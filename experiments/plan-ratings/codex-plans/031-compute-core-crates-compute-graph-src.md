# 031 - Compute Graph Mutation and Query Correctness Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/crates/compute-graph/src`

Scope for this plan is the public `compute-graph` crate source: `DependencyGraph`, local and external dependency mutation APIs, range dependency indexing, volatile and formula-cell membership, cached edge statistics, position-aware dirty-set expansion, range-aware topological ordering, cycle detection, hypothetical edit checks, and the in-crate unit/property tests that verify those contracts.

Adjacent production dependencies that must be considered:

- `compute/core/src/scheduler/*`, which owns the production `DependencyGraph`, registers formula dependencies, deletes sheet range deps, computes dirty sets, asks for full/subset levels, runs selective range fixups, and validates edit-time cycle checks.
- `compute/core/src/scheduler/dep_extract/*`, which emits `DepTarget::Cell` and `DepTarget::Range(_, RangeAccess)` entries and owns the small-range expansion threshold behavior at the dependency extraction boundary.
- `compute/core/src/mirror/*` and `eval_bridge/*`, which implement the `PositionResolver` contract used by range containment, topological ordering, and cycle analysis.
- `cell-types`, `workbook-types`, and `compute-core` public package boundaries. `compute-graph` must remain public and must not depend on `mog-internal`.

This is a public Mog source folder. Implementation work belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`compute-graph` is the production dependency graph for formula recalculation. It is keyed by stable `CellId`s and separates symbolic dependency storage from geometric position resolution supplied by callers. The crate tracks:

- Local formula precedents and reverse dependents.
- Coarse range dependencies and a per-sheet interval index for range containment queries.
- External workbook precedents and reverse external-dependency indexes.
- Volatile cells and explicit formula-cell membership.
- Selective range dependency indexes used by scheduler fixup logic.
- Cached edge statistics and graph diagnostics.
- Position-aware recalc queries: dirty-set expansion, full and subset level ordering, cycle detection, and hypothetical edit cycle checks.

The folder already has substantial tests, including unit tests for mutation/query behavior, range selectivity regressions, resolved-view oracle comparisons, topological ordering, and property tests. The main improvement opportunity is not more isolated examples; it is to make all mutation-maintained derived indexes one verifiable contract and prove every public query against that contract after arbitrary production-style mutation sequences.

## Improvement objectives

1. Make graph storage invariants explicit and mechanically checked. Every mutation must leave `precedents`, `dependents`, `range_deps`, `range_index`, `sheet_ranges`, sheet range counts, external indexes, selective indexes, volatile cells, formula cells, and edge stats mutually consistent.
2. Centralize mutation bookkeeping so the same delta rules handle `set_precedents`, batch/fresh inserts, builder bulk load, `remove_cell`, `bulk_remove_cells`, `cleanup_sheet_ranges`, `set_external_precedents`, and `clear`.
3. Split derived indexes into cohesive internal components instead of scattering their update logic across mutation methods.
4. Define exact query contracts: which APIs are set-valued/unordered, which are deterministic, which include volatile/formula/data cells, and how missing positions affect `AnalysisCompleteness`.
5. Prove range containment and range-aware traversal by comparing the interval-tree production path against a brute-force oracle for points, rectangles, dirty sets, topo levels, and cycle checks.
6. Tighten completeness tracking so every position-aware analysis reports `Incomplete` exactly when needed and remains conservative when geometry is missing.
7. Strengthen `RangeAccess::Aggregate` and `RangeAccess::Selective` contracts across mutation indexes, topo barriers, dirty-set expansion, cycle detection, and scheduler selective-fixup queries.
8. Keep performance improvements on the production graph path, not on test-only harnesses or alternate graph implementations.

## Production-path contracts and invariants to preserve or strengthen

