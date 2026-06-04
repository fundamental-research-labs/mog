# 068 - Views SheetView Src Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/views/sheet-view/src`

Queue item: 68

Scope: the public `@mog-sdk/sheet-view` source package surface: root exports, public DTOs, capability interfaces, the imperative `SheetView` substrate, viewport wiring, viewport chrome, capability implementations, and package-local tests under `views/sheet-view/src/__tests__`.

Files and integration points inspected:

- `views/sheet-view/src/index.ts`
- `views/sheet-view/src/public-types.ts`
- `views/sheet-view/src/capability-interfaces.ts`
- `views/sheet-view/src/sheet-view.ts`
- `views/sheet-view/src/viewport-wiring.ts`
- `views/sheet-view/src/viewport-chrome.ts`
- `views/sheet-view/src/capabilities/*`
- `views/sheet-view/src/__tests__/*`
- `views/sheet-view/package.json`
- `views/sheet-view/jest.config.cjs`
- `views/sheet-view/tsconfig.json`
- `tools/api-snapshots/@mog-sdk__sheet-view.api.txt`
- `docs/guides/sheet-view.md`
- `apps/spreadsheet/src/systems/renderer/execution/renderer-execution.ts`
- `apps/spreadsheet/src/components/grid/effects/useRenderContextConfig.ts`
- `apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx`
- `apps/spreadsheet/src/systems/renderer/render-system.ts`
- `canvas/grid-canvas/src/renderer/grid-renderer.ts`
- `canvas/grid-renderer/src/coordinates/coordinate-system.ts`
- `canvas/grid-renderer/src/hit-test/grid-hit-test.ts`
- `types/rendering/src/hit-test.ts`

Scope this plan does not cover:

- Replacing `@mog/canvas-engine`, `@mog/grid-canvas`, or `@mog/grid-renderer`.
- Changing workbook ownership, persistence, compute viewport fetching, or kernel APIs except where a public SheetView data-source adapter requires a typed boundary.
- Adding compatibility shims around raw renderer internals.
- Optimizing test-only paths or mock-only renderer behavior.
- Exposing private `mog-internal` content in public packages or docs.

## Current role of this folder in Mog

`views/sheet-view/src` is the shipped public low-level browser sheet view substrate. It mounts the canvas/grid stack into a host DOM container, attaches a workbook-backed data source, owns viewport layout and region refreshes, and exposes a capability handle that external consumers can use without importing `@mog/*` canvas internals.

Observed responsibilities:

- `index.ts` is the package root barrel. It exports `createSheetView()`, `createSheetViewDataSourceFromWorkbook()`, skin helpers, public DTOs, and capability interfaces. Docs and API snapshots state that public consumers should import from the package root only.
- `public-types.ts` owns the public DTO surface: geometry, hit-test results, render visual state, viewport state, object scene snapshots, interactive elements, commands, events, extension overlays/decorations/layers, skin inputs, mount options, and data-source attachment.
- `capability-interfaces.ts` defines the public capability facade intended to replace direct access to `engine`, `gridRenderer`, `coordinateSystem`, `positionIndex`, `mergeIndex`, and `updateContext()`.
- `sheet-view.ts` constructs `createGridRenderer()`, owns VPI/VMI, attaches workbook viewport regions, computes viewport layout, refreshes visible data, emits events, and wires concrete capability objects. The class still exposes `engine`, `coordinateSystem`, `gridRenderer`, `positionIndex`, `mergeIndex`, and `updateContext()` as internal escape hatches. The public factory returns a capability-only `SheetViewHandle`, but it also stores a hidden `__mogInternalGridRenderer` property that the spreadsheet app reads.
- `viewport-wiring.ts` is the production bridge from `WorkbookViewport` events to VPI/VMI hydration and render scheduler dirty marks. It preserves the important ordering invariant that wiring must connect before the first immediate viewport refresh.
- `capabilities/*` adapt internal renderer contracts into the public capability APIs. Key adapters include geometry, hit testing, render invalidation, viewport state, render state, data sources, objects, interactive elements, overlays, decorations, canvas extension layers, focus, commands, and skins.
- The spreadsheet app is already mostly capability-oriented through `getGeometry()`, `getHitTest()`, `getViewport()`, `getObjects()`, `getRenderState()`, and `getInteractiveElements()`. The remaining production leaks are concentrated in the hidden grid renderer extraction and broad `updateContext()` / `dataSources.update()` flow for app-owned renderer callback plumbing.

