# Publishing ZenImport Chrome on GitHub

Repository: https://github.com/vaslv/zenimport-chrome. MIT license.
Version 0.3.0 uses a GitHub Release with ZIP and SHA256SUMS; no Chrome
Web Store publication. [Release](https://github.com/vaslv/zenimport-chrome/releases/tag/v0.3.0).
[Release notes and upgrade requirements](release-0.3.0.md).
Local origin points to the created repository; its original license is preserved.

```sh
./scripts/test-docker.sh
sh scripts/build-docker.sh
```

Load `dist/extension/` through chrome://extensions in Developer mode.
The versioned ZIP contains only bundled extension assets, LICENSE, and
PRIVACY.md; it excludes server settings, .env, test data, logs, SQLite, and local
browser profiles. Builds are reproducible: ZIP file ordering/timestamps are fixed,
and the build writes `dist/SHA256SUMS` and prints SHA256. Verify it with
`(cd dist && shasum -a 256 -c SHA256SUMS)` on macOS or `sha256sum` on Linux.

`.github/workflows/ci.yml` uses Docker with synthetic services, no real bank/ZenMoney,
and retains the ZIP and checksum file. The local-storage matrix runs current and
minimum-browser checks without the Python backend: Python parity/controller modules
and explicit interop phases are skipped there. Complete actual-Python and archive
exchange acceptance remains a separate gate with both checkouts. CI never uploads to the Store, creates tags, or creates GitHub
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

`zenmoney-python==0.7.0` is published on PyPI. Backend 0.3.0 is distributed at
`ghcr.io/vaslv/zenimport-backend:0.3.0` with that pinned SDK dependency; the extension
connects to the backend HTTPS address and API_TOKEN. The joint Docker checks install
the SDK from the backend's hash-locked PyPI requirement, not a sibling SDK checkout.
Server mode keeps its ZenMoney token on the server. Version 0.3.0 accepts a
ZenMoney token in **ZenMoney connection** for browser mode; **Server connection**
still takes only the backend API token.
Publish compatible backend 0.3.0 migration support before extension 0.3.0.
These build/check commands do not publish either project by themselves.
Data details: [PRIVACY.md](../PRIVACY.md).
