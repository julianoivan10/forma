import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

import { formatDateTimeUTC, formatToken } from "./format";

export type ErrorKind =
  | "rejected" // user declined in wallet
  | "wrong-network"
  | "insufficient-gas"
  | "insufficient-balance"
  | "insufficient-allowance"
  | "reverted" // contract rejected with a known reason
  | "network" // RPC / connectivity
  | "unknown";

export interface DescribedError {
  kind: ErrorKind;
  title: string;
  detail: string;
  /** Raw reason for power users (error name or short message). */
  technical?: string;
}

type Args = readonly unknown[] | undefined;
const big = (args: Args, i: number) => (args?.[i] as bigint | undefined) ?? 0n;

/** Human explanations for every custom error the protocol can raise. */
const CONTRACT_ERRORS: Record<string, (args: Args) => { title: string; detail: string }> = {
  // FormaStaking
  ZeroAmount: () => ({ title: "Amount required", detail: "Enter an amount greater than zero." }),
  ZeroAddress: () => ({ title: "Address required", detail: "A non-zero address is required." }),
  InvalidPool: () => ({ title: "Unknown pool", detail: "This pool does not exist." }),
  PoolInactive: () => ({ title: "Pool closed", detail: "This pool is not accepting new stakes right now." }),
  PoolCapExceeded: () => ({ title: "Pool is full", detail: "This stake would exceed the pool capacity." }),
  BelowMinStake: (a) => ({
    title: "Below minimum",
    detail: `This pool requires at least ${formatToken(big(a, 0))} FORGE.`,
  }),
  PoolTermsChanged: () => ({
    title: "Pool terms changed",
    detail: "The pool lock or multiplier changed since you reviewed it. Refresh and review the new terms.",
  }),
  PositionNotActive: () => ({ title: "Position closed", detail: "This position is no longer active." }),
  NotPositionOwner: () => ({ title: "Not your position", detail: "Only the owner of the position NFT can do this." }),
  NotAuthorizedToClaim: () => ({
    title: "Not authorised",
    detail: "Only the owner (or the configured redirect recipient) can claim these rewards.",
  }),
  PositionLocked: (a) => ({
    title: "Still locked",
    detail: `This position unlocks on ${formatDateTimeUTC(big(a, 0))}.`,
  }),
  InsufficientPrincipal: () => ({ title: "Amount too large", detail: "You cannot withdraw more than the principal." }),
  NothingToClaim: () => ({ title: "Nothing to claim", detail: "This position has no pending rewards yet." }),
  NothingToCompound: () => ({ title: "Nothing to compound", detail: "This position has no pending rewards yet." }),
  CompoundNotAuthorized: () => ({
    title: "Compounding not enabled",
    detail: "The owner has not opted this position into keeper compounding.",
  }),
  CompoundTooSmall: (a) => ({
    title: "Too small to compound",
    detail: `Keepers can compound once at least ${formatToken(big(a, 0))} FORGE is pending.`,
  }),
  CompoundCooldown: (a) => ({
    title: "Compound cooldown",
    detail: `Keepers can compound this position again after ${formatDateTimeUTC(big(a, 0))}.`,
  }),
  InvalidRouting: () => ({ title: "Invalid routing", detail: "Check the routing mode and recipient address." }),
  InvalidKeeperFee: () => ({ title: "Keeper fee too high", detail: "The keeper fee cap must be at most 5%." }),
  BoostNotExpirable: () => ({ title: "Boost still valid", detail: "This position boost has not expired." }),
  NoRewardBudget: () => ({ title: "No reward budget", detail: "There are no unallocated rewards to stream." }),
  UnsupportedTokenTransfer: () => ({ title: "Token not supported", detail: "The token transfer amount mismatched." }),
  EnforcedPause: () => ({
    title: "Protocol paused",
    detail: "Staking is paused by the protocol pauser. Emergency withdrawal remains available.",
  }),
  // ForgeToken faucet
  FaucetCooldown: (a) => ({
    title: "Faucet cooldown",
    detail: `You can request test FORGE again after ${formatDateTimeUTC(big(a, 0))}.`,
  }),
  FaucetDailyCapReached: () => ({
    title: "Faucet empty for today",
    detail: "The global daily faucet cap has been reached. Try again after 00:00 UTC.",
  }),
  MaxSupplyExceeded: () => ({ title: "Supply cap reached", detail: "The test token supply cap has been reached." }),
  // Vault
  ZeroShares: () => ({ title: "Amount too small", detail: "This amount would mint zero stFORGE shares." }),
  ZeroAssets: () => ({ title: "Amount too small", detail: "This amount of stFORGE redeems to zero FORGE." }),
  SlippageExceeded: () => ({
    title: "Exchange rate moved",
    detail: "The vault exchange rate changed beyond your limit. Review the updated preview.",
  }),
  VaultExited: () => ({
    title: "Vault exited",
    detail: "The vault performed an emergency exit. Deposits are closed; redemptions are paid from idle FORGE.",
  }),
  ERC4626ExceededMaxDeposit: () => ({
    title: "Deposits unavailable",
    detail: "The vault cannot accept this deposit now (protocol paused, pool closed or at capacity).",
  }),
  ERC4626ExceededMaxRedeem: () => ({
    title: "Redemptions unavailable",
    detail: "You cannot redeem this much right now (protocol paused or balance too low).",
  }),
  ERC4626ExceededMaxWithdraw: () => ({
    title: "Withdrawals unavailable",
    detail: "You cannot withdraw this much right now (protocol paused or balance too low).",
  }),
  // ERC-20
  ERC20InsufficientBalance: () => ({ title: "Insufficient FORGE", detail: "Your test FORGE balance is too low." }),
  ERC20InsufficientAllowance: () => ({
    title: "Approval required",
    detail: "Approve FORGE for this contract before continuing.",
  }),
};

