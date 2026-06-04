# Plan 047 — Harden `mog/canvas/drawing/engine/src` (drawing object layout, grouping, z-order, rendering)

## Source folder and scope

- **Folder:** `mog/canvas/drawing/engine/src`
- **Package:** `@mog/drawing-engine` (`mog/canvas/drawing/engine`, version `0.1.0`, `private: true`, `"type": "module"`)
- **Subpath exports today:** `.` (barrel → `src/index.ts`), `./canvas` (`renderer/canvas.ts`), `./hit-test` (`renderer/hit-test.ts`), `./svg` (`renderer/svg.ts`).
- **Files in scope (4,024 LOC across 26 files):**
  - **Z-order** — `z-order/z-order-manager.ts` (`sortByZOrder`, `bringToFront`/`sendToBack`/`bringForward`/`sendBackward`, `normalizeZOrder`, `insertAtZIndex`, `removeFromZOrder`).
  - **Grouping** — `grouping/group-manager.ts` (hierarchy: `createGroup`, `ungroup`, `getGroupMembers`, `getTopLevelGroup`, `validateGroupHierarchy`), `grouping/group-operations.ts` (`resolveSelectionTarget`, `computeGroupBounds`).
  - **Spatial** — `spatial/spatial-query.ts` (`hitTest`, `selectInRect`, `findNearby`, `findOverlapping`), `spatial/selection.ts` (immutable `SelectionState` ops).
  - **Anchor** — `anchor/anchor-types.ts` (`CellDimensionLookup`, `Anchor` union), `anchor/anchor-resolver.ts` (`resolveAnchor`/`resolveAnchorPoint`, `positionToAnchor`, `boundsToTwoCellAnchor`), `anchor/resize-with-cells.ts`.
  - **Layout** — `layout/snap.ts` (`snapToGrid`, `snapToObjects`), `layout/align.ts`, `layout/distribute.ts`.
  - **Renderer** — `renderer/canvas.ts` + `renderer/svg.ts` orchestrators; `renderer/path.ts`, `renderer/fills.ts`, `renderer/strokes.ts`, `renderer/hit-test.ts` primitives; `renderer/effects/{canvas,svg,utils,index}.ts`.
  - **Diagnostics** — `diagnostics/{anchor-diagnostics,reporters,validators,index}.ts`.
- **Dependencies (production):** `@mog/canvas-engine` (`parseHex`, `computeLinearGradientEndpoints`), `@mog/geometry` (`PathOps`, `Rect`, `pointInRect`, `rectContains`, `distanceToRect`), `@mog-sdk/contracts` (`DrawingObject`, `DrawingFill`, `DrawingStroke`, `Path`, `BoundingBox`, `Point2D`). Dev-only: `@mog/shape-engine`.
- **Charter as written (`src/index.ts` header):** *"Standalone drawing composition engine for floating objects … Pure computation: no DOM, no Canvas, no React, no Yjs."* This charter is **factually false for the `renderer/` subtree** (see finding 1) and is the central contract this plan must reconcile.
- **Known consumers (must not break):** `mog/kernel/src/domain/drawing/spatial-operations.ts` (the pure bridge wrapping z-order/grouping/hit-test/anchor/align/distribute), `mog/canvas/drawing-canvas/src/renderers/shape.ts`, `mog/file-io/pdf/graphics/src/drawing-renderer.ts`, `mog/apps/spreadsheet/src/systems/objects/coordination/object-coordination.ts`, `mog/canvas/drawing/diagram/src/gallery/preview-generator.ts`, `mog/apps/spreadsheet/.../TextEffectsGallery.tsx`, plus ink/text-effects/diagram integration tests.

## Current role of this folder in Mog

This package is the **engine-agnostic composition and rendering core for floating drawing objects** (shapes, equations, ink, text-effects, diagrams) on a spreadsheet sheet. It deliberately knows nothing about specific object engines or about the kernel's CRDT/Yjs store — it receives pre-resolved data and returns pure results that the kernel persists. It owns six concerns:

