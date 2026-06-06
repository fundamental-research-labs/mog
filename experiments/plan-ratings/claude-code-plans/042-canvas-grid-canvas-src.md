# Plan 042 — Decompose and harden the grid-canvas composition facade (`mog/canvas/grid-canvas/src`)

## Source folder and scope

- **Folder:** `mog/canvas/grid-canvas/src` (TypeScript; package `@mog/grid-canvas`, `version 0.1.0`, `private`, dev-export resolves to `./src/index.ts`).
- **Primary files in scope:**
  - `renderer/grid-renderer.ts` (**2844 lines** — by far the dominant file) — the `GridRendererImpl` composition facade plus **nine** in-file data-source adapter classes (`CellDataAdapter`, `SelectionDataAdapter`, `SheetDataAdapter`, `CollaborationDataAdapter`, `TraceDataAdapter`, `FloatingObjectDataAdapter`, `GroupingDataAdapter`, `PageBreakDataAdapter`, `OverlayDataAdapter`), the ~80-field `fieldHandlers` dispatch table (`buildFieldHandlers`, L1096–1538), selection/header dirty-rect computation (L1553–1789), scene-graph patch application + projection (`applySceneGraphPatches`, `syncSceneGraph`, `buildSceneObject`, `buildDiagramData`, `buildTextEffectRef`, L1807–2247), lifecycle, viewport/scroll/zoom, sheet switch, queries, hit-test, and bridge wiring.
  - `renderer/grid-render-scheduler.ts` (134 lines) — `GridRenderScheduler` implementing the "Write = Invalidate" `RenderScheduler` contract; two-phase dirty expansion (dependency expansion via `DirtyCellExpander` → coordinate resolution via `ViewportPositionIndex`/`ViewportMergeIndex`).
  - `renderer/viewport-to-region-layout.ts` (80 lines) — the single sanctioned `Viewport`→`RenderRegion<GridRegionMeta>` projection.
  - `renderer/scene-graph-reader.ts` (61 lines) and `renderer/scene-graph-bounds-reader.ts` (51 lines) — read-only adapters over `drawing-canvas`'s `SceneGraph` for the public `ISceneGraphReader` / `IObjectBoundsReader` contracts (devtools + overlay).
  - `renderer/render-context.ts` (47 lines) — pure re-export shim (the monolithic `RenderContext` was retired; types now live in contracts).
  - `cell-style-bridge.ts` (289 lines) — DOM/canvas font + style adapters (`getCellCanvasFont`, `getCellDOMStyle`, `getThemedCellStyle`); the only DOM-dependent code in the package.
  - `viewports/compute-layout.ts` (**894 lines**) — `computeViewportLayout`, a pure function building single / freeze (1–4 regions) / split (2–4 panes) / overlay viewport layouts.
  - `viewports/types.ts` (86 lines), `viewports/scroll.ts` (17 lines) — re-export shims sourcing from `@mog/grid-renderer` + contracts; carry a few local types (`ComputeLayoutInput`, `FrozenBoundaries`, `ViewportBuilder`).
  - `viewports/index.ts`, `renderer/index.ts`, `index.ts` — barrels.
  - `styles/css-variables.ts` (300 lines) — CSS-variable cache/reader + `applyChromeTheme` (ChromeTheme → `--color-ss-*` bridge).
  - `vite-env.d.ts` — ambient types.
  - `renderer/__tests__/*` (6 suites) and `viewports/__tests__/compute-layout.test.ts` — existing coverage for dirty-hint computation, scene projection, region mapping, layout.
