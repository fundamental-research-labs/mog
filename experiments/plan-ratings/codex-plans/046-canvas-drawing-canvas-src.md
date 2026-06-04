# 046 - Drawing Canvas Production Contract Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/canvas/drawing-canvas/src`

Queue scope: drawing layer scene, renderer, bridge, and hit-testing code for `@mog/drawing-canvas`.

In scope:

- `scene/`: `SceneGraph` storage, z-order reads, group bounds, dirty IDs, mutation notifications, and scene object discriminated unions.
- `layer/`: `DrawingLayer` integration with `@mog/canvas-engine` per-region rendering, dirty rects, viewport culling, and hit-map synchronization.
- `hit-testing/`: `HitMap` spatial index maintenance, viewport transforms, Path2D registrations, narrow-phase testing, z-order hit priority, and group hit metadata.
- `renderers/`: type-specific renderers for pictures, textboxes, shapes, connectors, charts, ink, equations, diagrams, OLE objects, rich text, image cache, and shared render utilities.
- `bridges/`: chart, diagram, equation, text-effect, ink, and 3D mapping bridge contracts.
- `factory.ts`, `index.ts`, `shape-rendering-info.ts`, and OOXML conversion utilities where they define public package behavior.

Out of direct edit scope for this plan, but required integration context:

- `canvas/grid-canvas/src/renderer/grid-renderer.ts`, which creates the drawing layer, applies floating object patches into `SceneGraph`, registers `HitMap` with input capture, and exposes scene/bounds readers.
- `canvas/engine/src`, which owns `CanvasLayer`, per-region transform setup, dirty rect clipping, and hit-test provider ordering.
- `canvas/spatial`, `canvas/drawing/engine`, `canvas/drawing/shapes`, `canvas/drawing/diagram`, `types/objects`, `kernel/src/floating-objects`, and OOXML parser/writer folders that supply geometry, bounds, object payloads, and contract types.

## Current role of this folder in Mog

`@mog/drawing-canvas` is the world-space floating object layer registered by `@mog/grid-canvas` at z-index 500 on canvas 0. It renders charts, pictures, textboxes, shapes, connectors, ink, equations, diagrams, and OLE previews over grid cells while selection handles and guides render above it through the overlay package.

The current production path is:

1. `GridRenderer` calls `createDrawingLayer()`.
2. Floating-object kernel/store patches are converted into `SceneObject` instances in `grid-canvas` and applied to `SceneGraph`.
3. `SceneGraph` mutations mark the `DrawingLayer` dirty and maintain dirty IDs for `HitMap.syncIndex()`.
4. `DrawingLayer.render()` runs once per render region, culls scene objects against the visible document region, dispatches to type-specific renderers, clears/re-registers Path2D body paths, and updates `HitMap` viewport transform state.
5. `HitMap` is registered with canvas-engine input capture and returns topmost drawing-object hits using a spatial broad phase plus optional Path2D narrow phase.
6. `grid-canvas` overlay adapters read `SceneGraph` bounds and use `HitMap` viewport transform getters to convert document-space object bounds into screen-space handles.

This folder is therefore not just a renderer bundle. It is the synchronous scene authority for rendered floating objects, hit selection, overlay positioning, devtools scene snapshots, and production dirty rect invalidation.

## Improvement objectives

1. Make scene mutation a first-class production contract rather than a set of per-object map operations.
   - Add explicit batch/replace transactions for full scene syncs, sheet switches, and patch bursts.
   - Preserve exact affected bounds, dirty IDs, z-order invalidation, and request-frame behavior without issuing redundant callbacks for every object during full rebuilds.
   - Make replacement semantics explicit: add-vs-replace, remove-missing, type change, z-index change, visual-only update, geometry update, group change, and clear.

