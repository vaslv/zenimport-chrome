# L0: observed reference behavior and explicit gaps

Reference: commits in `contracts/business/v1/baseline.json`. Generated evidence is
source-only and does not inspect production data. See the contract README for
historical SQLite NULL behavior and legacy metadata classification.

## Period precedence, as implemented

1. Popup displays saved one-time period if present, otherwise today minus 30 days.
2. On an initial enabled account without `last_complete_end`, an untouched default
   and no saved override sends no forced date. Its configured import_start wins.
3. If the user edited the date, used a shortcut, or has a saved override, that
   explicit date is sent. After initial capture the displayed default becomes an
   explicit 30-day reimport on a normal popup click.
4. Reimport values are scoped by endpoint and connection. Completion clears only
   the matching consumed override, not a newer user selection.
5. Without a forced date, Python computes the contiguous frontier from import_start,
   overlapping 14 days and filling holes before later complete islands. It merges
   outstanding forced obligations and splits inclusive calendar ranges by the
   connector max_window_days. A six-month shortcut means calendar months with
   day clamping, not 180 days. Existing supported banks use Asia/Ho_Chi_Minh.
6. Started jobs keep their end_date/windows during a long pause. Failed/incomplete
   pages never advance complete coverage or its contiguous watermark.

The browser port preserves this precedence. Changing it is a separately described
product change, not an incidental interpretation of the earlier plan.

## Identity and immutable facts

Connection identity is `(bank, profile_key)`; physical account identity is `(bank,
identity_scope, profile_key-or-empty, source_key, currency)`. Account display names
do not merge logins. A bank external ID/alias resolves a canonical bank UUID;
changed observations append revisions. Captured revisions remain tied to pages.

Store amount magnitude as a positive exact decimal string and direction separately.
24 integer and 12 fractional digits is the wire upper bound; supported currency
scale may be stricter. occurred_at has an explicit offset; local_date must equal
its day in the bank timezone. Zero is not a valid bank amount.

Known processing uses UUID plus actual matched target account. Transfers can own
one movement per account side; current mapping is insufficient to repair an old
unknown target. New opposite-bank evidence can corroborate historical ownership.

## State machines

Capture: planned/collecting/paused are active, one active job per connection and one
capture lock per physical account. A 120-second lease increments epoch on ownership
change; the extension renews before 60 seconds remain. Unknown job-start ACK keeps
the request UUID; resuming a known paused job uses a new command UUID.

Bank processing: pending/prepared/uncertain/delivered/suppressed. Delivered may only
stay delivered or become suppressed; suppressed stays suppressed. Other application
transitions still require repository/business proof, not only these SQL checks.

Delivery: prepared/attempting/uncertain/delivered/suppressed. attempted UUID/payload
and authorization are immutable. ever_attempted cannot decrease. Attempting requires
ever_attempted=1 and needs_rebuild=0. Unknown outcome verifies the original UUID;
absence does not prove safe resend. Existing UUID confirms delivery even after a
mobile edit; explicit deletion suppresses it permanently.

Matching: bank reference first, then target/day/signed amount/instrument across all
types with multiplicity. Equal-amount ordering is not category identity. Unique
split/settlement search has 16-part and 20,000-visit bounds. Ambiguous genuinely new
records follow create-new policy; uncertain old attempts do not become new records.

Prediction: current catalog (300 seconds), valid manual/rule first, otherwise at
least three independent reviewed consistent payments with no conflicts. Evidence
excludes chronological equal-amount ties, unsuitable transfers, settlements and
unreviewed predictions. Full mirror readiness requires account/instrument/tag/
transaction collections; only explicit deletion establishes a tombstone.

Reports compare current signed movements, both unmatched sides, over complete bank
coverage. Delivery failure and equal balances do not hide discrepancies.

## Gaps that must not be copied as guarantees

- Backend v1 generic start clears imported hold and generic resume clears exported
  hold. L3 replaces this behavior for format2 with guarded participant handoff;
  legacy commands cannot bypass the new gates.
- Existing format1 ZIP contains SQLite; it is not a browser interchange format.
- Backend instance_id travels with backups; physical installation identity is new.
- Browser in-memory queues currently coordinate only remote capture. They do not
  provide a local financial database, durable outbox or multi-generation fencing.
- Python recipient normalization uses NFKC + full Unicode casefold. JavaScript
  lowercasing is not equivalent. L2/L8 must pin cross-language casefold vectors or
  a documented, parity-tested implementation; no silent ASCII-only shortcut.
- Legacy metadata and inert archived rows may contain previously unclassified
  values. Portable export must classify/screen these instead of promising that a
  column-name allowlist alone excludes all historical secrets.
- Automatic category assignment on ZenMoney's side remains outside local control.
- Real installed-MV3 API access, minimum Chrome compatibility and local quotas are
  L1 gates, not facts established by the existing Node SDK tests.
