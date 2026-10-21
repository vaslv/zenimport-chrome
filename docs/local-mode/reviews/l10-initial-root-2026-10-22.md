# L10 stale coordinator Root correction

The major adversarial review found a token rotation between journal creation and
native hold could leave a native transfer bound to a different Root from its
coordinator. The journal could neither accept that hold nor cancel it.

The native final hold/reservation transaction now validates the current head,
initial Root and exact local source/destination/credential binding. The monotonic
financial-activity bit is the only tolerated difference. Independent native peer
primitives without a coordinator journal retain their existing protocol behavior.
Coordinator-owned destination credential references remain immutable while held;
a caller must cancel before selecting a replacement credential.

A saved local source_start rejected by permanent Root/credential epoch advancement
may terminate only its unused journal. This requires no native switch, operation,
receipts or chunks. Its exact request and initial/observed Root are durably audited
before cancellation. It does not change Root, contact a peer, fabricate a receipt,
or resume an actual native hold. Late old requests remain permanently fenced.

Independent adversarial focused reread: no findings. Deterministic native tests
exercise both stale hold directions, rollback on audit quota failure, permanent
late rejection, immutable held credentials and the existing real-hold recovery.
Docker evidence is recorded in the progress log. Cross-model CLI unavailable.
