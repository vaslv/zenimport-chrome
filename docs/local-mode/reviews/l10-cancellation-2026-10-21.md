# L10.6 cancellation and irreversible handoff recovery

Cancellation revokes the old native coordinator lease atomically. Before handoff,
it must win source_cancel, durably discard destination activation, and only then
resume the original source. Unknown handoff queries the same saved request; if
handoff won, the runner recovers forward and never resumes the old generation.
A completely unused journal can terminate without a hold. Native reservation and
source_start reject its terminal marker inside their own final transactions,
closing the race with a late cancelled runner.

API review found a real stale-CAS cancellation race: a background source_seal or
late destination_start/arm may advance the participant after cancel/discard was
saved. Blindly repeating that obsolete epoch could wait forever. The correction
is restricted to these cancellation control commands. Authenticated status must
show the old request was not accepted, the same participant/switch has advanced
monotonically, and every intervening epoch has the exact allowed permanent
receipt. The old request is retained in an immutable private audit row; replacement
UUID/epoch and receipt-chain acceptance commit together. Any late old request can
no longer match that epoch. Uncertain financial SDK requests are never replaced.
Quota rollback preserves both the old request and absence of the replacement.

Independent API and adversarial final reviews are clean after that correction.
Native fault tests exercise both late-transition races, dropped cancellation/
discard/resume replies, forward recovery after a lost winning handoff, untouched
financial facts, unused-abort fencing and audit/replacement quota rollback.
Python/native tests additionally cover actual HTTP reverse transfer into a fresh
remote-only browser and cancellation of a real Python import. Test evidence and
remaining L10 scope are recorded in progress.md. External cross-model CLI remains
unavailable; no cross-model result is claimed.
