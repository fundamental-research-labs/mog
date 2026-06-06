Rating: 8/10

Summary judgment

This is a strong, production-path plan. It correctly treats `scheduler/` as the live recalc orchestrator, identifies real issues in the current code, and emphasizes contracts over isolated fixes. The best parts are the explicit preservation of the four recalc strategies, the focus on silent degradation signals, the cross-sheet schema-validation TODO, and the verification expectations around result identity and native/WASM parity.

The rating is not higher because several proposed fixes still stop at intent rather than a verifiable contract. The biggest weak spots are metric propagation and merge semantics, schema-constraint dependency extraction, timeout/error wire shape, and exact verification commands. Those are solvable, but an implementer would still need to make important design choices before editing.

Major strengths

- The plan is grounded in real scheduler source, not generic cleanup. The cited anchors match the code: projection stabilization silently returns on depth/deadline, `schema_validation.rs` has the cross-sheet TODO, `passes.rs` has duplicated level loops and SUMIFS epoch `expect`s, and timeout currently writes plain `CellError::Calc` values while only `metrics.timed_out` distinguishes the cause.
- It preserves key scheduler invariants instead of flattening orchestration: incremental topo, full topo, cycle recovery, and data-table prepass remain distinct while only the per-level body is considered for deduplication.
- It separates correctness risk from performance risk. Projection stabilization truncation is treated as possible stale output, while agg-prepass bail-outs are framed as observable performance degradation.
- Phase 0 is valuable. Requiring evidence before editing is the right sequencing for this folder, especially for `MAX_DEPTH`, timeout surfacing, graph-build coverage, and the `passes.rs` refactor boundary.
- The plan calls out cross-repo/type-contract impact for `RecalcMetrics`, which matters because the metrics shape is consumed by generated kernel compute types.

Major gaps or risks

- Metric propagation is under-specified. `projection_stabilize` currently returns only changes/projections/errors and creates a local `spill_metrics` that is discarded. The plan says to thread a truncation flag into `RecalcResult.metrics`, but does not define whether stabilization accepts the parent metrics by mutable reference, returns a richer result struct, or merges nested metrics. It also does not enumerate all merge sites that must preserve new fields; at least `storage/engine/services/mutation.rs` merges selected metrics manually, while the range-operation `patches.rs` helper currently does not merge metrics at all.
- The schema-validation implementation sketch is too coarse. "Parse the constraint AST once" is only safe for sheet-name discovery, not full dependency matching. Formula constraints are evaluated per target cell, so relative references and row-relative formulas can depend on the validating cell position. The plan should specify whether the fix is sheet-level invalidation only, exact cell/range dependency extraction, or a conservative but bounded fallback. It also needs cache ownership/versioning for parsed schema formulas across `load_schema_map`, `update_schema`, `remove_schema`, and `clear_schemas`.
- Timeout tagging is not a concrete wire contract. `CellErrorInfo.error` already carries the string "Recalculation timeout exceeded", while `CellChange.value` is still ordinary `#CALC!`. The plan proposes either an error reason or an `extra_flags` bit, but `extra_flags` is currently render metadata ORed into binary patch flags. A timeout cause should be a typed error/diagnostic contract unless the wire flag space is explicitly audited.
- The SUMIFS epoch fix is vague. Replacing `expect` with a public-entry initialization does not make private helper calls structurally safe; `topo_evaluate_pass` is also called from projection stabilization and cycle paths. A stronger contract would pass a `SumifsCacheEpoch` or a recalc session object into the level-eval helpers so missing epoch initialization is impossible by type.
- The plan is broad enough to be several implementation workstreams: observable degradation metrics, schema dependency correctness, `passes.rs` refactor, panic hardening, timeout diagnostics, graph-build auditing, and optional allocation tuning. The sequencing section helps, but the plan should name which phases can ship independently and which public contracts must be updated together.

Contract and verification assessment

The contract section is unusually good for a plan review target: result ordering, seed-change inclusion, manual-calc behavior, cycle seeding, thread-local cache hygiene, `WriteTrust`, ID allocation, and native/WASM result parity are all called out. Those are the right constraints for scheduler work.

Verification is directionally strong but not concrete enough. The plan should name exact gates, for example `cargo test -p compute-core` and `cargo clippy -p compute-core`, plus any feature-specific/native and wasm-pack lane actually used in this repo. Because metrics and generated TS bridge types are in scope, it should also require the contracts/type generation gate and a TS typecheck gate for `kernel/src/bridges/compute/compute-types.gen.ts` consumers. The performance gate also needs an exact benchmark or fixture command, not only "263K / stress-many-sheets style cases."

The proposed tests cover the right behaviors, especially cross-sheet schema constraints, deep spill stabilization, agg-prepass bail-out metrics, no-panic epoch handling, and timeout distinguishability. The plan should add tests for metric merging through engine mutation result combiners, because otherwise new degradation fields can be set correctly in compute-core and then disappear before the UI sees them.

Concrete changes that would raise the rating

- Define the new metric fields exactly, including separate max-depth vs deadline projection-stabilization signals, agg-prepass guard fallback vs closure-cap signals, defaults, merge behavior, generated TS shape, and all merge call sites.
- Replace the schema-validation sketch with a precise invalidation contract: cache location, schema-version invalidation, how sheet names are resolved, how relative references are handled per row/cell, and whether dirty matching is exact or conservative.
- Specify a recalc session/epoch API for SUMIFS cache ownership so `topo_evaluate_pass` cannot be called without an epoch.
- Choose one timeout diagnostic wire shape and reject `extra_flags` unless the render flag contract is explicitly extended and tested.
- Split Phase 3 refactoring from Phase 1/2 correctness work or mark it as a separate landing step with byte-identical result fixtures before and after.
- Add exact verification commands for Rust, generated contracts, TypeScript consumers, native/WASM parity, and the performance fixture.
