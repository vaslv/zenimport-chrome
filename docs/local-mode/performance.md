# Local source read budget

The worker keeps at most one disposable source projection per physical database
and installation. Every use still takes and checks a fresh native financial
snapshot. Committed row deltas may update the projection only when its complete
previous snapshot matches. Aborts publish nothing. Unknown revisions, changed
credentials/authority, restarted workers and exceeded budgets fall back to cold
native reads. Mirror staging is invisible until its final publication; hard
deletions and first-observed tombstones retain their native semantics.

The cache limits are 2,000,000 rows and 256 MiB of estimated JSON text storage,
not a guarantee of total V8 heap usage. A commit may carry at most 10,000 changes
and 8 MiB of estimated delta text. Oversized mirror responses are rejected before
iterating their entities in the final write transaction. The cache is neither
portable evidence nor permission to dispatch. Native dispatch/Root checks remain
mandatory. Settings mutations without a delta receipt safely cause a cold read.

A successful create response containing every attempted UUID permits the ordinary
incremental read. Missing UUIDs, unsuccessful exchanges and uncertain attempts
still request the transaction collection. None of these checks permits a second
create for an attempted UUID.

## Docker measurements (2026-10-23)

Native MV3/IndexedDB, synthetic SDK and banks, network disabled, 3 GiB container
limit. Each retained-history case sends **41 new transactions in three actual
bounded cycles**, not 100,000 new transactions. Counts include the two local
processing-status scans; warm source reads do not rescan the 29 source tables.

| Retained transactions | Cold rows read | Cold read + cache | Three cycle times | Rows read per cycle | Longest native transaction |
|---|---:|---:|---|---:|---:|
| 1,000 | 1,218 | 72 ms | 0.97 / 0.97 / 0.67 s | 82 | 70 ms |
| 10,000 | 10,218 | 320 ms | 2.66 / 2.58 / 2.27 s | 82 | 233 ms |
| 100,000 | 100,218 | 3.34 s | 15.89 / 16.13 / 15.17 s | 82 | 1.93 s |

The container-wide peak for the largest case was 2,190,376,960 bytes. This includes
Chromium and the test runner; it is not a service-worker-only heap measurement.
Real elapsed cycle time was measured independently of the synthetic clock and
asserted below the 180-second cycle lease. These are fixture measurements on this
machine, not deployment latency guarantees. Domain reconciliation still traverses
in-memory history; this correction removes repeated whole-history IndexedDB reads
and unnecessary full transaction fetches, not all history-dependent CPU work.

## Restore benchmark input boundary

Archive recovery starts with an existing input ZIP. The native restore benchmark
prepares one synthetic Blob before its restore timer, then passes that exact Blob
to the real `RestoreOwner.begin` and `load` methods. Full archive verification,
hashing, IndexedDB staging, graph validation, preview and activation remain inside
the unchanged 180-second restore budget. The private probe rejects a missing or
mismatched prepared file instead of silently regenerating it.

The result records `fixture_setup_seconds`, `elapsed_seconds` for restoration and
`combined_elapsed_seconds` for setup plus restoration. The unchanged 3 GiB cgroup
peak includes setup too; it is not reset before restoration. This measures the
RestoreOwner pipeline, not popup upload/file staging or live network latency.
Earlier results timed two synthetic ZIP generations inside restoration and are
not directly comparable to this corrected restore-only measurement.

Isolated Docker results on 2026-10-23 (100,000 retained entities; the complete
21-test restore module passed in each browser):

| Browser | Fixture setup | Restore pipeline | Combined wall time | Container peak |
|---|---:|---:|---:|---:|
| Chromium 145 | 5.48 s | 89.87 s | 95.35 s | 1,187,106,816 bytes |
| Chrome 140 | 8.91 s | 138.79 s | 147.70 s | 1,518,985,216 bytes |

These are measurements on the local Docker host, not guarantees for other CPUs.
