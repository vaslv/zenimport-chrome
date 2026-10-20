# Portable financial dataset, version 2

Status: proposed contract. Freeze the executable schema in L0–L3 before implementing
the second importer. This document does not describe an already supported format.

## 1. Compatibility goal

An export from Python/SQLite and an export from TypeScript/IndexedDB represent the
same financial history. Importing either into an eligible destination must preserve
all evidence that prevents another send. Storage engines, runtime credentials,
physical host identity and currently executing workers are not transferred.

Keep three versions independent:

- `archive_version`: ZIP layout, serialization, integrity and limits.
- `financial_schema_version`: logical entities, columns, keys and invariants.
- Runtime schema: SQLite migration number or IndexedDB version.

The current server schema is 7. Do not assign that number to IndexedDB or assume an
archive version implies a database version. Publish an explicit compatibility
matrix and pure, versioned logical transformations. A reader rejects unsupported
newer versions without changing active state.

## 2. Proposed archive

One downloaded file: `zenimport-data-<UTC timestamp>.zip`.

```text
manifest.json
tables/connections.ndjson
tables/connection_accounts.ndjson
...
tables/processing_targets.ndjson
tables/dataset_metadata.ndjson
```

Every table declared by the logical schema has exactly one file, including empty
tables. Unknown or duplicate files are errors. There are no scripts, executable
SQL, filesystem paths, tokens, cookies or environment files.

The manifest contains:

| Field | Meaning |
|---|---|
| `format` | Literal `zenimport-portable` |
| `archive_version` | Integer `2` |
| `financial_schema_version` | Version of the checked-in logical contract |
| `archive_id` | Random UUID for this immutable export |
| `created_at` | UTC ISO timestamp |
| `producer` | Product version, engine and contract revision; informational |
| `dataset_id` | Financial lineage UUID, preserved on migration |
| `export_session_id` | Reference to the source's durable export operation |
| `zenmoney_identity` | Canonical sorted owner IDs and identity-proof version |
| `tables` | Expected filenames, column order, row counts, uncompressed byte counts, SHA-256 |
| `dataset_digest` | SHA-256 of a canonical descriptor of schema, identity and table hashes |
| `required_features` | Required semantic features, e.g. target-side receipts |

A source may also report an installation ID as informational metadata, but it must
not become the destination's installation identity. Existing backend `instance_id`
travels with format-1 databases; it is **not** evidence that two endpoints are the
same physical server. Add a distinct runtime identity/capability as needed.

Define the digest byte preimage precisely in a checked-in contract: UTF-8, ordered
fields, normalized identity strings, filenames sorted by code point, LF, no BOM,
and no incidental producer timestamp/session ID in the financial dataset digest.
Hash raw table bytes; do not reserialize stored raw ZenMoney JSON for hashing.
Fixtures must give Python and TypeScript the same expected digests.

Table `rows` and `bytes` are bounded JSON integers, from 0 through 268,435,456,
matching the Python codec and golden descriptor. They are safe exact Numbers in
the browser. Protocol-2 HTTP counters are decimal strings; do not substitute that
transport convention into the archive manifest. Financial INTEGER scalars remain
tagged canonical decimal strings, including values larger than 2^53.

ZIP container bytes need not match between engines. Validate both:

1. Archive SHA-256 for file transfer, retry and user checksums.
2. Dataset digest for comparing logically identical snapshots.

Checksums detect corruption, not authenticity or authorization.

### Typed rows and exact numbers

Use arrays in declared column order. Each scalar has an explicit type:

```json
["text","125000.0001"]
["integer","9007199254740993"]
["null"]
["blob","AAEC"]
```

The snippets represent scalar encodings, not whole rows. A row is an array of such
scalars. Constrain tags by column schema; money columns accept exact decimal text,
not numeric JSON tokens. Integer strings have canonical syntax; timestamps remain
integer strings until explicitly range-checked for the UI. Text stays text even
when it looks numeric. SQL NULL, empty string and absent/invalid columns differ.
Booleans follow the logical column contract, not host-language truthiness.

