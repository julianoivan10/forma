"use client";

import { useForma, type FormaState } from "@/lib/forma";

const WALLET_TEXT: Record<FormaState, string> = {
  disconnected: "Not connected",
  "not-deployed": "Connected · not deployed here",
  ready: "Connected",
  "wrong-network": "Wrong network",
  mainnet: "Mainnet · blocked",
};

/**
 * Network + wallet state, always as text (colour is only a secondary cue).
 * `layout="inline"` sits in the navbar on wide screens; `layout="strip"` is the slim row used below xl.
 */
export function NetworkStatus({ layout }: { layout: "inline" | "strip" }) {
  const { networkLabel, state, connected } = useForma();
  const walletText = connected ? WALLET_TEXT[state] : WALLET_TEXT.disconnected;
  const warn = state === "wrong-network" || state === "mainnet";

  const network = (
    <span className="mono inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] whitespace-nowrap text-ink uppercase">
      <span aria-hidden className="size-2 bg-orange ring-1 ring-ink" />
      {networkLabel}
    </span>
  );
  const wallet = (
    <span
      className={`mono inline-flex items-center gap-1.5 text-[10px] tracking-[0.12em] whitespace-nowrap uppercase ${warn ? "font-semibold text-danger" : "text-ink-2"}`}
    >
      <span
        aria-hidden
        className={`size-2 ${warn ? "bg-danger" : connected ? "bg-lime ring-1 ring-ink" : "border border-ink-3"}`}
      />
      {warn && <span aria-hidden>!</span>}
      Wallet · {walletText}
    </span>
  );

  if (layout === "inline") {
    return (
      <div role="status" aria-label="Network and wallet status" className="hidden flex-col items-end gap-1 xl:flex">
        {network}
        {wallet}
      </div>
    );
  }
  return (
    <div role="status" aria-label="Network and wallet status" className="border-t border-rule xl:hidden">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 sm:px-8">
        {network}
        {wallet}
      </div>
    </div>
  );
}
