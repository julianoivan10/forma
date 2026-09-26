"use client";

import { explorerAddressUrl, explorerTokenUrl } from "@forma/config";
import {
  formatBpsPercent,
  formatDateTimeUTC,
  formatDateUTC,
  formatLockDuration,
  formatMultiplier,
  formatToken,
  parseTokenInput,
  perDay,
  PHASE_LABEL,
  positionNftAbi,
  positionPhase,
  PositionStatus,
  RoutingMode,
  shortAddress,
} from "@forma/sdk";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";

import { AmountInput } from "@/components/AmountInput";
import { EmergencyDialog } from "@/components/EmergencyDialog";
import { LockTimeline } from "@/components/LockTimeline";
import { ActionGate } from "@/components/NetworkGuard";
import { PositionGlyph } from "@/components/PositionGlyph";
import { RoutingForm } from "@/components/RoutingForm";
import { TxStatus } from "@/components/TxStatus";
import { AddressLink, FitNumeral, Loading, ReadError, Row, SectionHeader, TxLink } from "@/components/ui";
import { useForma } from "@/lib/forma";
import { usePositionCreation } from "@/lib/logs";
import { usePosition, useProtocol } from "@/lib/reads";
import { useNow } from "@/lib/time";
import { useFormaTx } from "@/lib/write";

const ROUTING_LABEL = ["KEEP", "COMPOUND", "REDIRECT"];

export default function PositionPage() {
  const params = useParams<{ id: string }>();
  const id = /^\d+$/.test(params.id ?? "") ? BigInt(params.id) : undefined;
  if (id === undefined || id === 0n) {
    return (
      <div className="py-20">
        <p className="label">Invalid position id</p>
        <h1 className="display mt-4 text-5xl">No such position.</h1>
      </div>
    );
  }
  return <PositionDetail id={id} />;
}

