# 027 - Compute Core Import Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/src/import`

Scope for this plan is the production import-to-snapshot and import-ingest code in `compute-core`: `parse_output_to_snapshot`, its sheet/name/table/pivot/data-table lowerers, typed boundary helper modules, import range classifier, anchor collection, and the `phantom` A1 helper module.

Adjacent production dependencies that must be considered:

- `domain-types/src/parse_output.rs`, which owns the position-keyed `ParseOutput`, `SheetData`, `CellData`, `NamedRange`, and `DataTableRegion` contracts consumed by this folder.
- `file-io/xlsx/parser/src/output/to_parse_output/*`, which converts `FullParseResult` into `ParseOutput` and classifies projection/spill roles before compute-core import.
- `compute/core/src/storage/engine/construction/{xlsx,csv,deferred,range_styles}.rs`, which preallocates IDs, builds `HydrationIdMap`, calls `parse_output_to_workbook_snapshot`, derives ranged positions, and then hydrates storage.
- `compute/core/src/storage/infra/hydration/*`, especially direct import, ranged import, sheet allocation, identity-only anchors, phantom cells, feature hydration, and range payload writing.
- `compute/core/src/mirror/snapshot.rs` and scheduler initialization, where `WorkbookSnapshot` cells, ranges, named ranges, tables, pivots, data tables, and calculation settings become live compute state.
- `compute-parser`, `formula-types`, `snapshot-types`, `cell-types`, and `value-types`, which define A1 parsing/classification, references, identity IDs, snapshot payloads, and cell values.
- `xlsx-parser` export paths that must round-trip imported features even when `WorkbookSnapshot` intentionally does not carry those feature families.

This is a public Mog source folder. Implementation belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`import` is the bridge from parser-owned, position-keyed import data to compute initialization:

```text
FullParseResult -> full_parse_result_to_parse_output()
    -> ParseOutput
    -> parse_output_to_workbook_snapshot()
    -> WorkbookSnapshot
    -> ComputeCore::init_from_snapshot()
```

The main entrypoint is `parse_output_to_snapshot::parse_output_to_workbook_snapshot(output, id_map, allocator)`. It converts sheets, cells, named ranges, tables, pivot tables, data table regions, iterative calculation settings, and full calculation settings into `WorkbookSnapshot`. When a `HydrationIdMap` is supplied, it uses the same sheet/cell/row/column identities allocated for Yrs hydration and runs the import classifier to compact eligible column runs into `RangeData`.

Important current behavior:

- `sheet_lowering` allocates or reuses sheet and cell IDs, skips parser-proven dynamic-array spill targets, filters empty cells whose style is redundant with row/column defaults, and injects synthetic comment target cells only in the no-`id_map` snapshot path.
- `name_lowering` skips hidden and orphan `#REF!` names, maps `local_sheet_id` to the allocated `SheetId`, keeps raw A1 expressions for later identity conversion, and links some names to classifier-produced `RangeKind::Data` ranges.
- `table_lowering` uses `compute_parser::split_sheet_prefix` and `parse_a1_range` to lower table ranges by sheet index, avoiding old byte-level sheet-prefix parsing.
- `pivot_lowering` derives a `PivotTableDef` from `ParsedPivotTable` config and scans output sheet cells to estimate the rendered pivot extent.
- `data_table_lowering` structurally copies typed `DataTableRegion` input references into snapshot data table definitions.
- `validation_lowering`, `sparkline_lowering`, and `merge_lowering` document why some feature families do not require a `WorkbookSnapshot` lowering step.
- `hyperlink_lowering` and `view_lowering` expose typed classifiers that downstream hydration uses, while anchor collection still has some simpler A1 helper usage.
- `anchor_collection` prevents the classifier from ranging feature-sensitive cells. It currently anchors formulas, rich strings, comments, hyperlinks, merge origins, array formulas, shared/array formula cells, conditional-format corners, data-validation corners, floating object starts, sparklines, table headers, identity named-range endpoints, pivot starts, and data-table starts.
- `classifier` converts non-anchored column runs to `F64Le`, `I64Le`, or `MixedCbor` range payloads, removes promoted cells from `SheetSnapshot.cells`, and leaves too-small or anchored runs as per-cell entries.
- `phantom` is a thin wrapper around `compute_parser` for A1 cell/range parsing, but it still has local shape assumptions such as `contains(':')`.