Existing tests cover viewport wiring, viewport chrome math, workbook data-source refreshes, overlay/decorations/layers lifecycles, skin resolution, object scene patches, commands, and events. There is no direct package-local test coverage for geometry, hit-test mapping, viewport capability state transitions, render-state mapping completeness, focus behavior, render invalidation semantics, or the `createSheetView()` capability-only handle.

## Improvement objectives

1. Make `@mog-sdk/sheet-view` a fully capability-based public substrate with no production dependency on hidden renderer handles.

2. Replace open `unknown` and `Record<string, unknown>` public escape hatches with typed, SheetView-owned adapter contracts where the folder already knows the production shape.

3. Reconcile hit-test contracts across `GridRenderer.hitTest()`, coordinate-system classification, grid hit-test providers, `UnifiedHitResult`, and public `SheetHitResult` so every production hit branch is either reachable and mapped or explicitly absent from the public union.

4. Make render-state and data-source mapping exhaustive and auditable. Unknown public render-state fields must not be silently ignored; app-owned renderer callbacks must have typed capability entry points instead of being cast into `RenderContextConfig`.

5. Strengthen geometry and viewport contracts for frozen panes, split panes, hidden dimensions, page-space vs viewport-space coordinates, zoom, resize, scroll clamping, overlay viewports, and visible-range observation.

6. Define lifecycle and disposal semantics for every capability: which methods throw after dispose, which no-op by design, which emit events, and which release DOM/canvas subscriptions.

7. Preserve package-root import discipline and public API snapshot control while expanding the contract surface deliberately.

8. Keep implementation on the production app path. The spreadsheet app, embed/docs path, grid renderer, and public API snapshot must all agree on the same capability contracts.

## Production-path contracts and invariants to preserve or strengthen

Public package boundary:

- Public consumers import only from `@mog-sdk/sheet-view`.
- `public-types.ts` remains the owner of SheetView public DTOs. External consumers must not need `@mog/canvas-engine`, `@mog/grid-renderer`, `@mog/grid-canvas`, or internal `RenderContextConfig` types.
- `mog` must not depend on `mog-internal`.
- The canonical workbook remains outside the SheetView public type surface, but the runtime attachment contract must be structurally typed enough to remove `unknown` casts in production code.
- API snapshot changes must be intentional and reviewed as public contract changes.

Capability surface:

- `createSheetView()` returns a capability-only `SheetViewHandle`.
- The production spreadsheet app must not require `__mogInternalGridRenderer`, raw `GridRenderer`, raw `engine`, raw coordinate system, raw VPI/VMI, or raw `updateContext()` after the migration is complete.
- `SheetView` may keep package-private internals for implementation, but public package exports and app-facing coordinator types should route through capabilities.
- `SheetViewHandle` methods and capability methods must preserve current lifecycle: `attach()` once, `start()` after attach/policy wiring, `switchSheet()` with region reset, `suspend()` / `resume()`, `resize()`, and idempotent `dispose()`.

Viewport and data refresh:

- `ViewportWiring.connect()` must remain before the first immediate viewport refresh so the initial `fetch-committed` event hydrates VPI/VMI.
- `fetch-committed` rebuilds VPI/VMI, syncs binary workbook readers, and marks all dirty.
- `dimensions-patched` rebuilds geometry indices and marks geometry dirty.
- `cells-patched` marks cell dirty without rebuilding VPI/VMI.
- Multiple SheetViews sharing a workbook must keep the eager population path from an existing viewport buffer.
- Sheet switch must dispose old viewport regions, reset stale refresh generation, reset per-sheet scroll state, resync workbook data sources, handle overlays that dismiss on sheet change, and refresh the new active sheet.
- Debounced viewport refresh must ignore stale generation work after dispose or sheet switch.

