# Acceptance and failure-injection matrix

Status: planned tests, **not executed** by this design task.
Implementation stages reference these IDs in their progress records.

## Test layers and evidence

1. Pure domain tests: exact arithmetic, identity, dates and state transitions.
2. Shared fixtures: Python reference and TypeScript domain implementations produce
   the same specified outcomes, portable state and external write intents.
3. Repository tests: actual SQLite and actual IndexedDB, including constraints,
   transactions, upgrades and recovery. An in-memory IndexedDB imitation cannot
   establish browser durability.
4. MV3 integration: install the **built extension** into a disposable real browser,
   use synthetic bank pages and a controllable fake ZenMoney HTTP service.
5. Migration integration: a disposable backend container, one or two disposable
   browser profiles, shared fixtures and independent external request journal.
6. Separately approved live test-account checks: distinguish these from all
   synthetic evidence. Never use production bank/account history for automated QA.

Use existing Docker recipes as the starting point. Pin Node, Python, browser and
dependency versions. Avoid unbounded network installs in the test phase; obtain
dependencies in a controlled build step. Mock external financial services and
deny outbound test network access except explicitly configured internal fixtures.

The fake ZenMoney service stores requests and resulting remote data outside the
extension process. It can accept a write then drop the response, partially accept
a batch, delay a reply, return invalid data and respond with controlled errors.
After killing the browser, its record remains independently inspectable.

Every scenario specifies:

- Fixture/contract version and initial portable dataset hash.
- User/connector/API events, deterministic clock and fault point.
- Allowed external requests and exact expected UUIDs/payloads.
- Expected visible status, coverage, receipts and active/paused dataset.
- Final state/invariants and any intentionally unresolved condition.

Inject clocks and UUID generators in both engines. Declare mappings only for
runtime-specific identities; do not normalize away transaction UUIDs, amounts,
attempt payloads or target ownership to make divergent engines appear equal.

Assert exact request multiplicity; “same balance”, “same transaction count” or
“no exception” alone does not prove safe synchronization.

## A. Build and browser platform

| ID | Scenario | Required result | Gate |
|---|---|---|---|
| A01 | Build from clean lockfile twice | Deterministic distributable content; no unpublished SDK/local path dependency | L1/L12 |
| A02 | Install ZIP in minimum/current browser | Popup, worker, content scripts and local bundle load under manifest CSP | L1/L12 |
| A03 | Inspect packaged scripts | No remote executable code, eval, Node-only runtime, credentials or test fixtures | L1/L12 |
| A04 | Token/large exact value passes SDK→storage→DTO | Exact decimal/ID strings preserved; no `bigint` messaging failure | L1/L2 |
| A05 | Worker dies; alarms disappear | Startup recreates scheduler; journal determines remaining work | L1/L9 |
| A06 | Popup closes; then browser exits/restarts | Accepted operation persists; no expectation of execution while Chrome is closed | L9/L12 |
| A07 | Real API read from installed MV3 with test token | Correct identity/full read, no write; actual origin/permission verified | L1 live gate |
| A08 | Permission denied/revoked | Clear setup/status; no fallback route or unauthorized request | L1/L11 |

## B. Exact data and storage

| ID | Scenario | Required result | Gate |
|---|---|---|---|
| B01 | 24 integer/12 fractional bank digits, large IDs, negative movement | Exact arithmetic and validation; amount magnitude/direction remain distinct | L2 |
| B02 | Empty/null/missing values, UTF-8 descriptions, raw JSON unknown fields | Lossless portable representation; invalid shape rejected | L2/L4 |
| B03 | Crash halfway through multi-store financial write | All or none; no receipt without its required facts | L4 |
| B04 | Duplicate unique key or missing foreign record | Rejected atomically with stable error; no partial secondary index | L4 |
| B05 | Change/delete immutable attempt/receipt/tombstone | Repository refuses; invariant checker catches malicious imported state | L4 |
| B06 | Terminal processing reset to pending | Refused; no accidental resurrection | L4 |
| B07 | Upgrade interrupted/versionchange blocked by another page | Old state remains recoverable; clients close/reload gracefully | L4 |
| B08 | Quota/disk failure during capture/import | No completion ACK/activation; old data retained | L4/L7/L10 |
| B09 | Initialized config but missing/corrupt financial DB | Recovery-required state; no silent creation of empty writer | L4 |
| B10 | 1k/10k/100k and near-limit archives | Bounded chunks, recorded memory/time, no oversized worker task | L1/L4/L12 |
| B11 | Stale derivation tries committing after generation changes | Fenced rejection; new generation is untouched | L4/L8 |
| B12 | Crash between external sentinel and DB setup; IDB loss after token removal | Explicit setup/recovery, never silent empty initialization | L4 |

