# 098 - Apps Spreadsheet Renderer System Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/systems/renderer`

Queue item: 98

Scope: the spreadsheet app renderer system: `RenderSystem`, renderer/page-break XState machines, actor access, SheetView execution, render-context projection, Workbook event subscriptions, viewport-follow coordination, layout/page-break/sparkline/conditional-format coordination helpers, debug lifecycle logging, and renderer-local simulator/tests.

Files and integration points inspected:

- `apps/spreadsheet/src/systems/renderer/render-system.ts`
- `apps/spreadsheet/src/systems/renderer/types.ts`
- `apps/spreadsheet/src/systems/renderer/machines/grid-renderer-machine.ts`
- `apps/spreadsheet/src/systems/renderer/machines/page-break-machine.ts`
- `apps/spreadsheet/src/systems/renderer/execution/renderer-execution.ts`
- `apps/spreadsheet/src/systems/renderer/execution/render-context-coordination.ts`
- `apps/spreadsheet/src/systems/renderer/subscriptions/event-subscriptions.ts`
- `apps/spreadsheet/src/systems/renderer/subscriptions/slicer-integration.ts`
- `apps/spreadsheet/src/systems/renderer/coordination/*`
- `apps/spreadsheet/src/systems/renderer/features/page-break/page-break-coordination.ts`
- `apps/spreadsheet/src/systems/renderer/testing/*`
- `apps/spreadsheet/src/components/grid/effects/useRendererDependencies.ts`
- `apps/spreadsheet/src/components/grid/effects/useRenderContextConfig.ts`
- `apps/spreadsheet/src/components/grid/effects/useRendererLifecycle.ts`
- `apps/spreadsheet/src/components/grid/effects/useRendererSync.ts`
- `apps/spreadsheet/src/components/grid/effects/useSparklineCFIntegration.ts`
- `apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx`
- `apps/spreadsheet/src/coordinator/sheet-coordinator.ts`
- `apps/spreadsheet/src/hooks/shared/use-grid-mouse.ts`
- `apps/spreadsheet/src/hooks/view/use-renderer-actions.ts`
- `apps/spreadsheet/src/actions/handlers/selection/page-navigation.ts`
- `views/sheet-view/src/*` as the renderer substrate dependency
- Existing app-eval scenarios under `mog-internal/dev/app-eval/scenarios/{viewport-follow,scrolling,freeze-structure,sheet-switch-roundtrip,view,zoom,sparklines,conditional-formatting}`

Out of scope for this folder-specific plan:

- Replacing SheetView, canvas engine, grid renderer, or workbook viewport storage.
- Moving durable workbook state into UIStore, React state, renderer machines, or renderer caches.
- Optimizing mock-only, simulator-only, or benchmark-only paths.
- Adding compatibility shims around legacy raw renderer access. The correct path is to migrate callers to explicit capabilities.
- Changing private/internal eval assets from public `mog` code.

## Current role of this folder in Mog

`apps/spreadsheet/src/systems/renderer` is the spreadsheet app's renderer orchestration layer. It is not the canvas renderer itself; it coordinates the app-local actors, Workbook events, SheetView lifecycle, viewport state, context projection, and feature-specific invalidation needed to keep the visible grid synchronized with the workbook and user interaction state.

Observed responsibilities:

