"use client";

import { supportedChains } from "@forma/config";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { anvil, baseSepolia } from "wagmi/chains";

import { ANVIL_ENABLED, env } from "./env";

const projectId = env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/** WalletConnect-based wallets need a project id; without one we only offer browser-injected wallets. */
export const WALLETCONNECT_ENABLED = Boolean(projectId);

const connectors = connectorsForWallets(
  WALLETCONNECT_ENABLED
    ? [
        { groupName: "Recommended", wallets: [injectedWallet, metaMaskWallet, coinbaseWallet, rabbyWallet] },
        { groupName: "More", wallets: [rainbowWallet, walletConnectWallet] },
      ]
    : [{ groupName: "Browser wallet", wallets: [injectedWallet, coinbaseWallet] }],
  {
    appName: "Forma (Base Sepolia testnet)",
    // Only used by WalletConnect wallets, which are not offered when the id is missing.
    projectId: projectId ?? "walletconnect-disabled",
  },
);

export const wagmiConfig = createConfig({
  chains: supportedChains(ANVIL_ENABLED),
  connectors,
  ssr: true,
  transports: {
    [baseSepolia.id]: http(env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL, { batch: true }),
    [anvil.id]: http("http://127.0.0.1:8545", { batch: true }),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
