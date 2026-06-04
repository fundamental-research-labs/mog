# 046 — Improve `mog/canvas/drawing-canvas/src` (drawing-layer scene, renderers, and hit-testing)

## Source folder and scope

- **Folder:** `mog/canvas/drawing-canvas/src`
- **Size:** ~5,270 lines of `.ts` across 25 files. Top files: `shape-rendering-info.ts` (765), `bridges/diagram-canvas-bridge.ts` (450), `bridges/three-d-bridge.ts` (426), `renderers/rich-text.ts` (368), `hit-testing/hit-map.ts` (347), `renderers/render-utils.ts` (310), `renderers/connector.ts` (280), `scene/types.ts` (253).
- **In scope (edit targets):**
  - **Scene state:** `scene/scene-graph.ts` (`SceneGraph` — Map-backed store + dirty notification), `scene/types.ts` (the `SceneObject` discriminated union, hit-region enum, shared fill/border config).
  - **Layer:** `layer/drawing-layer.ts` (`DrawingLayer implements CanvasLayer` — z-order iteration, viewport culling, dispatch), `factory.ts` (`createDrawingLayer` wiring).
  - **Hit testing:** `hit-testing/hit-map.ts` (`HitMap implements HitTestProvider` — spatial broad-phase + Path2D narrow-phase).
  - **Renderers (`renderers/`):** `dispatcher.ts`, `render-utils.ts`, `rich-text.ts`, `shape.ts`, `picture.ts`, `image-cache.ts`, `connector.ts`, `textbox.ts`, `ink.ts`, `equation.ts`, `chart.ts`, `diagram.ts`, `ole-object.ts`.
  - **Bridges:** `bridges/bridge-registry.ts`, `bridges/types.ts`, `bridges/diagram-canvas-bridge.ts`, `bridges/three-d-bridge.ts`.
  - **Shape support metadata:** `shape-rendering-info.ts`; **conversions:** `utils/ooxml-conversions.ts`. `index.ts` (the public barrel).
- **Out of scope (named for coupling, not edit targets):**
  - **`@mog/canvas-engine`** — supplies `CanvasLayer`, `HitTestProvider`, `DirtyRectAccumulator`, `regionLocalVisibleRect`, `TextMeasurer`, `computeLinearGradientEndpoints`, and the per-region coordinate contract. This plan treats those signatures and the region transform as fixed; any change there is flagged as a cross-folder dependency.
  - **`@mog/grid-canvas`** (`renderer/grid-renderer.ts`, `scene-graph-reader.ts`) — the sole consumer of `createDrawingLayer`/`SceneGraph`/`HitMap`. It owns the selection/resize/rotation **overlay** and its own `OverlayHitResult`, then casts overlay regions to `ObjectHitRegion` (`grid-renderer.ts:2520-2553`). Contract changes to the hit-region enum or `HitMap.hitTest` ripple here.
  - **`@mog/shape-engine`** (`createDrawingObject`, `getRegisteredShapeTypes`), **`@mog/drawing-engine`** (`renderDrawingObjectToCanvas`, `pathToPath2D`), **`@mog/spatial`** (`createSpatialIndex`, `hitTestPipeline`, `testPointInPath`), and the chart/diagram/text-effect/equation bridge implementations injected from the kernel/app. Drawing-canvas delegates to all of these; their internals are not edited here.

## Current role of this folder in Mog

This package is the **floating-object rendering and hit-testing layer** for the spreadsheet canvas. It owns three concerns:

1. **Scene state (`SceneGraph`).** A `Map<string, SceneObject>` of all floating objects — pictures, textboxes, shapes, connectors, charts, ink, equations, diagrams, OLE objects — each a member of a `type`-discriminated union (`scene/types.ts:225-234`). Bounds are in **document space** (absolute sheet coordinates). Mutations (`add`/`remove`/`update`/`clear`) fire an `onDirty(affectedBounds)` callback so downstream layers can do partial repaint, and accumulate a `dirtyIds` set consumed by the hit-test spatial index.

