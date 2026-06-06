Rating: 8/10

## Summary judgment

This is a strong, evidence-driven plan. It reads the production drawing layer as an integrated scene/render/hit-test system, names the important cross-package consumer in `@mog/grid-canvas`, and proposes fixes that target real user-visible behavior rather than test-only paths. The plan is actionable enough to parallelize and its highest-priority geometry work is correctly placed before culling and broad-phase hit testing.

It falls short of a top rating because several contracts remain underspecified or missed. Most importantly, the plan does not address the per-region hit-test lifecycle: the engine renders per-region layers once per region, while `DrawingLayer.render` calls `hitMap.clear()` and `setViewportTransform()` per region and `HitMap` stores only one scroll/zoom/origin. Improving rotated geometry alone will not make hit testing correct in frozen/split-region layouts if the screen point is still interpreted through the last-rendered region. The verification section is also imprecise about the local test framework: this package uses Jest, not Vitest.

## Major strengths

- The evidence is concrete and mostly matches the current production code: raw bounds are used for culling and spatial indexing, hit results from drawing-canvas are body-only, z-order is freshly sorted, image load failures retry indefinitely, connectors use bbox endpoints, and rich-text wrapping diverges between single-run and multi-run paths.
- The plan preserves the right architectural boundaries: `SceneGraph` remains document-space state, renderers remain pure, bridge ownership stays injected, and the `@mog/grid-canvas` hit-region dependency is explicitly called out.
- The sequencing is mostly sound. Transform-correct visual extent before hit/cull fixes, then hit-region contract alignment, then lower-risk performance/cache/error/text work is a defensible order.
- It includes real production-path verification ideas: rotated object clicks, viewport-edge culling, broken-image behavior, cross-package typechecks, and app-eval scenarios.
- Parallelization notes are useful and avoid mixing independent work like image-cache bounds, z-order memoization, error boundary cleanup, and rich-text wrapping.

## Major gaps or risks

- The plan misses the multi-region/frozen-pane contract. `renderPerRegion` loops all regions, `DrawingLayer.render` clears/registers hit paths per region, and `HitMap.hitTest(screenPoint)` has no way to choose the containing region. The plan should specify whether `HitMap` stores region transforms, asks canvas-engine for a region lookup, or receives enough viewport layout data to map screen points correctly.
- "Visual extent" is underspecified. Stroke width, arrowheads, shadows/glows, text overflow, bridge placeholders, and connector decorations need explicit inclusion or exclusion; otherwise this becomes another approximate AABB helper with edge bugs.
- The transform-aware narrow phase needs a precise matrix contract: matrix type, rotation center, flip order, inverse-point handling, and browser/Jest availability for `DOMMatrix`, `Path2D.addPath`, and `OffscreenCanvas`.
- The hit-region recommendation is still a choice, not a final contract. If the plan recommends narrowing drawing-canvas to body-only, it should name the new overlay-owned handle-region type and audit all `ObjectHitRegion` importers, not just the two casts in `grid-renderer.ts`.
- `SceneGraph.update` leaves a key design choice open: deep-ish partial `data` merge versus forbidding partial `data`. That should be decided because update semantics are a contract, not an implementation detail.
- The connector resolver proposal needs ownership and signature details: source package, coordinate space, handling of hidden/grouped/rotated shapes, invalidation, and what `siteIndex` means for each registered shape geometry.
- The plan calls unit tests "Vitest", but `@mog/drawing-canvas` currently uses Jest (`package.json` test script and existing tests import Jest APIs).
- The scope is large enough that it needs clearer PR/phase acceptance boundaries. As written, a team could start too many high-blast-radius changes without a crisp "done" contract per phase.

## Contract and verification assessment

The contract section is better than average: it names `CanvasLayer`, `HitTestProvider`, document-space bounds, topmost-first hit priority, bridge policy, renderer isolation, and dirty repaint semantics. The main missing contract is region-aware hit testing and overlay positioning. Since `OverlayDataAdapter` derives screen-space object bounds from `HitMap.getScrollOffset()`, `getZoom()`, and `getRegionOrigin()`, the same single-region state problem can affect both hit tests and selection chrome.

Verification is directionally good but should be corrected to the actual gates: `pnpm --filter @mog/drawing-canvas test`, `pnpm --filter @mog/drawing-canvas typecheck`, and `pnpm --filter @mog/grid-canvas typecheck` for the consumer contract. The app-eval scenarios should explicitly drive real UI input paths for rotated/flipped object clicks, the old pre-rotation miss area, connector stroke selection, frozen-pane/split-region hits, viewport-edge culling, and broken-image retry/log throttling.

The plan should also add contract tests proving render and hit-test transforms use the same helper, visual extent is used consistently by culling and spatial indexing, and image-cache failed/retry/eviction states have deterministic behavior.

## Concrete changes that would raise the rating

1. Add an earliest phase for region-aware `HitMap` lifecycle: define how screen points select a render region and how body paths/transforms survive multi-region rendering.
2. Replace the Vitest references with the package's Jest-based test gates and actual `pnpm --filter` commands.
3. Decide the `SceneGraph.update` `data` semantics and the hit-region ownership model in the plan rather than offering alternatives.
4. Specify the exact transform matrix contract shared by `withRenderContext`, visual extent calculation, and `HitMap` narrow-phase inverse transforms.
5. Define visual-extent inputs for strokes, arrowheads, shadows, connector decorations, and bridge placeholders.
6. Define the connector connection-site resolver interface, owner, coordinate space, invalidation behavior, and fallback rules.
7. Split the implementation into reviewable phases with explicit acceptance tests and cross-package type gates for each contract-changing phase.
8. Add real UI/app-eval coverage for frozen-pane region hits in addition to the rotated/flipped object scenarios.
