Rating: 8/10

Summary judgment

This is a strong plan for a high-risk production boundary. It is grounded in the actual shape of `kernel/src/bridges/compute`: `compute-bridge.ts` and `compute-core.ts` are both large, direct transport calls and manual tuple handling are real, the generated manifest is currently too coarse, security/session methods are still hand-written despite Rust session annotations, and the sync mutation-result test documents a real cross-layer contract gap. The plan also preserves the right architectural truths: Rust owns compute state, generated artifacts should not be hand-edited, mutation patches and viewport movement are independent pipelines, `MutationResultHandler` is the event gateway, provider updates must drain synchronously after mutations, and TypeScript workarounds should move back into Rust when they compensate for engine contract gaps.

The main weakness is executability. The plan is excellent as a roadmap, but the first implementation pass is still broad enough that parallel agents could make incompatible cuts. It needs a stricter Phase 0 contract artifact, a clearer extraction order for `ComputeCore`, and more precise verification gates for generated code, sync, and transport variants.

Major strengths

- Production-path relevance is high. The plan focuses on the kernel-to-compute bridge used by document lifecycle, SDK/headless paths, provider sync, viewport buffers, and UI rendering rather than mocks or test-only helpers.
- The architectural direction is correct: make bridge metadata and generated dispositions the source of truth, then remove one-off TypeScript overrides by fixing Rust descriptors, bridge-ts, or transport metadata.
- The invariants section is unusually useful. It names ordering, write-gate, lifecycle, trap, sync/hydration, provider update, viewport identity, bounds conversion, undo/redo, and event-gateway contracts that implementation can turn into tests.
- The plan correctly treats TypeScript-side formula `#REF!` search and sheet-copy full-recalc bypasses as Rust contract gaps, not bridge behavior to normalize forever.
- It recognizes that manual direct `core.transport.call(...)` sites are a category problem, not isolated bugs, and proposes an audit that would prevent new silent bypasses.
- The parallelization notes identify plausible workstreams and dependency owners across `kernel`, `compute/api`, `compute/core`, `infra/rust-bridge/bridge-ts`, and `infra/transport`.

Major gaps or risks

- The contract inventory is specified as a goal but not as a concrete artifact. It should define an exact schema, output location, derivation sources, direct-call allowlist, manual override disposition values, and fail conditions before any refactor starts.
- `ComputeCore` decomposition is under-sequenced. The plan names good service boundaries, but it does not define the stable facade that generated methods may depend on (`docId`, guarded `transport`, `mutate`, `mutateCore`, `query`, lifecycle guards, viewport hooks), nor how direct test and production imports of `ComputeCore` migrate.
- Return-shape generation needs a starting matrix. Known cases include normal bytes-plus-mutation, bare value reads, bare `RecalcResult`, void mutation-like methods, id-plus-mutation, id-plus-config-plus-mutation, packed bytes tuples, and stateless reads. The plan asks implementers to classify them but does not provide the initial expected classification.
- Session/security behavior needs sharper lifecycle semantics. Rust has `#[bridge::session]`, but the generated manifest currently only models read/write/lifecycle. The plan should state whether principal/session methods require an initialized document, whether they bypass write gates, and how they differ from reads and writes in generated metadata.
- The sync section depends on a test suite that currently describes itself as expected to fail and can skip when the NAPI path is unavailable. The plan should require converting that into a non-skipping production gate or pairing it with a Rust gate that proves the same mutation-result domain fields.
- Deep import cleanup is real but broad. Source consumers currently import from `compute-types.gen.ts` and `compute-core.ts` in many places, so the plan needs a migration order: add stable barrels first, migrate consumers, then restrict deep imports.
- Floating-object and chart normalization work is valuable, but it is a large domain-contract project. It should be a later milestone after the bridge method inventory and generation contract are in place, otherwise it risks diluting the core bridge refactor.
- Diagnostic counters for provider updates may be useful, but they are less essential than ordering and exactly-once contracts. The plan should not let observability additions substitute for behavioral proof.

Contract and verification assessment

The contract goals are mostly right, but they need to become machine-checkable earlier. The strongest version of this plan would make the contract matrix fail when a generated method lacks doc scope, lifecycle phase, method kind, return shape, provider-update behavior, security/session behavior, or manual override disposition. It should also fail when a hand-written method calls raw transport outside an explicit disposition.

The verification section is broad and production-minded, but it has holes for the code it proposes to change. If `bridge-ts` is edited, it needs `cargo clippy -p bridge-ts` in addition to bridge-ts tests. If generated type ownership changes, the gate should include the compute type generation/freshness path, not only bridge and manifest generation. If return-shape generation changes, the smoke matrix should explicitly cover NAPI, WASM, and Tauri packing/normalization semantics or name the smallest equivalent transport gates. For TypeScript, `pnpm --filter @mog-sdk/kernel typecheck` is appropriate, but behavior gates should explicitly assert write-gate-before-transport, provider drain exactly once, state-before-event ordering, hydration deficit backfill, and post-trap short-circuiting.

Concrete changes that would raise the rating

1. Add a Phase 0 section with the exact contract matrix schema, expected source inputs, generated output/test location, direct transport allowlist, and initial dispositions for every current manual override category.
2. Define the `ComputeCore` facade contract before decomposition, including which members generated bridge code can use and which subservices stay private.
3. Add an explicit extraction sequence: contract inventory, generator return-shape/session support, manual override reduction, then `ComputeCore` service extraction.
4. Specify session method lifecycle and write-gate rules, especially for active principal and security diagnostics.
5. Convert `sync-mutation-result.test.ts` from an expected-failure/skippable signal into a required gate or add an equivalent non-skipping Rust production-path gate.
6. Add missing verification gates for `cargo clippy -p bridge-ts`, compute type generation freshness, generated artifact clean-diff checks, and transport return-shape coverage.
7. Add a public-export/deep-import migration plan before tightening imports from `.gen.ts` and `compute-core.ts`.
8. Split floating-object/chart adapter formalization into its own milestone after the bridge inventory and generation contracts are established.