2. **Rendering (`DrawingLayer` + renderers).** `DrawingLayer` implements `CanvasLayer` (zIndex 500, `per-region` render mode). Each frame it sorts the scene by z-order, translates the context into region-local document space, AABB-culls against the visible region, and dispatches each surviving object through `dispatchRender` to a per-type pure renderer. Specialized object kinds (chart, diagram, text-effect/warp, equation/LaTeX, ink) are delegated to **bridges** held in `BridgeRegistry`; a required chart bridge fails-fast, optional bridges render placeholders.

3. **Hit testing (`HitMap`).** Implements `HitTestProvider`. Two-phase: a grid `SpatialIndex` broad-phase (`@mog/spatial`) plus a per-frame `Path2D` narrow-phase via `testPointInPath` on an `OffscreenCanvas`. Renderers register a body `Path2D` during render; `hitTest` converts a screen point to document space and returns the topmost hit as an `ObjectHitResult { objectId, groupId, region }`.

The factory `createDrawingLayer` wires all four collaborators (scene graph, bridge registry, hit map, image cache) and owns their lifecycle/disposal.

## Evidence (observed in the current tree)

- **Hit geometry ignores rotation and flip — rotated objects are unclickable where they appear.** Renderers register their narrow-phase `Path2D` in *un-transformed* document space: `shape.ts:110-115` translates the shape geometry to `bounds.x/bounds.y` but never applies `obj.rotation`/`flipH`/`flipV`; `connector.ts:273-278` and `textbox.ts:51-55` register the axis-aligned bounding rect. Yet `withRenderContext` (`render-utils.ts:299-309`) *does* rotate/flip the pixels via `applyRotation`/`applyFlip`. The broad-phase is also unrotated: both `HitMap.syncIndex` (`hit-map.ts:204`) and `addToIndex/updateInIndex` (`hit-map.ts:156-188`) insert `obj.bounds` verbatim. Net effect: a rotated shape is hit where its *unrotated* footprint was, not where it is drawn — clicks land on empty canvas, and the rotated-away region falsely registers hits.

- **The `ObjectHitRegion` contract is mostly unfulfilled by its owner.** `scene/types.ts:242-253` defines `body | resize-nw…resize-w | rotation | warp-adjust`, but `HitMap.hitTest` only ever emits `region: 'body'` (`hit-map.ts:301`, `hit-map.ts:335`). Resize/rotation handles are produced by a *different* layer (grid-canvas overlay) whose `OverlayHitResult.region` is then **cast** to `ObjectHitRegion` (`grid-renderer.ts:2520-2553`). So the canonical enum lives here while the package itself can only ever produce one of its values — an API that advertises capabilities it does not deliver, and a `region as ObjectHitRegion` cast that is unchecked at the boundary.

- **`getByZOrder()` re-sorts the entire scene on every frame and every fallback hit test.** `scene-graph.ts:95-97` builds a fresh array and `.sort()`s it on each call. `DrawingLayer.render` calls it once per region per frame (`drawing-layer.ts:118`) and `hitTestLinearScan` calls it again (`hit-map.ts:312`). The header comment rationalizes this as negligible "<1000 objects (~10μs)", but the package already maintains `dirtyIds`, so a memoized sorted view invalidated on mutation is free to add. At 60fps with multiple regions and a large deck of objects this is avoidable `O(N log N)` per frame.

- **Z-order tie-break is non-deterministic across load paths.** The comparator is `a.zIndex - b.zIndex` (`scene-graph.ts:96`). Equal `zIndex` falls back to `Map` insertion order, which depends on the order objects were `add`ed (import vs. collab replay vs. user insert). Two clients can paint overlapping equal-z objects in different orders. There is no stable secondary key (e.g., object id).

- **Viewport culling and the spatial broad-phase use the un-rotated AABB, so rotated/wide-stroke objects pop at the edge.** `drawing-layer.ts:137-144` culls with raw `obj.bounds`; the spatial index stores raw `obj.bounds`. An object rotated 45° (or with a thick stroke/arrowhead that extends past `bounds`) whose rotated extent crosses the viewport boundary is culled while still partially visible, causing it to flicker in/out during scroll, and is missed by broad-phase hit tests near its rotated corners.

