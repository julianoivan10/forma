# Forma — project overview

**Programmable staking positions.** A testnet staking protocol in which a stake
is an on-chain object: an NFT-represented position with its own lock,
multiplier, reward stream and routing policy, plus an ERC-4626 liquid staking
vault. Built with Solidity/Foundry and Next.js on Base Sepolia.

Status: contracts, tests and frontend complete and working on a local chain;
Base Sepolia deployment and real-wallet testing pending. **Not audited.**

## Problem

Most staking contracts reduce a stake to a balance in a mapping. That makes
locked stake illiquid and opaque (you cannot hold, transfer or inspect "my
90-day stake" as a thing), reward handling one-size-fits-all (claim or
nothing), and staking UIs that show made-up APYs rather than protocol state.

## Solution

- **Positions, not balances.** Each stake mints an ERC-721 whose token *is*
  the position. Terms are snapshotted at stake time and cannot silently change.
- **Lock tiers sharing one stream.** Rewards are split by
  `principal × multiplier`, so locking longer earns more per token; the boost
  ends at unlock.
- **Programmable rewards.** Keep, auto-compound through permissionless keepers
  (with an owner-capped fee), or redirect to another wallet.
- **Liquid alternative.** stFORGE: an ERC-4626 vault that stays staked and
  compounds.
- **Honest interface.** Every number is read from chain; estimates say what
  they assume; transactions show five real stages and never claim success
  before a mined receipt.

## Architecture

Five non-upgradeable contracts — `FormaStaking` (all funds and accounting),
`PositionNFT`, `PositionRenderer` (on-chain SVG metadata),
`LiquidStakingVault`, `ForgeToken` (test token + faucet) — a TypeScript SDK
generated from the ABIs, and a Next.js 16 app. See
[ARCHITECTURE.md](ARCHITECTURE.md) and [PROTOCOL.md](PROTOCOL.md).

## Why staking positions are NFTs

The position needs an identity that can be owned, transferred, inspected and
rendered. ERC-721 gives that for free with wallet and marketplace support.
The key design decision is *what travels with the token*: lock, multiplier,
penalty and pending rewards do (so a transfer can never bypass a lock); the
reward-routing policy does not (so a buyer never inherits a redirect to the
seller's wallet). Routing records who configured it and silently reverts to
"keep" for any new owner — no transfer hook needed.

## Why ERC-4626

It is the standard interface for tokenised vaults, so stFORGE is legible to any
integrator (`convertToAssets`, `previewDeposit`, `maxRedeem` …). The work is in
using it safely: internal asset accounting so donations cannot move the share
price, a virtual-share decimals offset, a minimum first deposit, zero-share and
zero-asset reverts, `max*` functions that reflect protocol pauses, and
slippage-protected entry points. Inflation/donation attacks have dedicated
tests.

## How rewards work

Accumulator-per-weight accounting with one global stream:
`acc += emitted × 1e30 / totalWeight`; each position earns
`weight × Δacc / 1e30`. Positions settle before any weight change. Principal
and reward reserve are separate buckets; emissions during zero-stake periods,
forfeited rewards and penalties are recycled into the next stream. All
rounding favours the protocol. Solvency relations are enforced as invariants.

## Security model

No proxies; one fund-holding contract; `nonReentrant` + strict
checks-effects-interactions everywhere; role separation (admin / pool manager /
reward manager / pauser) with no power over principal; emergency withdrawal
that no pause can block; snapshotted terms plus reviewed-terms checks on
`stake`; a triple mainnet guard. See [SECURITY.md](SECURITY.md).

## Testing methodology

- 193 Foundry tests: 160 unit, 13 fuzz (1,000 runs each), 14 invariants
  (256 runs × depth 200) driven by a handler exercising every user, keeper,
  vault and admin path with exact ghost accounting, and 6 tests that run the
  real deployment script.
- ~97–100 % line coverage of protocol contracts; Slither reviewed, findings
  triaged or fixed.
- 14 SDK tests and 10 component tests (Vitest).
- 29 Playwright tests, including a two-wallet flow against a local chain with
  real mined transactions (faucet, stake, rejected signature, claim, compound,
  withdraw, emergency exit with penalty, vault deposit and redeem), each
  verified with independent on-chain reads, plus console-error, mobile-overflow,
  keyboard and reduced-motion checks. End-to-end testing found and fixed three
  real bugs (a clock-dependent lock state, a lost confirmation after closing a
  position, a missing accessible label).

## Testnet deployment

Pending. The deployment pipeline (allow-listed networks, keystore signing,
Basescan verification, manifest with tx hashes, role hand-over) is built and
tested locally. See [DEPLOYMENT.md](DEPLOYMENT.md) and [TESTNET.md](TESTNET.md).

## Known limitations

Not audited; lazy boost expiry; front-runnable pending rewards on NFT sale;
manual reward re-funding; log-based history limited by RPC ranges; testnet APRs
are meaningless as returns. Full list in [PROTOCOL.md §17](PROTOCOL.md#17-known-limitations).

## Future improvements

- SPLIT routing (percentage-based reward distribution).
- An indexer (e.g. Ponder) for complete history, clearly separated from
  on-chain state.
- Boost decay curves instead of a step at unlock.
- Keeper bot reference implementation.
- A professional audit before any value-bearing deployment.