1. **Z-order** — per-sheet stacking order as `{id, zIndex}` arrays; the kernel persists the returned `zIndex` values.
2. **Grouping** — a two-map hierarchy (`groups: groupId→GroupInfo`, `parentOf: objectId→groupId`) supporting nested groups, with single-click-selects-group / double-click-drills-in semantics.
3. **Spatial queries** — hit testing (broad-phase AABB + optional Canvas2D narrow-phase), rubber-band selection, proximity, overlap.
4. **Anchoring** — OOXML-style `absolute`/`oneCell`/`twoCell` anchors resolved to pixel boxes via a `CellDimensionLookup` the bridge supplies; reverse resolution (pixels→anchor) and resize-with-cells recompute.
5. **Layout** — grid snap, object-to-object snap with guides, align, distribute.
6. **Rendering** — Canvas2D and SVG orchestrators that compose path/fill/stroke/effect primitives into a full `DrawingObject` render, plus pixel-accurate hit-test path construction.

It sits below `@mog/canvas` consumers and above `@mog/geometry`/`@mog-sdk/contracts`. The kernel bridge (`spatial-operations.ts`) is the canonical pure entry point for layout/z-order/grouping; `drawing-canvas` and `pdf/graphics` consume the renderer directly.

### Evidence-backed problems found

1. **The package's stated purity charter is violated by its own renderer subtree.** `src/index.ts:10` declares *"no DOM, no Canvas"*, yet `renderer/canvas.ts` takes a `CanvasRenderingContext2D`, `renderer/hit-test.ts:23` constructs `new DOMMatrix(...)` / `new DOMPoint(...)` / `new Path2D(...)`, `spatial/spatial-query.ts` accepts a live `ctx` in `HitTestNarrowPhaseOptions`, and `renderer/effects/canvas.ts` uses offscreen-canvas compositing. So the barrel re-exports DOM-bound functions from a package advertised as pure. There is **no environment guard**: importing `@mog/drawing-engine` in a non-DOM context (a worker without `OffscreenCanvas`, a Node SSR/test path, the PDF pipeline) and calling a renderer throws a `ReferenceError` at runtime rather than failing at a typed boundary. The two halves (pure compute vs. environment-bound render) are not separated in the type system or the export map.

2. **The `spatial/` module has no spatial index — every query is a full linear scan, re-run per pointer event.** `hitTest` does `[...objects].sort((a,b)=>b.zIndex-a.zIndex)` (an O(n log n) copy+sort) **on every call**, then a linear walk; `findNearby`, `findOverlapping`, and `selectInRect` are each O(n) full scans. Hit testing runs on every `pointermove` during hover/drag, so on a sheet with many objects this is O(n log n) per mouse event with per-call allocation. A folder literally named `spatial` maintains no broad-phase acceleration structure (uniform grid / R-tree) and no incrementally-maintained z-sorted view.

3. **Renderer ships visibly wrong or empty output for several declared `DrawingObject` features.** These are not hypothetical — they are coded fallbacks:
   - **Text is never drawn.** `renderer/canvas.ts:120` leaves text rendering commented out; a `DrawingObject` carrying text renders fill/stroke only. Any shape with a text body (callouts, labeled diagram nodes) renders blank text on canvas.
   - **Reflection effect unimplemented** (`renderer/canvas.ts:116`) despite `DrawingEffects.reflection` existing in the contract.
   - **Pattern fills collapse to a flat foreground color** in both renderers (`fills.ts:105`, `fills.ts:188`) — patterns lose their tile entirely.
   - **Image fills are dropped on canvas** (`fills.ts:111` is a bare `break`) and become `fill:none` in SVG (`fills.ts:191`) — picture-filled shapes render empty.
   - **Compound strokes are wrong.** `strokes.ts:33` renders `double`/`thickThin`/`thinThick`/`triple` all as a *single* thinner line; `thickThin` and `thinThick` are even identical (both `width*0.6`). Bordered shapes with compound outlines look like thin single lines.
   - **Gradient stop opacity ignores non-hex colors.** `fills.ts:applyStopOpacity` only blends alpha when `parseHex` succeeds; named/`rgb()` stop colors silently lose their per-stop opacity.

