# L10.9 no-import joins and source lineage review

Independent API and adversarial reviewers read the full source diff and reviewed
fixtures/tests in summary mode. Both final results: no remaining findings.
The external cross-model CLI is unavailable; this is not cross-model evidence.

A used server is joined without import, merge, source pause or a fabricated
handoff. Source capture quiescence, owner checks, settled outbox and Root CAS
precede atomic selection. Retained native financial rows remain read-only.
Quota rollback preserves the initial Root; a lost response is recovered from the
permanent join decision. An old cancellation cannot stop a later capture.

Review identified a source-lineage race between journal creation and source hold.
The fix permanently binds installation/dataset IDs in the protected selected
context, checks them before reservation and compares the real source_start proof
before destination_start. If lineage changed, immutable audit and cancellation
intent commit together and normal source_cancel/discard/resume recovers. No
archive with the unexpected lineage is imported and no receipt is invented.

Docker results are recorded in progress.md. Product local routing is still gated
by backup/restore and L11/L12. No live financial account or production data used.
