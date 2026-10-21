# L8 persisted reconciliation review — 2026-10-21

Two independent read-only reviewers examined the actual storage/domain changes
against Python existing.reconcile, ownership and mirror.reconcile_known. Final
rechecks report NO FINDINGS. No unavailable cross-model result is claimed.

Corrections made during review:

- Matching keeps API account-reference string types and numeric instrument types
  distinct. A raw string instrument cannot collide with a numeric instrument and
  create a durable receipt. The read-only report keeps Python's scalar currency
  lookup behavior. Invalid related types are never learning evidence.
- Known UUID reconciliation precedes new amount matching, includes never-attempted
  intents and respects duplicate-cleanup canonical survivors. Explicit deletions
  suppress the old bank/intent without discarding its payload or original UUID.
- Known history is processed once for its exact source revision/mirror/projection.
  Its private watermark is published after all own matching commits. New explicit
  edges invalidate it even at the same mirror generation. A post-known reread must
  equal the last committed source stamp; external changes cannot inherit the marker.
- A large imported group writes at most 200 new receipts per native transaction,
  always together with its final bank/delivery state. Killing the worker after
  the first page preserves those facts; the next run writes only missing receipts.
- Unchanged known state/reason/delivery rows do not receive timestamp-only writes.
  This deliberately preserves the last actual state transition instead of copying
  Python's repeated no-op SQL timestamp churn. New semantic transitions retain
  source timestamps. Both financial decisions and compared first-transition rows
  match the actual source.

Singles atomically store receipt/target/terminal state and remove only unattempted
prepared intents. Split/settlement groups atomically store all members/targets and
terminal states. Each unit consumes a revalidated updated source stamp; partially
committed earlier facts remain valid when a later external change aborts the plan.

Resource policy: Cartesian imported ownership expansion is capped at 1,000,000
pairs before any matching mutation and returns unsupported_scenario above that
limit. Reports share membership sets instead of expanding them; they remain
independent of this matching limit. Unit coverage includes 100k unchanged known
identities producing no timestamp-only work, within a 10-second CPU budget.

Docker current native/actual Python tests: 27 passed in 64.57s (one existing
Starlette warning), covering receipts/targets/group facts, source report parity,
malformed instrument types, explicit UUID presence/absence/deletion, quota rollback,
1001-member interrupted recovery and external-write interleaving. Known-UUID
fixtures start with invalidated prepared intents in both implementations; the
source mirror's separate category-preparation phase is not claimed implemented
by that comparison. Minimum-browser and final unit results follow in progress.md.

Logs: /tmp/zenimport-l8-persisted-*.log. No live data/API, production changes,
financial SDK writer, push, tags or publication.

Final gates: 214 unit/contracts plus strict/generated checks passed; minimum
Chrome 140 passed all ten native persisted cases in 90.74s. The interrupted group
recovery retained its unchanged per-native-transaction 10-second guard.
