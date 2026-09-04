# Bulk Sender

Bulk Sender is a non-custodial batch sender for distributing ETH and ERC-20 tokens on Base.

**Live app:** https://bulksender.rakibhq.xyz

---

## Overview

Bulk Sender helps creators, communities, teams, and DAO operators send funds to many wallets without paying an extra protocol fee.

The app supports both direct ETH batch sends and ERC-20 batch sends through Permit2. Users can paste recipient lists manually, upload a CSV file, review totals, confirm the transaction from their wallet, and track receipts for each successful batch.

## Features

- Batch send ETH to multiple Base wallets
- Batch send ERC-20 tokens with Permit2-based signing
- CSV upload for recipient and amount lists
- Optional split amount mode for sending the same amount to many addresses
- Strict atomic batch behavior where failed transfers revert the transaction
- Automatic batching for large recipient lists, with up to 500 recipients per transaction
- Exact ERC-20 approval flow instead of unlimited approvals
- Token symbol, decimals, allowance, recipient count, total, and fee review before sending
- Receipt table with transaction hashes and BaseScan links
- Standard web app support for Base App and browser wallets
- Optional paymaster flow for wallets that support sponsored calls
- Builder Code attribution support for Base ecosystem tracking

## Supported network

- Base Mainnet

The app is designed for Base and requires the connected wallet to be on Base Mainnet before sending.

## Sending behavior

### ETH batch sends

ETH sends are handled through the MultiSender contract. The user provides a list of recipients and amounts, then sends the exact total as `msg.value`. The contract forwards ETH to each recipient in the batch.

### ERC-20 batch sends

ERC-20 sends use Uniswap Permit2. The app asks the user to approve the exact batch total to Permit2 when needed, then signs a Permit2 message and submits the batch transaction through the MultiSender contract.

This keeps the approval flow smaller and avoids unlimited token approvals.

### Large recipient lists

Recipient lists are automatically split into multiple transactions when they contain more than 500 recipients. For example, a list of 1,400 recipients is sent as three parts: 500, 500, and 400.

Each part has its own wallet confirmation, transaction hash, and receipt entry.

### CSV format

The CSV upload supports simple recipient lists such as:

```csv
address,amount
0x0000000000000000000000000000000000000000,0.01
0x0000000000000000000000000000000000000000,0.02
```

The app also supports address-only rows when using split amount mode.

## Tech stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- Wagmi
- viem
- Uniswap Permit2 SDK
- Injected and EIP-6963 wallet discovery
- TanStack Query
- PapaParse

## License

This project is licensed under the [MIT License](./LICENSE).