- **Adjacent code touched only as dependency (not edited blindly):**
  - `@mog/canvas-engine` — `createCanvasEngine`, `markDirty`, `DirtyHint`/`DocSpaceRect`, `setLayout`, `DirtyCellExpander`, hit-test registry.
  - `@mog/grid-renderer` — `createGridLayers`, `createGridHitTest`, `ViewportPositionIndex`/`ViewportMergeIndex`, `GridCoordinateSystem`, `CoordinateSystemImpl`, `computeVisibleRange`/`computeFrozenRange`, scroll utils.
  - `@mog/drawing-canvas` — `createDrawingLayer`, `SceneGraph`, `HitMap`, `SceneObject` union.
  - `@mog/canvas-overlay` — `createOverlayLayer`.
  - `@mog-sdk/contracts/rendering` — `GridRenderer`, `RenderContextConfig`, data-source interfaces, `GridRendererStats`.
  - `mog/views/sheet-view/src/{sheet-view.ts,viewport-wiring.ts}` — the sole production consumer; owns `engine.start()` and wires the scheduler's indices (see Objective 2).
  - `apps/spreadsheet/src/components/grid/effects/useRenderContextConfig.ts` — drives `updateContext()` on every React/Zustand render.

This is a **production-path** plan: it strengthens correctness (scheduler wiring, sheet-switch race, cast-free scene projection), observability (stats, unhandled-field detection), and maintainability (decomposing a 2844-line module), all on the live render facade. It is **not** a test-only, reduced-scope, or shim plan.

## Current role of this folder in Mog

`@mog/grid-canvas` is the **thin composition facade** that assembles four lower-level canvas packages into the complete spreadsheet canvas and presents them behind the single `GridRenderer` contract that the views/app layers consume. It owns no drawing logic and no layer logic; per its own header docs, "All rendering logic lives in `@mog/grid-renderer`. All drawing logic lives in `@mog/drawing-canvas`." Its job is wiring:

1. **Composition** — construct the engine (2 canvases), grid layers, drawing layer, overlay layer; register layers and hit-test providers in priority order (overlay 1000 → drawing 500 → grid 0).
2. **State adaptation** — wrap the flat ~80-field `RenderContextConfig` (the legacy React→renderer state channel) into typed, mutable data-source adapters consumed by the layers, dispatched per-field in `updateContext()` (the documented hot path: "50–200+ calls/sec").
3. **Invalidation routing** — translate state changes into precise `DirtyHint`s (selection/header dirty rects, scene-graph AABB rects) so the engine repaints minimal regions; bridge buffer writes to layer invalidation via `GridRenderScheduler`.
4. **Layout projection** — `computeViewportLayout` (pure) produces the domain `ViewportLayout`; `viewportLayoutToRegionLayout` projects it into the engine's generic `RegionLayout`, the only place production `RenderRegion` values are built.
5. **Scene projection** — convert kernel `FloatingObject`s into `drawing-canvas` `SceneObject`s and keep the scene graph in sync (targeted patches for mutations, full rebuild for init/sheet-switch).
6. **Queries & platform bridges** — page-space cell/range bounds, hit-test classification, object bounds/scene readers for devtools, and DOM/canvas cell-style adapters that guarantee WYSIWYG between canvas cells and the in-cell editor.

The code is mature and heavily commented, and the architectural intent ("thin facade") is explicit. The improvement opportunities are concentrated in: **one file that has grown to 2844 lines and absorbed responsibilities the facade was meant to delegate**, **a self-owned dependency the facade declines to wire (silently degrading to full-dirty)**, **a documented async sheet-switch race patched at the read sites rather than the source**, **`as`-cast contract drift in scene projection**, **dead/misleading telemetry**, and **a silently-lossy hot-path dispatch**.

## Improvement objectives

