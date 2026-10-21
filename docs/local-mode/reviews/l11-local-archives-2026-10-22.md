# L11 trusted local archive facade

LocalArchives exposes named upload, backup, recovery, explicit preview acceptance
and bounded cleanup operations. It never accepts SDK ownership proofs, arbitrary
financial table names or write-capable SDK clients from popup messages. Verified
protected credential references remain background-only. Backup source selection
includes only the active or retained retired local copy with known owners.

A backup first stops one capture or recovers one expired delivery lease, then
rechecks source quiescence and captured Root inside the actual snapshot hold.
Its ready snapshot releases the source. Only an explicit acknowledgement of the
complete verified download permits cache cleanup and records retained-copy backup
evidence. Recovery retains the original uploaded archive on cancellation and
cleans only the never-activated stage. Activation preserves the explicit first
Sync barrier; no financial transactions are sent by these controls.

Review corrections:

- File mutations and every RestoreOwner/BackupOwner native unit now bind a cloned
  captured full Root, including credential epoch and pending control. Only a
  monotonic financial activity bit is tolerated. A handler suspended after open
  cannot act on a newer recovery, even if it names that recovery's ID.
- Preview freshness starts conservatively before the SDK verification request.
  The final native preview transaction checks age before and after persistence;
  slow network/projection/write processing cannot renew stale evidence.
- The disposable facade test now inspects the actual native participant barrier;
  its initial failure called a nonexistent fixture command, not a product method.

Independent API and adversarial final rereads: no remaining confirmed findings.
Reviewers did not run tests; external cross-model CLI remains unavailable.

Docker: strict/generated checks and 264 unit/contracts passed (1938.90ms).
Current native facade/file/backup/recovery: 37 passed, three large cases deselected
(136.10s). The immediately preceding complete file/recovery matrix, including
1k/10k/100k restores, passed 26 tests (190.01s). The final minimum Chrome 140
facade/captured-Root/freshness repeat passed 11 tests, 21 deselected (124.35s).
The selected-server coordinator separately passed all seven actual-Python cases
on minimum Chrome (72.41s). See progress.md for log paths and remaining gates.

Product background/popup and L12 acceptance remain unfinished. No production
services/data, live SDK requests, push, tags or publication.
