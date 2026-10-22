# L11 trusted control dispatch checkpoint

The privileged runtime now exposes named storage/archive factories. Popup-only
messages use exact field allowlists, bounded canonical chunk transport and explicit
browser/server restore targets. UI messages cannot supply authority proofs or raw
storage handles. Each command delegates to native fenced owners; data/mode-changing
commands may adopt only their own resulting context.

Review corrected a late initial RPC response that could overwrite a newer selected
context. A revision fence now rejects a reply started before any intervening scope
change, while parallel replies in the same established scope remain valid.

Backup preflight also checks each known owner has a stored live mirror user before
acquiring its hold. A newly verified token alone cannot strand the first export.
Older fact-only backup fixtures retain the existing complete build-time graph gate.

Final independent API review: no findings. The preceding adversarial reread of the
control API was clean; the additional native backup preflight received API review.
Reviewers did not run tests. External cross-model CLI remains unavailable.

Docker strict/generated checks and 271 unit/contracts passed (1754.47ms). Actual
native control/application/backup: 14 passed (21.77s). Minimum Chrome 140 control
API: three passed (23.71s). Tests cover trusted command boundaries, stale replies,
explicit recovery targets, drafts, token setup/removal, canonical file chunks and
export before/after the first mirror. Logs:
/tmp/zenimport-l11-control-api-{final-unit,native-final,min}.log.

This is an internal prerequisite. Product dispatch, popup and L12 are unfinished.
No live API, production data, push, tags or publication.
