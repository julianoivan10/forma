"use client";

import {
  getDeployment,
  isMainnetChainId,
  isSupportedChainId,
  NETWORK_LABEL,
  type SupportedChainId,
} from "@forma/config";
import { formaContracts } from "@forma/sdk";
import { useAccount } from "wagmi";

import { ANVIL_ENABLED, DEFAULT_READ_CHAIN_ID } from "./env";

export type FormaState =
  | "disconnected" // reads work, writes need a wallet
  | "mainnet" // wallet on a mainnet: hard stop
  | "wrong-network" // wallet on an unsupported testnet/chain
  | "not-deployed" // supported chain but no deployment manifest
  | "ready";

/**
 * Single source of truth for "which chain are we reading, which contracts, and can the user transact".
 * Reads always target a supported chain; they never fall back to fabricated data.
 */
export function useForma() {
  const { address, chainId: walletChainId, status } = useAccount();
  const connected = status === "connected" && !!address;
  const walletSupported = isSupportedChainId(walletChainId, ANVIL_ENABLED);
  const readChainId = (connected && walletSupported ? walletChainId : DEFAULT_READ_CHAIN_ID) as SupportedChainId;
  const contracts = formaContracts(readChainId);
  const deployment = getDeployment(readChainId);

  let state: FormaState;
  if (!connected) state = contracts ? "disconnected" : "not-deployed";
  else if (isMainnetChainId(walletChainId)) state = "mainnet";
  else if (!walletSupported) state = "wrong-network";
  else if (!contracts) state = "not-deployed";
  else state = "ready";

  return {
    address: connected ? address : undefined,
    connected,
    walletChainId,
    readChainId,
    networkLabel: NETWORK_LABEL[readChainId],
    contracts,
    deployment,
    state,
    canTransact: state === "ready",
  };
}