4. **Canvas and SVG renderers compute linear-gradient geometry by two different formulas, so the same object renders differently in the two backends.** Canvas (`fills.ts:55`) calls `computeLinearGradientEndpoints(cx, cy, w, h, rad)` from `@mog/canvas-engine`; SVG (`fills.ts:148`) instead projects onto a normalized `objectBoundingBox` with `0.5 ± cos/sin*0.5`. These are not guaranteed to agree (the canvas path is aspect-ratio aware in pixel space; the SVG path is in unit box space), so a gradient previewed on canvas can disagree with the SVG/PDF export of the same shape. There is no shared single source of truth for gradient endpoints and no test asserting cross-backend parity.

5. **Hit testing re-parses geometry into a `Path2D` on every test.** `renderer/hit-test.ts:47` → `pathToPath2D` (`path.ts:61`) → `PathOps.pathToSvgString(path)` then `new Path2D(svgString)`. So each `isPointInDrawingObject` call serializes the path to an SVG `d` string and re-parses it through the browser. During a hover/drag over overlapping objects this runs per candidate per event. There is no `Path2D` (or transformed-`Path2D`) cache keyed by object identity/geometry version.

6. **`computePathBounds` is deliberately loose (control-point hull), inflating every downstream consumer.** `path.ts:102` includes bezier **control points** in the min/max. The comment admits *"conservative … the true tight bounds could be smaller."* Those loose bounds feed (a) the SVG `viewBox` (`svg.ts:106`) — so exported SVGs have wrong/oversized framing for curved shapes — and (b) any broad-phase culling, widening the false-positive band for hit tests on curved geometry. Tight bezier bounds (solving the derivative roots) are standard and cheap.

7. **The transform↔AABB contract is unstated and unenforced, so rotated objects can be mis-hit.** `SpatialObject.bounds` is an axis-aligned box, but `DrawingObject.transform` can rotate/shear. `hitTest` culls with `pointInRect(point, obj.bounds)` (`spatial-query.ts:72`) *before* the transform-aware narrow phase (`hit-test.ts:71` inverse-transforms the point). If the caller stored a *pre-transform* AABB, a click on a rotated shape's true extent that lies outside the un-rotated box is culled before narrow-phase ever runs — a missed hit. Whether `bounds` must be the post-transform AABB is documented nowhere and checked nowhere.

8. **Group bounds drift: `GroupInfo.bounds` is captured once and never recomputed.** `createGroup` (`group-manager.ts:75`) stores the bounds passed in; no operation updates them when members move/resize. `computeGroupBounds` exists in `group-operations.ts` but operates on caller-supplied member bounds and never writes back into the hierarchy. So `validateGroupHierarchy` can pass while `GroupInfo.bounds` is stale relative to the members it contains — a latent correctness bug for any consumer that trusts the stored group box (selection overlay, group drag).

9. **The z-order invariant is self-contradictory across the module.** `bringToFront`/`sendToBack`/`bringForward`/`sendBackward`/`removeFromZOrder` all funnel through `normalizeZOrder`, which guarantees **contiguous `[0..n)`**. But `insertAtZIndex` (`z-order-manager.ts:169`) shifts and appends *without* normalizing, producing gapped/over-range indices — and `diagnostics/validators.ts:validateZOrder` then emits `DRAWING_ZORDER_GAP` **warnings** for exactly that state. One module function routinely produces a state another module function warns about; there is no single declared post-condition. `bringToFront` also assigns `maxZ + 1` before normalizing, briefly exceeding `n-1`.

10. **`positionToAnchor` hard-codes grid maxima and assumes an O(1) lookup it may not get.** `anchor-resolver.ts:90` binary-searches columns over `[0, 16384)` and rows over `[0, 1048576)` as inline literals (the spreadsheet grid limits, duplicated here with no link to the contract that defines them). Each binary-search step calls `getColLeft`/`getColWidth`/`getRowTop`/`getRowHeight`; if the bridge's `CellDimensionLookup` is itself O(index) (prefix sum without caching), `positionToAnchor` is O(n log n) per call. The monotonicity precondition (left edges strictly increasing) that the binary search *requires* is undocumented, and negative inputs are silently clamped (`Math.max(0, …)`), which can map an off-grid object to `(row 0, col 0)` without signaling.

