Rating: 8/10

Summary judgment

This is a strong, production-path-aware plan for a difficult scheduler area. It correctly identifies real current risks in `compute/core/src/scheduler`: duplicated incremental/full level loops in `recalc/passes.rs`, separate sequential/parallel result application in `level_eval.rs`, selective fixup that owns but does not surface `projection_deltas`, data-table debug `eprintln!` side effects, deadline checks that do not reach every inner phase, and incremental cycle handling that still re-evaluates too broadly. The plan also respects the existing architecture: one evaluator through `Evaluator::evaluate()` and `MirrorContext`, graph-first dependency registration, specialized orchestration for full/incremental/cycle/data-table paths, and public-only implementation in `mog`.

The rating is not higher because the plan is ambitious enough to need sharper acceptance contracts before implementation starts. Several proposed abstractions are named but not specified tightly enough to prevent semantic drift: `RecalcSession` ownership/borrowing, the `LevelSchedule` hook model, timeout outputs for partially applied phases, metric compatibility, and result/projection deduplication rules. For a scheduler refactor that touches calculation correctness, cache invalidation, projection materialization, cycles, and data tables, those contracts should be executable or table-driven before the code is moved.

Major strengths

- The plan is grounded in the production scheduler rather than a harness. Its objectives line up with concrete source evidence, including the mirrored-loop warning in `recalc/passes.rs`, local-only `projection_deltas` in `recalc/selective_fixup.rs`, and data-table `eprintln!` calls in `data_table_prepass.rs`.
- It correctly preserves architectural boundaries: no second evaluator, no `mog-internal` dependency from public code, no collapse of full/incremental/aggregate/data-table/cycle semantics into a single pretend-equivalent path.
- The contract list is unusually good for this folder. It calls out dynamic-array top-left storage versus full array entry values, ghost projection cells, RangeStore invalidation, lookup cache invalidation, rayon thread-local caches, manual calculation behavior, disabled sheets, and Excel-compatible cycle behavior.
- The plan identifies systemic fixes rather than isolated bugs. In particular, it treats selective fixup projection stabilization, deadline threading, result application, and cache invalidation as shared contracts.
- The verification section names focused Rust gates and insists on production entrypoints such as `ComputeCore::init_from_snapshot`, edit/batch mutation paths, `recalculate_with_options`, and storage-engine calculate paths.

Major gaps or risks

- `RecalcSession` is under-specified. The source already has `recalc/session.rs` as the deadline/cache helper module, but no session object. The plan should define exact ownership and borrow boundaries for `ComputeCore`, `CellMirror`, `RangeStore`, accumulators, metrics, SUMIFS epoch, and journal/tracing context. Without that, the implementation can easily become a large mutable-borrow adapter rather than a simplifying abstraction.
- The shared level executor needs a stricter phase contract. The two existing loops differ around subset-level cycle return, precomputed full levels, data-table filtering, deferred aggregate trigger levels, blocker pre-evaluation, SUMIFS warm data, and mutation of remaining levels. The plan names hooks but does not specify hook ordering, allowed mutations, inputs/outputs, or which hook may invalidate caches.
- Timeout semantics are not precise enough. The plan says to make every phase deadline-aware and sometimes emit deterministic `#CALC!`, but it does not define what happens after partial data-table overrides, partial selective cascades, partially applied projection changes, or cycle iteration that expires after predecessors have been evaluated.
- Metrics compatibility is too vague. The plan proposes new metrics and warns about metrics consumers, but does not define which `RecalcMetrics` fields are contractual, how cycle-handler metrics should merge with top-level metrics, or how refactoring should avoid changing existing reported counts unexpectedly.
- Result deduplication and ordering need explicit rules. Current cycle paths already deduplicate downstream changes over predecessor changes, while main paths append selective fixup and stabilization changes. A shared session accumulator should specify how duplicate `CellChange`, projection teardown/materialization patches, errors, and old values are ordered and resolved.
- The cycle refactor is directionally right but underspecified. Incremental scoping must account for range-aware edges, projection-derived edges, selective references, disabled sheets, and formulas that were skipped or deferred during initialization. "Compute predecessor and downstream scopes from dirty affected set" is not yet a contract.
- Data-table guard refactoring is called out correctly, but the proposed guard type needs exact unwind behavior for `in_data_table_eval`, saved raw values, cache clearing, and interaction with nested `full_recalc`/TABLE prepasses. This is one of the highest-risk areas and deserves a smaller design subsection.
- Test sequencing is late. Contract fixtures are step 7, after broad refactors. For this folder, the fixtures should be the first executable artifact, or at least land beside each phase change.

Contract and verification assessment

The plan's production-path relevance is high. It avoids test-only shortcuts and names real entrypoints. The proposed focused gates are appropriate: `cargo test -p compute-core` and `cargo clippy -p compute-core`, plus `compute-graph` tests/clippy if graph APIs change. The per-module test list is useful, though it should be validated against actual test target filtering before implementation because Rust module-path filters can silently run fewer tests than intended.

The verification gap is acceptance criteria, not command choice. The plan should require before/after equivalence fixtures for full recalc, incremental edit recalc, manual calculate, no-op repeated calculate, cycle handling, selective fixup, projection stabilization, aggregate prepass, and data-table restore behavior. It should also specify expected `RecalcResult` patch ordering/deduplication, projection registry state, cache invalidation observations, and metrics deltas for each fixture.

The contract section is better than most plans, but it remains mostly prose. The most important contracts should become named test matrices or small design tables before implementation: phase inputs/outputs, cache invalidation obligations, deadline behavior, allowed mirror mutations, and accumulator merge rules.

Concrete changes that would raise the rating

- Add a `RecalcSession` design table with fields, ownership mode, lifetime/borrow strategy, phase methods, and exact finish output. Include how it merges duplicate `CellChange`, `ProjectionChange`, `CellErrorInfo`, `ProjectionDelta`, old values, and metrics.
- Specify the `LevelSchedule`/executor API as a contract: schedule variants, hook names, hook order, allowed hook mutations, cache invalidation points, deadline checks, and cycle-cell return behavior.
- Move contract tests to the beginning of the sequence. Require failing fixtures before broad refactors for result application equivalence, selective-fixup projection stabilization, manual calculation dirty clearing, cycle idempotence, data-table panic restoration, and aggregate prepass trigger parity.
- Define deterministic timeout behavior per phase, especially for data-table override loops, selective cascade levels, cycle predecessor/core/downstream phases, projection stabilization recursion, and aggregate blocker pre-evaluation.
- Add a metrics compatibility checklist listing existing fields that must remain stable, new fields to add, and how metrics from cycle/full/incremental/selective/stabilization phases merge.
- Break the implementation into safer landing slices: remove data-table debug output first; add selective-fixup projection-delta propagation/stabilization with tests; introduce shared result application; then introduce session/shared executor; then cycle-plan scoping; then data-table deadline/guard restructuring.
- Add explicit rollback/safety invariants for data-table restore and projection materialization: saved raw values, ghost-cell preservation, `in_data_table_eval` restoration, cache clearing on normal return and unwind, and no recursive TABLE prepass.
