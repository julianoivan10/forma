# Forma Protocol Specification

> **Status:** V1 design, testnet-only (Base Sepolia, chain id 84532). Not audited.
> This document is the source of truth for contract behaviour. If code and this
> document disagree, that is a bug in one of them.

Forma turns a stake into a **position**: an on-chain object with its own terms
(pool, principal, lock, multiplier), its own reward stream, its own routing
policy, and an ERC-721 token that represents ownership of all of it.

```
Stake → Position → Earn → Customize → Compound → Use
```

---

## 1. Contracts

| Contract | Responsibility | Holds funds? |
| --- | --- | --- |
| `ForgeToken` | Test ERC-20 (`FORGE`, 18 decimals) with a rate-limited faucet and a hard supply cap. Refuses to deploy outside chain ids 31337 / 84532. | No |
| `FormaStaking` | Core protocol. Pools (lock tiers), positions, reward accounting, locks, boost expiry, withdrawals, emergency withdrawal, reward routing, compounding, keeper incentives, per-account stats. | **Yes** – all principal and all reward reserves |
| `PositionNFT` | ERC-721 (`FORMA-POS`). One token per position, `tokenId == positionId`. Only `FormaStaking` can mint/burn. Maintains a per-owner index so wallets can enumerate their positions without an indexer. | No |
| `PositionRenderer` | Stateless on-chain metadata/SVG generator. Reads position state from `FormaStaking` and returns a deterministic `data:` URI. | No |
| `LiquidStakingVault` | ERC-4626 vault (`stFORGE`). Stakes deposited FORGE into a single zero-lock `FormaStaking` position, compounds its rewards, and exposes a share token whose exchange rate tracks underlying assets. | Holds one position NFT (and idle FORGE only after an emergency exit) |

Contracts that were considered and **deliberately not created**:

- **RewardController as a separate contract.** Reward accounting is tightly
  coupled to position weight changes; splitting it would add an external call
  (and a trust boundary) to every stake/withdraw/compound. The math is instead
  isolated in `libraries/RewardMath.sol` (pure functions, unit tested alone).
- **PoolRegistry.** Pools are a small bounded array (`MAX_POOLS = 16`) inside
  `FormaStaking`. A separate registry would add cross-contract reads with no
  security benefit.
- **Compounder.** Permissionless compounding is a single function on
  `FormaStaking` (`compound(positionId)`). A separate contract would need
  privileged access to reward accounting. A batch helper was considered and
  dropped for V1: a skip-on-failure loop would duplicate eligibility logic;
  keepers send one transaction per position.

No contract is upgradeable. There are no proxies.

---

## 2. Units, precision and bounds

| Constant | Value | Meaning |
| --- | --- | --- |
| `BPS` | `10_000` | 1.00× multiplier, 100% fee |
| `MIN_MULTIPLIER_BPS` | `10_000` | 1.00× |
| `MAX_MULTIPLIER_BPS` | `50_000` | 5.00× |
| `MAX_LOCK_DURATION` | `730 days` | |
| `MAX_EARLY_EXIT_PENALTY_BPS` | `2_500` | 25% of principal |
| `MAX_KEEPER_FEE_BPS` | `500` | 5% of the compounded reward |
| `MIN_REWARD_DURATION` / `MAX_REWARD_DURATION` | `1 days` / `365 days` | reward stream length |
| `MAX_POOLS` | `16` | |
| `RATE_PRECISION` | `1e18` | `rewardRate` is stored as tokens/sec × 1e18 |
| `ACC_PRECISION` | `1e30` | `accRewardPerWeight` scale |

Why `1e30`: with a token supply capped at `1e27` wei (1B FORGE) and weights
≤ 5× principal, `weight × Δacc ≤ emitted × 1e30 ≤ 1e57`, far inside `uint256`.
The accumulator itself grows by at most `emitted × 1e30 / totalWeight`, and
`totalWeight ≥ minStake` whenever it is non-zero, so it cannot overflow in any
realistic lifetime. Rounding dust per accumulator update is `< totalWeight / 1e30`
wei, i.e. effectively zero.

