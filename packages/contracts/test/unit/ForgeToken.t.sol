// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {ForgeToken} from "../../src/token/ForgeToken.sol";

contract ForgeTokenTest is Test {
    ForgeToken internal token;
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");

    function setUp() public {
        vm.warp(1_750_000_000);
        token = new ForgeToken(admin);
    }

    function test_metadata() public view {
        assertEq(token.symbol(), "FORGE");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 0, "no premine");
    }

    function test_faucet_mintsFixedAmountAndSetsCooldown() public {
        vm.expectEmit(address(token));
        emit ForgeToken.FaucetClaimed(alice, 1000e18, block.timestamp + 24 hours);
        vm.prank(alice);
        token.faucet();
        assertEq(token.balanceOf(alice), 1000e18);
        assertEq(token.nextFaucetAt(alice), block.timestamp + 24 hours);
    }

    function test_faucet_revertsDuringCooldown_thenWorksAfter() public {
        vm.prank(alice);
        token.faucet();
        uint256 next = token.nextFaucetAt(alice);

        vm.warp(next - 1);
        vm.expectRevert(abi.encodeWithSelector(ForgeToken.FaucetCooldown.selector, next));
        vm.prank(alice);
        token.faucet();

        vm.warp(next);
        vm.prank(alice);
        token.faucet();
        assertEq(token.balanceOf(alice), 2000e18);
    }

    function test_faucet_globalDailyCap() public {
        uint256 claims = token.FAUCET_DAILY_CAP() / token.FAUCET_AMOUNT();
        // Stay inside one UTC day.
        vm.warp((block.timestamp / 1 days) * 1 days + 1);
        for (uint256 i; i < claims; ++i) {
            vm.prank(address(uint160(0x1000 + i)));
            token.faucet();
        }
        assertEq(token.faucetRemainingToday(), 0);
        vm.expectRevert(ForgeToken.FaucetDailyCapReached.selector);
        vm.prank(alice);
        token.faucet();

        // Next day the cap resets.
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        token.faucet();
        assertEq(token.faucetRemainingToday(), token.FAUCET_DAILY_CAP() - token.FAUCET_AMOUNT());
    }

    function test_mint_onlyMinter() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, token.MINTER_ROLE())
        );
        vm.prank(alice);
        token.mint(alice, 1);

        // Admin must explicitly grant the minter role; holding admin alone is not enough.
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, admin, token.MINTER_ROLE())
        );
        vm.prank(admin);
        token.mint(alice, 1);
    }

    function test_mint_respectsMaxSupply() public {
        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), admin);
        token.mint(alice, token.MAX_SUPPLY());
        vm.expectRevert(ForgeToken.MaxSupplyExceeded.selector);
        token.mint(alice, 1);
        vm.stopPrank();

        vm.expectRevert(ForgeToken.MaxSupplyExceeded.selector);
        vm.prank(alice);
        token.faucet();
    }

    function test_constructor_rejectsMainnetChains() public {
        uint256[3] memory chains = [uint256(1), 8453, 10];
        for (uint256 i; i < chains.length; ++i) {
            vm.chainId(chains[i]);
            vm.expectRevert(abi.encodeWithSelector(ForgeToken.UnsupportedChain.selector, chains[i]));
            new ForgeToken(admin);
        }
    }

    function test_constructor_allowsBaseSepolia() public {
        vm.chainId(84_532);
        ForgeToken t = new ForgeToken(admin);
        assertEq(t.symbol(), "FORGE");
    }

    function test_constructor_rejectsZeroAdmin() public {
        vm.expectRevert(ForgeToken.ZeroAddress.selector);
        new ForgeToken(address(0));
    }
}
