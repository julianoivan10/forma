# Testnet

> **Status: not yet deployed to Base Sepolia.** Everything below the
> "Deployment record" heading is to be filled from `deployments/base-sepolia.json`
> after the first deployment. Local Anvil deployments are fully working and
> covered by end-to-end tests.

Forma is a **Base Sepolia (chain id 84532) testnet** protocol. FORGE and
stFORGE have no intended monetary value. Contracts are not audited. Do not
deposit assets of value.

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

- Rates are extreme and volatile because the stream is large and total stake
  is small (see [ECONOMICS.md](ECONOMICS.md)).
- Public RPCs limit `eth_getLogs` ranges, so indexed activity only covers
  recent blocks (≈ 2 days by default, extendable in the UI).
- The faucet is sybil-able by design (it is a test token); caps bound supply.
- Reward streams are re-funded manually by the reward manager.

## Deployment record

| Item | Value |
| --- | --- |
| Deployed at | _pending_ |
| Version | 0.1.0 |
| ForgeToken | _pending_ |
| PositionNFT | _pending_ |
| FormaStaking | _pending_ |
| PositionRenderer | _pending_ |
| LiquidStakingVault | _pending_ |
| Admin | _pending_ |
| Pool manager | _pending_ |
| Reward manager | _pending_ |
| Pauser | _pending_ |
| Sources verified on Basescan | _pending_ |

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
