# L11 selected-server snapshot export

RemoteArchiveBackup persists an immutable exact backup request before HTTP and
resumes status, verified chunks, ZIP verification, explicit download acknowledgement
and bounded cleanup after worker/browser restart or lost replies. The backend owns
the short snapshot hold and releases its writer when the snapshot is ready. The
browser does not invent writer authority or change its selected route for export.
A repaired selected token may resume only the same physical server and dataset;
full captured Root checks reject callbacks from the previous credential epoch.

Native coordination blocks mode changes, restore starts and competing file writes
until this export finishes. A separate cleanup permit allows cancel/clean only
while cleaning; download writes require the exact current intent in working phase
without a cancellation request. Completed/superseded permits are permanently stale.
The source may continue ordinary work after its consistent snapshot is ready.

Exact backend withdrawal is required by preflight capability discovery. It fences
a never-accepted begin, releases only an owned hold or discards an already-ready
snapshot cache. No download acknowledgement is fabricated. The paired backend is
cea63b8; its complete Docker suite passed 826 tests (155.68s).

Independent API/adversarial reviews corrected:

- An old initial CAS could retry forever after another operation advanced the
  source epoch. Fresh identity now makes this visibly blocked; withdrawal retires
  the original request before a new one is created.
- A delayed ready response/file.begin could recreate an uploading cache after
  completed cancellation, blocking later exports. Phase-specific native permits
  and progress guards revoke both delayed paths before any cache write.
- The externally cancelled/cleaned response now has the same explicit step-state
  shape as other coordinator branches and resumes permanent withdrawal.

Final API and adversarial rereads have no remaining confirmed findings. Reviewers
did not run tests; external cross-model CLI remains unavailable.

Docker: strict/generated checks and 265 unit/contracts passed (1402.69ms).
Actual isolated Python plus native remote backup/recovery/local archive/file
scenarios: 28 passed (68.33s). Minimum Chrome 140: all ten remote backup scenarios
passed (93.48s). Tests cover lost begin/ack, full Chrome restart, unused/building/
ready/stale cancellation, offline withdrawal, credential repair, stale callbacks,
competing file/mode rejection, old-server capability rejection, both late-cache
race points and external server cancellation. Only existing third-party warnings.
No live API/production data, push, tags or publication.

Product background/popup and L12 acceptance remain unfinished.
