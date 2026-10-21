# Native browser storage checkpoints

The extension's local financial mode is still disabled in product handlers.
L4 uses actual IndexedDB/Dexie with the 49 typed financial tables and independent
runtime/dataset/import control. Physical IDB version 7 is independent of financial
schema 1 and archive version 2. Versions 1–5 are unpublished development layouts.
Version 6 adds two nonportable application-control stores for scoped transient
state and nonsecret remote context descriptors; financial/archive schemas do not
change. Version 7 adds a private bounded backup-chunk store (60 native stores
in total); backup data is never included as another portable financial table.
See [the application boundary](application-service.md).

## Inactive format staging

`LocalDatabase.stageArchive` reads a bounded immutable Blob into a fresh generation.
Each stage has a private writer identity, profile installation/routing epoch and a
durable manifest/progress journal. Native uniqueness and packaged CHECKs apply
during loading; cross-table/financial graph checks are deliberately deferred to
the complete generation. Declared owners are archive claims, not fresh token
verification. Neither `format_valid` nor an archive checksum grants activation.

Loading commits at most 500 rows or roughly 1 MiB per batch (a single allowed
large row can exceed the ordinary batch threshold). Every batch verifies the
independent trusted sentinel outside IDB, then checks routing, stage ownership and
inactive lifecycle inside its native transaction. External API/timer work never
runs inside those transactions. The persistent committed rows are scanned again
for canonical order, counts and hashes before recording `format_valid`.

The active pointer and its financial rows are untouched. A quota/hash/fence error
leaves a failed or still-loading inactive generation. Killing the worker leaves a
durable loading journal; reopening never promotes it or silently initializes a
replacement active history. A retry creates a separate inactive stage. Financial
application handlers have no native database handles or arbitrary mutation API.
Activation and protected handoff are separate from format staging and
must be completed before product exposure.

## Persistent facts-only validation

`LocalDatabase.validateStageGraph` reruns the full archived financial proof and
atomically records its version, dataset digest and verification timestamp with
the inactive dataset's `validated` lifecycle. It never changes the active pointer,
obtains a fresh token-owner proof or grants permission to send. A retry always
rechecks persisted bytes and financial relationships; it preserves the original
timestamp only if the proof still succeeds. A semantic/hash failure clears the
verdict and marks the inactive import failed.

Runtime version 4 adds explicit nullable proof fields to version-3 stage journals.
The upgrade does not infer validation from an old format/hash result. A malformed
old journal aborts the entire version change, preserving version 3 and its bytes.
Worker death before the final commit retains the original format-valid stage;
a quota failure inside that commit rolls back both lifecycle and verdict. Stale
routing or an unavailable sentinel cannot persist a new verdict. No result is
an activation shortcut; protected handoff and fresh ownership remain separate.

## Abandoned import cleanup

Cleanup applies only to an explicitly discarded, never-active stage. Discarding
revokes its loading/validation writer before any deletion; it does not imply a
backup. A separate trusted user acknowledgment records that the original source
or backup is retained. Collection waits at least 24 hours after both creation and
that acknowledgment, then removes at most 500 financial rows per transaction.
The next invocation resumes from persisted rows; the stage and dataset controls
disappear atomically with the final batch. Retrying an acknowledgment preserves
its original timestamp.

Every operation checks the current routing fence and sentinel. Active, held,
armed, retired and pending-switch data are excluded. This does not collect old
handed-off generations or permanent participant receipts. A missing sentinel is
never repaired or cleared by cleanup, even after all abandoned imports are gone.
No background collector or UI invokes these private operations yet.

## Offline financial interoperability

`sh scripts/test-financial-interop.sh ../ZenImportBackend` runs Python archives
through actual installed MV3/IndexedDB staging, full validation and a read-only
inactive copy. Python verifies every raw logical scalar, installs that archive
in a separate synthetic protocol-2 destination, re-exports its SQL projections
and sends them through the native browser again. Current and legacy graphs and
format-1 conversion all take this path. Use `INTEROP_BROWSER=chrome140` for the
minimum-browser image. All containers disable network and use private scratch.

Format 1 is restored by a compatible temporary backend using its existing owner
verification/restore path and exported as format 2. The browser does not load or
execute SQLite or archived SQL. Tests compare exact financial facts and explicitly
enumerate mirror rebinding, prediction invalidation, fresh unattempted source
context and appended import provenance. Physical migration-hold audit aliases
project back to their original logical key; this does not resume the old hold.

`copyInactiveStage` only re-exports a fully checked immutable inactive generation.
Its newly generated archive/session IDs do not authorize a source handoff. The
test bridge and synthetic owner/participant setup are not product handlers or
proof of live identity. Protected export and activation are checked separately
through the participant owner described below; local product mode stays disabled.

## Protected participant owner

