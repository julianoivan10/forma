// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFormaStaking} from "../../src/interfaces/IFormaStaking.sol";
import {Base} from "../utils/Base.t.sol";

contract LockBoostTest is Base {
    uint256 internal constant DAILY = 1000 * ONE;
    uint256 internal constant TOL = 1e9;

    function setUp() public override {
        super.setUp();
        _fund(100_000 * ONE, 100 days);
    }

    function test_boostActiveWhileLocked() public {
        uint256 id = _stake(alice, BUILDER, 100 * ONE);
        _skip(29 days);
        PositionView memory v = staking.getPositionView(id);
        assertTrue(v.locked);
        assertFalse(v.boostExpirable);
        assertEq(v.position.activeMultiplierBps, 12_500);
    }

    function test_expireBoost_permissionlessAfterUnlock() public {
        uint256 id = _stake(alice, BUILDER, 100 * ONE);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.BoostNotExpirable.selector, id));
        staking.expireBoost(id);

        _skip(30 days);
        assertTrue(staking.getPositionView(id).boostExpirable);
        vm.expectEmit(address(staking));
        emit IFormaStaking.BoostExpired(id, 125 * ONE, 100 * ONE);
        vm.prank(attacker); // anyone can kick
        staking.expireBoost(id);

        Position memory p = _pos(id);
        assertEq(p.activeMultiplierBps, 10_000);
        assertEq(p.multiplierBps, 12_500, "historical multiplier kept");
        assertEq(p.weight, 100 * ONE);
        assertEq(staking.totalWeight(), 100 * ONE);
        assertEq(staking.getPool(BUILDER).totalWeight, 100 * ONE);

        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.BoostNotExpirable.selector, id));
        staking.expireBoost(id);
    }

    function test_expireBoost_genesisNeverExpirable() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        _skip(1 days);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.BoostNotExpirable.selector, id));
        staking.expireBoost(id);
    }

    function test_expiry_preservesEarnedRewardsAndLowersFutureShare() public {
        uint256 locked = _stake(alice, CALIBRATION, 1000 * ONE); // 1.10x, 1h lock
        uint256 open = _stake(bob, GENESIS, 1000 * ONE);
        _skip(1 hours);
        uint256 earnedBefore = _pending(locked);
        staking.expireBoost(locked);
        assertEq(_pending(locked), earnedBefore, "kick does not change earned rewards");

        _skip(1 days);
        // After the kick both have weight 1000 → equal share.
        assertApproxEqAbs(_pending(locked) - earnedBefore, _pending(open) - (DAILY / 24) * 1000 / 2100, TOL * 10);
    }

    function test_boostGrace_untilTouched_isDocumentedBehaviour() public {
        // Documented limitation (PROTOCOL.md §4.3): the boost persists after unlock until touched/kicked.
        uint256 id = _stake(alice, CALIBRATION, 1000 * ONE);
        uint256 other = _stake(bob, GENESIS, 1000 * ONE);
        _skip(1 hours + 1 days);
        // Without a kick Alice still earned 1.10 / 2.10 of the full period.
        assertApproxEqAbs(_pending(id), (DAILY + DAILY / 24) * 1100 / 2100, TOL * 10);
        assertApproxEqAbs(_pending(other), (DAILY + DAILY / 24) * 1000 / 2100, TOL * 10);
    }

    function test_claimTouches_expiresBoost() public {
        uint256 id = _stake(alice, CONVICTION, 100 * ONE);
        _skip(90 days);
        vm.prank(alice);
        staking.claim(id);
        assertEq(_pos(id).activeMultiplierBps, 10_000);
    }

    function test_lockBoundary_oneSecondBefore() public {
        uint256 id = _stake(alice, LONG_FORGE, 100 * ONE);
        uint256 unlock = _pos(id).unlockTime;
        vm.warp(unlock - 1);
        assertTrue(staking.getPositionView(id).locked);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.BoostNotExpirable.selector, id));
        staking.expireBoost(id);
        vm.warp(unlock);
        assertFalse(staking.getPositionView(id).locked);
        staking.expireBoost(id);
    }

    function test_compoundWhileLocked_staysLocked() public {
        uint256 id = _stake(alice, CONVICTION, 100 * ONE);
        _skip(10 days);
        vm.prank(alice);
        (uint256 compounded,) = staking.compound(id);
        Position memory p = _pos(id);
        assertEq(p.principal, 100 * ONE + compounded);
        assertEq(p.unlockTime, p.startTime + 90 days, "lock unchanged");
        assertEq(p.weight, (100 * ONE + compounded) * 17_500 / BPS, "compounded at active multiplier");
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PositionLocked.selector, p.unlockTime));
        vm.prank(alice);
        staking.withdraw(id, compounded);
    }
}