1. **Decompose `grid-renderer.ts` into cohesive modules** so the facade is actually thin and the hot path is isolated and individually testable — without changing the public surface of `@mog/grid-canvas`.
2. **Wire `GridRenderScheduler` inside the facade** using dependencies the facade already owns, eliminating a leaky `as unknown as` cross-package cast and the silent full-dirty fallback when wiring is forgotten.
3. **Fix the sheet-switch scene-graph race at the source** with an epoch/generation guard, so stale-object rendering and click leaks cannot occur, and the defensive guards in `hitTest`/`isObjectOnActiveSheet` become belt-and-suspenders rather than the only protection.
4. **Make scene projection (`buildSceneObject`) cast-free** by closing the contract drift between `FloatingObject` and the scene `data` shapes, restoring the "no `as` casts" invariant the file docstring claims.
5. **Tighten invalidation precision** for the known full-dirty hot paths: the unconditional `markDirty('ui')` on every selection change, and the full `drawing`/`overlay` repaints on floating-object selection/patch.
6. **Make `GridRendererStats` honest** — wire `totalFrames`/`queueDepth` to real counters or remove them from the contract; today both are hard-coded `0`.
7. **Stop silent data loss in `updateContext()`** — detect unhandled config keys in development so a renamed/added `RenderContextConfig` field can't become a silent no-render bug.
8. **Resolve the dual coordinate-system ambiguity** (`gridCoords` vs legacy `coords`) and the misleading `setScroll()` semantics, converging query authority onto one source of truth.

## Production-path contracts and invariants to preserve or strengthen

- **`GridRenderer` contract (from `@mog-sdk/contracts/rendering`) is unchanged in signature.** Every method (`start/stop/pause/resume/dispose`, `setViewportLayout`, `setScroll/setZoom`, `updateContext`, `invalidate*`, `hitTest`, `getCellPageBounds`/`getRangePageBounds`/`getCellRenderedSize`, `boundsReader`/`sceneGraphReader`, bridge setters) keeps its current behavior. `createGridRenderer` continues to return the concrete `GridRendererImpl` subtype (so `getEngine()`/`getGridLayers()`/`getCellExpander()`/`getRenderScheduler()` stay reachable by `sheet-view`).
- **Package barrel (`src/index.ts`) export set is preserved.** Decomposition is internal; no consumer import path changes. `viewports/`, `renderer/`, and root barrels keep re-exporting the same names.
- **`updateContext()` remains allocation-free and O(1) per field.** The static dispatch table is the documented zero-allocation hot path; any refactor keeps the `for…in` + table-lookup shape and must not introduce per-call closures or allocations.
- **`viewportLayoutToRegionLayout` stays the only production constructor of `RenderRegion<GridRegionMeta>`** (enforced by lint, per its docstring). `computeViewportLayout` stays a pure function (no side effects, no caching, no mutation).
- **Dirty-hint correctness invariant:** any computed `{type:'rects'}` hint must be a superset of the actually-changed pixels; when in doubt the code falls back to `{type:'full'}`. Every precision improvement (Objective 5) must preserve "over-paint is safe, under-paint is a bug" — verified by the existing `false-dirty-prevention` / `*-dirty` suites.
- **Coordinate/scroll math semantics are byte-stable.** `compute-layout.ts`'s `viewportOrigin`/`scrollOffset`/`docOrigin` relationships (documented inline per region) and the freeze/split/overlay region geometry must not change; refactors there are cosmetic only unless an objective explicitly targets the math.
- **WYSIWYG cell-style invariant:** `getCellCanvasFont` and `getCellDOMStyle` must keep producing matching typography (font shorthand order, CJK fallback insertion, intrinsic-weight handling, `line-height = cellHeight` vertical centering). These are the source of canvas/DOM editor agreement.
- **Scene-graph read consistency:** `boundsReader`/`sceneGraphReader` remain lazy singletons over the *same* `SceneGraph` instance used for rendering, stable across `switchSheet()`.

## Concrete implementation plan

### Phase A — Decompose `grid-renderer.ts` (no behavior change)

Split the 2844-line module into a facade + focused units under `renderer/`. The facade (`grid-renderer.ts`) retains construction, layer/hit-test registration, lifecycle, the dispatch-table *wiring*, and the public methods; the moved code is imported back.

