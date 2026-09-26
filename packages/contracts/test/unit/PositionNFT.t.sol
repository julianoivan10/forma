// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

import {IFormaStaking} from "../../src/interfaces/IFormaStaking.sol";
import {IPositionRenderer} from "../../src/interfaces/IPositionRenderer.sol";
import {PositionNFT} from "../../src/nft/PositionNFT.sol";
import {Base} from "../utils/Base.t.sol";

contract PositionNFTTest is Base {
    function test_onlyStakingCanMintOrBurn() public {
        vm.expectRevert(PositionNFT.OnlyStaking.selector);
        vm.prank(admin);
        nft.mint(attacker, 999);

        uint256 id = _stake(alice, GENESIS, 10 * ONE);
        vm.expectRevert(PositionNFT.OnlyStaking.selector);
        vm.prank(alice);
        nft.burn(id);
    }

    function test_ownerIndex_tracksMintTransferBurn() public {
        uint256 a = _stake(alice, GENESIS, 10 * ONE);
        uint256 b = _stake(alice, GENESIS, 10 * ONE);
        uint256 c = _stake(alice, GENESIS, 10 * ONE);
        assertEq(nft.balanceOf(alice), 3);

        vm.prank(alice);
        nft.transferFrom(alice, bob, a); // swap-and-pop: c moves into slot 0
        uint256[] memory ids = nft.tokensOfOwner(alice, 0, 10);
        assertEq(ids.length, 2);
        assertEq(ids[0], c);
        assertEq(ids[1], b);
        assertEq(nft.tokenOfOwnerByIndex(bob, 0), a);

        vm.prank(alice);
        staking.withdraw(b, 10 * ONE); // burn
        ids = nft.tokensOfOwner(alice, 0, 10);
        assertEq(ids.length, 1);
        assertEq(ids[0], c);

        vm.expectRevert(PositionNFT.IndexOutOfBounds.selector);
        nft.tokenOfOwnerByIndex(alice, 1);
    }

    function test_tokensOfOwner_pagination() public {
        for (uint256 i; i < 5; ++i) {
            _stake(alice, GENESIS, 10 * ONE);
        }
        assertEq(nft.tokensOfOwner(alice, 0, 2).length, 2);
        assertEq(nft.tokensOfOwner(alice, 4, 10).length, 1);
        assertEq(nft.tokensOfOwner(alice, 5, 10).length, 0);
        assertEq(nft.tokensOfOwner(alice, 3, 2)[1], 5);
        assertEq(staking.positionsOf(alice, 1, 2).length, 2);
    }

    function test_transfer_doesNotBypassLock() public {
        uint256 id = _stake(alice, LONG_FORGE, 100 * ONE);
        uint256 unlock = _pos(id).unlockTime;
        vm.prank(alice);
        nft.transferFrom(alice, bob, id);

        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.PositionLocked.selector, unlock));
        vm.prank(bob);
        staking.withdraw(id, 100 * ONE);

        // Previous owner lost all rights.
        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotPositionOwner.selector, id));
        vm.prank(alice);
        staking.emergencyWithdraw(id);

        vm.warp(unlock);
        vm.prank(bob);
        staking.withdraw(id, 100 * ONE);
    }

    function test_transfer_pendingRewardsTravelWithPosition() public {
        _fund(30_000 * ONE, 30 days);
        uint256 id = _stake(alice, GENESIS, 100 * ONE);
        _skip(1 days);
        uint256 pending = _pending(id);
        vm.prank(alice);
        nft.safeTransferFrom(alice, bob, id);

        uint256 bal = forge.balanceOf(bob);
        vm.prank(bob);
        staking.claim(id);
        assertEq(forge.balanceOf(bob), bal + pending);

        vm.expectRevert(abi.encodeWithSelector(IFormaStaking.NotAuthorizedToClaim.selector, id));
        vm.prank(alice);
        staking.claim(id);
    }

    function test_transfer_emergencyPenaltyStillApplies() public {
        uint256 id = _stake(alice, CONVICTION, 100 * ONE);
        vm.prank(alice);
        nft.transferFrom(alice, bob, id);
        vm.prank(bob);
        assertEq(staking.emergencyWithdraw(id), 90 * ONE, "penalty travels with the position");
    }

    function test_tokenURI_isDeterministicOnChainJson() public {
        uint256 id = _stake(alice, CONVICTION, 1234 * ONE);
        _skip(3 days);
        string memory uri = nft.tokenURI(id);
        assertEq(_prefix(uri, 29), "data:application/json;base64,");

        string memory json = string(Base64Decoder.decode(_slice(uri, 29)));
        assertTrue(_contains(json, '"name":"Forma Position #1"'));
        assertTrue(_contains(json, '"trait_type":"Pool","value":"Conviction"'));
        assertTrue(_contains(json, '"trait_type":"Multiplier","value":"1.75x"'));
        assertTrue(_contains(json, '"trait_type":"Lock Days","display_type":"number","value":90'));
        assertTrue(_contains(json, '"trait_type":"Amount Tier","display_type":"number","value":3'));
        assertTrue(_contains(json, '"trait_type":"Age Days","display_type":"number","value":3'));
        assertTrue(_contains(json, '"trait_type":"Status","value":"LOCKED"'));
        assertTrue(_contains(json, "TESTNET"));
        assertTrue(_contains(json, "data:image/svg+xml;base64,"));
        assertEq(nft.tokenURI(id), uri, "stable within a block");
    }

    function test_tokenURI_svgContent() public {
        uint256 id = _stake(alice, GENESIS, 50 * ONE);
        string memory json = string(Base64Decoder.decode(_slice(nft.tokenURI(id), 29)));
        uint256 start = _indexOf(json, "data:image/svg+xml;base64,") + 26;
        uint256 end = _indexOf(json, '","attributes"');
        string memory svg = string(Base64Decoder.decode(_substring(json, start, end)));
        assertTrue(_contains(svg, "#1</text>"));
        assertTrue(_contains(svg, "GENESIS"));
        assertTrue(_contains(svg, "50.00 FORGE"));
        assertTrue(_contains(svg, "NO LOCK"));
        assertTrue(_contains(svg, "1.00&#215;"));
        assertTrue(_contains(svg, "BASE SEPOLIA &#183; TESTNET"));
    }

    function test_tokenURI_nonexistentReverts() public {
        vm.expectRevert();
        nft.tokenURI(77);
    }

    function test_setRenderer_onlyAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, nft.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(attacker);
        nft.setRenderer(IPositionRenderer(address(1)));

        vm.expectRevert(PositionNFT.ZeroAddress.selector);
        vm.prank(admin);
        nft.setRenderer(IPositionRenderer(address(0)));
    }

    function test_supportsInterfaces() public view {
        assertTrue(nft.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(nft.supportsInterface(0x5b5e139f)); // ERC721Metadata
        assertTrue(nft.supportsInterface(0x49064906)); // ERC4906
        assertTrue(nft.supportsInterface(0x7965db0b)); // AccessControl
    }

    // ─── string helpers ────────────────────────────────────────────────────

    function _prefix(string memory s, uint256 n) internal pure returns (string memory) {
        return _substring(s, 0, n);
    }

    function _slice(string memory s, uint256 from) internal pure returns (string memory) {
        return _substring(s, from, bytes(s).length);
    }

    function _substring(string memory s, uint256 from, uint256 to) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(to - from);
        for (uint256 i = from; i < to; ++i) {
            out[i - from] = b[i];
        }
        return string(out);
    }

    function _indexOf(string memory haystack, string memory needle) internal pure returns (uint256) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        for (uint256 i; i + n.length <= h.length; ++i) {
            bool matched = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return i;
        }
        return type(uint256).max;
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        return _indexOf(haystack, needle) != type(uint256).max;
    }
}