- `RenderSystem` owns the renderer and page-break XState actors, exposes actor access, delegates lifecycle and viewport operations to `renderer-execution`, wires event subscriptions, wires render-context coordination, exposes SheetView capability accessors, and provides cross-system methods such as `invalidate`, `onReady`, `zoomToSelection`, page-break drag methods, and viewport-follow setup.
- `grid-renderer-machine.ts` is a pure lifecycle/state machine for mount, layout, initialization, ready, switching sheet, suspended, error, and disposing states. It also stores pending actions, emits scroll-to-active-cell requests, and keeps canvas dimensions and current/target sheet ids in state.
- `page-break-machine.ts` is a pure drag-state machine for page-break drag start, movement, end, and cancel.
- `renderer-execution.ts` maps renderer machine state transitions to SheetView side effects: create, configure freeze/split, attach Workbook, restore scroll, push view options/culture, start/suspend/resume, switch sheet, resize, dispose, and expose SheetView capabilities. It still extracts `__mogInternalGridRenderer`, returns deprecated `getRenderer()`, and forwards `updateContext()` to `sheetView.dataSources.update(...)` as an untyped record.
- `render-context-coordination.ts` subscribes to selection, editor, clipboard, object interaction, page-break, and renderer actors, builds a large `Partial<RenderContextConfig>`, and pushes it directly to the renderer. It also has a delayed follower lane for page breaks, print area, and search highlights.
- `event-subscriptions.ts` subscribes to a large Workbook event set and maps events to context updates, viewport config updates, full invalidation, feature cache invalidation, and table auto-expansion. It retains deprecated raw `GridRenderer` fallback callbacks for current sheet and invalidation.
- `layout-coordination.ts` defines a richer layout recompute coordinator for view options, filters, grouping, outlines, dimension changes, hidden rows/columns, and active-sheet changes, but no production call site was found for `setupLayoutCoordination`.
- `PageBreakCoordinator` has the production-looking drag execution and Worksheet print API writes, but no production call site was found for `PageBreakCoordinator.setDependencies(...)`; current `RenderSystem` page-break hit/drag methods therefore have no committed dependency path.
- `viewport-follow-coordination.ts` is a strong pattern: it listens to selection actor emits for user-initiated selection changes and requests renderer scrolling only when the target cell is outside the visible viewport.
- Renderer-local tests mostly validate machine transitions, no-throw behavior, cleanup of delayed context reads, and sparkline subscription behavior. Several tests explicitly say they do not create a real renderer or real SheetView path.

The folder is close to the intended architecture, but the contracts are not yet complete: some production modules are not wired, several renderer updates still happen through React effects and untyped context pushes, deprecated raw renderer access remains, and no-op simulator tests can pass without proving the visible spreadsheet path works.

## Improvement objectives

1. Make renderer activation deterministic: all required actors, Workbook handles, SheetView data sources, sheet-state providers, feature managers, and UI-store subscriptions must be installed before the renderer can enter the production ready path.

2. Turn renderer sync policy into one explicit manifest. Every Workbook/UI/actor event that can affect render context, viewport layout, geometry, invalidation, cache freshness, or feature auto-expansion should have one owner and one tested action.

3. Replace open `updateContext(config: Partial<RenderContextConfig>)` usage and the local `[key: string]: unknown` placeholder with typed renderer data-source, render-state, and context projection contracts.

4. Remove production dependencies on raw `GridRenderer` and the hidden `__mogInternalGridRenderer` handle once SheetView exposes the missing object hit-region and interaction capabilities.

5. Wire page-break drag through the real production path: hit testing, drag preview context, target row/column conversion, Worksheet print writes, cancellation, invalidation, and real UI verification.

6. Either integrate `layout-coordination.ts` as the renderer layout owner or delete/replace it with the unified event manifest. Do not keep an unwired module that appears to own production layout invariants.

7. Make sheet switching, initial attach, resize, freeze/split changes, zoom, scroll restoration, and view-option pushes one ordered view-sync transaction with generation guards.

8. Define and execute pending renderer actions, or remove the pending-action machine state and exported helpers if no production caller should rely on them.

9. Upgrade tests from no-op lifecycle checks to production-path checks with fake SheetView capabilities, real subscription policies, browser-backed UI paths, and app-eval scenarios driven through keyboard, mouse, ribbon, and canvas behavior.

10. Preserve the separation of concerns: pure machines hold state, RenderSystem owns renderer side effects, SheetView owns the canvas substrate, Workbook/Worksheet owns durable data, and UIStore owns session-local UI state.

## Production-path contracts and invariants to preserve or strengthen

