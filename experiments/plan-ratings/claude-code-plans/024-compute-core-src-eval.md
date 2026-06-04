# Plan 024 — Harden and complete the production formula evaluation engine (`compute/core/src/eval`)

## Source folder and scope

- **Public source folder:** `mog/compute/core/src/eval`
- **Size:** ~25k LOC total; ~17.7k LOC of non-test production code across 60+ files.
- **In scope:** the evaluator engine and its subsystems —
  - `engine/` — recursive-descent AST evaluator (`evaluator.rs`), function dispatch (`eval_primitives.rs`), operators, aggregates, statistical/logical primitives, higher-order LAMBDA forms, reference resolution, special forms.
  - `context/` — the `EvalDataAccess` (async) / `EvalMetadata` (sync) / `DataSource` trait hierarchy and the `sync_block_on` bridge (`context/traits.rs`).
  - `cache/` — the six-tier cache hierarchy: `workbook_cache`, `epoch_cache`, `range_store`, `subexpr_cache`, `lambda_cache`, `database_cache`, plus `range_version`/`versioned_entry`.
  - `lookup/` — INDEX/MATCH/VLOOKUP/HLOOKUP/XLOOKUP dispatch and the lookup index.
  - `functions/` — evaluation-aware function dispatch (SUMPRODUCT, SUBTOTAL, GETPIVOTDATA, conditional-aggregate borrowed paths).
  - `coordination/` — `vectorized/` columnar evaluation and `iterative_solver` (circular-reference convergence). **Both are currently `#[allow(dead_code)]` staged subsystems.**
  - `eval_value.rs`, `external.rs`, `clock.rs`, `mod.rs`.
- **Out of scope (depended upon, not edited here):** `compute_parser` (AST), `value_types` (`CellValue`/`CellError`), `compute_functions` (the ~435 `PureFunction` registry), `eval_bridge/` (the `MirrorContext`/`OverrideContext` impls of the traits), `scheduler/` (the recalc orchestration that calls `Evaluator::evaluate`). These are named where the eval contract crosses into them.

## Current role of this folder in Mog

This is **the** production formula evaluation path. Every recalc, conditional-format evaluation, cycle solve, and what-if solver run funnels through `Evaluator::evaluate(node, data, meta)` (entry points observed in `scheduler/level_eval.rs`, `scheduler/cycles.rs`, `scheduler/cf_eval.rs`, `scheduler/solver_methods.rs`, and `eval_bridge/override_context.rs`).

The engine is an async recursive-descent walker over `ASTNode`. The async-ness exists to support demand-driven, DAG-parallel evaluation on native (rayon thread pool); on the synchronous contexts it is driven to completion by `sync_block_on`, which polls once and panics on `Pending`. The evaluator owns data reads exclusively via `EvalDataAccess` and hands `&dyn EvalMetadata` to pure functions. Values flow as the evaluator-internal `EvalValue` (which adds `Lambda`/`Omitted` variants over `CellValue`) and collapse to `CellValue` at the boundary, with `Lambda`/`Omitted` becoming `#CALC!`.

Roughly 41 functions are handled as **evaluator primitives** (they need AST access, short-circuiting, scope, or reference construction); the remaining ~435 fall through to the `GLOBAL_REGISTRY` `PureFunction` dispatch after argument pre-evaluation.

## Improvement objectives

Ranked, all on the production path. No reduced scope, shims, or test-only fixes.

