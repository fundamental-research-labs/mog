# 044 — Improve `mog/canvas/overlay/src` (selection chrome, handle hit testing, drag/ink overlays)

## Source folder and scope

- **Folder:** `mog/canvas/overlay/src` (`@mog/canvas-overlay`, v0.1.0)
- **Size:** ~15 source files (~58 KB of `.ts`) plus 4 test files (~2,300 lines). Production files:
  - **Layer + hit-test host:** `overlay-layer.ts` (323 lines — the `CanvasLayer` + `HitTestProvider` implementation and `createOverlayLayer` factory), `types.ts` (config, `HandleRegion`, `getHandleVisibility`, `OverlayHitResult`).
  - **Handle geometry:** `handle-positions.ts` (pure position math), `handle-paths.ts` (Path2D builders + DOMMatrix rotation), `handle-hit-testing.ts` (priority-ordered hit test), `selection-chrome.ts` (outline/group/resize/rotation renderers), `custom-handles.ts` (extensible WordArt-style handles).
  - **Transient chrome renderers:** `drag-preview.ts`, `insertion-preview.ts`, `rubber-band.ts`, `smart-guides.ts`, `connection-points.ts`, `ink-preview.ts`.
  - `index.ts` (barrel).
- **In scope (edit targets):** all files above. The package is a pure-renderer + hit-test seam: it draws screen-space UX chrome on canvas 1 and answers handle hit tests. It owns no selection/drag state — that comes from `OverlayDataSource`.
- **Out of scope (named for coupling, not edit targets):**
  - **`@mog-sdk/contracts/rendering` `OverlayDataSource`** (`mog/contracts/src/rendering/data-sources.ts:342-399`) and its mirror in `mog/types/rendering/src/data-sources.ts`. Several improvements below add or tighten methods on this contract; those edits land in the contracts folder (plans 001-003) and are flagged as cross-folder dependencies, not done here. The contract requires `pnpm --filter @mog-sdk/contracts build` before consumers typecheck (see `[[mog-contracts-declaration-rollup]]`).
  - **`@mog/canvas-engine`** (`CanvasLayer`, `DirtyRectAccumulator`, `DirtyHint`, `HitResult`, `DocSpaceRect`, render-loop) — the dirty-rect / partial-repaint work depends on engine semantics but does not modify the engine.
  - **`@mog/spatial`** (`testPointInPath`) — current hit testing depends on it; one objective removes that dependency.
  - **The single production consumer:** `mog/canvas/grid-canvas/src/renderer/grid-renderer.ts` (constructs the overlay at `:1061`, registers the hit-test provider at `:1067`, and drives dirtiness at `:1362/:1386/:1397`). Its `OverlayDataAdapter` (`:791`) is the live `OverlayDataSource`. Edits there are cross-folder.

## Current role of this folder in Mog

This folder is the **screen-space UX-chrome layer for canvas 1** (the top, non-scrolling canvas). Two responsibilities:

1. **Rendering (`OverlayLayer.render`).** A fixed back-to-front compositing pipeline (`overlay-layer.ts:67-242`): per-object selection outlines → group bounding box (multi-select) → resize handles → rotation handle → custom handles → connection-point indicators → smart guides → rubber band → drag preview → insertion preview → ink preview. Every renderer is a pure function taking `(ctx, state, config)`; the layer pulls state from `OverlayDataSource` each frame. All coordinates are CSS pixels (post-zoom); handles render at constant on-screen size regardless of document zoom.

2. **Hit testing (`OverlayLayer.hitTest` → `hitTestHandles`).** Answers "which handle is under this point" in priority order: custom handles → group handles (multi-select) → per-object handles (single select). It builds `Path2D` objects (`handle-paths.ts`) and tests them with `testPointInPath` from `@mog/spatial`, expanding each handle's hit area by `handleHitExpansion` CSS pixels.

