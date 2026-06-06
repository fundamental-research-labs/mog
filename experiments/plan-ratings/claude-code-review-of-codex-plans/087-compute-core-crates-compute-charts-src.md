Rating: 9/10

# Review of Plan 087: Compute Charts Native Transform Improvements

Source folder: `mog/compute/core/crates/compute-charts/src`
Plan reviewed: `mog-internal/plans/active/experiments/plan-ratings/codex-plans/087-compute-core-crates-compute-charts-src.md`

## Summary judgment

This is a strong, unusually well-grounded plan. Nearly every "observed gap" it lists is a real, verifiable property of the current code rather than a plausible guess. It correctly diagnoses the central architectural problem — that `compute-charts` is positioned as the production-authoritative native transform path but currently has no error contract, an inverted regression field binding, collision-prone grouping, ad hoc expression parsing, and unverified parity against the TS `@mog/charts` standalone implementation. The improvement objectives, contracts, sequencing, and verification gates are coherent and follow directly from the diagnosis. The plan also respects the planning-worker constraint (it explicitly states the implementation gates must not be run by this worker).

The main reasons it is not a 10 are scope ambitiousness (20 implementation steps across 9 notional agents touching Rust crates, TS grammar, kernel compiler, and four binding layers) and a handful of canonical decisions deliberately left open ("decide whether the TS grammar should expose the full set or Rust should narrow"), which push real contract-defining work onto the implementer.

## Verification of factual claims

I spot-checked the plan's claims against the public source and they hold:

- `ChartError` defines exactly `TransformFailed` and `InvalidBin` (`error.rs:5-10`), and the production path returns only `Vec<DataRow>` (`transforms/mod.rs:22`, `apply_transforms`). The "no structured outcome" gap is real.
- Regression field inversion is real and concrete. The dispatcher binds `Transform::Regression { regression: x_field, on: y_field, ... }` (`transforms/mod.rs:53-66`), i.e. `regression` → x and `on` → y, while the TS grammar treats `regression` as the dependent y field. This is exactly as described.
- Output-cardinality drift is real: the Rust regression test asserts `result.len() == 50` (`transforms/regression.rs:114`) via `RegressionOptions::default()`, while the TS grammar hardcodes `numPoints = 100` (`charts/src/grammar/transforms/regression.ts:100`).
- Grouping is collision-/order-prone exactly as claimed: `BTreeMap<String, Vec<&DataRow>>` (`transforms/aggregate.rs:40`) keyed by `make_group_key`, which joins `v.to_string()` parts and maps a missing field to the literal `"null"` (`aggregate.rs:73-85`) — so a missing field and a real JSON `null` both collapse to `"null"`, and `BTreeMap` yields sorted rather than first-seen order.
- `Distinct` uses `v.to_string()` as identity (`aggregate.rs:241`), confirming the "accidental stringification" claim.
- Rust exposes a wider aggregate set than the TS grammar: TS `AggregateSpec.op` is limited to `sum|mean|median|min|max|count|variance|stdev` (`charts/src/grammar/spec.ts:87`), with no `q1/q3/ci0/ci1/distinct/values`.
- The bridge surface (`ChartBridge` with `chart_apply_transforms`, `chart_compute_regression`, `chart_compute_density`, `chart_compute_bins`, `chart_compute_stacking`, `chart_compute_statistics`) exists at `compute/core/src/bridge_pure.rs:562-624`, and the kernel compiler reports `wasm-transforms+ts-grammar` vs `ts-grammar` and falls back via `catch` (`chart-compiler.ts:354-390`).

This level of corroboration is the plan's biggest asset: the implementer can trust the problem statement instead of re-deriving it.

## Major strengths

- **Diagnosis is evidence-based and specific.** It names files, types, and exact mismatches (regression x/y, 50-vs-100 points, BTreeMap ordering, `to_string()` identity), so the work is actionable rather than aspirational.
- **Correct framing of the core risk.** It explicitly refuses to "keep the TS fallback as a way to mask native transform bugs," which is the right north star: silent fallback is precisely what hides native semantic drift today.
- **Contracts section is the strongest part.** The invariants on value semantics (number/string/bool/null/array/object/missing), first-seen group order, stable sort with mixed types, collision-safe keys, deterministic binning boundaries, and "no NaN/Inf across the bridge" are exactly the right contracts to pin for a cross-language transform engine.
- **Verification gates are tiered and realistic.** Per-crate `cargo test`/`clippy`, conditional adjacent-crate gates, binding gates for wasm/napi/pyo3, `pnpm typecheck`, plus an extensive contract-test matrix (filter/calculate/aggregate/group-key/sort/bin/regression/density/stacking/production-compiler/bridge). The shared Rust↔TS parity-fixture idea is the correct mechanism to make drift visible rather than hoping two implementations stay aligned.
- **Sequencing is sound.** Schema-first, then regression fix, then checked execution, then expression AST, then identity/grouping, then stats, then bridge regen, then production fixtures, then perf last ("correctness lands first"). The parallelization plan correctly gates fan-out on the schema + error-result contract being written first.

