# Shared financial contracts

Version 1 pins the released Python behavior before the local TypeScript port.
The baseline is read from Git objects, never from an application database.

- `v1/baseline.json`: source commits, source/test hashes and the public SDK pin.
- `v1/sqlite-v7.json`: every table/column/check/index/foreign key/trigger, repository
  owner, named invariant case and portable disposition.
- `v1/http-routes-v1.json`: all API/health routes and source annotations.
- `v1/wire-v1.json`: generated current Pydantic schemas, including reports.
- `v1/application.json`: application operations independent of HTTP transport.
- `v1/rules.json`: financial rules, source evidence and planned acceptance cases.
- `v1/scenario.schema.json`: strict common behavioral scenario format.
- `v1/scenarios/`: specified expectations. A scenario is not a passing parity test
  until both runners actually implement and execute it.
- `v1/portable-v2.schema.json`: bounded manifest and typed scalar format.
- `v1/portable-policy.json`: logical table mapping, exact canonicalization, limits
  and explicit per-field runtime normalization.

Regenerate source evidence deliberately with `python3 scripts/freeze-business-contracts.py`.
Verify against pinned Git sources using `--check`. Do not regenerate expectations
merely because the implementation disagrees. Version changes require a reviewed
contract decision. Runtime-specific identifiers may be mapped; financial UUIDs,
attempt payloads and target ownership must remain exact.

Logical required keys are explicit even where SQLite's historical TEXT PRIMARY KEY
syntax permits NULL. The browser/importer must reject a NULL logical key; current
source DTOs already require valid IDs. This is an explicit validation tightening,
not a claim that all SQLite declarations contain NOT NULL.

Unknown metadata fails export classification, including `legacy:*`: historical
metadata/archived rows require an explicit secret-screened policy in L3. Preserving
audit history is not permission to export a legacy token. No arbitrary archived
SQL is executable.

Generated wire schemas capture declarative field constraints. Pydantic validators
such as positive nonzero amount, account/period consistency and unique page IDs
are additional semantic rules; JSON Schema validation alone does not reproduce
them. Those rules remain explicit in rules.json, source tests and common scenarios.

Full/incremental fixture raw JSON is UTF-8 text. Plain fixture JSON carries exact
IDs/amounts/timestamps as strings. Both runners use the fixture clock and UUID
sequence. This contract describes application semantics; it does not duplicate
the independent SDK API parity fixture suite.

L2 implements eight pure scenarios, 500 arithmetic vectors and 6,354 normalization
vectors in both runtimes. Stateful scenarios remain explicit unsupported cases
until their designated stages. See docs/local-mode/behavior-contracts.md for range
limits, exact encoding, the corrected Python precision defect and Docker commands.
