# Standalone extension implementation progress

User authorized sequential implementation, checks and local commits on 2026-10-20.
No push, tags or publication are authorized for this phase. Automated tests use
only synthetic services, isolated browser profiles and disposable databases.

## L0 — source behavior and contracts

Status: complete. Source/contract review and Docker validation passed.

- Pinned Chrome 32f8628 (including the fixture-race correction), backend 618bf4f
  (SQLite7/API1), SDK 5a6aa60/npm0.1.0
  and its public tarball SHA256. Source/test file hashes are in baseline.json.
- Generated all 49 table definitions, columns, SQL checks, foreign keys, indexes
  including partial uniqueness, triggers and per-table repository/test ownership.
- Classified all current service_meta keys. Unknown/legacy metadata is rejected
  until explicit secret-screened mapping; archives never execute legacy SQL.
- Froze all 21 routes including info/health/migration, Pydantic wire models,
  transport-independent operations, 15 financial rules, portable manifest/typed
  scalars/canonicalization and scenario schemas. Future business fixtures are
  explicitly specified, not falsely reported as executed parity tests.
- Recorded exact period precedence and remaining gaps in baseline-behavior.md,
  including Unicode NFKC/full-casefold parity and new migration-gate requirements.
- Added pinned dev-only Ajv validation. Runtime extension code is unchanged.

### Validation evidence so far

- Backend `scripts/test-docker.sh`: 543 passed on linux/arm64, plus container
  authentication, SIGKILL recovery, graceful-stop and restored-snapshot checks.
- Chrome baseline `scripts/test-docker.sh`: 54 unit tests passed; 14 standalone
  browser tests passed, 2 backend-only modules skipped by design.
- Chrome updated `scripts/test-docker.sh --unit-only`: 60 passed, zero skipped.
- Initial full integration: 28 passed, 2 failed because start_sync observed the
  durable command before its job acknowledgment. Corrected only the fixture
  helper; focused regression passed (2 passed, 12 deselected).
- Fixture-race fix committed separately: 32f8628
  `test(browser): wait for persisted job acknowledgement`.
- Full integration rerun: 30 passed, zero skipped (389.04 seconds). The two
  original failures are resolved without changing application behavior.
- SQLite inventory independently reconstructed and compared inside the pinned
  Python Docker image, including nested/quoted CHECK parsing: passed.
- Baseline regeneration/check, schema validation, contract integrity and diff
  checks passed. Review confirmed semantic Pydantic validators are documented
  separately from generated JSON Schema. No live financial API was called.
- Public npm metadata confirms 0.1.0 integrity; SDK installation remains L1.

Ignored evidence: test-results/local-mode/L0/. No credentials are recorded there.

## L1 — browser architecture and SDK feasibility

Status: complete for the Chrome 140 candidate. Code review and Docker gates passed.

- Installed public zenmoney-typescript 0.1.0 with the L0-pinned npm integrity,
  Dexie 4.4.6, esbuild 0.28.2 and TypeScript 5.9.3. Docker uses pinned Node 24.
- Added deterministic browser ESM bundling for the worker and extension pages.
  Type checking and dependency checks reject external/Node imports. Product ZIPs
  exclude the isolated feasibility entry, test data, source maps and metafiles.
- Proved lossless SDK/raw-IDB/Chrome-message roundtrips, compound uniqueness,
  multiple-store rollback, failed upgrades, versionchange connection closing,
  actual worker termination, full browser restart and absent-alarm recovery.
- Tested native host consent denial/grant/revocation, SDK timeout and content
  script denial of local/session storage. Probes do not expose real credentials.
- Required unlimitedStorage replaces an unsupported optional grant (ADR 001).
  Genuine native quota rollback uses the same bundled store on a bounded web
  origin; extension-origin DevTools quota override is ineffective. Extension
  transaction quota failure is separately injected. Physical disk exhaustion on
  the extension origin is not claimed as tested.
- Chrome 120 failed: local.setAccessLevel is absent and its startup exception
  prevents message handling. An older matching driver reproduced the missing
  browser method. Selected Chrome 140 for the local candidate (ADR 002), with the
  alternative of redesigning credentials offered to the user. This is an explicit
  compatibility change for the upcoming release, not an update to published 0.2.1.
- Tested 1k/10k/100k rows, last using 204.8 MB logical payload, chunks of 1,000.
  Both tested runtimes stayed below the 3 GiB container budget and the 10-second
  chunk budget. Exact measured times and cgroup peak memory are in ignored JSON.
  This is feasibility evidence; L4 still tests actual financial archives/stores.
- The separately approved live read passed from an installed MV3 probe: one
  SDK request, verified test identity, no financial writes and no stored response
  data. An earlier preflight failed before browser launch/API dispatch; the
  read-only filesystem Chrome crashpad configuration was corrected offline.
  No additional live requests are authorized by this result.

### Validation evidence

- `scripts/test-docker.sh`: 61 unit tests; 14 standalone browser tests passed,
  2 backend-only modules skipped by design.
- `scripts/test-integration.sh ../ZenImportBackend`: 30 passed, zero skipped;
  unchanged remote synchronization semantics after bundling.
- `sh scripts/test-local-runtime.sh`: six native feasibility cases per supported
  browser: Chromium 145 passed in 16.08s; Chrome 140 passed in 44.53s. Zero skipped.
- Two final pinned Docker artifact builds are byte-identical: SHA256
  fee823b2be137085787373a8cbcd9eb3017f5da1cb0bac6f0b9361ff0e8eff72.
  Review checked the permission scope, read-only probe guard, package exclusions,
  SDK pin, isolated profiles and the unsupported Chrome 120 exception. Native
  content-script denial was added rather than inferring security from API calls.
- Docker artifact build/checksum comparison and native browser checks are recorded
  under ignored `test-results/local-mode/L1/`. No production data/services changed.

## L2 — common behavior and exact arithmetic

Status: complete. Cross-language, native-browser and source-code review gates passed.

- Added BigInt finite-decimal arithmetic, bounded bank/SDK projections, exact
  signed transfer movements, raw/DTO codecs and structured domain failures.
- Pinned Unicode 15 full casefold with native NFKC parity, Python whitespace and
  code-point semantics; added calendar/offset/timezone/month-clamping helpers.
- Both runners execute eight pure scenarios, 500 arithmetic vectors and 6,354
  normalization vectors with identical observed results/digests. Four future
  stateful specifications explicitly reject unsupported execution; no fake pass
  or ignored state assertions/faults. Deterministic clock/UUID contexts are ready
  for later stateful adapters. Shared hashes/fixture version policy are enforced.
- The desired high-precision movement fixture failed against the old backend.
  Fixed source arithmetic separately in backend 4f30c02; retained the independent
  expectation. Matching, reports and reviewed cleanup now preserve exact sums.
- Recorded limits, intentional formatter whitespace handling, prediction handling
  for newer Unicode and future coverage in behavior-contracts.md.

### Validation

- `sh scripts/test-business-contracts.sh ../ZenImportBackend`: exact parity for
  eight scenarios and all 6,854 generated vectors. Network disabled.
- Chrome `scripts/test-docker.sh`: 69 unit tests passed; 14 standalone browser
  tests passed, two backend-only modules skipped by design.
- `sh scripts/test-local-runtime.sh`: eight installed-worker/native cases passed
  per browser: Chromium 145 in 17.02s; Chrome 140 in 57.19s, zero skipped.
- Backend `scripts/test-docker.sh`: 553 tests plus HTTP/auth, SIGKILL, graceful
  shutdown and restored snapshot delivery passed. The final sign-only refinement
  also passed all 553 tests in the read-only Docker test container.
- TypeScript strict type checking, SDK browser bundling, contract copy/integrity
  check and source baseline check passed. Review checked scale before monetary
  normalization, exact transfer direction, astral key ordering, codec budgets,
  unsupported stateful fixtures and the financial rounding regression.
- Ignored evidence is under test-results/local-mode/L2/. No live API requests,
  production data/service changes, push, tags or publication in this stage.

## L3 — portable server migration

Status: complete after the L3.4 verification below. L3.1 added the bounded format
codec and independently checked golden bytes. The checkpoint notes below record
how graph, authority and HTTP gates were subsequently completed. Standalone
financial mode remains inaccessible in the product UI until L4–L11 pass.

