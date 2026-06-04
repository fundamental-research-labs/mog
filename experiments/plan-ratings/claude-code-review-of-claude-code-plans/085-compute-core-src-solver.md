Rating: 8/10

# Review of plan 085 — `mog/compute/core/src/solver`

## Summary judgment

This is a strong, evidence-driven plan. It correctly identifies that the folder is a *bridge* (contract + type translation + routing), not an algorithm home, and it scopes its objectives to that role: routing correctness, contract truthfulness, and closing a dead-end terminal state. Nearly every factual claim in the "Evidence" section checks out against the current tree, and the contract/invariant analysis is unusually careful (determinism, read-only evaluation, `solution`-length totality, objective-transform 1:1). The sequencing is sound — pure bridge-only correctness fixes first, the large cross-folder algorithmic lift isolated and deferred.

The main reason it is not a 9–10: the *headline* objective (native constrained/integer optimization, step 5) lands almost entirely in an explicitly out-of-scope crate, is a substantial algorithmic undertaking, and its verification gates are comparatively thin relative to its size and risk. The in-scope folder cannot deliver its own banner feature alone — and the plan, while honest about this, still frames it as the centerpiece.

## Verification of evidence (spot-checked against source)

- `RequiresPython` dead end: confirmed. Producers are only `solver/mod.rs:118-135` plus doc comments; the single hit in `scheduler/solver_methods.rs:21` is a doc comment, not a handler. No TS/app/infra consumer exists. Accurate.
- Bounds dropped for `NelderMead`/`BFGS`: `to_crate_config` (mod.rs:35-42) always builds `bounds`; `dispatch.rs:11-15` confirms only L-BFGS-B/DE honor bounds. Accurate.
- Integer-constraint invariant unenforced (`types.rs:42-44` vs `mod.rs:163-166`): accurate — any non-empty `constraints` short-circuits to `requires_python`.
- Default disagreement (`types.rs:96-99` doc says `1e-6`/`1000`/`30000` vs `mod.rs:47-53` `10_000`/`100`, `1e-8`/`1e-6`): accurate.
- Two divergent root paths: confirmed — `solver_methods.rs` goal_seek sets `root_finding_step_limit = max_change`, `max_time_ms = 0` and calls `solve_root` directly; the unified `solve()` path leaves the crate default and sets `max_time_ms = 30_000`. `SolverParams` has no step-limit field. Accurate.
- Dead `Unbounded`/`Infeasible`, collapsed `MaxEvaluations→MaxIterations`, `dual_values: None`, empty `solution` on error paths: all confirmed in mod.rs:76-86, 118-135, 169-182.
- Determinism via DE fixed seed: confirmed at `diff_evolution.rs:257-259` (`seed_from_u64(0)` when `config.seed` is `None`). Good catch and the right invariant to protect.

The plan's empirical grounding is its biggest strength; I found no overstated evidence.

## Major strengths

- **Correct altitude.** It resists the temptation to "improve" by reimplementing algorithms in the bridge; it keeps `to_crate_objective` a pure map and pushes math into the crate.
- **Contract truthfulness as a first-class goal.** The defaults reconciliation (one `const` source of truth referenced by doc comments) and the `solution`-length totality contract are exactly the kind of fixes that prevent silently-wrong results and consumer panics.
- **Sequencing and parallelizability are explicit and correct.** Steps 1–3 are genuinely bridge-only and independent; step 4 is correctly gated behind step 1 and flagged as cross-folder; step 6 correctly depends on step 5.
- **Invariant preservation is concrete**, not hand-wavy: determinism (fixed seed default), read-only override evaluation for new constraint closures, NaN→reject sentinel parity, additive bridge-ts changes.

## Major gaps or risks

