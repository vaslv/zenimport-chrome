# Changelog

## 0.3.0 — 2026-10-23

- Add a browser database and direct ZenMoney access using pinned zenmoney-typescript 0.1.0; retain optional server mode and existing remote installations.
- Persist capture, matching, category evidence and delivery journals across worker/browser restarts. Preserve mobile edits and deletions.
- Add verified token setup, portable backups, explicit browser/server transfers, recovery previews and held-operation credential repair. Only one selected database can dispatch.
- Keep the compact popup and read-only discrepancies; normalize empty filters identically in both modes.
- Require Chrome 140+ for protected persistent extension storage. All server operation requires backend 0.3.0 with context fencing. Existing remote mode/settings are retained, but upgrade the backend before the extension.

- Fix large-mirror backup ownership, expired restore previews, offline account disabling and credential repair during browser restores.
- Keep migration errors visible until confirmed progress; avoid repeated whole-history reads during delivery and verify crash recovery without duplicate creates.

See [operation guide](docs/local-mode/operation-guide.md) and [acceptance record](docs/local-mode/release-acceptance.md).

## 0.2.1 — 2026-10-19

- Add BIDV VND payment-account capture, with bounded date windows and strict
  completeness checks, filter verification, and unchanged-row narrowing support.
- Detect multiple bank logins automatically by known accounts/primary-account
  anchors; rename the current connection inline without a manual selector.
- Simplify the popup into compact Bank accounts, Server connection, Data migration
  and Synchronization period sections. Repeat imports default to 30 days;
  initial account dates are respected unless explicitly overridden.
- Retain connection identity during bank navigation and report capture stages.
- Show both unmatched bank records and unmatched ZenMoney records per day; read-only
  reporting remains available when delivery fails.
- Use Do not import to exclude an account persistently; remove the ineffective
  Unlink action that automatic discovery would immediately undo.

Requires backend 0.2.1 or newer. See [release preparation](docs/release-0.2.1.md).
