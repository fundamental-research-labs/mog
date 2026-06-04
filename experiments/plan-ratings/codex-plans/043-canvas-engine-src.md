# 043 - Canvas Engine Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/canvas/engine/src`

Queue scope: shared canvas loop, scheduling, GPU, and input state.

This plan covers the production TypeScript source for `@mog/canvas-engine`:

- Public engine factory and instance wiring in `engine.ts` and `index.ts`.
- Core contracts in `core/types.ts`, coordinate conversion in `core/coordinate-space.ts`, and dirty rect accumulation in `core/dirty-rect-accumulator.ts`.
- rAF rendering, layer cache compositing, dirty rect collection, layout invalidation, animation clock, layer error handling, and debug timing in `loop/render-loop.ts`.
- Layer registration, visibility, z-ordering, canvas grouping, and dirty facade behavior in `registry/layer-registry.ts`.
- Passive task scheduling, priority budgets, deduplication, shedding, and scheduler stats in `scheduler/priority-scheduler.ts`.
- Canvas DOM ownership, stacked canvas creation, DPR handling, resize flushing, and context setup in `host/canvas-host.ts`.
- Pointer, wheel, cursor, pointer-state, and hit-test dispatch in `input/input-capture.ts`.
- Runtime canvas memory mode selection in `gpu/memory-detection.ts`.
- Generic effective state, geometry helpers, text measurement, color helpers, and snap helpers.
- Existing unit tests under `canvas/engine/src/__tests__` and `canvas/engine/src/core/__tests__`.

Adjacent production dependencies that must be considered:

- `canvas/grid-canvas/src/renderer/grid-renderer.ts`, `grid-render-scheduler.ts`, and `viewport-to-region-layout.ts`, which create the engine, translate spreadsheet viewport layouts into engine `RegionLayout`, and implement the `Write = Invalidate` bridge.
- `canvas/grid-renderer/src/layers/base-layer.ts` and grid-renderer layers, which duck-type into render-loop cache support and rely on canonical coordinate helpers.
- `canvas/drawing-canvas`, `canvas/overlay`, and drawing packages, which consume `CanvasLayer`, `Rect`, `DirtyRectAccumulator`, hit testing, color, gradient, and text-measurement helpers.
- `contracts/src/rendering/grid-renderer.ts` and `types/rendering/src/grid-renderer.ts`, which mirror the render-scheduler contract without depending on `@mog/canvas-engine`.
- `views/sheet-view` and `apps/spreadsheet`, which exercise the production pointer, wheel, scroll, resize, pause/resume, and renderer lifecycle paths.

This is a public Mog source folder. Implementation work belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`canvas/engine/src` is the hardware-level canvas substrate for Mog's spreadsheet and canvas surfaces. It is intended to be generic and domain-free: it owns canvas lifecycle, frame scheduling, region clipping, coordinate-space conversion primitives, dirty invalidation, input capture, hit-test dispatch, and small shared rendering utilities. Spreadsheet-specific layout, cell data, object data, and layer behavior are supposed to live in grid, drawing, overlay, app, or contract packages.

Observed structure and responsibilities:

- `createCanvasEngine` wires `CanvasHost`, `LayerRegistry`, `PriorityScheduler`, `RenderLoop`, `InputCapture`, cursor/pointer helpers, and generic effective state.
- `RenderLoop` processes scheduler tasks at the start of each rAF, renders dirty or continuously animated layers, supports cached layer compositing through a duck-typed cache API, supports partial dirty rects, promotes dirty rects to full repaint on scroll/resize, and uses layer-level error backoff.
- `CanvasHost` creates stacked canvases, sets alpha/desynchronized context options, observes container resize, handles DPR changes, defers element dimension changes until the render frame, and pre-fills the opaque bottom canvas.
- `LayerRegistry` stores layers, sorts visible layers by z-index, groups them by canvas index, and forwards dirty calls.
- `PriorityScheduler` is a passive queue, not a render loop. It deduplicates tasks by `layerId` and hint key, processes priority queues within a frame budget, and tracks scheduler processing stats.
- `InputCapture` normalizes pointer and wheel DOM events, tracks pointer state, manages cursor priority, and dispatches registered hit-test providers top-down by z-index.
- `coordinate-space.ts` is now the single canonical implementation of the doc/canvas transform formula for region layouts.

