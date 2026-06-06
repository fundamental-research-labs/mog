# 085 - Compute Core Solver Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/src/solver`

This plan covers the public Rust `compute-core` solver facade:

- `mod.rs`, which converts spreadsheet-facing solver parameters into `compute-solver` configs, routes methods to Rust algorithms or external-solver sentinels, and converts algorithm results back to bridge results.
- `types.rs`, which defines `Objective`, `Variable`, `Constraint`, `SolverMethod`, `SolverParams`, `SolverResult`, `TerminationReason`, `GoalSeekParams`, `GoalSeekResult`, and `GoalSeekError`.
- `tests.rs`, which currently verifies routing and Goal Seek bridge conversion, while algorithm-level tests live in `compute/core/crates/compute-solver`.

The plan must be implemented in the public `mog` repo. This internal plan file is the only file written by this planning worker.

Adjacent production paths that must be part of the implementation contract:

- `compute/core/crates/compute-solver/src`, the domain-agnostic numerical engine for root finding, Nelder-Mead, BFGS, L-BFGS-B, differential evolution, auto dispatch, and evaluation-budget handling.
- `compute/core/src/scheduler/solver_methods.rs`, which builds the production evaluator closures over `CellMirror`, `OverrideContext`, AST evaluation, and formula text providers.
- `compute/core/src/storage/engine/delegations.rs` and `compute/core/src/storage/engine/delegations/what_if_sync.rs`, which expose solver and Goal Seek through the compute bridge.
- `kernel/src/api/worksheet/operations/goal-seek-operations.ts`, `kernel/src/api/worksheet/what-if.ts`, and `types/api/src/api/worksheet/what-if.ts`, which define the public worksheet Goal Seek behavior.
- `compute/core/src/data_table` and `compute/core/src/what_if/scenarios`, which are adjacent what-if engines and must stay contract-compatible but should not be folded into the solver facade.

## Current role of this folder in Mog

`compute/core/src/solver` is the spreadsheet-facing optimization contract for compute-core. It is not the main numerical implementation. The folder owns the bridge-level shape of optimization requests and responses, plus routing from spreadsheet concepts such as `CellId`, objective cells, changing cells, and Goal Seek parameters into the lower-level `compute-solver` crate.

The current production path is:

1. TypeScript worksheet/app code calls `ws.whatIf.goalSeek(...)` or the compute bridge's solver endpoints.
2. `YrsComputeEngine` delegates to `ComputeCore::solve` or `ComputeCore::goal_seek`.
3. `scheduler/solver_methods.rs` resolves the formula/objective cell, builds an evaluator closure using `OverrideContext`, and evaluates the objective formula with temporary variable overrides.
4. `solver::solve` routes unconstrained Rust-supported methods to `compute-solver`; explicit `Simplex`, `MixedInteger`, and any constrained problem currently return `TerminationReason::RequiresPython`.
5. `GoalSeekParams` bypasses the generic `SolverParams` wrapper and calls `compute_solver::solve_root` directly through the scheduler path.

Important observations from source inspection:

- The docs in `types.rs` and `scheduler/solver_methods.rs` still describe several multi-variable methods as Python-only, but `mod.rs` routes `NelderMead`, `BFGS`, `LBFGSB`, and `GlobalEvolution` to Rust.
- `RequiresPython` is a sentinel result, but no public production catch-and-dispatch path was evident in the inspected public source. That makes constrained, LP, and MIP behavior underspecified.
- Parameter validation is thin. Empty variable lists, non-finite inputs, duplicate variables, invalid bound pairs, objective/variable overlap, and unsupported constraint shapes are not normalized into a single typed error contract before routing.
- Goal Seek has richer Rust wire results (`solution_value`, `achieved_value`, `error`, `error_message`) than the public worksheet API currently returns.
- Public worksheet docs describe Goal Seek as read-only, but `kernel/src/api/worksheet/operations/goal-seek-operations.ts` applies the found solution immediately, while the spreadsheet app also has a separate `APPLY_GOAL_SEEK_RESULT` action.
- A legacy TypeScript Goal Seek implementation remains in `kernel/src/domain/workbook/goal-seek.ts`; inspection found no production import, so it is either dead code or an undocumented non-production helper.
- Root finding in `compute-solver` does not enforce `max_time_ms` the same way the harnessed multi-variable algorithms do, and root-finding bracket/evaluation accounting is not a complete budget contract.
- Global differential-evolution polish can exceed the caller's intended budget because DE and NM polish account separately, and dispatch comparison currently risks comparing raw objective values where transformed objective values are required for `Maximize` and `Target`.
- Data Tables and Scenario Manager are adjacent what-if features with stronger persistent-region/session-state contracts. Solver/Goal Seek should align with those contracts without merging unrelated modules into this folder.

