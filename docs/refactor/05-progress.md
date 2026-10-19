# Implementation status

October 15, 2026: the user authorized sequential implementation and regular local commits.

| Stage | Status / result |
|---|---|
| B0 | Complete: docs/sync-api-v1.md, backend/sync_contracts.py, fixtures/sync-v1/examples.json; 56 Docker contract tests passed |
| S1 | Complete in ZenMoneyAPI, 880aa19; 244 tests, mypy, 99% coverage |
| S2 | Unnecessary: no SDK capability gaps |
| S3 | Complete: wheel 0.6.0 installed in a clean independent backend container; checksum/exact unreviewed write checked |
| B1 | Complete, ZenImportBackend e856175: independent project, Docker runtime/config/tests, health/info, explicit settings/foreign database protection; 93 tests and HTTP/persistence smoke passed |
| B2 | Complete in ZenImportBackend, ffecceb/log ac93657: financial schema v2, explicit synthetic legacy v12 migration; 169 tests/Docker smoke passed |
| B3 | Complete in ZenImportBackend, 29315a5/docs 7da6060: account settings, periods/jobs/lease, atomic ingestion/completeness; schema v3; 235 tests/HTTP/resume passed |
| B4 | Complete in ZenImportBackend, 4cbd4f3/docs a09f33d: read-only SDK mirror/cursor/deletions, independent confirmed-payment predictions; schema v4; 292 tests/HTTP/resume passed |
| B5 | Complete in ZenImportBackend, 825c9d4/docs ff00f76: durable complete-version authorization, one worker, SDK viewed=false, UUID verification/crash recovery without blind retries; schema v5; 340 tests/HTTP/resume/persistence passed |
| B6 | Independent portion complete October 16 in ZenImportBackend, c6a5c9f/docs 2a14cbc: 347 tests each ARM64/emulated AMD64, HTTP/lifecycle/snapshot; E5 awaits new extension |
| E1 | Skeleton extracted: independent MV3, minimal popup, v1 client, private storage, reproducible build. Three Docker unit checks passed; browser acceptance follows E4/E5 |
| E2–E4 | Implemented; actual bank limits require M3 |
| E5 | Complete: 13 unit + two popup + seven end-to-end browser checks in Docker; reproducible ZIP; docs/testing.md |
| M1–M4 | Not started at this checkpoint; real data unchanged |

Historical next stage: E1, independent Chrome extraction; independent B6 ready, joint E5 follows E1–E4. Backend work belongs to ZenImportBackend; settings/capture/read-only mirror/prediction/sender implemented. No real API in those checks. Legacy server/extension continue separately. Current backend log: ZenImportBackend/docs/refactor/05-progress.md; this file started as the original project's extraction summary.

## Checks

- B6 (October 16): ZenImportBackend scripts/test-platforms.sh, Docker 29.4.0 / Compose 5.1.2 / CPython 3.12.15: **347 passed ARM64/347 AMD64**. Actual Linux/aarch64/x86_64; AMD64 emulated through OrbStack on ARM64. HTTP/auth/resume, post-fake-commit SIGKILL, graceful in-flight shutdown (exit 143/Application shutdown complete), restart/new-file snapshot restore: original UUIDs/identity, exactly three viewed=false records, no repeat upsert. UID 10001/read-only root, WAL/CLI/privacy/snapshot races checked. Resources removed; no real API/bank/database. ZenImportBackend/docs/b6-validation.md, docs/operations.md. E5 awaits new Chrome.
- B5: same Docker/Compose/linux/arm64/CPython: **340 passed**, 48 new checks. Network-isolated SDK/stateful fake: expense/income/viewed=false, categories/NULL, full versions/backlog, UUIDs, lost/partial responses, HTTP rejection, mobile edits/deletion, two workers, settings/disabling/token/accounts, backoff, intent rollback, v4→v5, background delivery without new browser requests. Actual child-process crashes before requests/after fake commits recover without upsert. Database deletion race uses mode=rw. HTTP/auth/resume/persistent authorization/financial preservation after recreation passed. Test resources removed; no real bank/API/database. ZenImportBackend/docs/delivery.md.
- B4: same environment: **292 passed**, 57 new checks. Every SDK entity/raw/exact amount, incremental cursor/deletions, mobile edits, absent UUIDs, failures/retries/atomicity/races, freshness/restart, SDK-outage capture, threshold 2/3/5, split/N:M/exclusions, viewed=false, payees/directions/rules, started payload preservation, v3→v4 rollback. HTTP/auth/resume/recreation preservation passed. Resources removed; no real API/bank/database.
- B3: same environment: **235 passed**. Concurrent commands/settings/leases, repeat/reordered/duplicate pages, completeness, gaps/overlap/one-time reread, calendar boundaries, disabling/account failures, v2→v3 rollback. Actual Docker HTTP: partial job, recreation, repeated command/page, completion. Synthetic only; test resources removed.
- B2: same environment: **169 passed**. Synthetic v12, exact SDK money/JSON, 1:N/N:M, exclusions, UUIDs/attempts/deletions, source/schema/BLOB archives, repetition, WAL/rollback. CLI conversion/HTTP/preservation after recreation. Resources removed; no real data/API.
- B1: same environment: 93 passed, network-isolated config container, HTTP/auth, recreation preserving identity. Containers/unique volume removed; AMD64 then awaited B6.
- One Starlette httpx TestClient warning remains; tests pass. SDK retains httpx 0.28.1. Changing test-client dependencies was outside extraction.
- ZenImport scripts/test-contracts.sh, Docker/CPython 3.12.15: 56 passed, new contract only, not full application.
- ZenMoneyAPI scripts/test.sh, Docker/CPython 3.12.15: 244 passed, strict package/typing_contract mypy, 99% lines, no test network.
- Vendored SDK SHA256 b28722f6ee09ea79726cbab64fa769171904b6c9a2e6b825bc2d2c88437e1e58; all nine files matched source.
- No actual API/bank/mobile UI in these stages; production database not opened for changes.
- Preexisting SDK untracked .idea/ excluded from commits.

