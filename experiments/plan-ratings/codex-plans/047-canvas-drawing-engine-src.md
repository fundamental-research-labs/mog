# 047 - Canvas Drawing Engine Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/canvas/drawing/engine/src`

Package: `@mog/drawing-engine` in the public `mog` repo.

This plan covers the TypeScript source files under `canvas/drawing/engine/src`:

- `anchor/`: row/column anchor types, anchor-to-pixel resolution, resize-with-cells behavior.
- `z-order/`: floating object stacking operations and normalization.
- `grouping/`: nested group hierarchy, group operations, selection target resolution, group bounds.
- `spatial/`: broad/narrow hit testing, rectangular selection, proximity, overlap, selection state.
- `layout/`: snap-to-grid, snap-to-objects, align, distribute.
- `renderer/`: Canvas2D and SVG rendering orchestrators, fill/stroke/path primitives, narrow-phase hit testing, 2D/3D effect renderers.
- `diagnostics/`: z-order/group/anchor validation and text summaries.
- `index.ts`: package-level API surface.

Out of scope for this plan: implementation in this worker, edits to production code, generated `dist/`, package metadata, lockfiles, fixtures, or tests. The implementation work described here belongs in the public `mog` repo; this Markdown file remains private planning material in `mog-internal`.

## Current role of this folder in Mog

`@mog/drawing-engine` is a workspace-internal hardware package for sheet floating-object composition and universal `DrawingObject` rendering. The package is marked private and bundle-only, depends on `@mog/geometry`, `@mog/canvas-engine`, and `@mog-sdk/contracts`, and exports the root API plus Canvas/SVG/hit-test subpaths.

The folder is currently the shared sink for several production paths:

- `kernel/src/domain/drawing/spatial-operations.ts` delegates z-order, grouping, hit-test, anchor, snap, align, and distribute helpers to this package.
- `canvas/drawing-canvas/src/renderers/shape.ts` converts scene shapes through `@mog/shape-engine`, then delegates geometry rendering to `renderDrawingObjectToCanvas()` and `pathToPath2D()`.
- `canvas/drawing/ink`, `canvas/drawing/diagram`, and `canvas/drawing/text-effects` produce `DrawingObject` values that are rendered through `@mog/drawing-engine`.
- Spreadsheet UI code and kernel shape tests import `renderDrawingObjectToSVG()` for visible output and preview paths.

The source is split into small pure helpers, but the package-level comment says "Pure computation: no DOM, no Canvas, no React, no Yjs" while the renderer subtree deliberately depends on Canvas2D APIs and `renderer/effects/canvas.ts` lazily touches `document` to register SVG filters for Canvas 3D effects. The package therefore needs a clearer boundary: composition math should stay fully deterministic and host-agnostic; renderers should declare their Canvas/SVG/environment contracts explicitly.

The current test footprint is broad for a recently imported package: 20 test files cover z-order, grouping, anchors, layout, selection, spatial queries, path/fill/stroke primitives, Canvas/SVG render orchestrators, effects, and shape-engine integration. The missing layer is not raw unit count; it is a single production scene contract tying z-order, group hierarchy, anchors, object bounds, hit-test priority, and renderer output together.

## Improvement objectives

1. Define a canonical drawing scene composition contract.

   Introduce a source-level scene model in `@mog/drawing-engine` that represents the minimum data needed to compose floating drawing objects: ID, resolved bounds, z-order, visibility, lock state if needed by selection/layout, anchor, optional `DrawingObject`, and group membership. Today each subsystem accepts slightly different shapes (`ZOrderedItem`, `SpatialObject`, `GroupHierarchy`, `SelectionState`, raw `BoundingBox[]`), which makes it possible for callers to maintain mutually inconsistent state. The engine should expose one validated composition model plus adapters for domain-specific operations.

2. Make z-order deterministic for every production path.

   The engine should own the rule that visual order, hit-test order, SVG order, Canvas draw order, and group operation order all resolve ties the same way. Current helpers normalize z-order locally, but direct sorts in `spatial-query.ts`, diagnostics, and adjacent `drawing-canvas` scene graph code rely on plain numeric sort behavior and do not share a tie-breaker contract. Add a canonical stable ordering function and make all operations use it.

