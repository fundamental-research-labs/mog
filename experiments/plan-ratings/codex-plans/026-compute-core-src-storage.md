# 026 - Compute Core Storage Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/src/storage`

Scope for this plan is the production storage layer in `compute-core`: the Yrs-backed workbook document, sheet maps, cell maps, grid identity indexes, workbook-level metadata, sheet-level metadata, storage hydration, sync rebuild, mutation dispatch, observer replay, undo/redo integration, export reads, and the hot-path mirrors and indexes that make storage usable by calculation and viewport rendering.

Adjacent production dependencies that must be considered:

- `compute_document` for the Yrs schema constants, cell serde, observer, undo origins, update encoding, and schema-version guards.
- `cell_types` for `SheetId`, `CellId`, `RowId`, `ColId`, `RangeId`, client-partitioned allocators, and grid limits.
- `compute/core/src/mirror/*` for `CellMirror`, `SheetMirror`, projection registries, range views, table/pivot metadata, and row/column reverse indexes.
- `compute/core/src/scheduler/*` for `ComputeCore`, formula registration, recalculation, and allocator sharing.
- `compute/core/src/storage/engine/*` for `YrsComputeEngine`, `EngineStores`, `MutationCoordinator`, mutation handlers, sync, construction, export, viewport, formatting, structural operations, and service facades.
- `compute-collab`, `snapshot_types`, `domain_types`, and XLSX import/export code paths that create, replay, or consume Yrs state.
- Kernel-side state mirror consumers of `MutationResult` payloads, because storage hydration and observer replay must emit enough public state for the app mirror to match the Rust engine.

This is a public Mog source folder. Implementation work belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`storage` is the production state boundary for workbook data. `YrsStorage` owns the Yrs `Doc` and caches root `workbook` and `sheets` maps. The top-level module documents the current hybrid-storage contract: writes go through Yrs, while `CellMirror` and other in-memory structures provide fast reads for calculation and viewport rendering.

The folder currently has several overlapping responsibilities:

- `mod.rs` defines root document bootstrap, Yrs state loading, root map accessors, storage ID allocation, lazy workbook-child map creation, and sheet-order access.
- `engine/mod.rs` defines `YrsComputeEngine`, which wires `CellMirror`, `YrsStorage`, `EngineStores`, `MutationCoordinator`, `ViewportService`, security state, update observers, scenario state, and deferred hydration.
- `engine/stores.rs` groups the state that most services need: storage, grid indexes, layout indexes, merge indexes, `ComputeCore`, conditional-format caches, text-measurement caches, and custom style stores.
- `engine/mutation_coordinator.rs` owns the observer, undo manager, pending recalc/format patches, and sheet-lifecycle history.
- `engine/mutation_dispatch.rs` is the central `EngineMutation` dispatcher for many user-visible mutations, but a broad set of domain modules still open Yrs write transactions directly.
- `cells`, `sheet`, `workbook`, and `properties` own domain-specific persistence helpers for cell values, row/column dimensions, sheet lifecycle, named ranges, workbook settings, tables, slicers, comments, hyperlinks, merges, schemas, sparklines, grouping, floating objects, and formatting.
- `infra/hydration` populates Yrs from snapshots and XLSX parse output, allocating sheet/cell/row/column identities and writing workbook/sheet metadata.
- `engine/construction` builds engines from snapshots or Yrs state, assembles indexes and mirrors, normalizes named ranges, seeds allocators, and initializes caches.
- `engine/sync_pipeline.rs` rebuilds in-memory state after remote Yrs updates and emits hydration-shaped mutation results.
- `engine/services/export` reads the canonical state back out for XLSX/export and bridge-facing projections.

Important current design decisions visible in the source:

- `YrsStorage::new()` intentionally creates only root Yrs maps (`workbook`, `sheets`, `security`). Workbook-level child maps are lazy-created on first write to avoid provider replay LWW conflicts.
- Per-sheet maps are created during sheet creation or hydration as part of the sheet transaction. This differs from workbook-child laziness and should remain explicit.
- `gridIndex/{posToId,idToPos}` is the authoritative Yrs-side cell identity store after the GridIndex migration. `posToId` is the visible winner when concurrent writes target the same position.
- `CellMirror`, `GridIndex`, `LayoutIndex`, `MergeSpatialIndex`, `ComputeCore`, security caches, CF caches, custom style stores, and kernel `MutationResult` payloads must remain synchronized with the Yrs document.
- Sync and undo/redo paths rely on observer replay and Yrs-side position data to rebuild mirror/grid/compute state when in-memory indexes are stale or have been replaced.