- `mog` must not depend on `mog-internal`; plans and eval references stay internal.
- Workbook/Worksheet APIs remain the durable source of truth for cells, formats, view settings, tables, sparklines, page breaks, object persistence, and print settings.
- Renderer machines stay pure: no DOM reads, no Workbook writes, no SheetView calls, no timers, no React calls.
- `RenderSystem` owns side effects at the machine boundary and must be idempotent under React strict-mode mount/unmount, repeated `start()`, repeated cleanup, and late actor emissions.
- SheetView attach ordering remains strict: freeze/split config before `attach`, Workbook attach before initial viewport-derived scroll restore, initial context/data-source projection before first visible render, and render loop start only after policy wiring.
- Sheet switch must not leak stale data: old viewport regions are disposed/reset, pending async context reads are generation-guarded, scroll and zoom restore use the target sheet, view options apply to the target sheet, and late work from the previous sheet cannot mutate the new sheet render context.
- Scroll restoration must sync the InputCoordinator physics engine whenever RenderSystem changes the main viewport scroll position outside the input scroll path.
- Viewport layout, visible range, frozen panes, split viewports, headers, outline gutters, hidden rows/columns, zoom, and scroll offsets must remain mutually consistent.
- Context callbacks that read cell data, formats, tables, filters, sparklines, validation, grouping, objects, charts, trace arrows, and search highlights must be sheet-aware and must not close over stale active sheet ids.
- Workbook event subscriptions must filter by the current rendered sheet when the event is sheet-scoped, except for workbook-scoped settings that intentionally affect every sheet.
- Events that update renderer data and events that update feature caches must have deterministic ordering. Cache invalidation cannot depend on whether a renderer is attached.
- Page-break drag commits only on end, never on cancel. Manual page-break writes go through the Worksheet print API, and render invalidation follows the durable write.
- Feature integrations such as sparklines, conditional formatting, tables, slicers, and page breaks must clean up old subscriptions when rewired and must not publish late async results after dispose.
- E2E verification must use real UI input paths and canvas/readback assertions; direct state mutation is not sufficient for renderer behavior.

## Concrete implementation plan

### 1. Add contract tests that expose current production gaps

Before refactoring, add focused failing tests for the real contracts this folder is supposed to own:

- A `RenderSystem` activation test with fake SheetView capabilities proving renderer execution does not enter `ready` before runtime bindings are present.
- A page-break integration test proving `hitTestPageBreak()` can return a hit and `pageBreakDragTerminator.endDrag()` writes through a fake Worksheet print API. This should fail today unless `PageBreakCoordinator.setDependencies(...)` is wired.
- A layout coordination test proving row/column hide, filter apply/clear, grouping, outline level, dimension changes, and active-sheet changes trigger exactly the intended layout recompute/invalidation action. This should fail or be impossible while `setupLayoutCoordination` is unwired.
- A render-context projection test that asserts every field currently pushed by `useRenderContextConfig`, `SpreadsheetGrid`, `event-subscriptions`, and `render-context-coordination` has a typed owner and is cancelled/generation-guarded on cleanup.
- A pending-action test that queues selection, scroll, and invalidation before ready and asserts either they are applied in order after ready or the API no longer exists.

Keep these tests production-path: fake the Workbook and SheetView capability interfaces, not the renderer system methods under test.

### 2. Introduce explicit renderer runtime bindings

Replace the current scattered late setters with a single typed runtime contract:

- Current setters to consolidate: `setRendererDependencies`, `setContextConfig`, `setSelectionActorForViewportFollow`, `setSparklineManager`, `getEventSubscriptions().setSparklineConfig`, `setCFConfig`, and `setTableAutoExpansionConfig`.
- Add a `RendererRuntimeBindings` or equivalent contract that includes Workbook, Workbook viewport, sheet-state provider, UI-store view-state access, input scroll reset callback, grid/editor/clipboard/object actors, remote cursor source, render data sources, feature managers, and table auto-expansion callbacks.
- Install bindings exactly once before `RenderSystem.start()` or before the renderer machine can accept `MOUNT`. If React has to provide some callbacks after coordinator construction, expose a single activation method with precondition checks and debug metrics rather than multiple independent setters.
- Make missing required bindings explicit errors in development/test instead of no-op behavior. Optional features should be represented as optional capability groups with clear defaults.
- Move `useRendererDependencies`, `useRenderContextConfig`, and `useSparklineCFIntegration` toward producing/updating typed binding objects instead of directly calling renderer setters and `updateContext()`.