### L3.2 — private financial graph validation

- Added an explicit shared metadata/legacy classification contract and runtime
  copy. Unknown keys, objects and columns fail until reviewed; archived SQL is
  inert data, not executed schema. Stock legacy projections are verified against
  archived facts instead of relaxing modern SDK checks.
- The backend validates all staged hashes again, relational/insert constraints,
  raw bank aliases/revisions, capture/request/coverage proofs, terminal processing,
  attempted identity and authorization, current mirror projections, owner claims
  and nested credential markers in a disposable private proof database.
- Source host paths/leases have documented normalization. Owner comparison is not
  fresh authentication; graph validation grants no import or activation authority.
- Docker: 626 backend tests and 70 Chrome unit/contract tests passed. Only synthetic
  fixtures, no live calls. Review added missing projection rejection and a legacy
  source-proof regression rather than accepting modern malformed string amounts.
- L3 remains incomplete: durable participant/epoch/CAS, transfer endpoints, staged
  installation, old-client hold guards and crash/race acceptance are next. No
  format-2 HTTP route or user-facing local financial mode is enabled yet.

### L3.3 — durable server participant primitives

- Backend schema 8 separates physical installation UUID/epoch from financial
  lineage; adds immutable switch bindings, receipts and bounded durable chunks.
  The canonical contract explicitly excludes these runtime authority tables.
- Source cancellation and handoff share one transactional CAS. Cancellation needs
  a bound destination discard before resumption, including a permanent tombstone
  when upload never started. Activation requires source handoff, rechecks target
  eligibility and commits installation/receipt together; sending awaits Sync.
- Persistent holds also guard old jobs/resume/export paths and mirror startup.
  Old Mirror instances cannot reclaim changed credentials. Format-1 SQLite6/7/8
  restores preserve destination physical identity; original financial lineage
  and source schema audit remain distinct from new runtime migration markers.
- This is an internal primitive layer, not exposed format-2 HTTP or completed L3.
  Background staging, authenticated capabilities/commands and full interop/crash
  acceptance remain next. Runtime product behavior is still remote-only.
- Validation: 669 backend Docker tests passed after review, including CAS races,
  immutable evidence, repeated chunk ACK, rollback during installer invocation,
  eligibility recheck, legacy hold guards and physical-identity restore. Full
  isolated container lifecycle suite also passed (667-test revision plus HTTP,
  SIGKILL, graceful stop and restored delivery). Chrome unit/contract suite: 70
  passed. No live API calls or production changes.
- User reports Chrome 155.0.8059.85 installed; minimum 140 remains the candidate
  decision. Native Docker evidence still covers 140/145, not an unrun 155 build.

### L3.4 — portable server API, background staging and atomic installation

- Added the pinned protocol-2 HTTP schemas/routes/command contract and explicit
  physical alias for legacy hold audit. Receipt null fields are part of integrity
  and are preserved through the HTTP response model. Ordinary capture API stays 1.
- Added authenticated bounded chunk transfer; persisted background snapshot,
  validation and activation tasks; fresh read-only SDK owner checks; atomic
  financial installation with permanent decision receipts; explicit retry/status.
- Source quiescence recovers crashed attempts as uncertain without another send.
  Source/target holds survive every failure. A target stays awaiting explicit Sync.
  Recovery recognizes committed success even after the coordinator advanced.
- Reviewed historical source proofs, contiguous revisions, category positions,
  legacy missing-run-ID compatibility, late mirror commits and indexed audit
  lookups. Trusted SQL is packaged; archived SQL remains inert. Private scratch
  is cleaned only for the current installation under its writer lock.
- Latest native suite: 701 tests passed before the final HTTP status-code mapping;
  both architecture lifecycle suites passed their 695-test checkpoint, including
  HTTP/auth, SIGKILL, graceful stop and restored delivery. Chrome compatibility:
  30 browser/backend cases passed. Chrome unit/contract checks: 70 passed.
- Final verification/contract pin update remains before declaring L3 complete.
  L4–L12 have not started; product UI still uses the remote backend exclusively.

### L3 final gate

- 702 backend tests passed in the read-only network-disabled Docker container.
  Both linux/arm64 and linux/amd64 full Docker suites passed the 701-test revision,
  including HTTP/auth, SIGKILL, graceful stop and restored delivery. The final
  provenance-chain addition passed the complete 702-test native suite.
- The built current extension passed all 30 browser/backend integration cases;
  70 Chrome unit/contract cases passed. Cross-language results remain identical
  for eight scenarios, 500 arithmetic and 6,354 Unicode vectors. Contract copies,
  declared source revision and reproducible runtime bytes are checked.
- Native process SIGKILL covers private staging, committed source sealing and
  committed activation before its task acknowledgment. Recovery cleans only own
  scratch and recognizes permanent results without another API read or write.
- Import provenance is portable audit, separate from activation authority. A
  second migration/re-export preserves the exact earlier provenance and all
  attempted-send rows. Old archives, wrong owner, receipt substitution, source
  cancellation/handoff race, legacy hold bypass and late mirror commits are covered.
- Review findings were fixed before closing the stage: receipt null serialization,
  stale task display after coordinator advancement, source attempt recovery,
  explicit legacy projection/revision/tag proofs and import provenance retention.
- No live API requests, production data/container changes, push, tags or publication.
  Evidence logs are stored in ignored test-results/local-mode/L3/.

## Next stages

L4 is in progress: native IndexedDB financial repositories and archive interop,
with its required independent review. L5–L12 are not yet implemented. Product synchronization
continues to use the remote backend; do not present standalone mode as ready.

### L4.1 — typed scalar/key foundation (L4 in progress)

- Reproducibly generated all 49 logical row interfaces and column, primary,
  secondary/partial-unique, foreign-key, CHECK and trigger descriptors from the
  checksum-pinned contract. Unknown expression/partial indexes fail generation.
- Added typed scalar validation and exact signed-64-bit text. IndexedDB keys use
  ASCII UTF-8 hex and offset fixed-width integer hex, preserving SQLite ordering
  including astral text, embedded NUL, negative values and integers above 2^53.
- Raw JSON is opaque exact text at this layer. These shape/key checks explicitly
  do not claim financial-graph or relational validity; repositories add that gate.
- Docker: 84 unit/contract tests passed; strict TypeScript and browser ESM bundling
  passed. No new runtime behavior, browser storage or local financial sends are
  exposed. Native financial database, archive interop and independent L4 review
  remain required. Generator checking is part of the Docker unit build.

### L4.2 — native control owner and loss sentinel (L4 in progress)

- Added a storage-private Dexie database with strict transaction durability, all
  49 generation-scoped financial stores/indexes and typed runtime/dataset control.
  Initial seeds, active pointer and profile identity commit together. Application
  handlers receive no database handles or generic financial mutation method.
- A trusted chrome.storage.local sentinel is acknowledged before IDB creation.
  It is ready only after initialization. A separate monotonic activity key cannot
  be erased by a stale base update or unrelated credential-key deletion. Missing
  IDB, incomplete initialization or mismatched metadata requires recovery; it
  never silently initializes another financial journal.
- Native tests cover concurrent opening, full profile restart, marker write/ready
  ACK failure, stale activity fence and worker termination after acknowledged
  sentinel creation but before IDB initialization. The crash fixture originally
  killed before the write ACK; its explicit checkpoint now tests the intended
  boundary. No financial-history reset path was added to satisfy it.
- Added ADR 003: stable profile installation identity is distinct from the fresh
  financial participant identity for each generation. Returning from a server
  cannot reactivate a previously handed-off generation.
- Docker: 91 unit/contract tests passed; strict typing/bundling passed; 14 native
  cases passed per browser (Chromium 145 and Chrome 140). The 3 GiB offline
  containers and isolated profiles never used a real API or bank session.
- L4 is not complete. Relational/financial mutation repositories, staged archive
  interoperability, generation activation/cleanup tests and the independent
  storage review remain. Local mode remains inaccessible in product handlers.

### L4.3 — relational constraints and fenced native writes (L4 in progress)

- Added a storage-private transaction owner with same-generation foreign keys,
  native unique/partial indexes, projection cascades, immutable acknowledged facts,
  terminal processing and stable attempted UUID/payload/authorization guards.
  Any rejected mutation aborts the whole transaction even if its caller catches
  the error. Escaped handles cannot open an implicit later transaction.