- `renderer/adapters/` — one file per data-source adapter class (`cell-data-adapter.ts`, `selection-data-adapter.ts`, `sheet-data-adapter.ts`, `collaboration-data-adapter.ts`, `trace-data-adapter.ts`, `floating-object-data-adapter.ts`, `grouping-data-adapter.ts`, `page-break-data-adapter.ts`, `overlay-data-adapter.ts`), plus `adapters/index.ts`. These are pure state holders implementing the contract interfaces; moving them is mechanical (no `this`-facade coupling — `OverlayDataAdapter` only depends on `FloatingObjectDataAdapter` + `SceneGraph`/`HitMap`, already injected).
- `renderer/scene-projection.ts` — `buildSceneObject`, `buildDiagramData`, `buildTextEffectRef`, `deriveIconLabel`, `OLE_PROG_ID_LABELS`, `GEOMETRY_FIELDS`, `POSITION_FIELDS`. These are static/pure transforms; convert the current private methods into exported pure functions (the projection test already pokes `GridRendererImpl.prototype` to reach `buildSceneObject` — see `scene-object-projection.test.ts` — and would simplify to a direct import).
- `renderer/dirty-hints.ts` — `computeSelectionDirtyHint`, `computeHeadersDirtyHint`, `selectionRangeToPixelRect`, `cellToPixelRect`, `expandRangeForMerges`. Parameterize on `positionIndex`/`mergeIndex` (already the only state they read) so they are pure and unit-testable in isolation (the `selection-dirty`/`headers-dirty` suites map directly).
- Keep `buildFieldHandlers` in the facade but consider extracting the handler *bodies* that are pure delegations into the adapters; leave the dirty-marking handlers in place (they need `this.engine`).

Acceptance for Phase A: identical exported API, all existing tests green, `grid-renderer.ts` reduced to the composition/wiring core (target < ~900 lines), no `dynamicallyDisableSandbox`-style behavior change.

### Phase B — Wire the render scheduler inside the facade (Objective 2)

In the `GridRendererImpl` constructor, immediately after creating `this.renderScheduler` (currently `grid-renderer.ts:1013`) and after `positionIndex`/`mergeIndex` are assigned (L1019–1022) and grid layers exist (`this.gridLayers.cells` is the `DirtyCellExpander`, exposed via `getCellExpander()`):

```ts
this.renderScheduler.setPositionIndex(this.positionIndex);
this.renderScheduler.setMergeIndex(this.mergeIndex);
this.renderScheduler.setCellExpander(this.getCellExpander());
```

This removes the dependency on the consumer to perform wiring through the `getRenderScheduler() as unknown as { setPositionIndex?… }` cast in `sheet-view.ts:723-729` / `viewport-wiring.ts:275-279`. The scheduler's `markCellsDirty` silent fallback to full-dirty (`grid-render-scheduler.ts:66-73`) then only triggers when callers genuinely pass no cells — not when wiring was skipped. Coordinate with the `sheet-view` owner to drop the now-redundant `expandableScheduler` cast (out-of-folder follow-up; the facade change is backward-compatible because the setters are idempotent). Add a dev-only one-time warning in `markCellsDirty` when `_positionIndex` is null at first cell-dirty call, so a regression is loud rather than a silent perf cliff.

### Phase C — Fix the sheet-switch scene-graph race at the source (Objective 3)

`switchSheet()` (L2380) clears the scene graph synchronously but `syncSceneGraph()` (L1955) is async (`await getAllObjectBounds`). During the await window the React `floatingObjects` adapter already points at the new sheet while the scene graph is empty/being-rebuilt; `hitTest`/`isObjectOnActiveSheet` (L2530, L2577) guard *clicks*, but stale objects can still *render* a frame.

- Introduce a monotonic `private sceneEpoch = 0` incremented in `switchSheet()` and `getFloatingObjects`-driven rebuilds. Capture `const epoch = ++this.sceneEpoch` before the await in `syncSceneGraph`; after the await, bail if `epoch !== this.sceneEpoch` (a newer switch superseded this rebuild), discarding late bounds instead of populating a stale graph.
- Keep the existing click guards as defense-in-depth, but they should now be unreachable for the steady state.
- Add a regression test that interleaves two `switchSheet` calls with out-of-order bounds resolution and asserts only the latest sheet's objects land in the graph.

