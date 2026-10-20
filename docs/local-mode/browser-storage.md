# Native browser storage checkpoints

The extension's local financial mode is still disabled in product handlers.
L4 uses actual IndexedDB/Dexie with the 49 typed financial tables and independent
runtime/dataset/import control. Physical IDB version 3 is independent of financial
schema 1 and archive version 2. Versions 1/2 are unpublished development layouts.

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
No automatic garbage collection, activation or protected handoff is implemented
by this checkpoint; those remaining L4 gates must be completed before exposure.

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

ZIP DOS timestamps are stable across UTC, Vietnam and Hawaii timezones. Signed and
unsigned data descriptors are supported; their size, rather than an ambiguous CRC
value, determines whether the optional signature is present. Compression yields
outside database transactions so large inputs do not monopolize message handling.
Nested native quota/BulkError/AbortError outcomes are redacted to stable codes.
