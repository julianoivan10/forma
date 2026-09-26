import { deployedChainIds, explorerAddressUrl, getDeployment, NETWORK_LABEL, type SupportedChainId } from "@forma/config";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { TestnetDisclosure } from "@/components/TestnetDisclosure";

export const metadata: Metadata = { title: "Protocol documentation" };

const TOC = [
  ["testnet", "Testnet disclosure"],
  ["overview", "Overview"],
  ["pools", "Pools & multipliers"],
  ["rewards", "Reward accounting"],
  ["locks", "Locks & boost expiry"],
  ["emergency", "Emergency withdrawal"],
  ["nft", "Position NFTs"],
  ["routing", "Reward routing"],
  ["compounding", "Compounding & keepers"],
  ["vault", "Liquid staking vault"],
  ["admin", "Roles & pause"],
  ["risks", "Risks & limitations"],
  ["contracts", "Contracts"],
] as const;

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-ink pt-6 pb-12">
      <p className="label">{String(n).padStart(2, "0")}</p>
      <h2 className="display mt-2 text-3xl">{title}</h2>
      <div className="prose-forma mt-5 max-w-[68ch] space-y-4 text-[15px] leading-relaxed text-ink-2 [&_strong]:text-ink">
        {children}
      </div>
    </section>
  );
}

function Formula({ children }: { children: ReactNode }) {
  return <pre className="mono overflow-x-auto border-l-2 border-lime bg-paper px-4 py-3 text-[13px] text-ink">{children}</pre>;
}