`FormaStaking` is token-agnostic but **assumes** the staking token is a
standard ERC-20 without transfer fees, rebasing or hooks, with supply below
`2^128`. Principal and weight are stored as `uint128` via `SafeCast`.

---

## 3. Pools

A pool is a **lock tier**, not a separate reward stream.

```solidity
struct Pool {
    string  name;
    uint64  lockDuration;         // seconds; 0 = no lock
    uint16  multiplierBps;        // 10_000 = 1.00x
    uint16  earlyExitPenaltyBps;  // applied to principal on emergency exit while locked
    bool    active;               // accepts new capital
    uint128 minStake;             // minimum principal for a new position
    uint128 maxTotalPrincipal;    // 0 = uncapped; applies to new capital only
    uint128 totalPrincipal;       // live
    uint128 totalWeight;          // live
    uint32  openPositions;        // live
}
```

Default testnet configuration (deployment script, **example parameters, not
economic promises**):

| id | name | lock | multiplier | early-exit penalty |
| --- | --- | --- | --- | --- |
| 0 | Genesis | 0 d | 1.00× | 0% |
| 1 | Builder | 30 d | 1.25× | 5% |
| 2 | Conviction | 90 d | 1.75× | 10% |
| 3 | Long Forge | 180 d | 2.50× | 15% |
| 4 | Calibration *(testnet only)* | 1 h | 1.10× | 2% |

`Calibration` exists so the full lock → unlock → boost-expiry → withdraw
lifecycle can be exercised end-to-end on a public testnet in an hour instead of
a month.

**Why one global stream:** if each pool had its own emission, every position
in a pool would carry the same multiplier and the multiplier would cancel out.
All positions in all pools therefore share **one** reward stream, split by
`weight = principal × multiplier`. A 2.50× position earns 2.5× per token what a
1.00× position earns over the same interval.

Pool management (`POOL_MANAGER_ROLE`): `createPool`, `updatePool` (name, lock,
multiplier, penalty, minStake, cap), `setPoolActive`. All parameters are
bounds-checked. **Pool updates never touch existing positions** (see §4).

---

## 4. Positions

```solidity
enum PositionStatus { None, Active, Closed, EmergencyClosed }

struct Position {
    uint128 principal;
    uint128 weight;              // principal * activeMultiplierBps / BPS
    uint64  startTime;
    uint64  unlockTime;          // snapshot: startTime + pool.lockDuration at creation
    uint32  poolId;
    uint16  multiplierBps;       // snapshot of pool multiplier at creation (historical record)
    uint16  activeMultiplierBps; // multiplierBps while locked; BPS (1.00x) after boost expiry
    uint16  earlyExitPenaltyBps; // snapshot
    PositionStatus status;
    uint64  lastThirdPartyCompound;
    uint32  compoundCount;
    uint256 rewardPerWeightPaid; // accumulator checkpoint
    uint128 rewardsAccrued;      // settled but unpaid rewards
    uint128 lifetimeRewards;     // realised rewards (claimed + compounded + redirected + keeper fee)
}
```

### 4.1 Snapshots

At creation the position copies `unlockTime`, `multiplierBps`, and
`earlyExitPenaltyBps` from its pool. Later pool changes only affect **new**
positions. `stake()` also takes `expectedLockDuration` and
`expectedMultiplierBps`; if the pool changed between the user's preview and
execution the call reverts with `PoolTermsChanged`. A user can never receive
terms different from the ones they signed for.

### 4.2 State machine

```
            stake()                      withdraw(all) after unlock
  None ───────────────▶ Active ─────────────────────────────────────▶ Closed
                         │  ▲   increasePosition (unlocked only)
                         │  └── withdraw(partial) after unlock, compound, claim
                         │
                         └──── emergencyWithdraw() (any time) ─────────▶ EmergencyClosed
```