Target state: `RenderSystem` is either truly constructor-complete or has one audited activation boundary. It should not have independent feature setters that can silently leave production modules disconnected.

### 3. Make renderer execution transitions serialized and generation-safe

Refactor `setupRendererExecution` around an explicit transition runner:

- Do not call an `async` transition function through `void executeStateTransition(...)` with a surrounding synchronous `try/catch`; async exceptions become rejected promises. Either make the transition function synchronous where possible or serialize and await transitions with rejection handling that sends `ERROR`.
- Track a lifecycle generation that increments on dispose, unmount, and sheet switch. Any delayed SheetView attach, context push, follower refresh, or restored scroll must check the generation before mutating state.
- For rapid sheet switches, coalesce target sheet changes or serialize them so stale intermediate switches cannot send `SHEET_SWITCHED` for the wrong target.
- Capture old and target sheet identities before mutating SheetView state. The existing `sheet-switch-viewport` test documents a prior ordering bug; make the production transition runner itself test the current SheetView `switchSheet` ordering rather than a copied toy sequence.
- Treat resize, freeze/split changes, scroll restoration, zoom, view options, and context/data-source projection as part of the same view-sync transaction for the target sheet.
- Ensure cleanup unsubscribes first, increments generation, disposes SheetView, clears renderer refs, and prevents late `onRendererCreated`, `onContextUpdate`, or scroll-reset callbacks.

### 4. Replace untyped render context pushes with typed projection groups

Create a renderer context projection layer that owns typed groups instead of open `Partial<RenderContextConfig>` bags:

- Visual actor state: selection, editor, clipboard, object interaction, page-break drag, shimmer, remote cursors.
- Cell/table/filter data sources: cell value, format, binary readers, table at cell, resolved table range, filter header info, active table filter checks.
- Object/chart data sources: floating object state, object list, object bounds, all object bounds, chart render callback.
- Structure and overlay data: grouping config, row/column groups, outline levels, trace arrows, cell-position resolver, search highlights.
- Page/print data: preview mode, manual page breaks, auto page breaks, print area, preview font.
- Preview state: paste preview, flash-fill preview, create-table preview, font preview.
- Workbook/view settings: gridlines, row/column headers, gridline color, zero values, RTL, culture, theme, skin/chrome theme, cut/copy indicator, drag-fill setting.

Implementation details:

- Keep `RenderContextConfig` mapping field-by-field and exhaustive. Unknown keys should not be accepted by app code.
- Move direct calls from `useRenderContextConfig` and `SpreadsheetGrid` into the projector or typed render-state/data-source capabilities.
- Keep the fast actor lane synchronous for drag/edit/selection updates. Keep slow follower reads for page breaks, print area, and search highlights, but make them keyed by generation and by sheet.
- Add compile-time coverage for every projected field using `satisfies Record<...>` or an equivalent exhaustive mapper.
- Remove the local placeholder `RenderContextConfig { [key: string]: unknown }` in `types.ts`.

This likely depends on SheetView exposing typed data-source/update capabilities, as already called out by the adjacent SheetView plan.

### 5. Unify event subscriptions and layout coordination

Replace the split and partially duplicated subscription model with a single renderer event policy manifest:

- Each Workbook event maps to one or more explicit effects: context patch, data-source refresh, layout recompute, geometry invalidation, full render invalidation, feature cache invalidation, auto-expansion, or coordinator callback.
- Include all events currently in `event-subscriptions.ts` and `layout-coordination.ts`: freeze, view options, split create/change/remove, hidden/unhidden rows/columns, inserted/deleted rows/columns, row height, column width, filters, grouping, outline levels, sheet settings, workbook settings, theme, merges, sort, tables, comments, sparklines, conditional formatting, and table auto-expansion.
- Remove deprecated `getRenderer()` fallback from subscription config. Current sheet and invalidation should use SheetView render capability callbacks only.
- Integrate RAF batching for layout recompute where it matters, but keep immediate recompute for user-visible state changes such as view options, split/freeze topology, grouping collapse, and filter apply/clear.
- Make cleanup deterministic and idempotent, with duplicate registration protection for rewired optional feature groups.
- Decide whether slicer cache invalidation belongs in this renderer event policy or a separate data/UI system. If it remains here, inject a clock and generation guard instead of using `Date.now()` inside fire-and-forget async work.

