# L2: executable cross-language behavior contracts

Canonical source: `contracts/business/v1/`. The backend carries an exact copy in
`fixtures/business/v1/`, pinned by `fixtures/business/revision.json`. Each artifact
is hashed in the shared manifest. A missing, extra or modified file fails the
gate; matching only a version number is insufficient. L0 source evidence remains
pinned to its original Git objects, even after correcting a source-domain defect.

Run `sh scripts/test-business-contracts.sh ../ZenImportBackend`. This builds both
runners in isolated Docker, disables networking at execution, compares independent
expectations and then compares actual results/digests between implementations.
Each repository's ordinary Docker suite also validates its own pinned contract.

## Executed now

- Eight ordered pure scenarios: large amounts, cancellation, numeric equality,
  boundary/errors, recipient identity, calendar/timezone behavior, both transfer
  sides and lossless wire/canonical DTO digests.
- Five hundred seeded independent Python Decimal vectors; TypeScript also checks
  inverse, commutativity and sign properties. The generator is
  `scripts/generate-arithmetic-vectors.py`; changing expectations requires review.
- All 6,354 Unicode 15 characters whose NFKC/casefold/whitespace result changes,
  plus multi-character composition, Greek sigma, sharp S and whitespace cases.
- Deterministic clock/UUID dependency containers. Pure operations do not read the
  host clock or generate IDs. A stateful scenario cannot silently ignore its
  state assertions, injected fault or UUID sequence.
- The pure scenarios and vector sets run inside the installed offline MV3 worker
  in both supported browser targets, in addition to Node/Python execution.

Four stateful specifications describe mirror deletion, matching multiplicity,
uncertain delivery and migration identity. They intentionally fail with
unsupported_command/unsupported_scenario until their designated stages implement
real adapters. They are not passing storage/delivery tests. L3–L10 expand these
fixtures and the historical regression matrix with complete stateful inputs.

## Numeric and wire decisions

`ExactMoney` uses a normalized BigInt coefficient/scale. Addition, subtraction,
comparison, equality and sign never use Number arithmetic on a monetary value.
Bank input retains the frozen lexical limits of 24 integer/12 fractional digits,
positive magnitude and currency-scale validation before normalization. A VND
amount `1.0` is rejected rather than rounded to `1`.

Internal arithmetic and known SDK financial projections support up to 96 integer
and 96 fractional digits, with a bounded 256-character input. Exponent tokens are
expanded only after their resulting range is checked. Out-of-range projections
fail explicitly; SDK raw text/unknown fields are not silently rounded or changed.
Aggregated values may exceed the bank-input bound. No currency rounding policy is
invented. API output uses SDK ExactDecimal; domain values prohibit implicit Number
coercion. Calculation output is a canonical plain decimal string; original raw
bank/SDK strings remain separate evidence.

Chrome message DTOs contain string IDs, exact amount strings and bounded integer
counters. Raw JSON uses the published SDK codec. Canonical capture-policy DTOs use
Python-compatible code-point key sorting and ASCII escaping; they reject floats,
unsafe integers, accessors, cycles, sparse arrays and lone surrogates, with depth,
node and byte budgets. Portable format-2 UTF-8 canonical encoding is a separate
L3/L4 contract. The Python SDK's formatter whitespace is removed lexically for
the wire-roundtrip fixture; no quoted content or numeric token is rewritten.

## Identity and dates

Recipient prediction keys use Python Unicode 15 NFKC + full casefold, not lowercase.
The generated fold/range table is in `src/domain/unicode-data.ts`; regenerate with
`scripts/unicode-contract.py` in the pinned Python 3.12 image. Unicode notices ship
with the artifact. Newer/unassigned characters produce unsupported_unicode for
prediction normalization, avoiding browser-ICU-dependent keys. They remain valid
raw history: L8 must skip unsupported prediction evidence, not reject a bank row.
Identifiers and financial UUIDs are never case-folded as recipient names.

Dates are explicit calendar strings and offset timestamps; local days use the
bank timezone. Month shortcuts clamp calendar days instead of assuming 180 days.
Date arithmetic uses numeric calendar metadata, separately from money arithmetic.

## Source correction

The high-precision movement fixture failed against the old Python source:
`100.000…001` became `100` under its fixed 80-digit context, creating a possible
false match. Backend commit 4f30c02 adds bounded exact contexts/sums and regression
tests for matching, report totals and reviewed cleanup. Its supported decimal span
is explicitly bounded at 8,192 digits; unsupported ranges fail instead of rounding.
Source expectations were not changed to reproduce the bug. No production data,
live financial writes or production deployment was part of this correction.
