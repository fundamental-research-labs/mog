# Plan 027 — Harden the `ParseOutput → WorkbookSnapshot` import lowering pipeline

## Source folder and scope

- **Folder:** `mog/compute/core/src/import`
- **Files in scope:**
  - `mod.rs` — module doc + re-exports
  - `phantom.rs` — A1 cell/range parsing helpers (`parse_cell_ref`, `parse_range_ref`)
  - `parse_output_to_snapshot/mod.rs` — orchestrator `parse_output_to_workbook_snapshot` + `SheetResolver`
  - `parse_output_to_snapshot/sheet_lowering.rs` — cells, UUID minting, iterative-calc settings
  - `parse_output_to_snapshot/classifier.rs` — homogeneous-column-run → `RangeData` promotion + payload encoding
  - `parse_output_to_snapshot/anchor_collection.rs` — positions that must not be ranged / must keep durable identity
  - `parse_output_to_snapshot/name_lowering.rs` — defined names + named-range→Data-range linkage
  - `parse_output_to_snapshot/table_lowering.rs` — tables
  - `parse_output_to_snapshot/pivot_lowering.rs` — pivot tables
  - `parse_output_to_snapshot/data_table_lowering.rs` — what-if data-table regions
  - `parse_output_to_snapshot/{validation,sparkline,merge,view}_lowering.rs` — boundary docs / narrow A1 classifiers / no-ops
  - `parse_output_to_snapshot/tests.rs` — orchestrator-level integration tests

- **Out of scope (touched only as evidence, not edited):** `storage/engine/construction/xlsx.rs` (caller), `storage/infra/hydration/*` (ID allocation + Yrs hydration), `mirror/range_view.rs` (the `RangeData` decoder), `file-io/xlsx/parser` (upstream `ParseOutput` producer). Changes those crates need are called out as cross-folder dependencies, not done here.

This plan stays inside the public `mog/compute/core/src/import` surface; the production improvement targets are the lowering correctness and the encode/decode contract.

## Current role of this folder in Mog

This is the **import-to-snapshot lowering stage** of the XLSX ingest pipeline:

```
XLSX bytes
  → xlsx_api::parse  → ParseOutput          (position-keyed, no identities)
  → parse_output_to_workbook_snapshot(...)  (THIS FOLDER)
  → WorkbookSnapshot
  → CellMirror::from_snapshot + ComputeCore::init_from_snapshot_no_recalc
```

Concretely the folder:

1. Mints stable `SheetId`/`CellId` hex strings, reusing the IDs that `allocate_sheet_ids` pre-allocated into the `HydrationIdMap` so Yrs storage and ComputeCore share **one identity space** (the `id_map.is_some()` production path).
2. Lowers per-feature structures (defined names, tables, pivots, data-table regions, iterative-calc) from `ParseOutput`/`SheetData` into `WorkbookSnapshot` fields.
3. Runs the **import classifier**: scans non-anchored cells column-by-column and promotes long homogeneous runs into compact `RangeData` payloads (`F64Le` / `I64Le` / `MixedCbor`), removing those cells from per-cell storage. This is what keeps large imports under the WASM ~4 GB memory ceiling (see `import_from_xlsx_bytes` doc-comment in `construction/xlsx.rs`).
4. Computes **anchored positions** (cells referenced by formulas, merges, CF, validations, tables, named ranges, pivots, data-tables, floating objects, sparklines, comments) so those cells are never collapsed into a range and keep durable identity.

The caller `parse_and_hydrate_xlsx` then **re-derives** which positions were ranged by diffing the snapshot's surviving cells against `ParseOutput` cells, and skips those during Yrs hydration. The classifier's output therefore feeds both ComputeCore init and the Yrs write plan.

## Improvement objectives

