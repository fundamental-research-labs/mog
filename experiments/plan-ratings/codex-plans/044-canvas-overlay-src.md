# 044 - Canvas Overlay Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/canvas/overlay/src`

Scope: the public `@mog/canvas-overlay` source package that renders and hit-tests screen-space canvas chrome for floating-object selection, resize handles, rotation handles, custom handles, connection-point indicators, smart guides, rubber-band selection, drag previews, insertion previews, and ink previews.

Adjacent production dependencies that must be considered:

- `mog/contracts/src/rendering/data-sources.ts` for `OverlayDataSource` and the render-state contracts that feed the overlay.
- `mog/types/rendering/src/render-context.ts` and `mog/types/rendering/src/hit-test.ts` for `FloatingObjectRenderState`, `FloatingObjectOperation`, and `ObjectHitRegion`.
- `mog/canvas/grid-canvas/src/renderer/grid-renderer.ts` for `OverlayDataAdapter`, scene-graph to screen-space projection, dirty marking, and hit-provider registration.
- `mog/canvas/engine/src/core/types.ts` and render-loop dirty handling for the `CanvasLayer` and `HitTestProvider` contracts.
- `mog/apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx` and the object interaction system for real selection, drag, resize, rotate, insertion, and custom-handle states.

This is a public Mog source folder. Implementation work belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`canvas/overlay/src` is the screen-space UX layer for canvas 1. It implements `OverlayLayer`, a `CanvasLayer` with `renderMode = 'once'`, and also implements `HitTestProvider` so resize, rotation, and custom handles win over object-body and grid hit testing.

The package currently has these production responsibilities:

- Convert `OverlayDataSource` selection state into per-object outlines, an axis-aligned multi-selection group outline, resize handles, and a rotation handle.
- Render screen-space auxiliary overlays: connection points, smart guides, rubber-band selection, drag preview, insertion preview, and ink preview.
- Hit-test resize, rotation, and custom handles with expanded CSS-pixel hit areas.
- Keep handles at fixed CSS-pixel sizes regardless of document zoom or device pixel ratio.
- Re-export a small API: `OverlayLayer`, `createOverlayLayer`, `OverlayLayerConfig`, `OverlayConfig`, `HandlePosition`, and `CustomHandle`.

The production caller in `canvas/grid-canvas/src/renderer/grid-renderer.ts` creates `OverlayLayer` after the drawing layer, wires `OverlayDataAdapter` to the drawing scene graph and hit map, registers overlay as the highest-priority hit-test provider, and marks it dirty when floating-object state or scene-graph patches change.

Important current observations:

- The overlay package has a clear screen-space CSS-pixel contract, but render and hit-test paths each re-query the data source and rebuild related geometry separately.
- `OverlayDataAdapter` currently provides selection bounds, object bounds, lock state, rotation, active handle, and insertion preview, but returns empty or null for smart guides, rubber band, drag preview, ink preview, and connection-point indicators.
- The adapter suppresses stable selection chrome when `FloatingObjectRenderState.interactionState === 'operating'`; operation previews need to be fed through explicit preview data, not by forcing selected chrome to remain visible.
- Custom handles are passed as static layer config even though their visibility and positions are object/domain-specific. Render applies the selected object's rotation to custom handles, while current custom-handle hit paths do not carry the parent bounds/rotation.
- Multi-selection render uses lock state when deciding whether group handles are visible, but `hitTestHandles` currently computes group visibility with `isLocked = false`, which can make hidden group handles hittable.
- Drag preview renders axis-aligned dashed bounds and does not include object rotation, group transforms, or resize/rotate operation previews.
- Tests cover many local modules, but most canvas behavior is verified through Node mocks. They do not prove real browser `Path2D`/`DOMMatrix` behavior, visual alignment under DPR, or production adapter behavior from the actual spreadsheet interaction path.

## Improvement objectives