1. **O1 — Eliminate per-call allocation and linear string dispatch in the hottest path.** `eval_function` runs `let upper = name.to_uppercase()` (a fresh heap `String`, Unicode-folding) on *every* function invocation, then matches it against a ~90-arm `&str` match. `engine/reference_area.rs:262` repeats the `to_uppercase` allocation, and `engine/eval_state.rs:52` does `name.to_ascii_uppercase()` then re-uppercases each scope key in a loop on every variable resolution. Replace with allocation-free, case-insensitive dispatch driven by a resolved function identity.
2. **O2 — Finish the `EpochCache` migration and make epoch-scoped caching parallel-correct by construction.** The subexpression cache (`cache/subexpr_cache.rs`) and the sheet-name normalization cache (in `mirror/`) are `thread_local! + RefCell` stores whose canonical owner is meant to be `cache/epoch_cache.rs` (`EpochCache`), per the in-file `TODO(full-migration)` notes. Today `EpochCache` is `#[allow(dead_code)]` and only collects stats. Thread the epoch cache through the evaluator so the thread-locals can be retired.
3. **O3 — Resolve the two staged `coordination/` subsystems on the production path.** `coordination/vectorized` (columnar vectorized eval) and `coordination/iterative_solver` (circular-reference iteration) are fully built, tested, and `#[allow(dead_code)]`, but not wired into any caller outside `eval/`. Wire them into the recalc/solve path (preferred — they exist to be used) or remove them. This plan drives the wiring.
4. **O4 — Implement What-If Data Tables (`TABLE()`).** `eval_primitives.rs` returns `#CALC!` for the parser-synthesized `TABLE()` pseudo-function — a real product gap. Implement input-cell substitution + per-cell result re-evaluation.
5. **O5 — Wire the dormant `database_cache` tier into the D-functions.** `cache/database_cache.rs` exists but DSUM/DGET/etc. re-parse headers/rows/criteria from scratch every call (confirmed by the comment at `eval_primitives.rs:204`).
6. **O6 — Make the per-formula deadline the primary safety guard and thread it through all entry points.** `Evaluator::evaluate` sets `deadline: None`; only `evaluate_with_deadline` arms it. The global `MAX_OPERATIONS = 10_000_000` constant both over-kills legitimate large recalcs and is the only backstop on the common path.

## Production-path contracts and invariants to preserve or strengthen

These must hold after every change. They are the acceptance bar for the work below.

- **Value boundary:** `EvalValue::Lambda`/`Omitted` must never escape to storage/wire/formatting; they collapse to `#CALC!` exactly at `into_cell_value()` (eval_value.rs). Any new dispatch path must keep this collapse.
- **Trait split:** `EvalDataAccess` reads stay owned by the `Evaluator`; functions only ever receive `&dyn EvalMetadata`. Do not leak data reads to functions.
- **Error semantics:** error propagation, `#NAME?` for unknown functions, and arity validation (`min_args`/`max_args` → `#VALUE!` with message) currently live in the registry fallthrough. Any interned-dispatch rework (O1) must preserve identical error values and messages.
- **Excel-compatible case folding:** function/name matching is ASCII case-insensitive. Switching from `to_uppercase()` (Unicode) to ASCII folding (O1) is a *correctness improvement* but must be verified to not change behavior for any currently-recognized name.
- **Epoch isolation:** epoch-scoped caches (subexpr, sheet-name, sorted/frequency) must be empty at epoch entry and never leak across epochs or across rayon worker threads. O2 must preserve this; the current thread-local clear-on-`EpochCache::new()` behavior is the reference semantics.
- **Determinism under parallelism:** native eval runs on a rayon pool. Results must be identical to single-threaded WASM eval for the same workbook. Cache wiring (O2/O5) and vectorization (O3) must not introduce order-dependent results.
- **`sync_block_on` invariant:** the synchronous contexts resolve `EvalDataAccess` immediately; the panic-on-`Pending` guard is intentional. Do not silently swallow `Pending`.
- **Safety limits:** `MAX_DEPTH`, `MAX_SCOPE_DEPTH`, and a recursion/operation/time bound must remain enforced. O6 may change *which* guard is primary but must not weaken the guarantee that no formula can run unbounded.
- **Subexpr cache soundness:** keying is FxHash + full-AST `PartialEq` collision check, and only array results are cached, with volatile/position-dependent subtrees excluded (`is_cacheable`). Preserve all three.

## Concrete implementation plan

### Phase 0 — Evidence & decision gate (blocking for O3)
- Confirm with the compute owners whether `coordination/vectorized` and `coordination/iterative_solver` are intended for activation this cycle or for removal. The code is complete and tested but unwired; the decision changes the rest of O3. Record the decision in this plan before starting O3 implementation.
- Capture a baseline recalc benchmark on representative large workbooks (heavy SUM/SUMIFS/VLOOKUP/lambda workloads) so O1/O2/O5 wins are measurable. (Benchmark harness lives outside this folder; coordinate, do not author here.)

