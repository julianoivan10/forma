# Economics (testnet)

> Everything here describes **testnet parameters with test tokens that have no
> monetary value**. Nothing in this document is a promise or an estimate of
> real returns.

## Token

`FORGE` — 18 decimals, hard cap 1,000,000,000. No premine. Supply comes from:

- the faucet: 1,000 FORGE per address per 24 h, at most 1,000,000 FORGE per UTC day overall;
- `MINTER_ROLE` (reward manager) for funding reward streams, within the cap.

## Reward stream

One protocol-wide stream. The reward manager calls
`notifyRewards(amount, duration)`; the contract re-streams **everything in the
reserve that is not already owed** (new funds + leftover + idle) evenly over
`duration` (1–365 days).

Default deployment: **5,000,000 FORGE over 90 days ≈ 55,555 FORGE/day**.

Rewards are split by weight:

```
weight(position)  = principal × multiplier (while locked; 1.00× after unlock)
your share / sec  = emission / sec × weight / totalWeight
```

## Pools (lock tiers)

| Pool | Lock | Multiplier | Early-exit penalty |
| --- | --- | --- | --- |
| Genesis | none | 1.00× | — |
| Builder | 30 days | 1.25× | 5 % |
| Conviction | 90 days | 1.75× | 10 % |
| Long Forge | 180 days | 2.50× | 15 % |
| Calibration *(testnet only)* | 1 hour | 1.10× | 2 % |

Bounds enforced on-chain: lock ≤ 730 days; 1.00× ≤ multiplier ≤ 5.00×;
penalty ≤ 25 %; a pool without a lock must be 1.00× with no penalty.

The multiplier is paid for **being locked**. At unlock the boost expires
(lazily: on the next touch or a permissionless kick). Compounding while locked
adds to locked principal at the boosted weight; it never extends the lock.

## Rates shown in the app

| Figure | Definition | Where computed |
| --- | --- | --- |
| Emission rate | protocol FORGE per second / day | on-chain `rewardState` |
| Reward rate | emission × position weight ÷ total weight | on-chain `getPositionView` / `previewStake` |
| Estimated APR | reward rate × 365 days ÷ principal; for previews includes the new stake's own dilution | on-chain `previewStake` |
| Estimated APY | `(1 + APR/365)^365 − 1` | app, from the on-chain APR |

**Assumptions** (stated next to every figure): today's emission rate and total
weight stay constant for a year, the boost stays active, and rewards are
compounded daily for APY. None of these hold in practice: the stream has an end
date (shown), other stakers enter and leave, and boosts expire.

**Why testnet APRs look absurd.** With 55K FORGE/day and little FORGE staked,
a new stake receives a huge share of emission — e.g. with nothing staked, a
1,000 FORGE stake would receive the whole stream, an APR in the millions of
percent. That is correct arithmetic on test parameters, and meaningless as a
return, so the app does not show it: whenever the previewed stake would be more
than 10 % of total weight, or the on-chain APR exceeds 1,000 %, the rate reads
**"Not meaningful yet"** with the note *"Testnet emission estimate is highly
sensitive to current pool liquidity."* (`assessAprEstimate` in `@forma/sdk`; the
on-chain figure itself is never altered). Displayed estimates are always
labelled **EST. APR · TESTNET**.

## Penalties, forfeits and where they go

| Event | Principal | Pending rewards | Destination |
| --- | --- | --- | --- |
| Withdraw after unlock | returned in full | paid to owner / redirect recipient | — |
| Emergency withdraw while locked | returned minus snapshot penalty | forfeited | penalty + forfeit → reward reserve → re-streamed to stakers |
| Emergency withdraw after unlock / while paused | returned in full | forfeited | forfeit → reward reserve |

There is no treasury and no admin fee.

## Keepers

Owners who choose COMPOUND routing let anyone compound for a fee of
`min(protocol keeper fee, owner's cap)` of the compounded rewards.
Default protocol fee: 1 %; hard maximum 5 %. Minimum compound amount 1 FORGE,
per-position cooldown 1 hour (defaults). Because the fee is proportional,
compounding more often never raises the total fee share.

## Liquid staking (stFORGE)

The vault stakes all deposits in one Genesis (no-lock, 1.00×) position and
compounds it fee-free. Its exchange rate = total assets ÷ total shares, which
rises only as that position earns. stFORGE earns the Genesis rate, not a boosted
one — liquidity is paid for with the multiplier. It is not risk-free.