2. Make hit testing deterministic across transforms, object types, and render regions.
   - Replace the single "last rendered region" viewport state with a region-aware transform model that works with freeze panes, split panes, zoom, scroll, DPR, and header offsets.
   - Accumulate Path2D registrations across all regions for a frame instead of clearing them once per region.
   - Make narrow-phase hit paths reflect rotation, flip, connector stroke width, and object-specific geometry where available.
   - Keep spatial-index broad phase document-space and incrementally synchronized from scene mutations.

3. Establish renderer fidelity contracts for every `SceneObjectType`.
   - Each object type must define render behavior, hit behavior, dirty expansion needs, fallback behavior, and bridge readiness behavior.
   - Remove inconsistent double error-boundary behavior and replace console-only failures with a structured render diagnostic hook that still preserves "one broken object does not kill the layer".
   - Make text rendering consistent for textbox and shape content, including rich-text-only payloads, padding, clipping, wrapping, vertical alignment, and text effects.

4. Strengthen bridge contracts and async invalidation.
   - Chart bridge readiness should have an explicit placeholder/error policy instead of silent skip when missing.
   - Diagram async layout fetches should request a frame and mark the relevant object dirty when cached data arrives.
   - Image cache loads should dirty the specific object bounds when possible, not always fall back to a full layer dirty mark.
   - 3D bridge mappers and OOXML conversion helpers should be covered as contract boundary code, not treated as incidental utilities.

5. Keep `@mog/drawing-canvas` workspace-internal but make its public exports intentionally narrow.
   - Preserve `SceneGraph`, `HitMap`, `BridgeRegistry`, `createDrawingLayer`, scene object types, and shape rendering info exports needed by `grid-canvas`.
   - Avoid leaking renderer implementation details into public contracts.
   - Keep `mog` independent from `mog-internal`.

## Production-path contracts and invariants to preserve or strengthen

- Scene object bounds are document-space CSS pixel rectangles. Renderers draw in document coordinates after `DrawingLayer` subtracts region scroll offset.
- Canvas-engine owns per-region clipping, translate-to-region-origin, zoom scaling, and context save/restore around `CanvasLayer.render()`.
- `DrawingLayer.renderMode` remains `per-region`, `canvas` remains `0`, and layer z-index remains below overlay handles but above grid content.
- `SceneGraph.getByZOrder()` returns ascending visual order; hit testing returns the highest z-index hit first.
- Scene object IDs are stable and unique within the active sheet scene. Replacing an ID must dirty old and new affected bounds.
- Group membership remains flat via `groupId`; group bounds are the union of member document-space bounds; hit results propagate `groupId`.
- Dirty hints are document-space. Add/remove/update must dirty every pixel that could show stale drawing content, including old bounds, new bounds, strokes/shadows/effects, and image/diagram async completion.
- `HitMap` broad-phase candidates come from the spatial index and must stay synchronized with scene graph mutations before every hit test.
- Hit-test provider output uses `layerId: "drawing"` and an `ObjectHitResult` target with `objectId`, `groupId`, and object hit region.
- Missing optional bridges may render placeholders, but missing required production bridges must surface deterministically and must not silently hide persisted user objects.
- Renderer failures are isolated to the object being rendered; failures must not poison canvas context state for later objects.
- Public package exports remain stable enough for `grid-canvas` and devtools readers, while renderer internals stay internal.
- E2E verification must use real UI input paths for selecting, moving, resizing, inserting, scrolling, and zooming drawings.

## Concrete implementation plan

1. Document and codify the scene contract.
   - Add an internal contract document or top-level source comment near `scene/types.ts` describing document-space bounds, z-order, group behavior, dirty semantics, render semantics, and hit semantics.
   - Add type-level helpers for object common fields and per-type payloads only where they reduce duplicate update logic; keep the exported discriminated union.
   - Add a central `SceneObjectUpdate` or transaction API that prevents accidental type/data mismatches when updating an object.