The folder is therefore not just a converter. It is the contract boundary where imported workbook features either enter compute snapshot state, hydrate directly into Yrs, require durable cell identity, or are safe to compact into ranges.

## Improvement objectives

1. Make the import feature policy explicit and exhaustive: every `ParseOutput` and `SheetData` feature must have a declared snapshot, direct-hydration, identity-anchor, range-anchor, range-style, or ignored-with-diagnostic policy.
2. Replace implicit `HydrationIdMap` shape assumptions and duplicated map construction with checked allocation contracts shared by XLSX, CSV, deferred import, and direct hydration.
3. Make `parse_output_to_workbook_snapshot` a checked production builder that reports malformed import state instead of relying on `debug_assert`, indexing assumptions, silent empty sheet IDs, or silent feature skips.
4. Harden range classification so compaction is provably lossless for values and metadata, deterministic, bounds-checked, and safe for every `CellValue` variant.
5. Promote typed A1/reference classifiers into the anchor and hydration contracts so UTF-8, quoted sheet names, sheet-qualified refs, ranges, and sqref lists are handled consistently.
6. Tighten each lowerer around the exact contract it owns: sheet/cell projection, named range scope and data-range linkage, table range validity, pivot rendered extent, data table sheet resolution, and calculation settings.
7. Add production-path tests that run through parser output, snapshot construction, ranged hydration, mirror initialization, deferred hydration completion, and export-visible readback.
8. Add structured diagnostics and metrics for import drops, malformed refs, range classification decisions, anchor reasons, and data-loss prevention.

## Production-path contracts and invariants to preserve or strengthen

- `ParseOutput` stays position-keyed. It must not gain cell or sheet UUID assumptions just to simplify this folder.
- `WorkbookSnapshot` stays narrower than `ParseOutput`. Feature families that hydrate directly into Yrs should not be shoved into snapshot unless compute initialization needs them.
- When `HydrationIdMap` is present, snapshot sheet IDs, cell IDs, row IDs, column IDs, and range IDs must share one identity space with Yrs hydration.
- `HydrationIdMap.sheet_ids`, `cell_ids`, `row_ids`, and `col_ids` must be shape-compatible with `ParseOutput.sheets` before conversion starts. Production code should fail with a diagnostic error, not panic or silently skip.
- Dynamic-array spill targets are skipped only when parser-owned `ImportedCellProjectionRole::DynamicArraySpillTarget` proves they are spill targets. Consumers must not infer omission from `cm` or other OOXML metadata alone.
- Formula cells, array formula sources, CSE shared/array formulas, rich strings, comments, hyperlinks, merge origins, validations, conditional formats, floating objects, sparklines, table headers, named-range endpoints, pivots, data tables, and any future feature with cell-attached identity must not be compacted into a range without a declared policy.
- Range compaction must not drop value, formula, style, rich string, original value, original SST, formula metadata, metadata indices, VM, image/control/array values, or export-owned provenance. If a field cannot be represented by the range payload or range-side metadata, the cell remains explicit.
- Range payload row IDs and column IDs must always exist in the preallocated row/column registries, and the payload length must match the declared axis cardinality.
- Named ranges must resolve sheet scope to allocated `SheetId`s. Invalid local sheet indices are diagnostics and drops, not fallback workbook-scope names.
- Named range to data-range linkage must respect sheet qualifiers and sheet scope; the same A1 coordinates on another sheet must not be linked accidentally.
- Table definitions must not fall back to `SheetId::from_raw(0)` on resolver failure. A malformed table should be skipped with an import diagnostic.
- Pivot table extents must be derived from a stable contract, not just a best-effort scan that can miss blank rendered cells or over-trust estimated columns.
- Data table region sheet indices must resolve to real snapshot sheets. Invalid indices should be rejected or diagnosed, not lowered to an empty sheet string.
- A1 and formula-shaped import fields must use shared typed parser APIs. No byte-indexing, ad hoc UTF-8 slicing, or local colon/sheet-prefix heuristics should remain in production import logic.
- Direct import, ranged import, CSV import, and deferred XLSX import should produce equivalent compute-visible values and metadata for the same `ParseOutput`, modulo the intentionally partial first-sheet snapshot in deferred opening.
- Public dependency direction stays intact: `mog` must not depend on `mog-internal`.

