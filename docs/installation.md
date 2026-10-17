# Install and update ZenImport Chrome

## Requirements

- Desktop Google Chrome 120 or newer with permission to load unpacked extensions.
- ZenImportBackend 0.1.0, API v1, running at an address this computer can reach.
- The backend's `API_TOKEN`. The ZenMoney token is configured on the server only.
- An authenticated VietinBank session with VND current-account transaction history open.

The backend image is available at `ghcr.io/vaslv/zenimport-backend:0.1.0`.
Use its [deployment and verification guide](https://github.com/vaslv/zenimport-backend/blob/main/docs/container-release-0.1.0.md)
for Docker configuration, HTTPS, persistent data, and backups. A remote backend
requires HTTPS with a certificate trusted by Chrome. Local HTTP is allowed for
`http://localhost:18792` and `http://127.0.0.1:18792`.

Only the VietinBank connector above has live bank acceptance. Other banks and
currencies are not supported by this release. This is a GitHub ZIP distribution,
not a Chrome Web Store installation; managed browsers may prohibit Developer mode.

## Download and install

1. Open [Releases](https://github.com/vaslv/zenimport-chrome/releases) and download
   `zenimport-chrome-0.1.9.zip` and `SHA256SUMS` from the same release.
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

1. Sign in to VietinBank yourself and open transaction history for the desired
   account. The extension does not log in or extend an expired bank session.
2. Open ZenImport's popup. Expand **Settings → Connection** if necessary. Enter the
   backend's root address, such as `https://your-server.example`, and its
   **Server token** (`API_TOKEN`). Do not append `/api/v1` to the address.
3. Click **Connect** and approve Chrome's request for access to that server.
   Connecting verifies access but does not start synchronization.
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

The popup displays progress and the last successful synchronization time. Ordinary
synchronization resumes from the previous complete boundary with a 14-day overlap;
it does not reread the entire initial period every time. For an older one-time
import, set **One-time history import start date** before synchronizing.

If capture pauses, reopen the bank history and use **Synchronize** to resume.
**Stop capture** stops further reading; it does not undo records already sent or
revoke delivery of previously authorized complete intervals. **Discrepancies**
opens a read-only report of potentially extra ZenMoney records for covered days.
Resolve financial edits in ZenMoney.

## Update without losing settings

1. Finish an active synchronization before updating. Download and verify the new
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

## Switch backends safely

Complete any unfinished capture before changing servers. Use the new address and
the **new backend token** in Connection settings; verify account mappings again.
Keep the old backend's database and delivery journal backed up. The server can
match records still present in ZenMoney by bank day and signed amount, but an empty
database cannot know which imported records you previously deleted. Starting
with an empty database may recreate those deleted records; preserving deletion
history requires transferring the journal. See the backend's deployment guide
before choosing a cutover method.

## Troubleshooting and privacy

- Connection failure: check the root URL, HTTPS certificate, server token, and
  Chrome's requested host access. Never paste tokens into GitHub issues.
- Synchronize unavailable: open the supported bank's history and configure at
  least one account for import. A saved account explicitly excluded from import
  is not a synchronization target.
- Session expired: sign in on the bank website again and reopen history. The
  extension neither handles bank passwords nor prevents automatic logout.
- Report does not prove equality: only completely captured bank days are checked;
  coverage and pending delivery warnings must be considered.

Read [PRIVACY.md](../PRIVACY.md) for stored data and deletion behavior. Automated
release checks use synthetic bank/ZenMoney data, isolated databases, and a separate
browser profile; they do not certify the mobile app's current presentation.
