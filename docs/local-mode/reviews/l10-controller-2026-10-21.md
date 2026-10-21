# L10.8 production transfer ports and bounded source quiescence

ModeTransfers binds protected local/server candidates, the journal, native owner
and authenticated HTTP adapters. Fresh owner/physical-ID checks precede the initial
Root CAS and destination preparation. The server descriptor and remote Root
selection commit together after real source handoff. No SDK financial writer is
part of the controller. Imported contexts remain awaiting explicit synchronization.
Popup routing remains disabled until the other L10/L11 gates pass.

Local source preparation stops one unfinished capture or recovers an expired
outbox without sending. It never labels unfinished intervals complete. Server
preparation exposes an authenticated physical-ID/epoch-fenced quiesce endpoint,
which stops one active capture under the exclusive gate; source_start retains its
final no-active-capture check. A lost start response recovers the permanent receipt
without trying to mutate the already held Root.

Independent API/adversarial reviews fixed three actual availability defects:

- Quiescence now accepts only the same monotonic financialMayHaveStarted change
  already allowed by the journal, preserving every other Root fence.
- An imported server awaiting explicit Sync is rejected before a reverse journal
  or native reservation is created, and checked again before reservation.
- A competing client's server hold cannot strand an unused local reservation.
  With no saved command, no source request could have dispatched. With one saved
  source_start, authenticated status must prove its permanent absence and a now
  strictly higher epoch, making that old CAS forever invalid. The exact request
  and complete observed proof remain in immutable audit. Audit, native discard,
  Root restoration, cancellation marker and lease revocation are one transaction.
  A foreign source is never modified; no handoff/cancel receipt is fabricated.
  Otherwise, normal bilateral cancellation or forward recovery is mandatory.

Adapters are additionally fenced to the same journal ID before any claim, so a
late handler cannot act on a replacement operation with old peer transports.

Final independent reviews report no remaining findings. External cross-model CLI
is unavailable; no cross-model result is claimed. Docker evidence is recorded in
progress.md: actual production controller roundtrip, shared-pause consent, server
capture cancellation, foreign transfer races, quota rollback and minimum browser.
No live API, production history, push, tags or publication.
