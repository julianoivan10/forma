// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";

import {FormaStaking} from "../../src/FormaStaking.sol";
import {IFormaTypes} from "../../src/interfaces/IFormaStaking.sol";
import {IPositionNFT} from "../../src/interfaces/IPositionNFT.sol";
import {PositionNFT} from "../../src/nft/PositionNFT.sol";
import {PositionRenderer} from "../../src/nft/PositionRenderer.sol";
import {ForgeToken} from "../../src/token/ForgeToken.sol";
import {LiquidStakingVault} from "../../src/vault/LiquidStakingVault.sol";

/// @notice Shared fixture: full protocol with the default testnet pool table.
abstract contract Base is Test, IFormaTypes {
    uint256 internal constant GENESIS = 0;
    uint256 internal constant BUILDER = 1;
    uint256 internal constant CONVICTION = 2;
    uint256 internal constant LONG_FORGE = 3;
    uint256 internal constant CALIBRATION = 4;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant ONE = 1e18;
    uint256 internal constant REWARD_DURATION = 30 days;

    ForgeToken internal forge;
    PositionNFT internal nft;
    FormaStaking internal staking;
    PositionRenderer internal renderer;
    LiquidStakingVault internal vault;

    address internal admin = makeAddr("admin");
    address internal poolManager = makeAddr("poolManager");
    address internal rewardManager = makeAddr("rewardManager");
    address internal pauser = makeAddr("pauser");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal keeper = makeAddr("keeper");
    address internal attacker = makeAddr("attacker");

    function setUp() public virtual {
        vm.warp(1_750_000_000);
        forge = new ForgeToken(admin);
        (nft, staking) = _deployCore(IERC20(address(forge)));
        renderer = new PositionRenderer(staking);

        vm.startPrank(admin);
        nft.setRenderer(renderer);
        staking.grantRole(staking.POOL_MANAGER_ROLE(), poolManager);
        staking.grantRole(staking.REWARD_MANAGER_ROLE(), rewardManager);
        staking.grantRole(staking.PAUSER_ROLE(), pauser);
        forge.grantRole(forge.MINTER_ROLE(), admin);
        vm.stopPrank();

        _createDefaultPools();
        vault = new LiquidStakingVault(IERC20(address(forge)), staking, GENESIS, admin);

        address[6] memory users = [alice, bob, carol, keeper, attacker, rewardManager];
        for (uint256 i; i < users.length; ++i) {
            _mint(users[i], 10_000_000 * ONE);
            vm.prank(users[i]);
            forge.approve(address(staking), type(uint256).max);
            vm.prank(users[i]);
            forge.approve(address(vault), type(uint256).max);
        }
    }

    function _deployCore(IERC20 token) internal returns (PositionNFT nft_, FormaStaking staking_) {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        nft_ = new PositionNFT(predicted, admin);
        staking_ = new FormaStaking(
            token,
            IPositionNFT(address(nft_)),
            admin,
            CompoundConfig({keeperFeeBps: 100, keeperCooldown: 1 hours, minCompoundAmount: uint128(ONE)})
        );
        assertEq(address(staking_), predicted, "staking address prediction");
    }

    function _createDefaultPools() internal {
        vm.startPrank(poolManager);
        staking.createPool(_params("Genesis", 0, 10_000, 0));
        staking.createPool(_params("Builder", 30 days, 12_500, 500));
        staking.createPool(_params("Conviction", 90 days, 17_500, 1000));
        staking.createPool(_params("Long Forge", 180 days, 25_000, 1500));
        staking.createPool(_params("Calibration", 1 hours, 11_000, 200));
        vm.stopPrank();
    }

    function _params(string memory name, uint64 lock, uint16 mult, uint16 penalty)
        internal
        pure
        returns (PoolParams memory)
    {
        return PoolParams({
            name: name,
            lockDuration: lock,
            multiplierBps: mult,
            earlyExitPenaltyBps: penalty,
            minStake: uint128(ONE),
            maxTotalPrincipal: 0
        });
    }

    // ─── helpers ───────────────────────────────────────────────────────────

    /// @dev Use instead of `block.timestamp` in tests: via-IR may cache `block.timestamp` across `vm.warp`.
    function _now() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    function _skip(uint256 dt) internal {
        vm.warp(vm.getBlockTimestamp() + dt);
    }

    /// @dev Stake with explicit terms (no pre-call), for use right after `vm.expectRevert`.
    function _stakeRaw(address user, uint256 poolId, uint256 amount, uint64 lock, uint16 mult)
        internal
        returns (uint256 id)
    {
        vm.prank(user);
        id = staking.stake(poolId, amount, lock, mult);
    }

    function _mint(address to, uint256 amount) internal {
        vm.prank(admin);
        forge.mint(to, amount);
    }

    function _stake(address user, uint256 poolId, uint256 amount) internal returns (uint256 id) {
        Pool memory pool = staking.getPool(poolId);
        vm.prank(user);
        id = staking.stake(poolId, amount, pool.lockDuration, pool.multiplierBps);
    }

    function _fund(uint256 amount, uint256 duration) internal {
        vm.prank(rewardManager);
        staking.notifyRewards(amount, duration);
    }

    function _pos(uint256 id) internal view returns (Position memory) {
        return staking.getPosition(id);
    }

    function _pending(uint256 id) internal view returns (uint256) {
        return staking.pendingRewards(id);
    }

    function _setRouting(address owner, uint256 id, RoutingMode mode, address recipient, uint16 maxFee) internal {
        vm.prank(owner);
        staking.setRouting(id, mode, recipient, maxFee);
    }

    /// @dev Checks the core solvency relations from PROTOCOL.md §5.5.
    function _assertSolvent() internal view {
        RewardState memory s = staking.rewardState();
        assertGe(forge.balanceOf(address(staking)), s.totalPrincipal + s.rewardReserve, "balance >= principal+reserve");
        assertGe(s.rewardReserve, s.outstandingRewards + s.futureEmissions, "reserve >= owed + future");
    }
}