2. Replace ad hoc scene mutation with batch-aware mutation primitives.
   - Add `SceneGraph.transaction(fn)` or explicit `replaceAll(objects)`, `applyBatch(ops)`, and `updateObject(id, updater)` APIs.
   - Aggregate affected bounds once per batch and emit a single dirty callback.
   - Track dirty IDs, removed IDs, and full-clear generations separately so `HitMap` can distinguish "remove these objects" from "rebuild index from scratch".
   - Preserve current simple methods (`add`, `remove`, `update`, `clear`) as thin wrappers over the new primitives if they remain exported.
   - Update `grid-canvas` full rebuild and patch application to use the batch API so sheet switch and burst updates trigger one frame request and one dirty hint.

3. Introduce an explicit drawing viewport transform store.
   - Replace `HitMap`'s single `scrollOffset`, `zoom`, and `regionOrigin` fields with a per-frame/per-region transform registry keyed by region ID.
   - Store region screen bounds, document scroll offset, zoom, DPR, and frame number for each rendered region.
   - On hit test, choose the transform whose screen-space bounds contain the pointer, then convert to document coordinates. Fall back deterministically only when no region has been rendered yet.
   - Replace the overlay adapter's current getter trio with `docToScreen(rectOrPoint)` and `screenToDoc(point)` helpers that choose the correct region for freeze panes and split panes.
   - Add tests with at least two regions using different scroll offsets to prove selection and handle placement do not depend on render order.

4. Fix Path2D lifecycle and transform-aware narrow-phase hit testing.
   - Clear hit paths once per frame, not once per region render. Use `FrameContext.frameNumber` or an explicit frame generation passed by `DrawingLayer`.
   - Register document-space hit paths for every visible rendered object type. For simple rectangular objects, register rectangle paths; for shapes, use shape-engine geometry; for connectors, use an expanded stroke path or distance-to-segment narrow phase; for ink, register stroke envelopes or point-to-polyline checks.
   - Apply the same rotation and flip transform used for rendering to registered hit geometry.
   - Keep broad-phase bounds conservative. For rotated/flipped objects, use transformed AABB or dirty expansion so the spatial index never misses a visually painted pixel.
   - Preserve graceful fallback when `OffscreenCanvas` or `Path2D` is unavailable, but make that fallback explicit and covered by tests.

5. Make dirty regions match the pixels renderers can actually touch.
   - Add a shared function to compute conservative visual bounds for each `SceneObject`, including stroke width, arrowheads, rotation, shadows/effects where supported, and async placeholder-to-final-image swaps.
   - Use visual bounds in `SceneGraph` dirty callbacks and `HitMap` spatial index bounds where broad-phase accuracy requires it.
   - Wire `ImageCache` load completion to dirty the affected object bounds instead of only calling `layer.markDirty()` globally. This likely needs source-to-object reverse indexing or a callback that receives the loaded `src`.
   - Wire `DiagramCanvasBridge` async layout completion to invalidate only the diagram object's visual bounds and request a frame.

6. Consolidate renderer execution and diagnostics.
   - Choose one error-boundary layer: either dispatcher-level or `withRenderContext`, not both.
   - Ensure every renderer saves/restores canvas state exactly once around its transforms and internal clipping, with nested saves only where needed.
   - Replace direct `console.warn`/`console.error` render-path diagnostics with an injected diagnostics hook or dev-only reporter that records object ID, type, renderer label, bridge state, and error.
   - Keep object-local placeholder rendering as the user-visible failure behavior.

7. Complete renderer behavior by object type.
   - Picture: register hit body, handle async load invalidation by object bounds, preserve crop/opacity/brightness/contrast, and add tests for crop normalization extremes.
   - Textbox: preserve fill/border/text-effect behavior while adding rich-text-only rendering, padding under small bounds, clipping, and vertical alignment tests.
   - Shape: render text when `richText` is present even if plain `text` is empty, apply transform-aware hit paths, and use shape-engine as the support source of truth.
   - Connector: replace bounding-box hit paths with stroke-aware hit testing, account for arrowheads, and support straight/bent/curved connector variants systematically.
   - Chart: define and test missing bridge behavior; render a visible placeholder or surfaced diagnostic instead of silently skipping persisted charts.
   - Ink: register stroke hit regions, account for pressure/width/opacity, and avoid clipping leakage.
   - Equation: preserve bridge fallback but add hit body registration and clipping for long fallback text.
   - Diagram: request frames when cached computed layouts arrive, invalidate cache on relevant bridge changes, and ensure fallback and computed paths share bounds/hit behavior.
   - OLE object: register hit body, preserve preview/icon behavior, and dirty only affected preview bounds when image loads.

