# Truepay
API-focused BSB & account validation: Express middleware that checks a BSB + account number exists and that the account holder name matches the customer name.

## Usage

```ts
import express from "express";
import { verifyBankAccount, InMemoryBsbDirectory } from "truepay";

app.post("/payees", express.json(),
  verifyBankAccount({ provider: myProvider, bsbDirectory }),
  (req, res) => res.json(req.bankVerification));
```

Request body: `{ "bsb": "062-000", "accountNumber": "12345678", "accountName": "John Smith" }`
(override with the `extract` option).

## Pipeline
1. **Format**: BSB is 6 digits (`062000` / `062-000`), account number 6-10 digits.
2. **BSB directory** (optional): unknown BSB -> `bsb_not_found`.
3. **Provider lookup**: `AccountVerificationProvider.lookupAccount(bsb, account)` returns the bank-recorded holder name (5s timeout by default).
4. **Name match**: order-insensitive, ignores titles/`Pty Ltd`, tolerates initials. Result is `match`, `close_match` or `no_match`.

| status | HTTP (reject mode) |
|---|---|
| verified | next() |
| close_match | 422 (next() if `allowCloseMatch`) |
| name_mismatch / account_not_found / bsb_not_found | 422 |
| invalid_input | 400 |
| provider_error | 502 |

`mode: "annotate"` never blocks; it just sets `req.bankVerification`.

The real account name is never returned on a mismatch, only on a `close_match` (as `suggestedName`).

## Loading the BSB directory
```ts
import { loadBsbDirectory } from "truepay";

const { directory, count, skipped } = await loadBsbDirectory("./data/bsb.csv");
app.post("/payees", verifyBankAccount({ provider, bsbDirectory: directory }), handler);
```
- Supports `.csv` and `.json` (array of `{ bsb, bank, branch, state? }`).
- CSV defaults to the AP+ BSB Database column order (`BSB, Bank, Branch, Street, Suburb, State, ...`). If your file differs, pass `columns: { bsb, bank, branch, state }` (zero-based indexes).
- Header rows and malformed lines are skipped and counted in `skipped`. An empty result throws, so a wrong file can't silently disable BSB checks.
- The fixed-width `.txt` format isn't supported yet.

## Providers
`MockProvider` is for dev/tests. A BSB and account number alone can't prove ownership: you need a real source
(e.g. Confirmation of Payee via your bank/NPP access, or a verification vendor). Implement `AccountVerificationProvider` for it.

## Dev
`npm run dev` | `npm test` | `npm run build`