### Phase 1 — O1: allocation-free function dispatch
1. Introduce a `FunctionId` (or reuse the registry's existing id space) resolved **once at parse time** and stored on `ASTNode::Function`, or — if touching the AST is undesirable — resolve to an interned id via a `&'static` perfect-hash map keyed on an uppercased *stack* buffer (ASCII names are short; use `to_ascii_uppercase` into a `SmallVec`/`[u8; N]` with a heap fallback only for pathological lengths).
2. Replace the `match upper.as_str()` ladder in `engine/eval_primitives.rs` with a match on the resolved id for the ~41 evaluator primitives; route the remainder to the registry by id (the registry already supports id lookup — `get_by_name`/`get_by_id`).
3. Apply the same ASCII-fold-without-alloc fix to `engine/reference_area.rs:262` and to the scope-variable lookup loop in `engine/eval_state.rs:52` (compare with `eq_ignore_ascii_case` instead of re-allocating each key).
4. Keep the LET/LAMBDA early-return and the operator-alias pre-check (`eval_operator_function_alias`) intact.

### Phase 2 — O2: complete the EpochCache migration
1. Thread an `&EpochCache` (or an epoch handle) through `Evaluator::evaluate*` → `eval_node_inner` → the subexpr get/insert sites, replacing the `thread_local!` in `cache/subexpr_cache.rs` with field access on `EpochCache`. This is the touch-list the TODOs name: `evaluator.rs`, `eval_primitives.rs`, and call sites.
2. Move the sheet-name normalization cache the same way (its thread-local lives in `mirror/`; the `EpochCache::sheet_names` field is its canonical home).
3. Reduce the subexpr insert cost: today every insert does `node.clone()` of the full AST subtree for collision verification. Store a reference/owned-once handle or an `Arc<ASTNode>` shared with the cache key so the clone is amortized, preserving the `PartialEq` collision check.
4. Delete the now-dead `thread_local!` backing stores and drop `#[allow(dead_code)]` from `epoch_cache`.

### Phase 3 — O3: resolve staged coordination subsystems (gated on Phase 0)
- **If activating `iterative_solver`:** wire it into `scheduler/cycles.rs`/`solver_methods.rs` behind the workbook iterative-calculation setting (max iterations + max change), feeding the evaluator's per-cell results into the convergence loop. Preserve the existing non-iterative `#CIRC!`/error behavior when the setting is off.
- **If activating `vectorized`:** wire `detect_groups`/`order_groups`/`execute_group` into the recalc coordinator for uniform-column formula groups (the "fill-down a column of identical-shape formulas" case), with a scalar fallback for any group that fails pattern extraction. Guard behind a feature flag for staged rollout, and assert result-equality vs scalar eval in the verification gate.
- **If removing either:** delete the module, its tests, and the `coordination/mod.rs` wiring, and remove the now-unneeded `#[allow(dead_code)]`. Do not leave staged-but-dead code as the steady state.

### Phase 4 — O4: What-If Data Tables
1. Implement `TABLE()` evaluation in `eval_primitives.rs`: the parser synthesizes `TABLE(row_input_cell, col_input_cell)` for data-table cells. For each cell in the table body, substitute the row/column input values into the referenced input cell(s) and re-evaluate the result formula.
2. This requires a substitution-aware data-access shim (an `OverrideContext`-style overlay already exists in `eval_bridge/`); reuse that mechanism rather than mutating the mirror. Keep substitution scoped per table cell to avoid cross-contamination.
3. Bound the work (a data table is `rows × cols` re-evaluations) by the same deadline/operation guard as O6.

### Phase 5 — O5: D-function database cache
1. In the D-function arm of `eval_primitives.rs`, when `args[0]` (and the criteria range) are `ASTNode::Range`, extract coordinates and consult `cache/database_cache.rs` for a parsed header/row/criteria structure keyed by range + column versions (`col_version` already exists on `EvalMetadata`/`DataSource` for staleness).
2. Fall back to the current scratch evaluation when ranges are non-static or the cache reports staleness.

### Phase 6 — O6: deadline as primary guard
1. Add a deadline to the common `Evaluator::evaluate` entry by threading the recalc-session deadline from the scheduler entry points, so the wall-clock guard (already implemented in `tick()` via `DEADLINE_CHECK_INTERVAL`) is always armed.
2. Keep `MAX_DEPTH`/`MAX_SCOPE_DEPTH` as hard structural limits; reposition `MAX_OPERATIONS` as a generous backstop rather than the primary kill switch.

## Tests and verification gates

> Per task constraints this plan does **not** run build/test/typecheck commands. The gates below are what the implementer must satisfy.

- **Existing eval test suite (`eval_tests/`) stays green** — basics, coercion, lookups, range_ops, let_lambda, array_context, advanced_arrays, error_propagation, sumproduct, subtotal, dynamic_refs, wildcard_and_coercion, argument_validation, function_boundaries. These encode the contracts above and are the primary regression net.
- **O1:** add a dispatch table that asserts every previously-recognized function name (all casings, including mixed Unicode-vs-ASCII forms) resolves to the same handler/registry id and produces identical results and error messages. Differential test: random formula corpus, old vs new dispatch.
- **O2:** epoch-isolation tests — assert subexpr/sheet-name caches are empty at epoch entry on every rayon worker; assert native (multi-thread) and WASM (single-thread) produce identical results for a SMALL(IF(...))-style workload that exercises the cache; assert no cross-epoch leakage after a dirty-set change.
- **O3 (vectorized):** result-equality assertion between vectorized group execution and scalar eval for every test group (the suite in `coordination/vectorized/tests.rs` already exists — extend it to run behind the production wiring). **(iterative):** convergence and non-convergence (`#NUM!`/max-iter) cases against the workbook iterative-calc setting.
- **O4:** Data Table fixtures (one-variable row, one-variable column, two-variable) with known expected grids; verify substitution isolation and deadline bounding.
- **O5:** D-function results identical with cache on vs off; staleness test mutating the database range mid-session and confirming recomputation.
- **O6:** a pathological formula hits the deadline and returns the timeout error on the common entry path (previously only `MAX_OPERATIONS` would catch it).
- **Cross-cutting:** run the app-eval / api-eval recalc scenarios as the integration gate, and the captured Phase-0 benchmark to confirm O1/O2/O5 did not regress (target: net improvement on function-heavy recalc).

## Risks, edge cases, and non-goals

- **Risk — dispatch rewrite changes a subtle case (O1):** Unicode `to_uppercase()` and ASCII folding differ for non-ASCII names. Mitigation: differential test over the full registry name set; treat any divergence as a finding, not a silent change.
- **Risk — epoch-cache threading is invasive (O2):** it touches the evaluator's core call stack and every cache site. Mitigation: land it as a pure refactor first (behavior-identical, thread-locals still present behind the new façade), then delete the thread-locals in a second step.
- **Risk — vectorization correctness (O3):** columnar paths are where Excel-compat divergences hide (mixed types, errors mid-column, implicit intersection). Mitigation: feature-flag, scalar fallback per group, mandatory equality gate.
- **Risk — Data Table cost blowup (O4):** large tables are `rows × cols` evaluations. Mitigation: deadline bounding (O6) and reuse of the override overlay rather than mirror mutation.
- **Edge cases to honor:** volatile/position-dependent subtrees excluded from subexpr cache; booleans-from-references vs literal-booleans in aggregates (the `DenseBoolMask` contract); hidden-row handling in SUBTOTAL/AGGREGATE; spill-range (`ANCHORARRAY`/`#`) and implicit-intersection semantics; external references currently returning unavailable (out of scope unless external-links work is separately prioritized — `external.rs` scaffold exists but is not part of this plan).
- **Non-goals:** implementing external workbook links (separate effort); changing the `PureFunction` registry in `compute_functions`; altering `compute_parser` AST shape beyond an optional resolved-id field for O1; rewriting the async/sync bridge; any test-only or shim fix that does not move the production path.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable:** O1 (dispatch), O4 (Data Tables), O5 (D-function cache) touch largely disjoint files and can proceed concurrently after Phase 0.
- **Sequenced:** O2 (epoch-cache threading) modifies the evaluator core call stack; land it before or carefully merge-coordinated with O1 to avoid churn in `eval_primitives.rs`/`evaluator.rs`.
- **Cross-folder dependencies:**
  - `scheduler/` (`level_eval.rs`, `cycles.rs`, `cf_eval.rs`, `solver_methods.rs`) — entry points must pass the deadline (O6) and, for O3-iterative/vectorized, drive the new coordination paths. Coordinate with the scheduler owners.
  - `eval_bridge/` (`mirror_context.rs`, `override_context.rs`, `mirror_access.rs`) — implements the `EvalDataAccess`/`EvalMetadata`/`DataSource` traits; the epoch-cache handle (O2), database-cache wiring (O5), and Data-Table override overlay (O4) all surface here. Trait additions must update these impls.
  - `mirror/` — owns the sheet-name normalization thread-local that O2 retires.
  - `compute_parser` — only if O1 adds a resolved-`FunctionId` field to `ASTNode::Function`.
- **Build note:** changes to the trait surface in `context/traits.rs` ripple to `eval_bridge` impls; sequence trait edits before consumer edits.
