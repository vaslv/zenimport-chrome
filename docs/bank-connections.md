# Multiple connections to the same bank

Status: local development 0.2.1, not published. Update both Chrome and the backend
to 0.2.1 before using this feature. The existing SDK is unchanged.

## Add and use a connection

1. Sign in on the bank website using the required bank login. Open Accounts or
   payment-account history. Bank credentials remain exclusively on that website;
   ZenImport does not store passwords, authenticate for you, or switch bank logins.
2. Open ZenImport. The first connection for a bank uses the rendered account-owner name when
   available, with a bank-name fallback. The current connection appears above
   Synchronize; click its pencil to rename it. Custom names survive rediscovery.
3. Map each discovered physical account to a same-currency ZenMoney account, or
   choose **Do not import**. Choose its initial start date and save. Any number of
   supported accounts can be enabled; unconfigured/ignored accounts are not read.
4. Click **Synchronize**. Only this connection's enabled accounts are captured.
5. Sign out of the bank and sign into another login. Open its payment-account
   overview and reopen ZenImport. An unknown primary account automatically creates
   a separate connection, initially without any enabled import mappings.
6. Returning to a known set of accounts resolves the previous connection. Existing
   connection IDs, names, settings and history are retained. A manual selector is
   shown only when multiple saved connections make the observed accounts ambiguous.

The connector supplies the initial anchor: BIDV uses the first rendered VND
payment account on its Accounts overview. VietinBank currently exposes only the
selected account, so it retains membership-based matching and explicit association
for new accounts rather than treating every selected account as a primary one. The server scopes
that number by bank. A new automatic profile key is `account-v1:<account number>`.
Returning accounts resolve their existing membership before a new key is used,
so reordered cards and legacy random profile keys do not reset connections. An
Accounts overview containing known and newly opened accounts can attach the new
accounts to its single existing connection. If the same overview spans multiple
saved connections, explicit selection is required rather than guessing.

BIDV history alone exposes no primary-account overview: for an unseen account,
open Accounts first. VietinBank still exposes only the selected account; a newly
seen second account cannot be inferred to belong to the same login from a name.
Two logins sharing the same primary account cannot be distinguished automatically
by that account alone. Explicit connections remain available for these cases.

Owner names are display labels, never matching keys. BIDV exposes the name in
`.sidebar-account--owner-name`; VietinBank exposes it in the selected account label.
An unverified customer-ID field is not scraped. Custom names survive rediscovery.

## Scope and safety

Connection names, membership, capture jobs, last-success timestamps, and one-time
older-import requests are separate. Ordinary capture uses each physical account's
last complete boundary with a 14-day overlap. A start command rechecks the bank
page and the selected connection before it creates a job. One unfinished capture
is allowed in this extension; finish or stop it before switching. A paused capture
has a separate **Stop paused capture** button. Repairing the server token preserves
that capture without authorizing a new synchronization.

Two logins can expose the same physical bank account. Its canonical identity,
ZenMoney mapping, import choice/start date, coverage, and delivery/deletion journal
are shared. It cannot be imported twice by merely creating another connection.
Changes to that account's import settings apply to all its connections. To remove
access from one connection only, use **Unlink account** there; keep the account
available on another connection. Unlinking preserves bank history, sent UUIDs,
deletions, and mappings. Rediscovery can attach it again without resetting history.

Names and unfinished name drafts stay in private extension contexts. Drafts are
scoped to the server, bank, and observed physical accounts, so changing bank logins
does not restore another login's unfinished form. Creating a connection alone sends
no financial transactions. A lost creation response reuses the saved creation ID
only for the same observed accounts.

Existing connection UUIDs and settings are retained when upgrading. The server
also returns connection names after moving to a new browser or restoring a migration
archive; local timestamps are still browser-local. Backend schema 7 adds only name
metadata and upgrades owned earlier schemas with a private backup. Archives made by
published 0.2.0 (schema 6) remain importable into the new backend after verification;
new schema-7 archives require the new backend and cannot be imported by 0.2.0.

## Verification boundary

Docker tests cover two synthetic BIDV logins with two accounts each, separate
ZenMoney targets/ignored accounts and sync timestamps, returning to the first login,
repeated capture, shared physical-account delivery, mobile deletion, unlinking,
popup name drafts, lost responses, stale start commands, and migration. These are
not a live acceptance of both real BIDV logins; no production records or credentials
were used. No product controls or keepalive are injected into the bank page.
