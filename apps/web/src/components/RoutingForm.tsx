"use client";

import { formatBpsPercent, RoutingMode, shortAddress, type Routing } from "@forma/sdk";
import { useState } from "react";
import { isAddress, type Address } from "viem";

const MODES = [
  { value: RoutingMode.Keep, label: "Keep", body: "Rewards stay claimable by you." },
  {
    value: RoutingMode.Compound,
    label: "Compound",
    body: "Anyone may compound this position for a capped keeper fee. Compounded rewards join locked principal.",
  },
  { value: RoutingMode.Redirect, label: "Redirect", body: "Claims pay another wallet, which may also trigger them." },
] as const;

export function RoutingForm({
  current,
  owner,
  protocolKeeperFeeBps,
  busy,
  onSubmit,
}: {
  current: Routing | undefined;
  owner: Address;
  protocolKeeperFeeBps: number | undefined;
  busy: boolean;
  onSubmit: (mode: number, recipient: Address, maxKeeperFeeBps: number) => void;
}) {
  const [mode, setMode] = useState<number>(current?.mode ?? RoutingMode.Keep);
  const [recipient, setRecipient] = useState<string>(
    current?.mode === RoutingMode.Redirect ? current.recipient : "",
  );
  const [feePct, setFeePct] = useState<string>(
    current?.mode === RoutingMode.Compound ? String(current.maxKeeperFeeBps / 100) : String((protocolKeeperFeeBps ?? 100) / 100),
  );

  const recipientError =
    mode === RoutingMode.Redirect
      ? !isAddress(recipient)
        ? "Enter a valid 0x address."
        : recipient.toLowerCase() === owner.toLowerCase()
          ? "Redirecting to yourself is the same as Keep."
          : undefined
      : undefined;
  const feeBps = Math.round(Number(feePct) * 100);
  const feeError =
    mode === RoutingMode.Compound && (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 500)
      ? "Keeper fee cap must be between 0% and 5%."
      : undefined;

  const unchanged =
    current &&
    current.mode === mode &&
    (mode !== RoutingMode.Redirect || current.recipient.toLowerCase() === recipient.toLowerCase()) &&
    (mode !== RoutingMode.Compound || current.maxKeeperFeeBps === feeBps);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (recipientError || feeError) return;
        onSubmit(
          mode,
          mode === RoutingMode.Redirect ? (recipient as Address) : "0x0000000000000000000000000000000000000000",
          mode === RoutingMode.Compound ? feeBps : 0,
        );
      }}
      className="space-y-4"
    >
      <fieldset>
        <legend className="label mb-2 text-ink">Reward routing</legend>
        <div className="grid gap-px bg-rule sm:grid-cols-3">
          {MODES.map((m) => (
            <label
              key={m.value}
              className={`block cursor-pointer bg-ivory p-3 has-[:checked]:bg-ink has-[:checked]:text-ivory has-[:focus-visible]:outline-2`}
            >
              <input
                type="radio"
                name="routing-mode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => setMode(m.value)}
                className="sr-only"
              />
              <span className="display block text-lg">{m.label}</span>
              <span className="mt-1 block text-xs opacity-80">{m.body}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === RoutingMode.Redirect && (
        <div>
          <label htmlFor="redirect-recipient" className="label text-ink">
            Recipient wallet
          </label>
          <input
            id="redirect-recipient"
            className="field mt-2"
            placeholder="0x…"
            spellCheck={false}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
            aria-invalid={!!recipient && !!recipientError}
          />
          {recipient && recipientError && <p className="mt-1 text-sm text-danger">{recipientError}</p>}
          <p className="mt-2 text-xs text-ink-2">
            Every claim will pay this address and emit <code className="mono">RewardRedirected</code>. It resets
            automatically if the position NFT changes owner.
          </p>
        </div>
      )}

      {mode === RoutingMode.Compound && (
        <div>
          <label htmlFor="keeper-fee" className="label text-ink">
            Max keeper fee you accept (%)
          </label>
          <input
            id="keeper-fee"
            className="field mt-2 max-w-40"
            inputMode="decimal"
            value={feePct}
            onChange={(e) => setFeePct(e.target.value)}
            aria-invalid={!!feeError}
          />
          {feeError && <p className="mt-1 text-sm text-danger">{feeError}</p>}
          <p className="mt-2 text-xs text-ink-2">
            Keepers receive min(protocol fee{protocolKeeperFeeBps !== undefined ? ` ${formatBpsPercent(protocolKeeperFeeBps)}` : ""},
            your cap) of each compounded amount. Raising the protocol fee later can never charge you more than this cap.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn" disabled={busy || !!recipientError || !!feeError || !!unchanged}>
          {busy ? "Saving…" : "Save routing"}
        </button>
        {current && (
          <span className="mono text-xs text-ink-2">
            Current: {MODES[current.mode]?.label ?? "?"}
            {current.mode === RoutingMode.Redirect && ` → ${shortAddress(current.recipient)}`}
            {current.mode === RoutingMode.Compound && ` · cap ${formatBpsPercent(current.maxKeeperFeeBps)}`}
          </span>
        )}
      </div>
    </form>
  );
}
