"use client";

import { formatToken, shortAddress } from "@forma/sdk";
import Link from "next/link";
import { useState } from "react";

import { TxSteps } from "@/components/TxStatus";
import { Empty, Loading, ReadError, SectionHeader, TxLink } from "@/components/ui";
import { useForma } from "@/lib/forma";
import { ACTIVITY_LOOKBACK, useActivity, type ActivityItem } from "@/lib/logs";
import { useMyPositions } from "@/lib/reads";
import { useTx } from "@/lib/tx";

function describe(item: ActivityItem): string {
  const a = item.args;
  const amt = (k: string) => (typeof a[k] === "bigint" ? `${formatToken(a[k] as bigint, { maxDecimals: 4 })} FORGE` : "");
  const id = typeof a.positionId === "bigint" ? `#${a.positionId}` : "";
  switch (item.event) {
    case "Stake":
      return `Opened ${id} in pool ${a.poolId} · ${amt("amount")}`;
    case "PositionIncreased":
      return `Increased ${id} · ${amt("amount")}`;
    case "Unstake":
      return `${a.closed ? "Closed" : "Withdrew from"} ${id} · ${amt("amount")}`;
    case "RewardClaimed":
      return `Claimed ${amt("amount")} from ${id} → ${shortAddress(String(a.to))}`;
    case "RewardRedirected":
      return `Redirected ${amt("amount")} from ${id} → ${shortAddress(String(a.recipient))}`;
    case "RewardRedirectConfigured":
      return `Routing for ${id} set to ${["KEEP", "COMPOUND", "REDIRECT"][Number(a.mode)]}`;
    case "Compound":
      return `Compounded ${amt("compounded")} into ${id}${(a.keeperFee as bigint) > 0n ? ` · keeper fee ${amt("keeperFee")}` : ""}`;
    case "BoostExpired":
      return `Boost expired on ${id}`;
    case "EmergencyWithdraw":
      return `Emergency exit ${id} · returned ${amt("amountOut")} · penalty ${amt("penalty")} · forfeited ${amt("rewardsForfeited")}`;
    case "RewardsFunded":
      return `Reward stream funded · ${amt("amount")}`;
    case "FaucetClaimed":
      return `Faucet · ${amt("amount")} to ${shortAddress(String(a.account))}`;
    case "Deposit":
      return `Vault deposit · ${amt("assets")}`;
    case "Withdraw":
      return `Vault redemption · ${amt("assets")}`;
    case "VaultHarvested":
      return `Vault compounded ${amt("compounded")}`;
    default:
      return item.event;
  }
}

export default function ActivityPage() {
  const { address, readChainId, connected } = useForma();
  const [scope, setScope] = useState<"mine" | "all">(connected ? "mine" : "all");
  const [lookback, setLookback] = useState(ACTIVITY_LOOKBACK);
  const effectiveScope = connected ? scope : "all";
  const { positions } = useMyPositions();
  const myIds = (positions ?? []).map((p) => p.id.toString());
  const activity = useActivity(effectiveScope === "mine" ? address : undefined, lookback, effectiveScope === "mine" ? myIds : []);
  const { records } = useTx();

  const mine = new Set(myIds);
  const items = activity.data?.items ?? [];

  return (
    <div className="pt-10">
      <p className="label">Activity</p>
      <h1 className="display mt-3 text-[clamp(2rem,6vw,5rem)]">On-chain activity</h1>

      <div className="mt-8 grid gap-px bg-rule text-sm md:grid-cols-2">
        <div className="bg-ivory p-4">
          <p className="label text-ink">On-chain state</p>
          <p className="mt-2 text-ink-2">
            Balances, positions, rewards and rates elsewhere in the app are read directly from contract state. They are
            authoritative.
          </p>
        </div>
        <div className="bg-ivory p-4">
          <p className="label text-orange-ink">Indexed activity (this page)</p>
          <p className="mt-2 text-ink-2">
            Event history from <code className="mono">eth_getLogs</code> over a bounded block range. It can lag, and
            public RPCs limit the range. Use it as a log, not as a source of truth.
          </p>
        </div>
      </div>

      {records.length > 0 && (
        <section className="mt-12">
          <SectionHeader index="01" title="This session" aside={`${records.length} transaction${records.length === 1 ? "" : "s"}`} />
          <ul className="grid gap-px bg-rule pt-px lg:grid-cols-2">
            {records.map((r) => (
              <li key={r.id} className="bg-ivory p-4">
                <p className="label mb-3 text-ink">{r.label}</p>
                <TxSteps record={r} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12">
        <SectionHeader
          index={records.length > 0 ? "02" : "01"}
          title="Protocol events · indexed"
          aside={activity.data ? `Blocks ${activity.data.fromBlock}–${activity.data.toBlock}` : undefined}
        />
        <div className="flex flex-wrap items-center gap-2 pt-4">
          {connected && (
            <div role="group" aria-label="Scope" className="flex">
              {(["mine", "all"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  onClick={() => setScope(s)}
                  className="mono border border-ink px-3 py-2 text-[11px] tracking-[0.14em] uppercase aria-pressed:bg-ink aria-pressed:text-ivory"
                >
                  {s === "mine" ? "My activity" : "All protocol"}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn btn-ghost min-h-9" onClick={() => setLookback((l) => l * 2n)} disabled={activity.isFetching}>
            Scan further back
          </button>
          {activity.isFetching && <span className="label">Scanning…</span>}
        </div>

        <div className="pt-4">
          {activity.error ? (
            <ReadError error={activity.error} what="event logs" />
          ) : activity.isLoading ? (
            <Loading label="Scanning event logs" />
          ) : items.length === 0 ? (
            <Empty title="No events in the scanned range">
              Try scanning further back{effectiveScope === "mine" ? " or switch to all protocol activity" : ""}.
            </Empty>
          ) : (
            <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    <th scope="col">Block</th>
                    <th scope="col">Event</th>
                    <th scope="col">Detail</th>
                    <th scope="col">Contract</th>
                    <th scope="col" className="text-right">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.key}>
                      <td className="mono text-xs">{item.blockNumber.toString()}</td>
                      <td className="mono text-xs font-semibold">{item.event}</td>
                      <td className="text-sm">
                        {typeof item.args.positionId === "bigint" ? (
                          <Link href={`/positions/${item.args.positionId}`} className="hover:underline">
                            {describe(item)}
                          </Link>
                        ) : (
                          describe(item)
                        )}
                        {mine.has(String(item.args.positionId ?? "")) && <span className="tag ml-2 border-lime-ink text-lime-ink">Yours</span>}
                      </td>
                      <td className="mono text-xs text-ink-2">{item.contract}</td>
                      <td className="text-right">
                        <TxLink chainId={readChainId} hash={item.hash} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
