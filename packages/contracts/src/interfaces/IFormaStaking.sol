// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Shared types for the Forma protocol. See docs/PROTOCOL.md for semantics.
interface IFormaTypes {
    enum PositionStatus {
        None,
        Active,
        Closed,
        EmergencyClosed
    }

    enum RoutingMode {
        Keep,
        Compound,
        Redirect
    }

    struct Pool {
        string name;
        uint64 lockDuration;
        uint16 multiplierBps;
        uint16 earlyExitPenaltyBps;
        bool active;
        uint128 minStake;
        uint128 maxTotalPrincipal;
        uint128 totalPrincipal;
        uint128 totalWeight;
        uint32 openPositions;
    }

    /// @notice Mutable pool parameters supplied by the pool manager.
    struct PoolParams {
        string name;
        uint64 lockDuration;
        uint16 multiplierBps;
        uint16 earlyExitPenaltyBps;
        uint128 minStake;
        uint128 maxTotalPrincipal;
    }

    struct Position {
        uint128 principal;
        uint128 weight;
        uint64 startTime;
        uint64 unlockTime;
        uint32 poolId;
        uint16 multiplierBps;
        uint16 activeMultiplierBps;
        uint16 earlyExitPenaltyBps;
        PositionStatus status;
        uint64 lastThirdPartyCompound;
        uint32 compoundCount;
        uint256 rewardPerWeightPaid;
        uint128 rewardsAccrued;
        uint128 lifetimeRewards;
    }

    struct Routing {
        RoutingMode mode;
        address recipient;
        uint16 maxKeeperFeeBps;
        address configuredBy;
    }

    struct AccountStats {
        uint64 firstStakeAt;
        uint32 positionsOpened;
        uint32 positionsMatured;
        uint32 compounds;
        uint64 longestLock;
        uint128 rewardsEarned;
    }

    struct CompoundConfig {
        uint16 keeperFeeBps;
        uint64 keeperCooldown;
        uint128 minCompoundAmount;
    }

    /// @notice Aggregated view of a position for frontends and the NFT renderer.
    struct PositionView {
        uint256 id;
        address owner;
        Position position;
        uint256 pendingRewards;
        Routing effectiveRouting;
        bool locked;
        bool boostExpirable;
        uint256 rewardPerSecond; // FORGE wei/sec at the current emission rate and total weight
    }

    struct StakePreview {
        uint256 weight;
        uint256 multiplierBps;
        uint256 lockDuration;
        uint256 unlockTime;
        uint256 rewardPerSecond; // FORGE wei/sec this position would receive at the current rate
        uint256 estimatedAprBps; // annualised, assumes current emission + total weight persist
        uint256 streamEndsAt;
    }

    struct EmergencyPreview {
        uint256 principal;
        uint256 pendingForfeited;
        uint256 penalty;
        uint256 amountOut;
    }

    struct RewardState {
        uint256 rewardRate; // tokens/sec * RATE_PRECISION
        uint256 periodFinish;
        uint256 lastUpdateTime;
        uint256 accRewardPerWeight;
        uint256 totalWeight;
        uint256 totalPrincipal;
        uint256 rewardReserve;
        uint256 outstandingRewards;
        uint256 futureEmissions;
        uint256 idleRewards;
    }
}

