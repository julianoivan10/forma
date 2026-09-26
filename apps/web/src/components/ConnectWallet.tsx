"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { shortAddress } from "@forma/sdk";

/** Custom-rendered RainbowKit button that matches the Forma visual system. */
export function ConnectWallet({ compact = false }: { compact?: boolean }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        if (!ready) {
          return (
            <span aria-hidden className="btn btn-ghost opacity-0">
              Connect
            </span>
          );
        }
        if (!account) {
          return (
            <button type="button" className="btn px-3 sm:px-[1.125rem]" onClick={openConnectModal} aria-label="Connect wallet">
              Connect<span className="hidden sm:inline">&nbsp;wallet</span>
            </button>
          );
        }
        if (chain?.unsupported) {
          return (
            <button type="button" className="btn btn-danger" onClick={openChainModal}>
              Wrong network
            </button>
          );
        }
        return (
          <button type="button" className="btn btn-ghost" onClick={openAccountModal} title={account.address}>
            <span aria-hidden className="size-2 bg-lime ring-1 ring-ink" />
            {compact ? shortAddress(account.address, 3) : shortAddress(account.address)}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