Target state: there is one readable table of renderer-relevant events, and tests assert both coverage and action semantics.

### 6. Wire page-break drag as a first-class renderer feature

Implement page-break dependencies in the production path:

- Provide `PageBreakCoordinator` with `pageBreakActor`, Workbook, current rendered sheet id, and coordinate conversion from SheetView geometry/viewport capabilities.
- Convert pointer coordinates correctly under zoom, headers, frozen panes, split panes, RTL if supported, scroll offsets, hidden rows/columns, and outline gutters.
- Hit test both horizontal and vertical manual page breaks. Automatic breaks can render as non-draggable or return a non-draggable hit type, but the policy must be explicit and tested.
- During drag, update `pageBreakActor` and ensure `render-context-coordination` publishes drag preview state at interaction cadence.
- On end, write through Worksheet print APIs, invalidate page-break data, and refresh preview context. On cancel, clear drag state without writes.
- Handle async page-break reads/writes with generation guards and no late writes after disposal.
- Replace current tests that bypass the coordinator with tests that use the real `RenderSystem` page-break methods and fake Worksheet print handles.

Add or update app-eval coverage for real ribbon and mouse paths: insert a page break, enter Page Break Preview, drag the page-break affordance on canvas, verify metadata changed, verify pixels move, then cancel a second drag and verify metadata is unchanged.

### 7. Make active-sheet view sync a single transaction

Move scattered view-sync side effects into a single `syncRenderedSheetViewState` flow owned by RenderSystem or a renderer-owned coordinator:

- Initial attach: load split/freeze, view options, culture/theme/skin, exact session scroll, fallback persisted cell scroll, zoom, and context/data-source projection before the first visible frame.
- Sheet switch: apply target split/freeze config, switch SheetView, restore exact scroll, sync InputCoordinator, apply target view options/zoom, resync context/data sources, refresh feature caches, and then mark the machine ready.
- Post-mount mirror pushes in `SpreadsheetGrid` should become part of this transaction or a typed sync event, not a separate React effect racing the renderer's current sheet.
- Zoom-to-selection should continue to use geometry and viewport capabilities, but persist zoom through the same per-sheet view-state contract used by normal zoom changes.
- `getTopLeftVisibleCell(sheetId)` should either validate that `sheetId` matches the rendered sheet or expose a sheet-agnostic current-rendered-sheet method. Ignoring the parameter hides stale-sheet call sites.

This work should be verified with sheet-switch, freeze, split, zoom, and scroll roundtrip scenarios.

### 8. Remove raw `GridRenderer` production access

After SheetView exposes the missing capabilities, migrate the remaining raw renderer call sites:

- `renderer-execution.ts` should stop reading `__mogInternalGridRenderer`.
- `RendererExecutionResult.getRenderer()` and `IRenderSystem.getRenderer()` should be deleted from the production API.
- `event-subscriptions.ts` should no longer accept `getRenderer`.
- `sheet-coordinator.ts` object system integration should depend on a typed object hit-test/interaction capability instead of `getGridRenderer`.
- `use-renderer-actions.ts` should expose SheetView capabilities only.
- Action handlers such as page navigation should use typed renderer capability dependencies instead of `Record<string, unknown>` guards.

Do not leave a compatibility shim. The correct change is to add the missing SheetView capability contract and migrate all production callers in the same workstream.

### 9. Replace no-op simulator coverage with production-path harnesses

Keep renderer machine tests, but add tests that prove visible-path behavior:

- Extend `renderer-simulator` or add a new harness that installs fake SheetView capabilities and fake Workbook handles. Viewport methods should mutate observable fake state, not no-op.
- Add tests for SheetView lifecycle ordering: freeze/split before attach, attach before scroll restore, view options before first start, dispose before callback cleanup.
- Add tests for viewport-follow using actor emits and fake viewport `getScrollToCell`, verifying no scroll when already visible and exact scroll reset when not visible.
- Add tests for event policy coverage and cleanup: all event subscriptions uninstall, optional feature rewiring replaces previous handlers, stale sheet events are ignored, workbook-scoped events still apply.
- Add tests for context projection generation: rapid selection/editor/object/page-break changes publish only current state; slow follower reads cannot overwrite newer state.
- Add tests for pending actions or remove pending-action APIs and update exports.