3. Strengthen grouping as a real hierarchy, not a partial metadata convention.

   `GroupHierarchy` supports nested groups, but adjacent `drawing-canvas` scene storage is flat `groupId` metadata. The engine should own group creation, ungrouping, reparenting, dissolving invalid groups, recursive bounds, recursive z-order behavior, and selection target resolution as a coherent hierarchy contract. Callers should not have to infer whether a group ID is a scene object, metadata, or both.

4. Make anchors and layout functions spreadsheet-scale and schema-explicit.

   `positionToAnchor()` currently binary-searches hardcoded Excel limits of 16,384 columns and 1,048,576 rows. That matches XLSX sheet bounds but hides an important workbook contract inside the drawing engine. Define sheet extent inputs on `CellDimensionLookup` or a companion options object, validate offsets/dimensions, and make edge behavior explicit for negative coordinates, zero-size objects, hidden/zero-sized rows and columns, and anchors whose `from` and `to` are reversed.

5. Unify render, hit-test, and bounds semantics.

   Rendering applies transforms, clips, fills, strokes, effects, 3D shape properties, and recursive children. Narrow hit testing builds transformed paths and recurses into children, but it does not share a render-plan abstraction with the renderers. SVG viewBox computation uses only the root geometry bounds, not transformed children, strokes, shadows, glow, bevel, extrusion, or clipping. Add a render plan/bounds pipeline so Canvas, SVG, hit testing, and diagnostics interpret `DrawingObject` the same way.

6. Replace documented approximations with explicit support contracts.

   Current renderer comments mark pattern fills as simplified, image fills as skipped, compound strokes as approximated, text rendering as deferred, Canvas reflection as not implemented, and SVG bevel as simplified. These should become first-class support statuses with diagnostics and test fixtures, not informal comments. For each `DrawingFill`, `DrawingStroke`, `DrawingEffects`, `scene3d`, and `sp3d` property in the `DrawingObject` contract, the engine should either render it, expose a diagnostic issue, or declare it unsupported in a typed capability report.

7. Make diagnostics machine-readable and production-actionable.

   Current diagnostics return string summaries and generic issue codes. Expand diagnostics so production callers can validate an entire scene before render, export, or persistence: duplicate IDs, duplicate or non-contiguous z-order, invalid bounds, non-finite numbers, invalid group hierarchy, missing group members, missing anchors, unsupported render features, and hit-test/render bounds mismatches. Diagnostics should include object IDs, paths, severity, and remediation hints.

## Production-path contracts and invariants to preserve or strengthen

- Dependency direction remains `contracts/types -> geometry/canvas hardware -> kernel -> apps`. `@mog/drawing-engine` must not depend on `kernel`, `apps`, `mog-internal`, React, Yjs, or spreadsheet UI state.
- Composition helpers remain deterministic pure functions. Given the same scene data, they return the same operation result without reading global app state.
- Renderer modules may use Canvas2D/SVG/DOM facilities, but those dependencies must be explicit and injectable where host support varies.
- All exported operations preserve object IDs. No operation silently drops an object except explicit remove/ungroup semantics that return structured information about what changed.
- Z-order is a total order per sheet/layer: no duplicate visual rank after normalization, stable tie-breaking before normalization, and consistent topmost resolution for rendering and hit testing.
- Group hierarchy is acyclic. Every child has at most one parent. Every `parentOf` entry points to an existing group. Every group child list and parent map entry agree. Groups with fewer than two effective children are either rejected or dissolved by a documented operation.
- Group bounds are derived from current member bounds unless explicitly cached with invalidation metadata. Stale group bounds should be diagnosable.
- Selection state cannot select both a parent group and its descendants unless the operation explicitly represents drill-in selection.
- Anchor resolution is sheet-extent-aware and handles hidden/zero-size rows and columns consistently with spreadsheet layout.
- Layout operations preserve width/height unless the operation is explicitly resize-oriented. Align/distribute/snap never mutate input objects.
- Spatial hit testing uses the same z-order, visibility, transforms, strokes, and group selection rules as the rendered scene.
- Render output is state-isolated: every Canvas operation balances save/restore and does not leak alpha, dash, filter, transform, clip, composite mode, line cap/join, or shadow state.
- SVG output is valid XML, uses deterministic ID generation, escapes dynamic attribute values, and does not collide when multiple rendered SVG fragments are embedded in one document.
- Bounds used for SVG viewBox, hit-test broad phase, dirty rectangles, and diagnostics include the same geometry inflation rules for transforms, stroke width, and effects.
- Unsupported or intentionally approximate features are not silent in production validation.