- **Step 5 dominates risk and is mostly out-of-scope.** Penalty/augmented-Lagrangian plus branch-and-bound (or DE-with-integrality) is a real numerical-engineering project in `compute-solver`, the folder explicitly named as not-an-edit-target. The plan acknowledges this, but it means the in-scope folder's headline win is contingent on a large external deliverable whose own verification ("penalty convergence on a known QP; B&B on a small MILP") is sketched at one line each. A plan scoped to the bridge probably should either (a) treat steps 1–4,6,7 as the deliverable and split step 5 into its own crate-scoped plan, or (b) state an interim honest behavior (`Unsupported`) so the bridge is shippable before the engine work lands.
- **Silent method substitution (step 2) is a debatable behavior change.** Redirecting an explicit `NelderMead`/`BFGS` request to `LBFGSB` when bounds are present overrides a user/caller's stated method. The "or reject" alternative is offered but the choice is left open. This is a product-visible decision worth pinning down (and possibly surfacing in the result message) rather than leaving as either/or.
- **`MaxEvaluations` preservation is under-specified.** Step 6 says "add a bridge variant or map it without conflating" — but adding a `TerminationReason` variant is a serialized-contract change rippling to bridge-ts, and the plan doesn't commit. Note also `GoalSeekError::MaxIterations` already maps from crate `MaxEvaluations` (mod.rs:101), so naming consistency between the two enums deserves a sentence.
- **`x0` finiteness / fixed-variable edge case interaction.** Step 3 validates `lower <= upper` and `x0` finiteness, but the equal-bound (fixed variable) case feeding into L-BFGS-B and B&B-needs-finite-bounds-for-integers cases are only listed under "edge cases," not wired into the validation contract. These are the cases most likely to produce a false `converged`.

## Contract and verification assessment

The contract analysis is the best part of the plan. It correctly treats `SolverParams`/`SolverResult`/`GoalSeek*` as a dual seam (Rust↔crate and Rust↔TS), insists added fields be additive with bridge-ts updated in lockstep, and turns the loose "`solution` parallel to variables" doc into a stated total contract across every return path. The verification gates map cleanly onto the objectives: bounded-request-honors-bounds, validation-error-not-RequiresPython, default-constants drift guard, goal-seek/solve equivalence on a shared fixture, per-termination `solution.len()` invariant, and a determinism double-run. These are the right tests.

Weaknesses: the crate-level gates for the largest piece (constrained/integer) are thin (one property each) given that "false convergence" is the named risk; a bound/constraint-*satisfaction* property test (assert the returned point actually satisfies every active constraint within tolerance, for randomized inputs) should be a hard gate, not an aside. The bridge-ts golden test is named but the actual allow-list mechanism/location is asserted rather than cited, so a reviewer can't confirm the lockstep step is real work vs. assumption.

## Concrete changes that would raise the rating

1. **Split the deliverable.** Make steps 1–4, 6 (variant cleanup + honest `Unsupported`), and 7 the in-scope plan with shippable interim semantics; move step 5 (native constrained/integer engine) into a dedicated `compute-solver` plan it can depend on. This makes the in-scope folder independently completable.
2. **Decide the bounds-redirect behavior** (redirect vs. reject) explicitly, and require the result `message` to state when a method was substituted, so the change is observable and testable.
3. **Promote constraint-satisfaction to a hard property-test gate**: for randomized feasible problems, assert every active constraint and every bound holds within tolerance whenever `converged: true`; prefer non-converged/`Infeasible` otherwise. This directly mitigates the "false convergence" risk the plan itself flags.
4. **Pin the `TerminationReason` evolution**: commit to either a new `MaxEvaluations` variant (with the bridge-ts additive change spelled out) or a documented lossless mapping, and reconcile naming against `GoalSeekError::MaxIterations`.
5. **Fold the fixed-variable and integer-needs-finite-bounds edges into `validate_params`** with explicit return behavior, rather than leaving them in the prose edge-case list.
6. **Cite the bridge-ts allow-list path** (file + mechanism) so the "update in lockstep" dependency is verifiable rather than assumed.