Current improvement signals from the inspected source:

- `CanvasInputEventBase.worldPosition` is documented as document-space, but `InputCapture` emits it as the same value as `position` and comments that callers must apply transforms. That is a public event contract mismatch.
- `CanvasLayer.render` documentation still says per-region layers should draw in "document coordinates minus region.scrollOffset", while the canonical formula in `RenderRegion` and `coordinate-space.ts` requires `viewportOrigin` as well. The old wording invites frozen-pane regressions.
- `RenderLoop` relies on a duck-typed cache capability (`getOrCreateCache`, `clearCache`) that is not part of the `CanvasLayer` contract even though it is now a production render path.
- Partial dirty collection converts every dirty doc rect into every region and then emits one bounding union, without clipping to the region/canvas. That can over-invalidate, accidentally cover offscreen space, and hide bugs in freeze-pane dirty targeting.
- `DirtyRectAccumulator` has viewport-area promotion support, but the render loop does not use it when collecting frame dirty coverage.
- `PriorityScheduler.getStats()` measures task-processing time, yet `createCanvasEngine.getStats()` exposes those values as engine FPS/frame time. That conflates scheduling cost with actual rendered frame cost.
- `PriorityScheduler.hasWork()` excludes IDLE tasks, and scheduling work does not itself wake an idle `RenderLoop`. The wake contract for direct scheduler use is implicit.
- `LayerRegistry.setVisibility()` does not invalidate sorted caches and does not define how hiding/showing a painted layer clears stale pixels. Existing tests even document this as current behavior.
- Single-canvas GPU fallback wraps layers with `Object.create(layer, { canvas: 0 })`. That can break class instances with private fields because methods may execute with the proxy as `this`, and it makes canvas routing an implicit object-shape trick.
- `RenderLoop` hardcodes spreadsheet layer IDs (`background`, `cells`, `selection`) as critical layers, which leaks domain knowledge into the supposedly generic engine.
- GPU memory detection is a one-shot heuristic based on device memory, iOS Safari, and a fixed allocation test. It is not tied to actual container size, DPR, configured canvas count, or later resize/DPR changes.
- Existing tests cover many loop, host, registry, scheduler, dirty rect, coordinate, and utility behaviors, but `InputCapture` has no focused test file and the rendering tests are mostly mock-canvas tests rather than browser-backed production path checks.

## Improvement objectives

1. Make the engine's public contracts executable and internally consistent: coordinate semantics, input positions, cache support, layer error policy, visibility changes, scheduler wake behavior, and stats must match what production code actually does.
2. Preserve the engine's zero-domain boundary by removing spreadsheet-specific layer IDs and by pushing all domain behavior into callers through typed policy, metadata, or adapters.
3. Replace duck-typed production render capabilities with explicit TypeScript interfaces so cache, dirty, criticality, and partial-render contracts can be tested and consumed safely.
4. Make dirty invalidation region-aware, clipped, and measurable rather than reducing every partial update to an unclipped all-region union.
5. Split scheduler metrics from render-loop metrics so FPS, render time, queue time, dirty coverage, dropped/full-promotion frames, and cache reuse are observable through the correct owner.
6. Make input capture region-aware and container-relative, with a precise contract for screen, canvas, region-local, and document positions.
7. Make canvas host hardware policy adaptive to container size, DPR, canvas count, memory budget, context behavior, and platform quirks instead of one-shot global heuristics.
8. Strengthen production-path verification with browser-backed canvas and real UI input tests, not only mocks or direct state mutation.