## Concrete implementation plan

### 1. Add a scene composition model and operation result layer

Create a new `src/scene/` subsystem with:

- `DrawingSceneItem`: the canonical composition record with `id`, `bounds`, `zIndex`, `visible`, optional `locked`, optional `anchor`, optional `drawingObject`, and optional group metadata.
- `DrawingScene`: immutable arrays/maps for items, group hierarchy, and selection state.
- `DrawingSceneOperationResult`: `{ scene, changedIds, affectedBounds, diagnostics }`.
- `createDrawingScene()`, `validateDrawingScene()`, `normalizeDrawingScene()`, and read-only query helpers.

Use this model as the integration layer while keeping narrow helpers in `z-order`, `grouping`, `spatial`, `layout`, and `anchor`. The new layer should compose existing helpers rather than duplicating their math, but it should be the public path for callers that need whole-scene invariants.

Do not introduce compatibility shims that preserve inconsistent state. Move callers toward the canonical scene contract, and let TypeScript force updates where the old shape was underspecified.

### 2. Centralize stable ordering

Replace ad hoc `sort((a, b) => a.zIndex - b.zIndex)` usage inside this package with one ordering module:

- `compareZOrder(a, b, options)`.
- `sortBackToFront(items)`.
- `sortFrontToBack(items)`.
- `normalizeZOrder(items, tieBreaker)`.

Tie-breaker policy should be documented and test-covered. Prefer a deterministic insertion/order key supplied by the scene model; fall back to original array index only inside pure helper calls where no durable key exists.

Extend z-order operations for production cases:

- Batch bring forward/backward for multi-selection while preserving relative order.
- Move an entire group as one visual unit.
- Insert at front/back relative to siblings or whole sheet.
- Validate duplicate IDs and duplicate z-indices in one pass.
- Return unchanged object identities only when no semantic change occurred, and otherwise return fresh changed records.

Update diagnostics and spatial queries to use the same ordering helpers.

### 3. Make grouping hierarchical and operation-safe

Rework `grouping/group-manager.ts` around explicit structural operations:

- `createGroup()` validates no duplicate group ID from the generator, validates every requested member exists in the scene when scene data is available, and rejects grouping an ancestor with its descendant.
- `ungroup()` returns the removed group, promoted children, affected ancestors, and affected bounds.
- `reparentMembers()` handles moving children between groups and top-level scene.
- `dissolveInvalidGroups()` recursively removes empty/single-child groups according to a documented rule.
- `getGroupMembers()` exposes both leaf-only and direct-child modes.
- `computeGroupBounds()` accepts hierarchy + object bounds and recursively computes nested group bounds.
- `resolveSelectionTarget()` supports single-click group selection, double-click drill-in, modifier selection, and locked/hidden object behavior through typed options.

Add a single validation function that checks cycles, orphans, inconsistent child links, duplicate children across groups, stale group bounds, and invalid parent chains. Current validation checks the basics but does not prove that all scene objects referenced by groups exist, nor that the same child is absent from every other group.

Coordinate with `canvas/drawing-canvas/src/scene/types.ts` and `scene-graph.ts`: either adopt the engine hierarchy directly or provide an adapter that derives scene graph `groupId` only as a cached projection. The source of truth should be the engine hierarchy.

### 4. Make anchors explicit about sheet dimensions and edge behavior

Change `CellDimensionLookup` or add `AnchorResolutionOptions` so `positionToAnchor()` does not hardcode sheet limits. Required data:

- `maxRows` and `maxCols`.
- Optional policy for out-of-range positions: clamp, reject, or allow overflow.
- Optional hidden-row/hidden-column behavior if `getRowHeight()` or `getColWidth()` returns zero.

Add validation helpers:

- `validateAnchor(anchor, dimsOrOptions)`.
- `normalizeAnchor(anchor, options)`.
- `anchorToBounds(anchor, dims, options)` as the canonical name behind `resolveAnchor()`.
- `boundsToAnchor(bounds, dims, options)` with explicit target type (`absolute`, `oneCell`, `twoCell`).