1. Make overlay state a single typed frame snapshot that is built once from production data sources and consumed by both rendering and hit testing.
2. Unify render geometry and hit geometry so every visible handle, guide, preview, and custom control has one source of truth for position, rotation, visibility, priority, and hit area.
3. Complete the production adapter path for selection, drag, resize, rotate, insertion, custom handles, smart guides, connection points, and rubber-band or lasso-style selection where those interactions exist.
4. Replace static custom-handle config with a dynamic, selected-object-aware provider contract that keeps domain logic out of `canvas/overlay` while keeping render and hit behavior consistent.
5. Normalize all overlay rectangles and bounds at the package boundary: finite numbers, non-negative dimensions where the renderer expects rectangles, explicit rotation degrees, and screen-space CSS pixels.
6. Make hit-test results align with Mog's public object interaction types, including group handles and custom handles, so app-side cursor and operation dispatch do not need shape-specific guesswork.
7. Strengthen overlay dirty and repaint contracts for `renderMode = 'once'` layers without confusing document-space dirty rects with screen-space overlay rects.
8. Upgrade verification from mock-call assertions to production-path and browser-canvas coverage for rotated handles, DPR, custom handles, group selection, locked objects, and real UI input.

## Production-path contracts and invariants to preserve or strengthen

- Overlay coordinates remain screen-space CSS pixels after viewport transform. The overlay must not accept document-space bounds without an explicit conversion step.
- Handle visual sizes, hit-area expansion, rotation-handle offset, guide widths, and rubber-band styles remain CSS-pixel values and do not scale with zoom.
- `OverlayLayer` remains canvas 1, `renderMode = 'once'`, and the highest-priority hit-test provider for object handles.
- Rendering must stay synchronous. No overlay render or hit-test path may await bounds, object data, or domain metadata.
- Stable selection chrome is suppressed during active object operations when the object interaction state says it should be suppressed. Drag, resize, rotate, insertion, and custom-operation previews must come from explicit preview state.
- Per-object outlines are drawn for selected objects. Multi-selection also draws an axis-aligned group bounding box and group handles when the group is transformable.
- Group handle semantics must be explicit: if group rotation is supported, render and hit-test a group rotation handle with `isGroup = true`; if unsupported, omit it from both render and hit. Do not render one behavior and hit-test another.
- Locked and non-transformable objects must have identical render and hit visibility. Hidden handles are never hittable.
- Small and tiny object thresholds must apply identically to render descriptors and hit descriptors.
- Custom handles must be tied to a selected object, respect that object's rotation and lock/edit state, render and hit-test the same geometry, and return a target that distinguishes object ID from handle ID.
- Rotation transforms must be mathematically identical for outlines, handle visuals, handle hit areas, custom handles, drag previews, and dirty bounds.
- `ctx.save()` and `ctx.restore()` calls must remain balanced even if a renderer or hit-test setup exits early.
- The overlay must not leak private `mog-internal` dependencies into public code.
- E2E tests for object interaction must use real UI input paths: mouse, keyboard, pointer events, and clipboard where relevant.

## Concrete implementation plan

1. Introduce an overlay frame snapshot.

   - Add `overlay-snapshot.ts` with an `OverlayFrameSnapshot` built from `OverlayDataSource`, dynamic custom-handle providers, and `OverlayConfig`.
   - Resolve selected IDs, per-object bounds, rotations, lock state, group bounds, active handle, insertion preview, drag/resize/rotate preview, guides, rubber band, ink preview, and connection indicators in one read pass.
   - Normalize inputs at this boundary: reject non-finite coordinates, normalize negative insertion/rubber-band dimensions where appropriate, preserve explicit zero-size behavior, and record skipped objects for diagnostics/tests.
   - Let `OverlayLayer.render()` consume the snapshot rather than re-querying the data source throughout rendering.
   - Let `OverlayLayer.hitTest()` build or reuse the same snapshot-building path so hit behavior cannot drift from render behavior.

