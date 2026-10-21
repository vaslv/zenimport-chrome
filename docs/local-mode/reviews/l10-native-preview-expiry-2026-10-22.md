# L10 native restore preview expiry correction

The major API review reproduced a preview expiring while activation awaited the
native anchor. A time captured before that await incorrectly authorized commit.
Activation now samples time inside the final native transaction and again after
all writes. Either failure aborts Root, participant, dataset, stage and intent
changes together. Successful permanent activation replay remains idempotent.

Independent API reread: no findings. The cross-model CLI remains unavailable.
Docker strict/generated/bundle checks and 256 unit/contracts passed (1838.07ms).
Current Chromium: 14 functional restore tests passed (47.42s); three previously
measured resource cases were excluded from this focused repeat. New deterministic
faults expire the preview at the anchor read and after the final intent write;
both roll back completely and permit a fresh preview and explicit activation.
Minimum Chrome 140 evidence is recorded in the progress log.
No live accounts, financial API writes, tags, push or publication were used.
