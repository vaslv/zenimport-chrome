# L11 opt-in trusted background and durable wakeups

The background can opt into named local/storage controls while the product entry
remains remote-only until popup acceptance. Only the exact popup URL may dispatch
those commands. Legacy format-1 migration is rejected in standalone mode. UI Root
changes return the newly resolved context; reports remain read-only.

DeliveryAlarms resolve only a configured selected local copy without a pending
switch or awaitingSync barrier. Neither popup status nor control recovery starts
a new synchronization. Independent storage-control wakeups resume only previously
persisted intents, with a watchdog armed before dispatch, a 16-unit/25-second
budget, durable stable-code pauses, and explicit retry. They never accept previews,
acknowledge external downloads or release first-sync barriers automatically.

Independent adversarial review found the startup account-settings recovery defect;
867fe18 fixes its native read-only preflight. Background recovery now restores
independent control wakeups even if settings recovery fails. API review additionally
found missing legacy verification failure handling and inaccessible snapshot retry.
Status now exposes verificationError while retaining setup; explicit snapshot retry
reuses the same native/server operation rather than beginning another snapshot.
Final independent API and adversarial rereads have no findings. Reviewers ran no
tests; external cross-model CLI remains unavailable.

Docker strict/generated checks and 278 unit/contracts passed (5968.11ms), including
legacy status failure, sender/command boundaries, explicit retry, bounded budgets,
durable pause and restart scheduling. Native background/settings: 11 passed, one
large unrelated case deselected (37.27s); earlier background/control API: five
passed (12.63s). Minimum Chrome 140: three critical background/startup cases passed,
nine deselected (165.69s), before the final additive legacy-error/retry API changes.
The native restart scenario closes all Chrome processes with an unfinished export,
then resumes it through a real alarm without acknowledging the downloaded archive.
Logs: /tmp/zenimport-l11-background-{unit,settings,native,min}.log.

Product entry/popup and L12 acceptance are unfinished. No live API/production data,
push, tags or publication.
