Rating: 8/10

# Review of 025 — Compute Core Scheduler Improvement Plan


## Summary judgment

This is a strong, evidence-grounded plan for the production recalculation
scheduler in `compute/core/src/scheduler`. Nearly every concrete claim it makes
about the current code checks out against the source, which is the single most
important signal that the author actually read the folder rather than
hallucinating a generic refactor. The plan correctly identifies the real
duplication and correctness hazards, frames them as contract problems rather
than cosmetic cleanups, and keeps the right non-goals (one evaluator, no
collapsed semantic paths, no `mog → mog-internal` dependency). It loses points
for being large for a single plan, for under-specifying the equivalence/perf
acceptance criteria, and for not making characterization tests a hard gate
before the risky refactors and behavior changes begin.

## Major strengths

- **Accurate against the code.** Spot-checks confirm the plan's specifics:
  - The two hand-maintained per-level loops exist (`recalc/passes.rs`
    `topo_evaluate_pass` and `topo_evaluate_pass_with_levels`), and the literal
    comment "Any changes to the per-level body must be mirrored" is at
    `passes.rs:19` — exactly the correctness risk objective #2 calls out.
  - `selective_dep_fixup_pass` returns
    `(Vec<CellChange>, Vec<ProjectionChange>, Vec<CellErrorInfo>)`, collects
    `projection_deltas` internally, and takes no `Deadline` — matching
    objectives #4 and #6.
  - `data_table_prepass.rs` has unconditional `eprintln!("[DT-EVAL] ...")` at
    lines 492 and 551 (objective #7).
  - Manual mode state (`pending_manual_dirty_cells`, cleared at full recalc),
    `affected_cells`/`topo_evaluate_cells` incremental path, and
    `handle_cycles_with_precomputed_levels` cycle path all exist as described.
  - The adjacent `compute-graph/src/recalc/*` modules (barrier_graph, cycles,
    dirty_set, range_helpers, topo_order) exist and back the cycle/selective
    claims.
- **Contract-first framing.** The "Production-path contracts and invariants"
  section is the best part of the plan: two-phase parallel read/apply, RangeStore
  invalidation ordering, rayon thread-local clearing across workers, manual-mode
  pending semantics, Excel-compatible cycle behavior, data-table ghost-cell
  raw-value preservation, calc-disabled-sheet exclusion. These are the things a
  refactor of this layer can silently break, and they are stated as preserve/
  strengthen targets rather than left implicit.
- **Verification is anchored to production entrypoints**, explicitly forbidding
  faked dirty sets and direct state mutation — the right call for a scheduler
  whose bugs live in the orchestration, not the evaluator. The named test modules
  (`scheduler_tests`, `projection_tests`, `agg_prepass`, `data_table_prepass`,
  `dep_extract`) all exist as real directories/files.
- **Sequencing and parallelization are realistic.** Landing `RecalcSession` and
  shared outcome application before the prepass/cycle refactors is correct
  ordering: it removes the duplicated mutation/caching code those later refactors
  would otherwise have to touch twice. Splitting cycle-plan + `compute-graph`
  additions onto their own agent with independent graph tests is sound.
- **Risk section is specific and matches the genuinely scary parts** (prepass
  timing on loop centralization, cycle scoping missing range/projection-fed
  predecessors, data-table mirror restore, projection/CellChange dedup fighting
  for a position, worker thread-local clearing).

## Major gaps or risks

- **Scope is large for one plan.** Eight objectives span a typed session object,
  level-executor unification, result-application unification, selective fixup
  promotion, cycle-plan rework, prepass normalization, a full contract-test
  suite, and docs. The parallelization notes help, but the dependency graph
  creates a real critical path (session → outcome apply → loop unification →
  prepass/cycle). This reads closer to an epic than a single landable change.
  No interim landing/revert strategy is offered, and feature-flag shims are a
  stated non-goal — so a partially-landed refactor of a hot path has no
  described safety valve.
- **Characterization tests are not a hard pre-refactor gate.** Agent A "audits
  and writes contract tests," but the sequencing does not require those tests to
  exist and pass against the *current* code before Agents B/C/D begin refactoring.
  For a correctness-preserving refactor this is the highest-leverage gate and it
  should be mandatory and first, not parallel.
- **Objective #5 is a behavior change wearing a refactor's clothes.** Narrowing
  incremental cycle handling from "evaluate every non-cycle formula cell" to
  "only necessary predecessors and downstream dependents" is a semantic change
  with explicit miss-risk (acknowledged in risks). The plan should require a
  differential test proving the new scoped set produces identical results to the
  current broad set on cycle fixtures, not just "preserve idempotence through
  `calculate()`."
- **Acceptance criteria are under-specified.** Verification reduces to "tests
  pass + clippy + measure perf on snapshots." There are no equivalence assertions
  defined beyond "compare values/patches," no baseline numbers, and no pass/fail
  threshold for the perf work. "Where metrics are contractual" is left to the
  implementer to decide which metrics are contractual — that decision should be
  in the plan.
- **`session.rs` already exists** (currently only the `Deadline` alias and
  `clear_thread_local_caches`). The plan says "Define a `RecalcSession` ... in
  `recalc/session.rs`" without noting the file's current contents or how the
  existing deadline/cache-clearing helpers fold into the new type. Minor, but a
  reader could mistake this for a greenfield file.
- **Deadline-driven `#CALC!` outputs are a user-visible behavior change**
  (objective #4 / risk). The plan says tests "must define deterministic timeout
  behavior" but does not specify what that behavior is (which cells get `#CALC!`,
  whether partial results persist, how it interacts with viewport patches). That
  contract should be pinned down in the plan, not deferred.

## Contract and verification assessment

The invariant list is the plan's strongest contract artifact and is unusually
complete for this layer. Gaps: (1) the deadline/`#CALC!` contract is asserted as
a goal but its observable shape is undefined; (2) the projection-vs-CellChange
dedup rule ("must not contradict regular CellChange entries for the same
position") is stated as an invariant but no resolution rule is given for the
conflict case the risks section raises; (3) "metrics where metrics are
contractual" leaves the test surface ambiguous. Verification gates are concrete
and the test module names are real, but the gates prove "compiles, lints, tests
green" rather than "behavior is equivalent to baseline" — the equivalence the
whole refactor rests on. Adding before/after differential assertions through the
production entrypoints (same workbook, same edit, identical `RecalcResult` +
graph + projection-registry state pre/post refactor) would close this.

## Concrete changes that would raise the rating

1. **Make characterization tests gate #1.** Require Agent A's contract/equivalence
   tests to land and pass against current `main` before any refactor commit, and
   state that B/C/D rebase onto them.
2. **Define the timeout contract explicitly:** which cells become `#CALC!`, what
   happens to already-computed levels, and how timeout interacts with viewport
   patching — with a deterministic test fixture.
3. **Require a differential test for the cycle-scoping change (#5)** proving the
   narrowed incremental predecessor/downstream set yields identical values and
   patches to the current broad evaluation on range- and projection-fed cycle
   fixtures.
4. **Specify the projection/CellChange dedup resolution rule** for the
   same-position conflict, not just the invariant that it must not contradict.
5. **Add acceptance criteria with baselines:** name the contractual metrics, give
   target/no-regression thresholds for the perf pass, and define the equivalence
   assertion (values + `RecalcResult` patches + graph deps + projection registry)
   as the bar each entrypoint must clear.
6. **Address incremental landing/rollback** given the no-feature-flag non-goal:
   either split the session/outcome foundation into its own independently
   landable PR with full green tests, or state the revert plan for a hot-path
   regression.
7. **Acknowledge the existing `recalc/session.rs` contents** and describe how the
   `Deadline` alias and `clear_thread_local_caches` fold into `RecalcSession`.
8. **Decouple the trivial `eprintln!` removal** (do it immediately, as the plan
   half-notes) from the high-risk data-table guard refactor so the cleanup isn't
   blocked behind the session cache API.
