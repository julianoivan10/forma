// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IPositionRenderer {
    /// @notice Full `data:application/json;base64,...` metadata URI for a position.
    function tokenURI(uint256 positionId) external view returns (string memory);
}
