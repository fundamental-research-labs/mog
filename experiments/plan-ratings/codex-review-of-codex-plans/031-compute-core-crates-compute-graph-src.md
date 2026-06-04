Rating: 8/10

Summary judgment

This is a strong plan for the `compute-graph` crate. It correctly identifies the production role of `DependencyGraph`, the mutation-maintained indexes that can drift, the scheduler entrypoints that rely on graph correctness, and the need to prove the interval-tree path against brute-force oracles. The plan is especially good at turning "add more tests" into a systematic invariant and state-machine testing strategy.

The rating is not higher because the plan is very broad and still underspecified in the places most likely to determine success: exact API contracts, concrete refactor boundaries, oracle model details, performance budgets, and phased acceptance criteria. It is architecturally aligned, but it needs sharper sequencing and more executable contracts before it is a low-risk implementation spec.

Major strengths

- Accurately maps the real crate structure and fields: `precedents`, `dependents`, `range_deps`, `range_index`, `sheet_ranges`, sheet counts, external indexes, `volatile_cells`, `formula_cells`, `selective_dep_cells_idx`, and cached stats all exist and are the right correctness surface.
- Correctly treats scheduler usage as production-path evidence. Formula registration, bulk init/import, sheet range cleanup, dirty-set expansion, cycle checks, topo levels, and selective fixup all call through the public graph APIs the plan names.
- The invariant-checker objective is the right foundation. Recomputing canonical derived state from stored precedents and comparing every secondary index would catch exactly the class of mutation bugs this folder is prone to.
- The plan handles hard graph semantics rather than only simple cell edges: aggregate versus selective ranges, missing geometry, range-mediated cycles, full/subset topo, hypothetical edits, external-only formulas, and deleted-sheet range cleanup.
- Verification gates are mostly relevant and production-oriented. The plan includes both `compute-graph` tests/clippy and `compute-core` scheduler tests when scheduler-facing contracts change.

Major gaps or risks

- The plan is too large for one coherent change set. It combines invariant infrastructure, mutation delta refactors, typed sub-index extraction, query contract changes, geometry completeness rewrites, randomized state-machine tests, scheduler integration tests, diagnostics, and performance work. That needs explicit landing phases with acceptance criteria for each phase.
- Several contracts are described as future audits rather than decisions. For example, "classify every public query" is useful, but the plan should name each public API and state whether it is ordered, set-valued, diagnostic, or scheduling-critical.
- The proposed `DependencyDelta` is underspecified. It does not define the delta shape, ownership model, ordering/dedup semantics, deferred range-index rebuild behavior, or how local, external, volatile, formula-membership, and stat updates compose in one operation.
- The sub-index refactor could become churn without a clear contract. `RangeDependencyIndex`, `ExternalDependencyIndex`, `SelectiveRangeIndex`, and `GraphStats` are plausible, but the plan should state their exact canonical inputs and public facade methods before implementation.
- The property/state-machine testing section is directionally excellent but not yet executable. It needs generated operation weights, model bounds, resolver generation, shrink-stable comparison rules, and precise oracle outputs for unordered versus ordered APIs.
- Performance risk is acknowledged but not bounded. The plan should name benchmark commands, representative fixture sizes, and acceptable regressions for mutation throughput, range-index rebuilds, dirty-set expansion, topo, and cycle checks.

Contract and verification assessment

The contract coverage is high. The plan names the important invariants, including bidirectional local edges, range index derivation, selective index derivation, external forward/reverse consistency, volatile/formula membership, stats precision, dirty-set conservatism, topo/cycle agreement, and missing-position completeness.

The weakest contract area is determinism and completeness. Current code has hash-backed iterators and mixed resolver paths; the plan correctly flags both, but it should prescribe exact behavior per method. It should also define whether incomplete geometry results are conservative supersets, possibly missing cycle/order information, or merely diagnostic for each API.

The verification gates are appropriate for Rust work and do not rely only on compilation. The plan would be stronger if it separated gates by phase: invariant/test-only phase, mutation refactor phase, geometry/topo phase, scheduler integration phase, and performance phase. The final gates are good, but the current list does not specify when the full `compute-core` suite is mandatory versus when focused scheduler tests are enough.

Concrete changes that would raise the rating

- Add a phase table with one deliverable, touched modules, acceptance tests, and rollback risk per phase.
- Provide an explicit API contract matrix for every public query in `queries.rs`, `topo.rs`, and `recalc/*`.
- Specify the `DependencyDelta` data model and the exact rules for applying it with immediate versus deferred range-index rebuilds.
- Define the canonical oracle model for the state-machine tests, including operation distribution, max graph size, resolver generation, and comparison semantics.
- List the exact scheduler integration scenarios and their public entrypoints instead of describing them as broad categories.
- Name benchmark commands/fixtures and set acceptable regression thresholds for the hot production paths.
- Decide up front whether `max_deps_per_cell` remains an upper-bound diagnostic or becomes exact, and make the plan's stats contract match that decision throughout.