## Improvement objectives

1. Make the storage consistency contract executable. Add a shared invariant checker that can prove Yrs, `CellMirror`, `GridIndex`, `LayoutIndex`, merge index, `ComputeCore`, workbook metadata, sheet metadata, and hydration/export projections agree after production mutations.
2. Centralize write transaction policy. Every production Yrs write should have an audited origin, mutation family, affected entity set, and after-write synchronization contract.
3. Normalize workbook-child map creation through one typed registry so new workbook-level domains cannot accidentally reintroduce eager sub-map creation or LWW replay hazards.
4. Make sheet lifecycle storage deterministic and auditable: sheet order, sheet map existence, required per-sheet submaps, row/column axes, defaults, mirror entries, compute sheet registration, and kernel hydration results should all be derived from one contract.
5. Strengthen cell identity invariants. No normal cell value path should create a Yrs cell without a position mapping, a mirror entry, a grid-index entry, and compute registration where applicable.
6. Unify rebuild/export/hydration semantics. `from_snapshot`, `from_yrs_state`, XLSX hydration, sync rebuild, `rebuild_compute_core`, full-state encode/decode, and export should all preserve the same canonical workbook state.
7. Close observer-result gaps. Live local mutations, remote sync replay, undo/redo, and import hydration should emit enough `MutationResult` state for the kernel mirror to match Rust state without ad hoc per-feature fixes.
8. Turn storage tests from domain-only unit coverage into production-path contract coverage across all mutation families.
9. Improve diagnostics so invariant failures identify the exact divergent store and owning mutation rather than surfacing later as blank viewports, stale formulas, lost metadata, or export drift.

## Production-path contracts and invariants to preserve or strengthen

- Yrs remains the collaborative source of truth. No production path should mutate only `CellMirror`, `GridIndex`, `ComputeCore`, layout indexes, merge indexes, or caches when the state is persistent workbook state.
- `CellMirror` remains the hot read cache for calculation and viewport paths. Compute/eval paths should not read the CRDT on hot paths except through intentional rebuild or query boundaries.
- `YrsStorage::new()` must not eagerly create workbook child maps, arrays, or scalar metadata. Blank provider-replay targets must not commit local workbook-child state before remote updates apply.
- Workbook child maps and arrays must be created only through audited lazy helpers, with one registry of allowed workbook-level keys and expected Yrs type.
- Sheet creation/hydration must create a complete sheet map in one transaction: sheet-order entry, metadata, row/column axes, `gridIndex`, cells map, properties map, dimension maps, feature maps, range maps, formatting maps, and object/order maps.
- Every visible sheet in `sheetOrder` must have a sheet map, valid name metadata, row/column axes, mirror sheet, grid index, layout index, merge index, and compute sheet registration. Orphan sheet maps from CRDT conflict losers must not become visible state.
- Sheet names remain Excel-compatible and case-insensitively unique for visible sheets.
- Row/column identity policy must be explicit. Whether `RowId` and `ColId` are sheet-scoped or workbook-unique, `GridIndex`, Yrs row/column arrays, range anchors, dimensions, formulas, and mirror reverse indexes must use the same policy.
- `gridIndex/posToId` is the Yrs-side position winner. `idToPos` is an inverse/recovery map and must not resurrect losing cells during hydration, sync rebuild, export, or observer replay.
- A normal physical cell in `cells` must have a stable `CellId`, row/column position, raw value, optional formula, optional identity formula, optional array/CSE marker, mirror entry, grid entry, and compute registration consistent with its type.
- Metadata-only anchored identities, such as comment/note anchors on empty cells, must be represented deliberately: they may have grid identity without a physical cell value entry, but they must be distinguishable from missing value writes.
- Clearing a cell must remove or null the correct Yrs cell data, remove stale position mappings where appropriate, preserve old values for undo/redo, update mirror/grid only after compute has consumed positions needed for viewport patches, and not leave formulas or dependencies registered.
- Formula text, identity formulas, named-range references, structured references, CSE array refs, dynamic-array projections, and formula writeback after structural edits must round-trip through one canonical identity format.
- Structural mutations must update row/column axes, cell positions, range anchors, formulas, dimensions, layout indexes, merge indexes, security structure version, mirror row/col reverse indexes, and viewport patches atomically from the caller perspective.
- Workbook and sheet metadata families must have one source of truth for persistence and one documented mirror/export owner: settings, protection, print, view, tables, pivots, slicers, filters, schemas, conditional formats, comments, hyperlinks, sparklines, grouping, floating objects, custom styles, themes, links, document properties, and fidelity metadata.
- Undo/redo, remote sync, provider replay, deferred hydration completion, and rebuild-from-Yrs must preserve the same visible state as the original local mutation path.
- Update observers installed for provider fan-out must stay attached for the engine lifetime and after storage replacement.
- CF caches, custom style stores, security caches, layout indexes, merge indexes, and compute caches must be invalidated or rebuilt when their persisted inputs change.
- Public dependency direction stays intact: `mog` and `compute-core` must not depend on `mog-internal`.