## Improvement objectives

1. Make `compute/core/src/solver` the single authoritative Rust bridge contract for spreadsheet optimization requests, including validation, routing, result semantics, error classification, and method capability reporting.
2. Reconcile Goal Seek contracts across Rust wire types, public TypeScript API types, worksheet operation docs, app dialog behavior, and apply/read-only semantics.
3. Replace sentinel-only unsupported behavior with an explicit solver capability model for Rust-local, external-solver-required, and unsupported problem classes.
4. Validate every `SolverParams` and `GoalSeekParams` request before algorithm dispatch so invalid requests return deterministic typed failures, never panics, partial empty vectors, or ambiguous `NumericalError` fallbacks.
5. Preserve the production evaluator path through `CellMirror`, AST cache, `OverrideContext`, formula text provider, and scheduler semantics. Do not optimize a test-only closure path.
6. Make budgets and telemetry consistent across root finding, local multi-variable solvers, auto cascades, and global-polish flows: evaluation counts, iteration counts, elapsed time, max-time termination, and best-so-far results must mean the same thing.
7. Ensure objective semantics are correct for `Target`, `Minimize`, and `Maximize`, including dispatch cascades, best-result selection, result reporting, and tolerance checks.
8. Define a long-term external solver boundary for constraints, linear programming, mixed integer problems, and dual/shadow-price output without introducing a hidden dependency from public `mog` to private infrastructure.
9. Keep Data Table and Scenario Manager separate, but align shared what-if invariants: temporary overrides restore state, recalculation caches do not leak between hypothetical evaluations, public APIs are clear about read-only versus write operations, and errors surface with stable machine-readable codes.
10. Expand production-path tests so solver correctness is proven through the same bridge, scheduler, and worksheet API paths users exercise.

## Production-path contracts and invariants to preserve or strengthen

- The solver facade remains public `compute-core` source and must not depend on `mog-internal`.
- `compute-solver` remains domain-agnostic: no `CellId`, workbook, sheet, mirror, parser, bridge, or TypeScript API knowledge should move into that crate.
- `compute/core/src/solver` owns spreadsheet-facing request/result shape and method routing; it should not directly mutate workbook cells.
- `ComputeCore::goal_seek` and `ComputeCore::solve` must evaluate hypothetical values through the real formula evaluator, AST cache, formula text provider, and mirror-backed context.
- Goal Seek and generic solver evaluation must not persist temporary variable overrides into `CellMirror`, Yrs storage, undo history, projection state, or collaborative state.
- Public worksheet Goal Seek must have one clear contract: either read-only with an explicit apply action, or write-through with no second apply path. The selected contract must be documented and tested end to end.
- `SolverParams::variables` must be non-empty for algorithms requiring variables, parallel to result solution ordering, and stable under duplicate or invalid `CellId` inputs.
- Bounds must be finite when present, have `lower <= upper`, and be honored by every method that claims bound support. Unsupported bound/method combinations must fail with explicit capability errors.
- `RootFinding` requires `Objective::Target`; non-target objectives should return a typed invalid-request termination or error, not a generic numerical failure.
- `Target`, `Minimize`, and `Maximize` semantics must remain raw-result preserving: results report the workbook formula's raw value at the solution, while internal algorithm comparison may use transformed objective values.
- `max_iterations`, `max_time_ms`, and `precision` must have one documented meaning across Goal Seek and generic solver paths. A zero value must be either rejected or explicitly defined as unlimited/default.
- Every evaluation budget count must include all objective calls, including bracket search, finite-difference probes, line-search probes, cascaded fallbacks, and polish passes.
- Non-numeric formula results, formula evaluation errors, missing formula cells, unresolved cells, and circular/evaluation failures must be distinguishable enough for UI and API callers to present correct messages.
- `RequiresPython` or any replacement external-solver status must not pretend success and must not lose problem metadata needed for a real external dispatch.
- Solver result vectors must always be parallel to `params.variables`; partial/best-so-far results must identify whether each variable value is final, best-so-far, or unavailable.
- Data Table and Scenario Manager behavior remains in `compute/core/src/data_table` and `compute/core/src/what_if/scenarios`; solver changes may share contract concepts but should not centralize all what-if features into the solver folder.
- Native and WASM bridge behavior must match for supported local methods, except where an explicitly documented external-solver capability is unavailable.

