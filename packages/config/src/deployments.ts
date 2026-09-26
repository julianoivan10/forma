import { deployments } from "./generated/deployments";
import type { ContractName, DeploymentManifest } from "./types";

/** Deployment for `chainId`, or `undefined` when the protocol is not deployed there. Never guesses. */
export function getDeployment(chainId: number | undefined): DeploymentManifest | undefined {
  return chainId === undefined ? undefined : deployments[chainId];
}

export function getContractAddress(chainId: number | undefined, name: ContractName) {
  return getDeployment(chainId)?.contracts[name];
}

export function deployedChainIds(): number[] {
  return Object.keys(deployments).map(Number);
}