## Concrete implementation plan

1. Add a storage invariant contract module.

   - Create a production-compiled `storage/invariants` module with read-only validators and a structured `StorageInvariantReport`.
   - Validate root schema: root maps, schema version when present, lazy workbook-child absence on blank docs, workbook child map types, and security map shape.
   - Validate visible sheet graph: sheet order, sheet maps, sheet names, per-sheet submaps, row/column axes, grid index maps, mirror sheets, compute sheet order, layout indexes, merge indexes, CF cache entries, and security structure version expectations.
   - Validate cells: Yrs cell map entries, `posToId` winner mapping, `idToPos` inverse, mirror position/value/formula, `GridIndex` registration, `ComputeCore` formula registration, CSE/projection registry state, and stale-loser handling.
   - Validate metadata families: named ranges, workbook settings, tables, slicers, pivot specs, sheet settings, comments, hyperlinks, merges, schemas, CFs, filters, sparklines, grouping, dimensions, range formats, and floating objects.
   - Expose this as a normal internal API that tests and debug/diagnostic paths can call. Do not hide the contract in a test-only module.

2. Build a typed storage write boundary.

   - Introduce `StorageWriteOrigin` and `StorageMutationFamily` wrappers around Yrs origins such as user edit, bootstrap, UI state, and structural edit.
   - Add a `StorageWriteContext` that opens transactions, records affected sheets/cells/workbook domains, and can run invariant spot checks after commit in debug or test builds.
   - Inventory every production `transact_mut` call under `storage` and classify it as cell, sheet lifecycle, sheet metadata, workbook metadata, structural, object, feature, import/hydration, sync, security, or test helper.
   - Migrate production writers to accept the context or call typed helpers. Keep tests free to use direct Yrs setup only through explicit test-support modules.
   - Ensure every bridge-facing method that mutates persisted state routes through `EngineMutation` or a documented domain-specific service with equivalent validation, origin tagging, observer/update-buffer behavior, and cache invalidation.

3. Normalize workbook-level child map and array ownership.

   - Replace ad hoc `ensure_*_map` helpers with a typed `WorkbookChild` registry for all workbook children: sheet order, settings, named ranges, tables, slicers, power query, scenarios, data tables, connections, theme, document properties, file metadata, custom styles, pivot specs, timelines, shared strings, package fidelity, and external-link metadata.
   - Have `ensure_settings_map`, named-range helpers, table persistence, slicer persistence, hydration workbook helpers, and query-time creators delegate to this registry.
   - Add an audited array equivalent for `sheetOrder`, and forbid direct `workbook.insert(KEY_*, MapPrelim...)` for workbook children outside the registry.
   - Add tests proving `YrsStorage::new()` creates only root maps, then replay a populated update into a blank doc and verify settings, named ranges, tables, slicers, data tables, styles, and document properties remain visible.
   - Add a static/code-search gate in tests or dev tooling that fails when new workbook-child insertions bypass the registry.