## Concrete implementation plan

1. Write the solver contract matrix first.

   Build a matrix covering `Objective` x `SolverMethod` x dimensionality x bounds x constraints x finite/non-finite inputs x missing formula/objective cells. For each row, specify whether the request is Rust-local, external-solver-required, invalid, or unsupported; expected result shape; expected termination; and user-facing error code. Use this as the acceptance source for code and tests.

2. Introduce validated request types inside the solver facade.

   Add internal `ValidatedSolverParams` and `ValidatedGoalSeekParams` structures built from public serde types. Validate non-empty variable lists, finite targets/initial guesses/precision/budgets/bounds, duplicate variable cells, invalid bounds, missing variables for constraints, unsupported integer constraints, and objective/variable overlap policy. Keep public wire structs stable unless the API contract intentionally changes.

3. Replace ambiguous failures with typed termination/error categories.

   Extend or rationalize `TerminationReason` and `GoalSeekError` so invalid input, missing formula, non-numeric evaluation, external solver required, unsupported method, infeasible, unbounded, max time, max evaluations, stagnation, and numerical failure are not collapsed into generic `NumericalError` or `NonNumeric`. If bridge compatibility requires preserving existing enum variants, add structured `error_code`/`details` fields rather than overloading `message`.

4. Define the capability boundary for external solvers.

   Decide whether `Simplex`, `MixedInteger`, and constrained nonlinear problems are implemented in public Rust now or dispatched through a public extension interface. The right production contract is not a silent `RequiresPython` placeholder: callers need a deterministic capability result with enough serialized problem data for a future external solver, and tests must assert that no caller assumes local success.

5. Align docs and generated bridge type comments with actual routing.

   Update comments in `types.rs`, `mod.rs`, `scheduler/solver_methods.rs`, bridge type docs, and public worksheet docs so they agree: root finding, Nelder-Mead, BFGS, L-BFGS-B, differential evolution, and auto dispatch are Rust-local where supported; constrained/LP/MIP behavior follows the explicit capability contract.

6. Unify Goal Seek as a wrapper over the validated generic solver model.

   Keep a convenience `GoalSeekParams` API, but route it through the same validation defaults, objective semantics, budget handling, result conversion, and telemetry as `SolverParams { method: RootFinding }`. Avoid two separate defaults for precision, max iterations, and max change.

7. Resolve Goal Seek read-only versus write-through behavior.

   Preferred production contract: `ws.whatIf.goalSeek` is read-only and returns `solutionValue`, `achievedValue`, `iterations`, and error metadata; the app's Apply action performs the write. If write-through is chosen instead, remove the separate apply path and document the mutation. Either way, make worksheet API docs, kernel implementation, app dialog state, tests, and bridge contracts agree.

8. Preserve full Goal Seek result detail across TypeScript contracts.

   Promote `solutionValue`, `achievedValue`, `error`, and `errorMessage` into the public worksheet result instead of mapping down to `{ found, value, iterations }`. Keep any backwards-compatible aliases only if the public contract requires them, and make generated bridge normalization explicit.

9. Retire or quarantine the legacy TypeScript Goal Seek algorithm.

   If `kernel/src/domain/workbook/goal-seek.ts` is unused, delete it with tests proving the Rust bridge path is the only production path. If it is kept for pure package consumers, mark it as a standalone numerical helper with conformance fixtures against `compute-solver::solve_root` so behavior cannot drift.

10. Fix root-finding budget and telemetry in `compute-solver`.

   Make `solve_root` honor `max_time_ms`; include bracket search and all secant/Brent evaluations in the same budget; report iteration and evaluation counts consistently; return best-so-far on budget exhaustion; and map max-time termination distinctly from max-iteration termination.

