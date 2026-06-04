Rating: 8/10

# Review of Plan 033: Compute Pivot Aggregation and Layout Semantics Improvements

Source folder: `mog/compute/core/crates/compute-pivot/src`
Plan reviewed: `mog-internal/plans/active/experiments/plan-ratings/codex-plans/033-compute-core-crates-compute-pivot-src.md`

## Summary judgment

This is a strong, unusually well-grounded plan. Its central claims are not hand-waving — I verified the most load-bearing ones directly against the source and they are correct:

- `AggregateFunction::CountUnique` really is collapsed onto relational `Count` (`presenter/query_mapping.rs:167`: `Count | CountUnique => RelAggFunc::Count`), so unique counting silently does not happen on the production path.
- `map_aggregate` ends in a catch-all `_ => RelAggFunc::Sum` (`query_mapping.rs:177`), and the same silent-fallback shape repeats for sort direction (`_ => Ascending`, line 161), top/bottom type (`_ => Top`, line 185), and top/bottom by (`_ => Count`, line 192). The plan's "future variants degrade silently" claim is accurate and broader than it even states.
- `measure_descriptors` and `value_records` are hard-coded to `Vec::new()` at the single production projection site (`presenter/result_projection.rs:128-129`), confirming the "always empty typed metadata" gap.
- The filter default inversion is real: `engine/validation.rs:379` sets `show_items_with_no_data: filter.show_items_with_no_data.unwrap_or(true)` against documented default `false`.
- The non-exhaustive Show Values As no-op path exists (`show_values_as/transforms/mod.rs:178`).

Because the diagnosis is verifiable rather than speculative, the plan earns trust. The improvement objectives, invariants, and verification matrix are coherent and map cleanly onto the actual module layout (`presenter/*`, `show_values_as/*`, `calc_field/*`, `resolved.rs`, `engine/*`). The main weakness is scope: this is closer to a multi-quarter program of work than a single executable slice, and several real sequencing dependencies are left implicit behind an optimistic "naturally parallelizable" framing.

## Major strengths

1. **Evidence-based diagnosis.** Every "observed gap" I sampled is true in the current tree. This is the single biggest differentiator from a generic plan — it was written against the code, not against an idea of the code.
2. **Explicit, well-chosen invariants.** The "contracts and invariants" section is the strongest part: pure crate with no `mog-internal` dependency, `ResolvedPivotConfig` as the trusted input with no reintroduced `unwrap_or` fallbacks, `PlacementId` as primary value identity vs repeatable `FieldId`, `rendered_bounds` authoritative for materialization/GETPIVOTDATA, `None` vs `Some(Vec::new())` grand-total distinction, and `(blank)` null-header semantics. These are precise enough to write contract tests against.
3. **Correct architectural posture.** It explicitly keeps generic grouping/aggregation/sorting/calc-measure execution delegated to `compute-relational` and value semantics to `compute-stats`, rather than reimplementing them in `compute-pivot`. This matches the existing `pub use compute_stats::{aggregate, sort}` re-export structure in `lib.rs`.
4. **Production-path discipline.** Step 16 and the performance section insist on exercising stored-pivot paths (`pivot_compute_from_source`, `materialize_pivot`, `pivot_register_def`, bridge pure compute) rather than direct `compute-pivot` helpers, and explicitly forbid optimizing benchmark/test-only paths. This guards against the classic "fixed the helper, not the product" failure.
5. **Detailed verification matrix.** The contract-test enumeration (aggregate matrix, count semantics, measure identity, calc-field parity, result-metadata alignment, layout matrix, expansion matrix, Show Values As matrix, boundary validation) is genuinely thorough and tied to specific failure modes.

## Major gaps or risks