Preserve raw JSON fields as **text** containing their original lossless wire
representation. Bank IDs and ZenMoney IDs use the existing semantic normalization,
not floating-point conversion. Do not serialize SDK classes, `bigint`, JavaScript
Date objects, `undefined` or NaN through ordinary JSON.

Export rows in the schema's documented primary-key tuple order with type-aware
comparison. Specify ordering for any legacy row without a primary key; preserve
its stored sequence. Detect duplicate keys before activation.

L0 must generate a field-level contract containing columns, nullability, primary
and unique keys, enum/check rules, foreign keys, invariant owner and import policy.
The group inventory below is not a substitute for that executable schema.

## 3. Complete preservation inventory

The baseline contains 48 financial-schema tables plus `service_meta`. Every table
must be assigned a disposition. No table may be ignored because the UI does not
currently use it.

| Baseline tables | Required behavior |
|---|---|
| `connections`, `connection_accounts`, `connection_discovery`, `connection_labels` | Preserve connection IDs, bank/profile anchors, memberships, observation evidence and user names |
| `bank_accounts`, `account_bindings` | Preserve canonical physical accounts, aliases/identity, enabled/ignored choices, target mapping, settings versions, start dates and historical bindings |
| `bank_transactions`, `bank_aliases`, `bank_versions` | Preserve source identity, exact amounts/directions, dates/timezone evidence, references, current revision and every captured version |
| `bank_processing`, `processing_receipts`, `processing_targets` | Preserve terminal states, permanent receipts and the actual matched account/transfer side; never infer a missing historical side from only today's binding |
| `capture_jobs`, `capture_intervals`, `capture_pages`, `coverage`, `captured_records`, `capture_errors` | Preserve completed/failed/cancelled capture audit, page digests, completeness evidence, revisions, range boundaries and errors |
| `job_requests`, `job_context`, `job_accounts`, `reimport_ranges` | Preserve request idempotency, immutable execution/account snapshots and historical period requests |
| `account_capture_locks` | No active lease may be exported; validate that there are no unresolved locks after quiescing. Record expired lease audit if needed, then omit executable leases |
| `zen_sync_runs`, `zen_entities`, `zen_movements`, `zen_tags`, `zen_deletions`, `zen_tombstones`, `zen_mirror_state` | Preserve raw history, projections, durable deletion evidence and cursor audit; require destination revalidation before financial writes |
| `link_groups`, `link_bank_members`, `link_zen_members` | Preserve single/split/settlement membership and uniqueness, including opposite sides of transfers |
| `deliveries`, `delivery_attempts`, `delivery_authorizations`, `delivery_schedule` | Preserve UUIDs, immutable payloads, first/previous attempts, authorization proofs, uncertainty, retry/verification state and deadlines |
| `bank_exclusions`, `zen_exclusions` | Preserve exclusions; no deleted or intentionally excluded record becomes a new candidate |
| `recipient_rules`, `category_choices`, `category_evidence`, `category_payments`, `category_predictions` | Preserve curated knowledge and provenance. Derived predictions are invalidated/recomputed when source generation changes |
| `legacy_imports`, `legacy_objects`, `legacy_rows` | Preserve inert audit data and typed values; never execute archived SQL |
| `schema_migrations` | Export source migration audit separately from destination runtime migration tracking. Never install source migration markers as if destination migrations ran |
| `service_meta` | Explicit allowlist into logical dataset metadata; exclude credentials, machine paths, locks and physical installation identity |

Do not discard failed jobs or ambiguous/uncertain attempts as "temporary data".
They can explain why a second create would be unsafe.

### Metadata classification

L0 inventories every current `service_meta` key and every planned local control
field. Unknown keys fail export validation until classified, rather than silently
leaking runtime data or losing evidence.

