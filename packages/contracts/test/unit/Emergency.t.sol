// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFormaStaking} from "../../src/interfaces/IFormaStaking.sol";
import {Base} from "../utils/Base.t.sol";

contract EmergencyTest is Base {
    function setUp() public override {
        super.setUp();
        _fund(30_000 * ONE, 30 days);
    }

    function test_emergency_whileLocked_appliesPenaltyAndForfeitsRewards() public {
        uint256 id = _stake(alice, CONVICTION, 1000 * ONE);
        _stake(bob, GENESIS, 1000 * ONE);
        _skip(5 days);

        EmergencyPreview memory pv = staking.previewEmergencyWithdraw(id);
        assertEq(pv.principal, 1000 * ONE);
        assertGt(pv.pendingForfeited, 0);
        assertEq(pv.penalty, 100 * ONE, "10% penalty");
        assertEq(pv.amountOut, 900 * ONE);

        uint256 reserveBefore = staking.rewardReserve();
        uint256 bal = forge.balanceOf(alice);
        vm.expectEmit(address(staking));
        emit IFormaStaking.EmergencyWithdraw(id, alice, 900 * ONE, 100 * ONE, pv.pendingForfeited);
        vm.prank(alice);
        uint256 out = staking.emergencyWithdraw(id);

        assertEq(out, 900 * ONE);
        assertEq(forge.balanceOf(alice), bal + 900 * ONE, "no rewards paid");
        assertEq(uint8(_pos(id).status), uint8(PositionStatus.EmergencyClosed));
        assertFalse(nft.exists(id));
        assertEq(staking.rewardReserve(), reserveBefore + 100 * ONE, "penalty to reserve");
        assertEq(staking.totalPrincipal(), 1000 * ONE);
        _assertSolvent();
    }

    function test_emergency_forfeitedAndPenaltyAreRestreamed() public {
        uint256 id = _stake(alice, CONVICTION, 1000 * ONE);
        uint256 other = _stake(bob, GENESIS, 1000 * ONE);
        _skip(5 days);
        EmergencyPreview memory pv = staking.previewEmergencyWithdraw(id);
        vm.prank(alice);
        staking.emergencyWithdraw(id);

        RewardState memory s = staking.rewardState();
        assertApproxEqAbs(s.idleRewards, pv.pendingForfeited + pv.penalty, 1e9, "idle = forfeited + penalty");

        // Re-stream: Bob (sole staker) eventually receives everything that is not already his.
        uint256 bobBefore = _pending(other);
        _fund(0, 1 days);
        _skip(30 days);
        uint256 streamedToBob = _pending(other) - bobBefore;
        assertApproxEqAbs(streamedToBob, s.idleRewards + s.futureEmissions, 1e10);
        _assertSolvent();
    }

    function test_emergency_afterUnlock_noPenalty() public {
        uint256 id = _stake(alice, CALIBRATION, 1000 * ONE);
        _skip(1 hours);
        EmergencyPreview memory pv = staking.previewEmergencyWithdraw(id);
        assertEq(pv.penalty, 0);
        vm.prank(alice);
        assertEq(staking.emergencyWithdraw(id), 1000 * ONE);
    }

    function test_emergency_genesis_noPenalty() public {
        uint256 id = _stake(alice, GENESIS, 1000 * ONE);
        vm.prank(alice);
        assertEq(staking.emergencyWithdraw(id), 1000 * ONE);
    }

    function test_emergency_whilePaused_penaltyWaived() public {
        uint256 id = _stake(alice, LONG_FORGE, 1000 * ONE);
        _skip(1 days);
        vm.prank(pauser);
        staking.pause();
        EmergencyPreview memory pv = staking.previewEmergencyWithdraw(id);
        assertEq(pv.penalty, 0);
        uint256 bal = forge.balanceOf(alice);
        vm.prank(alice);
        staking.emergencyWithdraw(id);
        assertEq(forge.balanceOf(alice), bal + 1000 * ONE);
        _assertSolvent();
    }

    function test_emergency_cannotCreateRewards() public {
        uint256 id = _stake(alice, CONVICTION, 1000 * ONE);
        _skip(3 days);
        uint256 outstandingBefore = staking.rewardState().outstandingRewards;
        vm.prank(alice);
        staking.emergencyWithdraw(id);
        assertLt(staking.rewardState().outstandingRewards, outstandingBefore, "owed rewards decreased");
        assertEq(staking.accountStats(alice).rewardsEarned, 0);
        assertEq(_pos(id).lifetimeRewards, 0);
    }

    function test_emergency_onlyOwner() public {
        uint256 id = _stake(alice, CONVICTION, 1000 * ONE);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotPositionOwner.selector, id));
        vm.prank(attacker);
        staking.emergencyWithdraw(id);
    }

    function test_emergency_twiceReverts() public {
        uint256 id = _stake(alice, CONVICTION, 1000 * ONE);
        vm.startPrank(alice);
        staking.emergencyWithdraw(id);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PositionNotActive.selector, id));
        staking.emergencyWithdraw(id);
        vm.stopPrank();
    }

    function test_emergency_thenClaimReverts() public {
        uint256 id = _stake(alice, GENESIS, 1000 * ONE);
        _skip(1 days);
        vm.startPrank(alice);
        staking.emergencyWithdraw(id);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PositionNotActive.selector, id));
        staking.claim(id);
        vm.stopPrank();
    }

    function test_emergency_previewForInactiveIsZero() public view {
        EmergencyPreview memory pv = staking.previewEmergencyWithdraw(123);
        assertEq(pv.amountOut, 0);
    }

    function test_emergency_penaltyIsSnapshot() public {
        uint256 id = _stake(alice, CONVICTION, 1000 * ONE);
        vm.prank(poolManager);
        staking.updatePool(CONVICTION, _params("Conviction", 90 days, 17_500, 2500));
        assertEq(staking.previewEmergencyWithdraw(id).penalty, 100 * ONE, "old 10% applies");
    }
}