1. **Scope is a program, not a slice.** Despite the "first implementation slice" and "out of scope" framing, the in-scope work spans 16 implementation steps across at least seven crates (`compute-pivot`, `compute-relational`, `compute-stats`, `pivot-types`, `domain-types`, `compute-core`) plus TS/bridge/SDK regeneration. Any one of steps 2 (resolved measure plan), 5 (unified calc-measure execution), 8 (presenter layout rewrite), or 11 (collapsed column aggregates) is a substantial standalone effort. The plan would be stronger if it named the *minimum* first landing (e.g. CountUnique + exhaustive mapping + measure-slot model + populate `measure_descriptors`) and deferred the layout/projection rewrite explicitly.
2. **Sequencing dependencies are real but presented as parallel.** "Agent A–G run in parallel" understates hard ordering: Agent C's measure plan is a prerequisite for D (layout addresses slots), E (Show Values As becomes measure-slot-aware), F (materialization uses descriptors), and G (bridge DTOs). Agent B's `CountUnique` in relational must land before C can populate descriptors that assert correct counts. The plan should mark the measure-slot model + aggregate mapping as a serial foundation phase, then fan out.
3. **DTO breaking-change story is thin.** Populating `value_records`/`measure_descriptors`, changing `ColumnRemap` to a visible-column descriptor list, and possibly extending descriptor DTOs for calculated fields are flagged as "coordinated bridge/SDK/kernel/app updates," but the plan does not state which changes are additive (safe to land independently) vs wire-breaking (require lockstep regeneration). For a public crate feeding wasm/napi bridges this is the highest-risk axis and deserves an explicit additive-first strategy.
4. **`value_records` size budget is named but not bounded.** The risk section acknowledges result-size blowup and proposes "a deliberate provenance policy," but offers no concrete budget, default, or threshold. Without a decision (e.g. provenance off by default, opt-in per compute call, compact index format), step 7 risks either bloating every materialization or silently shipping empty records again.
5. **Verification gates are coarse at the top level.** The required gates are `cargo test/clippy -p <crate>` — necessary but not sufficient as acceptance criteria. The detailed contract-test list partly compensates, but there is no statement of *which* new tests gate which step, nor any baseline (e.g. "no existing `compute-pivot` test regresses except the documented collapsed-column tests in step 11"). The plan does correctly call out that tests encoding the current collapsed-`Null` bug must be rewritten.
6. **Empty-item universe is an open design question, not a decision.** Step 9 lists three candidate sources (pre-filter source data, pivot cache items, explicit field-item metadata) but defers the choice. Since `compute-pivot` is stateless and may not receive the full item universe, this could block the whole empty-rows/columns objective; it should be resolved (or explicitly time-boxed as a spike) before committing Agent D to it.

## Contract and verification assessment

The contract definition is the plan's best dimension. Value layout is pinned to a single rule — "visible column tuple order × measure slot order" — and every output vector, descriptor, value record, and materialized coordinate is required to agree with it. Identity is disambiguated correctly (`PlacementId` primary, `FieldId` repeatable, `PivotValueSource::Field` vs `CalculatedField` preserved end-to-end). Count semantics are specified precisely (`Count` numeric, `CountA` non-empty, `CountUnique` unique non-empty via `compute-stats` equality), which matters because the current code's `Count`/`CountA`→`Count`/`CountNums` mapping is exactly the kind of thing this contract pins down.

The non-algebraic-aggregate invariant (subtotals/grand totals computed from raw contributing rows, not composed from child display values) is the right call and correctly flagged as the hard part of adding `CountUnique` to relational. The calc-field unification (one resolver for body, subtotal, row/column/corner totals with deterministic alias priority) directly targets a verified divergence risk.

Verification is strong on breadth (the contract-test matrix) but weak on gating precision and baselines, as noted above. There is no numeric or behavioral acceptance threshold beyond "tests pass," and no rollback/migration plan for the cross-bridge DTO changes.

## Concrete changes that would raise the rating

1. **Define a minimum first landing.** Carve out a Phase 1 that ships independently and additively: `CountUnique` correctness (relational + stats), exhaustive `map_aggregate`/sort/top-bottom with structured `PivotError` instead of `_ =>` fallbacks, the `ResolvedMeasureSlot` model, and population of `measure_descriptors`. Defer presenter layout rewrite (step 8), empty-item semantics (step 9), and collapsed-column aggregates (step 11) to later phases with their own gates.
2. **Make the dependency graph explicit.** Replace "Agents A–G in parallel" with a serial foundation (measure plan + aggregate mapping) → fan-out (layout, Show Values As, materialization, bridge). State which agent outputs are inputs to which.
3. **Classify every DTO change as additive vs breaking**, and commit to additive-first (new optional fields, default-empty preserved until consumers opt in) so `compute-pivot` can land ahead of bridge/SDK/app regeneration rather than in lockstep.
4. **Decide the `value_records` provenance policy now**: default state, opt-in mechanism, and a size budget or compact-index format. Without this, step 7 is under-specified.
5. **Resolve the empty-item universe question** (or schedule a bounded spike) before committing to `show_items_with_no_data`/`show_empty_rows`/`show_empty_columns`, given the crate's stateless contract.
6. **Tighten gates into acceptance criteria**: tie named contract tests to each step, state the no-regression baseline, and explicitly enumerate the existing tests that must change (collapsed-column `Null` tests, `show_items_with_no_data` default tests) so reviewers can distinguish intended contract changes from accidental breakage.