`Closed` and `EmergencyClosed` are terminal; the NFT is burned on entry.
Every function that operates on a position reverts with `PositionNotActive`
unless `status == Active`.

### 4.3 Lock expiry and boost expiry

- `withdraw` requires `block.timestamp >= unlockTime`.
- A multiplier is a reward for **being locked**. Once `block.timestamp >=
  unlockTime`, the position's boost is expired: `activeMultiplierBps` drops to
  1.00× and `weight` is recomputed.
- Weight changes must be written to storage, so boost expiry is applied
  whenever the position is touched (claim, compound, withdraw, increase) and
  by a permissionless `expireBoost(positionId)` ("kick"). Changing routing does
  not touch accounting.
- **Documented limitation:** between `unlockTime` and the first touch/kick the
  position keeps earning at its boosted weight. This is the standard trade-off
  of lazily-evaluated boosts (cf. Curve gauge kicks). Kicking is free, has no
  incentive, and benefits every other staker; the UI surfaces kickable
  positions.
- `block.timestamp` is used only for coarse lock/emission accounting. Validator
  timestamp drift (seconds) is immaterial relative to lock durations measured
  in hours or days. No logic depends on exact second equality.

### 4.4 Increasing a position

`increasePosition(id, amount)` adds principal to an existing position. It is
only allowed when the position is **unlocked** (`now >= unlockTime`), which
means its effective multiplier is already 1.00×. This makes top-ups
unambiguous: they never extend a lock and never buy a boost. It exists
primarily so the liquid vault can hold a single position. The pool must be
active and the pool cap is enforced.

### 4.5 Withdrawal

`withdraw(id, amount)`: owner only, not paused, after unlock, `0 < amount ≤
principal`. Partial withdrawals reduce principal and weight. A full withdrawal
settles and pays all pending rewards to the position's claim destination
(§8), burns the NFT, and marks the position `Closed`. If the position had a
non-zero lock it counts as **matured** in account stats.

---

## 5. Reward accounting

Standard accumulator-per-weight ("reward per token") accounting with a single
global stream.

### 5.1 State

| Variable | Meaning |
| --- | --- |
| `rewardRate` | tokens/sec × `RATE_PRECISION` |
| `periodFinish` | end of current stream |
| `lastUpdateTime` | last accumulator update |
| `accRewardPerWeight` | Σ emitted × `ACC_PRECISION` / totalWeight |
| `totalWeight` | Σ position weights |
| `totalPrincipal` | Σ position principal |
| `rewardReserve` | FORGE held for rewards (future stream + emitted-but-unpaid + idle) |
| `outstandingRewards` | emitted to positions but not yet paid/forfeited (upper bound of Σ pending) |

### 5.2 Global update

```
t  = min(now, periodFinish)
if t > lastUpdateTime:
    dt = t - lastUpdateTime
    if totalWeight > 0:
        emitted = rewardRate * dt / RATE_PRECISION        // floor
        accRewardPerWeight += emitted * ACC_PRECISION / totalWeight   // floor
        outstandingRewards += emitted
    lastUpdateTime = t
```

When `totalWeight == 0` time still advances; those emissions are **not lost**:
they stay in `rewardReserve`, are not counted as outstanding or future, and are
therefore re-streamed by the next `notifyRewards` (§5.4).

### 5.3 Position settlement

```
pending(p) = p.rewardsAccrued + p.weight * (acc - p.rewardPerWeightPaid) / ACC_PRECISION
```

`_settle(p)` writes `pending` into `rewardsAccrued` and checkpoints
`rewardPerWeightPaid = acc`. Every weight change is preceded by
`_updateGlobal(); _settle(p);` so a weight change never retroactively changes
already-earned rewards.

### 5.4 Funding (`notifyRewards(amount, duration)`, `REWARD_MANAGER_ROLE`)

```
_updateGlobal()
received = balanceAfter - balanceBefore       // pulls `amount` (may be 0)
rewardReserve += received
budget = rewardReserve - outstandingRewards   // leftover stream + idle + new
rewardRate = budget * RATE_PRECISION / duration
periodFinish = now + duration; lastUpdateTime = now
```