11. Correct transformed-objective comparison in solver dispatch.

   Ensure cascades and DE polish choose the better result using objective-aware transformed values, not raw `fun` where `Maximize` and `Target` invert or shift the comparison. Preserve raw `fun` for reporting. Add tests for `Maximize` cascades and `Target` global polish where raw comparison would choose the wrong candidate.

12. Make cascade and polish budgets aggregate.

   Treat auto dispatch as one run with one budget. If Auto tries root then Nelder-Mead, or DE then NM polish, the second phase receives only remaining evaluations/time and the returned telemetry aggregates evaluations, iterations, elapsed time, phases attempted, and final termination reason.

13. Add a production evaluator session for repeated hypothetical evaluations.

   In `scheduler/solver_methods.rs`, factor the duplicated `OverrideContext` setup into a `HypotheticalEvaluator` that owns variable IDs, objective AST, sheet context, formula text provider, eval cache, and evaluating set. It should expose `eval_f64(&[f64]) -> SolverEvalOutcome` and be used by both `solve` and `goal_seek`. Preserve current read-only override behavior, but make cache clearing, circular guard reset, and error classification explicit.

14. Add dependency-scope optimization only on the production path.

   For multi-variable solving, evaluate only the objective's affected dependency chain when safe, using the graph and scheduler machinery rather than re-evaluating unrelated workbook state. This should be a production evaluator feature guarded by correctness tests, not a benchmark-only shortcut. If dependency-chain reuse is not yet safe for all formula features, the evaluator should report why it falls back to current full objective evaluation.

15. Define result application as a separate mutation contract.

   If applying solver results is supported beyond Goal Seek, add an explicit mutation/API operation that writes solution variables through normal `setCell`/mutation paths, with undo, recalc, protection, collaboration, and validation semantics. Do not let read APIs mutate as a side effect.

16. Add solver capability introspection.

   Expose a small public method or constant table for supported methods, dimensional limits, bound support, constraint support, and external-solver requirements. Use it for UI enablement and API error messages instead of duplicating assumptions in app code.

17. Keep Data Table and Scenario Manager aligned but separate.

   Cross-check hypothetical-evaluation cache clearing and restore behavior against `data_table_prepass.rs` and scenario apply/restore. Share utility patterns only where they reduce real duplication; do not move persistent Data Table regions or session-scoped Scenario Manager state into `solver`.

18. Make bridge serialization explicit and generated where possible.

   Ensure solver wire types use one casing policy at the bridge boundary and that TypeScript callers do not rely on ad hoc casts from snake_case to camelCase. Regenerate or update bridge type declarations only as part of the implementation, with contract tests asserting the actual transport shape.

19. Add observability and deterministic diagnostics.

   Add optional phase summaries to solver results: method selected, phases attempted, final method, external-solver requirement, validation errors, and evaluation failure class. Keep user-facing messages stable but make machine-readable details available for tests and UI.

20. Remove stale comments after tests encode the behavior.

   Replace comments that describe old Python-only routing or ambiguous TODOs with tests and concise current documentation. Do not leave multiple conflicting narratives about where solving happens.

## Tests and verification gates

Rust tests to add or strengthen:

- `compute/core/src/solver/tests.rs` contract-matrix tests for every method/objective/dimensionality/capability combination.
- Validation tests for empty variables, duplicate variables, invalid bounds, non-finite values, invalid precision/budgets, objective/variable overlap, and unsupported constraints.
- Routing tests proving Rust-local methods do not return external-solver statuses and constrained/LP/MIP methods return the explicit capability result.
- Goal Seek wrapper tests proving `GoalSeekParams` and equivalent `SolverParams` share defaults, tolerance, budgets, result conversion, and error mapping.
- Root-finding tests in `compute-solver` for max-time, max-evaluation accounting, bracket-search budget inclusion, best-so-far returns, non-finite objective values, and max-change behavior.
- Dispatch tests in `compute-solver` for transformed-objective comparison, `Maximize` cascades, `Target` cascades, DE plus NM polish budget aggregation, deterministic seeds, and telemetry aggregation.
- Scheduler integration tests that build a workbook snapshot, run `ComputeCore::goal_seek` and `ComputeCore::solve`, and assert temporary overrides do not persist.
- Production evaluator tests for formulas with dependent cells, external formula text provider paths, formula errors, non-numeric outputs, circular evaluation, and variable cells on other sheets where supported.
- Bridge/delegation tests for snake_case/camelCase serialization, typed error propagation, and no accidental mutation from read endpoints.
- TypeScript worksheet API tests proving `ws.whatIf.goalSeek` either is read-only or write-through according to the selected contract, with the app dialog apply flow updated accordingly.
- App-level tests driving real dialog actions for execute/apply/cancel states, failed Goal Seek, non-numeric targets, missing formula cells, and achieved-value display.
- Data Table and Scenario regression tests to prove shared hypothetical-evaluation changes do not break data-table prepass restore behavior or scenario apply/restore state.

