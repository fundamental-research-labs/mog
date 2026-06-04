Rating: 8/10

# Review of Plan 085 — compute-core/src/solver


## Summary judgment

This is a strong, evidence-grounded plan. Nearly every observation it makes
about the current code is verifiable in the public source, and the plan
correctly identifies that `compute/core/src/solver` is a thin bridge facade
whose real defects live in its contracts (validation, error classification,
result fidelity, doc/routing drift) and in the adjacent crates/paths it routes
into. It resists the obvious trap of treating the folder in isolation: it pulls
in the `compute-solver` crate, the scheduler evaluator, the kernel Goal Seek
operation, the public TypeScript types, and the app dialog as part of one
coherent contract, while explicitly fencing off Data Tables and Scenario
Manager as separate. The main weaknesses are scope size relative to a single
"folder" plan and a few speculative items presented with the same confidence as
the well-founded ones.

I verified the plan's central factual claims against source:

- `mod.rs:5,147` doc comment still says Simplex/MixedInteger/constrained →
  `RequiresPython` and `types.rs:1-7,61` still describes NM/BFGS/etc. as
  "dispatched to Python (scipy)", while `mod.rs:189-197` actually routes
  NelderMead/BFGS/LBFGSB/GlobalEvolution to Rust. The doc/routing drift the plan
  flags is real.
- `RequiresPython` appears only in `solver/` and `scheduler/solver_methods.rs`;
  `rg` finds **no** Tauri/WASM catch-and-dispatch in public source. The plan's
  "no production catch-and-dispatch path was evident" claim is accurate, which
  makes the LP/MIP/constrained path genuinely a dead sentinel today.
- `goal-seek-operations.ts` indeed (a) applies the solution via `setCell`
  immediately (write-through) *and* the plan notes a separate
  `APPLY_GOAL_SEEK_RESULT` app action, (b) maps the rich Rust result down to
  `{ found, value, iterations }`, dropping `achievedValue`/`error`, and (c) uses
  an `as unknown as` cast across the snake_case→camelCase boundary. All three
  criticisms (steps 7, 8, 18) are confirmed.
- The `RootFinding` non-target case returns a generic `NumericalError`
  (`mod.rs:170-181`) rather than a typed invalid-request reason — supporting the
  error-taxonomy critique (step 3).
- `kernel/src/domain/workbook/goal-seek.ts` exists (14KB) — the legacy-helper
  observation (step 9) is grounded; the plan correctly hedges that no production
  import was found and conditions its action on that.

That level of source fidelity is the plan's strongest asset.

## Major strengths

- **Contract-matrix-first sequencing.** Step 1 (Objective × Method ×
  dimensionality × bounds × constraints × finite/non-finite × missing-cell →
  classification + result shape + termination + error code) is exactly the right
  acceptance artifact for a routing facade, and it is reused as the test source.
  This is the single most valuable instruction in the plan.
- **Correct architectural boundaries.** It repeatedly insists `compute-solver`
  stays domain-agnostic (no `CellId`/workbook/bridge knowledge) and that the
  facade must not mutate cells. The "preserve the production evaluator path, do
  not optimize a test-only closure" invariant (objective 5, step 13) is a real
  hazard it heads off explicitly.
- **Result-fidelity and read-only/write-through reconciliation.** Steps 7–8
  target a genuine user-facing correctness gap (lost `achievedValue`/error
  detail, and a double-write ambiguity between kernel auto-apply and the app
  Apply action). It demands one documented contract tested end to end rather
  than picking arbitrarily.
- **Budget/telemetry unification (steps 10–12).** The observations about
  `solve_root` not honoring `max_time_ms`, bracket-search evals escaping the
  budget, and DE+NM polish double-counting are concrete and testable, and the
  transformed-vs-raw objective comparison bug (step 11) is a precise,
  high-value correctness concern for `Maximize`/`Target`.
- **Honest non-goals and risk section.** It names the repo-boundary risk
  (private dispatcher in public core), the "budget tightening exposes slow
  models" tradeoff, and the casing-cast paper-over risk. These are the right
  things to worry about.

## Major gaps or risks

- **Scope vs. unit of work.** This is effectively a multi-crate, multi-package
  epic (6 agents A–F spanning Rust facade, `compute-solver`, scheduler, kernel,
  app, and what-if regressions). For a plan nominally scoped to one source
  folder, the blast radius is large and the verification cost high. It would
  benefit from an explicit phase-1 minimal slice (validation + error taxonomy +
  doc reconciliation + result fidelity) that delivers value without the
  external-solver, dependency-scoping, and capability-introspection work.