## Major gaps or risks

- **Breadth vs. "first slice" tension.** The scope section names a "first implementation slice" but the concrete plan is 20 steps spanning two languages, the kernel compiler, and four bindings. The out-of-scope list is good, but there is no explicit minimal-viable cut (e.g. "land regression fix + checked result + bridge regen first, defer expression AST and stacking parity"). A reader could reasonably treat this as one mega-change. Calling out an ordered, independently-shippable subset would de-risk it.
- **Canonical decisions deferred to the implementer.** Several pivotal contract choices are posed as open questions: whether TS exposes the full aggregate set or Rust narrows; whether `histogram_with_series_config` gains a richer DTO or is renamed; whether violin helpers stay public or move behind a fuller statistic contract. For a contract-reconciliation plan, leaving the canonical answer unspecified weakens the "single canonical contract" objective — these are the decisions most likely to cause re-litigation across the nine agents.
- **Bridge result-shape change is the riskiest step and is under-specified.** Step 5 proposes either a `ChartTransformResult`/`Result` bridge shape "or an error that the transport can surface predictably" without committing to one. Given wasm/napi/pyo3 each have different type constraints (the plan itself notes `usize` limitations), the exact serialized error/result wire shape is the highest-coordination-cost decision and deserves a concrete proposed shape, not an either/or.
- **Migration of existing fallback-expecting tests is acknowledged but not enumerated.** The plan notes "tests that expected TS fallback on any native failure will need updating" but does not estimate how many or where, so the blast radius of the error-surfacing change is unquantified.
- **No rollout/feature-gating consideration.** Making native transforms authoritative and converting silent passes into chart errors is a user-visible behavior change; the plan does not discuss whether this needs gating, staged enablement, or a way to compare native-vs-TS output on real workbooks before flipping authority.

## Contract and verification assessment

Contract clarity is high. The plan converts each observed gap into a stated invariant and then into a test-matrix row, which is the right pipeline. The value-identity, group-key collision, sort stability, and "no non-finite across the bridge" contracts are precise enough to implement against. The parity-fixture strategy (shared compact fixtures executed by both Rust and TS) is the correct structural answer to two-implementation drift and is the single most valuable item in the verification plan.

Two contract weaknesses: (1) the canonical aggregate/regression/density/bin field sets are described as "to be decided" rather than asserted, so the schema reconciliation in step 2 still carries open design risk; (2) the bridge error/result shape — the contract most expensive to change later — is the least concretely specified. Verification gates themselves are appropriate, correctly scoped to changed surfaces, and correctly excluded from this planning worker's responsibilities.

## Concrete changes that would raise the rating

1. **Commit to one bridge result/error shape.** Replace the "or" in step 5 with a concrete proposed signature (e.g. a tagged `ChartTransformResult { data | error }` with a defined serialized form) and show how it degrades across wasm/napi/pyo3 given the `usize` constraints. This is the keystone decision and should not be left open.
2. **Resolve the canonical aggregate/regression-default/density/bin decisions in the plan**, not at implementation time — state whether TS narrows to the Rust set or vice versa, and fix the canonical regression point count and default output field names explicitly. Objective 1 ("one canonical schema") is undercut while these remain open.
3. **Define an explicitly ordered, independently-shippable first slice** (suggested: regression field+default fix → checked execution + bridge result shape → bridge regen + kernel error handling → production compiler fixtures), with expression AST, grouping identity, and stacking parity as clearly separable follow-ups.
4. **Add a rollout/comparison strategy:** a way to run native and TS transforms side-by-side on representative chart configs and diff results before native becomes authoritative, plus whether the authority flip needs gating. This protects against the parity fixtures missing a real-data case.
5. **Quantify the fallback-test migration:** enumerate (or at least point `rg` patterns at) the kernel/charts tests that assume TS fallback on any native failure, so the behavior-change blast radius is sized before step 5 lands.

---

Files changed by this review: only `mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-codex-plans/087-compute-core-crates-compute-charts-src.md`.