- Financial lineage, first-sync-started, import provenance, prior archive digests
  and irreversible processing facts are portable.
- Migration pause state is represented in export-session metadata and recreated as
  a destination hold; it is not an arbitrary string copied into active execution.
- Destination installation identity, active mode, active generation, worker
  leases, tab/document IDs, backend endpoint, bearer credentials and local API token
  are runtime-specific.
- Source token hashes are not credentials, but are context fingerprints, not owner
  identity. Retain their audit meaning without using them as the new credential's
  live authorization. Do not weaken immutable attempted authorizations to make a
  migration appear successful.
- Existing legacy operational timestamps/history remain audit data; expired locks
  are not recreated as ownership.

The contract must distinguish portable audit columns from destination state that
is reset. A normalization report enumerates resets and their reasons.

## 4. Export: make a stable, safe source

1. Validate token identity is known from a verified mirror. A dataset with no
   financial history may use a separately defined empty-configuration export.
   Never manufacture an owner ID from account titles.
2. Create a durable export session. Block new capture and delivery starts.
3. Finish or explicitly cancel incomplete capture; do not turn partial history
   into complete coverage. Preserve completed intervals and cancellation audit.
4. Let an already executing outbound request settle within its deadline. If its
   outcome is unknown, preserve the attempted UUID/payload as uncertain. The
   quiescence barrier must prove no request remains capable of issuing a new send.
5. Persist the source migration hold before enumerating financial rows. All
   writers check the hold and fence in the same transaction as their write claim.
6. Read a consistent dataset. For SQLite use its snapshot facility under the
   existing gates. For IndexedDB freeze financial writes and export bounded
   keyset chunks from the same generation; no one multi-minute transaction.
7. Validate row/relationship invariants and produce bounded files/hash state.
8. Persist the completed export descriptor and downloadable artifact reference.
   Closing the popup or stopping the worker does not lose its status.

A backup export may explicitly resume its source once the artifact is safely
available. A migration export remains held until the switch is completed or an
explicit safe cancellation authorizes resumption. Label these actions distinctly;
do not silently resume a source after an import has potentially become active.

No active capture tab lease is portable. Continuing a previously incomplete
capture after migration uses a new capture command and the preserved history
evidence, not an old browser document ID.

## 5. Import eligibility and identity

Destination eligibility mirrors the existing server contract:

- No prior started synchronization, bank transactions, deliveries, attempted
  writes, processing receipts or processing targets.
- Setup-only account/catalog metadata may be replaceable **only** under the
  documented pre-sync eligibility rule, never merged.
- No concurrent capture, delivery, mirror writer or other migration activation.
- Same archive can be retried idempotently while its initial imported hold is
  still in place. A different archive or a started destination is rejected.

An eligible browser target is a fresh staging generation. The old generation is
retained as a backup and is not merged. Activating a replacement requires the
explicit replacement flow described in [architecture.md](architecture.md).

Authenticate destination ZenMoney access and perform a read-only full identity
check. Compare canonical owner sets using the existing server convention. Define
joint/shared-budget changes as an explicit unsupported identity transition for
this release unless a separate fixture-backed policy is approved. Account display
names, token hashes and server URLs are not identities.

Account mismatch or unavailable identity check leaves the source held and the
destination unactivated. Tokens never travel inside an archive. A remote backend
keeps its server-side ZenMoney token; a browser asks for its own valid token.

## 6. Validate, stage, activate

1. Create/reuse an import session keyed by request UUID and archive SHA-256.
2. Bound upload/download bytes before allocation. Allow only expected ZIP methods
   and filenames; reject encrypted entries, duplicate entries, path traversal,
   symlinks, malformed UTF-8, zip bombs and invalid CRC/hash/length/count metadata.
3. Stream/decompress through bounded processing, then validate typed records into
   isolated staging storage. Count actual emitted bytes and rows; don't trust the
   central directory. Limit manifest size, row bytes and table counts explicitly.
