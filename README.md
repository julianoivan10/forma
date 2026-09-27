# Forma

**Programmable staking positions.** Stake → Position → Earn → Customize → Compound → Use.

Forma turns a stake into an on-chain position: an ERC-721 carrying its own
lock, multiplier, reward stream and routing policy, alongside an ERC-4626
liquid staking vault (stFORGE).

> **Testnet only (Base Sepolia, chain id 84532). Not audited.** FORGE and
> stFORGE have no intended monetary value. Do not deposit assets of value.

| | |
| --- | --- |
| Contracts | `FormaStaking`, `PositionNFT`, `PositionRenderer`, `LiquidStakingVault`, `ForgeToken` — Solidity 0.8.28, Foundry, OpenZeppelin 5.6, non-upgradeable |
| Frontend | Next.js 16, React 19, wagmi 2 / viem 2, RainbowKit, TanStack Query, Tailwind 4 |
| Tests | 193 Foundry (unit, fuzz, invariant, deployment) · 18 SDK · 19 component · 35 Playwright e2e on a real local chain |
| Status | Contracts **deployed and verified on Base Sepolia** ([addresses](docs/TESTNET.md#deployment-record)). Real-wallet testnet run and public frontend: **pending** |

## Quick start (local)

Requirements: Node ≥ 22, pnpm 10, [Foundry](https://getfoundry.sh).

```bash
pnpm install
pnpm build:contracts                 # forge build
pnpm test:contracts                  # 193 tests
pnpm anvil                           # terminal 1: local chain
pnpm deploy:local                    # terminal 2: deploy + regenerate ABIs/manifests
cp apps/web/.env.example apps/web/.env.local
pnpm dev                             # http://localhost:3000
```

Connect a browser wallet to Anvil (chain 31337, RPC `http://127.0.0.1:8545`),
import an Anvil dev account, and use the faucet on the Settings page.

## Commands

| Command | Does |
| --- | --- |
| `pnpm build:contracts` / `pnpm test:contracts` | Foundry build / full test suite |
| `pnpm --filter @forma/contracts test:invariant` | invariant campaign only (`FOUNDRY_PROFILE=deep` for a longer one) |
| `pnpm --filter @forma/contracts coverage` | coverage summary |
| `pnpm --filter @forma/contracts slither` | static analysis |
| `pnpm abis` | regenerate SDK ABIs and deployment manifests |
| `pnpm --filter @forma/sdk test` | SDK unit tests |
| `pnpm test:web` | component tests |
| `pnpm e2e` | Playwright against Anvil + a production build (`pnpm --filter @forma/web build` first) |
| `pnpm typecheck` / `pnpm lint` | TypeScript / ESLint |
| `pnpm deploy:local` / `pnpm deploy:base-sepolia` | guarded deployments (mainnet is refused) |

## Repository

```
apps/web            Next.js app
packages/contracts  Foundry project (src, test, script)
packages/config     chains, env schema, generated deployment manifests
packages/sdk        generated ABIs, types, formatting, rates, glyph model, error decoding
deployments/        deployment manifests
scripts/            ABI export, guarded deploy wrapper
docs/               protocol spec and project documents
```

## Documentation

- [PROTOCOL.md](docs/PROTOCOL.md) — normative protocol specification
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — system, frontend and visual architecture
- [SECURITY.md](docs/SECURITY.md) — threat model, tests, invariants, Slither triage, known risks
- [ECONOMICS.md](docs/ECONOMICS.md) — testnet parameters and what the rates mean
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — deploying contracts and frontend
- [TESTNET.md](docs/TESTNET.md) — using the testnet, deployment record, real-wallet checklist
- [project-overview.md](docs/project-overview.md) — portfolio summary