11. **`snapToObjects` is O(objects × alignment-candidates) with array `splice` per match and no early-out.** `layout/snap.ts:96` loops all other objects, builds two 5-element candidate arrays each iteration, and `findIndex`+`splice`es the guides array on every improving match. For a drag against many neighbors this re-allocates per frame. There is also no axis-bucketing to skip objects that cannot possibly align.

12. **No test directory covers several of these paths and there is a build/freshness hazard.** A `__tests__/` tree exists (renderer, anchor, z-order, grouping, layout, spatial, diagnostics, integration), but there is **no** test asserting canvas/SVG gradient parity, compound-stroke fidelity, transform-aware broad-phase, group-bounds freshness, or the z-order post-condition. The package also ships a committed `dist/` and a 79 KB `tsconfig.tsbuildinfo`, and its `exports` map serves `dist/*.js` for the `import` condition while `src/*` for `development` — so a stale `dist` (the engine is consumed by `pdf/graphics` and `drawing-canvas`) can silently ship behavior that diverges from `src`.

## Improvement objectives

1. **Make the purity contract true and typed.** Cleanly separate the **environment-free compute core** (z-order, grouping, spatial math, anchor, layout, selection, diagnostics) from the **environment-bound renderer** (anything touching `CanvasRenderingContext2D`/`DOMMatrix`/`Path2D`/`OffscreenCanvas`), expressed in the export map and the package header, with explicit capability detection at the render boundary instead of raw `ReferenceError`s.
2. **Add a real broad-phase spatial index** so hit testing, rubber-band, proximity, and overlap are sub-linear per query and per-event allocation is eliminated, while keeping the existing pure function signatures working for small/ad-hoc inputs.
3. **Close the renderer fidelity gaps** that ship visibly wrong output: compound strokes, pattern/image fills, gradient cross-backend parity, gradient-stop opacity for all color formats; and define the contract for the still-deferred features (text, reflection) so they are explicit capability gaps, not silent blanks.
4. **Strengthen and unify the structural invariants** — one declared z-order post-condition; live (or explicitly recomputed) group bounds; a documented and enforced transform↔AABB contract for `SpatialObject`.
5. **Make anchor resolution robust and configurable** — grid limits sourced from the contract, documented monotonicity precondition, signaled (not silently clamped) off-grid inputs, and a lookup-cost contract.
6. **Lock the gains with verification gates** — cross-backend render parity tests, geometry-bounds tightness tests, invariant property tests, and a performance regression guard for the spatial index — without weakening any existing public signature.

## Production-path contracts and invariants to preserve or strengthen

**Preserve (public API — these have external consumers; do not break signatures):**
- The `spatial-operations.ts` bridge surface: `bringToFront`/`sendToBack`/`bringForward`/`sendBackward`/`normalizeZOrder`/`sortByZOrder`, `createGroup`/`ungroup`, `hitTest`/`selectInRect`, `resolveAnchor`, `snapToGrid`, `alignObjects`/`distributeObjects`, and all re-exported types (`Anchor`, `CellDimensionLookup`, `GroupHierarchy`, `SnapResult`, `SpatialObject`, `ZOrderedItem`, `AlignType`, `DistributeType`). These return values the kernel persists — output shapes must stay stable.
- The renderer entry points used by `drawing-canvas` and `pdf/graphics`: `renderDrawingObjectToCanvas`, `renderDrawingObjectToSVG`, `isPointInDrawingObject`/`buildHitTestPath`, and the primitive exports (`renderFillToCanvas`, `fillToSVGAttributes`, `renderStrokeToCanvas`, `strokeToSVGAttributes`, `replayPathToCanvas`, `pathToPath2D`, `computePathBounds`) and all effect exports.
- Purity of the compute core: no DOM/Canvas/React/Yjs/`Date.now`/`Math.random` may enter z-order, grouping, spatial math, anchor, layout, selection, diagnostics. `createGroup` already takes an injected `idGenerator` — keep that pattern for any new ID/time needs.
- Immutability: all operations return new objects/arrays; no in-place mutation of inputs.