## Contracts for subsequent stages

B3 preserved wire v1; ZenImportBackend/docs/capture.md. B4 refreshes catalog outside transactions, freshness up to 300 seconds; new jobs force refresh. SDK outages permit capture, block delivery. B4 never sends; B5 uses its mirror before every attempt. job_accounts/job_context retain snapshots; captured_records exact versions; coverage only complete. One-time reread preserves remaining work independently of old coverage. B5 checks enabled/version/target/needs_rebuild, not mere bank-row presence. Real rehearsal/mobile acceptance remain M1/M3.

B2 preserved wire format; ZenImportBackend/docs/financial-storage.md. Legacy bindings remain historical, accounts unconfigured, coverage never presumed. Permanent receipts survive mirror changes. Started payload/UUID immutable; needs_rebuild=1 blocks until safe preparation. B4 recomputes category_evidence/category_payments from actual linked reviewed payments. Production migration remains M1.

docs/sync-api-v1.md fixes routes/errors, amount/time formats, versioned settings, idempotency, capture leases, completeness, independent delivery. Models validate shapes; B2–B5 implement database completeness, details allowlists, currency/scale, settings, delivery states.

## Historical B4 → B5 handoff (completed)

ZenImportBackend/docs/mirror-predictions.md. Force Mirror.refresh before delivery outside transactions, then check enabled/version/target and completed-interval version. Manual choice → rule → three independent consistent viewed=true payments → NULL. Splits do not multiply examples; our viewed=false never trains. Started payloads/UUIDs immutable. Existing UUID confirms despite mobile edits; explicit deletion suppresses forever. Absence never authorizes uncertain retries. Actual initial/empty-account response, mobile UI, real data, AMD64 then untested. Real writes/migration await later stages.

## Historical B5 → B6/E5 handoff (independent portion complete)

ZenImportBackend/docs/delivery.md and current backend log. v5 authorizations bind exact complete version/job/target and freeze after attempts. Server worker resumes authorized work after Chrome/server restart but creates no new capture jobs. SDK expense/income viewed=false/category-or-NULL. Persist exact payload/UUID/intent before network; network outside write lock, single sender via flock. Atomic diff/read-only forceFetch transaction verifies UUIDs. Mobile edits never revert; deletions terminal suppressed. HTTP codes/UUID absence do not prove nonapplication; intent-before-request crashes can remain uncertain without retry. Reads use durable 15…300-second delays. Upgrade alone never authorizes unproven legacy rows. At this checkpoint B6/AMD64/E1–E5/M1–M3 remain ahead; production server/extension/SDK unchanged.

## B6 → E1 handoff

Backend ready for v1 Chrome development, independent B6 complete, E5 ahead. Next E1 per docs/refactor/03-extension.md in history-preserving neighboring ZenImportChrome. Never restore financial editors/reconciliation/injected bank UI. SDK separate/unchanged. Snapshot helper publishes current own schema only to new destinations; actual migration M1, production unchanged. Native AMD64/external HTTPS/mobile ZenMoney untested.

## Next-stage entry template

- Stage / date / project / commit:
- Changes and locations:
- Checks and results:
- Not checked:
- Contract changes:
- Next specific stage:

## E1 — October 16, 2026

Created independent ZenImportChrome Git-history copy without hardlinks/remotes. Removed backend, SDK wheel, SPA/options/devtools, inline UI, legacy commands. Source project/production data unchanged. Standard-library Python build; dependency-free runtime. Three Docker unit tests passed. Installation/worker/popup acceptance belongs to E5; skeleton only.

## E2 — October 16, 2026

Separated connector registry, VietinBank probe/account switching, strict v1 DTO parser, bank calendar. Existing vib:id/vib:f1 unchanged; null details excluded from wire allowlist. Eight Docker unit checks passed. No complete list claim: accounts_complete=false, only observed selected Current account discovered; server accumulates known accounts. Prior observations confirm VND; other currencies disabled. Actual URL switching/account-list markup needs M3, not fixture claims.

## E3 — October 16, 2026

