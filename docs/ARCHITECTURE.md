# Architecture

Forma is a pnpm monorepo with a strict one-way dependency flow:

```
packages/contracts ──(forge build)──▶ out/*.json ─┐
deployments/*.json ◀──(Deploy.s.sol)              │  scripts/export-abis.mjs
        │                                         ▼
        └──────────────────────────▶ packages/config/src/generated/deployments.ts
                                     packages/sdk/src/generated/abis.ts
                                                  │
                                                  ▼
                                            apps/web (Next.js)
```

ABIs and addresses exist in exactly one generated place each. Components never
declare ABIs or addresses.

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/contracts` | Foundry project: `src/` (5 contracts + interfaces + `RewardMath`), `test/` (unit, fuzz, invariant, integration), `script/Deploy.s.sol` |
| `packages/config` | Chains, network labels, explorer URLs, mainnet deny-list, public-env Zod schema, generated deployment manifests |
| `packages/sdk` | Generated ABIs, ABI-derived types, formatting, rate conversion (APR → APY), position phase logic, milestones, error decoding, the glyph model |
| `apps/web` | Next.js 16 App Router frontend |
| `deployments/` | Deployment manifests written by the deploy script (`anvil.json`, later `base-sepolia.json`) |
| `scripts/` | `export-abis.mjs` (codegen), `deploy.mjs` (network allow-list + manifest post-processing) |
| `docs/` | Protocol spec and supporting documents |

A `packages/ui` package was **not** created: only one app consumes the
components, and a shared package would add build plumbing without a second
consumer. Shared, framework-free logic (formatting, the glyph model) lives in
`@forma/sdk` so it stays testable.

## Contracts

See [PROTOCOL.md](PROTOCOL.md) for semantics. Deployment order and wiring:

```
ForgeToken(admin)
PositionNFT(staking = predicted address, admin)   ← address of the next CREATE
FormaStaking(token, nft, admin, compoundConfig)   ← constructor asserts nft.staking() == this
PositionRenderer(staking)  → nft.setRenderer(renderer)
LiquidStakingVault(token, staking, poolId = 0, admin)
```

| Contract | Runtime size | Notes |
| --- | --- | --- |
| FormaStaking | ~19.0 KB | all funds and accounting |
| LiquidStakingVault | ~11.0 KB | ERC-4626, internal accounting |
| PositionRenderer | ~7.9 KB | on-chain SVG + JSON |
| PositionNFT | ~5.9 KB | per-owner index |
| ForgeToken | ~5.1 KB | faucet + cap + chain guard |

Compiler: solc 0.8.28, `via_ir`, optimizer 200 runs, EVM `cancun`.
Dependencies: OpenZeppelin Contracts 5.6.1, forge-std 1.16.2 (both via pnpm,
no git submodules).

## Frontend

**Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind
CSS 4, wagmi 2 + viem 2, TanStack Query 5, RainbowKit 2, Zod 4.

**Wallet choice.** RainbowKit + WalletConnect was chosen over Privy: Forma
needs plain EOA wallets on Base Sepolia, not embedded wallets or social login,
and RainbowKit keeps wallet connection entirely separate from protocol logic.
RainbowKit 2 requires wagmi 2, so the app uses wagmi 2.19 rather than wagmi 3.
Without `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` only browser-injected wallets are
offered (and the settings page says so).

**Dependency pin.** RainbowKit pulls `@base-org/account`, which depends on
`@coinbase/cdp-sdk@^1`. Versions ≥ 1.53 statically import optional `@x402/*`
payment packages that Turbopack cannot resolve. The root `package.json` pins
`@coinbase/cdp-sdk` to `1.52.0` via `pnpm.overrides`. Forma never uses x402.

### Data layer

| Module | Role |
| --- | --- |
| `lib/env.ts` | Parses `NEXT_PUBLIC_*` with the shared Zod schema. Production builds reject Anvil. |
| `lib/wagmi.ts` | Chains = Base Sepolia (+ Anvil in development). JSON-RPC batching. |
| `lib/forma.ts` | `useForma()` — the single answer to "which chain are we reading, which contracts, can the user transact?" States: `disconnected`, `mainnet`, `wrong-network`, `not-deployed`, `ready`. |
| `lib/reads.ts` | Typed contract reads (`useProtocol`, `useMyPositions`, `usePosition`, `useForgeAccount`, `useVault`, previews). Always the generated ABI, never a fallback value. |
| `lib/tx.tsx` | Transaction state machine + session log (see below). |
| `lib/write.ts` | `useFormaTx().send(target, fn, args, meta)` — function name and args are checked against the ABI at compile time. |
| `lib/logs.ts` | Indexed activity via `eth_getLogs`, chunked, bounded, always labelled as indexed. |
| `lib/time.ts` | `useNow()` in **chain time** (latest block timestamp + elapsed local seconds). |

**On-chain state is authoritative.** Every balance, position, rate and
preview is a contract read. "What do I own?" uses `FormaStaking.positionsOf`,
which walks the NFT's on-chain owner index — no indexer. Event logs are used
only for history (activity page, faucet history, a position's creation tx,
keeper candidates) and every such view says it is indexed and bounded. Keeper
candidates discovered from logs are re-verified against current state.

**Eligibility is decided on-chain.** For example the withdraw control uses
`PositionView.locked` computed by the contract; the UI clock is only used for
countdowns, and that clock is anchored to block time (end-to-end testing caught
a bug where a wall-clock comparison disagreed with the chain).

### Transaction lifecycle

```
Preparing ──▶ Wallet confirmation ──▶ Submitted ──▶ Confirming ──▶ Confirmed
    │                 │                                   │
    └──── Failed ◀────┴───────────────────────────────────┘ (revert / rejection / RPC)
```

1. `simulateContract` first — predictable reverts are explained before the
   wallet opens (custom errors decoded by `describeError`).
2. `writeContract` → hash.
3. `waitForTransactionReceipt`; **success is only shown for a mined receipt
   with `status: "success"`**. A reverted receipt is a failure with its block.
4. All queries are invalidated after confirmation.

Duplicate submissions are blocked per action key (`claim:184`,
`stake`, …) synchronously, before any await. Each status shows the tx hash,
explorer link (or "local" on Anvil), contract, amount and block.

### Wallet and network guards

- `MainnetAlert` (global): a red bar whenever the wallet is on a known mainnet
  chain id; no transaction is ever built for it.
- `ActionGate` wraps every write control and renders the missing step instead:
  connect, switch network (with rejection handling and manual fallback
  instructions), or "not deployed on this network".
- Errors: `describeError` maps wallet rejection (4001), missing gas, chain
  mismatch, RPC failure and **every protocol custom error** to a specific
  message. There is no generic "Something went wrong".

## Visual system

Bright DeFi laboratory × editorial financial interface.

| Token | Value | Meaning |
| --- | --- | --- |
| ivory `#F3EFE4` / paper `#F9F7F0` | surfaces | faint 32 px notebook grid |
| ink `#0E1A2B` | text, rules, buttons | |
| lime `#B8F229` (text-safe `#3B6200`) | active / positive growth | |
| orange `#FF5F1F` (text-safe `#A83600`) | locked / commitment | |
| sky `#2E9BFF`, violet `#6C4CFF` | lock tiers | |
| danger `#C8102E` | failure / irreversible | never decorative |

Type: Archivo (variable width, set expanded for display numerals), Instrument
Sans (UI), IBM Plex Mono (labels, addresses, amounts, hashes). Layout: hairline
rules, numbered section labels, oversized numerals, dense tables, square
buttons, no cards-for-everything, no gradients, no glassmorphism. Numerals use
`FitNumeral`, which scales to its container by character count and never wraps
mid-number. Motion: one arc-draw and a subtle rise, both disabled under
`prefers-reduced-motion`.

### Position glyph

Implemented twice with identical formulas: `PositionRenderer.sol` (on-chain
SVG in `tokenURI`) and `@forma/sdk/glyph.ts` + `PositionGlyph.tsx`.

| Visual channel | Data | Formula |
| --- | --- | --- |
| Tick count | principal tier | tier (1–6, decades of whole FORGE from < 100 to ≥ 1M) × 8 |
| Arc sweep | lock progress | `(now − start) × 1000 / lock`, full ring if unlocked or no lock |
| Arc weight | active multiplier | `6 + (activeBps − 10000) × 12 / 40000` |
| Hue | lock tier | none → lime · ≤ 30 d → sky · ≤ 90 d → orange · > 90 d → violet |
| Rotation | identity | `id × 137 mod 360` |

## Testing layers

| Layer | Tool | Location |
| --- | --- | --- |
| Contract unit / fuzz / invariant / deployment | Foundry | `packages/contracts/test` |
| Static analysis | Slither | `packages/contracts/slither.config.json` |
| SDK logic | Vitest | `packages/sdk/test` |
| Components | Vitest + Testing Library | `apps/web/test` |
| End-to-end (real local chain) | Playwright + Anvil | `apps/web/e2e` |

The e2e wallet is an injected EIP-1193 provider that forwards to Anvil with a
fresh impersonated account per run. Transactions are really signed by Anvil
and mined; the app contains no test-only code paths.