8. Remove duplicated shape support truth.
   - Treat `@mog/shape-engine` preset registry as the authoritative native-rendering source.
   - Replace the hardcoded fallback union in `shape-rendering-info.ts` with generated metadata or an explicitly tested registry adapter.
   - Add a test that every contract `ShapeType` is classified as native or fallback and that native classifications exist in shape-engine.

9. Strengthen bridge and OOXML boundary tests.
   - Add exhaustive table tests for `three-d-bridge.ts` enum mapping against contract literals.
   - Add round-trip and clamping tests for OOXML conversion helpers, including out-of-range crop/opacity inputs if upstream can supply them.
   - Add bridge registry tests for late-binding setters, required bridge behavior, optional placeholder behavior, and render invalidation callbacks.

10. Integrate with `grid-canvas` through contracts, not implementation shortcuts.
   - Update `GridRenderer.applySceneGraphPatches()` and `syncSceneGraph()` to use scene batch APIs and visual-bound dirty hints.
   - Update `OverlayDataAdapter` to depend on transform conversion helpers instead of pulling raw last-rendered hit-map state.
   - Keep scene readers in `grid-canvas` returning contract snapshots so drawing-canvas internals remain private.

## Tests and verification gates

Package-level gates:

- `cd /Users/guangyuyang/Code/mog-all/mog/canvas/drawing-canvas && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog/canvas/drawing-canvas && pnpm typecheck`

Integration gates when `grid-canvas`, `canvas-engine`, or overlay adapters change:

- `cd /Users/guangyuyang/Code/mog-all/mog/canvas/grid-canvas && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog/canvas/grid-canvas && pnpm typecheck`
- `cd /Users/guangyuyang/Code/mog-all/mog/canvas/engine && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog/canvas/engine && pnpm typecheck`
- Repo-level TypeScript gate from `/Users/guangyuyang/Code/mog-all/mog`: `pnpm typecheck`

Focused tests to add or extend:

- `SceneGraph` batch operation tests for create/update/remove/replace/clear bursts, old+new dirty bounds, dirty ID/index synchronization, and z-order stability.
- `DrawingLayer` tests for one Path2D clear per frame across multiple regions, region-aware hit-map transform registration, zoomed culling, and dirty rect clipping.
- `HitMap` tests for multi-region pointer conversion, freeze-pane render order independence, rotated/flipped shape hits, connector stroke hits, invisible objects, group hits, and `Path2D`/`OffscreenCanvas` fallback.
- Renderer tests for each `SceneObjectType` proving render calls, hit registration, state restore, placeholder behavior, and diagnostics.
- Bridge tests for chart readiness, diagram async cache invalidation, image-load dirtying, and 3D enum mapper exhaustiveness.
- `grid-canvas` integration tests proving real `FloatingObjectPatch` bursts update the scene graph once and keep overlay handles aligned after scroll, zoom, and region changes.

UI behavior gates:

- Run the spreadsheet dev server and exercise the actual UI, not direct state mutation.
- Insert or load a sheet containing a picture, textbox, shape, connector, chart, ink stroke, equation, diagram, and OLE object.
- Select each object with the pointer, including overlapping z-order cases.
- Scroll and zoom, then select and drag objects.
- Enable freeze panes or equivalent multi-region layout and verify hit selection plus overlay handles stay aligned in each region.
- Move, resize, rotate, flip, hide, and delete objects; verify stale pixels do not remain.
- Load images/diagrams asynchronously and verify only affected regions repaint.

