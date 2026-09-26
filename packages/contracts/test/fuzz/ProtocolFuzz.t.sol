// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RewardMath} from "../../src/libraries/RewardMath.sol";
import {Base} from "../utils/Base.t.sol";

contract ProtocolFuzzTest is Base {
    function _poolOf(uint256 seed) internal view returns (uint256) {
        return seed % staking.poolCount();
    }

    // ─── reward math ───────────────────────────────────────────────────────

    /// Two positions accrue in exact proportion to weight and never exceed emission.
    function testFuzz_rewardsProportionalToWeight(uint256 amtA, uint256 amtB, uint256 poolA, uint256 poolB, uint256 dt)
        public
    {
        amtA = bound(amtA, ONE, 5_000_000 * ONE);
        amtB = bound(amtB, ONE, 5_000_000 * ONE);
        dt = bound(dt, 1, 30 days);
        poolA = _poolOf(poolA);
        poolB = _poolOf(poolB);

        _fund(30_000 * ONE, 30 days);
        uint256 a = _stake(alice, poolA, amtA);
        uint256 b = _stake(bob, poolB, amtB);
        _skip(dt);

        uint256 wA = _pos(a).weight;
        uint256 wB = _pos(b).weight;
        uint256 emitted = staking.rewardState().rewardRate * dt / 1e18;
        uint256 pA = _pending(a);
        uint256 pB = _pending(b);

        assertLe(pA + pB, emitted, "never more than emitted");
        // Each position gets its exact weighted share, floored (≤ 2 wei of accumulator dust).
        assertApproxEqAbs(pA, emitted * wA / (wA + wB), 2);
        assertApproxEqAbs(pB, emitted * wB / (wA + wB), 2);
        _assertSolvent();
    }

    /// Any sequence of claims pays out no more than was funded, and matches a continuous accrual.
    function testFuzz_claimSequenceBoundedByFunding(uint256 fund, uint64[8] memory gaps) public {
        fund = bound(fund, 1000 * ONE, 1_000_000 * ONE);
        _fund(fund, 10 days);
        uint256 a = _stake(alice, GENESIS, 1000 * ONE);
        uint256 b = _stake(bob, GENESIS, 1000 * ONE);
        uint256 claimed;
        for (uint256 i; i < gaps.length; ++i) {
            _skip(bound(gaps[i], 1, 3 days));
            vm.prank(alice);
            try staking.claim(a) returns (uint256 amt) {
                claimed += amt;
            } catch {}
        }
        assertLe(claimed + _pending(a) + _pending(b), fund);
        // Alice (claiming) and Bob (not claiming) have equal weight → equal lifetime earnings ± dust.
        assertApproxEqAbs(claimed + _pending(a), _pending(b), 1e6);
        _assertSolvent();
    }

    /// Streams never commit more than the budget, for any amount/duration.
    function testFuzz_notifyNeverOvercommits(uint256 amount, uint256 duration, uint256 amount2, uint256 wait) public {
        amount = bound(amount, 1, 5_000_000 * ONE);
        duration = bound(duration, 1 days, 365 days);
        amount2 = bound(amount2, 0, 3_000_000 * ONE);
        wait = bound(wait, 0, 400 days);
        _stake(alice, GENESIS, 10 * ONE);

        vm.prank(rewardManager);
        try staking.notifyRewards(amount, duration) {}
        catch {
            return; // amount too small for a non-zero rate over `duration`
        }
        _assertSolvent();
        _skip(wait);
        vm.prank(rewardManager);
        try staking.notifyRewards(amount2, duration) {} catch {}
        _assertSolvent();
        _skip(duration);
        _assertSolvent();
    }

    // ─── principal ─────────────────────────────────────────────────────────

    /// Stake → (partial) withdraw → close returns exactly the principal (no rewards funded).
    function testFuzz_principalConserved(uint256 amount, uint256 partialAmt, uint256 poolSeed) public {
        uint256 poolId = _poolOf(poolSeed);
        amount = bound(amount, ONE, 5_000_000 * ONE);
        partialAmt = bound(partialAmt, 1, amount);
        uint256 bal = forge.balanceOf(alice);

        uint256 id = _stake(alice, poolId, amount);
        vm.warp(_pos(id).unlockTime);
        vm.startPrank(alice);
        staking.withdraw(id, partialAmt);
        if (partialAmt < amount) staking.withdraw(id, amount - partialAmt);
        vm.stopPrank();

        assertEq(forge.balanceOf(alice), bal, "principal round-trips exactly");
        assertEq(staking.totalPrincipal(), 0);
        assertEq(staking.totalWeight(), 0);
    }

    /// Nobody but the owner can ever move principal, whatever the timing.
    function testFuzz_strangerCannotWithdraw(uint256 amount, uint256 dt, address stranger) public {
        vm.assume(stranger != alice && stranger != address(0));
        amount = bound(amount, ONE, 1000 * ONE);
        dt = bound(dt, 0, 400 days);
        uint256 id = _stake(alice, CONVICTION, amount);
        _skip(dt);
        vm.startPrank(stranger);
        vm.expectRevert();
        staking.withdraw(id, amount);
        vm.expectRevert();
        staking.emergencyWithdraw(id);
        vm.stopPrank();
    }

    /// Withdrawal is impossible before unlock and possible at/after it.
    function testFuzz_lockBoundary(uint256 poolSeed, uint256 dt) public {
        uint256 poolId = _poolOf(poolSeed);
        uint256 id = _stake(alice, poolId, 100 * ONE);
        uint256 unlock = _pos(id).unlockTime;
        dt = bound(dt, 0, 400 days);
        uint256 t = _pos(id).startTime + dt;
        vm.warp(t);
        vm.prank(alice);
        if (t < unlock) {
            vm.expectRevert();
            staking.withdraw(id, 100 * ONE);
        } else {
            staking.withdraw(id, 100 * ONE);
        }
    }

    // ─── emergency ─────────────────────────────────────────────────────────

    function testFuzz_emergencyMath(uint256 amount, uint256 poolSeed, uint256 dt, bool paused) public {
        uint256 poolId = _poolOf(poolSeed);
        amount = bound(amount, ONE, 5_000_000 * ONE);
        dt = bound(dt, 0, 200 days);
        _fund(30_000 * ONE, 30 days);
        uint256 id = _stake(alice, poolId, amount);
        _skip(dt);
        if (paused) {
            vm.prank(pauser);
            staking.pause();
        }

        Position memory p = _pos(id);
        uint256 expectedPenalty = (!paused && _now() < p.unlockTime) ? amount * p.earlyExitPenaltyBps / BPS : 0;
        uint256 bal = forge.balanceOf(alice);
        vm.prank(alice);
        uint256 out = staking.emergencyWithdraw(id);

        assertEq(out, amount - expectedPenalty);
        assertEq(forge.balanceOf(alice), bal + out, "rewards never paid by emergency exit");
        assertEq(staking.accountStats(alice).rewardsEarned, 0);
        _assertSolvent();
    }

    // ─── compounding ───────────────────────────────────────────────────────

    function testFuzz_keeperFeeBounded(uint16 protocolFee, uint16 ownerCap, uint256 dt) public {
        protocolFee = uint16(bound(protocolFee, 0, 500));
        ownerCap = uint16(bound(ownerCap, 0, 500));
        dt = bound(dt, 1 hours, 30 days);
        vm.prank(rewardManager);
        staking.setCompoundConfig(
            CompoundConfig({keeperFeeBps: protocolFee, keeperCooldown: 1 hours, minCompoundAmount: 0})
        );
        _fund(30_000 * ONE, 30 days);
        uint256 id = _stake(alice, BUILDER, 1000 * ONE);
        _setRouting(alice, id, RoutingMode.Compound, address(0), ownerCap);
        _skip(dt);

        uint256 pending = _pending(id);
        uint256 principalBefore = _pos(id).principal;
        vm.prank(keeper);
        (uint256 compounded, uint256 fee) = staking.compound(id);

        uint256 effectiveBps = protocolFee < ownerCap ? protocolFee : ownerCap;
        assertEq(fee, pending * effectiveBps / BPS);
        assertEq(compounded + fee, pending);
        assertEq(_pos(id).principal, principalBefore + compounded);
        _assertSolvent();
    }

    // ─── vault ─────────────────────────────────────────────────────────────

    /// Without rewards nobody profits from a deposit/redeem cycle, in any order.
    function testFuzz_vaultNoFreeLunch(uint256 a, uint256 b, uint256 c) public {
        a = bound(a, ONE, 1_000_000 * ONE);
        b = bound(b, 1, 1_000_000 * ONE);
        c = bound(c, 1, 1_000_000 * ONE);
        vm.prank(alice);
        uint256 sa = vault.deposit(a, alice);
        vm.prank(bob);
        uint256 sb = vault.deposit(b, bob);
        vm.prank(carol);
        uint256 sc = vault.deposit(c, carol);

        vm.prank(bob);
        uint256 outB = vault.redeem(sb, bob, bob);
        vm.prank(alice);
        uint256 outA = vault.redeem(sa, alice, alice);
        vm.prank(carol);
        uint256 outC = sc == 0 ? 0 : vault.redeem(sc, carol, carol);

        assertLe(outA, a);
        assertLe(outB, b);
        assertLe(outC, c);
        assertApproxEqAbs(outA, a, 2);
        assertApproxEqAbs(outB, b, 2);
    }

    /// With rewards, redemptions never exceed total assets and depositors share them by time-weighted value.
    function testFuzz_vaultRewardsNeverOverpaid(uint256 a, uint256 b, uint256 dt1, uint256 dt2) public {
        a = bound(a, ONE, 1_000_000 * ONE);
        b = bound(b, ONE, 1_000_000 * ONE);
        dt1 = bound(dt1, 1, 20 days);
        dt2 = bound(dt2, 1, 20 days);
        _fund(30_000 * ONE, 30 days);
        vm.prank(alice);
        vault.deposit(a, alice);
        _skip(dt1);
        vm.prank(bob);
        vault.deposit(b, bob);
        _skip(dt2);

        uint256 total = vault.totalAssets();
        uint256 aliceShares = vault.balanceOf(alice);
        uint256 bobShares = vault.balanceOf(bob);
        vm.prank(alice);
        uint256 outA = vault.redeem(aliceShares, alice, alice);
        vm.prank(bob);
        uint256 outB = vault.redeem(bobShares, bob, bob);
        assertLe(outA + outB, total);
        assertGe(outA, a - 1, "alice never loses principal");
        assertGe(outB, b - 1, "bob never loses principal");
        _assertSolvent();
    }

    // ─── library ───────────────────────────────────────────────────────────

    /// Domain from PROTOCOL.md §2: weight ≤ 5e27 (supply cap × max multiplier), Δacc ≤ 1e49 ⇒ product < 2^256.
    function testFuzz_rewardMath_earnedMonotonic(uint256 weight, uint256 acc1, uint256 acc2, uint256 paid) public pure {
        weight = bound(weight, 0, 5e27);
        paid = bound(paid, 0, 1e49);
        acc1 = bound(acc1, paid, paid + 1e49);
        acc2 = bound(acc2, acc1, paid + 1e49);
        assertLe(RewardMath.earned(weight, acc1, paid), RewardMath.earned(weight, acc2, paid));
    }

    function testFuzz_rewardMath_rateNeverExceedsBudget(uint256 budget, uint256 duration) public pure {
        budget = bound(budget, 0, 1e30);
        duration = bound(duration, 1, 365 days);
        uint256 rate = RewardMath.rateFor(budget, duration);
        assertLe(RewardMath.emitted(rate, duration), budget);
    }

    function testFuzz_rewardMath_splitNeverExceedsEmission(uint256 e, uint256 w1, uint256 w2) public pure {
        e = bound(e, 0, 1e30);
        w1 = bound(w1, 1, 5e27);
        w2 = bound(w2, 1, 5e27);
        uint256 d = RewardMath.accDelta(e, w1 + w2);
        assertLe(RewardMath.earned(w1, d, 0) + RewardMath.earned(w2, d, 0), e);
    }
}
