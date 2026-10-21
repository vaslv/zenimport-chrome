# Sequential implementation plan: L0–L12

Status: authorized; see progress.md for per-stage completion and evidence.
All paths below are relative to the named repository unless
stated otherwise. New filenames are proposed locations, not existing code.

## Working rules for every stage

1. Read this directory, the repository AGENTS.md, current source and the previous
   stage's evidence. Recheck HEAD and uncommitted changes before editing.
2. Keep production containers, data, tokens and bank sessions outside the test
   setup. Use named disposable Docker volumes and synthetic fixtures. Tests must
   not inherit a developer's `.env`, Chrome profile or default Compose project.
3. Implement only the stage's scope. Keep unfinished local mode inaccessible in
   distributed builds until its safety gates pass.
4. Run relevant unit, contract, integration and built-extension tests in Docker.
   Use a real browser for browser guarantees; a mocked API is insufficient for
   IndexedDB transactions, worker termination or permissions.
5. Review the changed code against the stage's invariants and regression cases.
   Address findings, rerun affected checks and record remaining limitations.
   An independent reviewer is required at the major gates L4, L9, L10 and L12.
6. Update `docs/local-mode/progress.md` with scope, changed contracts, commands,
   evidence paths, test totals, unresolved issues and the next stage. Use English.
   Do not commit private API responses or real account identifiers.
7. Check the staged diff and commit locally. Use `type(scope): imperative english
   description`. Verify the final commit subject and clean/expected worktree.
   Each stage ends with its own commit(s); fixes may get separate focused commits.
8. Stop at a failed safety gate; do not call an incomplete stage complete. Technical
   blockers require a recorded decision, not a bypass. No push, tag or publication
   is part of implementing this plan.

No time estimate substitutes for a gate. Execute sequentially to keep one owner
of cross-language contracts and migration semantics.

### Existing Docker entry points

These scripts were inspected while preparing the plan; they were **not run** for
this documentation-only task. Recheck their arguments/isolation at L0:

| Repository | Current entry point | Baseline coverage |
|---|---|---|
| Chrome | `scripts/test-docker.sh` | Unit and browser suites, network disabled for test containers |
| Chrome | `scripts/test-integration.sh ../ZenImportBackend` | Synthetic browser/backend integration |
| Chrome | `scripts/test-server-migration.sh --fake ../ZenImportBackend` | Existing isolated server-switch acceptance |
| Backend | `scripts/test-docker.sh` | Isolated platform build, API/auth, storage and delivery lifecycle |
| Backend | `scripts/test-contracts.sh` | Existing capture/API contract tests |
| Backend | `scripts/test-platforms.sh` | Both linux/arm64 and linux/amd64 checks |

Extend these or add explicitly named local-mode targets; do not mistake the
existing migration runner for browser-database acceptance. The Chrome runner's
`--live` branch requires separate scenario authorization and is not part of the
commands above. Store new test artifacts under ignored test-result directories.

## Dependencies and repository ownership

```text
L0 baseline/contracts
 └─ L1 browser/storage/SDK feasibility
     └─ L2 common behavior harness + exact arithmetic
         └─ L3 backend portable migration support
             └─ L4 browser database + portable import/export
                 └─ L5 application service boundary, remote compatibility
                     └─ L6 local mirror + credentials + identity
                         └─ L7 local account/capture management
                             └─ L8 matching + prediction + discrepancies
                                 └─ L9 durable delivery/recovery
                                     └─ L10 mode switches and migration
                                         └─ L11 popup integration
                                             └─ L12 complete acceptance
```

ZenImportChrome owns browser orchestration, UI, storage and the TypeScript
application engine. ZenImportBackend owns its Python implementation and portable
server endpoints. `zenmoney-typescript` stays an API SDK; change it only for a
demonstrated SDK defect with its own tests and review. Do not move application
matching or migration policy into the SDK.

Keep shared behavioral fixtures as a versioned data contract with one canonical
source (proposed: Chrome `contracts/business/`). Backend consumes a pinned
checksum-verified copy plus its Python runner. Do not create another public
package just to share test JSON. Record the contract revision in both repositories
and make CI fail if the declared fixture hashes disagree.

## L0 — Freeze observed behavior and logical contracts

**Goal:** make the current safety guarantees explicit before porting them.

