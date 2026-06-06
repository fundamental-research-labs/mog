# 026 — Harden the Yrs-Backed Storage Layer's Workbook/Sheet/Cell Invariants

## Source folder and scope

- **Source folder:** `/Users/guangyuyang/Code/mog-all/mog/compute/core/src/storage`
- **Crate:** the Rust compute core (`mog/compute/core`), compiled to wasm and consumed by `compute-core-wasm` and the SDK. `storage/mod.rs` is the module root; `engine`, `properties`, `security_cache`, `security_state` are `pub`, while `cells`, `infra`, `sheet`, `sheet_dimensions`, `table_format`, `workbook` are the internal organization.
- **In scope:** the full subtree (~138.5k LOC across `cells/`, `engine/`, `infra/`, `properties/`, `sheet/`, `sheet_dimensions/`, `workbook/`, plus `mod.rs`, `properties.rs`, `security_cache.rs`, `security_state.rs`, `table_format.rs`). The unifying contract is the **Hybrid Storage** pattern described in `mod.rs:1-58`: a `yrs::Doc` is the CRDT source of truth, and a `CellMirror` is a fast read cache; *every write must keep the two coherent*.
- **Out of scope (non-goals):** the formula dependency graph / recalc scheduler (`ComputeCore` lives outside this folder and is consumed via `engine`), the `mirror` crate's internal data structures, the `compute-collab` sync transport, XLSX byte-level parsing upstream of `infra/hydration`, and the TS-side SDK. Test-only patches, compatibility shims, or "make the panic a silent `None`" workarounds are explicitly rejected — the objective is to fix the production write/read paths at their source.

This is a planning artifact in `mog-internal`. It references public source by path but introduces no internal terminology into `mog/compute/core/src/storage`.

## Current role of this folder in Mog

This folder *is* Mog's persistent document model. It owns the `YrsStorage` struct (`mod.rs:170-179`) wrapping the `yrs::Doc` plus cached `workbook`/`sheets` root `MapRef`s, and it defines the entire document schema (`mod.rs:9-58`):

```
Y.Doc
+-- workbook: Y.Map { sheetOrder, stylePalette, workbookSettings, namedRanges, tables, slicers, powerQuery, scenarios }
+-- security: Y.Map { policies, version, templates }
+-- sheets: Y.Map<SheetId, Y.Map { cells, properties, gridIndex{posToId,idToPos}, rowHeights, colWidths,
                                   meta, schemas, charts, merges, hiddenRows, hiddenCols, rows, cols,
                                   rowIndex, colIndex, rowFormats, colFormats, comments, filters,
                                   sparklines, conditionalFormat, bindings, grouping, sorting,
                                   floatingObjects, floatingObjectGroups, rangeFormats }}
```

The architecture rests on three load-bearing facts established this pass:

1. **Yrs is authoritative; the `CellMirror` follows.** Writes go through a `TransactionMut` and are mirrored into `CellMirror` so the compute engine never touches the CRDT on the hot path (`mod.rs:3-7`). After a *remote* sync the engine rebuilds all in-memory state from yrs rather than trusting observer callbacks (`engine/sync_bridge.rs`), because remote `apply_update` may merge state without firing observers.

2. **Identity, not position, is the key.** Cells are keyed by a stable `CellId` (u128). The `gridIndex/{posToId,idToPos}` pair is a **bijection** between `"rowHex:colHex"` positions and `cellHex` identities, mirrored into an in-memory `GridIndex`. Row/column formats, structural shifts, and undo all operate on `RowId`/`ColId`, not indices. The schema comment records that the older `cellGrid`/`cellPos` stores were retired in the "GridIndex migration" and `gridIndex/{posToId,idToPos}` is now "the authoritative yrs-side identity store" (`mod.rs:30-33`).

