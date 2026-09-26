"use client";

import {
  formatCountdown,
  formatMultiplier,
  formatToken,
  PositionStatus,
  summarizePositions,
  type PositionView,
} from "@forma/sdk";
import Link from "next/link";
import { useReadContracts } from "wagmi";

import { Milestones } from "@/components/Milestones";
import { ActionGate } from "@/components/NetworkGuard";
import { PoolTable } from "@/components/PoolTable";
import { PositionGlyph } from "@/components/PositionGlyph";
import { PositionTable } from "@/components/PositionTable";
import { ProtocolStats } from "@/components/ProtocolStats";
import { Empty, Figure, Loading, ReadError, SectionHeader } from "@/components/ui";
import { useForma } from "@/lib/forma";
import { useMyPositions, useProtocol } from "@/lib/reads";
import { useNow } from "@/lib/time";

export default function HomePage() {
  const { connected } = useForma();
  return connected ? <Dashboard /> : <Landing />;
}

// ═══════════════════════════════════════════════════════════════════════════
//                                   LANDING
// ═══════════════════════════════════════════════════════════════════════════

const SEQUENCE = [
  ["Stake", "Deposit test FORGE into a lock tier."],
  ["Position", "Receive an ERC-721 that is the stake: terms, lock and rewards live on the token."],
  ["Earn", "One reward stream, split by principal × multiplier."],
  ["Customize", "Route rewards: keep, auto-compound, or redirect to another wallet."],
  ["Compound", "Fold rewards into principal, yourself or via permissionless keepers."],
  ["Use", "Transfer the position, or hold stFORGE — a liquid ERC-4626 share."],
] as const;

