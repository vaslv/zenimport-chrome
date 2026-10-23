# Standalone candidate acceptance — 0.3.0

Date: 2026-10-22. Local preparation only; not published. This record supplements
[the scenario matrix](acceptance.md) and the sequential [progress log](progress.md).
Decision: required offline gates passed; ready for a separately authorized release.
Optional new live financial-write acceptance was not performed.

## Isolation and build inputs

All new tests use synthetic banks, SDK responses and tokens, clean Chrome profiles,
native IndexedDB and disposable SQLite files. Runtime containers have external
network disabled. Build dependencies and the npm audit use public registries.
Production containers, databases, tokens and bank sessions were not used.

The SDK is npm `zenmoney-typescript` 0.1.0 with the exact integrity in package-lock.json.
The Python reference uses public PyPI `zenmoney-python` 0.7.0 and its hash lock.
Pinned Docker bases and minimum Chrome 140.0.7339.80 binary SHA256 are in Dockerfile
and Dockerfile.integration. Current test browser is Playwright Chromium 145.
Implementation source: Chrome `d2e4e31`; backend candidate `533c8f6`.
The following documentation/CI/license commit completes the Chrome candidate.

## Evidence and remaining gates

| Scope | Result / evidence |
|---|---|
| Backend full suite | 826 passed after version bump; /tmp/l12-backend-final.log |
| TypeScript strict/generated schemas and unit suite | 280 passed; /tmp/l12-unit-final.log |
| Full native storage/application suite with actual Python reference | 514 passed, 4 explicit interop skips; /tmp/l12-local-full.log |
| The four skipped exchange tests | Separate financial/authority runners passed below; no silent acceptance of skips |
| Shared contracts | 8 scenarios, 500 exact arithmetic cases, 6354 Unicode vectors; /tmp/l12-contracts.log |
| Portable codec exchange | 49 tables, raw scalar comparison; /tmp/l12-portable.log |
| Financial SQLite/browser exchange including converted format 1 | 3 original + 3 installed cases, Python prepare/install/verify passed; /tmp/l12-financial.log |
| Authority SQLite/browser exchange | Three browser phases passed with Python exchange/handoff verification; /tmp/l12-authority.log |
| Product setup and popup/report regression | 15 passed current; /tmp/l11-reviewed.log |
| Minimum browser product setup, keyboard/labels/layout | 3 passed; /tmp/l11-min-visual.log; inspected 390px screenshot |
| Backend candidate image-only deployment | arm64 and amd64 passed; /tmp/l12-server-arm64.log, /tmp/l12-server-amd64.log |
| Production npm dependency audit | 0 vulnerabilities; /tmp/l12-dependency-audit.json |
| Actual Python built-product integration | All 14 scenarios passed across runs: first ZIP recovery in /tmp/l11-integration-aligned.log, 12 in /tmp/l11-integration-aligned-rest.log, final worker-stop test in /tmp/l11-integration-restart-final.log |
| Final local product + report parity | 14 passed; /tmp/l12-product-final.log |
| Minimum critical crash/transfer/repair/quota/recovery | 12 passed in /tmp/l12-min-critical.log; its old product-selector failure was fixed and the full product case passed separately in /tmp/l12-product-min-paced.log |
| Minimum financial and authority interop | All original/installed/exchange/activation phases passed; /tmp/l12-financial-min.log, /tmp/l12-authority-min.log |
| Candidate ZIP current/minimum UI | 19 current + 3 minimum passed; /tmp/l12-final-zip-ui.log, /tmp/l12-final-zip-min-ui.log |
| Reproducible candidate ZIP and artifact inspection | Identical final builds, 32 files, 342,289 bytes; test-results/local-mode/L12/artifact-inspection.json and /tmp/l12-final-build-{one,two}.log |

The full native run preceded the final empty-report-filter correction; its focused
product/report rerun is recorded separately. Timing changes in integration fixtures
wait for durable work and visible completion; no production timeout or financial
assertion is weakened.

## Matrix coverage

These are test-to-requirement references, not a claim that each table row is one test.
All prior stage results remain in progress.md; the full suite repeats their executable
native coverage. All required IDs are covered by the passing suites and prior stage evidence below.
A07 is historical read-only evidence; the optional L12 live write is explicitly not run.

| Matrix IDs | Executable / prior evidence |
|---|---|
| A01–A03 | build.py allowlisted assets, deterministic build; product setup tests under installed manifest CSP |
| A04–A06 | test_runtime, test_background_local, test_delivery_sender/worker; exact values and actual browser shutdown |
| A07 | Previously authorized L1 real MV3 read only, progress.md L1; not rerun and no live writes authorized here |
| A08 | test_control_api, test_credential_candidates, test_popup_standalone |
| B01–B12 | test_domain, test_storage*, test_snapshot, test_source_facts*, test_portable_format, test_transfer_budget; prior L1/L4 1k/10k/100k time/memory measurements |
| C01–C11 | test_application, test_standalone_facade, test_connections, test_account*, test_period_parity, test_control_api, test_credential_candidates |
| D01–D12 | test_capture*, test_connector_capture, test_mirror*, test_source_facts*, test_background_local |
| E01–E15 | test_reconciliation_parity, test_ownership_parity, test_known_parity, test_persisted_reconciliation, test_prediction_parity, test_category_cache |
| F01–F12 | test_delivery_intent_parity, test_delivery_authorization, test_authorization_queue, test_delivery_sender/worker, test_first_sync, test_outbox* |
| G01–G27 | test_authority*, test_switch_journal, test_restore, test_backup*, test_migration_remote, test_remote_archive_controller, test_remote_recovery_selection, test_local_archive_facade; separate financial/authority exchange runners |
| H01–H11 | test_popup_standalone, test_product_sync, browser/test_popup and test_discrepancies, test_report_parity, test_local_reports, test_runtime, test_control_api; artifact inspection |