4. Consolidate sheet lifecycle schema creation.

   - Introduce a `SheetStorageSchema` or `SheetStorageBuilder` that owns the complete list of per-sheet maps, arrays, defaults, and row/column axis initialization.
   - Use it from `add_sheet_with_origin`, snapshot hydration, XLSX hydration, sheet copy, default-sheet creation, and sync rebuild fixtures.
   - Make sheet order updates go through typed helpers that preserve visible order, avoid duplicate visible IDs, and emit correct `SheetChange` payloads for create/delete/move/reorder/copy/undo/redo.
   - Document and enforce row/column identity allocation policy. If row/column IDs are sheet-scoped, encode the sheet boundary in validators; if they must be document-unique for ranges or formulas, switch creation and hydration to the engine allocator and update tests.
   - Add one visible-sheet enumerator on `YrsComputeEngine` that returns typed `SheetId`s and becomes the public internal replacement for reaching through to `YrsStorage::sheet_order`.

5. Make cell identity writes atomic and complete.

   - Define a `CellWritePlan` that carries sheet, position, `CellId`, row/column identity, raw value, formula source, identity formula, array marker, old value, and whether the write is physical, virtual, or metadata-only.
   - Make all normal cell write paths use the plan: single cell, batch cell, raw replay, import values, array formulas, clear range, copy/paste, sort, fill, remove duplicates, structural relocation, data table writes, and scenario apply/restore.
   - Audit low-level `YrsStorage::set_cell` and any other direct cell-map writers so they either write `gridIndex` position mappings in the same transaction or are restricted to test-support paths.
   - Ensure `write_cell_to_yrs_in_txn` and `remove_cell_position_from_yrs` become the only production helpers that mutate physical cell position mappings.
   - Preserve concurrent-position winner semantics: hydration and rebuild must walk `posToId`, skip `idToPos` losers, and remove or ignore loser mirror/compute entries deterministically.
   - Add invariants for CSE anchors, dynamic-array projections, region-backed virtual cells, and metadata-only anchors so they cannot be confused with ordinary physical cells.

6. Centralize state rebuild and snapshot/export reads.

   - Define one canonical read projection for "current visible workbook state" that can power `build_workbook_snapshot_from_yrs`, `build_workbook_snapshot`, sync rebuild, export helpers, and invariant comparison.
   - Make the projection explicit about source of truth per field: Yrs-only, mirror-backed, compute-backed, cache-backed, or derived.
   - Reconcile duplicated handling in construction snapshots, sync rebuild, hydration result building, and export modules so the same metadata families are not manually enumerated differently in each path.
   - Add round-trip fixtures that compare: snapshot -> engine -> Yrs state -> engine, XLSX parse output -> engine -> export projection, local mutation -> full-state encode -> remote engine, and remote diff replay -> sync rebuild.
   - Keep performance on production paths by sharing read scanners and indexes rather than adding broad Yrs scans on hot viewport/calculation paths.

7. Complete observer and mutation-result contracts.

   - Build a matrix of every persisted storage family and whether local live mutation, remote observer replay, undo, redo, import hydration, sync rebuild, and export should emit it.
   - Extend `DocumentObserver` or result builders to capture missing old-state fields where necessary, rather than leaving TODO-shaped old-name/old-index/old-color holes indefinitely.
   - For families where old state is intentionally unavailable on remote replay, emit hydration-shaped "Set" state and document why that is the correct kernel mirror contract.
   - Ensure `MutationResult` hydration covers all direct-state and mirror-backed families needed by the kernel mirror, including workbook settings, sheet settings, sheet order, sheet identity, page/print/view state, objects, tables, pivots, filters, CFs, comments, ranges, named ranges, sparklines, grouping, and slicers.
   - Add tests that apply the same operation locally and through encoded sync updates, then compare Rust engine state, kernel-facing mutation payloads, and invariant reports.

8. Harden structural operations and dependent indexes.

   - Create a structural operation contract that lists all stores each operation must update: Yrs axes, Yrs grid index, cell maps, mirror positions, row/col reverse indexes, formula writeback, named ranges, range-backed storage, tables, pivots, filters, charts, floating object bounds, comments, hyperlinks, dimensions, layout index, merge index, security version, CF cache, and viewport registry.
   - Make insert/delete/move rows/cols, range copy/sort/fill, merge/unmerge, sheet copy/delete, and group/sort/filter operations return a typed `StorageStructuralDelta`.
   - Use that delta for cache invalidation, formula writeback, mutation results, viewport patches, and invariant spot checks.
   - Add validators for partial overlap with merged cells, dynamic arrays, CSE arrays, table regions, schema ranges, data-table regions, and protected ranges before any write transaction opens.