1. **Eliminate the duplicated, hand-synchronized `MixedCbor` wire contract.** The encoder (`classifier::encode_mixed_cbor` + `error_discriminant`) and the decoder (`mirror/range_view.rs::visit_mixed_values`, tag bytes `0x00..=0x04` and the error-discriminant `0..=10`) are two independent hand-rolled tables that must agree byte-for-byte. A drift between them silently corrupts every imported mixed column. Make this a single shared, tested codec.
2. **Stop silent data loss in `MixedCbor`.** `CellValue::Array`, `CellValue::Control`, and `CellValue::Image` are all encoded as tag `0x00` (Null). Any image-in-cell or control value inside a promoted mixed run is silently dropped on import. Define correct handling (preserve, or provably-never-reaches-here with an assertion).
3. **Remove the caller-side re-derivation of ranged positions.** Have the classifier return the set of ranged `(row, col)` positions (and/or the per-cell decision) so `parse_and_hydrate_xlsx` consumes it directly instead of recomputing a snapshot-vs-parse-output diff. The current arrangement couples two modules through an implicit "whatever the snapshot dropped must have been ranged" inference that is fragile to any future cell-dropping rule (e.g. the existing redundant-empty-styled-cell skip already complicates the diff).
4. **Make implicit cross-module index invariants explicit and panic-free.** `classifier::flush_run` indexes `sheet_row_ids[entry.row as usize]` and `sheet_col_ids[col as usize]` directly. Safety relies on `sheet_identity_extent` (in another crate path) sizing the axis vectors to `max(cell.row)+1`. Convert this from an undocumented invariant into a checked one.
5. **Replace heuristic pivot-extent scanning with a bounded, correct derivation** and remove its `O(pivots × cells)` double sheet scan.
6. **Make orphaned cross-sheet references explicit instead of silently mis-targeted.** `data_table_lowering` uses `unwrap_or_default()` → empty sheet string when the sheet index is out of range, producing a region attached to `""`. Tables use `SheetId::from_raw(0)` as the same kind of silent fallback.
7. **Centralize and bound the named-range → Data-range linkage** (currently `O(names × sheets × ranges × row_ids)` with repeated linear `row_ids.iter().position(...)` scans) and narrow it using scope information that is already available.
8. **Unify ID-string minting.** `sheet_lowering` uses both `u128_to_hex32(...)` and `format!("{:032x}", ...)` for cell IDs in different branches; both must produce identical 32-char lowercase hex, but the duplication invites drift.

These are correctness/robustness objectives on the production ingest path — not test-only or cosmetic.

## Production-path contracts and invariants to preserve or strengthen

The following must hold before and after the work; several are currently implicit and should be promoted to asserted/encoded invariants:

- **C1 — Identity-space unity.** When `id_map.is_some()`, every `SheetId`/`CellId` in the snapshot equals the ID `allocate_sheet_ids` minted for the same sheet/cell index. (Strengthen: a debug assertion that snapshot cell IDs are a subset of the allocated cell IDs.)
- **C2 — Anchored cells are never ranged.** Every position returned by `collect_anchored_positions` is excluded from `RangeData`. (Preserve; add a property test.)
- **C3 — Range promotion is lossless for the values it claims to carry.** `F64Le` requires exact-integer-or-fractional f64; `I64Le` requires exact integers; the `≤ 2^53` / `> 2^53` split in `classify_value` must match what `NumericRunState::encoding` then emits, and the decoder must reproduce the original `CellValue`. (Strengthen: round-trip property test encoder→decoder over arbitrary value vectors.)
- **C4 — Null handling.** Explicit `Null` cells split numeric runs, may join `MixedCbor`, but a null-only run is never promoted, and ranged-out cells that are still identity-bearing nulls are retained as per-cell entries. (Preserve; this is subtle and currently only unit-tested in `classifier.rs`.)
- **C5 — Determinism.** Identical `ParseOutput` + identical allocator seed ⇒ byte-identical `RangeData` (encoding, payload, row_ids, col_ids, anchor) and identical surviving-cell order. (Preserve; `deterministic_output` test already pins part of this.)
- **C6 — Caller diff equivalence.** `parse_and_hydrate_xlsx`'s `ranged_positions` set must equal the positions the classifier actually removed. (Objective 3 turns this from "two computations that happen to agree" into "one source of truth".)
- **C7 — Axis-index bounds.** `entry.row` / `col` are always `< sheet_row_ids.len()` / `sheet_col_ids.len()`. (Objective 4.)
- **C8 — Encode/decode tag agreement.** `MixedCbor` tag bytes and error discriminants are identical between this folder's encoder and `mirror/range_view.rs`'s decoder. (Objective 1.)
- **C9 — Hidden/orphan names are dropped.** `is_orphan_name` skips `#REF!`-only and empty `refers_to`; `hidden` names (e.g. `_xlnm._FilterDatabase`) are skipped. (Preserve.)
- **C10 — UTF-8 totality.** All A1/sheet-prefix classification goes through `compute_parser::ParsedExpr::classify` / `split_sheet_prefix` and never panics on non-ASCII (the historic Greek-OFFSET incident class). (Preserve; the narrow classifiers already carry totality spot-checks.)