**Strengthen (make explicit and enforced):**
- **Z-order post-condition:** declare that the canonical stored state is contiguous `[0..n)` with stable tiebreak, make `insertAtZIndex` normalize to it, and reclassify `validateZOrder`'s gap finding to match the declared invariant (it should never fire for engine-produced output).
- **Group-bounds invariant:** `GroupInfo.bounds` must equal `computeGroupBounds(members)`; either recompute on every membership/position change or remove the stored field in favor of on-demand computation. `validateGroupHierarchy` gains a `staleBounds` check.
- **Transform↔AABB contract:** document and (in `validateZOrder`/a new validator, dev-only) check that `SpatialObject.bounds` is the **post-transform** AABB; have the renderer expose a helper (`computeRenderedBounds(obj)`) that callers use to populate it.
- **Anchor monotonicity precondition** and **off-grid signaling** documented on `CellDimensionLookup` and `positionToAnchor`.
- **Cross-backend render parity:** linear-gradient endpoints, stroke dash arrays, and fill semantics must derive from one shared helper used by both canvas and SVG.

## Concrete implementation plan

### Phase 1 — Reconcile the purity contract (structural, no behavior change)
1. Rewrite the `src/index.ts` header to state the truth: a pure compute core plus an explicitly environment-bound renderer; the barrel's renderer re-exports require a DOM/Canvas2D-capable host.
2. Introduce a `./compute` (or keep `.`) export that is provably DOM-free and a `./renderer` export grouping the environment-bound surface; keep the existing `./canvas`, `./hit-test`, `./svg` subpaths as-is for current consumers. No function moves files yet beyond what the export map needs — this phase is contract clarification.
3. Add a single capability guard used by every renderer entry (`assertCanvas2DAvailable()` / `assertSvgStringHost()` is trivial) that throws a typed, descriptive error (`DrawingRendererUnavailableError` with the missing primitive) instead of a bare `ReferenceError`, so the PDF/worker paths fail legibly.

### Phase 2 — Spatial index (objective 2)
4. Add `spatial/spatial-index.ts`: a broad-phase structure (start with a uniform grid keyed by AABB; interface-compatible so an R-tree can replace it) with `insert/remove/update/queryPoint/queryRect/queryRadius`. Maintain an incrementally-sorted z-view so `hitTest` no longer copies+sorts per call.
5. Rework `hitTest`/`selectInRect`/`findNearby`/`findOverlapping` to accept **either** the existing `SpatialObject[]` (small-input fast path, behavior preserved) **or** a `SpatialIndex` instance. Keep the array overloads exactly as they are for the bridge; add index-backed overloads. The bridge (`spatial-operations.ts`) can opt into the index later — no required change there.
6. Enforce the transform↔AABB contract (objective 4): broad-phase queries use post-transform AABBs; add `computeRenderedBounds(obj)` in the renderer and document that index entries must use it.

### Phase 3 — Renderer fidelity (objective 3)
7. **Compound strokes:** implement true multi-pass offset rendering for `double`/`triple`/`thickThin`/`thinThick` in both canvas (`strokes.ts`) and SVG (`strokeToSVGAttributes` → multiple stroke passes / paint-order), distinguishing `thickThin` from `thinThick`.
8. **Pattern fills:** build a `CanvasPattern` from a rendered tile on canvas and an SVG `<pattern>` def in SVG; remove the flat-foreground fallback.
9. **Image fills:** accept a pre-resolved image source map (callers already load images) and draw/clip on canvas; emit `<image>`/`<pattern>` in SVG. Where no source is supplied, render a typed placeholder rather than a silent blank.
10. **Gradient parity (objective 6):** extract one `linearGradientEndpoints`/`radialGradientGeometry` helper (canvas uses pixel space, SVG converts the *same* result into `objectBoundingBox` space) so both backends agree; route `applyStopOpacity` through a full color parser (extend `@mog/canvas-engine` color parsing or parse `rgb()/rgba()/named` here) so per-stop opacity works for all formats.
11. **Tight path bounds (objective; finding 6):** replace `computePathBounds` control-point hull with true bezier extrema (cubic/quadratic derivative roots). Update SVG `viewBox` to use the tight bounds.
12. **Text & reflection:** keep deferred but make them *explicit* — return/emit a typed `unsupportedFeature` diagnostic (via `diagnostics/`) when a `DrawingObject` carries text or reflection that the renderer cannot draw, so consumers can detect the gap instead of shipping a blank. (Full text layout is out of scope for this folder — see non-goals.)

