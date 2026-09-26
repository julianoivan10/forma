"use client";

import {
  forgeTokenAbi,
  formaStakingAbi,
  liquidStakingVaultAbi,
  positionNftAbi,
  type PositionView,
} from "@forma/sdk";
import { useReadContract, useReadContracts } from "wagmi";

import { useForma } from "./forma";

/** Protocol state refreshes every ~2 Base blocks. */
const LIVE = { refetchInterval: 4_000 } as const;
const SLOW = { refetchInterval: 15_000 } as const;
export const POSITION_PAGE = 100n;

// ─── protocol ──────────────────────────────────────────────────────────────

export function useProtocol() {
  const { contracts, readChainId } = useForma();
  const s = contracts?.staking;
  const enabled = { enabled: !!s };
  const common = { address: s?.address, abi: formaStakingAbi, chainId: readChainId } as const;

  const pools = useReadContract({ ...common, functionName: "getPools", query: { ...enabled, ...SLOW } });
  const rewards = useReadContract({ ...common, functionName: "rewardState", query: { ...enabled, ...LIVE } });
  const compound = useReadContract({ ...common, functionName: "compoundConfig", query: { ...enabled, ...SLOW } });
  const paused = useReadContract({ ...common, functionName: "paused", query: { ...enabled, ...LIVE } });
  const pausedAt = useReadContract({ ...common, functionName: "pausedAt", query: { ...enabled, ...SLOW } });
  const nextId = useReadContract({ ...common, functionName: "nextPositionId", query: { ...enabled, ...LIVE } });

  return {
    pools: pools.data,
    rewardState: rewards.data,
    compoundConfig: compound.data,
    paused: paused.data,
    pausedAt: pausedAt.data,
    positionsCreated: nextId.data === undefined ? undefined : nextId.data - 1n,
    isLoading: pools.isLoading || rewards.isLoading,
    error: pools.error ?? rewards.error ?? paused.error,
  };
}

/** On-chain `previewStake` for every pool with the same reference amount. */
export function usePoolPreviews(poolCount: number, amount: bigint) {
  const { contracts, readChainId } = useForma();
  const s = contracts?.staking;
  return useReadContracts({
    contracts: s
      ? Array.from({ length: poolCount }, (_, i) => ({
          address: s.address,
          abi: formaStakingAbi,
          functionName: "previewStake" as const,
          args: [BigInt(i), amount] as const,
          chainId: readChainId,
        }))
      : [],
    query: { enabled: !!s && poolCount > 0, ...LIVE },
  });
}

export function useStakePreview(poolId: number | undefined, amount: bigint | undefined) {
  const { contracts, readChainId } = useForma();
  const s = contracts?.staking;
  return useReadContract({
    address: s?.address,
    abi: formaStakingAbi,
    functionName: "previewStake",
    args: poolId !== undefined && amount !== undefined ? [BigInt(poolId), amount] : undefined,
    chainId: readChainId,
    query: { enabled: !!s && poolId !== undefined && amount !== undefined, ...LIVE },
  });
}

// ─── positions ─────────────────────────────────────────────────────────────

export function useMyPositions() {
  const { contracts, readChainId, address } = useForma();
  const s = contracts?.staking;
  const n = contracts?.nft;
  const list = useReadContract({
    address: s?.address,
    abi: formaStakingAbi,
    functionName: "positionsOf",
    args: address ? [address, 0n, POSITION_PAGE] : undefined,
    chainId: readChainId,
    query: { enabled: !!s && !!address, ...LIVE },
  });
  const balance = useReadContract({
    address: n?.address,
    abi: positionNftAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: readChainId,
    query: { enabled: !!n && !!address, ...LIVE },
  });
  return {
    positions: list.data as readonly PositionView[] | undefined,
    ownedCount: balance.data,
    truncated: balance.data !== undefined && balance.data > POSITION_PAGE,
    isLoading: list.isLoading,
    error: list.error,
    refetch: list.refetch,
  };
}

export function usePosition(id: bigint | undefined) {
  const { contracts, readChainId } = useForma();
  const s = contracts?.staking;
  const enabled = !!s && id !== undefined;
  const common = {
    address: s?.address,
    abi: formaStakingAbi,
    chainId: readChainId,
    args: id !== undefined ? ([id] as const) : undefined,
  } as const;
  const view = useReadContract({ ...common, functionName: "getPositionView", query: { enabled, ...LIVE } });
  const emergency = useReadContract({ ...common, functionName: "previewEmergencyWithdraw", query: { enabled, ...LIVE } });
  const stored = useReadContract({ ...common, functionName: "storedRouting", query: { enabled, ...SLOW } });
  return {
    view: view.data,
    emergency: emergency.data,
    storedRouting: stored.data,
    isLoading: view.isLoading,
    error: view.error,
  };
}