3. **Map creation order is a correctness concern, not a detail.** `YrsStorage::new()` eagerly creates only the three *root* maps and deliberately leaves every workbook-child sub-map to be lazy-created on first write via `ensure_workbook_child_map` (`mod.rs:186-243`, `mod.rs:376-388`). The long doc-comment explains why: two sessions that each eagerly insert the same workbook-child key race on a yrs Map LWW resolution that silently shadows one side's entire sub-tree (the "Provider Protocol" / issue #112 blank-viewport bug).

Mutations funnel through a single dispatch point (`engine/mutation_dispatch.rs` `apply_mutation`) that is responsible for keeping five stores coherent in lock-step: the yrs Doc, the `CellMirror`, the per-sheet `GridIndex`es, the `ComputeCore` dep graph, and the undo manager. The central risk surface of this folder is therefore **divergence**: any write path that updates one store but not another, or that swallows an error after a partial write, breaks the invariant that makes the whole hybrid design correct.

Observed scale/shape this pass: the largest files are `engine/tests/test_xlsx_export.rs` (1812), `engine/tests/test_formatting.rs` (1276), `workbook/named_ranges/tests.rs` (1184), `sheet/hyperlinks/tests.rs` (1062), `engine/features/mod.rs` (1078), `engine/services/metadata_shift.rs` (1038), `infra/hydration/features.rs` (1044), `engine/sync_pipeline.rs` (1016), `engine/queries.rs` (1011). The folder is test-heavy, which is good — but the gaps below are in production paths the tests do not currently pin.

## Improvement objectives

1. **Make yrs↔mirror coherence fail-loud and transactional.** Eliminate the write paths that silently no-op the yrs write but still mutate the mirror (the primary drift vector), and stop logging-and-continuing after a partial CRDT write.
2. **Promote the gridIndex bijection and per-sheet axis identity to enforced invariants** with a single auditable verifier, and make the `SheetNotFound`-from-missing-axis-identity failure self-describing instead of a misleading generic error (cf. memory: *resize SheetNotFound misleading*).
3. **Complete the GridIndex migration** by retiring the legacy `rows`/`cols`/`rowIndex`/`colIndex` per-sheet registries that the schema now describes as superseded, so there is exactly one authoritative identity store.
4. **Finish the workbook→per-sheet pivot storage migration** flagged by live TODOs, removing the orphaned workbook-level pivot hydration path.
5. **Remove the deprecated global ID allocators from all production paths**, leaving `EngineStores`-scoped allocation as the only minting route so collaborative ID partitioning holds.
6. **Fix the enumerated latent correctness bugs** (UTF-8 byte/char confusion in text-to-columns, locale-number `unwrap`, silent compact-property deserialization failures) on the production data path, not behind a test.
7. **Audit and tighten the `ensure_workbook_child_map` lazy-bootstrap discipline** so every workbook-child writer uses it (no eager insert reintroduces the LWW-shadow bug), and document/lock the eager-vs-lazy rule.

## Production-path contracts and invariants to preserve or strengthen

These are the invariants the implementation must keep true; several are currently only *intended* and must be promoted to *enforced*.