9. Improve diagnostics and observability.

   - Add tracing spans for storage writes with mutation family, origin, sheet/cell counts, affected metadata families, Yrs update byte count, observer change count, recalc output count, and invariant failures.
   - Add a compact invariant failure formatter that prints stable IDs, Yrs path, mirror path, grid position, and owning module.
   - Replace production `unwrap`/`expect` calls in non-test storage code when they can be reached through malformed/collaborative/imported data. Keep structurally unreachable cases only behind narrow helper types that prove the precondition.
   - Keep debug diagnostics internal. Do not add public bridge fields unless existing app diagnostics need them.

10. Build a production-path storage contract test suite.

   - Add compact workbook fixtures for blank docs, multi-sheet docs, formulas, dynamic arrays, CSE arrays, tables, named ranges, comments, hyperlinks, dimensions, merges, schemas, filters, CFs, pivots, slicers, sparklines, grouping, floating objects, workbook settings, sheet settings, protection, print/view state, custom styles, external links, and document metadata.
   - For each fixture, run production APIs: `from_snapshot`, create default sheet, set cells, batch cells, clear cells/ranges, structural edits, metadata mutations, undo/redo, full-state encode/decode, diff sync, rebuild compute core, export projection, deferred hydration completion, and XLSX import/export where applicable.
   - After each operation, run the invariant checker and compare visible workbook projections across local, synced, rebuilt, and exported forms.
   - Avoid direct state mutations in tests except inside explicit low-level storage unit tests whose purpose is schema codec validation.

## Tests and verification gates

Focused tests to add or update during implementation:

- Storage invariant unit tests for root maps, workbook-child laziness, sheet schema completeness, sheet order, row/column axes, grid-index bijection, cell value/formula identity, metadata-only anchors, and stale-loser conflict handling.
- Production mutation tests under `compute/core/src/storage/engine/tests` for cell edits, batch edits, clears, sheet lifecycle, structural edits, formatting, comments, hyperlinks, tables, pivots, filters, CFs, schemas, sparklines, grouping, objects, workbook settings, and sheet settings.
- Sync/provider replay tests proving blank-doc replay does not shadow workbook children and that local/diff/full-state replay converge to the same visible projection.
- Undo/redo tests that verify old values, old metadata, sheet lifecycle hints, CSE/dynamic-array state, dimensions, merges, row/column axes, and kernel-facing mutation results.
- Hydration/export tests that compare `from_snapshot`, XLSX hydration, deferred hydration, `from_yrs_state`, `rebuild_compute_core`, and export projections.
- Negative/corrupt-state tests that feed malformed Yrs maps into read/rebuild paths and assert deterministic errors or ignored non-visible state, not panics or divergent mirrors.

Required final gates for an implementation touching this folder:

- `cargo test -p compute-core storage::`
- `cargo test -p compute-core engine::tests`
- `cargo test -p compute-core`
- `cargo clippy -p compute-core`
- `cargo test -p compute-collab` and `cargo clippy -p compute-collab` if sync encoding, observer, or provider replay contracts change.
- `cargo test -p compute-document` and `cargo clippy -p compute-document` if schema, observer, undo origin, or cell serde code changes.
- XLSX/file-IO focused tests if hydration/export metadata mappings change.

Behavior verification must use production storage and engine entrypoints: `YrsComputeEngine::from_snapshot`, `from_yrs_state`, bridge-facing mutation methods, sync update APIs, undo/redo APIs, import/export APIs, and rebuild APIs. Do not prove storage correctness by mutating private maps directly and then asserting a helper returns the expected value.

Performance verification, if any storage scanners or validators are added to production paths, must target real import, sync, mutation, rebuild, and export paths. Invariant validation can be broad in tests, but production hot paths must use targeted checks or diagnostic-only sampling.

## Risks, edge cases, and non-goals