### Phase D — Cast-free scene projection (Objective 4)

`buildSceneObject` (L1994) advertises "without any `as` casts" but uses several: `(obj as unknown as { visible?: unknown }).visible` (L2002), `obj.fill.type as 'solid' | 'gradient' | 'none'` (multiple), `obj.text?.verticalAlign as …` (L2065), `(obj.shapeType as string) === 'group'` (L1995). These mark contract drift between `@mog-sdk/contracts/floating-objects` (`FloatingObject`) and the `@mog/drawing-canvas` scene `data` shapes.

- Audit each cast; for each, either (a) add the missing field/narrowed union to the `FloatingObject` contract so the property is typed, or (b) introduce a single typed narrowing helper in `scene-projection.ts` that the contract owner blesses. The `visible` field in particular is read structurally because it isn't on the typed object — surface it on the contract.
- Where the fill-type union differs (`obj.fill.type` vs scene `'solid'|'gradient'|'none'`), align the contract enum or map exhaustively with a `switch` (compile-checked) instead of an `as`.
- This is cross-folder (touches contracts); treat it as a coordinated change and gate on `pnpm --filter @mog-sdk/contracts build` per the contracts-declaration-rollup note before consumers typecheck.

### Phase E — Tighten invalidation precision (Objective 5)

- **Selection → UI:** the `selection` handler unconditionally calls `this.engine.markDirty('ui')` (L1114) on every selection change ("ui stays full dirty for now"). Determine what the UI layer actually renders that depends on selection (fill handle, cut/copy marching ants, drag-fill chrome). If it depends only on the *active cell*/range edges, compute a UI dirty hint analogous to `computeSelectionDirtyHint`; if it depends on nothing selection-derived, drop the `markDirty('ui')` entirely. Verify against the dirty-prevention suite.
- **Floating-object selection/patch:** `floatingObjectState` (L1353) and `floatingObjectPatches` (L1374) full-dirty `drawing`+`overlay` with explicit TODOs. `applySceneGraphPatches` already computes per-object AABB rects for `drawing`; thread the same rects into the `overlay` `markDirty` (old + new handle positions) for the selection-change path so selecting one object on a many-object sheet doesn't repaint the whole drawing/overlay.
- Remove the dead `let needsFullDirty = false` in `applySceneGraphPatches` (declared L1821, only read at L1949, never assigned `true`) and rely on the `dirtyRects.length === 0` fallback, documenting that empty-rects ⇒ full as the single fallback.

### Phase F — Honest stats and lossless dispatch (Objectives 6, 7)

- **Stats:** `getStats()` returns `totalFrames: this.totalFrames` (never incremented, always 0, L965/L2653) and `queueDepth: 0`. Either increment `totalFrames` in the engine frame callback / read it from `engineStats`, and source `queueDepth` from the scheduler's pending state — or, if no consumer reads them, remove both from `GridRendererStats` (contract change, coordinate with contracts owner). Pick wiring over removal if the engine already exposes a frame counter.
- **Unhandled keys:** `updateContext` (L2392) silently ignores any `config` key without a `fieldHandlers` entry. Add a dev-only guard: on first encounter of an unknown key, `console.warn` once (deduped via a `Set`) naming the key, so a renamed/added `RenderContextConfig` field that lacks a handler surfaces immediately instead of as a silent no-render. Optionally derive a compile-time check that every required `RenderContextConfig` key has a handler.

### Phase G — Coordinate-system convergence (Objective 8)

