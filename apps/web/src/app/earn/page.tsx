"use client";

import {
  APY_ASSUMPTION,
  emissionPerSecond,
  formaStakingAbi,
  formatBpsPercent,
  formatDateTimeUTC,
  formatToken,
  perDay,
  PositionStatus,
  RoutingMode,
  summarizePositions,
  type PositionView,
} from "@forma/sdk";
import Link from "next/link";
import { useReadContracts } from "wagmi";

import { ActionGate } from "@/components/NetworkGuard";
import { TxStatus } from "@/components/TxStatus";
import { Empty, Figure, Loading, ReadError, SectionHeader } from "@/components/ui";
import { useForma } from "@/lib/forma";
import { useActivity } from "@/lib/logs";
import { useMyPositions, useProtocol } from "@/lib/reads";
import { useNow } from "@/lib/time";
import { useFormaTx } from "@/lib/write";

const MODE = ["KEEP", "COMPOUND", "REDIRECT"];

export default function EarnPage() {
  const now = useNow();
  const { connected } = useForma();
  const { rewardState, compoundConfig, pools, paused, error: protocolError } = useProtocol();
  const { positions, isLoading } = useMyPositions();
  const { send, targets, isActive } = useFormaTx();
  const active = (positions ?? []).filter((v) => v.position.status === PositionStatus.Active);
  const s = summarizePositions(active, now);
  const streamActive = rewardState ? rewardState.periodFinish > now : false;

  return (
    <div className="pt-10">
      <p className="label">Earn</p>
      <h1 className="display mt-3 text-[clamp(2rem,6vw,5rem)]">Rewards &amp; compounding</h1>

      {/* ─── protocol stream ─── */}
      <section className="mt-10">
        <SectionHeader index="01" title="Reward stream · protocol-wide" aside="FormaStaking.rewardState" />
        {protocolError ? (
          <div className="pt-6">
            <ReadError error={protocolError} what="reward state" />
          </div>
        ) : !rewardState ? (
          <Loading />
        ) : (
          <>
            <div className="grid gap-8 pt-8 sm:grid-cols-2 lg:grid-cols-4">
              <Figure
                label="Emission rate"
                value={streamActive ? formatToken(perDay(emissionPerSecond(rewardState.rewardRate)), { maxDecimals: 0, minDecimals: 0 }) : "0"}
                unit="FORGE / DAY"
                size="md"
                note={streamActive ? `Until ${formatDateTimeUTC(rewardState.periodFinish)}` : "No active stream"}
              />
              <Figure label="Total weight" value={formatToken(rewardState.totalWeight, { maxDecimals: 0, minDecimals: 0 })} size="md" note="Σ principal × active multiplier" />
              <Figure label="Owed to positions" value={formatToken(rewardState.outstandingRewards, { maxDecimals: 0, minDecimals: 0 })} unit="FORGE" size="md" />
              <Figure label="Idle (re-streamable)" value={formatToken(rewardState.idleRewards, { maxDecimals: 0, minDecimals: 0 })} unit="FORGE" size="md" note="Forfeits, penalties, zero-weight periods" />
            </div>
            <dl className="mt-10 grid gap-px bg-rule text-sm md:grid-cols-4">
              {[
                ["Emission rate", "Tokens released per second by the protocol, for everyone combined. Set when the reward manager funds a stream."],
                ["Reward rate", "Your position's share of emission: emission × your weight ÷ total weight. Changes whenever anyone stakes or exits."],
                ["Estimated APR", "Reward rate × one year ÷ principal, computed on-chain by previewStake. Assumes nothing changes for a year."],
                ["Estimated APY", APY_ASSUMPTION],
              ].map(([t, d]) => (
                <div key={t} className="bg-ivory p-4">
                  <dt className="label text-ink">{t}</dt>
                  <dd className="mt-2 text-ink-2">{d}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>

      {/* ─── your rewards ─── */}
      <section className="mt-14">
        <SectionHeader index="02" title="Your rewards" aside={connected ? `${formatToken(s.totalPending, { maxDecimals: 4 })} FORGE pending` : undefined} />
        {!connected ? (
          <div className="pt-6">
            <ActionGate action="see your rewards">{null}</ActionGate>
          </div>
        ) : isLoading || !positions ? (
          <Loading />
        ) : active.length === 0 ? (
          <div className="pt-6">
            <Empty title="Nothing earning yet">
              <Link href="/stake" className="underline">Open a position</Link> to start earning test rewards.
            </Empty>
          </div>
        ) : (
          <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="data-table min-w-[820px]">
              <thead>
                <tr>
                  <th scope="col">Position</th>
                  <th scope="col">Pool</th>
                  <th scope="col" className="text-right">Pending</th>
                  <th scope="col" className="text-right">Rate / day</th>
                  <th scope="col">Routing</th>
                  <th scope="col" className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {active.map((v) => {
                  const id = v.id;
                  const busy = isActive(`claim:${id}`) || isActive(`compound:${id}`);
                  return (
                    <tr key={id.toString()}>
                      <td>
                        <Link href={`/positions/${id}`} className="numeral text-2xl hover:underline">#{id.toString()}</Link>
                      </td>
                      <td className="display uppercase">{pools?.[v.position.poolId]?.name}</td>
                      <td className="mono text-right text-sm text-lime-ink">{formatToken(v.pendingRewards, { maxDecimals: 4 })}</td>
                      <td className="mono text-right text-sm">{formatToken(perDay(v.rewardPerSecond), { maxDecimals: 4 })}</td>
                      <td className="mono text-xs">{MODE[v.effectiveRouting.mode]}</td>
                      <td className="text-right">
                        <ActionGate>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="btn btn-ghost min-h-9"
                              disabled={busy || !!paused || v.pendingRewards === 0n}
                              onClick={() => targets && send(targets.staking, "claim", [id], { key: `claim:${id}`, label: `Claim rewards · #${id}` })}
                            >
                              Claim
                            </button>
                            <button
                              type="button"
                              className="btn min-h-9"
                              disabled={busy || !!paused || v.pendingRewards === 0n}
                              onClick={() => targets && send(targets.staking, "compound", [id], { key: `compound:${id}`, label: `Compound · #${id}` })}
                            >
                              Compound
                            </button>
                          </div>
                        </ActionGate>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 space-y-2">
              {active.map((v) => (
                <div key={v.id.toString()}>
                  <TxStatus txKey={`claim:${v.id}`} />
                  <TxStatus txKey={`compound:${v.id}`} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ─── keepers ─── */}
      <section className="mt-14">
        <SectionHeader
          index="03"
          title="Keeper board"
          aside={compoundConfig ? `Protocol keeper fee ${formatBpsPercent(compoundConfig.keeperFeeBps)} · cooldown ${Number(compoundConfig.keeperCooldown) / 60} min` : undefined}
        />
        <p className="max-w-prose pt-4 text-sm text-ink-2">
          Owners who choose COMPOUND routing let anyone compound their position. The caller earns min(protocol fee,
          owner&apos;s cap) of the compounded rewards, subject to a minimum amount and a per-position cooldown.
          Candidates are discovered from recent <code className="mono">RewardRedirectConfigured</code> logs (indexed) and
          then verified against current on-chain state.
        </p>
        <KeeperBoard minAmount={compoundConfig?.minCompoundAmount} />
      </section>
    </div>
  );
}

function KeeperBoard({ minAmount }: { minAmount: bigint | undefined }) {
  const { contracts, readChainId, address } = useForma();
  const activity = useActivity(undefined);
  const ids = [
    ...new Set(
      (activity.data?.items ?? [])
        .filter((i) => i.event === "RewardRedirectConfigured" && Number(i.args.mode) === RoutingMode.Compound)
        .map((i) => (i.args.positionId as bigint).toString()),
    ),
  ].map(BigInt);

  const views = useReadContracts({
    contracts: contracts
      ? ids.map((id) => ({
          address: contracts.staking.address,
          abi: formaStakingAbi,
          functionName: "getPositionView" as const,
          args: [id] as const,
          chainId: readChainId,
        }))
      : [],
    query: { enabled: ids.length > 0, refetchInterval: 15_000 },
  });

  if (activity.isLoading) return <Loading label="Scanning recent logs" />;
  if (activity.error) return <div className="pt-4"><ReadError error={activity.error} what="indexed logs" /></div>;

  const live = (views.data ?? [])
    .map((r) => (r.status === "success" ? (r.result as PositionView) : undefined))
    .filter(
      (v): v is PositionView =>
        !!v && v.position.status === PositionStatus.Active && v.effectiveRouting.mode === RoutingMode.Compound,
    );

  if (live.length === 0) {
    return (
      <div className="pt-6">
        <Empty title="No compounding opportunities in the scanned range">
          Blocks {activity.data?.fromBlock.toString()}–{activity.data?.toBlock.toString()} contain no positions that
          currently opt in to keeper compounding.
        </Empty>
      </div>
    );
  }

  return (
    <div className="relative -mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="data-table min-w-[640px]">
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col" className="text-right">Pending</th>
            <th scope="col" className="text-right">Owner fee cap</th>
            <th scope="col">Eligible</th>
            <th scope="col"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {live.map((v) => {
            const eligible = minAmount === undefined || v.pendingRewards >= minAmount;
            const own = address && v.owner.toLowerCase() === address.toLowerCase();
            return (
              <tr key={v.id.toString()}>
                <td className="numeral text-xl">#{v.id.toString()}</td>
                <td className="mono text-right text-sm">{formatToken(v.pendingRewards, { maxDecimals: 4 })}</td>
                <td className="mono text-right text-sm">{formatBpsPercent(v.effectiveRouting.maxKeeperFeeBps)}</td>
                <td className="mono text-xs">{own ? "YOUR POSITION" : eligible ? "ABOVE MINIMUM" : "BELOW MINIMUM"}</td>
                <td className="text-right">
                  <Link href={`/positions/${v.id}`} className="btn btn-ghost min-h-9">Open</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