## Production-path contracts and invariants to preserve or strengthen

- `@mog/canvas-engine` remains a generic hardware package. It must not depend on spreadsheet app state, kernel state, contracts runtime implementation details, `mog-internal`, or domain-specific layer names.
- The canonical coordinate formula stays centralized:
  `canvas = bounds + (doc - viewportOrigin - scrollOffset) * zoom`
  and its inverse in `core/coordinate-space.ts`. No inline doc/canvas transform math should be added in engine, grid, drawing, or overlay hot paths except sanctioned helper composition.
- `RegionLayout` remains the engine-level projection of spreadsheet viewport layout. Production `RenderRegion` values should continue to come from `viewportLayoutToRegionLayout`, with tests and fixtures as the only normal inline literals.
- `RenderLoop` remains the only animation time source for layers through `FrameContext.timestamp` and `frameNumber`; layers should not use `Date.now()` or `performance.now()` for animation state.
- `Write = Invalidate` stays atomic for production buffer writes: data mutation must mark affected layers dirty and wake the render loop through the production `GridRenderScheduler`/engine path.
- Dirty hints remain geometric and domain-free. The grid renderer converts cells, merged cells, rows, columns, and object bounds into `DocSpaceRect` before entering the engine.
- Partial dirty rendering must be conservative: if the engine cannot prove a clipped partial repaint is complete, it must promote to full repaint for the affected canvas.
- Clean cached layers must still contribute cached pixels during partial composite; dirty cached layers must repaint their cache before being composited.
- Scroll, structural layout changes, zoom changes, DPR changes, canvas resize, cache resize, hidden/show layer changes, and context restoration must not leave stale pixels on screen.
- Multi-canvas and single-canvas modes must preserve the same visible z-order, hit-test order, layer lifecycle, and dirty semantics.
- Input events must be produced from real DOM pointer/wheel paths, with pointer capture and cursor behavior matching browser behavior.
- `CanvasHost.dispose()`, `InputCapture.dispose()`, `LayerRegistry.disposeAll()`, and `CanvasEngine.dispose()` remain idempotent and release DOM listeners, observers, rAF handles, canvases, caches, and layer resources.
- Public dependency direction stays intact: `mog` must not depend on `mog-internal`.

## Concrete implementation plan

1. Create a canvas-engine contract inventory and align comments with the canonical behavior.

   - Inventory exported types, runtime values, and implementation-only classes in `canvas/engine/src/index.ts`.
   - For each exported contract, record its owner and production consumers: `CanvasLayer`, `FrameContext`, `DirtyHint`, `RegionLayout`, `RenderScheduler`, `AnimationClock`, `HitTestProvider`, `TextMeasurer`, and engine stats.
   - Rewrite the `CanvasLayer.render` documentation so per-region rendering explicitly composes the canonical coordinate helpers and never describes the old `doc - scrollOffset` shortcut.
   - Add a small local contract README or doc comment block that states which capabilities are generic engine concepts and which belong to grid/drawing/overlay packages.
   - Add a static audit gate or focused test that rejects newly introduced inline coordinate formulas in canvas packages outside sanctioned helper files.

2. Replace implicit layer capabilities with typed contracts.

   - Add explicit optional interfaces for cacheable layers, dirty-rect layers, visibility behavior, and layer error policy. For example: `CacheableCanvasLayer`, `DirtyTrackedCanvasLayer`, and `LayerErrorPolicy`.
   - Move render-loop cache duck typing behind type guards exported or local to the engine, with tests that prove non-cacheable, cacheable, and dirty-rect-capable layers follow the intended path.
   - Replace hardcoded critical layer IDs with a layer-owned or registration-owned error policy such as `{ critical: true, maxFailures, backoff }`.
   - Keep layer render modes domain-free: `per-region` and `once` remain generic, but any once-mode layer that draws per-region bands must explicitly opt into or receive region metadata from its owning package.
   - Ensure capability additions update grid-renderer `BaseLayer`, drawing-canvas layers, overlay layers, and tests without adding compatibility shims around stale behavior.