const KIND_FOR: Record<string, ErrorKind> = {
  ERC20InsufficientBalance: "insufficient-balance",
  ERC20InsufficientAllowance: "insufficient-allowance",
};

/**
 * Converts any wallet/RPC/contract error into a specific, user-facing explanation.
 * Never returns a generic "Something went wrong".
 */
export function describeError(error: unknown): DescribedError {
  if (error instanceof BaseError) {
    const rejected = error.walk(
      (e) => e instanceof UserRejectedRequestError || (e as { code?: number } | null)?.code === 4001,
    );
    if (rejected) {
      return {
        kind: "rejected",
        title: "Request declined",
        detail: "You declined the request in your wallet. Nothing was sent.",
      };
    }

    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "";
      const known = CONTRACT_ERRORS[name];
      if (known) return { kind: KIND_FOR[name] ?? "reverted", ...known(revert.data?.args), technical: name };
      if (revert.reason) {
        return { kind: "reverted", title: "Transaction would fail", detail: revert.reason, technical: revert.reason };
      }
      return {
        kind: "reverted",
        title: "Transaction would fail",
        detail: "The contract rejected this call. Check the amount, network and position state.",
        technical: revert.shortMessage,
      };
    }

    const msg = `${error.shortMessage} ${error.details ?? ""}`.toLowerCase();
    if (msg.includes("insufficient funds")) {
      return {
        kind: "insufficient-gas",
        title: "Not enough ETH for gas",
        detail: "Your wallet needs Base Sepolia ETH to pay gas. Use a Base Sepolia faucet, then try again.",
        technical: error.shortMessage,
      };
    }
    if (msg.includes("chain mismatch") || msg.includes("does not match the target chain")) {
      return {
        kind: "wrong-network",
        title: "Wrong network",
        detail: "Switch your wallet to Base Sepolia to continue.",
        technical: error.shortMessage,
      };
    }
    if (
      msg.includes("http request failed") ||
      msg.includes("failed to fetch") ||
      msg.includes("timeout") ||
      msg.includes("timed out")
    ) {
      return {
        kind: "network",
        title: "Network unreachable",
        detail: "The RPC endpoint did not respond. Check your connection or try again in a moment.",
        technical: error.shortMessage,
      };
    }
    return { kind: "unknown", title: "Request failed", detail: error.shortMessage, technical: error.name };
  }
  if (error instanceof Error) {
    return { kind: "unknown", title: "Request failed", detail: error.message, technical: error.name };
  }
  return { kind: "unknown", title: "Request failed", detail: String(error) };
}
