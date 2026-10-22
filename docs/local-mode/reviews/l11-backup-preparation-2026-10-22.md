# L11 durable export preparation review fix

API review found a liveness gap: backupBegin can stop one capture/recover one batch
and return quiescing before a snapshot intent exists. The popup discarded the ID,
so no background wakeup could finish that original export.

A native preparation now saves the exact ID, generation and initial Root before
quiescence. Same-ID steps resume through the bounded driver. Preparation is not a
writer grant or snapshot hold. Snapshot begin consumes it in the same transaction
that acquires the final consistent hold. Cancellation creates a permanent per-ID
tombstone, including before a snapshot exists. Cancelled/superseded quiescers check
the preparation head and phase inside capture-stop transactions. Other native
mode, join, recovery and export starts reject an active preparation.

Independent API and adversarial rereads have no findings. Reviewers did not run
tests. Docker strict/generated checks and 279 unit/contracts passed (1295.02ms).
Native preparation/control API/local archive/backup plus current product popup:
17 passed (42.87s). The preparation regression closes Chrome completely, resumes
the same saved ID, and checks competing begins and permanently cancelled IDs.
Minimum Chrome repeat is running; it is not yet claimed as passed. Logs:
/tmp/zenimport-l11-popup-{unit,native,min}.log.

The product popup has separate unfinished acceptance/review work and is not part
of this commit. No production/live API, push, tags or publication.
