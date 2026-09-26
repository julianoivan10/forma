# Security

> **Forma has not been audited.** The testing and static analysis described
> here reduce risk; they are not an audit and do not make the contracts
> "secure". Forma is deployed to testnets only. Do not deposit assets of value.

## Design principles

- No upgradeability, no proxies, no delegatecall.
- One contract (`FormaStaking`) holds all funds; principal and reward reserve
  are tracked in separate buckets and rewards are only paid from the reserve.
- No admin function can move user principal or withdraw the reward reserve.
  `recoverERC20` refuses the staking token.
- Every external state-changing function is `nonReentrant` and follows
  checks-effects-interactions (all transfers happen after all state writes).
- Position terms are snapshotted; `stake()` also takes the reviewed terms and
  reverts on mismatch (`PoolTermsChanged`).
- Emergency withdrawal can never be paused, so a pause cannot trap principal.
- Fee-on-transfer / rebasing tokens are rejected with a balance-delta check.
- `ForgeToken` refuses to deploy outside chain ids 31337/84532; the deploy
  script and `scripts/deploy.mjs` allow-list the same chains and cross-check the
  RPC's chain id before signing.

The full threat model is in [PROTOCOL.md §16](PROTOCOL.md#16-threat-model).

## Roles

| Role | Holder on testnet | Powers | Cannot |
| --- | --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | `ADMIN_ADDRESS` | grant/revoke roles, unpause, recover non-FORGE tokens, set NFT renderer | move principal or reserve |
| `POOL_MANAGER_ROLE` | `POOL_MANAGER_ADDRESS` | create/update/(de)activate pools (new positions only) | change existing positions |
| `REWARD_MANAGER_ROLE` | `REWARD_MANAGER_ADDRESS` | fund/re-time the stream, keeper config within hard bounds | withdraw rewards |
| `PAUSER_ROLE` | `PAUSER_ADDRESS` | pause | unpause |
| `ForgeToken.MINTER_ROLE` | reward manager | mint test FORGE up to the 1B cap | exceed the cap |
| Vault `DEFAULT_ADMIN_ROLE` | `ADMIN_ADDRESS` | vault emergency exit, only while staking is paused | anything else |

The deployer renounces every role it was not explicitly configured to hold
(verified in `test/integration/Deployment.t.sol`). On Base Sepolia every role
address must be set explicitly; the script refuses to default them to the
deployer. Actual addresses are published in `deployments/base-sepolia.json`
and on the app's settings page once deployed.

## Test suite

| Suite | Tests | What it covers |
| --- | --- | --- |
| Unit (`test/unit`) | 160 | all user and admin entry points and their revert paths; access control; pools; rewards; locks & boost expiry; emergency; routing; compounding & keepers; NFT index/transfer/metadata; pause; admin; vault; reentrancy with a hostile hook token; fee-on-transfer rejection |
| Fuzz (`test/fuzz`) | 13 × 1,000 runs | reward proportionality, claim sequences vs. funding, stream budgeting, principal conservation, stranger access, lock boundary, emergency math, keeper fee bounds, vault round-trips (no free lunch / never overpaid), library properties |
| Invariant (`test/invariant`) | 14 invariant functions × 256 runs × depth 200 | see below |
| Deployment (`test/integration`) | 6 | real deploy script: wiring, funding, role hand-over, mainnet refusal, end-to-end user flow |

Deeper campaign: `FOUNDRY_PROFILE=deep forge test` (20k fuzz runs, 1,000 ×
500 invariant).

### Invariants

The handler drives random stakes, top-ups, partial/full withdrawals, claims
(by owners, recipients and strangers), owner and keeper compounds, routing
changes, NFT transfers, emergency exits, boost kicks, vault deposits /
redemptions / harvests / emergency exits, reward funding, pause toggles, time
warps and unauthorized admin calls. Ghost accounting is derived only from call
inputs/outputs, never from the contract's own counters.

1. `balance ≥ totalPrincipal + rewardReserve`
2. `rewardReserve ≥ outstandingRewards + futureEmissions`
3. rewards paid + compounded ≤ rewards funded + penalties
4. `totalPrincipal == in + compounded − out − penalties` (exact)
5. `rewardReserve == funded + penalties − paid − compounded` (exact)
6. Σ `accountStats.rewardsEarned` == paid + compounded (no rewards created or lost)
7. Σ position principal/weight == global and per-pool totals; open-position counts match
8. `weight == principal × activeMultiplier / BPS`; active multiplier is the snapshot or 1.00×
9. Σ pending ≤ outstanding rewards
10. NFT supply == active positions; closed positions have no NFT and no principal
11. Owner index maps to true owners
12. No withdrawal or top-up ever succeeded while locked
13. No stranger ever withdrew/emergency-withdrew; no unauthorized claim or compound; claims paid exactly the owner-chosen destination; keeper fees within the owner's cap
14. No unauthorized account ever changed configuration; emergency exits never paid rewards
15. Vault `totalAssets` == idle + position principal + pending; shares never over-claim assets

### Coverage (`forge coverage --ir-minimum`, unit + fuzz + integration)

| File | Lines | Branches | Functions |
| --- | --- | --- | --- |
| FormaStaking.sol | 97.6 % | 96.1 % | 98.1 % |
| LiquidStakingVault.sol | 98.8 % | 79.3 % | 100 % |
| PositionNFT.sol | 100 % | 80.0 % | 100 % |
| PositionRenderer.sol | 93.7 % | 62.5 % | 100 % |
| ForgeToken.sol | 100 % | 100 % | 100 % |
| RewardMath.sol | 100 % | — | 100 % |

Coverage is a map of what was executed, not a measure of correctness.

## Static analysis (Slither 0.11.6)

Run: `pnpm --filter @forma/contracts slither`. Findings in `src/` after
remediation:

| Detector | Impact | Location | Triage |
| --- | --- | --- | --- |
| weak-prng | High | `PositionRenderer._tenths` | **False positive.** `x % 10` formats a decimal digit for SVG coordinates; no randomness. |
| incorrect-equality | Medium | `FormaStaking._currentAcc` (`e == 0`) | Intended exact zero check on an integer emission; not a balance equality. |
| incorrect-equality | Medium | `PositionRenderer._footer` | Cosmetic "NO LOCK" label check. |
| reentrancy-no-eth | Medium | `LiquidStakingVault._withdraw` | Calls only the immutable, trusted `FormaStaking`; function is `nonReentrant`; `positionId` is cleared before the external withdraw. Accepted. |
| unused-return | Medium | `LiquidStakingVault._harvest` | Keeper fee is always 0 when the vault (owner) compounds. Accepted, commented. |
| reentrancy-benign / events | Low | vault | Same trusted-callee reasoning. |
| timestamp | Low | 21 sites | Coarse lock/emission accounting by design (PROTOCOL.md §4.3). |
| calls-loop | Low | `positionsOf` view | Paginated (≤ 100), view-only. |
| cyclomatic-complexity | Info | `_validatePoolParams` | Straight-line bounds checks. |

Fixed as a result of Slither review: stats write moved before the NFT burn in
`withdraw` (strict CEI); vault clears `positionId` before calling staking and
credits any closing reward to idle assets instead of ignoring the return
value; vault emergency exit uses the returned amount; renderer tick angles no
longer divide before multiplying.

**No known unresolved critical or high issue.**

## Known risks and limitations

- Not audited.
- Boost persists after unlock until the position is touched or kicked.
- An NFT seller can claim pending rewards before a transfer settles.
- `notifyRewards` resets the stream schedule; the reward manager controls
  emission timing (not accrued rewards).
- FORGE sent directly to `FormaStaking` is not accounted and not recoverable.
- Vault holders share one position; a vault emergency exit forfeits its
  pending rewards for everyone. Vault exit before 3 days of pause needs the
  vault admin.
- Log-based UI features (activity, creation tx, keeper board) depend on RPC
  log availability and are labelled as indexed.
- Front-end hosting, RPC providers and wallet software are outside the
  contracts' trust boundary.

## Reporting

This is a portfolio project on testnet. Please report issues by opening a
GitHub issue (no bounty). Never test against mainnet deployments — there are none.
