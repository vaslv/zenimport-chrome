# Changelog

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