Everything in the reserve that is not already owed to positions is re-streamed.
This automatically recycles: leftover stream, emissions during zero-weight
periods, forfeited rewards, early-exit penalties and rounding dust.
`amount == 0` is allowed (pure re-stream / extension). Reward-manager power is
limited to **re-timing** the stream; it cannot withdraw the reserve.

### 5.5 Solvency invariants

1. `stakingToken.balanceOf(staking) ≥ totalPrincipal + rewardReserve`
2. `rewardReserve ≥ outstandingRewards + futureEmissions`, where
   `futureEmissions = rewardRate × (periodFinish − lastUpdateTime) / RATE_PRECISION`
3. `Σ pending(p) ≤ outstandingRewards`
4. `Σ p.principal = totalPrincipal`, `Σ p.weight = totalWeight`, and the same per pool

Proof sketch of (2): `rewardRate = floor(budget·P/d)` so
`rewardRate·d/P ≤ budget`; emissions are floored per update and
`Σ floor(xᵢ) ≤ floor(Σ xᵢ)`, so emitted + remaining never exceeds the budget.
Proof sketch of (3): each update gives positions at most
`W·floor(emitted·A/W)/A ≤ emitted`, and per-position payouts are floored.

These are enforced as Foundry invariants (`test/invariant`).

### 5.6 Rounding policy

All divisions floor, always in the protocol's favour. Dust (≤ 1 wei per update
per position) remains in `rewardReserve` and is recycled by the next
`notifyRewards`. No user can gain from rounding.

---

## 6. Emergency withdrawal

`emergencyWithdraw(id)` — owner only, **never pausable**, available at any
time. It is deliberately punitive:

| Component | Treatment |
| --- | --- |
| Principal | returned minus penalty |
| Pending rewards | **forfeited** (`outstandingRewards -= pending`, stays in reserve → re-streamed) |
| Penalty | `principal × earlyExitPenaltyBps / BPS` if `now < unlockTime` **and** the protocol is **not** paused; otherwise 0 |
| Penalty destination | `rewardReserve` (re-streamed to remaining stakers). No treasury, no admin recipient. |
| NFT | burned; status `EmergencyClosed` |

The penalty is waived while paused so that an incident response never charges
users for leaving. Forfeiting rewards still applies, so emergency withdrawal
can never create rewards (invariant tested).

`previewEmergencyWithdraw(id)` returns `(principal, pendingForfeited, penalty,
amountOut)` so the UI can show exact consequences before the user signs.

---

## 7. Position NFT

- `tokenId == positionId`, ids start at 1.
- `FormaStaking` is the immutable minter/burner. Minting uses `_mint` (no
  receiver callback, no reentrancy surface).
- **Transfer model: Option B — transferable, rights attached to the token.**
  The lock, unlock time, multiplier, penalty and pending rewards all live on
  the position, not the holder. Transferring a locked NFT does not change
  `unlockTime`; `withdraw` checks the position, so transfers cannot bypass a
  lock. This is what makes a position composable ("Use").
- **Pending rewards travel with the NFT.** Buyers should treat
  `pendingRewards` as front-runnable by the seller (claim before transfer);
  marketplaces must account for this, as with Uniswap V3 positions.
- **Routing does not travel with the NFT** (see §8.3).
- Per-owner index (`tokensOfOwner(owner, offset, limit)`,
  `tokenOfOwnerByIndex`) is maintained in `_update` with swap-and-pop. There
  is no global enumeration array (the part of `ERC721Enumerable` we do not
  need). Rationale: "what do I own?" must be answerable from on-chain state
  alone, and public RPC `eth_getLogs` range limits make log-based discovery
  unreliable.
- `tokenURI` delegates to `PositionRenderer`. The renderer address is
  settable by `DEFAULT_ADMIN_ROLE` (metadata only — cannot affect funds; emits
  `RendererUpdated` and ERC-4906 `BatchMetadataUpdate`).

