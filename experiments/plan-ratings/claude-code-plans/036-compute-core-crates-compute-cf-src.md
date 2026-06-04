# 036 — Improve `mog/compute/core/crates/compute-cf/src` (conditional-formatting evaluation & rule coverage)

## Source folder and scope

- **Folder:** `mog/compute/core/crates/compute-cf/src`
- **Crate:** `compute-cf` (`version 0.1.0`, `publish = false`) — "Conditional formatting visual rule engine — predicates, visual encoding, cascade".
- **Role:** a pure-computation Rust crate that maps `(cell value, rule, range statistics, pre-evaluated formula result, now)` → visual properties (style, color-scale color, data-bar fill, icon). No storage dependency; the caller (the scheduler) supplies all inputs.
- **Files in scope (production source, excluding `*_tests.rs` / `*_tests/` modules):**
  - `lib.rs` — crate root; declares `evaluator`, `presets`, `priority`, `stats`, `types` (pub) and `rules`, `visual` (`pub(crate)`).
  - `evaluator.rs` (~330 lines) — `evaluate_rule`, `evaluate_rule_for_cell`, `CascadeEvaluator`, `evaluate_rules`, `coerce_to_visual_number`.
  - `priority.rs` — `merge_styles`, `merge_results` (per-field style merge; exclusive visual winner).
  - `stats.rs` — `RangeStatistics`, `compute_range_stats`, `RangeStatistics::merge`, `percentile`, `compute_mean_stddev`, `canonical_bits`, `parse_plain_number`.
  - `presets.rs` — 8 data-bar + 10 color-scale + 20 icon-set presets via `LazyLock`.
  - `rules/` — `cell_value`, `formula`, `top_bottom`, `above_average`, `duplicate`, `text`, `blanks_errors`, `time_period`.
  - `visual/` — `color_scale`, `data_bar`, `icon_set`.
  - `types/` — `wire` (IPC `Deserialize`), `convert` (`TryFrom<CFRuleWire>` + `CFRuleValidationError`), `rule` (`CFRule`/`CFRuleKind` + `CfRenderStyle`), `enums`, `value` (`CfValue`), `result` (`CFMatchResult`/`CellCFResult`).
- **Out of scope (named only for coupling, not edit targets):**
  - `mog/compute/core/src/scheduler/cf_eval.rs` — the sole production consumer of the evaluation entry points; supplies per-rule `RangeStatistics`, shifts and evaluates CF formula ASTs per cell, and drives `CascadeEvaluator::apply_for_cell`.
  - `mog/compute/core/src/storage/engine/cf_cache*` — converts domain CF rules into `CFRuleWire`/`CFRule`.
  - `domain-types::domain::conditional_format` — canonical home of `CFOperator`, `CFRuleType`, `CFTextOperator`, `DatePeriod` (re-exported by `types/enums.rs`).
  - `ooxml-types`, `compute-parser` (`FormulaSource`), `value-types` (`CellValue`, `Color`, `date_serial`), `cell-types` (`RangePos`).

## Current role of this folder in Mog

`compute-cf` is the **conditional-formatting decision engine**. Everything that decides *whether* a CF rule matches a cell and *what visual* it produces lives here; nothing about *which cells to evaluate*, *where the values come from*, or *how to evaluate CF formulas* does. That separation is deliberate and load-bearing:

1. **Predicate layer (`rules/`)** — one matcher per OOXML rule family. Each takes a `&CellValue` (+ stats / threshold) and returns `bool`.
2. **Visual layer (`visual/`)** — color-scale interpolation, data-bar sizing/axis, icon-index selection. Each takes a coerced `f64` + `RangeStatistics`.
3. **Cascade (`priority.rs` + `CascadeEvaluator`)** — priority-ordered merge with per-category (style vs. visual) stop-if-true semantics, matching the ported TypeScript `evaluateRules`/`mergeResults`.
4. **Type boundary (`types/`)** — a flat `Deserialize` wire struct (`CFRuleWire`) is validated once via `TryFrom` into a type-safe `CFRuleKind` enum that makes invalid states unrepresentable (e.g. a `ColorScale` rule cannot carry a cell-value threshold).
5. **Statistics (`stats.rs`)** — single-pass numeric stats + sorted values (percentiles) + four frequency maps (numeric, text, bool, numeric-text) for duplicate/unique detection with Excel-style cross-type coercion.

