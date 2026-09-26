/**
 * Mandatory, non-dismissible disclosure (not hidden in the footer).
 */
export function TestnetBanner() {
  return (
    <div role="note" aria-label="Testnet disclaimer" className="bg-ink text-ivory">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-8">
        <span className="tag border-lime text-lime">
          <span aria-hidden className="size-1.5 bg-lime" />
          Testnet
        </span>
        <p className="mono text-[11px] leading-relaxed tracking-wide text-ivory/85">
          Base Sepolia deployment for testing and demonstration. FORGE and stFORGE have no intended monetary value.
          Smart contracts have not undergone an independent security audit.{" "}
          <strong className="font-semibold text-ivory">Do not deposit assets of value.</strong>
        </p>
      </div>
    </div>
  );
}