Operator approvals (`approve`/`setApprovalForAll`) authorise **transfers
only**. All position actions require `ownerOf(id) == msg.sender` (plus the
redirect recipient for `claim`, §8).

---

## 8. Reward routing

```solidity
enum RoutingMode { Keep, Compound, Redirect }
struct Routing {
    RoutingMode mode;
    address recipient;        // Redirect only
    uint16  maxKeeperFeeBps;  // Compound only: owner's cap on keeper fees
    address configuredBy;     // owner at configuration time
}
```

### 8.1 Semantics

| Mode | `claim(id)` may be called by | Rewards go to | Third-party `compound(id)` |
| --- | --- | --- | --- |
| Keep | owner | owner | not allowed |
| Compound | owner | owner | **allowed** (keeper fee ≤ owner cap) |
| Redirect | owner **or** recipient | recipient | not allowed |

- Only the current owner can configure routing (`setRouting`). Redirect
  requires a non-zero recipient that is not the staking contract.
- Emits `RewardRedirectConfigured(positionId, mode, recipient, maxKeeperFeeBps)`.
- Every redirected payout emits `RewardRedirected(positionId, recipient, amount)`
  in addition to `RewardClaimed`.

### 8.2 Why the recipient may trigger its own claim

Redirect is an owner-signed standing instruction ("stream my yield to X").
Letting X pull is the only way the instruction works without the owner
signing every claim. X cannot change the destination, amount or mode.

### 8.3 Routing and transfers

`configuredBy` records the owner who set the routing. If
`ownerOf(id) != configuredBy` the **effective** routing is `Keep` with no
recipient. A new owner therefore never inherits a redirect to someone else's
wallet or a compound policy they didn't choose, and no transfer hook/callback is
needed. (If the NFT returns to the original configurer, their own routing
applies again.)

---

## 9. Compounding

`compound(id)` moves pending rewards into principal (`rewardReserve →
totalPrincipal`) at the position's **active** multiplier. It never extends the
lock. Emits `Compound(positionId, caller, compounded, keeperFee)`.

| Caller | Allowed when | Keeper fee | Limits |
| --- | --- | --- | --- |
| Owner | always (if pending > 0) | 0 | — |
| Anyone else | effective routing = Compound | `pending × min(keeperFeeBps, owner.maxKeeperFeeBps) / BPS` | `pending ≥ minCompoundAmount`; `now ≥ lastThirdPartyCompound + keeperCooldown` |

Protections:

- **Excessive keeper rewards:** protocol fee capped at `MAX_KEEPER_FEE_BPS`
  (5%) and further capped by the owner's own snapshot cap, so a later increase
  in the protocol fee cannot silently charge existing opted-in positions more.
- **Dust / griefing:** `minCompoundAmount` and per-position `keeperCooldown`
  bound third-party frequency. Fees are proportional, so frequent compounding
  never increases the total fee share — it only burns the keeper's gas.
- **Consent:** third parties can only compound positions whose owner opted in,
  because compounding while locked converts liquid rewards into locked principal.

---

## 10. Liquid staking (`LiquidStakingVault`, ERC-4626)

```
deposit FORGE ─▶ vault ─▶ FormaStaking position (pool 0, no lock, 1.00×)
                 │
                 └─ mints stFORGE shares
rewards accrue to the vault's position → totalAssets grows → 1 stFORGE buys more FORGE
redeem stFORGE ─▶ vault compounds, withdraws principal ─▶ FORGE to receiver
```

- `asset()` = FORGE. `totalAssets()` = `idleAssets + position.principal +
  pendingRewards(position)` using **internal accounting** (never
  `balanceOf(this)`). Direct FORGE donations to the vault therefore do not move
  the share price.
- The vault owns exactly one position in a zero-lock pool (`vaultPoolId`,
  immutable). Its first stake passes `expectedLockDuration = 0`; if the pool
  ever gains a lock, the vault refuses to open a new position rather than lock
  depositors. Subsequent deposits use `increasePosition` (always unlocked).