Preserve two-cell reversed-anchor handling where `from` and `to` resolve in either order, but surface diagnostics when width/height are zero or negative before normalization. Round-trip tests should cover positions on cell boundaries, negative inputs, final row/column boundaries, hidden dimensions, fractional offsets, and large sheet coordinates.

### 5. Upgrade layout operations from point helpers to scene-aware layout

Keep `alignObjects()`, `distributeObjects()`, and `snapToObjects()` as small math functions, but add scene-level layout operations that understand selection, groups, locks, visibility, and anchors:

- `alignSelection(scene, selection, alignType, reference)`.
- `distributeSelection(scene, selection, distributeType, spacingPolicy)`.
- `snapMove(scene, movingIds, delta, snapOptions)`.

Strengthen contracts:

- `snapToObjects()` should define deterministic tie-breaking when multiple alignments are at equal distance.
- Snap guides should identify source object/edge and target object/edge, not only axis/position/type.
- Distribution should define behavior when total object span is smaller than total object size. Overlapping distribution can be valid, but it must be intentional and covered.
- Alignment/distribution should operate on group bounds for grouped selections, then apply deltas to descendants.

### 6. Introduce a render plan shared by Canvas, SVG, hit testing, and bounds

Add `src/renderer/render-plan.ts` with a normalized tree representation:

- Resolved local and world transforms.
- Effective clip path.
- Geometry path and inflated visual bounds.
- Fill/stroke/effects support status.
- Child order and inherited transform context.
- Deterministic IDs for SVG defs/filters/clips.

Canvas renderer, SVG renderer, `buildHitTestPath()`, `isPointInDrawingObject()`, `computePathBounds()`, and diagnostics should consume this plan or a shared lower-level transform/bounds utility. This avoids drift where Canvas renders children under one transform model while hit testing or SVG bounds see another.

Specific renderer fixes to plan into the render-plan work:

- SVG viewBox should include transformed child bounds, stroke inflation, and effect inflation, not only root geometry bounds.
- SVG `compositeEffectsToSVGFilter()` should receive `scene3d`/`sp3d` from `DrawingObject`; current `renderDrawingObjectToSVG()` only passes `node.effects`, so 3D filter support is present but not wired through the orchestrator.
- Canvas `renderDrawingObjectToCanvas()` should make `document`-dependent filter registration injectable for browser, worker, test, and server-render contexts.
- Hit testing should use the same transform tree and child order as rendering, including strokes, clips, visibility, and group ordering.
- Path bounds should either use a tight curve-bound implementation from `@mog/geometry` or explicitly expose conservative bounds. Do not silently use control-point bounds where tight visual bounds are required for dirty rectangles or SVG viewBox.

### 7. Complete fill, stroke, and effect support systematically

Build a support matrix directly against `types/objects/src/objects/drawing-object.ts`:

- `DrawingFill`: solid, linear-gradient, radial-gradient, pattern, image, none.
- `DrawingStroke`: opacity, dash, cap, join, compound line styles.
- `DrawingEffects`: outerShadow, innerShadow, glow, softEdge, reflection, bevel, transform3D.
- `DrawingObject`: `scene3d`, `sp3d`, `text`, `transform`, `clip`, `children`.

For each field, define Canvas status, SVG status, hit-test impact, bounds impact, and diagnostics. Then implement the complete category rather than leaving comments:

- Pattern fills should render from a deterministic tile definition or produce a warning diagnostic with a named unsupported code.
- Image fills should have an explicit image resolver interface for Canvas and SVG, including stretch/tile/crop semantics.
- Compound strokes should render true double/triple/thick-thin paths or be diagnosed as approximate with a support flag visible to callers.
- Reflection should be implemented for Canvas and SVG or reported consistently as unsupported.
- Text inside `DrawingObject.text` should route to the drawing text layout/rendering path, not remain a renderer comment. Coordinate with `canvas/drawing-canvas/src/renderers/rich-text.ts` and any text-effects/textbox ownership before implementation.

### 8. Make diagnostics complete and suitable for CI/evals

Add a whole-scene diagnostic API:

```ts
validateDrawingScene(scene, options): DrawingDiagnosticReport
```

The report should include:

- Typed issue codes and severities.
- Object/group/anchor/render-path locations.
- Summary counts by subsystem.
- Whether the scene is safe to render, safe to export, and safe to persist.
- Optional fix suggestions that point to engine operations, not prose-only advice.

Expand current validators:

- `validateZOrder()` should distinguish duplicate IDs, duplicate z-index, gaps, non-finite z-index, and non-integer z-index.
- `validateGroups()` should verify scene-object existence, duplicate child membership, stale bounds, and groups referenced by selection.
- Anchor diagnostics should include sheet extent and cell dimension lookups used for resolution.
- Renderer diagnostics should detect unsupported fill/stroke/effect/text properties before a render call.

Keep the existing human-readable summary as a reporter layered on the structured report.

### 9. Update package exports deliberately

After implementing the new source modules, revise `src/index.ts` so the root export presents a coherent API:

- Scene model and validation first.
- Operation groups for z-order, grouping, anchors, layout, spatial, selection.
- Renderer entrypoints and support diagnostics.
- Low-level primitives under documented "advanced consumer" exports.

If subpath exports need to grow beyond `./canvas`, `./svg`, and `./hit-test`, add intentional subpaths such as `./scene`, `./diagnostics`, and `./render-plan` in the package manifest in a separate implementation step. Do not rely on deep source imports from consumers.

## Tests and verification gates

Required test additions for the implementation:

- Unit tests for the new scene model: construction, normalization, duplicate ID rejection, z-order total ordering, unchanged-result identity behavior, and affected-bounds reporting.
- Z-order tests for duplicate z-index tie-breaking, multi-select moves, group moves, insert/remove at boundaries, negative/non-integer/non-finite z-index diagnostics, and stable render/hit-test order.
- Group hierarchy tests for recursive grouping, ancestor/descendant rejection, ungroup promotion, duplicate child detection, missing object references, stale bounds detection, selecting parent vs drilling into child, and integration with scene layout.
- Anchor tests for configurable sheet extents, boundary cells, zero-sized rows/columns, negative positions, reversed anchors, fractional offsets, and bounds-to-anchor-to-bounds round trips.
- Layout tests for grouped selections, locked/hidden items, equal snap-distance tie-breaking, snap guide source/target metadata, overlapping distribution, custom references, and unchanged inputs.
- Render-plan tests for nested transforms, clips, child order, SVG ID determinism, bounds including children/strokes/effects, and parity between Canvas/SVG/hit-test traversal.
- Renderer support-matrix tests that exercise every `DrawingFill`, `DrawingStroke`, `DrawingEffects`, `scene3d`, `sp3d`, `text`, `clip`, and `children` field.
- Integration tests from shape/ink/diagram/text-effects output into `renderDrawingObjectToSVG()` and `renderDrawingObjectToCanvas()` through the new render plan.
- Production path tests in `canvas/drawing-canvas` that use real scene graph rendering and hit-map registration, not direct state mutation shortcuts for the behavior under test.
- Kernel wrapper tests for `kernel/src/domain/drawing/spatial-operations.ts` after API updates.

Required verification gates once implementation exists:

- `pnpm --filter '@mog/drawing-engine' test`
- `pnpm --filter '@mog/drawing-engine' run check-types`
- `pnpm --filter '@mog/drawing-canvas' test`
- `pnpm --filter '@mog/drawing-canvas' run check-types`
- `pnpm --filter '@mog/shape-engine' test`
- `pnpm --filter '@mog/ink-engine' test`
- `pnpm --filter '@mog/diagram-engine' test`
- `pnpm --filter '@mog/text-effects-engine' test`
- Relevant kernel drawing/spatial tests, including `kernel/src/domain/drawing/spatial-operations.ts` wrappers.
- Repo-level `pnpm typecheck` for TypeScript contract changes unless the implementation work is explicitly constrained to a narrower type gate.
- UI/browser verification in the spreadsheet or drawing lab for selection, grouping, z-order, snapping, and rendered output. This should use actual mouse/keyboard input paths for E2E coverage, not direct scene mutation.

## Risks, edge cases, and non-goals

Risks:

