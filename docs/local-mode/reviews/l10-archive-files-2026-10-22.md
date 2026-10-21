# L10.13 private archive file handling review

Physical IDB version 8 adds a private archive-file chunk store, independent of
portable financial schema 1 and archive version 2. One resumable file is accepted
at a time, at most 64 MiB in 256 immutable 256 KiB chunks. Exact retries are
idempotent; conflicting chunk/file retries fail. Status reads only keys, not file
bytes. A ready file requires the complete persisted byte digest. Blob assembly
rechecks each immutable part, complete checksum and final nonce/phase.

File cancellation revokes in-flight sealing and reads. Cleanup deletes one cached
chunk at a time and requires cancellation first. A file never changes Root,
credentials or financial history. Upload quota failure and complete browser
restart retain existing chunks. SDK/token material never enters this file cache.

Cancelled recovery cleanup is a separate explicit action requiring retention of
the original archive. It rejects active/anchor generations, any previously
activated participant, or any native migration operation/receipt. Each transaction
deletes at most 500 financial rows from that one discarded recovery generation.
Original source history, old inactive datasets and routing remain unchanged.

Independent API and adversarial source reviews reported no findings. External
cross-model CLI remained unavailable. Latest Docker strict/generated/bundle checks
and all 249 unit/contracts passed. Current native storage/authority/file/recovery
regression: 63 passed; minimum Chrome 140 file/recovery: 16 passed. Detailed timing
and logs are recorded in progress.md. Product popup integration is still gated.
