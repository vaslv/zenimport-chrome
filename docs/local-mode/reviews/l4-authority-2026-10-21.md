# Independent L4 authority review — 2026-10-21

Status: final implementation review; execution evidence is recorded separately
in progress.md. This is not permission to enable local product mode or publish.

An independent read-only reviewer inspected the new generation participant,
speculative transition reducer, immutable recovery anchor, import permits, held
source reader and MigrationOwner, plus version-5 upgrade and changes to financial
repository fences, staging, graph proof, cleanup and native/SQLite exchange tests.
The implementation is committed as `d79a148`; the exchange runner is an additional
test-only change. Backend runtime logic is unchanged.

Two actionable issues were found and resolved before the implementation commit:

1. A stale importer could delete a newly discarded stage header after its last
   row-cleanup batch. Every erasure now rechecks Root epoch, pending switch,
   participant, hold and import nonce in the same transaction. A paused-loader
   native regression cancels the transfer and verifies the discard header survives.
2. Download exposed source chunks before the snapshot was sealed. Public download
   now requires a sealed source operation, while internal archive assembly uses a
   separate private reader. A native regression stops the worker after a committed
   chunk, rejects download, restarts and completes a new verified snapshot.

The reviewer rechecked both fixes and the complete final authority change, finding
no further actionable defect. The review covered atomic Root/participant/receipt
decisions, cancellation versus irreversible handoff, late callbacks, snapshot and
import nonces, protection of the anchor and permanent journal from cleanup, fresh
owner/credential CAS, awaiting-sync guards, version-5 rollback and the interop runner.
The reviewer did not run Docker, access an API or inspect production data.

Explicit boundaries of this L4 result:

- L5 must bootstrap control for existing remote users without IDB; an unavailable
  remote service must never create a local writer automatically.
- L6/L7 must initialize imported mirror/source bindings through a guarded path
  before use, preserving the sealed rows as audit evidence.
- L9 must define explicit sync release from awaiting-sync; no L4 method clears it.
- L10/L11 must wire authenticated migration and setup UI through the application
  service. Private owner ports and offline fixture identity are not live transport
  or SDK identity acceptance evidence.
- Distributed handlers remain remote-only. Existing Python normalization versus
  deferred native first-sync initialization is deliberate, fenced and documented
  in ADR 004; it must be completed before exposing local synchronization.
