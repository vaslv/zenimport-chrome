# Extension server switching and HTTPS

Separate, explicitly invoked acceptance. Ordinary tests never use real ZenMoney.
Production databases, installed Chrome profiles, and backend containers are unnecessary.

## Scenario scope

The built MV3 0.1.9 loads with unchanged manifest/JavaScript into a new persistent
Chromium profile in Docker/Xvfb for each independent set. The profile persists across
A→B within a set. Popup opens as an extension page to test alongside the active bank
tab. The bank is always synthetic: intercept HTML/API before bank network access.
Connector reads, background jobs, storage, and chrome.alarms are real.

Such tabs lack the temporary activeTab granted by clicking the toolbar icon. The
fixture first requests access only to the synthetic bank through a test button and
actual Chrome permissions API. It removes the button afterward; the extension
artifact stays unchanged. Actual toolbar popup opening/bank authentication are not tested.

Enter server addresses/tokens in ordinary fields and connect with the ordinary button.
Chrome displays native permission dialogs for the specific server; Xvfb/xdotool selects
Deny/Allow. Permissions APIs are not mocked, and broad `https://*/*` access is never
granted. Check state through `chrome.permissions.contains/getAll` and actual server requests.

Two independent sets: copied database and a new empty database. For each:

1. Create two owned VND accounts, eight ZenMoney records, and 11 corresponding bank records: expense, income, two equal amounts, both transfer sides, debt. Two records are initially missing.
2. Connect the extension to A over local HTTP; select both accounts/start date through the popup. Synchronize: exactly two creations. Repeat: zero.
3. Stop A and wait for its worker to finish. For the first set, transfer a consistent SQLite backup to B; for the second, initialize B empty.
4. Connect **the same extension profile** to B over HTTPS with another API token. Old jobs/last-sync dates must not appear. Copied databases retain account settings; empty databases require reconfiguration.
5. Reread the entire original history. First/repeated reads create zero transactions. Add one new bank record: one creation; repeat: zero.
6. Independently read ZenMoney: exact UUIDs, original seed fields, predicted category, new-record viewed=false, daily totals, both balances. Check SQLite integrity/FKs and no writes by old A.

Twelve jobs and six expected backend UUIDs across both sets. Each has 12 bank records
and 11 active ZenMoney records: one transfer covers both bank sides. Actual outgoing
write IDs are recorded before HTTP, so equal final balances cannot conceal repeat writes.

Separate checks before B connection:

- Chrome permission denied: server receives no HTTP request.
- Invalid token with trusted TLS: 401, old configuration retained.
- Trusted chain with wrong hostname: application receives no request.
- Untrusted CA: application receives no request.
- Every failure preserves previous server configuration.

## HTTPS and validation boundaries

The fixture creates a temporary CA/localhost SAN certificate and trusts the CA only
in disposable-container NSS. No `ignore_https_errors`, `--ignore-certificate-errors`,
SPKI bypass, or fetch replacement. Actual HTTPS is served by Uvicorn in that container;
this does not test a separate reverse proxy/public server. No certificates/keys are
installed on the host.

Production needs a root HTTPS address such as `https://zenimport.example.org`, correct
hostname, and complete trusted certificate chain. Enter that address and the **new
backend token**; ZenMoney tokens stay server-only. Subpaths, query/fragment, and HTTP
outside localhost/127.0.0.1 are prohibited. Redirects are not followed: supply the
final HTTPS URL, not an HTTP→HTTPS redirect.

An empty database can match account/day/amount movements including transfers/debts.
It **cannot reconstruct previous deletion history** or guarantee recognition of arbitrary
date/amount edits. For real migration, transfer the database after stopping the old
worker. Two independent active servers on one ZenMoney account are neither authorized
nor tested by this scenario. Mobile New display is separate; only viewed=false is checked.

## Reproduction

From the extension root with neighboring ZenImportBackend:

```sh
./scripts/test-server-migration.sh --fake ../ZenImportBackend
```

Uses the actual backend/SDK with fake ZenMoney and `--network none`. Builds only
special Docker target `migration-acceptance`; ordinary test-integration.sh still
uses target `integration`.

Live mode requires separate explicit user permission. Never supply production tokens.
Identity comes from prior completed backend acceptance; token from the verified SDK
test file:

```sh
export ZENIMPORT_LAB_IDENTITY=/absolute/private/lab/identity.json
export ZENIMPORT_TEST_TOKEN_FILE=/absolute/private/ZenMoneyAPI/.env
./scripts/test-server-migration.sh --live ../ZenImportBackend
```

