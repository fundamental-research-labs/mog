# 025 - Compute Core Scheduler Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/src/scheduler`

Scope for this plan is the production recalculation scheduler in `compute-core`: formula parsing/registration, dependency extraction handoff to `compute-graph`, full and incremental recalculation, manual calculation behavior, cycle recovery, selective dependency fixup, dynamic-array projection stabilization, aggregate prepasses, data-table prepasses, recalc result construction, and scheduler metrics.

Adjacent production dependencies that must be considered:

- `compute/core/crates/compute-graph/src/recalc/*` for dirty-set collection, range-aware barrier graphs, full and subset topological levels, selective range indexes, and cycle reporting.
- `compute/core/src/eval/*`, `eval_bridge/mirror_context.rs`, and `eval/cache/range_store` for the single formula evaluator, range materialization, workbook caches, and thread-local cache behavior.
- `compute/core/src/storage/engine/recalc.rs` and mutation handlers for user-facing calculate/manual-calc entrypoints and viewport patch consumption.

This is a public Mog source folder. Implementation work belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`scheduler` is the production orchestration layer around the formula evaluator. `ComputeCore` owns the `DependencyGraph`, AST cache, formula text registries, workbook cache domain, SUMIFS cache epoch, range-key precomputation, dirty/manual state, sheet ordering, projection blockers, and deferred graph-build state.

The folder currently exposes several distinct recalculation paths:

- Incremental automatic recalc: `recalc/entrypoints.rs` computes affected cells through `graph.affected_cells`, filters calculation-disabled sheets, then calls `topo_evaluate_cells`.
- Manual recalc behavior: edits update seeds immediately and accumulate `pending_manual_dirty_cells`; formula dependents wait until explicit calculate.
- Full recalc: `full_recalc` reuses `graph.evaluation_levels_full` and calls `topo_evaluate_levels_with_deadline` or `handle_cycles_with_precomputed_levels`.
- Cycle recovery: `cycles.rs` evaluates non-cycle predecessors, cycle SCCs, and downstream dependents, with separate single-pass and iterative modes.
- Projection stabilization: `spill.rs` re-extracts dependencies after dynamic-array projections change so future recalc ordering becomes projection-aware.
- Aggregate prepass: `agg_prepass` resolves or warms groups of COUNTIFS/SUMIFS/AVERAGEIFS/MAXIFS/MINIFS before normal level evaluation.
- Data-table prepass: `data_table_prepass.rs` resolves `TABLE` formulas with mutate-recalc-restore semantics.

The code already recognizes that these paths are not interchangeable. The main improvement opportunity is to make their contracts explicit and shared, while keeping the path-specific scheduling decisions separate.

## Improvement objectives

1. Make recalc-session state explicit: deadline, range store, SUMIFS epoch, metrics, changed/projection/error accumulators, and cache invalidation should be held by a typed session object instead of being manually threaded through each phase.
2. Centralize the duplicated per-level evaluation body in `recalc/passes.rs` without collapsing incremental and full scheduling semantics. The current comment says changes to one loop must be mirrored in the other; that is a correctness risk.
3. Centralize formula result application across sequential and parallel evaluation. Both paths perform spill handling, Null-to-0 coercion, dynamic-array top-left storage, old-value capture, and `CellChange` creation.
4. Make every production recalc phase deadline-aware, not just the main topological loops. Selective fixup and data-table prepass currently start after a deadline check but do not carry the deadline through their inner work.
5. Tighten cycle recovery so incremental cycle handling re-evaluates only necessary non-cycle predecessors and downstream dependents, not every non-cycle formula cell.
6. Preserve projection correctness through selective fixup. `selective_dep_fixup_pass` currently collects `projection_deltas` internally but returns only changes/projections/errors; any projection shape change caused during fixup should be stabilized or returned to callers for stabilization.
7. Replace production debug side effects with structured tracing. `data_table_prepass.rs` has unconditional `eprintln!("[DT-EVAL] ...")` calls during the first few evaluations.
8. Strengthen scheduler-level contract tests so future changes prove full/incremental/manual/cycle/projection/prepass equivalence through production entrypoints.

