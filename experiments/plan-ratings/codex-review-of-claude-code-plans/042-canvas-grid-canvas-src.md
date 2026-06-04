Rating: 8/10

Summary judgment

This is a strong, production-relevant plan. It accurately identifies `@mog/grid-canvas` as the composition facade, grounds most claims in the current source, and focuses on real live-path problems: scheduler self-wiring, async scene-graph rebuild races, scene projection contract drift, stale stats, silent `updateContext` drops, and overly broad dirtying. The plan is much better than a generic refactor proposal because it names existing files, tests, contracts, consumers, and preservation invariants.

The rating is not higher because the plan is broader than the folder scope in several phases, and some high-risk changes need sharper contracts before implementation. Phase D crosses into `types/objects` and `@mog-sdk/contracts`; Phase B has `views/sheet-view` cleanup; Phase G changes coordinate authority across renderer and view wiring. Those are legitimate dependencies, but the plan should separate local grid-canvas deliverables from owner handoffs and define exact acceptance criteria for each boundary.

Major strengths

- Source awareness is high. The plan's line counts, dominant-file diagnosis, adapter list, test suite inventory, scheduler fallback, `switchSheet()` / `syncSceneGraph()` race, `buildSceneObject()` casts, hard-coded stats, and `updateContext()` silent ignore behavior all match the inspected code.
- Architectural fit is good. The plan reinforces the package's stated role as a thin facade and keeps drawing logic in `@mog/drawing-canvas`, grid layer logic in `@mog/grid-renderer`, and public API stability at the package barrels.
- The objectives target the production path, not mocks or harnesses. `createGridRenderer`, `GridRendererImpl.updateContext`, live canvas invalidation, scene graph population, hit testing, and sheet-view scheduler wiring are all real app paths.
- The verification section is meaningfully tied to risk: dirty-rect tests for precision work, projection tests for scene data, interleaved sheet-switch testing for async races, and golden coordinate tests for Phase G.
- The plan correctly calls out hot-path constraints. It preserves the dispatch-table shape for `updateContext()` and calls for dev-only unknown-key warnings to avoid prod allocation/regression risk.

Major gaps or risks

- Scope boundaries need tightening. A plan for `mog/canvas/grid-canvas/src` can mention contract and sheet-view dependencies, but Phase D and parts of Phase F are not implementable solely in this folder. The plan should mark those as separate coordinated subplans with owned files, dependency order, and merge gates.
- Phase E is under-specified for the `ui` layer. `UILayer` renders marching ants, fill handle, drag previews, resize lines, selection-size tooltips, blocked-edit flash, and shimmer effects. "Drop `markDirty('ui')` if it depends on nothing selection-derived" is too loose; selection-derived UI dependencies are real. This phase needs a per-feature dirty-rect contract before narrowing repaint.
- Phase C's epoch guard is directionally right but should define the exact generation semantics. `syncSceneGraph()` can be triggered by `switchSheet`, `getFloatingObjects`, and `getAllObjectBounds`; the plan should specify whether the epoch is bumped on every rebuild request, whether it captures `currentSheetId` and provider identity, and what happens when bounds resolve out of order after the scene graph was already cleared.
- Stats are identified correctly but not specified enough. `GridRenderScheduler` is not actually queue-based; the queue lives in the engine priority scheduler. The plan should decide whether `GridRendererStats.queueDepth` means engine scheduler total pending tasks, grid render scheduler pending work, or a contract field to remove.
- Phase A is a large mechanical split before behavior fixes. That can be reasonable, but it creates broad churn in the file most later phases touch. The plan should require a no-behavior decomposition commit with module-level tests replacing prototype-bound private-method tests, then land independent correctness fixes in smaller slices.
- The "lint-enforced single constructor" invariant is mostly about coordinate-field reads, not a complete ban on every `RenderRegion<GridRegionMeta>` construction outside the mapper. The plan should either point to the exact existing lint rule or add the missing enforcement as an explicit task.

Contract and verification assessment

The contract preservation section is one of the plan's best parts: it calls out stable `GridRenderer` signatures, package barrel preservation, `updateContext()` allocation constraints, dirty-hint overpaint safety, viewport-layout math stability, WYSIWYG style behavior, and scene-reader consistency. Those are the right invariants for this folder.

Verification is mostly appropriate: `pnpm --filter @mog/grid-canvas typecheck` and `pnpm --filter @mog/grid-canvas test` match the package scripts, and `pnpm --filter @mog-sdk/contracts build` is the right gate for contract declaration changes. The plan should also require `pnpm --filter @mog/types-objects typecheck` / relevant referenced type package checks when Phase D changes canonical floating-object types, because `contracts/src/objects/floating-objects.ts` is only a re-export shim.

The manual app smoke is necessary but too informal for dirty-rect and sheet-switch work. The plan should specify at least one app-eval or browser-driven scenario for rapid sheet switching with objects, object selection on a many-object sheet, freeze/split scroll, and overflow tooltip readback if `getClippedCellContent` is implemented.

Concrete changes that would raise the rating

- Split the plan into local phases and coordinated external phases, with explicit file ownership for `types/objects`, `contracts`, and `views/sheet-view`.
- Define exact epoch/rebuild semantics for `syncSceneGraph()`, including all callers and stale promise behavior.
- Replace the Phase E UI dirtying language with a feature-by-feature dirty-rect contract for `UILayer` and overlay handles.
- Specify how `GridRendererStats.queueDepth` will be sourced, or make removing it a required contract decision.
- Add a compile-time exhaustiveness strategy for `fieldHandlers` against `RenderContextConfig` instead of only a dev warning.
- Add concrete app-eval/browser scenarios for the visual regressions that unit tests are unlikely to catch.
