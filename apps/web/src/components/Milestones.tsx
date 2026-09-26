"use client";

import { deriveMilestones, type PositionView } from "@forma/sdk";

import { useAccountStats, useVault } from "@/lib/reads";

/** Protocol reputation. Every mark is derived from on-chain counters or live holdings. */
export function Milestones({ positions, now }: { positions: readonly PositionView[]; now: bigint }) {
  const stats = useAccountStats();
  const { shares } = useVault();
  if (!stats.data) return null;
  const list = deriveMilestones(stats.data, positions, shares ?? 0n, now);
  const achieved = list.filter((m) => m.achieved).length;
  return (
    <div>
      <p className="label mb-4">
        Reputation · {achieved}/{list.length} marks
      </p>
      <ol className="grid grid-cols-1 gap-px bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {list.map((m, i) => (
          <li
            key={m.id}
            className={`bg-ivory p-4 ${m.achieved ? "" : "text-ink-3"} ${i === list.length - 1 && list.length % 2 === 1 ? "sm:col-span-2 lg:col-span-2" : ""}`}
          >
            <div className="flex items-center justify-between">
              <span className="mono text-[10px] tracking-[0.14em]">{String(i + 1).padStart(2, "0")}</span>
              <span
                aria-hidden
                className={`size-3 ${m.achieved ? "bg-lime ring-1 ring-ink" : "border border-dashed border-ink-3"}`}
              />
            </div>
            <p className={`display mt-3 text-lg ${m.achieved ? "" : "opacity-60"}`}>{m.label}</p>
            <p className="mt-1 text-xs">{m.description}</p>
            <p className="mono mt-2 text-[10px] tracking-[0.12em] uppercase">
              {m.achieved ? "Achieved" : "Not yet"} · {m.source === "counter" ? "on-chain counter" : "live holding"}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