The package is intentionally state-free and host-agnostic: it knows nothing about WordArt, SmartArt, charts, or the kernel — domain handles arrive through the generic `CustomHandle` interface, and all selection/drag/guide/ink state arrives through `OverlayDataSource`. This is the right architecture; the improvements below harden the seam without breaking it.

## Evidence (observed in the current tree)

- **Hit testing is coupled to the last render through mutable canvas state.** `hitTest` returns `null` if `this._lastCtx` is unset (`overlay-layer.ts:248-249`), so a hit test before the first render silently fails. It then does a `save()` → `setTransform(1,0,0,1,0,0)` → … → `restore()` dance (`:275-289`) to defeat the DPR scale baked into the stashed context, with a comment explaining that `isPointInPath` transforms the path but not the test point. The actual geometry — point in a (possibly rotated) rectangle, a circle, a diamond — is simple closed-form math that needs no canvas at all. The `Path2D` + `testPointInPath` + `@mog/spatial` dependency + stashed-context workaround exist only to reuse the canvas point-in-path primitive.

- **Multi-select group hit testing ignores the lock state that rendering honors.** In `render`, group handle visibility is computed with `allLocked = selectedIds.every(id => ds.isObjectLocked(id))` (`overlay-layer.ts:172-173`) — if every selected object is locked, no group handles draw. But `hitTestHandles` computes group visibility with `getHandleVisibility(groupBounds, false, config)` — locked hardcoded to `false` (`handle-hit-testing.ts:77`). Result: when all selected objects are locked, the group shows **no handles but still answers hits on them**, so a drag can start on an invisible handle. Render and hit-test disagree on the same predicate.

- **Fine-grained dirty tracking is dead code; every overlay change is a full canvas-1 repaint.** `OverlayLayer` owns a `DirtyRectAccumulator` (`overlay-layer.ts:91`) and exposes `getDirtyRects()`/`isFullDirty()`, but `markDirty(hint)` is only ever called with the default `{type:'full'}` (`:115-117`), and the constructor calls `promoteToFull()` (`:104`). The sole consumer confirms this is known, deferred work: `grid-renderer.ts:1360-1362` (`TODO: Overlay partial repaint — selection handles and chrome only need to repaint old + new handle positions`) and `:1382-1386` (`TODO: Overlay partial repaint … Revisit if profiling shows overlay repaint as a bottleneck`). For continuous gestures — ink strokes, eraser cursor, drag preview at pointer-move rate — this repaints the entire top canvas every frame.

- **The active handle is never visually distinguished.** `OverlayDataSource.getActiveHandle(): string | null` exists in the contract (`data-sources.ts:354`) and is implemented by the live adapter (`grid-renderer.ts:878`), but `OverlayLayer.render` never calls it. The handle currently being dragged/hovered renders identically to every other handle — no emphasis, no affordance — even though the data is already plumbed through.

- **Theme-relevant colors are hardcoded inside renderers, bypassing `OverlayConfig`, and one is off-theme.** `OverlayConfig` centralizes selection/handle/guide/rubber-band colors (`types.ts:40-92`), but several renderers ignore it: `ink-preview.ts` hardcodes eraser `#666666` (`:132`), lasso stroke `#217346` and fill `rgba(33,115,70,0.1)` (`:181,185`); `connection-points.ts` hardcodes indicator fill `#ffffff` (`:79,98`); and `insertion-preview.ts` hardcodes fill `rgba(66,133,244,0.08)` (`:43`) — a **blue** that clashes with the green (`#217346`) selection theme everything else uses. Theming, dark mode, and high-contrast cannot reach these surfaces, and the insertion preview is visually inconsistent today.

- **Connection-point snap-target dedup uses float equality on coordinates.** `connection-points.ts:69-74` skips re-drawing the snap target by testing `pt.x === snapTarget.x && pt.y === snapTarget.y`. This is exact `===` on floats that originate from independent screen-space projections; if the snap target is recomputed rather than referentially shared, the equality can miss and the point is drawn twice (outline under the filled snap dot). Identity/index-based matching is the correct dedup key.