- Document and then reduce the dual systems: `gridCoords: GridCoordinateSystem` (used to build the hit-test, L1016/1070) vs legacy `coords: CoordinateSystem` ("kept for backward compat", L1084) which `setScroll`/`setZoom`/`resize`/`getCellPageBounds` fallback/`getRangePageBounds`/`hitTest` fallback still read.
- Clarify `setScroll()` (L2361): it currently updates only the legacy `coords` and calls `markScrollDirty()`; the *actual* render scroll arrives via `setViewportLayout(layout, {invalidation:'scroll'})`. Either make `setScroll` a documented no-op-for-render bookkeeping call, or route scroll through the region-layout path so there is one authority. Migrate `getCellPageBounds`/`getRangePageBounds`/`hitTest` off the legacy `coords` where the `positionIndex` + `viewportLayout` already provide the answer (`getCellPageBounds` already prefers the layout path, L2433, and only falls back to `coords`). This is the most behavior-sensitive phase — sequence it last, behind targeted tests for split/freeze/overlay page-bounds and cross-viewport hit classification.

### Cross-cutting cleanups (low-risk, batch with the above)

- Gate the `(window as any).__OS_DEVTOOLS__` hot-path probe in `applySceneGraphPatches` (L1808) behind a typed dev hook to remove the `any` cast and the per-call array allocation when devtools is absent (it already short-circuits to `null`, but the typing is loose).
- Decide whether `viewports/compute-layout.ts` (and its `types.ts`/`scroll.ts` shims) should move into `@mog/grid-renderer` alongside `computeVisibleRange`/`computeFrozenRange`/scroll (all re-exported *from* grid-renderer today). Record the boundary decision; if it stays, delete the shim indirection by importing contracts directly. (Decision only in this plan; not a blind move.)
- Implement or remove `getClippedCellContent` (L2662) — currently a `TODO` stub returning `null`, so overflow-cell tooltips don't work through this contract method. `CellsLayer` tracks clipped cells; expose it or drop the method from the contract.
- Consider correcting `computeContentSize` (L144) scrollbar drift: it estimates `totalRows * DEFAULT_ROW_HEIGHT` ignoring custom sizes. Use the `positionIndex` accumulated custom-size delta (if O(1)-available) to correct the estimate without O(n) iteration.

## Tests and verification gates

- **Preserve existing suites green at every phase:** `renderer/__tests__/{false-dirty-prevention,headers-dirty,scene-object-projection,scroll-dirty,selection-dirty,update-object-bounds,viewport-to-region-layout}.test.ts` and `viewports/__tests__/compute-layout.test.ts`. Phase A must not change any assertion.
- **Phase A:** add a barrel/exports snapshot test (or rely on `tsc --noEmit` via `pnpm --filter @mog/grid-canvas check-types`) proving the public API is unchanged after the split. Re-point `scene-object-projection.test.ts` to import the extracted pure `buildSceneObject` (simpler than the current prototype-poking).
- **Phase B:** unit test that a freshly constructed `GridRendererImpl` returns a scheduler whose `markCellsDirty([{row,col}])` produces a `{type:'rect'/'rects'}` hint (not full-dirty), proving in-facade wiring; and that the dev warning fires when the position index is absent.
- **Phase C:** the interleaved-sheet-switch epoch test described in Phase C; assert no stale-sheet object renders or hit-routes after a superseding switch.
- **Phase D:** rely on `tsc` after removing the casts; add projection tests for each `FloatingObject` variant (picture/textbox/shape/connector/chart/equation/drawing/oleObject/diagram) confirming the `data` shape and that `formControl`/`shape:group` still project to `null`.
- **Phase E:** extend the dirty-prevention suites to assert (a) selection-only changes no longer mark `ui` full-dirty (or mark only the computed UI rect), and (b) single-object selection on a multi-object sheet yields per-object overlay rects, not full. Maintain the over-paint-safe invariant: add a property-style check that the union of emitted rects covers the changed cells.
- **Phase F:** test that `getStats().totalFrames` advances after frames (if wired) and that `updateContext({someUnknownKey})` warns once in dev and is a no-op in prod.
- **Phase G:** golden tests for `getCellPageBounds`/`getRangePageBounds` under single/freeze/split/overlay and zoom ≠ 1, and `hitTest` classification across viewport seams, before and after migrating off legacy `coords`.
- **Gates:** `pnpm --filter @mog/grid-canvas typecheck` and `pnpm --filter @mog/grid-canvas test` must pass each phase; for Phase D also `pnpm --filter @mog-sdk/contracts build` before consumer typecheck. (Per task constraints these commands are listed as the verification gates for whoever executes the plan; this planning pass does not run them.) Add a manual app-eval smoke (scroll, freeze, split, select range, select/drag a shape, switch sheets rapidly) to confirm no visual regressions, since dirty-rect bugs are often invisible to unit tests.

