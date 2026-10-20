# ADR 001: required storage permission, optional API host

Date: 2026-10-20. Status: accepted engineering correction during L1.

## Observation

Chrome 145.0.7632.0 loads a manifest containing optional `unlimitedStorage`, but
`chrome.permissions.request` and `remove` reject it with "Only permissions specified
in the manifest may be requested." The declaration's presence in `getManifest()`
is not proof of an effective permission. Native host-only consent succeeds.

The [W3C WebExtensions issue](https://github.com/w3c/webextensions/issues/1087)
documents Chrome's rejection and a Chrome maintainer's explanation. Some examples
in the Chrome migration documentation are misleading for this permission.
[Chrome storage persistence guidance](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies#storage-persistence)
describes the quota/eviction effect of an effective `unlimitedStorage` grant.

## Decision

Declare `unlimitedStorage` in required manifest permissions. Keep the ZenMoney API
host optional and request it from the explicit setup action. No new broad host
access or bank permission is granted at installation. Check the effective grant in
native current/minimum-browser acceptance. Disk failure still aborts financial
transactions; this permission does not provide physical disk space or backups.

DevTools quota override does not constrain the extension origin in the observed
runtime. Test genuine quota rollback with the same bundled Dexie code on a bounded
web origin, including successful replay after removing the artificial quota.
Current Chrome reports AbortError for that failed transaction. Also inject
QuotaExceededError inside an actual extension IDB transaction and assert rollback.
These are distinct tests; do not claim a native extension disk-exhaustion event.

This is a permission implementation correction, not a change to storage modes,
migration behavior or financial policy. L1 also discovered that Chrome 120 lacks
protected persistent storage; see [ADR 002](adr-002-supported-chrome.md) for the
selected candidate minimum and its native verification.