## Concrete implementation plan

Ordered so each step is independently reviewable and lands behind passing tests.

### Step 1 — Extract the `MixedCbor` codec into one shared, typed module (objectives 1, 2, 8)

- Introduce a single codec for the range payload wire format that owns **both** encode and decode for `MixedCbor` (and the trivial `F64Le`/`I64Le` forms), plus the `CellError ↔ discriminant` mapping. Natural home: a small module next to the `PayloadEncoding` type in `cell-types` (so both `import::classifier` and `mirror::range_view` depend on it), or a dedicated `payload_codec` module re-used by both. Decision recorded below in Risks.
- Replace `classifier::encode_mixed_cbor`, `classifier::error_discriminant`, and `encode_f64le`/`encode_i64le` with calls into the shared encoder.
- Replace the hand-written tag/discriminant matches in `mirror/range_view.rs::visit_mixed_values` and `decode_mixed_value_at` with the shared decoder.
- Add `Array`/`Control`/`Image` handling: rather than silently emitting Null, either (a) carry a dedicated tag that the decoder reconstructs faithfully, or (b) if these variants genuinely cannot reach a promoted run (Image/Array/Control are anchored or never enter column runs), keep them out by construction and replace the `=> push(0x00)` arm with a `debug_assert!(false, ...)` + a defensive non-lossy fallback (keep the cell per-cell instead of dropping its value). Investigate which holds — `Array`/spill anchors are already excluded via `ImportedCellProjectionRole::DynamicArraySpillTarget` and `anchors_from_array_formulas`, suggesting (b) is reachable for `Image` specifically. The chosen path must not silently lose a value.

### Step 2 — Classifier returns its own decisions (objectives 3, 6 for C6)

- Change `classify_sheet_ranges` to return the set of ranged positions (e.g. `FxHashSet<(u32,u32)>`) alongside mutating `sheet.ranges`, or have `parse_output_to_workbook_snapshot` thread that out via a per-sheet result struct.
- Add a returned summary on the orchestrator (`parse_output_to_workbook_snapshot`) — e.g. an out-param or a richer return type carrying `ranged_positions_per_sheet` — so `parse_and_hydrate_xlsx` consumes the authoritative set.
- Update `construction/xlsx.rs` (cross-folder, see dependencies) to drop the snapshot-vs-parse-output diff in favor of the returned set. Until that caller change lands, keep the diff as a `debug_assert_eq!` cross-check so the two cannot silently diverge during migration.

### Step 3 — Bounds-safe axis indexing (objective 4, C7)

- In `classifier.rs`, replace direct `sheet_row_ids[entry.row as usize]` / `sheet_col_ids[col as usize]` indexing with checked access that, on out-of-range, skips promotion for that run (leaving cells per-cell) and emits a `tracing::warn!` rather than panicking.
- Promote the relationship to a documented invariant at the orchestrator boundary: add `debug_assert!` that `sheet_row_ids.len() >= max_cell_row+1` and likewise for cols, referencing `sheet_identity_extent` as the producer. This protects against a future change to extent computation silently turning into an import panic.

### Step 4 — Pivot extent derivation (objective 5)

- Replace the `output.sheets.iter().find(|s| s.name == ...)` re-scan (which duplicates the `resolver.by_name` lookup and is `O(pivots × sheet_cells)`) with a single pass: resolve the output sheet once, then bound the pivot region using the config's structural metadata (`row_placements`, `value_placements`, `column_placements`) and the already-known cell extent for that sheet, computed once per sheet rather than once per pivot.
- Keep the existing `first_data_row`/`first_data_col`/`data_on_rows` semantics intact (these feed GETPIVOTDATA); add unit tests pinning the derived `end_row`/`end_col`/`rendered_rows`/`rendered_cols` against representative layouts (row-only, row+col, multi-value, `data_on_rows` true/false).

### Step 5 — Explicit orphan handling for cross-sheet refs (objective 6)