- **I1 — Source-of-truth ordering.** A successful cell/sheet/property write commits to the yrs `TransactionMut` *first*; only after the transaction is established does the `CellMirror` get the matching edit. If the yrs side cannot be reached (sheet map or `cells` map missing), the mirror **must not** be updated and the caller **must** see an error. Today `set_cell` (`cells/values/storage_methods.rs:215-242`) violates this: the yrs write is gated behind a nested `if let Some(... YMap ...)` (lines 219-222) that silently falls through when the sheet/cells map is absent, yet `mirror.apply_edit(...)` runs unconditionally at lines 235-241. That is a direct mirror-drift path.
- **I2 — No partial-write success.** A write that fails after mutating part of the document must surface the failure, not log-and-continue. `set_cell` writes the cell prelim, then on a failed `write_identity_formula_to_yrs` only `tracing::error!`s (`cells/values/storage_methods.rs:226-230`) while still pushing the identity formula into the mirror — yrs and mirror now disagree about the formula. This must become an error return (the yrs transaction is dropped/aborted) so the five-store dispatch can refuse the mutation cleanly.
- **I3 — Structural-shift mirror coherence.** Row/col insert/delete updates the yrs `rowOrder`/`colOrder`, the `GridIndex`, deleted-cell cleanup, and `CellMirror` inside one `ORIGIN_STRUCTURAL` transaction (`sheet/structural/mod.rs`). The mirror update currently discards its result: `let _ = mirror.apply_structure_change(sheet_id, &change)` at `sheet/structural/mod.rs:89` and `:182`, and `engine/services/structural/structure_change.rs:129`. A mirror failure here leaves yrs shifted and the mirror unshifted. The result must be checked and propagated.
- **I4 — gridIndex bijection.** For every sheet, `posToId` and `idToPos` are exact inverses, and every position references a `rowHex`/`colHex` that resolves to a live row/col identity. Hydration already enforces the "anchor references a missing row/col identity ⇒ error" rule (`infra/hydration/sheet/grid_index.rs`), but there is no runtime/debug verifier on the steady-state mutation paths. This must be promotable to a single `debug_assert`-backed audit.
- **I5 — Sheet-order ↔ sheets-map consistency.** Every hex in `workbook/sheetOrder` is a key in `workbook/sheets` and vice-versa; create/delete/reorder maintain both in one transaction (`sheet/crud.rs`, `sheet/order.rs`). Strengthen by adding the cross-domain cleanup that is currently missing: deleting a sheet does **not** clean up sheet-scoped named ranges, leaving them unresolvable (observed in `sheet/crud.rs` remove path vs `workbook/named_ranges/`).
- **I6 — Merge non-overlap.** No two merge ranges in a sheet overlap; creation rejects overlaps and `merge_and_center` unmerges first (`sheet/merges/mutations.rs`, `resolve.rs`). Preserve as-is; add to the audit (I4 verifier).
- **I7 — Lazy workbook-child bootstrap (Provider Protocol).** No workbook-child sub-map is eagerly inserted in `YrsStorage::new`; every writer goes through `ensure_workbook_child_map` (`mod.rs:376-388`). Preserve and *enforce by audit* — a reintroduced eager insert silently resurrects the LWW-shadow blank-viewport bug.
- **I8 — Collaborative ID partitioning.** Runtime IDs are minted from a client-partitioned `IdAllocator` keyed off the doc client id (`mod.rs:119-158`) so state vectors round-trip and concurrent peers don't collide. The module-global `STORAGE_ID_ALLOC` / `next_id_hex` / `next_id_uuid_string` are explicitly `Deprecated` in favor of `EngineStores::next_id_hex()` (`mod.rs:99-115`) but remain reachable; production paths must not use the unpartitioned global.
- **I9 — Compact vs structured property duality.** A cell's properties are either a structured Y.Map (post user edit) or a compact JSON string referencing the workbook `stylePalette` (post XLSX import); reads must resolve both (`properties/yrs.rs`). Strengthen: a malformed compact payload must not silently degrade to "no format" (`properties/yrs.rs:61,73` use `.ok()` / `.ok()?`).

## Concrete implementation plan

The work is sequenced so the coherence/invariant fixes (which protect everything else) land first, the migrations follow, and the latent-bug fixes are independent and parallelizable.

### Phase 1 — Close the yrs↔mirror drift paths (I1, I2, I3)

