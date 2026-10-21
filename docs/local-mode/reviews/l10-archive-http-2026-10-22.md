# L10.16 installed archive interoperability review

The protected bounded migration transport now supports separate archive-control
routes. It preserves origin permission checks before/after a request, bearer auth,
no cookies/redirects/cache, 20-second request/body deadline, bounded JSON and
256 KiB binary chunks with exact checksums. No automatic command retry, SDK
financial mutation or peer receipt is added.

Archive requests, status and previews use exact shape, UUID/digest bindings,
canonical decimal integer strings, valid kind/phase combinations and safe numeric
summary counters. Begin binds physical identity/epoch; recovery additionally binds
dataset lineage/archive SHA/size and explicit retirement/loss declarations.
Activation accepts only a permanent recovery activated outcome, never cleaned or
cancelled state. Finalize/cancel actions check their own expected result phases.
Token/permission failures never select a local fallback.

Independent API review reported no findings. Adversarial review found that typed
unknown-archive HTTP404 was confused with missing protocol support. Fixed: typed
not_found remains distinct; an untyped missing endpoint is unsupported. Both unit
and actual Python HTTP regressions cover this lost-outcome recovery distinction.
Final independent reread is clean. External cross-model CLI unavailable.

Installed native Chrome tests export/retire a browser source, restore its archive
on an empty Python server with accepted preview, and verify immutable journal and
awaiting-sync authority without any financial SDK send. Reverse coverage downloads
and acknowledges a real server backup, retires the source service, restores a new
browser generation, compares every portable fact and verifies explicit-sync hold.
Both directions pass on current Chromium and minimum Chrome 140. Product popup
routing remains gated by L11/L12; transport tests do not claim full product UX.
