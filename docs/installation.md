# Install and update ZenImport Chrome 0.3.0

See [release notes](release-0.3.0.md) and the [browser/server operation guide](local-mode/operation-guide.md).

## Requirements

- Desktop Google Chrome 140 or newer with permission to load unpacked extensions.
- For browser mode: your ZenMoney API token. No backend is required.
- For optional server mode: ZenImportBackend 0.3.0+ at a reachable address and its
  `API_TOKEN`. The server stores its own ZenMoney token; never enter a server token
  in the browser-mode ZenMoney field.
- An authenticated VietinBank VND current-account history or BIDV English VND
  payment-account page.

The backend image for this release is `ghcr.io/vaslv/zenimport-backend:0.3.0`.
Use its [deployment and verification guide](https://github.com/vaslv/zenimport-backend/blob/main/docs/container-release-0.3.0.md)
for Docker configuration, HTTPS, persistent data, and backups. A remote backend
requires HTTPS with a certificate trusted by Chrome. Local HTTP is allowed for
`http://localhost:18792` and `http://127.0.0.1:18792`.

VietinBank and [BIDV](bidv.md) VND are supported within their documented
verification boundaries. Other banks and currencies are not supported. This is a GitHub ZIP distribution,
not a Chrome Web Store installation; managed browsers may prohibit Developer mode.

## Download and install

1. Open [Releases](https://github.com/vaslv/zenimport-chrome/releases) and download
   `zenimport-chrome-0.3.0.zip` and `SHA256SUMS` from the same release.
2. Verify the ZIP before extraction. On macOS, run the following from the directory
   containing both files:

   ```sh
   shasum -a 256 -c SHA256SUMS
   ```

   On Linux, use `sha256sum -c SHA256SUMS`. The result must be **OK**. On other
   systems, calculate the ZIP's SHA256 with a trusted checksum tool and compare
   it with the value in `SHA256SUMS`.
3. Extract into a permanent directory, for example `ZenImportChrome`. The selected
   directory must contain `manifest.json` directly, not another nested ZIP.
4. In Chrome, open `chrome://extensions`, enable **Developer mode**, click
   **Load unpacked**, and select that directory. Do not try to install the ZIP
   directly. Disable any separate legacy ZenImport extension before use.
5. Pin ZenImport from Chrome's Extensions menu if you want quick access.

The steps follow Chrome's [unpacked extension instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Configure and synchronize

1. Sign in to the supported bank yourself and open transaction history for the desired
   account. The extension does not log in or extend an expired bank session.
2. Open ZenImport's popup. A new installation uses **Browser database**. In
   **ZenMoney connection**, enter your ZenMoney token and choose **Verify token**;
   approve API access. This verifies the owner without starting synchronization.
3. For optional server mode, expand **Server connection**, enter its root address
   (without `/api/v1`) and **Server token**, then **Connect** and approve access.
   Choose explicitly between moving history to an empty server and joining an
   existing server without import. The [operation guide](local-mode/operation-guide.md)
   explains both choices and the reverse transfer. Only the selected database sends.
4. For each discovered bank account, choose the corresponding ZenMoney account or
   **Do not import**. Select the first import date and click **Save account**.
   The default is 30 days ago; **6 months** and a custom date are available.
   Open other bank accounts and use **Refresh account list** to discover them:
   automatic discovery of the complete VietinBank account list is not yet verified.
5. Click **Synchronize** and approve bank-host access if Chrome requests it. Keep
   the history tab open and stay signed in until completion. This click authorizes
   both reading history and sending missing operations to ZenMoney. The bank tab
   may navigate between history pages during capture.
6. Review imported operations in the official ZenMoney app. New records are sent
   with `viewed=false`; only confidently predicted categories are prefilled.
   This release does not provide transaction editing in the bank website.

The popup displays progress and the last successful synchronization time. The first
import uses the saved account dates. Subsequent runs default to 30 days. Expand
**Synchronization period** to explicitly select 30 days, six months or a custom
start date; an explicit selection also overrides initial account dates.

If capture pauses, reopen the bank history and use **Synchronize** to resume.
**Stop capture** stops further reading; it does not undo records already sent or
revoke delivery of previously authorized complete intervals. **Discrepancies**
opens a read-only report of unmatched bank and ZenMoney records for covered days.
A failed delivery does not block this report.
Resolve financial edits in ZenMoney.

## Update without losing settings

1. Finish an active synchronization and keep a verified private backup. In server
   mode, upgrade the backend to 0.3.0 first, retaining its data volume and journal.
   Existing server mode/settings remain selected after the extension update.
   Download and verify the new
   release's ZIP and checksum.
2. Extract into a temporary directory, then replace the extension files in the
   **same permanent directory originally loaded in Chrome**. Remove obsolete
   extension files when replacing an older release; keep a copy outside the loaded
   directory if you need a rollback.
3. Open `chrome://extensions` and click **Reload** on the existing ZenImport card.
   Reopen the bank history tab and popup. Confirm the displayed extension version
   on the card and the saved backend/account configuration.

Do not uninstall and reinstall, move the loaded directory, or use **Load unpacked**
on a different path for a routine update. These can create a different extension
identity or remove local settings. Successful connection/account settings and
capture checkpoints are stored locally; unfinished server/token input is only a
session draft and is cleared by extension reload. Updates from GitHub are manual.

## Move data safely

Use [browser/server transfers and portable backups](local-mode/operation-guide.md).
A direct transfer verifies the destination, pauses the source and hands off write
authority. Moving to an empty destination preserves receipts and deletion history;
joining an already used server never merges data. A server outage never silently
activates the inactive browser copy.

For recovery from a backup, stop all former writers, restore onto an eligible
empty destination, review the fresh preview and explicitly activate. Restore does
not send transactions; Synchronize is a separate subsequent action. The archive
excludes credentials and cannot reconstruct changes made after its snapshot.
Keep it private. Legacy format-1 SQLite archives need backend conversion to
portable format 2 before browser restore.

An empty database alone cannot know which imported records were deleted in
ZenMoney. Preserve the delivery journal instead of relying only on day/amount
matching. Do not run two independent writers from copies of the same database.

## Troubleshooting and privacy

- Connection failure: check the root URL, HTTPS certificate, server token, and
  Chrome's requested host access. Never paste tokens into GitHub issues.
- Synchronize unavailable: open the supported bank's history and configure at
  least one account for import. A saved account explicitly excluded from import
  is not a synchronization target.
- Session expired: sign in on the bank website again and reopen history. The
  extension neither handles bank passwords nor prevents automatic logout.
- Report does not prove equality: only completely captured bank days are checked;
  coverage warnings must be considered. Delivery failures do not block the report
  for complete bank days in 0.2.1.

Read [PRIVACY.md](../PRIVACY.md) for stored data and deletion behavior. Automated
release checks use synthetic bank/ZenMoney data, isolated databases, and a separate
browser profile; they do not certify the mobile app's current presentation.
