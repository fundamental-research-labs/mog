Rating: 8/10

Summary judgment

This is a strong, production-relevant plan. It is grounded in the actual renderer folder, distinguishes dead coordination from live production seams, and names the architectural invariants that matter: pure machines, execution-layer side effects, single renderer ownership, transition-detected subscriptions, and capability accessors. The major findings are real: the unused coordination/action band exists, page-break drag is routed through `RenderSystem` but the coordinator has no dependency injection path, lifecycle debug logging is hardcoded on, the renderer context type is a placeholder, and `getRenderer()` still has live callers.

The plan falls short of a 9 or 10 because several implementation contracts are still too implicit for the highest-risk fixes. Most importantly, the lifecycle recovery section misses that `executeStateTransition` is `async` but called as `void executeStateTransition(...)` inside a synchronous `try/catch`; thrown creation/attach failures become rejected promises and are not caught by that `try/catch`, so the machine may never enter `error` in the first place. The page-break recovery also needs a tighter coordinate-space and rebind contract before implementation.

Major strengths

- The evidence is specific and mostly verified against source. `setupLayoutCoordination`, `buildSparklineCoordination`, `buildCFCoordination`, and the functions in `renderer-actions.ts` are definition-only or barrel-only in the inspected paths, while `syncOutlineGutter()` has no live production caller.
- The plan focuses on production behavior rather than cleanup for its own sake. The retry path, page-break preview drag, unbounded debug logger, and placeholder renderer context type are real product or maintainability issues.
- The architectural direction fits the subsystem. Keeping XState machines pure and moving SheetView disposal/recreation into `renderer-execution.ts` is the right boundary.
- The sequencing is sensible: correctness and footprint work first, broader type/capability migration later. Calling out `getRenderer()` removal as a staged cross-folder item is the right instinct.
- The verification section names behavior-oriented regressions, not only type checks. The proposed page-break and retry tests would catch current failures if implemented through the production seams.

Major gaps or risks

- Lifecycle error handling is incomplete. Adding a `case 'error'` that disposes `sheetView` is necessary, but not sufficient. `setupExecution()` currently calls the async `executeStateTransition()` without awaiting or attaching `.catch()`, so a thrown error from `createSheetView`, `attach`, or bridge setup can bypass `rendererActor.send({ type: 'ERROR' })`. The plan should require fixing that reporting path before or with retry recovery.
- Page-break injection is under-specified. The plan says to derive `getRowPosition`, `getColPosition`, `getRowFromPosition`, and `getColFromPosition` from geometry/viewport, but it does not define the coordinate space. The hook passes grid mouse coordinates; the coordinator must be explicit about viewport-local vs page-space coordinates, zoom, headers, frozen panes, split panes, and hidden rows/columns. Without that contract, a "wired" page-break drag can still be subtly wrong.
- Rebinding page-break dependencies can leak subscriptions. `PageBreakCoordinator.setDependencies()` currently overwrites `deps` and subscribes again without unsubscribing a prior subscription. The plan mentions guarding re-injection on sheet switch, but it should require idempotent reconfiguration or dispose-before-rebind semantics.
- The layout-coordination decision is still too open-ended. "Wire if a gap exists, delete if no gap" is directionally right, but the implementer needs a concrete evidence matrix: which events are already covered by SheetView viewport events, binary dimension patching, render invalidation, or `switchSheet`, and which acceptance tests prove outline gutter width and layout recomputation after grouping/filter/dimension changes.
- The `getRenderer()` migration is correctly staged but lacks a replacement map. `sheet-coordinator.ts` passes `getGridRenderer` into input coordination, `use-renderer-actions.ts` exposes it, and `event-subscriptions.ts` still carries a deprecated fallback. The plan should name the exact capability replacement for each remaining use, especially scroll physics/input paths that may still require APIs not exposed by SheetView capabilities.
- The slicer relocation objective may be too shallow. `slicer-integration.ts` is misfiled, but `GridEditingSystem.getSlicerCache()` and `rebuildAllSlicerCaches()` are currently stubs. A pure file move may improve DAG hygiene without creating a real owner contract for slicer cache state or subscriptions.

Contract and verification assessment

The contract section is above average: it preserves machine purity, single ownership, ready-state context updates, generation guards, transition-detected actor subscriptions, cleanup completeness, viewport-follow intent gating, and scroll physics synchronization. Those are the right invariants for this folder.

The missing contracts are mostly around newly proposed wiring. Page-break dependency injection needs an explicit lifecycle contract: when it is configured, what happens if renderer dependencies arrive before or after ready, how it survives sheet switches, and how repeated configuration avoids duplicate subscriptions. Error recovery needs an explicit failure contract: any execution-layer failure must transition the machine to `error`, dispose partial SheetView state, and make `RETRY` create a fresh SheetView.

Verification is good but should be tightened. Existing simulator tests mostly validate machine transitions without real renderer dependencies, so they are not enough for the lifecycle retry bug. The new retry test must mock or fake `createSheetView`/SheetView creation through `setupRendererExecution`, assert failure reaches `error`, assert partial SheetView disposal, and assert retry recreates the handle without an unhandled rejection. The package gate should also name the app package directly: `pnpm --filter @mog/app-spreadsheet typecheck` and the targeted `@mog/app-spreadsheet` test command are more precise than only `@mog/spreadsheet`, unless the intent is a full root typecheck.

Concrete changes that would raise the rating

- Add a Phase B step to fix async transition failure handling: either make `executeStateTransition` synchronous if it has no awaits, or attach `.catch()`/`await` so all execution errors send `ERROR` and are covered by tests.
- Specify the page-break coordinate contract in terms of SheetView geometry APIs, including viewport/page conversion, zoom, headers, frozen panes, split panes, and hidden rows/columns.
- Require `PageBreakCoordinator.setDependencies()` to be idempotent, or add a `configurePageBreakCoordinator()` wrapper in `RenderSystem` that disposes the old coordinator subscription before rebinding.
- Replace the layout "gap exists" decision with a small event coverage table and acceptance tests for grouping/outline gutter, filter visibility, row height, column width, and sheet switch behavior.
- Add a caller-by-caller `getRenderer()` migration map with the exact replacement capabilities and any missing capability API that must be added before deleting the back-channel.
- Clarify whether slicer work is only a relocation or also a real cache-owner integration into `GridEditingSystem`.
- Correct the verification gates to include `pnpm --filter @mog/app-spreadsheet typecheck`, targeted renderer tests under that package, and an app-eval/UI smoke for Page Break Preview drag and retry recovery.