**Read:** backend `schema_v2.sql`–`schema_v7.sql`, `storage.py`, `accounts.py`,
`capture*.py`, `records.py`, `mirror.py`, `existing.py`, `ownership.py`,
`predictions.py`, `delivery.py`, `discrepancies.py`, `migration.py`; Chrome
`background.js`, `coordinator.js`, `backend-client.js`, `bank-profiles.js`,
popup/discrepancies handlers and connector interfaces.

**Deliverables:**

1. Add a baseline manifest with exact source commits, protocol version, SDK
   version/integrity and all existing behavior tests.
2. Enumerate all 49 baseline tables, fields, keys (including partial unique indexes),
   null semantics, cascading projection deletion, check constraints, triggers,
   allowed state transitions and metadata keys. Assign each invariant to a future
   TypeScript repository method and a named test.
3. Define domain DTOs separately from HTTP request paths and SDK wire objects:
   config/readiness, account discovery/mapping, capture plan/page/completion,
   mirror refresh, delivery status, discrepancy report and migration operations.
4. Freeze money/date/timezone/identity canonicalization, including missing fields,
   signed target-account movements, repeated transactions and nullable values.
5. Freeze synchronization period precedence from the code and tests: saved first
   import, popup override, rolling overlap, gap recovery, completed interval
   watermark. Do not accidentally replace the current popup's explicit period
   semantics with an older design.
6. Define business fixture schema: initial portable state, ordered commands,
   observed ZenMoney/bank inputs, injected failures, expected API write calls,
   state transitions and final portable state.
   Inject deterministic clocks and UUID generators into both runners. Where a
   runtime-specific identifier is intentionally different, define its comparison
   mapping explicitly; never normalize away a financial UUID or attempted payload.
7. Define portable archive schema and compatibility table from
   [portable-data.md](portable-data.md), including every normalization.
8. Record baseline existing limitations separately from required behavior. A
   discovered Python bug becomes a failing desired-behavior fixture, not parity
   that deliberately reproduces a financial error.

**Checks:** existing backend and Chrome Docker suites; contract-schema validation;
table/trigger inventory completeness; no real API requests.

**Exit:** every existing safety rule has a named owner and fixture; no unknown
table/metadata disposition.

**Local commits:** Chrome `docs(local mode): freeze domain and migration contracts`;
backend only if its reference adapter/fixture metadata changes.

## L1 — Prove the browser architecture

**Goal:** validate runtime assumptions before a full engine port.

**Chrome targets:** `package.json`, lockfile, `scripts/build.py`, new bundler config,
`src/local/` prototype boundary, synthetic extension harness and Docker tooling.

**Tasks:**

1. Pin published `zenmoney-typescript@0.1.0` and a supported Dexie release with
   lockfile integrity. Select a small bundler/toolchain after checking current
   primary docs. Keep source maps/private paths out of release assets as appropriate.
2. Bundle ESM service worker and required extension pages into deterministic local
   assets. Preserve existing content-script/MAIN-world execution boundaries.
   Confirm no Node polyfills, remote script, `eval`, dynamic dependency download
   or CSP exception is required.
3. Prove exact wire roundtrip for large IDs and decimal values through SDK,
   IndexedDB raw-text storage and Chrome message DTOs.
4. Prove multiple-store transaction atomicity, unique compound indexes, transaction
   abort on quota, active-generation lookup, concurrent connections, schema
   versionchange handling and worker restart.
5. Measure realistic 1k/10k/100k-history fixtures and a near-import-limit fixture.
   Record peak memory, transaction/chunk duration and restart behavior. Choose
   bounded chunk sizes so an individual worker task does not approach Chrome's
   idle/fetch/event limits.
6. Test host permission acquisition/revocation, local mode permission scope,
   trusted storage access, timeout/AbortController and absent alarm recovery.
7. Test the installed built extension on Chrome 120 (existing minimum) and current
   pinned Chromium/Chrome in Docker. If test infrastructure cannot run minimum
   Chrome, document the gap; either obtain real minimum-version evidence or
   explicitly propose raising the manifest minimum before release.
   L1 implementation decision: Chrome 120 failed the native persistent-storage
   isolation gate. The local candidate selects verified Chrome 140; see ADR 002.
8. With separate approval, perform one read-only fetch from the built extension
   using the verified **test** ZenMoney account. Confirm real endpoint, permission,
   response codec and MV3 context. Never print the token or persist response data
   into Git. Node SDK tests and a fake HTTPS endpoint do not prove this gate.

