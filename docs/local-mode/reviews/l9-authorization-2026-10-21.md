# L9 authorization checkpoint review — 2026-10-21

The independent API reviewer found two defects: restricting proof intervals to the
current job and failing to canonicalize an uppercase job UUID. Both are fixed and
covered by native regressions. A second reviewer adversarially rechecked portable validation and authorization
fences; both final reviews report NO FINDINGS. Reviewers did not independently
run the recorded tests.

Actual Python delivery.authorize_job joins any completed observation of the same
physical account with the current click's job_accounts snapshot, settings and
allowed date range. It does not require the original capture interval to belong
to the new click. New overlap capture need not finish before old complete facts
can be authorized. Only immutable completed revisions are usable.

The new native cross-job export regression also exposed an existing overstrict
kernel condition and the same condition in both portable history validators.
They now follow the SQL insert proof: complete captured revision, physical
account and job snapshot settings/target; ordinary foreign-key/relationship
checks still reject missing jobs, accounts and invalid revisions. Attempted
payload/UUID and authorization immutability are unchanged. The standalone browser
history check explicitly retains existing-job validation.

A named repository writes at most 200 authorization rows per source-fenced native
unit, then schedules verification/delivery. A partially completed authorization
build can replay after restart; no HTTP request is made here. Actual SQLite/native
capture tests compare authorization and schedule rows, including a new click before
its overlap has completed, using identical synthetic credential source hashes.
Only newly generated local DB/audit identifiers are mapped for comparison.

Docker: 217 unit/contracts, 47 native/kernel/relations/source cases in 61.17s,
then five final native/source authorization cases in 7.98s. Backend full isolated
suite: 767 passed in 38.05s, plus HTTP/auth, SIGKILL, graceful stop and restored
journal lifecycle checks. Existing Starlette warnings remain warnings.
Logs: /tmp/zenimport-l9-authorization*.log, /tmp/zenimport-l9-backend-history.log.

L9 is not complete: queue acceptance, immutable send intents, fenced SDK dispatch,
verification-only recovery and durable scheduler still require implementation.
No live data/API, product local routing, push, tags or publication.