- **Speculative items mixed with grounded ones.** Step 14 (dependency-scope
  objective evaluation using graph/scheduler machinery) is a substantial,
  correctness-risky optimization presented alongside well-justified fixes. The
  plan does hedge ("guarded by correctness tests… report why it falls back"),
  but it is the weakest-justified item and could be cut or deferred without loss.
- **External-solver boundary is decided-by-deferral.** Step 4 correctly says
  `RequiresPython` is not a production contract, but it leaves the actual
  decision (implement in Rust now vs. define a public extension interface)
  open. Since the experiment shows there is *no* current dispatcher, the plan
  could have committed to a concrete near-term contract: return a deterministic
  `ExternalSolverRequired { serialized_problem }` status and assert no caller
  treats it as success. As written, the most consequential design question is
  pushed into implementation.
- **No measurement of current behavior before changing it.** The plan asserts
  several budget/telemetry bugs but does not require capturing current outputs
  (golden values) before refactor, which makes "did we change behavior we
  didn't mean to" hard to prove given it forbids overfitting iteration counts.
- **Enum/wire compatibility migration is underspecified.** Step 3 proposes
  extending `TerminationReason`/`GoalSeekError` or adding `error_code`/`details`.
  Both `TerminationReason` and `GoalSeekError` are `Serialize`/`Deserialize`
  across the bridge; the plan flags compatibility but does not lay out the
  migration mechanics (versioning, default handling for old payloads, generated
  TS regeneration order) beyond "add structured fields."

## Contract and verification assessment

Contracts are the plan's center of gravity and are mostly well-specified: the
invariants section (parallel solution vectors, finite bounds with `lower<=upper`,
RootFinding requires Target, no override persistence into mirror/Yrs/undo,
read-only vs write-through, aggregate budgets) reads like a usable acceptance
checklist. The "solution vector must always be parallel to `params.variables`
and identify final/best-so-far/unavailable per variable" invariant is
particularly good and currently violated (`requires_python` returns
`solution: vec![]`).

Verification gates are appropriate and proportionate: `cargo test`/`clippy` for
both crates, kernel/app TS tests, `pnpm typecheck`, and a manual dialog
execute/apply/cancel pass. The test list is comprehensive and maps cleanly back
to objectives (contract-matrix, validation, routing-doesn't-lie, Goal-Seek
wrapper parity, root-finding budget accounting, transformed-objective dispatch,
no-persistence scheduler integration, bridge casing, data-table regression).

Two gaps: (1) no gate proves the *negative* repo-boundary constraint (a check
that public `mog` gains no `mog-internal`/Python dependency) — given the plan
calls this out as a top risk, a guard would be warranted; (2) the verification
section lists commands but not pass/fail thresholds or a "regression baseline"
for the budget changes, so "precise failure status" is asserted but not gated.

## Concrete changes that would raise the rating

1. **Split into a committed phase 1 vs. deferred phases.** Mark steps 2, 3, 5,
   6, 7, 8 (validation, error taxonomy, doc reconciliation, Goal Seek unify,
   read-only/write-through, result fidelity) as the must-land slice; move steps
   4, 14, 15, 16 to an explicit follow-up with their own acceptance. This would
   make the plan executable as one reviewable unit.
2. **Commit to a concrete external-solver status now** (e.g.
   `ExternalSolverRequired { method, serialized_problem }` replacing the
   `RequiresPython` placeholder) with a test asserting no caller reads it as
   success — instead of leaving the decision open in step 4.
3. **Decide read-only vs write-through explicitly** rather than stating a
   preference. The evidence (kernel auto-applies *and* an app Apply action both
   exist) means the choice has migration consequences; name the chosen contract
   and the exact files that change.
4. **Add a baseline-capture step** before the budget/telemetry refactor: record
   current evals/iters/elapsed/termination for a fixed problem set so behavior
   changes are intentional and provable.
5. **Specify the enum-migration mechanics** for `TerminationReason`/
   `GoalSeekError`: additive variants vs. `error_code` field, default decoding
   of legacy payloads, and the order of regenerating TS bridge declarations.
6. **Add a repo-boundary verification gate** (a grep/dependency check that the
   public solver gains no `mog-internal`/Python dependency), since the plan
   names this as a primary risk.
7. **Cut or clearly defer step 14** (dependency-scope evaluation); it is the
   least-justified item and carries the most correctness risk relative to its
   stated value.
