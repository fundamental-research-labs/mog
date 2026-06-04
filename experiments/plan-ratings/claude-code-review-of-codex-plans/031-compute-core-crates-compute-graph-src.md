Rating: 8/10

# Review of Plan 031 — Compute Graph Mutation and Query Correctness

Source folder reviewed: `mog/compute/core/crates/compute-graph/src`
Plan reviewed: `codex-plans/031-compute-core-crates-compute-graph-src.md`

## Summary judgment

This is a strong, unusually well-researched plan. Nearly every concrete name it
cites was verified against the actual source: the `DependencyGraph` fields
(`precedents`, `dependents`, `range_deps`, `range_index`, `sheets_with_range_deps`,
`range_count_per_sheet`, `sheet_ranges`, `volatile_cells`, `formula_cells`,
`selective_dep_cells_idx`, `total_edges`, `max_deps_per_cell`, `external_deps`,
`external_precedents`); the mutation methods (`set_precedents`,
`set_precedents_defer_index`, `apply_precedents`, `remove_old_edges`, `remove_cell`,
`bulk_remove_cells`, `cleanup_sheet_ranges`, `set_external_precedents`, builder
`bulk_set_precedents`); the query/recalc surface (`affected_cells[_unordered/_levels]`,
`evaluation_levels[_full]`, `subset_levels`, `detect_cycles`, `would_create_cycle`,
`resolve_range_targets`, `cells_reaching`, `reachable_forward`); the
completeness types (`Analyzed`, `AnalysisCompleteness::{Exact,Incomplete}`); the
`RangeAccess::{Aggregate,Selective}` semantics; the adjacent scheduler modules
(`dep_extract`, `formula_reg`, `init`, `recalc`, `projection_tests`); the
`PositionResolver` impl on `CellMirror`; and even the verification targets
(`tests/proptests.rs`, `benches/graph_benchmark.rs`) all exist as written. The
verification gates are runnable, not aspirational. That accuracy alone puts this
plan well above the median.

The central good idea — turning the prose invariants into an executable
`assert_invariants`/`GraphInvariantReport` that recomputes canonical derived state
from `precedents`/`external_precedents`/`volatile_cells`/`formula_cells` and
diffs it against every maintained index — is exactly the right lever for a folder
whose charter is "mutation and query correctness." Combined with a state-machine
proptest over production-style operation sequences, it directly attacks the class
of bug this crate is most exposed to: a derived index drifting out of sync with
canonical state after some mutation ordering.

Where it falls short of a 9–10: it is a refactor-heavy *hardening* plan that
never names a concrete suspected defect, it bundles a sweeping internal
rearchitecture with the correctness work and presents that refactor as mandatory
rather than conditioned on findings, it slightly misrepresents the
already-existing completeness mechanism, and its acceptance criteria are soft.

## Major strengths

- **Code-grounded, not hand-wavy.** The contract list in "Production-path
  contracts and invariants to preserve" reads like it was written against the
  real struct, including subtle live behaviors: empty-precedent formulas still
  counting as formula cells, `cleanup_sheet_ranges` preserving volatile formulas
  that survive with empty local deps, selective-index derivation from
  `precedents`, and the bidirectional cell/range edge invariants.
- **Executable invariants + oracle.** The invariant checker, brute-force oracle
  comparison (interval-tree vs. linear scan), and state-machine proptest are the
  three techniques most likely to find real bugs here, and they are sequenced so
  the checker lands first as a gate for everything else.
- **Disciplined non-goals.** Explicitly forbidding (a) moving dep extraction out
  of the scheduler, (b) `compute-graph → compute-core`/`mog-internal` dependency,
  (c) an alternate graph engine, and (d) optimizing the oracle/test path. These
  match the crate's actual public boundary (`lib.rs` depends only on
  `cell_types`/`workbook_types`) and the existing extraction-at-scheduler design.
- **Honest treatment of `max_deps_per_cell`.** Offering an explicit
  exact-vs-upper-bound contract with a test for the weaker promise, rather than
  silently over-promising, is the right call given removals would otherwise force
  scans.
- **Real verification gates.** `--test proptests`, the per-module `test_*`
  filters, the `compute-core` scheduler suites, and `graph_benchmark` all resolve
  to actual targets; the "no test-only mutation shortcut as proof" rule is sound.

## Major gaps or risks

1. **No concrete defect motivates the work.** The plan itself notes the folder
   "already has substantial tests" (true — there is a resolved-view oracle,
   proptests, range-selectivity regressions, topo/cycle suites). The deliverable
   is therefore largely "prove the existing thing is correct and reorganize it."
   That is legitimate, but the plan presents zero evidence or even a hypothesis
   that any invariant currently breaks. A correctness plan for this folder would
   be stronger if it named at least one suspected drift (e.g., a specific
   mutation ordering where `selective_dep_cells_idx` or `range_count_per_sheet`
   could go stale) to anchor the value proposition and to give the proptest a
   first target to falsify.

