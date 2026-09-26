"use client";

import {
  APY_ASSUMPTION,
  aprBpsToApyBps,
  formatBpsPercent,
  formatDateUTC,
  formatLockDuration,
  formatMultiplier,
  formatRateBps,
  formatTokenCompact,
  GLYPH_HEX,
  lockHue,
  type Pool,
} from "@forma/sdk";
import Link from "next/link";

import { usePoolPreviews, useProtocol } from "@/lib/reads";
import { useNow } from "@/lib/time";

import { Loading, ReadError, TestnetEstimate } from "./ui";

export const REFERENCE_STAKE = 1000n * 10n ** 18n;
const MAX_LOCK_FOR_BAR = 180 * 86_400;

function LockBar({ seconds }: { seconds: bigint }) {
  const s = Number(seconds);
  const width = s === 0 ? 2 : Math.max(6, Math.sqrt(s / MAX_LOCK_FOR_BAR) * 100);
  return (
    <span aria-hidden className="mt-1.5 block h-1 w-24 bg-ink/10">
      <span className="block h-full" style={{ width: `${Math.min(100, width)}%`, background: GLYPH_HEX[lockHue(seconds)] }} />
    </span>
  );
}

/**
 * Pools are lock tiers sharing one reward stream. APR comes from the contract's own `previewStake`.
 * `select` renders a choose button instead of a link (used by the staking flow).
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

  return (
    <div>
      <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="data-table min-w-[720px]">
          <thead>
            <tr>
              <th scope="col">Pool</th>
              <th scope="col">Lock</th>
              <th scope="col">Multiplier</th>
              <th scope="col">Early exit</th>
              <th scope="col" className="text-right">Staked</th>
              <th scope="col" className="text-right">Est. APR / APY*</th>
              <th scope="col">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pools.map((pool: Pool, i: number) => {
              const pv = previews.data?.[i];
              const apr = pv?.status === "success" ? pv.result.estimatedAprBps : undefined;
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
                    <span className="mono text-sm">{formatLockDuration(pool.lockDuration)}</span>
                    <LockBar seconds={pool.lockDuration} />
                  </td>
                  <td className="numeral text-2xl">{formatMultiplier(pool.multiplierBps)}</td>
                  <td className="mono text-sm">
                    {pool.lockDuration === 0n ? "—" : formatBpsPercent(pool.earlyExitPenaltyBps)}
                  </td>
                  <td className="mono text-right text-sm">{formatTokenCompact(pool.totalPrincipal)}</td>
                  <td className="mono text-right text-sm">
                    {apr === undefined ? (
                      previews.isLoading ? "…" : "—"
                    ) : (
                      <>
                        <span className="text-ink">{formatRateBps(apr > 0n ? apr : null)}</span>
                        <span className="block text-[11px] text-ink-3">{formatRateBps(aprBpsToApyBps(apr))}</span>
                      </>
                    )}
                  </td>
                  <td className="text-right">
                    {select ? (
                      <button
                        type="button"
                        className={`btn ${isSelected ? "" : "btn-ghost"} min-h-9`}
                        disabled={!pool.active}
                        aria-pressed={isSelected}
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
      <div className="mt-3 flex flex-wrap items-start gap-3 text-xs text-ink-2">
        <TestnetEstimate />
        <p className="max-w-3xl">
          *APR from the contract&apos;s <code className="mono">previewStake</code> for a new{" "}
          {formatTokenCompact(REFERENCE_STAKE)} FORGE position: current emission × its weight share (including its own
          dilution), annualised, while its boost is active. APY: {APY_ASSUMPTION}{" "}
          {rewardState && streamActive && rewardState.totalWeight === 0n && (
            <strong className="text-ink">
              Nobody is staked yet, so a new stake would receive the entire emission — that is why the estimate is
              extreme. It falls as soon as others stake.{" "}
            </strong>
          )}
          {rewardState &&
            (streamActive
              ? `Current reward stream ends ${formatDateUTC(rewardState.periodFinish)}.`
              : "No reward stream is active right now.")}
        </p>
      </div>
    </div>
  );
}
