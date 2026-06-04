# Plan 025 — Harden the recalc scheduler (`mog/compute/core/src/scheduler`)

## Source folder and scope

- **Folder:** `mog/compute/core/src/scheduler` (Rust, `compute-core` crate; ~9.8k LOC of non-test source).
- **Primary files in scope:**
  - `mod.rs` (979 lines) — `ComputeCore`, the top-level orchestrator: owns `DependencyGraph`, AST cache, formula-string registries, sheet ordering, spill-blocker map, schema map, dirty bit, deferred-graph state. Public sheet/named-range/table/schema/parser API.
  - `recalc/` — orchestration: `entrypoints.rs` (public `recalc` / `full_recalc` / `*_with_options`), `passes.rs` (42 KB; the two near-identical per-level evaluation loops `topo_evaluate_pass` and `topo_evaluate_pass_with_levels`), `incremental.rs` (`topo_evaluate_cells`, the 3-phase incremental driver), `full.rs` (`topo_evaluate_levels_with_deadline`), `selective_fixup.rs` (selective-range cascade), `prepass_integration.rs` (agg-blocker pre-eval + `MAX_CLOSURE_SIZE`), `session.rs` (`Deadline`, thread-local cache clearing), `result.rs` (`make_cell_change`, metrics), `cache_invalidation.rs`.
  - `level_eval.rs` (482 lines) — parallel (rayon, `#[cfg(feature = "native")]`) vs sequential per-level evaluation; `PARALLEL_THRESHOLD = 500`.
  - `cycles.rs` (986 lines) — SCC handling, seeding, single-pass and iterative convergence, three-pass cycle recalc.
  - `spill.rs` (669 lines) — dynamic-array spill, teardown projection changes, `projection_stabilize` (`MAX_DEPTH = 5`), spill-blocker bookkeeping.
  - `data_table_prepass.rs` (884 lines) — TABLE mutate-recalc-restore prepass with `catch_unwind`.
  - `agg_prepass/` (`mod.rs`, `hashmap.rs`, `pattern.rs`, `sorted_range.rs`) — SUMIFS/COUNTIFS/AVERAGEIFS group batching, `AGG_MIN_GROUP_SIZE = 8`.
  - `dep_extract/` (`mod.rs`, `visitor.rs`, `refs.rs`, `policy.rs`, `formula_text.rs`) — AST→`DepTarget` extraction with Aggregate/Selective/Volatile taxonomy.
  - `edit.rs` (1067 lines) — `WriteTrust`, CSE/data-table region partial-write guard, edit processing + projection invalidation.
  - `init.rs` (852 lines) — four init modes (full / no-recalc / minimal / viewport-only) and `ensure_graph_built` (deferred graph construction).
  - `formula_reg.rs`, `schema_validation.rs`, `cf_eval.rs`, `ast_transform.rs`, `input.rs`, `resolvers.rs`, `value_utils.rs`, `solver_methods.rs`.
- **Adjacent code touched only as dependency (not edited blindly):**
  - `compute/core/src/graph/` — `DependencyGraph`, `affected_cells`, `subset_levels`, `evaluation_levels_full`. The scheduler is the primary consumer.
  - `compute/core/src/eval/` — `Evaluator::evaluate`, `MirrorContext`, `WorkbookCache`, range store, clock.
  - `compute/core/crates/types/snapshot-types/src/recalc.rs` — `RecalcResult` / `RecalcMetrics` (already carries `timed_out`, `has_circular_refs`, `projection_conflicts`, `agg_prepass_*`, etc.). New diagnostic fields would land here.
  - `compute_functions::helpers::sumifs_result_cache` — the SUMIFS cache domain/epoch the scheduler owns and seeds.

This is a **production-path** plan: it strengthens correctness, observability, and maintainability of the live recalc engine. It is not a test-only, reduced-scope, or shim plan.

## Current role of this folder in Mog

`scheduler/` is the recalculation engine of the Rust compute core. `ComputeCore` ingests cell edits, structural changes, and snapshot loads; parses formulas into a cached AST; extracts dependencies into a `DependencyGraph`; and evaluates dirty cells in topological order, returning a `RecalcResult` (changed cells, projection changes, errors, validation annotations, metrics) that the engine layer fans out to the viewport, CRDT storage, and UI.

