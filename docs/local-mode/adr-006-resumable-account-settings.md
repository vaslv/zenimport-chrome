# ADR 006: resumable local account settings

Status: implemented under L7 verification; product local mode remains disabled.

A direct atomic port of Python account settings was correct on small histories,
but its 100k prepared-delivery test held a native transaction for 21.1 seconds.
That exceeds the existing 10-second budget. Increasing the threshold or leaving
some old target authorizations usable would violate the local storage gates.

Use an exclusive dataset hold and a nonportable account-settings operation:

1. Validate the desired setting, current version, representable next version,
   supported account, calendar bounds and current mirrored target/currency.
   Acquire the hold and persist the exact normalized request atomically.
2. Prove coverage/frontier and, when changing a historical target, the absence of
   uncertain/attempted-pending deliveries before changing derived facts.
3. Scan at most 500 bank rows per unit; mark only never-attempted prepared
   deliveries for rebuild and clear their obsolete authorized job. Original
   payloads, UUIDs and all attempted/terminal facts remain intact.
4. Cancel active account intervals in bounded units, preserve captured pages and
   complete coverage, and refresh affected job locks/status separately.
5. Atomically save the new account version, binding and frontier, release the
   hold, and retain the completed reply. Repeated executors return that receipt,
   even when another executor has already released the hold.

Every unit verifies the independent anchor, Root mode/generation/epoch, active
participant and the exact hold owner inside its native transaction. No network
or Chrome-storage promise is awaited inside that transaction. Ordinary writers,
mirror publication, archive export and migration cannot enter during the hold.
Opening a repository for recovery recognizes only this operation kind and
lineage; ordinary reads/writes do not inherit permission to bypass a hold.

Worker termination or quota failure leaves the operation at its last acknowledged
unit. Startup or the identical request resumes it. An unrelated request receives
account_busy. There is no timeout-based release of partially completed work.
Unknown migration holds are never treated as settings recovery. A deterministic
preflight failure releases the hold before any derived mutation; overflow must
not create an operation that can never finish.

The operation is not a portable migration participant or financial identity. The
financial archive format and logical row schema are unchanged. A snapshot can be
exported only after the setting has completed, so it includes the same final
account/binding/rebuild/capture facts as the Python operation. Current imported
awaiting-sync state is still an ordinary-write fence; guarded first-sync setup
and release belong to the later capture/delivery wiring.

The private repository validates its mirrored target transactionally. The future
privileged application facade must refresh/check the SDK catalog for a changed
enabled setting, matching the existing server route. That network step stays
outside this owner. No bank page receives credentials, and this operation never
calls a financial API writer.