- Its routing stays `Keep`; nobody else can compound or redirect it.
  The vault compounds its own rewards (fee-free, as owner) on every
  deposit/withdraw and via permissionless `harvest()`.
- `_decimalsOffset() = 6` (stFORGE has 24 decimals). Virtual shares/assets make
  first-depositor inflation unprofitable even if an unforeseen donation path
  existed. The first real deposit must also satisfy the pool's `minStake`.
- `max*` functions return 0 when staking is paused, the pool is inactive, or
  the vault has exited, so they never overstate what can be executed.
- Slippage-protected helpers: `depositWithMin(assets, receiver, minShares)` and
  `redeemWithMin(shares, receiver, owner, minAssets)`.
- Rounding: OpenZeppelin ERC-4626 (shares minted round down, shares burned
  round up) — always in the vault's favour. Consequence: the last redeemer
  receives a few wei less than `totalAssets`; that dust stays in the vault
  position (earning a negligible share) and accrues to the next depositor.

### 10.1 Vault emergency exit

State machine: `Active → Exited` (terminal).

`emergencyExit()` calls `FormaStaking.emergencyWithdraw` on the vault position.
It is only callable while `FormaStaking` is paused, by
`DEFAULT_ADMIN_ROLE` at any time during the pause, or by **anyone** once the
pause has lasted `EMERGENCY_EXIT_DELAY` (3 days). The position has no lock and
the protocol is paused, so no penalty applies; pending rewards are forfeited.
After exit, `totalAssets = idleAssets`, deposits are disabled and
withdrawals/redemptions are paid pro-rata from idle FORGE.

stFORGE is **not risk-free**: its value depends on `FormaStaking` solvency,
reward funding, and correct accounting.

---

## 11. Account stats (gamification source)

`FormaStaking` stores per-account counters, attributed to the position owner at
the time of the action:

```solidity
struct AccountStats {
    uint64  firstStakeAt;
    uint32  positionsOpened;
    uint32  positionsMatured;   // full withdrawal after unlock of a lock>0 position
    uint32  compounds;          // compounds on positions they owned
    uint64  longestLock;        // longest lock ever committed (seconds)
    uint128 rewardsEarned;      // realised rewards (claimed + compounded + redirected + keeper fees paid)
}
```

Milestones (derived by the frontend from this struct plus live positions and
the stFORGE balance — nothing is invented client-side):

| Milestone | Condition |
| --- | --- |
| FIRST STAKE | `positionsOpened ≥ 1` |
| 7 DAY STREAK | owns an active position with age ≥ 7 d (live) |
| 30 DAY CONVICTION | `longestLock ≥ 30 d` |
| FIRST COMPOUND | `compounds ≥ 1` |
| 100 FORGE EARNED | `rewardsEarned ≥ 100 FORGE` |
| POSITION MATURED | `positionsMatured ≥ 1` |
| LIQUID POSITION CREATED | `stFORGE.balanceOf ≥ 1` wei (live) |

---

## 12. Rates shown to users

| Term | Definition | Source |
| --- | --- | --- |
| Emission rate | `rewardRate / RATE_PRECISION` FORGE/sec, protocol-wide | on-chain |
| Position reward rate | `emission × weight / totalWeight` | on-chain view `previewStake` / `positionRewardRate` |
| Estimated APR | `positionRewardRate × 365 d / principal` assuming the current emission rate and total weight persist for a year | on-chain view |
| Estimated APY | `(1 + APR/365)^365 − 1`: daily compounding, same assumptions | frontend, from on-chain APR |

`previewStake(poolId, amount)` includes the new stake's own weight in the
denominator (dilution). If the stream ends before a year, the UI shows the
stream end date next to every annualised number. All figures are labelled
**TESTNET ESTIMATE**.

---

## 13. Roles and administration

