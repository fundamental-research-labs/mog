Rating: 8/10

Summary judgment

This is a strong production-path plan. It correctly treats `@mog/drawing-canvas` as more than a renderer bundle: it is the scene authority consumed by `grid-canvas` for rendering, hit testing, dirty invalidation, overlay positioning, and devtools scene reads. The plan maps well to the current source: `SceneGraph` has per-operation dirty callbacks, `DrawingLayer.render()` clears hit paths per region, `HitMap` stores a single last-rendered transform, `OverlayDataAdapter` reads raw transform getters, charts silently skip when the bridge is absent, and renderer hit registration is uneven across object types.

The rating is not higher because one central contract is under-specified and partly stale: the canvas-engine region transform is not just `doc - scrollOffset`. `RenderRegion` has `viewportOrigin`, and `canvas-engine/src/core/coordinate-space.ts` defines the canonical formula through `docToCanvas`/`canvasToDoc`. The plan says the new transform model must work with freeze panes and split panes, but it does not explicitly require carrying `viewportOrigin` or using the canonical helpers, and its invariant repeats the current scroll-only drawing-layer contract. That gap is large enough to leave the hardest class of multi-region bugs alive.

Major strengths

- The plan is grounded in the actual production path from `GridRenderer.createDrawingLayer()` through `SceneGraph`, `DrawingLayer`, `HitMap`, overlay bounds conversion, and canvas-engine hit-test registration.
- It identifies real existing failure modes: unbatched scene mutation, per-region `HitMap.clear()`, last-rendered viewport state, bounding-box connector hits, missing hit paths for several object types, duplicated renderer error boundaries, async image/diagram invalidation, and silent chart skips.
- It has systematic object-type coverage rather than a narrow bug fix. The per-`SceneObjectType` renderer contract is the right level of completeness for this folder.
- The dependency direction is appropriate: public behavior changes live in `mog`, integration with `grid-canvas` is explicit, and the plan does not introduce any `mog-internal` dependency.
- Verification is unusually good for a plan: package tests, package typecheck, integration package gates, repo typecheck, and real UI behavior gates are all listed.

Major gaps or risks

- The transform contract needs to name the full canvas-engine formula: `canvas = bounds + (doc - viewportOrigin - scrollOffset) * zoom`. Region-aware hit testing and overlay conversion should store or receive enough `RenderRegion` data to use `canvasToDoc` and `docToCanvas`, not another hand-written partial formula.
- The transaction API is still conceptual. It should define the operation shape, return/notification payload, dirty generation semantics, removed-ID semantics, and whether `clear()` followed by `replaceAll()` produces full dirty, old+new visual rects, or both.
- Visual bounds are called out correctly but not specified enough. The plan should define the `getVisualBounds(obj)` contract, whether the spatial index uses logical bounds or visual bounds, and the conservative expansion rules for rotation, stroke, shadows, connector arrowheads, crop, and async placeholders.
- Async invalidation needs an explicit stale-callback contract. Image and diagram callbacks can arrive after disposal, after source/object replacement, or after a sheet switch; the plan mentions this as a risk but should make generation checks an acceptance criterion.
- The public export boundary needs a concrete migration path. Replacing `HitMap` getter trio with conversion helpers affects `grid-canvas` and likely tests; the plan should specify compatibility wrappers or intentional removal.

Contract and verification assessment

The contract language is generally strong: document-space bounds, z-order ordering, group propagation, dirty hints, object-local renderer failure isolation, bridge readiness, and UI-path E2E requirements are all stated. The missing piece is that the coordinate contract must be aligned with `canvas-engine`, including `viewportOrigin` and helper-based conversions.

The verification gates are appropriate and production-path focused. To make them sufficient, add focused tests for non-zero `viewportOrigin`, not only different scroll offsets; prove render culling, hit testing, and overlay handles are correct in frozen-row/frozen-column regions regardless of render order. Add type/API tests or export snapshots for the intentionally narrow public surface. For UI gates, specify the fixture or insertion workflow and concrete pass/fail checks for stale pixels, selected object IDs, and overlay handle alignment.

Concrete changes that would raise the rating

- Rewrite the coordinate/viewport sections around `RenderRegion`, `viewportOrigin`, `docToCanvas`, and `canvasToDoc`, and make inline transform math removal an explicit acceptance criterion.
- Specify exact `SceneGraph.applyBatch`/`replaceAll` operation types and the mutation notification payload consumed by `DrawingLayer` and `HitMap`.
- Define `getObjectVisualBounds(obj)` with per-object expansion rules and state where logical bounds versus visual bounds are used.
- Add generation/disposal validation requirements for `ImageCache` and `DiagramCanvasBridge` async callbacks.
- Add a concrete diagnostics interface, including object ID, type, renderer label, bridge state, error, and devtools/reporting behavior.
- Turn the renderer behavior list into a test matrix keyed by `SceneObjectType` with render, hit, dirty, placeholder, and state-restore expectations.