## C. Identity, connection and periods

| ID | Scenario | Required result | Gate |
|---|---|---|---|
| C01 | Upgrade configured 0.2.1 extension | Remote mode/config/jobs retained, local mode not activated | L5 |
| C02 | Clean install | Local setup selected; token/mapping required before synchronization | L11 |
| C03 | Same bank, two logins, multiple accounts | Correct automatic profile, canonical account and per-account target | L7 |
| C04 | Same physical account observed through two profiles | One financial account/transaction identity, multiple memberships | L7 |
| C05 | Same holder name, different primary account | No merge solely by name; known memberships govern identity | L7 |
| C06 | Bank account remapped after prior delivery | Preserve original target receipt and historical binding | L7/L8 |
| C07 | Token rotated for same owner; different owner token | Same owner preserves history; other owner cannot adopt it | L6 |
| C08 | 30 days, six calendar months, custom date, first vs later sync | Exact frozen period precedence, timezone/leap/month-edge behavior | L7 |
| C09 | Incomplete interval then gap recovery | Watermark does not skip missing coverage | L7 |
| C10 | Backend unavailable | Remote remains remote; no local automatic fallback | L5/L10 |
| C11 | Restart/rotate/remove token with prepared or in-flight requests | Verified token survives restart; fenced removal blocks new sends and retains uncertainty | L6/L9 |

## D. Capture and mirror

| ID | Scenario | Required result | Gate |
|---|---|---|---|
| D01 | Lost job-start acknowledgment | Same idempotency request recovers original job | L5/L7 |
| D02 | Lost page acknowledgment | Same page accepted once; different bytes under same page key rejected | L7 |
| D03 | Changed bank account/document/lease | Reject stale page; preserve previous committed capture | L7 |
| D04 | Bank totals/pages incomplete or connector stops | No false complete coverage or creation authorization | L7 |
| D05 | Full diff omits required collection | Mirror not marked ready; prior trusted facts retained | L6 |
| D06 | Incremental diff omits unchanged collection | Not interpreted as deletion | L6 |
| D07 | Deleted transaction later absent from full mirror | Tombstone persists; deleted operation not recreated | L6/L9 |
| D08 | Two diff responses arrive out of order | Only valid generation/cursor commits | L6 |
| D09 | Full mirror on imported/rotated context | Correct owner check; cursor/projections atomic; old audit retained | L6/L10 |
| D10 | HTTP429, auth error, network timeout, malformed JSON | Durable bounded recovery; no fabricated financial response | L6/L9 |
| D11 | Mirror exceeds negotiated response/storage bound | Clear error; no partial cursor advancement or false success | L6 |
| D12 | Bank capture commits while a large mirror is staged | Mirror publication preserves new bank/outbox facts and checks its own cursor generation | L6/L7 |

## E. Matching, transfer ownership and categories