- `data_table_lowering::convert_data_table_regions`: when `resolver.by_index(dt.sheet_index)` is `None`, **skip** the region with a `tracing::warn!` instead of attaching it to `""` (mirrors the `name_lowering` skip-on-bad-index policy). An empty sheet string region is unreachable by any real sheet and is dead weight that downstream lookups silently ignore.
- `table_lowering::convert_tables_from_sheets`: the `SheetId::from_raw(0)` fallback is unreachable in practice (sheet_idx is always valid since we iterate `sheet_data`), but the `parse_a1_range` failure path already `filter_map`s away. Confirm and document that a table whose `range_ref` fails to parse is intentionally dropped; add a `tracing::warn!` so silently-dropped tables are observable.

### Step 6 — Bound and narrow named-range linkage (objective 7)

- In `link_named_ranges_to_data_ranges`, precompute per-sheet `RowId → positional index` maps once (instead of `row_ids.iter().position(...)` inside the inner loop per Data-range), and index Data-ranges by `col_id` once per sheet, so linkage is roughly `O(names + sheets·ranges)` rather than the current multiplicative scan.
- Where a named range is `Scope::Sheet(sid)`, restrict the candidate-sheet search to that sheet rather than "check all sheets" (the comment acknowledges this is currently skipped for simplicity).
- Preserve the "single-column Data-range only" matching semantics (C3 for ranges is column-oriented).

### Step 7 — Documentation truthing pass

- Update `parse_output_to_snapshot/mod.rs` and `classifier.rs` module docs to reflect: (a) the codec now lives in one place, (b) the classifier returns ranged positions, (c) the axis-bounds invariant. The doc comments currently describe `MixedCbor` as "cbor" though it is a bespoke TLV format — rename the encoding's prose to "tagged TLV" to avoid implying RFC-8949 CBOR. (Keep the `PayloadEncoding::MixedCbor` enum name unless a separate type-rename is coordinated with `cell-types`.)

## Tests and verification gates

All new tests live under the existing in-crate `#[cfg(test)]` modules (`parse_output_to_snapshot/tests.rs` and per-module `mod tests`) plus the engine-level integration tests under `storage/engine/tests/test_deferred_xlsx_import/`. (Authoring those test files is part of the production change, not a substitute for it.)

1. **Round-trip codec property test (C3, C8):** for arbitrary `Vec<CellValue>` containing numbers (small + large ints + fractionals), text (incl. non-ASCII/empty), bools, every `CellError`, and `Null`, assert `decode(encode(v)) == v` element-wise, exercising the single shared codec. This is the headline gate for objective 1/2.
2. **Encoder/decoder agreement guard:** a test that fails to compile or fails at runtime if the tag set or error discriminants diverge (e.g. exhaustive match over `CellError` in one place that both sides consume).
3. **No-silent-loss test (objective 2):** a promoted mixed run containing an `Image`/`Control`/`Array` value either round-trips or keeps that cell as a per-cell entry — never returns `Null` where a non-null value went in.
4. **Caller-diff equivalence (C6):** assert the classifier's returned ranged-position set equals the legacy snapshot-vs-parse-output diff over a fixture with mixed ranged/anchored/empty-styled cells (the `debug_assert_eq!` from Step 2 plus an explicit test).
5. **Axis-bounds safety (C7):** construct a `SheetSnapshot` whose cell rows/cols exceed the supplied `row_ids`/`col_ids` and assert the classifier degrades to per-cell (no panic, warn emitted).
6. **Pivot extent regression (objective 5):** unit tests for row-only, row+col, multi-value, and `data_on_rows` layouts pinning `end_row/end_col/first_data_row/first_data_col`.
7. **Orphan data-table skip (objective 6):** a `DataTableRegion` with an out-of-range `sheet_index` is dropped, not attached to `""`.
8. **Named-range linkage parity (objective 7):** the optimized linkage produces identical `linked_range_id` assignments as the current implementation across a fixture matrix (cell ref, single-column range, multi-column range that must NOT link, sheet-scoped vs workbook-scoped).
9. **Determinism (C5):** extend `deterministic_output` to also cover the returned ranged-position set and the new codec output.
10. **Preserved behavior:** all existing tests in `classifier.rs`, `anchor_collection.rs`, `data_table_lowering.rs`, `hyperlink_lowering.rs`, `view_lowering.rs`, `merge_lowering.rs`, and `tests.rs` must still pass unchanged.