function Landing() {
  const now = useNow(10_000);
  return (
    <>
      <section className="grid gap-10 pt-12 pb-16 lg:grid-cols-[1.35fr_1fr] lg:gap-16 lg:pt-20">
        <div className="animate-rise min-w-0">
          <p className="label">Forma protocol · v0.1 · testnet</p>
          <h1 className="display mt-6 text-[clamp(2.6rem,11vw,8.5rem)]">
            Your stake
            <br />
            is an <span className="bg-lime px-2">object.</span>
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-ink-2">
            Forma turns a stake into a composable on-chain position with its own lock, multiplier, reward stream and
            routing policy — represented by an NFT you can hold, configure, compound and transfer.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/stake" className="btn">
              Open a position
            </Link>
            <Link href="/docs" className="btn btn-ghost">
              Read the protocol
            </Link>
          </div>
        </div>
        <HeroGlyphs now={now} />
      </section>

      <section aria-labelledby="sequence" className="pb-20">
        <SectionHeader index="01" title="The sequence" id="sequence" />
        <ol className="grid gap-px bg-rule sm:grid-cols-2 lg:grid-cols-6">
          {SEQUENCE.map(([title, body], i) => (
            <li key={title} className="bg-ivory p-5 pt-6">
              <span className="mono text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <p className="display mt-6 text-2xl">{title}</p>
              <p className="mt-2 text-sm text-ink-2">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="state" className="pb-20">
        <SectionHeader index="02" title="Protocol state · live from chain" id="state" />
        <div className="pt-8">
          <ProtocolStats />
        </div>
      </section>

      <section aria-labelledby="pools" className="pb-20">
        <SectionHeader index="03" title="Lock tiers" id="pools" aside="One stream · weighted by multiplier" />
        <div className="pt-4">
          <PoolTable />
        </div>
      </section>

      <section className="grid gap-10 border-t border-ink pt-10 lg:grid-cols-2">
        <div>
          <p className="label">04 — Liquid staking</p>
          <p className="display mt-4 text-4xl">stFORGE</p>
          <p className="mt-4 max-w-prose text-ink-2">
            Deposit into an ERC-4626 vault that keeps FORGE staked and compounds it. The exchange rate rises only as
            rewards actually accrue on-chain. It is not risk-free.
          </p>
          <Link href="/liquid" className="btn btn-ghost mt-6">
            Explore the vault
          </Link>
        </div>
        <div>
          <p className="label">05 — Connect</p>
          <p className="display mt-4 text-4xl">Your control surface</p>
          <p className="mt-4 max-w-prose text-ink-2">
            Connect a wallet on Base Sepolia to see what you own, what is earning, what is locked and when it unlocks.
          </p>
          <div className="mt-6">
            <ActionGate action="see your positions">{null}</ActionGate>
          </div>
        </div>
      </section>
    </>
  );
}

/** Shows the three most recent real positions; a labelled specimen only when none exist yet. */
function HeroGlyphs({ now }: { now: bigint }) {
  const { contracts, readChainId } = useForma();
  const { positionsCreated } = useProtocol();
  const ids =
    positionsCreated && positionsCreated > 0n
      ? Array.from({ length: Number(positionsCreated < 6n ? positionsCreated : 6n) }, (_, i) => positionsCreated - BigInt(i))
      : [];
  const reads = useReadContracts({
    contracts: contracts
      ? ids.map((id) => ({
          ...contracts.staking,
          functionName: "getPositionView" as const,
          args: [id] as const,
          chainId: readChainId,
        }))
      : [],
    query: { enabled: ids.length > 0 },
  });
  const live = (reads.data ?? [])
    .map((r) => (r.status === "success" ? (r.result as PositionView) : undefined))
    .filter((v): v is PositionView => !!v && v.position.status === PositionStatus.Active)
    .slice(0, 3);

  if (live.length === 0) {
    const specimen = { id: 184n, principal: 1000n * 10n ** 18n, activeMultiplierBps: 17_500 };
    return (
      <figure className="relative flex min-w-0 flex-col items-center justify-center border border-dashed border-rule-strong p-4 sm:p-8">
        <PositionGlyph
          input={{ ...specimen, startTime: now - 40n * 86_400n, unlockTime: now + 50n * 86_400n }}
          now={now}
          size={300}
          title="Specimen glyph (not a real position)"
        />
        <figcaption className="mono mt-4 text-center text-[11px] tracking-[0.14em] text-ink-2 uppercase">
          Specimen · not a real position
          <br />
          Ticks = size · arc = lock progress · weight = multiplier · hue = lock tier
        </figcaption>
      </figure>
    );
  }

  const [first, ...rest] = live;
  return (
    <figure className="relative min-w-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        {first && (
          <Link href={`/positions/${first.id}`} className="group block min-w-0 sm:flex-1">
            <PositionGlyph input={{ id: first.id, ...first.position }} now={now} size={300} />
            <p className="numeral mt-2 text-3xl group-hover:underline">#{first.id.toString()}</p>
          </Link>
        )}
        <div className="flex gap-4 sm:flex-col">
          {rest.map((v) => (
            <Link key={v.id.toString()} href={`/positions/${v.id}`} className="group block min-w-0 sm:text-right">
              <PositionGlyph input={{ id: v.id, ...v.position }} now={now} size={120} />
              <p className="numeral text-lg group-hover:underline">#{v.id.toString()}</p>
            </Link>
          ))}
        </div>
      </div>
      <figcaption className="mono mt-4 text-[11px] tracking-[0.14em] text-ink-2 uppercase">
        Latest live positions · read from chain
      </figcaption>
    </figure>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//                                  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

function Dashboard() {
  const now = useNow();
  const { positions, truncated, isLoading, error } = useMyPositions();
  const { pools } = useProtocol();
  const active = (positions ?? []).filter((v) => v.position.status === PositionStatus.Active);
  const summary = summarizePositions(active, now);

  return (
    <>
      <section aria-labelledby="summary" className="pt-10 pb-14">
        <SectionHeader index="01" title="Your staking position" id="summary" aside={<Link href="/stake" className="underline">New position →</Link>} />
        {error ? (
          <div className="pt-6">
            <ReadError error={error} what="your positions" />
          </div>
        ) : isLoading || !positions ? (
          <Loading label="Reading your positions" />
        ) : (
          <div className="grid gap-x-8 gap-y-10 pt-8 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <Figure label="Total staked" value={formatToken(summary.totalPrincipal)} unit="FORGE" size="xl" />
            <Figure
              label="Rewards · pending"
              value={formatToken(summary.totalPending)}
              unit="FORGE"
              tone="lime"
              note={<Link href="/earn" className="underline">Claim or compound →</Link>}
            />
            <Figure
              label="Current multiplier"
              value={summary.totalPrincipal === 0n ? "—" : formatMultiplier(summary.weightedMultiplierBps)}
              note="Principal-weighted, active boosts"
            />
            <Figure
              label="Next unlock"
              value={summary.nextUnlock === null ? "—" : formatCountdown(summary.nextUnlock - now)}
              tone={summary.nextUnlock === null ? "ink" : "orange"}
              note={
                summary.lockedPrincipal > 0n
                  ? `${formatToken(summary.lockedPrincipal)} FORGE locked`
                  : "Nothing locked"
              }
            />
          </div>
        )}
      </section>

      <section aria-labelledby="positions" className="pb-14">
        <SectionHeader
          index="02"
          title="Your positions"
          id="positions"
          aside={`${summary.activeCount} active${truncated ? " · showing first 100" : ""}`}
        />
        {positions && active.length === 0 ? (
          <div className="pt-6">
            <Empty title="No active positions">
              You do not hold any Forma positions on this network.{" "}
              <Link href="/stake" className="underline">
                Open your first position
              </Link>{" "}
              — test FORGE is available from the <Link href="/settings#faucet" className="underline">faucet</Link>.
            </Empty>
          </div>
        ) : (
          positions && <PositionTable positions={active} pools={pools} now={now} />
        )}
      </section>

      <section aria-labelledby="available" className="pb-14">
        <SectionHeader index="03" title="Available pools" id="available" />
        <div className="pt-4">
          <PoolTable />
        </div>
      </section>

      <section aria-labelledby="reputation" className="pb-8">
        <SectionHeader index="04" title="Protocol reputation" id="reputation" />
        <div className="pt-6">{positions && <Milestones positions={active} now={now} />}</div>
      </section>
    </>
  );
}