3. Make registry state changes repaint-correct.

   - Fix `LayerRegistry.setVisibility()` to invalidate sorted caches whenever visibility changes.
   - Define the visibility repaint contract: hiding a previously visible layer must dirty the affected canvas so its previous pixels are cleared or recomposited; showing a layer must dirty that layer or the canvas.
   - Move frame-wake side effects to the engine wrapper rather than putting render-loop knowledge into the registry. The registry should report whether the visible set changed; the engine should mark/request as needed.
   - Add stable tie-breaking for equal `zIndex` layers using registration order, so rendering and hit testing are deterministic.
   - Add tests for hidden-layer stale-pixel prevention, re-showing cache rebuilds, equal z-index order, visibility changes across canvas indexes, and dispose/unregister after visibility toggles.

4. Replace single-canvas proxying with explicit canvas routing.

   - Remove `Object.create(layer, { canvas: 0 })` from `createCanvasEngine`.
   - Introduce a registry-level or render-loop-level `getCanvasIndex(layer)` routing decision so the original layer instance is always called as itself.
   - Preserve the original declared canvas in stats/debug output while rendering to canvas 0 in single-canvas mode.
   - Verify class-based layers with private fields continue to render and receive `markDirty`, `markClean`, `dispose`, cache, and error callbacks with the correct `this`.
   - Add tests comparing multi-canvas and single-canvas mode z-order, dirty routing, cache compositing, and hit-test behavior.

5. Rework dirty rect collection into a region-aware dirty mapper.

   - Add a `DirtyRegionMapper` owned by the render loop or core package that takes dirty doc rects, current layout, canvas size, DPR, and layer mode.
   - Clip each doc rect against each region's visible doc-space extent before converting it to canvas space.
   - Clamp resulting canvas-space rects to actual canvas bounds before converting to physical pixels.
   - Preserve multiple dirty rects when they remain disjoint and below a threshold; only coalesce to a union or promote to full when the area, rect count, or unsupported layer mix makes partial repaint worse than full repaint.
   - Thread viewport/canvas area into `DirtyRectAccumulator.coalesce()` or centralize area promotion in the mapper so large partial updates become full repaints deterministically.
   - Keep scroll, structural layout, resize, DPR, and cache-size changes as full-promotion events.
   - Add coverage for frozen rows/columns, negative/offscreen doc rects, fractional zoom, fractional DPR, merged-cell rects spanning regions, hidden layers, mixed cached/non-cached layers, and dirty rects outside all visible regions.

6. Split render-loop metrics from scheduler metrics.

   - Add a render-loop stats collector with rendered frame count, skipped frame count, last/average/max total frame time, scheduler time, render time, per-canvas render time, dirty coverage area, full-promotion reason counts, cache hits/misses, and layer error counts.
   - Keep `PriorityScheduler` stats scoped to queue depths, task execution time, processed tasks, deduplication, shedding state, and budget misses.
   - Update `CanvasEngine.getStats()` to report actual render-loop frame metrics plus scheduler queue summaries, rather than treating scheduler processing time as FPS.
   - Decide which stats are public contract fields and which are debug/devtools-only. Avoid leaking implementation-only metrics into public APIs unless consumers need them.
   - Add tests with fake clocks that prove idle frames, dirty frames, scheduler-only frames, continuous frames, and skipped frames are counted correctly.

