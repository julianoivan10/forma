// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {IFormaStaking} from "../../src/interfaces/IFormaStaking.sol";
import {Base} from "../utils/Base.t.sol";

contract StakingTest is Base {
    // ─── stake ─────────────────────────────────────────────────────────────

    function test_stake_createsPositionAndNFT() public {
        uint256 balBefore = forge.balanceOf(alice);
        vm.expectEmit(address(staking));
        emit IFormaStaking.Stake(1, alice, CONVICTION, 1000 * ONE, _now() + 90 days, 17_500);
        uint256 id = _stake(alice, CONVICTION, 1000 * ONE);

        assertEq(id, 1);
        assertEq(nft.ownerOf(id), alice);
        assertEq(forge.balanceOf(alice), balBefore - 1000 * ONE);
        assertEq(forge.balanceOf(address(staking)), 1000 * ONE);

        Position memory p = _pos(id);
        assertEq(p.principal, 1000 * ONE);
        assertEq(p.weight, 1750 * ONE);
        assertEq(p.startTime, _now());
        assertEq(p.unlockTime, _now() + 90 days);
        assertEq(p.poolId, CONVICTION);
        assertEq(p.multiplierBps, 17_500);
        assertEq(p.activeMultiplierBps, 17_500);
        assertEq(p.earlyExitPenaltyBps, 1000);
        assertEq(uint8(p.status), uint8(PositionStatus.Active));

        assertEq(staking.totalPrincipal(), 1000 * ONE);
        assertEq(staking.totalWeight(), 1750 * ONE);
        Pool memory pool = staking.getPool(CONVICTION);
        assertEq(pool.totalPrincipal, 1000 * ONE);
        assertEq(pool.totalWeight, 1750 * ONE);
        assertEq(pool.openPositions, 1);
    }

    function test_stake_zeroAmountReverts() public {
        vm.expectRevert(IFormaStaking.ZeroAmount.selector);
        vm.prank(alice);
        staking.stake(GENESIS, 0, 0, 10_000);
    }

    function test_stake_insufficientBalanceReverts() public {
        address broke = makeAddr("broke");
        vm.prank(broke);
        forge.approve(address(staking), type(uint256).max);
        vm.expectRevert();
        vm.prank(broke);
        staking.stake(GENESIS, ONE, 0, 10_000);
        assertEq(staking.nextPositionId(), 1, "no position consumed");
    }

    function test_stake_recordsAccountStats() public {
        _stake(alice, GENESIS, 10 * ONE);
        _skip(5);
        _stake(alice, CONVICTION, 10 * ONE);
        _stake(alice, BUILDER, 10 * ONE);
        AccountStats memory s = staking.accountStats(alice);
        assertEq(s.firstStakeAt, _now() - 5);
        assertEq(s.positionsOpened, 3);
        assertEq(s.longestLock, 90 days);
    }

    function test_positionIds_areSequentialAndIndexedPerOwner() public {
        uint256 a = _stake(alice, GENESIS, 10 * ONE);
        uint256 b = _stake(bob, GENESIS, 10 * ONE);
        uint256 c = _stake(alice, BUILDER, 10 * ONE);
        assertEq(a, 1);
        assertEq(b, 2);
        assertEq(c, 3);
        uint256[] memory ids = nft.tokensOfOwner(alice, 0, 10);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 3);

        PositionView[] memory views = staking.positionsOf(alice, 0, 10);
        assertEq(views.length, 2);
        assertEq(views[1].id, 3);
        assertEq(views[1].owner, alice);
        assertTrue(views[1].locked);
    }

    // ─── withdraw ──────────────────────────────────────────────────────────

    function test_withdraw_beforeUnlockReverts() public {
        uint256 id = _stake(alice, BUILDER, 100 * ONE);
        uint256 unlock = _pos(id).unlockTime;
        vm.warp(unlock - 1);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PositionLocked.selector, unlock));
        vm.prank(alice);
        staking.withdraw(id, 100 * ONE);
    }

    function test_withdraw_atExactUnlockSucceeds() public {
        uint256 id = _stake(alice, BUILDER, 100 * ONE);
        vm.warp(_pos(id).unlockTime);
        vm.prank(alice);
        staking.withdraw(id, 100 * ONE);
        assertEq(uint8(_pos(id).status), uint8(PositionStatus.Closed));
    }

    function test_withdraw_genesisImmediately() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        uint256 bal = forge.balanceOf(alice);
        vm.prank(alice);
        staking.withdraw(id, 100 * ONE);
        assertEq(forge.balanceOf(alice), bal + 100 * ONE);
    }

    function test_withdraw_partialKeepsPositionOpen() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        vm.expectEmit(address(staking));
        emit IFormaStaking.Unstake(id, alice, 40 * ONE, false);
        vm.prank(alice);
        staking.withdraw(id, 40 * ONE);
        assertEq(_pos(id).principal, 60 * ONE);
        assertEq(_pos(id).weight, 60 * ONE);
        assertEq(staking.totalPrincipal(), 60 * ONE);
        assertEq(nft.ownerOf(id), alice);
    }

    function test_withdraw_fullClosesBurnsAndPaysRewards() public {
        _fund(30_000 * ONE, REWARD_DURATION);
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        _skip(1 days);
        uint256 pending = _pending(id);
        assertGt(pending, 0);

        uint256 bal = forge.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = staking.withdraw(id, 100 * ONE);

        assertEq(paid, pending, "pending paid on close");
        assertEq(forge.balanceOf(alice), bal + 100 * ONE + pending);
        assertEq(uint8(_pos(id).status), uint8(PositionStatus.Closed));
        assertFalse(nft.exists(id));
        assertEq(staking.getPool(GENESIS).openPositions, 0);
        assertEq(staking.totalWeight(), 0);
        _assertSolvent();
    }

    function test_withdraw_moreThanPrincipalReverts() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        vm.expectRevert(IFormaStaking.InsufficientPrincipal.selector);
        vm.prank(alice);
        staking.withdraw(id, 100 * ONE + 1);
    }

    function test_withdraw_zeroReverts() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        vm.expectRevert(IFormaStaking.ZeroAmount.selector);
        vm.prank(alice);
        staking.withdraw(id, 0);
    }

    function test_withdraw_doubleWithdrawReverts() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        vm.prank(alice);
        staking.withdraw(id, 100 * ONE);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PositionNotActive.selector, id));
        vm.prank(alice);
        staking.withdraw(id, 100 * ONE);
    }

    function test_withdraw_notOwnerReverts() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotPositionOwner.selector, id));
        vm.prank(attacker);
        staking.withdraw(id, 100 * ONE);
    }

    function test_withdraw_approvedOperatorCannotWithdraw() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        vm.prank(alice);
        nft.setApprovalForAll(bob, true);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotPositionOwner.selector, id));
        vm.prank(bob);
        staking.withdraw(id, 100 * ONE);
    }

    function test_withdraw_nonexistentPositionReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PositionNotActive.selector, 42));
        vm.prank(alice);
        staking.withdraw(42, 1);
    }

    function test_withdraw_maturedStatCountsOnlyLockedPositions() public {
        uint256 g = _stake(alice, GENESIS, 10 * ONE);
        uint256 c = _stake(alice, CALIBRATION, 10 * ONE);
        _skip(1 hours);
        vm.startPrank(alice);
        staking.withdraw(g, 10 * ONE);
        staking.withdraw(c, 10 * ONE);
        vm.stopPrank();
        assertEq(staking.accountStats(alice).positionsMatured, 1);
    }

    // ─── increasePosition ──────────────────────────────────────────────────

    function test_increase_onlyWhenUnlocked() public {
        uint256 id = _stake(alice, BUILDER, 100 * ONE);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PositionLocked.selector, _pos(id).unlockTime));
        vm.prank(alice);
        staking.increasePosition(id, 10 * ONE);

        vm.warp(_pos(id).unlockTime);
        vm.prank(alice);
        staking.increasePosition(id, 10 * ONE);
        Position memory p = _pos(id);
        assertEq(p.principal, 110 * ONE);
        // Boost expired on touch: top-ups never buy a multiplier.
        assertEq(p.activeMultiplierBps, 10_000);
        assertEq(p.weight, 110 * ONE);
        assertEq(p.unlockTime, p.startTime + 30 days, "lock not extended");
    }

    function test_increase_genesis() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        vm.expectEmit(address(staking));
        emit IFormaStaking.PositionIncreased(id, alice, 5 * ONE);
        vm.prank(alice);
        staking.increasePosition(id, 5 * ONE);
        assertEq(_pos(id).principal, 105 * ONE);
    }

    function test_increase_guards() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        vm.expectRevert(IFormaStaking.ZeroAmount.selector);
        vm.prank(alice);
        staking.increasePosition(id, 0);

        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotPositionOwner.selector, id));
        vm.prank(bob);
        staking.increasePosition(id, ONE);

        vm.prank(poolManager);
        staking.setPoolActive(GENESIS, false);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PoolInactive.selector, GENESIS));
        vm.prank(alice);
        staking.increasePosition(id, ONE);
    }

    // ─── misc ──────────────────────────────────────────────────────────────

    function test_closedPositionView() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        vm.prank(alice);
        staking.withdraw(id, 100 * ONE);
        PositionView memory v = staking.getPositionView(id);
        assertEq(v.owner, address(0));
        assertEq(v.pendingRewards, 0);
        assertEq(staking.pendingRewards(id), 0);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, id));
        nft.ownerOf(id);
    }

    function test_largeValues() public {
        uint256 big = 900_000_000 * ONE; // near the FORGE max supply
        _mint(carol, big);
        vm.prank(carol);
        forge.approve(address(staking), type(uint256).max);
        _fund(1_000_000 * ONE, 1 days);
        uint256 id = _stake(carol, LONG_FORGE, big);
        _stake(alice, GENESIS, ONE);
        _skip(1 days);
        assertApproxEqRel(_pending(id), 1_000_000 * ONE, 1e12, "whale receives ~all emission");
        _assertSolvent();
    }
}