The existing no-throw tests can remain as smoke tests, but they should not be the primary evidence for renderer correctness.

### 10. Update docs, exports, and dependency inventory

- Update renderer system comments to match reality after the activation model changes. If the system is constructor-complete, remove late setter language; if it has one activation boundary, document that boundary.
- Update public/internal exports after raw renderer access and pending-action helpers are removed or typed.
- Update `docs/internals/spreadsheet/state.md` or the relevant renderer architecture doc with the event policy manifest, context projection groups, and view-sync transaction.
- Update app-eval notes for renderer paths that require real input rather than direct state manipulation.

## Tests and verification gates

Required package gates for implementation work in this folder:

- `pnpm --filter @mog/app-spreadsheet test -- src/systems/renderer`
- `pnpm --filter @mog/app-spreadsheet test -- src/components/grid/effects src/hooks/shared/use-grid-mouse.ts src/hooks/view/use-renderer-actions.ts`
- `pnpm --filter @mog/app-spreadsheet test -- src/actions/handlers/selection/page-navigation.ts`
- `pnpm --filter @mog/app-spreadsheet typecheck`

If the SheetView capability surface changes:

- `pnpm --filter @mog-sdk/sheet-view test`
- `pnpm --filter @mog-sdk/sheet-view typecheck`
- Update API snapshots only when the public contract change is intentional.

Focused renderer tests to add or extend:

- Renderer activation preconditions and ready ordering with fake SheetView capabilities.
- Transition runner serialization, error handling, rapid sheet switches, and dispose during in-flight transition.
- View-sync transaction for initial attach and sheet switch: split/freeze, view options, culture/theme/skin, zoom, scroll restore, input scroll reset, and context projection.
- Unified event policy: every event in the manifest maps to the correct action and cleanup.
- Render-context projection: exhaustive field mapping, fast actor lane, slow follower lane, remote cursors, shimmer, trace arrows, page breaks, search highlights, and stale generation cancellation.
- Page-break production path: hit test, drag preview, end commit, cancel no-write, horizontal and vertical breaks, zoom/freeze/split coordinate conversion.
- Pending actions: applied in order after ready or deleted from public exports.
- Raw renderer access removal: no production `renderer.getRenderer()` callers remain.

Production-path app-eval gates should use real UI input and canvas/readback assertions:

- Viewport follow: `viewport-follow/arrow-*.spec.ts`, `viewport-follow/page-down-up.spec.ts`, `viewport-follow/frozen-pane-follow.spec.ts`, `viewport-follow/go-to-jump.spec.ts`, `viewport-follow/mouse-click-follow.spec.ts`.
- Scrolling and view sync: `scrolling/wheel-scroll-advances-viewport.spec.ts`, `scrolling/scroll-position-restore-on-sheet-switch.spec.ts`, `scrolling/scroll-to-distant-cell.spec.ts`, `keyboard/ctrl-backspace-scroll-to-active.spec.ts`.
- Freeze/split/zoom: representative `freeze-structure/*freeze*.spec.ts`, `view/view-split-*.spec.ts`, `zoom/zoom-freeze-pane-alignment.spec.ts`, `zoom/zoom-persists-per-sheet.spec.ts`, `zoom/view-zoom-to-selection.spec.ts`.
- Sheet switching: `sheet-switch-roundtrip/selection-scroll-restoration.spec.ts`, `sheet-switch-roundtrip/hit-test-after-switch.spec.ts`, `sheet-switch-roundtrip/freeze-after-switch.spec.ts`, `sheet-switch-roundtrip/switch-and-back-rendering.spec.ts`.
- Page breaks: `view/view-page-break-preview-toggle-via-ribbon.spec.ts`, `view/view-page-break-preview-renders-manual-break.spec.ts`, `view/view-normal-clears-preview-rendering-not-breaks.spec.ts`, plus a new drag-through-canvas scenario.
- Sparklines and CF: `sparklines/line-sparkline-insert.spec.ts`, `sparklines/sparkline-reflects-data-change.spec.ts`, `sparklines/sparkline-selection-shows-tools-tab.spec.ts`, and representative `conditional-formatting/*.spec.ts` render scenarios.

