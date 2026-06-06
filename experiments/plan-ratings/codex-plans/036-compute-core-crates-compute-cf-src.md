# Improve `compute-cf` Conditional Formatting Evaluation and Rule Coverage

## Source folder and scope

Source folder: `mog/compute/core/crates/compute-cf/src`

Scope: the public Rust conditional-formatting computation crate that converts flat CF wire rules into typed internal rules, evaluates style and visual conditional-formatting rules, computes range statistics, merges rule results by priority, and serializes per-cell CF results for the compute bridge/render path.

Adjacent production-path dependencies that must be included in the implementation work:

- `mog/compute/core/src/scheduler/cf_eval.rs`, which resolves rule ranges, computes per-rule statistics, evaluates formula rules per target cell, and calls `compute_cf::evaluator::CascadeEvaluator`.
- `mog/compute/core/src/storage/engine/cf_cache.rs` and `mog/compute/core/src/storage/engine/delegations/compute_sheets_named.rs`, which convert stored or bridge-supplied rules before evaluation.
- `mog/contracts/src/data/conditional-format.ts`, `mog/kernel/src/bridges/compute/types.ts`, generated bridge types, and compute-wire render conversion, because those types define the production API and rendering contract that `compute-cf` results must satisfy.

Non-scope: changing spreadsheet UI behavior, adding compatibility shims around bad rule input, replacing the formula engine, or optimizing benchmark-only/test-only paths.

## Current role of this folder in Mog

`compute-cf` is a pure conditional-formatting rule engine: callers provide cell values, typed rules, per-rule range statistics, pre-evaluated formula results, and a calendar date; the crate returns `CFMatchResult`/`CellCFResult` data with style, color scale, data bar, and icon output. It has no storage dependency and is re-exported by compute core as `compute_core::cf`.

The folder is organized into:

- `types/`: `CFRuleWire` deserialization, `CfValue` typed operands, validation, conversion into `CFRuleKind`, and output result structs.
- `rules/`: predicate evaluators for cell value, formula truthiness, top/bottom, above average, duplicate/unique, text, blanks/errors, and time periods.
- `visual/`: color-scale interpolation, data-bar sizing/axis output, and icon-set bucket selection.
- `stats.rs`: numeric/text/bool statistics and duplicate-frequency maps used by top/bottom, above-average, visual rules, and duplicate rules.
- `priority.rs` and `evaluator.rs`: result merging, category-specific stop-if-true behavior, and dispatch across all rule kinds.
- `presets.rs`: preset data bars, color scales, and icon-set names used by the bridge.

Existing tests are already broad and colocated, including module-level tests, conversion tests, visual tests, evaluator cascade tests, and scheduler formula tests in compute core. The next improvement should turn that coverage into explicit production contracts and close drift between Rust, TypeScript bridge declarations, public API types, and render output.

## Improvement objectives

1. Make the CF rule contract exhaustive and generated where possible: every public/domain rule type, bridge wire shape, Rust `CFRuleKind`, evaluator dispatch arm, preset, and render result field should be tied to one source of truth or a contract test.
2. Eliminate silent invalid-rule behavior in the production path. Invalid bridge/domain rules should produce observable diagnostics or a typed error path instead of disappearing via `filter_map(...ok())`.
3. Strengthen formula-rule correctness on the production scheduler path: parsing, relative-reference shifting, `has_formula` blank semantics, invalid formula behavior, formula error truthiness, and stop-if-true short-circuiting should all have contract tests.
4. Preserve Excel-shaped semantics while making edge cases explicit: numeric coercion, text matching, blanks/errors, duplicate cross-type matching, date periods, top/bottom ties, above-average standard deviations, percentile behavior, color interpolation, data bars, and icon thresholds.
5. Keep `compute-cf` pure. Storage, clock, formula evaluation, and range materialization stay in compute core; `compute-cf` receives already-resolved inputs and remains deterministic.
6. Align render output with the binary viewport path so `CellCFResult` fields, compute-wire render extras, and TypeScript cache types cannot drift.

## Production-path contracts and invariants to preserve or strengthen