### Phase 4 — Hit-test performance (finding 5)
13. Cache the `Path2D` (and the transformed `Path2D`) per object keyed by geometry identity + transform, invalidated when geometry/transform changes. `buildHitTestPath`/`isPointInDrawingObject` consult the cache; `pathToPath2D` stays as the uncached primitive.

### Phase 5 — Invariant unification (objective 4, findings 8–9)
14. **Z-order:** declare the contiguous-`[0..n)` post-condition in `z-order-manager.ts`; make `insertAtZIndex` normalize; ensure `bringToFront`/`sendToBack` return normalized output (already do via `normalizeZOrder`). Reclassify `validateZOrder` gap detection so it flags only genuinely external/corrupt input, never engine output.
15. **Group bounds:** add `recomputeGroupBounds(hierarchy, memberBounds)` that refreshes every `GroupInfo.bounds`, call it from `createGroup`/`ungroup`, and add a `staleBounds` issue code to `validateGroupHierarchy`/`validateGroups`.

### Phase 6 — Anchor robustness (objective 5, finding 10)
16. Source grid limits (`16384`/`1048576`) from `@mog-sdk/contracts` (or a named constant in `anchor-types.ts`) instead of inline literals.
17. Document the strict-monotonic precondition on `CellDimensionLookup` and the binary searches; replace the silent negative clamp with an explicit policy (clamp + a returned/traced flag, surfaced through `diagnostics/anchor-diagnostics.ts`).
18. Document the lookup-cost contract (callers should supply an O(1)/cached `CellDimensionLookup`); `traceAnchorResolution` already aids debugging — extend it to record search iterations when a trace is requested.

### Phase 7 — `snapToObjects` efficiency (finding 11)
19. Bucket candidate objects by axis proximity before the alignment loop and track the single best guide per axis without `splice`, eliminating per-frame array churn.

## Tests and verification gates

> Per task constraints, this worker does not run builds/tests. The following are the gates the implementing change must add/pass; they live in the package's existing `__tests__/` tree and run via the package `test` (jest) + `typecheck` scripts.

1. **No public-signature regression:** existing `__tests__/{z-order,grouping,layout,spatial-query,selection,anchor-resolver,diagnostics}.test.ts` and `__tests__/renderer/*` + `__tests__/integration/*` continue to pass unchanged. The bridge (`mog/kernel/.../spatial-operations.ts`) and its tests stay green.
2. **Purity gate:** a test (or lint rule) asserts the compute-core entry points import nothing from DOM/Canvas; importing the compute subpath in a Node environment without any DOM shim succeeds, and calling a renderer there throws the **typed** `DrawingRendererUnavailableError`, not `ReferenceError`.
3. **Spatial index:** property tests asserting index-backed `hitTest`/`selectInRect`/`findNearby`/`findOverlapping` return identical results to the linear reference implementation over randomized object sets (including rotated objects with post-transform AABBs); a perf guard asserting per-query work does not grow linearly with object count past a threshold.
4. **Render fidelity:** golden/structural tests for compound strokes (all four styles distinct), pattern fills (tile present), image fills (drawn or typed placeholder), and gradient-stop opacity across hex/`rgb()`/named colors.
5. **Cross-backend parity:** a test asserting canvas and SVG linear-gradient endpoints derive from the shared helper and agree within tolerance for representative aspect ratios/angles.
6. **Tight bounds:** `computePathBounds` returns mathematically tight bounds for cubic/quadratic curves (compared against sampled-point extrema within tolerance); SVG `viewBox` matches.
7. **Invariants:** property test that every z-order op (incl. `insertAtZIndex`) yields contiguous `[0..n)` and `validateZOrder` reports no gap/duplicate for engine output; test that `GroupInfo.bounds` equals `computeGroupBounds(members)` after create/ungroup/member-move and that `validateGroupHierarchy` flags injected stale bounds.
8. **Anchor:** tests for non-uniform/monotonic dimension lookups, off-grid (negative) inputs producing the documented signal, and grid-limit boundary indices.
9. **Type/build gate:** `tsc --noEmit` clean; do **not** commit a refreshed `dist/`/`tsconfig.tsbuildinfo` as part of behavior review — treat `dist` as a build artifact (see risks).