interface IFormaStaking is IFormaTypes {
    // ─── events ────────────────────────────────────────────────────────────
    event PoolCreated(
        uint256 indexed poolId, string name, uint64 lockDuration, uint16 multiplierBps, uint16 penaltyBps
    );
    event PoolUpdated(
        uint256 indexed poolId, string name, uint64 lockDuration, uint16 multiplierBps, uint16 penaltyBps
    );
    event PoolActiveSet(uint256 indexed poolId, bool active);
    event Stake(
        uint256 indexed positionId,
        address indexed owner,
        uint256 indexed poolId,
        uint256 amount,
        uint256 unlockTime,
        uint256 multiplierBps
    );
    event PositionIncreased(uint256 indexed positionId, address indexed owner, uint256 amount);
    event Unstake(uint256 indexed positionId, address indexed owner, uint256 amount, bool closed);
    event RewardClaimed(uint256 indexed positionId, address indexed owner, address indexed to, uint256 amount);
    event RewardRedirected(uint256 indexed positionId, address indexed recipient, uint256 amount);
    event RewardRedirectConfigured(
        uint256 indexed positionId, RoutingMode mode, address indexed recipient, uint16 maxKeeperFeeBps
    );
    event Compound(uint256 indexed positionId, address indexed caller, uint256 compounded, uint256 keeperFee);
    event BoostExpired(uint256 indexed positionId, uint256 oldWeight, uint256 newWeight);
    event EmergencyWithdraw(
        uint256 indexed positionId, address indexed owner, uint256 amountOut, uint256 penalty, uint256 rewardsForfeited
    );
    event RewardsFunded(
        address indexed funder, uint256 amount, uint256 duration, uint256 rewardRate, uint256 periodFinish
    );
    event CompoundConfigUpdated(uint16 keeperFeeBps, uint64 keeperCooldown, uint128 minCompoundAmount);
    event ERC20Recovered(address indexed token, address indexed to, uint256 amount);

    // ─── errors ────────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroAmount();
    error InvalidPool(uint256 poolId);
    error PoolInactive(uint256 poolId);
    error PoolCapExceeded(uint256 poolId);
    error TooManyPools();
    error InvalidLockDuration();
    error InvalidMultiplier();
    error InvalidPenalty();
    error InvalidName();
    error InvalidCap();
    error BelowMinStake(uint256 minStake);
    error PoolTermsChanged();
    error PositionNotActive(uint256 positionId);
    error NotPositionOwner(uint256 positionId);
    error NotAuthorizedToClaim(uint256 positionId);
    error PositionLocked(uint256 unlockTime);
    error InsufficientPrincipal();
    error NothingToClaim();
    error NothingToCompound();
    error CompoundNotAuthorized(uint256 positionId);
    error CompoundTooSmall(uint256 minAmount);
    error CompoundCooldown(uint256 availableAt);
    error InvalidRouting();
    error InvalidKeeperFee();
    error InvalidCooldown();
    error InvalidRewardDuration();
    error NoRewardBudget();
    error CannotRecoverStakingToken();
    error BoostNotExpirable(uint256 positionId);

    // ─── user actions ──────────────────────────────────────────────────────
    function stake(uint256 poolId, uint256 amount, uint64 expectedLockDuration, uint16 expectedMultiplierBps)
        external
        returns (uint256 positionId);
    function increasePosition(uint256 positionId, uint256 amount) external;
    function withdraw(uint256 positionId, uint256 amount) external returns (uint256 rewardsPaid);
    function claim(uint256 positionId) external returns (uint256 amount);
    function compound(uint256 positionId) external returns (uint256 compounded, uint256 keeperFee);
    function emergencyWithdraw(uint256 positionId) external returns (uint256 amountOut);
    function setRouting(uint256 positionId, RoutingMode mode, address recipient, uint16 maxKeeperFeeBps) external;
    function expireBoost(uint256 positionId) external;

    // ─── views ─────────────────────────────────────────────────────────────
    function stakingToken() external view returns (address);
    function positionNFT() external view returns (address);
    function poolCount() external view returns (uint256);
    function getPool(uint256 poolId) external view returns (Pool memory);
    function getPosition(uint256 positionId) external view returns (Position memory);
    function getPositionView(uint256 positionId) external view returns (PositionView memory);
    function pendingRewards(uint256 positionId) external view returns (uint256);
    function effectiveRouting(uint256 positionId) external view returns (Routing memory);
    function previewStake(uint256 poolId, uint256 amount) external view returns (StakePreview memory);
    function previewEmergencyWithdraw(uint256 positionId) external view returns (EmergencyPreview memory);
    function rewardState() external view returns (RewardState memory);
    function positionsOf(address owner, uint256 offset, uint256 limit) external view returns (PositionView[] memory);
    function accountStats(address account) external view returns (AccountStats memory);
    function paused() external view returns (bool);
    function pausedAt() external view returns (uint64);
}