export function useAccountStats() {
  const { contracts, readChainId, address } = useForma();
  const s = contracts?.staking;
  return useReadContract({
    address: s?.address,
    abi: formaStakingAbi,
    functionName: "accountStats",
    args: address ? [address] : undefined,
    chainId: readChainId,
    query: { enabled: !!s && !!address, ...SLOW },
  });
}

// ─── FORGE token ───────────────────────────────────────────────────────────

export function useForgeAccount() {
  const { contracts, readChainId, address } = useForma();
  const t = contracts?.forge;
  const enabled = !!t && !!address;
  const common = { address: t?.address, abi: forgeTokenAbi, chainId: readChainId } as const;
  const balance = useReadContract({
    ...common,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled, ...LIVE },
  });
  const stakingAllowance = useReadContract({
    ...common,
    functionName: "allowance",
    args: address && contracts ? [address, contracts.staking.address] : undefined,
    query: { enabled, ...LIVE },
  });
  const vaultAllowance = useReadContract({
    ...common,
    functionName: "allowance",
    args: address && contracts ? [address, contracts.vault.address] : undefined,
    query: { enabled, ...LIVE },
  });
  const nextFaucetAt = useReadContract({
    ...common,
    functionName: "nextFaucetAt",
    args: address ? [address] : undefined,
    query: { enabled, ...SLOW },
  });
  const faucetRemaining = useReadContract({
    ...common,
    functionName: "faucetRemainingToday",
    query: { enabled: !!t, ...SLOW },
  });
  return {
    balance: balance.data,
    stakingAllowance: stakingAllowance.data,
    vaultAllowance: vaultAllowance.data,
    nextFaucetAt: nextFaucetAt.data,
    faucetRemainingToday: faucetRemaining.data,
    isLoading: balance.isLoading,
  };
}

// ─── vault ─────────────────────────────────────────────────────────────────

export function useVault() {
  const { contracts, readChainId, address } = useForma();
  const v = contracts?.vault;
  const enabled = !!v;
  const common = { address: v?.address, abi: liquidStakingVaultAbi, chainId: readChainId } as const;
  const user = address ? ([address] as const) : undefined;

  const totalAssets = useReadContract({ ...common, functionName: "totalAssets", query: { enabled, ...LIVE } });
  const totalSupply = useReadContract({ ...common, functionName: "totalSupply", query: { enabled, ...LIVE } });
  const decimals = useReadContract({ ...common, functionName: "decimals", query: { enabled } });
  const exchangeRate = useReadContract({ ...common, functionName: "exchangeRate", query: { enabled, ...LIVE } });
  const positionId = useReadContract({ ...common, functionName: "positionId", query: { enabled, ...LIVE } });
  const exited = useReadContract({ ...common, functionName: "exited", query: { enabled, ...SLOW } });
  const idle = useReadContract({ ...common, functionName: "idleAssets", query: { enabled, ...SLOW } });
  const shares = useReadContract({
    ...common,
    functionName: "balanceOf",
    args: user,
    query: { enabled: enabled && !!user, ...LIVE },
  });
  const maxDeposit = useReadContract({
    ...common,
    functionName: "maxDeposit",
    args: user,
    query: { enabled: enabled && !!user, ...LIVE },
  });
  const maxRedeem = useReadContract({
    ...common,
    functionName: "maxRedeem",
    args: user,
    query: { enabled: enabled && !!user, ...LIVE },
  });
  const shareValue = useReadContract({
    ...common,
    functionName: "convertToAssets",
    args: shares.data !== undefined ? [shares.data] : undefined,
    query: { enabled: enabled && shares.data !== undefined, ...LIVE },
  });

  return {
    totalAssets: totalAssets.data,
    totalSupply: totalSupply.data,
    decimals: decimals.data,
    exchangeRate: exchangeRate.data,
    positionId: positionId.data,
    exited: exited.data,
    idleAssets: idle.data,
    shares: shares.data,
    shareValue: shareValue.data,
    maxDeposit: maxDeposit.data,
    maxRedeem: maxRedeem.data,
    isLoading: totalAssets.isLoading,
    error: totalAssets.error,
  };
}

export function useVaultPreview(kind: "deposit" | "redeem", amount: bigint | undefined) {
  const { contracts, readChainId } = useForma();
  const v = contracts?.vault;
  return useReadContract({
    address: v?.address,
    abi: liquidStakingVaultAbi,
    functionName: kind === "deposit" ? "previewDeposit" : "previewRedeem",
    args: amount !== undefined ? [amount] : undefined,
    chainId: readChainId,
    query: { enabled: !!v && amount !== undefined && amount > 0n, ...LIVE },
  });
}