export default function DocsPage() {
  const chains = deployedChainIds();
  return (
    <div className="grid gap-10 pt-10 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Documentation" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <p className="label mb-3 text-ink">Contents</p>
        <ol className="mono space-y-1.5 text-xs">
          {TOC.map(([id, t], i) => (
            <li key={id}>
              <a className="hover:underline" href={`#${id}`}>
                <span className="text-ink-3">{String(i).padStart(2, "0")}</span> {t}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <article className="min-w-0">
        <p className="label">Documentation</p>
        <h1 className="display mt-3 mb-4 text-[clamp(2rem,6vw,5rem)]">How Forma works</h1>
        <p className="mb-10 max-w-prose text-ink-2">
          A summary of the protocol specification. The complete, normative version lives in{" "}
          <code className="mono">docs/PROTOCOL.md</code> in the repository, alongside SECURITY, ECONOMICS and DEPLOYMENT.
          Not audited. Testnet only.
        </p>
        <div className="mb-10 max-w-[68ch]">
          <TestnetDisclosure id="testnet" />
        </div>

        <Section id="overview" n={1} title="Overview">
          <p>
            Forma turns a stake into a <strong>position</strong>: an on-chain object with its own terms, its own reward
            stream, its own routing policy and an ERC-721 token representing ownership of all of it. Five contracts:
            <code className="mono"> FormaStaking</code> (all accounting and funds), <code className="mono">PositionNFT</code>,{" "}
            <code className="mono">PositionRenderer</code> (on-chain metadata), <code className="mono">LiquidStakingVault</code>{" "}
            (ERC-4626 stFORGE) and <code className="mono">ForgeToken</code> (test token with a rate-limited faucet).
            None are upgradeable.
          </p>
        </Section>

        <Section id="pools" n={2} title="Pools & multipliers">
          <p>
            A pool is a <strong>lock tier</strong>, not a separate reward stream. Every position in every pool shares one
            stream, split by <strong>weight = principal × multiplier</strong>. If each pool had its own stream, all positions
            inside it would carry the same multiplier and it would cancel out.
          </p>
          <p>
            Terms are <strong>snapshotted</strong> at stake time: unlock time, multiplier and early-exit penalty. A pool
            manager changing a pool later affects only new positions. The stake transaction also carries the lock and
            multiplier you reviewed; if the pool changed in between, it reverts instead of giving you different terms.
          </p>
        </Section>

        <Section id="rewards" n={3} title="Reward accounting">
          <p>Standard accumulator-per-weight accounting with one global stream:</p>
          <Formula>
            {`emitted  = rewardRate × Δt / 1e18            (rewardRate = tokens/s × 1e18)
acc     += emitted × 1e30 / totalWeight
pending  = settled + weight × (acc − checkpoint) / 1e30`}
          </Formula>
          <p>
            Every weight change settles the position first, so nothing is counted twice. All divisions round down in
            the protocol&apos;s favour. The reward reserve is tracked separately from principal; payouts only ever come
            from the reserve. Emissions during periods with no stakers, forfeited rewards and penalties become{" "}
            <strong>idle</strong> and are re-streamed at the next funding.
          </p>
          <p>
            <strong>Rates you see:</strong> emission rate (protocol-wide tokens per second); your reward rate (your
            weight share of it); estimated APR (on-chain <code className="mono">previewStake</code>, annualised while
            boosted); estimated APY (APR compounded daily, computed in the app). All assume today&apos;s emission and total
            weight persist, which they will not. They are testnet estimates, not returns.
          </p>
        </Section>

        <Section id="locks" n={4} title="Locks & boost expiry">
          <p>
            Withdrawal requires the unlock time to have passed. A multiplier rewards <strong>being locked</strong>, so at
            unlock the boost expires: the next time the position is touched (claim, compound, withdraw, top-up), or when
            anyone calls the permissionless <code className="mono">expireBoost</code>, its weight drops to 1.00×. Until
            then it keeps its boosted weight. This lazy expiry is a documented limitation.
          </p>
        </Section>

        <Section id="emergency" n={5} title="Emergency withdrawal">
          <p>
            Always available, including while paused. It returns principal minus an early-exit penalty (snapshotted,
            only while locked, waived while the protocol is paused), <strong>forfeits all pending rewards</strong>, burns
            the NFT and cannot be undone. Penalties and forfeited rewards go back to the reward reserve for remaining
            stakers; no admin ever receives them. The app shows the exact on-chain preview before you confirm.
          </p>
        </Section>

        <Section id="nft" n={6} title="Position NFTs">
          <p>
            Every position mints an ERC-721 with <code className="mono">tokenId = positionId</code>. Positions are{" "}
            <strong>transferable, with rights attached to the token</strong>: the lock, multiplier and pending rewards stay
            on the position, so transferring can never bypass a lock. Pending rewards travel with the NFT (a seller can
            claim first — price accordingly). Metadata and the SVG image are generated on-chain from position state.
          </p>
        </Section>

        <Section id="routing" n={7} title="Reward routing">
          <p>
            <strong>Keep</strong>: claims pay the owner. <strong>Compound</strong>: anyone may compound for a capped keeper
            fee. <strong>Redirect</strong>: claims pay a chosen wallet, which may also trigger them. Only the owner can
            configure routing. Routing records who set it; if the NFT changes hands, the new owner does not inherit it —
            effective routing falls back to Keep.
          </p>
        </Section>

        <Section id="compounding" n={8} title="Compounding & keepers">
          <p>
            Compounding moves pending rewards into principal at the active multiplier; it never extends a lock, and
            compounded tokens stay locked until unlock. Owners compound for free. Third parties can compound only
            positions that opted in, and receive min(protocol fee, owner&apos;s cap) — the protocol fee is capped at 5% and
            your cap is snapshotted, so later fee changes cannot charge you more. A minimum amount and per-position
            cooldown bound griefing.
          </p>
        </Section>

        <Section id="vault" n={9} title="Liquid staking vault (stFORGE)">
          <p>
            An ERC-4626 vault that holds one no-lock Forma position and compounds it. <code className="mono">totalAssets</code>{" "}
            = idle + position principal + pending rewards, from internal accounting — tokens donated directly to the
            vault are ignored, so donation/inflation attacks cannot move the share price. Shares use a virtual decimals
            offset of 6 (stFORGE has 24 decimals), the first deposit must meet the pool minimum, zero-share deposits and
            zero-asset redemptions revert, and slippage-protected entry points are used by this app.
          </p>
          <p>
            If FormaStaking is paused, the vault cannot move funds. Its admin can trigger an emergency exit during a
            pause; after three days of pause anyone can. An exit forfeits the vault&apos;s pending rewards and makes redemptions
            pay pro-rata from idle FORGE. <strong>stFORGE is not risk-free.</strong>
          </p>
        </Section>

        <Section id="admin" n={10} title="Roles & pause">
          <p>
            Separate roles: admin (roles, unpause, recover foreign tokens, set NFT renderer), pool manager (pool terms
            for new positions), reward manager (fund/re-time the stream, keeper fee within bounds), pauser (pause only).
            No role can move user principal or withdraw the reward reserve. Pausing disables staking, withdrawals, claims,
            compounding and funding; emergency withdrawal, routing changes, boost expiry and NFT transfers stay available.
            A pause can cost pending rewards (if you emergency-exit) but can never trap principal.
          </p>
        </Section>

        <Section id="risks" n={11} title="Risks & limitations">
          <ul className="list-disc space-y-2 pl-5">
            <li>Not audited. Automated tests, fuzzing, invariants and static analysis are not an audit.</li>
            <li>Testnet only. FORGE and stFORGE have no intended monetary value. Do not deposit assets of value.</li>
            <li>Boosts persist after unlock until the position is touched or kicked.</li>
            <li>Pending rewards on a transferred NFT can be claimed by the seller before transfer.</li>
            <li>Funding a new stream resets its schedule; annualised figures assume nothing changes.</li>
            <li>Indexed activity comes from RPC logs over a bounded range and can be incomplete.</li>
            <li>Vault holders share one position; an emergency exit forfeits the vault&apos;s pending rewards for everyone.</li>
          </ul>
        </Section>

        <Section id="contracts" n={12} title="Contracts">
          <div id="deployment" className="scroll-mt-6" />
          {chains.length === 0 ? (
            <p>No deployment manifests are bundled with this build.</p>
          ) : (
            chains.map((chainId) => {
              const d = getDeployment(chainId)!;
              return (
                <div key={chainId} className="not-prose">
                  <p className="label mb-2 text-ink">
                    {NETWORK_LABEL[chainId as SupportedChainId] ?? chainId} · v{d.version}
                  </p>
                  <table className="data-table">
                    <tbody>
                      {Object.entries(d.contracts).map(([name, addr]) => {
                        const url = explorerAddressUrl(chainId, addr);
                        return (
                          <tr key={name}>
                            <td className="mono text-xs">{name}</td>
                            <td className="mono text-right text-xs break-all">
                              {url ? (
                                <a href={url} target="_blank" rel="noreferrer" className="underline">
                                  {addr} ↗
                                </a>
                              ) : (
                                addr
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
          <p>
            {chains.includes(84532)
              ? "Base Sepolia sources are verified on Basescan."
              : "Base Sepolia deployment: pending. The app shows no placeholder addresses until a real deployment manifest exists."}{" "}
            <Link href="/settings#contracts" className="underline">
              Live contract view →
            </Link>
          </p>
        </Section>
      </article>
    </div>
  );
}
