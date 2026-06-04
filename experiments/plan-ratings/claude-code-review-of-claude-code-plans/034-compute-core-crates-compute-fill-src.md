Rating: 9/10

# Review of Plan 034 — `mog/compute/core/crates/compute-fill/src`


## Summary judgment

This is an unusually strong, evidence-grounded plan. It targets a sound architecture and resists the temptation to restructure it, instead isolating a small set of genuine inference-correctness defects in the live autofill engine. Every concrete claim I spot-checked against the source held up exactly — file names, line numbers, function names, the buggy heuristic, the test that enshrines a bug, the cross-boundary contract files, and the verification-gate test paths all exist as described. The plan reads like it was written by someone who actually traced the data flow from `compute_fill` through lanes → series → emitter and out across the IPC bridge, not someone pattern-matching on file names.

The five core objectives are real, correctly diagnosed, and ordered by value. The phasing (Phase 0 establishes reference behavior before any code change) is the right instinct for a correctness-sensitive numeric crate. Verification gates are concrete and runnable. The risk section anticipates the genuinely tricky parts (a fix that *must* change a passing test, wire-contract desync, trend-semantics ambiguity, floating-point determinism).

## Verification of the plan's central claims

I confirmed the following against the public source:

- `engine_policy.rs:102-111` maps `LinearTrend → step: Some(1.0)` and `GrowthTrend → multiplier: Some(2.0)` as fixed constants ignoring `source_values`. **Confirmed** — the defect is real and is the highest-value fix.
- `determine_lane_pattern` uses `request.step_value != 1.0` as the override heuristic (`engine_policy.rs:63`), while the doc comment in `types.rs:103` claims "auto-detected … when 0 or unset." The code never checks 0. **Confirmed** — the comment and the code disagree exactly as stated.
- `series/common.rs:12-22` `anchor_number` honors `direction_mult` (last for forward, first for backward), but `series/numeric.rs:13,29,53` and `series/date.rs:15` all pass the literal `1`, while `cyclic.rs:51,110` and `textual.rs:13,62` correctly thread `direction_mult`. **Confirmed** — the inconsistency is precisely as described.
- `engine_tests.rs` `fill_up` asserts `A4=3_000_010` (a duplicate of source `A5`) and `A3=3_000_012`; its own inline comment acknowledges the duplication. **Confirmed** — the test enshrines the off-by-one.
- `linear_trend_mode_forces_pattern` / `growth_trend_mode_forces_pattern` assert only `pattern_type`, and the linear test even feeds a *text* cell ("hello"), so no numeric magnitude is exercised. **Confirmed** — these tests mask the wrong magnitudes.
- `LanePlans::detected_pattern` returns `self.plans.values().next()` (first lane only). **Confirmed.**
- `num_or_error` (`series/common.rs:4-9`) silently converts non-finite to `CellError::Value` with no warning channel; `error.rs` is the "infallible" stub. **Confirmed.**
- Cross-boundary files exist: `engine_types/fill.rs` (`to_fill_request` at :92, `step_value` at :111), `mutation_handlers/fill.rs`, `compute/core/tests/auto_fill.rs`, and `infra/rust-bridge/bridge-ts/tests/generate_compute_bridge.rs`. **All confirmed.**

This level of accuracy is the plan's strongest asset: an implementer can act on it without re-deriving the diagnosis.

## Major strengths

- **Correct architectural restraint.** It explicitly declares the lane/tiling decomposition and detector chain out of scope and frames the work as correctness patches, not a rewrite. The non-goals section is specific and enforceable.
- **The trend objective is diagnosed with real depth.** It does not stop at "do least squares" — it observes that a fitted line over non-collinear points (`[2,5,6]`) is *not* a constant-step recurrence, and on that basis argues for option (b) (dedicated `LinearTrend`/`GrowthTrend` generators evaluating `y(x)`) over option (a) (reusing the recurrence generator). It also notes that extending x below 1 for backward fills sidesteps the anchor bug for the trend path. That is a subtle, correct insight.
- **Contract and invariant section is genuinely load-bearing.** Purity, update-ordering (`sort_updates`), source/hidden/merge exclusions, the "count without anchor change reintroduces the off-by-one" warning, serde back-compat, and detector priority are all called out with file references.
- **Verification gates are concrete and matched to each objective**, including a cross-boundary `auto_fill.rs` integration test to confirm magnitudes survive serde — exactly the failure mode an in-crate unit test would miss.
- **Risk handling is honest**, especially flagging that objective 2's fix must intentionally change a passing test, and that objective 3 can be split into its own bridge-coordinated PR.

