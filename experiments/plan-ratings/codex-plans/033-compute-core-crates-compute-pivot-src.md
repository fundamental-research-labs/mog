# Plan 033: Compute Pivot Aggregation and Layout Semantics Improvements

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/crates/compute-pivot/src`

Scope this plan covers:

- The `compute-pivot` Rust crate source under `src`, including pivot validation/resolution, relational query mapping, presentation projection, row/column hierarchy handling, grand totals, Show Values As transforms, calculated-field parsing/evaluation, filtering helpers, grouping helpers, drill-down, field item extraction, and public re-exports.
- Production behavior exposed through `compute_pivot::{compute, compute_resolved, compute_with_show_values_as, compute_with_show_values_as_resolved, validate_and_resolve, drill_down_resolved}`.
- Result-shape contracts consumed by `compute/core/src/mirror/write/pivot_materialization.rs`, `compute/core/src/storage/engine/objects/pivots.rs`, pure bridge bindings, spreadsheet pivot UI, SDK/runtime generated APIs, and GETPIVOTDATA pivot definitions.
- Adjacent public crates only where the correct pivot fix crosses a boundary: `compute-relational`, `compute-stats`, `types/pivot-types`, `domain-types/src/domain/pivot`, `snapshot-types`, and compute-core bridge/materialization code.

Out of scope for the first implementation slice:

- Rewriting the XLSX pivot parser or writer except where parser-produced DTOs expose a broken compute-pivot contract.
- Building a separate pivot implementation in TypeScript, materialization, or tests.
- Optimizing benchmark-only paths before the production compute/materialization path is correct.
- Adding compatibility shims that preserve known wrong pivot semantics.

## Current role of this folder in Mog

`compute-pivot/src` is the stateless pivot table computation engine. Its intended contract is a pure function from `(validated config, source data, expansion state)` to `PivotTableResult`, with no document state or `CellMirror` dependency inside the crate.

Current production flow:

- `compute()` and `compute_with_show_values_as()` validate a boundary `PivotEngineConfig` into `ResolvedPivotConfig`.
- `compute_resolved()` maps the resolved config into a `compute_relational::RelationalQuery`, executes the relational engine, and projects `QueryResult` back into `PivotTableResult`.
- `presenter/*` owns row flattening, column header spans, expansion visibility, grand-total framing, column remapping, and rendered bounds.
- `show_values_as/*` mutates post-aggregation display values using a `GroupHierarchy` index built from the aggregated row tree and projected rows.
- `calc_field/*` parses a small arithmetic formula language for calculated fields. Regular row body values are calculated by `compute-relational`; grand totals are currently patched locally in `compute-pivot`.
- `types/*` re-exports `pivot-types`, whose canonical DTOs mostly live in `domain-types`.

Important observed gaps:

- `AggregateFunction::CountUnique` is mapped to relational `Count`, so it does not count unique values on the production path.
- Future or unknown aggregate/date/top-bottom variants fall back to `Sum`, `Day`, or `Count` in query mapping instead of failing through an explicit contract.
- `PivotTableResult.measure_descriptors` and `value_records` are always empty even though public DTOs define stable typed metadata for addressable pivot values.
- Value slots are mostly keyed by `field_id`; stable `placement_id` and `PivotValueSource` are not carried through the resolved measure plan, which makes duplicate value placements and calculated-field value sources ambiguous.
- Calculated fields have two evaluation paths: relational body/subtotal calculation and local grand-total calculation. The local path can diverge for duplicate value fields, aliases, or formulas that should resolve by placement/output identity.
- Several layout knobs are resolved but not implemented in projection: repeat labels, show empty rows/columns, subtotal-at-top, and a fully distinct compact vs outline row projection contract.
- Presenter expansion accepts structural keys in row/column visibility, while `build_group_hierarchy_from_aggregated_tree()` only checks raw node keys, allowing Show Values As hierarchy to disagree with displayed expansion state.
- Collapsed column parents can render visible headers while body values are padded with `Null` instead of using the collapsed parent aggregate.
- `ShowValuesAs` stride inference depends on grand-total corner shape and defaults to one measure, which is fragile when grand totals are disabled, empty, or multi-measure/calculated values are present.
- `ShowValuesAs` documentation says Difference and PercentDifference require `base_item`; validation only requires `base_field`, and runtime silently defaults to previous.
- `ResolvedFilter` documentation says `show_items_with_no_data` defaults false, while validation defaults it to true.

## Improvement objectives

1. Make the pivot measure contract explicit.
   Introduce one resolved measure-slot model that carries placement identity, source identity, aggregate function, display name, number format, Show Values As config, output stride index, and field/calculated-field aliases.

2. Correct aggregation semantics systematically.
   Implement every public `AggregateFunction` exactly, including `CountUnique`, and remove silent fallback behavior for future variants.

3. Populate typed pivot result metadata.
   Emit `measure_descriptors` and `value_records` consistently with `PivotRow.values`, column headers, tuple keys, visible expansion state, and source row provenance.

4. Unify calculated-field evaluation.
   Make row values, subtotals, row grand totals, column grand totals, and corner totals use one calculated-measure resolver with the same alias and duplicate-placement rules.

5. Turn presenter layout into an auditable projection contract.
   Implement compact, outline, and tabular forms as explicit projection modes, including repeat labels, subtotal placement, blank rows, empty row/column items, row/column captions, and grand-total framing.

6. Make expansion and visibility canonical.
   Use one expansion-key contract for row projection, column projection, Show Values As hierarchy, drill-down, and item extraction.

7. Make Show Values As measure-aware.
   Address transforms by measure slot, not inferred vector widths, and define whether each transform applies to regular, calculated, subtotal, and grand-total values.

8. Strengthen validation as a production contract.
   Validate ambiguous value references, calculated-field value placements, Show Values As base requirements, non-finite boundary timestamps, duplicate placements, source ranges, and layout/filter defaults before execution.

9. Verify through production consumers.
   Prove the compute-pivot result can be materialized, queried, displayed, registered for GETPIVOTDATA, and transported through generated bridge surfaces without downstream inference.

## Production-path contracts and invariants to preserve or strengthen

- `compute-pivot` remains a public, dependency-clean Rust crate. It must not depend on `mog-internal` or on UI/application code.
- `ResolvedPivotConfig` remains the trusted execution input. Execution code should not reintroduce `unwrap_or` fallback semantics for invalid references or missing required options.
- `compute-pivot` continues to delegate generic grouping, aggregation, sorting, filtering, calculated-measure, and grand-total execution to `compute-relational` where that is the correct production engine.
- The pivot result value layout must be explicit: visible column tuple order times measure slot order. Every `PivotRow.values`, grand-total vector, `measure_descriptors`, `value_records`, and materialized cell coordinate must agree on that order.
- `Count` counts numeric values, `CountA` counts non-empty values, and `CountUnique` counts unique non-empty values using canonical `compute-stats` value equality/key semantics.
- Non-algebraic aggregates and calculated fields must compute subtotals and grand totals from the raw contributing rows or an equivalent exact accumulator, not by composing child display values when that would change semantics.
- Future `#[non_exhaustive]` enum variants must produce explicit unsupported/validation errors or a consciously added implementation. They must not silently become `Sum`, `Day`, or `Count`.
- Stable `PlacementId` is the primary identity for value slots. `FieldId` is a source identity and can repeat across value placements.
- `PivotValueSource::Field` and `PivotValueSource::CalculatedField` remain distinct through validation, execution, result metadata, item extraction, and bridge serialization.
- Calculated-field formulas operate on aggregated values with deterministic alias resolution. Duplicate source field names, duplicate value placements, display names, field IDs, and output aliases must resolve the same way for body cells and all totals.
- Expansion state semantics must be identical for row projection, column projection, hierarchy indexing, Show Values As, drill-down, and item extraction. Empty expansion sets continue to mean fully expanded.
- Collapsed row or column group display must show the aggregate for the collapsed group, not a placeholder `Null`, unless the aggregate itself is blank/null by contract.
- `PivotGrandTotals::{row,column,grand}` preserve the current `None` vs `Some(Vec::new())` distinction: `None` means no slot, while an empty vector can reserve a visible slot with no value cells.
- `rendered_bounds` remains authoritative for materialization and GETPIVOTDATA bounds. Downstream renderers should not infer geometry from row/value vector lengths.
- Empty data, header-only source ranges, all-filtered data, no-measure pivots, and no-row/no-column pivots return deterministic framed results with clear errors only when the config or relational execution is invalid.
- Null group headers continue to display as `(blank)` while underlying keys remain collision-safe and distinct from literal text values.

## Concrete implementation plan

1. Write the pivot contract inventory.
   Add a source-level contract matrix for compute-pivot covering config resolution, measure slots, aggregate mapping, calculated fields, Show Values As, layout modes, expansion keys, value vector shape, result metadata, grand totals, drill-down, item extraction, and materialization expectations. Use this as the implementation checklist and as the basis for contract tests.

2. Introduce a resolved measure-slot model.
   Extend `ResolvedPivotConfig` or add a sibling `ResolvedMeasurePlan` with one ordered `ResolvedMeasureSlot` per output measure. Each slot should carry `PlacementId`, `PivotValueSource`, source `FieldId` or `CalculatedFieldId`, source column where applicable, aggregate function, display name, number format, Show Values As config, output index, and alias set. Replace ad hoc `value_placements()` plus separate `calculated_fields()` width calculations with this measure plan wherever output values are addressed.

3. Fix aggregate mapping and relational support.
   Add `CountUnique` to `compute-relational` aggregation if needed, backed by `compute-stats` unique counting semantics. Replace `map_aggregate()` with an exhaustive mapping that either maps every known aggregate or returns a structured `PivotError`. Do the same for date grouping and top/bottom mapping so non-exhaustive variants cannot degrade silently. Add tests for every aggregate in body cells, subtotals, row grand totals, column grand totals, corner totals, sort-by-value, top/bottom filters, and Show Values As inputs.

4. Make duplicate value placements unambiguous.
   Resolve sort-by-value and top/bottom references by stable value placement identity where available, not first matching `field_id`. Preserve compatibility for legacy configs only by resolving unambiguous `field_id` references and rejecting ambiguous duplicates with a structured validation error. Update flat DTO conversion tests for repeated source fields with different aggregate functions and display names.

5. Unify calculated-measure execution.
   Move local grand-total calculated-field patching onto the same alias resolver used by relational calculated measures, or extract a shared calculated-measure evaluator used by both `compute-relational` and compute-pivot totals. The resolver should support `col0`, placement IDs, source field IDs, source field names, display names, and first-wins duplicate name policy consistently. Remove duplicated `apply_calc_fields_to_values()` behavior once all totals use the shared path.

6. Populate `measure_descriptors`.
   Build descriptors directly from the resolved measure plan. Field-backed descriptors should include stable placement ID, source, aggregate function, display name, and number format. Calculated descriptors should preserve calculated-field identity, display name, and formula metadata through the existing descriptor types or a deliberate DTO extension if the current shape is insufficient.

7. Populate `value_records` on the production result.
   During projection, produce typed row tuple keys, column tuple keys, measure index, computed value, and source row indices for every addressable visible value cell, including subtotal and grand-total records where the public contract expects them. Keep records aligned with `PivotRow.values` and grand-total slots. If full provenance would be too large for some production paths, add an explicit provenance option or compact index format instead of leaving metadata silently empty.

8. Rewrite presenter projection around a layout model.
   Add a `PivotLayoutProjection` or equivalent internal structure that computes row-header columns, column-header rows, data region, grand-total slots, value-header rows, captions, and body row descriptors before materializing `PivotTableResult`. Implement compact, outline, and tabular row projections as separate strategies that share one geometry contract. Honor `repeat_row_labels`, `subtotal_location`, `insert_blank_row_after_item`, row/column/data captions, grand-total captions, and header visibility flags where result DTOs can express them.

9. Implement empty item semantics.
   Define the source of the item universe for `show_items_with_no_data`, `show_empty_rows`, and `show_empty_columns`: source data before filters, pivot cache items, or explicit field item metadata. Then implement row and column tree completion on that universe so filtered-out but visible empty groups render with correct zero/null aggregate semantics. Do not fake empty items in the UI or materializer.

10. Canonicalize expansion keys.
    Move `ExpansionKey` conversion and matching into a shared helper used by presenter visibility and hierarchy tree building. Accept both raw node keys and structural legacy keys where needed, but normalize once. Update Show Values As hierarchy construction so collapsed/expanded scope matches projected rows and columns exactly.

11. Correct collapsed column aggregates.
    Change `ColumnRemap` from a leaf-only remapper to a visible-column descriptor list. A visible descriptor can represent either a leaf or a collapsed parent node. When a parent is collapsed, map row values to the parent aggregate for that column group instead of padding with `Null`; reserve `Null` only for genuinely missing values.

12. Make Show Values As measure-slot aware.
    Replace grand-total-corner width inference with the resolved measure plan and visible column descriptors. For each transform, define whether it reads raw values or already transformed values, how it handles regular vs calculated measures, and how it treats subtotal/grand-total cells. Align validation with the domain docs: either require `base_item` for Difference and PercentDifference or update the public contract and tests to say missing base item means previous.

13. Harden filter, grouping, and layout defaults.
    Reconcile documentation and implementation for `show_items_with_no_data`. Validate number grouping, date grouping, condition operands, top/bottom `n`, and Show Values As base fields against the complete resolved measure/axis plan. Reject ambiguous or unsupported configurations early. Ensure `validate_config()` remains a legacy string wrapper over the same structured validation path.

14. Align drill-down and item extraction with the new result model.
    Update drill-down to use typed row/column tuple keys or a documented key adapter instead of relying on ad hoc string paths. Update `get_field_items` and `get_all_field_items` to reflect empty item semantics, expansion state, calculated value placements, and stable placement identity.

15. Update materialization and GETPIVOTDATA registration.
    Keep `PivotRenderedBounds` authoritative and verify that `CellMirror::materialize_pivot()` writes every header, body value, grand total, and corner cell according to the new projection. Update `PivotTableDefExt::to_pivot_table_def()` to use measure descriptors, placement identity, calculated fields, `data_on_rows`, and rendered bounds accurately enough for GETPIVOTDATA lookup.

16. Add production-path regression fixtures.
    Build compact fixtures that run through `compute-core` stored pivot paths, not only direct `compute-pivot` helpers: create/load pivot config, source identity resolution, compute from source, materialize, get all items, register pivot def, and bridge pure compute. Cover duplicate value fields, calculated fields, CountUnique, collapsed rows/columns, Show Values As, empty items, no-measure framing, and custom captions.

## Tests and verification gates

Required Rust gates for implementation in this folder:

- `cargo test -p compute-pivot`
- `cargo clippy -p compute-pivot`

Additional Rust gates when adjacent crates change:

- `cargo test -p compute-relational` and `cargo clippy -p compute-relational` for aggregate, calculated-measure, sorting, filtering, subtotal, grand-total, or tree-shape changes.
- `cargo test -p compute-stats` and `cargo clippy -p compute-stats` if aggregate value semantics or unique-counting helpers change.
- `cargo test -p pivot-types` and `cargo clippy -p pivot-types` if result/config DTOs or serde behavior change.
- `cargo test -p domain-types` and `cargo clippy -p domain-types` if canonical pivot DTOs, `AggregateFunction`, placement, or Show Values As contracts change.
- `cargo test -p compute-core` and `cargo clippy -p compute-core` if bridge, storage, materialization, GETPIVOTDATA registration, or stored pivot services change.

TypeScript and bridge gates when public surfaces change:

- Regenerate and check bridge artifacts for `compute/wasm`, `compute/napi`, kernel compute bridge metadata, and transport command metadata.
- Focused kernel pivot bridge tests for DTO conversion, result transport, and item extraction.
- Focused spreadsheet pivot component or hook tests when result shape or expansion behavior changes.
- `pnpm typecheck` for TypeScript declaration, generated bridge, app, or SDK changes.

Contract tests to add:

- Aggregate matrix: every `AggregateFunction` across body cells, subtotals, row grand totals, column grand totals, corner totals, empty inputs, mixed text/numeric/null/error inputs, filtered rows, and column groups.
- Count semantics: `Count`, `CountA`, and `CountUnique` on text-only, number-only, mixed, blank, duplicate, case-variant, and error-containing data.
- Measure identity: duplicate source field value placements with different aggregates, display names, placement IDs, sort-by-value, top/bottom filters, number formats, and Show Values As configs.
- Calculated fields: field-name aliases, placement/output aliases, duplicate source fields, division by zero, missing references, non-finite results, body/subtotal/grand-total parity, and calculated-field value placements using flat `calculatedFieldId` DTOs.
- Result metadata: `measure_descriptors` and `value_records` align with row values, column headers, tuple keys, measure indexes, source row indices, subtotal rows, collapsed nodes, and grand totals.
- Layout matrix: compact, outline, tabular, repeat labels, subtotal top/bottom, blank rows, empty rows/columns, row/column/data captions, grand-total captions, no row fields, no column fields, no value fields, and no source data.
- Expansion matrix: raw node keys and structural keys produce identical row projection, column projection, Show Values As hierarchy, drill-down, and item extraction.
- Show Values As matrix: all transform variants over flat and hierarchical pivots, multi-value pivots, disabled grand totals, missing base fields/items, calculated measures, subtotals, collapsed groups, non-numeric values, and division by zero.
- Production stored-pivot paths: `pivot_compute_from_source`, `pivot_get_all_items`, `materialize_pivot`, `pivot_register_def`, and pure bridge compute for representative pivot configs.
- Boundary validation: flat DTO conversion, non-finite timestamps, duplicate field IDs, invalid source ranges, unknown fields, ambiguous duplicate value references, invalid grouping, invalid filter operands, invalid Show Values As configs, and unsupported future enum variants.

Performance verification:

- Any performance work must measure the production path: `compute_with_show_values_as_resolved()` through `compute-relational` plus presenter projection and, when relevant, `CellMirror::materialize_pivot()`.
- Do not optimize direct test helpers, synthetic-only benchmark adapters, or mock layout paths as the primary outcome.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Adding `CountUnique` to relational aggregation affects subtotal and grand-total algebra. It is not safely composable from child counts unless the unique sets are available, so exact raw-row or set-accumulator logic is required.
- Populating `value_records` can increase result size significantly. The implementation should use compact tuple construction and a deliberate provenance policy rather than silently omitting records.
- Stable placement identity may expose existing legacy configs that reference value fields only by `field_id`. The correct behavior is to accept unambiguous legacy references and reject ambiguous ones with actionable validation errors.
- Empty item semantics require a clear item universe. If the current source data does not expose all pivot cache items, the implementation must surface that missing input explicitly rather than inventing incomplete UI-only placeholders.
- Changing collapsed column behavior from `Null` padding to parent aggregates can affect existing tests that encoded the current bug. Update those tests to the production contract.
- Calculated-field alias resolution can be subtle when source field names, display names, field IDs, and placement IDs overlap. Tests must define first-wins or explicit-priority behavior.
- Show Values As transforms mutate display values. If raw values are needed for records, drill-down, or downstream calculations, preserve raw aggregate metadata or compute transforms from an immutable raw snapshot.
- `rendered_bounds` changes can break materialization and GETPIVOTDATA if row/column slots are off by one. Add explicit geometry tests before changing projection code broadly.
- Public DTO changes can require coordinated bridge, SDK, kernel, and app updates.

Non-goals:

- Do not implement a second pivot engine in the spreadsheet UI or compute-core materializer.
- Do not keep wrong aggregate mappings for compatibility.
- Do not patch only `CountUnique` and leave the rest of the aggregate/layout contract implicit.
- Do not make `compute-pivot` depend on private or internal repos.
- Do not bypass `ResolvedPivotConfig` by adding runtime fallback behavior in presenter or Show Values As code.
- Do not optimize benchmark-only or test-only code paths as the primary performance improvement.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable once the measure-slot and layout contracts are written.

- Agent A: build the contract matrix and validation tests for resolved configs, measure slots, aggregate mapping, unsupported variants, and ambiguous duplicate value references.
- Agent B: implement relational aggregate support for `CountUnique`, non-algebraic subtotal/grand-total handling, and aggregate matrix tests in `compute-relational` and `compute-stats`.
- Agent C: implement the resolved measure plan, calculated-field alias resolver, measure descriptors, and value records in `compute-pivot`.
- Agent D: rewrite presenter projection for compact/outline/tabular layout, rendered bounds, captions, subtotal placement, empty rows/columns, and collapsed column aggregates.
- Agent E: update Show Values As transforms to use measure slots and canonical expansion hierarchy, then add transform matrix tests.
- Agent F: update compute-core bridge/storage/materialization/GETPIVOTDATA paths and production stored-pivot fixtures.
- Agent G: update TypeScript/kernel/app consumers and generated bridge/type metadata if public result DTOs or bridge signatures change.

Dependencies:

- `mog/compute/core/crates/compute-relational` owns the delegated relational execution pipeline for grouping, aggregation, sorting, filters, calculated measures, subtotals, and grand totals.
- `mog/compute/core/crates/compute-stats` owns canonical aggregate and value equality/key semantics.
- `mog/domain-types/src/domain/pivot` and `mog/compute/core/crates/types/pivot-types` own public pivot DTOs, placement IDs, value sources, layout options, and Show Values As contracts.
- `mog/compute/core/src/bridge_pure.rs`, `mog/compute/core/src/storage/engine/objects/pivots.rs`, and `mog/compute/core/src/mirror/write/pivot_materialization.rs` consume compute-pivot production results.
- `mog/kernel/src/bridges`, `mog/apps/spreadsheet/src/components/pivot`, and SDK/runtime generated surfaces consume transported `PivotTableResult` and must stay aligned with DTO changes.
- `mog/file-io/xlsx/parser/src/domain/pivot` may need follow-up only when OOXML pivot conversion emits ambiguous aggregation, placement, expansion, or cache item semantics that the corrected compute contract now rejects.
