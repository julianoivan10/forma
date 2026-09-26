"use client";

import { describeError, type DescribedError } from "@forma/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Abi, Address, Hash, TransactionReceipt } from "viem";
import { useAccount, useConfig } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";

/**
 * Transaction lifecycle. Success is only ever shown after a mined receipt with status "success".
 *   preparing → wallet → submitted → confirming → confirmed | failed
 */
export type TxPhase = "preparing" | "wallet" | "submitted" | "confirming" | "confirmed" | "failed";

export const TX_STEPS: { phase: Exclude<TxPhase, "failed">; label: string }[] = [
  { phase: "preparing", label: "Preparing" },
  { phase: "wallet", label: "Wallet confirmation" },
  { phase: "submitted", label: "Submitted" },
  { phase: "confirming", label: "Confirming" },
  { phase: "confirmed", label: "Confirmed" },
];

export interface TxRecord {
  id: number;
  /** Deduplication key, e.g. `claim:184`. Only one active tx per key. */
  key: string;
  label: string;
  contractName: string;
  contractAddress: Address;
  amountLabel?: string;
  chainId: number;
  phase: TxPhase;
  /** Phase reached before failing (for rendering the step list). */
  failedAt?: TxPhase;
  hash?: Hash;
  blockNumber?: bigint;
  error?: DescribedError;
  startedAt: number;
}

export interface TxRequest {
  key: string;
  label: string;
  contractName: string;
  amountLabel?: string;
  chainId: number;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

export type TxResult = { ok: true; receipt: TransactionReceipt; hash: Hash } | { ok: false; error: DescribedError };

interface TxContextValue {
  records: TxRecord[];
  run: (req: TxRequest) => Promise<TxResult>;
  isActive: (key: string) => boolean;
  latest: (key: string) => TxRecord | undefined;
  dismiss: (id: number) => void;
}

const TxContext = createContext<TxContextValue | null>(null);

const ACTIVE: TxPhase[] = ["preparing", "wallet", "submitted", "confirming"];

export function TxProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [records, setRecords] = useState<TxRecord[]>([]);
  const activeKeys = useRef(new Set<string>());
  const nextId = useRef(1);

  const patch = useCallback((id: number, update: Partial<TxRecord>) => {
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, ...update } : r)));
  }, []);

  const run = useCallback(
    async (req: TxRequest): Promise<TxResult> => {
      // Duplicate-submission guard (synchronous, so double clicks cannot race).
      if (activeKeys.current.has(req.key)) {
        return {
          ok: false,
          error: { kind: "unknown", title: "Already in progress", detail: "This action already has a pending transaction." },
        };
      }
      activeKeys.current.add(req.key);
      const id = nextId.current++;
      setRecords((rs) => [
        {
          id,
          key: req.key,
          label: req.label,
          contractName: req.contractName,
          contractAddress: req.address,
          amountLabel: req.amountLabel,
          chainId: req.chainId,
          phase: "preparing",
          startedAt: Date.now(),
        },
        ...rs.slice(0, 19),
      ]);

      let phase: TxPhase = "preparing";
      const fail = (error: unknown, extra: Partial<TxRecord> = {}): TxResult => {
        const described = describeError(error);
        patch(id, { phase: "failed", failedAt: phase, error: described, ...extra });
        return { ok: false, error: described };
      };

      try {
        // 1. Preparing: simulate first so predictable reverts never reach the wallet.
        const { request } = await simulateContract(config, {
          address: req.address,
          abi: req.abi,
          functionName: req.functionName,
          args: req.args,
          chainId: req.chainId,
          account: address,
        } as Parameters<typeof simulateContract>[1]);

        // 2. Wallet confirmation.
        phase = "wallet";
        patch(id, { phase });
        const hash = await writeContract(config, request as Parameters<typeof writeContract>[1]);

        // 3–4. Submitted → confirming.
        phase = "submitted";
        patch(id, { phase, hash });
        phase = "confirming";
        patch(id, { phase });
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: req.chainId });

        // 5. Confirmed or reverted on-chain.
        if (receipt.status !== "success") {
          return fail(new Error(`Transaction reverted on-chain in block ${receipt.blockNumber}.`), {
            blockNumber: receipt.blockNumber,
          });
        }
        patch(id, { phase: "confirmed", blockNumber: receipt.blockNumber });
        await queryClient.invalidateQueries();
        return { ok: true, receipt, hash };
      } catch (error) {
        return fail(error);
      } finally {
        activeKeys.current.delete(req.key);
      }
    },
    [address, config, patch, queryClient],
  );

  const value = useMemo<TxContextValue>(
    () => ({
      records,
      run,
      isActive: (key) => records.some((r) => r.key === key && ACTIVE.includes(r.phase)),
      latest: (key) => records.find((r) => r.key === key),
      dismiss: (id) => setRecords((rs) => rs.filter((r) => r.id !== id)),
    }),
    [records, run],
  );

  return <TxContext.Provider value={value}>{children}</TxContext.Provider>;
}

export function useTx() {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error("useTx must be used inside <TxProvider>");
  return ctx;
}

export function isActivePhase(phase: TxPhase): boolean {
  return ACTIVE.includes(phase);
}
