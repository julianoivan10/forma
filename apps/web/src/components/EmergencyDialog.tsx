"use client";

import { formatBpsPercent, formatToken, type EmergencyPreview } from "@forma/sdk";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Consequences first, then an explicit acknowledgement, then the irreversible action.
 * Every figure comes from the contract's own `previewEmergencyWithdraw`.
 */
export function EmergencyDialog({
  open,
  onClose,
  onConfirm,
  preview,
  penaltyBps,
  paused,
  locked,
  busy,
  positionId,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  preview: EmergencyPreview | undefined;
  penaltyBps: number;
  paused: boolean;
  locked: boolean;
  busy: boolean;
  positionId: bigint;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [ack, setAck] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setAck(false);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const penaltyReason = paused
    ? "Waived: protocol is paused"
    : locked
      ? `${formatBpsPercent(penaltyBps)} of principal (still locked)`
      : "None: position is unlocked";

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(560px,calc(100vw-2rem))] border-2 border-danger bg-paper p-0 text-ink backdrop:bg-ink/60"
    >
      <div className="bg-danger px-5 py-3 text-white">
        <h2 id={titleId} className="mono text-sm font-semibold tracking-[0.16em] uppercase">
          Emergency withdraw · Position #{positionId.toString()}
        </h2>
      </div>
      <div className="p-5">
        {!preview ? (
          <p className="label">Reading previewEmergencyWithdraw…</p>
        ) : (
          <dl className="mono text-sm">
            {[
              ["Principal", `${formatToken(preview.principal, { maxDecimals: 4 })} FORGE`],
              ["Pending rewards", `${formatToken(preview.pendingForfeited, { maxDecimals: 4 })} FORGE`],
              ["Rewards forfeited", `${formatToken(preview.pendingForfeited, { maxDecimals: 4 })} FORGE`],
              ["Penalty", `${formatToken(preview.penalty, { maxDecimals: 4 })} FORGE — ${penaltyReason}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-rule py-2">
                <dt className="text-ink-2">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="font-semibold">Estimated amount returned</dt>
              <dd className="numeral text-3xl">{formatToken(preview.amountOut)} FORGE</dd>
            </div>
          </dl>
        )}
        <p className="mono mt-2 text-xs font-semibold tracking-[0.16em] text-danger uppercase">
          This action cannot be undone. The position NFT is burned.
        </p>
        <p className="mt-2 text-sm text-ink-2">
          Forfeited rewards and any penalty return to the reward reserve and are re-streamed to remaining stakers. The
          final amount is computed on-chain at execution and can only be equal or higher (e.g. if the lock expires or
          the protocol is paused first).
        </p>
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-danger" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I understand I will forfeit my pending rewards{locked && !paused ? " and pay the penalty" : ""}.</span>
        </label>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" disabled={!ack || busy || !preview} onClick={onConfirm}>
            {busy ? "Withdrawing…" : "Emergency withdraw"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
