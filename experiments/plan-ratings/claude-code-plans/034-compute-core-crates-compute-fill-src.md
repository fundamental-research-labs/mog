# Plan 034 — Correct autofill inference & series behavior (`mog/compute/core/crates/compute-fill/src`)

## Source folder and scope

- **Folder:** `mog/compute/core/crates/compute-fill/src` (Rust, `compute-fill` crate; ~3.4k LOC non-test source, ~3.7k LOC tests).
- **Primary files in scope:**
  - `engine.rs` (46 lines) — `compute_fill`, the single public entry point. Pure function: orchestrates lane planning, target enumeration, and per-cell emission into a `FillResult`. No mutation, no storage access.
  - `engine_policy.rs` (124 lines) — `FillPolicy::from_request` (value/formula/format inclusion per mode) and `determine_lane_pattern` / `determine_pattern` (maps `FillMode` → `FillPattern`, including the **LinearTrend/GrowthTrend → constant-step/constant-multiplier** mapping).
  - `engine_lanes.rs` (240 lines) — `build_lane_plans`: groups non-formula source cells into per-column/row "lanes", detects each lane's pattern, generates its series sized to the visible target count, and **tiles** patterns across target lanes wider than the source.
  - `engine_emitter.rs` (122 lines) — `emit_target`: maps each target cell back to a source cell, pulls the next series value (or copies/adjusts formulas), accumulates `FillUpdate`s and warnings.
  - `engine_targets.rs` (66 lines) — target-cell enumeration (direction-aware ordering, hidden-row/col skip, source-range exclusion, non-origin merged-cell skip) and the merged-cells-in-target warning.
  - `types.rs` (301 lines) — the pure data contracts: `FillRequest`, `FillInput`, `SourceCell`, `FillResult`, `FillUpdate`, `FillPattern`/`FillPatternType`, `FillWarning`/`FillWarningKind`, `FillMode`, `FillDirection`, `LocaleNames`, `CustomList`.
  - `patterns/` (`mod.rs` + `numeric.rs`, `date_time.rs`, `locale.rs`, `cyclic.rs`, `text_numeric.rs`, `values.rs`) — `detect_fill_pattern`: priority-ordered detector chain (date → time → weekday → month → quarter → custom list → ordinal → text+number → linear → growth → copy).
  - `series/` (`mod.rs` + `common.rs`, `numeric.rs`, `date.rs`, `cyclic.rs`, `textual.rs`) — `generate_series_values`: per-pattern value generation, with anchor extraction (`common::anchor_number` / `anchor_text`) and `num_or_error` finite-guarding.
  - `formula_adjust.rs` + `formula_adjust/` (`coords.rs`, `shapes.rs`) — relative/absolute/mixed ref shifting with grid-bound (`MAX_ROWS`/`MAX_COLS`) clamping and `out_of_bounds` flagging.
  - `flash_fill.rs` (775 lines) — example-driven string-transformation synthesis (tokenize → infer program → apply), a separate public path from `compute_fill`.
  - `helpers.rs` (796 lines) — `map_target_to_source`, `count_visible_cells_on_lane`, merge predicates, etc.
  - `error.rs` (10 lines) — `FillError` stub; the crate is currently infallible.
- **Adjacent code touched only as dependency (read, not edited):**
  - `mog/compute/core/src/engine_types/fill.rs` — `BridgeAutoFillRequest`/`BridgeFlashFillRequest` wire types and the `to_fill_request` / mode/direction string parsing that feeds this crate across the IPC boundary.
  - `mog/compute/core/src/storage/engine/services/mutation_handlers/fill.rs` — the engine-side caller that gathers `SourceCell`s (resolving formula `ref_positions`), invokes `compute_fill`, and applies `FillUpdate`s to CRDT storage.
  - `value_types` (`CellValue`, `FiniteF64`, `CellError`, `date_serial::{add_months_to_serial, serial_to_ymd}`), `formula_types::IdentityFormula`, `domain_types::CellFormat`.

This is a **production-path** plan: it corrects observable wrong-value behavior and strengthens the inference contracts of the live autofill engine. It is not test-only, reduced-scope, or a shim.

## Current role of this folder in Mog