- `compute-cf` must not depend on `mog-internal`, kernel, app, storage, Yrs, or UI packages.
- `CFRuleWire -> CFRule` is the validation boundary. After conversion, invalid field combinations should be impossible in evaluator code.
- Rule priority is ascending: lower priority number is evaluated first and wins conflicting style/visual properties.
- Style rules and visual rules have independent `stop_if_true` categories. A style stop must not block data bars, color scales, or icon sets; a visual stop must not block style rules.
- Style results merge per field, with higher-priority matched rules winning each field. Visual result categories are exclusive independently: first matching data bar wins data bar, first matching color scale wins color scale, first matching icon wins icon.
- Statistics are per rule over all resolved ranges for that rule. `evaluate_rules` remains only a same-stats convenience; compute core must continue using per-rule stats.
- Formula evaluation is a scheduler responsibility. `compute-cf` only consumes a formula result and applies Excel truthiness.
- Formula references shift relative to the first range origin for each target cell, and formula rules skipped by stop-if-true must not be evaluated.
- Formula cells are not blank for blanks/not-blanks rules even when the displayed formula result is empty.
- Numeric visual rules accept numeric values and booleans (`TRUE = 1`, `FALSE = 0`) but not text/errors/nulls unless a documented production contract says otherwise.
- `RangeStatistics` excludes non-numeric values from numeric stats while preserving text/bool/numeric-text frequencies needed for duplicate detection.
- Date-period rules use an injected/current calendar date from compute core and evaluate inclusive ranges with Excel serial-date conversion.
- Data-bar output must keep fill percent, axis position, sign, colors, borders, direction, gradient, and show-value flags in the units expected by JSON bridge and binary viewport conversion.
- Icon-set output must keep set name and icon index consistent with `CFIconSetName::SERDE_NAMES` and generated wire constants.

## Concrete implementation plan

### 1. Establish a rule contract matrix

Create a machine-checkable matrix in `compute-cf` tests that enumerates every `CFRuleType` accepted by the public/domain layer and asserts:

- the expected `CFRuleWire` fields;
- the resulting `CFRuleKind` variant;
- whether a style is required/ignored;
- default values for omitted optional fields;
- validation errors for missing required fields;
- evaluator dispatch behavior for a representative matching and non-matching cell.

This should cover not only canonical public rule types (`cellValue`, `formula`, `colorScale`, `dataBar`, `iconSet`, `top10`, `aboveAverage`, `duplicateValues`, `containsText`, `containsBlanks`, `containsErrors`, `timePeriod`) but also OOXML/import aliases currently accepted in Rust bridge enums (`notContainsText`, `beginsWith`, `endsWith`, `notContainsBlanks`, `notContainsErrors`).

### 2. Replace silent invalid-rule drops with diagnostics

Change bridge/delegation conversion sites that currently do `filter_map(|w| CFRule::try_from(w).ok())` into a production contract that preserves failure information.

Implementation direction:

- Introduce a typed conversion result for CF evaluation requests, e.g. valid rules plus validation diagnostics keyed by source rule index/id when available.
- In storage-cache conversion, expose enough diagnostics for logs/telemetry and developer-visible test assertions without blocking evaluation of other valid rules.
- In direct bridge evaluation, return a typed error or diagnostics-bearing response if the API contract can be changed; if the bridge must continue returning `CellCFResult[]`, add a parallel diagnostics channel/event rather than silently dropping.
- Add tests proving invalid color, missing operands, invalid icon thresholds, bad data-bar lengths, and invalid formulas are visible and do not corrupt valid rules.

This should not be a compatibility shim. The production contract should make malformed conditional formats observable while still evaluating well-formed rules deterministically.

### 3. Unify and generate bridge operand/value contracts

Rust `CFRuleWire` now accepts typed `CfValue`, but handwritten TypeScript bridge declarations still describe several operands as `string`/`string[]`. Align the boundary so the TypeScript bridge, generated bridge types, Rust serde shape, and public API cannot drift.

Implementation direction:

- Make `CfValue` the explicit bridge operand schema for cell-value values and color/icon/data-bar thresholds.
- Generate or contract-test the TypeScript declarations for `CFRuleWire`, `CFColorPointWire`, `CFIconThresholdWire`, custom icons, `matchPositiveFillColor`, and `matchPositiveBorderColor`.
- Add serde roundtrip tests for scalar and tagged `CfValue` forms: number, text, bool, formula, null, numeric string, non-numeric string, arrays/objects lowered from JSON, and NaN display behavior.
- Add public API to bridge conversion tests so `CFColorPoint.value?: number | string`, `CFIconThreshold.gte`, `customIcon`, data-bar ext fields, and domain aliases convert into the exact Rust wire shape.

### 4. Strengthen evaluator and cascade contracts

