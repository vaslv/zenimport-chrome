# L8.2 historical ownership checkpoint

Scope: pure durable-target backfill, known-side claims, late opposite-bank transfer
corroboration and affected-day blocking. No persistence or financial API mutation.
The caller must supply the unique KNOWN union, ever-attempted immutable payloads,
original authorizations, exact revision/current bank facts and canonical amounts.

Independent API and adversarial review found two issues and their fixes:

- Recovery and unknown-owner blocking need different mirror entity sets. Python
  recovery excludes permanent tombstones, but blocking includes a current
  deleted=0 entity that reappeared after a tombstone. A single filtered map lost
  that protective block. OwnershipContext now requires both eligible transactions
  and explicit current blockingTransactions. An actual Python fixture covers
  unknown transfer ownership, a permanent tombstone, reappearance and the same
  target/day remaining blocked.
- Per-edge payload scans and per-unknown full KNOWN scans were quadratic for a
  large imported journal. Payload proof sets and historical owners are indexed
  once; account mappings, peer amount/day/instrument buckets and remote movement
  alternatives are indexed as well. All conflicting proofs and alternative counts
  remain intact. Property-read assertions prove linear journal traversal and a
  native 100k fixture measures bounded worker units.

The API recheck reported no further findings. The adversarial recheck and final
Docker evidence are recorded in progress.md. No cross-model review is claimed.

Actual source fixtures build complete SQLite capture/authorization graphs through
Python's HTTP/SDK harness; the SDK transport and banks are synthetic. Both transfer
directions, FX, late second bank, repeated amounts, changed mapping/day/amount,
ambiguous opposite legs and reappeared tombstones are compared with the installed
TypeScript domain. Existing source records are not modified by TypeScript yet;
this checkpoint compares proposals and blocked sets, not durable browser writes.

Still pending in L8: category evidence/prediction, revision-fenced repository
application of these proposals and complete-coverage report assembly. No product
local mode, writer, real token, push, tag or publication is enabled.
