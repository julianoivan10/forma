// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Takes a 1% fee on every transfer. FormaStaking must reject it.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Fee", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

/// @notice ERC-777-style hook token: on the first transfer into or out of `target` it re-enters `target` with `payload`.
///         Used to prove every FormaStaking entry point is protected by the reentrancy guard.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;
    bool public reentered;
    bool public reentrySucceeded;
    bytes public reentryError;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        reentered = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if ((from == target || to == target) && target != address(0) && !reentered) {
            reentered = true;
            (bool ok, bytes memory err) = target.call(payload);
            reentrySucceeded = ok;
            reentryError = err;
        }
    }
}
