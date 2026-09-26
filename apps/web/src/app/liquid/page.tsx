"use client";

import { formatToken, parseTokenInput } from "@forma/sdk";
import Link from "next/link";
import { useState } from "react";

import { AmountInput } from "@/components/AmountInput";
import { ActionGate } from "@/components/NetworkGuard";
import { TxStatus } from "@/components/TxStatus";
import { Loading, ReadError, Row, SectionHeader, TestnetEstimate } from "@/components/ui";
import { useForma } from "@/lib/forma";
import { useForgeAccount, useProtocol, useVault, useVaultPreview } from "@/lib/reads";
import { useFormaTx } from "@/lib/write";

const SLIPPAGE_BPS = 50n; // 0.5 % tolerance on the previewed amount
const SHARE_DECIMALS_FALLBACK = 24;

function withSlippage(x: bigint) {
  return (x * (10_000n - SLIPPAGE_BPS)) / 10_000n;
}

export default function LiquidPage() {
  const { address } = useForma();
  const vault = useVault();
  const forge = useForgeAccount();
  const { paused } = useProtocol();
  const { send, targets, isActive } = useFormaTx();
  const [tab, setTab] = useState<"deposit" | "redeem">("deposit");
  const [depositInput, setDepositInput] = useState("");
  const [redeemInput, setRedeemInput] = useState("");

  const shareDecimals = vault.decimals ?? SHARE_DECIMALS_FALLBACK;
  const dep = parseTokenInput(depositInput);
  const depAmount = dep.ok ? dep.value : undefined;
  const depError =
    depositInput === ""
      ? undefined
      : !dep.ok
        ? dep.reason
        : forge.balance !== undefined && dep.value > forge.balance
          ? "Insufficient FORGE balance."
          : vault.maxDeposit !== undefined && dep.value > vault.maxDeposit
            ? vault.maxDeposit === 0n
              ? "The vault is not accepting deposits right now."
              : `At most ${formatToken(vault.maxDeposit)} FORGE can be deposited.`
            : undefined;

  const red = parseTokenInput(redeemInput, shareDecimals);
  const redAmount = red.ok ? red.value : undefined;
  const redError =
    redeemInput === ""
      ? undefined
      : !red.ok
        ? red.reason
        : vault.maxRedeem !== undefined && red.value > vault.maxRedeem
          ? vault.maxRedeem === 0n
            ? "Redemptions are unavailable right now (protocol paused)."
            : "More than your redeemable stFORGE."
          : undefined;

  const depPreview = useVaultPreview("deposit", depAmount && !depError ? depAmount : undefined);
  const redPreview = useVaultPreview("redeem", redAmount && !redError ? redAmount : undefined);

  const needsApproval = depAmount !== undefined && (forge.vaultAllowance ?? 0n) < depAmount;
  const busy = isActive("vault-approve") || isActive("vault-deposit") || isActive("vault-redeem");
  const rate = vault.exchangeRate;

  return (
    <div className="pt-10">
      <p className="label">Liquid staking · ERC-4626</p>
      <h1 className="display mt-3 text-[clamp(2rem,6vw,5rem)]">stFORGE</h1>
      <p className="mt-4 max-w-2xl text-ink-2">
        The vault keeps all deposited FORGE staked in a single no-lock Forma position and compounds its rewards. You
        hold shares. The exchange rate is <em>underlying assets per share</em>: it rises only when rewards actually
        accrue on-chain. It is not guaranteed and stFORGE is not risk-free.
      </p>

      {vault.error ? (
        <div className="mt-8"><ReadError error={vault.error} what="vault state" /></div>
      ) : vault.isLoading ? (
        <Loading label="Reading vault" />
      ) : (
        <>
          {/* ─── model ─── */}
          <section className="mt-12" aria-label="How the vault works">
            <SectionHeader index="01" title="The model · live values" aside="LiquidStakingVault" />
            <ol className="grid gap-px bg-rule pt-px md:grid-cols-5">
              {[
                {
                  k: "Deposit",
                  v: depAmount && !depError ? `${formatToken(depAmount)} FORGE` : "FORGE",
                  d: "You transfer FORGE to the vault.",
                },
                {
                  k: "Mint",
                  v: depPreview.data !== undefined ? `${formatToken(depPreview.data, { tokenDecimals: shareDecimals })} stFORGE` : "stFORGE",
                  d: "previewDeposit: shares = assets × supply ÷ total assets (rounded down).",
                },
                {
                  k: "Vault",
                  v: vault.totalAssets !== undefined ? `${formatToken(vault.totalAssets)} FORGE` : "—",
                  d: vault.positionId ? `Staked in position #${vault.positionId} (Genesis, no lock), compounding.` : "No vault position open yet.",
                },
                {
                  k: "Exchange rate",
                  v: rate !== undefined ? `1 stFORGE = ${formatToken(rate, { maxDecimals: 6, minDecimals: 4 })} FORGE` : "—",
                  d: "convertToAssets(1 share). Moves with accrued rewards only.",
                },
                { k: "Redeem", v: "stFORGE → FORGE", d: "Vault compounds, withdraws principal, pays you." },
              ].map((step, i) => (
                <li key={step.k} className="relative bg-ivory p-5">
                  <span className="mono text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  <p className="label mt-4 text-ink">{step.k}</p>
                  <p className="numeral mt-2 text-xl break-words">{step.v}</p>
                  <p className="mt-2 text-xs text-ink-2">{step.d}</p>
                  {i < 4 && (
                    <span aria-hidden className="mono absolute top-1/2 -right-2 z-10 hidden bg-ivory text-ink md:block">
                      →
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {vault.exited && (
              <p role="alert" className="mt-4 border-l-2 border-danger bg-danger-wash px-4 py-3 text-sm">
                The vault performed an emergency exit. Deposits are closed. Redemptions are paid pro-rata from{" "}
                {formatToken(vault.idleAssets ?? 0n)} idle FORGE.
              </p>
            )}
          </section>

          {/* ─── your position ─── */}
          <section className="mt-14 grid gap-12 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <SectionHeader index="02" title="Your liquid position" />
              <dl className="pt-2">
                <Row k="stFORGE balance" v={vault.shares !== undefined ? formatToken(vault.shares, { tokenDecimals: shareDecimals, maxDecimals: 6 }) : address ? "…" : "Connect wallet"} />
                <Row k="Redeemable value" v={vault.shareValue !== undefined ? `${formatToken(vault.shareValue, { maxDecimals: 6 })} FORGE` : "—"} />
                <Row k="Vault total assets" v={vault.totalAssets !== undefined ? `${formatToken(vault.totalAssets)} FORGE` : "—"} />
                <Row k="stFORGE supply" v={vault.totalSupply !== undefined ? formatToken(vault.totalSupply, { tokenDecimals: shareDecimals }) : "—"} />
                <Row k="Share decimals" v={`${shareDecimals} (18 + virtual offset 6)`} />
              </dl>
              <div className="mt-6 space-y-2 text-sm text-ink-2">
                <p className="flex items-center gap-2"><TestnetEstimate /> No yield is promised.</p>
                <p>
                  Risks: FormaStaking accounting or solvency failure; reward stream ending; a protocol pause (redemptions
                  wait until unpause or a vault emergency exit, which forfeits the vault&apos;s pending rewards). Read the{" "}
                  <Link className="underline" href="/docs#vault">vault docs</Link>.
                </p>
              </div>
            </div>

            <div>
              <div role="tablist" aria-label="Vault action" className="flex border-b border-ink">
                {(["deposit", "redeem"] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    type="button"
                    id={`tab-${t}`}
                    aria-selected={tab === t}
                    aria-controls={`panel-${t}`}
                    onClick={() => setTab(t)}
                    className="mono px-5 py-3 text-xs font-semibold tracking-[0.14em] uppercase aria-selected:bg-ink aria-selected:text-ivory"
                  >
                    {t}
                  </button>
                ))}
              </div>

              {tab === "deposit" ? (
                <div role="tabpanel" id="panel-deposit" aria-labelledby="tab-deposit" className="space-y-4 pt-6">
                  <AmountInput id="vault-deposit" label="Deposit" value={depositInput} onChange={setDepositInput} balance={forge.balance} symbol="FORGE" error={depError} disabled={busy} />
                  {depPreview.data !== undefined && depAmount && (
                    <dl>
                      <Row k="You receive (preview)" v={`${formatToken(depPreview.data, { tokenDecimals: shareDecimals, maxDecimals: 6 })} stFORGE`} />
                      <Row k="Minimum accepted (0.5% slippage)" v={`${formatToken(withSlippage(depPreview.data), { tokenDecimals: shareDecimals, maxDecimals: 6 })} stFORGE`} />
                    </dl>
                  )}
                  <ActionGate action="deposit">
                    <div className="flex flex-wrap gap-3">
                      {needsApproval && (
                        <button
                          type="button"
                          className="btn"
                          disabled={busy || !!depError || !depAmount}
                          onClick={() =>
                            targets && depAmount &&
                            send(targets.forge, "approve", [targets.vault.address, depAmount], {
                              key: "vault-approve",
                              label: "Approve FORGE for vault",
                              amountLabel: `${formatToken(depAmount)} FORGE`,
                            })
                          }
                        >
                          {isActive("vault-approve") ? "Approving…" : "1 · Approve FORGE"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !!paused || !!depError || !depAmount || needsApproval || depPreview.data === undefined}
                        onClick={async () => {
                          if (!targets || !depAmount || depPreview.data === undefined || !address) return;
                          const res = await send(targets.vault, "depositWithMin", [depAmount, address, withSlippage(depPreview.data)], {
                            key: "vault-deposit",
                            label: "Deposit into stFORGE vault",
                            amountLabel: `${formatToken(depAmount)} FORGE`,
                          });
                          if (res.ok) setDepositInput("");
                        }}
                      >
                        {isActive("vault-deposit") ? "Depositing…" : needsApproval ? "2 · Deposit" : "Deposit"}
                      </button>
                    </div>
                    <TxStatus txKey="vault-approve" />
                    <TxStatus txKey="vault-deposit" />
                  </ActionGate>
                </div>
              ) : (
                <div role="tabpanel" id="panel-redeem" aria-labelledby="tab-redeem" className="space-y-4 pt-6">
                  <AmountInput
                    id="vault-redeem"
                    label="Redeem"
                    value={redeemInput}
                    onChange={setRedeemInput}
                    balance={vault.maxRedeem ?? vault.shares}
                    balanceLabel="Redeemable"
                    symbol="stFORGE"
                    decimals={shareDecimals}
                    error={redError}
                    disabled={busy}
                  />
                  {redPreview.data !== undefined && redAmount && (
                    <dl>
                      <Row k="You receive (preview)" v={`${formatToken(redPreview.data, { maxDecimals: 6 })} FORGE`} />
                      <Row k="Minimum accepted (0.5% slippage)" v={`${formatToken(withSlippage(redPreview.data), { maxDecimals: 6 })} FORGE`} />
                    </dl>
                  )}
                  <ActionGate action="redeem">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !!redError || !redAmount || redPreview.data === undefined}
                      onClick={async () => {
                        if (!targets || !redAmount || redPreview.data === undefined || !address) return;
                        const res = await send(targets.vault, "redeemWithMin", [redAmount, address, address, withSlippage(redPreview.data)], {
                          key: "vault-redeem",
                          label: "Redeem stFORGE",
                          amountLabel: `${formatToken(redAmount, { tokenDecimals: shareDecimals, maxDecimals: 6 })} stFORGE`,
                        });
                        if (res.ok) setRedeemInput("");
                      }}
                    >
                      {isActive("vault-redeem") ? "Redeeming…" : "Redeem"}
                    </button>
                    <TxStatus txKey="vault-redeem" />
                  </ActionGate>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