It converges every evaluation path onto a single `Evaluator::evaluate` core via a `MirrorContext` adapter, but deliberately keeps four **orchestration** strategies separate because their invariants are incompatible (documented in `mod.rs:9-43`):
- **Incremental topo** (`recalc/passes::topo_evaluate_pass`) — computes fresh levels from the dirty set via `graph.subset_levels`.
- **Full topo** (`recalc/passes::topo_evaluate_pass_with_levels`) — consumes pre-computed global levels from `evaluation_levels_full`.
- **Cycle recovery** (`cycles::handle_cycles_and_recalc`) — SCC analysis, null→0.0 seeding, optional iterative convergence.
- **Data-table prepass** (`data_table_prepass::run_data_table_prepass`) — per-(row,col) input override with per-write cache invalidation.

Layered on top are two performance prepasses (aggregation batching, agg-blocker pre-eval), dynamic-array spill with bounded projection stabilization, schema validation, and conditional-formatting evaluation. Parallelism is level-batched via rayon on native and a single-threaded fallback on WASM, gated throughout by `#[cfg(feature = "native")]`.

The code is mature and carefully commented; the improvement opportunities are concentrated in **silent degradation paths**, **a documented cross-sheet correctness gap**, **structural duplication that forces manual mirroring of bug fixes**, and **panic-on-invariant points** — not in gross algorithmic defects.

## Improvement objectives

1. **Make silent degradation observable and bounded — never silently wrong.** Several paths bail out or abort and log only via `tracing`, which is invisible to callers, tests, and product telemetry. Each should set a typed signal in `RecalcMetrics` (mirroring the existing `timed_out` precedent at `recalc.rs:86`) so the engine/UI can distinguish "fully recalculated" from "degraded":
   - **Projection stabilization max-depth abort** (`spill.rs:197-200`): `if depth >= MAX_DEPTH` returns empty and logs `tracing::error!` only. A deep TRANSPOSE/spill cascade past depth 5 can leave **stale spilled values** with no signal to the caller.
   - **Projection stabilization deadline abort** (`spill.rs:205-208`): same silent-empty return when the recalc deadline passes mid-stabilization.
   - **Agg-prepass blocker bail-out** (`recalc/passes.rs:60-163`, `recalc/prepass_integration.rs:76-118`): when a data-column formula blocker is not pre-evaluated, or the blocker transitive closure exceeds `MAX_CLOSURE_SIZE = 10_000`, the prepass silently falls back to ordinary topo eval. Correctness is preserved but a large perf cliff is invisible.
   These are not equivalent in severity: the projection-stabilization aborts are a **correctness** risk (wrong displayed values); the agg bail-out is a **performance** risk. The plan treats them accordingly (see implementation Phase 1).

