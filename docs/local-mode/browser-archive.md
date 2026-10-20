# Browser portable format implementation

The L4 codec implements archive 2 / financial schema 1 from the pinned contracts.
It validates format and integrity only. The golden fixture deliberately lacks a
valid financial graph; successfully reading it never authorizes installation,
owner adoption, a mode switch or another API write.

`src/local/portable/` uses the published SDK's duplicate-key-rejecting lossless
JSON parser, pinned fflate 0.8.3 synchronous DEFLATE streams and @noble/hashes 2.4.0
incremental SHA256. Dependencies are bundled locally, with no Node polyfill,
dynamic dependency fetch, eval or worker-backed compression helper. Exact raw
JSON remains TEXT. Tagged financial integers remain canonical signed-64-bit text.
Manifest counters are separately bounded exact JSON integers.

The reader bounds the immutable input Blob at 64 MiB, reads a private byte copy,
and streams each DEFLATE member in 4 KiB compressed blocks. Emitted data is checked
against the declared size before row decoding. The full uncompressed dataset is
never assembled. Individual rows are bounded at 128 MiB, total data at 256 MiB and
the manifest at 64 KiB. Callers must write rows only into inactive private staging
and validate its full financial graph before requesting any activation authority.

The ZIP profile has exactly 50 known members, methods 0/8, canonical known names,
regular files, no ZIP64, encryption, multi-disk archive, member/global comments,
overlap, hidden files, leading/trailing data or contradictory local/central/data
descriptor fields. Both ordinary Python headers and fflate data descriptors are
supported. Harmless extra fields remain inert; ZIP64 extra fields are rejected.
CRC32, actual lengths, row order, exact canonical row bytes, table SHA256 and the
dataset digest are independently verified. Checksums are not authentication.

The writer streams each ordered table before its manifest. Producer/archive
timestamps and container bytes do not affect the financial dataset digest.
Downstream storage failures propagate only stable redacted error codes, including
quota and routing-fence errors. A partial output or a failed sink is not a sealed
archive. The caller owns crash recovery, staging cleanup and durable holds.

Run `sh scripts/test-portable-interop.sh ../ZenImportBackend` for offline Docker
golden exchange in both directions. The test additionally compares producer
contract SHA256 with Python's reproducibly packaged contract. Native MV3 tests
execute the same bundle under extension CSP, with extra Worker creation denied.
Full staged-data/activation/large-dataset gates are separate L4 requirements.