## Concrete implementation plan

1. Write the import feature policy manifest.

   - Add an internal `ImportFeaturePolicy` table or module that enumerates every top-level `ParseOutput` field and every `SheetData` field relevant to compute import.
   - Classify each field as one of: `WorkbookSnapshot`, `DirectYrsHydration`, `IdentityOnlyAnchor`, `PhysicalPhantomCell`, `RangeCompactionAnchor`, `RangeSideMetadata`, `ExportOnlyProvenance`, `NoComputeImportEffect`, or `UnsupportedWithDiagnostic`.
   - Make `anchor_collection` consume this policy rather than accumulating one-off helper calls with no visible coverage target.
   - Add a focused test fixture that builds a `SheetData` containing one instance of each coordinate-owning feature family and asserts its anchor/identity policy. Include existing families plus charts, slicers, slicer anchors, timelines, timeline anchors, auto filters, sort state, x14 validations, row/column dimensions where relevant, worksheet semantic containers, and authored style runs.
   - Document why each no-op lowering module is no-op at snapshot level and which storage hydrator or writer path owns the feature instead.

2. Introduce checked import lowering context.

   - Replace the unchecked `Option<&HydrationIdMap>` plumbing with an `ImportLoweringContext` that carries allocation mode, sheet resolver, row/column registries, allocator, feature policy, diagnostics sink, and whether range classification is enabled.
   - Add `HydrationIdMap::from_sheet_allocations(...)` and use it from XLSX, CSV, and deferred construction instead of duplicating the loop that copies sheet/cell/row/column IDs.
   - Add `HydrationIdMap::validate_against_parse_output(&ParseOutput) -> Result<ValidatedHydrationIds, ImportLoweringError>` to verify sheet count, cell ID count per original `SheetData.cells`, row ID count, column ID count, and bounds for all non-filtered cells and features.
   - Make the checked builder the production entrypoint, for example `try_parse_output_to_workbook_snapshot(...) -> Result<WorkbookSnapshot, ImportLoweringError>`, and migrate production call sites. Keep any convenience wrapper test-only or delete the unchecked wrapper after call sites migrate.
   - Convert existing `debug_assert_eq!` and direct indexing of ID arrays into validated accessors on `ValidatedHydrationIds`.

3. Refactor sheet and cell lowering around dual residency.

   - Separate "value is represented in snapshot cells", "value is represented in range payload", "cell identity is represented in Yrs", and "cell metadata is represented in Yrs/range side maps" as distinct states.
   - Extend synthetic cell injection in no-`id_map` snapshots from comments-only to the complete set of identity-required anchors that must be visible to `init_from_snapshot`, or explicitly prove and test why each feature does not require synthetic snapshot cells.
   - Make dynamic-array projection filtering depend only on `ImportedCellProjectionRole` and add tests for normal `cm`, unknown metadata, dynamic-array source, dynamic-array spill target, shared formula metadata, and array formula metadata.
   - Preserve ordering determinism after synthetic insertion and filtering so ID allocation and snapshot output remain stable.
   - Add diagnostics for cells outside declared sheet dimensions. Decide a single policy: extend dimensions before lowering or reject/diagnose out-of-bounds feature coordinates.