- **Transient-chrome bounds are not normalized for inverted drags.** `rubber-band.ts:31-38` and `insertion-preview.ts:42-50` call `fillRect`/`strokeRect` with raw `{x,y,width,height}`. `strokeRect` tolerates negative width/height, but the dashed `setLineDash` phase and any future rounded-corner or padding logic assume a normalized (top-left origin, positive extent) rectangle. The contract for `getRubberBand()`/`getInsertionPreview()` does not state which corner is the origin, so a drag up-and-left produces negative extents that are only accidentally handled.

- **Renderer parameter types are inline-duplicated instead of imported from the contract.** Each transient renderer re-declares the shape it receives — e.g. `smart-guides.ts:30-35` redeclares the guide object, `ink-preview.ts:33-37,208-216` redeclares stroke/preview shapes, `drag-preview.ts:31-38` redeclares the drag-preview shape. These are verbatim copies of the `OverlayDataSource` method return types (`data-sources.ts:356-398`). When the contract changes, these drift silently — the renderer compiles against its own private copy.

- **The public barrel under-exports the package's own contract surface.** `index.ts` exports only `OverlayLayer`, `createOverlayLayer`, `OverlayLayerConfig`, `HandlePosition`, `OverlayConfig`, `CustomHandle` (`:14-27`). It omits `OverlayHitResult` and `HandleRegion` — the *result* type of `hitTest`, which a consumer needs to interpret `HitResult.target` (returned untyped via the engine's `HitResult`). It also omits `getHandleVisibility`, `DEFAULT_OVERLAY_CONFIG`, `ScreenBounds`, `ConnectionPointIndicators`, and `InsertionPreviewBounds`. Consumers either re-derive these or reach into deep import paths.

## Improvement objectives

1. **Make hit testing pure geometry, decoupled from render state.** Remove the `_lastCtx` dependency, the `Path2D`/`testPointInPath`/`@mog/spatial` dependency, and the DPR `setTransform` workaround. Hit testing becomes a pure function of `(point, bounds, config)` that works before the first frame and is trivially unit-testable.
2. **Restore parity between what renders and what is hit-testable**, especially the all-locked multi-select group case, by computing visibility from a single shared predicate used by both paths.
3. **Enable incremental (partial) repaint of canvas 1** by computing tight dirty rects from previous→current overlay state, turning the dead `DirtyRectAccumulator` capability into real per-gesture repaint and removing the two `grid-renderer` TODOs.
4. **Route every color and line style through `OverlayConfig`**, fixing the off-theme insertion-preview blue and making the whole overlay themeable (dark mode / high contrast).
5. **Render active-handle emphasis** by consuming the already-plumbed `getActiveHandle()`.
6. **Tighten correctness on transient chrome:** identity-based snap-target dedup, normalized inverted-drag bounds.
7. **Eliminate inline type duplication** by importing shared shapes from the contract, and **complete the public barrel** so the hit-test result surface is part of the package's API.

## Production-path contracts and invariants to preserve or strengthen

- **`CanvasLayer` identity is fixed:** `id='overlay'`, `zIndex=0`, `renderMode='once'`, `canvas=1`. Do not change these — the render loop and `grid-renderer` register by these values (`grid-renderer.ts:1064,1067,2530`).
- **Compositing order (`overlay-layer.ts:67-82`) is a UX contract** — handles above outlines, ink above everything. Preserve the documented back-to-front order exactly.
- **All overlay coordinates are CSS pixels (post-zoom).** Handles must keep constant on-screen size at any zoom. No change to the coordinate space.
- **The package stays state-free and domain-agnostic.** No selection/drag/ink state may be cached across frames *except* the minimal previous-frame snapshot needed to diff dirty rects (objective 3), which must be derived solely from `OverlayDataSource` reads and reset on `dispose()`.
- **`hitTest` priority order** (custom → group → per-object, first hit wins) is a behavioral contract relied on by `grid-renderer`'s hit dispatch; preserve it.
- **`getHandleVisibility` thresholds** (`tinyObjectThreshold`, `smallObjectThreshold`, lock → `none`) are the single source of truth for both render and hit test — strengthen this by making both paths call it with identical arguments (objective 2).
- **Strengthen the `OverlayDataSource` rectangle contract:** document and enforce that `getRubberBand()`/`getInsertionPreview()` may return inverted extents and the overlay normalizes them; this is a clarification, not a breaking change.