2. Create shared overlay geometry descriptors.

   - Add a geometry module that produces typed descriptors for selection outlines, group outlines, resize handles, rotation handles, custom handles, connection indicators, guides, rubber bands, drag previews, insertion previews, and ink/lasso overlays.
   - Define `HandleDescriptor` with owner object ID, group flag, optional handle ID, `ObjectHitRegion`, visual geometry, expanded hit geometry, z/priority, visibility reason, and dirty bounds.
   - Use inverse-rotation math for handle and custom-handle hit testing instead of depending on a stashed render context. Handles are simple squares, circles, and diamonds; pure geometry is more reliable than `Path2D` plus the last `CanvasRenderingContext2D`.
   - Keep `Path2D` or canvas path construction for drawing only where useful, but make hit tests independent of browser canvas state.
   - Ensure custom handles receive their parent `ScreenBounds` so render and hit testing apply the same rotation.
   - Encode hit priority in descriptors: custom handles, rotation handle, resize handles, group handles, then lower-priority overlay-only visuals.

3. Tighten public and package-level types.

   - Align `HandleRegion` with `ObjectHitRegion` from public rendering/object types instead of maintaining a divergent local union.
   - Replace `OverlayHitResult` with a target shape that can represent `{ type: 'floatingObjectHandle', objectId, region, isGroup, handleId? }` or map directly to the existing floating-object hit contract where possible.
   - Distinguish `objectId` from `handleId` for custom handles. A custom WordArt warp handle should not report the handle instance ID as though it were the object ID.
   - Promote dynamic custom handles into the data-source or a sibling provider interface, such as `getCustomHandles(selectionSnapshot)`, instead of static `OverlayLayerConfig.customHandles`.
   - Keep domain-specific handle generation out of the overlay package; text effects, diagrams, connectors, and other domains should provide descriptors through the provider contract.

4. Complete the production adapter path.

   - Extend `OverlayDataSource` or add a focused `OverlayInteractionDataSource` so `OverlayDataAdapter` can expose operation preview data from `FloatingObjectRenderState.operation`.
   - Update the spreadsheet object interaction snapshot to pass operation details to the renderer, not `operation: null`.
   - Derive drag previews from the actual operation state and scene-graph bounds, including selected object IDs, deltas, rotations, group bounds, resize bounds, and rotation previews.
   - Feed active handle state into overlay styling and descriptor visibility.
   - Add real adapter implementations for smart guides, rubber-band selection, and connection-point indicators when the object system has those states; otherwise keep methods explicitly documented as unsupported for that interaction, not silently null because the adapter is incomplete.
   - Keep the scene graph and hit map as the synchronous source for overlay object bounds; do not reintroduce async `computeObjectBounds()` in the render path.

5. Refactor rendering around descriptors.

   - Replace the long render method's per-feature data-source calls with a declarative compositing pipeline over snapshot sections.
   - Preserve the current front-to-back order: object outlines, group outline, handles, custom handles, connection points, smart guides, rubber band, drag/operation preview, insertion preview, and ink preview.
   - Add active/hover/disabled styling hooks without changing default visuals. The active handle should be visually distinguishable during resize, rotate, or custom-handle adjustment.
   - Render rotated drag previews and resize previews with the same transform helpers used by selection outlines.
   - Add a small canvas-state helper that wraps `save`/`restore` in `try/finally` for complex sections and resets line dash, alpha, stroke, and fill state locally.
   - Normalize crisp one-pixel guide and outline strokes for screen-space canvas rendering under DPR without changing the CSS-pixel coordinate contract.

6. Make hit testing deterministic and production-shaped.

   - Remove the dependency on `_lastCtx` for handle hit testing once pure geometry hit tests exist.
   - Use descriptor priority to make overlapping handles deterministic.
   - Apply the same visibility checks for render and hit testing, including locked objects, all-locked groups, small objects, tiny objects, edit-mode suppression, and operation-mode suppression.
   - Return group handles as group targets with `objectId: null` or an explicit group target only if downstream object coordination can consume that shape consistently.
   - Add hit tests for rotated custom handles, rotated resize handles, group handles with all locked objects, tiny objects with active selection, and overlapping custom/resize handles.

