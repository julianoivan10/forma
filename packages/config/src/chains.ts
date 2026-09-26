import type { Address, Chain, Hash } from "viem";
import { anvil, baseSepolia } from "viem/chains";

export const BASE_SEPOLIA_CHAIN_ID = baseSepolia.id; // 84532
export const ANVIL_CHAIN_ID = anvil.id; // 31337

export type SupportedChainId = typeof BASE_SEPOLIA_CHAIN_ID | typeof ANVIL_CHAIN_ID;

/** The primary (and only public) target. Mainnet is intentionally absent. */
export const PRIMARY_CHAIN: Chain = baseSepolia;

export const NETWORK_LABEL: Record<SupportedChainId, string> = {
  [BASE_SEPOLIA_CHAIN_ID]: "BASE SEPOLIA · TESTNET",
  [ANVIL_CHAIN_ID]: "ANVIL · LOCAL DEVNET",
};

/**
 * Chain ids that must never receive a transaction from this app. Used by the wallet guard as a second line of
 * defence on top of the supported-chain allow-list.
 */
export const MAINNET_CHAIN_IDS: readonly number[] = [1, 10, 56, 137, 8453, 42161, 43114, 59144, 324, 534352];

export function isSupportedChainId(id: number | undefined, anvilEnabled: boolean): id is SupportedChainId {
  if (id === BASE_SEPOLIA_CHAIN_ID) return true;
  return anvilEnabled && id === ANVIL_CHAIN_ID;
}

export function isMainnetChainId(id: number | undefined): boolean {
  return id !== undefined && MAINNET_CHAIN_IDS.includes(id);
}

export function supportedChains(anvilEnabled: boolean): readonly [Chain, ...Chain[]] {
  return anvilEnabled ? [baseSepolia, anvil] : [baseSepolia];
}

const EXPLORER: Partial<Record<number, string>> = {
  [BASE_SEPOLIA_CHAIN_ID]: "https://sepolia.basescan.org",
};

/** Block-explorer link, or `null` when the chain has no public explorer (Anvil). */
export function explorerTxUrl(chainId: number, hash: Hash): string | null {
  const base = EXPLORER[chainId];
  return base ? `${base}/tx/${hash}` : null;
}

export function explorerAddressUrl(chainId: number, address: Address): string | null {
  const base = EXPLORER[chainId];
  return base ? `${base}/address/${address}` : null;
}

export function explorerTokenUrl(chainId: number, token: Address, tokenId?: bigint): string | null {
  const base = EXPLORER[chainId];
  if (!base) return null;
  return tokenId === undefined ? `${base}/token/${token}` : `${base}/nft/${token}/${tokenId.toString()}`;
}