function PositionDetail({ id }: { id: bigint }) {
  const now = useNow();
  const { address, readChainId, contracts } = useForma();
  const { view, emergency, storedRouting, isLoading, error } = usePosition(id);
  const { pools, compoundConfig, paused } = useProtocol();
  const creation = usePositionCreation(id, view?.position.startTime);
  const { send, targets, isActive } = useFormaTx();
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [withdrawInput, setWithdrawInput] = useState("");

  const tokenUri = useReadContract({
    address: contracts?.nft.address,
    abi: positionNftAbi,
    functionName: "tokenURI",
    args: [id],
    chainId: readChainId,
    query: { enabled: !!contracts && view?.position.status === PositionStatus.Active, refetchInterval: 60_000 },
  });

  if (error) return <div className="pt-10"><ReadError error={error} what={`position #${id}`} /></div>;
  if (isLoading || !view) return <Loading label={`Reading position #${id}`} />;

  const p = view.position;
  if (p.status === PositionStatus.None) {
    return (
      <div className="py-20">
        <p className="label">Position #{id.toString()}</p>
        <h1 className="display mt-4 text-5xl">Not minted.</h1>
        <p className="mt-4 text-ink-2">No position with this id exists on this network.</p>
      </div>
    );
  }

  const pool = pools?.[p.poolId];
  const phase = positionPhase(view, now);
  const activePos = p.status === PositionStatus.Active;
  const isOwner = !!address && activePos && view.owner.toLowerCase() === address.toLowerCase();
  const routing = view.effectiveRouting;
  const isRecipient =
    !!address && routing.mode === RoutingMode.Redirect && routing.recipient.toLowerCase() === address.toLowerCase();
  const canKeeperCompound = !!address && !isOwner && activePos && routing.mode === RoutingMode.Compound;
  const lock = p.unlockTime - p.startTime;
  // Authoritative: the contract's own lock check (block time), not the local clock.
  const unlocked = lock === 0n || !view.locked;
  const staleRouting =
    storedRouting && storedRouting.configuredBy !== "0x0000000000000000000000000000000000000000" &&
    storedRouting.configuredBy.toLowerCase() !== view.owner.toLowerCase();

  const k = (a: string) => `${a}:${id}`;
  const anyBusy = ["claim", "compound", "withdraw", "emergency", "routing", "kick"].some((a) => isActive(k(a)));

  const parsedWithdraw = parseTokenInput(withdrawInput);
  const withdrawError =
    withdrawInput === "" ? undefined : !parsedWithdraw.ok ? parsedWithdraw.reason : parsedWithdraw.value > p.principal ? "More than the position principal." : undefined;
  const withdrawAmount = parsedWithdraw.ok && !withdrawError ? parsedWithdraw.value : undefined;

  const imageUri = (() => {
    const uri = tokenUri.data;
    if (!uri?.startsWith("data:application/json;base64,")) return undefined;
    try {
      const json = JSON.parse(atob(uri.slice(29))) as { image?: string };
      return json.image;
    } catch {
      return undefined;
    }
  })();

  return (
    <div className="pt-10">
      {/* ─── masthead ─── */}
      <section className="grid gap-10 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="label">
            {pool?.name ?? `Pool ${p.poolId}`} · {PHASE_LABEL[phase]}
          </p>
          <h1 className="numeral mt-4 text-[clamp(3.5rem,11vw,9rem)]">
            POSITION
            <br />#{id.toString()}
          </h1>
          <div className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
            <div className="@container">
              <p className="label">Principal</p>
              <FitNumeral className="mt-2" maxRem={2.25} text={formatToken(p.principal)} />
              <p className="mono text-xs text-ink-2">FORGE</p>
            </div>
            <div className="@container">
              <p className="label">Multiplier</p>
              <FitNumeral className="mt-2" maxRem={2.25} text={formatMultiplier(p.activeMultiplierBps)} />
              <p className="mono text-xs text-ink-2">
                {p.activeMultiplierBps === p.multiplierBps ? "active" : `was ${formatMultiplier(p.multiplierBps)} while locked`}
              </p>
            </div>
            <div className="@container">
              <p className="label">Earned · pending</p>
              <FitNumeral className="mt-2 text-lime-ink" maxRem={2.25} text={formatToken(view.pendingRewards, { maxDecimals: 4 })} />
              <p className="mono text-xs text-ink-2">
                {view.rewardPerSecond > 0n ? `+${formatToken(perDay(view.rewardPerSecond), { maxDecimals: 4 })} / day` : "not earning (no stream)"}
              </p>
            </div>
            <div className="@container">
              <p className="label">{lock === 0n ? "Lock" : unlocked ? "Unlocked" : `Locked for ${formatLockDuration(lock)}`}</p>
              <FitNumeral className="mt-2" maxRem={2.25} text={lock === 0n ? "NONE" : formatDateUTC(p.unlockTime)} />
              <p className="mono text-xs text-ink-2">{lock === 0n ? "withdraw any time" : formatDateTimeUTC(p.unlockTime)}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-3">
          {activePos ? (
            <PositionGlyph input={{ id, ...p }} now={now} size={320} />
          ) : (
            <div className="flex size-[320px] items-center justify-center border border-dashed border-rule-strong">
              <span className="label">NFT burned</span>
            </div>
          )}
        </div>
      </section>

      {/* ─── timeline ─── */}
      <section className="mt-14">
        <SectionHeader index="01" title="Lock timeline" aside={PHASE_LABEL[phase]} />
        <div className="pt-6">
          <LockTimeline startTime={p.startTime} unlockTime={p.unlockTime} now={now} />
          {view.boostExpirable && (
            <p className="mt-4 text-sm text-sky-ink">
              Unlocked, but the {formatMultiplier(p.activeMultiplierBps)} boost is still applied until this position is
              touched. Anyone can expire it (it only lowers this position&apos;s share).
            </p>
          )}
        </div>
      </section>

      {!activePos ? (
        <section className="mt-14">
          <SectionHeader index="02" title="Closed" />
          <p className="pt-6 text-ink-2">
            This position was {p.status === PositionStatus.Closed ? "withdrawn after unlock" : "closed by emergency withdrawal"}.
            Lifetime rewards realised: {formatToken(p.lifetimeRewards)} FORGE.
          </p>
          {/* Keep the confirmation of the transaction that closed it visible. */}
          <TxStatus txKey={k("withdraw")} />
          <TxStatus txKey={k("emergency")} />
        </section>
      ) : (
        <section className="mt-14">
          <SectionHeader
            index="02"
            title="Actions"
            aside={isOwner ? "You own this position" : isRecipient ? "You are the redirect recipient" : `Owner ${shortAddress(view.owner)}`}
          />
          <div className="pt-6">
            <ActionGate action="manage this position">
              {!isOwner && !isRecipient && !canKeeperCompound ? (
                <p className="text-sm text-ink-2">
                  You are not the owner of this position. Only the owner can claim, withdraw or change routing.
                </p>
              ) : (
                <div className="grid gap-px bg-rule lg:grid-cols-2">
                  {/* claim */}
                  {(isOwner || isRecipient) && (
                    <div className="bg-ivory p-5">
                      <p className="display text-2xl">Claim</p>
                      <p className="mt-1 text-sm text-ink-2">
                        Pays {formatToken(view.pendingRewards, { maxDecimals: 4 })} FORGE to{" "}
                        {routing.mode === RoutingMode.Redirect ? `the redirect recipient ${shortAddress(routing.recipient)}` : "the owner"}.
                      </p>
                      <button
                        type="button"
                        className="btn mt-4"
                        disabled={anyBusy || !!paused || view.pendingRewards === 0n}
                        onClick={() =>
                          targets &&
                          send(targets.staking, "claim", [id], {
                            key: k("claim"),
                            label: `Claim rewards · #${id}`,
                            amountLabel: `≈ ${formatToken(view.pendingRewards, { maxDecimals: 4 })} FORGE`,
                          })
                        }
                      >
                        {isActive(k("claim")) ? "Claiming…" : "Claim rewards"}
                      </button>
                      <TxStatus txKey={k("claim")} />
                    </div>
                  )}

                  {/* compound */}
                  {(isOwner || canKeeperCompound) && (
                    <div className="bg-ivory p-5">
                      <p className="display text-2xl">Compound</p>
                      <p className="mt-1 text-sm text-ink-2">
                        {isOwner
                          ? "Adds pending rewards to principal at the active multiplier. Does not extend the lock; compounded FORGE stays locked until unlock."
                          : `Keeper compound: you receive min(${formatBpsPercent(compoundConfig?.keeperFeeBps ?? 0)}, owner cap ${formatBpsPercent(routing.maxKeeperFeeBps)}) of the compounded amount.`}
                      </p>
                      <button
                        type="button"
                        className="btn mt-4"
                        disabled={anyBusy || !!paused || view.pendingRewards === 0n}
                        onClick={() =>
                          targets &&
                          send(targets.staking, "compound", [id], {
                            key: k("compound"),
                            label: `Compound · #${id}`,
                            amountLabel: `≈ ${formatToken(view.pendingRewards, { maxDecimals: 4 })} FORGE`,
                          })
                        }
                      >
                        {isActive(k("compound")) ? "Compounding…" : isOwner ? "Compound" : "Compound as keeper"}
                      </button>
                      <TxStatus txKey={k("compound")} />
                    </div>
                  )}

                  {/* withdraw */}
                  {isOwner && (
                    <div className="bg-ivory p-5">
                      <p className="display text-2xl">Withdraw</p>
                      {!unlocked ? (
                        <p className="mt-1 text-sm text-ink-2">
                          Available from {formatDateTimeUTC(p.unlockTime)}. Before then, only emergency withdrawal is possible.
                        </p>
                      ) : (
                        <>
                          <p className="mt-1 mb-4 text-sm text-ink-2">
                            Withdrawing the full principal closes the position, pays pending rewards and burns the NFT.
                          </p>
                          <AmountInput
                            id="withdraw-amount"
                            label="Amount"
                            value={withdrawInput}
                            onChange={setWithdrawInput}
                            balance={p.principal}
                            balanceLabel="Principal"
                            symbol="FORGE"
                            error={withdrawError}
                            disabled={anyBusy}
                          />
                          <button
                            type="button"
                            className="btn mt-4"
                            disabled={anyBusy || !!paused || withdrawAmount === undefined}
                            onClick={async () => {
                              if (!targets || withdrawAmount === undefined) return;
                              const res = await send(targets.staking, "withdraw", [id, withdrawAmount], {
                                key: k("withdraw"),
                                label: `${withdrawAmount === p.principal ? "Close" : "Withdraw from"} #${id}`,
                                amountLabel: `${formatToken(withdrawAmount)} FORGE`,
                              });
                              if (res.ok) setWithdrawInput("");
                            }}
                          >
                            {isActive(k("withdraw"))
                              ? "Withdrawing…"
                              : withdrawAmount === p.principal
                                ? "Withdraw all & close"
                                : "Withdraw"}
                          </button>
                        </>
                      )}
                      <TxStatus txKey={k("withdraw")} />
                    </div>
                  )}

                  {/* emergency */}
                  {isOwner && (
                    <div className="bg-ivory p-5">
                      <p className="display text-2xl text-danger">Emergency withdraw</p>
                      <p className="mt-1 text-sm text-ink-2">
                        Always available, even when paused. Forfeits pending rewards
                        {!unlocked && p.earlyExitPenaltyBps > 0 ? ` and costs ${formatBpsPercent(p.earlyExitPenaltyBps)} of principal while locked` : ""}.
                      </p>
                      <button type="button" className="btn btn-danger mt-4" disabled={anyBusy} onClick={() => setEmergencyOpen(true)}>
                        Review consequences
                      </button>
                      <TxStatus txKey={k("emergency")} />
                    </div>
                  )}
                </div>
              )}

              {view.boostExpirable && address && (
                <div className="mt-px bg-ivory p-5">
                  <p className="display text-xl">Expire boost</p>
                  <p className="mt-1 text-sm text-ink-2">Permissionless. Recomputes this position&apos;s weight at 1.00×.</p>
                  <button
                    type="button"
                    className="btn btn-ghost mt-3"
                    disabled={anyBusy}
                    onClick={() => targets && send(targets.staking, "expireBoost", [id], { key: k("kick"), label: `Expire boost · #${id}` })}
                  >
                    Expire boost
                  </button>
                  <TxStatus txKey={k("kick")} />
                </div>
              )}

              {isOwner && (
                <div className="mt-8 border-t border-ink pt-6">
                  {staleRouting && (
                    <p className="mb-4 text-sm text-sky-ink">
                      A routing configured by a previous owner ({shortAddress(storedRouting!.configuredBy)}) is stored but
                      inactive. Effective routing is KEEP until you set your own.
                    </p>
                  )}
                  <RoutingForm
                    current={routing}
                    owner={view.owner}
                    protocolKeeperFeeBps={compoundConfig?.keeperFeeBps}
                    busy={anyBusy}
                    onSubmit={(mode, recipient, fee) =>
                      targets &&
                      send(targets.staking, "setRouting", [id, mode, recipient as Address, fee], {
                        key: k("routing"),
                        label: `Set routing ${ROUTING_LABEL[mode]} · #${id}`,
                      })
                    }
                  />
                  <TxStatus txKey={k("routing")} />
                </div>
              )}
            </ActionGate>
          </div>

          <EmergencyDialog
            open={emergencyOpen}
            onClose={() => setEmergencyOpen(false)}
            preview={emergency}
            penaltyBps={p.earlyExitPenaltyBps}
            paused={!!paused}
            locked={!unlocked}
            busy={isActive(k("emergency"))}
            positionId={id}
            onConfirm={async () => {
              if (!targets) return;
              setEmergencyOpen(false);
              await send(targets.staking, "emergencyWithdraw", [id], {
                key: k("emergency"),
                label: `Emergency withdraw · #${id}`,
                amountLabel: emergency ? `≈ ${formatToken(emergency.amountOut)} FORGE returned` : undefined,
              });
            }}
          />
        </section>
      )}

      {/* ─── contract state ─── */}
      <section className="mt-14 grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <SectionHeader index="03" title="Contract state" aside="FormaStaking.getPositionView" />
          <dl className="pt-2">
            <Row k="Owner" v={activePos ? <AddressLink chainId={readChainId} address={view.owner} /> : "— (burned)"} />
            <Row k="Status" v={["NONE", "ACTIVE", "CLOSED", "EMERGENCY CLOSED"][p.status]} />
            <Row k="Pool" v={`${pool?.name ?? "?"} (#${p.poolId})`} />
            <Row k="Principal (wei)" v={p.principal.toString()} />
            <Row k="Weight (wei)" v={p.weight.toString()} />
            <Row k="Multiplier · snapshot" v={formatMultiplier(p.multiplierBps)} />
            <Row k="Multiplier · active" v={formatMultiplier(p.activeMultiplierBps)} />
            <Row k="Early-exit penalty · snapshot" v={formatBpsPercent(p.earlyExitPenaltyBps)} />
            <Row k="Start" v={formatDateTimeUTC(p.startTime)} />
            <Row k="Unlock" v={formatDateTimeUTC(p.unlockTime)} />
            <Row k="Pending rewards (wei)" v={view.pendingRewards.toString()} />
            <Row k="Settled rewards (wei)" v={p.rewardsAccrued.toString()} />
            <Row k="Lifetime realised (wei)" v={p.lifetimeRewards.toString()} />
            <Row k="Reward checkpoint" v={p.rewardPerWeightPaid.toString()} />
            <Row k="Compounds" v={String(p.compoundCount)} />
            <Row k="Routing · effective" v={`${ROUTING_LABEL[routing.mode]}${routing.mode === RoutingMode.Redirect ? ` → ${shortAddress(routing.recipient)}` : ""}${routing.mode === RoutingMode.Compound ? ` · cap ${formatBpsPercent(routing.maxKeeperFeeBps)}` : ""}`} />
          </dl>
        </div>
        <div>
          <SectionHeader index="04" title="On-chain NFT" aside="PositionNFT.tokenURI" />
          <div className="pt-4">
            {activePos ? (
              imageUri ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUri} alt={`On-chain SVG for position ${id}`} className="w-full max-w-[400px] border border-ink" />
              ) : tokenUri.isLoading ? (
                <Loading label="Reading tokenURI" />
              ) : (
                <p className="text-sm text-ink-2">tokenURI unavailable.</p>
              )
            ) : (
              <p className="text-sm text-ink-2">The NFT was burned when the position closed.</p>
            )}
            <ul className="mono mt-4 space-y-2 text-xs">
              {contracts && explorerTokenUrl(readChainId, contracts.nft.address, id) && (
                <li>
                  <a className="underline" target="_blank" rel="noreferrer" href={explorerTokenUrl(readChainId, contracts.nft.address, id)!}>
                    NFT on Basescan ↗
                  </a>
                </li>
              )}
              {contracts && explorerAddressUrl(readChainId, contracts.staking.address) && (
                <li>
                  <a className="underline" target="_blank" rel="noreferrer" href={explorerAddressUrl(readChainId, contracts.staking.address)!}>
                    FormaStaking contract ↗
                  </a>
                </li>
              )}
              <li>
                Creation tx ·{" "}
                {creation.data ? (
                  <TxLink chainId={readChainId} hash={creation.data.hash} />
                ) : creation.isLoading ? (
                  "searching logs…"
                ) : (
                  "not found in the scanned log range"
                )}{" "}
                <span className="text-ink-3">(indexed from RPC logs)</span>
              </li>
            </ul>
          </div>
          <p className="mt-6 text-sm text-ink-2">
            <Link className="underline" href="/positions">
              ← All positions
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