## Concrete implementation plan

### Phase A — Pure-geometry hit testing (objectives 1, 2)

1. Add `handle-geometry.ts` with pure predicates: `pointInRotatedRect(p, rect, rotationDeg)`, `pointInCircle(p, center, radius)`, `pointInDiamond(p, center, halfExtent)`. `pointInRotatedRect` inverse-rotates the test point about the rect center (radians = `deg*π/180`) and does an axis-aligned containment check — equivalent to the current DOMMatrix path-rotation but on the point, which is what hit testing actually needs.
2. Rewrite `handle-hit-testing.ts` to test these predicates against the positions from `handle-positions.ts` (expanded by `handleHitExpansion`) and the custom-handle shapes, dropping `testPointInPath`, the `ctx` parameter, and the `@mog/spatial` import. Keep the same priority order and `OverlayHitResult` return.
3. Compute group visibility inside `hitTestHandles` with the **same** lock argument the renderer uses. Lift the `allLocked`/single-`locked` computation into a shared helper (e.g. `resolveSelectionVisibility(ds, selectedIds, bounds, config)` in `overlay-layer.ts` or a small `selection-state.ts`) and call it from both `render` and `hitTest` so they can never diverge again.
4. Simplify `OverlayLayer.hitTest`: drop `_lastCtx` stashing and the `save/setTransform/restore` block; call the pure `hitTestHandles` directly. `render` no longer needs to stash `ctx` (remove `this._lastCtx` and its reset in `dispose`).
5. Reduce `handle-paths.ts` to only what rendering still needs. The `Path2D` builders were used solely by hit testing; once hit testing is geometric, delete the hit-path builders (or keep none) and remove the now-unused `@mog/spatial` workspace dependency from `package.json` **only if** no other module imports it (verify by search; the dependency removal is a cross-file edit confined to this package's `package.json`, which is permitted as part of this folder's production path — note it explicitly in the PR).

### Phase B — Partial repaint (objective 3)

6. Add `overlay-dirty.ts`: a `computeOverlayDirtyRects(prev, next, config): DocSpaceRect[]` that, given the previous and current overlay state snapshots, returns the union of changed regions — old+new selection outlines, old+new handle clusters (including rotation-handle offset and `handleHitExpansion` padding), drag-preview rects, guide line bounds, rubber-band/insertion rects, and ink-stroke bounding boxes. Return a single full-canvas sentinel when the change set is unbounded (e.g. selection count crosses single↔multi, or guide set churns wholesale) so the engine falls back to full repaint safely.
7. In `OverlayLayer`, capture a minimal immutable snapshot of the overlay-relevant `OverlayDataSource` reads at the end of each `render`. Add a method the host calls instead of blind `markDirty('overlay')` — e.g. `markDirtyFromStateChange()` that diffs current reads against the snapshot and feeds rect hints to the accumulator, promoting to full only when `computeOverlayDirtyRects` returns the sentinel. Keep the existing `markDirty(hint?)` for explicit callers.
8. Update the consumer (`grid-renderer.ts:1362,1386,1397`) to call the rect-producing path and delete the two `TODO: Overlay partial repaint` comments. This is a cross-folder edit (grid-canvas) and must be sequenced after Phase B lands in the overlay package; flag as a dependency.
9. Guard correctness: dirty rects are emitted in the same screen-space CSS-pixel space the renderer draws in, and must include stroke half-width and dash overshoot padding so partial repaints never clip a 2px outline or a handle border. Reset the snapshot on `dispose()`.

