// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFormaStaking} from "../../src/interfaces/IFormaStaking.sol";
import {Base} from "../utils/Base.t.sol";

contract CompoundTest is Base {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        _fund(30_000 * ONE, 30 days);
        id = _stake(alice, GENESIS, 1000 * ONE);
        _skip(1 days);
    }

    function test_ownerCompound_noFee() public {
        uint256 pending = _pending(id);
        uint256 reserve = staking.rewardReserve();
        vm.expectEmit(address(staking));
        emit IFormaStaking.Compound(id, alice, pending, 0);
        vm.prank(alice);
        (uint256 compounded, uint256 fee) = staking.compound(id);

        assertEq(compounded, pending);
        assertEq(fee, 0);
        Position memory p = _pos(id);
        assertEq(p.principal, 1000 * ONE + pending);
        assertEq(p.weight, 1000 * ONE + pending);
        assertEq(p.compoundCount, 1);
        assertEq(p.lifetimeRewards, pending);
        assertEq(_pending(id), 0);
        assertEq(staking.totalPrincipal(), 1000 * ONE + pending);
        assertEq(staking.rewardReserve(), reserve - pending, "moved reserve -> principal");
        AccountStats memory s = staking.accountStats(alice);
        assertEq(s.compounds, 1);
        assertEq(s.rewardsEarned, pending);
        _assertSolvent();
    }

    function test_compounded_principalIsWithdrawable() public {
        vm.prank(alice);
        (uint256 compounded,) = staking.compound(id);
        uint256 bal = forge.balanceOf(alice);
        vm.prank(alice);
        staking.withdraw(id, 1000 * ONE + compounded);
        assertEq(forge.balanceOf(alice), bal + 1000 * ONE + compounded);
        _assertSolvent();
    }

    function test_thirdParty_requiresOptIn() public {
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.CompoundNotAuthorized.selector, id));
        vm.prank(keeper);
        staking.compound(id);
    }

    function test_keeper_receivesCappedFee() public {
        _setRouting(alice, id, RoutingMode.Compound, address(0), 500);
        uint256 pending = _pending(id);
        uint256 keeperBal = forge.balanceOf(keeper);
        vm.prank(keeper);
        (uint256 compounded, uint256 fee) = staking.compound(id);
        // Protocol fee is 1% (fixture), owner cap 5% → 1%.
        assertEq(fee, pending * 100 / BPS);
        assertEq(compounded, pending - fee);
        assertEq(forge.balanceOf(keeper), keeperBal + fee);
        assertEq(_pos(id).principal, 1000 * ONE + compounded);
        assertEq(_pos(id).lifetimeRewards, pending);
        _assertSolvent();
    }

    function test_keeper_feeLimitedByOwnerCap_whenProtocolRaisesFee() public {
        _setRouting(alice, id, RoutingMode.Compound, address(0), 50); // owner accepts at most 0.5%
        vm.prank(rewardManager);
        staking.setCompoundConfig(CompoundConfig({keeperFeeBps: 500, keeperCooldown: 1 hours, minCompoundAmount: 0}));
        uint256 pending = _pending(id);
        vm.prank(keeper);
        (, uint256 fee) = staking.compound(id);
        assertEq(fee, pending * 50 / BPS, "owner's cap, not the raised protocol fee");
    }

    function test_keeper_zeroCapMeansFreeCompounding() public {
        _setRouting(alice, id, RoutingMode.Compound, address(0), 0);
        vm.prank(keeper);
        (, uint256 fee) = staking.compound(id);
        assertEq(fee, 0);
    }

    function test_keeper_cooldown() public {
        _setRouting(alice, id, RoutingMode.Compound, address(0), 500);
        vm.prank(keeper);
        staking.compound(id);
        _skip(30 minutes);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.CompoundCooldown.selector, _now() + 30 minutes));
        vm.prank(keeper);
        staking.compound(id);

        // Owner is never rate-limited.
        vm.prank(alice);
        staking.compound(id);

        _skip(30 minutes);
        vm.prank(keeper);
        staking.compound(id);
    }

    function test_keeper_minCompoundAmount() public {
        _setRouting(alice, id, RoutingMode.Compound, address(0), 500);
        vm.prank(rewardManager);
        staking.setCompoundConfig(
            CompoundConfig({keeperFeeBps: 100, keeperCooldown: 1 hours, minCompoundAmount: uint128(10_000 * ONE)})
        );
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.CompoundTooSmall.selector, 10_000 * ONE));
        vm.prank(keeper);
        staking.compound(id);
    }

    function test_compound_nothingPendingReverts() public {
        vm.startPrank(alice);
        staking.compound(id);
        vm.expectRevert(IFormaStaking.NothingToCompound.selector);
        staking.compound(id);
        vm.stopPrank();
    }

    function test_compound_repeatedDustDoesNotIncreaseTotalFee() public {
        _setRouting(alice, id, RoutingMode.Compound, address(0), 100);
        vm.prank(rewardManager);
        staking.setCompoundConfig(CompoundConfig({keeperFeeBps: 100, keeperCooldown: 10 minutes, minCompoundAmount: 0}));
        uint256 totalFee;
        uint256 totalReward;
        for (uint256 i; i < 20; ++i) {
            _skip(10 minutes);
            uint256 pending = _pending(id);
            vm.prank(keeper);
            (, uint256 fee) = staking.compound(id);
            totalFee += fee;
            totalReward += pending;
        }
        assertLe(totalFee, totalReward * 100 / BPS, "fee share bounded by 1%");
        _assertSolvent();
    }

    function test_compound_closedPositionReverts() public {
        vm.prank(alice);
        staking.withdraw(id, 1000 * ONE);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PositionNotActive.selector, id));
        vm.prank(alice);
        staking.compound(id);
    }

    function test_compound_afterUnlockUsesBaseMultiplier() public {
        uint256 c = _stake(bob, CALIBRATION, 1000 * ONE);
        _skip(2 hours);
        vm.prank(bob);
        (uint256 compounded,) = staking.compound(c);
        Position memory p = _pos(c);
        assertEq(p.activeMultiplierBps, 10_000);
        assertEq(p.weight, 1000 * ONE + compounded);
    }
}
