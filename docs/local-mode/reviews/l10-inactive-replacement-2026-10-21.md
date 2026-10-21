# L10.11 inactive-copy replacement review

Reverse live transfer requires explicit replacement consent and an acknowledged
backup made after each financial local generation became inactive. Prior active
snapshots do not satisfy that gate. The exact generation, backup ID, dataset ID,
archive hash and dataset digest are retained atomically with the switch journal.
Destination reservation verifies the same evidence again before changing Root.
No old generation is merged, reactivated or deleted.

Independent API/adversarial source reviews completed (tests in summary mode).
API review found two issues, both fixed and covered by native browser regressions:

- A later download acknowledgement could select an earlier-sorted backup and make
  an already accepted decision unrecoverable. Reservation now verifies the exact
  backup IDs retained in the decision, independent of new backup evidence.
- Raw corrupted backup metadata could pass as evidence. A strict validator now
  checks shape/version/UUIDs/SHA256, timestamps and byte/chunk bounds, snapshot
  routing and the complete manifest's dataset/archive/session/time bindings.
  Corruption cannot select a destination or alter Root.

Final independent review reports no remaining findings. External cross-model CLI
unavailable. Docker evidence is recorded in progress.md. Product local routing
remains gated by manual restore and L11/L12. No production data or live API used.