Expand evaluator-level tests into table-driven coverage over the complete cross-product that matters:

- each rule category matching and non-matching;
- style-only, visual-only, and mixed style/visual results;
- independent stop-if-true for style vs visual categories;
- higher-priority field-by-field style merging;
- separate exclusivity for data bar, color scale, and icon results;
- empty-style matching rules and `CFMatchResult::has_any()` behavior;
- unsorted rules in debug builds and compute-core sorting in production;
- formula rules skipped before formula evaluation when a higher-priority stop applies.

If any contract is currently only documented in comments, turn it into a test.

### 5. Close rule-semantic edge cases systematically

Audit and test each rule module as a full category, not as individual bug fixes:

- `cell_value`: numeric/text/bool/control coercion, mixed-type equality, string case folding, epsilon equality, between/not-between threshold ordering, negative zero, empty strings, errors, arrays/images, and non-finite guard behavior.
- `text`: all operators, empty search strings, non-text cells, errors, Unicode case folding, numbers/bools via display coercion, and not-contains semantics on blanks.
- `blanks_errors`: null, empty text, formula cells returning empty text, errors, arrays/images, and not-blank/not-error variants.
- `time_period`: all 16 periods around week/month/quarter/year boundaries, leap years, Excel serial 60 behavior, invalid serials, fractional serials if they can reach this layer, and timezone/current-date injection through compute core.
- `top_bottom`: ranks 0/1/N/>N, percent 0/1/50/100/>100, ties at thresholds, duplicate values, empty stats, and negative values.
- `above_average`: above/below, equal-average, std-dev offsets, sample standard deviation, empty and single-value ranges, negative and high-magnitude values.
- `duplicate`: number/text cross-type duplicates, plain-number vs scientific notation text, case-insensitive text, booleans isolated from numeric/text namespaces, blank/error exclusion, negative zero, and merged disjoint-range frequencies.
- `formula`: truthiness for bool/number/text/null/error, evaluation errors from scheduler, relative references, absolute references, sheet-qualified references, and volatile/current-time behavior if formulas can depend on it.

Use table-driven tests and property tests where useful, but keep production semantics in the real evaluator path.

### 6. Harden visual rule algorithms and output contracts

Turn visual behavior into contract tests against known expected outputs:

- Color scales: 2- and 3-color interpolation, alpha preservation, min/mid/max equality, midpoint outside min/max, percent vs percentile vs number vs formula points, clamping, identical values, booleans, and empty stats.
- Data bars: all-positive, all-negative, mixed-sign, zero-at-axis, axis automatic/midpoint/none, min/max length clamps, direction, show value, gradient, border/negative border, match-positive flags, and malformed min/max ranges.
- Icon sets: all 3/4/5 icon sets, threshold count validation, greater-than vs greater-than-or-equal, reverse order, show-icon-only inversion, custom icon overrides, percent vs percentile vs number thresholds, NoIcons/Custom sentinel behavior, and bounds for custom icon indexes.
- Render conversion: verify `CellCFResult -> compute-wire` keeps units consistent (`fill_percent` 0..100 in JSON result, converted to 0..1 render data), preserves icon set name indexes, and does not drop visual fields.

### 7. Improve range-statistics production contracts

Keep `RangeStatistics` as the single stats abstraction but harden its contracts:

- Add invariants for `count`, `min`, `max`, `sum`, `mean`, `std_dev`, sorted values, and all frequency maps after `compute_range_stats` and `merge`.
- Add proptests comparing `RangeStatistics::merge(per_range)` against `compute_range_stats(concatenated_values)` for numeric stats and all duplicate-detection maps.
- Add percentile tests for empty, singleton, boundary, fractional, clamped, repeated, negative, and large-magnitude values.
- Add tests for large sparse ranges through compute-core `eval_cf`, proving the optimized dense-column path and normal path produce identical CF results.

### 8. Add production scheduler integration coverage

In compute core, add integration tests that exercise the actual `ComputeCore::eval_cf` path rather than direct evaluator shortcuts:

- multiple rules with different ranges and different statistics;
- overlapping ranges with priority sorting;
- formula rules with relative/absolute refs over multi-cell ranges;
- formula errors and parse failures;
- large sparse full-sheet ranges;
- rule ranges outside sheet bounds;
- formulas and blank detection on cells with formulas returning empty strings;
- CF cache refresh from stored domain conditional formats.

These tests should use real mirror/storage setup and real formula evaluation where the production path uses them.

