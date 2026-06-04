# Plan 042: Grid Canvas Orchestration and Renderer Integration Improvements

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/canvas/grid-canvas/src`

Scope this plan covers:

- `renderer/grid-renderer.ts`: the composition facade that wires `@mog/canvas-engine`, `@mog/grid-renderer`, `@mog/drawing-canvas`, and `@mog/canvas-overlay` into the `GridRenderer` contract.
- `renderer/grid-render-scheduler.ts`: the write-to-invalidate bridge used by viewport buffers and geometry updates.
- `renderer/viewport-to-region-layout.ts`: the mechanical boundary from spreadsheet `ViewportLayout` to canvas-engine `RegionLayout`.
- `renderer/scene-graph-bounds-reader.ts` and `renderer/scene-graph-reader.ts`: public readback adapters over the drawing scene graph.
- `viewports/compute-layout.ts`, `viewports/types.ts`, and `viewports/scroll.ts`: viewport layout orchestration retained in this package.
- `cell-style-bridge.ts` and `styles/css-variables.ts`: DOM/canvas style adaptation and chrome theme CSS variable bridging.
- Existing package tests under `src/renderer/__tests__` and `src/viewports/__tests__`.

Production paths that must be considered:

- `views/sheet-view/src/sheet-view.ts` creates the renderer, owns viewport layout recomputation, stamps sheet-scoped viewport IDs, syncs Rust viewport registrations, and calls `setViewportLayout()`.
- `views/sheet-view/src/capabilities/*` and `apps/spreadsheet/src/components/grid/effects/useRenderContextConfig.ts` push render state through `updateContext()`.
- `apps/spreadsheet/src/components/grid/editors/InlineCellEditor.tsx`, print preview, toolbar hover flows, and mouse hooks consume the exported cell style adapters.
- `@mog/grid-renderer` owns cell/header/selection/UI/page-break/grid layer implementation and null data-source defaults.
- `@mog/drawing-canvas` owns scene graph, object rendering, hit map, bridge registry, and drawing-layer dirty callbacks.
- `@mog/canvas-engine` owns layout iteration, dirty rect accumulation, layer registration, request-frame behavior, and hit-test provider ordering.

Out of scope for the first implementation slice:

- Rewriting cell painting logic inside `canvas/grid-renderer/src`.
- Rewriting drawing object renderers inside `canvas/drawing-canvas/src`.
- Moving sheet-view policy state into grid-canvas.
- Adding compatibility shims around known contract drift. Update the public contracts and production callers directly when a contract is wrong.

## Current role of this folder in Mog

`@mog/grid-canvas` is the spreadsheet canvas composition boundary. It is intentionally a facade, not a renderer layer package. The package exports three main surfaces:

- `createGridRenderer()` / `GridRendererImpl`, implementing the contracts-level `GridRenderer` interface and exposing view-layer extensions like `getEngine()`, `getGridLayers()`, and `getCellExpander()`.
- `computeViewportLayout()`, a pure layout function that builds single, frozen, split, and overlay viewport layouts before `viewportLayoutToRegionLayout()` projects them into canvas-engine regions.
- DOM-dependent style and theme adapters that cannot live in `@mog/grid-renderer`, including `getCellCanvasFont()`, `getCellDOMStyle()`, `getThemedCellStyle()`, and `applyChromeTheme()`.

The package is already architecturally important but concentrated. `renderer/grid-renderer.ts` is 2,844 lines and currently contains:

- Mutable adapters from `RenderContextConfig` into focused data-source interfaces.
- A hot-path `updateContext()` dispatch table for 50-200+ calls per second.
- Dirty hint computation for selection and headers.
- Canvas engine, grid layer, drawing layer, overlay layer, hit-test provider, bridge, and lifecycle wiring.
- Scene graph patch application and full scene graph sync.
- Contract query methods such as page-space cell/range bounds, hit testing, scene graph readers, and object bounds updates.

Existing tests already lock several important behaviors: false dirty prevention for callback identity changes, partial dirty hints for selection and headers, scroll-vs-structural invalidation, viewport-to-region projection, scene-object projection, object bounds updates, and extensive viewport layout cases. The main improvement opportunity is to turn the implicit orchestration matrix in `grid-renderer.ts` into explicit, typed, independently testable production contracts while preserving the current facade API.

## Improvement objectives

1. Split the monolithic `GridRendererImpl` internals into focused orchestration modules without changing the public `@mog/grid-canvas` export surface.
2. Make `RenderContextConfig` to data-source adaptation exhaustive, typed, and drift-resistant so new render context fields cannot be silently ignored or mapped to the wrong dirty layers.
3. Replace ad hoc dirty-layer decisions with a declarative invalidation matrix covering context fields, buffer writes, geometry changes, viewport layout changes, scene graph patches, theme changes, scroll, zoom, sheet switch, and object interaction.
4. Strengthen the scene graph integration contract: Rust-supplied bounds are the production source for object rebuilds, incremental patches return precise old/new dirty rects, cross-sheet stale graph hits are blocked, and public readback reflects the rendered graph.
5. Preserve the single canonical viewport pipeline and add integration-level tests that prove sheet-view layout composition, region projection, page-space bounds, hit testing, and hidden-header/freeze/split behavior agree.
6. Promote DOM/canvas style parity into a tested contract, especially theme font/color resolution, CJK fallback insertion, preview font behavior, intrinsic font weights, vertical alignment, and editor surface fallback colors.
7. Keep `@mog/grid-canvas` a facade. Rendering algorithms stay in `@mog/grid-renderer`; drawing algorithms stay in `@mog/drawing-canvas`; generic engine behavior stays in `@mog/canvas-engine`.

## Production-path contracts and invariants to preserve or strengthen

- `updateContext()` remains O(number of fields in the patch) and must not serialize, deep clone, or rebuild data sources on every call.
- Data callback identity changes for cell values, formats, binary readers, tables, sparkline data, and validation readers must not mark cells dirty by themselves. Buffer mutation through `RenderScheduler.markCellsDirty()` is the production cell repaint signal.
- The "write = invalidate" contract remains explicit: viewport buffer mutations call `markCellsDirty()`, row/column dimension changes call `markGeometryDirty()`, and full buffer swaps/theme-level changes call `markAllDirty()`.
- Dirty hints emitted from grid-canvas are document-space hints compatible with canvas-engine's dirty rect conversion.
- Selection and header dirty hints repaint old and new visual extents, include active-cell/merge padding, and fall back to full dirty for formula mode, full row/column selections, multi-range selections, or unavailable position-index data.
- `setViewportLayout(layout, { invalidation: 'scroll' })` must update engine region metadata while avoiding static overlay/divider full repaints; structural layout changes still fully dirty the relevant layers.
- `computeViewportLayout()` remains pure and side-effect-free. Sheet-view may stamp sheet IDs onto viewport IDs, but grid-canvas owns only projection into `RegionLayout<GridRegionMeta>`.
- `viewportLayoutToRegionLayout()` remains mechanical: viewport ID, bounds, `viewportOrigin`, `scrollOffset`, zoom, cell range, sheet ID, and scroll behavior must be preserved or derived in one place.
- The legacy coordinate system stays synchronized enough for current callers until it is intentionally retired through a public contract change.
- Scene graph rebuilds use `getAllObjectBounds()` for batch sheet-switch/init paths. Incremental patch paths use `FloatingObjectPatch.bounds`. The old per-object async bounds callback is retained only for overlay/selection fallback, not as the production render source.
- A scene graph hit on a previous sheet must not route a click to a stale floating object after `switchSheet()`.
- `boundsReader` and `sceneGraphReader` remain live readers over the current drawing scene graph, stable for the renderer lifetime.
- DOM editor styles and canvas cell styles both flow through the same resolved cell style and theme reference logic.
- `applyChromeTheme()` updates the renderer container CSS variables and clears CSS variable caches so shell chrome and canvas chrome stay visually aligned.
- `resume()` must continue delegating to the engine even when `GridRendererImpl.isRunning` is false, because sheet-view currently owns engine start policy.

## Concrete implementation plan

1. Build a grid-canvas orchestration contract inventory.

   Create a source-scanned matrix for all `RenderContextConfig` keys and renderer public methods. For each context key, record owner adapter, stored field or callback, dirty layers, dirty hint mode, request-frame behavior, identity guard policy, and production producer. The inventory should live as an executable test fixture or generated metadata under `canvas/grid-canvas/src/renderer/__tests__`, not as private docs. The test should fail when `RenderContextConfig` gains a field that has no explicit disposition.

2. Extract data-source adapters into a typed adapter module.

   Move `CellDataAdapter`, `SelectionDataAdapter`, `SheetDataAdapter`, `CollaborationDataAdapter`, `TraceDataAdapter`, `FloatingObjectDataAdapter`, `GroupingDataAdapter`, `PageBreakDataAdapter`, and `OverlayDataAdapter` into `renderer/data-sources/`. Keep their classes internal to grid-canvas, but export small factory and type helpers for tests. Each adapter should have a focused `applyInitialConfig()` and explicit setter methods. Use `satisfies` checks against contracts-level data-source interfaces and null defaults from `@mog/grid-renderer` where applicable.

3. Replace the untyped dispatch table with a typed context update router.

   Define a `RenderContextFieldHandler<K extends keyof RenderContextConfig>` shape and a `createRenderContextUpdateRouter()` that receives the adapters, engine invalidator, grid-layer updater, scene graph syncer, and theme applier. The router should expose `apply(config)` and the contract inventory from step 1. Remove `Record<string, (value: any) => void>` from the production path. Unknown keys should be impossible at compile time and explicitly ignored only for documented historical fields such as `coords` or `interactiveElements`.

4. Centralize invalidation policy.

   Add `renderer/invalidation/` with a `GridInvalidator` facade over `engine.markDirty()` and `engine.requestFrame()` plus pure helpers for:

   - selection dirty hints,
   - header dirty hints,
   - scroll dirty layers,
   - all-layer dirty,
   - geometry dirty,
   - scene graph old/new bounds dirty,
   - overlay dirty for handle movement.

   The implementation should keep precise dirty hints where already proven and convert current TODO full-dirty cases into explicit contract entries. Do not over-optimize every case in the same slice; the important improvement is that every full-dirty fallback is intentional and tested.

5. Make scene graph synchronization a dedicated production component.

   Extract `applySceneGraphPatches()`, `syncSceneGraph()`, `buildSceneObject()`, `buildDiagramData()`, `buildTextEffectRef()`, OLE label derivation, and field classification into `renderer/scene-graph-sync/`. The component should accept `FloatingObjectDataAdapter`, `DrawingLayerHandle`, bridge references, and an invalidator. It should return precise dirty hints and structured skipped-patch diagnostics in dev builds. Add exhaustive tests for every supported `FloatingObject` type: picture, textbox, shape, connector, chart, equation, drawing/ink, OLE, diagram, unsupported group container, and form control skip.

6. Strengthen object patch and bounds contracts.

   Add tests proving created, updated, removed, position-only, visual-only, geometry-changing, missing-data, and missing-bounds patches behave correctly. Missing bounds on created/updated objects should skip rendering with a dev warning, not silently rebuild through the legacy per-object async path. Position-only patches should update bounds/rotation/z/flip without rebuilding type-specific data. Removed objects should dirty old bounds only when the object existed.

7. Introduce a renderer composition factory.

   Split constructor wiring into a small `createGridRendererComposition(config)` helper that returns engine, grid layers, drawing layer, overlay, hit-test providers, coordinate system, scheduler, adapters, and readers. The `GridRendererImpl` constructor should become policy wiring plus public method binding, not the place where every layer and adapter is hand-built. This keeps construction testable without forcing tests to bind private prototype methods to fake objects.

8. Upgrade tests away from private prototype binding.

   Current tests reach private methods through `GridRendererImpl.prototype as any`. After extraction, test pure invalidation helpers, router handlers, scene graph sync, and composition factory components directly. Keep a smaller integration test around `GridRendererImpl` public methods so the facade contract is still covered.

9. Align `invalidateCells()` with the scheduler contract.

   Today `invalidateCells()` marks the full `cells` layer dirty even though `GridRenderScheduler.markCellsDirty()` computes precise cell and merge-aware rects. Decide whether public `invalidateCells()` should delegate to the scheduler or remain a full-layer API. Implement the production contract directly and update tests. Prefer precise scheduler delegation when a position index exists, with documented full-dirty fallback when coordinates are missing or the position index has no data.

10. Make viewport layout integration contract-complete.

   Keep `computeViewportLayout()` pure, but add cross-module tests that start with sheet-view-like inputs, call `computeViewportLayout()`, stamp sheet-scoped viewport IDs, project through `viewportLayoutToRegionLayout()`, and assert engine region metadata, `getCellPageBounds()`, `getCellRenderedSize()`, and `hitTest()` agree for single, freeze rows, freeze columns, freeze rows plus columns, split, overlays, hidden headers, zoom, and small container cases.

11. Add lifecycle and sheet-switch race tests.

   Add tests for `start()`, `stop()`, `pause()`, `resume()`, `dispose()`, `switchSheet()`, async scene graph sync completion, and stale hit-test suppression. In particular, prove that switching sheets clears stale drawing hits before `getAllObjectBounds()` resolves and that late sync results cannot re-add objects from the previous sheet after a newer sheet switch.

12. Add DOM/canvas style parity tests.

   Test `getCellCanvasFont()`, `getThemedCellStyle()`, and `getCellDOMStyle()` against the same `CellFormat`, value, theme, CJK content, preview font, and vertical alignment inputs. Assert font family fallback ordering, intrinsic weight handling, theme font/color resolution, `showZeroValues`-related value styling where relevant, editor background fallback, and line-height/padding behavior. These should remain Node/JSDOM-friendly and should not depend on actual browser font availability.

13. Tighten CSS variable bridge behavior.

   Add tests for `applyChromeTheme()` setting every `ChromeTheme` field onto the expected `--color-ss-*` variables and clearing the CSS cache. Add a small disposal or idempotence check around CSS variable cache invalidation listeners if repeated test/browser initialization can register duplicate resize listeners.

14. Document and enforce package boundaries.

   Update module comments and tests so grid-canvas cannot grow renderer algorithms by accident. `@mog/grid-canvas` may compose layers, adapt DOM state, project viewport layout, and maintain facade lifecycle. It should not implement cell painting, shape rendering, generic dirty rect accumulation, or sheet-view policy state.

15. Complete integration through production callers.

   Update sheet-view and spreadsheet callers only when needed by contract changes from the steps above. Do not create parallel compatibility paths. If typed router changes reveal fields that sheet-view currently sends but grid-canvas does not use, either wire them intentionally or remove the dead sender in the same workstream.

## Tests and verification gates

Focused package tests to add or strengthen:

- Context router contract test: every `keyof RenderContextConfig` has an explicit handler or disposition, with expected dirty layers and identity guard policy.
- Adapter tests for each data-source adapter, including initial config, clearing to null/undefined, default values, callback replacement, and public data-source interface conformance.
- Invalidation tests for selection/header dirty hints, scroll dirty, all dirty, geometry dirty, cell dirty with merges, object old/new bounds, and full-dirty fallbacks.
- Scene graph sync tests for every floating object type and patch kind.
- Sheet-switch race tests for stale scene graph hits and late async sync results.
- Viewport integration tests covering compute -> compose sheet IDs -> region projection -> page bounds/hit-test consistency.
- Style bridge tests for theme references, preview fonts, CJK fallback, intrinsic weights, DOM vertical alignment, and editor surface fallback.
- CSS variable bridge tests for all `ChromeTheme` fields and cache clearing.

Verification commands for the implementation workstream:

- `cd mog/canvas/grid-canvas && pnpm test`
- `cd mog/canvas/grid-canvas && pnpm typecheck`
- `cd mog/canvas/grid-renderer && pnpm test` if any data-source, layer contract, or viewport helper behavior is touched.
- `cd mog/canvas/drawing-canvas && pnpm test` if scene graph or drawing-layer contracts are touched.
- `cd mog/canvas/engine && pnpm test` if dirty hint, region layout, or engine invalidation semantics change.
- `cd mog/views/sheet-view && pnpm test` for layout/data-source integration changes.
- `cd mog && pnpm typecheck` for TypeScript contract or cross-package caller changes.
- Run the spreadsheet dev server and exercise real UI paths for selection navigation, scrolling, freeze panes, split panes, object insert/move/resize, sheet switch, theme/skin change, inline editing, and copy/paste visual feedback after UI-facing changes.

E2E tests must drive real keyboard, mouse, clipboard, and pointer paths through the UI. They should not seed renderer state by direct private method calls.

## Risks, edge cases, and non-goals

Risks:

- Refactoring the facade can accidentally change `updateContext()` allocation or dirty frequency. Keep the router hot path simple and benchmark production update sequences before and after if performance-sensitive changes land.
- Moving scene graph sync may expose latent async races during sheet switch. Add generation tokens or active-sheet guards before changing sync ordering.
- Typed handler exhaustiveness may reveal fields that currently have no real rendering effect. The correct outcome is an explicit disposition or production wiring, not a silent no-op.
- Dirty rect precision can miss visual extents for merged cells, thick selection borders, formula highlights, frozen headers, or transformed objects. Preserve full-dirty fallbacks until a precise hint is proven.
- Tests that bind private prototype methods currently mask construction wiring issues. Replacing them with extracted helper tests should be paired with at least one public facade integration test.
- CSS variable listener setup may behave differently in Node, JSDOM, and browsers. Keep non-browser fallbacks deterministic.

Edge cases to cover:

- Position index unavailable or partially hydrated.
- Frozen rows/columns larger than the viewport.
- Hidden row headers, hidden column headers, and mixed header visibility.
- Zoom changes combined with freeze panes and split panes.
- Full row, full column, multi-range, formula-mode, drag-fill, paste-preview, and table-preview selections.
- Merged cells at only one boundary of a selection range.
- Object patches without data, without bounds, with stale bounds, or for objects removed before the patch is applied.
- Sheet switch while object bounds batch sync is in flight.
- Overlay hits on previous-sheet objects after active sheet changes.
- Theme changes while inline editor or font preview is active.
- CJK strings, quoted font families, intrinsic-weight fonts, and unavailable fonts.

Non-goals:

- Do not move rendering algorithms from `@mog/grid-renderer` into grid-canvas.
- Do not move drawing algorithms from `@mog/drawing-canvas` into grid-canvas.
- Do not optimize mocks or test-only render paths.
- Do not keep duplicate old and new context update APIs. With no external users, update the production contract and call sites directly.
- Do not make `mog` depend on `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

This work can be split across independent agents after the contract inventory lands:

- Agent A: build the `RenderContextConfig` handler inventory and typed router tests.
- Agent B: extract data-source adapters and update adapter/unit tests.
- Agent C: extract invalidation helpers and migrate dirty hint tests away from private prototype binding.
- Agent D: extract scene graph sync, object projection, and patch tests.
- Agent E: add viewport integration tests spanning compute layout, region projection, page bounds, hit testing, and sheet-view ID stamping.
- Agent F: add style bridge and CSS variable bridge contract tests.
- Agent G: integrate any sheet-view/spreadsheet caller changes and run production UI smoke verification.

Dependencies:

- `mog/contracts/src/rendering` and `mog/types/rendering/src` own `GridRenderer`, `RenderContextConfig`, data-source interfaces, dirty layer names, and public object reader contracts.
- `mog/views/sheet-view/src` owns renderer lifecycle policy, viewport layout recomputation, sheet-scoped viewport IDs, data-source pushing, and Rust viewport registration.
- `mog/canvas/grid-renderer/src` owns grid layer implementation, null data-source defaults, coordinate indexes, visible range helpers, header constants, and grid hit testing.
- `mog/canvas/drawing-canvas/src` owns scene graph mutation behavior, drawing-layer dirty callbacks, hit map transforms, bridge registry, and scene object types.
- `mog/canvas/engine/src` owns engine layout, dirty rect accumulation, layer registry semantics, request-frame behavior, and generic hit-test provider ordering.
- `mog/apps/spreadsheet/src` owns real user workflows that must be exercised after changes: selection/editing, object interactions, themes/skins, clipboard visual feedback, and toolbar-driven preview font changes.