### Phase C — Theming and active-handle emphasis (objectives 4, 5)

10. Extend `OverlayConfig` (in `types.ts`, and the merged `DEFAULT_OVERLAY_CONFIG`) with the currently-hardcoded tokens: `eraserCursorColor`, `lassoStrokeColor`, `lassoFillColor`, `connectionPointFillColor`, `connectionPointSnapColor`, `insertionPreviewFillColor`, `insertionPreviewStrokeColor`, and `activeHandleFillColor`/`activeHandleStrokeColor`. Default the insertion-preview tokens to the green selection theme (resolving the blue inconsistency) unless product explicitly wants the blue — surface this as the one user-facing visual change to confirm.
11. Replace the hardcoded literals in `ink-preview.ts`, `connection-points.ts`, and `insertion-preview.ts` with the new config fields, threading `config` into the renderers that don't yet receive it (they already take `Pick<OverlayConfig, …>` — widen the picks).
12. Pass `ds.getActiveHandle()` into `renderResizeHandles`/`renderRotationHandle`/`renderCustomHandles` (or a thin wrapper) and render the matching handle with the `activeHandle*` colors / a slightly larger size. The active-handle id maps to a `HandleRegion`; reuse the existing region identifiers so no new contract field is needed beyond reading the already-present `getActiveHandle()`.

### Phase D — Correctness and API hygiene (objectives 6, 7)

13. `connection-points.ts`: dedup the snap target by identity/index rather than float `===`. Prefer matching by array index (the data source can mark which point is the snap target) — if the contract only exposes coordinates, fall back to an epsilon compare and document it; ideally tighten the contract to carry a `snapIndex` (cross-folder, contracts).
14. Normalize inverted-drag bounds in `rubber-band.ts` and `insertion-preview.ts` via a shared `normalizeRect({x,y,width,height})` helper (top-left origin, non-negative extent) before fill/stroke. Document the normalization in the `OverlayDataSource` rect-returning methods (cross-folder, contracts).
15. Replace inline-duplicated parameter shapes in `smart-guides.ts`, `ink-preview.ts`, `drag-preview.ts`, `connection-points.ts`, `insertion-preview.ts` with named types imported from `@mog-sdk/contracts/rendering` (extract them in the contract if not already named). Keep `Pick<>`-based config typing.
16. Complete `index.ts`: export `OverlayHitResult`, `HandleRegion`, `HandleVisibility`, `getHandleVisibility`, `DEFAULT_OVERLAY_CONFIG`, `ScreenBounds`, and the renderer-input types (`ConnectionPointIndicators`, `InsertionPreviewBounds`). This makes the hit-test result surface part of the package API instead of a deep import.

## Tests and verification gates

- **Existing tests must stay green** (`__tests__/handle-hit-testing.test.ts`, `overlay-layer.test.ts`, `handle-positions.test.ts`, `smart-guides.test.ts`). Note that `handle-hit-testing.test.ts` currently constructs a canvas `ctx` to drive `testPointInPath`; Phase A removes that dependency, so these tests are updated to call the pure predicates directly (this is a consequence of a production change, not a test-only workaround).
- **New unit tests (gates):**
  - `handle-geometry`: point-in-rotated-rect at 0°/45°/90°/negative rotation; on-edge and corner cases; circle and diamond containment incl. expansion padding.
  - Group hit/render parity: all-locked multi-select returns **no** hit and renders **no** handles (the regression this plan fixes); mixed lock returns handles.
  - `hitTest` before first render returns a real result (no longer null-gated on `_lastCtx`).
  - `computeOverlayDirtyRects`: returns tight union for selection-move and drag-preview; returns full-repaint sentinel on single↔multi transition; includes stroke/dash padding so a 2px outline is never clipped.
  - Theming: each renderer honors its new config token; default insertion-preview color matches the selection theme.
  - Active-handle emphasis: the region returned by `getActiveHandle()` renders with the active colors.
  - `normalizeRect`: inverted (negative width/height) input produces top-left origin, positive extents.
