"use client";

import { formatToken, PositionStatus, summarizePositions } from "@forma/sdk";
import Link from "next/link";

import { Milestones } from "@/components/Milestones";
import { ActionGate } from "@/components/NetworkGuard";
import { PositionTable } from "@/components/PositionTable";
import { Empty, Figure, Loading, ReadError, SectionHeader } from "@/components/ui";
import { useForma } from "@/lib/forma";
import { useMyPositions, useProtocol } from "@/lib/reads";
import { useNow } from "@/lib/time";

export default function PositionsPage() {
  const now = useNow();
  const { connected } = useForma();
  const { positions, truncated, ownedCount, isLoading, error } = useMyPositions();
  const { pools } = useProtocol();
  const active = (positions ?? []).filter((v) => v.position.status === PositionStatus.Active);
  const s = summarizePositions(active, now);

  return (
    <div className="pt-10">
      <p className="label">Positions</p>
      <h1 className="display mt-3 text-[clamp(2.5rem,6vw,5rem)]">Your positions</h1>
      <p className="mt-4 max-w-prose text-ink-2">
        Each position is an ERC-721 held by your wallet. The list below is read from the NFT&apos;s on-chain owner
        index — no indexer involved.
      </p>

      {!connected ? (
        <div className="mt-10">
          <ActionGate action="see your positions">{null}</ActionGate>
        </div>
      ) : error ? (
        <div className="mt-10">
          <ReadError error={error} what="your positions" />
        </div>
      ) : isLoading || !positions ? (
        <Loading label="Reading your positions" />
      ) : (
        <>
          <div className="mt-10 grid gap-8 border-t border-ink pt-8 sm:grid-cols-3">
            <Figure label="Active positions" value={String(s.activeCount)} size="md" />
            <Figure label="Principal" value={formatToken(s.totalPrincipal)} unit="FORGE" size="md" />
            <Figure label="Pending rewards" value={formatToken(s.totalPending)} unit="FORGE" size="md" tone="lime" />
          </div>
          <section className="mt-12">
            <SectionHeader
              index="01"
              title="Holdings"
              aside={truncated ? `Showing 100 of ${ownedCount}` : `${active.length} held`}
            />
            {active.length === 0 ? (
              <div className="pt-6">
                <Empty title="No positions yet">
                  <Link href="/stake" className="underline">
                    Open a position
                  </Link>{" "}
                  to receive your first position NFT.
                </Empty>
              </div>
            ) : (
              <PositionTable positions={active} pools={pools} now={now} />
            )}
          </section>
          <section className="mt-12">
            <SectionHeader index="02" title="Reputation" />
            <div className="pt-6">
              <Milestones positions={active} now={now} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