Coordinator stores command/UUID/lease/context in private local storage; server owns pages/completeness. ACK before checkpoint, same request_id after response loss; restart reads server and safely repeats intervals. Guards tab/document/run/account; disabled accounts not read. Login pauses, incomplete history fails, Stop halts capture only. Passive MAIN observer never reads auth/request body; button alone starts. No keepalive. Twelve unit checks passed, including synthetic second bank/coordinator recreation. Actual Chrome worker/bank DOM in E5/M3.

## E4 — October 16, 2026

One Synchronize/Stop capture button, brief result, collapsed server/token settings, compatible targets/explicit Do not import, 30-day/six-calendar-month/custom dates, one-time old capture. No ZenMoney token. New unconfigured accounts do not block configured accounts (backend clarification, wire v1 unchanged). None configured/all disabled prohibits start. Twelve Docker units passed; backend/browser regressions started, final E5 results later.

## E5 — October 16, 2026

Results/limits: docs/testing.md. Actual built-extension tests found/fixed fetch binding, refresh/selection races, delayed responses, old-driver cleanup, alarm recovery, repeat resume commands, port loss when stopping workers. Synthetic bank/ZenMoney only. Next M1/M2 copy rehearsal/overall matrix; M3/M4 require actual bank/agreed live writes and acceptance before cutover.

## M2 and popup 0.1.1 — October 16, 2026

Synthetic data/real restored copy checked without network: backend 352 ARM64 + 352 emulated AMD64; Chrome 13 unit/nine browser-integration (three popup/six end-to-end). Copy financial fingerprint unchanged after startup/stop. Fixed native popup 115 → 390 px with regression. Backend docs/m2-validation.md, docs/live-acceptance.md; Chrome docs/testing.md. M3/M4 need live acceptance; production/SDK unchanged, no pushes/tags.

## M3 — live bank portion, October 16, 2026

Inspected selected VND-account DOM, calendar/filters, pages 1/2/13 (130 rows total), payment details in the user's session. Does not prove complete automated capture/JSON; multiple accounts unavailable. No ZenMoney delivery. Redacted details: docs/m3-bank-observation.md. Mobile/M4 await agreed test account/results.

## Popup completion 0.1.2 — October 16, 2026

User deferred live ZenMoney testing; M3 mobile/M4 not performed. Minimal UI complete: one button/brief status, collapsed settings, connection/accounts/one-time history sections, clear server token, waiting indicator, unavailable fields hidden. Stable 390 px. Three existing synthetic Docker popup checks passed; no real ZenMoney/cutover.

## Popup draft preservation 0.1.3 — October 16, 2026

Fixed losing address/token on window switching: immediate input session drafts, restoration without overwriting active typing, clear only after successful worker connection verification. Fields protected during connecting. 13 unit/five browser passed on synthetic data. Regressions close immediately after both field orders, failed/successful connections, and bank-page draft isolation. No real bank/ZenMoney.

## Collapsed configured settings 0.1.4 — October 16, 2026

Configured popup opens collapsed; saving the last account closes settings. Independent expandable connection section keeps address/token out of new-account setup. Setup errors expand the relevant section; manual expansion/unsaved drafts retained. 13 unit/six browser passed with synthetic data. Production backend unchanged.

## Account save confirmation 0.1.5 — October 16, 2026

Waiting/errors/success appear beside account Save; fields disable during requests. Confirmed settings show Saved after reopening; form edits reenable Save. Other unsaved account forms survive. 13 unit/seven browser passed; standalone backend module skipped. Production diagnosis read-only; no actual sync started by this fix.

## Last synchronization 0.1.6 — October 16, 2026

Below the main button, show local date/time and live elapsed-time text. Worker retains first complete-success confirmation by server/connection; new/failed attempts never erase it. Never invent old-job dates. Successful no-new-record runs also update time. 15 unit/eight browser passed on synthetic data, standalone integration skipped. Production backend/actual sync not started.

## Discrepancy page 0.1.7 — October 16, 2026

Added one user-approved read-only extension tab. Popup Discrepancies opens current bank report; account/period filters and daily groups show extra candidates, bank/ZenMoney totals/difference. Explicit coverage/mirror/unfinished delivery; unchecked emptiness never implies equality. No financial actions/type/category edits. Worker limits report commands to reads. Updated AGENTS.md/contract exception to the previous no-page policy.

Standalone: 15 unit/nine browser passed; final integration: 16 passed. Backend 370 tests/lifecycle passed, local runtime updated. Actual read checked 184 covered days, returning 500 candidates/132 days with no new attempts; this does not prove every candidate wrong. All decisions stay in official ZenMoney. SDK/schema/manifest permissions unchanged. docs/testing.md and ZenImportBackend/docs/discrepancies.md. No pushes/tags.

## October 16: bank-page readiness — 0.1.8

Actual post-cleanup sync stopped after 32 seconds with capture_context_changed before page one. No new confirmed financial requests: 518 intent/518 response_applied unchanged. Seven originals preserved/eight copies previously deleted by separate explicit backend authorization.

