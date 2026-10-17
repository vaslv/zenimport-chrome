# Preparing ZenImport Chrome for GitHub

Repository: https://github.com/vaslv/zenimport-chrome. MIT license.
Unpacked build and ZIP 0.1.9 are prepared; no Chrome Web Store publication.
Local origin points to the created repository; its original license is preserved.

```sh
./scripts/test-docker.sh
python3 scripts/build.py
```

Load `dist/extension/` through chrome://extensions in Developer mode.
`dist/zenimport-chrome-0.1.9.zip` contains only extension sources, LICENSE, and
PRIVACY.md; it excludes server settings, .env, test data, logs, SQLite, and local
browser profiles. Builds are reproducible: ZIP file ordering/timestamps are fixed,
and the build prints SHA256.

`.github/workflows/ci.yml` uses Docker with synthetic services, no real bank/ZenMoney,
and retains the ZIP. CI never uploads to the Store, creates tags, or creates GitHub
Releases. Backend integration acceptance is separate:
`./scripts/test-integration.sh ../ZenImportBackend`; this needs both checkouts,
whereas the finished extension build needs only this repository.

After separate permission: check clean Git state/history for secrets, push prepared
commits without force, and wait for CI. GitHub Release requires separate tag/push and
publication permissions; attach only the verified ZIP and its SHA256. This document
itself publishes nothing.

Publish `vaslv/zenmoney-python` (zenmoney-python package) first, then the backend with
its pinned SDK dependency; the extension connects to the backend HTTPS address and
API_TOKEN. Never enter a ZenMoney token into the extension.
Data details: [PRIVACY.md](../PRIVACY.md).
