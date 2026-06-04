Rating: 8/10

# Review of plan 036 — `mog/compute/core/crates/compute-cf/src`

## Summary judgment

This is a strong, evidence-grounded plan. It demonstrates genuine familiarity with the crate: every claim in the Evidence section that I spot-checked is accurate against the current tree, with correct file/line anchoring. It correctly diagnoses that the crate is *already feature-complete* against the domain `CFRuleType` enum and that the real work is fidelity gaps, API footguns, and cost — not new scope. The objectives are production-path, the contract-preservation section is unusually rigorous, and the sequencing separates a genuinely independent set of refactors (Steps 2,4,5,6) from the one cross-folder-dependent feature (Step 1). The main weaknesses are that the marquee objective (Step 1) is the least concrete and delivers zero observable behavior change without a separate folder's edit, and that a couple of the lower-value steps (5's lazy frequency map, the "macro or derive-style helper" in 4) are left as open design choices rather than decisions.

## Verification of the evidence (sampled)

- **Formula-`cfvo` → `0.0` gap:** confirmed. `types/value.rs:139` returns `None` for `Formula`/`Null`; `types/convert.rs:131` `parse_point_value` does `value.as_ref().and_then(CfValue::as_number)` for `CFValueType::Formula`; `visual/color_scale.rs:56` and `visual/icon_set.rs:27` both resolve `Number | Formula => point.value.unwrap_or(0.0)`. The chain the plan describes is real and the `0.0` degradation is genuine.
- **`has_formula = false` hardcoding:** confirmed. `evaluator.rs:226` (`CascadeEvaluator::apply` delegates with `false`) and the `evaluate_rule`/`evaluate_rules` wrappers; `rules/blanks_errors.rs:19-21` shows the formula-cell dependence. The scheduler's only call is `apply_for_cell` (`cf_eval.rs:286`), so the convenience entry points are indeed unused-in-production footguns.
- **`evaluate_rules` unused in production:** confirmed — the sole production caller is `CascadeEvaluator::apply_for_cell`.
- **`merge_styles` hand-written field list:** confirmed it enumerates fields with `higher.x.or(lower.x)` (I count ~20 `.or(lower…)` sites, vs. the plan's "17 fields" — see minor discrepancy below).
- **`CfValue::Formula { source }` already carries the source** (`value.rs:57`, `to_formula_source` at `:81`), which is what makes Step 1's "preserve the formula CfValue rather than discarding to None" feasible without new plumbing in the wire type.

The plan's factual base is trustworthy.

## Major strengths

- **Diagnosis over guesswork.** The Evidence section reads like a real code audit, not a templated improvement list. It names the exact failure mode (silent `0.0`), why it's silent, and why the existing scheduler can't currently fix it.
- **Purity is treated as a hard, load-bearing invariant** and Step 1 is explicitly designed around it (crate receives *already-evaluated* values; evaluation stays in the scheduler). This is the correct architectural call and is stated repeatedly.
- **Contract section is excellent.** Type-state safety of `CFRuleKind`, the single `TryFrom` validation chokepoint, serde wire shapes shared with NAPI/WASM/pyo3, `CFIconSetName::SERDE_NAMES`/codegen coupling, and Excel numeric semantics are all called out as things that must not drift. This is the part most plans omit.
- **Honest about no-op landings.** Step 1 is explicitly designed so the crate-side change is byte-identical with an empty evaluation map, gated by a test — the right way to land a paired cross-folder feature.
- **Behavior-preserving steps are correctly identified** and tied to existing regression gates (`priority_tests.rs` for the merge macro, `stats_tests.rs` for the merge rewrite).

## Major gaps or risks

- **Step 1 is the highest-value objective but the least specified, and it is not self-completing.** The plan proposes two different representations in adjacent paragraphs: (a) "extend the per-point representation so a Formula-typed point can hold an evaluated `Option<f64>`" and (b) "Add an evaluation-input parameter … a small typed struct mapping each Formula point/threshold to its pre-evaluated f64." These are different designs (mutate-the-rule vs. side-channel input). It also says to "expose [the formula source] on `CFColorPoint`/`CFIconThreshold` for the scheduler to evaluate" — a third surface change. The plan should pick one and justify it (the side-channel input is cleaner for purity and avoids mutating a validated `CFRule`; the per-point `evaluated` field risks a stale/uninitialized state). As written, an implementer has to resolve a real design fork mid-step.
- **The marquee fix produces zero user-visible change on its own.** By the plan's own (correct) admission, without the `cf_eval.rs` producer the output stays `0.0`. That's defensible sequencing, but it means the plan's #1 objective cannot be validated end-to-end inside this folder; the only proof it works is the deferred cross-folder app-eval. The plan should state more sharply that Step 1 is *not done* until the paired scheduler PR lands, and ideally name the acceptance test that closes it.
- **Step 5 (stats cost) is the weakest-justified objective.** It mixes a sound, results-identical change (k-way merge of already-sorted inputs; merge-into-largest to avoid clones) with a speculative one ("consider building `numeric_text_frequency` lazily"). Lazy construction changes the cost model based on which rule families are present and introduces a conditional that must be proven results-identical; it's listed as "consider" with no decision. Given the plan elsewhere claims caching is a scheduler concern, this step risks adding complexity for a benefit the plan doesn't quantify. It would be stronger as "k-way merge only; defer laziness."
- **No quantification anywhere.** Step 5 asserts merge is "the dominant cost" for large ranges but offers no measurement, and the crate has an `evaluator_bench_tests.rs` that could anchor a before/after. A perf objective with no baseline number is hard to gate.
- **Step 4's mechanism is left open** ("a declarative macro (or a derive-style helper)"). A field-enumerating macro is the obvious fit, but "derive-style helper" implies a proc-macro/new trait that is heavier than warranted. Picking the local `macro_rules!` approach explicitly would de-risk this.

## Contract and verification assessment

- **Contracts:** Best part of the plan. The invariants enumerated are the right ones and match the code (dual `CfValue` deserialization, exclusive visual winner / first-writer-wins, `debug_assert`ed priority sort, sample std-dev `n-1`, `PERCENTILE.INC`, Lotus-1900). Step 6's observation that the `compute_icon` count re-check is unreachable from the validated `TryFrom` path is correct and the "demote to `debug_assert!`, keep one defensive `>10` bound" resolution is appropriately conservative.
- **Verification gates:** Good coverage and correctly scoped — existing `*_tests` as regression gates for the behavior-preserving steps; new goldens for the fidelity contracts (text coercion split, `is_truthy` on numeric/empty text, icon `Percent`/`Percentile`/`Number`); a serde round-trip case proving a `Formula` cfvo survives conversion without flattening to `0.0`; and the cross-folder app-eval for the end-to-end render. The named commands (`cargo test -p compute-cf`, clippy, scheduler tests, `compute-wire` codegen test) are the right set.
- **Gap:** the plan asserts "numerically identical" for the stats rewrite but doesn't specify *how* identity is asserted across the lazy-frequency variant — if laziness is kept, the gate needs an explicit "frequency maps identical whether built eagerly or lazily" assertion, which isn't called out.

## Minor issues

- "17 optional fields" in `merge_styles` vs. ~20 `.or(lower…)` sites in the actual function — small factual drift; doesn't affect the conclusion but the count should match the code (per-side borders / `number_format` are likely the delta the plan itself mentions).
- Step 2 says "rename `evaluate_rule_for_cell` → `evaluate_rule`" while `evaluate_rule` already exists as the wrapper — the plan means "collapse the wrapper into the canonical name," which is fine, but the phrasing reads as renaming onto an occupied name. A one-line note that the old `evaluate_rule` wrapper is removed first would remove ambiguity.

## Concrete changes that would raise the rating

1. **Decide Step 1's representation.** Commit to the side-channel typed input (e.g. `&FormulaCfvoValues` mapping point identity → evaluated `f64`) passed to `compute_color_scale`/`compute_data_bar`/`compute_icon`, and explicitly reject mutating the validated `CFRule`. State whether `CFColorPoint`/`CFIconThreshold` need to *carry* the formula source or whether the scheduler reads it from the existing `CfValue::Formula` — pick one.
2. **State Step 1's done-criterion as the paired app-eval**, and mark it explicitly blocked-on the `cf_eval.rs` producer so it isn't mistaken for independently shippable.
3. **Trim Step 5 to the results-identical k-way merge + merge-into-largest**, drop or separately gate the lazy frequency map, and anchor the claim with a number from `evaluator_bench_tests.rs` (before/after).
4. **Pick `macro_rules!` for Step 4** and note the macro lives next to `CfRenderStyle` so the struct↔merge coupling is local and the compile error on a new field is obvious.
5. **Fix the field count** (17 → actual) and the Step 2 rename phrasing.
6. **Add an explicit identity assertion** to the stats gate if any laziness is retained.

These are refinements to an already-solid plan; none of them are corrections to wrong analysis. The plan's diagnosis is accurate, its architecture is sound, and its risk-handling is above average — held back from a 9 mainly by the under-specified, non-self-completing marquee step and a perf step that mixes a safe win with a speculative one.
