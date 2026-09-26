import { ANVIL_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, parsePublicEnv } from "@forma/config";

// Literal references so Next.js inlines them at build time.
export const env = parsePublicEnv({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_ENABLE_ANVIL: process.env.NEXT_PUBLIC_ENABLE_ANVIL,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
});

export const ANVIL_ENABLED = env.NEXT_PUBLIC_ENABLE_ANVIL;

/** Chain used for public reads when no (supported) wallet is connected. */
export const DEFAULT_READ_CHAIN_ID =
  ANVIL_ENABLED && env.NEXT_PUBLIC_APP_ENV === "development" ? ANVIL_CHAIN_ID : BASE_SEPOLIA_CHAIN_ID;