- **`ImageCache` retries failed loads forever and grows without bound.** On load error it deletes the entry from `loading` and records nothing (`image-cache.ts:44-46`); `getImage` only consults `cache` and `loading` (`image-cache.ts:29-33`), so the very next frame starts a brand-new `Image()` load for the same broken URL. A persistently failing image (404, CORS, bad data URL) triggers a fresh network request *every frame* and never resolves to an error placeholder. Separately, the cache has no max size, LRU, or byte accounting (`image-cache.ts:16-19`) — only `clear()`/`invalidate()` — so a long session that scrolls through many large images or data-URL blobs accumulates `HTMLImageElement`s indefinitely.

- **Double error boundary: dead `catch`, un-throttled per-frame `console.warn`.** Every renderer wraps its body in `withRenderContext`, which catches, `console.warn`s, draws an error placeholder, and **does not rethrow** (`render-utils.ts:304-308`). `dispatchRender` then wraps the same call in its *own* `try/catch` that also draws a placeholder (`dispatcher.ts:61-107`). The dispatcher's catch is therefore unreachable for any renderer that uses `withRenderContext` (all of them), reachable only for the bridge-acquisition lines like `bridges.getChartBridge()` at `dispatcher.ts:81`. Meanwhile a single persistently broken object logs a warning on *every frame* (no throttle/dedupe), flooding the console at frame rate.

- **Connectors ignore their declared connection sites and route on the bbox diagonal.** `ConnectorData.startConnection`/`endConnection` (`scene/types.ts:126-128`) carry `{shapeId, siteIndex}`, but the renderer never reads them: `getEndpoints` always returns the top-left→bottom-right diagonal of `obj.bounds` (`connector.ts:129-136`). A connector "attached" to two shapes does not actually anchor to their connection sites and will not reroute when an endpoint shape moves — its geometry is purely a function of its own bounding box.

- **Connector hit region is the whole bounding box.** `connector.ts:273-278` registers `bounds` as the body `Path2D`. For a diagonal thin line spanning a large area, clicking anywhere in that (possibly huge) rectangle selects the connector — there is no distance-to-stroke narrow phase, so connectors over-capture clicks meant for objects behind them.

- **Rich-text multi-run wrapping bypasses `TextMeasurer` and has no long-word break.** The single-style path uses `textMeasurer.measureWrappedText` (`rich-text.ts:159-160`), but the multi-run path (`wrapMultiRunText`, `rich-text.ts:205-291`) measures with raw `ctx.measureText`. The two measurement sources can disagree (DPR, font fallback, locale shaping), so wrapping differs between a one-run and multi-run textbox of the same content. Neither path breaks a word longer than `maxWidth` (it overflows the clip), and `lineHeight` is a single value derived from the largest run's font (`rich-text.ts:121-126`), so mixed-size lines overlap or clip.

- **`SceneGraph.update` shallow-merges and replaces `data` wholesale, silently.** `scene-graph.ts:74` does `{ ...existing, ...updates } as SceneObject`. The `Partial<Omit<SceneObject,'id'|'type'>>` signature means a caller passing `{ data: { ... } }` replaces the entire per-type payload — a partial `data` patch drops every unspecified field. The `as SceneObject` cast also bypasses any check that the patched `data` still matches the object's `type` discriminant. This invariant ("`data` is all-or-nothing; updates must preserve the discriminant") is undocumented and unenforced.

- **Two parallel spatial-index maintenance paths; one is effectively dead.** `HitMap` exposes `addToIndex`/`removeFromIndex`/`updateInIndex` (`hit-map.ts:156-188`) **and** a lazy `syncIndex` that reconciles from `sceneGraph.getDirtyIds()` at hit-test time (`hit-map.ts:195-216`). The factory wires `onDirty` only to layer dirtiness, never to the explicit index methods (`factory.ts:75-83`), so the index is maintained solely via `syncIndex`. The explicit methods are unused public surface, and `dirtyIds` is cleared *only* inside `syncIndex` — if `hitTest` is never called (e.g., a read-only render), `dirtyIds` accumulates unbounded. `updateInIndex` even contradicts its own comment, doing remove+insert because "`updateBounds` only changes bounds."