Geometry and coordinate spaces:

- Viewport-space, page-space, document-space, cell-area-relative, and rendered-size reads must remain distinct.
- Geometry reads must be correct under scroll, zoom, resize, frozen panes, split panes, hidden rows/columns, outline gutters, headers, merged cells, and device pixel ratio.
- Range reads that cross pane boundaries may return multiple rects; overlay/decorations policy must state whether it uses individual rects or a bounding box.
- `getCellRenderedSize()` remains independent of scroll and clipping.
- `getDimensions()` and `getPositionDimensions()` must reflect the active sheet's hydrated position index and must not expose mutable internal indices.

Hit testing:

- Public `SheetHitResult` must cover every production branch reachable from `GridRenderer.hitTest()` and its lower-level providers.
- Public type names use SheetView-owned names, but internal variants must be mapped exhaustively with a compile-time `never` guard. Falling through to `{ type: 'empty' }` for an unmapped internal variant is not acceptable.
- Merged-cell hits must have a clear policy: either return a regular cell with anchor normalization elsewhere, or return `merged-cell-anchor` with the merge region. The public union and implementation must match.
- Table resize handles, formula range handles, selection border affordances, floating object handles, hidden boundaries, outline gutters/buttons, comment indicators, interactive elements, frozen regions, headers, resize handles, select-all, fill handle, cells, and empty area must have a source-of-truth inventory and tests.

Render state and app data sources:

- `renderState.update()` is for visual state: selection, editor, clipboard, remote cursors, view options, chrome theme, shimmer, page breaks, preview font, search highlights, blocked edit attempt, and validation circles.
- Data-source callbacks are a separate capability. They cover cell values/formats, tables, filters, sparklines, validation, floating objects, charts, grouping/outline, trace arrows, paste/flash-fill previews, table preview, page breaks, binary viewport readers, and any other production `RenderContextConfig` callback currently pushed by the spreadsheet app.
- The adapter from public SheetView DTOs to internal renderer config must be field-by-field and exhaustive. Unknown renderer config must not be accepted through the public package as an untyped bag.
- Selection and editor event emission from render-state updates must stay deterministic and must not pretend to know app-owned commit vs cancel decisions.

Objects, overlays, decorations, layers, and skin:

- Object scene APIs report rendered scene state, not workbook persistence state.
- Transient object bounds must either visibly clear back to committed state immediately or invalidate/resync so the renderer cannot retain stale transient visuals.
- Overlay/decorations layers remain non-persistent and must not mutate workbook formats.
- Overlay dismissal on scroll and sheet change must be deterministic.
- Canvas extension layers must resize with the SheetView container, honor DPR, clean up RAFs/canvases on dispose, and render in documented z-order relative to built-in layers.
- Skin changes affect view chrome and renderer policy only; they must not mutate workbook theme, formats, collaboration state, or persisted document data.

## Concrete implementation plan

### 1. Inventory and close the remaining renderer escape hatches

Create a production inventory of every current raw renderer dependency outside `views/sheet-view/src`:

- `apps/spreadsheet/src/systems/renderer/execution/renderer-execution.ts` reading `__mogInternalGridRenderer`.
- `RendererExecutionResult.getRenderer()` and downstream deprecated callers.
- `RenderSystem.updateContext()` and `rendererExecution.updateContext()`.
- `useRenderContextConfig()` direct pushes for callback data sources, trace arrows, page breaks, remote cursors, floating objects, and previews.
- Any bridge callback documented as wiring to SheetView's engine through `onRendererCreated`.

For each dependency, either migrate to an existing capability or add a correctly typed capability extension. The target state is:

- `createSheetView()` no longer defines `__mogInternalGridRenderer`.
- `RendererExecutionResult.getRenderer()` is removed or narrowed to a non-production test/debug path only after all app callers are gone.
- `onRendererCreated` receives `SheetViewHandle` and any bridge-specific APIs through explicit capabilities, not hidden engine access.
- App code uses `sheetView.render`, `sheetView.viewport`, `sheetView.geometry`, `sheetView.objects`, `sheetView.renderState`, `sheetView.dataSources`, `sheetView.locale`, and future extension capabilities only.

