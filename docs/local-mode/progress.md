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
