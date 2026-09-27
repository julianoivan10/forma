# Testnet

> **Status (2026-09-27):** contracts **deployed and source-verified on Base
> Sepolia**; configuration and roles checked on-chain. The real-wallet
> acceptance run on Base Sepolia and the public frontend deployment are
> **still pending** (see the checklist below). Local Anvil flows are fully
> covered by end-to-end tests.

Forma is a **Base Sepolia (chain id 84532) testnet** protocol. FORGE and
stFORGE have no intended monetary value. Contracts are not audited. Do not
deposit assets of value.

## Deployment record

Canonical source: [`deployments/base-sepolia.json`](../deployments/base-sepolia.json)
(consumed by the app through `packages/config/src/generated/deployments.ts`).
Raw Foundry broadcast: `packages/contracts/broadcast/Deploy.s.sol/84532/`.

| Item | Value |
| --- | --- |
| Network | Base Sepolia · chain id **84532** |
| Version | 0.1.0 |
| Deployed | 2026-09-27 04:18 UTC · 24 transactions in blocks 47357225 – 47357248, all mined successfully |
| Deployer | [`0x23D4Fe2e9AF46Dd89a21FDa53551c7E55E222660`](https://sepolia.basescan.org/address/0x23D4Fe2e9AF46Dd89a21FDa53551c7E55E222660) |
| Compiler | solc 0.8.28 · optimizer 200 runs · EVM cancun |

| Contract | Address | Deployment tx | Source |
| --- | --- | --- | --- |
| ForgeToken | [`0x2C60E2597f13A6a907B0ee7B0651888C455a0489`](https://sepolia.basescan.org/address/0x2C60E2597f13A6a907B0ee7B0651888C455a0489#code) | [`0xf5b89d33…e103c3`](https://sepolia.basescan.org/tx/0xf5b89d332bc0ab078cb94c791f6c603c9583845e961d29f5fb966c28ebe103c3) | Verified |
| PositionNFT | [`0x135120723F7a50CC8f305a6fAdB42450F5D55421`](https://sepolia.basescan.org/address/0x135120723F7a50CC8f305a6fAdB42450F5D55421#code) | [`0x7bb74109…b0385f`](https://sepolia.basescan.org/tx/0x7bb74109c79e633f491494fdf8222bfa11a3fb79728d3fdc4815695af7b0385f) | Verified |
| FormaStaking | [`0xA7A77a7Ac3a34BeFbC297dB43D676e15Ae3187df`](https://sepolia.basescan.org/address/0xA7A77a7Ac3a34BeFbC297dB43D676e15Ae3187df#code) | [`0x3c534146…d2c58d`](https://sepolia.basescan.org/tx/0x3c5341464cf4b62247c6fbfcd1f9907e5d410e02d17f22d6513351c94cd2c58d) | Verified |
| PositionRenderer | [`0xfFF02e931872FdEE16a4349Ec27319E829A14897`](https://sepolia.basescan.org/address/0xfFF02e931872FdEE16a4349Ec27319E829A14897#code) | [`0xbb03dbe1…1af2de20`](https://sepolia.basescan.org/tx/0xbb03dbe116f2bae279e355c5c4dd1765ecbb952e7a9252f78b37261e1af2de20) | Verified |
| LiquidStakingVault | [`0x88703bCCb6C9757294AD936Afc7813403d791677`](https://sepolia.basescan.org/address/0x88703bCCb6C9757294AD936Afc7813403d791677#code) | [`0xa08f89cb…e508a136`](https://sepolia.basescan.org/tx/0xa08f89cb6a5e29f3792f661c470982286703e62eb623f97fc4542721e508a136) | Verified |

All five deployment transactions were confirmed mined with status success,
receipt contract addresses match the manifest, bytecode is present at every
address, and Basescan reports every source as verified.

### Verified on-chain configuration

- **Wiring:** `FormaStaking.stakingToken` = ForgeToken · `FormaStaking.positionNFT`
  = PositionNFT · `PositionNFT.staking` = FormaStaking · `PositionNFT.renderer` =
  PositionRenderer · `PositionRenderer.staking` = FormaStaking ·
  `LiquidStakingVault.asset` = ForgeToken · `LiquidStakingVault.staking` =
  FormaStaking · vault pool = 0 (Genesis).
- **Pools** (min stake 1 FORGE each; example testnet parameters):

  | Pool | Lock | Multiplier | Early-exit penalty |
  | --- | --- | --- | --- |
  | 0 Genesis | none | 1.00× | — |
  | 1 Builder | 30 days | 1.25× | 5 % |
  | 2 Conviction | 90 days | 1.75× | 10 % |
  | 3 Long Forge | 180 days | 2.50× | 15 % |
  | 4 Calibration | 1 hour | 1.10× | 2 % |

- **Reward stream:** 5,000,000 FORGE funded at deployment, streamed over 90 days
  (≈ 55,555.56 FORGE/day protocol-wide), 2026-09-27 04:19 UTC → 2026-12-26
  04:19 UTC. Emissions while nothing is staked stay in the reserve as idle
  rewards and are re-streamed on the next `notifyRewards`.
- **Keeper compounding:** protocol fee 1 %, cooldown 1 hour, minimum 1 FORGE.
- **Protocol state at verification:** not paused; no positions yet; vault empty.

### Roles

All roles are held by the deployer and **only** the deployer (reconstructed
from every `RoleGranted`/`RoleRevoked` event since deployment and cross-checked
with `hasRole`):

| Contract | Role | Holder |
| --- | --- | --- |
| FormaStaking | `DEFAULT_ADMIN_ROLE`, `POOL_MANAGER_ROLE`, `REWARD_MANAGER_ROLE`, `PAUSER_ROLE` | deployer |
| ForgeToken | `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE` | deployer |
| PositionNFT | `DEFAULT_ADMIN_ROLE` | deployer |
| LiquidStakingVault | `DEFAULT_ADMIN_ROLE` | deployer |

This is the deploy script's intended outcome when all four role addresses are
configured to the deployer (acceptable for a first testnet deployment; see
[SECURITY.md](SECURITY.md)). Before wider use, consider moving roles to
separate wallets or a multisig.

## Using Forma on Base Sepolia

1. Add Base Sepolia to your wallet (chain id 84532, explorer
   `https://sepolia.basescan.org`). The app offers to switch automatically.
2. Get Base Sepolia ETH for gas from a public Base Sepolia faucet.
3. Open **Settings → FORGE faucet** and request 1,000 test FORGE (once per
   24 h per address; 1,000,000 FORGE per UTC day globally).
4. **Stake**: pick a lock tier, enter an amount, confirm the lock terms, approve
   the exact amount, stake. Your position NFT appears under **Positions**.
5. Use **Calibration** (1 h lock) to see a full lock → unlock → boost expiry →
   withdraw cycle in an hour.

## Testnet limitations

- With little FORGE staked, a new stake would receive most of the emission, so
  the app shows APR as "Not meaningful yet" instead of an extreme figure (see
  [ECONOMICS.md](ECONOMICS.md)).
- Public RPCs limit `eth_getLogs` ranges (some provider free tiers allow only
  10 blocks per request), so indexed activity only covers recent blocks and may
  be incomplete. On-chain state reads are unaffected.
- The faucet is sybil-able by design (it is a test token); caps bound supply.
- Reward streams are re-funded manually by the reward manager.

## Real-wallet acceptance checklist (pending)

To be executed on Base Sepolia with **two real wallets** (e.g. MetaMask and
Coinbase Wallet) and verified directly on Basescan (balances and events),
not only in the UI:

| # | Wallet | Action | Verify on-chain | Result |
| --- | --- | --- | --- | --- |
| 1 | A | faucet, approve, stake (Genesis) | `Stake` event, NFT owner = A | ☐ |
| 2 | B | faucet, approve, stake (Calibration) | `Stake` event, NFT owner = B | ☐ |
| 3 | A | claim | `RewardClaimed`, FORGE balance delta | ☐ |
| 4 | A | compound | `Compound`, principal increased | ☐ |
| 5 | B | withdraw after the 1 h unlock | `Unstake(closed=true)`, NFT burned | ☐ |
| 6 | A | emergency withdraw on a separate Conviction position | `EmergencyWithdraw`, 10 % penalty | ☐ |
| 7 | A | liquid deposit | `Deposit`, stFORGE balance | ☐ |
| 8 | A | liquid redeem | `Withdraw`, FORGE returned | ☐ |
| 9 | A | set Redirect routing → B, B claims | `RewardRedirected` to B | ☐ |
| 10 | A/B | network switch, rejected signature, wrong network, insufficient gas | UI shows specific explanations | ☐ |

The same flow (items 1–8 plus a rejected signature) already passes locally
against Anvil with real mined transactions: `pnpm e2e`.