## Risks, edge cases, and non-goals

**Risks / edge cases:**
- **Stale `dist/` shipping divergent behavior.** The `exports` map serves `./dist/*.js` for the `import` condition; consumers like `pdf/graphics` may resolve `dist`. Any renderer change must be accompanied by a rebuilt `dist` in the normal build pipeline — otherwise `src` and shipped behavior diverge. (This plan does not edit `dist`; it flags the hazard for the implementer/CI.)
- **Compound-stroke and pattern/image work changes pixels**, so existing pixel-golden tests (if any) and PDF exports must be re-baselined deliberately, with visual diff review.
- **Spatial-index overloads must not change small-input results** — keep the linear path as the reference oracle and the default for ad-hoc arrays.
- **Tight bounds shrink AABBs**, which could expose latent callers that relied on the old loose box as padding (e.g. selection overlays); audit `drawing-canvas` overlay code when changing bounds.
- **Transform contract enforcement could start rejecting** index entries that previously passed; gate the validator to dev/diagnostic mode, not the hot path.
- **`OffscreenCanvas`/`Path2D` availability** differs across worker/SSR/test hosts — the capability guard must degrade legibly, and pattern-tile rendering must have a non-offscreen fallback.

**Non-goals:**
- Full rich-text layout/shaping for in-shape text — that belongs to a text-layout subsystem, not this composition engine; this plan only makes the gap explicit and diagnosable.
- Implementing reflection compositing — declared a typed capability gap here; defer the actual off-screen compositor.
- Changing the kernel/Yjs persistence model, the `CellId→{row,col}` translation (lives in the bridge), or any contract types beyond additive invariant/diagnostic codes.
- Reduced-scope/test-only patches or compatibility shims — all changes are production-path with preserved public signatures.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable within this folder:** Phase 5 (invariants), Phase 6 (anchor), Phase 7 (snap) touch disjoint compute files (`z-order/`, `grouping/`, `anchor/`, `layout/`) and can proceed concurrently with the renderer work (Phase 3/4) and the spatial index (Phase 2).
- **Phase 1 (export-map/contract split) should land first** since later phases reference the compute/renderer boundary, but it is mechanical and low-risk.
- **Cross-folder coordination:**
  - `@mog/canvas-engine` — gradient endpoint + color parsing helpers (objective 6/finding 4,10) may need a shared/extended utility there; coordinate to avoid duplicating color parsing.
  - `@mog-sdk/contracts` — grid limits constant and any new diagnostic codes (`staleBounds`, `unsupportedFeature`) are additive; per the contracts declaration-rollup note, editing contract types requires `pnpm --filter @mog-sdk/contracts build` before consumers typecheck (out of scope to run here, but a dependency for the implementer).
  - `mog/kernel/src/domain/drawing/spatial-operations.ts` — the bridge is the canonical pure consumer; the index overloads are designed so the bridge needs **no** change, but adopting the index there is a follow-up.
  - `mog/canvas/drawing-canvas` and `mog/file-io/pdf/graphics` — direct renderer consumers; re-baseline their visual/PDF outputs after Phase 3/4 and audit overlay code after the tight-bounds change.
- **No dependency on, and no edits to, any folder outside `mog/canvas/drawing/engine/src`** for the core of this plan; cross-folder items above are coordination points, not prerequisites for the in-folder compute/invariant work.
