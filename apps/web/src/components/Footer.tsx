import Link from "next/link";

export function Footer() {
  return (
    <footer className="rule-t mt-24">
      <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-10 sm:px-8 md:grid-cols-[2fr_1fr_1fr]">
        <div className="max-w-md space-y-3">
          <p className="display text-2xl">FORMA</p>
          <p className="text-sm text-ink-2">
            Programmable staking positions. A testnet portfolio protocol on Base Sepolia. Not audited. Test tokens
            only. Figures labelled as estimates are derived from current on-chain state and are not returns.
          </p>
        </div>
        <div>
          <p className="label mb-3">Protocol</p>
          <ul className="space-y-2 text-sm">
            <li><Link className="hover:underline" href="/docs">How it works</Link></li>
            <li><Link className="hover:underline" href="/docs#risks">Risks &amp; limitations</Link></li>
            <li><Link className="hover:underline" href="/docs#contracts">Contracts</Link></li>
          </ul>
        </div>
        <div>
          <p className="label mb-3">Testnet</p>
          <ul className="space-y-2 text-sm">
            <li><Link className="hover:underline" href="/settings#faucet">FORGE faucet</Link></li>
            <li><Link className="hover:underline" href="/activity">On-chain activity</Link></li>
            <li><Link className="hover:underline" href="/settings">Network &amp; wallet</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
