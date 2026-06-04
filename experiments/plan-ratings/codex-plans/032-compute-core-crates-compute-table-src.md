# Plan 032: Compute Table Source Improvements

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/crates/compute-table/src`

Queue item: 32, `mog/compute/core/crates/compute-table/src`, table compute, filters, and structured references.

Scope this plan covers:

- The `compute-table` Rust crate source for pure table computation: table creation, resize, range queries, options, totals, calculated-column helpers, auto-expansion helpers, and table lifecycle event data.
- Filter computation: value, condition, top/bottom, dynamic date/average, color, icon payloads, advanced filter DNF criteria, filter dropdown data, row visibility bitmaps, and filter resolution helpers.
- Sort and comparison semantics for table rows, filter dropdown values, slicer cache values, and display/dedup keys.
- Slicers and timeline utilities: slicer CRUD, slicer-to-filter conversion, slicer cache generation, timeline period generation, and Excel serial date handling.
- Structured references: resolution against `Table` and `formula_types::TableDef`, structural adjustment, formatting, and parser bridge use through `compute-parser`.
- Table styles: built-in style registry, custom style registry helpers, table cell format resolution, borders, banding, first/last column emphasis, and style option handling.
- Public bridge exposure through `compute/core/src/bridge_pure.rs` and generated WASM/N-API bindings only as integration contracts for this crate. The implementation target remains the production `compute-table` crate and its production callers.

Out of scope for the first implementation effort:

- Moving durable table state, Yrs storage, undo/redo, row moves, import/export persistence, or UI state into `compute-table`. This crate should remain pure and stateless.
- Reimplementing compute-core table lifecycle state in TypeScript.
- Test-only performance improvements, bridge-only compatibility wrappers, or temporary behavior shims around incorrect pure engine semantics.

## Current role of this folder in Mog

`compute-table/src` is the canonical Rust pure table engine. Its crate-level docs explicitly position it as stateless table computation with no DOM, Yjs, React, or XState. `compute/core/src/lib.rs` re-exports it as `compute_core::table`, while `compute/core/src/bridge_pure.rs` exposes many of its functions through `TableBridge` for WASM and N-API.

The folder currently includes about 100 source files with extensive focused tests. Its public surface is broad:

- Table model operations live under `table/`, `operations.rs`, `queries.rs`, `auto_expansion.rs`, `calculated_columns.rs`, `events.rs`, `range_resolution.rs`, and `selection.rs`.
- Filters live in `filter.rs`, `filter_resolve/`, `filter_dropdown.rs`, `advanced_filter.rs`, `visibility.rs`, and related tests.
- Sort and shared value semantics live in `sort.rs` and `compare.rs`.
- Slicer and timeline logic live in `slicer.rs`, `slicer_cache.rs`, and `timeline.rs`.
- Structured references live in `structured_refs.rs` and `structured_refs/*`.
- Table styles live in `styles.rs`, `styles/*`, `custom_styles.rs`, and `styles_tests/*`.

Important production paths observed during inspection:

- WASM and N-API import `compute_table::types::{DynamicFilter, FilterCriteria, FilterDropdownData, RowVisibility, Slicer, SlicerCache, SlicerSortOrder, SortSpec, Table, TableBoolOption, TableCellFormat, TableColumn, TableRange, TableStructureChange, TableStyleDef, TableTopBottomFilter}` for generated bridge methods.
- `compute-core` production filter evaluation converts domain filter records to `compute-table::types::FilterCriteria` and delegates row matching to `compute_table::filter::evaluate_column_filter`.
- `compute-core` structured-reference dependency extraction resolves formula structured references through `compute_table::structured_refs::resolve_ranges_from_table_def`.
- `table-engine/src` still exposes TypeScript wrappers and type conversion helpers around the same conceptual table operations, so Rust-vs-TypeScript drift is a real contract risk.

Current sharp edges worth addressing systematically:

- Several exported operations encode invalid input differently: `Result<Table, TableError>`, `Option<Table>`, an unchanged clone, an empty vector, or a string error at the bridge layer.
- `resolve_dynamic_filter` panics for date-based dynamic filters when `now` is missing, while other public paths inject a clock. A pure engine API should make temporal context required or return a typed error.
- Color and icon filters intentionally fall back to all-visible when required context is missing on some paths. That is acceptable only if the API says it is a preview/no-context path; production filter application must never silently convert an unsupported predicate to pass-all.
- Visibility composition uses minimum bitmap length, while slicer cache/dropdown paths tolerate short visibility bitmaps differently. Exact bitmap length and 0/1 normalization are not a single contract.
- Structured reference resolution returns empty ranges or `None` for several distinct failures, making unknown table, unknown column, missing current row, no data rows, and empty specifiers hard to distinguish.
- Timeline date utilities use local serial conversion logic that should be reconciled with the dynamic filter date-range serial utilities and the project-wide Excel date contract.

## Improvement objectives

1. Make `compute-table` an auditable pure-engine contract.
   Build a public surface matrix for every exported function and type in this folder: module, bridge exposure, TypeScript wrapper parity, input invariants, output semantics, error semantics, temporal requirements, format/icon context requirements, and production caller.

2. Normalize invalid-input behavior into typed contracts.
   Replace silent unchanged-table returns, ambiguous `Option` returns, empty-vector failure sentinels, and bridge `String` errors with domain-specific `Result` or explicit result enums. Update production callers and bridge descriptors to use the stronger contract directly.

3. Make filter evaluation total, deterministic, and context-explicit.
   Introduce a `FilterEvaluationContext` style contract that makes `now`, `week_start_day`, row formats, icon/conditional-format context, and bitmap length expectations explicit. Date-based dynamic filters should never panic; color/icon filters should never silently pass all rows on production evaluation paths.

4. Canonicalize value identity and ordering across table features.
   Ensure table sort, filter dropdowns, value filters, slicer caches, advanced filters, and display text share one documented value equality/order/display contract, including strings, booleans, errors, blanks, arrays, controls, images, date serials, and numeric edge cases.

5. Strengthen structured-reference semantics.
   Resolve structured refs with typed outcomes that distinguish success, empty-by-definition, and resolution failure. Preserve Excel semantics for case-insensitive table/column lookup, `#This Row`, no-data tables, headers/totals/all unions, column ranges, escaping, formatting roundtrips, and formula dependency extraction.

6. Align Rust, bridge, and TypeScript table-engine behavior.
   Treat the Rust crate as the canonical engine. Generate or audit TypeScript wrappers and bridge descriptors from the Rust contract so `table-engine/src`, WASM, N-API, and compute-core production callers do not drift.

7. Consolidate table geometry and identity contracts.
   Table ranges, column IDs, column names, header/totals/data regions, cell-id backed ranges, resize rules, auto-expansion, calculated columns, filter ownership, and slicer connectivity should have one explicit production contract that `compute-core` storage can rely on.

8. Make style and date behavior Excel-contract driven.
   Built-in style definitions, custom styles, table cell format precedence, row/column banding, borders, filter color matching, and timeline/dynamic-filter date serial handling should be verified against a shared Excel semantics matrix rather than independent local assumptions.

## Production-path contracts and invariants to preserve or strengthen

- `compute-table` remains pure and stateless. It accepts data snapshots and returns new values, bitmaps, ranges, events, or typed errors. It does not read Yrs state, dispatch UI events, mutate workbooks, or perform I/O.
- `domain-types`, `cell-types`, `formula-types`, and `value-types` remain the canonical shared type crates. `compute-table` must not duplicate durable domain models when a canonical type exists.
- Public serde wire types keep camelCase field names and tagged enum shapes unless the implementing change updates all generated bridge, TypeScript, and SDK callers in the same production contract change.
- Table IDs, table names, display names, column IDs, and column names must not be conflated. Case-insensitive name lookup is allowed where Excel semantics require it, but stable IDs remain the identity keys for durable relationships.
- `TableRange` values are inclusive, position-based, and must be valid before table operations use them. Cell-id range resolution must report missing/deleted endpoints explicitly instead of silently hiding identity loss.
- Table resize preserves the top-left anchor unless a new operation explicitly supports table move. Resize cannot produce inverted ranges, zero columns, or a table with no allowed data row under the chosen header/totals configuration.
- Column add/remove/rename operations preserve non-colliding stable column IDs, valid indices, unique visible names, calculated formula metadata, totals metadata, and structured-reference rewrite inputs.
- Filter bitmaps are one byte per data row, contain only 0 or 1, and all composed bitmaps for one evaluation have identical row-count contracts. Any truncation, extension, or unknown row is an explicit result, not implicit behavior.
- Dynamic filter date rules use the same injected calendar date as NOW()/TODAY() production evaluation and a documented week start. Pure APIs that cannot know the date require it as input.
- Color filters use the fully resolved display format for each row. Icon filters either receive conditional-format icon context or return a typed unsupported/context-missing outcome.
- Advanced Filter criteria preserve Excel's DNF shape: criteria rows are ORed, non-empty cells within a row are ANDed, repeated criteria headers compose predicates for one list column, and formula criteria are either implemented through a formula-evaluation hook or rejected with a typed unsupported result.
- Structured-reference resolution must preserve table sheet identity, current-row semantics, headers/data/totals/all row regions, column ranges, escaping, and formula dependency coverage. Empty table sections are not the same as unknown table/column failures.
- Sort operations return stable permutations over original row indices and do not mutate data. Production application of the permutation remains in compute-core so row identity, formulas, formatting, hidden rows, filters, undo, and events are preserved.
- Table style resolution is deterministic, applies the same precedence for headers, totals, row banding, column banding, first/last column emphasis, and edge borders across Rust and rendered UI, and uses the default style only as an explicit style-resolution fallback.

## Concrete implementation plan

1. Build the compute-table contract inventory.
   Add an audit fixture or source-generated report listing every `pub fn`, `pub struct`, `pub enum`, `pub type`, and re-export in `compute-table/src`. Include bridge method name where exposed by `TableBridge`, TypeScript `table-engine` wrapper name where present, production caller categories, input invariants, output/error contract, and coverage status. This becomes the work queue for the remaining implementation slices.

2. Define canonical result and context types.
   Add small, domain-specific public types such as `TableOperationError`, `TableOperationResult<T>`, `FilterEvaluationContext`, `FilterEvaluationError`, `StructuredRefResolution`, `BitmapValidationError`, and `RangeIdentityResolution`. Map them through the existing `TableError` where appropriate, but avoid string-only errors at the public bridge boundary.

3. Normalize table operation returns by category.
   Convert operations that silently return unchanged tables or `Option<Table>` for invalid input into explicit results. Priority targets: `remove_column`, `rename_table_column_by_index`, `set_column_total_function`, `remove_data_row`, `set_calculated_formula`, `clear_calculated_formula`, range identity fallback, and auto-expansion operations. Update `TableBridge` descriptors so WASM/N-API receive typed failures instead of ambiguous success-shaped values.

4. Strengthen creation and naming validation.
   Ensure `create_table` validates the table name, range, header count, column count, duplicate input headers, generated column names, table ID, and Excel name constraints through one path. Table name and column name dedupe should be deterministic, case-insensitive, and covered by property tests. Reject invalid states at construction instead of relying on later range helpers.

5. Canonicalize bitmap handling.
   Introduce helpers for validating row visibility and filter bitmaps: exact expected length, 0/1 values, and optional normalization when a caller intentionally accepts bool-like bytes. Use the same helpers in `visibility`, `filter_dropdown`, `slicer_cache`, and production filter evaluation. Replace "use minimum length" composition with an explicit exact-length production function; keep any truncating helper only if it has a clear name and non-production disposition.

6. Make filter evaluation context explicit.
   Change the core evaluation path so dynamic date filters require `now`, `week_start_day` has an explicit default or input contract, color filters require a format slice of exact length, and icon filters require an icon context or return `UnsupportedIconFilterContext`. Keep the bridge pure `table_evaluate_column_filter` honest by either accepting the required context or exposing it as a no-format preview method with a distinct name and documented limitations.

7. Complete color and icon filter semantics.
   Color filters should match the displayed fill/font color after table style, cell format, conditional formatting, and theme resolution in production. Icon filters should evaluate against conditional-format rule output, not pass through. The pure crate can own the final predicate over resolved per-row color/icon values; compute-core should own gathering those resolved values.

8. Unify value equality, order, and display.
   Create one documented `TableValueSemantics` module or fixture that drives `compare_values`, `cell_values_equal`, `cell_value_key`, `format_cell_display`, filter dropdown sorting, slicer cache sorting, value filter membership, advanced filter equality, and custom sort matching. Cover all current `CellValue` variants, and document where table ordering intentionally differs from pivot ordering.

9. Harden top/bottom and dynamic filters.
   Audit `TopBottomBy::Items`, `Percent`, and `Sum` behavior for ties, blanks, errors, negative numbers, duplicate values, count zero, count beyond row count, percent rounding, and empty data. For dynamic filters, share date serial conversion and date range computation with `timeline.rs` and filter-resolve date helpers, including Excel 1900 leap-year compatibility.

10. Upgrade Advanced Filter from partial evaluator to production contract.
   Either implement formula-backed criteria by accepting a formula evaluation callback/result snapshot from compute-core, or keep a first-class unsupported result that production callers surface to users. Add explicit contracts for wildcard escaping, repeated headers, blank/nonblank criteria, unknown headers, source row width mismatch, unique-record dedupe keys, and copy-to vs in-place consumers.

11. Replace structured-ref sentinels with typed resolution.
   Split resolution outcomes into `Resolved(Vec<TableRange>)`, `ResolvedEmpty`, `UnknownTable`, `UnknownColumn`, `MissingCurrentRow`, `InvalidSpecifier`, and `InvalidTableGeometry`. Use these outcomes for both `Table` and `TableDef` resolution so formula dependency extraction can distinguish no dependency from an unresolved dependency requiring an error or conservative invalidation.

12. Strengthen structured-ref formatting and adjustment.
   Build a roundtrip corpus from Excel-style structured references: escaped column names, quotes, brackets, `#`, `@`, spaces, column ranges, reversed column ranges, headers/data/totals/all unions, nested bracket forms, implicit `@`, empty sections, renamed tables, renamed columns, removed columns, added columns, and resized tables. Adjustment should return typed rewrite outcomes, including "reference now invalid", rather than preserving invalid original refs by default.

13. Make table range identity explicit.
   Replace `resolve_table_range`'s silent fallback with a result describing resolved identity, missing corner, legacy fallback, or migration needed. Coordinate with compute-core storage so tables using CellId identity can be repaired, migrated, or invalidated intentionally when endpoint cells are deleted or moved.

14. Reconcile timeline and date-range utilities.
   Move Excel serial date conversion to a shared helper in this crate or a lower value/date utility crate. Use it in `timeline.rs`, `filter_resolve/date_range.rs`, dynamic filters, and any bridge pure date helpers. Replace approximate year detection with exact serial-to-date conversion and add tests for serial 1, 59, 60, 61, leap years, month/quarter/year boundaries, and timezone-independent calendar dates.

15. Make style resolution auditable.
   Build a generated fixture for built-in style IDs, style count, key colors, border defaults, and region precedence. Verify `TableStyleMedium2` fallback exists without `expect`-only enforcement. Extend custom style behavior so user-defined style lookup and built-in style lookup use one registry contract, with typed `StyleNotFound` and `DuplicateStyleName` errors.

16. Align `compute-table` with `table-engine/src`.
   Inventory TypeScript wrappers and conversions in `table-engine/src`, especially filter conversion, sort, slicer cache, filter dropdown, visibility, and structured refs. Choose Rust as canonical. Either generate TypeScript wrappers/types from bridge metadata or add parity tests that compare Rust bridge outputs against TypeScript expectations for the same fixtures until the TypeScript implementation can be reduced to thin bridge calls.

17. Add bridge descriptor parity checks.
   For `TableBridge`, verify every intended pure table function is emitted in WASM and N-API, and every skip is intentional with a typed reason such as unsupported `usize`. Replace skipped signatures with bridge-friendly types where the operation is production-relevant, for example `u32`/`u64` row counts instead of `usize` for sort/all-visible helpers.

18. Integrate with compute-core production paths.
   Update `compute/core/src/storage/sheet/filters/*`, structured-reference dependency extraction, table lifecycle services, slicer helpers, and bridge pure wrappers to consume the new typed contracts. Production paths should gather required state and call the canonical pure engine; they should not duplicate filter/sort/structured-ref logic.

19. Add XLSX and UI contract hooks.
   Coordinate with import/export code so table styles, filters, sort state, totals, calculated columns, slicers, and structured references roundtrip through the same pure contracts. Coordinate with kernel/spreadsheet UI so real filter dropdowns, slicers, sort, auto-expansion, and structured-reference formulas exercise the Rust production path.

20. Retire stale or misleading local comments.
   Several comments document "bug fix over TS", "bridge layer handles actual match", or "Table struct does not have auto_expand" despite observed types including newer fields. After contracts are explicit, update comments to describe current production behavior and remove historical implementation notes that no longer guide maintainers.

## Tests and verification gates

Rust crate gates:

- `cargo test -p compute-table`
- `cargo clippy -p compute-table`
- Focused tests for each changed category: table creation/resize/names, column operations, filters, filter resolution, advanced filter, dropdowns, sort, visibility, slicers, timeline, structured refs, styles, range identity, calculated columns, auto-expansion, and events.

Compute-core integration gates:

- `cargo test -p compute-core -- filter`
- `cargo test -p compute-core -- structured_ref`
- `cargo test -p compute-core -- slicer`
- `cargo test -p compute-core -- table`
- `cargo clippy -p compute-core` when compute-core callers or bridge descriptors change.

Bridge and binding gates:

- WASM bridge generation/build gate for table pure functions after descriptor or type changes, using the repo's configured `target-wasm` path.
- N-API bridge generation/build gate after descriptor or type changes.
- Descriptor parity test proving `TableBridge` WASM/N-API exposure matches the contract matrix, with explicit dispositions for unsupported bridge types.
- Serde roundtrip tests for every public `compute_table::types` wire type and every new result/context/error type.

TypeScript and UI gates:

- `pnpm test` for `table-engine` when wrapper parity or TypeScript conversion behavior changes.
- Relevant kernel tests for table/filter/sort/slicer callers when production paths change.
- `pnpm typecheck` for TypeScript bridge metadata, contracts, wrappers, or kernel caller changes.
- Browser/UI exercise through real input paths for create table, rename table/column, resize table, filter dropdown, dynamic filter, color/icon filter, slicer selection, sort, auto-expansion by adjacent typing/paste, calculated columns, totals row, and structured-reference formulas.

Contract tests to add:

- Public surface contract matrix freshness test for `compute-table/src`.
- Rust-vs-TypeScript fixture parity for filter conversion, dropdowns, slicers, visibility, sort, structured refs, styles, and date serial helpers.
- Filter evaluation matrix covering every `FilterCriteria` variant, exact context requirements, row format/icon context, dynamic date rules, average rules, top/bottom tie behavior, blanks, errors, controls, images, arrays, and empty data.
- Bitmap property tests for exact length, invalid byte values, empty bitmaps, all-visible, all-hidden, multi-filter AND composition, and row visibility summaries.
- Structured-ref corpus tests for parse-format-resolve-adjust roundtrips and typed failure outcomes.
- Range identity tests for resolved CellId corners, missing top-left, missing bottom-right, both missing, legacy fallback, migration required, moved endpoints, and inverted endpoint resolution.
- Date serial tests shared by timeline and dynamic filters, including Excel serial 60 behavior and month/quarter/year boundaries.
- Style fixture tests for all built-in styles, default fallback, banding precedence, emphasis precedence, borders, header/totals rows, no-header tables, no-totals tables, and single-column tables.
- Advanced Filter tests for DNF criteria shape, repeated headers, wildcard criteria, blank/nonblank, unique records, malformed ranges, formula criteria, and copy-to/in-place integration results.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Normalizing return contracts will surface existing callers that rely on unchanged-table or empty-vector sentinels. The correct response is to update those production callers to handle typed outcomes, not to preserve ambiguous behavior.
- Bridge type support may lag Rust type quality. For production-relevant operations, adjust the Rust signatures to bridge-friendly typed primitives instead of skipping descriptors.
- Tightening bitmap length validation may reveal hidden data-shape bugs in filter dropdowns, slicers, and storage-level filter evaluation. Those should be fixed at the producer of the bad bitmap.
- Color and icon filters depend on fully resolved display context from compute-core. The pure crate should own predicates over resolved inputs, while compute-core owns context collection.
- Structured-reference typed failures may require formula evaluator and dependency graph changes so unresolved references are represented correctly rather than dropped.
- Table range identity fallback is currently forgiving. Making it explicit can expose tables whose CellId endpoints were lost; compute-core needs repair/migration behavior for those cases.
- Rust-vs-TypeScript parity work can uncover TypeScript paths that still bypass the Rust engine. The plan intentionally routes production behavior to Rust rather than maintaining two independent implementations.

Non-goals:

- Do not make `compute-table` stateful.
- Do not add dependencies from public `mog` code to `mog-internal`.
- Do not optimize benchmark harnesses or mock-only paths.
- Do not keep TypeScript as a second source of truth for table engine semantics.
- Do not add compatibility shims for loose or ambiguous return behavior as the primary solution.
- Do not bypass generated bridge descriptors with hand-written WASM/N-API table method surfaces.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the contract inventory is built:

- Agent A: public surface and bridge inventory for `compute-table/src`, `TableBridge`, WASM, N-API, and `table-engine/src`.
- Agent B: table operation contracts for create/resize/names/columns/totals/calculated columns/auto-expansion/events.
- Agent C: filter contracts for value/condition/top-bottom/dynamic/color/icon/advanced filters and bitmap validation.
- Agent D: structured-reference contracts for resolution, formatting, adjustment, parser roundtrips, and formula dependency integration.
- Agent E: slicer, timeline, date serial, dropdown, and row visibility contracts.
- Agent F: style registry, custom style, cell format resolution, and XLSX style roundtrip fixtures.
- Agent G: compute-core integration updates for storage filters, table lifecycle services, structured-ref dependency extraction, slicers, and bridge pure wrappers.
- Agent H: TypeScript/kernel/UI parity updates and real UI workflow tests.

Key dependencies:

- `mog/compute/core/src/bridge_pure.rs` owns the generated `TableBridge` exposure for this crate.
- `mog/compute/wasm/src` and `mog/compute/napi/src` consume the generated bridge descriptors and the `compute_table::types` wire structs.
- `mog/compute/core/src/storage/sheet/filters` converts durable domain filter records into `compute-table` filter criteria and applies production filter evaluation.
- `mog/compute/core/src/scheduler/dep_extract` consumes structured-reference resolution for formula dependency edges.
- `mog/compute/core/src/storage/engine/services/tables` and related table lifecycle code own durable table state and should call into this crate for pure table computations.
- `mog/compute/core/crates/compute-parser/src` owns parsing of structured references used by this crate's formatting and bridge parsing paths.
- `mog/domain-types`, `mog/compute/core/crates/types/*`, and public contracts own canonical shared types.
- `mog/table-engine/src` is the TypeScript-facing table engine/wrapper surface that must be aligned with the Rust canonical behavior.
- `mog/kernel/src/domain/tables`, worksheet APIs, spreadsheet UI, and XLSX import/export are production consumers that verify the real user-visible workflows.