## Risks, edge cases, and non-goals

- **Decomposition is the highest-churn, lowest-semantic-risk phase** — the main risk is accidental behavior change via lost `this` binding or import cycles between `adapters/` and the facade. Mitigate by moving pure state classes first, keeping `engine`-touching handlers in the facade, and gating on the unchanged-API snapshot.
- **Phase G (coordinate convergence) is the highest behavioral risk.** Two coordinate sources have subtle divergences across freeze/split/overlay; migrating queries can shift page-bounds by header/gutter offsets. Sequence last, behind golden tests, and keep the legacy `coords` fallback until the layout path is proven for every configuration.
- **Phase E under-paint risk:** narrowing `ui`/`overlay` dirty regions can leave stale chrome (marching ants, handles) if a rect is too small. The invariant "over-paint safe, under-paint bug" governs; prefer slightly-larger rects and verify with the dirty-prevention suite plus manual smoke.
- **Phase D is cross-package:** changing `FloatingObject`/scene contracts can ripple to other consumers; coordinate with the contracts owner and rebuild contracts declarations first.
- **Hot-path regression risk:** `updateContext` runs 50–200+ times/sec. The unknown-key dev warning and any added bookkeeping must be dev-gated / allocation-free in prod.
- **Async API surface:** `getFloatingObjectBounds`/`getAllObjectBounds` may return promises; the epoch guard must handle both sync and async resolution paths (matching the existing `instanceof Promise` handling at L1962).
- **Non-goals:** no change to drawing/layer/engine internals (those live in sibling packages and have their own plans); no new public `GridRenderer` methods beyond possibly removing dead stats; no rewrite of `computeViewportLayout` math; no migration of `compute-layout.ts` out of the package in this plan (decision only); no styling/theme redesign; no test-only shims.

## Parallelization notes and dependencies on other folders

- **Independent, can start immediately:** Phase A (decomposition), Phase F's unhandled-key warning, the dead-variable and devtools-typing cleanups — all internal to `mog/canvas/grid-canvas/src`.
- **Depends on `@mog-sdk/contracts` (cross-folder, coordinate with that owner):** Phase D (FloatingObject/scene shape alignment) and any `GridRendererStats` contract change in Phase F. Build contracts declarations before consumer typecheck (see `[[mog-contracts-declaration-rollup]]`).
- **Depends on / coordinates with `mog/views/sheet-view`:** Phase B (the consumer's `expandableScheduler` cast in `viewport-wiring.ts` becomes redundant once the facade self-wires) and Phase G (sheet-view owns `engine.start()` and scroll-position management; confirm no double-wiring). The facade change is backward-compatible, so it can land before the consumer cleanup.
- **No dependency on `@mog/grid-renderer`/`drawing-canvas`/`canvas-overlay` internals** for any phase except the optional `compute-layout` relocation decision (which would be a separate, jointly-owned move).
- **Internal phase ordering:** A → (B, C, D, E, F in parallel) → G last. Phase A unblocks the others by isolating each concern into its own file, reducing merge contention; G is gated behind the golden coordinate tests that the other phases don't touch.
