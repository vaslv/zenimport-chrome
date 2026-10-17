# M3 — live VietinBank observation, October 16, 2026

Inspected the account after the user signed in independently. Only native bank
controls were used; neither extension synchronization nor real ZenMoney delivery
was initiated. No tokens, password, or complete bank details were saved in this report.

## Confirmed

- Home shows Current account (1); the history selector contains exactly one available Current account. Its currency is VND.
- History navigation uses /payment-history?accountNo=...; selected account text is in .vt-select__single-value .cus-option and matches the connector probe format.
- For September 16–October 16, 2026, the bank shows 130 transactions, 10 rows per page. Pages 1/2/13 are available; after loading, ranges are 1–10 / 11–20 / 121–130, total=130. Active-page switching precedes range refresh; the driver waits for the range change and does not equate a click with completed loading.
- .table-pagination-total-range, .table-pagination-total-total, and aria-label Page N / is your current page match the current DOM.
- Choose time range (readonly), Input keyword to search, From, To, and radio All exist. The calendar has role=application, aria-label=Calendar; days are role=button with full English dates; navigation uses img alt=button back/next and confirmation Chọn. The current period was confirmed unchanged.
- Clicking a bank row opens Transaction details: reference, source account, amount/currency, beneficiary account/name, bank, description, status, channel, and date/time. The dialog was closed and history returned to page one.
- The bank table contains no extension-injected financial editors.

## Not established by this check

- Multiple actual accounts, automatic switching, other currencies: this login has one account only. accounts_complete=false remains.
- Maximum historical depth, complete automatic reading of all 130 transactions, current response JSON/fields, and trxId/f1 stability across repeated captures. Manual DOM inspection does not replace an end-to-end connector run.
- viewed=false creation in actual ZenMoney, mobile edits/deletion, and repeat synchronization. These need an agreed separate test account and synthetic record; the user has been asked.

M3 is partial (live bank DOM); M4 has not started. Historical data, production database,
and ZenMoney records are unchanged.