`compute-fill` is the pure inference core for spreadsheet autofill ("fill handle" drag, Fill → Series/Down/Right, Flash Fill). The engine caller pre-gathers every cell the operation can see — source values, formulas with resolved positional ref coordinates, formats, merges, hidden rows/cols, the active locale's day/month names, and any custom lists — packs them into a `FillInput`, and calls `compute_fill`. The crate detects the pattern in the source, generates the continuation series, adjusts formula references for their new positions, and returns a `FillResult` of position-keyed `FillUpdate`s plus warnings and the detected pattern. The caller is solely responsible for turning those updates into storage mutations; this crate never mutates or resolves `CellId`s.

The design is deliberately clean: one public function, a lane-based decomposition that lets each column (or row, for horizontal fills) detect and generate independently, and a tiling step that repeats source-lane patterns across wider targets. The detector chain and series generators are a careful port of the prior TypeScript implementation, with explicit priority ordering documented in `patterns/mod.rs`.

The improvement opportunities are **not** structural — the architecture is sound. They are concentrated in a small number of **inference-correctness defects** where the output diverges from spreadsheet-standard behavior, plus **silent-degradation** and **reporting-fidelity** gaps:

1. **LinearTrend / GrowthTrend ignore the source data entirely** (a real correctness defect).
2. **Backward fills (Up / Left) anchor numeric and date series on the wrong end of the source**, producing an off-by-one continuation — and a test currently enshrines the wrong values.
3. **`step_value`'s default (1.0) doubles as an "unset" sentinel**, making an explicit step of 1.0 indistinguishable from "auto-detect".
4. **`detected_pattern` reports only the first lane**, mis-describing heterogeneous multi-column fills.
5. **Non-finite series results (growth overflow, etc.) become `#VALUE!` cells with no warning.**

## Improvement objectives

1. **Make LinearTrend and GrowthTrend perform real least-squares regression over all source values.** Today `engine_policy::determine_pattern` (`engine_policy.rs:102-111`) maps `FillMode::LinearTrend` to `FillPattern { pattern_type: Linear, step: Some(1.0), .. }` and `FillMode::GrowthTrend` to `FillPattern { pattern_type: Growth, multiplier: Some(2.0), .. }` — **fixed constants that disregard the selected source cells**. The spreadsheet-standard behavior is: Linear Trend fits a least-squares line `y = a + b·x` through the source points (x = 1, 2, 3…) and extends it; Growth Trend fits an exponential `y = a·b^x` (least-squares on `ln y`) and extends that. With source `[2, 4, 6]`, Linear Trend must continue `8, 10, …` (slope 2), not `7, 8, …` (slope 1); with source `[3, 9, 27]`, Growth Trend must continue `81, 243, …` (ratio 3), not `54, 108, …` (ratio 2). This is the single highest-value fix in the folder. The existing tests `linear_trend_mode_forces_pattern` / `growth_trend_mode_forces_pattern` (`engine_tests.rs:572`, `:592`) only assert the *pattern type*, so they have masked the wrong magnitudes.

2. **Anchor backward (Up / Left) numeric and date series on the source end nearest the target.** `series::common::anchor_number` (`series/common.rs:12-22`) already takes a `direction_mult` and is built to return `last()` for forward fills and `first()` for backward fills — but every numeric/date caller passes the literal `1` (`series/numeric.rs:13,29,53`; `series/date.rs:15`), so backward fills always anchor on the *last* source value and then apply a negative step from there. The result is an off-by-one: for source `A5=3_000_010, A6=3_000_008` filled Up, the engine emits `A4=3_000_010` (a duplicate of `A5`) and `A3=3_000_012`, where the standard result is `A4=3_000_012, A3=3_000_014`. The `fill_up` test (`engine_tests.rs:475-506`) currently asserts the buggy values and must be corrected as part of the fix. Note the cyclic/textual generators already thread `direction_mult` into `anchor_text` correctly (`series/cyclic.rs:51,110`, `series/textual.rs:13,62`), so this is an inconsistency to close, not a new concept.

3. **Disambiguate "explicit step" from "auto-detect" without overloading 1.0.** `FillRequest.step_value` defaults to `1.0` (`types.rs:103-110`), and `determine_lane_pattern` treats `step_value != 1.0` as "user overrode the step" (`engine_policy.rs:63-65`). The doc comment claims "auto-detected from source when 0 or unset" but the code never checks `0`; it checks `!= 1.0`. Consequence: a user who has source `1, 3` (auto step 2) and explicitly types step `1` in the Series dialog gets step 2, because `1.0` is read as "unset". Make the override explicit — e.g. `step_value: Option<f64>` on `FillRequest` (with the bridge mapping absent/sentinel → `None`), so "auto-detect" and "explicit 1.0" are distinct. This is a wire-contract change coordinated with `engine_types/fill.rs`.