The production path is: scheduler computes per-rule `RangeStatistics` (merging across disjoint ranges), pre-evaluates the rule-level CF formula per target cell (shifting the AST relative to the rule origin), then calls `CascadeEvaluator::apply_for_cell(value, rule, stats, formula_result, now, has_formula)` per applicable rule in priority order, and stamps `row/col` onto the resulting `CFMatchResult`.

Rule-family coverage is **already complete** against the domain `CFRuleType` enum: every variant (`CellValue`, `Formula`/`expression`, `ColorScale`, `DataBar`, `IconSet`, `Top10`, `AboveAverage`, `DuplicateValues`, `ContainsText`, `NotContainsText`, `BeginsWith`, `EndsWith`, `ContainsBlanks`, `NotContainsBlanks`, `ContainsErrors`, `NotContainsErrors`, `TimePeriod`) maps to a `CFRuleKind` arm and a matcher. The crate is also heavily unit-tested (`stats_tests.rs` ~31 KB, `priority_tests.rs` ~18 KB, plus `evaluator_tests/`, `types_tests/`, per-rule `*_tests.rs`). So this plan is about **fidelity gaps inside otherwise-covered families, an API-shape footgun, and stats cost** — not about adding missing rule types or reducing scope.

## Evidence (observed in the current tree)

