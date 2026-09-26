"use client";

import { shortAddress } from "@forma/sdk";

import { TX_STEPS, useTx, type TxPhase, type TxRecord } from "@/lib/tx";

import { TxLink } from "./ui";

const ORDER: Record<Exclude<TxPhase, "failed">, number> = {
  preparing: 0,
  wallet: 1,
  submitted: 2,
  confirming: 3,
  confirmed: 4,
};

/** Five-step status for a single transaction record, with hash, explorer link, contract and amount. */
export function TxSteps({ record }: { record: TxRecord }) {
  const failed = record.phase === "failed";
  const at = (failed ? (record.failedAt ?? "preparing") : record.phase) as Exclude<TxPhase, "failed">;
  const reached = ORDER[at];

  return (
    <div className="space-y-3" aria-live="polite">
      <ol className="grid grid-cols-5 gap-1" aria-label={`${record.label} progress`}>
        {TX_STEPS.map((step, i) => {
          const isFailedStep = failed && i === reached;
          const done = !failed ? i < reached || record.phase === "confirmed" : i < reached;
          const current = !failed && i === reached && record.phase !== "confirmed";
          return (
            <li key={step.phase} className="min-w-0">
              <span
                aria-hidden
                className={`block h-1.5 ${
                  isFailedStep ? "bg-danger" : done ? "bg-ink" : current ? "animate-pulse bg-orange" : "bg-ink/15"
                }`}
              />
              <span
                className={`mono mt-1.5 block truncate text-[10px] tracking-[0.1em] uppercase ${
                  isFailedStep ? "text-danger" : current ? "text-ink" : "text-ink-3"
                }`}
              >
                {isFailedStep ? "Failed" : step.label}
                {current && <span className="sr-only"> (in progress)</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <dl className="mono grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-ink-3">Action</dt>
        <dd>{record.label}</dd>
        <dt className="text-ink-3">Contract</dt>
        <dd>
          {record.contractName} <span className="text-ink-3">{shortAddress(record.contractAddress)}</span>
        </dd>
        {record.amountLabel && (
          <>
            <dt className="text-ink-3">Amount</dt>
            <dd>{record.amountLabel}</dd>
          </>
        )}
        {record.hash && (
          <>
            <dt className="text-ink-3">Tx hash</dt>
            <dd>
              <TxLink chainId={record.chainId} hash={record.hash} />
            </dd>
          </>
        )}
        {record.blockNumber !== undefined && (
          <>
            <dt className="text-ink-3">Block</dt>
            <dd>{record.blockNumber.toString()}</dd>
          </>
        )}
      </dl>

      {record.phase === "wallet" && <p className="text-sm text-ink-2">Confirm the transaction in your wallet.</p>}
      {record.phase === "confirming" && (
        <p className="text-sm text-ink-2">Submitted. Waiting for the transaction to be mined — do not resubmit.</p>
      )}
      {record.phase === "confirmed" && (
        <p className="text-sm font-medium text-lime-ink">Confirmed on-chain.</p>
      )}
      {failed && record.error && (
        <div role="alert" className="border-l-2 border-danger bg-danger-wash px-3 py-2">
          <p className="text-sm font-semibold text-danger">{record.error.title}</p>
          <p className="text-sm text-ink">{record.error.detail}</p>
          {record.error.technical && <p className="mono mt-1 text-[11px] text-ink-3">{record.error.technical}</p>}
        </div>
      )}
    </div>
  );
}

/** Inline status for the latest transaction under `txKey` (renders nothing before the first attempt). */
export function TxStatus({ txKey }: { txKey: string }) {
  const { latest } = useTx();
  const record = latest(txKey);
  if (!record) return null;
  return (
    <div className="mt-4 border border-ink bg-paper p-4">
      <TxSteps record={record} />
    </div>
  );
}

const PHASE_TEXT: Record<TxPhase, string> = {
  preparing: "Preparing",
  wallet: "Confirm in wallet",
  submitted: "Submitted",
  confirming: "Confirming",
  confirmed: "Confirmed",
  failed: "Failed",
};

/** Compact session transaction log pinned to the viewport corner. Full detail lives next to each action. */
export function TxDock() {
  const { records, dismiss } = useTx();
  const visible = records.slice(0, 4);
  if (visible.length === 0) return null;
  return (
    <aside
      aria-label="Recent transactions"
      className="fixed right-3 bottom-3 left-3 z-40 border border-ink bg-paper shadow-[4px_4px_0_0_#0e1a2b] sm:left-auto sm:w-[380px]"
    >
      <p className="label rule-b px-3 py-2 text-ink">Session transactions</p>
      <ul>
        {visible.map((r) => (
          <li key={r.id} className="flex items-center gap-3 border-b border-rule px-3 py-2 last:border-b-0">
            <span
              aria-hidden
              className={`size-2 shrink-0 ${
                r.phase === "confirmed" ? "bg-lime ring-1 ring-ink" : r.phase === "failed" ? "bg-danger" : "animate-pulse bg-orange"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{r.label}</p>
              <p className="mono text-[10px] tracking-[0.1em] text-ink-3 uppercase">
                {PHASE_TEXT[r.phase]}
                {r.hash && (
                  <>
                    {" · "}
                    <TxLink chainId={r.chainId} hash={r.hash} />
                  </>
                )}
              </p>
            </div>
            {!isActive(r.phase) && (
              <button
                type="button"
                className="mono text-[10px] tracking-[0.12em] text-ink-3 uppercase hover:text-ink"
                onClick={() => dismiss(r.id)}
                aria-label={`Dismiss ${r.label}`}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function isActive(phase: TxPhase) {
  return phase !== "confirmed" && phase !== "failed";
}