7. Make scheduler wake and idle semantics explicit.

   - Define whether `PriorityScheduler.schedule()` is pure queue mutation or whether the engine-owned scheduler wrapper wakes the render loop.
   - If direct access remains on `CanvasEngineInstance.scheduler`, wrap or expose scheduling through an engine method that requests a frame for non-idle work.
   - Decide whether IDLE tasks should keep the loop alive when no dirty layers exist. If yes, `shouldContinue()` must include idle work with budget rules; if no, document that IDLE tasks require another frame source.
   - Add starvation tests for IDLE and LOW tasks under shedding, paused/resumed scheduler behavior, replacement deduplication, cancellation, and exception handling.
   - Keep scheduler tasks cheap dirty-marking operations; do not move heavy rendering work into the scheduler.

8. Make input capture coordinate-correct and region-aware.

   - Replace `offsetX`/`offsetY` with container-relative coordinates computed from `clientX/clientY` and the container bounding rect. This avoids target-relative surprises when events originate on stacked child canvases.
   - Replace the ambiguous `worldPosition` behavior with an explicit event coordinate payload. The right target shape should distinguish screen/canvas position, resolved `regionId`, region-local position, and document position when a region contains the event.
   - Let the engine supply the current `RegionLayout` to `InputCapture` or provide a resolver callback so input normalization can use `canvasToDocXY` with the same canonical formula as rendering.
   - Define behavior for events outside all regions, events on once-mode UI, frozen pane boundaries, zoomed layouts, and touch hit expansion.
   - Keep keyboard events out of the generic engine unless a separate explicit keyboard input contract is added.
   - Add focused tests for pointerdown/move/up/enter/leave, wheel delta modes, modifier propagation, pointer capture/release, cursor priority, provider z-ordering, provider unregister, container-relative coordinate math, transformed doc position, and outside-region events.
   - Add browser-driven tests that use real pointer and wheel input paths through the spreadsheet canvas instead of directly mutating input state.

9. Make `CanvasHost` hardware and DOM ownership more robust.

   - Add a typed `CanvasMemoryPolicy` or `CanvasHardwarePolicy` that estimates actual canvas memory from container size, DPR, requested canvas count, cache count/size, and platform hints.
   - Re-evaluate the memory/canvas mode decision on material resize and DPR changes, not only at engine creation.
   - Keep the fallback domain-free: route layers to fewer physical canvases through the engine rather than mutating layer instances.
   - Centralize CSS-to-physical conversion through `canvasToPhysical` or a shared helper so clear, draw, and resize paths use the same rounding and clamping rules.
   - Track original container styles changed by the host (`position`, `touchAction`, `cursor` if owned) and restore them on dispose when the engine made the change.
   - Add tests for fractional DPR rounding, very large canvases, zero-size to nonzero transitions, DPR-only monitor moves, resize during pending frame, disposal during pending resize, context creation fallback, and Windows desynchronized context policy.
   - Add browser smoke checks for resize and DPR behavior because mock DOM tests cannot prove real canvas allocation, compositing, or context behavior.

10. Strengthen continuous animation and pause/resume behavior.

   - Make continuous-frame registration lifecycle explicit: requesting frames for an unknown layer should either be rejected or tracked with a diagnostic, not silently mark nothing forever.
   - Stop continuous frames automatically when a layer unregisters or the engine disposes.
   - Preserve resume's full repaint behavior for GPU-backed surface loss, but record it as a full-promotion reason and clear stale dirty/scroll snapshots consistently.
   - Add tests for unregistering animated layers, pause/resume while scheduler has work, hidden tab style resume, and continuous dirty hints that remain partial where safe.

11. Clarify generic effective state semantics.

   - Decide whether `EffectiveStateManager` is purely a map or whether it should integrate with invalidation and request-frame callbacks.
   - If it stays generic storage, remove any implication that it guarantees 60fps visual preview by itself; the owner must dirty/request frames.
   - If it becomes render-aware, add optional invalidation hooks and ownership scoping so set/clear operations dirty the right object/layer.
   - Add tests for mutation ordering, clear-on-dispose behavior, and interaction with request-frame if hooks are added.