- `set_precedents(cell, deps)` replaces all local value dependencies for `cell`, deduplicates dependency targets, keeps first-observed dependency order for `get_precedents`, marks `cell` as a formula cell even for empty dependency lists, and removes all old local reverse/index entries before adding new ones.
- `GraphBuilder` and `BatchMutations` must produce the same observable graph as individual `set_precedents` calls after build/drop, including range index availability and cached stats.
- Local cell edges are bidirectional: every stored `DepTarget::Cell(target)` in `precedents[cell]` has `cell` in `dependents[target]`, and every reverse dependent points back to a matching forward precedent.
- Range edges are bidirectional through indexes: every stored `DepTarget::Range(range, access)` has `cell` in `range_deps[range]`, and every `range_deps` entry has a matching precedent with the same range and access mode.
- `range_index`, `sheet_ranges`, `sheets_with_range_deps`, and `range_count_per_sheet` are derived exactly from `range_deps`; they must never contain stale deleted-sheet ranges or miss surviving ranges.
- `selective_dep_cells_idx` is derived exactly from `precedents`: it contains a cell only when that cell has at least one `RangeAccess::Selective` dependency, and it contains no range removed by replacement, cell removal, bulk removal, or sheet cleanup.
- `external_deps` and `external_precedents` are independent of local `DepTarget`s but still obey the same forward/reverse consistency and formula-membership rules for external-only formulas.
- Volatile membership is independent of formula dependencies, but `remove_cell` and `clear` must remove volatile entries for deleted cells while `cleanup_sheet_ranges` must preserve volatile formulas that survive with empty local deps.
- Cached stats have a precise contract. `total_edges` should match the canonical count after every mutation. `max_deps_per_cell` should either be made exact or explicitly renamed/documented as an upper-bound diagnostic with tests that assert that weaker contract.
- Query methods that return `Vec<CellId>` from hash-backed storage must either document set semantics or return a deterministic order when scheduler/user-facing behavior depends on order.
- Range containment is inclusive on all boundaries, sheet-specific, duplicate-safe, and identical for point queries, rectangle-overlap queries, and `get_range_dependents_at`.
- Dirty-set expansion is conservative: changed cells and volatile cells are always included, direct dependents are included, range dependents are included when positions are known, and unresolved positions trigger documented over-invalidation rather than missed dependents.
- Full and subset topological ordering must respect cell dependencies and aggregate range barriers. Selective range deps must avoid false cycles but remain discoverable by the selective-fixup query APIs.
- `detect_cycles`, `would_create_cycle`, `evaluation_levels`, `evaluation_levels_full`, and `subset_levels` must agree on what constitutes a real range-mediated cycle, including aggregate self-reference, selective self-reference, and selective back-edge filtering.
- `Analyzed<T>::completeness` must be computed through one tracked resolver path for all geometry-aware phases. A method must not report `Exact` after silently consulting an untracked resolver for cells whose positions are required.
- Public dependency direction stays intact: `compute-graph` depends only on public/core crates and never on `compute-core` implementation details or internal planning files.

## Concrete implementation plan

1. Write the graph invariant contract as code, not only prose.

   - Add an internal `GraphInvariantReport`/`assert_invariants` helper available under tests and debug assertions.
   - Recompute canonical derived state from `precedents`, `external_precedents`, `volatile_cells`, and `formula_cells`, then compare it to `dependents`, `range_deps`, `sheet_ranges`, `range_index` membership, sheet range counts, `external_deps`, `selective_dep_cells_idx`, and edge stats.
   - Add narrow invariant categories so failures identify the broken subsystem: local edges, ranges, range indexes, external refs, formula membership, volatile membership, selective index, and stats.
   - Call the helper after every mutation in test builds and at selected debug-only boundaries in production mutation methods.

2. Refactor mutation code around explicit deltas.

   - Introduce a private `DependencyDelta` or equivalent internal operation that records removed and added local cell edges, range edges, selective ranges, external refs, formula membership changes, volatile changes, and stat changes.
   - Make `set_precedents`, `set_precedents_defer_index`, `GraphBuilder::bulk_set_precedents`, `remove_cell`, `bulk_remove_cells`, and `cleanup_sheet_ranges` apply deltas through one bookkeeping path.
   - Preserve the public API and builder/batch ergonomics, but remove duplicated manual updates for edge counters, selective indexes, range sheet counts, and range index rebuild decisions.
   - Treat empty local precedents as a first-class formula state rather than a special case hidden inside individual methods.

3. Encapsulate derived indexes inside typed substructures.

   - Move `range_deps`, `range_index`, `sheets_with_range_deps`, `range_count_per_sheet`, and `sheet_ranges` behind a private `RangeDependencyIndex` with methods for add/remove/range cleanup/rebuild/query.
   - Move `external_deps` and `external_precedents` behind a private `ExternalDependencyIndex`.
   - Move `selective_dep_cells_idx` behind a private `SelectiveRangeIndex` that is updated only from canonical local precedence deltas.
   - Move `total_edges` and `max_deps_per_cell` behind a `GraphStats` type with an explicit exact-vs-upper-bound contract.
   - Keep `DependencyGraph` as the public facade so downstream users do not learn about internal index layout.

