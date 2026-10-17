# VietinBank: automatic history capture

## Goal

One extension command: find/open the bank tab, wait for manual sign-in if needed,
open the selected account's history, apply a month/six months/custom range, collect
all parts, persist locally, and show results. Matching/ZenMoney writes are outside
this stage.

## Confirmed

- Current-account history: /payment-history?accountNo=…; also verify the number against the selected account in DOM.
- Endpoint https://api-ipay.vietinbank.vn/ipay/wa/getHistTransactions.
- JSON: accountNo, currentPage, nextPage, pageSize, totalRecords, transactions. Observed currentPage=0, nextPage=1, pageSize=100, totalRecords=135, 100 rows.
- Transaction details exist in JSON; four of 100 rows lack trxId, requiring fingerprints/ambiguity checks.
- Local database has 100/135 transactions. Repeats create no duplicates.
- Ten-row table pages are not 100-row API pages.

## Unknowns blocking request implementation

- Exact request fields: account number, dates, page number/size, date format.
- Session/signature/checksum/requestId dependencies; whether ordinary app mechanisms can change/send parameters without bypassing protection.
- Period/page-size limits, pagination termination, empty-result shape.
- Whether six months fit one request or require intervals.
- Account switching, session expiry, repeated searches, and history changes between pages.

## Research in an active bank session

1. Obtain the diagnostic schema of the current period's first page for the selected account.
2. Change the start date and compare: only expected date/request-identifier fields should differ.
3. Request the next API page through native bank actions; compare page parameters/response and check the remaining 35 rows.
4. Check empty/long periods. Establish limits from actual responses/UI, never assumptions.
5. Prefer native app requests; if signature/session reuse requires unsafe copying, automate visible filters/pages and observe JSON instead.

Capture request schemas through a separate diagnostic action with Network open.
Store field names/types; permit values only for a bounded date/pagination allowlist.
Never export tokens, cookies, headers, accountNo, sessionId, checksum, requestId, or
arbitrary text. Full HAR/cURL is unnecessary. A schema is a research tool, not proof
of automatic capture readiness.

## Implementation plan after protocol confirmation

- Capture controller outside the popup: waiting for login, preparing, capturing, saving locally, complete, cancelled, failed. Popup closure never stops it.
- Process only the approved history endpoint. Users enter passwords/OTP; bank credentials stay in bank context, outside backend/logs.
- Verify account/parameters before each interval/page; stop on context changes. Never navigate to payment actions.
- Apply a confirmed range; split by proven bank limits, verify gap-free boundaries and safely deduplicate overlaps.
- Collect expected pages only; validate counts, repeated pages, pagination direction, ID uniqueness, row validity. Equal totalRecords alone never combines different searches.
- Save progress/coverage metadata in a separate import session; current 2000-row/2 MB backend limits apply per batch, not entire period.
- Claim complete only after proving all pages/intervals; cancelled/interrupted capture is explicitly partial. Repeated runs are safe.
- End with new/repeated/uncertain row counts and period coverage. Send nothing to ZenMoney.

## Acceptance

Synthetic contract/browser checks: 0/1/100/135/over 2000 rows; multiple intervals;
cancel/restart; expired session; error/repeated page; changed account/totalRecords;
ID conflicts; no stored/logged secrets. Then actual current period (135 rows) and
six-month range with independent bank count reconciliation. Do not claim automatic
capture before these checks.

Initial status: plan/diagnostics prepared. Bank tab was at /login when research began;
the user must sign in manually.

## Live observation on the evening of October 6

After sign-in, the monthly count became 136 because a transaction was added. Calendar
range 06.04.2026–06.10.2026 followed by Search produced:
“Khoảng thời gian tìm kiếm không quá 30 ngày. Vui lòng kiểm tra lại” — search periods
cannot exceed 30 days. The table retained the previous search and is not the six-month
result. Use at most 30 calendar dates (29 days between endpoints) until precise
inclusivity is verified.

Calendar: readonly Choose time range input; application Calendar; navigation img
alt="button back"/"button next" inside role=button; days have full English date
aria-labels and start/end state; apply button Chọn. Clicking the previous-month image
worked; the parent role=button did not through the tool. A start-day change can retain
the old end: verify both endpoints before Search, not only one click.

Research stopped on “Your session has timed out. Please login again”. Another sign-in
and request-body diagnostic schema are needed. Automatic capture readiness is not claimed.

## Version 0.2.0: interface automation and journal

The primary Get history button starts a job persisted in `chrome.storage.local`.
Users sign in and select a month or six months. First use requests Chrome access
only to `https://ipay.vietinbank.vn/*`. Account comes from open history or the sole
local VietinBank account if history is closed. Ambiguity requires opening the desired
account's history once.

The loader registers a MAIN observer at `document_start` and reopens history. Early
registration also catches requests through the bank's saved fetch reference. Unregister
after completion/stop. Never read/store request contents, headers, cookies, sessions,
or full HTML. Chrome permission remains until user revocation. DevTools stays a
fallback response source but is unnecessary for ordinary use.

The ISOLATED controller uses windows of at most 30 calendar dates, clears text/amount
filters, selects All, controls calendar/Search, then walks table pages until another
JSON page is requested. Transaction details come from allowlisted JSON fields, not
modals. Closing the popup never stops capture. Do not close/reload/change the bank
tab while running.

