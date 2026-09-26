// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFormaStaking} from "../../src/interfaces/IFormaStaking.sol";
import {Base} from "../utils/Base.t.sol";

contract RoutingTest is Base {
    uint256 internal id;
    address internal savings = makeAddr("savings");

    function setUp() public override {
        super.setUp();
        _fund(30_000 * ONE, 30 days);
        id = _stake(alice, BUILDER, 1000 * ONE);
        _skip(1 days);
    }

    function test_defaultRoutingIsKeep() public view {
        Routing memory r = staking.effectiveRouting(id);
        assertEq(uint8(r.mode), uint8(RoutingMode.Keep));
        assertEq(r.recipient, address(0));
    }

    function test_redirect_ownerClaimSendsToRecipient() public {
        vm.expectEmit(address(staking));
        emit IFormaStaking.RewardRedirectConfigured(id, RoutingMode.Redirect, savings, 0);
        _setRouting(alice, id, RoutingMode.Redirect, savings, 0);

        uint256 pending = _pending(id);
        uint256 aliceBal = forge.balanceOf(alice);
        vm.expectEmit(address(staking));
        emit IFormaStaking.RewardClaimed(id, alice, savings, pending);
        vm.expectEmit(address(staking));
        emit IFormaStaking.RewardRedirected(id, savings, pending);
        vm.prank(alice);
        staking.claim(id);

        assertEq(forge.balanceOf(savings), pending);
        assertEq(forge.balanceOf(alice), aliceBal, "owner receives nothing directly");
        assertEq(staking.accountStats(alice).rewardsEarned, pending, "earned credited to owner");
    }

    function test_redirect_recipientCanPull() public {
        _setRouting(alice, id, RoutingMode.Redirect, savings, 0);
        uint256 pending = _pending(id);
        vm.prank(savings);
        staking.claim(id);
        assertEq(forge.balanceOf(savings), pending);
    }

    function test_redirect_strangerCannotClaim() public {
        _setRouting(alice, id, RoutingMode.Redirect, savings, 0);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotAuthorizedToClaim.selector, id));
        vm.prank(attacker);
        staking.claim(id);
    }

    function test_redirect_recipientCannotActOnPrincipalOrRouting() public {
        _setRouting(alice, id, RoutingMode.Redirect, savings, 0);
        vm.startPrank(savings);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotPositionOwner.selector, id));
        staking.setRouting(id, RoutingMode.Redirect, savings, 0);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotPositionOwner.selector, id));
        staking.emergencyWithdraw(id);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.CompoundNotAuthorized.selector, id));
        staking.compound(id);
        vm.stopPrank();
    }

    function test_onlyOwnerCanConfigure() public {
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotPositionOwner.selector, id));
        vm.prank(attacker);
        staking.setRouting(id, RoutingMode.Redirect, attacker, 0);

        // Even an approved operator cannot redirect someone else's rewards.
        vm.prank(alice);
        nft.setApprovalForAll(bob, true);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotPositionOwner.selector, id));
        vm.prank(bob);
        staking.setRouting(id, RoutingMode.Redirect, bob, 0);
    }

    function test_invalidConfigurations() public {
        vm.startPrank(alice);
        vm.expectRevert(IFormaStaking.InvalidRouting.selector);
        staking.setRouting(id, RoutingMode.Redirect, address(0), 0);
        vm.expectRevert(IFormaStaking.InvalidRouting.selector);
        staking.setRouting(id, RoutingMode.Redirect, address(staking), 0);
        vm.expectRevert(IFormaStaking.InvalidRouting.selector);
        staking.setRouting(id, RoutingMode.Redirect, savings, 100);
        vm.expectRevert(IFormaStaking.InvalidRouting.selector);
        staking.setRouting(id, RoutingMode.Compound, savings, 100);
        vm.expectRevert(IFormaStaking.InvalidKeeperFee.selector);
        staking.setRouting(id, RoutingMode.Compound, address(0), 501);
        vm.expectRevert(IFormaStaking.InvalidRouting.selector);
        staking.setRouting(id, RoutingMode.Keep, savings, 0);
        vm.expectRevert(IFormaStaking.InvalidRouting.selector);
        staking.setRouting(id, RoutingMode.Keep, address(0), 1);
        vm.stopPrank();
    }

    function test_transfer_resetsEffectiveRouting() public {
        _setRouting(alice, id, RoutingMode.Redirect, savings, 0);
        vm.prank(alice);
        nft.transferFrom(alice, bob, id);

        Routing memory r = staking.effectiveRouting(id);
        assertEq(uint8(r.mode), uint8(RoutingMode.Keep), "new owner does not inherit redirect");
        assertEq(staking.storedRouting(id).recipient, savings, "stale config still stored");

        // Old recipient can no longer pull; rewards go to the new owner.
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotAuthorizedToClaim.selector, id));
        vm.prank(savings);
        staking.claim(id);

        uint256 pending = _pending(id);
        vm.prank(bob);
        staking.claim(id);
        assertEq(forge.balanceOf(savings), 0);
        assertEq(staking.accountStats(bob).rewardsEarned, pending);
    }

    function test_transfer_resetsCompoundOptIn() public {
        _setRouting(alice, id, RoutingMode.Compound, address(0), 500);
        vm.prank(alice);
        nft.transferFrom(alice, bob, id);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.CompoundNotAuthorized.selector, id));
        vm.prank(keeper);
        staking.compound(id);
    }

    function test_switchBackToKeep() public {
        _setRouting(alice, id, RoutingMode.Redirect, savings, 0);
        _setRouting(alice, id, RoutingMode.Keep, address(0), 0);
        uint256 pending = _pending(id);
        uint256 bal = forge.balanceOf(alice);
        vm.prank(alice);
        staking.claim(id);
        assertEq(forge.balanceOf(alice), bal + pending);
        assertEq(forge.balanceOf(savings), 0);
    }

    function test_redirect_appliesOnFullWithdraw() public {
        _setRouting(alice, id, RoutingMode.Redirect, savings, 0);
        _skip(30 days);
        uint256 pending = _pending(id);
        uint256 bal = forge.balanceOf(alice);
        vm.prank(alice);
        staking.withdraw(id, 1000 * ONE);
        assertEq(forge.balanceOf(alice), bal + 1000 * ONE, "principal to owner");
        assertEq(forge.balanceOf(savings), pending, "rewards to recipient");
    }

    function test_routingOnClosedPositionReverts() public {
        uint256 g = _stake(bob, GENESIS, 10 * ONE);
        vm.prank(bob);
        staking.withdraw(g, 10 * ONE);
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PositionNotActive.selector, g));
        vm.prank(bob);
        staking.setRouting(g, RoutingMode.Redirect, savings, 0);
    }
}