stage2-results.json must sit beside identity.json. Before writes/every worker startup,
validate the persisted token fingerprint, production-token exclusion, and actual user
from a full ZenMoney response. Both files mount read-only; production .env/SQLite
never mount. Existing test transactions are preserved/independently checked; new
accounts use prefix `ZenImport CHROME`. No automatic account/transaction cleanup.

Output shows counts/boolean results only. Private `.local/browser-migration/<UUID>/`
contains intent history, audit IDs, A/B databases, profile, certificates, screenshots.
Excluded from Git/Docker context; directories/files use umask 077. Build/output logs
are also private.

Runs are one-shot: run-started prevents blind replay after interruption. Persisted
seed intent may only be read/verified, never automatically resent. On error, inspect
journal/profile/attempts; never delete the marker and restart over that directory.
A new explicit acceptance creates independent accounts/new UUIDs rather than fixing
an unfinished prior run.

Narrow `--live --resume-verified-prefix` is only for manual fixture recovery after
all six copied jobs complete; it also permits completed empty-set A initial/repeat
before B starts. Requires prior `/state`; verifies pinned user, baseline, remote
UUIDs/balances, database integrity, no unfinished delivery, and exactly 2/1 outgoing
write IDs on copied A/B. If empty A already ran, verify all its completed jobs,
exactly two write IDs, remote records/balances. No repeated seed/completed jobs or
copied worker startup. Each verified prefix resumes only once with separate
`resume-verified-N`; any other partial run stops for manual review. The ordinary
shell runner never enables this mode automatically.

## References

- [Playwright: Chrome extensions](https://playwright.dev/python/docs/chrome-extensions)
- [Chrome: permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- Prior HTTP acceptance: neighboring `ZenImportBackend/docs/migration-lab.md`.

Record actual results below only after runs complete.

### Independent acceptance, October 17, 2026

Complete `--network none` scenario passed on Chromium 145.0.7632.0, Linux/ARM64,
Playwright 1.58.0, MV3 0.1.9: 12 jobs, six expected new UUIDs, zero repeat writes.
Both HTTPS B databases created zero old records and one new record each. Native
permissions, 401, hostname, and untrusted-CA checks passed. Fake ZenMoney does not
calculate balances: this checks movements/exact UUIDs/fields; actual balances belong
to the separate live run.

### Separate test ZenMoney live acceptance, October 17, 2026

Confirmed 12 completed capture/delivery jobs: A initial/repeat, B initial/repeat,
B new/repeat for both copied and physically empty databases.

| Scenario | A: initial / repeat | B: initial / repeat | B: new / repeat |
|---|---:|---:|---:|
| Consistent database copy | 2 / 0 | 0 / 0 | 1 / 0 |
| Empty B database | 2 / 0 | 0 / 0 | 1 / 0 |

Counts are actual outgoing new-transaction UUIDs, not only final net. Six expected
UUIDs and zero repeated/unexpected writes. Per set: 12 bank records, 11 active
ZenMoney UUIDs, one transfer covering both sides. Independently checked exact UUIDs,
seed fields, predicted categories, viewed=false, daily movements, actual account
balances, original test-account data, and SQLite FK/integrity. A sent nothing after
switching. All six permission/HTTPS/auth checks passed.

Created only owned test entities: four VND accounts, two categories, 16 seed records,
six backend records. Existing test data preserved. No production ZenMoney/database/
installed extension/container used; production retained its old container ID/port
18792. Extension artifact unchanged; Chromium 145.0.7632.0 on Linux/ARM64.

The first live run passed six copied jobs/financial reconciliation, then exceeded
the 30-second embedded HTTPS shutdown wait. Resumption found a separate popup polling
race: the test could click the still-visible Stop button instead of Sync. Financial
writes were never repeated. The fixture now waits for actual Sync state, closes each
set's browser before stopping B, and uses a bounded graceful timeout. These are
acceptance changes, not production backend changes. A verified-prefix resume repeated
neither seed nor completed jobs; final results.json was written after servers stopped.

Private live journal: `.local/browser-migration/c06cc618-abbd-4605-9640-6bef1d2e7f53/`.
It retains original output.log, resumptions, audit, and results; Git receives only this
anonymized report. No public endpoint, remote reverse proxy, mobile UI validation,
or guarantee for arbitrary deletion-history resets.
