# L8 category cache publication review — 2026-10-21

Two independent read-only reviewers examined the raw-source category adapter,
private cache publication, source-stamp refactor and native regression tests.
Both final rechecks returned NO FINDINGS. The external cross-model reviewer
remains unavailable; no result from that tool is claimed.

The cache marker is private and never portable authority. Readers require a ready
marker for exactly the current credential, generation, participant, mirror and
financial revision. A build first makes the cache unreadable, then clears/writes
at most 200 rows per native unit. Publication checks final counts atomically.
Every unit checks both the source stamp and unique builder ID. Concurrent source
changes or a superseding builder prevent the old worker from writing/publishing.
Interrupted or quota-aborted builds remain unreadable and rebuild from source.

Only the prepared, never-attempted delivery needs_rebuild flag can change as a
side effect. It is committed atomically with the changed prediction and updated
source/build stamp. UUIDs, attempted payloads and authorization remain intact.
The flag is not a learning/model input. Real named capture/mirror/reconciliation
fixtures exercise this path; direct 100k-row seeds prove volume bounds only.

The raw-row category plan matches actual Python predictions.prepare across 25
scenarios, independently of the older manually normalized domain comparison.
Native tests cover reviewed-only learning, conflicting categories, unchanged
source reuse, preserved prepared UUID/payload, quota rollback, real worker death,
source/builder races and 100k pending rows. Partial derived rows are not readable.

The private control validates actor UUID shape, state, exact keys and bounded
counts. One build supports up to 1m rows per derived table. Imported ownership
Cartesian expansion retains the earlier explicit 1m-pair resource guard.

Final Docker results and logs are recorded in ../progress.md. No live data/API,
financial SDK writes, product local routing, push, tags or publication.
