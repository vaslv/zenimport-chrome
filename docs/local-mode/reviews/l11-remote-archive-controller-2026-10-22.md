# L11 selected-server archive recovery coordinator

The trusted coordinator owns HTTP proofs, bounded chunk dispatch, durable preview
consent and permanent route selection. Popup messages will carry only operation
IDs and explicit user decisions. Production routing remains disabled until the
remaining L11 integration is complete.

The immutable begin is saved before HTTP. A lost begin response resumes by status,
using the same operation ID and request. Rejected begins remain recoverable by
permanent exact-request withdrawal; a stale participant epoch is shown as blocked
rather than an endless busy retry. Fresh physical identity is required before the
original route can resume or the restored dataset can be selected.

Cancellation is durable before network dispatch. A native final activation grant
checks the current exact preview consent immediately before sending. A delayed
step cannot use consent revoked by a failed refresh. Once dispatch is granted,
refresh cannot revoke an unknown activation; retry resolves its permanent status,
or cancellation withdraws if still possible. If activation already won, it is
resolved forward rather than inventing rollback.

Successful activation/withdrawal is followed by resumable remote and local file
cache cleanup. It does not send financial transactions, replace source history or
invent peer handoff authority. Root/descriptor/terminal selection rolls back on
quota failure, while subsequent status resolution avoids importing twice.

Independent API and adversarial reviews: no remaining confirmed findings after
correcting durable cancellation, final-grant and cleanup races. Reviewers did not
run tests. External cross-model CLI remains unavailable in this environment.

Docker evidence: strict/generated checks and 264 unit/contracts passed (1816.92ms).
Actual isolated Python HTTP plus native selection/proofs: 24 passed (51.31s), only
an existing third-party warning. The private harness initially mislabeled a
SyncError as storage_corrupt; it now preserves the typed transport error. Minimum
Chrome evidence is recorded in progress.md after completion. No live services,
production data, push, tags or publication.