- Interpreted only checksum-pinned packaged CHECK predicates, with no arbitrary
  SQL/eval. 2,332 independent cases execute the actual SQLite 3.40.1 reference,
  including three-valued NULL logic, UTF-8 text, exact money and JSON depth limits.
  The reference caught the newer JSON1 nesting limit assumption: the pinned
  backend accepts 2,000, not 1,000 levels. Raw JSON is not rewritten.
- IndexedDB version 2 adds generation-scoped FK indexes. Upgrade rebuilds derived
  envelopes atomically, preserves exact raw payloads and rolls back to version 1
  on invalid old rows. Financial logical schema remains 1.
- Review corrected attempted-authorization lookup to use the delivery's unique
  bank-ID index rather than its ZenMoney-ID primary key. Application handlers
  cannot import generic financial handles or the callback-based internal writer.
- Docker: 96 unit/contract checks passed; 24 native cases passed per browser
  (Chromium 145 in 27.55s; Chrome 140 in 128.79s), including real worker death inside
  a financial transaction, synthetic quota failure, caught-error rollback,
  immutable attempt/proof history, cross-generation FK rejection and upgrades.
  Backend reference/portable-codec checks: 46 passed. Evidence is under ignored
  test-results/local-mode/L4/. No live calls or production data changes.
- L4 remains incomplete: staged archive interoperability, complete financial
  graph validation, generation activation/cleanup and independent review follow.

### L4 archive-contract correction

Cross-runtime inspection found that the manifest JSON Schema declared table
counters as strings, although the actual Python codec, canonical digest and
golden fixture already use bounded JSON integers. Corrected the schema to the
existing format (0 through 268,435,456) and added golden-descriptor validation,
fractional/boolean/string/unsafe-counter rejection and Python boundary checks.
This does not change financial tagged INTEGER strings or HTTP protocol counters.
Docker: 96 Chrome unit checks and 91 backend codec/graph/reference checks passed.
No archive validity is presented as financial graph or activation authority.

### L4.4 — browser portable ZIP format (L4 in progress)

- Added bounded streaming row/ZIP codecs with exact typed scalars, canonical
  ordering, duplicate JSON/member rejection, CRC/size/hash/digest checks and
  strict inert ZIP metadata. Source SQL is never executed. All stage/activation
  authority remains outside this format-only module.
- Pinned fflate 0.8.3 and @noble/hashes 2.4.0 with npm integrity and MIT notices.
  Bundles use only synchronous compression/incremental hashing, without Node
  dependencies or additional Workers. Portable runtime constants are generated
  reproducibly from the same five contract resources packaged by Python.
- Docker interop exported TypeScript's golden ZIP, verified every raw row/table
  and digest in Python, then verified Python's ZIP in TypeScript. Producer contract
  SHA256 agrees. The fixture explicitly cannot pass financial graph validation.
- Docker: 111 unit/contract cases passed; 25 native cases passed per browser
  (Chromium 145 in 31.03s, Chrome 140 in 133.32s). Native MV3 exercised the bundled
  SDK/ZIP/hash codec under CSP with worker creation forbidden. Format tests cover
  malformed metadata, BOM names/JSON, duplicate keys/members, source ordering,
  exact integers, untrusted lengths/CRC and redacted/quota sink failures.
- L4 is not complete: inactive durable staging, full graph validation, bounded
  large-dataset storage, generation lifecycle/cleanup and independent review
  remain. No live financial API calls or user-facing local sends were enabled.

### L4.5 — durable inactive import generations (L4 in progress)

- IDB version 3 adds a private stage journal. Imports use a fresh generation and
  writer identity, bounded native batches, trusted-sentinel checks before every
  batch and routing/lifecycle checks within each transaction. They re-read and
  verify the committed financial bytes before recording format completion.
  No code in this importer changes the active generation or grants API writes.
- Interrupted imports remain loading/inactive; malformed or quota-failed imports
  remain failed/inactive. Retry does not reopen an incomplete stage as a writer.
  Existing active counts/views are scoped to the active generation. A stale
  generation now reports stale_epoch rather than misclassifying a valid current
  marker as lost storage. Missing/malformed markers still require recovery.
- Hardened nested quota/bulk error redaction; verified rollback and subsequent
  retry without leaving the fixture's injected hook installed. ZIP wall clocks
  are deterministic across timezones; descriptor span disambiguates its signature
  from a possible CRC value. Codec CPU yields stay outside IDB transactions.
- Docker: 116 unit/contract cases passed. Complete native suites passed 33 cases
  per browser (145: 94.68s; 140: 278.17s). Two focused cases passed on each current
  build (4.21s/14.58s), adding a 34th unique case for marker removal during import
  and rechecking quota/retry. The 140 run's 60s faulthandler diagnostic during its
  long benchmark was not a failed test or execution timeout; all cases completed.
- Native 100k staging stored 206,600,234 logical bytes. Both browsers stayed below
  1.3 GB cgroup peak and 150ms per native transaction, within the 3 GiB/10s gates.
  This is envelope/format throughput, not a fabricated financial-graph pass.
  Actual worker death preserves inactive partial data and the original active
  pointer. Evidence is copied to ignored test-results/local-mode/L4/.
- L4 remains incomplete: full financial graph validation, protected generation
  activation/retirement, backup-aware cleanup, legacy conversion and independent
  review remain. L5–L12 have not started. No live calls, production changes,
  push, tags or publication were performed.

### L4.6 — archive JSON and Python value parity (L4 in progress)

- Added 1,044 independent actual-Python expectations for secret screening,
  classified audit metadata, Decimal text and mirror amount/flag projections.
  Frozen Unicode-15 word ranges and Python case folds avoid host Unicode drift.
  Nested JSON, escaped lone surrogates, unknown metadata and invalid provenance
  fail before any graph activation; original raw JSON is not rewritten.
- A large-field regression exposed excessive temporary string allocation in the
  SDK dependency's JSON parser. Archive JSON now uses native grammar with bounded
  preflight and mandatory numeric source revival into SDK exact types. API SDK
  0.1.0 and its HTTP client are unchanged. Duplicate decoded keys, unsafe numeric
  coercion, excessive nesting and invalid Unicode remain rejected.
- Docker: 123 unit/contract cases passed; native archive/value/boundary cases
  passed on Chromium 145 (3 in 5.77s) and Chrome 140 (3 in 18.71s). Both actual
  browsers parsed/canonicalized a 128 MiB row under the 3 GiB container limit.
  A separate 16 MiB invalid-ID regression passed with a 128 MiB JS heap.
- Backend's complete offline Docker suite passed 737 cases after the source-side
  JSON/audit corrections. The shared vectors are recomputed from those actual
  Python functions, not copied expected TypeScript results. Focused native checks
  do not replace the later complete L4 gate or independent storage review.
- Full graph validation, protected lifecycle/cleanup and legacy conversion remain
  next. Product mode is still remote-only. No live calls or production changes.

### L4.7 — read-only relational graph proof (L4 in progress)

- Added a complete synthetic captured/delivered journal produced by the actual
  isolated Python application. Python independently validates its full graph and
  canonical dataset digest. It includes attempted sends and permanent receipts;
  it is separate from the intentionally invalid format-only golden fixture.
- A bounded, storage-private reader rechecks immutable stage identity, routing
  epoch, trusted sentinel, generation ownership, stored bytes/hashes and derived
  index fields. It exposes only rows and packaged unique-key lookups, no SQL or
  database handles. Partial proof does not change a stage lifecycle or active data.
- Checks cover every logical table's CHECKs, primary/unique ordering and populated
  foreign keys, plus all three packaged historical insert proofs after loading.
  Unknown future insert invariants fail closed until explicitly implemented.
- Docker: 127 unit/contract cases passed. Missing-parent mutations cover all 33
  populated reference cohorts in the shared fixture, including composite keys.
  Python financial fixture/graph checks passed 54 tests. Five native reader cases
  passed per browser (145: 4.33s; 140: 28.62s), including invalid relationship/proof,
  poisoned derived index, stale epoch and active-generation protection.
- This is intentionally not a complete financial graph validator: raw record,
  capture, legacy and mirror semantics follow next. L4 and local mode stay incomplete.

