"use client";

import {
  formaStakingAbi,
  formatBpsPercent,
  formatDateTimeUTC,
  formatLockDuration,
  formatMultiplier,
  formatRateBps,
  formatToken,
  parseTokenInput,
  perDay,
} from "@forma/sdk";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { parseEventLogs } from "viem";

import { AmountInput } from "@/components/AmountInput";
import { ActionGate } from "@/components/NetworkGuard";
import { PoolTable } from "@/components/PoolTable";
import { PositionGlyph } from "@/components/PositionGlyph";
import { TxStatus } from "@/components/TxStatus";
import { Row, TestnetEstimate } from "@/components/ui";
import { useForma } from "@/lib/forma";
import { useForgeAccount, useProtocol, useStakePreview } from "@/lib/reads";
import { useNow } from "@/lib/time";
import { useFormaTx } from "@/lib/write";

export default function StakePage() {
  return (
    <Suspense>
      <StakeFlow />
    </Suspense>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-ink pt-5 pb-10 md:grid-cols-[180px_1fr]">
      <div className="flex items-start gap-3 md:block">
        <span className={`numeral text-4xl ${done ? "text-lime-ink" : ""}`}>{String(n).padStart(2, "0")}</span>
        <h2 className="label mt-2 text-ink">{title}</h2>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function StakeFlow() {
  const params = useSearchParams();
  const initial = Number(params.get("pool"));
  const [poolId, setPoolId] = useState<number | undefined>(Number.isInteger(initial) && initial >= 0 ? initial : undefined);
  const [input, setInput] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [createdId, setCreatedId] = useState<bigint | null>(null);

  const now = useNow();
  const { address } = useForma();
  const { pools, positionsCreated, paused } = useProtocol();
  const forge = useForgeAccount();
  const { send, targets, isActive } = useFormaTx();

  const pool = poolId !== undefined ? pools?.[poolId] : undefined;
  const parsed = parseTokenInput(input);
  const amount = parsed.ok ? parsed.value : undefined;

  const amountError = useMemo(() => {
    if (input.trim() === "") return undefined;
    if (!parsed.ok) return parsed.reason;
    if (pool && parsed.value < pool.minStake) return `Minimum for ${pool.name} is ${formatToken(pool.minStake)} FORGE.`;
    if (forge.balance !== undefined && parsed.value > forge.balance)
      return `You have ${formatToken(forge.balance)} FORGE. Get test FORGE from the faucet.`;
    if (pool && pool.maxTotalPrincipal > 0n && pool.totalPrincipal + parsed.value > pool.maxTotalPrincipal)
      return "This would exceed the pool capacity.";
    return undefined;
  }, [input, parsed, pool, forge.balance]);

  const preview = useStakePreview(poolId, amount && !amountError ? amount : undefined);
  const locked = pool ? pool.lockDuration > 0n : false;
  const needsAck = locked && !acknowledged;
  const allowance = forge.stakingAllowance ?? 0n;
  const needsApproval = amount !== undefined && allowance < amount;
  const valid = pool && pool.active && amount !== undefined && !amountError;
  const busy = isActive("approve-stake") || isActive("stake");

  const chooseTier = (id: number) => {
    setPoolId(id);
    setAcknowledged(false);
    setCreatedId(null);
  };

  async function approve() {
    if (!targets || amount === undefined) return;
    await send(targets.forge, "approve", [targets.staking.address, amount], {
      key: "approve-stake",
      label: "Approve FORGE for staking",
      amountLabel: `${formatToken(amount)} FORGE`,
    });
  }

  async function stake() {
    if (!targets || amount === undefined || !pool || poolId === undefined) return;
    // The reviewed terms are passed on-chain: if the pool changed meanwhile, the stake reverts.
    const res = await send(targets.staking, "stake", [BigInt(poolId), amount, pool.lockDuration, pool.multiplierBps], {
      key: "stake",
      label: `Stake into ${pool.name}`,
      amountLabel: `${formatToken(amount)} FORGE`,
    });
    if (res.ok) {
      const [event] = parseEventLogs({ abi: formaStakingAbi, logs: res.receipt.logs, eventName: "Stake" });
      if (event) setCreatedId(event.args.positionId);
      setInput("");
      setAcknowledged(false);
    }
  }

  const expectedId = positionsCreated !== undefined ? positionsCreated + 1n : undefined;

  return (
    <div className="grid gap-10 pt-10 lg:grid-cols-[1fr_360px]">
      <div>
        <p className="label">Stake</p>
        <h1 className="display mt-3 mb-10 text-[clamp(2.5rem,6vw,5rem)]">Open a position</h1>

        {paused && (
          <p role="alert" className="mb-8 border-l-2 border-orange bg-orange/10 px-4 py-3 text-sm">
            The protocol is paused. New stakes are disabled until it is unpaused.
          </p>
        )}

        <Step n={1} title="Choose lock tier" done={pool !== undefined}>
          <p className="mb-4 max-w-prose text-sm text-ink-2">
            Pools are lock tiers. All positions share one reward stream, weighted by principal × multiplier. The
            multiplier applies while the position is locked and drops to 1.00× at unlock.
          </p>
          <PoolTable select={chooseTier} selected={poolId} />
        </Step>

        <Step n={2} title="Enter amount" done={!!valid}>
          <div className="max-w-xl">
            <AmountInput
              id="stake-amount"
              label="Principal"
              value={input}
              onChange={(v) => {
                setInput(v);
                setCreatedId(null);
              }}
              balance={forge.balance}
              symbol="FORGE"
              error={amountError}
              disabled={busy}
            />
            {forge.balance === 0n && (
              <p className="mt-3 text-sm text-ink-2">
                You have no test FORGE.{" "}
                <Link className="underline" href="/settings#faucet">
                  Use the testnet faucet
                </Link>
                .
              </p>
            )}
          </div>
        </Step>

        <Step n={3} title="Confirm lock" done={!!pool && !needsAck}>
          {!pool ? (
            <p className="text-sm text-ink-3">Choose a lock tier first.</p>
          ) : !locked ? (
            <p className="text-sm">
              <strong>{pool.name}</strong> has no lock: withdraw any time. Weight 1.00×.
            </p>
          ) : (
            <label className="flex max-w-prose cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-ink"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span>
                I understand this position is locked for <strong>{formatLockDuration(pool.lockDuration)}</strong>, until
                about <strong>{formatDateTimeUTC(now + pool.lockDuration)}</strong>. Leaving early via emergency
                withdrawal forfeits pending rewards and costs <strong>{formatBpsPercent(pool.earlyExitPenaltyBps)}</strong>{" "}
                of principal. The {formatMultiplier(pool.multiplierBps)} boost ends at unlock.
              </span>
            </label>
          )}
        </Step>

        <Step n={4} title="Preview" done={!!preview.data}>
          {!valid ? (
            <p className="text-sm text-ink-3">Complete steps 1–2 to see the on-chain preview.</p>
          ) : preview.isLoading || !preview.data ? (
            <p className="label">Reading previewStake…</p>
          ) : (
            <dl className="max-w-xl">
              <Row k="Amount" v={`${formatToken(amount!)} FORGE`} />
              <Row k="Lock" v={formatLockDuration(preview.data.lockDuration)} />
              <Row k="Multiplier" v={formatMultiplier(preview.data.multiplierBps)} />
              <Row k="Weight" v={formatToken(preview.data.weight)} />
              <Row
                k="Est. reward rate"
                v={
                  preview.data.rewardPerSecond > 0n
                    ? `${formatToken(perDay(preview.data.rewardPerSecond), { maxDecimals: 4 })} FORGE / day`
                    : "No active stream"
                }
              />
              <Row
                k="Est. APR"
                v={
                  <span className="inline-flex items-center gap-2">
                    {formatRateBps(preview.data.estimatedAprBps > 0n ? preview.data.estimatedAprBps : null)}
                    <TestnetEstimate />
                  </span>
                }
              />
              <Row k="Unlock date" v={preview.data.lockDuration === 0n ? "Immediately" : formatDateTimeUTC(preview.data.unlockTime)} />
              <Row k="Position NFT" v={expectedId ? `FORMA-POS · expected #${expectedId}` : "FORMA-POS"} />
            </dl>
          )}
        </Step>

        <Step n={5} title="Approve token" done={!!valid && !needsApproval}>
          <ActionGate action="approve FORGE">
            {!valid ? (
              <p className="text-sm text-ink-3">Waiting for a valid amount.</p>
            ) : needsApproval ? (
              <>
                <p className="mb-3 text-sm text-ink-2">
                  Allow FormaStaking to transfer exactly {formatToken(amount!)} FORGE (no unlimited approval).
                </p>
                <button type="button" className="btn" disabled={busy || !!paused} onClick={approve}>
                  {isActive("approve-stake") ? "Approving…" : "Approve FORGE"}
                </button>
              </>
            ) : (
              <p className="mono text-sm text-lime-ink">Allowance sufficient: {formatToken(allowance)} FORGE</p>
            )}
            <TxStatus txKey="approve-stake" />
          </ActionGate>
        </Step>

        <Step n={6} title="Stake" done={createdId !== null}>
          <ActionGate action="stake">
            <button
              type="button"
              className="btn"
              disabled={!valid || needsApproval || needsAck || busy || !!paused || !address}
              onClick={stake}
            >
              {isActive("stake") ? "Staking…" : pool ? `Stake into ${pool.name}` : "Stake"}
            </button>
            {needsAck && valid && <p className="mt-2 text-sm text-ink-2">Confirm the lock terms in step 3.</p>}
          </ActionGate>
        </Step>

        <Step n={7} title="Transaction confirmation">
          <p className="text-sm text-ink-2">Status appears here once you submit. Success is only shown after the transaction is mined.</p>
          <TxStatus txKey="stake" />
        </Step>

        <Step n={8} title="Position created" done={createdId !== null}>
          {createdId === null ? (
            <p className="text-sm text-ink-3">Your position NFT will be linked here after confirmation.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <p className="numeral text-5xl">POSITION #{createdId.toString()}</p>
              <Link href={`/positions/${createdId}`} className="btn">
                Open position →
              </Link>
            </div>
          )}
        </Step>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="border border-ink bg-paper p-5">
          <p className="label">Position NFT · preview</p>
          <div className="my-4 flex justify-center">
            {pool && amount !== undefined && !amountError ? (
              <PositionGlyph
                input={{
                  id: expectedId ?? 0n,
                  principal: amount,
                  startTime: now,
                  unlockTime: now + pool.lockDuration,
                  activeMultiplierBps: pool.multiplierBps,
                }}
                now={now}
                size={240}
                title="Preview of the position glyph (not yet minted)"
              />
            ) : (
              <div className="flex size-[240px] items-center justify-center border border-dashed border-rule-strong">
                <span className="label">Awaiting terms</span>
              </div>
            )}
          </div>
          <p className="mono text-[11px] tracking-[0.12em] text-ink-2 uppercase">
            Not yet minted · rendered from your inputs with the same formula as the on-chain renderer
          </p>
        </div>
      </aside>
    </div>
  );
}