7. Fix screen-space dirty behavior.

   - Define the correct dirty contract for overlay snapshots: old descriptor dirty bounds plus new descriptor dirty bounds, inflated by stroke width and hit/visual handle radius where repaint needs it.
   - If `canvas-engine` dirty hints remain document-space only, add a coordinate-space tagged dirty hint or a `screenRect` hint for `renderMode = 'once'` layers before doing partial overlay repaint.
   - Until that engine contract exists, keep overlay full-dirty behavior explicit and correct rather than passing misleading document-space rects for screen-space chrome.
   - Once engine support exists, have `OverlayLayer` retain the previous snapshot's dirty envelope and mark only changed overlay regions for selection moves, handle hover, guide changes, and insertion previews.

8. Expand local unit and browser-canvas coverage.

   - Add pure geometry tests for rotated points, inverse-rotation hit tests, handle descriptors, custom handles, group bounds, dirty envelopes, and negative/zero-size rect normalization.
   - Update existing overlay Jest tests to assert descriptor outputs and render outcomes instead of only checking loose call counts.
   - Add browser-backed tests for real `CanvasRenderingContext2D`, `Path2D`, `DOMMatrix` if still used for drawing, DPR transform handling, and pixel-level smoke checks for nonblank overlay regions.
   - Add adapter tests in `canvas/grid-canvas` proving `OverlayDataAdapter` converts scene-graph document bounds to screen bounds, suppresses stable chrome during operations, exposes operation previews, and keeps render/hit visibility identical.

9. Add spreadsheet production-path coverage.

   - Exercise object selection, drag, resize, rotate, multi-select, locked objects, small objects, text-effect warp handles, insertion preview, connection points, and sheet switching through the spreadsheet UI.
   - Use real mouse and keyboard paths in E2E tests. Do not mutate object interaction state directly to create a green test.
   - Assert both behavior and visual surface: cursor/target routing, emitted operation target, preview position, handle visibility, and overlay canvas pixels.

10. Update package documentation and exports.

    - Document the final overlay coordinate contract, snapshot contract, render order, hit priority, and adapter responsibilities in the package README or module docs.
    - Export only the public types that downstream packages genuinely need. Keep descriptor internals private unless another public package needs them for a typed provider.
    - Remove comments that contradict behavior, such as multi-select "no rotation" if group rotation remains supported.

## Tests and verification gates

Focused tests to add or strengthen during implementation:

- `canvas/overlay/src/__tests__/handle-positions.test.ts` for descriptor-backed visibility and threshold behavior.
- `canvas/overlay/src/__tests__/handle-hit-testing.test.ts` for pure geometry hit tests, rotated handles, locked groups, custom-handle priority, and no `_lastCtx` dependency.
- `canvas/overlay/src/__tests__/overlay-layer.test.ts` for snapshot-driven render order, active handle styling, group target semantics, and state suppression during operations.
- New `canvas/overlay/src/__tests__/overlay-snapshot.test.ts` for data-source normalization, skipped invalid bounds, group bounds, and operation preview snapshots.
- New `canvas/overlay/src/__tests__/custom-handles.test.ts` for parent rotation, object ID versus handle ID, and domain-provided handles.
- `canvas/grid-canvas/src/renderer/__tests__` coverage for `OverlayDataAdapter` production projection from scene graph and hit map.
- Spreadsheet object-system tests for state snapshots carrying operation previews into render context.
- Browser or Playwright coverage for actual canvas rendering and hit behavior under DPR and rotation.

Verification gates for the implementation workstream:

- `cd canvas/overlay && pnpm test`
- `cd canvas/overlay && pnpm typecheck`
- `cd canvas/grid-canvas && pnpm test`
- `cd canvas/grid-canvas && pnpm typecheck`
- `cd apps/spreadsheet && pnpm test` for object interaction/render-context paths changed by the adapter work.
- `cd apps/spreadsheet && pnpm typecheck`
- Root `pnpm typecheck` after any `contracts`, `types`, or cross-package public type changes.
- Run the spreadsheet dev server and exercise object selection, drag, resize, rotate, multi-select, locked object, insertion preview, and custom-handle workflows in a browser.

