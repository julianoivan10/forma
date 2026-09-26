"use client";

import { emissionPerSecond, formatDateUTC, formatToken, formatTokenCompact, perDay } from "@forma/sdk";

import { useProtocol } from "@/lib/reads";
import { useNow } from "@/lib/time";

import { Figure, Loading, ReadError } from "./ui";

/** Protocol-wide state, read live from FormaStaking. */
export function ProtocolStats() {
  const { rewardState, positionsCreated, paused, isLoading, error } = useProtocol();
  const now = useNow(15_000);
  if (error) return <ReadError error={error} what="protocol state" />;
  if (isLoading || !rewardState) return <Loading label="Reading protocol state" />;

  const active = rewardState.periodFinish > now;
  const daily = active ? perDay(emissionPerSecond(rewardState.rewardRate)) : 0n;

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
      <Figure label="Total staked" value={formatTokenCompact(rewardState.totalPrincipal)} unit="FORGE" size="md" />
      <Figure
        label="Emission rate"
        value={active ? formatTokenCompact(daily) : "0"}
        unit="FORGE / DAY"
        size="md"
        note={active ? `Stream ends ${formatDateUTC(rewardState.periodFinish)}` : "No active reward stream"}
      />
      <Figure
        label="Reward reserve"
        value={formatTokenCompact(rewardState.rewardReserve)}
        unit="FORGE"
        size="md"
        note={`Owed: ${formatToken(rewardState.outstandingRewards, { maxDecimals: 0, minDecimals: 0 })} · idle: ${formatToken(rewardState.idleRewards, { maxDecimals: 0, minDecimals: 0 })}`}
      />
      <Figure
        label="Positions opened"
        value={positionsCreated?.toString() ?? "—"}
        size="md"
        note={paused ? "Protocol is PAUSED" : "Protocol live"}
        tone={paused ? "orange" : "ink"}
      />
    </div>
  );
}