12. Add production-path verification for canvas behavior.

   - Keep the existing Jest unit suites for deterministic unit coverage.
   - Add browser-backed integration tests that instantiate the actual canvas engine with real canvases and inspect pixels or screenshots for rendering, resize, dirty partials, single-canvas fallback, and pause/resume repaint.
   - Add spreadsheet-level Playwright coverage for real pointer/wheel input, freeze panes, zoom, scrolling, selection rendering, formula range highlight, floating object drag/resize, and context menu hit testing.
   - Add visual/pixel assertions for dirty rects: a clean cached layer must still appear inside a partial dirty region, hidden layers must disappear, and scroll/resize/DPR must not leave stale pixels.
   - Make every E2E test drive the UI through keyboard, mouse, pointer, wheel, or clipboard input paths; do not mutate engine, registry, or renderer state directly to reach the test condition.

## Tests and verification gates

The implementation pass should run these gates. This planning worker did not run them because the queue item explicitly forbids running test, build, typecheck, or verification commands.

Focused package gates:

- `pnpm --filter @mog/canvas-engine test`
- `pnpm --filter @mog/canvas-engine typecheck`
- `pnpm --filter @mog/grid-renderer test`
- `pnpm --filter @mog/grid-renderer typecheck`
- `pnpm --filter @mog/grid-canvas test`
- `pnpm --filter @mog/grid-canvas typecheck`
- `pnpm --filter @mog/drawing-canvas test`
- `pnpm --filter @mog/drawing-canvas typecheck`
- `pnpm --filter @mog/canvas-overlay test` and typecheck if overlay imports or hit-test behavior change.

Downstream contract and app gates:

- `pnpm --filter @mog-sdk/contracts typecheck` if mirrored rendering contracts or exported scheduler primitives change.
- `pnpm --filter @mog/views-sheet-view test` and typecheck if engine instance, input, or render capability types change.
- `pnpm --filter @mog/app-spreadsheet test` and typecheck for spreadsheet production-path integration.
- Repo-wide `pnpm typecheck` after TypeScript contract changes unless an implementation task defines a narrower explicit type gate.

Browser and UI verification:

- Start the relevant spreadsheet dev server and exercise the production canvas in a browser.
- Add/run Playwright or equivalent browser tests using real pointer and wheel events for selection, scroll, freeze-pane hit testing, floating-object drag/resize, and dirty repaint.
- Add pixel/screenshot checks for real canvas rendering on at least normal DPR and high DPR configurations.
- Exercise single-canvas fallback through an injected hardware policy or deterministic low-memory browser fixture, while keeping the production routing path intact.

Behavioral assertions that must be covered:

- Frozen-pane coordinate conversions stay correct for rendering, hit testing, input doc position, and dirty rect mapping.
- Dirty partials never leave stale pixels and promote to full repaint for scroll, structural layout, resize, DPR, unsupported layer mixes, and large dirty area.
- Scheduler work wakes the loop according to the documented contract, and idle/low-priority tasks do not starve indefinitely.
- Visibility toggles rebuild sorted caches and repaint the affected canvases.
- Single-canvas fallback preserves layer identity, z-order, dirty state, cache behavior, and hit testing.
- Layer errors follow generic layer policy, not hardcoded spreadsheet layer IDs.

## Risks, edge cases, and non-goals

Risks:

- Dirty rect changes are high risk because under-invalidation causes stale pixels while over-invalidation can hide correctness issues and reduce performance. Region clipping and promotion rules need focused tests before optimization claims.
- Changing input event coordinate payloads can break consumers that currently compensate for `worldPosition` being screen-space. The implementation must update all production consumers rather than adding a compatibility shim that preserves the mismatch.
- Formalizing cache capabilities can uncover layers that accidentally depend on duck typing. Those layers should be fixed at their owning package boundary.
- Single-canvas routing changes can affect z-order and alpha compositing, especially when world and screen-space layers previously lived on separate DOM canvases.
- Browser canvas behavior differs by platform. Desynchronized contexts, OffscreenCanvas, iOS canvas limits, fractional DPR, and context allocation failures need real-browser checks, not only Jest mocks.
- Replacing hardcoded critical layer IDs requires every critical production layer to declare policy correctly. Missing policy can allow important layers to disable after repeated errors.
- Adding richer stats can create noisy public APIs if implementation-only details are exposed too broadly.

