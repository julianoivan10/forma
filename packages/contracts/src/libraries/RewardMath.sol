// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title RewardMath
/// @notice Pure accumulator arithmetic used by FormaStaking. Isolated so that it can be tested on its own.
/// @dev    All divisions floor (protocol-favouring). See docs/PROTOCOL.md §5.
library RewardMath {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant RATE_PRECISION = 1e18;
    uint256 internal constant ACC_PRECISION = 1e30;
    uint256 internal constant YEAR = 365 days;

    /// @notice Tokens emitted over `dt` seconds at `rate` (tokens/sec * RATE_PRECISION).
    function emitted(uint256 rate, uint256 dt) internal pure returns (uint256) {
        return rate * dt / RATE_PRECISION;
    }

    /// @notice Accumulator increase when `amount` tokens are spread over `totalWeight`.
    function accDelta(uint256 amount, uint256 totalWeight) internal pure returns (uint256) {
        return amount * ACC_PRECISION / totalWeight;
    }

    /// @notice Rewards earned by `weight` between two accumulator values.
    function earned(uint256 weight, uint256 accNow, uint256 accPaid) internal pure returns (uint256) {
        return weight * (accNow - accPaid) / ACC_PRECISION;
    }

    /// @notice `amount * multiplierBps / BPS`.
    function weightOf(uint256 amount, uint256 multiplierBps) internal pure returns (uint256) {
        return amount * multiplierBps / BPS;
    }

    /// @notice `amount * bps / BPS` (fees, penalties).
    function bpsOf(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return amount * bps / BPS;
    }

    /// @notice Rate (tokens/sec * RATE_PRECISION) that streams `budget` over `duration`.
    function rateFor(uint256 budget, uint256 duration) internal pure returns (uint256) {
        return budget * RATE_PRECISION / duration;
    }
}