## Production-path contracts and invariants to preserve or strengthen

- All formula evaluation continues to go through `Evaluator::evaluate()` with `MirrorContext`; no scheduler path gets a private evaluator or test-only shortcut.
- Dependency registration remains graph-first: formula parse and AST cache updates must keep `graph`, `ast_cache`, `formula_strings`, `cell_formula_text`, `formula_text_deps`, volatility, and `cell_range_keys` consistent.
- `RangeAccess::Aggregate`, `RangeAccess::Selective`, and volatile-dynamic references keep distinct scheduling semantics. Selective references must avoid false cycles but still get a production fixup pass when changed range values can affect them.
- Recalc results must include direct seed edits plus formula changes needed by downstream viewport patching. Projection teardown/restoration patches must not contradict regular `CellChange` entries for the same position.
- Dynamic-array source cells store the top-left scalar in column data while retaining the full array in the entry value; ghost projection cells must not be promoted to real values during save/restore paths.
- Per-level evaluation must keep the two-phase parallel contract: parallel read-only evaluation, then sequential application of writes and spill handling.
- RangeStore and lookup caches must be invalidated after any changed cell, spill materialization, or projection range write before later levels or stabilization read those ranges.
- Thread-local caches must be cleared across the rayon worker pool at recalc-session boundaries and at any intra-session boundary where prior values can become stale.
- Manual calculation mode must update direct edits immediately, keep dependent formulas pending, and clear pending dirty cells only after successful explicit full recalc.
- Cycle behavior must remain Excel-compatible: non-iterative cycles use cached/seed values and emit circular diagnostics; iterative cycles respect `max_iterations` and `max_change`.
- Data-table evaluation must always restore input/result/chain cells on success and unwind, preserve ghost-cell raw values, and avoid recursive TABLE prepasses.
- Calculation-disabled sheets remain in the dependency graph but must not be evaluated.
- Public dependency direction stays intact: `mog` and `compute-core` must not depend on `mog-internal`.

## Concrete implementation plan

1. Define a `RecalcSession` and accumulator API in `recalc/session.rs`.

   - Own or borrow the recalc `Deadline`, epoch-scoped `RangeStore`, active SUMIFS epoch, `RecalcMetrics`, `changed_cells`, `projection_changes`, `errors`, and `projection_deltas`.
   - Provide methods for `begin`, `clear_all_thread_local_caches`, `pre_materialize(level)`, `apply_timeout_to_remaining(levels)`, `invalidate_after_level`, `record_projection_metrics`, and `finish`.
   - Move repeated changed-position/projection-range/lookup-cache invalidation logic out of both `topo_evaluate_pass` loops and out of selective fixup.
   - Keep `build_recalc_result` as the boundary that constructs `RecalcResult`, but feed it from the session accumulator.

2. Introduce a typed level executor instead of two hand-maintained loops.

   - Add a `LevelSchedule` abstraction that can represent precomputed full levels or freshly computed incremental subset levels plus cycle cells.
   - Add explicit hooks for path-specific behavior: data-table prepass before levels, aggregate prepass immediately or at trigger level, blocker pre-evaluation, and already-evaluated tracking.
   - Move the common per-level body into one function: pre-materialize ranges, check deadline, emit journal level start, choose sequential/parallel by `PARALLEL_THRESHOLD`, evaluate, invalidate caches, update metrics.
   - Preserve the full-path optimization that avoids recomputing levels and preserve the incremental path's cycle-cell return.