Edge cases to cover:

- Frozen rows, frozen columns, both-axis frozen panes, split regions, and events on divider boundaries.
- Negative, offscreen, zero-size, fractional, and huge dirty rects.
- Dirty rects under fractional zoom and fractional DPR.
- Hidden dirty layers, re-shown clean layers, unregistered cached layers, and unregistering layers with active continuous animation.
- Multi-canvas mode, single-canvas fallback, and transitions caused by resize/DPR hardware policy changes.
- Pointer events whose target is a child canvas, not the container; touch pointer capture; wheel line/page delta modes.
- Scheduler tasks scheduled while the loop is idle, paused, resumed, shedding low priority work, or containing only idle work.
- Resize while a frame is pending, dispose while resize rAF is pending, zero-size container followed by nonzero size, and DPR-only monitor moves.
- Cache canvas resizing, context creation failure, OffscreenCanvas absence, and canvas contexts with alpha/desynchronized fallback behavior.

Non-goals:

- Do not put spreadsheet-specific cell, selection, formula, or object semantics into `canvas/engine`.
- Do not introduce a second rendering engine or bypass the production `createCanvasEngine` path.
- Do not optimize test-only harnesses, mock renderers, or benchmark-only code as the primary outcome.
- Do not add compatibility shims that preserve incorrect input `worldPosition`, stale visibility caches, or layer proxy behavior.
- Do not change public dependency direction or add any dependency from `mog` to `mog-internal`.
- Do not replace real UI input E2E coverage with direct engine/registry state mutation.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the contracts are written down.

- Agent A: contract inventory, type/interface cleanup, documentation alignment, and coordinate-formula audit across `canvas/engine`, `canvas/grid-renderer`, `canvas/grid-canvas`, `canvas/drawing-canvas`, and `canvas/overlay`.
- Agent B: render-loop dirty mapper, explicit cache capability interfaces, render stats, full-promotion reasons, and dirty/cached layer tests.
- Agent C: input capture and hit-test coordinate contract, real pointer/wheel unit tests, and downstream spreadsheet/grid-canvas integration.
- Agent D: registry visibility, stable ordering, single-canvas routing without layer proxies, critical/error policy, and lifecycle cleanup.
- Agent E: CanvasHost hardware policy, DPR/resize/context behavior, memory fallback, and browser-backed canvas smoke tests.
- Agent F: final integration across grid-renderer, grid-canvas, drawing-canvas, overlay, sheet-view, and app-spreadsheet, including Playwright production-path verification.

Dependencies:

- Contract inventory and coordinate documentation should land first because it defines which behavior is engine-owned and which belongs to downstream packages.
- Explicit layer capabilities should land before large render-loop rewrites so cache and dirty behavior are typed instead of duck-typed.
- Registry visibility and single-canvas routing can proceed in parallel with input work because they touch disjoint contracts, but both must be integrated before final browser verification.
- Dirty mapper work depends on the current `RegionLayout` contract and should coordinate with `viewportLayoutToRegionLayout` tests in `canvas/grid-canvas`.
- Input coordinate fixes depend on access to the same current `RegionLayout` used by rendering; the engine should own that handoff to avoid duplicate layout math in app code.
- Hardware policy changes should provide deterministic injection points so tests can force multi-canvas and single-canvas modes without depending on developer machine memory or user agent.
- Any changes to mirrored scheduler or render priority contracts must coordinate with `contracts/src/rendering/grid-renderer.ts` and `types/rendering/src/grid-renderer.ts`.
