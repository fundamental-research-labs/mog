Rating: 8/10

# Review of Plan 024 — Harden and complete the production formula evaluation engine (`compute/core/src/eval`)

## Summary judgment

This is a strong, evidence-grounded plan that demonstrates real familiarity with the
target folder. Nearly every factual claim it makes is verifiable against the source, and
its scope boundaries, invariants, and verification gates are unusually disciplined. It
correctly identifies the folder as *the* production recalc path and keeps every objective
on that path rather than drifting into test-only or shim work.

It loses points for breadth and for two genuinely unresolved architectural forks (the O1
dispatch mechanism and the O3 activate-vs-remove decision), plus a soft performance gate.
Six objectives spanning pure refactors, a strategic decision, and net-new features is a
lot for one plan and would be better delivered as a sequenced set. None of these are
disqualifying; the plan is executable today for most of its objectives.

## Evidence verification

I confirmed the plan's load-bearing claims directly against the public source:

- O1: `engine/eval_primitives.rs:40` does `let upper = name.to_uppercase()`;
  `engine/reference_area.rs:262` repeats `to_uppercase`; `engine/eval_state.rs:52`
  (`get_variable_case_insensitive`) does `to_ascii_uppercase` then re-uppercases each
  scope key in a loop. All accurate.
- Registry id-based dispatch exists: `compute-functions/src/registry.rs` exposes lookup by
  name (returning `(u16, &RegisteredFunction)`) and by id. The O1 "route remainder by id"
  claim is supported.
- O2: `cache/subexpr_cache.rs:47` is a `thread_local!` store with `#[allow(dead_code)]` at
  :115; `cache/epoch_cache.rs` carries `TODO(full-migration)` notes (lines 30, 91, 102)
  and is stats-only (`stats()`/`capture_stats()` at epoch end). Accurate.
- O3: `coordination/mod.rs:29,32` carries `#[allow(dead_code)]` for `iterative_solver` and
  `vectorized`; `coordination/vectorized/tests.rs` exists (917 LOC). The "complete, tested,
  unwired" framing is correct.
- O4: `engine/eval_primitives.rs:155` returns `CellValue::Error(CellError::Calc, ...)` for
  `"TABLE"`, with a comment confirming it is parser-synthesized. Accurate.
- O5: the `database_cache` "Future optimization" comment at `eval_primitives.rs:~204`
  exists verbatim; `col_version` exists on the trait (`context/traits.rs:93`). Accurate.
- O6: `engine/evaluator.rs:47` sets `deadline: None`; `evaluate_with_deadline` (`:53`) arms
  it; `MAX_OPERATIONS`/`MAX_DEPTH`/`MAX_SCOPE_DEPTH` and `DEADLINE_CHECK_INTERVAL = 1024`
  all present in `eval_state.rs`. Accurate.
- The full `eval_tests/` suite list matches the directory contents exactly.

This level of citation accuracy is the plan's strongest signal of quality.

## Major strengths

- **Production-path relevance is excellent.** Entry points (`scheduler/level_eval.rs`,
  `cycles.rs`, `cf_eval.rs`, `solver_methods.rs`, `override_context.rs`) are named, and
  every objective moves the real recalc path. No reduced-scope or shim work.
- **Invariants section is the best part.** The value-boundary collapse (`into_cell_value`),
  trait split (`EvalDataAccess` vs `EvalMetadata`), error-semantics preservation, epoch
  isolation, determinism-under-rayon, `sync_block_on` panic-on-`Pending`, and subexpr-cache
  soundness (FxHash + full-AST `PartialEq` + `is_cacheable`) are stated as a hard acceptance
  bar. This is exactly the contract clarity a refactor of a hot engine needs.
- **Phase 0 decision gate for O3** is the right call: it refuses to wire (or delete)
  staged subsystems without an owner decision, and makes the rest of O3 conditional on it.
- **Per-objective verification gates** are concrete and well-matched: differential dispatch
  testing for O1, epoch-emptiness-per-worker for O2, scalar-vs-vectorized equality for O3,
  known-grid Data Table fixtures for O4, cache-on-vs-off equality for O5, deadline-hit for O6.
- **Risk register with mitigations** is honest, especially the Unicode-vs-ASCII folding
  divergence risk (O1) and the columnar Excel-compat hazards (O3).
- **Sequencing is thought through**: O2 (core call-stack churn) before/coordinated-with O1;
  the "land as pure refactor first, delete thread-locals second" staging for O2.

## Major gaps or risks

- **O1 leaves the core mechanism unresolved.** "Add `FunctionId` to `ASTNode::Function` at
  parse time" *or* "intern via a static perfect-hash on a stack buffer" are materially
  different decisions — one touches `compute_parser` (a cross-crate AST change with its own
  ripple and serialization implications), the other does not. The plan should pick one (or
  state a decision criterion) before implementation, because the touch-list and the
  parallelization story differ between them.
