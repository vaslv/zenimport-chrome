# ADR 002: require Chrome 140 for the upcoming extension

Date: 2026-10-20. Status: selected for the local implementation candidate;
publication remains separately authorized. The user has been offered the
alternative of retaining Chrome 120 with a redesigned credential store.

## Evidence

The released manifest declared Chrome 120. Installed Chrome 120.0.6099.109 has no
`chrome.storage.local.setAccessLevel` method. Invoking it during module evaluation
throws and prevents normal message handling. Using both Playwright 1.58 and a
Chrome-era 1.40 driver reproduced the missing method; changing automation drivers
does not create a browser API. Storage, quota and SDK probes alone could not
detect this until the content-script isolation assertion was added.

Chromium's [implementation change from July 2025](https://chromium.googlesource.com/chromium/src.git/+/a8f1f337c692360aaec9470a0a91f965011d37a3%5E%21/)
adds access-level control to local and sync storage. Current documentation's
general method/version heading must not be treated as evidence that every storage
area supported it in Chrome 120.

Chrome for Testing 140.0.7339.80 and pinned Chromium 145.0.7632.0 both pass the
native content-script denial test for local and session storage. The Chrome 140
binary is downloaded from the official Chrome for Testing endpoint and verified
against SHA256 7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546.

## Decision and impact

The upcoming candidate requires Chrome 140. Required storage isolation is not
replaced with a permissive fallback or a swallowed startup exception. This keeps
the approved trusted-local credential/sentinel design and avoids introducing a
second secret store solely for obsolete browser versions.

The published 0.2.1 release is unchanged. Local builds are an unfinished candidate
and are not a new release of 0.2.1. L12 selects the next release number and must
include this compatibility change in its release notes. Reconsidering Chrome 120
requires an explicit architecture change and fresh isolation/recovery tests.
