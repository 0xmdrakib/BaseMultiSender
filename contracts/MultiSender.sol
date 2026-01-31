// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal Permit2 AllowanceTransfer interface (Uniswap Permit2)
interface IAllowanceTransfer {
    struct PermitDetails {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    struct PermitSingle {
        PermitDetails details;
        address spender;
        uint256 sigDeadline;
    }

    function permit(address owner, PermitSingle calldata permitSingle, bytes calldata signature) external;

    function transferFrom(address from, address to, uint160 amount, address token) external;
}

/// @notice Minimal safe ERC20 transfer helper (handles no-return + bool-return tokens)
library SafeTransfer {
    error ERC20TransferFailed();

    function safeTransfer(address token, address to, uint256 amount) internal {
        // transfer(address,uint256)
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok) revert ERC20TransferFailed();

        if (data.length == 0) return; // non-standard ERC20
        if (data.length == 32) {
            if (!abi.decode(data, (bool))) revert ERC20TransferFailed();
            return;
        }

        // weird return data
        revert ERC20TransferFailed();
    }
}

contract BaseMultiSenderStrict {
    using SafeTransfer for address;

    /// @dev Uniswap Permit2 address (same across many chains; verify for your chain)
    address public constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    IAllowanceTransfer public constant PERMIT2 = IAllowanceTransfer(PERMIT2_ADDR);

    // ----------------- Errors -----------------
    error LengthMismatch();
    error EmptyBatch();
    error ZeroRecipient(uint256 index);
    error ZeroAmount(uint256 index);
    error EthValueMismatch(uint256 expected, uint256 got);
    error EthSendFailed(uint256 index, address to, uint256 amount);

    error PermitSpenderMismatch(address expected, address got);
    error PermitSignatureExpired();
    error PermitAllowanceExpired();
    error PermitAmountTooLow(uint256 required, uint256 permitted);
    error TotalTooLargeForPermit2();

    // ----------------- Events -----------------
    event BatchETH(address indexed sender, uint256 recipients, uint256 totalWei);
    event BatchERC20(address indexed sender, address indexed token, uint256 recipients, uint256 totalAmount);

    // ----------------- Reentrancy Guard -----------------
    uint256 private _lock = 1;
    modifier nonReentrant() {
        require(_lock == 1, "REENTRANCY");
        _lock = 2;
        _;
        _lock = 1;
    }

    receive() external payable {}

    // ----------------- Public API -----------------

    /// @notice Strict ETH multisend (atomic). Funds come from msg.value, sent out by this contract.
    function sendETH(address[] calldata recipients, uint256[] calldata amounts) external payable nonReentrant {
        uint256 n = _validate(recipients, amounts);

        uint256 total = _sumAndValidate(recipients, amounts);
        if (total != msg.value) revert EthValueMismatch(total, msg.value);

        for (uint256 i = 0; i < n; ) {
            uint256 amt = amounts[i];
            address to = recipients[i];
            (bool ok, ) = to.call{value: amt}("");
            if (!ok) revert EthSendFailed(i, to, amt);
            unchecked { ++i; }
        }

        emit BatchETH(msg.sender, n, total);
    }

    /// @notice Strict ERC20 multisend via Permit2 (atomic).
    /// Pattern: (1) Permit2.permit -> (2) Permit2 pulls TOTAL to this contract -> (3) contract transfers to recipients.
    function sendERC20Permit2(
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        bytes calldata signature,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant {
        uint256 n = _validate(recipients, amounts);

        // UX + safety checks before doing anything
        if (permitSingle.spender != address(this)) {
            revert PermitSpenderMismatch(address(this), permitSingle.spender);
        }
        if (permitSingle.sigDeadline < block.timestamp) revert PermitSignatureExpired();

        // expiration is uint48 (seconds). 0 means expired. Require it to be in the future.
        if (permitSingle.details.expiration != 0 && permitSingle.details.expiration < block.timestamp) {
            revert PermitAllowanceExpired();
        }

        uint256 total = _sumAndValidate(recipients, amounts);

        if (total > type(uint160).max) revert TotalTooLargeForPermit2();
        uint256 permitted = uint256(permitSingle.details.amount);
        if (permitted < total) revert PermitAmountTooLow(total, permitted);

        address token = permitSingle.details.token;

        // 1) Set Permit2 allowance for this contract using signature
        PERMIT2.permit(msg.sender, permitSingle, signature);

        // 2) Pull total tokens from sender into THIS contract (single transferFrom)
        PERMIT2.transferFrom(msg.sender, address(this), uint160(total), token);

        // 3) Send out from contract -> recipients (explorer will show "From: contract")
        for (uint256 i = 0; i < n; ) {
            token.safeTransfer(recipients[i], amounts[i]);
            unchecked { ++i; }
        }

        emit BatchERC20(msg.sender, token, n, total);
    }

    // ----------------- Internals -----------------

    function _validate(address[] calldata recipients, uint256[] calldata amounts) internal pure returns (uint256 n) {
        n = recipients.length;
        if (n == 0) revert EmptyBatch();
        if (n != amounts.length) revert LengthMismatch();
    }

    function _sumAndValidate(address[] calldata recipients, uint256[] calldata amounts) internal pure returns (uint256 total) {
        uint256 n = recipients.length;
        for (uint256 i = 0; i < n; ) {
            address to = recipients[i];
            uint256 amt = amounts[i];

            if (to == address(0)) revert ZeroRecipient(i);
            if (amt == 0) revert ZeroAmount(i);

            total += amt;
            unchecked { ++i; }
        }
    }

    function _sum(uint256[] calldata amounts) internal pure returns (uint256 total) {
        uint256 n = amounts.length;
        for (uint256 i = 0; i < n; ) {
            total += amounts[i];
            unchecked { ++i; }
        }
    }
}
