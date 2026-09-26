"use client";

import { BASE_SEPOLIA_CHAIN_ID, NETWORK_LABEL } from "@forma/config";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import type { ReactNode } from "react";
import { useSwitchChain } from "wagmi";

import { useForma } from "@/lib/forma";

const MANUAL_NETWORK = "Add Base Sepolia manually: chain id 84532, explorer sepolia.basescan.org.";

/**
 * Human-readable explanation for a failed network switch. Wallets (and wagmi) report both a declined prompt and a
 * failed "add network" as a rejection, so the message covers both and always gives the manual fallback.
 */
function switchErrorText(error: Error): string {
  const rejected =
    error.name === "UserRejectedRequestError" ||
    (error as Error & { code?: number }).code === 4001 ||
    /user rejected|denied/i.test(error.message);
  return rejected
    ? `The network switch was declined or your wallet could not add Base Sepolia. Nothing changed. ${MANUAL_NETWORK}`
    : `Your wallet could not switch automatically. ${MANUAL_NETWORK}`;
}

/**
 * Actionable global warning when the connected wallet is on a chain Forma cannot use.
 * Mainnet gets the strongest treatment: Forma never builds a transaction for it.
 */
export function NetworkAlert() {
  const { state, walletChainId } = useForma();
  const { chains, switchChain, isPending, error } = useSwitchChain();
  if (state !== "mainnet" && state !== "wrong-network") return null;
  const mainnet = state === "mainnet";
  const walletChain = chains.find((c) => c.id === walletChainId)?.name;
  return (
    <div role="alert" className={`border-b-2 ${mainnet ? "border-danger bg-danger-wash" : "border-orange bg-orange/10"}`}>
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <div className="min-w-0 text-sm">
          <p
            className={`mono text-xs font-semibold tracking-[0.12em] uppercase ${mainnet ? "text-danger" : "text-orange-ink"}`}
          >
            {mainnet ? "Mainnet detected — blocked" : "Wrong network"} · wallet on chain {walletChainId}
            {walletChain ? ` (${walletChain})` : ""}
          </p>
          <p className="mt-1 text-ink">
            {mainnet
              ? "Forma is testnet-only and will never send a mainnet transaction. Switch your wallet to Base Sepolia to continue."
              : "Forma runs on Base Sepolia testnet. You can keep browsing; actions stay disabled until you switch."}
          </p>
          {error && <p className="mt-1 text-danger">{switchErrorText(error)}</p>}
        </div>
        <button
          type="button"
          className={`btn ${mainnet ? "btn-danger" : ""}`}
          disabled={isPending}
          onClick={() => switchChain({ chainId: BASE_SEPOLIA_CHAIN_ID })}
        >
          {isPending ? "Confirm in wallet…" : "Switch to Base Sepolia"}
        </button>
      </div>
    </div>
  );
}

/**
 * Renders `children` (write controls) only when the wallet can actually transact on a Forma deployment.
 * Otherwise explains exactly what is missing and offers the fix.
 */
export function ActionGate({ children, action = "continue" }: { children: ReactNode; action?: string }) {
  const { state, readChainId } = useForma();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending, error } = useSwitchChain();

  if (state === "ready") return <>{children}</>;

  if (state === "disconnected") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn" onClick={openConnectModal}>
          Connect wallet
        </button>
        <span className="text-sm text-ink-2">Connect a wallet to {action}.</span>
      </div>
    );
  }

  if (state === "mainnet" || state === "wrong-network") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-danger"
            disabled={isPending}
            onClick={() => switchChain({ chainId: BASE_SEPOLIA_CHAIN_ID })}
          >
            {isPending ? "Confirm in wallet…" : "Switch to Base Sepolia"}
          </button>
          <span className="text-sm text-ink-2">Your wallet is on an unsupported network.</span>
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {switchErrorText(error)}
          </p>
        )}
      </div>
    );
  }

  return (
    <p className="text-sm text-ink-2">
      Forma is not deployed on {NETWORK_LABEL[readChainId]} yet. See <a href="/docs#deployment" className="underline">deployment status</a>.
    </p>
  );
}
