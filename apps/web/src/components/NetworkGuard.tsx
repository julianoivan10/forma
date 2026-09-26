"use client";

import { BASE_SEPOLIA_CHAIN_ID, NETWORK_LABEL } from "@forma/config";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import type { ReactNode } from "react";
import { useSwitchChain } from "wagmi";

import { useForma } from "@/lib/forma";

/**
 * Global hard stop when a wallet is on a mainnet. Forma never builds a transaction for mainnet.
 */
export function MainnetAlert() {
  const { state, walletChainId } = useForma();
  const { switchChain, isPending } = useSwitchChain();
  if (state !== "mainnet") return null;
  return (
    <div role="alert" className="border-b-2 border-danger bg-danger-wash">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <p className="text-sm text-danger">
          <strong className="mono tracking-wider uppercase">Mainnet detected (chain {walletChainId}).</strong> Forma is
          a testnet-only protocol and will not send transactions on mainnet. Switch to Base Sepolia.
        </p>
        <button
          type="button"
          className="btn btn-danger"
          disabled={isPending}
          onClick={() => switchChain({ chainId: BASE_SEPOLIA_CHAIN_ID })}
        >
          {isPending ? "Check wallet…" : "Switch to Base Sepolia"}
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
            {/^user rejected/i.test(error.message)
              ? "Network switch declined in wallet."
              : `Could not switch automatically: ${error.message.split("\n")[0]}. Add Base Sepolia (chain id 84532) in your wallet.`}
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
