// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {FormaStaking} from "../../src/FormaStaking.sol";
import {IFormaTypes} from "../../src/interfaces/IFormaStaking.sol";
import {PositionNFT} from "../../src/nft/PositionNFT.sol";
import {ForgeToken} from "../../src/token/ForgeToken.sol";
import {LiquidStakingVault} from "../../src/vault/LiquidStakingVault.sol";

/// @notice Drives random but valid-looking protocol usage and records ghost accounting derived purely
///         from call inputs/outputs (never from FormaStaking's own counters).
contract Handler is CommonBase, StdCheats, StdUtils, IFormaTypes {
    uint256 internal constant ONE = 1e18;

    FormaStaking public staking;
    PositionNFT public nft;
    ForgeToken public forge;
    LiquidStakingVault public vault;
    address public admin;
    address public rewardManager;
    address public pauser;

    address[] public actors;
    address public keeper;
    uint256[] public positionIds;

    // ─── ghost accounting ──────────────────────────────────────────────────
    uint256 public gPrincipalIn;
    uint256 public gPrincipalOut;
    uint256 public gCompounded;
    uint256 public gPenalties;
    uint256 public gRewardsFunded;
    uint256 public gRewardsOut;

    // ─── violation flags (must stay false) ─────────────────────────────────
    bool public lockBypassed;
    bool public unauthorizedWithdraw;
    bool public unauthorizedClaim;
    bool public unauthorizedCompound;
    bool public unauthorizedAdmin;
    bool public emergencyPaidRewards;

    mapping(bytes32 => uint256) public calls;

    constructor(
        FormaStaking staking_,
        PositionNFT nft_,
        ForgeToken forge_,
        LiquidStakingVault vault_,
        address admin_,
        address rewardManager_,
        address pauser_,
        address[] memory actors_,
        address keeper_
    ) {
        staking = staking_;
        nft = nft_;
        forge = forge_;
        vault = vault_;
        admin = admin_;
        rewardManager = rewardManager_;
        pauser = pauser_;
        actors = actors_;
        keeper = keeper_;
    }

    // ─── helpers ───────────────────────────────────────────────────────────

    function positionCount() external view returns (uint256) {
        return positionIds.length;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    /// @dev Picks the first *active* position at or after `seed` (wrapping), so calls are not wasted on closed ones.
    function _position(uint256 seed) internal view returns (uint256 id, bool ok) {
        uint256 len = positionIds.length;
        for (uint256 i; i < len; ++i) {
            id = positionIds[(seed + i) % len];
            if (staking.getPosition(id).status == PositionStatus.Active) return (id, true);
        }
        return (0, false);
    }

    function _now() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    // ─── user actions ──────────────────────────────────────────────────────

    function stake(uint256 actorSeed, uint256 poolSeed, uint256 amount) external {
        address user = _actor(actorSeed);
        uint256 poolId = poolSeed % staking.poolCount();
        amount = bound(amount, ONE, 1_000_000 * ONE);
        Pool memory pool = staking.getPool(poolId);
        vm.prank(user);
        try staking.stake(poolId, amount, pool.lockDuration, pool.multiplierBps) returns (uint256 id) {
            positionIds.push(id);
            gPrincipalIn += amount;
            calls["stake"]++;
        } catch {}
    }

    function increase(uint256 posSeed, uint256 amount) external {
        (uint256 id, bool ok) = _position(posSeed);
        if (!ok) return;
        address owner = nft.ownerOf(id);
        if (owner == address(vault)) return;
        amount = bound(amount, 1, 100_000 * ONE);
        bool locked = _now() < staking.getPosition(id).unlockTime;
        vm.prank(owner);
        try staking.increasePosition(id, amount) {
            if (locked) lockBypassed = true;
            gPrincipalIn += amount;
            calls["increase"]++;
        } catch {}
    }

    function withdraw(uint256 posSeed, uint256 fraction) external {
        (uint256 id, bool ok) = _position(posSeed);
        if (!ok) return;
        address owner = nft.ownerOf(id);
        if (owner == address(vault)) return;
        Position memory p = staking.getPosition(id);
        fraction = bound(fraction, 1, 100);
        uint256 amount = fraction == 100 ? p.principal : (uint256(p.principal) * fraction) / 100;
        if (amount == 0) amount = 1;
        bool locked = _now() < p.unlockTime;
        vm.prank(owner);
        try staking.withdraw(id, amount) returns (uint256 rewardsPaid) {
            if (locked) lockBypassed = true;
            gPrincipalOut += amount;
            gRewardsOut += rewardsPaid;
            calls["withdraw"]++;
        } catch {}
    }

    function withdrawAsStranger(uint256 posSeed, uint256 actorSeed) external {
        (uint256 id, bool ok) = _position(posSeed);
        if (!ok) return;
        address caller = _actor(actorSeed);
        if (caller == nft.ownerOf(id)) return;
        vm.prank(caller);
        try staking.withdraw(id, 1) {
            unauthorizedWithdraw = true;
        } catch {}
        vm.prank(caller);
        try staking.emergencyWithdraw(id) {
            unauthorizedWithdraw = true;
        } catch {}
    }

    function claim(uint256 posSeed, uint256 callerSeed) external {
        (uint256 id, bool ok) = _position(posSeed);
        if (!ok) return;
        address owner = nft.ownerOf(id);
        Routing memory r = staking.effectiveRouting(id);
        // Try as the owner, the configured recipient, or a random actor.
        address caller = callerSeed % 3 == 0
            ? owner
            : (callerSeed % 3 == 1 && r.recipient != address(0)) ? r.recipient : _actor(callerSeed);
        address expectedTo = r.mode == RoutingMode.Redirect ? r.recipient : owner;
        uint256 destBefore = forge.balanceOf(expectedTo);
        vm.prank(caller);
        try staking.claim(id) returns (uint256 amount) {
            bool authorized = caller == owner || (r.mode == RoutingMode.Redirect && caller == r.recipient);
            if (!authorized) unauthorizedClaim = true;
            // Rewards must land exactly at the routing destination chosen by the current owner.
            if (forge.balanceOf(expectedTo) != destBefore + amount && expectedTo != address(staking)) {
                unauthorizedClaim = true;
            }
            gRewardsOut += amount;
            calls["claim"]++;
        } catch {}
    }

    function compound(uint256 posSeed, bool asKeeper) external {
        (uint256 id, bool ok) = _position(posSeed);
        if (!ok) return;
        address owner = nft.ownerOf(id);
        address caller = asKeeper ? keeper : owner;
        Routing memory r = staking.effectiveRouting(id);
        vm.prank(caller);
        try staking.compound(id) returns (uint256 compounded, uint256 fee) {
            if (caller != owner && r.mode != RoutingMode.Compound) unauthorizedCompound = true;
            if (caller != owner && fee * 10_000 > (compounded + fee) * r.maxKeeperFeeBps) unauthorizedCompound = true;
            gCompounded += compounded;
            gRewardsOut += fee;
            calls["compound"]++;
        } catch {}
    }

    function setRouting(uint256 posSeed, uint256 modeSeed, uint256 recipientSeed, uint16 fee) external {
        (uint256 id, bool ok) = _position(posSeed);
        if (!ok) return;
        address owner = nft.ownerOf(id);
        if (owner == address(vault)) return;
        RoutingMode mode = RoutingMode(modeSeed % 3);
        address recipient = mode == RoutingMode.Redirect ? _actor(recipientSeed) : address(0);
        uint16 maxFee = mode == RoutingMode.Compound ? uint16(bound(fee, 0, 500)) : 0;
        vm.prank(owner);
        try staking.setRouting(id, mode, recipient, maxFee) {
            calls["setRouting"]++;
        } catch {}
    }

    function transferPosition(uint256 posSeed, uint256 toSeed) external {
        (uint256 id, bool ok) = _position(posSeed);
        if (!ok) return;
        address owner = nft.ownerOf(id);
        if (owner == address(vault)) return;
        address to = _actor(toSeed);
        vm.prank(owner);
        nft.transferFrom(owner, to, id);
        calls["transfer"]++;
    }

    function emergencyWithdraw(uint256 posSeed) external {
        (uint256 id, bool ok) = _position(posSeed);
        if (!ok) return;
        address owner = nft.ownerOf(id);
        if (owner == address(vault)) return;
        uint256 principal = staking.getPosition(id).principal;
        uint256 balBefore = forge.balanceOf(owner);
        vm.prank(owner);
        try staking.emergencyWithdraw(id) returns (uint256 amountOut) {
            if (forge.balanceOf(owner) - balBefore != amountOut || amountOut > principal) emergencyPaidRewards = true;
            gPrincipalOut += amountOut;
            gPenalties += principal - amountOut;
            calls["emergency"]++;
        } catch {}
    }

    function expireBoost(uint256 posSeed) external {
        (uint256 id, bool ok) = _position(posSeed);
        if (!ok) return;
        try staking.expireBoost(id) {
            calls["expireBoost"]++;
        } catch {}
    }

    // ─── vault ─────────────────────────────────────────────────────────────

    function vaultDeposit(uint256 actorSeed, uint256 amount) external {
        address user = _actor(actorSeed);
        amount = bound(amount, ONE, 500_000 * ONE);
        vm.prank(user);
        try vault.deposit(amount, user) {
            gPrincipalIn += amount;
            calls["vaultDeposit"]++;
        } catch {}
    }

    function vaultRedeem(uint256 actorSeed, uint256 fraction) external {
        address user = _actor(actorSeed);
        uint256 shares = vault.balanceOf(user) * bound(fraction, 1, 100) / 100;
        if (shares == 0) return;
        uint256 pid = vault.positionId();
        uint256 pending = pid == 0 ? 0 : staking.pendingRewards(pid);
        bool exited = vault.exited();
        vm.prank(user);
        try vault.redeem(shares, user, user) returns (uint256 assets) {
            if (!exited) {
                // The vault compounds (fee-free) before withdrawing principal.
                gCompounded += pending;
                gPrincipalOut += assets;
            }
            calls["vaultRedeem"]++;
        } catch {}
    }

    function vaultHarvest() external {
        uint256 pid = vault.positionId();
        uint256 pending = pid == 0 ? 0 : staking.pendingRewards(pid);
        try vault.harvest() returns (uint256 compounded) {
            if (compounded != pending) emergencyPaidRewards = true;
            gCompounded += compounded;
            calls["vaultHarvest"]++;
        } catch {}
    }

    function vaultEmergencyExit(uint256 seed) external {
        // Rare: exit only occasionally so the vault stays active for most of the run.
        if (seed % 10 != 0 || !staking.paused() || vault.exited()) return;
        uint256 pid = vault.positionId();
        uint256 principal = pid == 0 ? 0 : staking.getPosition(pid).principal;
        vm.prank(admin);
        try vault.emergencyExit() {
            gPrincipalOut += principal; // paused ⇒ no penalty, rewards forfeited
            calls["vaultExit"]++;
        } catch {}
    }

    // ─── admin / time ──────────────────────────────────────────────────────

    function fundRewards(uint256 amount, uint256 duration) external {
        amount = bound(amount, 0, 200_000 * ONE);
        duration = bound(duration, 1 days, 90 days);
        vm.prank(rewardManager);
        try staking.notifyRewards(amount, duration) {
            gRewardsFunded += amount;
            calls["fund"]++;
        } catch {}
    }

    function togglePause(uint256 seed) external {
        if (staking.paused()) {
            vm.prank(admin);
            staking.unpause();
        } else if (seed % 8 == 0) {
            vm.prank(pauser);
            staking.pause();
        }
    }

    function unauthorizedAdminAttempt(uint256 actorSeed, uint256 which) external {
        address caller = _actor(actorSeed);
        vm.startPrank(caller);
        which = which % 5;
        if (which == 0) {
            try staking.createPool(
                PoolParams({
                    name: "Rogue",
                    lockDuration: 1 days,
                    multiplierBps: 50_000,
                    earlyExitPenaltyBps: 0,
                    minStake: 1,
                    maxTotalPrincipal: 0
                })
            ) {
                unauthorizedAdmin = true;
            } catch {}
        } else if (which == 1) {
            try staking.notifyRewards(0, 1 days) {
                unauthorizedAdmin = true;
            } catch {}
        } else if (which == 2) {
            try staking.pause() {
                unauthorizedAdmin = true;
            } catch {}
        } else if (which == 3) {
            try staking.setCompoundConfig(
                CompoundConfig({keeperFeeBps: 500, keeperCooldown: 10 minutes, minCompoundAmount: 0})
            ) {
                unauthorizedAdmin = true;
            } catch {}
        } else {
            try staking.updatePool(0, PoolParams("Genesis", 0, 10_000, 0, 1, 0)) {
                unauthorizedAdmin = true;
            } catch {}
        }
        vm.stopPrank();
    }

    function warp(uint256 dt) external {
        dt = bound(dt, 1, 15 days);
        vm.warp(_now() + dt);
    }
}
