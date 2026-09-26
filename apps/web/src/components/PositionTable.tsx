"use client";

import {
  formatCountdown,
  formatMultiplier,
  formatToken,
  PHASE_LABEL,
  positionPhase,
  type Pool,
  type PositionView,
} from "@forma/sdk";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PositionGlyph } from "./PositionGlyph";

const PHASE_TONE: Record<string, string> = {
  open: "border-lime-ink text-lime-ink",
  locked: "border-orange-ink text-orange-ink",
  "boost-expirable": "border-sky-ink text-sky-ink",
  unlocked: "border-lime-ink text-lime-ink",
};

export function PhaseTag({ view, now }: { view: PositionView; now: bigint }) {
  const phase = positionPhase(view, now);
  return <span className={`tag ${PHASE_TONE[phase] ?? "border-ink-3 text-ink-3"}`}>{PHASE_LABEL[phase]}</span>;
}

/** Dense list of positions. Each row links to the position's own page. */
export function PositionTable({
  positions,
  pools,
  now,
}: {
  positions: readonly PositionView[];
  pools: readonly Pool[] | undefined;
  now: bigint;
}) {
  const router = useRouter();
  return (
    <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="data-table min-w-[760px]">
        <thead>
          <tr>
            <th scope="col" className="w-14">
              <span className="sr-only">Glyph</span>
            </th>
            <th scope="col">Position</th>
            <th scope="col">Pool</th>
            <th scope="col" className="text-right">Principal</th>
            <th scope="col" className="text-right">Multiplier</th>
            <th scope="col" className="text-right">Earned (pending)</th>
            <th scope="col">Status</th>
            <th scope="col" className="text-right">Unlock</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((v) => {
            const p = v.position;
            const href = `/positions/${v.id.toString()}`;
            const remaining = p.unlockTime > now ? p.unlockTime - now : 0n;
            return (
              <tr key={v.id.toString()} data-href={href} onClick={() => router.push(href)}>
                <td>
                  <PositionGlyph
                    input={{ id: v.id, ...p }}
                    now={now}
                    size={44}
                    showMultiplier={false}
                    animate={false}
                  />
                </td>
                <td>
                  <Link href={href} className="numeral text-2xl hover:underline" onClick={(e) => e.stopPropagation()}>
                    #{v.id.toString()}
                  </Link>
                </td>
                <td className="display text-base uppercase">{pools?.[p.poolId]?.name ?? `Pool ${p.poolId}`}</td>
                <td className="mono text-right text-sm">{formatToken(p.principal)} FORGE</td>
                <td className="numeral text-right text-xl">{formatMultiplier(p.activeMultiplierBps)}</td>
                <td className="mono text-right text-sm text-lime-ink">{formatToken(v.pendingRewards, { maxDecimals: 4 })}</td>
                <td>
                  <PhaseTag view={v} now={now} />
                </td>
                <td className="mono text-right text-sm">
                  {p.unlockTime === p.startTime ? "—" : remaining > 0n ? formatCountdown(remaining) : "Now"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
