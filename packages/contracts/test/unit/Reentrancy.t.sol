// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {FormaStaking} from "../../src/FormaStaking.sol";
import {IFormaStaking} from "../../src/interfaces/IFormaStaking.sol";
import {PositionNFT} from "../../src/nft/PositionNFT.sol";
import {Base} from "../utils/Base.t.sol";
import {FeeOnTransferToken, ReentrantToken} from "../utils/Mocks.sol";

/// @notice Protocol assumes a plain ERC-20, but every entry point must still be reentrancy-safe.
contract ReentrancyTest is Base {
    ReentrantToken internal rtoken;
    FormaStaking internal rstaking;
    PositionNFT internal rnft;

    function setUp() public override {
        super.setUp();
        rtoken = new ReentrantToken();
        (rnft, rstaking) = _deployCore(IERC20(address(rtoken)));
        vm.startPrank(admin);
        rstaking.grantRole(rstaking.POOL_MANAGER_ROLE(), poolManager);
        rstaking.grantRole(rstaking.REWARD_MANAGER_ROLE(), rewardManager);
        vm.stopPrank();
        vm.prank(poolManager);
        rstaking.createPool(_params("Genesis", 0, 10_000, 0));

        rtoken.mint(alice, 1_000_000 * ONE);
        rtoken.mint(rewardManager, 1_000_000 * ONE);
        vm.prank(alice);
        rtoken.approve(address(rstaking), type(uint256).max);
        vm.prank(rewardManager);
        rtoken.approve(address(rstaking), type(uint256).max);
        vm.prank(rewardManager);
        rstaking.notifyRewards(30_000 * ONE, 30 days);
    }

    function _assertBlocked() internal view {
        assertTrue(rtoken.reentered(), "hook fired");
        assertFalse(rtoken.reentrySucceeded(), "re-entry must fail");
        assertEq(bytes4(rtoken.reentryError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function _stakeR() internal returns (uint256 id) {
        vm.prank(alice);
        id = rstaking.stake(0, 100 * ONE, 0, 10_000);
    }

    function test_reentrancy_onStake() public {
        rtoken.arm(address(rstaking), abi.encodeCall(IFormaStaking.stake, (0, ONE, 0, 10_000)));
        _stakeR();
        _assertBlocked();
    }

    function test_reentrancy_onClaim() public {
        uint256 id = _stakeR();
        _skip(1 days);
        rtoken.arm(address(rstaking), abi.encodeCall(IFormaStaking.claim, (id)));
        vm.prank(alice);
        rstaking.claim(id);
        _assertBlocked();
    }

    function test_reentrancy_onWithdraw() public {
        uint256 id = _stakeR();
        _skip(1 days);
        rtoken.arm(address(rstaking), abi.encodeCall(IFormaStaking.withdraw, (id, 100 * ONE)));
        vm.prank(alice);
        rstaking.withdraw(id, 100 * ONE);
        _assertBlocked();
    }

    function test_reentrancy_onEmergencyWithdraw() public {
        uint256 id = _stakeR();
        rtoken.arm(address(rstaking), abi.encodeCall(IFormaStaking.emergencyWithdraw, (id)));
        vm.prank(alice);
        rstaking.emergencyWithdraw(id);
        _assertBlocked();
    }

    function test_reentrancy_onKeeperCompound() public {
        uint256 id = _stakeR();
        vm.prank(alice);
        rstaking.setRouting(id, RoutingMode.Compound, address(0), 500);
        _skip(1 days);
        rtoken.arm(address(rstaking), abi.encodeCall(IFormaStaking.compound, (id)));
        vm.prank(keeper);
        rstaking.compound(id);
        _assertBlocked();
    }

    function test_feeOnTransferToken_rejected() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        (, FormaStaking fstaking) = _deployCore(IERC20(address(fot)));
        bytes32 role = fstaking.POOL_MANAGER_ROLE();
        vm.prank(admin);
        fstaking.grantRole(role, poolManager);
        vm.prank(poolManager);
        fstaking.createPool(_params("Genesis", 0, 10_000, 0));
        fot.mint(alice, 1000 * ONE);
        vm.prank(alice);
        fot.approve(address(fstaking), type(uint256).max);

        vm.expectRevert(FormaStaking.UnsupportedTokenTransfer.selector);
        vm.prank(alice);
        fstaking.stake(0, 100 * ONE, 0, 10_000);
    }
}