1. **`set_cell` must be fallible and yrs-first.** Change `cells/values/storage_methods.rs:200-242` so the navigation to the `cells` map returns `Result<_, ComputeError::SheetNotFound>` (or a new `CellsMapMissing`) instead of a silent `if let` fall-through. Only after the yrs cell prelim and identity-formula writes both succeed inside the transaction does `mirror.apply_edit` run. On `write_identity_formula_to_yrs` error (lines 226-230), abort the transaction (drop the `TransactionMut` without the mirror edit) and propagate the error. Update the single dispatch caller in `engine/mutation_dispatch.rs` / the mutation handlers to thread the `Result` (they already operate in a `Result`-returning context per `engine/sync_pipeline.rs`).
2. **Audit sibling write methods in the same file** (`remove_cell_with_origin` at `:250+`, and the batch `set_cell_values` path) for the same "mirror updated regardless of yrs reachability" shape and apply the same yrs-first ordering.
3. **Check the structural mirror result.** Replace `let _ = mirror.apply_structure_change(...)` at `sheet/structural/mod.rs:89`, `:182`, and `engine/services/structural/structure_change.rs:129` with explicit handling: on `Err`, abort the structural transaction and return the error so yrs is never shifted without the mirror. (The `sync_pipeline.rs:313,819` `let _ = self.mirror.add_sheet(...)` calls are on the rebuild-from-yrs path and are lower risk, but should be reviewed for the same reason and at minimum logged at `warn` with the sheet id.)

### Phase 2 — Promote and verify the identity invariants (I4, I5, I6, I7)

4. **Single invariant verifier.** Add a `debug_assert`-gated `verify_storage_invariants(&self, txn)` (in a new `engine/integrity.rs` or alongside `engine/grid_indexing.rs`) that, per sheet, checks: (a) `posToId`/`idToPos` are mutual inverses; (b) every position's `rowHex`/`colHex` resolves in `rowOrder`/`colOrder`; (c) `sheetOrder` ⊇⊆ `sheets` keys; (d) no merge overlap. Call it at the end of structural ops and cell-write batches under `cfg(debug_assertions)` so CI/test runs fault on drift without costing production hot-path time.
5. **Make `SheetNotFound`-from-missing-axis-identity self-describing.** Per memory (*resize SheetNotFound misleading*), the col/row resize `SheetNotFound` really means "the grid index lacks an axis identity for that index," and it is data-dependent (no repro on blank sheets). Introduce a distinct error variant (e.g. `AxisIdentityMissing { sheet, axis, index }`) at the resize/structural read boundary (`sheet_dimensions/mod.rs`, `engine/services/structural/dimensions.rs`, `sheet/schemas/columns.rs`) so the failure names the real cause instead of masquerading as a missing sheet. Keep `SheetNotFound` for genuinely absent sheets only.
6. **Sheet-deletion cross-domain cleanup (I5).** In the `remove_sheet` path (`sheet/crud.rs`), remove or tombstone sheet-scoped named ranges (and audit pivots/slicers/CF that may reference the deleted sheet) so deletion cannot strand unresolvable references.
7. **Lock the lazy-bootstrap rule (I7).** Confirm every workbook-child writer routes through `ensure_workbook_child_map` (named_ranges, tables, slicers, powerQuery, settings, styles, protection, custom — all already observed using it in `workbook/**` and `infra/hydration/workbook.rs`). Add a module doc-comment cross-link and the audit check that no `workbook.insert(KEY_*, MapPrelim/ArrayPrelim)` exists outside `ensure_*` helpers.

### Phase 3 — Retire superseded stores and finish migrations (I8, objectives 3 & 4)

8. **Remove the deprecated global allocators from production (I8).** Grep all `next_id_hex()` / `next_id_uuid_string()` / `STORAGE_ID_ALLOC` references; route every non-test, non-import production caller through `EngineStores::next_id_hex()`. If the import pipeline genuinely needs a doc-less allocator, give it an explicit partitioned allocator passed in, not the module global. Then narrow the `#[allow(dead_code)]` globals to `#[cfg(test)]` (or delete if unused after the sweep).
9. **Retire legacy `rows`/`cols`/`rowIndex`/`colIndex` per-sheet maps.** The schema comment marks `gridIndex/{posToId,idToPos}` as authoritative and the older identity stores as retired in migration (`mod.rs:30-45`). Audit remaining readers/writers of these four maps; migrate any survivors to `GridIndex`/`rowOrder`/`colOrder`; stop writing them on the create/hydrate path (`sheet/crud.rs add_sheet_with_origin`, `infra/hydration/sheet/`). Keep a read-tolerant migration window for old persisted docs (read legacy if present, never write) — this is a schema-compat read path, *not* a shim, so it is permitted.
10. **Finish the pivots workbook→per-sheet migration.** Resolve the live TODOs at `infra/hydration/import.rs:234` and `infra/hydration/workbook.rs:665` ("Remove workbook-level pivot hydration — pivots will be stored per-sheet"). Move pivot storage under the sheet sub-map, update hydration to populate per-sheet, and delete the orphaned workbook-level path once readers are migrated.

