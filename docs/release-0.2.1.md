# Chrome 0.2.1 — release preparation

Status: prepared locally, not published. The last published release is 0.2.0.
No Git tags, GitHub releases, pushes or Chrome Web Store submissions were made.

## Changes and requirements

See [CHANGELOG](../CHANGELOG.md). This version requires backend 0.2.1 or newer
for both banks. Upgrade the backend before the extension. Desktop Chrome 120+
remains required. BIDV supports the English VND payment-account interface; other
currencies and account types are not certified. Bank sessions are user-managed.

## Installation after publication

Download `zenimport-chrome-0.2.1.zip` and `SHA256SUMS` from the separately authorized
GitHub Release, verify the checksum and extract into the same permanent directory
as the existing unpacked extension. Click Reload in chrome://extensions and reopen
the bank page/popup. Do not uninstall: that would discard browser-local settings.
ZIP distribution has no automatic updates. Review account mappings before syncing.

Initial import uses the date saved per account; changing Synchronization period
explicitly overrides it. Repeated synchronization defaults to 30 days. Select
Do not import and save to stop importing an account; the choice survives discovery
and applies to shared physical accounts across connections.

## Artifact and validation

Build with `python3 scripts/build.py`. Release assets are the versioned ZIP and
`dist/SHA256SUMS`. The ZIP contains only extension files, LICENSE and PRIVACY.md;
server tokens, bank history, tests and development settings are excluded.
The two local builds produced identical SHA256:

```text
df9b4009e41821eed75d0b20c8eda51c9e803c0764e5071d8e60f2333ecf1751  zenimport-chrome-0.2.1.zip
```

Docker unit tests: 54 passed. Independent browser suite: 14 passed, two expected
integration-only skips. GitHub workflow lint and tracked-source secret scanning
passed. The archive contains 28 files; manifest/package versions both equal 0.2.1.
The final joint real-backend/fake-ZenMoney suite passed all 30 tests in Docker.
Only the existing upstream Starlette/httpx deprecation warning remains.

Tests use disposable Docker databases, synthetic bank pages and fake ZenMoney.
They do not modify a production service or prove the mobile application's UI.
Prior live bank observations are documented separately in connector/progress docs.

## Publication after separate authorization

Push the reviewed commit, wait for Chrome CI, then create the authorized tag and
GitHub Release with the exact verified ZIP and SHA256SUMS. Confirm the downloaded
release matches local checksums. Publish only after backend 0.2.1 is available and
its registry digest has passed native AMD64/ARM64 acceptance.
