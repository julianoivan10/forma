/**
 * Full testnet disclosure. Shown on Settings and Docs; the navbar carries the persistent
 * "BASE SEPOLIA · TESTNET" status on every page.
 */
export function TestnetDisclosure({ id }: { id?: string }) {
  return (
    <section id={id} role="note" aria-label="Testnet disclaimer" className="scroll-mt-6 border border-ink bg-paper">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink bg-ink px-4 py-2 text-ivory">
        <span className="tag border-lime text-lime">
          <span aria-hidden className="size-1.5 bg-lime" />
          Testnet
        </span>
        <span className="mono text-[11px] tracking-[0.14em] uppercase">Disclosure</span>
      </div>
      <div className="space-y-2 px-4 py-4 text-sm leading-relaxed">
        <p>
          This protocol is deployed on <strong>Base Sepolia</strong> for testing and demonstration. FORGE and stFORGE
          have <strong>no intended monetary value</strong>.
        </p>
        <p>
          The smart contracts have <strong>not undergone an independent security audit</strong>. Estimated rates are
          derived from current testnet state and are not returns.
        </p>
        <p className="mono text-xs font-semibold tracking-[0.12em] uppercase">Do not deposit assets of value.</p>
      </div>
    </section>
  );
}