### L4.8 — classified legacy/audit proof (L4 in progress)

- Added the actual stock legacy conversion fixture, independently accepted by
  Python's complete graph validator. The browser checks all packaged JSON columns,
  classified metadata, normalized schema audit and the exact known legacy objects.
- Reconstructs the original legacy SHA256 from ASCII-packed object headers and
  unchanged ordered row text, including empty-table counts. Primary-prefix reads
  remain bounded and generation/epoch fenced. Archived SQL is compared as data;
  no SQL execution or new migration authority is introduced.
- Docker: 130 unit/contract cases passed. Eight native relational/audit cases
  passed per browser (145: 9.58s; 140: 46.05s), including the genuine converted
  fingerprint and rejection of a rewritten row despite valid outer archive hashes.
  Python fixture/graph checks passed 55 tests in 3.62s. The final integer-tag length
  guard avoids unnecessary long-string allocation and passed the same unit cases.
- Raw bank/capture/mirror semantics, protected activation, cleanup, format-1
  conversion and independent L4 review remain. No local financial sends enabled.

### L4.9 — permanent send-history proof (L4 in progress)

- Added read-only validation of create-once payload identity, exact original
  attempt bytes, matching job authorization, quiescent source leases/delivery and
  permanent terminal receipt/link evidence. Comparisons retain complete payload
  equality rather than substituting a payload hash. Legacy journal exceptions
  stay explicit; validation never resumes delivery or changes a processing state.
- Docker: 133 unit/contract cases passed. Five focused native history cases passed
  per browser (145: 7.38s; 140: 29.49s), with eight earlier relational/audit cases
  deselected intentionally. Python independently rejects ten broken-history variants
  of the shared current fixture; its focused module passed 13 tests in 0.71s.
- Both current and genuine converted legacy journals pass this partial proof.
  Full raw bank/capture/mirror semantics and L4 lifecycle/interop/review remain;
  product behavior is still remote-only, with no new API writes enabled.

### L4.10 — exact mirror and legacy projection proof (L4 in progress)

- Added derived legacy bank/movement/category proof indexes after classified
  audit validation. Current mirror entities use the published SDK's entity keys;
  movement fields preserve exact Decimal text, flags, raw category order and
  positions. Legacy projections must match the same archived source and tags,
  including converted entities with no historical run ID.
- Verifies required mirror context/projections, tombstone identities and the
  declared owner set. This is archived identity consistency, not a fresh token
  check or owner adoption. Structured identifier values fail closed rather than
  inventing a Python representation for an unsupported API identity.
- Docker: 138 unit/contract cases passed. Six focused native mirror cases passed
  per browser (145: 8.50s; 140: 38.22s; 13 prior cases intentionally deselected).
  The Python fixture module passed 14 tests in 0.88s, including the same exact
  high-precision Decimal projection and rejection of altered category positions.
- L4 still needs raw bank revisions/capture proofs, protected activation and
  cleanup, full financial interop, format-1 conversion and independent review.
  Product remains remote-only; no live calls or production changes occurred.

### L4 bank wire/time prerequisite (L4 in progress)

- Ported the actual bank wire model's fields, code-point limits, defaults, exact
  amount strings and timestamp serialization. Aware comparisons use integer
  microseconds rather than Date's millisecond precision. Legacy Vietnam clock
  projection checks historical offsets and fold/gap behavior instead of assuming
  every old timestamp used UTC+7.
- Shared reference observations cover 111 real Python model outcomes, five aware
  timestamp pairs and 302 legacy clocks around every observed historical Vietnam
  offset change and calendar extremes. Python recomputes the fixed fixture.
- Docker: strict typing and 141 unit/contract cases passed. All 418 observations
  passed in one native case per browser (145: 2.34s; 140: 5.81s; three unrelated
  cases intentionally deselected). Python reference/financial checks: 15 passed
  in 0.94s. No API calls or production data were involved.
- Review caught a late legacy-kind guard that passed bundling but failed strict
  typing. Fixed it separately and made every Docker unit build run TypeScript
  checks as well; no claim of a passing earlier failing build is made.
- This prerequisite does not yet validate all raw-bank/capture graph relations.
  Full L4 lifecycle/interop/review and L5–L12 remain outstanding.

### L4.11 — bank raw/revision/frontier proof (L4 in progress)

- Added read-only current-record and complete revision-chain validation, canonical
  and historical aliases, exact currency/scale projections and contiguous coverage
  frontiers. Old bank projections must match classified original source rows,
  including their amount scale, beneficiary fields and historical timestamps.
- Equivalent aware timestamps compare by integer microseconds without rewriting
  either raw audit. A one-microsecond difference still fails. Missing revisions,
  processing state, aliases and changed current/legacy fields are rejected even
  when outer archive hashes are recomputed.
- Docker: strict typing and 145 unit/contract cases passed. Six focused native
  bank cases passed per browser (145: 8.43s; 140: 36.29s; 19 prior cases deselected).
  Python fixture/graph tests: 67 passed in 3.78s, including independent equivalent-
  offset acceptance and microsecond-mismatch rejection.
- Capture/page completeness proof and a combined graph validator remain next;
  lifecycle/cleanup, full interop, legacy conversion and independent L4 review
  are still required. No activation authority, live calls or product sends added.

### L4 nested JSON/resource correction

- A failing-before-fix browser regression found that rejecting a deeply nested
  JSON candidate could incorrectly downgrade it to an ordinary unchecked note.
  Only syntax/duplicate-key failures now use that fallback. Resource, Unicode
  and unsupported-decoder failures remain fatal; root-depth counting matches the
  Python graph convention, including a deepest empty container at depth 128.
- Extended actual-Python screening observations with eight boundary/nested cases.
  All 1,052 value observations pass in the native worker. A 5,000,001-element
  candidate also fails before parsed allocation in a 128 MiB Node child heap.
- Docker: strict typing and 147 unit/contract cases passed. Native screening
  passed on 145 (1.92s) and 140 (5.39s), with three other format cases deselected.
  Focused Python screening/resource/graph suite: 56 passed in 5.24s. Python's two
  allocation defects were fixed/tested in separate backend commits.
- No graph activation, local delivery, live API access or production change.

### L4 line-terminator contract coverage

- Extended independent reference observations for trailing LF/CR/Unicode line
  separators in integer, money, UUID, timestamp, hash, metadata and label fields.
  Existing runtime validators already reject these malformed lexical values;
  the new tests passed before any runtime change, so no corrective rewrite was made.
- Docker: strict typing and 153 unit/contract cases passed; all 2,642 actual SQLite
  CHECK outcomes and 1,132 Python value observations agree. Two focused Python
  vector-regeneration checks passed in 0.21s. No new product behavior or authority.

### L4.12 — complete archived financial facts proof (L4 in progress)

- Combined all 49 logical-table integrity/relationship checks with classified
  audit, raw bank revisions, capture/page/coverage, immutable send history and
  current/legacy mirror projections. Alternative read adapters also rehash every
  table against the manifest. Archived owner equality remains distinct from a
  separately expected owner; no graph result authorizes activation or API writes.
- Capture proof verifies request identity, stable job snapshots, terminal source
  states, canonical stored page bytes, complete page evidence, account/date/scale/
  detail scope and the exact captured revision. Recomputed outer archive hashes
  cannot substitute a missing proof. Complete intervals require actual empty-page
  evidence, not a zero-page claim; the corresponding source fix is separate.
- Reference Unicode data demonstrated that a valid 828,022-byte wire request has
  a 2,434,555-byte stored ASCII projection. Added a separate bounded persistence
  encoder; ordinary 2 MB DTO limits remain unchanged. The compact reference recipe
  recomputes its exact Python SHA256 without checking in the expanded payload.
- Docker: strict typing and 159 unit/contract cases passed. Eight complete-graph/
  persistence cases passed per browser (145: 10.70s; 140: 44.72s; 29 prior cases
  intentionally deselected). Python graph/resource/model/fixture checks: 74 passed
  in 5.28s. Equivalent dictionary ordering/offset spellings pass while changed
  captured values fail; an initial negative fixture was corrected to remove its
  dependent authorization so it tests capture evidence after FK consistency.