Required verification gates for an implementation touching this area:

- `cargo test -p compute-solver`
- `cargo clippy -p compute-solver`
- `cargo test -p compute-core`
- `cargo clippy -p compute-core`
- Relevant kernel/app TypeScript tests for worksheet what-if operations and data-analysis handlers.
- `pnpm typecheck` for TypeScript contract/API changes.
- For UI behavior changes, run the spreadsheet dev server and exercise Goal Seek execute/apply/cancel through the real dialog and worksheet API.

## Risks, edge cases, and non-goals

- Solver correctness is inseparable from spreadsheet formula evaluation. A numerically correct algorithm can still be wrong if dependency caches, volatile functions, dynamic arrays, or cross-sheet formula text resolution do not match recalc semantics.
- Budget tightening can expose existing slow models as failures. That is acceptable only if the failure status is precise and callers can adjust budgets intentionally.
- External solver support is a contract boundary risk. Returning `RequiresPython` without a real dispatcher is not enough for production; implementing a private-only dispatcher in public core would violate repo boundaries.
- Goal Seek write-through semantics are currently inconsistent. Changing them may require coordinated updates in kernel, app dialog state, tests, and docs.
- Transport casing normalization is easy to paper over with casts. The plan requires generated or tested contracts instead of relying on runtime shape assumptions.
- Optimization methods can be sensitive to initial values, non-smooth spreadsheet formulas, discontinuities, errors, and volatile functions. Tests should assert stable behavior classes rather than overfit exact iteration counts except where algorithm contracts require them.
- Bounds and constraints can conflict with Excel-like solver expectations. The implementation should define Mog's exact behavior instead of inheriting ambiguous spreadsheet UI conventions.
- This plan does not move Data Tables, persistent Data Table region creation, or Scenario Manager storage into `solver`.
- This plan does not optimize benchmark harnesses or test-only closures. Performance work must target `scheduler/solver_methods.rs` and real compute bridge paths.
- This plan does not add private `mog-internal` dependencies, Python sandbox implementation details, or deployment-specific solver infrastructure to public `mog`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable, but the contracts must be written first so implementation slices compose cleanly.

- Agent A: own `compute/core/src/solver` validation, routing, result types, bridge conversion tests, and docs cleanup.
- Agent B: own `compute/core/crates/compute-solver` root-finding budget enforcement, objective-aware dispatch comparison, cascade/polish budget aggregation, and algorithm telemetry tests.
- Agent C: own `compute/core/src/scheduler/solver_methods.rs` hypothetical evaluator extraction and production-path integration tests.
- Agent D: own TypeScript contract/API alignment in `types/api`, `contracts`, `kernel/src/api/worksheet/operations/goal-seek-operations.ts`, and generated bridge declarations.
- Agent E: own app dialog/action behavior in `apps/spreadsheet/src/dialogs/formulas`, `apps/spreadsheet/src/actions/handlers/data-analysis.ts`, and UI tests for read-only/apply semantics.
- Agent F: own regression coverage for adjacent what-if features in `compute/core/src/data_table`, `compute/core/src/what_if/scenarios`, and related app/kernel data-table tests.

Dependency order:

1. Finalize the solver/Goal Seek contract matrix and public read-only versus write-through decision.
2. Land Rust validation/result/routing contracts and `compute-solver` budget fixes.
3. Update scheduler production evaluator and bridge serialization.
4. Align TypeScript public contracts and app behavior.
5. Run Rust, TypeScript, and UI verification gates through production paths.

