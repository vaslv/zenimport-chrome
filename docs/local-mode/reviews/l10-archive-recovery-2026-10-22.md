# L10.12 archive-only recovery review

Recovery from an archive is a separate authority path. It requires an eligible
empty destination, explicit retirement of all former writers, acceptance of lost
post-snapshot evidence, a fresh full SDK owner read and an accepted read-only
reconciliation summary. It never fabricates bilateral handoff receipts, resumes
a former server or sends financial SDK mutations. Activation creates a fresh
physical participant while preserving the archive dataset lineage and every
portable fact; explicit First Sync remains required afterward.

All staging writes recheck Root, nonce, participant and immutable manifest
bindings. Cancellation revokes loading/preview work and discards only the fresh
unactivated generation. Quota faults remain resumable across a complete browser
restart. An unavailable or changed owner, stale preview, denied permission,
different archive or corrupt manifest cannot activate the destination.

Independent API and adversarial reviews found no remaining source findings after
fixes. External cross-model CLI was unavailable; this is not a cross-model pass.
The reviews covered exact manifest/owner bindings, source preservation, explicit
replacement evidence, late SDK responses, transient preview data and authority
checks around every native transaction.

The native gate exposed a Dexie transaction callback returning an untracked
native async promise; the callback is now explicitly async and awaits the full
routing guard. Fault fixtures use semantic store scopes instead of brittle table
counts. Summary counters deduplicate physical account connections. A bounded
positive foreign-key cache lives only within one immutable graph proof; mutable
authority is never cached and final publication still requires the current nonce.
The private manifest cache is keyed by exact immutable text and retains one entry.
Changed manifest text is fully revalidated, including on activation.

Docker evidence is recorded in progress.md. Full 100,000-record recovery meets the
180-second per-case budget under a 3 GiB container limit. Native archive upload,
cancelled-copy cleanup, server recovery and product UI integration remain later
gates. Product local routing is still disabled. No live API or production data.
