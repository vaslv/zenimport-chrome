# BIDV payment-account connector

Status: **0.2.1, published**. Requires ZenImportBackend 0.2.1 or newer;
backend 0.2.0 does not accept BIDV discovery. No new permissions are requested
until the user clicks Synchronize for BIDV.

## Use

1. Sign in to `https://smartbanking.bidv.com.vn` yourself and select English.
2. Open Accounts (`/tai-khoan`) or a VND payment account
   (`/tai-khoan/thanh-toan/<account-number>`).
3. Open ZenImport, check the [automatically detected connection](bank-connections.md),
   map each discovered account to its ZenMoney account, and choose
   the first import date. The default is 30 days; six months/custom dates are
   available within the bank's rolling one-calendar-year limit.
4. Click Synchronize. Chrome asks for access to the BIDV origin. The connector
   opens the account-specific **All transactions at BIDV** history, applies each
   requested period, and clicks View more until the bank shows its terminal marker.
5. Review imported unread transactions in the official ZenMoney application.

Only rendered VND payment cards are discovered. Discovery is deliberately partial:
other currencies, savings, loans, hidden account tabs, and Vietnamese UI have not
been verified. Refresh discovery after opening other payment accounts. Unsupported
accounts are never inferred from balances or account-holder names.

## Data and identity

The visible history table and the inspected transaction modal expose the same five
fields: bank transaction date/time, remark, signed VND amount, balance, and reference.
All five are retained. Time uses Asia/Ho_Chi_Minh (`+07:00`); amounts use exact decimal
strings without JavaScript floating-point conversion. Beneficiary fields are not
invented from free-form remarks.

A BIDV reference is **not a unique posting ID**: principal and fee can share the
same reference, timestamp, and remark. Identity version `bidv:f1` hashes the physical
account, timestamp, reference, signed exact amount, and exact balance. This separates
equal-value postings with distinct balances and is independent of row order, capture
window, and transport page. Identical posting fingerprints fail capture rather than
being silently dropped. Corrected bank timestamps/references/balances would change
this fingerprint; preserve backend migration data and inspect any such bank corrections
before a new sync. Existing backend matching still uses account/day/signed amount
across all ZenMoney operation types.

The complete interval is held only in the content script's memory until pagination
ends, then uploaded as deterministic pages of 100 records. This stays below API v1's
2 MB request limit even with maximum-length Unicode remarks. The backend ACK is the
checkpoint. A crash rereads the interval; no bank records are stored in Chrome storage.

## Completion and privacy

The bank uses a shared `/w2/process` XHR endpoint. A MAIN-world observer emits only
start/end request numbers and HTTP status. It never reads request/response bodies,
headers, passwords, cookies, OTPs, browser storage, or authentication objects. It
does not issue bank requests. The isolated driver uses ordinary DOM controls only.

Capture requires a fresh completed request and confirmed filters. Narrowing an already
loaded range may keep identical rows; widening requires a table update. It also requires
an unchanged account/document, the All tab, empty search, and the bank's explicit
terminal/empty marker outside transaction text. Appended pages must preserve their
existing prefix. Concurrent shared-endpoint activity, malformed/duplicate postings,
missing terminal markers, login expiry, or user input aborts capture without claiming
complete coverage. HTTP status alone is not proof of complete history.
There is no injected product UI and no session keepalive.

## Verification boundary

Live inspection on October 17, 2026 confirmed the English Accounts/payment route,
calendar reset/date selection, a filtered nine-posting interval, both fee/principal
shared references, the five transaction-detail fields, the View more control, and
the All transactions viewed terminal marker. Login expiry was observed and left to
the user. No real bank data was uploaded to a backend or ZenMoney during development.

Docker checks use a sanitized synthetic BIDV UI, installed production extension
scripts, real backend HTTP/SQLite, and fake ZenMoney. They cover empty/full periods,
large pagination, transport boundaries, malformed duplicate identities, stale UI,
repeated sync, and mobile deletion. Subsequent live capture and transfer recovery are recorded separately in the
backend progress log (October 19): completed BIDV jobs and zero discrepancies over
185 covered days after recovery, with no new remote records from recovery. This
does not certify every bank UI path or both real logins; fixture tests do not
establish those live results. English UI labels or bank markup may change in the future;
the connector then fails capture rather than guessing.
