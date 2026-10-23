# Phase 2: standalone ZenImport with an optional backend

Date: 2026-10-20. Status: **COMPLETE — released as 0.3.0**.
Prepared using the office-hours design workflow, building on previously approved
product decisions. The user authorized sequential implementation with checks and
local commits on 2026-10-20. See [progress](progress.md) for completed work and gates.
Live financial scenarios and publication still require their own authorization.

## Outcome and confirmed decisions

A new installation can synchronize bank history directly with ZenMoney after the
user supplies a ZenMoney token and maps bank accounts. Financial history and the
processing journal live in that Chrome profile. A backend remains optional for
people who want one centralized dataset shared by several browsers.

The user has already chosen:

- Exactly one active mode: local browser or remote backend.
- Local mode by default for **new** installations. Existing configured extensions
  keep their current backend and jobs when upgraded.
- Moving to an empty destination can carry all data before activating it.
- Joining an already used server does not import or merge local history.
- Migration works in both directions. An old local copy is not current after
  remote use and must not silently become active again.
- Banks remain connector modules inside the extension. No injected product UI,
  stored bank passwords, bank keepalive, or automatic login.
- New transactions are expense/income according to the bank movement, with
  `viewed=false`. Categories are predicted conservatively; further editing happens
  in the official ZenMoney application.
- Existing ZenMoney edits and deletions remain authoritative.
- The separate Discrepancies page remains read-only and compares both unmatched
  sides independently of delivery success.

## Recommended engineering approach

Use **IndexedDB with a narrowly encapsulated Dexie adapter**, a TypeScript domain
engine inside this repository, and the published `zenmoney-typescript@0.1.0`.
Keep Python/SQLite on the server. Define a versioned, lossless portable archive and
shared business-behavior fixtures, extending the SDK's existing parity discipline.

The databases will have the **same logical financial model and guarantees**, not
the same physical file. SQLite triggers and foreign keys must be represented by
explicit repository operations, indexes, validation and adversarial tests in
IndexedDB. Merely copying table names does not reproduce their protection.

The user approved implementing this recommendation. L1 remains a feasibility gate;
a failed gate leads to a reviewed
ADR, not a silent reduction of guarantees.

### Alternatives considered

| Approach | Reuse and benefit | Cost / risk | Decision |
|---|---|---|---|
| Minimal: store JSON in `chrome.storage.local`, add direct SDK calls to background.js | Smallest first patch; current popup/coordinator remain recognizable | No multi-record financial transactions; weak invariant enforcement; large-history and crash recovery problems | Rejected for a financial journal |
| IndexedDB + internal TypeScript engine + portable logical archive | Native worker storage, transactional writes, stable browser APIs; retains Python server and existing connectors | Business logic must be ported with shared fixtures; DB constraints become explicit code | Recommended |
| SQLite/WASM with persistent browser VFS | Can reuse more SQL/schema and potentially a SQLite file | Worker/VFS/CSP requirements, locking and packaging need an additional proof; Python rules still need a port | Reserve if L1 proves IndexedDB unsuitable |

A new published domain-engine package, a backend rewrite into TypeScript, two-way
replication and simultaneous local/server writes are outside this phase.

## Read this plan in order

1. [Architecture and behavioral rules](architecture.md): runtime boundaries,
   exact numbers, mirror, matching, delivery, credentials and mode switching.
2. [Portable data contract](portable-data.md): all preserved state, archive format,
   import eligibility, staging, migrations and recovery.
3. [Implementation stages](implementation-plan.md): L0–L12 with dependencies,
   concrete outputs, tests, review gates and suggested commit messages.
4. [Acceptance matrix](acceptance.md): shared fixtures, real browser failure tests,
   server/browser migration and release criteria.
5. [Review record](review.md): independent design review and unresolved concerns.

The independent review completed in three rounds: six issues corrected, final
result PASS (9/10). This is a design assessment, not executed implementation tests.

## Current implementation baseline

Inspected source, not production data:

| Project | Baseline | Important entry points |
|---|---|---|
| ZenImportChrome | `ccf21c0`, released 0.2.1 | `extension/background.js`, `coordinator.js`, `backend-client.js`, `bank-profiles.js`, `popup*.js`, `discrepancies.js`, `connectors/` |
| ZenImportBackend | `618bf4f`, released 0.2.1, SQLite schema 7 | `backend/storage.py`, `schema_v2.sql`–`schema_v7.sql`, `accounts.py`, `capture*.py`, `records.py`, `mirror.py`, `existing.py`, `ownership.py`, `predictions.py`, `delivery.py`, `discrepancies.py`, `migration.py` |
| zenmoney-typescript | `5a6aa60`, npm/GitHub 0.1.0 | SDK client/builders, lossless codec, exact number types and fetch transport |

The Chrome build currently copies dependency-free JavaScript files. It needs a
deterministic bundle step before an npm dependency can be shipped. All extension
assets must remain local; no remote script loading is introduced.

The backend has 48 tables declared in its financial schema scripts plus
`service_meta`. Its existing archive is format 1: `manifest.json` and
`database.sqlite3`. Browser compatibility requires a new format; format 1 cannot be
called portable merely by renaming its file.

SDK 0.1.0 preserves exact values but deliberately does **not** implement application
arithmetic, storage, matching, durable delivery, deduplication or token persistence.
Those responsibilities belong to this phase.

## Decisions to validate during implementation

No further product interview is needed before L0. The following are explicit
technical gates, not assumptions disguised as completed work:

1. L1: direct **real test-account read** from the built MV3 extension, with the
   exact API host permission; synthetic browser tests do not prove this.
2. L1/L4: IndexedDB durability, quota handling, upgrades and large staged imports
   in the supported minimum Chrome and the pinned current test browser. L1 found
   Chrome 120 lacks required storage isolation; the selected candidate minimum is
   Chrome 140, documented in [ADR 002](adr-002-supported-chrome.md).
3. L2: behavioral parity with the Python backend, including SQL-enforced invariants.
4. L3/L10: old archives, resumable transfer and crash-safe activation.
5. L12: complete installed-extension acceptance with zero extra financial writes
   in the controlled retry/migration scenarios.

Live writes require an explicitly approved scenario on the verified test account.
Existing production tokens, bank sessions, SQLite volumes and live transactions
are not test fixtures. Reading source documentation does not authorize reading
private financial files.

## Definition of done

- A clean Chrome installation completes setup and synchronization with no backend.
- Server mode keeps its existing behavior and has no local financial writer.
- Every completed interval and confirmed/uncertain/deleted transaction survives
  worker shutdown, browser restart and bidirectional migration.
- Shared Python/TypeScript fixtures pass, including transfers when new banks appear.
- Both unmatched sides remain visible in Discrepancies while delivery is blocked.
- A failed mode switch leaves one safe, identifiable active or paused source;
  it never activates two writers or clears prior processing evidence.
- A local→server→browser roundtrip preserves financial identities and history;
  the next sync does not replay already attempted writes.
- Docker tests, minimum/current Chrome acceptance, artifact checks and final review
  pass. Real-bank/live-API evidence is reported separately.

## Limits to communicate accurately

Local operation continues after closing the popup while Chrome can run the
extension. Closing Chrome stops execution; persisted work resumes later.
Uninstalling the extension or removing the browser profile can remove its local
data. An archive is the recovery path, not Chrome account synchronization.

No system can guarantee zero duplicates for unrelated independently initialized
writers or ambiguous historical records without retained evidence. This phase
preserves the existing multiplicity-aware matching and create-once journal; it
does not invent a distributed lock across disconnected copies.

## Execution and distribution

Execute L0–L12 sequentially. Each completed stage has a review, Docker evidence,
an English progress entry and at least one local conventional commit. If a stage
changes both repositories, each repository gets its own reviewed commit.

Implement first; release versions are selected at L12, not assumed to be 0.2.2.
Likely a coordinated minor release is appropriate. Backend migration support must
be available before publishing an extension that offers cross-mode migration.
Distribution remains GitHub Release ZIP + checksums for Chrome and GHCR for the
backend. Chrome Web Store submission is a separate task.

Push, tags, GitHub Releases, npm publication and GHCR publication require fresh
explicit authorization for those projects/releases. The prior SDK release
permission does not authorize publishing this phase.

Execution starts at L0: pin the backend reference and enumerate business contracts
before modifying any financial runtime. Current evidence is in progress.md.
