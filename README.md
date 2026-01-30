# Base MultiSender UI (v2)

Elegant Next.js + Tailwind UI for your verified MultiSender contract on **Base mainnet**:
- ETH: Strict + Best-effort
- ERC20: Signature-based approvals (Strict + Best-effort)

## Setup
```bash
npm install
cp .env.example .env.local
npm run dev
```

### Required env vars
- `NEXT_PUBLIC_MULTISENDER_ADDRESS=0x...`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...`

Optional:
- `NEXT_PUBLIC_PERMIT2_ADDRESS` (defaults to canonical Base mainnet Permit2 if you set it)

## Notes
- ERC20 + Permit2 requires a one-time `approve(PERMIT2, ...)` for each token before signature-based transfers work.
- After sending, the UI decodes contract events from the transaction receipt into a readable receipt.


## Hydration warning (dev)
If you see a hydration mismatch warning, it is often caused by a browser extension injecting attributes into <html>/<body>. Try Incognito or disable extensions.