**Verification gates (run by the implementer; this plan does not run them):**
- `cargo test -p compute-core import::` (unit + orchestrator tests).
- The deferred-XLSX import integration suite (`storage::engine::tests::test_deferred_xlsx_import`) including `range_streaming` which exercises `MixedCbor` materialization end-to-end via COUNTA.
- `xlsx-roundtrip` report run on a representative corpus to confirm no regression in imported value fidelity (it consumes `parse_output_to_workbook_snapshot`).
- Clippy clean on the touched crates.

## Risks, edge cases, and non-goals

**Risks / edge cases:**
- **Codec home choice.** Moving the `MixedCbor` codec into `cell-types` (alongside `PayloadEncoding`) is cleanest but adds a `value-types` dependency edge that crate may not currently have; if that violates a dependency invariant (cf. the `ooxml-types` zero-dep note in `sparkline_lowering.rs`), fall back to a dedicated codec module in `compute-core` that both `import` and `mirror` import. Resolve the edge before Step 1; this is the main architectural decision.
- **Wire-format stability.** `RangeData` payloads are produced fresh at import and consumed in-process by `range_view`; they are **not** a persisted on-disk format (Yrs stores ranges via hydration, not these raw byte buffers). Confirm this before changing tags — if any payload is persisted to Yrs verbatim, tag changes become a migration concern and Array/Control/Image must be handled additively (new tags) rather than by repurposing.
- **Behavior change surface.** Skipping orphan data-table regions (Step 5) changes output for malformed files; this is strictly more correct (an `""`-sheet region is unusable) but should be called out in the change description.
- **Performance.** Step 6 should reduce linkage cost; verify on a workbook with many defined names + many classified Data ranges that it does not regress.
- **`i64::MAX as f64` boundary** in `classify_value` (`v < (i64::MAX as f64)`) rounds up; the existing guard plus the `≤ 2^53` promotable check keeps this safe, but the round-trip property test (gate 1) must include values near `2^53` and near `i64::MAX` to lock it down.

**Non-goals:**
- Typing the deferred upstream string fields (`ooxml_types::sparklines` `data_range`/`location`) — explicitly deferred per `sparkline_lowering.rs`; requires a cross-crate dependency restructure.
- Row-oriented / 2D-block range promotion. The classifier is column-oriented by design; adding row runs is a separate optimization, not a correctness fix, and is out of scope here.
- Changing `domain_types`/`snapshot_types` field shapes (e.g. lifting `TableSpec.range_ref` off `String`) — those are external-format-boundary carve-outs owned by other plans.
- Renaming the `PayloadEncoding::MixedCbor` enum variant (coordinate separately with `cell-types` consumers); this plan only corrects the *prose* describing it.

## Parallelization notes and dependencies on other folders

- **Step 1 (codec)** is the critical-path dependency for Steps 2 and the data-loss tests, and it spans `mirror/range_view.rs` and possibly `cell-types`. It should land first and be reviewed by owners of those folders. This is the one step that *must* edit production code outside this folder (the decoder); coordinate with the `mirror` / `cell-types` plan owners (queue items covering `compute/core/src/mirror` and `compute/core/crates/types`).
- **Step 2 (classifier returns ranged positions)** requires a follow-up edit in `storage/engine/construction/xlsx.rs` (`parse_and_hydrate_xlsx`) — coordinate with the construction/storage folder owner. Use the `debug_assert_eq!` bridge so the two land independently without a flag day.
- **Steps 3, 4, 5, 6, 7** are internal to `src/import` and mutually independent — they can be done in parallel by separate agents (the W3.0 per-boundary file split was designed exactly so fan-out agents don't collide). Step 3 touches only `classifier.rs` + `mod.rs`; Step 4 only `pivot_lowering.rs`; Step 5 only `data_table_lowering.rs`/`table_lowering.rs`; Step 6 only `name_lowering.rs`.
- **Upstream invariant dependency:** Step 3's bounds assertion depends on `sheet_identity_extent` (in `storage/infra/hydration/sheet/identity.rs`) continuing to size axis vectors as `max(cell.row/col)+1`; document the coupling so a future change there is caught by the assertion rather than by a production import panic.
