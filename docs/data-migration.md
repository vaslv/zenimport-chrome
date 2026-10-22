# Move data to another backend (0.2.0)

For the unpublished 0.3.0 standalone candidate, use the [browser/server operation guide](local-mode/operation-guide.md). The instructions below describe the earlier server-only releases.

Both backends and the extension must support migration (0.2.0+). The earlier 0.1.9
ZIP does not contain the buttons. Upgrade both servers and the extension first.
Backend 0.2.1 accepts verified archives from 0.2.0 (schema 6) and current schema 7;
0.2.0 cannot import a schema-7 archive. Named connections and memberships are
included in the new archive.

1. In **Data migration**, click **Export data** on the old server.
   This stops bank capture and persistently pauses that backend. Save the ZIP and
   check that the download completed. If another server operation is in progress,
   retry when it finishes.
2. In **Connection** (**Server connection** in 0.2.1), enter the new address and its backend token, then Connect.
   Configure that server's ZenMoney token separately for the same ZenMoney account.
3. Before its first synchronization, click **Import data** and select the ZIP.
   Wait for **Data restored**. Import does not send financial changes to ZenMoney.
4. Click **Synchronize** when ready. Leave the old backend paused or turn it off.

The imported archive retains account mappings, completed periods, bank identities,
delivery UUIDs/receipts, remote deletions, and category history. It does not contain
server tokens. Changes/deletions made in ZenMoney remain authoritative after its
current data is fetched. A previously used server cannot import or merge archives;
the backend enforces this even if a client tries to bypass the disabled button.

The ZIP is private, **unencrypted financial history**. Keep it out of Git/public
issues. Only import trusted files. Limits: 64 MiB ZIP, 256 MiB unpacked database;
use the manual backend snapshot procedure for larger histories. A remote HTTPS
proxy must allow that upload size and sufficient time (up to 120s).

If a popup closes during transfer, reopen Data migration to check the server state.
The source stays paused. A completed import is reported as restored and cannot
start financial delivery until you click Synchronize. Retrying the identical
archive before that click is safe; replacing it with a different archive is blocked.

**Resume this server** is only for a cancelled move. It requires confirmation;
do not use it when the new server is operating. After any later source activity,
create a fresh archive before moving. Do not downgrade a paused backend to an older
version that cannot enforce the pause. No mechanism can stop another disconnected
server from being deliberately started with older copied data.

The migration panel works without an open bank page. Bank access is needed again
to synchronize. No transaction editor, bank keepalive, or new browser permission
is introduced. Full server contract/safety details:
[backend migration guide](https://github.com/vaslv/zenimport-backend/blob/main/docs/popup-migration.md).
