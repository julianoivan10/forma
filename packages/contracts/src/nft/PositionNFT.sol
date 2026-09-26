// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IPositionNFT} from "../interfaces/IPositionNFT.sol";
import {IPositionRenderer} from "../interfaces/IPositionRenderer.sol";

/// @title PositionNFT
/// @notice ERC-721 representing Forma staking positions (`tokenId == positionId`).
///         Transferable: the lock, multiplier and pending rewards stay attached to the position, so a
///         transfer cannot bypass a lock. Reward routing does NOT follow the token (see PROTOCOL.md §7–8).
/// @dev    Only `staking` (immutable) can mint or burn. Maintains a per-owner index so wallets can list
///         their positions from on-chain state alone, without the global array of ERC721Enumerable.
contract PositionNFT is ERC721, AccessControl, IPositionNFT, IERC4906 {
    address public immutable staking;
    IPositionRenderer public renderer;

    mapping(address owner => uint256[]) private _ownedTokens;
    mapping(uint256 tokenId => uint256) private _ownedIndex;

    event RendererUpdated(address indexed renderer);

    error OnlyStaking();
    error ZeroAddress();
    error IndexOutOfBounds();

    modifier onlyStaking() {
        if (msg.sender != staking) revert OnlyStaking();
        _;
    }

    constructor(address staking_, address admin) ERC721("Forma Position", "FORMA-POS") {
        if (staking_ == address(0) || admin == address(0)) revert ZeroAddress();
        staking = staking_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mint(address to, uint256 tokenId) external onlyStaking {
        // `_mint`, not `_safeMint`: no receiver callback → no reentrancy surface during `stake`.
        _mint(to, tokenId);
    }

    function burn(uint256 tokenId) external onlyStaking {
        _burn(tokenId);
    }

    /// @notice Metadata only. Cannot affect positions or funds.
    function setRenderer(IPositionRenderer renderer_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(renderer_) == address(0)) revert ZeroAddress();
        renderer = renderer_;
        emit RendererUpdated(address(renderer_));
        emit BatchMetadataUpdate(0, type(uint256).max);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        IPositionRenderer r = renderer;
        return address(r) == address(0) ? "" : r.tokenURI(tokenId);
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256) {
        if (index >= _ownedTokens[owner].length) revert IndexOutOfBounds();
        return _ownedTokens[owner][index];
    }

    /// @notice Paginated list of token ids owned by `owner`. Order is not stable across transfers.
    function tokensOfOwner(address owner, uint256 offset, uint256 limit) external view returns (uint256[] memory ids) {
        uint256[] storage owned = _ownedTokens[owner];
        uint256 total = owned.length;
        if (offset >= total) return ids;
        uint256 end = offset + limit > total ? total : offset + limit;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            ids[i - offset] = owned[i];
        }
    }

    /// @dev Keeps the per-owner index in sync on mint, transfer and burn (swap-and-pop).
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from == to) return from;
        if (from != address(0)) {
            uint256[] storage fromList = _ownedTokens[from];
            uint256 index = _ownedIndex[tokenId];
            uint256 lastId = fromList[fromList.length - 1];
            if (lastId != tokenId) {
                fromList[index] = lastId;
                _ownedIndex[lastId] = index;
            }
            fromList.pop();
        }
        if (to != address(0)) {
            _ownedIndex[tokenId] = _ownedTokens[to].length;
            _ownedTokens[to].push(tokenId);
        } else {
            delete _ownedIndex[tokenId];
        }
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl, IERC165) returns (bool) {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);
    }
}
