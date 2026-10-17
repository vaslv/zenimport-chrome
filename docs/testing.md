# E1–E5 validation — October 16, 2026

- `scripts/test-docker.sh`: **13 unit + 3 browser passed**. One integration module skips only in the independent browser image without a backend.
- `scripts/test-integration.sh ../ZenImportBackend`: **9 browser/integration passed**, no skips, actual built MV3, Chromium/Playwright 1.58.0, real backend HTTP/SQLite/SDK. Container networking is disabled, bank requests use anonymized HTML/JSON fixtures, SDK uses a stateful fake.
- Backend after unconfigured-account clarification: **352 passed**, HTTP/persistence/SIGKILL/graceful/snapshot on ARM64. Also 352 passed and lifecycle on AMD64 under OrbStack emulation (M2).

Verified two enabled/one ignored account; accumulated partial discovery; exact trxId/f1;
empty intervals; 132 rows transitioning from table cache to JSON page 1 with
totalRecords=0; expenses/income; a category from three confirmed payments and unknown
NULL; ambiguous historical matches created as new; viewed=false; repeat synchronization,
mobile edits, and deletions never overwrite; one-time old capture; lost ACK after
page commit; popup closure; forced worker stop through root CDP Target.closeTarget,
confirmed execution context destruction, and resumption; SDK response loss after
application; changed filters never confirm coverage. Common coordinator unit tests
also use a synthetic second bank and a new tab after pause.

Popup checks: currency selection, explicit ignored/unselected states, 30-day/six-month
dates, reopening, incompatible API, keyboard, and long titles without horizontal overflow.
Configuration is inaccessible to the ISOLATED content world. The bank DOM contains no
product UI; opening pages/settings creates no job.

Temporary browser-test installation differs from the ZIP **only in pregranted access
to two synthetic origins** (localhost/ipay fixture), avoiding Chrome's native permission
dialog automation. Shipped JavaScript/CSS is unchanged. The ZIP has no such required
host_permissions. No third-party runtime was added. Popup screenshots were visually checked.

Fixtures do not establish complete real account lists, actual VietinBank switching,
current real DOM, or mobile unreviewed records. Those belong to M3. Currently supports
VND and only the observed Current account; accounts_complete=false. USD is not imported.
Chrome has no bank passwords/SDK token.

Reproducible ZIP: two scripts/build.py runs yielded SHA256
`f06d3ae7c6365d60902ad7a39e4c49482c331d0dc3b34ad360cccef6bc8dc231`.
Installation: README. Local data/secrets are excluded from ZIP/Docker context.
Production server/extension were not switched.

## Popup fix 0.1.1

Reproduced through actual chrome.action.openPopup: old CSS produced 115 px width.
Fixed width/min-width on root/body gives 390 px. A new test connects to the native
action target through CDP (not in Playwright context.pages), checks width, overflow,
and fields. This is not an ordinary popup.html tab with a fixed viewport.
Visually checked test-results/popup-native.png. Extension permissions are unchanged.

Also checked null/missing trxId with legacy f1 and SDK unavailability: history capture
continues while delivery pauses with the correct status. The delivered counter is
labelled Processed: it includes prior deliveries, not just newly added records.

## Interface completion 0.1.2

Only existing synthetic popup checks: three passed in Docker, including native action
popup 390 px, account selection/ignoring, dates, keyboard, reopening, incompatible API.
The prior full integration suite was not rerun for this version; the user deferred
live ZenMoney checks. Visually checked popup-native.png, popup-settings.png,
popup-compact.png. ZIP 0.1.2 SHA256:
0a9764493d979e1306e4d5f79227b2a4a3303458dbe5a766198d0ddac389f644.
Contract/extension permissions unchanged.

## Connection drafts 0.1.3

Docker: 13 unit + five browser passed; standalone image skips backend integration.
Two new scenarios cover address-first/token-first input, immediate closure after
each field, reopening, preservation after API failure, clearing after success, and
no draft access in the ISOLATED content world. Synchronization never starts automatically.
Temporary tokens use only storage.session with TRUSTED_CONTEXTS; confirmed config
is separate in local. Successful configuration clears the draft in the worker even
with a closed popup. No new permissions. ZIP SHA256:
20facc36c9e156d8946fcbdaa610d6805cf04a04612be76565b0d9efe9d88fcd.

Context7 timed out; storage.session semantics were checked against official docs:
https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas
(memory, clearing on Chrome/extension restart, inaccessible to content scripts).

## Automatic settings expansion 0.1.4

