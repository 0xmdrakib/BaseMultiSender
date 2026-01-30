// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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

    struct AllowanceTransferDetails {
        address from;
        address to;
        uint160 amount;
        address token;
    }

    function permit(address owner, PermitSingle calldata permitSingle, bytes calldata signature) external;

    function transferFrom(address from, address to, uint160 amount, address token) external;

    function transferFrom(AllowanceTransferDetails[] calldata transferDetails) external;
}

contract MultiSenderPermit2 is ReentrancyGuard {
    IAllowanceTransfer public immutable PERMIT2;

    uint256 public constant MAX_RECIPIENTS = 500;
    uint256 public constant MAX_REVERT_DATA = 256;

    bytes4 private constant PERMIT2_TRANSFER_FROM_SINGLE =
        bytes4(keccak256("transferFrom(address,address,uint160,address)"));

    mapping(address => uint256) public pendingRefund;

    error LengthMismatch();
    error BadMsgValue();
    error TooManyRecipients();
    error ZeroAddress();
    error InvalidSpender();
    error AmountTooLarge();
    error NoRefund();

    event ETH_Item(uint256 indexed index, address indexed to, uint256 amount, bool success, bytes returnDataTruncated);
    event ERC20_Item(uint256 indexed index, address indexed token, address indexed to, uint256 amount, bool success, bytes returnDataTruncated);
    event BatchSummary(
        address indexed sender,
        address indexed token, // address(0) for ETH
        uint256 totalRequested,
        uint256 successCount,
        uint256 failCount,
        uint256 unsentOrRefundedAmount,
        bool strictMode
    );
    event RefundQueued(address indexed user, uint256 amount);
    event RefundPaid(address indexed user, uint256 amount);

    constructor(address permit2) {
        PERMIT2 = IAllowanceTransfer(permit2);
    }

    // -------- helpers --------

    function _truncate(bytes memory data) internal pure returns (bytes memory) {
        if (data.length <= MAX_REVERT_DATA) return data;
        assembly { mstore(data, MAX_REVERT_DATA) }
        return data;
    }

    function _validate(address[] calldata recipients, uint256[] calldata amounts) internal pure {
        uint256 n = recipients.length;
        if (n != amounts.length) revert LengthMismatch();
        if (n > MAX_RECIPIENTS) revert TooManyRecipients();
        for (uint256 i = 0; i < n; i++) {
            if (recipients[i] == address(0)) revert ZeroAddress();
        }
    }

    function _sum(uint256[] calldata amounts) internal pure returns (uint256 total) {
        for (uint256 i = 0; i < amounts.length; i++) total += amounts[i];
    }

    function _u160(uint256 x) internal pure returns (uint160) {
        if (x > type(uint160).max) revert AmountTooLarge();
        return uint160(x);
    }

    function _permit(IAllowanceTransfer.PermitSingle calldata permitSingle, bytes calldata sig) internal {
        if (permitSingle.spender != address(this)) revert InvalidSpender();
        PERMIT2.permit(msg.sender, permitSingle, sig);
    }

    // -------- ETH --------

    function sendETHStrict(address[] calldata recipients, uint256[] calldata amounts)
        external
        payable
        nonReentrant
    {
        _validate(recipients, amounts);

        uint256 total = _sum(amounts);
        if (total != msg.value) revert BadMsgValue();

        for (uint256 i = 0; i < recipients.length; i++) {
            (bool ok, ) = recipients[i].call{value: amounts[i]}("");
            require(ok, "ETH_TRANSFER_FAILED");
        }

        emit BatchSummary(msg.sender, address(0), total, recipients.length, 0, 0, true);
    }

    function sendETHBestEffort(address[] calldata recipients, uint256[] calldata amounts)
        external
        payable
        nonReentrant
    {
        _validate(recipients, amounts);

        uint256 total = _sum(amounts);
        if (total != msg.value) revert BadMsgValue();

        uint256 okCount;
        uint256 failCount;
        uint256 refundAmount;

        for (uint256 i = 0; i < recipients.length; i++) {
            (bool ok, bytes memory data) = recipients[i].call{value: amounts[i]}("");
            if (ok) {
                okCount++;
                emit ETH_Item(i, recipients[i], amounts[i], true, "");
            } else {
                failCount++;
                refundAmount += amounts[i];
                emit ETH_Item(i, recipients[i], amounts[i], false, _truncate(data));
            }
        }

        _refund(refundAmount);
        emit BatchSummary(msg.sender, address(0), total, okCount, failCount, refundAmount, false);
    }

    function _refund(uint256 refundAmount) internal {
        if (refundAmount == 0) return;
        (bool ok, ) = msg.sender.call{value: refundAmount}("");
        if (ok) emit RefundPaid(msg.sender, refundAmount);
        else {
            pendingRefund[msg.sender] += refundAmount;
            emit RefundQueued(msg.sender, refundAmount);
        }
    }

    function withdrawRefund() external nonReentrant {
        uint256 amt = pendingRefund[msg.sender];
        if (amt == 0) revert NoRefund();
        pendingRefund[msg.sender] = 0;

        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "REFUND_WITHDRAW_FAILED");
        emit RefundPaid(msg.sender, amt);
    }

    // -------- ERC20 Permit2 --------

    function sendERC20Permit2Strict(
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        bytes calldata signature,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant {
        _validate(recipients, amounts);
        _permit(permitSingle, signature);

        address token = permitSingle.details.token;
        uint256 n = recipients.length;

        IAllowanceTransfer.AllowanceTransferDetails[] memory details =
            new IAllowanceTransfer.AllowanceTransferDetails[](n);

        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            uint256 amt = amounts[i];
            total += amt;
            details[i] = IAllowanceTransfer.AllowanceTransferDetails({
                from: msg.sender,
                to: recipients[i],
                amount: _u160(amt),
                token: token
            });
        }

        PERMIT2.transferFrom(details);

        emit BatchSummary(msg.sender, token, total, n, 0, 0, true);
    }

    function sendERC20Permit2BestEffort(
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        bytes calldata signature,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant {
        _validate(recipients, amounts);
        _permit(permitSingle, signature);

        address token = permitSingle.details.token;
        uint256 n = recipients.length;

        uint256 okCount;
        uint256 failCount;
        uint256 total;
        uint256 failedTotal;

        for (uint256 i = 0; i < n; i++) {
            uint256 amt = amounts[i];
            total += amt;

            bytes memory callData = abi.encodeWithSelector(
                PERMIT2_TRANSFER_FROM_SINGLE,
                msg.sender,
                recipients[i],
                _u160(amt),
                token
            );

            (bool ok, bytes memory data) = address(PERMIT2).call(callData);
            if (ok) {
                okCount++;
                emit ERC20_Item(i, token, recipients[i], amt, true, "");
            } else {
                failCount++;
                failedTotal += amt;
                emit ERC20_Item(i, token, recipients[i], amt, false, _truncate(data));
            }
        }

        emit BatchSummary(msg.sender, token, total, okCount, failCount, failedTotal, false);
    }

    receive() external payable {}
}