3. Unify sequential and parallel formula result application.

   - Add a `FormulaEvalOutcome { cell_id, sheet_id, value, error, eval_us }`.
   - Make sequential evaluation produce and immediately apply outcomes; make parallel evaluation produce the same outcomes in the read phase and apply them through the same `apply_formula_outcome` method.
   - Put spill handling, Null coercion, dynamic-array top-left storage, old-value capture, error tracking, and journal result recording in one application function.
   - Keep parallelism strictly read-only until the apply phase.

4. Make selective fixup a first-class recalc phase.

   - Thread `Deadline` through `selective_dep_fixup_pass` and check it before candidate evaluation and each downstream cascade level.
   - Return `projection_deltas` or run `projection_stabilize` inside the fixup phase so dynamic-array projections created during fixup cannot leave dependents stale.
   - Use the shared session invalidation helpers for changed cells, projection cells, and lookup-cache columns.
   - Add metrics for selective candidates, evaluated fixups, skipped-by-changed-index cells, downstream cascade cells, and timeout.

5. Rework cycle recovery around a `CycleRecalcPlan`.

   - For full recalc, keep using `evaluation_levels_full` outputs: predecessor levels, SCC cores, and downstream levels.
   - For incremental recalc, compute predecessor and downstream scopes from the dirty affected set and the reported cycle cells rather than evaluating all non-cycle formula cells.
   - Share one cycle handler for both sources: evaluate predecessor levels, seed/evaluate cycle cells, evaluate downstream levels, run selective fixup, then projection stabilization.
   - Thread deadlines into iterative and single-pass cycle evaluation. If the deadline expires, emit deterministic `#CALC!` changes and metrics instead of continuing unbounded.
   - Preserve existing idempotence behavior tested through the user-facing `calculate()` path.

6. Normalize prepass coordination.

   - Give aggregate and data-table prepasses explicit contracts: input dirty set, already-evaluated set, allowed mutations, cache invalidations required, deadline behavior, metrics emitted, and conditions for bail-out.
   - Replace silent blocker-closure cap behavior in `collect_agg_data_column_blockers` with a surfaced metric or diagnostic when the cap is hit.
   - Remove unconditional `eprintln!` from data-table evaluation; use `tracing` or journal-gated events.
   - Make data-table prepass deadline-aware across region grouping, body materialization, each override evaluation, chain-level evaluation, and writeback.
   - Keep mutate-recalc-restore semantics but wrap saved-value restoration in a guard type so unwind safety is structural rather than manually sequenced.

7. Add scheduler contract fixtures and equivalence tests.

   - Build compact workbook fixtures for each scheduling family: plain chains, wide independent levels, manual mode, volatile formulas, calculation-disabled sheets, selective ranges, cycles, projection readers, aggregate groups, wrapped SUMIFS cache warmup, and one-/two-variable data tables.
   - For every applicable fixture, compare production entrypoints: initial full recalc, incremental edit recalc, explicit calculate/manual recalc, and no-op repeated calculate.
   - Assert values, `RecalcResult` patches, projection registry state, graph dependencies, cache invalidation behavior, and metrics where metrics are contractual.
   - Add a regression test where a selective fixup formula produces a new or resized projection and a downstream range reader is corrected by stabilization.

8. Update observability and documentation.

   - Keep the top-level scheduler architecture table, but add the new session/phase contracts and state which modules own each phase.
   - Add tracing spans around prepass decisions, skipped candidates, cycle-plan sizes, selective fixup cascades, timeout application, and projection stabilization recursion.
   - Do not expose new public IPC fields unless metrics consumers need them; prefer internal `RecalcMetrics` additions if already part of the existing result contract.

## Tests and verification gates

Required focused tests during implementation:

- `cargo test -p compute-core scheduler::scheduler_tests`
- `cargo test -p compute-core scheduler::projection_tests`
- `cargo test -p compute-core scheduler::agg_prepass`
- `cargo test -p compute-core scheduler::data_table_prepass`
- `cargo test -p compute-core scheduler::dep_extract`
- `cargo test -p compute-graph` if any graph API, cycle-plan, selective-index, or topo-level logic changes.