- **Formula-typed CF value objects (`cfvo`) silently resolve to `0.0`.** `types/convert.rs::parse_point_value` handles `CFValueType::Formula` as `Ok(value.as_ref().and_then(CfValue::as_number))` — and `CfValue::as_number` returns `None` for the `Formula` variant (`types/value.rs:139`). So a color-scale / data-bar / icon-set point whose `type="formula"` stores `value: None`. Then `visual/color_scale.rs::resolve_color_point_value` and `visual/icon_set.rs::resolve_icon_threshold_value` both map `CFValueType::Formula => point.value.unwrap_or(0.0)`. Net effect: **any formula-based threshold inside a visual rule degrades to a constant `0.0`**, which silently mis-renders the gradient/bar/icon. The scheduler (`cf_eval.rs`) only evaluates the *rule-level* `CFRuleKind::Formula`; it has no path to evaluate per-point `cfvo` formulas, and the crate has no hook to receive their results. This is a real, unflagged Excel-fidelity gap (Excel permits formula `cfvo` on all three visual rule kinds).
- **The simple public entry points silently use `has_formula = false`.** `evaluate_rule`, `CascadeEvaluator::apply`, and `evaluate_rules` all delegate to the `*_for_cell` form hard-coding `has_formula = false` (`evaluator.rs:51`, `:226`, `:319`). `ContainsBlanks` depends on this bit: `rules/blanks_errors.rs::evaluate_blanks_for_cell` returns `!blanks` for formula cells (a formula cell is never "blank", even when its result is `""`). The production scheduler correctly calls `apply_for_cell` with the real `has_formula`, but the three "convenience" functions remain `pub` and will give wrong `ContainsBlanks` results on formula cells. `evaluate_rules` additionally carries a documented correctness caveat ("only correct when all rules share the same range") because it takes a single `RangeStatistics`. These are latent footguns on the public surface, not just dead code.
- **`evaluate_rules` is unused in production and diverges from the real cascade.** No production caller exists (the scheduler uses `CascadeEvaluator::apply_for_cell` directly). The function exists only for tests/convenience yet is `pub`, encodes the single-stats limitation, and drops `has_formula`. A `pub` API that is wrong in two ways and unused in production is a maintenance hazard.
- **Two different text→number coercion policies, by design but undocumented as a contract.** `rules/cell_value.rs::to_number` coerces `Text("1") → 1.0` (so numeric-looking text participates in cell-value comparisons), while `evaluator.rs::coerce_to_visual_number` returns `None` for all `Text` (visual rules ignore text). Both are plausibly Excel-correct, but the divergence is implicit and only discoverable by reading both files; there is no shared, asserted statement of the rule.
- **`is_truthy` treats all `Text` as falsy.** `rules/formula.rs::is_truthy` maps `Text(_) => false` unconditionally, including `Text("1")`. Comment claims Excel parity; this is a known sharp edge worth a golden-file lock rather than a code comment.
- **`CfRenderStyle` merge is hand-written across 17 fields.** `priority.rs::merge_styles` lists all 17 optional fields with `higher.x.or(lower.x)`. Adding a CF style property (a recurring event — per-side borders and `number_format` were clearly added over time) requires editing this function, `CfRenderStyle`, and the merge by hand; a missed field silently drops a CF style override on merge. No compile-time guarantee couples the struct to the merge.
- **`RangeStatistics` is clone- and allocation-heavy, recomputed per evaluation.** It carries `sorted_values: Vec<f64>` plus four `FxHashMap`s. `RangeStatistics::merge` (used by the scheduler for multi-range rules) concatenates and **re-sorts** all values (`O(N log N)`) and rebuilds all four maps every call; `len() == 1` still `clone()`s the whole struct. For large CF ranges this is the dominant cost and there is no caching keyed by range revision (caching itself is a scheduler concern, but the crate's merge/build cost is in-scope).
- **Icon-set `Percent` vs `Percentile` resolution is subtle and only prose-documented.** `visual/icon_set.rs::resolve_icon_threshold_value` compares the cell's *percent-of-range position* against a raw `Percent` threshold, but resolves a `Percentile` threshold to a data value and converts it back to a percent-of-range position. The `Number` type compares the raw cell value instead (`cell_metric` branch). This is intricate enough to warrant golden-file coverage against Excel rather than relying on the inline comment.
- **Malformed icon sets fail closed to "no icon" silently.** `visual/icon_set.rs::compute_icon` returns `None` when `thresholds.len() > 10` or when the threshold count disagrees with the set's `icon_count()`. The `TryFrom` boundary already rejects count mismatches (`IconSetThresholdCountMismatch`), so the in-`compute_icon` re-check is defensive but unreachable from the validated path — duplicated invariant with no single source of truth.

## Improvement objectives

1. **Close the formula-`cfvo` fidelity gap (highest value).** Give the crate a typed way to consume pre-evaluated per-point formula results so that `type="formula"` thresholds on color scales, data bars, and icon sets resolve to their evaluated value instead of `0.0`. The crate stays pure (the scheduler still does the evaluating); the crate gains the input channel and the resolution logic.
2. **Remove the public footguns.** Make the `has_formula`-carrying form the *only* way to evaluate, so `ContainsBlanks` cannot be silently wrong; eliminate or repair the single-stats `evaluate_rules`.
3. **Make implicit Excel-fidelity contracts explicit and golden-locked.** Text-coercion policy split (cell-value vs. visual), `is_truthy` text handling, and icon `Percent`/`Percentile` semantics each get a documented invariant plus a golden test.
4. **Couple `CfRenderStyle` to its merge at compile time.** A new style field must not be droppable on merge by omission.
5. **Reduce `RangeStatistics` build/merge cost** without changing results (numerically identical mean/std-dev, identical percentile/duplicate outcomes).
6. **Collapse the duplicated icon-count invariant to one source of truth.**

All objectives are production-path: each tightens a contract every CF render compiles against, or fixes a value that ships to the renderer. None reduce scope, add shims, or are test-only (tests are the verification gate, not the fix).

## Production-path contracts and invariants to preserve or strengthen

- **Purity.** `compute-cf` must remain free of any storage / Yrs / scheduler dependency. New formula-`cfvo` support takes *already-evaluated* values as input; it must not pull in `compute-core` or an evaluator.
- **Type-state safety of `CFRuleKind`.** Invalid combinations must stay unrepresentable. The `TryFrom<CFRuleWire>` boundary remains the single validation chokepoint; new fields validate there, not in matchers.
- **Cascade semantics.** Per-category (style vs. visual) stop-if-true, priority ordering (lower = higher = first, `debug_assert`ed sorted), per-field style merge, and exclusive visual winner (`data_bar`/`color_scale`/`icon` first-writer-wins) must be byte-for-byte preserved. `CFMatchResult` → `CellCFResult` row/col stamping unchanged.
- **Serde wire shapes.** `CFRuleWire`, `CfValue` (tagged form *and* bare-scalar shorthand), and all output `Serialize` shapes (`camelCase`, `skip_serializing_if = "Option::is_none"`) are IPC contracts shared with TypeScript/NAPI/WASM/pyo3 bindings. `CfValue`'s dual deserialization and round-trip proptest must keep passing.
- **`CFIconSetName::SERDE_NAMES` / `icon_count()`** stay the single source for codegen (`compute-wire` emits `ICON_SET_NAMES`); the existing length-equals-variant-count test must hold.
- **Excel numeric semantics.** `float_eq` epsilon comparison, NaN/Infinity exclusion from stats, sample std-dev (`n-1`), `PERCENTILE.INC`, Lotus-1900 leap-year date handling, and boolean→number coercion (TRUE=1/FALSE=0) are all observable behavior and must not drift.

## Concrete implementation plan

Ordered so each step is independently reviewable and lands behind passing tests.

### Step 1 — Formula-`cfvo` resolution channel (objective 1)
- In `types/rule.rs`, keep `CFColorPoint`/`CFIconThreshold` carrying their `CFValueType`, but stop conflating `Formula` with `Number` at resolution time. Add an explicit, evaluated operand path: extend the per-point representation so a `Formula`-typed point can hold an evaluated `Option<f64>` supplied by the caller (e.g. an `evaluated: Option<f64>` resolved value, distinct from the stored literal `value`).
- Add an evaluation-input parameter to the visual entry points (`compute_color_scale`, `compute_data_bar`, `compute_icon`) — a small typed struct mapping each `Formula` point/threshold to its pre-evaluated `f64` — and thread it from `evaluate_rule_for_cell`'s visual arms. Default/empty input preserves today's behavior for non-formula points.
- Update `resolve_color_point_value` and `resolve_icon_threshold_value`: `CFValueType::Formula` now reads the evaluated value when present, falling back to `0.0` only when genuinely absent (and `log`/debug-assert the absence so it stops being silent).
- In `types/convert.rs`, stop treating `Formula` `cfvo` as "numeric coercion, tolerate failure": preserve the formula `CfValue` (so the scheduler can later evaluate it) rather than discarding it to `None`. The `CfValue::Formula { source }` already carries the source; expose it on `CFColorPoint`/`CFIconThreshold` for the scheduler to evaluate.
- **Cross-folder dependency:** the scheduler (`cf_eval.rs`) must evaluate these point formulas (same AST-shift mechanism it already uses for rule-level formulas) and pass results in. That scheduler change is a *separate folder's* edit, tracked as a dependency (see Parallelization). This plan delivers the crate-side contract and the pure resolution; without the scheduler half, behavior is unchanged (still `0.0`), so the two land together but are reviewed independently.

### Step 2 — Make `has_formula` non-optional (objective 2)
- Fold `has_formula` into the canonical signatures: rename `evaluate_rule_for_cell` → `evaluate_rule` (single entry) taking `has_formula`, and `apply_for_cell` → `apply` taking `has_formula`. Remove the `false`-defaulting wrappers.
- Either delete `evaluate_rules` (no production caller) or, if retained for ergonomics, change it to require a `has_formula` slice parallel to `formula_results`, and document the single-stats limitation as a `debug_assert` that all rules share one range (or accept `&[RangeStatistics]`). Prefer deletion + a thin test helper to avoid shipping a knowingly-limited `pub` API.
- Update the in-crate tests and the scheduler call site to the new names (mechanical; scheduler already passes the real `has_formula`).

### Step 3 — Lock the implicit fidelity contracts (objective 3)
- Add a documented module-level invariant block stating the two text-coercion policies (cell-value coerces numeric text; visual rules ignore text) and reference it from both `coerce_to_visual_number` and `cell_value::to_number`.
- Add golden tests (driven by representative `CellValue`/rule fixtures) for: numeric-text in visual vs. cell-value rules; `is_truthy` on `Text("1")`/`Text("TRUE")`/empty; icon `Percent` vs `Percentile` vs `Number` selection across a known range. These lock current behavior so any future change is a conscious, reviewed diff. (Verification artifact, supporting the production contract — not a substitute for a code fix.)

### Step 4 — Compile-time-couple `CfRenderStyle` to its merge (objective 4)
- Replace the hand-written 17-field `merge_styles` with a declarative macro (or a derive-style helper) that enumerates the fields once, so adding a field to `CfRenderStyle` forces the merge to include it (a missing field becomes a compile error, not a silent drop). Keep "higher wins per field" semantics identical; the existing `priority_tests.rs` is the regression gate.

### Step 5 — Reduce `RangeStatistics` cost (objective 5)
- In `RangeStatistics::merge`, avoid the full re-sort: each input's `sorted_values` is already ascending, so use a k-way merge instead of concatenate-then-`sort_unstable`. Recompute mean/std-dev via the existing Welford pass over the merged stream (numerically identical). Avoid cloning frequency maps when merging into the largest input.
- Consider building `numeric_text_frequency` lazily (only the duplicate/unique matcher reads it) to skip the parse pass when no duplicate rule is present — gated so results are unchanged.
- Keep `compute_range_stats` single-pass; document the `O(n log n)` sort as the percentile prerequisite.

### Step 6 — One source of truth for icon counts (objective 6)
- Since `TryFrom` already enforces threshold-count-vs-`icon_count()`, demote the duplicated check in `compute_icon` to a single `debug_assert!` (validated invariant) and keep exactly one defensive `None` for the `> 10` upper bound, documenting that `compute_icon` trusts the validated `CFIconSet`.

## Tests and verification gates

- **Unit/regression (in-crate `*_tests`):** all existing tests must pass unchanged after Steps 2, 4, 5, 6 (these are behavior-preserving). `priority_tests.rs` gates the `merge_styles` macro; `stats_tests.rs` gates the `merge` rewrite (assert identical `min/max/sum/mean/std_dev/percentile/duplicate` outcomes vs. the old path on fixed fixtures, including all-non-numeric and single-range fast paths).
- **New golden tests (Step 1, 3):** formula-`cfvo` color/bar/icon resolution with a supplied evaluated value vs. the absent-fallback; the fidelity-contract goldens from Step 3.
- **Serde round-trip:** `CfValue` proptest and `wire_deser*` tests must still pass; add a case proving a `Formula` `cfvo` survives `CFRuleWire → CFRule` conversion without being flattened to `0.0`.
- **Cross-folder integration:** after the paired scheduler change, an `app-eval` / engine-level CF scenario with a formula-based color-scale/icon threshold renders the evaluated gradient/icon (not the `0.0` fallback). See `[[api-eval-usage]]` / `[[app-eval-usage]]` for harness mechanics.
- **Verification commands (run by a human/CI, not by this planning task):** `cargo test -p compute-cf`, `cargo clippy -p compute-cf`, and the compute-core scheduler tests; the `compute-wire` codegen test for `ICON_SET_NAMES`. Per task constraints, no build/test commands are run while authoring this plan.

## Risks, edge cases, and non-goals

- **Risk: signature changes ripple to bindings.** Renaming/removing `pub fn evaluate_rule(s)` touches NAPI/WASM/pyo3/`compute-wire` only if they reference these symbols directly — grep shows the scheduler is the consumer; confirm no binding re-exports the convenience functions before deletion. Keep the change additive where a public symbol is externally referenced.
- **Risk: formula-`cfvo` partial landing.** Until the scheduler evaluates point formulas, the crate-side change must be a no-op for existing inputs (empty evaluation map ⇒ identical output). Gate with a test asserting byte-identical results when no formula points are present.
- **Edge cases to preserve:** `min == max` collapse (color scale → min color; data bar/icon → 50% / middle); non-finite guards (color scale → min color, data bar → 0 fill, icon → worst/`reverse`-flipped); all-negative / mixed-sign data-bar axis math; `value_is_at_axis` zero-bar special case; `-0.0` and canonical-NaN frequency keys; Lotus-1900 leap-year; Sunday-based week boundaries.
- **Non-goals:** adding new CF rule *families* (coverage is already complete vs. the domain enum); changing cascade priority or stop-if-true semantics; moving formula evaluation into this crate (would violate purity); CF *caching/invalidation* strategy (a scheduler/`cf_cache` concern); locale-aware week start or alternate date systems.

## Parallelization notes and dependencies on other folders

- **Independent, can land alone:** Steps 2 (signature consolidation), 4 (style-merge macro), 5 (stats merge), 6 (icon invariant), and the Step 3 goldens — all self-contained in `compute-cf` with existing tests as the gate.
- **Paired cross-folder dependency (Step 1):** the formula-`cfvo` fix needs a matching edit in `mog/compute/core/src/scheduler/cf_eval.rs` to evaluate per-point formulas (reusing `shift_ast_for_cf` + `Evaluator`) and to pass evaluated values into the visual entry points; and possibly in `cf_cache*/convert.rs` to carry the formula source through. Sequence: land the crate-side input channel (no-op default) first, then the scheduler producer; they merge together but review separately. This folder owns the *contract and the pure resolution*; the scheduler folder owns the *evaluation*.
- **Watch for shared types:** `domain-types` owns `CFOperator`/`CFRuleType`/`CFTextOperator`/`DatePeriod`; `value-types` owns `CellValue`/`Color`; `cell-types` owns `RangePos`. None need to change for this plan, but any `CfValue`/wire-shape adjustment in Step 1 must stay serde-compatible with the TS/NAPI/WASM/pyo3 bindings and the `compute-wire` codegen.
