Rating: 8/10

Summary judgment

This is a strong plan. It correctly understands `compute-cf` as a pure conditional-formatting decision engine, separates crate responsibilities from scheduler responsibilities, and backs its priorities with concrete evidence from the current source tree. The highest-value issue, formula-typed `cfvo` thresholds degrading to `0.0`, is real and production-relevant. The public API footgun around `has_formula = false` is also accurately identified, and the plan is appropriately contract-focused rather than just adding tests around current behavior.

The rating is held below 9 because the central formula-`cfvo` fix is not specified as a precise type contract. The plan names the right seam but leaves too much ambiguity around how formula source, literal numeric thresholds, evaluated per-cell operands, and missing evaluation should be represented. The performance objective is directionally good but lacks a measurement gate or target, and a few proposed refactors could become churn unless their compile-time guarantees are spelled out more concretely.

Major strengths

- The plan's evidence matches the live implementation: `parse_point_value` drops formula operands to `None`, visual resolution falls back to `0.0`, scheduler formula evaluation currently only covers rule-level formulas, and production uses `CascadeEvaluator::apply_for_cell` rather than `evaluate_rules`.
- It preserves the most important architectural boundary: `compute-cf` remains pure and receives pre-evaluated inputs instead of importing scheduler, storage, or evaluator dependencies.
- It distinguishes complete rule-family coverage from fidelity gaps inside covered families. That prevents a misleading "add missing CF rules" project and keeps the work pointed at actual correctness defects.
- The sequencing is mostly reviewable: API cleanup, merge coupling, stats merge improvement, icon invariant cleanup, and golden-contract tests can be separate slices; formula-`cfvo` is explicitly marked as a paired scheduler dependency.
- The verification section covers the right categories: in-crate Rust tests, serde round trips, scheduler integration, and an engine/app-level scenario proving the renderer sees evaluated formula thresholds.

Major gaps or risks

- Step 1 needs an exact API. It currently suggests both storing evaluated values on rule points and passing a separate evaluation-input map. Those are different contracts. The plan should choose one canonical shape and define how it is keyed for color-scale min/mid/max, data-bar min/max, and icon thresholds.
- The plan says a missing formula evaluation can fall back to `0.0` with a log/debug assertion. That preserves compatibility, but it also preserves the current silent mis-render in release builds. If fallback is required for partial rollout, the plan should define whether the production path treats missing evaluated operands as "no visual", a typed error, an explicit fallback result, or a temporary compatibility mode.
- Formula-`cfvo` relative-reference semantics are not specified. Scheduler evaluation must know each point formula's source, origin, target-cell shift rules, and whether formulas are evaluated once per target cell or once per rule/range. This is the hardest part of the fix and should be a contract, not just a cross-folder note.
- The plan does not define how `FormulaSource` or formula text survives in `CFColorPoint` and `CFIconThreshold` while maintaining serde and conversion compatibility. The current internal structs only store `Option<f64>`, so the migration shape should be explicit.
- The stats performance objective lacks a baseline and acceptance threshold. K-way merge is plausible, but "reduce cost" should name a benchmark, fixture size, and expected asymptotic or wall-clock improvement so reviewers can tell whether the production path actually improved.
- The compile-time merge-coupling proposal is directionally right but underspecified. A macro only helps if it constructs `CfRenderStyle` without `..Default::default()` and forces new fields to fail compilation until the merge policy is declared.
- The plan calls for golden tests but does not identify whether those goldens come from Excel/OOXML fixtures, existing TypeScript parity behavior, or hand-authored expected values. For subtle Excel semantics, source-of-truth matters.

Contract and verification assessment

The contract assessment is above average. It explicitly protects purity, type-state validation at `TryFrom<CFRuleWire>`, cascade semantics, serde wire shapes, icon-set name codegen, and numeric/statistical edge cases. Those are the right load-bearing contracts for this crate.

Verification is also mostly appropriate: `cargo test -p compute-cf`, `cargo clippy -p compute-cf`, serde/proptest coverage, scheduler tests, and an app/API-level scenario after the paired scheduler change. The main missing piece is performance verification for `RangeStatistics::merge` and lazy frequency work. If the plan keeps objective 5, it should require a production-shaped benchmark or at least an existing bench test with large multi-range CF fixtures. The formula-`cfvo` integration test should also be made more precise: import or construct a workbook with color scale, data bar, and icon set formula thresholds, then assert non-`0.0` evaluated visual output through the scheduler path.

Concrete changes that would raise the rating

- Define the exact formula-operand model, for example an enum that preserves `Min`, `Max`, `Number(f64)`, `Percent(f64)`, `Percentile(f64)`, and `Formula(FormulaSource or source string)`, plus a separate per-cell `EvaluatedCfvoOperands` input keyed by visual rule point identity.
- Specify missing-evaluation behavior for formula `cfvo` thresholds in production and tests. Avoid a release-mode path that quietly reproduces the current `0.0` bug.
- Add a scheduler-side contract for formula threshold evaluation: origin range, relative-reference shift, evaluation frequency, error handling, and how results are passed into `compute-cf`.
- Turn objective 5 into a measurable performance task with a named benchmark fixture and an acceptance target, or split lazy `numeric_text_frequency` into a separate plan if it requires broader API changes.
- Make the style-merge macro/derive acceptance criterion explicit: adding any field to `CfRenderStyle` must fail to compile until merge behavior is declared.
- Name the golden sources for Excel-fidelity assertions, especially formula truthiness and icon `Percent` vs `Percentile` behavior.