4. Canonicalize query semantics.

   - Audit every public query in `queries.rs`, `topo.rs`, and `recalc/*` and classify it as ordered, unordered/set-valued, diagnostic, or production scheduling input.
   - For unordered APIs, document set semantics and update tests to compare sets instead of depending on hash iteration.
   - For APIs used as evaluation order or diagnostics, sort deterministically by position where geometry exists and by stable `CellId` fallback otherwise.
   - Make `edge_count`, `dep_edge_stats`, `summary`, and `max_depth` agree with the new stats contract and avoid contradictory documentation about cell-only versus range-inclusive counts.

5. Fix completeness tracking through a single geometry access layer.

   - Add a private `GeometryContext` wrapper around `PositionResolver` and the per-sheet position index. It should own miss tracking and expose all position and range-target resolution helpers.
   - Route `affected_cells`, `affected_cells_unordered`, `affected_cells_levels`, `evaluation_levels`, `evaluation_levels_full`, `subset_levels`, `detect_cycles`, `would_create_cycle`, `resolve_range_targets`, `cells_reaching`, and `reachable_forward` through that context.
   - Define which cells must be position-resolved for each analysis and test both exact and incomplete paths.
   - Preserve conservative behavior for dirty-set expansion with unresolved changed cells, but make less conservative methods explicitly report that range-mediated cycles/order may be incomplete.

6. Build a state-machine property test suite.

   - Generate random sequences of production-style operations: local dependency replace, empty formula registration, duplicate dependency submission, mark/unmark volatile, external dependency replace, single/bulk remove, sheet range cleanup, clear, builder bulk load, and batch mutations.
   - Maintain a simple canonical oracle model in tests that does not use the production indexes.
   - After every operation, assert forward/reverse local edge consistency, external consistency, formula/volatile membership, range containment point and rectangle queries, selective index results, edge stats, and `has_cell`/count queries.
   - Include both aggregate and selective range deps, overlapping ranges, duplicate ranges, full-row/full-column ranges, unknown sheets, self-dependencies, and cross-sheet references.
   - Keep the oracle test in the crate test path and avoid exposing test-only mutation APIs to production callers.

7. Strengthen range-aware algorithm oracle coverage.

   - Expand the existing resolved-view oracle into a reusable brute-force oracle for dirty-set expansion, range containment, aggregate barrier ordering, selective false-cycle filtering, cycle cores, downstream levels, and hypothetical edits.
   - Compare interval-tree queries against brute-force scans for randomized point and rectangle inputs after arbitrary mutations.
   - Compare `affected_cells`/`affected_cells_unordered` against the oracle under exact positions and conservative supersets under incomplete positions.
   - Compare `evaluation_levels`, `evaluation_levels_full`, and `subset_levels` against oracle ordering constraints rather than only checking that methods return something.
   - Compare `detect_cycles` and `would_create_cycle` against oracle outcomes for cell cycles, aggregate self-range cycles, selective self-ranges, selective back-edges, and mixed aggregate+selective dependencies.

8. Integrate production scheduler contract tests.

   - Add focused `compute-core` tests that reach graph behavior through production entrypoints: formula registration, formula edit replacement, sheet deletion, bulk import/init, dynamic-array projection stabilization, manual recalc, and selective fixup.
   - Verify graph state only through public `DependencyGraph` query APIs or scheduler-facing behavior, not by mutating private graph internals.
   - Include regression fixtures for deleted sheets with range-only formulas, external-only formulas, formulas that change from selective to aggregate ranges, and formulas whose dependency extraction moves between small expanded ranges and large range deps.

9. Add production-path observability and diagnostics.

   - Add tracing spans or structured debug diagnostics for mutation batch sizes, range-index rebuilds, invariant violations in debug/test, dirty-set fallback full-range sweeps, and cycle classification.
   - Expose no new public IPC unless downstream metrics already require it.
   - Keep diagnostics free of private/internal planning content.

10. Re-check performance on the actual graph path.

   - Use existing graph benchmarks and scheduler recalc paths to compare before/after mutation throughput, range index rebuild costs, dirty-set expansion, full/subset topo, and cycle checks.
   - Avoid optimizing a new oracle, mock, or test-only path. The oracle exists to prove correctness, not as a runtime replacement.
   - If invariant checking is expensive, compile it to tests/debug only or gate it behind explicit diagnostics so release production paths keep the intended complexity.

## Tests and verification gates

Required focused tests during implementation:

- `cargo test -p compute-graph test_mutations`
- `cargo test -p compute-graph test_queries`
- `cargo test -p compute-graph test_resolved_view`
- `cargo test -p compute-graph test_topo`
- `cargo test -p compute-graph --test proptests`
- `cargo test -p compute-core scheduler::dep_extract`
- `cargo test -p compute-core scheduler::projection_tests`
- `cargo test -p compute-core scheduler::scheduler_tests`