2. **Close the cross-sheet schema-validation correctness gap.** `schema_validation.rs:108-118` carries an explicit `TODO(P1)`: column schemas whose formula constraints reference cells on *other* sheets are not revalidated when those cells change, because the transitive pass only expands within already-dirty sheets. A constraint on Sheet2 referencing a changed Sheet1 cell silently keeps a stale validation verdict. Parse the constraint AST once (reusing `dep_extract`'s visitor), extract its sheet references, and expand the revalidation dirty-sheet set to include them.

3. **Collapse the `passes.rs` duplication without losing the agg-prepass entanglement.** `topo_evaluate_pass` (lines ~20-452) and `topo_evaluate_pass_with_levels` (lines ~461-929) share a structurally identical per-level body (pre-materialize ranges → deadline check → parallel/sequential dispatch → dirty invalidation → cache invalidation). The header comment (`passes.rs:11-19`) explicitly warns that "any changes to the per-level body must be mirrored." That is a standing latent-bug source: a fix applied to one loop and forgotten in the other will diverge incremental vs full recalc. Extract the shared per-level step into one private helper that both loops call, threading the agg-prepass mutable state through an explicit small struct rather than 6+ loose locals — so the duplication risk is removed while the two *outer* strategies (subset-levels+cycle-detection vs pre-computed-levels+deferred-agg-prepass) stay distinct.

4. **Remove production panic points on internal invariants.** `recalc/passes.rs:35` and `:712` call `.expect("SUMIFS cache epoch must be initialized …")`. If any future entry path reaches level evaluation without `begin_sumifs_cache_epoch()` having run, the engine aborts the whole WASM/native process instead of degrading. Establish the epoch at a single choke point (or return a `ComputeError` instead of panicking) so the invariant is enforced structurally rather than by a process-killing assertion.

5. **Make the recalc-timeout outcome legible end-to-end.** On deadline overrun, `passes.rs:283-304` writes `#CALC!` into every remaining cell and pushes a `CellErrorInfo`. `metrics.timed_out` is the one signal, but the `#CALC!` cells are indistinguishable downstream from genuinely-errored cells. Confirm (Phase 0) whether the engine/UI surface `timed_out` distinctly; if not, ensure timeout-induced errors are tagged (e.g. a distinct `CellErrorInfo.error` reason or an `extra_flags` bit) so a transient timeout is never mistaken for a permanent formula error, and so re-running recalc is the obvious remedy.

6. **Centralize and document the deferred-graph-build contract.** `ensure_graph_built` (`init.rs`) is called defensively at the top of `recalc_automatic`, `recalc_manual_edit`, and `full_recalc`. Audit every public mutation/recalc entry on `ComputeCore` to confirm none can touch the graph before it is built (the `deferred_formula_cells`/`deferred_snapshot` minimal-init path). Document the invariant in `mod.rs` and add a single debug assertion in the graph-touching helpers so a missing call fails loudly in tests rather than producing empty results in production.

7. **Tighten allocation/clone hotspots on the large-recalc path (lower priority, measured-first).** The result-collection and seed-merge paths in `recalc/entrypoints.rs:53-117` clone cell-id strings and rebuild `FxHashSet<&str>` dedup sets per call; `passes.rs` flattens per-cell range keys each level. These are deliberate trade-offs today, but on million-cell recalcs they compound. Any change here is **gated on profiling evidence** (Phase 4) and must not alter output ordering, which downstream viewport patching depends on.

## Production-path contracts and invariants to preserve or strengthen

- **Single evaluator core.** Every path must keep routing through `Evaluator::evaluate` + `MirrorContext`; orchestration may differ but evaluation semantics must not fork. (Preserve.)
- **Result completeness & ordering.** `RecalcResult.changed_cells` must continue to include both directly-edited non-formula seed cells *and* recomputed formula cells, with seed edits ordered before formula dependents and deduplicated (`entrypoints.rs:99-110`, `:169-180`). Viewport buffer patching relies on this. (Preserve — must be re-asserted by any refactor in Phase 3/4.)
- **The four orchestration strategies stay distinct.** Objective 3 deduplicates the *inner per-level body only*; it must not merge subset-level computation with pre-computed-level consumption, nor fold cycle/data-table handling into the topo loops. (Preserve the boundary documented in `mod.rs:20-32`.)
- **Region atomicity via `WriteTrust`.** `UserEdit` must keep rejecting partial writes into CSE/data-table regions; `TrustedReplay` must keep skipping the guard for Yrs replay and array re-materialization (`edit.rs:27-130`). (Preserve.)
- **Cycle seeding semantics.** Null/Circ/Text/Bool cycle cells seed to 0.0; numeric values warm-start; non-circular errors flow through; unresolved cells become `#CIRC!` (`cycles.rs:182-252`). Excel-declaration-order evaluation via `sheet_order` must be preserved. (Preserve.)
- **Thread-local cache hygiene.** `clear_thread_local_caches` must keep broadcasting across all rayon workers on native (`session.rs:34-37`); skipping any thread-local risks stale SUMIFS/sorted/frequency cache hits keyed by pointer identity. Objective 4's epoch change must not weaken this. (Preserve/strengthen.)
- **Calculation-mode and calc-enabled filters.** Manual mode reflects only direct edits (no `affected_cells` walk); cells on calc-disabled sheets are filtered out of evaluation but retain last values (`entrypoints.rs:86-94`, `:160-167`; `full_recalc` filter `:230-249`). (Preserve.)
- **ID-allocator sharing.** The `Arc<IdAllocator>` shared with the grid allocator in collaborative mode must remain the single source of `CellId`s to avoid ghost/real collisions (`mod.rs:166-275`). (Preserve.)
- **Deferred-import readback split.** `cell_formula_text` (document identity, cell-only) vs `formula_strings` (includes synthetic variable/named-range formulas) must remain distinct; readback uses the former (`mod.rs:174-182`, `full_recalc` orphan re-registration `entrypoints.rs:213-228`). (Preserve.)
- **WASM/native parity of *results*.** Native parallelism and the extra `WorkbookCache`/`LookupIndexCache` invalidation are perf-only; they must never change computed values vs the WASM single-threaded path. Any new metric or signal must be populated identically on both targets. (Preserve — this is the core regression risk for Objectives 1, 3, 4.)

## Concrete implementation plan

**Phase 0 — Evidence (must complete before editing):**
- Confirm how the engine layer consumes `RecalcMetrics.timed_out` and `CellErrorInfo` today (search `compute/core/src` and the kernel bridge) to decide Objective 5's tagging mechanism and to size the new metric fields for Objective 1.
- Confirm whether `projection_stabilize`'s max-depth/deadline aborts are reachable in any current scenario (grep cycle + spill tests, check `projection_tests/stabilization.rs`) so the new signal is testable, not theoretical.
- Map every `ComputeCore` public method that reads/mutates `self.graph` and verify the `ensure_graph_built` coverage for Objective 6 (enumerate against the minimal-init deferred path).
- Diff the two `passes.rs` per-level bodies line-by-line to produce the exact shared-step signature for Objective 3 (inputs: level slice, deadline, range store, dirty accumulators, metrics; outputs: changes/projection deltas/errors).

**Phase 1 — Observable degradation (Objective 1):**
- Add typed fields to `RecalcMetrics` (`recalc.rs`): e.g. `projection_stabilization_truncated: bool`, `agg_prepass_fallbacks: u64`, `agg_blocker_closure_capped: bool`. Default-false/zero, populated on both targets.
- In `spill.rs`, set the truncation flag (and keep the existing `tracing` log) when `depth >= MAX_DEPTH` or the deadline aborts, threading the metric up through the stabilization return into `RecalcResult.metrics`. **Investigate** whether `MAX_DEPTH = 5` is a real semantic bound or a guard — if cascades legitimately exceed it, the fix is to make stabilization iterate to a fixpoint with a much higher safety cap, not just report truncation; pick based on Phase 0 evidence.
- In `recalc/passes.rs` / `prepass_integration.rs`, increment the fallback counter on each agg-prepass bail-out and set the closure-cap flag when `MAX_CLOSURE_SIZE` is hit.

**Phase 2 — Cross-sheet schema validation (Objective 2):**
- In `schema_validation.rs`, for each formula-constraint schema, parse the constraint expression (reuse `dep_extract::visitor` / `parse_formula`), collect referenced `SheetId`s, and union them into the dirty-sheet set driving the transitive revalidation pass. Cache the parsed constraint AST per schema key to avoid reparsing every recalc.
- Remove the `TODO(P1)` comment only once the path is covered by a regression test (Phase 5).

**Phase 3 — Deduplicate the per-level loop (Objective 3):**
- Introduce a small `LevelEvalCtx` struct holding the mutable per-level state (range store, dirty positions/ranges, lookup-index columns, metrics refs) and a private `eval_one_level` helper containing the shared body.
- Rewrite both `topo_evaluate_pass` and `topo_evaluate_pass_with_levels` to call `eval_one_level`, keeping their distinct outer control flow (subset-levels+cycle detection; pre-computed levels + deferred agg prepass that mutates the level array between calls).
- Delete the "must be mirrored" warning comment once the body is single-sourced.

**Phase 4 — Invariant hardening (Objectives 4 & 6):**
- Replace the two SUMIFS-epoch `.expect()`s with either a guaranteed single establishment point at the top of each public recalc entry, or a `ComputeError::Internal` return; never panic in production.
- Add a debug-assert + doc comment for the deferred-graph contract on graph-touching helpers; confirm no public entry bypasses `ensure_graph_built`.

**Phase 5 — Timeout legibility & allocation tuning (Objectives 5 & 7):**
- Implement the timeout tagging chosen in Phase 0 (distinct error reason or `extra_flags` bit on timeout `#CALC!` cells).
- Only if Phase 0 profiling shows the seed-merge/clone paths are material on large recalcs: replace per-call `String` clones in `entrypoints.rs` dedup with borrowed `&CellId` keys and reuse scratch buffers. Re-assert result ordering with existing tests before and after.

## Tests and verification gates

> Per task constraints, this plan **does not run** cargo/build/test; the gates below are what an implementer must satisfy. Tests live in `scheduler/scheduler_tests/`, `scheduler/projection_tests/`, `agg_prepass/tests/`, and `dep_extract/tests/`.

- **No behavior regression (results identical):** full `scheduler_tests` suite (`cell_edits`, `cycles`, `dependency_levels`, `formula_behaviors`, `parallel_recalc`, `sheet_spill`, `variables`, `init`) must pass unchanged. This is the gate for the Phase 3 refactor and Phase 4/5 changes — computed values, change ordering, and projection output must be byte-identical.
- **WASM/native parity:** run the suite under both `--features native` and the WASM single-threaded configuration; any new metric must populate identically and no value may differ across targets.
- **Objective 1:** new tests asserting `metrics.projection_stabilization_truncated` flips on a synthetic >5-deep spill cascade, and `agg_prepass_fallbacks`/closure-cap flag increment on the bail-out scenario. If Phase 1 chooses fixpoint iteration instead of truncation, add a test proving the deep cascade now converges to correct values.
- **Objective 2:** regression test in `schema_validation`-adjacent tests: a cross-sheet formula constraint (Sheet2 constraint referencing a Sheet1 cell) revalidates when the Sheet1 cell changes. This must fail on `main` and pass after the fix.
- **Objective 4:** test exercising a recalc entry path that previously could miss epoch init now returns a `ComputeError` (or succeeds) rather than panicking; the deferred-graph debug-assert fires in a unit test that intentionally skips `ensure_graph_built`.
- **Objective 5:** test that a forced sub-`Duration` `recalc_timeout` produces `metrics.timed_out == true` *and* timeout-tagged error cells distinguishable from genuine `#CALC!`.
- **Performance gate (Objective 7 + Phase 3):** if any allocation change lands, capture before/after timings on the existing large-recalc benchmark fixtures (the 263K / "stress-many-sheets" style cases referenced in the prepass comments) to prove no regression; the Phase 3 refactor must show no measurable slowdown on `parallel_recalc` paths.
- **Static gates:** `cargo clippy` clean and `cargo fmt` for the touched files (run by the implementer, not this planner).

## Risks, edge cases, and non-goals

- **Highest risk — Phase 3 refactor silently changing per-level behavior.** The two loops differ subtly in *where* the agg prepass mutates the level array; extracting the shared body must not reorder pre-materialization vs deadline check vs dirty invalidation. Mitigation: line-by-line Phase 0 diff, and the "results identical" gate above. If the diff reveals the bodies are *not* truly identical, scope Objective 3 down to documenting the divergence precisely rather than forcing a merge.
- **`MAX_DEPTH` semantics unknown until Phase 0.** If depth-5 is a correctness ceiling Excel never exceeds, reporting truncation is sufficient; if real workbooks exceed it, only fixpoint iteration fixes the stale-value bug. Choosing wrong wastes effort — hence the explicit investigation gate.
- **Cross-sheet constraint parsing cost.** Reparsing constraint formulas every recalc would regress; the parsed-AST cache is mandatory, and cache invalidation must hook schema update/remove (`mod.rs:859-905`).
- **Thread-local cache and epoch coupling.** Objective 4's epoch change sits next to the rayon broadcast cache clearing; getting the order wrong reintroduces stale-SUMIFS cache hits. Treat `begin_sumifs_cache_epoch` + `clear_thread_local_caches` ordering as a single invariant.
- **Metric struct growth is a wire-contract change.** New `RecalcMetrics` fields cross the snapshot-types boundary consumed by the kernel/TS layer; additions must be backward-compatible (default values) and may require a `@mog-sdk/contracts` declaration rollup on the consumer side — coordinate, do not edit those files under this folder's scope.
- **Non-goals:** no change to formula *evaluation* semantics (that lives in `eval/`, `compute-functions`, `compute-parser`); no change to the `DependencyGraph` algorithms beyond what the scheduler calls; no new public `ComputeCore` API surface; no rework of the four-strategy split; no reduced-scope or test-only shims; no compatibility layers for old metric shapes beyond default-valued additions.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable work units** (different files, low conflict): Objective 1 (`spill.rs` + `prepass_integration.rs`), Objective 2 (`schema_validation.rs`), Objective 5 timeout tagging (`recalc/passes.rs` + engine surface). These can proceed concurrently once Phase 0 lands.
- **Serialized:** Objective 3 (`passes.rs` dedup) should land **before** Objective 5's timeout-tagging edits to the same file to avoid churn; Objective 4's epoch change touches `passes.rs` too and should be sequenced after Phase 3.
- **Cross-folder dependencies:**
  - `crates/types/snapshot-types/src/recalc.rs` — owns `RecalcMetrics`/`RecalcResult`; new fields land here and ripple to any consumer (kernel compute bridge, TS contracts). Requires the contracts declaration rollup before TS consumers typecheck (see `[[mog-contracts-declaration-rollup]]`).
  - `compute/core/src/graph/` — Objective 6's audit depends on graph-API call sites but does not modify the graph.
  - `compute/core/src/eval/cache/` — `WorkbookCache`/range store/thread-local caches interact with Objectives 1 and 4; read-only dependency unless the epoch fix needs a hook there.
  - `compute_functions::helpers::sumifs_result_cache` — the epoch API surface for Objective 4.
- No dependency on the dirty pre-existing `dev/api-eval` / `dev/app-eval` scenario files; this plan is compute-core internal and does not require eval-harness scenarios, though a follow-up app-eval scenario for cross-sheet validation (Objective 2) would be a reasonable separate task.