- **O3 is half a plan until Phase 0 resolves.** Both branches are sketched, but neither is
  execution-ready. The vectorized-activation branch in particular hand-waves the hardest
  part: how `detect_groups`/`order_groups`/`execute_group` integrate with the scheduler's
  existing DAG-level evaluation and dirty-set, and what defines a "uniform-column group" at
  the coordinator boundary. The iterative branch is closer but still defers the feeding of
  per-cell results into the convergence loop to "wire it in."
- **Performance gate is soft.** O1/O2/O5 are justified largely on perf, yet the gate is
  "net improvement on function-heavy recalc" with the benchmark harness explicitly
  out-of-folder and uncaptured. No baseline numbers, no regression threshold, no named
  workloads with target deltas. A perf-motivated refactor with no quantified gate risks
  shipping invasive churn for unmeasured gains.
- **O6's deadline source is undefined.** The plan says to thread "the recalc-session
  deadline" but never says where that value originates, what the default is when a caller
  supplies none, or how it interacts with interactive vs batch recalc. Threading a `None`
  through is a no-op; the value plumbing is the actual work and it's underspecified.
- **O4 substitution mechanics are light.** It reuses the `OverrideContext` overlay (good),
  but doesn't specify how the synthesized `TABLE(row_input, col_input)` maps to the input
  cells, one- vs two-variable detection, or behavior when the result formula itself spills
  or errors per cell. The fixtures imply the cases but the algorithm isn't pinned.
- **Breadth.** Six objectives mixing two pure refactors, a strategic decision, two feature
  implementations, and a safety-guard re-plumbing is a large unit of work with cross-folder
  reach into `scheduler/`, `eval_bridge/`, `mirror/`, and possibly `compute_parser`. The
  parallelization note helps, but this reads as a roadmap that should be split into
  shippable PRs rather than one plan.
- **Minor imprecision.** The plan states `EpochCache` is `#[allow(dead_code)]`; the literal
  attribute appears on `subexpr_cache.rs` and `coordination/mod.rs`, while `EpochCache`
  itself is "stats-only / unthreaded." Functionally the claim holds, but the attribute
  attribution is slightly off.

## Contract and verification assessment

Contract clarity is the plan's standout dimension: the invariants are specific, tied to
named code (`into_cell_value`, `is_cacheable`, `sync_block_on`, `DenseBoolMask`,
`MAX_DEPTH`), and framed as a non-negotiable acceptance bar. The error-semantics and
case-folding preservation requirements for O1 are exactly what would otherwise regress
silently, and the plan mandates differential testing to catch it.

Verification gates are mostly strong and per-objective. The weak spot is the
cross-cutting performance gate (qualitative only) and the absence of a captured Phase-0
baseline, which undercuts the primary justification for O1/O2/O5. The functional gates
(epoch emptiness per rayon worker, scalar-vs-vectorized equality, cache-on/off equality,
deadline-hit on the common path) are well-chosen and would catch the real hazards.

The plan is appropriately explicit that it does not run build/test commands and frames
the gates as implementer obligations — consistent with the task constraints.

## Concrete changes that would raise the rating

1. **Resolve the O1 fork** with a decision (or a crisp decision rule): commit to either the
   parse-time `FunctionId` on `ASTNode` (and own the `compute_parser` ripple + serialization
   impact) or the stack-buffer interned-dispatch, and give the chosen path its real
   touch-list.
2. **Quantify the perf gate**: name the baseline workloads, capture pre-change numbers in
   Phase 0, and set explicit non-regression thresholds (e.g. "≥X% improvement on
   function-heavy recalc, 0% regression on lookup-heavy") so O1/O2/O5 have a measurable bar.
3. **Specify O6's deadline plumbing**: where the session deadline originates, the default
   when absent, and the interactive-vs-batch policy — not just "thread it through."
4. **Make O3 executable for at least one branch**: if vectorized activation is the likely
   outcome, detail the scheduler integration (group boundary definition, DAG-level
   interaction, dirty-set handling) rather than deferring it to "wire it in."
5. **Split the plan** into sequenced deliverables — (a) O1+O2 refactor, (b) O6 safety, (c)
   O4/O5 features, (d) O3 post-decision — so each lands behind its own gate. The current
   single-plan framing is the main thing standing between this and a 9.
6. **Pin O4's algorithm**: one-/two-variable detection, input-cell mapping from the
   synthesized `TABLE()` args, and per-cell error/spill behavior.
7. Fix the minor `EpochCache` `#[allow(dead_code)]` attribution.
