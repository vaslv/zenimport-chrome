# L11 common local application facade prerequisite

The opt-in runtime initializes only fresh installations locally. Existing remote
profiles retain their selected mode and fail closed on unavailable or malformed
configuration; local fallback is never automatic. Production background wiring
is intentionally unchanged at this checkpoint.

The local facade calls named account/capture/report repositories and the existing
durable delivery worker. Ordinary discovery is metadata-only and needs no SDK
credential. Imported setup uses its lesser permit, and only explicit capture start
may acknowledge first synchronization. Reports refresh read-only SDK data and do
not invoke delivery. Exact settings/lease/instrument/created values admit decimal
text without rounding. Legacy format-1 transfer methods cannot grant local rights.

Independent API review found and corrected:

- Same-address token repair used physical datasetId as its transient scope.
  Preserve the descriptor generation/contextId and the physical binding separately.
- An old facade could adopt a current generation's credential or release its
  imported barrier after an await. Bind MirrorRepository and FirstSyncOwner to the
  captured full Root inside native transactions. Own successful credential CAS
  alone advances the bounded owner's reference; a competing generation cannot.
- Widen exact report created values in the declared facade DTO.
- Avoid mandatory SDK refresh for ordinary bank discovery before local setup.
- Check optional server permission before and after every ordinary remote fetch,
  including configuration verification. Preserve typed permission failures.

Final independent focused reread: no findings. New native fault tests suspend
credential selection and explicit-sync setup, replace the active generation with
another imported generation, and prove neither credential nor awaitingSync changes.
New unit tests preserve paused command/scope on bound token rotation, reject a
changed server dataset, and issue zero requests after permission revocation.
Backend separately checks paired physical/dataset headers under its request gate.

Docker evidence is recorded in progress.md. External cross-model CLI unavailable.
This prerequisite does not claim popup/migration/alarms integration or release
acceptance. No live API/data, push, tags or publication.

Final adversarial corrections:

- Imported first Sync now accepts its complete capture job, first-sync audit and
  awaitingSync release in one native transaction. Invalid DTOs, unknown connections,
  quota and expired setup evidence roll back the entire acceptance. Trusted time
  is sampled inside the transaction and after final writes; callers cannot reuse
  a captured pre-wait timestamp. The expiry fault explicitly intercepts the actual
  IDB add operation and asserts that injection was reached.
- SDK gateways floor their clock callback only at the SDK boundary. The public
  local clock can return fractional Unix seconds; the published SDK rejects that
  input otherwise. Read and native write regressions assert the integer request.
- A same-generation credential change fences metadata writes and the final
  migration quiescence stop/recovery transaction. Native pause-before-write proves
  an old quiescence cannot modify capture envelopes after rotation.
- Bound remote ordinary calls use the dedicated physical/dataset URL namespace as
  well as paired headers. An older server after a cached handshake returns 404
  before any legacy mutator can run. Legacy selected credentials remain repairable
  while offline; verification is explicit rather than a prerequisite for current().
- The unknown-response timeout fixture now waits indefinitely after recording the
  synthetic request and lets the SDK deadline expire. Its previous 30 ms deadline
  could legitimately expire during a native dispatch grant under load, testing a
  pre-dispatch outcome instead of the intended post-dispatch uncertainty. The
  fixture deadline is 3 seconds; production deadlines were not changed.

Independent final API and adversarial rereads: no remaining confirmed findings.
See progress.md for exact Docker snapshots and the isolated timeout fixture repeat.
