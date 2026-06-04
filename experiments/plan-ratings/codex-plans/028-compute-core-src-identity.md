# Plan 028: Compute Core Identity Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/src/identity`

Queue scope: cell, range, and document identity rules exposed through the public compute-core identity module. The folder itself is a thin public facade: `mod.rs` exports `GridIndex`, and `grid_index.rs` re-exports `compute_document::identity::*`. The production implementation therefore lives mainly in `compute/core/crates/compute-document/src/identity/`, with required integration points in compute-core storage, mirror, scheduler, sync, and structural mutation paths.

This plan targets the production identity path only: `GridIndex`, row/column axis identity stores, cell position maps, Yrs `gridIndex/{posToId,idToPos,rowAxis,colAxis}`, virtual cell identities for range-resident cells, and the compute-core callers that rely on those contracts.

## Current role of this folder in Mog

The requested folder is the compute-core identity entry point. It gives storage, mirror, scheduler, property, mutation, import, export, and security code a stable `GridIndex` API without exposing the internal `compute-document` crate path at every call site.

The current `GridIndex` model maintains:

- Sparse materialized cell identity mappings: `(row, col) -> CellId` and `CellId -> (row, col)`.
- Row and column axis identity mappings through `AxisIdentityStore<RowId>` and `AxisIdentityStore<ColId>`.
- Lazy `CellId` creation through `ensure_cell_id`.
- Dense row/column identity creation at sheet construction and insertion time.
- Structural shifts for inserted/deleted rows and columns.
- Row sort and row-axis reorder helpers for the two different sort semantics in the engine.

The Yrs document is the collaborative source of truth for persisted identity state. Runtime code normally reads the in-memory `GridIndex` and `CellMirror`, then rebuilds from Yrs during sync, undo/redo, import, and structural observer changes.

## Improvement objectives

1. Make identity invariants explicit, typed, and enforced in production, not only implied by tests and debug assertions.
2. Replace silent hydration skips and debug-only permutation checks with validated identity contracts that either produce a correct grid or return a precise error/report.
3. Preserve compact row/column axis identity stores across structural operations instead of materializing large axes into dense explicit vectors whenever an insert or reorder occurs.
4. Centralize the Yrs position-key codec and inverse-map validation so every caller agrees on `rowIdHex:colIdHex <-> CellId`.
5. Strengthen range and virtual-cell identity behavior so lookups never allocate real IDs accidentally and deleted/missing identities resolve predictably.
6. Keep the public compute-core facade stable while moving canonical tests and contracts to the implementation crate and integration paths that execute in production.

## Production-path contracts and invariants to preserve or strengthen

- A `CellId` identifies a logical cell, not a current position. Structural row/column changes update position mappings but do not rewrite identity references.
- Empty cells do not need real `CellId`s. Lookups must not create identities unless the operation is a write or explicit metadata materialization.
- `cell_at_pos` and `cell_to_pos` must be exact inverses: no duplicate positions, no duplicate cells, and no cell mapped outside current row/column axes.
- `RowId` and `ColId` order is the sheet's structural identity state. Index-based properties must resolve through row/column identities, not stored physical indexes.
- Yrs `gridIndex/posToId` is the CRDT winner map for position ownership. `idToPos` is an inverse mirror and must be validated or repaired from `posToId`, not treated as an independent authority.
- `rowOrder` and `colOrder` remain the legacy dense fallback. `gridIndex/rowAxis` and `gridIndex/colAxis` are the compact-axis source when present.
- `SheetDimensionsMut::ensure_capacity` must keep in-memory `GridIndex` axes and Yrs `rowOrder`/`colOrder` in lock-step using the same generated identities.
- Virtual `CellId`s derived from `(SheetId, RowId, ColId)` must stay disjoint from allocator-produced real IDs and must not advance the allocator high-water mark.
- Insert/delete/sort/reorder operations must be bounds-checked and overflow-safe against Mog/Excel row and column ceilings.
- Formula, range, chart, table, conditional-format, named-range, and object anchors that store identity references must resolve through current `GridIndex` state and render `#REF!` or equivalent deleted-reference state when an identity no longer resolves.

## Concrete implementation plan

