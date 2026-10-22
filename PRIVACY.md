# Data in ZenImport Chrome

The development build supports browser storage and optional server storage. Only
one mode is active. Existing configured installations retain server mode; a fresh
installation starts with browser storage. Published 0.2.1 uses server storage.

## Bank access and financial data

Users sign in on the bank website themselves. Explicit Synchronize authorizes
history collection and delivery of missing operations. The extension reads
amounts, dates, descriptions and available counterparty/balance details from the
open session. It never stores bank passwords, SMS codes or bank authentication
fields, and never sends them to ZenMoney or a backend. It adds no transaction
editor to the bank page. Corrections happen in the official ZenMoney application.

In browser mode, financial history, account mappings, the ZenMoney mirror,
prediction evidence, delivery attempts and deletion records are stored in
IndexedDB in this Chrome profile. The extension communicates directly with
ZenMoney using the bundled SDK. In server mode, the selected backend receives
history and performs this work in its own database. Its owner can access those
records. Local financial storage is inactive in server mode; a retained copy is
not a second writer. Server unavailability never triggers a local fallback.

History has no automatic retention deadline. Do not treat the delivery journal
as disposable cache: losing it can remove evidence that an operation was already
sent or deleted. Mobile changes and deletions are not intentionally overwritten
or recreated by synchronization.

## Credentials and permissions

The active local ZenMoney token, or the backend address and token in server mode,
are stored in protected persistent extension storage. Chrome 140 or newer is
required to restrict these values to trusted extension contexts. Tokens are not
passed to bank-page scripts or content scripts and are not included in backups.
The remote backend keeps its own ZenMoney token. Enter the token for the field's
label: ZenMoney token for browser mode; server token for a backend connection.

Unverified input drafts remain in private extension session storage across popup
closure, until accepted, cleared or the browser/extension restarts. They cannot
select a writer or start synchronization. Verified credentials survive a browser
restart. Removing a local token blocks new API work but preserves financial data
and uncertain delivery evidence; it does not erase ZenMoney transactions.

Chrome requests access to the supported bank host, the selected server origin,
and (for browser mode) `https://api.zenmoney.ru/*`. Remote servers require HTTPS;
HTTP is allowed only for localhost/127.0.0.1. `unlimitedStorage` supports browser
history storage; it does not grant website, filesystem or account access, and
cannot prevent disk failure or profile deletion. There is no analytics,
advertising, developer data endpoint or automatic cloud backup.

## Backups and moving storage

Data migration exports an **unencrypted private ZIP** containing financial facts,
account mappings and delivery/deletion evidence. It excludes credentials. Store
it securely and import only trusted archives. Local exports stay within this
browser and the downloaded file; server exports arrive from the selected backend.
Restoring to a server uploads the selected ZIP only to that server.

A current-format backup is a snapshot, not an automatic pause of the source.
Before restoring it, retire every previous writer and explicitly acknowledge
that records newer than the snapshot may be absent. The preview is read-only;
activation requires separate confirmation. Ordinary browser/server transfers use
a coordinated handoff so only one database can send new operations. An existing
server may be joined without import; databases are never merged automatically.

Downloaded ZIPs remain under your control. Temporary export/import files can be
cleaned from Data migration. Deleting a ZIP does not delete the source history.
Uninstalling the extension or removing this browser profile can delete the local
history and credentials. It does not erase a remote backend or ZenMoney data.

The read-only Discrepancies page uses the active mode. Refresh may fetch ZenMoney
history but does not send or delete transactions. Never attach real records,
tokens or backup ZIPs to public issue reports.