4. Validate keys, all foreign keys and immutable state relationships. For example:
   a terminal processing receipt cannot reference a missing bank record; an
   attempted delivery must retain its UUID, payload and authorization; a claimed
   complete interval must have its supporting capture evidence.
5. Apply only declared logical schema migrations to staging. Validate again.
6. Verify the destination owner set and source dataset digest, recording both.
7. Initialize destination runtime metadata: new installation identity/lease
   epoch, preserved dataset lineage, paused delivery, inactive staged generation.
8. Reset mirror readiness and require a fresh full refresh. Preserve old raw
   mirror and tombstones for audit; never interpret a fresh cursor as permission
   to forget old deletions. Invalidate derived predictions.
9. Rebind only allowed unattempted authorization contexts, following server rules.
   Attempted immutable payload/auth records remain immutable; their verification
   uses the separately validated same-dataset credential context.
10. Complete an import receipt containing archive and dataset digest, owner set,
    schema, counts, staging generation and normalized metadata report.
11. For live migration, the mode-switch coordinator verifies that receipt, arms the destination,
    durably hands off the source and only then commits destination selection and
    activation. Follow the participant protocol in architecture.md §10. Import
    completion alone never starts synchronization or grants write authority.

For archive-only disaster recovery, use the distinct restore flow in
architecture.md §10: eligible target, explicit former-writer retirement declaration,
new recovery operation, full identity/mirror check and read-only reconciliation
before deliberate activation. It does not pretend to obtain a handoff receipt
from a destroyed source. Imported receipts, uncertainty and tombstones retain
their exact meaning; recovery does not recreate evidence newer than the snapshot.

For the browser, activation is one short IndexedDB transaction changing the
active generation and mode operation state. Keep router configuration in that
same control database; `chrome.storage` is not a second source of truth.
Credentials are stored before activation and referenced by ID; orphaned staged
credentials can be cleaned safely. On startup, validate the reference before use.

For the server, use staged validation and an atomic installation mechanism
consistent with the current SQLite import. Upgrade the migration gates instead
of replacing them with an unprotected file copy. Never swap a live SQLite file
under open writers. The global migration hold applies to all connected browsers.

Incomplete staging is recoverable or safely removable; it must not be selected
as active on startup. Cleanup after activation cannot undo the activation.

## 7. Large artifacts and worker lifetime

The existing popup sends a single archive request. That cannot be assumed to work
for an entire browser database or survive popup closure.

Implement a durable migration service with:

- Operation creation, status, bounded chunks, commit/verify, arm, source handoff,
  activate, source cancellation decision, discard and pre-handoff source resume.
  Source `cancel_pending` versus `handed_off` is the authoritative CAS decision;
  destination discard requires the former's receipt. Each transition binds switch
  ID, participant epoch and digest. L3 freezes actual routes/DTOs and tests that
  legacy `/jobs` and `/migration/resume` cannot bypass format-2 holds.
- Request UUID + archive digest + chunk index/hash; duplicate identical chunks
  accepted, different bytes for the same index rejected.
- Status survives browser/worker/network restart. A lost success response causes
  a status query, not another destructive import.
- Bounded chunk payloads suitable for Chrome's JSON messaging. Do not send a Blob,
  ArrayBuffer, `bigint` or an entire ZIP through `runtime.sendMessage` and assume
  structured-clone behavior.
- For user file selection/download, extension-page code handles the file surface;
  background owns validation, journal and activation. Closing the page can pause
  transfer; completed chunks remain safe and an explicit resume can reselect the
  same file after digest verification.
- A bounded extension page can orchestrate heavy ZIP work without a new permanent
  product page. If offscreen processing is proposed, justify its Chrome API reason,
  permission and crash model at L1; it is not an assumed keepalive mechanism.
- Server routes authorize every chunk/status operation with the existing backend
  credential. Operation IDs are not secrets or authentication.
