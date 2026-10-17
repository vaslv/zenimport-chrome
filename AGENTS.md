# ZenImportChrome

Communicate in Russian. Plan: docs/refactor/03-extension.md; log: docs/refactor/05-progress.md.
Independent Chrome MV3 project; SDK and backend are separate neighboring projects.
No transaction editors, options/SPA, injected product UI, or bank keepalive.
Popup, explicitly requested history capture, account settings, server contract v1.
The user's October 16 clarification permits one separate Discrepancies page,
read-only candidates for extra ZenMoney transactions within the current bank;
corrections/deletions take place only in the official mobile application.
Never pass backend tokens to the bank page or retain bank authentication fields.
Tests use only synthetic banks, ZenMoney, and databases in isolated Docker.
Verify live bank capabilities separately; never claim them based on fixtures.
Work in stages with checks and local commits. No push, tags, or publication.