## Risks, edge cases, and non-goals

Risks:

- The renderer folder spans React effects, app coordinator, SheetView, Workbook events, and input/object systems. A partial migration can easily duplicate subscriptions or produce double invalidation.
- Removing raw `GridRenderer` access depends on SheetView exposing object hit-region and interaction details needed by object selection/resize/rotate. That dependency must be solved structurally, not bypassed.
- Rapid sheet switches can interleave with context follower reads, viewport refreshes, object scene resync, page-break reads, and scroll restoration. Generation guards are mandatory.
- Event policy consolidation can accidentally move cache invalidation that should occur even when no renderer is mounted. Feature cache ownership must stay explicit.
- Page-break coordinate conversion is easy to get wrong under frozen panes, split panes, zoom, hidden rows/columns, and RTL. Tests must cover those states.
- Stricter activation preconditions can expose existing order bugs in React effects. Fix the ordering instead of weakening preconditions.

Edge cases to explicitly test:

- Dispose between `MOUNT` and `LAYOUT_READY`.
- Dispose during SheetView attach, sheet switch, or delayed follower context read.
- Active sheet changes twice before the first switch completes.
- Sheet deletion/import while renderer has old current sheet id.
- Split removed while frozen panes exist for the same target sheet.
- Unfreeze after scrolling a frozen pane with non-zero input physics state.
- View options toggled before renderer ready and during sheet switch.
- Remote cursor update with no local actor state change.
- Shimmer entries changing after renderer unmount.
- Page-break drag cancel after target moved.
- Page-break drag over hidden rows/columns.
- Sparkline manager rewired while hydration is in flight.
- CF rule changes on inactive sheet.
- Table auto-expansion triggered by a stale active sheet id.

Non-goals:

- Do not replace Workbook/Worksheet durable ownership.
- Do not move renderer side effects into XState machine actions.
- Do not optimize test-only renderer simulators.
- Do not leave deprecated raw renderer shims after capability migration.
- Do not weaken E2E standards by mutating renderer state directly.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the activation and event-policy contracts are written.

- Agent A: renderer runtime bindings, activation preconditions, lifecycle transition runner, generation guards, and lifecycle tests.
- Agent B: typed context/data-source projection, migration of React `updateContext()` pushes, exhaustive mapping tests, and SheetView data-source dependency tracking.
- Agent C: unified event policy, layout coordination integration, slicer ownership decision, subscription cleanup tests, and event coverage inventory.
- Agent D: page-break production wiring, coordinate conversion, Worksheet print writes, renderer unit tests, and app-eval drag scenario.
- Agent E: raw `GridRenderer` access migration across renderer, coordinator, object system, hooks, and action handlers after SheetView capability additions.
- Agent F: verification owner for package tests, typechecks, and app-eval scenarios across viewport-follow, freeze/split, sheet-switch, zoom, page-break, sparklines, and conditional formatting.

Dependencies:

- `views/sheet-view/src` for typed data-source, render-state, object hit-region, viewport, geometry, and render capabilities.
- `apps/spreadsheet/src/coordinator` for construction order, actor availability, object system integration, receipt/object scene resync, and feature manager ownership.
- `apps/spreadsheet/src/components/grid` for React effect migration and first-frame view-state synchronization.
- `apps/spreadsheet/src/systems/input` for scroll physics reset and pointer/keyboard path verification.
- `apps/spreadsheet/src/systems/objects` for object hit testing and floating object interaction state.
- `apps/spreadsheet/src/systems/grid-editing` for selection/editor/clipboard actors and viewport-follow emits.
- `@mog-sdk/contracts/rendering`, `@mog-sdk/contracts/api`, `@mog-sdk/contracts/viewport`, and `@mog-sdk/sheet-view` for public type contracts.
- `mog-internal/dev/app-eval/scenarios` for renderer behavior through real UI paths.