No verification command was run while writing this plan because this planning task explicitly forbids test/typecheck/build commands.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Multi-region rendering can make "last rendered transform wins" bugs intermittent because render order depends on viewport layout.
- `Path2D` and `OffscreenCanvas` support varies across test environments and older browsers; fallback behavior must be deterministic.
- Rotated objects need conservative dirty and spatial bounds or partial repaint can leave stale pixels.
- Connectors are thin but selectable; bounding-box hit testing over-selects diagonal and elbow connectors.
- Image and diagram async callbacks can fire after disposal or after the object source changed; callbacks need generation/object validation.
- Full scene sync currently calls `clear()` then many `add()` operations; changing this can accidentally drop dirty IDs or over-render if batch semantics are not precise.
- Bridge late-binding can make persisted charts/diagrams invisible until a bridge arrives; invalidation on bridge arrival must request a frame.
- Shape support metadata can drift from shape-engine if duplicated hardcoded lists remain.
- Rich text and text effects can mutate canvas state deeply; save/restore contracts need tests around every renderer.
- Private/internal plan content must not be copied into public docs or source comments.

Non-goals:

- Do not rewrite canvas-engine, spatial indexing, shape-engine, diagram-engine, or kernel floating-object ownership unless a contract change is required for drawing-canvas production behavior.
- Do not introduce test-only rendering paths or benchmark-only optimizations.
- Do not expose drawing renderer internals as public SDK contracts.
- Do not add compatibility shims for stale object formats; align source data at the kernel/contract boundary instead.
- Do not replace the existing Canvas2D rendering architecture with WebGL/Three.js for this folder.

## Parallelization notes and dependencies on other folders, if any

Recommended parallel workstreams:

- Worker A: scene graph and dirty contract.
  - Owns `canvas/drawing-canvas/src/scene`, `factory.ts`, `layer/drawing-layer.ts` dirty callback integration, and package-local scene/dirty tests.
  - Depends on current `DirtyHint` and `DirtyRectAccumulator` contracts from `canvas-engine`.

- Worker B: hit-map and viewport transforms.
  - Owns `canvas/drawing-canvas/src/hit-testing`, `DrawingLayer` hit-map frame/region registration, and `grid-canvas` overlay transform adapter changes.
  - Depends on `canvas-engine` `RenderRegion` semantics and may require narrow helper additions in `canvas-engine` if no region lookup contract exists.

- Worker C: renderer fidelity and hit geometry.
  - Owns type-specific renderers, shared render utilities, object visual bounds, Path2D registration, renderer diagnostics, and renderer tests.
  - Depends on `@mog/drawing-engine`, `@mog/shape-engine`, `@mog/diagram-engine`, and `@mog/spatial` for geometry primitives.

- Worker D: bridge and async invalidation.
  - Owns `bridges`, `image-cache`, chart/diagram/equation/text-effect behavior, 3D mapper tests, and async load/frame invalidation.
  - Depends on `@mog-sdk/contracts`, kernel diagram bridge contracts, and image source ownership from grid/kernel adapters.

- Worker E: production integration and UI verification.
  - Owns `grid-canvas` patch application, scene readers, overlay handle alignment, spreadsheet UI workflows, and E2E coverage through real input.
  - Depends on Workers A and B for stable batch and transform APIs.

Integration order:

1. Land scene batch contracts and tests first; this gives every other stream stable mutation semantics.
2. Land viewport transform store and hit-map frame lifecycle next; renderer hit paths can then target the final coordinate contract.
3. Land renderer hit/dirty improvements by object type in parallel once visual-bound and transform helpers are stable.
4. Land bridge async invalidation and grid-canvas integration after dirty and transform APIs settle.
5. Run package, integration, repo typecheck, and UI behavior gates before claiming production readiness.