Docker: 13 unit + six browser passed; backend integration skipped without backend.
Verified new users see connection settings; saved server settings collapse independently
while account setup is needed; saving the final enabled/ignored account collapses
settings; reopening stays collapsed; new unconfigured accounts expand accounts;
incompatible servers expand connection settings; manual expansion/session drafts work.
Unavailable/incompatible targets also count as incomplete setup. Visually checked
390 px layout. ZIP SHA256:
ba62146c1251fc2e9d08f2c101980d20fc4dfb586d19bcaaf02d96e3a1ca5fb0.
Production backend/bank/ZenMoney untouched.

## Account save feedback 0.1.5

Docker: 13 unit + seven browser passed; independent image skips backend integration.
A delayed fake server verifies Saving…, disabled fields, and feedback beside the
button in a scrolled 390×300 window. Errors appear there, selected values survive,
and retries remain available. Success displays Saved after reopening too; editing
the date enables saving again. Only the saved account form is replaced. No automatic
synchronization. Visually checked test-results/account-saving.png. No real ZenMoney
API was used. ZIP SHA256:
41841c2ce1f192899e173bca62e1e9933d8c1a1fa0f629ad4bbb08df1bf867fb.

## Last successful synchronization 0.1.6

Docker: 15 unit + eight browser passed; standalone backend integration skipped.
Coordinator records completedAt once after complete capture and confirmed delivery,
including no-new-record runs. Incomplete/blocked delivery creates no date. Old jobs
without startedAt receive no invented timestamp. The date survives repeated polling,
worker recreation, popup closure, and subsequent failures. Storage is partitioned by
server address/connection ID; browser tests cover connection switching and no other
connection's date on unsupported pages. Historical checks covered Russian minute/hour/
day plural forms, boundaries, unknown timestamps, and live relative time refresh.
Visually checked test-results/popup-last-sync.png: 390 px, collapsed settings.
No real bank/backend/ZenMoney; API contract/permissions unchanged. ZIP SHA256:
7e35079e7703d68431d32bd889ce798df0b0a7fa4aa47a252be268707411b807.

## Read-only discrepancy page 0.1.7

Standalone Docker: 15 unit + nine browser passed (backend integration skipped).
Final integration against current backend: **16 browser/integration passed**
(nine independent/seven end-to-end). New scenario reads the actual backend/SQLite
through HTTP and pinned SDK with fake ZenMoney, shows an extra record, and removes
it on Refresh after simulated mobile deletion; no new SDK writes. Backend separately:
370 tests + lifecycle checks passed.

Browser tests check a new popup-opened tab with correct connection ID, date/totals/
incomplete coverage, account/period filters, error recovery, no token in URL/DOM,
and XSS protection for hostile descriptions. Report-page start is forbidden; bank
UI remains untouched. No deletion/editor/delivery controls. Visually checked desktop
and 390 px: test-results/discrepancies-desktop.png and discrepancies-mobile.png.

Updated stale test steps: manually expand collapsed settings before account refresh;
MAIN/ISOLATED bank Date.now now share real time. Synthetic calendars/relative-date
clocks remain stable on extension pages. Production bank-response timing checks were
not weakened. The first joint run stopped on clock mismatch; the next found an old
collapsed-settings step; the final suite fully passed.

ZIP 0.1.7 SHA256: b2a589763450ac1d82671da6fe02a99e2fe21b7e02d6b09598fe221139ba1080.
Manifest permissions unchanged. Production backend was updated separately; the
read-only report was checked on the current connection without creating/editing/
deleting transactions.

## Bank page ready while resources still load — 0.1.8

Connector readiness uses verified selected-account DOM/document identity rather than
chrome.tabs.status=complete. Probe/start use scripting.executeScript with
injectImmediately=true so document_idle cannot delay a ready page. The handler
waits for required elements; account/document/period guards remain. Extension
permissions/financial requests unchanged.

Chrome API reference: https://developer.chrome.com/docs/extensions/reference/api/scripting
(checked through Context7 on October 16, 2026). executeScript defaults to document_idle;
injectImmediately allows execution before loading completes. adapter.test.mjs regressions:
loading/complete, unready DOM, login navigation, initial observer registration,
no redundant reload, preserved documentIds on start. Actual bank acceptance is
recorded separately; model tests do not prove causes of every live failure.

## English documentation and interface — October 17, 2026

Documentation, comments, interface labels, errors, and displayed dates are English.
Date/relative-time locale is en-GB; monetary display uses English separators.
Docker: 31 unit + 10 browser passed, one expected standalone skip; integration with
the actual backend and fake ZenMoney: 17 passed. Historical observations above retain
their original dates, results, and scope. No production data, permissions, protocol
identifiers, or published release artifacts were changed.
