// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title ForgeToken (FORGE) — TESTNET TOKEN, NO MONETARY VALUE
/// @notice ERC-20 used by the Forma protocol on local Anvil and Base Sepolia only.
///         Supply is hard-capped. New tokens come from exactly two places:
///         1. a public faucet with a fixed amount, a per-address cooldown and a global daily cap;
///         2. `MINTER_ROLE` (reward funding on testnet), bounded by the same cap.
/// @dev    The constructor refuses to deploy on any chain other than Anvil (31337) and
///         Base Sepolia (84532). This is a deliberate mainnet guard.
contract ForgeToken is ERC20, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 public constant MAX_SUPPLY = 1_000_000_000e18;
    uint256 public constant FAUCET_AMOUNT = 1000e18;
    uint256 public constant FAUCET_COOLDOWN = 24 hours;
    uint256 public constant FAUCET_DAILY_CAP = 1_000_000e18;

    uint256 public constant ANVIL_CHAIN_ID = 31_337;
    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;

    /// @notice Timestamp at which `account` may next use the faucet (0 = never used).
    mapping(address account => uint256) public nextFaucetAt;
    /// @notice Faucet-minted amount per UTC day index (`block.timestamp / 1 days`).
    mapping(uint256 day => uint256) public faucetMintedOnDay;

    event FaucetClaimed(address indexed account, uint256 amount, uint256 nextClaimAt);

    error UnsupportedChain(uint256 chainId);
    error FaucetCooldown(uint256 nextClaimAt);
    error FaucetDailyCapReached();
    error MaxSupplyExceeded();
    error ZeroAddress();

    constructor(address admin) ERC20("Forge Test Token", "FORGE") ERC20Permit("Forge Test Token") {
        if (block.chainid != ANVIL_CHAIN_ID && block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert UnsupportedChain(block.chainid);
        }
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Mint `FAUCET_AMOUNT` test tokens to the caller. Rate-limited.
    function faucet() external {
        uint256 next = nextFaucetAt[msg.sender];
        if (block.timestamp < next) revert FaucetCooldown(next);

        uint256 day = block.timestamp / 1 days;
        uint256 mintedToday = faucetMintedOnDay[day] + FAUCET_AMOUNT;
        if (mintedToday > FAUCET_DAILY_CAP) revert FaucetDailyCapReached();

        faucetMintedOnDay[day] = mintedToday;
        uint256 nextClaimAt = block.timestamp + FAUCET_COOLDOWN;
        nextFaucetAt[msg.sender] = nextClaimAt;

        _mintCapped(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT, nextClaimAt);
    }

    /// @notice Testnet reward funding. Bounded by `MAX_SUPPLY`.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mintCapped(to, amount);
    }

    /// @notice Faucet amount still available today across all users.
    function faucetRemainingToday() external view returns (uint256) {
        uint256 minted = faucetMintedOnDay[block.timestamp / 1 days];
        return minted >= FAUCET_DAILY_CAP ? 0 : FAUCET_DAILY_CAP - minted;
    }

    function _mintCapped(address to, uint256 amount) private {
        if (totalSupply() + amount > MAX_SUPPLY) revert MaxSupplyExceeded();
        _mint(to, amount);
    }
}