- TTL cleanup only for abandoned, inactive staging. Never expire the only
  migration receipt or source pause marker needed to resolve a lost acknowledgment.

Start with current server limits: 64 MiB compressed and 256 MiB uncompressed
dataset. Define how NDJSON overhead compares with the format-1 SQLite limit and
use the smaller negotiated destination limit. These are compatibility starting
points, not measured browser performance claims. L1/L4/L12 must validate memory,
time and quota with boundary fixtures before finalizing limits.

If the free space cannot hold old generation + staging + validation overhead,
fail before activation. `unlimitedStorage` reduces browser quota restrictions; it
does not create disk space. Do not delete the active dataset to make an import fit.

## 8. Format 1 and rolling deployment

The released 0.2.1 archive is a SQLite file in ZIP. Preserve backend import support
for it. A browser without SQLite must **not** advertise direct format-1 import.

Supported migration path for an old archive:

1. Restore it using an upgraded compatible backend into an eligible destination.
2. Validate/full-refresh as required by the current migration contract.
3. Export portable format 2.
4. Import format 2 into the browser.

This conversion can be offered by the backend migration service against isolated
staging without activating restored data, if L3 implements/tests that path.
Otherwise document the explicit temporary-backend procedure. Do not promise an
unimplemented convenience conversion.

Capability negotiation reports archive versions, logical schema range, limits,
chunk/status support and whether activation/resume is protected. Existing 0.2.1
backends can continue ordinary server-mode synchronization through the existing
remote adapter; incompatible cross-mode migration is disabled with an upgrade
message. Do not raise the ordinary API protocol minimum just to hide migration.

| Extension situation / transition | Backend 0.2.1 | Backend with format-2 handoff and identity capabilities |
|---|---|---|
| Upgrade while already configured in remote mode | Continue ordinary sync/reporting and same-endpoint token correction | Continue |
| Existing remote configuration is temporarily offline | Stay remote and show unavailability | Stay remote and show unavailability |
| Local history → empty remote target | Upgrade required; cannot transfer through format1 implicitly | Full migration with protected handoff |
| Local mode → used server | Upgrade required for verified owner/dataset/runtime identity; no merge fallback | Join after verification and local quiescence, without importing |
| Remote history → browser | Upgrade source first | Current quiescent export and full handoff |
| User changes to a different endpoint | Treat as a new destination, not a token correction; new transition requires capabilities | Apply the matching empty/used-destination transition |
| Restore an old format1 backup | Existing restore behavior remains on compatible backend | Restore/convert through the documented format1 compatibility path |

For new mode transitions require the new identity capabilities even when the local
dataset is empty; do not guess ownership from account titles or silently downgrade
the protocol. This does not prevent an already configured legacy remote installation
from continuing normal operation. Existing `/info` readiness and account catalogs
do not constitute the full new identity/activation contract.

Deploy the backend capability first, then the extension. Retain a known restore
procedure and test the new backend with the released extension before publishing.

## 9. Required roundtrips

- SQLite → format 2 → IndexedDB → format 2 → fresh SQLite.
- IndexedDB → format 2 → fresh SQLite → format 2 → fresh IndexedDB.
- Format 1 → compatible backend → format 2 → IndexedDB.
- Interrupted transfer/import/activation → restart → same import receipt.
- Imported uncertain operation → fresh mirror → verify original UUID → no new UUID.
- Imported deletion/transfer-target receipt → new bank evidence → no resurrection.
- Backup file only after profile loss → explicit disaster-recovery restore →
  owner/mirror/reconciliation checks → deliberate activation, with snapshot limits.

Compare portable financial state and explicitly declared normalizations, then run
another capture/mirror/reconciliation/delivery cycle against the fake ZenMoney
service. Equal row counts or equal balances alone are insufficient.

See [acceptance.md](acceptance.md) for the complete scenario matrix.