**Exit:** supported local bundle, native storage/crash evidence and direct API
feasibility demonstrated. If the live read is pending, isolated work may continue
but local mode cannot be declared ready. If IndexedDB cannot meet invariants,
review the SQLite/WASM alternative before proceeding.

**Commit:** `build(extension): add verified local engine toolchain`.

## L2 — Shared application fixtures and exact arithmetic

**Goal:** make two engines independently satisfy the same financial behavior.

**Chrome targets:** `contracts/business/`, `src/domain/money.ts`,
`src/domain/identity.ts`, `src/domain/dates.ts`, contract runner.
**Backend targets:** `tests/contracts/` Python adapter, fixture revision manifest.

**Tasks:**

1. Implement a finite decimal value using normalized integer coefficient/scale
   and BigInt arithmetic. Preserve bank bounds (24 integer/12 fractional digits)
   and define overflow/unsupported-wire-range errors. Never use `Number`, binary
   floats or a display formatter for reconciliation.
2. Define comparison, sign, sum, subtraction and exact equality needed by transfer
   matching and report totals. Specify no implicit rounding; currencies need not
   have two decimal places. Format display separately.
3. Create lossless DTO/raw-wire codecs and structured semantic error codes.
4. Run fixtures through current Python behavior; record desired expected results
   independently. Build the TypeScript runner interface incrementally.
5. Cover keys, amount/day matching with multiplicity, full/incremental mirror,
   attempted-write recovery, transfer ownership, partial coverage, deletion and
   migration identity. Later stages add their runner implementations.
6. Fix source-domain defects in Python as separate commits with a regression
   fixture. Never silently update all expected results to match a buggy adapter.

**Checks:** Python Decimal versus TypeScript arithmetic vectors; random bounded
property tests; canonical raw JSON/digest fixtures; clear failure for unsupported
commands rather than fake passing/skipped assertions.

**Exit:** reproducible Docker harness, exact arithmetic and contract version policy.

**Commits:** Chrome `test(contracts): add shared financial behavior fixtures`;
backend `test(contracts): add portable behavior reference runner`.

## L3 — Portable server migration and durable operations

**Goal:** provide the server half before browser interoperability is advertised.

**Backend targets:** `migration.py`, `snapshot.py`, storage migrations as needed,
API routes/contracts/capabilities, migration tests and deployment documentation.

**Tasks:**

1. Implement format-2 typed serializer/parser, canonical dataset digest, explicit
   table mapping and invariant validation. Preserve format-1 support.
2. Add physical installation identity distinct from portable dataset identity.
   Persist import/export operation records, holds, chunk acknowledgments and
   immutable receipts. Select the next schema migration number from actual HEAD.
3. Implement bounded, authenticated migration start/status/chunk/finalize/arm/
   handoff/activate/cancel-decision/discard and pre-handoff source-resume commands.
   A source CAS arbitrates `cancel_pending` versus `handed_off` before any discard.
   Bind switch ID,
   expected participant epoch and digest. Freeze names/status/error DTOs. Guard
   legacy `/jobs` and `/migration/resume` so they cannot clear format-2 holds.
   Request idempotency is permanent for the migration outcome, not just a short
   in-memory cache.
4. Reuse and strengthen current gates: no new writers while export/import starts,
   no unfinished capture disguised as complete, unknown requests retained,
   eligible-target recheck at activation, fresh identity check, full mirror
   required after import.
5. Keep ordinary API compatibility with the released extension. Advertise new
   migration capability independently of ordinary capture API compatibility.
6. Validate global pause across two clients and a running delivery. A source may
   not resume automatically because a chunk transfer or popup failed.
7. Document/test old format-1 conversion path and staged restore. Do not add a
   general arbitrary-SQL execution endpoint.

**Checks:** existing backend Docker suite; exact archive golden fixtures; malformed
archives; concurrent import/sync; crash/restart after chunk/commit; wrong owner;
same archive retry; started target; 0.2.1 Chrome remote compatibility.

**Exit:** server export/import proven with canonical fixture archives, no browser
code yet required; unknown source status fails safely.

**Commit:** `feat(migration): support portable datasets and resumable transfers`.

## L4 — IndexedDB financial store and archive interoperability

**Goal:** store the complete financial model with enforceable invariants.

