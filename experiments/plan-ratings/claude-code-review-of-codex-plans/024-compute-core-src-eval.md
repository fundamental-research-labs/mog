Rating: 8/10

# Review: 024 — compute/core/src/eval


## Summary judgment

This is a strong, unusually well-grounded plan for the production formula
evaluation core. Its description of the current system is accurate at a level
of detail that is rare in these plans: I spot-checked the major factual claims
against the source and they hold. The plan correctly frames `eval` as the
single evaluation engine that every scheduler recalc path converges on, names
the right adjacent subsystems (`scheduler`, `eval_bridge::MirrorContext`,
`mirror`, the `compute-*` crates), and proposes a coherent set of objectives
with explicit invariants, sequencing, parallelization, and feature-gated
verification gates. The dominant weakness is scope: nine large objectives — at
least three of which (first-class references, explicit epoch-cache ownership,
external evaluation) are individually major structural efforts — are bundled
into a single plan without a clear MVP slice or per-objective acceptance
criteria. That makes the plan an excellent *charter* but a risky single unit of
work.

## Factual accuracy (verified against source)

The plan's "current observations" are correct:

- `Evaluator::evaluate()` and `Evaluator::evaluate_with_deadline()` both exist
  (`eval/engine/evaluator.rs:35,53`); the scheduler checks deadlines around
  phases/levels, not inside one formula's loop. ✓
- `scheduler/mod.rs:11-13` documents "All recalc paths converge on a single
  evaluation core … the one and only `Evaluator::evaluate()`." ✓
- `EvalValue` carries only `Cell`, `Omitted`, and `Lambda`; there is no
  first-class reference variant, and the boundary collapses lambdas/omitted to
  `#CALC!` (`eval_value.rs`). ✓
- `EpochCache` is explicitly staged with `TODO(full-migration)` to thread
  `&EpochCache` through the evaluator (`eval/cache/epoch_cache.rs:30,91,102`). ✓
- `database_cache.rs:1` is literally a "Tier 1 placeholder." ✓
- External refs fail closed: `ASTNode::ExternalSheetRef|ExternalThreeDRef|
  ExternalNameRef => eval_external_ref_unavailable()`
  (`eval/engine/evaluator.rs:163-165`), and the provider contracts in
  `external.rs` already model freshness, status (Denied/Broken/Ambiguous/
  Circular/Loading), and error variants that "intentionally cannot carry a
  CellValue." ✓
- The vectorized subsystem (`eval/coordination/vectorized`) has only test
  callers; `detect_groups`/`execute_group` have no production wiring outside
  `tests`. The `scheduler/agg_prepass/pattern.rs:520` reference is a comment
  ("Mirrors `detect_groups()`") for a separate prepass implementation, which
  confirms — rather than contradicts — the plan's claim that the eval-side
  vectorized path is not on the production path. ✓

Because the diagnosis is correct, the proposed work targets real gaps rather
than imagined ones. This is the plan's biggest strength.

## Major strengths

- **Invariant-first framing.** The "Production-path contracts and invariants"
  section is the best part of the plan. It pins down exactly what must not
  regress: `CellValue` as the sole output, `Null` preservation with boundary
  coercion staying in the scheduler, uniform limit/deadline application,
  exception-safe scope push/pop, reference identity for the specific functions
  that inspect references (`ROW`/`COLUMN`/`AREAS`/`FORMULATEXT`/`INDEX`/etc.),
  canonical range-key/clamping, fast-path semantic invisibility, epoch-cache
  non-leakage, and native/WASM result parity. These are testable contracts.
- **Fast-path equivalence as a first-class deliverable.** Objective 6 and the
  test plan demand differential tests (fast path on vs. each fast path off) for
  dense aggregates, borrowed conditional aggregates, lookup indexes, sorted
  caches, and SUMPRODUCT fusion. Given how many silent-correctness fast paths
  exist in this folder, this is exactly the right safety net, and the
  "test-only switch at the session level, not by mutating production state"
  instruction is the correct mechanism.
- **Honest staging decisions.** It explicitly asks to *either* wire vectorized
  execution into the scheduler with strict eligibility guards + scalar-
  equivalence sampling *or* keep it clearly non-production, and similarly for
  the database cache tier. This avoids leaving half-built subsystems ambiguous.
- **Verification gates are concrete and correctly conditioned.** The required
  gates (`cargo test/clippy -p compute-core`, `--no-default-features` for WASM
  cache parity) plus opt-in `perf-tests`/`corpus-tests`/`audit-tests` features
  and "performance must target production recalc, not mocks" show real
  familiarity with this crate's test surface.
- **Sequencing and dependency notes are sound.** Landing `EvalSession` first,
  then first-class references before primitive-dispatch cleanup, and
  coordinating epoch-cache ownership with the scheduler session boundary, is the
  correct order — each later change threads through one context.

## Major gaps or risks

- **Scope is too large for one plan.** Objectives 1–9 each could be their own
  plan; objectives 3 (explicit epoch-cache ownership across rayon/WASM), 4
  (first-class reference values), and 7/8 (vectorized + external) are
  individually high-risk structural changes. The plan acknowledges this in
  Risks but never carves a minimal first increment. A reviewer cannot tell what
  "v1 of this plan, shippable and verifiable" looks like versus the full
  program. This is the main reason it is not a 9–10.
