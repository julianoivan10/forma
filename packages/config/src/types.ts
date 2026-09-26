import type { Address, Hash } from "viem";

export type ContractName =
  | "ForgeToken"
  | "FormaStaking"
  | "PositionNFT"
  | "PositionRenderer"
  | "LiquidStakingVault";

export interface DeploymentManifest {
  network: "anvil" | "base-sepolia";
  chainId: number;
  version: string;
  /** Unix seconds. */
  deployedAt: number;
  /** First block containing a deployment transaction (log scans start here). */
  startBlock: number;
  contracts: Record<ContractName, Address>;
  roles: { admin: Address; poolManager: Address; rewardManager: Address; pauser: Address };
  transactions: Partial<Record<ContractName, Hash>>;
}
