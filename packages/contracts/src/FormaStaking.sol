// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IFormaStaking} from "./interfaces/IFormaStaking.sol";
import {IPositionNFT} from "./interfaces/IPositionNFT.sol";
import {RewardMath} from "./libraries/RewardMath.sol";

/// @title FormaStaking
/// @notice Core Forma protocol: lock-tier pools, NFT-represented positions, a single global reward
///         stream split by `principal × multiplier`, programmable reward routing and permissionless
///         compounding. Non-upgradeable. See docs/PROTOCOL.md.
/// @dev    Accounting buckets (all in staking-token wei):
///         - `totalPrincipal`: Σ position principal. Only ever paid to position owners.
///         - `rewardReserve`: tokens earmarked for rewards (future stream + owed + idle).
///         - `outstandingRewards`: emitted to positions and not yet paid/forfeited. Upper bound of Σ pending.
contract FormaStaking is IFormaStaking, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // ─── roles ─────────────────────────────────────────────────────────────
    bytes32 public constant POOL_MANAGER_ROLE = keccak256("POOL_MANAGER_ROLE");
    bytes32 public constant REWARD_MANAGER_ROLE = keccak256("REWARD_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ─── bounds ────────────────────────────────────────────────────────────
    uint256 public constant BPS = RewardMath.BPS;
    uint256 public constant MIN_MULTIPLIER_BPS = 10_000;
    uint256 public constant MAX_MULTIPLIER_BPS = 50_000;
    uint256 public constant MAX_LOCK_DURATION = 730 days;
    uint256 public constant MAX_EARLY_EXIT_PENALTY_BPS = 2500;
    uint256 public constant MAX_KEEPER_FEE_BPS = 500;
    uint256 public constant MIN_KEEPER_COOLDOWN = 10 minutes;
    uint256 public constant MAX_KEEPER_COOLDOWN = 30 days;
    uint256 public constant MIN_REWARD_DURATION = 1 days;
    uint256 public constant MAX_REWARD_DURATION = 365 days;
    uint256 public constant MAX_POOLS = 16;
    uint256 public constant MAX_NAME_LENGTH = 32;
    uint256 public constant MAX_PAGE_SIZE = 100;

    IERC20 private immutable _stakingToken;
    IPositionNFT private immutable _positionNFT;

    // ─── pools & positions ─────────────────────────────────────────────────
    Pool[] private _pools;
    mapping(uint256 positionId => Position) private _positions;
    mapping(uint256 positionId => Routing) private _routing;
    mapping(address account => AccountStats) private _stats;
    uint256 public nextPositionId = 1;

    // ─── reward stream ─────────────────────────────────────────────────────
    uint256 public rewardRate; // tokens/sec * RATE_PRECISION
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public accRewardPerWeight; // * ACC_PRECISION
    uint256 public totalWeight;
    uint256 public totalPrincipal;
    uint256 public rewardReserve;
    uint256 public outstandingRewards;

    CompoundConfig private _compoundConfig;
    uint64 public pausedAt;

    error NFTMisconfigured();
    error UnsupportedTokenTransfer();

    constructor(IERC20 stakingToken_, IPositionNFT positionNFT_, address admin, CompoundConfig memory compoundConfig_) {
        if (address(stakingToken_) == address(0) || address(positionNFT_) == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        // The NFT must be bound to this exact contract as its sole minter/burner.
        if (positionNFT_.staking() != address(this)) revert NFTMisconfigured();

        _stakingToken = stakingToken_;
        _positionNFT = positionNFT_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setCompoundConfig(compoundConfig_);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                               USER ACTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @inheritdoc IFormaStaking
    function stake(uint256 poolId, uint256 amount, uint64 expectedLockDuration, uint16 expectedMultiplierBps)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 positionId)
    {
        if (amount == 0) revert ZeroAmount();
        Pool storage pool = _pool(poolId);
        if (!pool.active) revert PoolInactive(poolId);
        if (pool.lockDuration != expectedLockDuration || pool.multiplierBps != expectedMultiplierBps) {
            revert PoolTermsChanged();
        }
        if (amount < pool.minStake) revert BelowMinStake(pool.minStake);
        _checkCap(pool, poolId, amount);

        _updateGlobal();

        positionId = nextPositionId++;
        Position storage p = _positions[positionId];
        uint64 lockDuration = pool.lockDuration;
        p.startTime = uint64(block.timestamp);
        p.unlockTime = uint64(block.timestamp) + lockDuration;
        p.poolId = uint32(poolId);
        p.multiplierBps = pool.multiplierBps;
        p.activeMultiplierBps = pool.multiplierBps;
        p.earlyExitPenaltyBps = pool.earlyExitPenaltyBps;
        p.status = PositionStatus.Active;
        p.rewardPerWeightPaid = accRewardPerWeight;
        _setPrincipal(p, amount);
        pool.openPositions += 1;

        AccountStats storage s = _stats[msg.sender];
        if (s.firstStakeAt == 0) s.firstStakeAt = uint64(block.timestamp);
        s.positionsOpened += 1;
        if (lockDuration > s.longestLock) s.longestLock = lockDuration;

        _pullExact(msg.sender, amount);
        _positionNFT.mint(msg.sender, positionId);

        emit Stake(positionId, msg.sender, poolId, amount, p.unlockTime, p.multiplierBps);
    }

    /// @inheritdoc IFormaStaking
    function increasePosition(uint256 positionId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Position storage p = _activePosition(positionId);
        _requireOwner(positionId);
        if (block.timestamp < p.unlockTime) revert PositionLocked(p.unlockTime);
        Pool storage pool = _pools[p.poolId];
        if (!pool.active) revert PoolInactive(p.poolId);
        _checkCap(pool, p.poolId, amount);

        _touch(positionId, p);
        _setPrincipal(p, uint256(p.principal) + amount);

        _pullExact(msg.sender, amount);
        emit PositionIncreased(positionId, msg.sender, amount);
    }

    /// @inheritdoc IFormaStaking
    function withdraw(uint256 positionId, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 rewardsPaid)
    {
        if (amount == 0) revert ZeroAmount();
        Position storage p = _activePosition(positionId);
        _requireOwner(positionId);
        if (block.timestamp < p.unlockTime) revert PositionLocked(p.unlockTime);
        if (amount > p.principal) revert InsufficientPrincipal();

        _touch(positionId, p);

        bool closing = amount == p.principal;
        address rewardsTo = address(0);
        if (closing) {
            rewardsPaid = p.rewardsAccrued;
            if (rewardsPaid > 0) {
                Routing memory r = _effectiveRouting(positionId, msg.sender);
                bool redirect = r.mode == RoutingMode.Redirect;
                rewardsTo = redirect ? r.recipient : msg.sender;
                _bookRewardPayment(positionId, p, msg.sender, rewardsTo, rewardsPaid, redirect);
            }
            if (p.unlockTime > p.startTime) _stats[msg.sender].positionsMatured += 1;
            _setPrincipal(p, 0);
            _close(positionId, p, PositionStatus.Closed);
        } else {
            _setPrincipal(p, uint256(p.principal) - amount);
        }
        emit Unstake(positionId, msg.sender, amount, closing);

        _stakingToken.safeTransfer(msg.sender, amount);
        if (rewardsPaid > 0) _stakingToken.safeTransfer(rewardsTo, rewardsPaid);
    }

    /// @inheritdoc IFormaStaking
    function claim(uint256 positionId) external nonReentrant whenNotPaused returns (uint256 amount) {
        Position storage p = _activePosition(positionId);
        address owner = _positionNFT.ownerOf(positionId);
        Routing memory r = _effectiveRouting(positionId, owner);
        bool redirect = r.mode == RoutingMode.Redirect;
        if (msg.sender != owner && !(redirect && msg.sender == r.recipient)) revert NotAuthorizedToClaim(positionId);

        _touch(positionId, p);
        amount = p.rewardsAccrued;
        if (amount == 0) revert NothingToClaim();

        address to = redirect ? r.recipient : owner;
        _bookRewardPayment(positionId, p, owner, to, amount, redirect);
        _stakingToken.safeTransfer(to, amount);
    }

    /// @inheritdoc IFormaStaking
    function compound(uint256 positionId)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 compounded, uint256 keeperFee)
    {
        Position storage p = _activePosition(positionId);
        address owner = _positionNFT.ownerOf(positionId);
        bool thirdParty = msg.sender != owner;
        Routing memory r = _effectiveRouting(positionId, owner);
        if (thirdParty && r.mode != RoutingMode.Compound) revert CompoundNotAuthorized(positionId);

        _touch(positionId, p);
        uint256 pending = p.rewardsAccrued;
        if (pending == 0) revert NothingToCompound();

        if (thirdParty) {
            CompoundConfig memory cfg = _compoundConfig;
            if (pending < cfg.minCompoundAmount) revert CompoundTooSmall(cfg.minCompoundAmount);
            uint256 availableAt = uint256(p.lastThirdPartyCompound) + cfg.keeperCooldown;
            if (p.lastThirdPartyCompound != 0 && block.timestamp < availableAt) revert CompoundCooldown(availableAt);
            uint256 feeBps = Math.min(cfg.keeperFeeBps, r.maxKeeperFeeBps);
            keeperFee = RewardMath.bpsOf(pending, feeBps);
            p.lastThirdPartyCompound = uint64(block.timestamp);
        }
        compounded = pending - keeperFee;

        p.rewardsAccrued = 0;
        p.lifetimeRewards += pending.toUint128();
        p.compoundCount += 1;
        outstandingRewards -= pending;
        rewardReserve -= pending;
        _setPrincipal(p, uint256(p.principal) + compounded);

        AccountStats storage s = _stats[owner];
        s.compounds += 1;
        s.rewardsEarned += pending.toUint128();

        emit Compound(positionId, msg.sender, compounded, keeperFee);
        if (keeperFee > 0) _stakingToken.safeTransfer(msg.sender, keeperFee);
    }

    /// @inheritdoc IFormaStaking
    /// @dev Never pausable: this is the principal recovery path. Penalty is waived while paused.
    function emergencyWithdraw(uint256 positionId) external nonReentrant returns (uint256 amountOut) {
        Position storage p = _activePosition(positionId);
        _requireOwner(positionId);

        _updateGlobal();
        _settle(p);

        EmergencyPreview memory preview = _emergencyPreviewMem(p);
        amountOut = preview.amountOut;

        // Forfeited rewards leave `outstandingRewards` but stay in `rewardReserve` → re-streamed.
        p.rewardsAccrued = 0;
        outstandingRewards -= preview.pendingForfeited;
        // Penalty moves from principal into the reward reserve → re-streamed. No admin recipient.
        rewardReserve += preview.penalty;
        _setPrincipal(p, 0);
        _close(positionId, p, PositionStatus.EmergencyClosed);

        emit EmergencyWithdraw(positionId, msg.sender, amountOut, preview.penalty, preview.pendingForfeited);
        _stakingToken.safeTransfer(msg.sender, amountOut);
    }

    /// @inheritdoc IFormaStaking
    function setRouting(uint256 positionId, RoutingMode mode, address recipient, uint16 maxKeeperFeeBps)
        external
        nonReentrant
    {
        _activePosition(positionId);
        _requireOwner(positionId);

        if (mode == RoutingMode.Redirect) {
            if (recipient == address(0) || recipient == address(this)) revert InvalidRouting();
            if (maxKeeperFeeBps != 0) revert InvalidRouting();
        } else if (mode == RoutingMode.Compound) {
            if (recipient != address(0)) revert InvalidRouting();
            if (maxKeeperFeeBps > MAX_KEEPER_FEE_BPS) revert InvalidKeeperFee();
        } else {
            if (recipient != address(0) || maxKeeperFeeBps != 0) revert InvalidRouting();
        }

        _routing[positionId] =
            Routing({mode: mode, recipient: recipient, maxKeeperFeeBps: maxKeeperFeeBps, configuredBy: msg.sender});
        emit RewardRedirectConfigured(positionId, mode, recipient, maxKeeperFeeBps);
    }

    /// @inheritdoc IFormaStaking
    /// @dev Permissionless "kick": drops an unlocked position's weight to 1.00×. Benefits all other stakers.
    function expireBoost(uint256 positionId) external nonReentrant {
        Position storage p = _activePosition(positionId);
        if (p.activeMultiplierBps == BPS || block.timestamp < p.unlockTime) revert BoostNotExpirable(positionId);
        _touch(positionId, p);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                               ADMINISTRATION
    // ═══════════════════════════════════════════════════════════════════════

    function createPool(PoolParams calldata params) external onlyRole(POOL_MANAGER_ROLE) returns (uint256 poolId) {
        if (_pools.length >= MAX_POOLS) revert TooManyPools();
        _validatePoolParams(params);
        poolId = _pools.length;
        Pool storage pool = _pools.push();
        _writePoolParams(pool, params);
        pool.active = true;
        emit PoolCreated(poolId, params.name, params.lockDuration, params.multiplierBps, params.earlyExitPenaltyBps);
        emit PoolActiveSet(poolId, true);
    }

    /// @notice Changes terms for NEW positions only. Existing positions keep their snapshots.
    function updatePool(uint256 poolId, PoolParams calldata params) external onlyRole(POOL_MANAGER_ROLE) {
        Pool storage pool = _pool(poolId);
        _validatePoolParams(params);
        _writePoolParams(pool, params);
        emit PoolUpdated(poolId, params.name, params.lockDuration, params.multiplierBps, params.earlyExitPenaltyBps);
    }

    function setPoolActive(uint256 poolId, bool active) external onlyRole(POOL_MANAGER_ROLE) {
        _pool(poolId).active = active;
        emit PoolActiveSet(poolId, active);
    }

    /// @notice Adds `amount` to the reward reserve and re-streams everything not already owed over `duration`.
    function notifyRewards(uint256 amount, uint256 duration)
        external
        onlyRole(REWARD_MANAGER_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (duration < MIN_REWARD_DURATION || duration > MAX_REWARD_DURATION) {
            revert InvalidRewardDuration();
        }
        _updateGlobal();

        if (amount > 0) {
            _pullExact(msg.sender, amount);
            rewardReserve += amount;
        }
        uint256 budget = rewardReserve - outstandingRewards;
        uint256 rate = RewardMath.rateFor(budget, duration);
        if (rate == 0) revert NoRewardBudget();

        rewardRate = rate;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        emit RewardsFunded(msg.sender, amount, duration, rate, block.timestamp + duration);
    }

    function setCompoundConfig(CompoundConfig calldata cfg) external onlyRole(REWARD_MANAGER_ROLE) {
        _setCompoundConfig(cfg);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        pausedAt = uint64(block.timestamp);
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        pausedAt = 0;
        _unpause();
    }

    /// @notice Recover tokens sent here by mistake. The staking token can never be recovered.
    function recoverERC20(IERC20 token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(token) == address(_stakingToken)) revert CannotRecoverStakingToken();
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit ERC20Recovered(address(token), to, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                                   VIEWS
    // ═══════════════════════════════════════════════════════════════════════

    function stakingToken() external view returns (address) {
        return address(_stakingToken);
    }

    function positionNFT() external view returns (address) {
        return address(_positionNFT);
    }

    function poolCount() external view returns (uint256) {
        return _pools.length;
    }

    function getPool(uint256 poolId) external view returns (Pool memory) {
        return _pool(poolId);
    }

    function getPools() external view returns (Pool[] memory) {
        return _pools;
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        return _positions[positionId];
    }

    function getPositionView(uint256 positionId) public view returns (PositionView memory v) {
        Position memory p = _positions[positionId];
        v.id = positionId;
        v.position = p;
        if (p.status != PositionStatus.Active) return v;

        v.owner = _positionNFT.ownerOf(positionId);
        uint256 acc = _currentAcc();
        v.pendingRewards = p.rewardsAccrued + RewardMath.earned(p.weight, acc, p.rewardPerWeightPaid);
        v.effectiveRouting = _effectiveRouting(positionId, v.owner);
        v.locked = block.timestamp < p.unlockTime;
        v.boostExpirable = !v.locked && p.activeMultiplierBps != BPS;
        if (block.timestamp < periodFinish && totalWeight > 0) {
            v.rewardPerSecond = Math.mulDiv(rewardRate, p.weight, totalWeight * RewardMath.RATE_PRECISION);
        }
    }

    /// @notice Positions owned by `owner`, paginated over the NFT owner index.
    function positionsOf(address owner, uint256 offset, uint256 limit)
        external
        view
        returns (PositionView[] memory views)
    {
        if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;
        uint256[] memory ids = _positionNFT.tokensOfOwner(owner, offset, limit);
        views = new PositionView[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            views[i] = getPositionView(ids[i]);
        }
    }

    function pendingRewards(uint256 positionId) external view returns (uint256) {
        Position storage p = _positions[positionId];
        if (p.status != PositionStatus.Active) return 0;
        return p.rewardsAccrued + RewardMath.earned(p.weight, _currentAcc(), p.rewardPerWeightPaid);
    }

    function effectiveRouting(uint256 positionId) external view returns (Routing memory) {
        if (_positions[positionId].status != PositionStatus.Active) {
            return Routing(RoutingMode.Keep, address(0), 0, address(0));
        }
        return _effectiveRouting(positionId, _positionNFT.ownerOf(positionId));
    }

    /// @notice Raw stored routing, including a stale configuration from a previous owner.
    function storedRouting(uint256 positionId) external view returns (Routing memory) {
        return _routing[positionId];
    }

    /// @notice What a new stake of `amount` into `poolId` would look like right now.
    /// @dev    `estimatedAprBps` assumes the current emission rate and total weight (including this stake)
    ///         persist for a year at the boosted multiplier. It is an estimate, not a promise.
    function previewStake(uint256 poolId, uint256 amount) external view returns (StakePreview memory s) {
        Pool storage pool = _pool(poolId);
        s.multiplierBps = pool.multiplierBps;
        s.lockDuration = pool.lockDuration;
        s.unlockTime = block.timestamp + pool.lockDuration;
        s.weight = RewardMath.weightOf(amount, pool.multiplierBps);
        s.streamEndsAt = periodFinish;
        if (amount == 0 || block.timestamp >= periodFinish) return s;

        uint256 newTotal = totalWeight + s.weight;
        s.rewardPerSecond = Math.mulDiv(rewardRate, s.weight, newTotal * RewardMath.RATE_PRECISION);
        s.estimatedAprBps =
            Math.mulDiv(rewardRate * RewardMath.YEAR, s.weight * BPS, newTotal * amount * RewardMath.RATE_PRECISION);
    }

    function previewEmergencyWithdraw(uint256 positionId) external view returns (EmergencyPreview memory preview) {
        Position memory p = _positions[positionId];
        if (p.status != PositionStatus.Active) return preview;
        p.rewardsAccrued += RewardMath.earned(p.weight, _currentAcc(), p.rewardPerWeightPaid).toUint128();
        return _emergencyPreviewMem(p);
    }

    function rewardState() external view returns (RewardState memory s) {
        s.rewardRate = rewardRate;
        s.periodFinish = periodFinish;
        s.lastUpdateTime = lastUpdateTime;
        s.accRewardPerWeight = _currentAcc();
        s.totalWeight = totalWeight;
        s.totalPrincipal = totalPrincipal;
        s.rewardReserve = rewardReserve;
        s.outstandingRewards = outstandingRewards + _pendingEmission();
        s.futureEmissions = block.timestamp < periodFinish
            ? RewardMath.emitted(rewardRate, periodFinish - Math.max(block.timestamp, lastUpdateTime))
            : 0;
        uint256 committed = s.outstandingRewards + s.futureEmissions;
        s.idleRewards = s.rewardReserve > committed ? s.rewardReserve - committed : 0;
    }

    function accountStats(address account) external view returns (AccountStats memory) {
        return _stats[account];
    }

    function compoundConfig() external view returns (CompoundConfig memory) {
        return _compoundConfig;
    }

    function paused() public view override(IFormaStaking, Pausable) returns (bool) {
        return super.paused();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                                 INTERNALS
    // ═══════════════════════════════════════════════════════════════════════

    function _lastApplicableTime() private view returns (uint256) {
        return Math.min(block.timestamp, periodFinish);
    }

    /// @dev Emission that `_updateGlobal` would add right now (view helper).
    function _pendingEmission() private view returns (uint256) {
        uint256 t = _lastApplicableTime();
        if (t <= lastUpdateTime || totalWeight == 0) return 0;
        return RewardMath.emitted(rewardRate, t - lastUpdateTime);
    }

    function _currentAcc() private view returns (uint256) {
        uint256 e = _pendingEmission();
        return e == 0 ? accRewardPerWeight : accRewardPerWeight + RewardMath.accDelta(e, totalWeight);
    }

    function _updateGlobal() private {
        uint256 t = _lastApplicableTime();
        uint256 last = lastUpdateTime;
        if (t <= last) return;
        uint256 w = totalWeight;
        if (w > 0) {
            uint256 e = RewardMath.emitted(rewardRate, t - last);
            if (e > 0) {
                accRewardPerWeight += RewardMath.accDelta(e, w);
                outstandingRewards += e;
            }
        }
        // With zero weight, time advances but nothing is emitted: those tokens stay idle in the reserve.
        lastUpdateTime = t;
    }

    function _settle(Position storage p) private {
        uint256 acc = accRewardPerWeight;
        uint256 e = RewardMath.earned(p.weight, acc, p.rewardPerWeightPaid);
        if (e > 0) p.rewardsAccrued += e.toUint128();
        p.rewardPerWeightPaid = acc;
    }

    /// @dev Global update + settle + boost expiry. Must precede any weight change.
    function _touch(uint256 positionId, Position storage p) private {
        _updateGlobal();
        _settle(p);
        if (p.activeMultiplierBps != BPS && block.timestamp >= p.unlockTime) {
            uint256 oldWeight = p.weight;
            p.activeMultiplierBps = uint16(BPS);
            _setPrincipal(p, p.principal);
            emit BoostExpired(positionId, oldWeight, p.weight);
        }
    }

    /// @dev Sets principal, recomputes weight at the active multiplier and updates global + pool totals.
    ///      Caller must have settled the position first.
    function _setPrincipal(Position storage p, uint256 newPrincipal) private {
        Pool storage pool = _pools[p.poolId];
        uint256 oldPrincipal = p.principal;
        uint256 oldWeight = p.weight;
        uint256 newWeight = RewardMath.weightOf(newPrincipal, p.activeMultiplierBps);

        totalPrincipal = totalPrincipal - oldPrincipal + newPrincipal;
        totalWeight = totalWeight - oldWeight + newWeight;
        pool.totalPrincipal = (uint256(pool.totalPrincipal) - oldPrincipal + newPrincipal).toUint128();
        pool.totalWeight = (uint256(pool.totalWeight) - oldWeight + newWeight).toUint128();

        p.principal = newPrincipal.toUint128();
        p.weight = newWeight.toUint128();
    }

    /// @dev Effects + events only; the caller performs the transfer after all state changes.
    function _bookRewardPayment(
        uint256 positionId,
        Position storage p,
        address owner,
        address to,
        uint256 amount,
        bool redirected
    ) private {
        p.rewardsAccrued -= amount.toUint128();
        p.lifetimeRewards += amount.toUint128();
        outstandingRewards -= amount;
        rewardReserve -= amount;
        _stats[owner].rewardsEarned += amount.toUint128();

        emit RewardClaimed(positionId, owner, to, amount);
        if (redirected) emit RewardRedirected(positionId, to, amount);
    }

    function _close(uint256 positionId, Position storage p, PositionStatus status) private {
        p.status = status;
        _pools[p.poolId].openPositions -= 1;
        delete _routing[positionId];
        _positionNFT.burn(positionId);
    }

    function _emergencyPreviewMem(Position memory p) private view returns (EmergencyPreview memory preview) {
        preview.principal = p.principal;
        preview.pendingForfeited = p.rewardsAccrued;
        if (!paused() && block.timestamp < p.unlockTime) {
            preview.penalty = RewardMath.bpsOf(p.principal, p.earlyExitPenaltyBps);
        }
        preview.amountOut = preview.principal - preview.penalty;
    }

    function _effectiveRouting(uint256 positionId, address owner) private view returns (Routing memory r) {
        r = _routing[positionId];
        // Routing set by a previous owner never applies to the current one (see PROTOCOL.md §8.3).
        if (r.configuredBy != owner) r = Routing(RoutingMode.Keep, address(0), 0, address(0));
    }

    function _activePosition(uint256 positionId) private view returns (Position storage p) {
        p = _positions[positionId];
        if (p.status != PositionStatus.Active) revert PositionNotActive(positionId);
    }

    function _requireOwner(uint256 positionId) private view {
        if (_positionNFT.ownerOf(positionId) != msg.sender) revert NotPositionOwner(positionId);
    }

    function _pool(uint256 poolId) private view returns (Pool storage) {
        if (poolId >= _pools.length) revert InvalidPool(poolId);
        return _pools[poolId];
    }

    function _checkCap(Pool storage pool, uint256 poolId, uint256 amount) private view {
        uint256 cap = pool.maxTotalPrincipal;
        if (cap != 0 && uint256(pool.totalPrincipal) + amount > cap) revert PoolCapExceeded(poolId);
    }

    /// @dev Rejects fee-on-transfer / rebasing behaviour: the protocol must receive exactly `amount`.
    function _pullExact(address from, uint256 amount) private {
        uint256 before = _stakingToken.balanceOf(address(this));
        _stakingToken.safeTransferFrom(from, address(this), amount);
        if (_stakingToken.balanceOf(address(this)) - before != amount) revert UnsupportedTokenTransfer();
    }

    function _validatePoolParams(PoolParams calldata params) private pure {
        bytes memory name = bytes(params.name);
        if (name.length == 0 || name.length > MAX_NAME_LENGTH) revert InvalidName();
        // Restricted charset keeps names safe to embed verbatim in NFT JSON/SVG metadata.
        for (uint256 i; i < name.length; ++i) {
            bytes1 c = name[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == " " || c == "-";
            if (!ok) revert InvalidName();
        }
        if (params.lockDuration > MAX_LOCK_DURATION) revert InvalidLockDuration();
        if (params.multiplierBps < MIN_MULTIPLIER_BPS || params.multiplierBps > MAX_MULTIPLIER_BPS) {
            revert InvalidMultiplier();
        }
        if (params.earlyExitPenaltyBps > MAX_EARLY_EXIT_PENALTY_BPS) revert InvalidPenalty();
        // A boost is a reward for being locked: no lock ⇒ no boost and no (inapplicable) penalty.
        if (params.lockDuration == 0) {
            if (params.multiplierBps != MIN_MULTIPLIER_BPS) revert InvalidMultiplier();
            if (params.earlyExitPenaltyBps != 0) revert InvalidPenalty();
        }
        if (params.minStake == 0) revert ZeroAmount();
        if (params.maxTotalPrincipal != 0 && params.maxTotalPrincipal < params.minStake) revert InvalidCap();
    }

    function _writePoolParams(Pool storage pool, PoolParams calldata params) private {
        pool.name = params.name;
        pool.lockDuration = params.lockDuration;
        pool.multiplierBps = params.multiplierBps;
        pool.earlyExitPenaltyBps = params.earlyExitPenaltyBps;
        pool.minStake = params.minStake;
        pool.maxTotalPrincipal = params.maxTotalPrincipal;
    }

    function _setCompoundConfig(CompoundConfig memory cfg) private {
        if (cfg.keeperFeeBps > MAX_KEEPER_FEE_BPS) revert InvalidKeeperFee();
        if (cfg.keeperCooldown < MIN_KEEPER_COOLDOWN || cfg.keeperCooldown > MAX_KEEPER_COOLDOWN) {
            revert InvalidCooldown();
        }
        _compoundConfig = cfg;
        emit CompoundConfigUpdated(cfg.keeperFeeBps, cfg.keeperCooldown, cfg.minCompoundAmount);
    }
}
