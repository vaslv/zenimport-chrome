# L10.7 detached server credential review

ServerCredentials stores a new protected UUID reference only after authenticated
fresh owner/participant verification and acknowledged storage. It never changes
Root, removes an active secret, imports data or invokes a financial writer.
Existing legacy records retain the exact ApplicationRuntime shape. Reusing a
candidate requires both its original owner and installation binding, plus any
new caller owner requirement. Every transport operation rechecks host permission.

Independent API/adversarial reviews found and fixed two issues: caller-provided
owners could override the original candidate binding, and object insertion order
was incorrectly part of storage acknowledgment equality. Regressions cover both,
including reordered nested storage objects. Final reviews: no findings. External
cross-model CLI remains unavailable; no cross-model result is claimed.

Docker strict/generated/bundle checks and all 244 unit/contracts passed. Tests
cover wrong owner, host permission, failed storage acknowledgment, physical server
replacement at the same address, legacy reference verification and corrupt secret
rejection. No live API, financial writes or product local routing.