- **Verification commands (run by the implementer, not in this planning run):** `pnpm --filter @mog/canvas-overlay test`, `pnpm --filter @mog/canvas-overlay typecheck`. Because objectives 3/6/7 touch `@mog-sdk/contracts`, run `pnpm --filter @mog-sdk/contracts build` first (`[[mog-contracts-declaration-rollup]]`), then typecheck `@mog/canvas-overlay` and `@mog/canvas-grid` (the consumer).
- **Integration gate:** `grid-canvas` integration tests and any app-eval selection/drag/resize scenarios continue to pass after the partial-repaint wiring (Phase B step 8). Manually confirm handles, rubber band, drag preview, and ink render and hit-test correctly under DPR=2 and at non-100% zoom, since Phase A removes the explicit DPR reset.

## Risks, edge cases, and non-goals

- **Risk — DPR/zoom regressions from removing the `setTransform` reset.** The current workaround compensated for the path being transformed but not the point. Pure-geometry hit testing operates entirely in CSS-pixel space (the same space `OverlayDataSource` returns bounds in), so it should be DPR-independent by construction — but this must be explicitly verified at DPR=2 and fractional zoom, as that reset existed for a reason.
- **Risk — partial-repaint clipping artifacts.** Under-padded dirty rects leave ghost outlines/handles. Mitigation: the sentinel-fallback for unbounded changes plus mandatory stroke/dash padding; default to full repaint whenever in doubt. Partial repaint must never trade correctness for speed.
- **Risk — rotated-bounds dirty rects.** A rotated selection's outline and handles occupy an axis-aligned box larger than `{x,y,width,height}`. `computeOverlayDirtyRects` must expand to the rotated AABB (including the rotation handle above the top edge).
- **Risk — visual change.** Re-theming insertion preview from blue to green is user-visible; confirm with product before changing the default (the only intentional visual change — everything else is pixel-identical).
- **Edge cases:** zero/negative-size objects (already gated by `tinyObjectThreshold`); empty selection; single-point ink stroke (filled dot); guide set churning every frame (sentinel → full repaint); custom handles present with multi-select (currently only rendered for single select — preserve that).
- **Non-goals:** redesigning the compositing pipeline or handle visuals; adding new gesture types; introducing accessibility/ARIA to the canvas (out of this layer's scope); moving selection/drag *state* into this package (it must stay state-free apart from the dirty-diff snapshot); changing `renderMode`/`zIndex`/`canvas`.

## Parallelization notes and dependencies on other folders

- **Internal sequencing:** Phase A (pure hit testing) and Phase C (theming + active handle) and Phase D (correctness/API) are largely independent and can proceed in parallel. Phase B (partial repaint) depends on no other phase internally but its consumer wiring (step 8) depends on the overlay-side API landing first.
- **Cross-folder dependencies:**
  - **`@mog-sdk/contracts` (plans 001-003):** extracting named renderer-input types (D-15), adding a `snapIndex` to connection-point data (D-13), and documenting inverted-rect normalization (D-14) are contract edits. Requires the contracts declaration rollup build before consumers typecheck (`[[mog-contracts-declaration-rollup]]`). The contract's mirror in `mog/types/rendering` must stay in sync.
  - **`@mog/canvas-grid` (`grid-canvas/src/renderer/grid-renderer.ts`):** Phase B step 8 replaces blind `markDirty('overlay')` calls with the rect-producing path and removes the two TODOs. Coordinate so the grid-canvas plan owner does not concurrently rewrite the same `getFloatingObjects*` callbacks.
  - **`@mog/spatial`:** Phase A removes this package's use of `testPointInPath`; the `package.json` dependency is dropped only after confirming no other overlay module imports it. No change to `@mog/spatial` itself.
  - **`@mog/canvas-engine`:** Phase B relies on the existing `DirtyRectAccumulator`/`DocSpaceRect`/`DirtyHint` semantics; no engine change required.