- **No per-objective acceptance criteria / done-state.** Objectives are
  expressed as directions ("make dispatch declarative enough," "prove all fast
  paths equivalent," "strengthen tests into contract tests") without a crisp
  exit condition (e.g. "the primitive matrix test enumerates every entry in the
  eval primitive table and fails CI if a new primitive is added without a row").
  Several would benefit from a concrete artifact target.
- **First-class references vs. cache key correctness is under-specified.** The
  plan introduces `ResolvedReference`/reference-valued `EvalValue` and also
  reworks range-key resolution and the subexpression/lookup caches in the same
  program, but does not address how deferring materialization interacts with
  cache keying and version validation (a reference held across a tick could
  outlive the column version it was resolved against). This is the most likely
  place for subtle correctness regressions and deserves an explicit invariant.
- **Deadline behavior change is a compatibility risk that is noted but not
  bounded.** "Per-formula deadlines may surface new `#CALC!`" is flagged, but
  there is no statement of the default deadline policy, whether existing
  workbooks that complete late should keep completing, or how this is gated/
  rolled out. "Deterministic and documented in tests" is necessary but not
  sufficient for a behavior change visible to users.
- **Cross-plan coupling is real but only narrated.** The plan depends on a
  scheduler "session boundary" and `FormulaEvalOutcome`/result-application
  contract that live in `compute/core/src/scheduler` and are owned by a
  *separate* plan. If that plan does not land the session boundary in a
  compatible shape, objectives 3 and 6 stall. The dependency is named but there
  is no fallback if the scheduler plan diverges.
- **`sync_block_on` / async-trait reality.** `EvalDataAccess` is async-in-trait
  with a sync bridge that panics on `Pending`; the plan threads a new
  `EvalSession` through everything but does not say whether the session is
  passed by value, `&`, or lives on the async context — a non-trivial decision
  given the RPITIT constraint that `EvaluationContext` can't be `dyn`. A line on
  the threading mechanism would de-risk Agent B's work.

## Contract and verification assessment

Contract clarity is high. The trait split (`EvalDataAccess` async,
`EvalMetadata` sync, blanket `EvaluationContext`) is described accurately, the
`CellValue` output boundary and the lambda/omitted collapse are correctly
identified as the only escape points, and the external provider contract is
already fail-closed in source — so objective 8 is genuinely "wire the existing
trait," not "design it," which lowers its risk. The reference-preserving
function list matches the functions that actually inspect references.

Verification is the plan's other strength: differential fast-path tests,
`RangeStore`/`MirrorContext` range-key parity tests, production-path tests
through `ComputeCore::init_from_snapshot` and the real recalc entrypoints
(rather than evaluator mocks), a fake `ExternalValueProvider`, native rayon
concurrency tests for cache leakage, and `--no-default-features` for WASM
parity. The gate list is correctly conditioned on what changed. The one missing
piece is acceptance thresholds: there are no numeric or pass/fail bars for the
perf fixtures, so "do not optimize mocks" is stated but "what counts as a perf
win/regression" is not.

## Concrete changes that would raise the rating

1. **Carve an explicit Phase 0 / MVP.** Define the smallest shippable
   increment — almost certainly `EvalSession` + per-formula deadline ticking +
   `DeadlineExceeded` surfacing + the fast-path equivalence test harness — and
   mark objectives 4/6/8 (references, vectorized, external) as follow-on plans
   that depend on it. This alone would justify a 9.
2. **Add per-objective exit criteria.** For each objective, one sentence on the
   artifact that proves it's done (e.g. "primitive table is exhaustive and a
   compile-time/CI check fails if a primitive lacks a contract row").
3. **State the deadline rollout policy.** Default deadline value/source, whether
   it is feature-gated initially, and the expected effect on currently-slow-but-
   completing workbooks.
4. **Add a reference-vs-cache invariant.** Specify that a deferred
   `ResolvedReference` must either re-validate column versions at
   materialization or be invalidated on the same version bump as `RangeStore`
   entries, and add a test for "reference resolved, dependency edited, reference
   materialized."
5. **Pin the `EvalSession` threading mechanism.** One line on how the session is
   passed given async-in-trait + non-`dyn` `EvaluationContext` (by-ref param vs.
   field on a context wrapper), so Agent B and Agent D don't pick incompatible
   shapes.
6. **Add a fallback for the scheduler-session dependency.** State what objs 3
   and 6 do if the scheduler plan's session boundary is not yet available
   (e.g. a temporary eval-owned epoch handle that the scheduler later adopts).
7. **Give the perf fixtures a pass/fail bar**, even a coarse one (no regression
   beyond X% on the named repeated-SUMIFS/lookup/statistics fixtures).

---

Verification note: the only file created/modified by this review is
`mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-codex-plans/024-compute-core-src-eval.md`.
All source inspection was read-only (`rg`/`sed`/`ls` and Read).
