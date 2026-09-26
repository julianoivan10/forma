"use client";

import type { Abi, Address, ContractFunctionArgs, ContractFunctionName } from "viem";

import { useForma } from "./forma";
import { useTx, type TxResult } from "./tx";

type Mutability = "nonpayable" | "payable";

export interface TxMeta {
  /** Dedup key: one active tx per key. */
  key: string;
  label: string;
  amountLabel?: string;
}

/**
 * Typed transaction sender bound to the current Forma deployment. Function names and argument tuples are
 * checked against the generated ABIs at compile time.
 */
export function useFormaTx() {
  const { contracts, readChainId, canTransact } = useForma();
  const { run, isActive, latest } = useTx();

  async function send<const TAbi extends Abi, TFn extends ContractFunctionName<TAbi, Mutability>>(
    target: { address: Address; abi: TAbi; name: string },
    functionName: TFn,
    args: ContractFunctionArgs<TAbi, Mutability, TFn>,
    meta: TxMeta,
  ): Promise<TxResult> {
    if (!canTransact) {
      return {
        ok: false,
        error: { kind: "wrong-network", title: "Wallet not ready", detail: "Connect a wallet on Base Sepolia first." },
      };
    }
    return run({
      ...meta,
      contractName: target.name,
      chainId: readChainId,
      address: target.address,
      abi: target.abi as Abi,
      functionName: functionName as string,
      args: args as readonly unknown[],
    });
  }

  const targets = contracts && {
    staking: { ...contracts.staking, name: "FormaStaking" },
    forge: { ...contracts.forge, name: "ForgeToken" },
    vault: { ...contracts.vault, name: "LiquidStakingVault" },
    nft: { ...contracts.nft, name: "PositionNFT" },
  };

  return { send, targets, isActive, latest, canTransact, chainId: readChainId };
}
