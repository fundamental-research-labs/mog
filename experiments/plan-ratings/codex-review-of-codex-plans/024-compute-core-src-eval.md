Rating: 8/10

Summary judgment

This is a strong plan for `compute/core/src/eval`. It correctly treats the folder as the production formula execution core, identifies the scheduler and `MirrorContext` as the production path, and focuses on structural contracts rather than isolated evaluator fixes. The plan's biggest weakness is that it combines several large architectural programs into one implementation plan without enough milestone-level acceptance criteria. As written, it is a very good strategic plan, but not yet a fully executable contract for parallel implementers.

Major strengths

- The scope is accurate and production-relevant. Inspection of `Evaluator::evaluate()` call sites in scheduler, cycle, data-table, schema-validation, and eval-bridge paths supports the plan's claim that production recalc converges on the evaluator plus context adapters.
- The plan correctly identifies real current gaps: `evaluate_with_deadline()` exists but production paths call `evaluate()`; `EpochCache` still documents thread-local access as the actual path; external AST refs currently fail closed; `database_cache.rs` is placeholder-only; vectorized eval is staged and locally tested rather than wired into scheduler execution.
- The invariant list is unusually useful. It names boundaries that would otherwise be easy to break, especially final `CellValue` output, evaluator-only value containment, scheduler-level `Null` coercion, uniform operation/deadline limits, and cache epoch isolation across data tables/cycles/rayon/WASM.
- It respects package boundaries. The plan keeps implementation in public `mog`, keeps internal planning private, and calls out neighboring public crates only where formula contracts actually cross crate boundaries.
- Verification is production-path oriented. The gates include `cargo test -p compute-core`, clippy, feature-sensitive tests, and scheduler/`ComputeCore` fixtures instead of only evaluator unit tests or benchmarks.
- The parallelization notes are credible. The proposed slices map to separable concerns once the session and reference contracts are stabilized.

Major gaps or risks

- The plan is too broad for one "concrete implementation plan" without explicit phases and stop conditions. `EvalSession`, epoch cache ownership, first-class references, primitive dispatch refactor, fast-path differential testing, vectorized production integration, external reference evaluation, observability, and production fixtures are each substantial. The sequencing says what should land first, but not what constitutes a complete first mergeable slice.
- `EvalSession` is named but not specified enough. The plan should define the exact fields, ownership model, lifetime shape, native/WASM cache abstraction, and migration strategy from `Evaluator<'a, D, M>` before asking agents to thread it through scheduler/storage paths.
- `ResolvedReference` and first-class reference values need a sharper contract. The plan lists reference kinds and consumers, but does not define materialization rules, error mapping, final-output behavior for a bare reference, cross-sheet/3-D union shape, or how reference identity interacts with `CellValue::Array`, spills, structured refs, and dependency extraction.
- The primitive dispatch table needs an explicit matrix deliverable. The plan says entries should declare arity, laziness, defaults, volatility, reference needs, and array lifting, but does not enumerate the initial function set or define how pure-registry metadata and eval-layer metadata stay synchronized.
- Vectorized shared-formula integration remains risky. The eligibility guards are good, but the plan should require an off-by-default production flag, scalar comparison mode, and result application through the exact scheduler spill/null/error/cache-invalidation path before any performance enablement.
- External references are under-scoped relative to their security surface. The eval-side provider contracts exist, but implementation also needs principal propagation, batching ownership, circular-read tokens, diagnostics policy, and bridge/runtime tests. The plan notes these topics, but does not identify the authoritative owner outside eval.
- Fast-path equivalence coverage is strong in breadth but not bounded. The plan should say which fast paths are already production-enabled, which are staged, and which differential tests are mandatory before changing each path.
- Observability requirements are plausible but could sprawl into public metrics or tracing churn. The plan should distinguish required correctness diagnostics from optional telemetry enhancements.

Contract and verification assessment

The plan has strong high-level contracts and generally excellent production-path relevance. Its invariants match live architecture: final evaluator output is `CellValue`, evaluator-only `EvalValue` variants currently cover cells/lambdas/omitted args, references mostly materialize early, scheduler still handles result packaging and final `Null` coercion, and thread-local cache clearing is still a scheduler/session concern.

The main contract weakness is lack of API-level specificity. A reviewer can understand the intended architecture, but an implementer could still make incompatible choices about session ownership, cache sharing, reference value representation, external error mapping, and primitive metadata shape while claiming to follow the plan. The plan should convert the most important prose contracts into type sketches, acceptance tests, and migration checkpoints.

The verification gates are appropriate for final implementation work and correctly avoid test-only performance paths. They need per-phase gates as well. For example, the `EvalSession` phase should require scheduler deadline behavior tests; the cache phase should require rayon/data-table/cycle epoch isolation tests; the reference phase should require direct reference-consumer and materialized-consumer comparison fixtures; and vectorized/external phases should remain independently gated and off by default until equivalence/security tests pass.

Concrete changes that would raise the rating

- Split the implementation into 4-6 named milestones with explicit deliverables, exit criteria, and required gates for each milestone.
- Add a type-level sketch for `EvalSession`/`EvalOptions`, including deadline, operation limits, epoch cache handle, workbook cache access, external context/provider, trace/journal metadata, and native/WASM ownership rules.
- Define the `ResolvedReference`/internal reference value contract precisely: variants, materialization API, final-output conversion, error behavior, range clamping, structured/3-D/external handling, and dependency-extraction expectations.
- Include a primitive metadata matrix covering every eval-layer primitive currently dispatched in `eval_primitives.rs`, with argument modes and laziness/default/reference behavior.
- Require vectorized evaluation to ship behind an explicit disabled-by-default gate with scalar equivalence comparison and normal scheduler result application before performance enablement.
- Identify the non-eval owners required for external references and specify which work belongs in eval versus bridge/runtime/provider layers.
- Add per-fast-path differential-test minimums tied to currently enabled production paths, so implementers know which equivalence tests must land before cache or optimization changes.
- Separate mandatory correctness diagnostics from optional observability enhancements to keep the plan focused on verifiable behavior.