2. **The completeness section overstates an unsolved problem.** Step 5 proposes a
   new `GeometryContext` wrapper that "owns miss tracking." But `TrackedResolver`
   already exists in `positions.rs` and is already threaded through
   `dirty_set.rs`, `cycles.rs`, and `topo_order.rs` (`TrackedResolver::new(positions)`
   at each entry, with `.completeness()` producing `Exact`/`Incomplete`). The real
   residual risk is narrower — a phase consulting an *untracked* side-resolver
   (the plan does gesture at this), and consolidating range-target resolution.
   By not acknowledging `TrackedResolver`, the plan inflates the scope and risks
   re-implementing existing machinery. It should be reframed as "audit that every
   geometry-aware phase routes through the existing tracked path; add range-target
   resolution to it" rather than "add miss tracking."

3. **Architectural churn is bundled with, and not gated on, correctness.** Step 2
   (a `DependencyDelta` bookkeeping layer) and Step 3 (typed `RangeDependencyIndex`
   / `ExternalDependencyIndex` / `SelectiveRangeIndex` / `GraphStats` substructures)
   are a large internal rewrite of a hot path — the source comments note ~2.6M
   precedent entries and ~12K selective deps, and the deferred-reindex contract is
   load-bearing for builder/batch performance. The plan flags the perf risk but
   still presents the refactor as a given. A safer shape: land the invariant
   checker + state-machine proptest first (cheap, low-risk, high signal), and make
   the delta/sub-index refactor *conditional* on the checker actually surfacing
   duplication-induced drift or on a proven maintainability cost. As written, a
   reviewer can't tell whether the refactor is justified by evidence or by taste,
   and it imports regression risk into what is nominally a correctness task.

4. **Soft acceptance criteria.** For a proptest- and oracle-heavy plan, "compare
   against the oracle" recurs without any pass/fail definition: no minimum
   proptest case count, no shrinking/seed-stability expectation, and — for the
   perf gates — only "record" build/mutation/topo/cycle times with no regression
   threshold. "Tests pass + clippy clean + no perf regression" is the implicit bar
   but the perf bar has no number, so the gate is unfalsifiable in practice.

5. **Step 9 (tracing/observability) is tangential scope.** Adding tracing spans
   for batch sizes / range-index rebuilds / dirty-set fallbacks is reasonable but
   only loosely related to "mutation and query correctness," and the crate runs
   under `#![deny(clippy::all)]` with `pedantic`/`nursery` warnings on a hot path.
   It reads as scope creep relative to the stated objective and should be optional.

## Contract and verification assessment

The contract section is the plan's best part: it is specific, matches the live
code, and is mostly mechanically checkable (which is the point of Step 1). The
forward/reverse edge invariants, the "derived exactly from `precedents`" claims
for the range and selective indexes, and the volatile-survival rules are all
faithful to the implementation. The set-vs-ordered query classification is a
genuine correctness concern given the `FxHashMap`/`FxHashSet` backing and several
`Vec<CellId>`-returning queries.

Verification gates are concrete and correct. `cargo test -p compute-graph
--test proptests` resolves to the real `tests/proptests.rs` integration target;
the per-area `test_mutations`/`test_queries`/`test_resolved_view`/`test_topo`
filters map onto the actual `src/tests/test_*` modules; the `compute-core`
scheduler suites and `graph_benchmark` bench exist. The "no test-only mutation
shortcut as proof of production correctness" constraint is exactly right and is
reinforced by Step 8's "verify only through public query APIs or scheduler-facing
behavior." The one weakness, as noted, is the absence of quantitative thresholds
for the proptest and performance gates.

## Concrete changes that would raise the rating

1. **Decouple correctness from refactor and add a decision gate.** Make Phase 1 =
   invariant checker + state-machine proptest + oracle expansion (the
   high-signal, low-risk work). Make the `DependencyDelta`/typed-sub-index
   refactor a *separate, conditional* phase justified by either a checker-found
   drift or a stated maintainability cost, with its own before/after benchmark
   gate. This isolates regression risk on the hot path.

2. **Acknowledge and build on `TrackedResolver`.** Rewrite Step 5 as "audit that
   `affected_cells*`, `evaluation_levels*`, `subset_levels`, `detect_cycles`,
   `would_create_cycle`, and `resolve_range_targets`/`cells_reaching`/
   `reachable_forward` all resolve geometry exclusively through the existing
   `TrackedResolver`; extend it (not a new wrapper) to cover range-target
   resolution." Drop or down-scope the new `GeometryContext`.

3. **Name at least one suspected invariant violation** (or state explicitly that
   none is known and the goal is regression-proofing). This anchors the proptest's
   first falsification target and clarifies expected value.

4. **Quantify the gates.** Specify a minimum proptest case count / operation
   sequence length, require committed shrink regressions, and give the perf gate a
   concrete tolerance (e.g., "build/mutation/topo within X% of baseline on the
   range-heavy fixture") rather than "record times."

5. **Make Step 9 (tracing) explicitly optional** or fold a minimal subset into the
   debug-only invariant path, keeping the release hot path untouched.

6. **State the empty-formula and deleted-sheet survival semantics as named test
   fixtures with expected outputs**, since the plan itself flags these as
   user-visible (deleted-sheet range-only formulas, nonempty-to-empty dep
   replacement) — turning them from prose risks into asserted regressions.