Risks:

- Centralizing transaction policy can accidentally change undo grouping or observer behavior. Origin semantics must be tested per mutation family before migration is considered complete.
- Workbook-child registry work can reintroduce provider replay bugs if any key bypasses lazy creation. Add search-backed tests and replay fixtures before broad refactors.
- Sheet schema consolidation can break XLSX round-trip fidelity if rarely used metadata maps are omitted. The schema registry must be built from the current complete key set, not from only common sheets.
- Cell identity tightening can expose existing paths that write physical cells without position mappings. Fix the category, do not add compatibility fallbacks that preserve missing identity writes.
- Invariant checks can become too expensive if run unconditionally on every mutation. Keep the checker complete, but choose production invocation points deliberately.
- Sync rebuild and hydration result consolidation can change kernel mirror payload shapes. Tests must compare app-visible mirror state, not only Rust state.
- Row/column identity policy may reveal ambiguous assumptions in ranges, dimensions, formulas, and copied sheets. Resolve the policy explicitly before changing allocators.

Edge cases to cover:

- Blank doc provider replay with remote workbook settings, named ranges, tables, slicers, styles, document properties, and data-table regions.
- Two independently bootstrapped peers creating the same deterministic default sheet ID but different nested Yrs maps.
- Concurrent cell writes to the same position with different `CellId`s, followed by full-state load, diff replay, undo, redo, and export.
- `idToPos` entries that exist without a winning `posToId`, malformed position strings, missing row/column axis entries, and orphan physical cell maps.
- Metadata-only cells for comments, notes, hyperlinks, merge placeholders, range schemas, and object anchors.
- Dynamic arrays, CSE arrays, region-backed virtual cells, spill blockers, and structural edits through projection ranges.
- Sheet copy/delete/rename/reorder with sheet-scoped named ranges, tables, formulas, print areas, pivots, charts, slicers, comments, and external links.
- Row/column insert/delete/move across dimensions, hidden rows/cols, filters, grouping, schemas, range formats, tables, merges, and floating object bounds.
- Deferred XLSX hydration followed by first mutation, sync update, export, or rebuild before and after completion.
- Corrupt or older Yrs state with missing optional maps, legacy axis arrays, compact axis stores, or unknown metadata.

Non-goals:

- Do not replace Yrs with a different storage engine.
- Do not move formula evaluation, scheduling, or canvas rendering responsibilities into storage.
- Do not optimize benchmark-only or test-only paths as the primary outcome.
- Do not add compatibility shims that preserve broken storage state behind feature flags.
- Do not make `mog` depend on `mog-internal`.
- Do not broaden this plan into a full file-format rewrite except where hydration/export contracts need shared storage projections.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the invariant matrix and mutation-family ownership table are written down.

- Agent A: build the invariant matrix and implement read-only validators for root schema, workbook children, sheet lifecycle, grid identity, cells, and metadata families.
- Agent B: inventory and migrate transaction/origin usage, including write contexts, direct `transact_mut` classification, and origin-specific undo/update-buffer tests.
- Agent C: implement workbook-child registry and sheet schema builder, with provider replay and sheet lifecycle tests.
- Agent D: implement cell identity/write-plan consolidation across cell edits, bulk edits, clears, arrays, imports, range operations, and metadata-only anchors.
- Agent E: consolidate rebuild, hydration, export, and sync projection contracts, then add round-trip and kernel-mirror payload tests.
- Agent F: harden structural-operation deltas, cache invalidation, formula writeback, layout/merge index updates, and security structure-version behavior.
- Agent G: run final production-path verification, investigate invariant failures, and measure any added scanner cost on import/sync/export paths.

Dependencies:

- The invariant matrix should land first. It gives every later agent a shared acceptance contract.
- Workbook-child registry work should land before adding new workbook metadata writers, because it protects the provider replay contract.
- Sheet schema builder and cell write-plan work can proceed in parallel once row/column identity policy is documented.
- Rebuild/export consolidation depends on the invariant checker so equivalence failures are diagnosable.
- Structural-delta hardening depends on cell identity and sheet-axis policy, because structural edits touch both.
- Changes touching `compute_document` observer/schema/undo contracts should be coordinated with compute-collab and kernel mirror plans.