`MigrationOwner` opens existing anchored control state, including held or remote
Root states. It never creates an empty local replacement after storage loss or
an unreachable remote server. IDB version 5 upgrades only known idle version-4
development datasets; unknown participant holds abort without inventing authority.
See [ADR 003](adr-003-generation-participants.md) and
[ADR 004](adr-004-immutable-recovery-anchor.md).

The destination reserves its fresh generation and participant before source start.
Reservation pauses ordinary claims through Root's pending switch and routing
epoch. The source enters export hold before reading any financial table. The
bounded reader rejects active captures, live capture leases and attempting sends;
it projects only declared nonportable worker/schema-audit fields. Export streams
256 KiB chunks with immutable hashes and a stable archive/session identity. A
partial source snapshot is private and not downloadable. Restart uses a new nonce
and rebuilds partial chunks before proving and sealing the full financial graph.

The destination commits each exact chunk before ACK. Replaying the same bytes is
safe; changing a committed chunk fails. Its import permit binds the inactive
generation, switch, participant, routing epoch and durable writer nonce. Every
batch, including partial-row cleanup and final header cleanup, repeats those
checks. Cancellation revokes late importers without deleting its discard evidence.

Arm and activation each rerun the financial graph proof and independently call
the privileged fresh-owner port. The final transaction checks the credential
reference/epoch again. Peer receipts require authenticated peer status in addition
to canonical integrity hashes. `MigrationPorts` is a trusted host boundary; bank
messages cannot supply their own peer authentication or owner verdict.

Source cancellation and handoff compete through one CAS. Cancellation requires a
verified durable destination-discard receipt before source resume. If handoff wins,
source resume is permanently forbidden. Unknown outcomes keep the pending state.
Replaying an identical request returns its immutable receipt before current epoch
checks; a changed request under that ID is rejected.

Activation atomically selects the validated generation, retires the old local
generation, consumes the stage into retained `activated` proof and commits the
participant and reply. Quota failure or worker death before commit changes none
of them. Death after commit loses only the reply. Selecting remote never revives
the retained source; returning from remote reserves a new local generation.

L4 activation preserves the exact imported financial rows. Ordinary repositories
remain blocked by `awaitingSync`; L4 exposes no way to clear it. L6/L7 must perform
guarded mirror/context initialization and L9 must add explicit sync release. L5
still owns first control bootstrap for existing configured remote users without
IDB. UI routing and the end-to-end authenticated migration workflow belong to
L5/L10, so the distributed extension still operates only through its backend.

`sh scripts/test-authority-interop.sh ../ZenImportBackend` runs actual native IDB
and SQLite transitions across persisted browser restarts in both directions.
`INTEROP_BROWSER=chrome140` selects the supported minimum. Tests compare all 49
tables, including exact attempt payloads, tombstones and target receipts. Python
destination normalizations are independently enumerated; the native destination
must preserve the sealed rows exactly. Peer-status and owner ports are offline
fixtures, not evidence of live authenticated HTTP or SDK identity verification.

## Evidence

Docker native tests import the format-only golden fixture and explicitly reject
using its stage as the financial writer. They cover profile restart, stale routing,
bad table hash, an injected native quota failure, retry on the same handle, actual
worker termination during loading and loss of the independent marker mid-import.
The latter must stop loading and require recovery, even while IDB remains present.

The 1k/10k/100k envelope benchmark uses synthetic records and is not claimed as a
financial graph or live API acceptance test. At 100k it stores 206,600,234 logical
bytes. Chromium 145 completed the import/re-read in 46.73s with a 149ms maximum
native transaction and 1,286,221,824-byte cgroup peak. Chrome 140 completed it in
75.90s with an 85.7ms maximum transaction and 1,271,791,616-byte peak. Both run in
network-disabled containers limited to 3 GiB. Timings include synthetic ZIP
creation and are not a deployment performance promise. Evidence JSON records the
actual browser user agent and retains exact byte counts.

The separate complete-graph benchmark preserves the full current Python fixture
and adds 1k/10k/100k correctly identified merchant entities. It imports, rehashes,
validates all financial relationships and persists an inactive verdict. At 100k
the graph is 207,024,399 logical bytes: 145 took 186.70s (140.33s graph validation),
722.2ms maximum native transaction, 1,121,820,672-byte cgroup peak; 140 took 332.77s
(277.88s validation), 110.8ms maximum transaction, 1,268,957,184-byte peak. Each
browser's full 1k/10k/100k run passed within its 3 GiB container. These are
synthetic merchant-heavy graphs, not proof of every possible 100k bank-history
shape or live-bank throughput. Worker startup/teardown increases suite wall time.

ZIP DOS timestamps are stable across UTC, Vietnam and Hawaii timezones. Signed and
unsigned data descriptors are supported; their size, rather than an ambiguous CRC
value, determines whether the optional signature is present. Compression yields
outside database transactions so large inputs do not monopolize message handling.
Nested native quota/BulkError/AbortError outcomes are redacted to stable codes.