4. **Report a faithful aggregate pattern for heterogeneous multi-lane fills.** `LanePlans::detected_pattern` returns `self.plans.values().next()` (`engine_lanes.rs:22-28`) — the first lane only. A 3-column fill where column A is a date series and columns B–C are linear reports "Date" for the whole operation. Either compute a representative/aggregate descriptor (e.g. unanimous pattern, else a `Mixed` discriminant) or document that `detected_pattern` is explicitly the primary-lane pattern and is advisory. The downstream summary (`FillResultSummary.pattern_type`, `types.rs:296`) is what the UI shows, so the choice must be made deliberately, not left implicit.

5. **Surface non-finite series outcomes as warnings, not silent `#VALUE!`.** `series::common::num_or_error` (`series/common.rs:4-9`) converts any NaN/∞ result to `CellValue::Error(CellError::Value)`. Growth fills over a long target, or a degenerate detected step, can silently produce a column of `#VALUE!` cells with no `FillWarning`. Add a `FillWarningKind` (e.g. `SeriesValueOverflow { row, col }`) emitted when a generated value is non-finite, so the engine/UI can distinguish "the fill produced errors" from a genuine source error. This also makes the `error.rs` stub's "fully infallible" claim honest by routing degradation through warnings rather than opaque error cells.

6. **(Lower priority, evidence-gated) Audit Flash Fill robustness and tie-breaking.** `flash_fill.rs` synthesizes a single transformation program from examples; confirm its behavior on (a) conflicting examples, (b) multi-token / multi-segment extractions, and (c) Unicode (the tokenizer splits on `is_alphabetic` / `is_ascii_digit`, so non-ASCII digits and graphemes need a deliberate decision). Scope concretely after Phase 0; do not expand speculatively.

## Production-path contracts and invariants to preserve or strengthen

- **Purity.** `compute_fill` and all helpers stay pure: no mutation, no storage/`CellId` access, deterministic output for a given `FillInput`. All new regression math is pure arithmetic over `source_cells`.
- **Update ordering.** `EmissionState::sort_updates` (`engine_emitter.rs:23-30`) sorts `updates` by `(row, col)`. Downstream application relies on this; preserve it.
- **Source-range / hidden / merge exclusions.** Target enumeration must continue to skip cells inside the source range, hidden rows/cols, and non-origin merged cells (`engine_targets.rs:26-43`); and visible-cell counting for series length must stay consistent with what is actually emitted (`engine_lanes.rs:108-126`, `helpers::count_visible_cells_on_lane`). A regression that changes the *count* without changing the *anchor* (or vice versa) reintroduces the off-by-one.
- **Formula adjustment semantics.** Absolute refs unshifted, relative shifted by `(target − source)` delta, out-of-bounds clamped to original position and flagged (`formula_adjust.rs`). Untouched by this plan; guard with existing tests.
- **Empty / single-value behavior.** Empty `source_cells` → empty `FillResult` with `Copy` pattern (`engine.rs:16-23`). A single numeric cell repeats (does **not** start a series) unless the mode is explicitly Series/LinearTrend (`patterns/mod.rs:83-118`); preserve this exactly — it is a deliberate spreadsheet-fidelity choice.
- **Wire/serde stability.** `types.rs` and `engine_types/fill.rs` are an IPC contract. Any field change (objective 3, the `step_value` shape) must keep serde back-compatible (serde default / `Option`) so older bridge payloads still deserialize, and must be mirrored on the TS bridge side. New `FillWarningKind` variants are additive (tagged enum) and safe.
- **Pattern-detector priority.** The detector ordering in `patterns/mod.rs:60-81` is load-bearing (date before linear, growth last). Regression work in objective 1 lives in the *mode-forced* path (`determine_pattern`), not the auto-detect chain — keep them separate.

## Concrete implementation plan

