// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IPositionNFT is IERC721 {
    function mint(address to, uint256 tokenId) external;
    function burn(uint256 tokenId) external;
    function staking() external view returns (address);
    function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256);
    function tokensOfOwner(address owner, uint256 offset, uint256 limit) external view returns (uint256[] memory);
    function exists(uint256 tokenId) external view returns (bool);
}