/// @dev Minimal base64 decoder for test assertions (OZ ships only an encoder).
library Base64Decoder {
    function decode(string memory data) internal pure returns (bytes memory result) {
        bytes memory d = bytes(data);
        if (d.length == 0) return result;
        uint256 padding;
        if (d[d.length - 1] == "=") padding++;
        if (d[d.length - 2] == "=") padding++;
        result = new bytes(d.length / 4 * 3 - padding);
        uint256 out;
        for (uint256 i; i < d.length; i += 4) {
            uint256 n = (_val(d[i]) << 18) | (_val(d[i + 1]) << 12) | (_val(d[i + 2]) << 6) | _val(d[i + 3]);
            if (out < result.length) result[out++] = bytes1(uint8(n >> 16));
            if (out < result.length) result[out++] = bytes1(uint8(n >> 8));
            if (out < result.length) result[out++] = bytes1(uint8(n));
        }
    }

    function _val(bytes1 c) private pure returns (uint256) {
        if (c >= "A" && c <= "Z") return uint8(c) - 65;
        if (c >= "a" && c <= "z") return uint8(c) - 71;
        if (c >= "0" && c <= "9") return uint8(c) + 4;
        if (c == "+") return 62;
        if (c == "/") return 63;
        return 0; // '='
    }
}
