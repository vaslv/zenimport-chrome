# Browser and server operation

This guide describes the unreleased 0.3.0 standalone candidate. The last published
0.2.1 extension remains server-only. Never load a development build into a profile
containing your only copy of financial history without a verified backup.

## First setup

Use Chrome 140 or newer. Load the unpacked, built extension. A fresh installation
selects **Browser database**; an existing server installation retains server mode.
In **ZenMoney connection**, enter the ZenMoney token and choose **Verify token**.
The extension requests access to the ZenMoney API and checks the account owner.
An entered draft is not an active credential. Drafts survive closing the popup
but are session data; verified credentials survive restarting Chrome.

Open a supported bank's account/history page. The extension automatically detects
the connection. In **Bank accounts**, map each discovered account to ZenMoney or
exclude it. Choose the initial start date (30 days by default, six months, or a
custom date), save, then select **Synchronize**. No bank password is requested.
The bank page receives no product overlay or ZenMoney/server token.

Synchronization obtains complete bank intervals, refreshes ZenMoney, matches
existing movements, and sends missing transactions as unviewed. Edit categories,
types and transactions in the official ZenMoney app. Mobile edits/deletions are
final; the local import ledger preserves that evidence. **Discrepancies** is a
read-only report; refreshing it does not authorize transaction creation.

## Choosing storage

Only one database is active in an extension profile. Server mode never silently
falls back to browser mode after an outage. Browser work resumes after Chrome
restarts, but it cannot run while Chrome is closed. Browser data is not synced
through a Chrome account and has no automatic cloud backup.

For any server connection, deploy backend 0.3.0 or newer with its own ZenMoney token,
then enter its HTTPS URL and **server token** in **Server connection**. Loopback
HTTP is allowed for local development. A server token is not a ZenMoney token.
Verify the destination before selecting it.

- Empty server: choose **Move browser data to this empty server** to preserve
  existing bank identities, delivery receipts and deletion history.
- Used server: explicitly connect without importing/merging. Its existing ledger
  must contain the import history required to prevent duplicates. The browser
  copy remains inactive; no automatic reconciliation of two databases occurs.
- Return to browser: expand **Move to this browser**, verify a same-owner ZenMoney
  token and acknowledge that the shared server will be paused for everyone.
  Replacing an inactive browser copy requires its downloaded, confirmed backup
  and explicit replacement consent.

Keep the original writer stopped while moving. The saved transfer verifies both
participants and hands off write authority before selecting the destination.
Closing the popup does not cancel the saved operation. Follow **Data migration**
for progress, retry and cancellation where it is still safe. Do not reset storage
or launch another independent writer to bypass an interrupted transfer.

## Backups and restore

In **Data migration**, choose the active server, active browser copy or available
inactive browser copy, then **Export data**. Wait for **Backup ready**, download
ZIP, check the file exists, and separately confirm **I saved the ZIP**. Export
itself does not retire the original writer. ZIP files contain private financial
history in readable form; checksums detect corruption, not authenticity or theft.
They exclude credentials and are not encrypted.

Restore is a recovery operation, not a database merge. Stop every former writer,
select an eligible destination, and acknowledge that changes made since the
snapshot may be absent. Choose the ZIP (at most 64 MiB). Supply a same-owner token
when restoring to browser storage. Wait for validation and the fresh comparison,
review its summary, then explicitly activate. Restore does not send financial
transactions. After activation, **Synchronize** explicitly resumes normal work.
A used destination cannot be overwritten through the empty-destination path.

Archives use portable format 2 / financial schema 1. Old format-1 SQLite ZIPs
cannot be opened directly by the browser. Restore one into a separate compatible
backend using its documented format-1 procedure, then export portable format 2
from that backend. Keep the original ZIP. Never rename a format-1 manifest or
extract its SQL into an active browser database. The offline interoperability
runner tests this conversion using synthetic data.

## Interruptions and credentials

A worker restart resumes durable progress. A failed request can have an uncertain
result, so retry the saved operation instead of inventing a new import. Status
may ask for a short delay after API throttling or a network error. Wait, then use
**Refresh account list**, **Retry**, or **Synchronize** as appropriate.

For ordinary token rotation, verify a new same-owner token in the relevant setup
section. Removing a browser token prevents further authenticated requests and
keeps history. For a held migration/recovery, use its **Replacement ... token**
field under Data migration; the operation's original destination and request IDs
are retained. A different owner or server lineage is rejected. A replacement
that was verified for a transfer becomes the ordinary connection only after the
terminal transition succeeds.

A quota failure, missing/corrupt database, revoked permission, or incompatible
server must be resolved explicitly. No empty database is silently created as a
substitute for missing history. Keep backups before uninstalling the extension,
clearing site/extension storage or deleting a Chrome profile. The UI is deliberately
limited: transaction corrections remain in the official ZenMoney application.

## Compatibility and permissions

| Extension | Chrome | Storage/backend |
|---|---|---|
| 0.3.0 candidate | 140+ | Browser by default; backend 0.3.0+ for all server operation |
| Existing 0.2.1 configuration upgraded in place | 140+ | Mode/settings retained; upgrade the backend to 0.3.0 before the extension |
| Published 0.2.1 | 120+ | Server-only; backend 0.2.1+ |

`activeTab` and `scripting` read the explicitly selected bank page; `storage` and
`unlimitedStorage` retain the local ledger and protected credentials; `alarms`
resume bounded work while Chrome is running. Optional host permission is requested
for the selected bank, ZenMoney API or server, never silently for every HTTPS site.
Unlimited storage does not eliminate disk exhaustion. Private/incognito operation
is disabled by the manifest (`incognito: not_allowed`). Clearing the profile removes its database and verified tokens.