Removed selectAccount/initial reload dependence on tab.status=complete. Readiness uses account DOM after parsing (interactive/complete) and documentId. Probe/start injectImmediately=true avoids document_idle delays from external resources. Account/type/date/document guards preserved; permissions/delivery contracts unchanged.

Checked official scripting.executeScript through Context7 October 16. Regressions cover loading/complete, incomplete DOM, login redirects, observer registration, no unnecessary reload, documentIds. Updated an old semantic-duplicate integration expectation to agreed day/amount matching: five new instead of six; existing UUID unchanged on initial/reread.

Docker: **23 unit; nine browser passed, one skipped** (no backend in base image), then **16 integration passed** with actual local HTTP backend/fake bank/ZenMoney, no external network/production database. Reloaded 0.1.8 through Chrome Extensions and verified installed version. Live success still awaited user sign-in after session expiry; fixtures not misrepresented as acceptance.

ZIP 0.1.8 SHA256: 5ef9aafe1bf311830ebfa301e617024ccbd3bcaed530340f6f62c788689db825.
Local changes, no pushes/tags.

### Live 0.1.8 acceptance complete — October 16, 21:36 (UTC+7)

After user sign-in, actual installed popup 0.1.8 read 67 records for October 2–16. Backend confirmed exactly two missing evening records; all 520 bank records delivered, capture/delivery complete, no errors. Journal increased exactly two intent/response pairs to 520+520, no old records resent.

Separate fresh ZenMoney read/backend audit: 184 covered days April 16–October 16; zero incomplete days/extra candidates/missing links/single or composite amount/daily mismatches. Eight deleted copies absent/seven originals unchanged. Extension report shows no extras; popup Done. Processed: 520. Suppressed: 0, plus last-sync time. Actual validation separate from Docker; user authorized these API calls. Private results/backups remain with the backend, not Git. No pushes/tags.

## Interrupted capture recovery 0.1.9 — October 16, 2026

Fixed two full-review findings. Lost first POST /jobs responses resume using current tabs/updated connection settings and the original unknown-job request_id. Known paused jobs still use a new resume command with prior job/worker IDs.

Paused capture permits verifying/storing a replacement token for the same server without deleting jobs/commands/checkpoints. Rejected tokens retain old data; another server/settings edits during active capture are blocked. Connecting never starts sync; users resume with the main button. Error/pause handling serializes with configuration to prevent token replacement overtaking recovery. Added clear pause status/existing_ownership_unknown text.

Docker: **31 unit; 10 browser passed, one skipped**. Regressions cover lost /jobs response/new tab, known/unknown job retention on token changes, rejected tokens, server-switch prohibition, pause/configuration races. Actual popup/background browser flow receives a fake 401, fixes token, resumes same job. Corrected backend schema 6/SDK 0.6.1 integration: **17 passed**.

Manifest/package updated to 0.1.9. No live bank/production/API; prior 0.1.8 live acceptance remains historical. New build not yet claimed installed. No pushes/tags.

## A/B switching through MV3 and HTTPS — October 17, 2026

Unchanged MV3 0.1.9 loaded in a separate Docker profile. Ordinary popup fields/connect button switch A HTTP → B HTTPS/new API token with copied/empty databases. Bank always synthetic; backend/SQLite/SDK/Chromium/native permissions/certificate checks real. Live mode uses only historically pinned test ZenMoney, never production/installed extension.

Twelve live jobs: each A creates two missing records, B creates zero old then one new. All repeats zero writes. Six expected UUIDs; transfers/debt/equal amounts never duplicated. Verified exact IDs/categories/viewed=false/daily movements/actual balances/original catalog/SQLite integrity/FKs. Permission denial, wrong token, hostname mismatch, and untrusted CA retain old config; no broad HTTPS permission.

Ordinary regressions: **31 unit; 17 browser/integration passed**. Independent offline scenario also runs 12 jobs. Fixed fixture popup-button refresh waits/HTTPS-case shutdown; live resume verified completed prefixes without repeating seed/delivery. No claim of public-server/toolbar-popup/mobile UI acceptance. Existing deletion preservation still requires database transfer.

Commands/limits/results: [server-migration-acceptance.md](../server-migration-acceptance.md).
Local commits only, no pushes/tags/publication.

## GitHub/ZIP preparation — October 17, 2026

MIT copied from user-approved `vaslv/zenimport-chrome`. Added PRIVACY.md/publication instructions/CI using synthetic services only. ZIP/unpacked builds include LICENSE/PRIVACY but no config/private data. Extension/connector business code unchanged. Docker: 31 unit/10 browser passed, one expected standalone integration skip. Joint acceptance uses new zenmoney-python 0.7.0; results recorded afterward. Gitleaks 8.30.1 history clean; initial GitHub MIT history preserved by ordinary merge. CI not yet run on GitHub. No production profile/bank/ZenMoney; no pushes/tags/publication.