**Phase 0 — Establish the reference behavior (no code change).**
- Build a behavior table for LinearTrend, GrowthTrend, and backward-fill numeric/date series against the spreadsheet-standard expected outputs (use the cases in objectives 1–2 plus negative-slope, single-source-value, and overflow cases). Capture expected magnitudes, not just pattern types.
- Confirm whether `step_value` is currently surfaced from the UI as an explicit user input and how the bridge passes "unset" (read `engine_types/fill.rs` + the TS caller). This decides the exact shape of objective 3's contract change.
- Confirm how the engine caller and UI consume `FillResult.warnings` and `detected_pattern` (read `mutation_handlers/fill.rs`) so objectives 4–5 land where they are actually observed.

**Phase 1 — Trend regression (objective 1, highest value).**
- Add a small pure regression helper (new private module under `series/`, e.g. `series/trend.rs`, or extend `series/numeric.rs`): `fit_linear(values: &[f64]) -> (intercept, slope)` via ordinary least squares over `x = 1..=n`, and `fit_growth(values: &[f64]) -> (a, b)` via least squares on `ln(y)` (require all `y > 0`; if any `y ≤ 0`, fall back to copy and emit no growth).
- Thread the fitted parameters into the `FillPattern`. Two viable shapes — pick one in Phase 0:
  - (a) Keep `FillPatternType::Linear`/`Growth` but compute `step`/`multiplier` from the regression *in `determine_pattern`* (it has `source_values` in `determine_lane_pattern`'s call path — `engine_policy.rs:53`), so the generators are unchanged; **or**
  - (b) Add `FillPatternType::{LinearTrend, GrowthTrend}` carrying `(intercept, slope)` / `(a, b)` and dedicated generators that evaluate `y(x)` at the projected x-index per target cell.
  - Prefer (b): linear *trend* over `[2, 5, 6]` is not a constant-step recurrence (the fitted line does not pass through the points), so reusing the recurrence-style `generate_linear` would be subtly wrong. A trend generator must evaluate the fitted function at each successive x, including the source positions' fitted values where the standard extends the line.
- Backward direction: x-indices extend below 1 (x = 0, −1, …) for Up/Left; the fitted function handles this naturally, which also sidesteps the anchor bug for the trend path.

**Phase 2 — Backward-fill anchoring (objective 2).**
- Change the numeric/date callers to pass `direction_mult` into `anchor_number` instead of the literal `1` (`series/numeric.rs:13,29,53`; `series/date.rs:15`). Re-derive the step application so that for backward fills the series extends *away* from the anchored (target-adjacent) end. Verify growth backward (`generate_growth` divides by multiplier when `direction_mult < 0`, `series/numeric.rs:36-40`) composes correctly with the corrected anchor.
- Correct the `fill_up` test (`engine_tests.rs:475-506`) to the standard expected values (`A4=3_000_012, A3=3_000_014`) and add a backward-fill date case.

**Phase 3 — `step_value` contract (objective 3).**
- Change `FillRequest.step_value: f64` → `Option<f64>` (or introduce an explicit `step_override: Option<f64>` alongside, if keeping the wire field is preferable), with serde defaulting to `None`. Update `determine_lane_pattern` (`engine_policy.rs:55-65`) to apply the override only when `Some`, dropping the `!= 1.0` heuristic. Mirror the change in `BridgeAutoFillRequest::to_fill_request` (`engine_types/fill.rs:92-113`) and the TS bridge (out-of-folder; flag as a cross-cut, see Parallelization).

**Phase 4 — Reporting fidelity (objectives 4–5).**
- `detected_pattern`: implement the chosen aggregate (unanimous-else-`Mixed`, or documented primary-lane). If adding a `Mixed` discriminant, extend `FillPatternType` (additive serde) and map it in `FillResultSummary`.
- Add `FillWarningKind::SeriesValueOverflow { row, col }` (or reuse a generic non-finite kind) and emit it from the emitter when a `next_value` resolves to `CellValue::Error` originating from `num_or_error`. Cleanest: have `generate_series_values` / `num_or_error` signal non-finite distinctly (e.g. return a typed marker) so the emitter can attach a warning at the correct `(row, col)` rather than inferring it.

**Phase 5 — Flash Fill (objective 6, only if Phase 0 surfaces real gaps).** Scope concretely after evidence; otherwise document current limitations in module docs and defer.

## Tests and verification gates

All new tests live in the crate's existing `#[cfg(test)]` modules (`engine_tests.rs`, `series/tests.rs`, `patterns/tests.rs`) — no production-path behavior is verified by test-only shims.

- **Trend regression (Phase 1):** LinearTrend over `[2,4,6]` → `8,10,12`; over `[1,2,4]` (non-collinear) → the *fitted-line* continuation, asserting exact least-squares values; negative slope; single source value (define and assert the degenerate behavior); GrowthTrend over `[3,9,27]` → `81,243`; GrowthTrend with a non-positive source value → documented fallback; backward-direction trend.
- **Backward anchoring (Phase 2):** corrected `fill_up`; fill-Up date series (Days/Months); fill-Left linear; assert no duplication of an existing source value at the target-adjacent cell.
- **`step_value` (Phase 3):** explicit step 1.0 over source `1,3` yields step 1 (not auto-detected 2); absent override preserves auto-detected step; serde round-trip of a payload with the field absent.
- **Reporting (Phase 4):** heterogeneous multi-lane fill → expected aggregate/`Mixed` pattern; long growth fill that overflows → `SeriesValueOverflow` warning emitted at the right `(row, col)` and `#VALUE!` still written.
- **Regression guard:** existing `engine_tests.rs`, `series/tests.rs`, `patterns/tests.rs`, `formula_adjust/tests.rs` must continue to pass except the deliberately-corrected `fill_up`.
- **Cross-boundary:** an `auto_fill` integration test in `compute/core/tests/auto_fill.rs` exercising LinearTrend/GrowthTrend end-to-end through the bridge to confirm magnitudes survive serde and application.
- **Verification gates** (run by the implementer, not in this planning task): `cargo test -p compute-fill`, `cargo test -p compute-core auto_fill`, `cargo clippy -p compute-fill`, and the bridge type-generation test (`infra/rust-bridge/bridge-ts/tests/generate_compute_bridge.rs`) for any `types.rs` change.

## Risks, edge cases, and non-goals

- **Wire-contract breakage (objective 3).** Changing `step_value`'s shape risks desyncing the Rust/TS bridge. Mitigate with serde defaults and a coordinated TS change; gate on the bridge-gen test. If coordination is out of scope for one PR, land the regression fixes (objectives 1, 2, 4, 5) first and split objective 3 into its own bridge-coordinated change.
- **Trend semantics ambiguity.** "Linear Trend" has two plausible readings (constant-step from the last point vs least-squares fit). The least-squares reading is the spreadsheet standard and is what objective 1 commits to; document this in `engine_policy.rs` / `series/trend.rs` so it is not "simplified" back to constant-step later.
- **Test enshrines a bug (objective 2).** `fill_up` currently asserts wrong values; the fix *must* change a passing test. Call this out explicitly in the PR so it is not mistaken for a regression.
- **Numeric edge cases:** growth with a zero/negative anchor; regression with `n < 2`, all-equal values (slope 0), or `ln` of non-positive; overflow to ∞. Each needs a defined outcome (copy fallback or warned `#VALUE!`), not a panic.
- **Floating-point determinism.** Regression introduces division/`ln`; keep it deterministic and within the crate's existing `TOLERANCE` conventions (`patterns/values.rs`). Do not let trend output drift across platforms.
- **Non-goals:** rewriting the detector chain or lane/tiling architecture (sound as-is); changing formula-adjustment semantics; adding new fill *modes* beyond fixing the existing two trend modes; expanding Flash Fill scope without Phase-0 evidence; any storage/CellId/IPC plumbing beyond the minimal `step_value` and additive-warning/pattern changes.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable within this folder:** Phase 1 (trend, `series/` + `engine_policy.rs`), Phase 2 (anchoring, `series/`), and Phase 4 (reporting, `engine_lanes.rs` + `engine_emitter.rs` + `types.rs`) touch largely disjoint files and can proceed concurrently; merge order matters only where Phase 1 and Phase 2 both touch `series/numeric.rs`.
- **Cross-folder dependency (objective 3 only):** the `step_value` contract change requires coordinated edits in `mog/compute/core/src/engine_types/fill.rs` and the TypeScript bridge / fill UI (out of this folder's scope). Sequence it after the in-folder fixes or behind the bridge-generation gate.
- **Downstream consumer to keep informed:** `mog/compute/core/src/storage/engine/services/mutation_handlers/fill.rs` consumes `FillResult.warnings` and `detected_pattern`; new warning kinds and any `FillPatternType::Mixed` discriminant must be handled (or safely ignored) there and in the UI summary mapping.
- **No dependency on other plan-queue folders** for the core correctness fixes (objectives 1, 2, 4, 5); they are self-contained in `compute-fill`.
