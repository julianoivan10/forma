import type { PositionView } from "./types";
import { BPS, PositionStatus } from "./types";

export type PositionPhase =
  | "open" // no lock (e.g. Genesis)
  | "locked"
  | "boost-expirable" // unlocked, boost still applied until touched/kicked
  | "unlocked"
  | "closed"
  | "emergency-closed";

export function positionPhase(v: PositionView, nowSeconds: bigint): PositionPhase {
  const p = v.position;
  if (p.status === PositionStatus.Closed) return "closed";
  if (p.status === PositionStatus.EmergencyClosed) return "emergency-closed";
  if (p.unlockTime === p.startTime) return "open";
  if (nowSeconds < p.unlockTime) return "locked";
  if (p.activeMultiplierBps !== Number(BPS)) return "boost-expirable";
  return "unlocked";
}

export const PHASE_LABEL: Record<PositionPhase, string> = {
  open: "OPEN",
  locked: "LOCKED",
  "boost-expirable": "UNLOCKED · BOOST PENDING EXPIRY",
  unlocked: "UNLOCKED",
  closed: "CLOSED",
  "emergency-closed": "EMERGENCY EXITED",
};

/** Lock progress in [0, 1]. Positions without a lock are complete. */
export function lockProgress(startTime: bigint, unlockTime: bigint, nowSeconds: bigint): number {
  if (unlockTime <= startTime || nowSeconds >= unlockTime) return 1;
  if (nowSeconds <= startTime) return 0;
  return Number(nowSeconds - startTime) / Number(unlockTime - startTime);
}

export function secondsUntilUnlock(unlockTime: bigint, nowSeconds: bigint): bigint {
  return unlockTime > nowSeconds ? unlockTime - nowSeconds : 0n;
}

export interface PortfolioSummary {
  totalPrincipal: bigint;
  totalPending: bigint;
  /** Principal-weighted current multiplier in bps (0 when nothing is staked). */
  weightedMultiplierBps: bigint;
  lockedPrincipal: bigint;
  /** Soonest future unlock among locked positions. */
  nextUnlock: bigint | null;
  activeCount: number;
}

/** Aggregates what the dashboard needs to answer "what do I own / what is earning / what is locked". */
export function summarizePositions(views: readonly PositionView[], nowSeconds: bigint): PortfolioSummary {
  let totalPrincipal = 0n;
  let totalPending = 0n;
  let totalWeight = 0n;
  let lockedPrincipal = 0n;
  let nextUnlock: bigint | null = null;
  let activeCount = 0;
  for (const v of views) {
    if (v.position.status !== PositionStatus.Active) continue;
    activeCount++;
    totalPrincipal += v.position.principal;
    totalWeight += v.position.weight;
    totalPending += v.pendingRewards;
    if (nowSeconds < v.position.unlockTime) {
      lockedPrincipal += v.position.principal;
      if (nextUnlock === null || v.position.unlockTime < nextUnlock) nextUnlock = v.position.unlockTime;
    }
  }
  const weightedMultiplierBps = totalPrincipal === 0n ? 0n : (totalWeight * BPS) / totalPrincipal;
  return { totalPrincipal, totalPending, weightedMultiplierBps, lockedPrincipal, nextUnlock, activeCount };
}
