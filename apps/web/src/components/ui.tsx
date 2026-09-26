"use client";

import { explorerAddressUrl, explorerTxUrl } from "@forma/config";
import { describeError, shortAddress } from "@forma/sdk";
import type { ReactNode } from "react";
import type { Address, Hash } from "viem";

/** "01 — YOUR POSITIONS" with an optional right-hand aside. */
export function SectionHeader({
  index,
  title,
  aside,
  id,
}: {
  index?: string;
  title: string;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className="flex flex-wrap items-end justify-between gap-3 border-b border-ink pb-2">
      <h2 className="label text-ink">
        {index && <span className="mr-3 text-ink-3">{index}</span>}
        {title}
      </h2>
      {aside && <div className="label">{aside}</div>}
    </div>
  );
}

/**
 * A numeral that never wraps mid-number: it scales to its container (`@container` ancestor) by character
 * count, capped at `maxRem`. Extra `reserve` characters leave room for a trailing unit.
 */
export function FitNumeral({
  text,
  maxRem,
  reserve = 0,
  className = "",
}: {
  text: string;
  maxRem: number;
  reserve?: number;
  className?: string;
}) {
  const chars = Math.max(text.length + reserve, 4);
  const cqi = (100 / (chars * 0.64)).toFixed(2);
  return (
    <span className={`numeral inline-block whitespace-nowrap ${className}`} style={{ fontSize: `min(${maxRem}rem, ${cqi}cqi)` }}>
      {text}
    </span>
  );
}

/** Oversized figure: label, numeral, unit and a footnote. */
export function Figure({
  label,
  value,
  unit,
  note,
  size = "lg",
  tone = "ink",
}: {
  label: string;
  value: string;
  unit?: string;
  note?: ReactNode;
  size?: "xl" | "lg" | "md";
  tone?: "ink" | "lime" | "orange";
}) {
  const maxRem = { xl: 7.5, lg: 4.25, md: 2.5 }[size];
  const tones = { ink: "", lime: "text-lime-ink", orange: "text-orange-ink" };
  return (
    <div className="@container min-w-0">
      <p className="label">{label}</p>
      <p className={`mt-2 flex flex-wrap items-baseline gap-x-2 ${tones[tone]}`}>
        <FitNumeral text={value} maxRem={maxRem} reserve={unit ? 2 : 0} />
        {unit && <span className="mono text-[11px] font-medium tracking-[0.1em]">{unit}</span>}
      </p>
      {note && <p className="mt-2 text-sm text-ink-2">{note}</p>}
    </div>
  );
}

export function Loading({ label = "Reading chain state" }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="label flex items-center gap-2 py-6">
      <span aria-hidden className="inline-block size-2 animate-pulse bg-orange" />
      {label}…
    </p>
  );
}

/** Explicit read failure. Never replaced with fallback data. */
export function ReadError({ error, what = "on-chain data" }: { error: unknown; what?: string }) {
  const d = describeError(error);
  return (
    <div role="alert" className="border-l-2 border-danger bg-danger-wash px-4 py-3">
      <p className="mono text-xs font-semibold tracking-wider text-danger uppercase">Could not read {what}</p>
      <p className="mt-1 text-sm text-ink">{d.title}: {d.detail}</p>
      <p className="mt-1 text-xs text-ink-2">No fallback data is shown. Values will appear once the RPC responds.</p>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-rule-strong px-6 py-10">
      <p className="label text-ink">{title}</p>
      {children && <div className="mt-3 max-w-prose text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function TxLink({ chainId, hash }: { chainId: number; hash: Hash }) {
  const url = explorerTxUrl(chainId, hash);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="mono break-all text-xs underline">
      {shortAddress(hash, 6)} ↗
    </a>
  ) : (
    <span className="mono break-all text-xs" title="Local Anvil chain — no block explorer">
      {shortAddress(hash, 6)} (local)
    </span>
  );
}

export function AddressLink({ chainId, address, label }: { chainId: number; address: Address; label?: string }) {
  const url = explorerAddressUrl(chainId, address);
  const text = label ?? shortAddress(address);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="mono text-xs break-all underline" title={address}>
      {text} ↗
    </a>
  ) : (
    <span className="mono text-xs break-all" title={address}>
      {text}
    </span>
  );
}

/** Key/value row for dense contract-state tables. */
export function Row({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 border-b border-rule py-2.5">
      <dt className="label self-center">{k}</dt>
      <dd className={`${mono ? "mono" : ""} min-w-0 text-right text-sm break-words`}>{v}</dd>
    </div>
  );
}

export function TestnetEstimate() {
  return (
    <span className="tag border-orange-ink text-orange-ink" title="Derived from current on-chain emission; not a promise of return">
      Testnet estimate
    </span>
  );
}
