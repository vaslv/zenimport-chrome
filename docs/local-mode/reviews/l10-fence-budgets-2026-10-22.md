# L10 whole-path fence budget correction

Major-gate review found that checking only the next increment could acquire an
unfinishable hold near signed int64 exhaustion. Live transfers now reserve two
Root routing increments and one credential increment before journal creation,
destination reservation and source hold. Pending destination token repair retains
one further credential increment for activation. Join reservation checks its final
routing/credential increments before capture quiescence.

Source participant start reserves four increments (start, seal, cancel, resume),
while destination start reserves three (start, arm, activate/discard), in both
TypeScript and Python. Remote preflight and native source journal creation reject
insufficient budgets before source preparation. Exact last-safe paths complete or
cancel without resetting a counter or changing its representation.

Independent adversarial reread reported no remaining budget findings. Other
major-gate findings (native restore TTL and stale initial Root race) remain separate
open corrections; this review does not declare L10 complete. External cross-model
CLI unavailable. Docker checks cover over-limit rejection with no Root/journal
change, final valid transfer/cancellation, and token repair preserving the reserved
activation increment. Timing and evidence are recorded in progress.md.
