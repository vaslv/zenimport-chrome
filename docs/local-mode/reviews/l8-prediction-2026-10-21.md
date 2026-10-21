# L8.3 category policy checkpoint

Scope: pure reviewed-payment evidence, recipient profiles, explicit rules/manual
choices, confidence and own-payment exclusion. No cache persistence, SDK dispatch
or product local mode is enabled. The exact mirror adapter must retain original
numeric quantum in the scale flags before canonical amount normalization.

Independent API and adversarial reviews found one fail-open: ignoring a category
with a future-Unicode title hid a known conflicting category and could turn
three A payments plus one B payment into unanimous A evidence. The fix records
that unsupported title as a blocker, including payments[bank]=null so excluding
the current payment remains correct. Both final rechecks found no further issue.
These are independent same-model passes, not cross-model coverage.

Unicode behavior is deliberately conservative per the frozen L2 contract:
unsupported title evidence blocks automatic history confidence; manual/rule
choices retain their priority. Unsupported pending beneficiary names return no
automatic category. Recipient normalization evaluates the strongest available
identity first: irrelevant lower-priority future-Unicode text cannot hide a
known account's conflicting payment. Original bank text is retained unchanged.

A duplicate-tag hypothesis was rejected, not fixed: both released mirror owners
already reject duplicate tag IDs before projection. An invalid source test was
removed and no backend change remains. The pure policy is additionally defensive
if such a manually constructed input is provided: it retains ambiguity and emits
one evidence edge per logical key. This is not an assertion that a malformed SDK
response becomes accepted. The backend full Docker gate passed 766 tests after
restoring its unchanged source.

Native/Python comparison covers 25 actual SQLite evidence/prediction cases:
thresholds, both directions, current mobile category changes, unreviewed/held/
deleted/transfer/debt/incompatible movements, original decimal scale, chronological
pair exclusion, shared UUIDs, splits, manual/rule conflicts, exclusions, historical
bindings and freshness. Evidence rows and decisions are compared separately;
financial IDs and amounts are unchanged. Fixture setup respects immutable receipts
by creating the desired history instead of updating/deleting old confirmations.

Docker strict types and 207 unit/contracts passed; actual Python/native adapter
passed 25 cases in 20.39s with one existing dependency warning. Logs and remaining
L8 repository work are recorded in progress.md. No real API or production data,
push, tag or publication was used.
