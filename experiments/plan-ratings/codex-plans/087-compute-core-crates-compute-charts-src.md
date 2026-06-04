# Plan 087: Compute Charts Native Transform Improvements

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/crates/compute-charts/src`

Queue item: 87

Scope this plan covers:

- The `compute-charts` Rust crate source under `src`, including chart transform serde types, the transform dispatcher, filter, aggregate, bin, sort, calculate, fold, regression, density, grouping, stacking, histogram/bin utilities, per-series chart statistic config helpers, public re-exports, and crate-local tests.
- Production behavior exposed through `compute_core::bridge_pure::ChartBridge` as `chart_apply_transforms`, `chart_compute_regression`, `chart_compute_density`, `chart_compute_bins`, `chart_compute_stacking`, and `chart_compute_statistics`.
- The chart compiler path that invokes these native transforms from `mog/kernel/src/domain/charts/bridge/chart-compiler.ts` before the TypeScript grammar compiler.
- The generated bridge types consumed by `kernel/src/bridges/compute/*`, `compute/api/src/pure/chart.rs`, `compute/wasm`, `compute/napi`, and `compute/pyo3` where this crate's DTOs cross package boundaries.
- Adjacent public chart code only where the correct production contract crosses a boundary: `mog/charts/src/grammar/spec.ts`, `mog/charts/src/grammar/transforms/*`, `mog/charts/src/algebra/stack.ts`, `mog/charts/src/core/config-to-spec/transforms.ts`, chart compiler tests, bridge generation, and `compute-stats` regression/KDE/statistics helpers.

Out of scope for the first implementation slice:

- Replacing the chart grammar compiler, DOM renderer, OOXML exporter, or chart config/data extraction pipeline.
- Moving workbook range resolution, hidden-dimension handling, chart cache invalidation, or theme/style resolution into `compute-charts`.
- Optimizing synthetic benchmark harnesses or test-only transform helpers before the production bridge path is correct.
- Keeping the current TypeScript fallback as a way to mask native transform bugs.
- Introducing dependencies from `compute-charts` to `mog-internal`, kernel UI code, or private-only packages.

## Current role of this folder in Mog

`compute-charts/src` is the native Rust implementation of chart data transform and chart-statistic logic. It sits below `compute-core` and above `compute-stats`, and is intended to provide the high-performance WASM-backed alternative for chart transform work while `@mog/charts` remains the pure TypeScript grammar/rendering package.

Current production flow:

- `charts/src/core/config-to-spec/*` and chart builders emit `ChartSpec` objects with inline `data.values` and `transform` arrays.
- `kernel/src/domain/charts/bridge/chart-compiler.ts` calls `chart_apply_transforms(localData, spec.transform)` when native chart WASM exports are available, removes the transform from the spec, and then lets the TypeScript grammar compile the transformed inline rows.
- `compute/core/src/bridge_pure.rs` forwards `chart_apply_transforms` to `compute_charts::transforms::apply_transforms`.
- `compute-charts/src/transforms/mod.rs` clones the input rows, applies transforms sequentially, and dispatches to module-local implementations for filter, aggregate, bin, sort, calculate, fold, regression, and density.
- `stacking.rs`, `grouping.rs`, and `transforms/bin/*` also expose native helper functions used or intended for chart algebra, histogram, and statistical chart computation.
- `types.rs` defines the Rust serde shape for the transform discriminated union and bridge DTOs such as `DataRow`, `StackInput`, `StackOutput`, `HistogramBin`, `DensityResult`, `PerSeriesBinConfig`, and `PerSeriesBoxwhiskerConfig`.

Important observed gaps:

- The crate defines `ChartError`, including `TransformFailed` and `InvalidBin`, but the production `chart_apply_transforms` path returns only `Vec<DataRow>`. Invalid transform parameters, parse failures, and unsupported semantics cannot currently become structured chart errors.
- The kernel falls back to the original TypeScript transform path only when the injected WASM function throws. The Rust implementation usually returns a row vector even for questionable inputs, so wrong native results can look successful.
- The Rust transform schema, `charts/src/grammar/spec.ts`, `charts/src/grammar/transforms/*`, and generated bridge type stubs are not a single canonical contract. For example, Rust exposes a wider aggregate operation set than the visible TS grammar `AggregateSpec`, while the generated bridge stubs have partial chart transform aliases.
- Regression field semantics are fragile across languages. The TS grammar treats `regression` as the dependent y field and `on` as the x field, while Rust comments label the Rust fields the other way around and the dispatcher binds them as `x_field` and `y_field`.
- Native regression output cardinality differs from TS grammar behavior: Rust delegates to `compute-stats` default options that currently produce 50 points in tests, while TS transform tests expect 100 generated regression points.
- The expression evaluators in native `filter` and `calculate` are hand-rolled and not validated through a parsed AST. They support overlapping but different subsets from the TS grammar path, and invalid expressions can include too much or too little data depending on implementation path.
- Aggregate grouping keys are stringified with delimiters or JSON text. This can collide across JSON values, blur missing vs `null` vs string values such as `"null"` or `"undefined"`, and reorder groups through `BTreeMap` rather than preserving the first-seen order used by chart grammar transforms.
- `Distinct` uses `serde_json::Value::to_string()` as identity, which is not an explicit chart value identity contract and can diverge from TS strict equality or intended spreadsheet/chart display semantics.
- Numeric extraction currently accepts only JSON numbers. This is defensible if the chart compiler normalizes every numeric datum before the bridge, but that invariant is not stated or tested at the native boundary.
- Bin and histogram helpers ignore some imported chart configuration. `resolve_bin_params` exposes `cumulative`, but `histogram_with_series_config` discards it and returns plain bins. `PerSeriesBoxwhiskerConfig` resolves options, but the native crate does not own a full box/whisker statistic contract.
- Stacking exists both in `compute-charts/src/stacking.rs` and `charts/src/algebra/stack.ts`; they are similar but not verified by shared parity fixtures through the bridge.
- Current tests are broad at the module level, but they are mostly local Rust unit tests or TS-side mocked WASM tests. They do not prove the complete production path from `configToSpec` through native transforms, bridge serialization, fallback/error behavior, grammar compile, and mark generation.

## Improvement objectives

1. Make native chart transforms a typed production contract.
   Define one canonical transform schema across Rust serde types, TypeScript grammar types, generated bridge types, kernel compiler inputs, and OOXML/export metadata.

2. Replace silent transform behavior with structured outcomes.
   Native transform execution should distinguish successful transformed data, deliberately unsupported native transforms, invalid transform specs, numeric-domain errors, expression-parse errors, and bridge serialization errors.

3. Make `compute-charts` the authoritative production transform path for charts that opt into native transforms.
   The TypeScript transform implementation may remain as a pure package fallback/standalone library, but production chart compilation should not rely on TS fallback to hide native semantic drift.

4. Align Rust and TypeScript transform semantics systematically.
   Cover filter, aggregate, bin, sort, calculate, fold, regression, density, grouping, histogram, and stacking through shared fixtures and precise contracts instead of per-function local assumptions.

5. Strengthen value identity and row-shape semantics.
   Preserve row order where the chart grammar depends on it, make group keys collision-safe, distinguish missing/null/string values intentionally, and ensure output fields never accidentally overwrite required source fields without a documented rule.

6. Make expression evaluation explicit and safe.
   Replace ad hoc filter/calculate parsing with a small checked expression AST whose supported syntax is documented, deterministic, and shared by transform validation and execution.

7. Make native statistical transforms match chart expectations.
   Regression, density, bins, histograms, stacking, box/whisker config helpers, and per-series chart statistics should have chart-facing defaults that match `@mog/charts` and imported Excel chart behavior where applicable.

8. Preserve clean crate boundaries.
   Keep `compute-charts` pure, stateless, and dependent only on appropriate public compute crates such as `compute-stats`; do not move renderer or workbook concerns into it.

9. Verify the actual production path.
   Add tests that exercise generated bridge DTOs and kernel chart compilation with real transform specs, not only direct Rust helpers or mocked WASM functions.

## Production-path contracts and invariants to preserve or strengthen

- `compute-charts` remains a public Rust compute crate with no dependency on `mog-internal`, UI packages, renderer packages, or kernel document state.
- `DataRow` remains the bridge representation for inline chart data rows, but its value semantics must be explicit: JSON number, string, bool, null, array, object, and missing field each have defined comparison, truthiness, grouping, sorting, and aggregate behavior.
- Transform order remains sequential. Each transform consumes the full output of the previous transform, and root/layer inherited data behavior remains owned by the kernel chart compiler.
- Native transform execution must be deterministic for identical input rows and transform specs.
- Successful native execution must remove the transform from the `ChartSpec` only after the transformed data has been computed and accepted as valid.
- Invalid specs should not silently return unchanged data, empty data, or partially transformed rows unless that is the documented semantic for the specific transform.
- A missing field is not automatically equivalent to JSON `null` unless the transform contract says so. Grouping, filtering, sorting, folding, and calculated expressions need explicit missing/null rules.
- Stringified group keys must not collide across distinct JSON values. Composite grouping should preserve first-seen group order unless a later sort transform deliberately reorders rows.
- Sorting must define stable behavior for equal keys, mixed types, nulls, missing fields, booleans, strings, numbers, arrays, and objects. Null placement must stay consistent with chart grammar and user-facing chart ordering.
- Aggregate `count`, numeric aggregates, `distinct`, `values`, confidence intervals, quartiles, and variance/stdev must use one documented numeric filtering and null handling policy.
- `Distinct` must use an explicit canonical value identity, not accidental display or debug stringification.
- `Values` must preserve source row order inside each group.
- Binning must produce deterministic inclusive/exclusive boundaries, clamp the upper endpoint, handle all-equal values, negative ranges, non-finite values, explicit steps, nice boundaries, and excessive `maxbins` without unbounded memory.
- Per-series bin configuration must preserve precedence: series-level settings override chart-level settings. If cumulative or normalized outputs are exposed, the returned DTO must represent them instead of discarding them.
- Regression transform fields must match the canonical TS grammar contract: `regression` is the dependent y field and `on` is the independent x field, unless the public schema is deliberately changed everywhere.
- Regression defaults must be chart-facing defaults, including method, polynomial order, output point count, domain extent, and output field names.
- Density/KDE must reject or normalize invalid `bandwidth`, `extent`, and `steps` values deterministically. It must not emit NaN or infinity across bridge boundaries.
- Stacking must preserve input order, category/group identity, sign handling, normalized totals, center offset behavior, and non-finite sanitation consistently with chart algebra.
- Native helper APIs exposed through `compute/api`, WASM, N-API, and PyO3 must not expose stale or partial DTO contracts.
- Bridge-generated TypeScript names must avoid collisions such as chart sort order vs unrelated sort order enums, and transform variants must remain discriminated by `type`.
- Kernel chart compiler errors should be surfaced as `ChartError` diagnostics when native transform failure is a chart-data problem, and only use fallback when native support is deliberately unavailable or the caller opts into fallback.
- Tests for native transform behavior must drive the production bridge/compiler path where possible, not only isolated helper functions.

## Concrete implementation plan

1. Write the native chart transform contract inventory.
   Add a source-level contract document or test matrix in the public repo covering transform variants, row value semantics, expression syntax, grouping key identity, sort ordering, aggregate semantics, binning, regression, density, stacking, histogram, per-series config precedence, bridge outcomes, and fallback/error policy. Use it as the checklist for the rest of the work.

2. Create one canonical transform schema.
   Reconcile `compute-charts/src/types.rs`, `charts/src/grammar/spec.ts`, `charts/src/grammar/transforms/*`, generated bridge type stubs, and chart-builder emitted transforms. Decide the canonical aggregate operation set, regression metadata fields, density options, bin options, sort order literals, and optional fields. Update Rust serde annotations and TS types so both sides represent the same discriminated union.

3. Fix regression field semantics first.
   Rename internal Rust variables and comments so `regression` means y/dependent field and `on` means x/independent field. Add direct Rust tests, TS grammar parity tests, and kernel compiler tests for trendline output over scatter data. Lock output field defaults and point count to the chart contract rather than `compute-stats` incidental defaults.

4. Introduce checked transform execution.
   Add `apply_transforms_checked(data, transforms) -> Result<Vec<DataRow>, ChartError>` and `apply_transform_checked(...)`. Use this checked API from `ChartBridge`. Replace current silent invalid behavior with structured errors for invalid bin steps, invalid `maxbins`, invalid density extent, invalid steps, expression parse failures, missing required aggregate fields, invalid regression domain, and unsupported transform variants.

5. Update bridge and kernel result handling.
   Change `chart_apply_transforms` to return either a typed `ChartTransformResult`/`Result` bridge shape or an error that the transport can surface predictably. Update `chart-compiler.ts` so native transform errors become chart compile diagnostics or explicit native-unavailable fallback based on a documented policy. Keep the compiler path ID meaningful: successful native transforms should report `wasm-transforms+ts-grammar`; TS fallback should be reserved for deliberate fallback.

6. Replace ad hoc expression parsing with a small AST.
   Build a `chart_expr` module for filter and calculate expressions. Supported syntax should include field references (`datum.field`, `datum["field"]`, and documented bare identifiers), string/number/bool/null literals, arithmetic, comparison, logical operators, negation, parentheses, and string concatenation if it remains part of the contract. Parse once per transform, validate field references where possible, then evaluate per row. Remove split-by-operator parsing that can mis-handle nesting, quoted text, unary signs, or unsupported syntax.

7. Define row value ordering and identity helpers.
   Add shared helpers for numeric extraction, truthiness, string conversion, JSON value equality, canonical key encoding, and chart sort ordering. Use these helpers in filter, aggregate, grouping, sort, fold, and stacking input conversion. Avoid `Value::to_string()` as a semantic identity except when the contract explicitly wants JSON text identity.

8. Make grouping collision-safe and first-seen ordered.
   Replace aggregate `BTreeMap<String, Vec<&DataRow>>` grouping with an ordered group accumulator keyed by a canonical `ChartValueKey` or serialized tuple that cannot collide with delimiter text. Preserve first-seen group order to match the chart grammar path unless the transform spec includes a sort.

9. Harden aggregate semantics.
   Implement a complete aggregate matrix for `count`, `sum`, `mean`, `average`, `median`, `min`, `max`, `variance`, `stdev`, `q1`, `q3`, `ci0`, `ci1`, `distinct`, and `values`. Decide whether the TS grammar should expose the full set or Rust should narrow to the canonical set. Validate missing `field` for field-dependent operations. Define behavior for empty groups, all-non-numeric values, text values, booleans, nulls, missing fields, arrays, objects, and non-finite numbers.

10. Align bin and histogram outputs with chart config.
    Make bin config validation explicit and add a native output contract for cumulative and normalized histogram data if chart configs need them. `histogram_with_series_config` should either return a richer enum/DTO carrying cumulative and density values or be renamed so it does not imply cumulative support. Cover underflow/overflow-related imported chart settings if they are intended for native computation; otherwise state they are renderer/export-only outside this crate.

11. Normalize density and violin behavior.
    Validate `bandwidth > 0`, `steps >= 2` where required, finite extents, and `extent[0] <= extent[1]`. Ensure single-value, constant, empty, and all-invalid data produce documented rows and never emit non-finite bridge values. Decide whether violin shape helpers remain public chart-native helpers or move behind a fuller box/violin statistic contract.

12. Make stacking parity explicit.
    Keep `compute_stack` pure, but add parity fixtures against `charts/src/algebra/stack.ts` for no-stack, zero, normalize, center, mixed signs, duplicate categories, missing fields, string/number category identity, non-finite values, and input order. If native stacking is to be production-authoritative, route chart consumers through the bridge instead of leaving two unverified implementations.

13. Reconcile TypeScript fallback and standalone transforms.
    Keep `charts/src/grammar/transforms/*` as the standalone pure library implementation only if it is backed by shared fixtures against Rust. Remove behavior differences such as TS returning unchanged data for unknown transforms while Rust cannot deserialize them, TS expression fallback including unparsable rows, regression point count differences, and different missing-field fold behavior.

14. Strengthen generated bridge DTOs.
    Regenerate bridge artifacts after schema changes and review `kernel/src/bridges/compute/types.ts`, `compute-types.gen.ts`, `compute-bridge.gen.ts`, and wire types for correct transform discriminants, enum names, optional fields, tuple fields, and `usize` bridge limitations. Replace hand-maintained incomplete stubs with generated or explicitly synchronized chart transform types where possible.

15. Add production chart compiler fixtures.
    Add kernel chart compiler tests that initialize real WASM exports or the closest generated bridge adapter, compile representative chart configs, and assert transformed inline data, compiler path ID, emitted chart errors, and final marks. Cover root transforms, layered inherited data, trendline transforms, data-label/error-bar filter layers, combo member filters, annotation filters, waterfall calculate transforms, and native failure handling.

16. Add Rust integration tests around `ChartBridge`.
    Test `compute_core::bridge_pure::ChartBridge` calls directly for JSON-like input rows and transform specs so bridge-facing behavior is covered separately from private module helpers. Include serde round-trip tests for every transform variant and generated bridge-sensitive DTO such as `ChartSortOrder`, `StackMode`, `HistogramBin`, `DensityResult`, and per-series configs.

17. Add shared parity fixtures.
    Store compact public fixtures for transform specs and expected rows that can be executed by Rust `compute-charts` tests and TS `@mog/charts` tests. Include numeric edge cases, mixed JSON value cases, expression syntax, aggregate/grouping collisions, regression, density, bins, and stacking. The goal is not to keep two independent implementations by hope; it is to make drift immediately visible.

18. Audit chart-statistic ownership.
    Decide which chart-statistic helpers belong in `compute-charts` versus `compute-stats` versus `@mog/charts` renderer marks. Regression/KDE math can remain in `compute-stats`; chart-specific row shaping, output field naming, per-series config precedence, and bridge-safe DTOs belong in `compute-charts`. Move duplicated math only when it strengthens the production path.

19. Add bounded performance checks on the production path.
    After correctness is locked down, measure `chart_apply_transforms` through the WASM/bridge path over realistic chart-sized inline data and common transform chains. Optimize row cloning, expression parsing, grouping allocation, and large histogram/regression operations only on this production path.

20. Document native transform support status.
    Add public crate docs and TS bridge docs that identify which transforms are native-authoritative, which are TS-standalone only, which metadata is ignored by compute and used only by export, and which invalid inputs become chart errors. This prevents future chart family work from adding transform metadata that silently disappears at the native boundary.

## Tests and verification gates

Required Rust gates for implementation in this folder:

- `cargo test -p compute-charts`
- `cargo clippy -p compute-charts`

Additional Rust gates when adjacent crates or bridge paths change:

- `cargo test -p compute-core` and `cargo clippy -p compute-core` for `ChartBridge`, generated pure bridge signatures, transport-facing DTOs, or bridge error shape changes.
- `cargo test -p compute-stats` and `cargo clippy -p compute-stats` for regression, KDE, quantile, confidence interval, or histogram/statistic helper changes.
- `cargo test -p compute-api` and `cargo clippy -p compute-api` if public pure chart wrapper signatures change.
- Binding-specific checks for `compute/wasm`, `compute/napi`, and `compute/pyo3` when generated bridge types, skipped functions, or chart DTOs change.

TypeScript and chart gates when public chart or kernel paths change:

- Regenerate bridge artifacts for compute bridge surfaces and review `kernel/src/bridges/compute/*`.
- Focused `@mog/charts` tests for grammar transform parity and chart config-to-spec emitted transform schemas.
- Focused kernel chart compiler tests for `chart_apply_transforms`, fallback/error behavior, layered inherited data, compiler path IDs, and final marks.
- `pnpm typecheck` for TypeScript declaration, generated bridge, chart package, kernel, app, or SDK changes.

Contract tests to add:

- Transform schema matrix: every transform variant deserializes/serializes from Rust and TypeScript, including optional/default fields and generated bridge aliases.
- Filter matrix: equality, `oneOf`, range, all numeric comparisons, missing/null/string/boolean/object values, logical operators, parentheses, negation, bracket field access, invalid expressions, and mixed type comparisons.
- Calculate matrix: field references, constants, arithmetic precedence, unary signs, parentheses, string concatenation, division by zero, missing fields, non-finite results, and output field overwrite behavior.
- Aggregate matrix: every aggregate op over empty inputs, all-invalid numeric inputs, mixed numeric/text/null rows, duplicate JSON values, object/array values for `distinct`, multi-field grouping, missing group fields, and sequential aggregate specs.
- Group key matrix: values such as `null`, missing, `"null"`, `"undefined"`, numbers vs numeric strings, booleans, arrays, objects, delimiter-containing strings, and duplicate composite tuples.
- Sort matrix: ascending/descending, stable equal keys, null/missing placement, numbers, strings, booleans, arrays, objects, mixed types, multiple sort keys, and non-finite boundary values.
- Bin/histogram matrix: empty data, no numeric data, all equal values, negative ranges, explicit step, invalid step, large `maxbins`, nice vs non-nice boundaries, upper-bound clamping, cumulative bins, normalized density bins, and per-series override precedence.
- Regression matrix: `regression` y field and `on` x field, all supported methods, polynomial order, invalid domains for log/pow/exp, insufficient points, non-numeric rows, output point count, output fields, and equation/R2 metadata pass-through if retained.
- Density/KDE matrix: bandwidth defaults, invalid bandwidth, extent validation, constant data, single value, empty data, non-numeric rows, step count, no non-finite outputs, and violin/statistical chart helpers.
- Stacking matrix: no stack, zero, normalize, center, positive/negative separation, zero totals, duplicate categories, category identity, group identity, input order, and non-finite values.
- Production compiler matrix: scatter trendline, waterfall calculate, data-label filters, error-bar filters, combo member filters, annotation filters, root plus child transforms, WASM unavailable, native invalid transform, and native success with transformed inline data.
- Bridge matrix: generated TS client calls, compute API pure wrappers, WASM skipped `usize` functions, N-API/PyO3 exposure, and serialized error/result shape.

Performance verification:

- Measure only the production path: `configToSpec` emitted transforms through `chart_apply_transforms`, bridge serialization, and subsequent TS grammar compilation.
- Track row clone/allocation behavior for large inline data and multi-step transform chains.
- Parse filter/calculate expressions once per transform, not once per row.
- Do not optimize standalone TS transform tests, mocked WASM tests, or synthetic helper-only benchmarks as the primary outcome.

Verification for this planning worker:

- This worker must not run the implementation gates above; they are listed for the future implementation plan.
- This worker only writes the requested Markdown plan file and verifies that no other file was changed by this run.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Changing `chart_apply_transforms` from `Vec<DataRow>` to a structured result can require bridge regeneration and coordinated kernel compiler updates. That is the correct production fix if native transform errors need to be observable.
- Regression field semantics are currently easy to invert. The implementation must fix comments, variable names, tests, TS builders, and fixtures together so future agents cannot reintroduce the mismatch.
- Grouping key changes can alter chart row order for aggregate transforms. The plan should preserve first-seen order unless the product contract explicitly wants sorted groups.
- Replacing stringified value identity can change `distinct` counts for numbers vs strings, null vs missing, arrays, and objects. Tests must make those changes deliberate.
- A stricter expression parser will convert some previously accepted or silently ignored expressions into errors. That is preferable to silently wrong chart data, but kernel error rendering and diagnostics must be ready.
- Some transform metadata exists for export or imported chart fidelity, not native data computation. The implementation must classify those fields explicitly instead of dropping them by accident.
- WASM, N-API, and PyO3 have different type constraints, including `usize` limitations already noted in bridge attributes. DTO changes must keep bindings coherent.
- Shared Rust/TS parity fixtures can expose existing TypeScript transform bugs. Fix the contract systematically rather than matching a wrong fallback behavior.
- Large `DataRow` clones can be expensive. Correctness should land first, followed by production-path allocation reductions that keep row ownership and bridge safety clear.
- If native transform errors are surfaced as chart errors, existing tests that expected TS fallback on any native failure will need to be updated to distinguish native unavailable from invalid chart data.

Non-goals:

- Do not implement a second chart renderer inside `compute-charts`.
- Do not move chart config extraction, workbook range resolution, style/theme resolution, or mark generation into this crate.
- Do not keep TS fallback as the correctness mechanism for native transform bugs.
- Do not narrow scope to one observed transform mismatch while leaving the transform schema and bridge contract implicit.
- Do not add compatibility shims for known wrong semantics such as inverted regression fields, silent invalid expressions, or discarded cumulative bin config.
- Do not add private/internal dependencies or leak internal planning content into the public repo.
- Do not optimize benchmark-only paths before the real chart compiler/bridge path is correct.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the canonical transform schema and error-result contract are written.

- Agent A: own the transform schema inventory across `compute-charts/src/types.rs`, `charts/src/grammar/spec.ts`, generated bridge types, and chart-builder emitted transforms.
- Agent B: implement checked Rust transform execution, `ChartError` expansion, bridge result shape, and Rust `ChartBridge` tests.
- Agent C: replace filter/calculate expression parsing with a checked AST and add expression matrix tests.
- Agent D: own aggregate, grouping, sort, and row value identity semantics, including collision-safe keys and first-seen ordering.
- Agent E: own bin, histogram, density, violin/statistical helpers, and per-series config precedence.
- Agent F: own regression semantics and compute-stats integration, including point count/defaults and method-specific invalid domains.
- Agent G: own stacking parity and native-vs-TS algebra fixtures.
- Agent H: update kernel chart compiler behavior, chart compile diagnostics, compiler path IDs, and production chart compiler tests.
- Agent I: regenerate and review bridge artifacts for WASM/N-API/PyO3/API wrappers and run the binding-specific gates.

Dependencies on other folders:

- `mog/compute/core/src/bridge_pure.rs` for production bridge signatures and error/result transport.
- `mog/compute/core/crates/compute-stats/src` for regression, KDE, quantile, and statistics math.
- `mog/charts/src/grammar/spec.ts` and `mog/charts/src/grammar/transforms/*` for the TS standalone transform schema and parity implementation.
- `mog/charts/src/core/config-to-spec/transforms.ts` and chart-family layer builders for emitted transform specs.
- `mog/charts/src/algebra/stack.ts` for stacking parity.
- `mog/kernel/src/domain/charts/bridge/chart-compiler.ts` for native transform invocation, fallback policy, and chart compile diagnostics.
- `mog/kernel/src/bridges/compute/*` and compute binding crates for generated bridge DTOs and client APIs.
