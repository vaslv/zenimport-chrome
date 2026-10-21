# Application boundary and remote upgrade

L5 keeps distributed handlers remote-only. `ApplicationService` names domain
operations with DTOs generated from the pinned HTTP contract; only the remote
adapter maps them to paths. Background handlers, the capture coordinator and
popup binary archive operations use the same privileged runtime resolver.

The native Root selects the mode and credential reference. Existing configured
profiles bootstrap a remote Root with an inactive anchor generation and no
financial rows. An unreachable server never creates an active local dataset.
The independent sentinel is acknowledged before database creation; interrupted
initialization or missing storage requires recovery rather than an empty reset.

Credentials are acknowledged in trusted Chrome storage before Root references
them. Their nonsecret URL/context descriptor lives separately in IndexedDB, so a
missing token disables transport but preserves the pending command and permits
explicit same-server credential repair. The old `config` key is a compatibility
projection after initial upgrade, never a fallback authority.

API v1 does not expose server dataset identity. L5 therefore allocates an opaque
cache-context UUID on each endpoint selection, retaining it for same-endpoint
credential correction. This UUID is not a financial dataset lineage or verified
server identity. L10 must use authenticated protocol-2 participant identity for
actual transfers. Revisiting an old URL gets a new cache context, avoiding reuse
of a previous server's job ID if that endpoint now hosts a different database.

Transient state and Root share one IndexedDB transaction owner. State patches
check the captured Root epoch, generation, credential reference and pending
switch in the transaction that commits the patch. Chrome view/capture/history
keys remain display projections for compatibility; reads use the authoritative
scoped record. A one-time legacy upgrade filters URL-keyed maps to its endpoint.
HTTP responses are checked before and after transport, and privileged UI messages
carry operation and context metadata. A popup cannot adopt another popup's new
endpoint underneath controls rendered for its old account list; reopening loads
the new context. Report links also bind their context before any request.

Bank page data still enters through existing connector/document/account checks.
Capture request IDs, unknown-start recovery, leases and persist-before-ACK
ordering are unchanged. A disabled local boundary rejects local selection until
the later mirror, capture, delivery and migration safety gates are implemented.
No mode button, local send or automatic synchronization is enabled by L5.