### 9. Add contract fixtures for import/export and public API parity

Use small XLSX/domain fixtures or existing OOXML parser fixtures to validate that imported conditional formats evaluate the same way as API-created conditional formats:

- canonical style rules;
- color scales with two and three points;
- data bars with negative colors/borders and axis settings;
- icon sets including custom icons and reverse order;
- OOXML alias rules (`notContainsText`, `beginsWith`, etc.);
- date-period rules;
- formula rules with relative references.

The assertion should compare the final `CellCFResult`/render cache output, not just parsed rule shapes.

## Tests and verification gates

Required gates for an implementation touching this area:

- `cargo test -p compute-cf`
- `cargo clippy -p compute-cf`
- Targeted compute-core tests for the production scheduler/cache path, including `scheduler::cf_formula_tests` and any new `cf_eval`/`cf_cache` integration tests.
- `cargo test -p compute-core` or the smallest package/test filter that includes the actual `ComputeCore::eval_cf` and CF cache path changed by the work.
- TypeScript bridge/type contract gate after TS declaration or generated type changes, including the relevant `pnpm typecheck` and bridge codegen/readiness check used by this repo for generated compute bridge types.
- If render conversion changes, run the viewport/render binary serialization tests that consume CF extras.
- If public API/domain conversion changes, run the relevant kernel conditional-format API tests and public contract tests.

Do not rely on `compute-cf` unit tests alone when changing scheduler, storage-cache, generated bridge, or render output behavior.

## Risks, edge cases, and non-goals

Risks:

- Changing silent invalid-rule drops into diagnostics may require bridge/API contract changes and coordinated updates in kernel/app callers.
- Tightening operand types can expose drift in handwritten TypeScript types, generated bridge output, and public API conversion.
- Excel semantics are nuanced for mixed-type comparisons, blanks produced by formulas, date serials, top/bottom ties, and data-bar/icon thresholds; tests should encode the intended Mog contract when Excel behavior is ambiguous.
- Large-range evaluation has production performance risk. Any change must verify the sparse fast path and normal path agree before optimizing further.
- Formula rules are split between compute-core scheduler and `compute-cf`; moving formula evaluation into `compute-cf` would introduce the wrong dependency direction.

Edge cases to keep explicit:

- Empty ranges, ranges fully outside sheet bounds, and full-sheet ranges.
- Empty stats for visual rules and top/bottom/above-average rules.
- Multiple disjoint ranges per rule with merged stats.
- Rules with no style or empty style.
- Duplicate detection for numeric-looking text vs scientific notation.
- Negative zero, large finite numbers, and unavailable non-finite values.
- Icon-set sentinel names (`NoIcons`, `Custom`) and custom icon indexes.
- Time-period rules around Sunday week starts, leap days, month/quarter/year boundaries, and user-timezone-driven current dates.

Non-goals:

- No UI-only feature work.
- No test-only benchmark optimization.
- No fallback evaluator that diverges from `ComputeCore::eval_cf`.
- No dependency from public `mog` code to `mog-internal`.
- No compatibility layer that hides malformed conditional-format rules without diagnostics.

## Parallelization notes and dependencies on other folders, if any

This work parallelizes cleanly if contracts are agreed up front:

- Worker A: `compute-cf/src/types` contract matrix, `CfValue` serde, validation diagnostics, and Rust conversion tests.
- Worker B: `compute-cf/src/rules` predicate semantic coverage across all rule kinds.
- Worker C: `compute-cf/src/visual`, `stats`, and `priority/evaluator` edge cases and property tests.
- Worker D: `compute/core/src/scheduler/cf_eval.rs` and `storage/engine/cf_cache.rs` production integration tests for ranges, formulas, large sparse ranges, and diagnostics propagation.
- Worker E: TypeScript/public contract alignment across `contracts/src/data/conditional-format.ts`, `kernel/src/bridges/compute/types.ts`, generated compute bridge types, and compute-wire render conversion.
- Worker F: Import/export fixture parity for OOXML/domain conditional formats.

Dependencies:

- The diagnostics shape from Worker A must be settled before Worker D and Worker E wire it through production callers.
- The bridge operand schema from Worker E must agree with `CfValue` before adding long-lived fixtures.
- Visual/render unit conventions must be documented before Worker C and Worker E update render assertions.
- Scheduler integration tests should land after the evaluator contracts they depend on, so failures identify production-path wiring rather than unstable rule semantics.