This work should land only after the replacement capabilities are complete; do not leave a partial migration that still needs the hidden property.

### 2. Replace the public data-source bag with typed data-source groups

Replace `SheetViewDataSources = Record<string, unknown>` and `ISheetViewDataSources.update()` as the main app data-source route with a typed contract that covers the complete current production callback set.

Add public, SheetView-owned DTO groups in `public-types.ts`, for example:

- `SheetCellDataSources`: `getCellValue`, `getCellFormat`, binary viewport readers, viewport-specific binary readers.
- `SheetTableDataSources`: `getTableAtCell`, `getResolvedTableRange`, filter header info, active table filter checks.
- `SheetObjectDataSources`: floating object state, object list, object bounds, all object bounds, chart renderer.
- `SheetGroupingDataSources`: grouping config, row/column groups, outline levels, max levels.
- `SheetPreviewDataSources`: paste preview, flash fill preview, table preview range, preview font.
- `SheetPageBreakDataSources`: preview mode, manual page breaks, auto page breaks, print area.
- `SheetValidationDataSources`: validation error state and validation circles.
- `SheetFormulaAuditDataSources`: trace arrows and trace cell position.
- `SheetCollabDataSources`: remote cursors.

Then implement a mapper inside `views/sheet-view/src` from these public groups into internal `RenderContextConfig` keys. The app should call `sheetView.dataSources.replaceGroups()` / `updateGroups()` or equivalent, not pass raw renderer config. Keep a narrow escape only for explicitly unknown extension data if the renderer truly has plugin-style keys; otherwise remove the generic bag.

Migration steps:

1. Add the typed public groups and package-local mapper.
2. Update `useRenderContextConfig()` and `SpreadsheetGrid.tsx` to use typed groups.
3. Update renderer execution so `updateContext()` delegates through typed data-source methods or disappears.
4. Remove the `Record<string, unknown>` public type from normal production use.
5. Add unit tests proving every currently pushed `RenderContextConfig` key has a typed public source or an intentionally documented internal-only owner.

### 3. Make render-state mapping exhaustive

Refactor `capabilities/render-state.ts` so `mapToInternalConfig()` is not an open record builder with silent ignores.

Add:

- A `SheetRenderStateKey` inventory over `keyof SheetRenderState`.
- Field-specific mapper functions for selection, editor, clipboard, remote cursors, view options, chrome theme, shimmer, page breaks, preview font, search highlights, blocked edit attempt, and validation circles.
- Compile-time coverage using `satisfies Record<keyof SheetRenderState, ...>` or an equivalent exhaustive map.
- Tests for each public render-state field that assert the exact internal context keys produced.
- Tests for event emission: selection visual change, editor start request from false to true with a cell, no bogus commit/cancel events from visual state alone.

Review current behavior where missing `selection.activeCell` maps to `{ row: 0, col: 0 }`. Preserve it only if the renderer dispatch table requires it; otherwise represent absence explicitly and test the renderer behavior.

### 4. Reconcile hit-test source of truth end to end

Create a hit-test contract inventory spanning:

- `types/rendering/src/hit-test.ts`
- `contracts/src/rendering/hit-test.ts`
- `canvas/grid-renderer/src/coordinates/coordinate-system.ts`
- `canvas/grid-renderer/src/hit-test/grid-hit-test.ts`
- `canvas/grid-canvas/src/renderer/grid-renderer.ts`
- `views/sheet-view/src/capabilities/type-mappers.ts`
- `views/sheet-view/src/public-types.ts`

Then implement one source-of-truth path:

1. Extend internal `UnifiedHitResult` to include every production grid hit branch that the renderer can produce, including selection border, table resize handle, formula range handle, interactive element, and merged-cell anchor if those are intended public branches.
2. Update `GridRenderer.hitTest()` so it uses the richer grid hit-test provider or equivalent production logic before falling back to coordinate classification. Object-layer cross-sheet guards must remain.
3. Update `mapHitResult()` to map every internal variant to `SheetHitResult` with an exhaustive `never` default.
4. If a public variant is not reachable by design, remove it from `SheetHitResult` or explicitly document and test its absence. Do not keep declared-but-unreachable variants.
5. Add package-local tests for each public hit branch and renderer-level tests where lower-level hit providers are the source.

This is cross-folder work by design; fixing only `type-mappers.ts` would not prove the production UI can ever emit those hits.

### 5. Type viewport config and layout as public SheetView DTOs

Replace:

- `SheetViewportConfig = { readonly type: string; readonly [key: string]: unknown }`
- `SheetOverlayViewportConfig = { readonly id: string; readonly [key: string]: unknown }`
- `SheetViewportLayout = unknown`

with SheetView-owned public DTOs that mirror only the view semantics hosts need:

- `SheetSingleViewportConfig`
- `SheetFrozenViewportConfig`
- `SheetSplitViewportConfig`
- `SheetOverlayViewportConfig` with typed bounds/range/origin/scroll behavior fields
- `SheetViewportLayout` with typed `viewports`, `dividers`, viewport bounds, cell ranges, scroll offsets, zoom, and roles

Add mappers between public DTOs and internal `PersistedViewportConfig`, `OverlayViewportConfig`, and `ViewportLayout`. App code such as `SplitDividersLayer` and `RenderSystem.getViewportLayout()` should stop casting `unknown` to internal layout types.

Strengthen viewport behavior while doing this:

- Clamp scroll bounds for split and overlay viewports, not just `main`.
- Preserve split/freeze config before `attach()` so first paint uses the correct topology.
- Keep `setFrozenPanes()` and `setConfig({ type: 'freeze' })` semantically equivalent.
- Ensure `getSnapshot()` and `getViewportState()` never expose mutable internal maps or stale sheet IDs.
- Test scroll restore across switch-sheet, unfreeze scroll reset, split scroll serialization, overlay viewport add/remove, and visible-range observer behavior.

### 6. Add geometry capability contract tests and mapper guards

Add focused tests for `SheetViewGeometry` with mocked renderer, coordinate system, position index, and merge index:

- `getCellRect()` and `getRangeRects()` return viewport-space rects and preserve multiple pane rects.
- `getCellPageRect()` and `getRangePageRects()` return page-space rects from the renderer.
- `getCellRenderedSize()` is independent of scroll and returns null only when the renderer cannot provide a usable zoom/size.
- `getDimensions()` reads row and column dimension info for both cell and range anchors, including hidden states.
- `fromViewportPoint()` and `toViewportPoint()` map through the current sheet ID and return null when no sheet/visible cell exists.
- `getMergeAnchor()` maps internal merge regions to public regions.
- `observe()` only fires on rect changes, swallows listener errors, and clears on dispose.
- `getHeaderVisibility()`, `getOutlineGutter()`, `getCellAreaOffset()`, and `getClippedCellContent()` match renderer/coordinate-system behavior.

Then add integration tests through `SheetView` for the production lifecycle cases that pure mocks cannot prove: attach ordering, VPI hydration before first layout-dependent geometry reads, resize/zoom/scroll observer notifications, and switch-sheet index reset.

### 7. Define lifecycle/disposal semantics for every capability

Add a package-local lifecycle contract table in code comments or docs, and back it with tests:

- `SheetViewHandle.dispose()` is idempotent and releases workbook scheduler, viewport regions, timers, ResizeObserver, wheel/click/focus listeners, overlays, decorations, canvas layers, skin subscribers, geometry observers, visible-range observers, event subscribers, renderer, and the inner container.
- State-mutating handle methods after dispose either throw through `_ensureNotDisposed()` or no-op by explicit design. The policy must be consistent by capability, not accidental.
- Capability observer disposables are idempotent.
- RAFs scheduled by canvas layers are cancelled on layer or view disposal.
- Overlay/decorations DOM nodes are removed on view disposal, sheet-change dismissal, and scroll dismissal.
- `renderState.update()` after dispose does not revive renderer state or emit events.