| ID | Scenario | Required result | Gate |
|---|---|---|---|
| E01 | Expense, income, refund, debt and transfer with equal target movement | Match on target/day/sign/currency/amount independent of transaction type | L8 |
| E02 | Three identical bank amounts and two remote movements | Consume two correctly; exactly one unmatched bank occurrence | L8 |
| E03 | Similar references but different account/day/amount | No unsafe match caused by description alone | L8 |
| E04 | Existing own-account transfer, only one bank synchronized | Preserve correct leg; external counterpart need not be captured | L8 |
| E05 | Add second bank later and capture opposite leg | Associate with existing transfer without another create or rewriting mobile data | L8 |
| E06 | Cross-currency transfer | Match each leg using its own exact amount/currency | L8 |
| E07 | Old receipt target differs from current account mapping | Historical actual target preserved; no duplicate/false ownership repair | L8 |
| E08 | Split or settlement group | Sum, multiplicity and membership match documented bounds | L8 |
| E09 | Ambiguous candidate or bounded search exhausted | Deterministic create-new policy for genuinely new rows; reason retained | L8/L9 |
| E10 | Unknown prior attempted UUID | Never reclassified as a new row by ambiguous matching | L8/L9 |
| E11 | User changes amount/type/category or deletes in ZenMoney | No overwrite or resurrection; report shows remaining mismatch if appropriate | L8/L9 |
| E12 | Corroborating transfer evidence added/removed over time | Safe relation updates using proof; never invent historical target | L8 |
| E13 | Reliable reviewed category evidence/rule | Same prediction as Python with explicit provenance | L8 |
| E14 | Conflicting, stale, unreviewed or self-predicted evidence | No confident category; no feedback loop | L8 |
| E15 | No predicted category | Send agreed no-category representation; do not promise ZenMoney won't auto-categorize | L8/L9 |

## F. Delivery and irreversible outcomes

| ID | Fault point | Required result | Gate |
|---|---|---|---|
| F01 | Before persisted intent | No remote request; subsequent work creates one stable intent | L9 |
| F02 | After intent/attempt but before dispatch | Conservative recovery; no new UUID; distinguish proven unstarted only if journal proves it | L9 |
| F03 | During request, server accepts then connection drops | Verify original UUID; one external operation | L9 |
| F04 | After response, before local receipt | Fresh read recovers known UUID; no resend | L9 |
| F05 | Some batch members accepted, response400/500 | Individually verify; never retry whole batch blindly | L9 |
| F06 | Remote user edit immediately after create | Known UUID still confirms original delivery | L9 |
| F07 | Remote deletion immediately after create | Tombstone suppression; no recreation | L9 |
| F08 | Two workers/events claim delivery | Transactional fenced ownership allows one dispatch | L9 |
| F09 | Lease expires while request is uncertain | New owner verifies, never overlaps the old uncertain write | L9 |
| F10 | Repeated alarms/manual Synchronize/reopened popup | Same retained evidence; no extra create | L9 |
| F11 | Auth/network retry after mode switch | Old context cannot send into new dataset/endpoint | L9/L10 |
| F12 | New genuinely unmatched transaction | Correct sign, target, date, exact amount and `viewed=false` | L9 |

## G. Portable archives and mode switching

