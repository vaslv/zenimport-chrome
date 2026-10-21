# Local read-only ZenMoney mirror (L6)

This is a private implementation checkpoint. The distributed application still
selects the remote adapter. It does not expose a local sync or an API writer.

## Credentials and identity

The privileged reader uses the published `zenmoney-typescript` 0.1.0 client with
a 20-second timeout and a 32 MiB response limit. Only `readDiff` is reachable.
Permission is checked before and after the request and on a cached read.
SDK errors become stable, redacted codes; response bodies and tokens are not
included in errors or financial archives. The SDK client closes in `finally`.

A token is verified with a complete read before its owner set is adopted. A
different owner cannot replace an established financial dataset. The verified
secret is acknowledged in trusted Chrome storage before a Root compare-and-swap
selects its reference and advances the credential epoch. Root is authoritative;
a missing referenced secret is an error, never permission to reset the dataset.
Rotation/removal fences old responses. Removal preserves financial history,
unknown outcomes, participant state and the independent storage sentinel.

Unverified drafts live in trusted session storage for at most 24 hours. Failed
verification candidates are removed only after proving that Root does not select
them. Cleanup of an interrupted candidate fences a suspended adoption before
deleting the orphan. No secret is stored in the portable financial graph.

## Refresh and publication

A durable 60-second refresh lease gives one reader ownership. Freshness is at
most 300 seconds. Failure removes readiness while retaining the last complete
view. Retry deadlines survive worker restarts: auth/permission 30 seconds,
rate limiting 60 seconds, other failures exponential with a 300-second cap.
No request is sent before the stored deadline. A rebind requires a new full
mirror even when the token text is unchanged.

Original response text is retained in raw runs. IDs, cursors, exact decimals,
unknown fields, all movement kinds, both transfer legs and first-observed
tombstones are preserved. Missing required full collections, bad JSON, a cursor
regression or a failed response never imply deletion. Full absence does not
erase permanent deletion evidence.

Small incremental updates commit atomically. Large updates build an unpublished
physical projection in units of 500 rows (one raw run per unit), with Root,
credential, participant and lease checks on every unit. Only a final transaction
publishes the pointer together with cursor and freshness. See ADR 005. A crash,
quota error or lost reply leaves either the old complete view or the committed
new view. Reopening never publishes abandoned construction.

The six physical mirror tables are a closed FK subgraph. Native sessions,
inspection and held exports resolve the published scope under their transaction
guard. The logical dataset, bank facts and delivery UUIDs remain unchanged.
Inactive projections have a 24-hour collection delay; bounded collection first
checks retained audit/tombstone/raw-run evidence and never deletes a held view.

## Derived data and imported participants

Predictions are eligible only while the mirror is ready and their generation
and bank revision match. Clearing readiness or advancing the generation
invalidates them atomically. Stale rows may remain as portable derived facts
until a guarded collector scans at most 500 keys per transaction. This is a
physical difference from SQLite's immediate DELETE, not financial evidence or
permission to reuse an old category. A persisted GC cursor prevents large
histories from blocking token rotation or failure handling.

An imported participant awaiting explicit sync may initialize this read-only
mirror through a narrowly restricted transaction owner. It cannot mutate bank
or delivery facts or release the awaiting-sync fence. L9 owns explicit release
and financial sending. L8 owns receipt reconciliation, prediction learning and
report decisions; mirror parity alone does not claim those implementations.

## Archive compatibility correction

The real Python mirror projects `viewed` and `hold` on transaction, reminder and
reminderMarker rows. The old portable validators incorrectly required null for
the latter two despite preserving their original raw fields. L6 fixes both
validators and proves the graph with the actual Python mirror. Legacy archives
continue through their separate historical-evidence path. A formerly accepted
current graph that contradicts its raw fields is rejected rather than silently
rewritten. No published standalone browser producer used the old projection.

## Evidence scope

Private probes use installed MV3 workers, native IndexedDB, synthetic fetches,
fresh profiles and network-disabled Docker. They are excluded from the ZIP.
No production data or live account is used. The stage evidence and review record
are in progress.md and reviews/l6-mirror-2026-10-21.md.