Joint Docker/current backend/new SDK: **17 passed**. Two independent build.py runs yielded identical ZIP SHA256 `7b109237d1d8a6adf760b8a30144923bd0ea74a06a558794e9c5984cc7395a37`. LICENSE/PRIVACY/manifest/no local configuration verified. Actionlint passed all three workflows; GitHub workflows had not yet run.

## English documentation and interface — October 17, 2026

Translated all documentation, comments, visible labels/status/errors, HTML language metadata, and date/relative-time formatting to English. Date locale en-GB; numeric display uses English separators. Test expectations and synthetic labels updated; protocol IDs, bank selectors, persistence, and financial behavior preserved. Production data and published SDK artifacts untouched.

Docker: **31 unit + 10 browser passed**, one expected standalone integration skip. Actual backend/fake ZenMoney integration: **17 passed**. Historical results above retain original dates/scope. Local commits only, no pushes/new tags/publication.

## GitHub Release 0.1.9 readiness — October 17, 2026

Prepared first public ZIP distribution and an English installation/manual-update
guide. Keep the loaded directory and use Chrome Reload to retain local settings;
uninstalling removes them. Documented Chrome 120+, VietinBank VND current accounts,
backend 0.1.0/API v1, trusted HTTPS, explicit synchronization, and journal retention
when changing servers. No Chrome Web Store submission or automatic updater.

Fixed the joint test image after backend publication: install zenmoney-python 0.7.0
from PyPI using the backend's exact SHA256 lock instead of the removed vendor
directory. Runtime extension code and manifest permissions are unchanged. Build
now emits SHA256SUMS; CI compares two builds and retains both release files.

Fresh isolated Docker results: **31 unit + 10 standalone browser passed**, one
expected backend-module skip; **17 current-backend integration passed** (one
upstream Starlette/httpx deprecation warning). Actionlint passed. Gitleaks scanned
all 123 existing commits without findings. Reproducible ZIP: 20 allowlisted source,
license, and privacy files; version/root manifest/content checked, no local data.
SHA256: `9e0b09111c094b5fe25dd8ab3f39fc3175b3edd5c45576c7a78915b713dd1112`.

Fresh offline HTTPS/MV3 acceptance: **12 completed jobs**, copied and empty server-B
databases, six expected newly created UUIDs total, zero writes on repeats or first
server-B synchronization. Daily movements, exact IDs, categories/viewed=false,
original records, and artifact bytes preserved. Native permission rejection/allow,
wrong token, certificate hostname mismatch, and untrusted CA checked with prior
config retained. Fake-mode balance validation is not implemented; actual-account
balances and the current mobile UI are not claimed from these fixtures.

No production database, installed extension, bank session, or real ZenMoney account
was accessed by these checks. A fresh server still cannot preserve prior deletions
without its delivery journal. GitHub CI and release-download verification remain
pending explicit push/tag approval; no publication is claimed by this entry.

## Popup export/import — October 17, 2026, local 0.2.0

Added a collapsed **Settings → Data migration** panel: Export data, Import data,
and explicit Resume this server for cancelled moves. Export stops this extension's
capture, obtains one private ZIP from the authenticated backend, and downloads a
Blob without new browser permissions. The source stays persistently paused, even
if the popup closes. Users then change the server/token and upload the selected
ZIP before the destination's first sync. Import availability is read from the
backend, refreshed after starting sync, and enforced again on the server.

Transfers omit cookies, reject redirects, and use only the authorized backend
origin. No archive/base64/token is stored in the bank page or extension settings.
Progress, unsupported older backend, invalid/oversized/wrong-account archive,
unknown transfer result, and durable pause/restored state are shown in the panel.
Restoration resets local capture/view checkpoints; saved settings/coverage come
from the imported server history. Import does not deliver financial writes until
the next explicit Synchronize. Documentation/privacy disclose the unencrypted
financial ZIP, limits, interrupted transfer handling, and source-resume restrictions.

Fresh Docker: **32 unit + 10 standalone browser passed**, one expected backend
module skip; **18 real-backend/browser integration passed**. The new flow exercised
actual ZIP download, persistent source pause, normal server-address change, broken
ZIP rejection with retry, file chooser/upload, restored mappings and disabled
reimport, first sync with zero duplicate writes, and preservation of a mobile
deletion. Native action-popup width regression also passed. Inspected the migration
panel screenshot; no horizontal overflow or bank-injected UI. Upstream Starlette/
httpx warning remains test-only. All bank/ZenMoney data and profiles were synthetic.

Backend b258376 separately passed 508 native ARM64 Docker tests and HTTP/auth,
SIGKILL, graceful stop and restored-delivery checks. ZIP 0.2.0 is reproducible:
SHA256 `1fcd1d96a0137ecb2437f96a35744d05fd05307d6a8cdbf3481f9d746ff772b1`.
Local commits only: no push, tags, new GitHub/GHCR publication, production restart,
installed-extension update, or real API was used. Public 0.1.9/0.1.0 artifacts
remain unchanged. Both components must be updated to use migration.

## Published 0.2.0 — October 17, 2026