4. Harden anchor collection and typed reference parsing.

   - Replace `phantom::parse_cell_ref` and `parse_range_ref` call sites with narrower typed helpers backed by `compute_parser::ParsedExpr`, `parse_a1_cell`, `parse_a1_range`, and `SqrefList` as appropriate.
   - Make hyperlink anchors use `hyperlink_lowering::classify_hyperlink_anchor`, so range hyperlinks anchor both endpoints or all required corners rather than being missed by single-cell parsing.
   - Make validation anchors consume typed sqref/range lists from the parser-side validation contract instead of reparsing string ranges with local range assumptions.
   - Preserve sheet qualification when the policy needs it. In particular, fix named range data-range linkage so `Sheet1!A1:A100` links only on Sheet1, and workbook-scoped names with unqualified refs use a documented scope resolution rule.
   - Add totality tests over malformed, empty, absolute, sheet-qualified, quoted-sheet, embedded-bang, non-ASCII, emoji, `#REF!`, and sqref-list samples for every helper used by anchor collection.

5. Make range classification lossless by construction.

   - Introduce a `RangeCandidate` type that records row, col, cell index, value class, and metadata eligibility before scanning runs.
   - Exclude or explicitly dual-reside cells with formulas, rich strings, cell-level properties, original value/SST provenance, formula metadata, cache provenance, images, controls, arrays, or any value variant the payload codec cannot encode losslessly.
   - Replace the current "Array/Control/Image encode as Null" fallback with either lossless payload tags or a hard per-cell retention rule. Data loss must be impossible by type, not a comment.
   - Bounds-check row and column ID lookup through validated registries. A missing row/column ID is an import error, not an indexed panic.
   - Keep range IDs deterministic by sorting sheet, column, run, and style-side range allocation inputs. Add a golden deterministic test that includes multiple columns, anchors, skipped cells, and style-side ranges.
   - Add a decoder-only test helper for `F64Le`, `I64Le`, and `MixedCbor` payloads and assert exact roundtrip for numbers, booleans, text, errors, nulls, large safe integers, unsafe integer boundaries, and unsupported value variants.
   - Define a dual-residency contract test: a cell whose value is range-backed but whose style/original metadata requires explicit Yrs identity must keep both the range value and the explicit metadata path.

6. Tighten lowerer-specific contracts.

   - `name_lowering`: preserve or recover sheet qualifiers for linkage; diagnose invalid `local_sheet_id`; retain supported macro/name metadata where snapshot or storage can own it; keep orphan `#REF!` behavior typed and total over UTF-8.
   - `table_lowering`: use resolver failure as a diagnostic drop; validate range shape, range normalization, header/totals bounds, and column count versus range width; define whether `name` or `display_name` is the compute lookup key.
   - `pivot_lowering`: prefer parser-provided rendered region or pivot table location metadata if available. If scanning is still required, scan a contractually bounded rendered area and handle blank labels/data cells without truncating the pivot.
   - `data_table_lowering`: require valid sheet index resolution; keep typed row/column input refs unchanged; preserve OOXML flags as sidecar data without making them behavioral until data-table evaluation supports them.
   - `sheet_lowering`: keep `calculation_settings` consistent with the flat iterative fields and add non-finite `iterate_delta` regression coverage.
   - `view_lowering` and `hyperlink_lowering`: ensure hydration call sites use the typed classifiers and emit diagnostics when invalid shapes are dropped or preserved raw for round-trip.

7. Unify import diagnostics and observability.

   - Add an `ImportLoweringDiagnostics` struct with counters and reason lists for skipped named ranges, tables, pivots, data tables, malformed refs, invalid sheet indices, invalid ID-map shapes, anchored positions by reason, range candidates, retained cells by reason, promoted ranges by encoding, unsupported range payload values, and dual-resident metadata cells.
   - Thread diagnostics through production import construction and expose them to existing parse/import diagnostics where that surface already exists. Do not leak private plan details or create a new public dependency.
   - Add tracing spans around snapshot conversion, anchor collection, classification, lowerer diagnostics, and named-range linkage. Keep payload-level logs off by default.
   - Replace silent fallback IDs and empty strings with explicit diagnostic outcomes.