## Major gaps or risks

- **Single-source-value behavior for the trend modes is under-specified.** The plan says to "define and assert the degenerate behavior" for a single source value but never states what it should be. With `n=1`, `fit_linear` has no slope and `fit_growth` has no ratio. The existing spreadsheet-fidelity rule (a single numeric cell *repeats*, per `patterns/mod.rs`) may or may not apply when the mode is explicitly `LinearTrend`. This is the one place the plan defers a decision that the implementer will be forced to invent, and it interacts with the existing single-cell invariant the plan elsewhere insists on preserving. It should pick the answer.
- **Objective 4 leaves the contract choice open** (aggregate `Mixed` discriminant vs. documented primary-lane). Adding a `FillPatternType::Mixed` variant is a wire/enum change with downstream mapping obligations in `FillResultSummary` and the UI; deciding "compute Phase 0" is acceptable for a plan, but the two branches have materially different blast radii (one is purely documentation, one is a serde enum change requiring consumer updates). The plan should at least state its default preference.
- **Interaction between the growth-trend fallback and the overflow warning (objectives 1 and 5) is not fully wired.** Objective 1 says "if any y ≤ 0, fall back to copy and emit no growth"; objective 5 adds a non-finite warning. The plan does not say whether a fallback-to-copy should itself surface any signal to the user, who would otherwise see a silent copy where they asked for a growth trend. Worth one sentence.
- **Option (b) for trend implies a new `FillPatternType` variant** (`LinearTrend`/`GrowthTrend` carrying fitted params), which is the same class of additive-enum wire change the plan treats carefully for `Mixed` — but here it is not flagged as a serde/consumer concern. Minor, but the plan's own consistency standard would catch it.
- **Phase-1/Phase-2 merge conflict on `series/numeric.rs`** is acknowledged, but the suggested concurrency could still produce a subtle semantic interaction: the corrected anchor (Phase 2) and the new trend generators (Phase 1) both alter how backward numeric series are produced. The plan notes the file overlap but not the behavioral overlap. Low risk given the trend path is mode-forced and separate, but worth an explicit note.

## Contract and verification assessment

Strong. The plan correctly identifies `types.rs` + `engine_types/fill.rs` as a dual-sided IPC contract and ties the `step_value` shape change to the bridge-generation test, with a fallback to land it as a separate coordinated PR. Serde back-compat (Option / `#[serde(default)]`) and additive tagged-enum warnings are the right mechanisms and are named. The purity and update-ordering invariants are explicitly preserved. The only contract-clarity weakness is the two open enum-shape decisions noted above (trend generator variant, `Mixed`), which should be resolved to "additive variant, mirror in `FillResultSummary`, ignore-safe in `mutation_handlers/fill.rs`" rather than left as Phase-0 forks. Verification coverage is comprehensive: per-objective unit cases with asserted magnitudes (not just pattern types — the explicit lesson learned from the masking tests), a regression guard that names the one test allowed to change, and an end-to-end serde-crossing test.

## Concrete changes that would raise the rating

1. **Specify the single-source-value outcome for `LinearTrend`/`GrowthTrend`** (e.g., repeat the value, matching the existing single-cell invariant, or define an explicit degenerate slope) rather than deferring it to "define and assert."
2. **Commit to a default for objective 4** (recommend: documented primary-lane unless Phase 0 shows the UI relies on aggregate accuracy — the cheaper, non-wire-breaking option) instead of leaving the `Mixed` enum change as an open fork.
3. **State whether a growth/trend fallback-to-copy emits a warning**, so the user is not silently downgraded from "growth" to "copy."
4. **Apply the plan's own additive-enum discipline to option (b)'s new `FillPatternType` variant** — flag it as a serde/consumer change with the same mitigation as `Mixed`.
5. **Add one sentence on the behavioral (not just file-level) overlap of Phases 1 and 2 on backward numeric series**, confirming the mode-forced trend path and the auto-detect anchor path stay separate.

These are refinements, not corrections — the diagnosis and architecture are sound and the evidence is verified. A point is withheld only for the handful of decisions the plan defers that an implementer will be forced to make blind.