With explicit permission, pushed code/documentation and tag v0.2.0 at
928d1f720d5ffa848ed1870a9aa634421d3f77ec, then published the GitHub Release with
the verified ZIP and SHA256SUMS. [Chrome CI](https://github.com/vaslv/zenimport-chrome/actions/runs/39040271339)
passed 32 units/10 standalone browser checks (one expected backend-module skip),
reproducibility and artifact upload. Downloaded CI artifact matches local bytes.
Separate current-backend/browser integration remains 18 passed, synthetic only.

Backend 0.2.0 publication/native AMD64+ARM64 acceptance passed before this release.
Both components are required for migration. Existing 0.1.9 release bytes were not
replaced; no installed extension or production backend/data was updated.
[Release/install](https://github.com/vaslv/zenimport-chrome/releases/tag/v0.2.0).
Independently downloaded both public release assets without account credentials:
ZIP and SHA256SUMS match the local/CI artifacts exactly, including manifest 0.2.0
and ZIP integrity. Source/tag remains immutable; subsequent docs do not replace it.


## October 17, 2026 — BIDV connector (local 0.2.1)

- Added a separate `connectors/bidv` module for the English BIDV Accounts and
  VND payment-account screens. Partial discovery brackets Payment cards before
  Savings; account-specific capture verifies URL, DOM and document identity.
- Capture resets the bank date filter, selects requested inclusive dates through
  the calendar, reads All transactions at BIDV, and follows View more to an
  explicit terminal marker. Only request lifecycle metadata crosses from MAIN;
  request/response bodies, authentication and backend credentials do not.
- Composite posting identities distinguish shared-reference principal/fees and
  equal amounts with different balances. Exact VND amounts, bank-local timestamps
  and all five available detail fields are preserved. Transport pages contain
  100 records to fit the API body limit even with maximum Unicode remarks.
- No new bank product UI, keepalive, editor, or automatic financial send. Existing
  popup account mapping/date/synchronize controls are reused. New support requires
  backend 0.2.1; the SDK remains unchanged. Documentation: `docs/bidv.md`.
- Actual bank inspection confirmed account routes, English filter/calendar, a
  nine-posting filtered interval, shared references, detail fields and terminal
  marker. A complete run of the new connector against the real bank and actual
  ZenMoney delivery remains pending. No real history was uploaded or synchronized.
- Docker: 44 unit tests; standalone browser 11 passed / 1 expected backend-module
  skip; full joint HTTP/SQLite/fake-ZenMoney suite 23 passed. Focused final BIDV
  regression 5 passed, then 2 passed after narrowing the history-menu selector.
  Tests cover 503-posting pagination, repeated import, mobile deletion, empty
  ranges, duplicate rejection, HTTP 200 with stale UI, and hover/click menus.
  Backend independently passed 516 tests plus lifecycle checks. Logs remain in
  ignored `.local/bidv-*.log`; fixtures contain only artificial records.
- Built `dist/zenimport-chrome-0.2.1.zip` and verified every archive member against
  the unpacked artifact; no private settings are included. Local commits only.
  No push, Git tags, release, installed-extension update or production deployment.

## October 17, 2026 — Multiple named bank connections (local 0.2.1)

- Added a compact Bank connection selector and Settings → Bank connections with
  Add connection/Rename. Each login can contain multiple discovered accounts;
  every distinct account has its own target, initial date and enabled/ignored
  choice. Users still authenticate only on the bank website. No bank credentials,
  injected product UI, financial editor, or keepalive were added.
- Inspection reads the server's connection catalog. Remembered choices are hints
  only among memberships containing all observed physical accounts. An unknown
  account requires an explicit existing association or a new named connection;
  it never silently extends the last login. Start commands bind the chosen
  connection and recheck the active bank page. Existing profile IDs are retained.
- Last-success markers and one-time import dates are scoped by server/connection.
  One unfinished capture blocks profile switching; a paused capture can now be
  explicitly stopped. Token repair keeps its prior recovery behavior. Pending
  saves/refreshes lock selection, preventing another profile from receiving stale
  settings. Names and unfinished form drafts survive popup closure; a draft and
  lost creation response are bound to the observed account set so another login
  cannot reuse that pending connection ID.
- Shared physical accounts reuse canonical IDs, mappings and the permanent
  delivery/deletion journal. Import settings are shared and the popup says so;
  Unlink account removes membership from one connection while preserving history.
- Docker: full joint built-extension/real-backend/fake-ZenMoney suite 26 passed.
  After final creation-context/interaction-lock tightening, 52 units and 12
  independent browser checks passed (two expected module skips without backend).
  Focused login/shared-account scenarios passed again: 2 tests on the final source.
  The complete backend passed 527 tests plus HTTP/crash/shutdown/snapshot checks.
  Logs: ignored `.local/profiles-*.log`; no production data or real APIs.
- Tests cover two artificial BIDV logins with two accounts each, different targets,
  ignored accounts, return to the first login, stale selection/start rejection,
  separate sync timestamps, repeat capture, shared access and mobile deletion
  without restoration, unlink, name drafts, and lost creation ACKs. Screenshot
  `test-results/popup-bank-connections.png` was checked at 390 px without overflow.
  A live two-login bank acceptance is not claimed.
- Guide: `docs/bank-connections.md`. Backend schema 7 preserves old profiles and
  accepts verified published schema-6 archives; new archives preserve names and
  memberships. Both components need 0.2.1. SDK unchanged. Local ZIP rebuilt;
  no push, tag, publication, installed-extension update or production deployment.


## October 18, 2026 — Independent popup sections

Removed the outer Settings disclosure. Server connection and Data migration now
have independently visible headings and start collapsed after configuration.
Connection setup, unfinished drafts and authentication/configuration errors still
open Server connection. Migration controls stay disabled without a server;
opening Data migration refreshes its availability. Bank connections and account
mapping remain accessible without an outer disclosure. No backend or financial
data changes, push, tag or publication.

Validation: Docker passed 52 unit tests, 12 browser tests (2 integration modules
skipped in the standalone image), and 3 focused real-backend integration tests
for ZIP migration and separate/shared bank connections. All data was synthetic.
The native popup screenshot confirmed the setup layout without overflow.


## October 18, 2026 — Current connection heading and owner names

The popup shows the resolved connection name with an accessible pencil button.
The manual selector is hidden when account membership resolves the connection.
BIDV's rendered sidebar owner-name element was inspected on the live Accounts
page; VietinBank's existing validated account label supplies its owner name.
New connection names use these fields when available. Existing labels and IDs
remain unchanged. Names are not unique login identifiers and never silently
merge separate connections. The user chose the primary account number as the identifier. New automatic
connections use a bank-scoped deterministic primary-account key. Existing account
membership preserves legacy IDs and metadata; mixed known/new overview accounts
join only a single unambiguous connection. Unknown BIDV detail-only accounts still
need the Accounts overview, and shared primary accounts remain ambiguous.
VietinBank only exposes the selected account, so a previously unseen additional
account cannot be automatically grouped with another account based on name alone.

Validation: final Docker checks passed 54 unit and 13 browser tests (2 expected
standalone integration-module skips). Four focused Docker integration checks
passed for two BIDV logins, shared-account delivery preservation, name drafts, and
heading/rename persistence. Live BIDV inspection verified only the rendered owner
name and account overview; no real capture, sync, or backend update was performed.


## October 18, 2026 — Inline rename and automatic connections only

Removed the bank connection selector, management disclosure, and create/name
forms. The current heading becomes an input when its pencil is clicked; the
same button becomes a checkmark. Enter saves, Escape cancels, failed saves retain
the draft, and private drafts survive reopening only in the same context.
All supported discoveries automatically resolve or create a connection, including
single-account pages. Legacy overlapping memberships resolve deterministically.
Account mappings, server configuration, and migration remain separate features.
No production server/data, synchronization, push, tag or release was changed.

Validation: Docker passed 54 unit tests, 13 standalone browser tests (2 expected
integration-module skips), and all 27 backend/browser integration tests. The
legacy multi-account fixture now explicitly seeds its prior membership through
the retained compatibility RPC rather than using the removed manual UI. Native
heading/edit screenshots were inspected. Only synthetic data was used.

## 2026-10-18 — Stable connection rename button

Aligned the shared rename/save button to the popup's right content edge and
kept the heading height stable when switching to its input. Long names truncate
instead of moving the controls. Replaced both icons with Heroicons v2.2.0
outline SVGs and bundled their MIT notice.

Validation: the targeted Docker browser test passed, including exact button
bounds before/after editing and right-edge alignment. Inspected both screenshots
and rebuilt the unpacked extension and ZIP. No real bank data or publication.

## 2026-10-18 — Simplify popup sections

Made Bank accounts a disclosure, initially collapsed unless account setup is
required. Removed section/account dividers and spaced Unlink account below Save
account. Rebuilt the extension; the targeted Docker popup test passed and the
rendered screenshot was checked. No production data or publication changed.

## 2026-10-18 — Preserve BIDV account navigation state

Observed an authenticated but empty Payment route in the live bank. Returning
to Accounts and using the card's detail action restored the account UI. The
connector now uses that action instead of direct detail URL navigation, and
installs the passive observer without reloading an already open bank document.
A previous completed capture no longer overwrites an inspection error with a
misleading connection-overview hint. The one-time import date UI is unchanged.

Validation: 54 Docker unit tests and two isolated BIDV browser tests passed.
The regression fixture rejects direct detail navigation and verifies the card
transition; preparation preserves the existing document. No live synchronization
or ZenMoney writes were performed. Extension artifacts rebuilt locally.

## 2026-10-18 — Put synchronization period below its action

Moved the one-time history start date into a collapsed Synchronization period
section directly below Synchronize. The date defaults to 30 days ago; shared
30 days / 6 months shortcuts match initial account setup, with custom dates
available through the same date input. Pending requests retain their date;
successful completion resets the next date to 30 days ago. Empty/future dates
are rejected, and period controls are locked during an active capture.

Validation: the targeted Docker popup test passed for the default date, both
shortcuts, custom date entry, account setup and collapsed state. Inspected the
screenshot, rebuilt local artifacts, and checked the diff. No live data sent.

## 2026-10-18 — Handle BIDV Reset's populated date range

Read-only production diagnostics showed the two previous captures failed before
any page was ingested. After restoring the bank account view and reloading the
installed extension, a user-configured synchronization reached the history
filter but timed out: Reset retained a populated default date range. The driver
incorrectly required both date fields to become empty. It now selects the two
requested calendar dates without assuming empty Reset values, retaining exact
range and network/DOM completion checks before accepting records.

Updated the synthetic bank to model populated Reset values. Both isolated BIDV
browser tests passed in Docker and local artifacts were rebuilt. The live attempt
failed before delivery; a successful live synchronization with this final filter
fix remains unverified. No push or release.

## 2026-10-18 — Accept unchanged BIDV rows when narrowing history

Live diagnostics isolated the remaining capture timeout to filtered_rows. BIDV
can leave the rendered first page unchanged after successfully applying a
narrower date range. Capture now records the previous loaded range and permits
unchanged rows only when narrowing it, after the observed response and filter
closure. Full pagination and strict parser date bounds remain mandatory; widening
still requires a rendered update. The synthetic stale-widening regression verifies
that incomplete coverage is never accepted.

Added a bounded capture-stage diagnostic to distinguish filter, pagination and
save failures without recording private bank data. Stage metadata is cleared on
pause/resume and does not replace authentication errors.

Validation: 7 isolated BIDV Docker browser/integration tests and 54 Docker unit
tests passed. Real capture completed with 22 records across two intervals (22 and
0). Backend processing completed for 19 records; three dated October 2 remain
blocked by existing_ownership_unknown. Legacy duplicate_cleanup links lack durable
proof of the retained transaction's account side; the backend intentionally refuses
to infer it from a mutable current binding. No ownership protection was bypassed
or historical linkage rewritten. Full live synchronization is not yet complete.
Local artifacts rebuilt. No push, tags or publication.

## 2026-10-19 — Compact popup settings layout

Moved Bank accounts above Server connection and Data migration. Removed the
server heading's special bold/dark styling so all disclosure headings share
one appearance. Reduced spacing between sections, below Discrepancies, and
around the connection header and status. Disclosure behavior is unchanged.

Validation: verified section order and shared heading styling, rebuilt the
extension ZIP, and checked the diff. No synchronization or data changes.

## 2026-10-19 — Show both sides of discrepancies

The read-only report now labels and counts unmatched bank and ZenMoney records
separately within each day. It explains account/date/signed-amount comparison and
that delivery does not block reporting. An older server's sync_in_progress state
now requests a backend update instead of suggesting an endless refresh loop.

Validation: two Docker browser/integration report tests passed against fixtures
and the updated backend, including mobile correction refresh, safe text rendering,
source labels, account filters and no financial writes. Inspected desktop and
narrow screenshots; rebuilt local extension artifacts. No push or publication.

## 2026-10-19 — Prepare Chrome 0.2.1 for publication

- Retained version 0.2.1 and documented BIDV, automatic connections, compact popup,
  independent two-sided discrepancies, and backend-first upgrade instructions.
- Release review found and fixed a default 30-day override truncating initial
  six-month imports. Explicit periods still override; repeat imports use 30 days.
- Removed the ineffective popup Unlink action; automatic discovery reattached the
  account immediately. Do not import persists across discovery/shared connections.
- Updated browser tests to expand collapsed sections before interacting. An initial
  parallel run also saw Chromium exit with SIGSEGV before page setup; the final
  isolated complete run passed without retries or weakened assertions.
- Docker: 54 unit tests; 14 independent browser tests with two expected backend-only
  skips; all 30 joint real-backend/fake-ZenMoney browser tests passed. Checks include
  server ZIP migration, repeated delivery, mobile deletion, BIDV navigation and
  filtering, interrupted capture, initial dates, explicit override and repeat dates.
- Workflow lint and tracked-source secret scan passed. ZIP rebuilt twice with
  identical SHA256 df9b4009e41821eed75d0b20c8eda51c9e803c0764e5071d8e60f2333ecf1751;
  28 packaged files, no settings/data/test files. Backend 463f12c was used; SDK
  remains PyPI 0.7.0. Private test logs are excluded in .local/release-0.2.1/.
- Production data/services were unchanged. No push, tags, releases or registry
  publication. Non-fatal upstream Starlette/httpx deprecation remains visible.

## 2026-10-19 — Publish Chrome 0.2.1

Authorized main/tag pushes and GitHub Release completed at source 3226f9d.
Source CI 39260275455 and tag CI 39260573207 passed. CI archive and downloaded
public assets are byte-identical to the locally tested ZIP and SHA256SUMS.
The SHA256 remains df9b4009e41821eed75d0b20c8eda51c9e803c0764e5071d8e60f2333ecf1751.
Backend GHCR native acceptance passed before final verification. No Chrome Web
Store submission, production deployment or financial-data changes occurred.