Required final gates:

- `cargo test -p compute-graph`
- `cargo clippy -p compute-graph`
- `cargo test -p compute-core` when scheduler-facing graph contracts or production entrypoints change
- `cargo clippy -p compute-core` when `compute-core` changes

Performance verification, when the implementation touches index structure or traversal algorithms:

- Run the existing `compute-graph` benchmark path for production graph operations.
- Run representative `compute-core` full and incremental recalc fixtures that register dependencies through production dependency extraction and schedule through production recalc entrypoints.
- Record graph build time, mutation time, range-index rebuild time, dirty-set size/time, topo time, cycle-check time, and memory growth for large range-heavy workbooks.

No verification should rely on direct test-only graph mutation shortcuts as proof of production correctness.

## Risks, edge cases, and non-goals

Risks:

- Centralizing mutation logic can regress builder and batch performance if every add/remove eagerly rebuilds range indexes. The implementation must preserve deferred rebuild contracts.
- Making `max_deps_per_cell` exact may require scans after removals. If exactness is too expensive, preserve an explicit upper-bound diagnostic contract instead of silently over-promising precision.
- Sorting formerly unordered query results can add cost on hot paths. Only make order deterministic where behavior requires it; otherwise document set semantics.
- A stronger completeness contract may expose existing callers that ignore `AnalysisCompleteness`. Tests should define which incomplete results are conservative enough for each scheduler path.
- Selective range filtering is subtle. Changes must preserve false-cycle avoidance while still scheduling selective formulas for downstream fixup when their read range can change.
- Range cleanup and formula survival semantics are user-visible through deleted-sheet formulas. Do not convert empty-precedent surviving formulas into removed formulas.

Edge cases to cover:

- Duplicate local deps, duplicate external deps, duplicate formula entries in bulk load, and duplicate range keys with multiple formula dependents.
- Replacing a formula's deps across all combinations: cell-only, range-only, mixed cell/range, aggregate-to-selective, selective-to-aggregate, local-to-external, external-to-local, and nonempty-to-empty.
- Removing a cell that is a formula, a precedent data cell, a volatile-only cell, an external-dependent formula, a range-dependent formula, and a formula depended on by other formulas.
- Bulk removal where removed cells depend on each other and surviving cells depend on multiple removed cells.
- Sheet cleanup for sheets with no ranges, all ranges, overlapping ranges, selective ranges, range-only formulas, volatile range formulas, and downstream dependents.
- Full-row/full-column ranges, single-cell ranges, adjacent ranges, overlapping ranges, max-boundary ranges, and cross-sheet ranges.
- Unpositioned changed cells, unpositioned formula cells, partially positioned subsets, and position resolver overrides for hypothetical edits.
- Aggregate self-range cycles, selective self-ranges, mixed aggregate+selective ranges, multi-hop range-mediated cycles, downstream-of-cycle cells, and volatile cells inside cycles.

Non-goals:

- Do not create an alternate production graph engine or compatibility shim that preserves old bugs.
- Do not move dependency extraction from scheduler into `compute-graph`; the graph should consume `DepTarget`s and keep extraction policy at the scheduler/parser boundary.
- Do not make `compute-graph` depend on `compute-core`, `mog-internal`, or private-only packages.
- Do not optimize property-test or oracle code as the main outcome.
- Do not broaden this plan into evaluator semantics except where formula reference semantics affect graph dependency contracts.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the invariant contract is written.

- Agent A: implement the invariant checker and state-machine oracle tests for local edges, ranges, external refs, formula/volatile membership, selective indexes, and stats.
- Agent B: refactor mutation paths around a shared delta application layer and typed range/external/selective/stat sub-indexes.
- Agent C: unify geometry/completeness handling and update range-aware dirty-set, topo, cycle, and hypothetical edit tests.
- Agent D: expand brute-force oracle comparisons for range containment, dirty sets, topo levels, cycle cores, downstream levels, and selective range semantics.
- Agent E: add scheduler production-path contract tests for formula registration, bulk init, sheet deletion, projection stabilization, selective fixup, and external dependencies.
- Agent F: run final verification and production-path performance comparison on range-heavy and large-formula fixtures.

Dependencies:

- The invariant checker should land before broad mutation refactors so each slice has a precise correctness gate.
- The range index substructure should land before geometry-query refactors because it defines the production query surface.
- The completeness/geometry context should land before cycle/topo oracle expansion so the tests assert the final completeness contract.
- Scheduler integration tests can be written in parallel once the public `DependencyGraph` contracts are documented, but they should be run again after the mutation and geometry refactors merge.