This controls native UI: the bank itself constructs private parameters, signatures,
and authentication. No direct session-replaying API client was created. Supports the
observed English Current account, Filter/Search, and calendar with Chọn. Changed markup
produces explicit errors, not silently incomplete imports.

Before each save, check account, page number, stable totalRecords, row count, date
range, and no duplicate IDs across interval pages. The backend atomically saves pages
and deduplicates by bank ID/fingerprint. Saved pages survive errors; runs may repeat.
Entire period saved appears only after all intervals/pages. A valid empty response
completes an empty interval.

The journal stores action time/stage, dates, interval/page, waits/durations, response/
added/duplicate counts, errors. Retain current/previous run, at most 4000 events each;
show the latest 80 in the menu. Download journal exports both runs without account
number, URL, or tab ID. Financial rows belong in the database, not the journal.
This is a loader action journal, not full browser HAR/console trace. Old manual tools
remain in diagnostics.

Jobs are limited to 20 minutes; individual waits to 30–45 seconds; backend writes to
60 seconds. With an open menu, 90 seconds without progress terminates a stuck job.
Browser restart/extension update cancels unfinished jobs. Bank logout requires sign-in.
No artificial infinite keepalive.

### Validation

`./scripts/test-docker.sh` checks the complete synthetic-bank flow with a saved fetch:
six months, multiple intervals, 103 rows per interval (two API pages), closed popup,
and repeat capture without new duplicates. Separately checks wrong account, out-of-range
dates, changed totals, cancellation, logout, empty intervals. This does not prove
current live markup compatibility: after updating the installed extension, verify a
real month, especially calendar and crossing row 100. Only then proceed to category
learning/matching. ZenMoney is not updated automatically.

## Response diagnostics 0.2.1

During capture, save every intercepted response to diagnostics **before** completeness/
import checks, even unexpected page numbers/totalRecords. Manual Network inspection
is no longer needed for these counts. Download diagnostic report exports the previous
zenimport-actions.json with `responses` in current/previous runs:

- Expected page, total, already saved count, selected interval.
- Actual currentPage, nextPage, pageSize, totalRecords, error, and types.
- Row count, transactions type, allowlisted transaction field types.
- Boolean account match, date range, empty/duplicate ID counts.
- Response-read error marker and previous action journal/stop reason.

Retain the latest 200 diagnostics per run; `responsesDropped` counts discarded ones.
Exclude financial values, transaction IDs, account details, payee names, descriptions,
arbitrary strings, headers, cookies, request body, sessionId, and full HTML. Counts
are only numbers, booleans, null, or short digit strings; other values are represented
by type. This is a diagnostic summary, not full HAR. Import/completeness checks are
unchanged. Old 0.2.0 journals cannot be retroactively enriched: run again after updating.

## Pagination 0.2.2

A live October 7 report confirmed page 0 / pageSize 100 / totalRecords 132 / 100 rows;
then page 1 / pageSize 100 / totalRecords 0 / 32 rows. Account matched; second response
dates September 7–13 were in range. nextPage=2 does not prove another missing page.

For continuation currentPage > 0, zero totalRecords is now replaced during validation/
import with the positive first-page total from the same interval. Diagnostics retain
the original zero. Changed nonzero totals still stop capture. The parser validates
exact expected row counts/page sequence; account/date/duplicate checks remain.
Outside automatic runs, standalone JSON with totalRecords=0 and rows remains rejected:
without page one, completeness cannot be proven. Empty first responses are separate.

## Monetary field diagnostics 0.2.3

Live 0.2.2 six-month capture completed April 7–May 6 (101 rows) and May 7–June 5
(112 rows), then stopped on June 6–July 5's first response with a generic VND-format
error. The old journal distinguished neither amount/balance nor value shape, so the
specific cause was unknown.

The parser now reports response row/exact field, while `responses.moneyIssues` is
recorded before parsing: type, reason (type/format/limit), length, format mask, and
zero-fraction flag for plain decimals. Replace digits with #, letters/other characters
with ?, retaining separators/signs only; no original values. Up to 20 samples per
response; moneyIssueCount gives the full count. Diagnostics/parser share one validator.
Money acceptance rules are unchanged. Determine actual format with a new 0.2.3 run;
never automatically guess amounts.

## Negative amounts 0.2.4

The 0.2.3 report identified negative integer amount on row 46 for June 6–July 5.
Live inspection of rows 41–50 showed a negative displayed amount, but the balance
increased by its magnitude relative to the immediately preceding chronological row.
The displayed sign therefore cannot alone establish direction.

The parser accepts negative integer amount within the previous limits. Net remains
amount × (-1 for D, +1 for C): negative debit reverses the debit. Every negative amount
requires independent confirmation: current balance minus the next strictly earlier
response row balance must exactly equal net. Comparison uses BigInt. Missing neighbors
(page boundaries), equal timestamps, incompatible currency/balances, or differing
movements stop page import with a specific reason rather than guessing direction.
Nonnegative transactions are unchanged. Preserve original signed amount; fingerprints
use confirmed net. negativeAmounts diagnostics contain row, D/C, and balanceCheck,
without amounts.

Limitation: automatic negative-amount confirmation at page boundaries/equal neighbor
timestamps is not implemented; those cases need a separate decision.