### Phase 4 — Latent correctness-bug fixes (objective 6, independent)

11. **Text-to-columns UTF-8 correctness.** `cells/data_ops.rs` fixed-width splitter treats char break positions as byte offsets (`:204` documented latent bug) and `:157` `value.char_indices().nth(i).unwrap()` can panic for non-ASCII. Replace byte/char conflation with char-boundary-safe slicing and remove the `unwrap` in favor of bounds-checked iteration; add the non-ASCII case to the data_ops tests.
12. **Locale-number parsing `unwrap`.** `cells/values/parsing.rs:394-395` `rfind(...).unwrap()` assumes both a comma and a period are present in a locale-ambiguous numeric string. Guard the `rfind` results and fall back to the existing parse-failure (`None`) arm rather than panicking on malformed input.
13. **Compact-property deserialization must not silently lose formatting (I9).** `properties/yrs.rs:61,73` swallow malformed compact JSON / palette inflation with `.ok()`/`.ok()?`, degrading to "no format." Surface a recoverable diagnostic (return a typed parse error to the property-read caller, or at minimum a rate-limited `warn` with the cell/style id) so corrupted imports are visible rather than silently blank-formatted.
14. **Lower-priority TODO debt (batch as capacity allows, each independently):** CF format linear-scan perf (`sheet/cf_store/formats.rs:224`), observer old-state retention so mutations can emit prior name/index/color/frozen state (`engine/services/mutation_handlers/result_building/observer.rs:569,579,599,606`), table auto-expansion detection (`engine/services/tables/queries.rs:109`), sort/filter consolidation (`engine/services/mutation_handlers/range_operations/sort.rs:82`). These are not coherence-critical; schedule after Phases 1-3.

## Tests and verification gates

> Per task constraints this plan does not run builds or tests; the gates below define what the implementing change must satisfy.

- **Coherence regression tests (Phase 1).** Add storage-level tests that: (a) call `set_cell` against a missing sheet/cells map and assert it returns an error *and* leaves the mirror untouched (no drift); (b) force `write_identity_formula_to_yrs` failure and assert the cell is absent from both yrs and mirror; (c) force `apply_structure_change` failure and assert the yrs `rowOrder`/`colOrder` are not shifted. These live under `engine/tests/` and `cells/values/tests` alongside the existing suites.
- **Invariant audit as a test gate (Phase 2).** Run `verify_storage_invariants` at the end of every existing structural/cell mutation test (it is `debug_assert`-gated, so a violation faults the test binary). Add a targeted test for the `AxisIdentityMissing` vs `SheetNotFound` distinction reproducing the data-dependent resize case from memory.
- **Migration parity (Phase 3).** Snapshot/round-trip tests proving (a) docs written without the legacy `rows`/`cols`/`rowIndex`/`colIndex` maps hydrate identically, and old docs *with* them still load (read-tolerance); (b) pivots authored per-sheet survive export→import→export unchanged (extend `engine/tests/test_xlsx_export.rs`); (c) no production code path mints IDs from the global allocator (a `grep`-style source assertion or a `#[cfg(test)]` poisoning of the global).
- **Latent-bug tests (Phase 4).** Non-ASCII text-to-columns fixed-width split; locale-ambiguous and malformed numeric parse inputs; malformed compact-property payload yields a surfaced diagnostic rather than silent default.
- **Standard gates (run by the implementer, not here):** `cargo build`/`cargo test` for the compute core, plus the existing `app-eval`/`api-eval` harnesses for resize, structural, merge, and import scenarios (cf. memory: *app-eval usage*, *api-eval usage*). A clean full `app-eval` run is the integration gate, given the deterministic-state-leak gotcha noted in memory (*ribbon collapse width-based*).
- **No-regression on collaboration:** the Provider-Protocol replay test referenced in `mod.rs:219` (`compute-collab/tests/provider_replay.rs`) must still pass after the Phase 2 lazy-bootstrap audit.