## Compatibility

Chrome 0.3.0 requires backend 0.3.0 for all remote work, including an existing
server configuration, because ordinary calls require context fencing. Upgrade the
backend first. The new backend still supports ordinary API v1 for old clients.

## Review and limits

Independent review records: [popup](reviews/l11-popup-2026-10-22.md),
[backend/write boundaries](reviews/l12-backend-2026-10-22.md). Cross-model CLI
review was unavailable; no such coverage is claimed. Review does not prove an
absence of bugs.

No new live bank or mobile ZenMoney write acceptance was run. The optional controlled
live-write gate is deferred without authorization. Synthetic success does not prove
current bank-site compatibility or mobile UI behavior. A backup snapshot cannot
reconstruct facts created after it, and independently cloned writers require explicit
retirement. Browser storage is not a cloud backup. See [operation guide](operation-guide.md).

## Artifact and retained evidence

ZIP SHA256: `60357e564c342c7a16e2be5eac21c992bef83a936c24888c0a4a8867151b63fc`.
The final ZIP contains licenses for all five production npm packages (including
SDK transitive lossless-json), no tests/probes/source maps or synthetic credentials,
and manifest Chrome 140 / incognito not_allowed. This manifest setting follows
[Chrome's official reference](https://developer.chrome.com/docs/extensions/reference/manifest/incognito), checked through Context7.

The untracked local `test-results/local-mode/L12/` folder retains the named logs,
artifact metadata, exact SDK integrity and fixture SHA256s. It includes failed
attempts as diagnosis evidence, not passing results. Runtime image:
`zenimport-backend:0.3.0-local-amd64`, revision `533c8f6`.
The artifact can be installed manually from `dist/extension`; no existing user
profile was updated during acceptance.

CI's independent local-storage matrix has no Python source and intentionally skips
Python-dependent modules and exchange phases. The complete local actual-Python
suite and interop runners above supply that separate acceptance gate. No remote CI
run is claimed because no push occurred.

Backend image ID: `sha256:4f1c6a78d8a2bedbc51b49935be8b4ee64b29e7e5cd7d649d19e1a2b388837e4`.
Bank HTML fixture SHA256: `336f42d6b32593b20c874faec33ac7748b1c42a497780ef914a99c7f314124ef`.
BIDV HTML fixture SHA256: `8d237d0b40786b124be18fbee4b226f6cbfd14fbc2a39fb5104556ab5e6d1267`.

## Pre-release corrections — 2026-10-23

The earlier tables and ZIP hash describe the original acceptance snapshot. Seven
subsequent corrections are recorded individually in progress.md with local
commits, Docker checks and independent source review. Backend source remains at
533c8f6; no new backend-wide test run is claimed for these Chrome-only changes.

The corrections cover published mirror backup ownership, expired recovery
previews, offline account disabling, credential repair for held browser restores,
persistent migration errors, bounded source reuse and built-product recovery after
an independently committed create loses its reply. Performance measurements in
performance.md concern retained ZenMoney mirror history and 41 newly captured bank
transactions; they do not measure delivery of 100,000 new bank transactions.

Current Docker evidence: 291 unit tests, 4 native cache/volume cases, 92 focused
mirror/delivery/reconciliation cases, 63 additional backup/recovery/settings/UI
cases and 6 built-product popup/sync cases passed. The product restart scenario
also forcibly terminates the exact service worker while the independent synthetic
HTTP server holds its successful reply. The restarted profile must still contain
the dispatching grant and attempted immutable payload before native recovery;
no popup, status RPC or hand-created delivery alarm participates in recovery.
A fresh explicit synchronization must preserve the single creating POST.
The forced-stop rerun and its measured outcome are recorded in progress.md.
Independent review of the final changes: no findings. These runs use only synthetic
data and isolated profiles; production data/containers were not changed.

Revised ZIP SHA256: `abf2be069f55774b95bce1d97e165573ae7ccf0f6d6b1a967dafc4ab49af79ad`.
Two final builds were identical: 32 files, 344,741 bytes. Manifest remains Chrome
140 minimum and incognito not_allowed. Artifact inspection found no test/probe
files, source maps, fixture transport or synthetic credentials. The prior hash
above is historical. No push, Git tag, registry publication or remote CI run was
performed for these corrections.

## Publication CI harness correction — 2026-10-23

Cold GitHub runners revealed premature evaluations of probe workers and a
suite-wide memory peak polluted by earlier disposable profiles. The test helper
now waits for the probe's actual message acknowledgment before direct evaluation.
The Docker runner performs complete collection and runs every collected module
in its own offline 3 GiB cgroup, preserving all existing assertions and declared
interop skips. This changes test infrastructure only; the product ZIP is unchanged.
Successful complete matrix reruns remain required before publishing the extension.

The probe-only manifest also has a stable public development key, allowing a
genuine message to wake first-install workers as well as reopened profiles before
waiting for their Playwright target. The helper asserts the actual extension ID
and boot acknowledgment. This avoids relying on an already-missed cold-start
event; it does not retry financial tests or modify the product manifest/archive.

The restore benchmark now prepares its existing input archive once before timing
the actual restore pipeline. Previous measurement included creating a synthetic
ZIP twice, which a real restore does not do. All real verification, load/staging,
graph validation, preview, activation and the 180 s gate remain; setup and total
wall times are recorded separately. The 3 GiB memory gate still includes fixture
preparation. No distributed product code is changed by this probe-only correction.
