// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";

import {Base} from "../utils/Base.t.sol";
import {Handler} from "./Handler.sol";

/// @notice Accounting invariants from PROTOCOL.md §5.5 plus ownership, authorization and vault consistency.
contract ProtocolInvariants is Base {
    Handler internal handler;
    address[] internal actorList;

    function setUp() public override {
        super.setUp();
        actorList.push(alice);
        actorList.push(bob);
        actorList.push(carol);
        actorList.push(makeAddr("dave"));
        for (uint256 i = 3; i < actorList.length; ++i) {
            _mint(actorList[i], 10_000_000 * ONE);
            vm.startPrank(actorList[i]);
            forge.approve(address(staking), type(uint256).max);
            forge.approve(address(vault), type(uint256).max);
            vm.stopPrank();
        }

        handler = new Handler(staking, nft, forge, vault, admin, rewardManager, pauser, actorList, keeper);
        _fund(100_000 * ONE, 30 days);

        bytes4[] memory selectors = new bytes4[](19);
        selectors[0] = Handler.stake.selector;
        selectors[1] = Handler.stake.selector; // weighted: staking is the most common action
        selectors[2] = Handler.increase.selector;
        selectors[3] = Handler.withdraw.selector;
        selectors[4] = Handler.withdrawAsStranger.selector;
        selectors[5] = Handler.claim.selector;
        selectors[6] = Handler.compound.selector;
        selectors[7] = Handler.setRouting.selector;
        selectors[8] = Handler.transferPosition.selector;
        selectors[9] = Handler.emergencyWithdraw.selector;
        selectors[10] = Handler.expireBoost.selector;
        selectors[11] = Handler.vaultDeposit.selector;
        selectors[12] = Handler.vaultRedeem.selector;
        selectors[13] = Handler.vaultHarvest.selector;
        selectors[14] = Handler.vaultEmergencyExit.selector;
        selectors[15] = Handler.fundRewards.selector;
        selectors[16] = Handler.togglePause.selector;
        selectors[17] = Handler.unauthorizedAdminAttempt.selector;
        selectors[18] = Handler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    // ─── solvency ──────────────────────────────────────────────────────────

    function invariant_balanceCoversPrincipalAndReserve() public view {
        assertGe(forge.balanceOf(address(staking)), staking.totalPrincipal() + staking.rewardReserve());
    }

    function invariant_reserveCoversOwedAndFutureRewards() public view {
        RewardState memory s = staking.rewardState();
        assertGe(s.rewardReserve, s.outstandingRewards + s.futureEmissions);
    }

    function invariant_cannotPayMoreRewardsThanFunded() public view {
        assertLe(
            handler.gRewardsOut() + handler.gCompounded(),
            handler.gRewardsFunded() + handler.gPenalties() + 100_000 * ONE // initial fund in setUp
        );
    }

    // ─── exact ghost accounting ────────────────────────────────────────────

    function invariant_principalMatchesGhost() public view {
        assertEq(
            staking.totalPrincipal(),
            handler.gPrincipalIn() + handler.gCompounded() - handler.gPrincipalOut() - handler.gPenalties()
        );
    }

    function invariant_reserveMatchesGhost() public view {
        assertEq(
            staking.rewardReserve(),
            100_000 * ONE + handler.gRewardsFunded() + handler.gPenalties() - handler.gRewardsOut()
                - handler.gCompounded()
        );
    }

    function invariant_realisedRewardStatsMatchPayouts() public view {
        uint256 earned;
        for (uint256 i; i < actorList.length; ++i) {
            earned += staking.accountStats(actorList[i]).rewardsEarned;
        }
        earned += staking.accountStats(address(vault)).rewardsEarned;
        assertEq(earned, handler.gRewardsOut() + handler.gCompounded(), "no rewards created or lost");
    }

    // ─── position-level consistency ────────────────────────────────────────

    function invariant_positionSumsMatchTotals() public view {
        uint256 n = staking.nextPositionId();
        uint256 poolCount = staking.poolCount();
        uint256[] memory poolPrincipal = new uint256[](poolCount);
        uint256[] memory poolWeight = new uint256[](poolCount);
        uint256[] memory poolOpen = new uint256[](poolCount);
        uint256 principal;
        uint256 weight;
        uint256 pending;
        uint256 active;

        for (uint256 id = 1; id < n; ++id) {
            Position memory p = staking.getPosition(id);
            if (p.status != PositionStatus.Active) {
                assertFalse(nft.exists(id), "closed position NFT burned");
                assertEq(p.principal, 0, "closed position has no principal");
                continue;
            }
            active++;
            assertTrue(nft.exists(id), "active position has NFT");
            assertGt(p.principal, 0);
            assertEq(p.weight, uint256(p.principal) * p.activeMultiplierBps / BPS, "weight formula");
            assertTrue(
                p.activeMultiplierBps == p.multiplierBps || p.activeMultiplierBps == BPS, "multiplier is snapshot or 1x"
            );
            principal += p.principal;
            weight += p.weight;
            pending += staking.pendingRewards(id);
            poolPrincipal[p.poolId] += p.principal;
            poolWeight[p.poolId] += p.weight;
            poolOpen[p.poolId]++;
        }

        assertEq(principal, staking.totalPrincipal(), "sum principal");
        assertEq(weight, staking.totalWeight(), "sum weight");
        assertLe(pending, staking.rewardState().outstandingRewards, "sum pending <= outstanding");
        for (uint256 i; i < poolCount; ++i) {
            Pool memory pool = staking.getPool(i);
            assertEq(pool.totalPrincipal, poolPrincipal[i], "pool principal");
            assertEq(pool.totalWeight, poolWeight[i], "pool weight");
            assertEq(pool.openPositions, poolOpen[i], "pool open positions");
        }

        uint256 nftTotal = nft.balanceOf(address(vault));
        for (uint256 i; i < actorList.length; ++i) {
            nftTotal += nft.balanceOf(actorList[i]);
        }
        assertEq(nftTotal, active, "NFT supply == active positions");
    }

    function invariant_ownerIndexConsistent() public view {
        for (uint256 i; i < actorList.length; ++i) {
            address owner = actorList[i];
            uint256 bal = nft.balanceOf(owner);
            uint256[] memory ids = nft.tokensOfOwner(owner, 0, bal);
            assertEq(ids.length, bal);
            for (uint256 j; j < ids.length; ++j) {
                assertEq(nft.ownerOf(ids[j]), owner, "index maps to true owner");
            }
        }
    }

    // ─── authorization / safety flags ──────────────────────────────────────

    function invariant_noLockBypass() public view {
        assertFalse(handler.lockBypassed());
    }

    function invariant_noUnauthorizedPrincipalAccess() public view {
        assertFalse(handler.unauthorizedWithdraw());
    }

    function invariant_noRewardTheft() public view {
        assertFalse(handler.unauthorizedClaim());
        assertFalse(handler.unauthorizedCompound());
    }

    function invariant_noUnauthorizedConfiguration() public view {
        assertFalse(handler.unauthorizedAdmin());
    }

    function invariant_emergencyNeverPaysRewards() public view {
        assertFalse(handler.emergencyPaidRewards());
    }

    // ─── vault ─────────────────────────────────────────────────────────────

    function invariant_vaultAssetsConsistent() public view {
        uint256 pid = vault.positionId();
        uint256 expected = vault.idleAssets();
        if (pid != 0) {
            assertEq(nft.ownerOf(pid), address(vault), "vault owns its position");
            expected += staking.getPosition(pid).principal + staking.pendingRewards(pid);
        }
        assertEq(vault.totalAssets(), expected);

        uint256 claimable;
        for (uint256 i; i < actorList.length; ++i) {
            claimable += vault.convertToAssets(vault.balanceOf(actorList[i]));
        }
        assertLe(claimable, vault.totalAssets(), "shares never over-claim assets");
        if (vault.exited()) assertEq(pid, 0);
    }

    /// @dev Coverage report: number of *successful* handler actions in the run (reverts are swallowed).
    function afterInvariant() external view {
        string[16] memory names = [
            "stake",
            "increase",
            "withdraw",
            "claim",
            "compound",
            "setRouting",
            "transfer",
            "emergency",
            "expireBoost",
            "vaultDeposit",
            "vaultRedeem",
            "vaultHarvest",
            "vaultExit",
            "fund",
            "",
            ""
        ];
        for (uint256 i; i < 14; ++i) {
            console2.log(names[i], handler.calls(bytes32(bytes(names[i]))));
        }
    }
}