- L4 remains incomplete: persistent validated-stage lifecycle, protected generation
  activation/retirement, backup-aware cleanup, full financial interop/format-1
  conversion, 100k graph/boundary gates and independent review remain. Product
  continues to use the remote backend; no live calls or production changes.

### L4.13 — persistent inactive facts verdict (L4 in progress)

- Full graph validation now commits a versioned digest/timestamp and inactive
  `validated` lifecycle atomically. The active generation and API authority remain
  unchanged. Revalidation reads the entire proof again rather than trusting a
  cached verdict; modified bytes revoke the proof. Successful retries preserve
  the original verification timestamp.
- Native runtime schema 4 adds nullable proof fields without inventing results
  for version-3 imports. Malformed old stage metadata aborts the whole upgrade;
  the original version and bytes remain available.
- Docker: strict typing and 160 unit/contract cases passed. Nineteen native
  validation/kernel cases passed per browser (145: 44.07s; 140: 158.21s), including
  current/legacy restart, stale routing, missing marker, tampering after a verdict,
  failed upgrade, final-transaction quota rollback and worker death before commit.
  The first launch did not reach pytest because Xvfb was container PID 1; the
  corrected isolated runs use `--init`, and only completed runs count as evidence.
- Full-graph size benchmarks are still running and are not part of this result.
  Protected activation/export/retirement, backup-aware cleanup, full interop and
  independent L4 review remain before L5. No live requests or product sends added.

### L4.14 — backup-aware abandoned import collection (L4 in progress)

- Explicit discard revokes an inactive import writer without deleting data. A
  separate backup acknowledgment and 24-hour retention are required before a
  bounded 500-row collection batch. Restart resumes persisted partial cleanup;
  the final batch removes stage and dataset controls atomically.
- Active/held/armed/retired generations and pending switches are protected. This
  path does not collect handed-off history or permanent participant receipts and
  never resets the independent storage-loss sentinel.
- Docker: strict typing and 160 unit/contract cases passed. Seven final cleanup
  cases passed per browser (145: 10.73s; 140: 52.65s). A preceding combined run
  passed 12 cleanup/validation cases on 145. The first compile caught an invalid
  variadic transaction call; the corrected table-array call passes strict typing.
- Collection remains storage-private and is not scheduled by product handlers.
  Protected activation/export and financial interop/review gates remain open.

### L4.15 — complete financial graph size gates (L4 in progress)

- Added a separate synthetic benchmark preserving the complete current Python
  financial fixture and 1k/10k/100k correctly keyed merchant entities. It proves
  the full graph and persistent inactive verdict, not merely envelope integrity.
- Docker: all three sizes passed per browser (145 suite: 220.52s; 140: 401.23s).
  At 100k, both store 207,024,399 logical bytes. Import plus full validation takes
  186.70s/332.77s; largest transaction 722.2ms/110.8ms; cgroup peak
  1,121,820,672/1,268,957,184 bytes (145/140). Limits remain 3 GiB and 10s per
  native transaction. Active data, pointer and exact stored fields are unchanged.
- This does not establish performance for every bank-heavy graph or Chrome 155
  on the user's machine. No real account, API request or production state used.
  Remaining L4 authority/export, financial interop and review gates still apply.

### L4.16 — complete native/Python financial interoperability (L4 in progress)

- Added a facts-only inactive archive copier and an explicit offline integration
  runner: Python ZIP -> native MV3/IDB validation/copy -> isolated Python protocol-2
  installation -> SQL export -> native IDB -> Python comparison. All 49 tables
  and raw scalars are preserved except separately asserted runtime normalizations.
- Current, legacy and converted format-1 graphs take that path. The old format is
  restored by a compatible temporary backend, then exported as format 2; no browser
  SQLite engine or executable archived SQL is used. Synthetic owner verification
  and participant setup do not count as a live identity or browser handoff gate.
- Docker: strict typing and 160 unit/contract cases passed. Three native roundtrips
  per direction passed on 145 (5.41s/4.39s) and 140 (27.04s/21.64s); all three Python
  prepare/install/final verification phases passed. The initial format-1 oracle
  incorrectly expected the physical hold alias in a logical export; corrected
  the independent expectation, without changing runtime behavior or financial data.
- Full backend Docker gate: 759 tests passed in 38.15s plus HTTP/auth, actual fake
  SDK dispatch, SIGKILL/recovery, graceful shutdown and snapshot-restore checks.
  Shared contract copies still agree. No live account or production data involved.
- L4 still requires protected active-source export, generation activation and
  irreversible retirement, remaining boundary/crash gates and independent review.
  L5–L12 have not started, and distributed product handlers remain remote-only.

### L4.17 — participant receipt wire prerequisite (L4 in progress)

- Added the protocol-2 integrity preimage/receipt checker. It preserves explicit
  nulls, exact decimal-string epochs above 2^53, UTF-8 sorted keys, archive bounds
  and operation/peer bindings. Checked immutable messages do not authenticate a
  peer or grant activation; authenticated status and participant decisions remain
  separate. JavaScript-only sparse arrays/symbols/classes cannot enter a preimage.
- Shared fixtures contain 435 actual Python receipt-verification observations and
  15 canonical-byte outcomes, recomputed by the source implementation. Receipt
  field names also match the pinned HTTP schema. The archive producer's five-
  resource logical contract revision is unchanged by this additional test data.
- Docker: strict typing and 164 unit/contract cases passed. All 450 observations
  passed in one installed-worker case per browser (145: 2.23s; 140: 8.08s).
  Python vector/participant/HTTP checks: 53 passed in 2.24s.
- This is a prerequisite, not a durable participant implementation. L4 still needs
  protected active-source export, atomic generation activation/retirement, final
  crash/boundary gates and independent completion review. Local mode stays disabled.

### Independent interim L4 review

- A separate read-only reviewer inspected the persistent verdict/upgrade, safe
  cleanup, inactive copy/native interop and participant wire changes through
  `5edb32b`, with backend counterparts through `1aa0e4f`. No actionable findings
  were reported. See reviews/l4-checkpoint-2026-10-21.md for scope and limitations.
- This does not replace the independent completion gate: the durable participant,
  protected active-source export and atomic activation/retirement are still next.
  Their owner must support held and remote control contexts; ordinary local
  storage fences must continue to reject pending switches and inactive histories.

### L4.18 — durable participant and one transactional writer decision

- Physical schema 5 stores generation participants, immutable request/receipt and
  chunk journals, and mode switches beside the financial Root. Version-4 upgrade
  seeds only known unpublished idle states; unknown authority aborts the upgrade.
- Protected source export freezes a generation, checks quiescence, streams bounded
  chunks and proves the complete graph before sealing. Unsealed chunks cannot be
  downloaded. A restart rebuilds partial source chunks with a new private nonce.
- Destination reservation binds a fresh peer before source export. Upload ACKs
  follow immutable chunk commits. Full graph and fresh owner checks precede arm
  and activation; credential changes fence the result. Root, active participant,
  retired generation and exact permanent reply activate in one native transaction.
- Cancellation races source handoff through one CAS. Resume requires the peer's
  durable discard receipt and authenticated status. Handoff is irreversible;
  reverse transfer uses a fresh generation, retaining the old participant journal.
  Activation preserves all archived financial rows and blocks ordinary writers
  with awaiting-sync. L6/L7/L9 still own first-sync initialization and release.
- ADR 004 clarifies the immutable external loss-detection anchor. The original
  header survives retirement; Root selects the writer without rewriting another
  storage area's generation pointer. No remote outage can select retained data.
- Docker: strict typing and 168 unit/contract cases passed. The 22 dedicated native
  authority cases passed on Chromium 145 in 45.07s, including quota rollback, worker
  death before/after activation commit, lost replies, cancelled late imports,
  partial snapshot recovery, reverse generation, fresh owner at both checkpoints,
  nonquiescent history and failed version-5 upgrade. Wider final gates are pending.
- Independent read-only review found two issues (late importer deleting a discard
  header; download of unsealed chunks). Both were fixed with native regressions;
  the reviewer found no further actionable issue on the final implementation pass.
  Product handlers remain remote-only. No live request or production data used.

### L4.19 — actual native/SQLite participant exchange

- Added an explicit offline runner using an installed native MV3 profile persisted
  across phases and the real Python/SQLite participant/installer. Each direction
  exchanges seal/arm/handoff receipts, activates once and preserves awaiting-sync.
  All 49 tables are compared; Python-only normalizations are checked separately,
  and native activation must retain its sealed financial rows exactly.
