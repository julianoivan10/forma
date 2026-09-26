// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Deploy} from "../../script/Deploy.s.sol";
import {IFormaTypes} from "../../src/interfaces/IFormaStaking.sol";

/// @notice Runs the real deployment script logic and checks the resulting configuration.
contract DeploymentTest is Test, IFormaTypes {
    Deploy internal script;
    Deploy.Config internal cfg;

    address internal admin = makeAddr("admin");
    address internal poolManager = makeAddr("poolManager");
    address internal rewardManager = makeAddr("rewardManager");
    address internal pauser = makeAddr("pauser");

    function setUp() public {
        vm.warp(1_750_000_000);
        script = new Deploy();
        cfg = Deploy.Config({
            admin: admin,
            poolManager: poolManager,
            rewardManager: rewardManager,
            pauser: pauser,
            initialRewards: 5_000_000e18,
            rewardDuration: 90 days
        });
    }

    function _deploy() internal returns (Deploy.Deployment memory) {
        return script.deploy(cfg, address(script));
    }

    function test_deploy_wiresEverything() public {
        Deploy.Deployment memory d = _deploy();
        assertEq(d.staking.stakingToken(), address(d.token));
        assertEq(d.staking.positionNFT(), address(d.nft));
        assertEq(d.nft.staking(), address(d.staking));
        assertEq(address(d.nft.renderer()), address(d.renderer));
        assertEq(address(d.vault.staking()), address(d.staking));
        assertEq(d.vault.asset(), address(d.token));
        assertEq(d.staking.poolCount(), 5);
        assertEq(d.staking.getPool(0).name, "Genesis");
        assertEq(d.staking.getPool(3).multiplierBps, 25_000);
        assertEq(d.staking.getPool(4).lockDuration, 1 hours);
    }

    function test_deploy_fundsRewardStream() public {
        Deploy.Deployment memory d = _deploy();
        RewardState memory s = d.staking.rewardState();
        assertEq(s.rewardReserve, 5_000_000e18);
        assertEq(s.periodFinish, block.timestamp + 90 days);
        assertEq(d.token.balanceOf(address(d.staking)), 5_000_000e18);
    }

    function test_deploy_rolesHandedOverAndDeployerRenounced() public {
        Deploy.Deployment memory d = _deploy();
        address deployer = address(script);

        assertTrue(d.staking.hasRole(d.staking.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(d.staking.hasRole(d.staking.POOL_MANAGER_ROLE(), poolManager));
        assertTrue(d.staking.hasRole(d.staking.REWARD_MANAGER_ROLE(), rewardManager));
        assertTrue(d.staking.hasRole(d.staking.PAUSER_ROLE(), pauser));
        assertTrue(d.token.hasRole(d.token.MINTER_ROLE(), rewardManager));
        assertTrue(d.token.hasRole(d.token.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(d.nft.hasRole(d.nft.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(d.vault.hasRole(d.vault.DEFAULT_ADMIN_ROLE(), admin));

        assertFalse(d.staking.hasRole(d.staking.DEFAULT_ADMIN_ROLE(), deployer));
        assertFalse(d.staking.hasRole(d.staking.POOL_MANAGER_ROLE(), deployer));
        assertFalse(d.staking.hasRole(d.staking.REWARD_MANAGER_ROLE(), deployer));
        assertFalse(d.staking.hasRole(d.staking.PAUSER_ROLE(), deployer));
        assertFalse(d.token.hasRole(d.token.MINTER_ROLE(), deployer));
        assertFalse(d.token.hasRole(d.token.DEFAULT_ADMIN_ROLE(), deployer));
        assertFalse(d.nft.hasRole(d.nft.DEFAULT_ADMIN_ROLE(), deployer));

        // Pauser and pool manager are separate from admin.
        assertFalse(d.staking.hasRole(d.staking.DEFAULT_ADMIN_ROLE(), pauser));
        assertFalse(d.staking.hasRole(d.staking.PAUSER_ROLE(), admin));
    }

    function test_deploy_refusesMainnets() public {
        uint256[4] memory chains = [uint256(1), 8453, 10, 42_161];
        for (uint256 i; i < chains.length; ++i) {
            vm.chainId(chains[i]);
            vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, chains[i]));
            script.deploy(cfg, address(script));
        }
    }

    function test_deploy_worksOnBaseSepoliaChainId() public {
        vm.chainId(84_532);
        Deploy.Deployment memory d = _deploy();
        assertEq(d.token.symbol(), "FORGE");
    }

    function test_deploy_endToEndUserFlow() public {
        Deploy.Deployment memory d = _deploy();
        address user = makeAddr("user");
        vm.startPrank(user);
        d.token.faucet();
        d.token.approve(address(d.staking), type(uint256).max);
        uint256 id = d.staking.stake(2, 500e18, 90 days, 17_500);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        assertGt(d.staking.pendingRewards(id), 0);
        vm.prank(user);
        d.staking.claim(id);
        string memory uri = d.nft.tokenURI(id);
        assertGt(bytes(uri).length, 1000);
    }
}