## Risks, edge cases, and non-goals

- **Behavioral change risk (Phase 1).** Making `set_cell` fallible changes a previously-infallible signature; every caller in `engine/mutation_dispatch.rs` and the mutation handlers must thread the `Result`. Mitigation: the dispatch layer is already `Result`-returning, so this is plumbing, not new error surfacing to the SDK — but it must be done in one change set, no half-migration.
- **Schema-compat (Phase 3, step 9/10).** Removing legacy maps and relocating pivots changes what fresh docs write. Persisted docs and in-flight collaborative sessions on older schema must still load. The read-tolerant window (read-if-present, never-write) is mandatory and is *not* a shim — it is a schema migration boundary. Verify with old-doc fixtures.
- **CRDT LWW subtlety (I7).** The lazy-bootstrap rule is non-obvious and easy to regress; the audit check is the guard. Do not "optimize" by eagerly creating workbook children — that is exactly the issue-#112 blank-viewport bug.
- **Edge cases to cover:** empty/blank sheets (the resize `SheetNotFound` does not repro there per memory — the fix is about data-bearing sheets); copy-sheet hex remapping gaps (`sheet/crud.rs` remap uses `unwrap_or_else` fallbacks that assume a complete pre-scan); structural shifts that fully remove a merge/CF/filter range; concurrent peers forking pre-bootstrap state.
- **Non-goals:** rewriting `CellMirror` internals; changing the recalc scheduler; altering the public SDK error taxonomy beyond adding the `AxisIdentityMissing` variant; performance work beyond the explicitly listed CF linear-scan TODO; any test-only or shim-based "fix" that masks rather than removes a drift path.

## Parallelization notes and dependencies on other folders

- **Internal ordering:** Phase 1 (drift) and Phase 2 (verifier) are sequential — the verifier (Phase 2) is most valuable once the drift paths are closed, and it then guards Phases 3-4. Phase 3's three migrations (allocators, legacy maps, pivots) are mutually independent and can be done in parallel by separate workers once Phase 2 lands. Phase 4's four bug fixes are fully independent of each other and of Phases 1-3.
- **Cross-folder dependencies (consumers of this folder, coordinate the signature change):**
  - `engine/` mutation dispatch and `compute-core-wasm` call into `cells`/`sheet` write methods; the `set_cell` fallibility change (Phase 1) and the `AxisIdentityMissing` error variant (Phase 2) cross the wasm/SDK boundary and must be coordinated with the `@mog-sdk/contracts` error surface (cf. memory: *contracts declaration rollup* — declaration build required before TS consumers typecheck; not run here).
  - `ComputeCore` (recalc/dep graph, outside this folder) consumes `CellMirror` reads; closing drift paths strengthens its inputs but requires no API change there.
  - `compute-collab` (sync transport) depends on the lazy-bootstrap and ID-partitioning invariants (I7, I8); the provider-replay test there is a gate.
  - `mirror` crate: `apply_structure_change`/`apply_edit`/`add_sheet` are the coherence touchpoints; Phase 1/3 only change *how callers handle their results*, not their signatures, unless `apply_structure_change` needs a richer error — coordinate if so.
- **No dependency on the unrelated pre-existing dirty paths** (api-eval/app-eval scenarios, dev fixtures) listed at launch; this plan touches none of them.
