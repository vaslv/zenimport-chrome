# Publishing ZenImport Chrome on GitHub

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
and the build writes `dist/SHA256SUMS` and prints SHA256. Verify it with
`(cd dist && shasum -a 256 -c SHA256SUMS)` on macOS or `sha256sum` on Linux.

`.github/workflows/ci.yml` uses Docker with synthetic services, no real bank/ZenMoney,
and retains the ZIP and checksum file. CI never uploads to the Store, creates tags, or creates GitHub
Releases. Backend integration acceptance is separate:
`./scripts/test-integration.sh ../ZenImportBackend`; this needs both checkouts,
whereas the finished extension build needs only this repository.

After separate permission: check clean Git state/history for secrets, push prepared
commits without force, and wait for CI. GitHub Release requires separate tag/push and
publication permissions; attach only the verified ZIP and `SHA256SUMS`. Verify the
downloaded release assets against the local build after upload. Release notes must
link to [installation and manual update instructions](installation.md), state the
supported bank and minimum backend/browser versions, and disclose deferred mobile
acceptance. This document
itself publishes nothing.

`zenmoney-python==0.7.0` is published on PyPI. Backend 0.1.0 is published at
`ghcr.io/vaslv/zenimport-backend:0.1.0` with that pinned SDK dependency; the extension
connects to the backend HTTPS address and API_TOKEN. The joint Docker checks install
the SDK from the backend's hash-locked PyPI requirement, not a sibling SDK checkout.
Never enter a ZenMoney token into the extension.
Data details: [PRIVACY.md](../PRIVACY.md).
