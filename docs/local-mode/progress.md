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

L4 is next: native IndexedDB financial repositories and archive interop, with its
required independent review. L4–L12 are not yet implemented. Product synchronization
continues to use the remote backend; do not present standalone mode as ready.
