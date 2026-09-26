// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IFormaStaking, IFormaTypes} from "../interfaces/IFormaStaking.sol";
import {IPositionRenderer} from "../interfaces/IPositionRenderer.sol";

/// @title PositionRenderer
/// @notice Deterministic on-chain metadata + SVG for Forma positions. Stateless; reads FormaStaking.
/// @dev    Visual encoding (mirrored by the frontend `PositionGlyph`, see docs/ARCHITECTURE.md):
///         - tick density   = principal tier (1–6, decades of FORGE)
///         - arc sweep      = lock progress (full ring once unlocked / no lock)
///         - arc weight     = active multiplier
///         - hue            = lock tier (none / ≤30d / ≤90d / >90d)
///         - rotation       = position id (identity)
contract PositionRenderer is IPositionRenderer {
    using Strings for uint256;

    IFormaStaking public immutable staking;

    string private constant INK = "#0E1A2B";
    string private constant IVORY = "#F3EFE4";

    constructor(IFormaStaking staking_) {
        staking = staking_;
    }

    function tokenURI(uint256 positionId) external view returns (string memory) {
        IFormaTypes.PositionView memory v = staking.getPositionView(positionId);
        string memory poolName = staking.getPool(v.position.poolId).name;
        Visual memory vis = _visual(v);

        string memory json = string.concat(
            '{"name":"Forma Position #',
            positionId.toString(),
            '","description":"A Forma staking position on Base Sepolia (TESTNET). The token represents the position itself: principal, lock, multiplier and pending rewards. Test tokens have no monetary value.",',
            '"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(positionId, poolName, v, vis))),
            '","attributes":',
            _attributes(poolName, v, vis),
            "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // ─── visual model ──────────────────────────────────────────────────────

    struct Visual {
        uint256 tier; // 1..6
        uint256 progress; // 0..1000
        uint256 strokeWidth;
        uint256 rotation;
        uint256 lockDays;
        uint256 elapsedDays;
        string color;
        string status;
    }

    function _visual(IFormaTypes.PositionView memory v) internal view returns (Visual memory vis) {
        IFormaTypes.Position memory p = v.position;
        uint256 lock = p.unlockTime - p.startTime;
        vis.lockDays = lock / 1 days;
        vis.elapsedDays = (block.timestamp - p.startTime) / 1 days;
        vis.tier = _tier(p.principal);
        vis.progress =
            (lock == 0 || block.timestamp >= p.unlockTime) ? 1000 : (block.timestamp - p.startTime) * 1000 / lock;
        vis.strokeWidth = 6 + (uint256(p.activeMultiplierBps) - 10_000) * 12 / 40_000;
        vis.rotation = (v.id * 137) % 360;
        vis.color = _color(lock);
        vis.status = lock == 0 ? "OPEN" : (v.locked ? "LOCKED" : "UNLOCKED");
    }

    function _tier(uint256 principal) internal pure returns (uint256) {
        uint256 whole = principal / 1e18;
        if (whole < 100) return 1;
        if (whole < 1000) return 2;
        if (whole < 10_000) return 3;
        if (whole < 100_000) return 4;
        if (whole < 1_000_000) return 5;
        return 6;
    }

    function _color(uint256 lock) internal pure returns (string memory) {
        if (lock == 0) return "#B8F229"; // lime — liquid
        if (lock <= 30 days) return "#2E9BFF"; // sky
        if (lock <= 90 days) return "#FF5F1F"; // orange
        return "#6C4CFF"; // violet — long conviction
    }

    // ─── svg ───────────────────────────────────────────────────────────────

    function _svg(uint256 id, string memory poolName, IFormaTypes.PositionView memory v, Visual memory vis)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">',
            '<rect width="400" height="400" fill="',
            IVORY,
            '"/>',
            _header(id, poolName),
            _glyph(vis),
            _footer(v, vis),
            "</svg>"
        );
    }

    function _header(uint256 id, string memory poolName) internal pure returns (string memory) {
        return string.concat(
            '<g fill="',
            INK,
            '"><text x="24" y="36" font-size="11" letter-spacing="2">FORMA / POSITION</text>',
            '<text x="376" y="40" font-size="26" font-weight="700" text-anchor="end">#',
            id.toString(),
            '</text><text x="24" y="62" font-size="15" font-weight="700" letter-spacing="1">',
            _upper(poolName),
            '</text></g><line x1="24" y1="76" x2="376" y2="76" stroke="',
            INK,
            '" stroke-width="1"/>'
        );
    }

    function _glyph(Visual memory vis) internal pure returns (string memory ticks) {
        uint256 count = vis.tier * 8;
        for (uint256 i; i < count; ++i) {
            ticks = string.concat(
                ticks,
                '<line x1="0" y1="-112" x2="0" y2="',
                i % 4 == 0 ? "-100" : "-106",
                '" transform="rotate(',
                _tenths(i * 3600 / count), // tenths of a degree
                ')"/>'
            );
        }
        return string.concat(
            '<g transform="translate(200 196) rotate(',
            vis.rotation.toString(),
            ')"><g stroke="',
            INK,
            '" stroke-width="1.5">',
            ticks,
            '</g><circle r="86" fill="none" stroke="',
            INK,
            '" stroke-opacity=".12" stroke-width="',
            vis.strokeWidth.toString(),
            '"/><circle r="86" fill="none" stroke="',
            vis.color,
            '" stroke-width="',
            vis.strokeWidth.toString(),
            '" pathLength="1000" stroke-dasharray="',
            vis.progress.toString(),
            ' 1000" transform="rotate(-90)"/><circle r="58" fill="',
            INK,
            '"/></g>'
        );
    }

    function _footer(IFormaTypes.PositionView memory v, Visual memory vis) internal pure returns (string memory) {
        string memory lockLine = vis.lockDays == 0 && v.position.unlockTime == v.position.startTime
            ? "NO LOCK"
            : string.concat("DAY ", _min(vis.elapsedDays, vis.lockDays).toString(), " / ", vis.lockDays.toString());
        return string.concat(
            '<text x="200" y="203" font-size="20" font-weight="700" fill="',
            IVORY,
            '" text-anchor="middle">',
            _formatBps(v.position.activeMultiplierBps),
            "&#215;</text>",
            '<line x1="24" y1="324" x2="376" y2="324" stroke="',
            INK,
            '" stroke-width="1"/><g fill="',
            INK,
            '" font-size="11"><text x="24" y="346">PRINCIPAL</text><text x="376" y="346" text-anchor="end">',
            _formatToken(v.position.principal),
            ' FORGE</text><text x="24" y="364">',
            lockLine,
            '</text><text x="376" y="364" text-anchor="end">',
            vis.status,
            '</text><text x="24" y="386" font-size="9" letter-spacing="1.5" fill-opacity=".6">BASE SEPOLIA &#183; TESTNET &#183; NO MONETARY VALUE</text></g>'
        );
    }

    function _attributes(string memory poolName, IFormaTypes.PositionView memory v, Visual memory vis)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '[{"trait_type":"Pool","value":"',
            poolName,
            '"},{"trait_type":"Lock Days","display_type":"number","value":',
            vis.lockDays.toString(),
            '},{"trait_type":"Multiplier","value":"',
            _formatBps(v.position.multiplierBps),
            'x"},{"trait_type":"Active Multiplier","value":"',
            _formatBps(v.position.activeMultiplierBps),
            'x"},{"trait_type":"Amount Tier","display_type":"number","value":',
            vis.tier.toString(),
            '},{"trait_type":"Age Days","display_type":"number","value":',
            vis.elapsedDays.toString(),
            '},{"trait_type":"Status","value":"',
            vis.status,
            '"},{"trait_type":"Network","value":"Base Sepolia (testnet)"}]'
        );
    }

    // ─── formatting helpers ────────────────────────────────────────────────

    /// @dev 17_500 → "1.75"
    function _formatBps(uint256 bps) internal pure returns (string memory) {
        uint256 frac = (bps % 10_000) / 100;
        return string.concat((bps / 10_000).toString(), ".", frac < 10 ? "0" : "", frac.toString());
    }

    /// @dev 18-decimals wei → "1234.56" (floored to 2 decimals).
    function _formatToken(uint256 amount) internal pure returns (string memory) {
        uint256 frac = (amount % 1e18) / 1e16;
        return string.concat((amount / 1e18).toString(), ".", frac < 10 ? "0" : "", frac.toString());
    }

    /// @dev 1234 → "123.4"
    function _tenths(uint256 x) internal pure returns (string memory) {
        return string.concat((x / 10).toString(), ".", (x % 10).toString());
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /// @dev ASCII upper-case into a fresh buffer (never mutates the input). Pool names are restricted to
    ///      `[A-Za-z0-9 -]` and ≤ 32 bytes by FormaStaking, so no SVG/JSON escaping is required.
    function _upper(string memory s) internal pure returns (string memory) {
        bytes memory src = bytes(s);
        bytes memory out = new bytes(src.length);
        for (uint256 i; i < src.length; ++i) {
            bytes1 c = src[i];
            out[i] = (c >= 0x61 && c <= 0x7A) ? bytes1(uint8(c) - 32) : c;
        }
        return string(out);
    }
}
