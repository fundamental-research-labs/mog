Rating: 6/10

Summary judgment

This is a serious, production-minded plan with good source awareness inside `compute/core/src/eval`: it identifies the real hot `eval_function` uppercase allocation, the `EpochCache` migration TODOs, the placeholder `database_cache`, the `TABLE` primitive fallback, and the safety-guard split between `evaluate` and `evaluate_with_deadline`. The contract section is also much better than a typical refactor plan.

The rating is held down because the plan is stale or overconfident against the broader production path. Data tables are already handled by `scheduler/data_table_prepass.rs`, iterative circular calculation is already implemented in `scheduler/cycles.rs`, and recalc entrypoints already carry scheduler deadlines even though per-formula evaluator deadlines are not threaded. Those facts do not make the proposed cleanups invalid, but they change the work from "implement missing production features" to "replace or consolidate existing production orchestration." That distinction must be explicit before this plan is safe to execute.

Major strengths

- Correctly treats `compute/core/src/eval` as a production engine, not a helper library, and names the main evaluator, trait boundary, cache tiers, primitive dispatch, lookup paths, and scheduler call sites.
- O1 is grounded in visible code: `eval_primitives.rs` allocates with `name.to_uppercase()` per function call, `reference_area.rs` repeats the pattern, and scope lookup in `eval_state.rs` uppercases both sides repeatedly.
- O2 matches the in-code `EpochCache` and `subexpr_cache` comments: `EpochCache` is currently a canonical owner/diagnostic shell while access still goes through thread-local caches.
- The invariant list is high value. Value-boundary collapse, trait split, registry fallthrough error semantics, epoch isolation, deterministic parallelism, `sync_block_on` behavior, and subexpression cache soundness are the right contracts to protect.
- The plan includes meaningful verification ideas beyond "run tests": differential dispatch tests, cache-isolation tests, scalar-vs-vectorized equality checks, data-table fixtures, D-function cache-on/cache-off parity, and deadline-path coverage.

Major gaps or risks

- O4 is materially stale as written. `eval_primitives.rs` still returns `#CALC!` for direct `TABLE()`, but production recalc has a real `run_data_table_prepass` that detects TABLE cells, mutates input cells, recalculates affected chains, restores values, and writes body results. The plan should first audit that path and decide whether the goal is bug-fixing, overlay-based replacement, or preserving scheduler ownership with tighter invariants.
- O3 overstates the absence of iterative calculation on the production path. `eval/coordination/iterative_solver.rs` is unwired, but `scheduler/cycles.rs` already has an iterative convergence loop behind the workbook iterative-calc setting. Wiring the dormant module is therefore a refactor/replacement of existing behavior, not activation of a missing feature.
- O6 is directionally right but imprecise. The evaluator common entrypoint has `deadline: None`, yet scheduler full/incremental paths already create and pass recalc deadlines around outer loops. The plan should enumerate every direct `Evaluator::evaluate` production call and define whether each needs per-formula `evaluate_with_deadline`, scheduler-loop timeout checks, or both.
- The scope is too broad for one executable plan: dispatch internment, epoch-cache ownership, vectorized recalc, iterative-solver replacement, data-table architecture, database-function caching, and deadline semantics all touch different contracts and failure modes.
- Phase 1 suggests parse-time `FunctionId` as the preferred design but leaves the AST/registry contract undecided. Adding IDs to `compute_parser::ASTNode::Function` is a cross-crate public shape change; an interned dispatch layer inside eval has a different blast radius. The plan needs to choose one or define exact decision criteria.
- O2 says to store a reference/owned-once handle or `Arc<ASTNode>` to avoid subexpression insert clones, but the evaluator currently receives borrowed ASTs from caches owned elsewhere. The ownership/lifetime contract for that change is not specified enough to implement safely.
- The database-cache objective is underspecified. `database_cache.rs` is currently a placeholder, while D-functions live in `compute-functions` database parsing/criteria code. The plan does not define the parsed structure, criteria semantics ownership, field-name normalization, or how cache keys combine database range versions and criteria range versions.
- The vectorized path needs a stricter production contract before activation. "Feature flag plus equality assertion" is useful, but the plan does not define where scalar fallback happens, how side-effect-like volatility and position-dependent functions are excluded, how dynamic arrays/spills interact, or what telemetry determines rollout.

Contract and verification assessment

The existing-contract section is the strongest part of the plan. It correctly protects the evaluator/data-access boundary, error semantics, cache isolation, parallel determinism, and safety limits. To become an implementation contract, it should be rewritten with observable preconditions and postconditions per objective: exact unknown-function messages after O1, exact cache lifetime across worker threads after O2, exact circular-reference metrics after any iterative refactor, exact TABLE behavior relative to the current scheduler prepass, and exact timeout error mapping after O6.

The verification gates are good conceptually but not yet operational. They should name concrete Rust gates such as `cargo test -p compute-core` and `cargo clippy -p compute-core`, plus any narrower package tests for `compute-functions` if D-function parsing changes. The integration gates should identify the current data-table, cycle, app-eval, and api-eval scenarios to preserve. The benchmark requirement also needs a named harness, representative workbook corpus, baseline metrics, and acceptable regression thresholds.

Concrete changes that would raise the rating

- Add a Phase 0 production-path audit that explicitly reconciles the plan with `scheduler/data_table_prepass.rs`, `scheduler/cycles.rs`, `scheduler/recalc/*`, and every `Evaluator::evaluate` caller.
- Reframe O4 from "implement What-If Data Tables" to a specific decision: keep scheduler prepass and harden it, replace mutate/recalc/restore with an overlay context, or move TABLE semantics into eval with a documented orchestration boundary.
- Reframe O3 iterative work as "consolidate or delete dormant eval coordination solver" and prove parity with current `scheduler/cycles.rs` metrics and behavior before swapping anything.
- Split the work into independent planlets: O1 dispatch, O2 epoch-cache migration, O5 D-function cache, O6 deadline threading, and separate scheduler-facing plans for data tables/vectorization/iterative consolidation.
- Choose the O1 identity strategy up front and specify the exact enum/id source, parser impact, registry API use, alias handling, `_xlfn.` normalization, and unknown-name/error-message preservation.
- Define the `EpochCache` API shape, lifetime model, thread-sharing story, and migration sequence before removing thread-local caches.
- Specify D-function cache keys and parsed payloads, including database range versions, criteria range versions, field lookup normalization, stale invalidation, and cache-on/cache-off differential tests.
- Replace broad verification prose with a command and fixture matrix tied to each objective, including current scheduler data-table and cycle tests as non-negotiable preservation gates.