1. Define a first-class identity contract layer in `compute-document`.
   - Add `GridIndexError`, `GridIndexInvariant`, and `GridIndexValidationReport` types owned by `compute/core/crates/compute-document/src/identity`.
   - Add `GridIndex::validate()` and focused checks for map inversion, axis length, duplicate axis identities, cell bounds, allocator high-water, and virtual-ID handling.
   - Convert mutating APIs that can receive untrusted or persisted inputs to fallible production contracts: registration, capacity growth, structural insertion/deletion, row sort, row-axis reorder, and Yrs hydration helpers.
   - Map `GridIndexError` to `ComputeError` in compute-core storage/service callers rather than panicking or silently skipping invalid state.

2. Validate row permutation semantics in release builds.
   - Introduce a validated `RowPermutation` value that proves source rows, target rows, and bounds before mutation.
   - Use it for both `sort_rows` and `reorder_row_ids`, while keeping their distinct semantics explicit: per-cell sort remaps cell positions only; range sort reorders row identities to match Yrs `rowOrder`.
   - Guarantee failed validation leaves `GridIndex` unchanged.
   - Update range-sort and observer rebuild callers to pass validated permutations instead of raw `(old, new)` tuples.

3. Preserve compact axes through structural mutation.
   - Replace `axis_insert_explicit` with axis-store-native operations that can insert, delete, move, and reorder without forcing a full dense materialization.
   - Extend `AxisIdentityStore` to represent mixed compact runs plus explicit inserted identities when necessary. A single row insert into a compact million-row sheet should add a small explicit segment, not allocate a million `RowId`s.
   - Add persistence support for the mixed/segmented representation under `gridIndex/rowAxis` and `gridIndex/colAxis`.
   - Reserve dense `rowOrder`/`colOrder` materialization for compatibility boundaries that explicitly require it, and make that conversion visible and audited.

4. Centralize identity key encoding and Yrs inverse-map maintenance.
   - Add a typed codec for `GridPositionKey { row_id, col_id }` that formats and parses `rowIdHex:colIdHex`.
   - Replace ad hoc `split_once(':')`, raw string literals, and duplicated `posToId`/`idToPos` update logic across storage cells, cell-editing persistence, snapshots, construction, sync, comments, hyperlinks, relocation, and sheet duplication.
   - During hydration, read `posToId` as authority, derive the expected `idToPos`, and report or repair stale inverse entries.
   - Make malformed Yrs identity state observable with an explicit report that includes sheet, key, cell, and rejected reason.

5. Strengthen hydration and sync rebuild behavior.
   - Update `build_grid_indexes_from_yrs` and `build_grid_from_yrs_for_sheet` to validate compact axes, legacy arrays, `posToId`, and snapshot cells as one contract.
   - Stop silently dropping malformed `posToId` entries unless the caller explicitly requests a best-effort repair mode.
   - Ensure `apply_grid_index_changes`, structural observer rebuild, undo/redo, remote sync, and sheet duplication all end with a validated `GridIndex` plus synchronized `CellMirror`.
   - Add a single production assertion point after structural rebuilds that checks `GridIndex`, `CellMirror`, layout index, and formula identity references agree for affected sheets.

6. Make virtual and range-resident identity behavior explicit.
   - Add `GridIndex` helpers that derive virtual cell IDs from current row/column identities without registering real cells.
   - Audit range payload, deferred import, data table, formatting, conditional-format, table, chart, named-range, and object-anchor callers to distinguish read-only identity lookup from materializing writes.
   - Add contract tests for inserted/deleted rows and columns around virtual IDs so range-resident formulas keep stable references and deleted anchors become unresolved rather than remapped to new real IDs.

7. Keep the public facade intentional.
   - Keep `compute/core/src/identity` as the public compute-core facade over `compute_document::identity`.
   - Move detailed behavior tests to the canonical `compute-document` identity test suite, and keep facade tests as compile/API smoke coverage that proves compute-core exposes the expected identity surface.
   - Document the facade boundary in `compute/core/src/identity/mod.rs` so future callers know not to add a second identity implementation in compute-core.

## Tests and verification gates

Required Rust behavior tests:

- `compute-document` identity unit tests for lifecycle, construction, row/column mutation, sorting, compact/mixed axes, virtual IDs, invalid permutations, overflow/bounds, duplicate registration, and invariant validation.
- Property tests that generate sequences of insert/delete/register/remove/sort/reorder operations and assert map inversion plus stable row/column/cell identity resolution after every step.
- Hydration tests that build Yrs documents with compact axes, legacy arrays, mixed inserted rows/columns, stale `idToPos`, duplicate `posToId`, invalid hex, deleted rows/cols, and virtual cell references.
- Compute-core integration tests for user writes beyond current dimensions, import/deferred hydration, structural undo/redo, remote sync replay, range sort, relocate/cut-paste, metadata-only cells, row/column property maps, and range-resident data.
- Formula/range tests proving identity formulas, conditional-format ranges, named ranges, tables, charts, comments, hyperlinks, and object anchors resolve through current `GridIndex` after structure changes.

Verification gates for the implementation work:

- `cargo test -p compute-document`
- `cargo clippy -p compute-document`
- `cargo test -p compute-core`
- `cargo clippy -p compute-core`
- Focused compute-core integration gates for sync replay, range structural behavior, relocate viewport patches, range collaboration convergence, and XLSX import/export roundtrip once the touched call sites are known.

This planning worker did not run those gates because the queue item explicitly forbids build, test, clippy, and verification commands.

## Risks, edge cases, and non-goals

Risks:

- Making invalid identity state fail fast may expose existing documents or tests that currently rely on silent repair. The implementation should separate strict import/bootstrap from explicit best-effort repair modes.
- A mixed compact/explicit axis representation touches serialization, hydration, and structural operations. It needs focused migration tests so compact persisted documents and legacy dense documents both remain readable.
- Changing mutator signatures to return errors will require updates across storage, mirror, structural mutation, import/export, and scheduler callers.
- Runtime validation must be placed at production boundaries and structural commits, not inside every hot lookup.

Edge cases to cover:

- Zero-row or zero-column sheets.
- Inserts and deletes at the beginning, end, and beyond bounds.
- Counts that would overflow `u32` or exceed `MAX_ROWS`/`MAX_COLS`.
- Duplicate `CellId` registration, duplicate position registration, and moves that vacate old positions.
- Sort permutations with duplicate targets, missing sources, out-of-bounds rows, and partial row sets.
- Compact axis IDs from another sheet or wrong seed.
- Virtual IDs, allocator high-water updates, and client-partitioned allocator IDs.
- CRDT conflicts where `posToId` and `idToPos` disagree.

Non-goals:

- Do not change public spreadsheet APIs from A1/numeric position inputs to identity inputs.
- Do not rewrite the TypeScript grid-index facade except where bridge contracts need to reflect stronger Rust behavior.
- Do not add test-only identity paths, compatibility shims, or alternate identity stores.
- Do not change the external UUID/hex ID wire format except through the typed codec using the existing format.

## Parallelization notes and dependencies on other folders, if any

This work should split cleanly across parallel agents:

- Contract agent: enumerate every `GridIndex` production caller and define the `GridIndexError`/validation API.
- Axis agent: implement mixed compact/explicit axis storage and persistence under `cell-types` plus `compute-document` schema helpers.
- Persistence/sync agent: centralize Yrs key codecs and update hydration, observer, duplication, snapshots, and cell-editing persistence.
- Range/virtual agent: audit range-resident data, virtual IDs, formula identity references, and object/range anchors for read-vs-write identity allocation.
- Verification agent: build the property and integration test matrix and wire it to the relevant crate gates.

Dependencies:

- `compute/core/crates/types/cell-types`: ID newtypes, virtual IDs, axis identity store representation, row/column bounds.
- `compute/core/crates/compute-document`: canonical `GridIndex`, schema keys, Yrs axis serialization, observer change types.
- `compute/core/src/storage`: Yrs persistence, construction, sync, structural mutation, sheet dimensions, snapshots, import/export.
- `compute/core/src/mirror`: fast runtime position lookup and formula/range resolution.
- `compute/core/crates/compute-parser` and `compute/core/crates/compute-graph`: identity formula display and CellId-keyed dependency behavior that must continue to resolve through `GridIndex`.
