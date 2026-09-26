// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {FormaStaking} from "../src/FormaStaking.sol";
import {IFormaTypes} from "../src/interfaces/IFormaStaking.sol";
import {IPositionNFT} from "../src/interfaces/IPositionNFT.sol";
import {PositionNFT} from "../src/nft/PositionNFT.sol";
import {PositionRenderer} from "../src/nft/PositionRenderer.sol";
import {ForgeToken} from "../src/token/ForgeToken.sol";
import {LiquidStakingVault} from "../src/vault/LiquidStakingVault.sol";

/// @title Deploy
/// @notice Deploys the full Forma protocol to Anvil (31337) or Base Sepolia (84532). Any other chain id —
///         including every mainnet — is refused. Adding mainnet support requires an intentional code change.
///
///         Usage (never pass a raw private key; use an encrypted keystore account):
///           forge script script/Deploy.s.sol --rpc-url base_sepolia --account forma-deployer --broadcast --verify
///
///         Env (all optional on Anvil, where they default to the deployer):
///           ADMIN_ADDRESS, POOL_MANAGER_ADDRESS, REWARD_MANAGER_ADDRESS, PAUSER_ADDRESS
///           INITIAL_REWARDS (wei, default 5,000,000 FORGE), REWARD_DURATION (seconds, default 90 days)
contract Deploy is Script, IFormaTypes {
    uint256 internal constant ANVIL = 31_337;
    uint256 internal constant BASE_SEPOLIA = 84_532;
    string public constant VERSION = "0.1.0";

    struct Config {
        address admin;
        address poolManager;
        address rewardManager;
        address pauser;
        uint256 initialRewards;
        uint256 rewardDuration;
    }

    struct Deployment {
        ForgeToken token;
        PositionNFT nft;
        FormaStaking staking;
        PositionRenderer renderer;
        LiquidStakingVault vault;
    }

    error UnsupportedChain(uint256 chainId);
    error MissingRoleAddress(string name);

    function run() external returns (Deployment memory d) {
        _assertSupportedChain();
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        Config memory cfg = _configFromEnv(deployer);
        d = deploy(cfg, deployer);
        vm.stopBroadcast();
        _writeManifest(d, cfg, deployer);
    }

    /// @notice Deterministic deployment + configuration. `deployer` must be the account executing the creates.
    function deploy(Config memory cfg, address deployer) public returns (Deployment memory d) {
        _assertSupportedChain();

        d.token = new ForgeToken(deployer);
        address predictedStaking = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        d.nft = new PositionNFT(predictedStaking, deployer);
        d.staking = new FormaStaking(
            IERC20(address(d.token)),
            IPositionNFT(address(d.nft)),
            deployer,
            CompoundConfig({keeperFeeBps: 100, keeperCooldown: 1 hours, minCompoundAmount: 1e18})
        );
        require(address(d.staking) == predictedStaking, "staking address mismatch");
        d.renderer = new PositionRenderer(d.staking);
        d.nft.setRenderer(d.renderer);

        // Pools (testnet example parameters — not economic promises).
        d.staking.grantRole(d.staking.POOL_MANAGER_ROLE(), deployer);
        d.staking.createPool(_pool("Genesis", 0, 10_000, 0));
        d.staking.createPool(_pool("Builder", 30 days, 12_500, 500));
        d.staking.createPool(_pool("Conviction", 90 days, 17_500, 1000));
        d.staking.createPool(_pool("Long Forge", 180 days, 25_000, 1500));
        d.staking.createPool(_pool("Calibration", 1 hours, 11_000, 200));

        d.vault = new LiquidStakingVault(IERC20(address(d.token)), d.staking, 0, cfg.admin);

        // Initial testnet reward stream.
        if (cfg.initialRewards > 0) {
            d.token.grantRole(d.token.MINTER_ROLE(), deployer);
            d.token.mint(deployer, cfg.initialRewards);
            d.staking.grantRole(d.staking.REWARD_MANAGER_ROLE(), deployer);
            d.token.approve(address(d.staking), cfg.initialRewards);
            d.staking.notifyRewards(cfg.initialRewards, cfg.rewardDuration);
        }

        _handOverRoles(d, cfg, deployer);
    }

    function _handOverRoles(Deployment memory d, Config memory cfg, address deployer) internal {
        FormaStaking s = d.staking;
        s.grantRole(s.POOL_MANAGER_ROLE(), cfg.poolManager);
        s.grantRole(s.REWARD_MANAGER_ROLE(), cfg.rewardManager);
        s.grantRole(s.PAUSER_ROLE(), cfg.pauser);
        s.grantRole(s.DEFAULT_ADMIN_ROLE(), cfg.admin);
        d.token.grantRole(d.token.MINTER_ROLE(), cfg.rewardManager);
        d.token.grantRole(d.token.DEFAULT_ADMIN_ROLE(), cfg.admin);
        d.nft.grantRole(d.nft.DEFAULT_ADMIN_ROLE(), cfg.admin);

        // The deployer keeps nothing it was not explicitly configured to hold.
        if (deployer != cfg.poolManager) s.renounceRole(s.POOL_MANAGER_ROLE(), deployer);
        if (deployer != cfg.rewardManager) {
            s.renounceRole(s.REWARD_MANAGER_ROLE(), deployer);
            d.token.renounceRole(d.token.MINTER_ROLE(), deployer);
        }
        if (deployer != cfg.admin) {
            s.renounceRole(s.DEFAULT_ADMIN_ROLE(), deployer);
            d.token.renounceRole(d.token.DEFAULT_ADMIN_ROLE(), deployer);
            d.nft.renounceRole(d.nft.DEFAULT_ADMIN_ROLE(), deployer);
        }
    }

    function _pool(string memory name, uint64 lock, uint16 mult, uint16 penalty)
        internal
        pure
        returns (PoolParams memory)
    {
        return PoolParams({
            name: name,
            lockDuration: lock,
            multiplierBps: mult,
            earlyExitPenaltyBps: penalty,
            minStake: 1e18,
            maxTotalPrincipal: 0
        });
    }

    function _assertSupportedChain() internal view {
        if (block.chainid != ANVIL && block.chainid != BASE_SEPOLIA) revert UnsupportedChain(block.chainid);
    }

    function _configFromEnv(address deployer) internal view returns (Config memory cfg) {
        bool local = block.chainid == ANVIL;
        cfg.admin = _roleAddress("ADMIN_ADDRESS", deployer, local);
        cfg.poolManager = _roleAddress("POOL_MANAGER_ADDRESS", deployer, local);
        cfg.rewardManager = _roleAddress("REWARD_MANAGER_ADDRESS", deployer, local);
        cfg.pauser = _roleAddress("PAUSER_ADDRESS", deployer, local);
        cfg.initialRewards = vm.envOr("INITIAL_REWARDS", uint256(5_000_000e18));
        cfg.rewardDuration = vm.envOr("REWARD_DURATION", uint256(90 days));
    }

    /// @dev On Base Sepolia every role address must be set explicitly (no silent "deployer owns everything").
    function _roleAddress(string memory name, address deployer, bool local) internal view returns (address a) {
        a = vm.envOr(name, address(0));
        if (a == address(0)) {
            if (!local) revert MissingRoleAddress(name);
            a = deployer;
        }
    }

    function _writeManifest(Deployment memory d, Config memory cfg, address deployer) internal {
        string memory network = block.chainid == ANVIL ? "anvil" : "base-sepolia";
        string memory c = "contracts";
        vm.serializeAddress(c, "ForgeToken", address(d.token));
        vm.serializeAddress(c, "PositionNFT", address(d.nft));
        vm.serializeAddress(c, "FormaStaking", address(d.staking));
        vm.serializeAddress(c, "PositionRenderer", address(d.renderer));
        string memory contractsJson = vm.serializeAddress(c, "LiquidStakingVault", address(d.vault));

        string memory r = "roles";
        vm.serializeAddress(r, "admin", cfg.admin);
        vm.serializeAddress(r, "poolManager", cfg.poolManager);
        vm.serializeAddress(r, "rewardManager", cfg.rewardManager);
        string memory rolesJson = vm.serializeAddress(r, "pauser", cfg.pauser);

        string memory m = "manifest";
        vm.serializeString(m, "network", network);
        vm.serializeUint(m, "chainId", block.chainid);
        vm.serializeString(m, "version", VERSION);
        vm.serializeAddress(m, "deployer", deployer);
        vm.serializeUint(m, "deployedAt", block.timestamp);
        vm.serializeUint(m, "startBlock", block.number);
        vm.serializeUint(m, "initialRewards", cfg.initialRewards);
        vm.serializeUint(m, "rewardDuration", cfg.rewardDuration);
        vm.serializeString(m, "roles", rolesJson);
        string memory json = vm.serializeString(m, "contracts", contractsJson);

        string memory path = string.concat(vm.projectRoot(), "/../../deployments/", network, ".json");
        vm.writeJson(json, path);
        console2.log("Manifest written:", path);
    }
}
