// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {FormaStaking} from "../../src/FormaStaking.sol";
import {IFormaStaking} from "../../src/interfaces/IFormaStaking.sol";
import {IPositionNFT} from "../../src/interfaces/IPositionNFT.sol";
import {PositionNFT} from "../../src/nft/PositionNFT.sol";
import {Base} from "../utils/Base.t.sol";
import {MockERC20} from "../utils/Mocks.sol";

contract PauseAdminTest is Base {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        _fund(30_000 * ONE, 30 days);
        id = _stake(alice, GENESIS, 1000 * ONE);
        _skip(1 days);
    }

    function _pause() internal {
        vm.prank(pauser);
        staking.pause();
    }

    // ─── pause ─────────────────────────────────────────────────────────────

    function test_pause_blocksStateChangingActions() public {
        _pause();
        assertTrue(staking.paused());
        assertEq(staking.pausedAt(), _now());

        bytes4 err = Pausable.EnforcedPause.selector;
        vm.startPrank(alice);
        vm.expectRevert(err);
        staking.stake(GENESIS, ONE, 0, 10_000);
        vm.expectRevert(err);
        staking.increasePosition(id, ONE);
        vm.expectRevert(err);
        staking.withdraw(id, ONE);
        vm.expectRevert(err);
        staking.claim(id);
        vm.expectRevert(err);
        staking.compound(id);
        vm.stopPrank();

        vm.expectRevert(err);
        vm.prank(rewardManager);
        staking.notifyRewards(ONE, 1 days);
    }

    function test_pause_keepsRecoveryPathsOpen() public {
        _pause();
        // Routing config, kicks and emergency exits remain available.
        _setRouting(alice, id, RoutingMode.Compound, address(0), 100);
        uint256 bal = forge.balanceOf(alice);
        vm.prank(alice);
        staking.emergencyWithdraw(id);
        assertEq(forge.balanceOf(alice), bal + 1000 * ONE);
    }

    function test_pause_nftTransfersStillWork() public {
        _pause();
        vm.prank(alice);
        nft.transferFrom(alice, bob, id);
        assertEq(nft.ownerOf(id), bob);
    }

    function test_unpause_restoresActionsAndRewardsKeptAccruing() public {
        uint256 before = _pending(id);
        _pause();
        _skip(1 days);
        assertGt(_pending(id), before, "accrual continues while paused");
        vm.prank(admin);
        staking.unpause();
        assertEq(staking.pausedAt(), 0);
        vm.prank(alice);
        staking.claim(id);
    }

    function test_pauseRoles_areSeparated() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, staking.PAUSER_ROLE()
            )
        );
        vm.prank(attacker);
        staking.pause();

        _pause();
        // The pauser cannot unpause: that requires the admin.
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, pauser, staking.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(pauser);
        staking.unpause();
    }

    // ─── admin ─────────────────────────────────────────────────────────────

    function test_roleAdministration() public {
        bytes32 pmRole = staking.POOL_MANAGER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, staking.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(attacker);
        staking.grantRole(pmRole, attacker);

        vm.prank(admin);
        staking.revokeRole(pmRole, poolManager);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, poolManager, pmRole)
        );
        vm.prank(poolManager);
        staking.setPoolActive(GENESIS, false);
    }

    function test_recoverERC20_onlyForeignTokens() public {
        MockERC20 stray = new MockERC20();
        stray.mint(address(staking), 5 * ONE);
        vm.prank(admin);
        staking.recoverERC20(IERC20(address(stray)), carol, 5 * ONE);
        assertEq(stray.balanceOf(carol), 5 * ONE);

        vm.expectRevert(IFormaStaking.CannotRecoverStakingToken.selector);
        vm.prank(admin);
        staking.recoverERC20(IERC20(address(forge)), admin, 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, staking.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(attacker);
        staking.recoverERC20(IERC20(address(stray)), attacker, 1);
    }

    function test_compoundConfig_boundsAndAccess() public {
        vm.startPrank(rewardManager);
        vm.expectRevert(IFormaStaking.InvalidKeeperFee.selector);
        staking.setCompoundConfig(CompoundConfig({keeperFeeBps: 501, keeperCooldown: 1 hours, minCompoundAmount: 0}));
        vm.expectRevert(IFormaStaking.InvalidCooldown.selector);
        staking.setCompoundConfig(CompoundConfig({keeperFeeBps: 100, keeperCooldown: 9 minutes, minCompoundAmount: 0}));
        vm.expectRevert(IFormaStaking.InvalidCooldown.selector);
        staking.setCompoundConfig(CompoundConfig({keeperFeeBps: 100, keeperCooldown: 31 days, minCompoundAmount: 0}));
        staking.setCompoundConfig(CompoundConfig({keeperFeeBps: 500, keeperCooldown: 2 hours, minCompoundAmount: 7}));
        vm.stopPrank();
        CompoundConfig memory c = staking.compoundConfig();
        assertEq(c.keeperFeeBps, 500);
        assertEq(c.keeperCooldown, 2 hours);
        assertEq(c.minCompoundAmount, 7);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, staking.REWARD_MANAGER_ROLE()
            )
        );
        vm.prank(attacker);
        staking.setCompoundConfig(c);
    }

    function test_noAdminPathMovesPrincipal() public {
        // Every privileged role acting together cannot extract staked principal or reserves.
        uint256 stakingBal = forge.balanceOf(address(staking));
        address[4] memory privileged = [admin, poolManager, rewardManager, pauser];
        for (uint256 i; i < privileged.length; ++i) {
            vm.startPrank(privileged[i]);
            try staking.recoverERC20(IERC20(address(forge)), privileged[i], 1) {
                fail();
            } catch {}
            try staking.withdraw(id, 1) {
                fail();
            } catch {}
            try staking.emergencyWithdraw(id) {
                fail();
            } catch {}
            vm.stopPrank();
        }
        assertEq(forge.balanceOf(address(staking)), stakingBal);
    }

    // ─── constructor guards ────────────────────────────────────────────────

    function test_constructor_rejectsMisboundNFT() public {
        PositionNFT wrongNft = new PositionNFT(address(0xdead), admin);
        vm.expectRevert(FormaStaking.NFTMisconfigured.selector);
        new FormaStaking(
            IERC20(address(forge)),
            IPositionNFT(address(wrongNft)),
            admin,
            CompoundConfig({keeperFeeBps: 100, keeperCooldown: 1 hours, minCompoundAmount: 0})
        );
    }

    function test_constructor_rejectsZeroAddresses() public {
        CompoundConfig memory cfg = CompoundConfig({keeperFeeBps: 100, keeperCooldown: 1 hours, minCompoundAmount: 0});
        vm.expectRevert(IFormaStaking.ZeroAddress.selector);
        new FormaStaking(IERC20(address(0)), IPositionNFT(address(nft)), admin, cfg);
        vm.expectRevert(IFormaStaking.ZeroAddress.selector);
        new FormaStaking(IERC20(address(forge)), IPositionNFT(address(nft)), address(0), cfg);
    }
}