| Role | Can | Cannot |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | grant/revoke roles, `unpause`, `recoverERC20` (non-FORGE tokens only), set NFT renderer | move principal, move reward reserve, change positions |
| `POOL_MANAGER_ROLE` | create/update pools, (de)activate pools | affect existing positions |
| `REWARD_MANAGER_ROLE` | `notifyRewards`, `setCompoundConfig` (bounded) | withdraw rewards |
| `PAUSER_ROLE` | `pause` | unpause |
| `ForgeToken` `MINTER_ROLE` | mint up to `MAX_SUPPLY` (testnet reward funding) | exceed cap |

There is **no** function that transfers user principal anywhere except to the
position owner. `recoverERC20` reverts for the staking token.

## 14. Pause

Paused (`FormaStaking`): `stake`, `increasePosition`, `withdraw`, `claim`,
`compound`, `notifyRewards` revert.

Always available: `emergencyWithdraw` (penalty waived while paused),
`setRouting`, `expireBoost`, all views, NFT transfers.

Funds can never be trapped by a pause: principal is always recoverable via
`emergencyWithdraw`. The cost of a prolonged pause is forfeited rewards, never
principal. `pausedAt` is recorded so dependent contracts (the vault) can apply
time-based recovery rules.

---

## 15. Events

`PoolCreated`, `PoolUpdated`, `PoolActiveSet`, `Stake`, `PositionIncreased`,
`Unstake`, `RewardClaimed`, `RewardRedirected`, `RewardRedirectConfigured`,
`Compound`, `BoostExpired`, `EmergencyWithdraw`, `RewardsFunded`,
`CompoundConfigUpdated`, `ERC20Recovered`; `ForgeToken.FaucetClaimed`;
ERC-721 `Transfer`; ERC-4626 `Deposit`/`Withdraw`; `VaultHarvested`,
`VaultEmergencyExit`.

---

## 16. Threat model

| Threat | Mitigation |
| --- | --- |
| Reentrancy via token hooks | `nonReentrant` on every external state-changing function; CEI ordering; NFT uses `_mint` (no callback); fee-on-transfer tokens rejected by a balance-delta check |
| Reward double counting | single accumulator; settle before every weight change; tested with fuzz + invariants |
| Paying more rewards than funded | `outstandingRewards` / `rewardReserve` bookkeeping; invariant 2 & 3 |
| Principal used to pay rewards | principal and reserve tracked separately; payouts only decrement `rewardReserve` |
| Lock bypass via NFT transfer | lock stored on position; `withdraw` checks position |
| Redirect theft after transfer | `configuredBy` check; effective routing resets to Keep |
| Third party forcing compounding | only when owner opted in; fee capped by owner snapshot |
| Keeper fee extraction | protocol cap 5%, owner cap, min amount, cooldown |
| Silent term changes | position snapshots; `expected*` params on `stake` |
| Pool misconfiguration | bounds on lock/multiplier/penalty; `MAX_POOLS` |
| ERC-4626 inflation / donation | internal asset accounting, decimals offset 6, minStake on first deposit, dedicated tests |
| Admin abuse | role separation; no principal-moving admin functions; pause cannot trap principal |
| Frontend showing fake data | all balances/positions/rates read from chain; no fallbacks |
| Accidental mainnet deploy | `ForgeToken` refuses non-testnet chain ids; deploy script allow-lists 31337/84532 |
| Timestamp manipulation | only coarse use; ± seconds immaterial |

## 17. Known limitations

- Not audited. Automated tests and Slither are not an audit.
- Boost grace period between unlock and first touch/kick (§4.3).
- Pending rewards are front-runnable by an NFT seller (§7).
- `notifyRewards` resets the stream schedule (standard Synthetix behaviour).
- A reward manager can make the stream arbitrarily short/long within bounds,
  changing emission rate (not accrued rewards).
- FORGE donated directly to `FormaStaking` (outside `notifyRewards`) is not
  accounted and cannot be recovered.
- Vault depositors share the vault position; an emergency exit forfeits the
  vault's pending rewards for all holders.
- Per-owner NFT index costs extra gas on transfer (acceptable trade for
  indexer-free reads).
- Testnet economics are illustrative only.
