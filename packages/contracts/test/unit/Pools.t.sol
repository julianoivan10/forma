// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {IFormaStaking} from "../../src/interfaces/IFormaStaking.sol";
import {Base} from "../utils/Base.t.sol";

contract PoolsTest is Base {
    function test_defaultPools() public view {
        assertEq(staking.poolCount(), 5);
        Pool memory conviction = staking.getPool(CONVICTION);
        assertEq(conviction.name, "Conviction");
        assertEq(conviction.lockDuration, 90 days);
        assertEq(conviction.multiplierBps, 17_500);
        assertEq(conviction.earlyExitPenaltyBps, 1000);
        assertTrue(conviction.active);
    }

    function test_createPool_onlyPoolManager() public {
        PoolParams memory p = _params("Rogue", 10 days, 12_000, 0);
        bytes32 role = staking.POOL_MANAGER_ROLE();
        address[3] memory notAllowed = [attacker, admin, rewardManager];
        for (uint256 i; i < notAllowed.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, notAllowed[i], role)
            );
            vm.prank(notAllowed[i]);
            staking.createPool(p);
        }
    }

    function test_createPool_emitsAndStores() public {
        vm.expectEmit(address(staking));
        emit IFormaStaking.PoolCreated(5, "Sprint", 7 days, 11_500, 300);
        vm.prank(poolManager);
        uint256 id = staking.createPool(_params("Sprint", 7 days, 11_500, 300));
        assertEq(id, 5);
        assertEq(staking.getPool(5).lockDuration, 7 days);
    }

    function test_createPool_boundsChecked() public {
        vm.startPrank(poolManager);
        vm.expectRevert(IFormaStaking.InvalidLockDuration.selector);
        staking.createPool(_params("X", uint64(731 days), 12_000, 0));

        vm.expectRevert(IFormaStaking.InvalidMultiplier.selector);
        staking.createPool(_params("X", 30 days, 9999, 0));

        vm.expectRevert(IFormaStaking.InvalidMultiplier.selector);
        staking.createPool(_params("X", 30 days, 50_001, 0));

        vm.expectRevert(IFormaStaking.InvalidPenalty.selector);
        staking.createPool(_params("X", 30 days, 12_000, 2501));

        // No lock ⇒ no boost and no penalty.
        vm.expectRevert(IFormaStaking.InvalidMultiplier.selector);
        staking.createPool(_params("X", 0, 12_000, 0));
        vm.expectRevert(IFormaStaking.InvalidPenalty.selector);
        staking.createPool(_params("X", 0, 10_000, 100));

        PoolParams memory p = _params("X", 30 days, 12_000, 0);
        p.minStake = 0;
        vm.expectRevert(IFormaStaking.ZeroAmount.selector);
        staking.createPool(p);

        p.minStake = uint128(10 * ONE);
        p.maxTotalPrincipal = uint128(ONE);
        vm.expectRevert(IFormaStaking.InvalidCap.selector);
        staking.createPool(p);
        vm.stopPrank();
    }

    function test_createPool_nameValidation() public {
        vm.startPrank(poolManager);
        vm.expectRevert(IFormaStaking.InvalidName.selector);
        staking.createPool(_params("", 1 days, 11_000, 0));
        vm.expectRevert(IFormaStaking.InvalidName.selector);
        staking.createPool(_params("ThisNameIsWayTooLongForAPoolLabel!", 1 days, 11_000, 0));
        // Characters that could break JSON/SVG metadata are rejected.
        string[4] memory bad = ['Bad"Name', "Bad<Name", "Bad&Name", "Bad\\Name"];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(IFormaStaking.InvalidName.selector);
            staking.createPool(_params(bad[i], 1 days, 11_000, 0));
        }
        staking.createPool(_params("Ok Name-2", 1 days, 11_000, 0));
        vm.stopPrank();
    }

    function test_createPool_maxPools() public {
        vm.startPrank(poolManager);
        for (uint256 i = staking.poolCount(); i < 16; ++i) {
            staking.createPool(_params("Filler", 1 days, 11_000, 0));
        }
        vm.expectRevert(IFormaStaking.TooManyPools.selector);
        staking.createPool(_params("Overflow", 1 days, 11_000, 0));
        vm.stopPrank();
    }

    function test_invalidPoolId_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.InvalidPool.selector, 99));
        staking.getPool(99);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.InvalidPool.selector, 99));
        vm.prank(alice);
        staking.stake(99, ONE, 0, 10_000);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.InvalidPool.selector, 99));
        vm.prank(poolManager);
        staking.setPoolActive(99, false);
    }

    function test_updatePool_doesNotChangeExistingPositions() public {
        uint256 id = _stake(alice, CONVICTION, 1000 * ONE);
        Position memory before = _pos(id);

        vm.prank(poolManager);
        staking.updatePool(CONVICTION, _params("Conviction", 10 days, 40_000, 2500));

        Position memory afterUpdate = _pos(id);
        assertEq(afterUpdate.unlockTime, before.unlockTime, "unlock snapshot");
        assertEq(afterUpdate.multiplierBps, 17_500, "multiplier snapshot");
        assertEq(afterUpdate.activeMultiplierBps, 17_500, "active multiplier");
        assertEq(afterUpdate.earlyExitPenaltyBps, 1000, "penalty snapshot");
        assertEq(afterUpdate.weight, before.weight, "weight");

        // New positions get the new terms.
        uint256 id2 = _stake(bob, CONVICTION, 1000 * ONE);
        assertEq(_pos(id2).multiplierBps, 40_000);
        assertEq(_pos(id2).unlockTime, _now() + 10 days);
    }

    function test_stake_revertsWhenTermsChangedSincePreview() public {
        Pool memory pool = staking.getPool(BUILDER);
        vm.prank(poolManager);
        staking.updatePool(BUILDER, _params("Builder", 30 days, 11_000, 500));

        vm.expectRevert(IFormaStaking.PoolTermsChanged.selector);
        vm.prank(alice);
        staking.stake(BUILDER, 100 * ONE, pool.lockDuration, pool.multiplierBps);

        vm.prank(poolManager);
        staking.updatePool(BUILDER, _params("Builder", 60 days, 12_500, 500));
        vm.expectRevert(IFormaStaking.PoolTermsChanged.selector);
        vm.prank(alice);
        staking.stake(BUILDER, 100 * ONE, pool.lockDuration, pool.multiplierBps);
    }

    function test_inactivePool_blocksNewCapital() public {
        vm.prank(poolManager);
        staking.setPoolActive(BUILDER, false);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PoolInactive.selector, BUILDER));
        _stakeRaw(alice, BUILDER, 100 * ONE, 30 days, 12_500);

        vm.prank(poolManager);
        staking.setPoolActive(BUILDER, true);
        _stake(alice, BUILDER, 100 * ONE);
    }

    function test_poolCap_enforcedOnNewCapitalOnly() public {
        PoolParams memory p = _params("Capped", 1 days, 11_000, 0);
        p.maxTotalPrincipal = uint128(1000 * ONE);
        vm.prank(poolManager);
        uint256 capped = staking.createPool(p);

        uint256 id = _stake(alice, capped, 900 * ONE);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PoolCapExceeded.selector, capped));
        _stakeRaw(bob, capped, 101 * ONE, 1 days, 11_000);
        _stake(bob, capped, 100 * ONE);
        assertEq(staking.getPool(capped).totalPrincipal, 1000 * ONE);

        // Compounding may exceed the cap (it is not new capital).
        _fund(1000 * ONE, 1 days);
        _skip(1 hours);
        vm.prank(alice);
        staking.compound(id);
        assertGt(staking.getPool(capped).totalPrincipal, 1000 * ONE);
    }

    function test_minStake() public {
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.BelowMinStake.selector, ONE));
        _stakeRaw(alice, GENESIS, ONE - 1, 0, 10_000);
    }
}