Any performance measurement must target the production overlay path registered through `GridRendererImpl`, not isolated mock renderers. Useful metrics are overlay frame time, descriptor build time, hit-test time, dirty region size, and repaint count during drag/resize/rotate.

## Risks, edge cases, and non-goals

Risks:

- Changing hit-test result shape can break object cursor management or operation dispatch if downstream types are not migrated together.
- Replacing `Path2D` hit testing with pure geometry may shift exact hit boundaries. Fixture tests should define the intended CSS-pixel hit envelope before the migration.
- Group rotation semantics need an explicit product decision. The implementation must not leave render and hit testing out of sync.
- Feeding operation previews from the object system can expose stale state if renderer callbacks are not updated in the same frame as scene-graph patches.
- Partial overlay dirtying can be wrong if screen-space and document-space dirty rects are mixed. Engine support must be explicit before partial repaint is enabled.
- Custom-handle providers can accidentally import domain logic into `canvas/overlay`; provider contracts should point outward, not inward.

Edge cases to cover:

- Rotated objects at 0, 45, 90, 180, 270, and negative angles.
- Objects with negative screen coordinates, zero width/height, tiny dimensions, and dimensions exactly at threshold boundaries.
- High zoom, low zoom, high DPR, and fractional scroll positions.
- Multi-selection with mixed locked/unlocked objects, all locked objects, missing bounds for one selected object, and objects with different rotations.
- Overlapping custom handles, resize handles, and rotation handles.
- Dragging while stable chrome is suppressed, including cancel and complete operation paths.
- Insertion previews drawn from top-left to bottom-right and reverse drag directions.
- Frozen panes and sheet switches where scene-graph bounds, hit-map transform, and overlay selection state update in different orders.
- Connection-point indicators with duplicate point coordinates and a snap target equal to one of the points.
- Ink preview strokes with pressure, empty strokes, lasso paths with fewer than two points, and eraser radius changes.

Non-goals:

- Do not move drawing-layer object rendering into `canvas/overlay`.
- Do not make overlay render by awaiting object bounds or object data.
- Do not optimize mock-only code paths or benchmark harnesses as the primary outcome.
- Do not add private `mog-internal` imports to public Mog packages.
- Do not preserve old behavior behind compatibility shims if the old behavior is render/hit inconsistency.
- Do not bypass real UI input paths in E2E tests by directly mutating object machine state.

## Parallelization notes and dependencies on other folders, if any

This work can be split cleanly after the snapshot and descriptor contracts are agreed.

- Agent A: define overlay snapshot, descriptor, hit-target, and custom-handle provider contracts in `canvas/overlay`, `contracts`, and `types`.
- Agent B: implement pure geometry, descriptor generation, render refactor, and overlay package tests.
- Agent C: update `OverlayDataAdapter` and `GridRendererImpl` to feed complete production operation previews, guides, and custom handles from scene graph and object interaction state.
- Agent D: update spreadsheet object interaction/render-context plumbing so operation snapshots are available to the renderer and E2E tests use real UI input.
- Agent E: implement browser-canvas visual/hit verification and final cross-package type/test gates.

Dependency order:

1. Contract tests for current render/hit mismatches and operation preview gaps.
2. Snapshot and descriptor contracts.
3. Geometry and hit-test refactor inside `canvas/overlay`.
4. Production adapter and spreadsheet render-context updates.
5. Dirty contract changes, after any required `canvas-engine` screen-space dirty support.
6. Browser and E2E verification.

Cross-folder dependencies must preserve direction: public `mog` packages may depend on public contracts/types and sibling public canvas packages, but must not depend on `mog-internal`. Internal planning stays in `mog-internal` only.