- **Dead `_dpr` parameter and unguarded context mutation.** `HitMap.setViewportTransform(scrollOffset, zoom, _dpr, regionOrigin)` ignores `_dpr` entirely (`hit-map.ts:142`) — vestigial. `DrawingLayer.render` calls `ctx.translate(-scrollOffset.x, -scrollOffset.y)` (`drawing-layer.ts:123`) with no `save()`/`restore()`, relying entirely on the engine resetting the transform between layers; if that contract ever changes this silently corrupts every subsequent layer.

- **Stale "MVP" comments and hardcoded text metrics in `shape.ts`.** The header says "simple centered text" / "MVP: no wrapping" (`shape.ts:5-6`, `shape.ts:78-79`), but the code calls `renderRichTextBlock` which wraps. Shape text is always `horizontal:'center', vertical:'middle'` (`shape.ts:140`) regardless of the shape's OOXML body anchor, and the text margin is a hardcoded `4` (`shape.ts:128`).

## Improvement objectives

1. **Make hit testing geometrically faithful to what is drawn** — rotation, flip, and stroke extent must be reflected in both the broad-phase bounds and the narrow-phase path, so a click lands on an object iff it visually overlaps the pointer.
2. **Resolve the `ObjectHitRegion` ownership/contract mismatch** so the type and the producer agree, and the grid-canvas boundary cast is eliminated or made safe.
3. **Remove avoidable per-frame work** — memoize z-order, make tie-break deterministic, and unify the spatial-index maintenance to a single path.
4. **Fix the `ImageCache` failure loop and bound its memory.**
5. **Make connectors honor connection sites and hit-test on the stroke**, and bring rich-text wrapping to a single, measurer-consistent implementation.
6. **Collapse the redundant error-handling layers** into one boundary with throttled diagnostics.
7. **Tighten `SceneGraph.update` semantics** (partial-`data` behavior, discriminant safety) and document the coordinate/transform invariants.

## Production-path contracts and invariants to preserve or strengthen

- **`CanvasLayer` / `HitTestProvider` conformance.** `DrawingLayer` must keep `id='drawing'`, `zIndex=500`, `renderMode='per-region'`, and the `isDirty/markDirty/markClean/getDirtyRects/isFullDirty/dispose` surface. `HitMap.hitTest(screenPoint)` must keep returning `HitResult | null` with `layerId='drawing'`.
- **Document-space bounds.** `SceneObject.bounds` stay absolute sheet coordinates; document→viewport conversion stays in `DrawingLayer`/`HitMap` using the engine region transform. *Strengthen:* define a single "object visual extent" helper (rotation + flip + stroke-aware AABB) and use it for **both** culling and broad-phase indexing so the two never diverge.
- **Topmost-first hit priority and group semantics.** Hits resolve in reverse z-order; `ObjectHitResult` keeps `{objectId, groupId, region}` so the consumer can implement "single-click selects group, double-click selects member."
- **Exhaustive dispatch.** Keep the `default: never` exhaustiveness guard in `dispatchRender` (`dispatcher.ts:100-103`) so a new `SceneObject` type fails to compile until handled.
- **Per-object isolation.** One broken object must never blank the layer. *Strengthen:* exactly one error boundary per object, with placeholder + throttled log.
- **Bridge fail-fast vs. placeholder policy.** Required chart bridge throws on first use; optional bridges render placeholders. Preserve this split (`bridge-registry.ts:47-80`, `bridges/types.ts:83-94`).
- **Pure, side-effect-free renderers.** Renderers stay pure functions of `(ctx, obj, deps)`; all mutable lifecycle (caches, index) stays in the owning collaborators.
- **Mutation→repaint contract.** `onDirty(affectedBounds)` must continue to emit old∪new bounds for partial repaint, with empty array ⇒ full dirty (`scene-graph.ts:43-92`, `factory.ts:75-83`).

## Concrete implementation plan

### Phase 1 — Transform-correct geometry (highest value, correctness)
1. Add a shared helper (in `render-utils.ts` or a new `geometry.ts`) `visualExtent(obj): Rect` that expands `obj.bounds` by rotation (rotate the 4 corners, take the AABB), flip (no-op for AABB), and a stroke/decoration pad. Use it in:
   - `DrawingLayer` culling (`drawing-layer.ts:137-144`),
   - `HitMap.syncIndex` insert (`hit-map.ts:204`) and any explicit index inserts.
