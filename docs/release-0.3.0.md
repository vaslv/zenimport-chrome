# ZenImport Chrome 0.3.0

Release date: 2026-10-23.

## What changes

- A fresh installation can synchronize directly with ZenMoney. Its browser
  database stores captured history, matching evidence and delivery receipts.
- Server mode remains available for a shared centralized dataset. Existing
  configured installations keep their server settings and mode.
- Portable ZIP backups and explicit browser/server transfers preserve financial
  history. Transfers require an empty destination; joining a used server never
  merges databases. Only one selected database has write authority.
- New operations remain unread in ZenMoney. Matching and category prediction
  preserve mobile edits/deletions; corrections stay in the official mobile app.
- Recoverable previews, token repair and persistent migration errors make stalled
  storage operations actionable. Large-history delivery reuses bounded source
  data and verifies attempted UUIDs without repeated creates after a crash.

## Requirements and upgrade

Use desktop Chrome 140+. For server mode, upgrade to backend 0.3.0 **before**
installing this extension; this also applies to existing server-only users.
Retain the server data volume and a verified private backup. Do not start multiple
independent writers from copies of the same financial journal.

Download `zenimport-chrome-0.3.0.zip` and `SHA256SUMS` from this release. Check the
checksum, extract into the existing permanent installation directory, and use
**Reload** on `chrome://extensions`. Do not uninstall to update. A new installation
uses **Load unpacked** and starts in browser mode. GitHub ZIP builds do not update
automatically; Chrome Web Store distribution is separate.

Follow [installation](installation.md) and [browser/server operation](local-mode/operation-guide.md).
Legacy SQLite format-1 backups must be restored on an isolated compatible backend
and exported as portable format 2 before they can be restored in Chrome.

## Verification

See [acceptance](local-mode/release-acceptance.md) and the sequential
[progress log](local-mode/progress.md) for isolated Docker, native browser/SQLite
parity, 100k-history measurements and independently committed-write crash recovery.
CI checks the source revision with current Chromium and Chrome 140. Release assets
are taken from the successful matching CI run and checked again after download.
Synthetic results do not claim new live bank-site or mobile UI acceptance.
