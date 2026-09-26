# Deployment

Forma deploys to exactly two networks:

| Network | Chain id | Command |
| --- | --- | --- |
| Local Anvil | 31337 | `pnpm deploy:local` |
| Base Sepolia | 84532 | `pnpm deploy:base-sepolia` |

**There is no mainnet path.** Three independent guards:

1. `scripts/deploy.mjs` only knows `anvil` and `base-sepolia`, and aborts if the
   RPC's live chain id differs from the chosen network.
2. `script/Deploy.s.sol` reverts with `UnsupportedChain` on any other chain id.
3. `ForgeToken`'s constructor reverts outside 31337/84532.

Adding mainnet would require deliberate changes to all three plus a review.

## Prerequisites

- Node ≥ 22, pnpm 10, Foundry (forge/cast/anvil ≥ 1.5).
- `pnpm install`
- For Base Sepolia:
  - a deployer account imported into Foundry's **encrypted keystore**
    (`cast wallet import forma-deployer --interactive`). Raw private keys in
    environment variables are refused by the wrapper.
  - Base Sepolia ETH for the deployer (≈ 0.03 ETH covers the ~24 transactions).
  - an RPC URL and an Etherscan V2 API key (works for Basescan verification).
  - addresses for each role (ideally distinct wallets/multisigs).

## Environment

Copy `.env.example` to `.env` (never committed):

```
BASE_SEPOLIA_RPC_URL=...
ETHERSCAN_API_KEY=...
DEPLOYER_ACCOUNT=forma-deployer
ADMIN_ADDRESS=0x...
POOL_MANAGER_ADDRESS=0x...
REWARD_MANAGER_ADDRESS=0x...
PAUSER_ADDRESS=0x...
# optional
INITIAL_REWARDS=5000000000000000000000000
REWARD_DURATION=7776000
```

On Base Sepolia all four role addresses are mandatory; the script will not
silently give the deployer every role.

## What the script does

1. Deploy `ForgeToken`, `PositionNFT` (bound to the predicted `FormaStaking`
   address), `FormaStaking` (asserts the binding), `PositionRenderer`, and wire
   the renderer.
2. Create the five pools (Genesis, Builder, Conviction, Long Forge, Calibration).
3. Deploy `LiquidStakingVault` on pool 0.
4. Mint `INITIAL_REWARDS` test FORGE and start the reward stream.
5. Grant roles to the configured addresses and **renounce every role the
   deployer was not configured to keep**.
6. Write `deployments/<network>.json`; the wrapper then adds deployment tx
   hashes and the start block from Foundry's broadcast log, and regenerates the
   TypeScript manifests/ABIs (`pnpm abis`).

Transactions are sent with `--slow` (one at a time, each waiting for its
receipt) for reliability.

## Verification

`pnpm deploy:base-sepolia` passes `--verify` to Forge, verifying all sources on
Basescan through the Etherscan V2 API. If verification is interrupted, re-run:

```
cd packages/contracts
forge verify-contract <address> src/FormaStaking.sol:FormaStaking --chain 84532 --watch
```

(constructor args are available in `broadcast/Deploy.s.sol/84532/run-latest.json`).

## After deploying

1. Commit `deployments/base-sepolia.json` and the regenerated
   `packages/config/src/generated/deployments.ts` (addresses are public).
2. Record role addresses in [TESTNET.md](TESTNET.md).
3. Deploy the frontend.

## Frontend (Vercel)

- Root directory: repository root; build command `pnpm build`; output
  `apps/web/.next` (or set the project root to `apps/web` with the workspace
  install).
- Environment variables — **public values only**:

| Variable | Production value |
| --- | --- |
| `NEXT_PUBLIC_APP_ENV` | `production` (or `testnet` for previews) |
| `NEXT_PUBLIC_ENABLE_ANVIL` | `false` (a production build with Anvil enabled fails validation) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | your WalletConnect Cloud id |
| `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | a public/rate-limited RPC (it is visible to browsers) |

**Never put a deployer key, mnemonic, Etherscan key or private RPC credential
in Vercel.** The frontend needs none of them.

## Local development

```
pnpm anvil                 # terminal 1
pnpm deploy:local          # deterministic addresses on a fresh Anvil
cp apps/web/.env.example apps/web/.env.local   # ENABLE_ANVIL=true
pnpm dev
```

On a fresh Anvil the addresses are deterministic, so the committed
`deployments/anvil.json` stays valid; restart Anvil before re-deploying.