2. Make narrow-phase paths transform-aware. Either (a) have each renderer bake `rotation`/`flip` into the registered `Path2D` (compose the same matrix `withRenderContext` applies, via `Path2D.addPath(localPath, matrix)`), or (b) store the per-object transform alongside the path in `HitMap` and apply its inverse to the query point before `testPointInPath`. Prefer (b): it keeps renderers from duplicating the transform math and centralizes the contract in `HitMap`. Update `registerBody` to accept an optional transform (default identity).
3. Add regression coverage for "click a rotated/flipped shape" and "click the now-empty pre-rotation corner."

### Phase 2 — Hit-region contract alignment
4. Decide ownership with the grid-canvas overlay (cross-folder, see dependencies). Either:
   - **Narrow** the drawing-canvas `ObjectHitResult` to `region: 'body'` and move the handle-region enum to the overlay/canvas-engine where handles are actually produced; or
   - **Implement** handle/rotation region detection inside `HitMap` (requires handle geometry, which currently lives in the overlay) — heavier, only if we want the drawing layer to own selection chrome.
   Recommended: narrow here, keep the full enum in the layer that emits it, and replace the `region as ObjectHitRegion` cast (`grid-renderer.ts:2536`, `2553`) with a typed mapping. This removes the "advertises-unfulfilled-API" smell.

### Phase 3 — Scene-graph performance & determinism
5. Memoize `getByZOrder()`: cache the sorted array, invalidate on any `add`/`remove`/`update`/`clear`. Reuse the existing mutation hooks; no new bookkeeping needed beyond a dirty flag.
6. Make the comparator total: `a.zIndex - b.zIndex || compare(a.id, b.id)` so equal-z paint/hit order is identical across import, collab replay, and interactive insertion.
7. Document and tighten `update`: support partial `data` via a deep-ish merge of the `data` field (or explicitly forbid partial `data` with a typed `UpdatableSceneFields` that excludes `data`, forcing a full `data` replace). Guard the discriminant so `update` can never change `type`.

### Phase 4 — ImageCache correctness & bounds
8. Add a negative/failed set (or `cache` entry tagged `failed`) so `getImage` returns "failed" without re-issuing a load; expose an explicit `retry(src)`/`invalidate(src)` for deliberate reloads. Surface a distinct error placeholder in `picture.ts`/`ole-object.ts` for failed (vs. still-loading) images.
9. Add an LRU bound (max entries, optionally max bytes via `naturalWidth*naturalHeight*4` estimate) with eviction on insert; keep `clear()`/`invalidate()`.

### Phase 5 — Single error boundary
10. Remove the `try/catch` from `dispatchRender` and rely on `withRenderContext` as the single boundary; move the bridge-acquisition calls (`getChartBridge`, etc.) inside the wrapped body so their throws are caught too. Add throttling/dedupe to the `console.warn` (e.g., warn once per object id per N frames, or only on first failure).

### Phase 6 — Connectors & rich text
11. Thread connection-site resolution into the connector renderer: accept a resolver (via a new optional bridge or a callback passed through the dispatcher) that maps `{shapeId, siteIndex}`→document point, and route from real endpoints; fall back to the bbox diagonal only when unconnected. Register a **stroked** hit path (`ctx`-independent distance-to-polyline, or an inflated `Path2D` of the route) instead of the full bbox.
12. Unify rich-text wrapping on `TextMeasurer` for both single- and multi-run paths; add long-word breaking; compute per-line height from the tallest run *on that line* rather than a global max. Remove the stale `shape.ts` "MVP" comments and route shape body-anchor/alignment through `ShapeData`.

### Phase 7 — Cleanup
13. Remove the dead `_dpr` parameter (or wire it if narrow-phase ever needs device pixels); collapse the dead `addToIndex/removeFromIndex/updateInIndex` API into the `syncIndex` path (or vice-versa) so there is one maintenance route; ensure `dirtyIds` is drained even on render-only sessions. Wrap the `ctx.translate` in `render` defensively or assert the engine's transform-reset contract.

## Tests and verification gates