| ID | Scenario | Required result | Gate |
|---|---|---|---|
| G01 | SQLite→browser→SQLite; reverse direction | All portable facts match plus declared runtime normalizations | L3/L4/L10 |
| G02 | Receipts/tombstones/uncertain batches/transfer targets in archive | Subsequent sync does not replay or resurrect | L4/L10 |
| G03 | Wrong owner, unsupported schema/feature | Reject before activation, source retained | L3/L4 |
| G04 | ZIP corruption/traversal/duplicate entry/zip bomb | Bounded rejection, no executable content or writes outside staging | L3/L4 |
| G05 | Unknown table/column/meta key | Explicit compatibility failure, no silent loss | L3/L4 |
| G06 | Used target receives import | Reject; joining is a separate no-merge operation | L3/L10 |
| G07 | Identical import retried after lost success | Same durable receipt, no duplicate imported rows | L3/L10 |
| G08 | Different import while initial hold exists | Reject, no target overwrite | L3/L10 |
| G09 | Lost chunk/status response, worker/popup restart | Resume by hashes/status or remain safely paused | L10 |
| G10 | Crash before source pause | Source remains valid active mode; destination cannot write | L10 |
| G11 | Crash after source pause/before import | Source paused, recoverable export; no destination writer | L10 |
| G12 | Crash after import/before local active pointer | Destination held; source held; verify receipt before continuing | L10 |
| G13 | Crash after activation/before cleanup | One selected mode; old snapshot never automatically active | L10 |
| G14 | Cancel before/after source handoff | Before: win source cancel CAS, discard destination, resume. After: forward recovery/new reverse migration only | L10 |
| G15 | Remote→local with old local history | Fresh generation, explicit backup/replacement; no merge/resume-old shortcut | L10 |
| G16 | Shared server, other client sends during export | Global hold/claim barrier serializes transition | L3/L10 |
| G17 | Disconnected old client reconnects | Sees hold/epoch before any write; no stale job resurrection | L10 |
| G18 | Source token/URL/instance identity copied in archive | Credentials absent, new runtime identity, lineage preserved | L3/L4 |
| G19 | Legacy format1 archive | Supported conversion route; unsupported direct browser import explained | L3/L10 |
| G20 | Unchecked transfer checkbox on local history | Clear risk acknowledgment and no sync as a connection side effect | L10/L11 |
| G21 | Legacy `/jobs` or `/migration/resume` during v2 transfer | Cannot clear import/export/handoff state or dispatch financial writes | L3/L10 |
| G22 | Delayed activate/discard/resume from cancelled or prior session | Switch ID/epoch/tombstone rejects stale transition; no second writer | L3/L10 |
| G23 | Reverse migration from used/offline server without archive | No empty-start or stale-local escape; require current export | L10 |
| G24 | New mode transition to legacy server; existing legacy remote upgrade | New transition requests capability upgrade; existing ordinary remote still works | L5/L10 |
| G25 | Cancel races handoff; either reply is lost | One source CAS decision wins; never handed-off source plus discarded destination | L3/L10 |
| G26 | Backup-only recovery after profile/source loss | Explicit retirement declaration, fresh target, owner/mirror check, read-only summary, deliberate activation | L10/L12 |
| G27 | Snapshot predates later source activity | Explain snapshot limit; preserved receipts remain immutable; no claim to reconstruct absent evidence | L10/L12 |

Migration assertions must include absence of concurrent send authority, not merely
the value of `activeMode`. Compare source/destination holds and dispatch journal.
Two unrelated manually cloned datasets are outside automatic mutual exclusion;
documentation must not imply that a ZIP implements a global distributed lock.

## H. UI, reporting and privacy

| ID | Scenario | Required result | Gate |
|---|---|---|---|
| H01 | Required vs completed setup | Required section open; configured sections collapsed | L11 |
| H02 | Close popup while entering token/address | Draft restored; secrets not shown in status/logs | L11 |
| H03 | Match blocked/delivery impossible, bank+mirror available | Report still shows both unmatched sides over valid coverage | L8/L11 |
| H04 | Equal daily/account totals but different transactions | Rows remain visible; balance does not dismiss discrepancies | L8 |
| H05 | Missing/partial bank coverage | Explain limits; do not claim all remote rows are extras | L8 |
| H06 | Refresh report | Only reads/mirror work, zero financial writes | L11 |
| H07 | Popup narrow viewport, keyboard, invalid token, migration progress | No clipping; meaningful focus/status; stable compact layout | L11 |
| H08 | Malicious bank message/page or data text | Narrow message validation, no token access, HTML rendered as text | L5/L11 |
| H09 | Export/logs/bundle inspected | No bearer tokens, cookies, password drafts or private test data | L12 |
| H10 | Incognito and deleted browser profile | Explicit unsupported/recovery behavior; no accidental shared local writer | L11/L12 |
| H11 | Secret draft saved/cancelled/removed/expired | Session draft erased; active token follows explicit persistent policy | L6/L11 |

## Release gate record

At L12 create an English report containing:

- Source commits, SDK version/integrity, images/browser versions and fixture hashes.
- Passed/failed/not-run IDs with evidence paths; no silent skips.
- Built ZIP checksums and clean-install/upgrade outcomes.
- Shared-state comparison and exact fake-service write-count results.
- Live-account evidence labeled separately, with sensitive details excluded.
- Open limitations and a concrete decision on release readiness.

Each earlier stage records its subset. Running a later full suite does not erase
an unresolved live browser or minimum-version gate.