8. Build production-path contract fixtures.

   - Create compact `ParseOutput` fixtures for each imported feature family and run them through the real production paths: direct `hydrate_from_parse_output` plus snapshot, ranged XLSX construction, CSV construction where applicable, deferred first-sheet construction, deferred completion, `ComputeCore::init_from_snapshot`, and export readback.
   - Add a "feature kitchen sink" fixture with formulas, rich strings, comments, hyperlinks including range anchors, merges, dynamic arrays, CSE arrays, conditional formats, validations/x14 validations, floating objects, sparklines, table headers, named ranges, pivots, data tables, styles, original values, and authored style runs. Assert the classifier promotes only safe cells and every anchored/metadata cell remains findable.
   - Add a roundtrip fixture for UTF-8 and quoted sheet names across named ranges, table ranges, hyperlinks, validations, pane top-left cells, and data table refs.
   - Add large production-path fixtures for range compaction that verify values through `CellMirror`, not by inspecting only `RangeData` bytes.
   - Add export-visible checks proving that ranged cells with style/original metadata and direct-hydrated feature families survive import -> compute init -> export `ParseOutput` reconstruction.

9. Remove stale import parsing surface.

   - After typed helpers are in place, shrink or delete `phantom` if it is only wrapping `compute_parser` without adding a meaningful contract.
   - Remove comments that describe W4 landing pads as future work once the feature policy manifest and tests make their current no-op status explicit.
   - Audit non-test `unwrap`, `expect`, direct indexing, and fallback IDs in this folder. Each must become a validated invariant, a diagnostic drop, or a spreadsheet/import error.

## Tests and verification gates

Focused tests to add or update during implementation:

- Unit tests for `ImportFeaturePolicy`, `ImportLoweringContext`, `HydrationIdMap` validation, and diagnostics.
- `parse_output_to_snapshot` lowerer tests for sheets, names, tables, pivots, data tables, calculation settings, and malformed refs.
- Anchor collection tests covering every coordinate-owning `SheetData` family and every typed reference shape.
- Classifier tests for threshold boundaries, anchor gaps, deterministic range IDs, unsupported value retention, dual-resident metadata cells, range-style sidecars, and payload decode roundtrip.
- Storage construction tests for XLSX, CSV, and deferred import using production constructors, not direct mutation of snapshot internals.
- Mirror initialization tests proving range-backed values and per-cell anchored values are both readable after `ComputeCore::init_from_snapshot`.
- Export service tests proving range-backed styled/provenance cells and direct-hydrated feature families are reconstructed correctly.
- Parser integration tests in `xlsx-parser` when parser-side typed contracts or `ParseOutput` conversion change.

Required final gates for an implementation touching this folder:

- `cargo test -p compute-core import::parse_output_to_snapshot`
- `cargo test -p compute-core storage::engine::construction`
- `cargo test -p compute-core storage::engine::tests::test_deferred_xlsx_import`
- `cargo test -p compute-core storage::engine::services::export`
- `cargo test -p compute-core`
- `cargo clippy -p compute-core`

Additional gates when dependencies change:

- `cargo test -p domain-types` and `cargo clippy -p domain-types` if `ParseOutput`, validation, hyperlink, table, or feature policy types change.
- `cargo test -p snapshot-types` and `cargo clippy -p snapshot-types` if snapshot structs, range payloads, or serde contracts change.
- `cargo test -p cell-types` if range identity, anchors, payload encodings, or ID helpers change.
- `cargo test -p compute-parser` if A1/reference parsing or classification changes.
- `cargo test -p xlsx-parser` and `cargo clippy -p xlsx-parser` if parser conversion, export roundtrip, or typed validation/hyperlink/sparkline contracts change.

Verification must exercise the production import constructors and hydration paths. Tests that directly call a lowerer are useful for small contracts, but they are not enough to prove ingest correctness.

## Risks, edge cases, and non-goals

Risks:

- Changing `parse_output_to_workbook_snapshot` from unchecked conversion to a checked builder will touch several production import paths. Do this early and migrate all call sites together.
- A complete feature policy can reveal that some `SheetData` families currently bypass range-anchor review. Fix the category systematically rather than exempting individual cases.
- Pivot rendered extent may not be fully derivable from current `ParsedPivotTable` config. If parser metadata is missing, surface that as an upstream contract need instead of preserving an unreliable scan.
- Range compaction can accidentally reduce memory while dropping export metadata. Value compaction and metadata residency must be tested as a pair.
- More explicit malformed-ref diagnostics can change which broken imported artifacts are skipped. The behavior must be deterministic and covered by tests.
- Deferred first-sheet import intentionally builds a partial initial snapshot. Tests must distinguish expected partial state from full hydration completion requirements.

Edge cases to cover:

- Empty workbooks, empty sheets, sheets with cells outside declared dimensions, and dimensions that need extension.
- Dynamic-array source cells, spill targets, unknown metadata cells, shared formulas, CSE arrays, and formula cells with empty cached values.
- Named ranges with workbook scope, sheet scope, invalid `local_sheet_id`, hidden names, orphan `#REF!`, external references, quoted sheet names, duplicated sheet-local coordinates, and names linked to data ranges.
- Tables with sheet-qualified refs, quoted sheet names, malformed refs, single-cell ranges, headerless tables, totals rows, column-count mismatch, and duplicate display names.
- Hyperlinks with single-cell anchors, range anchors, external URLs, internal locations, named-range locations, hash-prefixed locations, and malformed/non-ASCII targets.
- Data validations and x14 validations with single cells, ranges, sqref lists, absolute refs, malformed refs, and container count attributes.
- Conditional formats, sparklines, floating objects, slicers, timelines, pivots, data tables, merges, comments, threaded comments, and charts on empty cells.
- Range payloads containing nulls, booleans, text, errors, integers near 2^53, non-integer numbers, images, arrays, controls, and mixed long runs interrupted by anchors.
- Ranged cells with style IDs, authored style runs, original OOXML values, original SST indices, formula metadata, rich strings, and cache provenance.
- UTF-8 sheet names and formulas, including Greek, CJK, emoji, and quoted names containing embedded `!`.

Non-goals:

- Do not create a second import model or a compatibility shim that preserves known import bugs.
- Do not widen `WorkbookSnapshot` to carry every `ParseOutput` field unless compute initialization needs that field.
- Do not optimize parser-only, test-only, or benchmark-only paths as the primary outcome.
- Do not hide malformed input by falling back to raw IDs, empty sheet strings, or workbook scope.
- Do not add dependencies from public `mog` packages to `mog-internal`.
- Do not reduce scope to one failing feature family. The improvement is a complete import feature policy and production-path verification matrix.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable once the feature policy and checked builder contract are drafted.

- Agent A: inventory every `ParseOutput` and `SheetData` field, write `ImportFeaturePolicy`, and add exhaustive anchor/identity policy tests.
- Agent B: implement checked `HydrationIdMap` construction and validation, migrate XLSX/CSV/deferred/direct call sites, and remove duplicated allocation map loops.
- Agent C: replace local A1 helper usage with typed reference classifiers and update hyperlink, validation, named-range, and anchor collection tests.
- Agent D: harden the classifier and payload codecs, including unsupported value retention, dual-residency metadata, deterministic range IDs, and style-side range tests.
- Agent E: tighten name/table/pivot/data-table/calculation lowerers and add diagnostics for malformed or unresolved inputs.
- Agent F: build production-path fixtures across parser output, direct hydration, ranged hydration, deferred hydration, mirror init, and export readback.

Dependencies:

- The feature policy manifest should land before classifier or anchor rewrites so agents share the same contract.
- Checked `HydrationIdMap` validation should land before lowerers start relying on validated row/column accessors.
- Typed reference helper work can proceed in parallel with ID validation but should land before named-range linkage and validation-anchor changes.
- Classifier losslessness work depends on the feature policy and should coordinate with `storage/engine/construction/range_styles.rs` and `storage/infra/hydration/features.rs`.
- Pivot extent improvements may require upstream `xlsx-parser` metadata changes; isolate that dependency and test it in `xlsx-parser` before compute-core integration.
