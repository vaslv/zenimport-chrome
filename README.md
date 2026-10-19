# ZenImport Chrome

Prepared release **0.2.1** adds [BIDV VND payment-account history](docs/bidv.md) and
[named connections for multiple bank logins](docs/bank-connections.md).
It requires backend 0.2.1+ and is not yet published; the latest published release
below remains 0.2.0. See [release notes and preparation checks](docs/release-0.2.1.md).

Version **0.2.0** adds **Data migration**: export one ZIP, connect to a new
backend, and import before its first sync. Requires backend 0.2.0+; not included
in the earlier 0.1.9 release. [Migration instructions](docs/data-migration.md).

An independent MV3 extension. Reads history from an open online banking session and sends it to ZenImportBackend. Users review financial transactions in mobile ZenMoney.

## Install

Download the ZIP and `SHA256SUMS` from [GitHub Releases](https://github.com/vaslv/zenimport-chrome/releases), verify the checksum, and extract the ZIP into a permanent directory. In desktop Chrome 120 or newer, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**. Select the extracted directory containing `manifest.json`. The ZIP is not installed directly and this distribution does not update automatically.

Follow the [installation and update guide](docs/installation.md) to connect your backend, select bank accounts, and synchronize. The published build supports **VietinBank VND current-account history**; development adds BIDV as described above. Published Chrome 0.2.0 uses backend 0.2.0 (API v1) for migration. Development Chrome 0.2.1 requires backend 0.2.1 for connection discovery in both banks. See the [backend deployment guide](https://github.com/vaslv/zenimport-backend/blob/main/docs/container-release-0.2.0.md).

Keep the same installation directory when updating and click **Reload** on the extension card. Do not uninstall the extension if you want to retain its local settings and capture checkpoints. GitHub ZIP installation is separate from Chrome Web Store publication.

## Build from source

Neighboring projects: `ZenImportBackend`, `ZenMoneyAPI`. Extension builds do not require their source.

`python3 scripts/build.py` creates a reproducible ZIP, `dist/SHA256SUMS`, and `dist/extension`. Open `chrome://extensions`, enable Developer mode, and load this directory as an unpacked extension. Disable any separate legacy extension first. In the popup, enter the server address and **backend token**, not the ZenMoney token. HTTPS is mandatory except for localhost/127.0.0.1. Bank credentials are never sent to the server.

Plan and actual limitations: `docs/refactor/03-extension.md`, `docs/refactor/05-progress.md`. No Store publication is performed.

## Synchronization

Open history for the desired bank login/account. The popup shows the detected connection name with a pencil to rename it. BIDV Accounts automatically creates separate connections using an initial primary-account anchor. Known accounts retain their existing connection. Connections are created automatically; edit their names inline with the pencil and save with the checkmark. There is no connection selector or manual creation form. Sign in on the bank website yourself; ZenImport never stores bank passwords. On first connection, select a ZenMoney account or Do not import and a date (default: 30 days ago). A complete VietinBank account list is not yet verified: open other accounts and refresh the list. Configured accounts can synchronize while new ones remain unconfigured.

Synchronize authorizes capture and delivery of all missing transactions for configured accounts. The server adds only confidently known categories; every new record has viewed=false. Mobile changes/deletions are final. Pausing/closing the tab preserves pages; to resume, reopen history and click again. Stop capture does not undo sent records or revoke delivery of authorized complete intervals.

Expand **Synchronization period** below Synchronize to select 30 days, six months, or a custom start date. Repeat synchronization defaults to 30 days. The first import uses the start date saved for each account unless you explicitly change the synchronization period. The backend retains its previous-complete-boundary policy with a 14-day overlap for clients that do not request a period.

Chrome 0.1.8 capture/delivery was verified against actual VietinBank; results are in the [acceptance log](docs/refactor/05-progress.md). Mobile New-tab, edit, and deletion checks remain separately deferred. Automated tests use only synthetic banks, ZenMoney, and databases.

## Checks

`./scripts/test-docker.sh`: independent unit/popup checks. `./scripts/test-integration.sh ../ZenImportBackend`: joint validation with the actual backend and fake ZenMoney; only this needs neighboring source. Containers have no external networking. Detailed boundaries: docs/testing.md.

To update an already loaded unpacked build, rebuild dist/extension, click Reload on the ZenImport card in chrome://extensions, and reopen the popup. Current development version: 0.2.1. If a copied directory elsewhere was loaded, replace it with the new build first.

Unfinished server address/token input is restored after popup closure. Drafts stay only in private extension session storage until successful connection or Chrome/extension reload. They never connect automatically and are inaccessible to the bank page.

If an invalid backend token pauses capture, enter a new token for the same server address and reconnect. Jobs/captured pages survive; resume using Synchronize from the current bank history tab. Server switching during unfinished capture is blocked.

Server connection and Data migration are independent sections with always-visible headings. Both are collapsed when the popup opens with a configured connection. Missing configuration, an unfinished connection draft, or a connection configuration error opens Server connection. Bank connections and account mappings remain available separately.

Below Synchronize, the popup shows the last successful synchronization's local date/time and elapsed time. It requires confirmed complete capture and ZenMoney delivery; incomplete/failed attempts do not change the timestamp. Private extension local storage retains it separately for each server/bank connection. It is recorded at the worker's first success confirmation and refreshes in an open popup. Older versions did not store timestamps, so no approximate date is reconstructed: the row appears after the next successful synchronization on 0.1.6. Clearing extension data removes this local marker.

On a bank page, the menu offers **Discrepancies**. It opens a separate extension tab listing unmatched bank records and potentially extra ZenMoney records grouped by bank date/account. Select period/account; Refresh obtains current ZenMoney data. Only fully captured bank days are checked; pending or failed delivery does not block reporting on already captured complete days. Unmatched records are review candidates; edit/delete them in mobile ZenMoney. The page neither sends transactions, stores links, nor injects bank UI. Requires backend GET `/api/v1/connections/{id}/discrepancies` (added October 16). Automatic categories are unchanged.

Separate extension server-switch/HTTPS validation:
[scripts/test-server-migration.sh](scripts/test-server-migration.sh),
[scope and safe execution](docs/server-migration-acceptance.md).
External networking is disabled by default; live mode requires an explicitly supplied,
historically verified ZenMoney test identity.

Source repository: https://github.com/vaslv/zenimport-chrome. MIT license;
data handling: [PRIVACY.md](PRIVACY.md). ZIP preparation, CI, and publication:
[docs/publication.md](docs/publication.md). No automatic GitHub Release/Chrome Web Store uploads.