- Scene model adoption touches multiple packages (`@mog/drawing-engine`, `@mog/drawing-canvas`, `kernel`, and drawing producers). Use parallel implementation slices, but integrate through one canonical engine contract.
- Tightening z-order/group invariants may expose existing callers that rely on duplicate z-index or flat group metadata. Treat those as state bugs to fix at the source rather than preserving ambiguous behavior.
- Renderer parity can expand quickly because `DrawingObject` includes fills, strokes, effects, 3D, text, transforms, clips, and children. The support matrix keeps this bounded and prevents one-off fixes.
- Canvas filter code currently assumes `document` exists. Moving to an injected filter host must be done carefully so browser rendering remains fast and tests/workers do not crash.
- Bounds inflation for shadows, glow, soft edge, stroke, and extrusion can affect dirty rectangles and SVG viewBox size. The plan should prefer correctness over cropped output, then optimize if real production profiling shows a problem.

Edge cases to keep explicit:

- Empty scenes, single-object scenes, and objects without `DrawingObject` geometry.
- Duplicate IDs across objects and groups.
- Equal z-indices and insertion order after load/import.
- Hidden or locked objects in selection, hit testing, and layout.
- Nested groups with transforms and clipped children.
- Group members with mixed anchor types.
- Zero width/height paths, vertical/horizontal lines, and point paths.
- Non-finite numbers in bounds, transforms, anchors, z-index, effect sizes, and gradient stops.
- SVG ID collisions when multiple rendered SVGs are concatenated.
- Canvas state leakage after errors inside renderer primitives.
- Browser environments without `OffscreenCanvas`, `Path2D.addPath()` transform support, or DOM access for SVG filter registration.

Non-goals:

- Do not move `@mog/drawing-engine` into `kernel` or make it depend on app state.
- Do not optimize test-only render paths or benchmark harnesses.
- Do not introduce compatibility shims that allow invalid group/z-order/anchor state to survive indefinitely.
- Do not replace specialized shape, ink, diagram, text-effects, or rich-text engines with drawing-engine-local copies.
- Do not treat string diagnostics as the primary contract; structured diagnostics should be the production API.
- Do not update generated `dist/` without the corresponding source/build workflow in the implementation phase.

## Parallelization notes and dependencies on other folders, if any

The work is naturally parallelizable after the scene contract is specified. Suggested decomposition:

- Agent A: scene model, z-order total ordering, diagnostics scaffolding in `canvas/drawing/engine/src`.
- Agent B: group hierarchy operations and adapter plan for `canvas/drawing-canvas/src/scene`.
- Agent C: anchor extent/options work and layout scene operations.
- Agent D: render plan, bounds model, Canvas/SVG/hit-test parity.
- Agent E: fill/stroke/effect/text support matrix and renderer diagnostics.
- Agent F: production integration tests across drawing-engine, drawing-canvas, kernel wrappers, and drawing producers.

Integration dependencies:

- `types/objects/src/objects/drawing-object.ts` remains the canonical `DrawingObject` schema. Any schema expansion must happen there first, then flow through `contracts/src/drawing/index.ts`.
- `@mog/geometry` should own reusable tight path bounds, transform, matrix, and path offset helpers. Do not rebuild geometry math locally if the geometry package already owns it.
- `@mog/canvas-engine` owns Canvas layer scheduling, renderer infrastructure, and color utilities. Drawing-engine should not take over layer lifecycle.
- `@mog/spatial` and `canvas/drawing-canvas/src/hit-testing/hit-map.ts` already own indexed hit-test infrastructure for the live canvas layer. Drawing-engine should provide canonical object semantics and narrow-phase geometry, while drawing-canvas keeps the incremental index lifecycle.
- `kernel/src/domain/drawing/spatial-operations.ts` is the public bridge for kernel callers and must be updated once root exports change.
- Shape, ink, diagram, and text-effects packages should stay producers of `DrawingObject`; the engine should validate/render their outputs and feed failures back through shared diagnostics.

The first implementation milestone should be the written scene/render contracts and support matrix, followed by small vertical slices that prove the contract through one object type, one grouped scene, one anchored scene, and one rendered/hit-tested scene. After that, parallel agents can fill out the complete operation and support matrix without diverging on semantics.
