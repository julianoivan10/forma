import { formatCountdown, formatDateUTC, lockProgress } from "@forma/sdk";

/**
 * Horizontal lock timeline: start → now → unlock. For positions without a lock it says so plainly.
 */
export function LockTimeline({
  startTime,
  unlockTime,
  now,
  compact = false,
}: {
  startTime: bigint;
  unlockTime: bigint;
  now: bigint;
  compact?: boolean;
}) {
  if (unlockTime === startTime) {
    return (
      <div className="mono text-xs tracking-[0.12em] text-lime-ink uppercase">
        No lock · withdraw any time · 1.00× base weight
      </div>
    );
  }
  const p = lockProgress(startTime, unlockTime, now);
  const done = p >= 1;
  const remaining = unlockTime > now ? unlockTime - now : 0n;
  const pct = Math.round(p * 1000) / 10;
  return (
    <div>
      <div
        className="relative h-3 border border-ink bg-paper"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Lock progress"
      >
        {/* decile ticks */}
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} aria-hidden className="absolute top-0 h-full w-px bg-ink/15" style={{ left: `${(i + 1) * 10}%` }} />
        ))}
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 ${done ? "bg-lime" : "bg-orange"}`}
          style={{ width: `${p * 100}%` }}
        />
        {!done && (
          <span aria-hidden className="absolute -top-1.5 h-6 w-0.5 bg-ink" style={{ left: `calc(${p * 100}% - 1px)` }} />
        )}
      </div>
      {!compact && (
        <div className="mono mt-2 flex justify-between gap-2 text-[11px] tracking-wide text-ink-2 uppercase">
          <span>Start {formatDateUTC(startTime)}</span>
          <span className={done ? "text-lime-ink" : "text-ink"}>
            {done ? "Unlocked" : `${formatCountdown(remaining)} left · ${pct}%`}
          </span>
          <span>Unlock {formatDateUTC(unlockTime)}</span>
        </div>
      )}
    </div>
  );
}
