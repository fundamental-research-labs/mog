Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for the renderer system. It correctly treats `apps/spreadsheet/src/systems/renderer` as an orchestration layer rather than the canvas renderer itself, and it identifies the important production-path risks: late runtime binding, untyped context pushes, raw `GridRenderer` access, unwired layout coordination, incomplete page-break production wiring, async transition hazards, and weak simulator-only tests. The plan is well aligned with Mog's architecture and verification standards, but it is a little too expansive for a directly executable implementation spec. It needs sharper phase boundaries, concrete API contract shapes, and clearer exit criteria for the cross-repo SheetView dependency.

Major strengths

- The diagnosis matches the source. `RenderSystem` is documented as constructor-complete while still depending on `setRendererDependencies`, `setContextConfig`, `setSparklineManager`, `setCFConfig`, and table auto-expansion wiring. The plan correctly calls this out as an activation contract problem, not just a cleanup issue.
- It focuses on production-path behavior. The plan explicitly rejects simulator-only confidence and asks for fake SheetView/Workbook capability tests plus browser-backed app-eval coverage through real UI input paths.
- It identifies several real architectural seams: pure machines versus side-effect coordinators, durable Workbook ownership versus renderer-local state, SheetView as the canvas substrate, and renderer-owned synchronization policy.
- The page-break section is especially well grounded. Current tests explicitly bypass `PageBreakCoordinator` because dependencies are not installed, and the plan correctly requires real `RenderSystem` methods, Worksheet print API writes, cancel/no-write behavior, and coordinate conversion tests.
- The event-policy proposal is directionally right. `event-subscriptions.ts` and `layout-coordination.ts` currently overlap, while `setupLayoutCoordination` appears exported but not wired into the production path. A manifest with explicit effects would make coverage reviewable.
- The verification list covers the main package gates and correctly expands to `@mog-sdk/sheet-view` when public capability contracts change.

Major gaps or risks

- The plan is broad enough to hide sequencing risk. Runtime bindings, transition serialization, typed context projection, event policy consolidation, page-break wiring, raw renderer removal, and app-eval expansion are all large workstreams. The plan lists parallel agents, but it does not define the minimal contract artifact that must be agreed before those agents start.
- The proposed `RendererRuntimeBindings` is described by contents, but not by exact required versus optional groups, construction timing, idempotency behavior, or failure mode. That is the central contract for the whole refactor and needs a concrete TypeScript shape or acceptance checklist.
- The SheetView dependency is acknowledged but under-specified. Removing raw `GridRenderer` access depends on new public SheetView capabilities for object hit testing, geometry, data-source registration, render-state updates, and possibly viewport/input integration. The plan should state which capabilities must land first and which renderer migrations are blocked until then.
- The unified event manifest needs a stronger ownership boundary. Some events are renderer-visible effects, while others are data/cache effects that must run even with no renderer mounted. The plan mentions this risk, but it should prescribe how the manifest distinguishes renderer-attached effects from renderer-independent feature cache effects.
- The transition runner guidance is correct, but not concrete enough about concurrency semantics. It should define whether sheet switches are serialized FIFO, last-writer-wins coalesced, or generation-cancelled with an explicit completion event policy.
- Verification gates are numerous but not mapped to milestones. Without per-phase gates, an implementer could defer most meaningful verification until the end of a very large change.

Contract and verification assessment

The plan has good contract instincts: machines remain pure, Workbook/Worksheet remains durable truth, SheetView owns rendering substrate, RenderSystem owns side effects at actor boundaries, and E2E tests must use real UI input. It also includes many useful invariants around attach ordering, sheet-switch generation safety, scroll restoration, input physics reset, stale context reads, and page-break commit/cancel behavior.

The verification section is solid but should be more executable. The package gates are appropriate, and the focused test inventory is relevant. The missing piece is a phase-by-phase definition of what must fail first, what must pass after each migration, and which app-eval commands or scenario groups are required for the production UI paths. The plan also should require compile-time checks for deletion of raw renderer access, not just a test note saying no production callers remain.

Concrete changes that would raise the rating

- Add a phase contract table with columns for workstream, required API shape, files allowed to change, blocked-on dependency, unit tests, app-eval scenarios, and exit criteria.
- Specify the `RendererRuntimeBindings` interface in enough detail to distinguish required bindings, optional feature groups, dev/test precondition errors, and reactivation behavior under React strict mode.
- Define the SheetView capability additions as explicit public contracts before the renderer migration steps that depend on them.
- Turn the event-policy manifest into a concrete proposed type, including effect ordering, renderer-mounted versus renderer-independent effects, cleanup/idempotency rules, and coverage tests.
- State the sheet-switch concurrency policy precisely: serialized queue, coalesced latest target, generation cancellation, and exact machine events on stale completion.
- Split verification gates by milestone so the implementation can prove progress without waiting for the whole renderer migration to finish.
