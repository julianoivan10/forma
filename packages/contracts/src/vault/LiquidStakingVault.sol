// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IFormaStaking, IFormaTypes} from "../interfaces/IFormaStaking.sol";

/// @title LiquidStakingVault (stFORGE)
/// @notice ERC-4626 vault that keeps deposited FORGE staked in a single zero-lock FormaStaking position and
///         compounds its rewards. The exchange rate (assets per share) rises as rewards accrue.
///         stFORGE is NOT risk-free: it depends on FormaStaking solvency and reward funding. TESTNET ONLY.
/// @dev    Security notes (PROTOCOL.md §10):
///         - `totalAssets` uses internal accounting, never `balanceOf(this)` → direct donations are ignored.
///         - `_decimalsOffset() = 6` → virtual shares make first-depositor inflation unprofitable.
///         - The first deposit must meet the pool's `minStake`.
///         - Zero-share deposits and zero-asset redemptions revert.
///         - `max*` return 0 whenever the underlying action would revert for protocol-state reasons.
contract LiquidStakingVault is ERC4626, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant EMERGENCY_EXIT_DELAY = 3 days;

    IFormaStaking public immutable staking;
    uint256 public immutable vaultPoolId;

    /// @notice The vault's FormaStaking position (0 = none open).
    uint256 public positionId;
    /// @notice True once `emergencyExit` has run. Terminal.
    bool public exited;
    uint256 private _idleAssets;

    event VaultHarvested(uint256 indexed positionId, uint256 compounded);
    event VaultEmergencyExit(address indexed caller, uint256 indexed positionId, uint256 recovered);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroShares();
    error ZeroAssets();
    error AssetMismatch();
    error PoolNotLiquid();
    error SlippageExceeded(uint256 actual, uint256 limit);
    error VaultExited();
    error StakingNotPaused();
    error EmergencyExitTooEarly(uint256 availableAt);

    constructor(IERC20 asset_, IFormaStaking staking_, uint256 vaultPoolId_, address admin)
        ERC20("Staked FORGE (Forma testnet)", "stFORGE")
        ERC4626(asset_)
    {
        if (address(asset_) == address(0) || address(staking_) == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        if (staking_.stakingToken() != address(asset_)) revert AssetMismatch();
        if (staking_.getPool(vaultPoolId_).lockDuration != 0) revert PoolNotLiquid();
        staking = staking_;
        vaultPoolId = vaultPoolId_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─── ERC-4626 accounting ───────────────────────────────────────────────

    function totalAssets() public view override returns (uint256 assets) {
        assets = _idleAssets;
        uint256 id = positionId;
        if (id != 0) {
            assets += staking.getPosition(id).principal + staking.pendingRewards(id);
        }
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (exited || staking.paused()) return 0;
        IFormaTypes.Pool memory pool = staking.getPool(vaultPoolId);
        if (!pool.active) return 0;
        // A new position would inherit a lock if the pool was reconfigured; the vault refuses that.
        if (positionId == 0 && pool.lockDuration != 0) return 0;
        if (pool.maxTotalPrincipal == 0) return type(uint256).max;
        return pool.maxTotalPrincipal > pool.totalPrincipal ? pool.maxTotalPrincipal - pool.totalPrincipal : 0;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 maxAssets = maxDeposit(receiver);
        return maxAssets == type(uint256).max ? type(uint256).max : _convertToShares(maxAssets, Math.Rounding.Floor);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        if (!exited && staking.paused()) return 0;
        return super.maxWithdraw(owner);
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        if (!exited && staking.paused()) return 0;
        return super.maxRedeem(owner);
    }

    // ─── slippage-protected entry points ───────────────────────────────────

    function depositWithMin(uint256 assets, address receiver, uint256 minShares) external returns (uint256 shares) {
        shares = deposit(assets, receiver);
        if (shares < minShares) revert SlippageExceeded(shares, minShares);
    }

    function redeemWithMin(uint256 shares, address receiver, address owner, uint256 minAssets)
        external
        returns (uint256 assets)
    {
        assets = redeem(shares, receiver, owner);
        if (assets < minAssets) revert SlippageExceeded(assets, minAssets);
    }

    // ─── maintenance ───────────────────────────────────────────────────────

    /// @notice Compound the vault position's pending rewards (fee-free; the vault is the owner). Permissionless.
    function harvest() external nonReentrant returns (uint256 compounded) {
        compounded = _harvest();
    }

    /// @notice Leave FormaStaking during an incident. Only while FormaStaking is paused: by admin at any time,
    ///         or by anyone once the pause has lasted `EMERGENCY_EXIT_DELAY`. Forfeits pending rewards (no
    ///         penalty applies: zero-lock position, protocol paused). Afterwards redemptions are paid from idle.
    function emergencyExit() external nonReentrant {
        if (exited) revert VaultExited();
        if (!staking.paused()) revert StakingNotPaused();
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            uint256 availableAt = uint256(staking.pausedAt()) + EMERGENCY_EXIT_DELAY;
            if (block.timestamp < availableAt) revert EmergencyExitTooEarly(availableAt);
        }
        exited = true;
        uint256 id = positionId;
        uint256 recovered = 0;
        if (id != 0) {
            positionId = 0;
            recovered = staking.emergencyWithdraw(id);
            _idleAssets += recovered;
        }
        emit VaultEmergencyExit(msg.sender, id, recovered);
    }

    /// @notice Assets redeemable for one whole share (UI helper).
    function exchangeRate() external view returns (uint256) {
        return convertToAssets(10 ** decimals());
    }

    function idleAssets() external view returns (uint256) {
        return _idleAssets;
    }

    // ─── internals ─────────────────────────────────────────────────────────

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override nonReentrant {
        if (assets == 0) revert ZeroAmount();
        if (shares == 0) revert ZeroShares();
        if (exited) revert VaultExited();
        super._deposit(caller, receiver, assets, shares);

        IERC20(asset()).forceApprove(address(staking), assets);
        uint256 id = positionId;
        if (id == 0) {
            IFormaTypes.Pool memory pool = staking.getPool(vaultPoolId);
            // expectedLockDuration = 0: never open a locked position on depositors' behalf.
            positionId = staking.stake(vaultPoolId, assets, 0, pool.multiplierBps);
        } else {
            staking.increasePosition(id, assets);
        }
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        if (assets == 0) revert ZeroAssets();
        if (shares == 0) revert ZeroShares();
        if (exited) {
            _idleAssets -= assets;
        } else {
            _harvest();
            uint256 id = positionId;
            if (assets == staking.getPosition(id).principal) positionId = 0;
            // After `_harvest` nothing is pending, but any reward paid on close is kept as idle assets
            // (it is already counted in `totalAssets` via `pendingRewards`) rather than stranded.
            uint256 rewardsPaid = staking.withdraw(id, assets);
            if (rewardsPaid > 0) _idleAssets += rewardsPaid;
        }
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _harvest() private returns (uint256 compounded) {
        uint256 id = positionId;
        if (exited || id == 0 || staking.pendingRewards(id) == 0) return 0;
        // The vault is the owner, so the keeper fee is always zero.
        (compounded,) = staking.compound(id);
        emit VaultHarvested(id, compounded);
    }
}
