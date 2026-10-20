# Design review record

Date: 2026-10-20.

This review concerns the Phase 2 implementation plan, not implemented software.
No financial data or live API was used to validate the design.

## Scope

- `README.md`
- `architecture.md`
- `portable-data.md`
- `implementation-plan.md`
- `acceptance.md`

Review criteria: completeness, consistency, clarity, scope and feasibility.
An independent reviewer receives the documents and read-only source access.

## Result

**PASS, 9/10, after three review rounds.** Six actionable issues were found and
resolved. No unresolved design blockers remain. The document is ready for user
approval and L0; this does not approve implementation or publication by itself.

| Round | Score | Findings and disposition |
|---|---|---|
| 1 | 8/10 | Four issues: server-side activation authority missing; undefined empty reverse start; loss sentinel location unspecified; credential lifetime/removal unspecified. All corrected |
| 2 | 8.5/10 | Original four closed. Two new issues in the refined protocol: cancel/handoff race and undefined backup-only restore. Both corrected |
| 3 | 9/10 | PASS. Architecture, portable format, stages and acceptance checks agree |

## Corrections incorporated

1. Added durable participant state, source handoff, destination arm/activation and
   guards against legacy `/jobs` or `/migration/resume` bypassing format-2 holds.
2. Removed an undefined empty-local escape from a used or unavailable remote source.
3. Defined an independent trusted Chrome storage sentinel before local financial
   initialization, surviving token removal and mode changes.
4. Defined persistent verified credentials, session drafts, expiry/cleanup,
   credential epochs and conservative handling of in-flight requests at removal.
5. Made source `cancel_pending` compete atomically with `handed_off` before
   destination discard; unknown decisions require status recovery.
6. Separated archive-only disaster recovery from live migration, including explicit
   retirement of previous writers and the limits of snapshot-age evidence.

The review also prompted an explicit old-server compatibility matrix, deterministic
clock/UUID fixture requirements, fuller SQL-invariant inventory and separate mirror
versus whole-dataset generations.

## Remaining implementation gates

Executable column schema/DTOs, chunk sizes, performance budgets and real MV3/API
feasibility are intentionally assigned to L0–L4. They are not claimed as proven.
Storage, delivery and migration receive further code review after implementation.

Implementation and Docker acceptance have **not** started. Source and documents
were inspected read-only for the review; no financial data or live API was used.
The acceptance matrix defines the evidence required before a release claim.
