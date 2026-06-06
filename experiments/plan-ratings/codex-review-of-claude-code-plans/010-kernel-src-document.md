Rating: 8/10

Summary judgment

This is a strong plan. It is grounded in the actual `mog/kernel/src/document` production path, identifies real defects in `RustDocument` inbound-origin handling and import-initialize promotion, and treats provider contracts, host-backed ownership, and lifecycle-machine purity as load-bearing constraints rather than incidental code shape. The evidence is concrete enough that an implementer would know where to start, and the test list maps well to the folder's existing suites.

The rating is not higher because the plan is too broad for one coherent implementation stream and some acceptance contracts remain under-specified. It combines correctness races, provider-base refactors, public interface tightening, lifecycle-host extraction, Tauri sidecar wiring, diagnostics, and README cleanup. Those are related, but not all equally urgent or equally coupled. The plan also proposes a few high-risk moves, especially making provider lifecycle methods mandatory and removing `stateVector()`, without fully specifying compatibility, rollout, or the exact type/package contract across `@mog-sdk/types-document` and existing test harnesses.

Major strengths

- The plan correctly frames this folder as document lifecycle, provider persistence, and ownership/admission rather than as a narrow persistence implementation. That matches the actual code boundaries.
- The two most important production defects are well chosen: `_currentUpdateOrigin` is a shared mutable field across an async dynamic import before `applyUpdate`, and import-initialize promotion checks the queue before async checkpoint work can interleave.
- It preserves key architectural invariants: pure XState machine, side-effect host, provider FIFO/backpressure, apply-before-emit mirror behavior, host-backed fail-closed validation, legacy boundary guards, and the collab R1 bypass.
- The provider-contract work is systematic instead of whack-a-mole. The duplicated queue/flush/idempotency implementation across memory, filesystem, object-store, and database-log providers is real, and a conformance-gated base extraction is architecturally reasonable.
- Verification is mostly concrete. It names existing suites, new regression tests, boundary guards, and static gates rather than relying on broad "run tests" language.

Major gaps or risks

- Phase scope is over-packed. Phases 1 and 2 are correctness fixes; Phases 3-6 are refactors/type-contract changes; Phase 7 may depend on external desktop IPC; Phase 8 mixes proof-store bounds, observability policy, and diagnostic hatch semantics. These should be split into explicit landing units with stop/go criteria, not presented as one linear improvement.
- The plan says to make `getCapabilities()`, `getIdentity()`, and `storageCursor()` mandatory and drop the `stateVector()` alias, but `ProviderInboundUpdateEnvelope` and provider capability types already live in `@mog-sdk/types-document`, and many tests and adapters still call `stateVector()`. The migration needs an exact compatibility strategy: one breaking commit across all packages, or an additive deprecation phase with dual support and public API versioning.
- The Phase 1 fix offers alternatives but not a final contract. Hoisting the dynamic import removes one yield, but the real invariant should be "provider-origin tagging is scoped to one engine apply and cannot be overwritten by concurrent inbound applies." The plan should choose whether that is achieved by per-call bridge context, an inbound apply mutex, or a bridge callback signature change.
- The Phase 2 language says the orchestrator queue check should "consult the gate," but `RustDocument` does not own `WriteGate` directly; it reaches it through `computeBridge.writeGate`. The plan needs to specify the exact ownership API and how bridge-pending updates, microtask queues, staged providers, and baseline-causality are ordered while the checkpointing barrier is active.
- Tauri provider handling is underspecified. The plan correctly rejects a selectable throwing provider, but "wire the native sidecar IPC" may be blocked outside this folder. If wiring is not possible, unregistering must name the actual factory/host registration path and the expected composition-preflight failure mode.
- Observability is too vague for production acceptance. "One tagged diagnostic channel" should identify the existing logging/telemetry surface, event names, severity policy, and whether provider contract violations become surfaced document state, telemetry only, or fatal errors.

Contract and verification assessment

The contract section is one of the plan's best parts. It calls out the invariants an implementer must not break, including provider FIFO semantics, synchronous-start `flushSync`, lifecycle-machine purity, host-backed no-global behavior, and legacy guard behavior. That makes the plan reviewable and reduces accidental architecture drift.

The verification section is good but should be sharpened. For this TypeScript package, the acceptance gate should explicitly include `pnpm --filter @mog-sdk/kernel test` and `pnpm --filter @mog-sdk/kernel typecheck`, plus repo import-boundary lint if imports move. If public/mirrored provider types change, it should also require the relevant `@mog-sdk/types-document` and `@mog-sdk/contracts` build/type gates, not just mention declaration rollup conditionally. For Phase 7, conformance tests alone are not enough; there should be a real Tauri host-path integration or an explicit preflight rejection test if the provider is unregistered.

Concrete changes that would raise the rating

- Split the plan into three deliverables: correctness races first, provider contract/refactor second, and Tauri/observability/docs third. Give each deliverable its own merge criteria and rollback-safe boundary.
- Replace Phase 1 alternatives with one chosen design and a crisp invariant: origin is carried by call-scoped apply context or inbound applies are serialized by an explicit queue.
- Specify the import-promotion barrier as a precise state machine: when the write gate changes mode, when bridge updates are flushed, when queued updates are drained or deferred, when staged providers checkpoint, and when providers become live.
- Add a compatibility matrix for the provider interface change covering in-tree providers, `sdk-storage-adapter`, test providers, `@mog-sdk/types-document`, public barrels, and existing `stateVector()` consumers.
- Define the diagnostic contract for provider failures, including event names, severity, user-visible state if any, and tests that assert misbehaving providers cannot silently lose data without a surfaced signal.
- For Tauri, choose either "implemented with named sidecar commands and integration test" or "unregistered with named preflight error" before implementation begins.
