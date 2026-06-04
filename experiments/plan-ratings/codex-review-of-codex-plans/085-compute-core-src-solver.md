Rating: 8/10

Summary judgment

This is a strong, source-aware plan that correctly treats `compute/core/src/solver` as a spreadsheet-facing bridge contract rather than the numerical engine itself. It identifies the real production path through `scheduler/solver_methods.rs`, the bridge delegations, worksheet API, and app Goal Seek flow, and it catches several concrete inconsistencies visible in the code: stale Python-only comments, sentinel `RequiresPython` behavior, thin validation, duplicated hypothetical evaluator setup, root-finding budget gaps, raw-objective comparison in dispatch, and Goal Seek read-only versus write-through mismatch.

The main reason it is not a 9 or 10 is that it still defers some of the highest-leverage contract decisions. It asks implementers to "write the matrix first", "decide whether" external solvers are implemented or dispatched, and choose read-only versus write-through Goal Seek behavior. Those are exactly the specification decisions the plan should settle, or at least constrain with concrete accepted alternatives, before parallel implementation starts.

Major strengths

- The folder scope is accurate: the plan keeps `compute-solver` domain-agnostic and keeps spreadsheet concepts in `compute-core`/scheduler/API layers.
- It is production-path oriented. It does not stop at facade tests; it requires scheduler, bridge/delegation, worksheet API, app dialog, and adjacent what-if regression coverage.
- It names specific current defects and mismatches instead of speaking generally: `RequiresPython`, `NumericalError` fallback, Goal Seek result detail loss, casing casts, root budget accounting, and app/API mutation inconsistency.
- The plan has good architectural boundaries for public versus internal infrastructure and explicitly avoids adding private `mog-internal` dependencies to public `mog`.
- The parallelization notes are credible because the work slices map cleanly to contracts: facade validation/routing, numerical crate budgets/objectives, scheduler evaluator, TypeScript API, app UI, and adjacent what-if regressions.

Major gaps or risks

- The required solver contract matrix is described but not supplied. Without at least an initial matrix for method/objective/dimensionality/bounds/constraints/error classes, implementation agents can still make incompatible choices.
- The external solver boundary remains under-specified. "Public extension interface" versus "implement in public Rust now" is a large architectural fork, and the plan does not define the serialized problem shape, capability result schema, or what UI/API callers should receive today.
- Goal Seek semantics are still a decision point. The plan states a preference for read-only, but a reviewable implementation plan should explicitly select it and list the exact API/doc/app migration steps and compatibility aliases.
- Typed errors are directionally right but not concrete enough. The plan should propose the actual `TerminationReason`/`GoalSeekError`/`error_code` vocabulary and bridge casing contract rather than leave implementers to invent it during code changes.
- The scope is very broad for a folder-scoped plan. Some items, such as dependency-chain optimization, solver result application APIs, and capability introspection, are valid but should be milestone-gated so foundational contract fixes do not get tangled with performance and product-surface expansion.
- Backward compatibility is not fully addressed. Promoting `solutionValue`/`achievedValue` while the current public API exposes `{ found, value, iterations }` needs an explicit migration plan, generated type update path, and consumer compatibility policy.

Contract and verification assessment

The verification coverage is one of the plan's strongest parts. It calls for `cargo test`/`clippy` on both `compute-solver` and `compute-core`, TypeScript tests for worksheet what-if behavior, `pnpm typecheck`, and real UI exercise for dialog changes. It also correctly requires production evaluator tests rather than test-only closures.

The contract assessment is strong but incomplete. The plan identifies the right contracts to make explicit: validation before dispatch, objective semantics, budgets, result vector ordering, no mutation from read endpoints, external solver capability, and native/WASM parity. What is missing is the actual accepted contract for several of those areas. In Mog terms, it is an excellent discovery and direction document, but it is not yet a fully verifiable implementation spec.

Concrete changes that would raise the rating

- Add the initial solver contract matrix directly to the plan, including expected result shape, termination/error code, and capability classification for every currently exposed method/objective/constraint class.
- Select Goal Seek read-only semantics as the contract, then specify the exact changes to worksheet docs, kernel operation, app apply flow, bridge result mapping, and backward-compatible public API aliases.
- Define a concrete capability/error schema for invalid, unsupported, external-required, infeasible, unbounded, max-time, max-eval, non-numeric, and missing-formula cases.
- Specify the external solver boundary as a stable public problem descriptor plus capability response, even if no external dispatcher is implemented in this milestone.
- Split the work into milestones: contract/validation/API alignment first, numerical budget/objective fixes second, scheduler evaluator extraction third, performance/dependency-scope optimization later.
- Add exact acceptance tests for API compatibility, especially `value` versus `solutionValue`, snake_case versus camelCase transport behavior, and read endpoint non-mutation.