**Implementation status:** completed storage/private authority gate; see
[progress](progress.md#l4--completion-gate) and the
[independent review](reviews/l4-authority-2026-10-21.md).
ADR 004 records the immutable anchor and deferred guarded first-sync setup.
Product routing/local financial sends remain gated by L5–L12 below.

**Chrome targets:** `src/local/storage/`, `src/local/migration/`,
`src/control/`, archive worker/page boundary as justified by L1.

**Tasks:**

1. Create the control database and generation-scoped financial stores. Keep
   `activeMode`, `activeDataset`, switch operation/fence and credential references
   under one transactional owner.
2. Implement versioned IndexedDB upgrades, `versionchange` handling and failure
   recovery; no network operation inside an upgrade/financial transaction.
3. Implement typed repositories, unique indexes, explicit foreign-key checks,
   immutable receipts/attempts, terminal-state constraints and repository-only
   writes. Do not expose unrestricted table writes to application handlers.
4. Implement consistent chunked export under hold and staged import with quotas,
   schema/identity/invariant checks and atomic active-generation pointer.
5. Preserve all portable facts; initialize only explicitly nonportable runtime
   fields. Add source metadata for inspection without treating it as new leases.
6. Roundtrip both directions through L3's server implementation; compare domain
   state/digests with declared normalizations.
7. Add a nonsecret trusted `chrome.storage.local` sentinel outside IndexedDB,
   acknowledged before writable dataset initialization/first dispatch. Missing IDB
   with that sentinel is recovery-required, including after token removal. Test
   a crash between sentinel write and database setup; never auto-reset the marker.
8. Clean abandoned staging after safe TTL and backup acknowledgment. Never clear
   active data as an error-recovery shortcut.

**Checks:** actual IndexedDB in Docker browser; force-stop during transactions and
imports; quota failures; malicious records; reopen after upgrades; format-1 path;
100k and boundary-size datasets; all stored IDs/decimals remain exact.

**Exit:** independent storage/migration review, portable parity and crash safety.
No local financial sends enabled.

**Commit:** `feat(storage): add durable browser financial datasets`.

## L5 — Unified application service with unchanged remote behavior

**Goal:** decouple UI and bank capture from HTTP without changing their semantics.

**Chrome targets:** `src/application/`, remote adapter, `background.js`,
`coordinator.js`, `backend-client.js`, popup/discrepancies/migration handlers.

**Tasks:**

1. Define typed service methods from L0. Adapt current HTTP API to those methods;
   avoid a local adapter that parses URL strings to simulate a web server.
2. Route every financial action through one mode/context resolver. Remove
   scattered `new Backend(...)` decisions from UI handlers.
3. Keep the background message boundary narrow and validated. Attach operation,
   connection, dataset and mode-generation context to commands and replies.
4. Preserve current active request IDs, unknown start recovery, leases, capture
   ACK timing, browser document/account guards and server-token correction flow.
5. Upgrade existing saved server configurations into `remote` mode. Never create
   an active local dataset just because a configured server is unreachable.
6. Namespace transient views, cached catalogs, job status, sync history and
   connection hints by resolved dataset/server context. Endpoint change cannot
   reuse another server's job IDs.
7. Add a disabled local adapter boundary for the following stages. Existing
   release builds still use remote mode until the final local gate.

**Checks:** current popup/coordinator/connectors/migration/discrepancy suites;
snapshot of remote request semantics; configured upgrade; unreachable server;
pending job survives worker restart; stale response after context switch ignored.

**Exit:** remote regression tests unchanged in outcome, one service selection point.

**Commit:** `refactor(extension): isolate application service from transport`.

## L6 — Direct ZenMoney mirror, identity and catalogs

**Goal:** read through the SDK into a durable, exact local mirror.

**Chrome targets:** `src/local/zenmoney/`, mirror repositories, credential service,
catalog service and readiness status.

**Tasks:**

1. Use the published SDK and its fetch transport with explicit timeout/size
   limits. Keep token handling in the privileged extension context.
2. Implement identity bootstrap and local-token rotation: verify owner before
   adopting it; same owner retains data, different owner does not overwrite.
   A draft token is not considered a successfully configured connection.
   Verified tokens persist in trusted local storage; secret drafts are session
   scoped with 24-hour TTL. Credential epoch changes fence new dispatch. Removal
   deletes secrets/drafts after disabling the epoch, preserving uncertain requests,
   financial records and the independent sentinel.
3. Implement full/incremental diff, raw run capture, atomic cursor/projection
   updates, generation checks, tombstones and explicit required collections.
   No missing response collection or failed request becomes deletion evidence.
4. Derive account movements for all transaction types including both legs and FX;
   preserve exact source values for future schema interpretation.
5. Implement single-flight durable refresh, stale response rejection, cooldown/
   rate-limit scheduling and structured auth/permission errors.
6. Expose readiness/catatalogs without starting delivery. Force fresh full mirror
   after migration/identity rebind, preserve permanent deletion evidence.
7. Validate redaction across logs, popup errors, export, crash records and fixtures.

**Checks:** fake API full/diff sequences; HTTP400/401/403/429/5xx; timeout/invalid
JSON; wrong owner; missing collections; concurrent refresh; killed worker before/
after DB commit; SDK raw large numbers; permission revoked during fetch.

**Exit:** mirror/projection Python parity; no live create call possible from stage.

**Commit:** `feat(local mode): mirror ZenMoney directly in browser storage`.

## L7 — Local connections, account mapping, capture and periods

**Goal:** existing bank connectors can capture into local storage.

**Chrome targets:** local account/capture services, shared coordinator and existing
connector adapters only where their interface requires changes.

**Tasks:**

1. Port automatic connection detection, primary-account anchor, canonical account
   membership, labels and binding history with settings versions.
2. Keep every account's enabled/ignored/unconfigured status and ZenMoney target.
   Multiple logins to the same bank remain distinct without duplicating the same
   physical bank account.
3. Port L0's exact period planner, calendar-month preset, timezone boundaries,
   overlap and gap logic. Capture coverage advances only for validated completion.
4. Persist job request and immutable plan/account snapshots before starting bank
   reads. Atomically save page/records/revisions before ACK to the connector.
5. Reject conflicting repeated pages, stale leases, wrong connection/account,
   document changes and incomplete/incorrect totals. Preserve data already safely
   captured and permit the same logical request to recover.
6. Finish a capture independently of downstream delivery availability. Refresh
   Discrepancies from available complete intervals even if local API auth fails.

**Checks:** both existing BIDV/VietinBank synthetic connector suites in local and
remote modes; repeated page ACK, same-bank two profiles, multi-account, timezones,
six-month and gap plans, worker death after page commit, cancellation/partial bank
history. No bank page receives injected product controls.

**Exit:** identical captured portable facts and completeness decisions in both
implementations.

**Commit:** `feat(local mode): persist bank connections and history capture`.

## L8 — Matching, transfers, prediction and discrepancy reports

**Goal:** equal financial decisions with the server, including previously fixed
cross-bank transfer cases.

**Chrome targets:** `src/domain/reconciliation/`, `src/domain/prediction/`,
`src/local/reports/` and repositories. Python reference fixtures expand as needed.

**Tasks:**

1. Port reference/receipt-first matching and actual target-account ownership.
   Apply day, sign, amount, currency and account to all transaction types.
2. Port multiplicity: consume each eligible movement once in its proper group/
   side; same day/amount does not imply every bank row is already covered.
3. Port split/settlement matching with explicit bounded search, deterministic
   ordering and visible reasons when search is ambiguous/exhausted.
4. Port late-evidence transfer recovery: a newly linked bank can claim the other
   side of the existing ZenMoney transfer, using historical binding and authorized
   bank amount evidence. Receipts from old mappings remain trustworthy.
5. Preserve final user edits/deletions and exclusions. Reconciliation may update
   local evidence but must not rewrite a mobile edit or restore a tombstone.
6. Distinguish a newly unmatched bank movement from a previously attempted UUID
   whose result is unknown. The latter never becomes a fresh-create candidate.
7. Port category evidence/rules/confidence/freshness. Exclude unreliable matches,
   own predictions, unreviewed transfers and inappropriate directions from
   learning. Use no category when confidence fails.
8. Port both report sides with complete-bank-coverage restrictions and exact daily
   totals. A blocked delivery must not hide available discrepancies.
9. Chunk CPU-heavy scans outside transactions; use indexed candidate queries.
   Revalidate the generation when committing a derived result.

**Checks:** shared fixtures for every historical transfer/duplicate regression;
same day equal amounts with differing multiplicity; FX; untracked counterpart
account; new bank appears later; deleted transfer; changed binding; stale evidence;
prediction conflict; partial coverage; equal balance with different transactions.

**Exit:** Python/TypeScript behavioral parity and report parity; no API write in
matching or reporting. Independent domain review recommended here as well.

**Commit:** `feat(local mode): reconcile transactions and predict categories`.

## L9 — Durable create-only delivery and worker recovery

**Goal:** safely create new unviewed transactions despite MV3 interruption.

**Chrome targets:** delivery engine, scheduler/alarms, outbox repositories,
read-only verification and startup recovery.

**Tasks:**

1. Persist original authorization/capture version, stable transaction UUID,
   immutable exact payload and attempt record before any HTTP write.
2. Match/revalidate current mirror and target settings before first send. Follow
   server batching and verification rules; refresh before each batch of up to 20.
3. Distinguish verified success, deleted/suppressed, definitely not started and
   unknown outcome. Use durable state names mapped to the shared contract.
4. After timeout/network death, verify the **same UUID** by a fresh read. Existence
   confirms delivery even if the user edited it. Unknown absence alone does not
   authorize a blind resend. Port the server's bounded verification/retry policy.
5. Make HTTP status handling conservative: a 400 response is not assumed to prove
   every batch member was never created. Test partial acceptance/unknown results.
6. Implement fenced per-dataset delivery ownership, persistent deadlines and
   backoff. Recreate missing alarms on startup; an in-memory Promise queue is not
   the durable coordinator.
7. Bound execution to small units; persist before yielding. Closing popup does
   not cancel an accepted operation; closing Chrome pauses work safely.
8. Check mode/migration fence before claiming and immediately before dispatch,
   with switch quiescence covering already in-flight requests.
9. Status identifies capture progress separately from delivery/verification and
   last successful synchronization.

**Checks:** fake service records every request durably; kill worker before attempt,
after attempt before fetch, during fetch, after remote commit before response,
after response before local receipt; partial batch; expired lease race; repeated
alarm; auth rotation; rate-limit; migration hold during request.

**Exit:** independent delivery review. Zero extra create calls in every replay
scenario with retained evidence. Unresolved cases remain safely visible.

**Commit:** `feat(local mode): deliver new transactions with durable recovery`.

## L10 — Atomic mode selection and bidirectional migration

**Goal:** changing where data lives cannot silently create a second writer.

**Chrome targets:** mode controller, migration orchestration, context routing;
backend endpoints/gates from L3 if interoperability reveals defects.

**Tasks:**

1. Implement the durable switch state machine in architecture.md. Configuration
   editing is not activation. Source and destination status, identity, digest and
   hold receipt must be verified before the active pointer changes.
2. New install initializes local mode. Existing configured remote mode persists.
   Unavailable server never triggers automatic local fallback.
3. Local→empty server: optional migration checkbox, selected by default if local
   history exists; complete transfer/import/receipt before activating remote.
   Without transfer, require a clear warning about lost deduplication evidence and
   leave the new mode awaiting explicit synchronization.
4. Local→used server: join without import or merge; keep local generation inactive.
   Verify owner/dataset identity and show current server context before activation.
5. Remote→local: fresh generation and a reachable, quiescent server export.
   There is no empty-start escape for a used or unreachable source in this phase.
   Old local history is backup only. Back it up and require replacement consent;
   never reactivate it simply because it was once used.
6. Before moving off a shared server, display that export pauses all its clients.
   Disconnected old clients must observe the global hold before another send.
7. Recover lost import/activation responses by status/digest queries. Before source
   handoff, cancellation must win source `cancel_pending` CAS and then durably
   discard destination activation rights. If handoff won, discard is forbidden.
   After handoff, recover forward or start a new reverse migration; never resume
   the old source in place. If an outcome is unverifiable, remain paused.
8. Scope/reload all popup views and job IDs after pointer activation. Preserve
   selected period/connection only if they belong to the new dataset.
9. Implement backup/export download and restore/import progress, safe manual file
   handling, retry and storage cleanup without new permanent UI pages.
   Distinguish live migration from archive-only disaster recovery after source
   loss. Restore requires an eligible destination, explicit former-writer
   retirement declaration, owner/full-mirror verification and a read-only summary
   before activation. Explain loss of post-snapshot evidence; no automatic offline
   fallback and no fabricated handoff receipt.

**Checks:** browser↔server↔browser roundtrip; each switch crash point; two clients;
used/wrong-owner targets; dropped success reply; different ZIP retry; old v1;
same-digest retry; stale local copy; server offline; permission/quota failure.

**Exit:** independent migration review and exact invariant/side-effect comparison.
The old source is retained and paused, never silently wiped.

**Commits:** Chrome `feat(migration): switch storage modes with verified transfers`;
backend focused fix commit only if needed.

## L11 — Minimal popup and report integration

**Goal:** expose local capability without rebuilding a complex operations UI.

**Chrome targets:** popup HTML/styles/controllers, connection setup,
`popup-migration.js`, discrepancies controller, English UX/privacy documentation.

**Tasks:**

1. Preserve connection title/edit icon, Synchronize button, collapsed period,
   last-sync date/relative time and Discrepancies.
2. Present Bank accounts, local ZenMoney connection, Server connection and Data
   migration as compact peer sections. Hide irrelevant local credentials in remote
   mode; no generic Settings wrapper or bank-page overlay.
3. Open only required setup sections. Save address/token drafts across popup
   closing, but do not treat drafts as verified active credentials.
4. Configure local ZenMoney token, verified owner and optional remote connection
   with clear mode label. Do not ask for bank passwords or credentials already
   held by the backend.
5. Show migration checkbox only for eligible destinations, with active-history
   default/backup/replacement/global-pause behavior from L10.
6. Progress messages distinguish reading bank, refreshing ZenMoney, sending,
   checking an uncertain outcome and migration. Preserve useful status after
   popup closes or a worker restarts; avoid raw stack traces/financial dumps.
7. Keep Discrepancies read-only through the common facade. Refresh may read
   ZenMoney; it never creates/deletes transactions as a side effect.
8. Test keyboard access, label association, focus after collapsed setup, disabled
   actions with reason, narrow popup and scrolling. Controls must not overflow.
9. Explain local-profile storage limits, backup importance, token removal and
   no automatic cloud backup in concise setup/help text.

**Checks:** built extension visual/interaction tests for fresh local, configured
local, remote upgrade, invalid token, no bank, two bank profiles, migration,
blocked delivery and available report; secrets absent from page/content context.

**Exit:** local mode can be enabled in release candidate only after L1–L10 gates
pass; every path usable without hidden developer commands.

**Commit:** `feat(popup): expose standalone setup and storage migration`.

## L12 — Full acceptance, documentation and release preparation

**Goal:** produce a reviewable release candidate with honest evidence.

**Tasks:**

1. Run all [acceptance scenarios](acceptance.md) from built release ZIP and clean
   profiles/volumes. Confirm no source-only test bypasses bundling or permissions.
2. Repeat critical crash, transfer, deletion and migration cases in minimum/current
   browsers, including a complete Chrome shutdown and restart.
3. Run both repositories' full suites, shared contracts, backward compatibility,
   archive fuzz/boundary tests, dependency/license checks and artifact verification.
4. Independently review storage invariants, all outbound write entry points,
   credentials, capture trust boundary and mode/migration state machine.
5. If separately approved, verify controlled test-account local sync and migration
   with a known artificial history. Record exact expected side effects beforehand;
   clean up only scenario-owned UUIDs. Production history is not test material.
6. Document installation/local setup/token rotation/backups, remote setup,
   browser→server and server→browser procedures, old-archive conversion, paused
   recovery, known limits and troubleshooting in English.
7. Update README, PRIVACY, manifest permissions explanation, CHANGELOG, package
   versions, compatibility matrix and release notes. Select coordinated release
   numbers now, using the actual published baseline at implementation time.
8. Build ZIP + SHA256SUMS and backend image locally. Verify archive content and
   dependency pinning. Report what passed, what was not run and any blockers.
9. Save final local commits. Publish only after separate explicit authorization.
   Publish backend migration support before the extension that depends on it.

**Exit:** every required matrix item passed with evidence, or release explicitly
blocked with a concrete remaining task. No "production ready" claim based only on
unit tests or synthetic Node API access.

**Commits:** `docs(local mode): document standalone operation and migration`;
release preparation commits with scope `release` per repository as appropriate.

## Handoff prompt for the implementation model

> Implement L0 only from `docs/local-mode/`. Read AGENTS.md and inspect current
> HEADs first. This phase is planning-approved only after the user says to begin.
> Do not touch production data or live bank sessions. Preserve existing remote
> behavior. Freeze exact domain/portable contracts before porting code. Run
> relevant checks in isolated Docker, review, record evidence and commit locally.
> Do not push, create tags or publish. Report the next stage and any failed gate.

For later stages, replace L0 with the explicitly authorized stage or sequential
range. Do not skip unfinished prerequisites because a later UI task is easier.
