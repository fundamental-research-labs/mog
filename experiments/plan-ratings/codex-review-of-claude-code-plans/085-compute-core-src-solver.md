Rating: 7/10

Summary judgment

This is a serious, evidence-driven plan with a good understanding of the solver folder as a spreadsheet-aware bridge over the domain-agnostic `compute-solver` crate. It correctly identifies several production-path contract problems: `RequiresPython` is a dead-end result, Goal Seek and `solve(method: RootFinding)` diverge, documented defaults do not match applied defaults, some termination/result fields are not truthful, and the bridge needs stronger validation.

The rating is held to 7 because one major evidence claim is stale or incorrect, and the largest implementation step is still too underspecified to be a verifiable engineering contract. Current `compute-solver` BFGS and Nelder-Mead do project candidate points into bounds, so the plan's "bounds are silently dropped" framing is not supported by the current source. Also, native constrained optimization needs a much crisper interface and acceptance spec before it can be implemented safely.

Major strengths

- The folder boundary analysis is strong. The plan distinguishes `solver/types.rs` as the serialized contract, `solver/mod.rs` as the type/routing bridge, `scheduler/solver_methods.rs` as the spreadsheet evaluation closure owner, and `compute-solver` as the numerical engine.
- The `RequiresPython` critique is production-relevant. The source produces `TerminationReason::RequiresPython`, but the inspected production paths simply return the result; there is no clear downstream Python dispatch path.
- The root-finding divergence is a real contract issue. `GoalSeekParams` claims it maps to `SolverParams`, while `ComputeCore::goal_seek` calls `compute_solver::solve_root` directly with different `root_finding_step_limit` and `max_time_ms` behavior.
- The plan pays attention to contract truthfulness rather than just adding algorithms. Defaults, termination reasons, `solution` length, `dual_values`, deterministic DE seeds, and bridge-ts regeneration are exactly the right surfaces to call out.
- Sequencing is mostly sensible: bridge-only correctness fixes before cross-folder algorithm work, with explicit notes for scheduler and bridge-ts dependencies.

Major gaps or risks

- The bounds diagnosis needs correction. `compute/core/crates/compute-solver/src/bfgs.rs` projects `x` and `x_new` through `project_vec`, and `nelder_mead.rs` projects the initial simplex and each reflected/expanded/contracted point. The plan may still want bound-invariant tests and final-result checks, but it should not claim BFGS/Nelder-Mead ignore bounds without a narrower failing case.
- Redirecting explicit `NelderMead` or `BFGS` requests to `LBFGSB` is a contract change that the plan does not justify enough. If explicit method selection means "use exactly this algorithm," a validation error or documented `Auto`-only reroute may be cleaner than silently changing the solver.
- Constraint validation is ambiguous. For `Constraint::Integer`, the `CellId` must match a variable. For continuous `LessEqual`/`GreaterEqual`/`Equal`, the `cell_id` appears to be a constraint formula cell, not necessarily a variable. The plan sometimes says "validate constraint CellIds against the variable set," which would be wrong for formula constraints.
- Native constrained optimization is the headline objective, but the plan does not define the new callable interface. The current bridge receives only `FnMut(&[f64]) -> f64` for the objective; constrained solving needs either separate constraint evaluators, an evaluator trait, or a structured callback result from the scheduler.
- The algorithm contract for constraints is too open-ended. "Penalty / augmented-Lagrangian" and "branch-and-bound or DE-with-rounding" are alternatives, not a spec. The plan needs chosen methods, feasibility tolerances, equality handling, integrality tolerance, finite-bound requirements, budget accounting, deterministic seed behavior, and exact conditions for `Infeasible`/`Unbounded`.
- `Simplex`/`MixedInteger` are not clearly reconciled with arbitrary spreadsheet formulas. If `Simplex` is meant to be LP-specific and produce `dual_values`, the plan needs linearity detection or a contract saying this is generic nonlinear constrained solving with no duals.
- The serialization guidance conflicts with later recommendations. It says changes should be additive and stable, but also suggests removing or replacing `RequiresPython`, `Unbounded`, `Infeasible`, and possibly `dual_values`. That needs a migration sequence rather than a single contract edit.

Contract and verification assessment

The contract assessment is better than average: it identifies public Rust/TS types, bridge-ts regeneration, deterministic recalculation, read-only objective evaluation, objective transform semantics, NaN handling, and result-shape invariants. The biggest contract omission is the missing constraint-evaluator interface between `ComputeCore::solve`, `solver::solve`, and `compute-solver`.

The verification plan has good test categories, but it is not concrete enough for Mog's verification standard. It should name the exact Rust package gates, include clippy for touched crates, include bridge-ts generation/verify commands for serialized type changes, and include at least one production-path scheduler/API test for Goal Seek/Solver behavior. The bounded-solver tests also need to cover all relevant paths, including `Auto`, `LBFGSB` fallback/cascade, and `GlobalEvolution` polish if bounds are present.

Concrete changes that would raise the rating

- Replace the incorrect "bounds are silently dropped" evidence with a current-source audit of how each method handles bounds, then define the remaining invariant precisely: every converged result with finite bounds must satisfy those bounds within tolerance.
- Decide the explicit-method contract: exact algorithm, documented reroute, or validation error. Add tests that enforce that decision.
- Specify a `ConstraintEvaluator` boundary: what inputs it receives, how constraint formula cells are evaluated under overrides, how many constraint values are returned, how NaN/Inf maps to rejection, and how eval counts are charged.
- Separate continuous constraint cell IDs from integer variable cell IDs in validation rules.
- Turn the constrained/integer solver step into a concrete design: selected algorithms, feasibility/integrality tolerances, bound requirements, deterministic seeds, termination mapping, and known problem fixtures.
- Add a migration plan for public enum/field changes: additive `Unsupported` first, bridge-ts output update, downstream consumer updates, and only then deprecate or remove stale variants if compatibility policy allows.
- Make verification gates executable: `cargo test`/`cargo clippy` for `compute-core` and `compute-solver`, bridge-ts generator/verify tests for changed exported types, and scheduler-level behavior tests for unified Goal Seek.
