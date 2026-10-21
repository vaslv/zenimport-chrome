# ADR 005: bounded mirror construction and atomic publication

Status: implemented and reviewed in L6; local mode stays disabled.

The first native L6 implementation committed an entire diff in one transaction.
It preserved correctness but the 100k fixture held IndexedDB for 42.2 seconds,
exceeding the existing ten-second transaction budget. Increasing that budget or
accepting a partially updated active projection would bypass a safety gate.

For large updates, construct a private mirror view in units of at most 500 rows.
The six mirror tables form one closed foreign-key subgraph: entities, movements,
tags, raw runs, deletion audit and permanent tombstones. Copy retained records
exactly, replace only explicitly full collections, append the validated raw run
and preserve first-observed tombstones. Each unit verifies the active Root,
credential epoch, participant and durable refresh lease, then renews that lease.
No network, timer or external storage promise runs inside an IDB transaction.

The old complete mirror remains the only published view while construction is
in progress. A short transaction finally switches the private view pointer and
the logical cursor/freshness together. A failed/quota/interrupted construction
leaves the old view intact; an abandoned view never publishes on reopening.
Small updates retain the direct atomic path only within a conservative row bound.
That bound includes old affected tags, not just the new response's row count.
Reads used for sending require a completed refresh; reporting can use the prior
available complete projection without treating it as fresh authorization.

This physical view pointer is not a financial dataset generation, participant
identity or archive field. Repository sessions and held source readers resolve
it in the transaction that establishes their financial scope. A source hold
prevents any later publication or construction unit. Export reads only the
published view; staged import still contains ordinary logical financial rows.
Permanent evidence, bank facts and attempted UUIDs never move to a fresh logical
identity because of a mirror refresh. Existing portable schema and hashes remain
unchanged. No raw native table handle is exposed to application handlers.

Inactive/retired mirror versions are retained until a bounded private collector
proves they are not published, leased or used by a held snapshot. That collector,
crash boundaries, corruption checks, minimum-browser and portable interoperability
are required before L6 can close. The independent L4 storage guarantee must be
rechecked after adapting held readers. No product gate is implied by this ADR.

Prediction invalidation uses the existing ready/mirror-generation contract,
instead of an unbounded erase inside refresh/failure handling. Stale derived
rows are reclaimed with a persisted 500-key cursor. Neither a stale prediction
nor an unpublished mirror version becomes active evidence after reopening.
Current/minimum native checks include 100k mirror and prediction histories,
10k old tags on a hard-deleted entity, quota at publication, worker termination,
held export, and late replies after credential replacement/removal. Final gate
results are recorded in progress.md.
