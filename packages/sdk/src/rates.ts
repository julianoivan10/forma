import { BPS, SECONDS_PER_DAY } from "./types";

/**
 * Rates shown to users (docs/PROTOCOL.md §12). The protocol computes the APR on-chain
 * (`previewStake().estimatedAprBps`); this module only converts it — it never invents a rate.
 */

/** Days per year used for the APY compounding assumption. */
export const APY_COMPOUNDING_PERIODS = 365;

export const APY_ASSUMPTION =
  "Daily compounding of the current on-chain APR, assuming emission rate and total staked weight stay constant for a year. Testnet estimate — not a return.";

/** On-chain APR (bps) → APY (bps) under daily compounding. Returns `null` when there is no active stream. */
export function aprBpsToApyBps(aprBps: bigint, periods = APY_COMPOUNDING_PERIODS): bigint | null {
  if (aprBps <= 0n) return null;
  const apr = Number(aprBps) / Number(BPS);
  const apy = (1 + apr / periods) ** periods - 1;
  if (!Number.isFinite(apy)) return null;
  return BigInt(Math.floor(apy * Number(BPS)));
}

/** "12.34%" from bps; very large testnet rates are shown with a thousands separator. */
export function formatRateBps(bps: bigint | null): string {
  if (bps === null) return "—";
  const pct = Number(bps) / 100;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`;
}

/** Tokens per day (wei) from a per-second rate (wei/sec). */
export function perDay(ratePerSecond: bigint): bigint {
  return ratePerSecond * SECONDS_PER_DAY;
}

/** Protocol-wide emission in wei/sec from `rewardRate` (tokens/sec × 1e18 scale). */
export function emissionPerSecond(rewardRate: bigint): bigint {
  return rewardRate / 10n ** 18n;
}

/** Whether an annualised figure would outlive the funded stream (UI must show the stream end date). */
export function streamEndsWithinYear(periodFinish: bigint, nowSeconds: bigint): boolean {
  return periodFinish < nowSeconds + 365n * SECONDS_PER_DAY;
}