Required final gates:

- `cargo test -p compute-core`
- `cargo clippy -p compute-core`
- `cargo test -p compute-graph` and `cargo clippy -p compute-graph` if `compute-graph` changes.

Behavior/performance verification should use production recalc entrypoints (`ComputeCore::init_from_snapshot`, `set_cell`/batch mutation paths, `recalculate_with_options`, and storage-engine calculate paths), not direct state mutation to fake dirty sets. Any performance measurement must run against the production scheduler paths and should record level counts, evaluated cells, prepass hits, selective fixups, projection stabilization runs, cache hits/misses, and timeout behavior.

## Risks, edge cases, and non-goals

Risks:

- Centralizing the per-level loop can accidentally change when the aggregate prepass runs. The implementation must keep immediate incremental prepass and deferred full-recalc prepass as separate hooks.
- Cycle scoping changes can miss predecessor formulas that feed cycles through ranges or projections. The cycle plan must use range-aware graph APIs and projection-aware dependency extraction.
- Deadline enforcement can create new visible `#CALC!` outputs. Tests must define deterministic timeout behavior rather than allowing phases to continue silently.
- Data-table guard refactoring is high risk because it mutates the mirror during evaluation and must restore raw values, not fallback projection values.
- Projection and `CellChange` deduplication can break viewport patching if regular edits and projection teardowns fight for the same position.
- Rayon thread-local cache clearing must keep worker threads in mind; clearing only the main thread is insufficient.

Edge cases to cover:

- Selective range functions reading ranges with formulas that evaluate later in the same recalc.
- Dynamic-array projections created, resized, blocked, unblocked, or removed during main eval, selective fixup, and cycle downstream evaluation.
- Full-column aggregate ranges with formula blockers and spill targets in data or criteria columns.
- Manual calculation edits to plain values, new formulas, volatile formulas, and cycle cells.
- Calculation-disabled sheets with dependents on enabled sheets.
- Deferred minimal/viewport initialization followed by first mutation or explicit recalc.
- Non-iterative cycles, iterative numeric convergence, non-numeric cycle plateaus, and no-op repeated calculate.
- One-variable and two-variable data tables, orphan TABLE-cell region synthesis, and panic/unwind restoration.

Non-goals:

- Do not replace `Evaluator::evaluate()` or introduce a second formula evaluation engine.
- Do not optimize test-only harnesses, mocks, or direct graph fixtures as the primary outcome.
- Do not collapse aggregate, data-table, cycle, full, and incremental paths into one semantic path; only share the mechanics that are actually common.
- Do not change public dependency direction or add any dependency from `mog` to `mog-internal`.
- Do not add compatibility shims that preserve old bugs behind feature flags.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the contracts are written down.

- Agent A: audit and write contract tests for result patching, manual mode, cycle idempotence, selective fixup, projection stabilization, aggregate prepass, and data-table restore semantics.
- Agent B: implement `RecalcSession`, shared accumulator, shared invalidation helpers, and per-level executor mechanics inside `scheduler/recalc`.
- Agent C: implement cycle-plan scoping and any required `compute-graph` API additions, with graph-level tests in `compute/core/crates/compute-graph`.
- Agent D: refactor selective fixup, projection-delta propagation, aggregate/data-table prepass integration, and deadline threading.
- Agent E: run final production-path verification and compare metrics/perf on representative workbook snapshots.

Dependencies:

- `RecalcSession` and shared outcome application should land before large prepass or cycle refactors, because they remove most duplicated mutation/caching code.
- Cycle-plan changes may require `compute-graph` additions; those should be tested independently before scheduler integration.
- Selective fixup projection stabilization can be implemented before the full level-loop unification because it is a localized correctness fix.
- Data-table deadline/restore refactoring should wait until the session cache-clearing API exists, but debug-output removal can be done immediately.
