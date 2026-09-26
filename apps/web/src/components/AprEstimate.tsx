import {
  APR_NOT_MEANINGFUL_LABEL,
  APR_NOT_MEANINGFUL_NOTE,
  formatRateBps,
  type AprAssessment,
} from "@forma/sdk";

/**
 * Presentation of an on-chain APR estimate. Never shows an extreme or liquidity-dominated figure as if it were
 * a yield; always labels a shown value as a testnet estimate.
 */
export function AprEstimate({ assessment, withNote = false }: { assessment: AprAssessment; withNote?: boolean }) {
  if (assessment.kind === "no-stream") return <span className="text-ink-3">No active stream</span>;
  if (assessment.kind === "not-meaningful") {
    return (
      <span>
        <span className="text-ink-2">{APR_NOT_MEANINGFUL_LABEL}</span>
        {withNote && <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{APR_NOT_MEANINGFUL_NOTE}</span>}
      </span>
    );
  }
  return (
    <span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-ink">{formatRateBps(assessment.aprBps)}</span>
        <span className="tag border-orange-ink px-1 text-[9px] text-orange-ink">Testnet</span>
      </span>
      {assessment.apyBps !== null && (
        <span className="block text-[11px] text-ink-3">APY {formatRateBps(assessment.apyBps)} est.</span>
      )}
    </span>
  );
}

/** Column / row label used wherever an estimate appears. */
export function AprLabel() {
  return (
    <span className="inline-flex items-center gap-1.5">
      Est. APR
      <span className="tag border-orange-ink px-1 text-[9px] text-orange-ink">Testnet</span>
    </span>
  );
}