- All seven runner phases passed on Chromium 145 and Chrome 140. The three native
  phases took 2.55/1.29/0.99s and 7.93/7.53/6.71s respectively. Browser restarts
  retain pending journals and peer bindings. Transport authentication and owner
  identity use private offline ports; this is not a live authenticated HTTP test.
- A focused native replay regression additionally confirms a changed request with
  an old request ID fails before another owner read (1 passed, 21 deselected, 7.05s).
  The final independent implementation review is recorded in
  reviews/l4-authority-2026-10-21.md. Wider final browser gates are still running.

### L4.20 — correct the historical upgrade fixture

- The broad Docker suite exposed an obsolete test-only v3 builder: it enumerated
  all current stores, including new authority tables absent from the old layout.
  It now enumerates the actual old layout and copies the corresponding current
  records. No runtime upgrade, financial invariant or authority check is relaxed.
- Before correction, the full Chromium 145 run passed 111 cases, including all
  large-dataset cases, and failed this one setup helper; four explicit offline
  interop cases were skipped because they require their separate runners. Both
  successful/failed v3-upgrade assertions remain, and independent review confirmed
  the fixture correction preserves their scope. Final regression runs follow.

## L4 — completion gate

Status: complete for storage, portable facts and private participant authority.
Independent review and the following isolated Docker gates passed. Distributed
handlers remain remote-only; L5–L12 have not started.

| Gate | Executed result |
|---|---|
| Strict TypeScript, generated schema and unit/contracts | 168 passed |
| Current product browser regression | 14 passed, 2 backend-integration modules intentionally skipped |
| Chromium 145 native regression after the historical-helper correction | 105 passed, 4 explicit interop cases skipped, 7 size cases deselected; 212.68s |
| Chrome 140 authority/storage/upgrade/cleanup/import regression after correction | 60 passed, 3 size cases deselected; 477.28s |
| Full-run size evidence on unchanged runtime code | All 7 current-browser size cases and all 6 minimum-browser import/graph size cases passed, including 100k; 3 GiB container and 10s transaction assertions held |
| Native/SQLite authority exchange | All seven phases passed per browser, including persisted profiles, both activation directions and exact receipt replay |
| Current/legacy/converted-format-1 financial roundtrip | 3 cases per direction per browser, all Python phases passed; 145: 10.87s/8.43s, 140: 36.12s/27.87s |
| Backend unit/integration/lifecycle | 760 passed in 50.30s; HTTP/auth, fake SDK, SIGKILL/recovery, graceful stop and restored snapshot passed |

The initial broad runs reported only the obsolete v3 fixture setup failure
(145: 111 passed/1 failed/4 explicit interop skips; 140: 65 passed/1 failed).
After correcting that helper, the non-size regression gates above reran it and
all other selected cases successfully. Size cases were not repeated because the
fix changes only old-schema test setup, not the runtime or size fixture. The four
ordinary-suite interop skips were executed by the two dedicated runners; no
unexecuted interop case is counted as passed. Current/minimum browsers are pinned
Docker Chromium 145 on Linux/arm64 and Chrome 140 on Linux/amd64, not the user's
Chrome 155. Parallel-run timings are not performance promises.

The independent reviewer found two implementation defects, both fixed before
`d79a148`, then found no further actionable issue in the complete authority code
or the separate historical-fixture correction. See
[the review record](reviews/l4-authority-2026-10-21.md).

Completed local commits: Chrome `d79a148` (authority), `3c362dd` (native/SQLite
exchange), `3d5ca16` (historical upgrade fixture); backend `7b21b43` (test runner
only). The final evidence commit records this gate. Working production services,
browser data, credentials and real accounts were not used or changed. No push,
tags or publication were performed.

Next is L5's unified application service and configured-remote control bootstrap.
L6/L7 must guard imported mirror/source initialization and L9 must implement
explicit awaiting-sync release. L10/L11 then connect authenticated transfer and
setup UI; L12 remains the installed-product acceptance gate. L4 alone does not
enable a local financial send or a mode-switch button.

## L5 — unified application service (in progress)

### L5.1 — named typed remote boundary

- Generated all named DTOs from pinned wire-v1.json, including nested definitions,
  with deterministic regeneration and conflicting-definition rejection. The Docker
  unit image checks generated types against the frozen source contract.
- Added the transport-independent application interface and a remote adapter for
  current connection/account/capture/report/archive operations. Only this adapter
  maps named operations to HTTP paths. Product handlers are not switched yet.
- Review checked every route, method, body, query order, identifier escaping,
  opaque archive handling and error propagation. The adapter neither mutates a
  command nor schedules an additional request. Docker typing/generated checks and
  170 unit/contract tests passed. Production and live accounts were not used.

### L5.2 — route existing handlers through named services

- Background, capture coordinator and archive UI now use the named application
  service. The only product construction of the HTTP transport is the remote
  runtime factory; API paths no longer occur in these handlers.
- Capture requests, command IDs, lease/ACK ordering, pause/resume and completion
  timestamps are unchanged. Existing coordinator tests run through the real remote
  adapter against their explicit fake transport. Background unit tests load its
  built bundle so TypeScript imports follow the production build path.
- Review checked every replaced request and the before/after body/query semantics;
  no extra HTTP request, automatic sync or financial action was introduced. Docker
  passed 170 unit/contract cases and 14 browser cases (2 backend-only modules
  intentionally skipped). Context fencing/bootstrap follows in the next point.
  Declaration files are omitted from distributable ZIPs.

### L5.3–L5.7 — authoritative context and remote compatibility

- Added one privileged Root resolver, remote upgrade bootstrap, validated scoped
  messages/replies, and a disabled local boundary. IDB version 6 adds only two
  nonportable control stores (59 native stores total); financial schema 1 and
  portable format 2 are unchanged. Remote bootstrap leaves all 49 financial
  stores empty and its anchor inactive. Missing storage never initializes a
  replacement and an unavailable configured server never selects local mode.
- Authoritative transient checkpoints now share a transaction owner with Root.
  Old Chrome keys are compatibility projections, imported once for an upgraded
  endpoint. Endpoint selection changes context; same-server credential repair
  preserves unknown request IDs and pending jobs. Nonsecret descriptors retain
  the context even if a credential key is lost. UI/report/archive replies reject
  stale context, including status polling after another popup changes endpoint.
- Manual review found and corrected credential readback property-order reliance,
  a cross-storage checkpoint race, missing-secret namespace loss and an old
  popup's silent adoption of another endpoint. No independent L5 reviewer is
  claimed. See application-service.md for API-v1 identity limitations and later
  protocol-2 work. No local financial transport or mode-switch UI is enabled.

Executed isolated Docker gates on the final runtime:

| Gate | Result |
| --- | --- |
| Strict types/generated checks/unit/domain contracts | 179 passed |
| Current product browser regression | 14 passed, 2 backend-only modules intentionally skipped |
| Current browser/backend/SDK integration | 30 passed, one existing dependency deprecation warning |
| Chromium 145 native application/authority/storage/kernel/validation | 50 passed in 92.09s |
| Chrome 140 application/authority/storage/validation | 40 passed in 296.42s |
| Built extension server-switch/HTTPS acceptance | Both copied and empty targets passed all 12 captures; initial/new creates 2/1, all repeats and target-first captures 0 |

Private logs: /tmp/zenimport-l5-scope-final.log,
/tmp/zenimport-l5-integration-final.log, /tmp/zenimport-l5-native-final.log,
/tmp/zenimport-l5-minimum.log and /tmp/zenimport-l5-legacy-migration-shared.log.
The server-switch helper initially searched a long-removed Settings wrapper and
assumed that visiting two unknown accounts establishes common-login membership.
It now uses the current peer sections and explicitly seeds the fixture's known
two-account membership through the authenticated discovery API. Expected write
counts and identity/ledger comparisons are unchanged; automatic profile
isolation is not relaxed. The final acceptance uses fresh synthetic data, a
private CA, real browser permissions/TLS and network-disabled Docker containers.

Status: L5 complete. L6 next implements private read-only SDK mirror and token
identity; L7–L12 remain pending. Production data/services and live accounts were
not used. No push, tag or publication.

