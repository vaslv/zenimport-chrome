# ZenImport Chrome

Local **0.2.0** adds **Settings → Data migration**: export one ZIP, connect to a new
backend, and import before its first sync. Requires backend 0.2.0+; not included
in the published 0.1.9 release. [Migration instructions](docs/data-migration.md).

An independent MV3 extension. Reads history from an open online banking session and sends it to ZenImportBackend. Users review financial transactions in mobile ZenMoney.

## Install

Download the ZIP and `SHA256SUMS` from [GitHub Releases](https://github.com/vaslv/zenimport-chrome/releases), verify the checksum, and extract the ZIP into a permanent directory. In desktop Chrome 120 or newer, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**. Select the extracted directory containing `manifest.json`. The ZIP is not installed directly and this distribution does not update automatically.

Follow the [installation and update guide](docs/installation.md) to connect your backend, select bank accounts, and synchronize. Currently supported: **VietinBank VND current-account history**. The extension requires ZenImportBackend 0.1.0 (API v1); see the [published backend deployment guide](https://github.com/vaslv/zenimport-backend/blob/main/docs/container-release-0.1.0.md).

Keep the same installation directory when updating and click **Reload** on the extension card. Do not uninstall the extension if you want to retain its local settings and capture checkpoints. GitHub ZIP installation is separate from Chrome Web Store publication.

## Build from source

Neighboring projects: `ZenImportBackend`, `ZenMoneyAPI`. Extension builds do not require their source.

`python3 scripts/build.py` creates a reproducible ZIP, `dist/SHA256SUMS`, and `dist/extension`. Open `chrome://extensions`, enable Developer mode, and load this directory as an unpacked extension. Disable any separate legacy extension first. In the popup, enter the server address and **backend token**, not the ZenMoney token. HTTPS is mandatory except for localhost/127.0.0.1. Bank credentials are never sent to the server.

Plan and actual limitations: `docs/refactor/03-extension.md`, `docs/refactor/05-progress.md`. No Store publication is performed.

## Synchronization

Open history for the desired bank account. On first connection, select a ZenMoney account or Do not import and a date (default: 30 days ago). A complete VietinBank account list is not yet verified: open other accounts and refresh the list. Configured accounts can synchronize while new ones remain unconfigured.

Synchronize authorizes capture and delivery of all missing transactions for configured accounts. The server adds only confidently known categories; every new record has viewed=false. Mobile changes/deletions are final. Pausing/closing the tab preserves pages; to resume, reopen history and click again. Stop capture does not undo sent records or revoke delivery of authorized complete intervals.

For a one-time older import, set its start date before clicking. It clears after complete capture. Ordinary synchronization uses the server's previous complete boundary with a 14-day overlap rather than rereading all history.

Chrome 0.1.8 capture/delivery was verified against actual VietinBank; results are in the [acceptance log](docs/refactor/05-progress.md). Mobile New-tab, edit, and deletion checks remain separately deferred. Automated tests use only synthetic banks, ZenMoney, and databases.

## Checks

`./scripts/test-docker.sh`: independent unit/popup checks. `./scripts/test-integration.sh ../ZenImportBackend`: joint validation with the actual backend and fake ZenMoney; only this needs neighboring source. Containers have no external networking. Detailed boundaries: docs/testing.md.

To update an already loaded unpacked build, rebuild dist/extension, click Reload on the ZenImport card in chrome://extensions, and reopen the popup. Prepared version: 0.2.0; last public release: 0.1.9. If a copied directory elsewhere was loaded, replace it with the new build first.

Unfinished server address/token input is restored after popup closure. Drafts stay only in private extension session storage until successful connection or Chrome/extension reload. They never connect automatically and are inaccessible to the bank page.

If an invalid backend token pauses capture, enter a new token for the same server address and reconnect. Jobs/captured pages survive; resume using Synchronize from the current bank history tab. Server switching during unfinished capture is blocked.

Configured settings are collapsed when opening the popup; incomplete connection, new accounts, or unavailable mappings expand the appropriate section. Saving the last account collapses settings. Connection settings can be expanded manually.

Below Synchronize, the popup shows the last successful synchronization's local date/time and elapsed time. It requires confirmed complete capture and ZenMoney delivery; incomplete/failed attempts do not change the timestamp. Private extension local storage retains it separately for each server/bank connection. It is recorded at the worker's first success confirmation and refreshes in an open popup. Older versions did not store timestamps, so no approximate date is reconstructed: the row appears after the next successful synchronization on 0.1.6. Clearing extension data removes this local marker.

On a bank page, the menu offers **Discrepancies**. It opens a separate extension tab listing potentially extra ZenMoney records grouped by bank date/account. Select period/account; Refresh obtains current ZenMoney data. Only fully captured bank days are checked; the report warns during capture/delivery. Unmatched records are review candidates; edit/delete them in mobile ZenMoney. The page neither sends transactions, stores links, nor injects bank UI. Requires backend GET `/api/v1/connections/{id}/discrepancies` (added October 16). Automatic categories are unchanged.

Separate extension server-switch/HTTPS validation:
[scripts/test-server-migration.sh](scripts/test-server-migration.sh),
[scope and safe execution](docs/server-migration-acceptance.md).
External networking is disabled by default; live mode requires an explicitly supplied,
historically verified ZenMoney test identity.

Source repository: https://github.com/vaslv/zenimport-chrome. MIT license;
data handling: [PRIVACY.md](PRIVACY.md). ZIP preparation, CI, and publication:
[docs/publication.md](docs/publication.md). No automatic GitHub Release/Chrome Web Store uploads.
