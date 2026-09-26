// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

import {IFormaStaking} from "../../src/interfaces/IFormaStaking.sol";
import {LiquidStakingVault} from "../../src/vault/LiquidStakingVault.sol";
import {Base} from "../utils/Base.t.sol";

contract LiquidStakingVaultTest is Base {
    function _deposit(address user, uint256 assets) internal returns (uint256 shares) {
        vm.prank(user);
        shares = vault.deposit(assets, user);
    }

    function _redeemAll(address user) internal returns (uint256 assets) {
        uint256 shares = vault.balanceOf(user);
        vm.prank(user);
        assets = vault.redeem(shares, user, user);
    }

    // ─── basics ────────────────────────────────────────────────────────────

    function test_metadata() public view {
        assertEq(vault.symbol(), "stFORGE");
        assertEq(vault.decimals(), 24, "18 + offset 6");
        assertEq(vault.asset(), address(forge));
        assertEq(vault.vaultPoolId(), GENESIS);
    }

    function test_constructor_guards() public {
        vm.expectRevert(LiquidStakingVault.PoolNotLiquid.selector);
        new LiquidStakingVault(IERC20(address(forge)), staking, CONVICTION, admin);

        vm.expectRevert(LiquidStakingVault.AssetMismatch.selector);
        new LiquidStakingVault(IERC20(address(0xBEEF)), staking, GENESIS, admin);

        vm.expectRevert(LiquidStakingVault.ZeroAddress.selector);
        new LiquidStakingVault(IERC20(address(forge)), staking, GENESIS, address(0));
    }

    function test_deposit_stakesIntoSinglePosition() public {
        uint256 shares = _deposit(alice, 100 * ONE);
        assertEq(shares, 100 * ONE * 1e6, "1:1 at start (offset 6)");
        uint256 pid = vault.positionId();
        assertEq(pid, 1);
        assertEq(nft.ownerOf(pid), address(vault));
        assertEq(forge.balanceOf(address(vault)), 0, "nothing idle");
        assertEq(vault.totalAssets(), 100 * ONE);

        _deposit(bob, 50 * ONE);
        assertEq(vault.positionId(), pid, "same position reused");
        assertEq(_pos(pid).principal, 150 * ONE);
    }

    function test_redeem_roundTripWithoutRewards_noProfit() public {
        _deposit(alice, 100 * ONE);
        uint256 bal = forge.balanceOf(alice);
        uint256 out = _redeemAll(alice);
        assertLe(out, 100 * ONE);
        assertGe(out, 100 * ONE - 1);
        assertEq(forge.balanceOf(alice), bal + out);
    }

    function test_exchangeRate_risesWithRewards() public {
        _fund(30_000 * ONE, 30 days);
        _deposit(alice, 1000 * ONE);
        uint256 rate0 = vault.exchangeRate();
        _skip(1 days);
        uint256 rate1 = vault.exchangeRate();
        assertGt(rate1, rate0);
        // Sole staker: ~1000 FORGE rewards on 1000 principal → rate ≈ 2.
        assertApproxEqRel(rate1, 2 * ONE, 1e12);

        uint256 out = _redeemAll(alice);
        assertApproxEqRel(out, 2000 * ONE, 1e12);
        assertEq(vault.totalSupply(), 0);
        // Virtual shares round in the vault's favour: the last redeemer leaves wei-level dust behind.
        assertLe(vault.totalAssets(), 10, "only rounding dust remains");
        _assertSolvent();
    }

    function test_lateDepositorDoesNotCaptureEarlierRewards() public {
        _fund(30_000 * ONE, 30 days);
        _deposit(alice, 1000 * ONE);
        _skip(1 days); // ~1000 rewards to Alice's shares
        _deposit(bob, 1000 * ONE);
        _skip(1 days); // ~1000 split by value: Alice 2/3, Bob 1/3

        uint256 aliceOut = _redeemAll(alice);
        uint256 bobOut = _redeemAll(bob);
        assertApproxEqRel(aliceOut, 1000 * ONE + 1000 * ONE + uint256(2000 * ONE) / 3, 1e12);
        assertApproxEqRel(bobOut, 1000 * ONE + uint256(1000 * ONE) / 3, 1e12);
    }

    function test_vaultSharesStakingStreamFairlyWithDirectStakers() public {
        _fund(30_000 * ONE, 30 days);
        _deposit(alice, 1000 * ONE);
        uint256 direct = _stake(bob, GENESIS, 1000 * ONE);
        _skip(1 days);
        assertApproxEqAbs(vault.totalAssets() - 1000 * ONE, _pending(direct), 1e9);
    }

    function test_fullWithdrawOfExactPrincipal_closesPosition() public {
        _deposit(alice, 100 * ONE);
        uint256 pid = vault.positionId();
        vm.prank(alice);
        vault.withdraw(100 * ONE, alice, alice);
        assertEq(vault.positionId(), 0);
        assertFalse(nft.exists(pid));
        // Next deposit opens a fresh position.
        _deposit(bob, 10 * ONE);
        assertEq(vault.positionId(), pid + 1);
    }

    function test_harvest_compoundsWithoutChangingTotalAssets() public {
        _fund(30_000 * ONE, 30 days);
        _deposit(alice, 1000 * ONE);
        _skip(1 days);
        uint256 assetsBefore = vault.totalAssets();
        vm.prank(attacker); // permissionless
        uint256 compounded = vault.harvest();
        assertGt(compounded, 0);
        assertEq(vault.totalAssets(), assetsBefore, "harvest is value-neutral");
        assertEq(_pos(vault.positionId()).principal, assetsBefore);
        assertEq(vault.harvest(), 0, "nothing left to harvest");
    }

    function test_previewFunctionsMatchExecution() public {
        _fund(30_000 * ONE, 30 days);
        _deposit(alice, 1000 * ONE);
        _skip(1 days);

        uint256 expectedShares = vault.previewDeposit(500 * ONE);
        assertEq(_deposit(bob, 500 * ONE), expectedShares);

        uint256 expectedAssets = vault.previewRedeem(vault.balanceOf(bob));
        assertEq(_redeemAll(bob), expectedAssets);

        uint256 wantAssets = 300 * ONE;
        uint256 expectedBurn = vault.previewWithdraw(wantAssets);
        uint256 sharesBefore = vault.balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(wantAssets, alice, alice);
        assertEq(sharesBefore - vault.balanceOf(alice), expectedBurn);

        uint256 wantShares = 10 * ONE * 1e6;
        uint256 expectedCost = vault.previewMint(wantShares);
        uint256 balBefore = forge.balanceOf(carol);
        vm.prank(carol);
        vault.mint(wantShares, carol);
        assertEq(balBefore - forge.balanceOf(carol), expectedCost);
    }

    // ─── inflation / donation / first depositor ────────────────────────────

    function test_firstDeposit_belowMinStakeReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.BelowMinStake.selector, ONE));
        vm.prank(attacker);
        vault.deposit(1, attacker);
    }

    function test_zeroDepositAndZeroRedeemRevert() public {
        vm.expectRevert(LiquidStakingVault.ZeroAmount.selector);
        vm.prank(alice);
        vault.deposit(0, alice);

        _deposit(alice, 10 * ONE);
        vm.expectRevert(LiquidStakingVault.ZeroAssets.selector);
        vm.prank(alice);
        vault.redeem(0, alice, alice);

        // 1 share is worth far less than 1 wei of assets (offset 6) → zero-asset redemption reverts.
        vm.expectRevert(LiquidStakingVault.ZeroAssets.selector);
        vm.prank(alice);
        vault.redeem(1, alice, alice);
    }

    function test_directDonation_doesNotMoveSharePrice() public {
        _deposit(attacker, ONE);
        uint256 rateBefore = vault.exchangeRate();
        uint256 assetsBefore = vault.totalAssets();

        vm.prank(attacker);
        forge.transfer(address(vault), 1_000_000 * ONE);

        assertEq(vault.totalAssets(), assetsBefore, "donation ignored");
        assertEq(vault.exchangeRate(), rateBefore);

        uint256 victimShares = _deposit(alice, 1000 * ONE);
        assertEq(victimShares, 1000 * ONE * 1e6, "victim gets fair shares");
        uint256 out = _redeemAll(alice);
        assertGe(out, 1000 * ONE - 1, "victim loses nothing");
        assertLe(_redeemAll(attacker), ONE, "attacker cannot recover the donation");
    }

    function test_classicInflationAttack_isUnprofitable() public {
        // Attacker front-runs the first deposit with the minimum stake, then tries every donation path.
        _deposit(attacker, ONE);
        uint256 pid = vault.positionId();

        vm.startPrank(attacker);
        forge.transfer(address(vault), 500_000 * ONE); // path 1: raw transfer (ignored)
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotPositionOwner.selector, pid));
        staking.increasePosition(pid, 500_000 * ONE); // path 2: top up the vault position (owner only)
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.CompoundNotAuthorized.selector, pid));
        staking.compound(pid); // path 3: force a compound (vault routing is Keep)
        vm.stopPrank();

        uint256 victimShares = _deposit(alice, 2 * ONE);
        assertGt(victimShares, 0);
        assertApproxEqAbs(vault.previewRedeem(victimShares), 2 * ONE, 1);
    }

    function test_virtualShares_boundRoundingLossOnTinyFollowOnDeposits() public {
        _deposit(alice, 1000 * ONE);
        // 1 wei deposits after the position exists still mint non-zero shares.
        uint256 shares = _deposit(bob, 1);
        assertGt(shares, 0);
        assertLe(vault.previewRedeem(shares), 1);
    }

    // ─── max* / slippage ───────────────────────────────────────────────────

    function test_maxFunctions_zeroWhenStakingPaused() public {
        _deposit(alice, 100 * ONE);
        vm.prank(pauser);
        staking.pause();
        assertEq(vault.maxDeposit(alice), 0);
        assertEq(vault.maxMint(alice), 0);
        assertEq(vault.maxWithdraw(alice), 0);
        assertEq(vault.maxRedeem(alice), 0);

        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, alice, ONE, 0));
        vm.prank(alice);
        vault.deposit(ONE, alice);
    }

    function test_maxDeposit_zeroWhenPoolInactive_andRespectsCap() public {
        vm.prank(poolManager);
        staking.setPoolActive(GENESIS, false);
        assertEq(vault.maxDeposit(alice), 0);

        PoolParams memory p = _params("Genesis", 0, 10_000, 0);
        p.maxTotalPrincipal = uint128(500 * ONE);
        vm.startPrank(poolManager);
        staking.setPoolActive(GENESIS, true);
        staking.updatePool(GENESIS, p);
        vm.stopPrank();
        _stake(bob, GENESIS, 200 * ONE);
        assertEq(vault.maxDeposit(alice), 300 * ONE);
    }

    function test_maxDeposit_refusesLockedPoolForNewPosition() public {
        vm.prank(poolManager);
        staking.updatePool(GENESIS, _params("Genesis", 7 days, 12_000, 100));
        assertEq(vault.maxDeposit(alice), 0);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, alice, 10 * ONE, 0));
        vm.prank(alice);
        vault.deposit(10 * ONE, alice);
    }

    function test_existingVaultPosition_staysLiquidEvenIfPoolGainsLock() public {
        _deposit(alice, 100 * ONE);
        vm.prank(poolManager);
        staking.updatePool(GENESIS, _params("Genesis", 7 days, 12_000, 100));
        // Snapshot semantics: the vault's position was opened with no lock.
        _deposit(bob, 50 * ONE);
        assertEq(_redeemAll(alice), 100 * ONE);
    }

    function test_slippageHelpers() public {
        _fund(30_000 * ONE, 30 days);
        _deposit(alice, 1000 * ONE);
        _skip(1 days);
        uint256 expected = vault.previewDeposit(100 * ONE);
        vm.expectRevert(abi.encodeWithSelector(LiquidStakingVault.SlippageExceeded.selector, expected, expected + 1));
        vm.prank(bob);
        vault.depositWithMin(100 * ONE, bob, expected + 1);
        vm.prank(bob);
        uint256 shares = vault.depositWithMin(100 * ONE, bob, expected);

        uint256 expectedOut = vault.previewRedeem(shares);
        vm.expectRevert(
            abi.encodeWithSelector(LiquidStakingVault.SlippageExceeded.selector, expectedOut, expectedOut + 1)
        );
        vm.prank(bob);
        vault.redeemWithMin(shares, bob, bob, expectedOut + 1);
        vm.prank(bob);
        vault.redeemWithMin(shares, bob, bob, expectedOut);
    }

    function test_redeem_onBehalfRequiresAllowance() public {
        _deposit(alice, 100 * ONE);
        vm.expectRevert();
        vm.prank(attacker);
        vault.redeem(ONE, attacker, alice);
    }

    // ─── emergency exit ────────────────────────────────────────────────────

    function test_emergencyExit_requiresStakingPaused() public {
        _deposit(alice, 100 * ONE);
        vm.expectRevert(LiquidStakingVault.StakingNotPaused.selector);
        vm.prank(admin);
        vault.emergencyExit();
    }

    function test_emergencyExit_adminDuringPause_thenPaysFromIdle() public {
        _fund(30_000 * ONE, 30 days);
        _deposit(alice, 600 * ONE);
        _deposit(bob, 400 * ONE);
        _skip(1 days);
        vm.prank(pauser);
        staking.pause();

        vm.prank(admin);
        vault.emergencyExit();
        assertTrue(vault.exited());
        assertEq(vault.positionId(), 0);
        assertEq(vault.idleAssets(), 1000 * ONE, "principal recovered, rewards forfeited, no penalty");
        assertEq(vault.totalAssets(), 1000 * ONE);

        // Deposits disabled; withdrawals work even though staking is still paused.
        assertEq(vault.maxDeposit(alice), 0);
        assertApproxEqAbs(_redeemAll(alice), 600 * ONE, 1);
        assertApproxEqAbs(_redeemAll(bob), 400 * ONE, 1);

        vm.expectRevert(LiquidStakingVault.VaultExited.selector);
        vm.prank(admin);
        vault.emergencyExit();
    }

    function test_emergencyExit_permissionlessAfterDelay() public {
        _deposit(alice, 100 * ONE);
        vm.prank(pauser);
        staking.pause();
        uint256 availableAt = _now() + 3 days;

        vm.expectRevert(abi.encodeWithSelector(LiquidStakingVault.EmergencyExitTooEarly.selector, availableAt));
        vm.prank(carol);
        vault.emergencyExit();

        vm.warp(availableAt);
        vm.prank(carol);
        vault.emergencyExit();
        assertEq(_redeemAll(alice), 100 * ONE);
    }

    function test_emergencyExit_withNoPosition() public {
        vm.prank(pauser);
        staking.pause();
        vm.prank(admin);
        vault.emergencyExit();
        assertTrue(vault.exited());
        assertEq(vault.totalAssets(), 0);
    }

    function test_adminRoleIsVaultLocal() public {
        vm.prank(pauser);
        staking.pause();
        vm.expectRevert(abi.encodeWithSelector(LiquidStakingVault.EmergencyExitTooEarly.selector, _now() + 3 days));
        vm.prank(poolManager);
        vault.emergencyExit();
        assertFalse(vault.hasRole(vault.DEFAULT_ADMIN_ROLE(), poolManager));
    }
}
