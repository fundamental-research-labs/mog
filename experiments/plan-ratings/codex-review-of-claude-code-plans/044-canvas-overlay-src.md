Rating: 7/10

Summary judgment

This is a strong, evidence-based plan for `mog/canvas/overlay/src`. It correctly identifies several real production-path issues: hit testing depends on a stashed render context, multi-select locked-state rendering and hit testing disagree, the active handle is unused, hardcoded colors bypass `OverlayConfig`, transient rects are not normalized, and renderer-local type copies can drift from `OverlayDataSource`.

The rating is capped because the plan's largest structural objective, partial repaint, does not match the current canvas-engine dirty-rect contract. The overlay renders in canvas-absolute screen-space, but `CanvasLayer.getDirtyRects()` and `DirtyHint` are currently `DocSpaceRect`, and `RenderLoop.collectDirtyUnion()` converts every dirty rect through each render region before clearing canvas-space pixels. The plan says overlay dirty rects should be emitted in screen-space CSS pixels and also says no engine change is required. Those cannot both be true in the current architecture.

Major strengths

- The plan is grounded in actual source behavior, not speculative cleanup. The `_lastCtx` hit-test gate, DPR `setTransform` workaround, hardcoded `false` for group lock visibility, unused `getActiveHandle()`, hardcoded renderer colors, float equality snap-target dedup, and under-exported barrel are all real observations.
- The pure-geometry hit-testing direction is architecturally appropriate. It removes a render-state dependency from a hit-test path, makes pre-render hit testing possible, and enables deterministic unit tests without mocked `Path2D`/`DOMMatrix` behavior.
- The plan preserves important existing overlay contracts: `id='overlay'`, `renderMode='once'`, `canvas=1`, CSS-pixel screen-space rendering, compositing order, host-owned state, and handle priority order.
- It correctly flags cross-folder dependencies instead of pretending contract, grid-canvas consumer, and declaration-rollup changes can happen invisibly.
- The proposed verification set is meaningfully broader than "it typechecks": it includes geometry unit tests, render/hit parity tests, DPR/zoom checks, theming checks, and consumer type gates.

Major gaps or risks

- The partial-repaint design is not contract-correct as written. The engine documents dirty hints and `getDirtyRects()` as document-space, and the render loop converts all layer dirty rects via `docToCanvas()` for each region, including once-mode layers. Overlay state from `OverlayDataSource` is already screen-space CSS pixels. Branding those rects as `DocSpaceRect` would clear and clip the wrong pixels under scroll, frozen panes, and zoom. If overlay partial repaint is required, the plan needs either an engine-level dirty-space discriminator or a precise conversion contract; "no engine change required" is not defensible.
- The dirty snapshot API is underspecified. `markDirtyFromStateChange()` needs to define exactly when snapshots are invalidated: first render, dispose, viewport/zoom/layout changes, custom handle changes, config/theme changes, selection state changes, scene graph rebuilds, and any data-source callback identity changes. Without that, the implementation can easily produce stale partial rects or miss old pixels.
- Multi-select group hit results are not connected to the production consumer contract. `OverlayHitResult.objectId` is currently `null` for group handles, while `grid-renderer.hitTest()` only maps overlay hits to floating-object hits when `objectId` is non-null. The plan preserves the `null` result but does not specify how a group resize/rotate hit should reach the object interaction layer.
- Active-handle emphasis needs a stricter type contract. `OverlayDataSource.getActiveHandle()` returns `string | null`, while the live adapter reads `activeHandle` from a state shape typed as `ObjectHitRegion | null`. The plan alternates between "id" and region semantics. It should specify whether matching is by `HandleRegion`, custom handle id, custom handle region, or a discriminated handle key.
- Custom-handle hit testing remains unclear under rotation. Rendering applies parent-object rotation to custom handles, but current hit-path construction does not receive parent bounds. A pure-geometry rewrite should explicitly define custom-handle coordinate space and rotation behavior, especially if custom handles become part of the public API surface.
- The type/API hygiene work is reasonable, but it needs a clearer public contract diff. The package is private today, and the only production consumer imports `OverlayLayer`/`createOverlayLayer`. Exporting more types may still be right, but the plan should distinguish "consumer-required API" from "nice barrel completeness".
- The visual theming change from blue insertion preview to green selection theme is correctly flagged, but it should be an explicit product/design decision in the implementation contract, not a default assumption hidden inside tokenization.

Contract and verification assessment

The plan has good contract language around overlay identity, compositing order, coordinate space, state ownership, and hit-test priority. The hit-test and theming objectives fit the current package boundary well.

The partial-repaint contract is the main weakness. Current engine types make dirty rects document-space, while overlay renderers draw canvas-absolute screen-space. The plan must either add a new canvas-space dirty hint path to `@mog/canvas-engine`, define how screen-space overlay rects are converted safely under the active region layout, or defer partial repaint and keep overlay full-dirty until the engine supports canvas-space dirty rects.

The verification plan is good but incomplete for production behavior. Add explicit grid-canvas tests for overlay group-handle routing, tests around the engine dirty-rect coordinate-space contract if Phase B remains in scope, and at least one real browser/UI input path for resize/rotate handles under DPR=2 and non-100% zoom. The implementer should run overlay tests/typecheck, contracts build, grid-canvas tests/typecheck, and relevant app-eval or browser-driven handle scenarios.

Concrete changes that would raise the rating

- Rewrite Phase B around a concrete dirty-space contract. Prefer adding an engine-supported `CanvasSpaceRect` dirty path for once-mode screen-space layers, with render-loop tests, or explicitly remove partial repaint from this overlay plan until that engine contract exists.
- Define `OverlayHitResult` as a discriminated union for object vs group handles, and specify how `grid-renderer.hitTest()` maps group overlay hits into `FloatingObjectHitResult` or a new group-hit result.
- Tighten `getActiveHandle()` to a named type, likely `HandleRegion | null` or a discriminated handle key, and document matching for resize, rotation, group, and custom handles.
- Add an `OverlaySnapshot` schema to the plan, listing every data-source read captured for dirty diffing and every event that invalidates the snapshot to full dirty.
- Specify pure custom-handle geometry with parent bounds and rotation, or explicitly exclude rotated custom handles from the first hit-test rewrite.
- Make the contract extraction concrete: named renderer-input types in `@mog-sdk/contracts/rendering`, synchronized mirror updates in `types/rendering`, declaration-rollup build, and no remaining inline copies in overlay renderers.
- Strengthen verification commands with `pnpm --filter @mog/canvas-overlay test`, `pnpm --filter @mog/canvas-overlay typecheck`, `pnpm --filter @mog-sdk/contracts build`, grid-canvas test/typecheck gates, and a real UI scenario for handle hit/drag behavior.