This should be implemented against real `createSheetView()` handles as well as unit capability classes, because the public factory is the contract external users see.

### 8. Strengthen object and extension layer behavior

Improve the object capability:

- Make `clearTransientBounds()` visibly revert to committed scene state by calling a renderer method that can clear or resync transient overrides, or by invalidating/resyncing the drawing layer deterministically.
- If object-specific invalidation is not supported by the renderer, document that `objects.invalidate(objectId)` currently invalidates the drawing layer and add a renderer follow-up to support object-scoped dirty bounds.
- Test `hitTest()`, transient bounds update/clear, scene patch mapping, z-order reads, scene object snapshots, force resync, and invalidation.

Improve extension surfaces:

- Specify whether overlays/decorations anchored to a range spanning frozen/split panes receive one element per rect or a bounding box. Use individual rects for decorations where visual fidelity matters, and document bounding-box behavior for popover-style overlays.
- Ensure canvas extension layers resize on host resize and structural layout changes, including DPR changes.
- Add tests for collision policies (`flip`, `shift`, `hide`) and placement for all eight placements.
- Add tests for decoration badge positioning and animation style output without relying on global CSS side effects.

### 9. Preserve and update public docs and API snapshots deliberately

After implementation, update:

- `docs/guides/sheet-view.md` to describe typed data-source groups, typed viewport layout/config, hit-test result guarantees, and lifecycle semantics.
- `docs/reference/README.md` only if public package facts change.
- `tools/api-snapshots/@mog-sdk__sheet-view.api.txt` through the repository's API snapshot command.

The public API snapshot should show no `SheetViewportLayout = unknown` and no generic data-source bag as the primary contract. Any remaining `unknown` should be intentional for truly opaque user payloads such as object data, custom culture extensions, asset load errors, or plugin metadata.

## Tests and verification gates

Implementation should run these gates before claiming done:

- `pnpm --filter @mog-sdk/sheet-view test`
- `pnpm --filter @mog-sdk/sheet-view typecheck`
- `pnpm --filter @mog-sdk/sheet-view build`
- API snapshot verification/update for `@mog-sdk/sheet-view`.
- Targeted grid renderer tests for hit-test integration where `UnifiedHitResult` or `GridRenderer.hitTest()` changes.
- Targeted spreadsheet app tests covering renderer execution, render-context coordination, split dividers, grid mouse/input hit testing, object/chart handlers, and canvas interactive overlays.
- `pnpm typecheck` for TypeScript changes unless the implementation workstream defines and justifies a narrower package-level type gate.
- For UI-affecting changes, run the spreadsheet dev server and exercise real browser paths: mount, attach, first paint, scroll, zoom, switch sheet, freeze/unfreeze, split view, object hit/drag, table/formula/selection hit targets, overlays, focus, and dispose/remount.
- Any E2E tests added for this area must use real UI input paths: mouse, keyboard, wheel, pointer, and clipboard where relevant. Do not mutate renderer state directly to fake a user condition.

Test coverage to add or extend:

- Package-level `createSheetView()` handle tests proving no public raw renderer property is needed.
- Geometry capability unit tests and SheetView lifecycle integration tests.
- Hit-test matrix tests for all public hit variants.
- Render-state mapper exhaustive tests.
- Typed data-source adapter tests that cover every production callback key currently pushed by the spreadsheet app.
- Viewport config/layout typed mapper tests for single, freeze, split, overlay, sheet switch, and scroll restore.
- Disposal tests for every capability that owns subscriptions, DOM nodes, timers, RAFs, or renderer state.

## Risks, edge cases, and non-goals

Risks:

- Removing `__mogInternalGridRenderer` before bridge and app migrations are complete would break production spreadsheet initialization.
- Tightening public types will change the API snapshot and may require coordinated package versioning/documentation.
- Hit-test changes can alter input priority. Floating objects must remain above cells, and the existing cross-sheet object guard must stay in place.
- Typed data-source groups can become too coupled to internal renderer names if they are not expressed as SheetView-owned concepts.
- Viewport layout typing must not leak internal mutable objects or force public consumers to depend on `@mog-sdk/contracts/viewport`.
- Scroll clamping changes can affect split/freeze restore behavior; app UI store and workbook mirror fallback must remain consistent.
- Async viewport refresh races can reappear if generation guards, region disposal, or fetch ordering are disturbed.

Edge cases to explicitly test:

- Zero-size containers at construction, then resize to non-zero.
- Device pixel ratio changes for canvas extension layers.
- No active sheet ID before attach or after dispose.
- Shared workbook with multiple SheetViews where the second view attaches after data already exists.
- Hidden row/column boundaries at the start and end of hidden runs.
- Merged cells spanning frozen/split boundaries.
- Ranges spanning multiple pane rects.
- Very large scroll positions, non-finite scroll and zoom inputs, and unfreeze from non-zero scroll.
- Sheet switch while a debounced refresh is pending.
- Overlay/decorations anchored to cells that become invisible.
- Subscriber errors in events, geometry observers, visible-range observers, and skin listeners.
- Object scene stale data during sheet switch.
- Public consumers that keep capability references after view disposal.

Non-goals:

- Do not create a new renderer, coordinate system, or viewport engine.
- Do not move spreadsheet app policy into `@mog-sdk/sheet-view`.
- Do not expose workbook mutation, save/export, authorization, formula editing, command routing, or app state machines through SheetView.
- Do not add test-only adapter APIs to make unit tests convenient.
- Do not keep compatibility shims for raw renderer access as the final architecture.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable, but the slices must converge on one public contract.

Suggested parallel slices:

- Public API and DTO slice: `views/sheet-view/src/public-types.ts`, `capability-interfaces.ts`, `index.ts`, API snapshot, and docs. Owns typed data-source groups and typed viewport layout/config DTOs.
- SheetView implementation slice: `sheet-view.ts`, `viewport-wiring.ts`, `capabilities/viewport.ts`, `capabilities/render-state.ts`, lifecycle/disposal tests, and factory-handle tests.
- Hit-test slice: `types/rendering/src/hit-test.ts`, `contracts/src/rendering/hit-test.ts`, `canvas/grid-canvas/src/renderer/grid-renderer.ts`, `canvas/grid-renderer/src/coordinates`, `canvas/grid-renderer/src/hit-test`, and `views/sheet-view/src/capabilities/type-mappers.ts`.
- Spreadsheet app migration slice: `apps/spreadsheet/src/systems/renderer/execution`, `render-system`, `useRenderContextConfig`, `SpreadsheetGrid`, grid mouse/input hooks, split dividers, object/chart handlers, and bridge callbacks.
- Extension/lifecycle test slice: overlays, decorations, canvas layers, focus, events, objects, skin, and browser-level UI exercise.

Cross-folder dependencies:

- `canvas/grid-canvas/src/renderer/grid-renderer.ts` for hit-test, scene graph, render scheduler, invalidation, data-source, and lifecycle behavior.
- `canvas/grid-renderer/src` for coordinate classification, hidden/frozen/outline hit targets, interactive element collection, and rendering-layer expectations.
- `types/rendering/src` and `contracts/src/rendering` for internal renderer contracts that SheetView adapts.
- `apps/spreadsheet/src` for the production app path and remaining raw renderer/data-source migration.
- `docs/guides/sheet-view.md`, `docs/reference/README.md`, and `tools/api-snapshots` for public package contract updates.

Sequence:

1. Land public DTO/data-source/viewport/hit-test contract definitions with mapper scaffolding.
2. Implement SheetView capability mappers and package-local tests.
3. Migrate spreadsheet app production callers from raw renderer/updateContext to typed capabilities.
4. Remove hidden renderer access and deprecated production raw renderer getters.
5. Update docs and API snapshots.
6. Run package, app, API, and browser verification gates on the final integrated path.