## L6 — direct read-only mirror, identity and catalogs

Status: complete as a private read-only gate. No product local adapter or API
create transport is enabled. See local-mirror.md, ADR 005 and the independent
review in reviews/l6-mirror-2026-10-21.md.

- Implemented the published SDK gateway, exact raw full/diff projections,
  owner verification, trusted secret storage, epoch-fenced rotation/removal,
  drafts/candidate cleanup, catalogs, durable refresh lease and retry deadlines.
- Large projections use bounded unpublished construction and an atomic pointer
  publication. The first 100k atomic implementation exceeded the 10-second
  transaction budget (42.2s) and was rejected. The replacement passed the same
  asserted budget without relaxing the threshold. Old complete data and
  permanent evidence survive construction, interruption and collection.
- Inspection, ordinary sessions and held source export resolve the published
  view. Imported awaiting-sync participants may initialize only the read mirror;
  ordinary bank/delivery writes and participant release stay blocked.
- Specialist and adversarial findings were fixed, including large raw copies,
  old tag deletion, stale secret candidates, permission/fresh-cache handling,
  same-token full rebind and bounded prediction invalidation/collection. The
  final red-team recheck found no further confirmed defect in its correction.
- The real Python mirror revealed incorrect reminder flag checks in both archive
  validators. Backend commit `23ae6e9` corrects them with regression fixtures;
  Chrome uses the same rule. Legacy evidence interpretation is unchanged.

Executed isolated Docker gates:

| Gate | Result |
| --- | --- |
| Strict types/generated checks/unit/contracts | 183 passed |
| Product browser regression | 14 passed, 2 backend-only modules intentionally skipped |
| Native mirror/kernel/authority/application/storage/validation, Chromium 145 | 75 passed in 328.81s |
| Native mirror, Chrome 140 linux/amd64 | 25 passed in 453.31s |
| Actual Python mirror versus installed MV3 raw/projection/delete/full-reset parity | 1 passed, one existing dependency deprecation warning |
| Backend full suite after the flag correction | 762 passed, existing warnings only |

Native cases include 1k/10k/100k mirror updates, 100k derived predictions and
bounded collection, 10k old tags, both worker-stop boundaries, quota at data and
publication, restart-persisted 401/403/429/503 delays, late responses after token
rotation/removal, wrong owner, missing collection, source-held graph export and
the imported awaiting-sync write fence. The initial awaiting-sync fixture omitted
everActivated and correctly failed validation; fixing the fixture to represent a
real activated import passed without weakening the production invariant.

Logs: /tmp/zenimport-l6-final-native.log,
/tmp/zenimport-l6-final-minimum.log, /tmp/zenimport-l6-final-product.log,
/tmp/zenimport-l6-unit-last.log, /tmp/zenimport-l6-final-parity.log and
/tmp/zenimport-l6-backend-full.log. A final narrow prediction readiness guard
also reruns the 100k prediction case separately. The extra external CLI reviewer
could not start inside its sandbox and is not counted as a successful review;
the independent specialist/adversarial agents did complete.

L7 is next: local connection/account settings and complete bank capture. L8–L12
remain pending. No live account or production service was touched. No push, tag
or publication was performed.

## L7 — local accounts and bank capture (in progress)

### L7.1 and period-policy foundation

- Added a named local connection owner for discover/list/get/rename/unlink.
  Physical bank accounts use the same canonical identity as Python, while
  profile-scoped accounts remain separate. Complete absence, partial discovery,
  unsupported observations and unlink affect only the appropriate connection;
  historic membership and financial IDs are retained.
- Added strict frozen-contract setup validation, exact internal version text,
  Python-compatible name trimming and indexed private lookup/FK relations.
  Account operations share Root/epoch/participant/hold guards; imported
  awaiting-sync state still cannot trigger ordinary financial mutations.
- Ported the pure calendar coverage planner: contiguous frontier, 14-day overlap,
  forced periods, outstanding obligations, inclusive merging/chunking/subtraction.
  The installed browser agreed with the actual Python planner on 250 seeded
  gap/overlap/forced-range cases. Calendar-month presets remain in the existing
  shared date/UI path. Initial period precedence is unchanged.
- Independent API/domain review compared the new owner to accounts.py and
  capture.py and found no confirmed issue in this point. Docker strict types and
  186 unit/contracts passed; 13 native connection/kernel checks passed (3+10),
  plus the actual Python/browser planner parity test. Logs:
  /tmp/zenimport-l7-connections.log, /tmp/zenimport-l7-unit.log,
  /tmp/zenimport-l7-parity.log. A follow-up native run covers rollback after a
  valid first account and a conflicting later observation.

Not yet complete: L7 account settings/catalog proof, immutable capture jobs,
leases/pages/completion and complete captured-fact parity. The product remains
remote-only. L8–L12 remain pending; no release or publication is implied.

### L7.2 — account settings and bounded context invalidation

- Added optimistic/idempotent settings, current mirrored target/type/currency
  checks, exact version text, historical bindings and the unknown-delivery barrier
  even after temporarily ignoring an account. Complete bank coverage retains its
  identity; changing import_start recomputes its contiguous frontier.
- Only never-attempted prepared deliveries lose their old authorization and gain
  needs_rebuild. Attempted, uncertain, delivered and suppressed facts/payloads are
  preserved. The private repository performs no SDK or financial HTTP call.
- The 100k gate found a mistaken primary-key lookup, then exposed a 21.1-second
  atomic update. Fixed indexed bank-ID lookups and replaced that transaction with
  ADR 006's durable exclusive settings hold and at-most-500-row units. Export,
  migration and other writers cannot observe partial settings. An identical
  request or explicit startup recovery resumes the last committed unit.
- Independent API/red-team review found terminal-reply races and a MAX_INT64
  overflow that could strand the hold. Both are fixed and covered by native
  regressions; the final red-team pass reported no further confirmed issue.
- Current Chromium Docker: 22 native settings/connections/kernel cases passed in
  113.48s, including 100k prepared rows, quota, worker death, concurrent configure
  and recovery, and the unchanged per-transaction 10-second budget. Actual
  Python/browser account and 250-case period adapters: 2 passed (one existing
  dependency deprecation warning). Minimum-browser checks are recorded below
  after their completion. The previous failed stress runs are not counted as
  passed. See reviews/l7-settings-2026-10-21.md.

Minimum-browser gate: Chrome 140 Docker passed all 12 settings/connection cases
in 180.12s, including the same 100k stress/transaction budget and worker/quota/
concurrent-recovery cases. The final UUID-collision precondition reran all eight
non-size settings cases successfully. Strict typing and 186 unit/contracts also
passed. Logs: /tmp/zenimport-l7-settings-bounded.log,
/tmp/zenimport-l7-minimum.log, /tmp/zenimport-l7-settings-last.log,
/tmp/zenimport-l7-unit.log and /tmp/zenimport-l7-parity.log.

L7 remains in progress. The next point is durable local capture requests,
immutable account/plan snapshots, leases, pages and completion. Ordinary imported
awaiting-sync writes are still blocked; the later first-sync wiring must release
that fence explicitly. Local product routing and L8–L12 are not enabled.

### L7.3 — durable capture and existing connector acceptance

- Added normalized local start/status/lease/page/completion/pause/stop commands.
  Request IDs, immutable job context/account plans, physical-account locks and
  120-second lease epochs survive worker death. Repeated page ACKs return the
  stored receipt even after expiry; changed bodies/totals cannot advance coverage.
- Page facts/revisions/aliases and captured revision references commit before ACK.
  Explicit completion alone advances coverage/frontier and satisfies reimport
  obligations. Failure/cancellation retains already captured facts. Count-based
  completeness avoids materializing raw payloads for all pages.
- Added derived delivery state without financial API access. Capture can finish
  with no configured ZenMoney credential, while downstream delivery remains pending.
- Independent API and adversarial rechecks closed UUID normalization, state priority
  and reserved legacy-marker findings. Backend fix 40f89dd passed 766 Docker tests.
  See reviews/l7-capture-2026-10-21.md for the remaining large-view performance gate.
- Actual Python/native browser parity: 15 passed in 20.73s (one existing dependency
  warning), comprising the parity sequence plus the initial 14 capture regressions.
  The adapter compares all 18 capture/account tables across two observations.
