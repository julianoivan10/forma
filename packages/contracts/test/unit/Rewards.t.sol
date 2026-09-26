// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {IFormaStaking} from "../../src/interfaces/IFormaStaking.sol";
import {Base} from "../utils/Base.t.sol";

contract RewardsTest is Base {
    uint256 internal constant FUND = 30_000 * ONE; // 1_000 FORGE / day over 30 days
    uint256 internal constant DAILY = 1000 * ONE;
    uint256 internal constant TOL = 1e9; // wei-level rounding tolerance

    function test_notify_setsStream() public {
        vm.expectEmit(true, false, false, false, address(staking));
        emit IFormaStaking.RewardsFunded(rewardManager, FUND, REWARD_DURATION, 0, 0);
        _fund(FUND, REWARD_DURATION);
        RewardState memory s = staking.rewardState();
        assertEq(s.rewardRate, FUND * 1e18 / REWARD_DURATION);
        assertEq(s.periodFinish, _now() + REWARD_DURATION);
        assertEq(s.rewardReserve, FUND);
        assertEq(s.outstandingRewards, 0);
        assertLe(s.futureEmissions, FUND);
        _assertSolvent();
    }

    function test_notify_onlyRewardManager() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, staking.REWARD_MANAGER_ROLE()
            )
        );
        vm.prank(attacker);
        staking.notifyRewards(FUND, REWARD_DURATION);
    }

    function test_notify_durationBounds() public {
        vm.startPrank(rewardManager);
        vm.expectRevert(IFormaStaking.InvalidRewardDuration.selector);
        staking.notifyRewards(FUND, 1 days - 1);
        vm.expectRevert(IFormaStaking.InvalidRewardDuration.selector);
        staking.notifyRewards(FUND, 365 days + 1);
        vm.stopPrank();
    }

    function test_notify_zeroBudgetReverts() public {
        vm.expectRevert(IFormaStaking.NoRewardBudget.selector);
        _fund(0, REWARD_DURATION);
    }

    function test_singleStaker_receivesFullEmission() public {
        _fund(FUND, REWARD_DURATION);
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        _skip(1 days);
        assertApproxEqAbs(_pending(id), DAILY, TOL);
    }

    function test_twoStakers_splitByWeight() public {
        _fund(FUND, REWARD_DURATION);
        uint256 a = _stake(alice, GENESIS, 100 * ONE); // weight 100
        uint256 b = _stake(bob, CONVICTION, 100 * ONE); // weight 175
        _skip(1 days);
        assertApproxEqAbs(_pending(a), DAILY * 100 / 275, TOL);
        assertApproxEqAbs(_pending(b), DAILY * 175 / 275, TOL);
        assertLe(_pending(a) + _pending(b), DAILY, "never more than emitted");
    }

    function test_lateJoiner_doesNotEarnPastRewards() public {
        _fund(FUND, REWARD_DURATION);
        uint256 a = _stake(alice, GENESIS, 100 * ONE);
        _skip(1 days);
        uint256 b = _stake(bob, GENESIS, 100 * ONE);
        assertEq(_pending(b), 0);
        _skip(1 days);
        assertApproxEqAbs(_pending(a), DAILY + DAILY / 2, TOL);
        assertApproxEqAbs(_pending(b), DAILY / 2, TOL);
    }

    function test_claim_paysAndResets() public {
        _fund(FUND, REWARD_DURATION);
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        _skip(1 days);
        uint256 pending = _pending(id);
        uint256 bal = forge.balanceOf(alice);

        vm.expectEmit(address(staking));
        emit IFormaStaking.RewardClaimed(id, alice, alice, pending);
        vm.prank(alice);
        uint256 claimed = staking.claim(id);

        assertEq(claimed, pending);
        assertEq(forge.balanceOf(alice), bal + pending);
        assertEq(_pending(id), 0);
        assertEq(_pos(id).lifetimeRewards, pending);
        assertEq(staking.accountStats(alice).rewardsEarned, pending);
        _assertSolvent();
    }

    function test_claim_doubleClaimSameBlockReverts() public {
        _fund(FUND, REWARD_DURATION);
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        _skip(1 days);
        vm.startPrank(alice);
        staking.claim(id);
        vm.expectRevert(IFormaStaking.NothingToClaim.selector);
        staking.claim(id);
        vm.stopPrank();
    }

    function test_claim_noRewardsReverts() public {
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        _skip(1 days);
        vm.expectRevert(IFormaStaking.NothingToClaim.selector);
        vm.prank(alice);
        staking.claim(id);
    }

    function test_claim_cannotClaimOthersRewards() public {
        _fund(FUND, REWARD_DURATION);
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        _skip(1 days);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotAuthorizedToClaim.selector, id));
        vm.prank(attacker);
        staking.claim(id);
    }

    function test_partialClaims_sumToContinuousAccrual() public {
        _fund(FUND, REWARD_DURATION);
        uint256 a = _stake(alice, GENESIS, 100 * ONE);
        uint256 b = _stake(bob, GENESIS, 100 * ONE);
        uint256 claimedA;
        for (uint256 i; i < 10; ++i) {
            _skip(12 hours);
            vm.prank(alice);
            claimedA += staking.claim(a);
        }
        // Alice claimed every 12h; Bob never claimed. Same weight ⇒ same total (± rounding dust).
        assertApproxEqAbs(claimedA, _pending(b), TOL);
    }

    function test_depositAndWithdraw_midStream() public {
        _fund(FUND, REWARD_DURATION);
        uint256 a = _stake(alice, GENESIS, 100 * ONE);
        _skip(1 days);
        // Alice triples her stake after day 1, then halves it after day 2.
        vm.prank(alice);
        staking.increasePosition(a, 200 * ONE);
        uint256 b = _stake(bob, GENESIS, 100 * ONE);
        _skip(1 days);
        vm.prank(alice);
        staking.withdraw(a, 200 * ONE);
        _skip(1 days);

        // Day1: A=1000. Day2: A 300/400, B 100/400. Day3: A 100/200, B 100/200.
        assertApproxEqAbs(_pending(a), DAILY + DAILY * 3 / 4 + DAILY / 2, TOL);
        assertApproxEqAbs(_pending(b), DAILY / 4 + DAILY / 2, TOL);
        _assertSolvent();
    }

    function test_rewardExhaustion_stopsAtPeriodFinish() public {
        _fund(FUND, REWARD_DURATION);
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        _skip(REWARD_DURATION + 10 days);
        uint256 pending = _pending(id);
        assertApproxEqAbs(pending, FUND, TOL);
        assertLe(pending, FUND, "cannot exceed funded");
        vm.prank(alice);
        staking.claim(id);
        _skip(10 days);
        assertEq(_pending(id), 0, "nothing after exhaustion");
        _assertSolvent();
    }

    function test_topUp_midStream_preservesAccruedAndRestreamsLeftover() public {
        _fund(FUND, REWARD_DURATION);
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        _skip(10 days);
        uint256 accrued = _pending(id);

        // Top up 20k and restart a 30-day stream: leftover (~20k) + new (20k) = ~40k over 30 days.
        _fund(20_000 * ONE, REWARD_DURATION);
        assertEq(_pending(id), accrued, "accrued unchanged by top-up");
        RewardState memory s = staking.rewardState();
        assertApproxEqRel(s.rewardRate * REWARD_DURATION / 1e18, 40_000 * ONE, 1e12);

        _skip(REWARD_DURATION);
        assertApproxEqAbs(_pending(id), 50_000 * ONE, TOL, "all funded rewards eventually earned");
        _assertSolvent();
    }

    function test_zeroWeightPeriod_isRecycledNotLost() public {
        _fund(FUND, REWARD_DURATION);
        _skip(10 days); // nobody staked: ~10k emitted into the void
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        _skip(20 days);
        assertApproxEqAbs(_pending(id), 20_000 * ONE, TOL);

        RewardState memory s = staking.rewardState();
        assertApproxEqAbs(s.idleRewards, 10_000 * ONE, TOL, "idle bucket");

        // Re-notify with zero new tokens: idle rewards are streamed again.
        _fund(0, 10 days);
        _skip(10 days);
        assertApproxEqAbs(_pending(id), FUND, TOL * 10, "idle rewards re-streamed");
        _assertSolvent();
    }

    function test_multiplePools_shareOneStream() public {
        _fund(FUND, REWARD_DURATION);
        uint256 g = _stake(alice, GENESIS, 1000 * ONE); // 1000
        uint256 b = _stake(bob, BUILDER, 1000 * ONE); // 1250
        uint256 c = _stake(carol, CONVICTION, 1000 * ONE); // 1750
        uint256 l = _stake(keeper, LONG_FORGE, 1000 * ONE); // 2500
        _skip(1 days);
        uint256 total = 6500;
        assertApproxEqAbs(_pending(g), DAILY * 1000 / total, TOL);
        assertApproxEqAbs(_pending(b), DAILY * 1250 / total, TOL);
        assertApproxEqAbs(_pending(c), DAILY * 1750 / total, TOL);
        assertApproxEqAbs(_pending(l), DAILY * 2500 / total, TOL);
        assertApproxEqRel(_pending(l), _pending(g) * 25 / 10, 1e9, "2.5x per token");
    }

    function test_rounding_tinyStakeVsWhale() public {
        _fund(FUND, REWARD_DURATION);
        uint256 whale = _stake(alice, GENESIS, 5_000_000 * ONE);
        uint256 minnow = _stake(bob, GENESIS, ONE);
        for (uint256 i; i < 50; ++i) {
            _skip(1 hours);
            vm.prank(bob);
            try staking.claim(minnow) {} catch {}
        }
        uint256 expectedMinnow = DAILY * 50 / 24 / 5_000_001;
        assertLe(staking.accountStats(bob).rewardsEarned, expectedMinnow + 1, "minnow cannot gain from rounding");
        assertApproxEqAbs(staking.accountStats(bob).rewardsEarned, expectedMinnow, 1e6);
        assertGt(_pending(whale), 0);
        _assertSolvent();
    }

    function test_previewStake_matchesRealizedRate() public {
        _fund(FUND, REWARD_DURATION);
        _stake(alice, GENESIS, 1000 * ONE);
        StakePreview memory pv = staking.previewStake(CONVICTION, 1000 * ONE);
        assertEq(pv.weight, 1750 * ONE);
        assertEq(pv.multiplierBps, 17_500);
        assertEq(pv.unlockTime, _now() + 90 days);
        assertEq(pv.streamEndsAt, _now() + REWARD_DURATION);

        uint256 id = _stake(bob, CONVICTION, 1000 * ONE);
        _skip(1 days);
        assertApproxEqRel(_pending(id), pv.rewardPerSecond * 1 days, 1e12);
        // APR: 1000/day * 1750/2750 * 365 / 1000 principal
        uint256 expectedAprBps = DAILY * 365 * 1750 / 2750 * BPS / (1000 * ONE);
        assertApproxEqAbs(pv.estimatedAprBps, expectedAprBps, 1);
        assertEq(staking.getPositionView(id).rewardPerSecond, pv.rewardPerSecond);
    }

    function test_previewStake_noStreamMeansZeroRate() public view {
        StakePreview memory pv = staking.previewStake(GENESIS, 100 * ONE);
        assertEq(pv.rewardPerSecond, 0);
        assertEq(pv.estimatedAprBps, 0);
    }
}
