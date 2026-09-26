"use client";

import {
  APR_NOT_MEANINGFUL_NOTE,
  APY_ASSUMPTION,
  assessAprEstimate,
  formatBpsPercent,
  formatDateUTC,
  formatLockDuration,
  formatMultiplier,
  formatTokenCompact,
  GLYPH_HEX,
  lockHue,
  type AprAssessment,
  type Pool,
} from "@forma/sdk";
import Link from "next/link";

import { usePoolPreviews, useProtocol } from "@/lib/reads";
import { useNow } from "@/lib/time";

import { AprEstimate, AprLabel } from "./AprEstimate";
import { Loading, ReadError } from "./ui";

export const REFERENCE_STAKE = 1000n * 10n ** 18n;
const MAX_LOCK_FOR_BAR = 180 * 86_400;

function LockBar({ seconds }: { seconds: bigint }) {
  const s = Number(seconds);
  const width = s === 0 ? 2 : Math.max(6, Math.sqrt(s / MAX_LOCK_FOR_BAR) * 100);
  return (
    <span aria-hidden className="mt-1.5 block h-1 w-20 bg-ink/10">
      <span className="block h-full" style={{ width: `${Math.min(100, width)}%`, background: GLYPH_HEX[lockHue(seconds)] }} />
    </span>
  );
}

/**
 * Pools are lock tiers sharing one reward stream. APR comes from the contract's own `previewStake`; the
 * `assessAprEstimate` guard only decides whether it is meaningful enough to show.
 * `select` turns the table into the staking flow's tier picker (compact: no Staked column).
 */
export function PoolTable({
  select,
  selected,
}: {
  select?: (poolId: number) => void;
  selected?: number;
}) {
  const { pools, rewardState, isLoading, error } = useProtocol();
  const previews = usePoolPreviews(pools?.length ?? 0, REFERENCE_STAKE);
  const now = useNow(15_000);

  if (error) return <ReadError error={error} what="pools" />;
  if (isLoading || !pools) return <Loading label="Reading pools" />;

  const streamActive = rewardState && rewardState.periodFinish > now;
  const compact = !!select;
  const assessments: (AprAssessment | undefined)[] = pools.map((_, i) => {
    const pv = previews.data?.[i];
    if (pv?.status !== "success" || !rewardState) return undefined;
    return assessAprEstimate(pv.result.estimatedAprBps, pv.result.weight, rewardState.totalWeight);
  });
  const anyNotMeaningful = assessments.some((a) => a?.kind === "not-meaningful");

  return (
    <div>
      <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className={`data-table ${compact ? "min-w-150" : "min-w-180"}`}>
          <caption className="sr-only">Lock tiers with lock duration, multiplier, early-exit penalty and estimated APR</caption>
          <thead>
            <tr>
              <th scope="col">Pool</th>
              <th scope="col">Lock</th>
              <th scope="col">Multiplier</th>
              <th scope="col">Early exit</th>
              {!compact && (
                <th scope="col" className="text-right">
                  Staked
                </th>
              )}
              <th scope="col" className="text-right">
                <AprLabel />
                <span aria-hidden>*</span>
              </th>
              <th scope="col">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pools.map((pool: Pool, i: number) => {
              const assessment = assessments[i];
              const isSelected = selected === i;
              return (
                <tr
                  key={i}
                  aria-selected={select ? isSelected : undefined}
                  className={`${isSelected ? "bg-lime/25" : ""} ${select && pool.active ? "cursor-pointer" : ""}`}
                  // Whole-row tap target for touch screens where the action column may be scrolled out of view.
                  onClick={select && pool.active ? () => select(i) : undefined}
                >
                  <td>
                    <span className="display text-lg">{pool.name}</span>
                    <span className="mono ml-2 text-[10px] text-ink-3">#{i}</span>
                    {!pool.active && <span className="tag ml-2 border-ink-3 text-ink-3">Closed</span>}
                  </td>
                  <td>
                    <span className="mono text-sm whitespace-nowrap">{formatLockDuration(pool.lockDuration)}</span>
                    <LockBar seconds={pool.lockDuration} />
                  </td>
                  <td className="numeral text-2xl">{formatMultiplier(pool.multiplierBps)}</td>
                  <td className="mono text-sm">
                    {pool.lockDuration === 0n ? "—" : formatBpsPercent(pool.earlyExitPenaltyBps)}
                  </td>
                  {!compact && <td className="mono text-right text-sm">{formatTokenCompact(pool.totalPrincipal)}</td>}
                  <td className="mono text-right text-sm">
                    {assessment ? <AprEstimate assessment={assessment} /> : previews.isLoading ? "…" : "—"}
                  </td>
                  <td className="text-right">
                    {select ? (
                      <button
                        type="button"
                        className={`btn ${isSelected ? "" : "btn-ghost"} min-h-9`}
                        disabled={!pool.active}
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? "Selected" : "Choose"} ${pool.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          select(i);
                        }}
                      >
                        {isSelected ? "Selected" : "Choose"}
                      </button>
                    ) : (
                      <Link
                        href={`/stake?pool=${i}`}
                        className={`btn btn-ghost min-h-9 ${pool.active ? "" : "pointer-events-none opacity-40"}`}
                        aria-disabled={!pool.active}
                        aria-label={`Stake in ${pool.name}`}
                      >
                        Stake
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 max-w-3xl space-y-1.5 text-xs text-ink-2">
        {anyNotMeaningful && (
          <p className="text-ink">
            <strong>Not meaningful yet:</strong> {APR_NOT_MEANINGFUL_NOTE} Estimates appear once a new{" "}
            {formatTokenCompact(REFERENCE_STAKE)} FORGE stake would be a small share of total stake.
          </p>
        )}
        <p>
          *Estimated from the contract&apos;s <code className="mono">previewStake</code> for a new{" "}
          {formatTokenCompact(REFERENCE_STAKE)} FORGE position: current emission × its weight share, annualised, while
          its boost is active. APY: {APY_ASSUMPTION} Not a promise of yield.{" "}
          {rewardState &&
            (streamActive
              ? `Current reward stream ends ${formatDateUTC(rewardState.periodFinish)}.`
              : "No reward stream is active right now.")}
        </p>
      </div>
    </div>
  );
}