- Current Chromium: the expanded 17 native capture checks passed in 35.61s before
  the connector fixture failed on a test-only dynamic service-worker import. The
  fixture now uses static imports; all four real driver/coordinator/local-IDB
  acceptance cases passed in 11.90s. No production worker behavior was changed.
- Strict typing/generated-schema checks and all 186 unit/contracts passed. Further
  minimum-browser and existing product regression results follow below.

Logs: /tmp/zenimport-l7-capture-parity.log, /tmp/zenimport-l7-capture-final.log,
/tmp/zenimport-l7-connector.log and /tmp/zenimport-l7-capture-unit.log. No live API,
production data/service changes, push, tags or publication.

Final L7 regression gates: minimum Chrome 140 passed all 21 capture/connector cases
in 160.16s. Current-browser settings/connections/kernel passed 22 cases in 123.72s,
including the unchanged 100k settings budget. Existing packaged popup/connector/
report browser suite passed 14 cases with two Python-only modules skipped in
90.41s; those modules run separately in the Python integration target. Logs:
/tmp/zenimport-l7-capture-minimum-final.log, /tmp/zenimport-l7-capture-regression.log,
/tmp/zenimport-l7-product.log. Full remote HTTP integration is recorded next.

Remote HTTP regression gate: all 14 actual backend/SQLite/SDK/browser integration
cases passed in 271.28s (one existing dependency warning), including both banks,
repeat import, lost ACK, worker termination, API outage, deletion and migration.
Log: /tmp/zenimport-l7-remote-integration.log. L7's captured-fact and connector exit
gates are complete. L8 begins next. The packaged product remains remote-only;
local first-sync activation, SDK delivery, switching and popup wiring await L9–L12.

## L8 — matching, category prediction and reports (in progress)

### L8.1 — pure financial matching and bounded report comparison

- Ported reference-first singles, exact account-side movements for all types/FX,
  deterministic multiplicity, shared-target restriction and independent transfer
  leg consumption. Split/net-settlement proposals need a unique exact proof and
  cannot reuse a globally owned group UUID.
- Added bounded 16-element/20,000-step searches. Exhaustion invalidates all earlier
  proposals for that day. The read-only comparison reports both missing bank and
  extra ZenMoney sides even when their daily totals balance.
- Independent API and adversarial reviews found no confirmed remaining issue.
  A proposed regex finding was disproved in Docker and withdrawn; it is not counted
  as a fixed production defect. See reviews/l8-domain-2026-10-21.md.
- Docker actual Python/native browser adapters passed two tests in 2.05s across
  500 subset/report and 200 reference/multiplicity/group vectors. Inputs use the
  frozen canonical plain decimal domain encoding without rounding financial values.
  Logs: /tmp/zenimport-l8-parity.log and /tmp/zenimport-l8-unit.log.

This is a domain checkpoint only. Ownership recovery, persisted reconciliation,
category evidence/prediction and report assembly still remain in L8. L9–L12 are
pending. No product local routing, live API call, push, tag or publication.
Final L8.1 Docker gate: strict types, generated contracts and all 195 unit/contract
checks passed, including discarding an earlier unique split when a later search
exhausts the same daily budget. No adapter or storage behavior was bypassed.

### L8.2 — historical target proof and late transfer recovery

- Ported durable original-target proof from immutable request/authorization history,
  known-side claims, late opposite-bank corroboration and affected account/day
  blocking. Current mapping or a mutable mobile field alone never creates a proof.
- Independent review fixed separate eligible/current entity sets for permanent
  tombstone reappearance and removed quadratic full-journal scans. Indexed peer
  and alternative counts retain ambiguity barriers. See reviews/l8-ownership-2026-10-21.md.
- Docker strict types and 200 unit/contracts passed, including linear traversal
  assertions. Actual Python capture/authorization fixtures plus native domain
  checks initially passed 13 tests in 11.77s (10 transfer scenarios, a 100k backfill
  and two previous algorithm adapters). The expanded final 100k recovery check
  and final independent recheck are recorded below after completion.

Logs: /tmp/zenimport-l8-ownership.log, /tmp/zenimport-l8-ownership-unit.log,
/tmp/zenimport-l8-ownership-final.log. This is still a pure policy checkpoint;
persisted reconciliation, prediction/report assembly and L9–L12 remain pending.
No production/live API use, push, tags or publication.
Final L8.2 gate: all 11 native/source tests passed in 11.43s (one existing dependency
warning). Both 100k backfill and 100k unresolved-owner scans stayed below their
individual 10-second worker-unit limits. Both final independent readers reported
no remaining finding. Durable browser application remains a later L8 point.

### L8.3 — reviewed category evidence and conservative confidence

- Ported current reviewed ordinary-payment evidence, independent payment ownership,
  one-payment split counting, exclusions, historical bindings, original numeric
  scale checks and chronological-pair exclusion. Unreviewed predictions do not
  teach the model until reviewed in the mobile application.
- Ported current valid category/direction checks, explicit manual/rule precedence,
  own-payment exclusion, conflicting-history blockers and the three-consistent-
  payments threshold. Unsupported Unicode cannot hide a known conflicting category
  or replace a stronger recipient identity. Both independent rechecks are clean;
  see reviews/l8-prediction-2026-10-21.md.
- Docker: strict types/generated contracts and 207 unit/contracts passed; actual
  Python/native browser comparison passed all 25 evidence/prediction cases in
  20.39s. Existing dependency deprecation warning only. Logs:
  /tmp/zenimport-l8-prediction-unit.log and /tmp/zenimport-l8-prediction-parity.log.
- The duplicate-tag source hypothesis was disproved by existing mirror validation;
  no backend change remains. Its final full Docker gate passed 766 tests in 36.01s
  (/tmp/zenimport-l8-backend-final.log). Initial invalid fixture setup attempted
  immutable receipt changes; corrected fixtures create those histories at birth.

L8 still needs revision-fenced repository snapshots/application, persisted derived
caches and complete-bank-coverage report assembly. L9–L12 remain pending. Local
product routing and financial SDK dispatch are disabled; no push/tags/publication.

### L8.4 — bounded revision-fenced source snapshots

- Added a generation-private mutation revision, atomic with every actual financial
  Session mutation. Immutable/FK checks precede no-op elision; all account-settings
  paths use the same hook. Corrupt, negative or exhausted counters fail closed.
- Added 500-row source pages, stable source/mirror/credential/participant stamps
  and exclusive revalidation before derived application. Derived caches do not
  mutate source revisions and cannot be read through the paged source API.
- Both independent storage/API and adversarial reviews reported no findings; see
  reviews/l8-snapshots-2026-10-21.md. This is a consistency foundation, not yet the
  reconciler/cache publisher or an enabled local financial writer.
- Docker: strict types/generated contracts +207 unit checks; 44 native regression
  cases in 140.66s including 100k account settings; expanded current-browser
  snapshots plus mirror regressions 36 passed in 234.97s; minimum Chrome 140
  snapshots 11 passed in 75.32s. Covers restart, competing commits, settings/new
  capture invalidation, quota rollback, rotation, bounded scans and corrupt/max
  counters. Logs: /tmp/zenimport-l8-snapshot-*.log.

Persisted reconciliation, cache publication and report assembly remain in L8;
L9–L12 remain pending. No live API/data, push, tags or publication.

### L8.5 — exact repository/domain source boundary

- Added a named bounded source reader over the revision-fenced 25 required tables.
  Every 500-row page and final result checks the same source/authority stamp.
- Added exact SDK/raw amount conversion, original-quantum learning flags, current
  and historical bank versions including legacy signed units, and separate
  tombstone-aware matching/training vs blocking transaction maps.
- Fixed decimal-zero category direction and falsey legacy-detail boundaries found
  during review; both independent final reviews are clean. See
  reviews/l8-source-facts-2026-10-21.md.
- Docker: 211 unit/contracts plus strict types/generated checks passed; 2 actual
  Python/native browser source checks passed in 2.78s. Logs:
  /tmp/zenimport-l8-facts-unit*.log, /tmp/zenimport-l8-facts-parity*.log.

L8 still needs persisted reconciliation/cache publication and report assembly.
This checkpoint does not enable local routing or a financial SDK writer. No live
API/data, push, tags or publication.
