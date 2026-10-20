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

## Next stages

L2 shared behavior harness/exact arithmetic is next.
L2–L12 remain not started. Local financial synchronization remains inaccessible
in the product UI until the later safety gates pass.