- **Unit (Vitest, package-local):**
  - `scene-graph`: memoized z-order returns identical order to the naïve sort; deterministic tie-break for equal `zIndex`; `update` discriminant-safety and partial-`data` semantics; `onDirty` bounds for add/replace/move/remove/clear (old∪new, empty⇒full).
  - `hit-map`: rotated and flipped shape hit/miss at transformed corners; connector hits only near the stroke; broad-phase uses visual extent; topmost-first priority; group id propagation; empty-index linear-scan fallback parity.
  - `image-cache`: failed URL loads exactly once and does not re-issue; LRU eviction order; `invalidate`/`retry` behavior.
  - `rich-text`: single vs. multi-run produce identical wrapping for identical content under a stub `TextMeasurer`; long-word break; mixed-size line height.
  - `render-utils`/`dispatcher`: exhaustiveness still compiles; a throwing renderer draws exactly one placeholder and logs at most once; ctx save/restore balance (assert `ctx.save` calls == `ctx.restore` calls via a mock 2D context).
  - Keep `utils/ooxml-conversions.test.ts` green (existing scale round-trips).
- **Type gates:** `pnpm --filter @mog/drawing-canvas typecheck`, plus `@mog/grid-canvas` typecheck to confirm the hit-region contract change compiles end-to-end (the cast removal).
- **App-eval (cross-package, run by a human/CI, not in this planning task):** scenarios that insert a picture/shape/connector, rotate it, then click it; scroll a rotated object across the viewport edge (no popping); a broken image URL shows an error placeholder without console flooding. (Workspace already has app-eval scenario infra under `mog-internal/dev/app-eval`.)
- **No new lint/format regressions;** the package barrel (`index.ts`) public surface is unchanged except the deliberate hit-region narrowing.

## Risks, edge cases, and non-goals

- **Hit-region narrowing is a breaking contract change** for `@mog/grid-canvas`. It must land atomically with the consumer update (cast removal at `grid-renderer.ts:2536/2553`). If we instead implement handle detection in `HitMap`, we take on selection-chrome geometry the drawing layer does not currently know about — larger blast radius. Prefer narrowing.
- **Connection-site routing** depends on a resolver the drawing layer does not own (shape connection-site geometry lives in shape-engine/kernel). Until that resolver exists, keep the bbox-diagonal fallback so no regression; the stroke-based hit path is independently shippable.
- **Transform-aware narrow phase** must match `withRenderContext`'s matrix exactly (same center, same degree→radian, same flip order) or hits will be subtly off; centralizing the matrix in one helper used by both render and hit paths mitigates drift.
- **Memoized z-order** must invalidate on *every* mutation including `update` that changes `zIndex`; a missed invalidation causes stale paint order. Covered by tests.
- **LRU eviction** must never evict an image that is on-screen this frame (evict by least-recently-*requested* and re-load lazily); acceptable because `getImage` re-issues on miss and `onLoad` re-renders.
- **Non-goals:** no rewrite of the bridge implementations (chart/diagram/text-effect/equation engines); no change to the document-space coordinate model or the `per-region` render contract; no new object types; no migration of the spatial index implementation in `@mog/spatial`. This plan is production-path correctness/perf hardening, not a reduced-scope or test-only patch.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable within this folder:** Phase 3 (scene-graph), Phase 4 (image-cache), Phase 5 (error boundary), and the rich-text half of Phase 6 touch disjoint files and can proceed concurrently.
- **Serialize:** Phase 1 (visual-extent helper) is a prerequisite for the culling/broad-phase edits and for Phase 2; do it first. Phase 2 must be coordinated and land together with the `@mog/grid-canvas` consumer change (`grid-renderer.ts`), so it is the main cross-folder dependency.
- **Cross-folder dependencies:**
  - `@mog/grid-canvas` — hit-region contract (Phase 2) and any change to `HitMap`/`SceneGraph` public surface; it is the only consumer of `createDrawingLayer`.
  - `@mog/canvas-engine` — only if the per-region transform contract or `TextMeasurer` API needs extension (Phase 1/6); otherwise untouched.
  - `@mog/shape-engine`/kernel — connection-site resolver for Phase 6 connector routing (deferred behind the fallback).
- No dependency on the Rust compute core; all changes are TypeScript in the canvas layer.
