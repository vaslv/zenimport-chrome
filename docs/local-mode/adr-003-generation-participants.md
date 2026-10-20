# ADR 003: Financial installation identity for browser generations

Status: implementation decision for L4; reviewed with the L4 storage gate.

The browser has one durable profile installation ID in its trusted external
sentinel and runtime control. It detects missing IndexedDB and is never copied
from an archive. A financial generation has its own fresh participant UUID and
participant epoch. The profile routing epoch is a separate fence.

Protocol-2 `installation_id` for a local financial participant is this generation's
participant UUID. A backend has one financial generation per database, so its
physical database UUID already serves that role. Neither is a financial lineage.

A previously handed-off local generation cannot become a writer again. Returning
from a server stages a new generation with a new participant UUID, analogous to a
fresh server database. It retains the archive's financial lineage and UUID journal,
while the previous generation and its irreversible receipts stay inactive. Merely
reusing the browser profile never resets old activation authority.

This implements the approved fresh-generation reverse migration rule. It does not
allow an old local snapshot to resume, a source to undo handoff, an offline server
to cause local fallback, or a used database to merge with another history. The
control database's active pointer, pending switch and routing epoch remain under
one atomic transactional owner. L4 bootstrap exposes no financial dispatch.
