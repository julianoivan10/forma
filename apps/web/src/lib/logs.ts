"use client";

import { formaStakingAbi, forgeTokenAbi, liquidStakingVaultAbi } from "@forma/sdk";
import { useQuery } from "@tanstack/react-query";
import type { Address, Hash, Log, PublicClient } from "viem";
import { parseEventLogs } from "viem";
import { usePublicClient } from "wagmi";

import { useForma } from "./forma";

/**
 * Indexed activity comes from `eth_getLogs` against the RPC. It is NOT authoritative state: it can lag, and
 * public RPCs cap the block range per request. Every UI that shows it labels it as such.
 */
export const LOG_CHUNK = 9_000n;
export const ACTIVITY_LOOKBACK = 90_000n; // ≈ 2 days of Base Sepolia blocks

async function getLogsChunked(client: PublicClient, address: Address[], from: bigint, to: bigint): Promise<Log[]> {
  const out: Log[] = [];
  for (let start = from; start <= to; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n > to ? to : start + LOG_CHUNK - 1n;
    out.push(...(await client.getLogs({ address, fromBlock: start, toBlock: end })));
  }
  return out;
}

/** Locates the `Stake` event of a position by estimating its block from `startTime`. */
export function usePositionCreation(positionId: bigint | undefined, startTime: bigint | undefined) {
  const { contracts, readChainId, deployment } = useForma();
  const client = usePublicClient({ chainId: readChainId });
  return useQuery({
    queryKey: ["position-creation", readChainId, positionId?.toString()],
    enabled: !!client && !!contracts && positionId !== undefined && startTime !== undefined,
    staleTime: Infinity,
    queryFn: async (): Promise<{ hash: Hash; blockNumber: bigint } | null> => {
      const latest = await client!.getBlock();
      const floor = BigInt(deployment?.startBlock ?? 0);
      const clamp = (b: bigint) => (b < floor ? floor : b > latest.number ? latest.number : b);
      // Small chains (local devnets): scan everything. Otherwise estimate the block from Base's ~2 s block
      // time and search a window around it, widening once.
      const windows: [bigint, bigint][] =
        latest.number - floor <= LOG_CHUNK * 5n
          ? [[floor, latest.number]]
          : (() => {
              const est = clamp(latest.number - (latest.timestamp > startTime! ? (latest.timestamp - startTime!) / 2n : 0n));
              return [3_000n, 30_000n].map((r) => [clamp(est - r), clamp(est + r)] as [bigint, bigint]);
            })();
      for (const [from, to] of windows) {
        const logs = await client!.getContractEvents({
          address: contracts!.staking.address,
          abi: formaStakingAbi,
          eventName: "Stake",
          args: { positionId },
          fromBlock: from,
          toBlock: to,
        });
        const hit = logs[0];
        if (hit?.transactionHash) return { hash: hit.transactionHash, blockNumber: hit.blockNumber };
      }
      return null;
    },
  });
}

export interface ActivityItem {
  key: string;
  blockNumber: bigint;
  hash: Hash;
  contract: "FormaStaking" | "ForgeToken" | "LiquidStakingVault";
  event: string;
  args: Record<string, unknown>;
}

const RELEVANT = new Set([
  "Stake",
  "PositionIncreased",
  "Unstake",
  "RewardClaimed",
  "RewardRedirected",
  "RewardRedirectConfigured",
  "Compound",
  "BoostExpired",
  "EmergencyWithdraw",
  "RewardsFunded",
  "PoolCreated",
  "PoolUpdated",
  "Paused",
  "Unpaused",
  "FaucetClaimed",
  "Deposit",
  "Withdraw",
  "VaultHarvested",
  "VaultEmergencyExit",
]);

/**
 * Recent protocol events, optionally filtered to those involving `account` — either naming it directly or
 * referring to one of `positionIds` (e.g. a keeper compounding the account's position).
 */
export function useActivity(account: Address | undefined, lookback = ACTIVITY_LOOKBACK, positionIds: string[] = []) {
  const { contracts, readChainId, deployment } = useForma();
  const client = usePublicClient({ chainId: readChainId });
  return useQuery({
    queryKey: ["activity", readChainId, account ?? "all", lookback.toString(), positionIds.join(",")],
    enabled: !!client && !!contracts,
    refetchInterval: 20_000,
    queryFn: async () => {
      const latest = await client!.getBlockNumber();
      const floor = BigInt(deployment?.startBlock ?? 0);
      const from = latest - lookback > floor ? latest - lookback : floor;
      const raw = await getLogsChunked(
        client!,
        [contracts!.staking.address, contracts!.forge.address, contracts!.vault.address],
        from,
        latest,
      );
      const byContract = (addr: Address) => raw.filter((l) => l.address.toLowerCase() === addr.toLowerCase());
      const decoded = [
        ...parseEventLogs({ abi: formaStakingAbi, logs: byContract(contracts!.staking.address) }).map((l) => ({
          ...l,
          contract: "FormaStaking" as const,
        })),
        ...parseEventLogs({ abi: forgeTokenAbi, logs: byContract(contracts!.forge.address) }).map((l) => ({
          ...l,
          contract: "ForgeToken" as const,
        })),
        ...parseEventLogs({ abi: liquidStakingVaultAbi, logs: byContract(contracts!.vault.address) }).map((l) => ({
          ...l,
          contract: "LiquidStakingVault" as const,
        })),
      ];
      const acct = account?.toLowerCase();
      const ids = new Set(positionIds);
      const items: ActivityItem[] = decoded
        .filter((l) => RELEVANT.has(l.eventName))
        .filter((l) => {
          if (!acct) return true;
          const args = (l.args ?? {}) as Record<string, unknown>;
          if (typeof args.positionId === "bigint" && ids.has(args.positionId.toString())) return true;
          return Object.values(args).some((v) => typeof v === "string" && v.toLowerCase() === acct);
        })
        .map((l) => ({
          key: `${l.transactionHash}-${l.logIndex}`,
          blockNumber: l.blockNumber,
          hash: l.transactionHash,
          contract: l.contract,
          event: l.eventName,
          args: (l.args ?? {}) as Record<string, unknown>,
        }))
        .sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber > b.blockNumber ? -1 : 1));
      return { items, fromBlock: from, toBlock: latest };
    },
  });
}
