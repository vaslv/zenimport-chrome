# L8 source adapter review — 2026-10-21

Scope: bounded optimistic source collection and exact stored-row/domain boundary.
Both independent API and adversarial reviewers finished with NO FINDINGS after
corrections. No external cross-model review is claimed.

Corrected before commit:

- Tag direction flags such as JSON `0.0` decode to ExactDecimal; Python considers
  that equal to zero. The adapter now uses exact JSON-value numeric equality,
  preserving the distinction between null/default (allowed) and zero (disabled).
- Legacy `raw.details` uses Python truthiness fallback, including empty arrays,
  false, zero and empty strings accepted by the existing migration/proof contract.
  A valid old version no longer blocks all later source reconstruction.

Known financial values pass through the published SDK's lossless decoder and
ExactMoney, never Number. Original decimal quantum is checked before canonical
normalization for learning. Historical rows preserve canonical identity and
recover legacy signed minor units. A permanent tombstone that reappears stays in
blocking ownership input but never in eligible matching or reviewed evidence.

Docker: strict types/generated contracts and 211 unit checks passed. Actual
Python/raw SDK mirror plus native-IDB current/historical capture tests passed
2 cases in 2.78s (existing dependency warning only). The raw comparison covers
24-digit amounts, 12-decimal limits, original quantum, tiny scientific decimals,
FX, null category directions and decimal zero. Private probe is excluded from ZIP.
Logs: /tmp/zenimport-l8-facts-unit*.log, /tmp/zenimport-l8-facts-parity*.log.

No live account, financial API writes, production data/service changes or publish.
