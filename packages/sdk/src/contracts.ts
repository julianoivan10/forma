import { getDeployment } from "@forma/config";
import type { Address } from "viem";

import {
  forgeTokenAbi,
  formaStakingAbi,
  liquidStakingVaultAbi,
  positionNftAbi,
  positionRendererAbi,
} from "./generated/abis";

export interface FormaContracts {
  chainId: number;
  forge: { address: Address; abi: typeof forgeTokenAbi };
  staking: { address: Address; abi: typeof formaStakingAbi };
  nft: { address: Address; abi: typeof positionNftAbi };
  renderer: { address: Address; abi: typeof positionRendererAbi };
  vault: { address: Address; abi: typeof liquidStakingVaultAbi };
}

/** Typed contract handles for `chainId`, or `undefined` when Forma is not deployed there. */
export function formaContracts(chainId: number | undefined): FormaContracts | undefined {
  const d = getDeployment(chainId);
  if (!d || chainId === undefined) return undefined;
  return {
    chainId,
    forge: { address: d.contracts.ForgeToken, abi: forgeTokenAbi },
    staking: { address: d.contracts.FormaStaking, abi: formaStakingAbi },
    nft: { address: d.contracts.PositionNFT, abi: positionNftAbi },
    renderer: { address: d.contracts.PositionRenderer, abi: positionRendererAbi },
    vault: { address: d.contracts.LiquidStakingVault, abi: liquidStakingVaultAbi },
  };
}
