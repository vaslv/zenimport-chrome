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

## Next stages

L1 is next: bundled SDK/Dexie/browser storage feasibility. The user separately
approved one read-only installed-MV3 request to the verified test account. It is
not executed yet. L2–L12 remain not started.
