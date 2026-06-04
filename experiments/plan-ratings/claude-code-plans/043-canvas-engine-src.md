# 043 — Improve `mog/canvas/engine/src`

## Source folder and scope

- **Folder:** `mog/canvas/engine/src` (npm package `@mog/canvas-engine`, version `0.1.0`, private)
- **In scope:** the generic, zero-domain canvas infrastructure that lives in this folder:
  - `engine.ts` — `createCanvasEngine` factory wiring all components
  - `index.ts` — public barrel exports
  - `core/types.ts` — engine-wide types (`CanvasLayer`, `RenderRegion`, `DirtyHint`, `RenderScheduler`, branded coordinate rects, `RenderPriority`, etc.)
  - `core/coordinate-space.ts` — canonical doc⇄canvas transform
  - `core/dirty-rect-accumulator.ts` — per-layer dirty region accumulation
  - `loop/render-loop.ts` — rAF render loop, dirty-rect caching, error boundary
  - `scheduler/priority-scheduler.ts` — priority task queue + dynamic shedding
  - `registry/layer-registry.ts` — layer registration, z-order, dirty facade
  - `host/canvas-host.ts` — multi-canvas stacking, DPR, resize
  - `input/input-capture.ts` — pointer/wheel capture, cursor manager, hit-test dispatch
  - `state/effective-state-manager.ts` — optimistic drag/resize state
  - `gpu/memory-detection.ts` — multi-vs-single canvas GPU memory heuristic
  - `geometry/transform-math.ts`, `geometry/gradient-math.ts` — pure resize/rotation/gradient math
  - `utils/snap.ts`, `utils/color-utils.ts`, `utils/text-measurer.ts`
- **Out of scope:** consumers in `canvas/grid-renderer`, `canvas/overlay`, `canvas/drawing-canvas`, `views/sheet-view`, and `kernel` bridges. These are referenced only to establish contracts and migration impact; their code is not modified by this plan.

## Current role of this folder in Mog

`@mog/canvas-engine` is the **generic rendering substrate** beneath every canvas surface in Mog. It deliberately carries *zero domain knowledge* (no cell/row/col/sheet concepts) and is consumed by:

- `canvas/grid-renderer` — registers `BaseLayer`-derived layers (background, cells, selection, headers, dividers, UI, cursors) and drives the engine via `createCanvasEngine`.
- `canvas/overlay` and `canvas/drawing-canvas` — reuse `DirtyRectAccumulator`, coordinate-space helpers, and transform math.
- `kernel/src/bridges/compute/*` — depend on the `RenderScheduler` **interface** (the "Write = Invalidate" contract `markCellsDirty` / `markGeometryDirty` / `markAllDirty`), injected from the view layer (`views/sheet-view/src/viewport-wiring.ts`).

The engine owns: the single rAF loop; z-index-first layer iteration interleaving `per-region` and `once` layers; per-layer off-screen cache compositing with partial (dirty-rect) repaint; a per-layer error boundary with exponential backoff; DPR and resize handling deferred to the render frame; GPU-memory fallback to single-canvas mode; pointer/wheel capture with top-down hit-test dispatch; and the canonical `doc⇄canvas` coordinate transform that all layers must route through.

The code is well-structured and heavily commented, with branded coordinate-space rects (`DocSpaceRect`, `CanvasSpaceRect`, `RegionLocalRect`, `PhysicalRect`) enforcing the canonical formula. The improvement objectives below target concrete correctness, performance, and contract-integrity gaps found by reading the source and tracing consumers — not a rewrite.

## Improvement objectives

1. **Remove dead scheduling infrastructure / restore its intended contract.** `PriorityScheduler.schedule()` has **zero callers anywhere in the repo** (verified: `rg "scheduler\.schedule\(|PriorityScheduler"` outside the engine returns nothing). The render loop calls `processFrame()` on an always-empty queue every frame, and `getStats()` derives `fps` / `averageFrameTime` / `maxFrameTime` *solely from that empty processing*, so engine FPS telemetry is meaningless. Either wire the scheduler to the live invalidation path or excise the priority/shedding apparatus and fix the stats source. (Production path — not a test-only or shim fix.)
2. **Fix cross-region dirty-union inflation in `collectDirtyUnion`.** A single doc-space dirty rect is converted to canvas-space for *every* region and unioned, so one main-pane cell edit inflates the dirty union across all frozen-pane coordinate spaces, defeating partial repaint and risking a union that spans the whole canvas. Union only into regions whose visible doc window actually intersects the rect.
3. **Scope scroll-triggered full repaints per region.** `renderFrame` promotes *all* layers to full-dirty whenever *any* region's scroll offset changes; scrolling the main pane forces static frozen-pane layers into full repaints. Promote only layers/regions affected by the scrolled region(s).
4. **Remove the domain-knowledge leak in the error boundary.** `CRITICAL_LAYER_IDS = {'background','cells','selection'}` is hardcoded spreadsheet vocabulary inside a "zero domain knowledge" engine. Replace with a per-layer/`config` capability so the engine stays domain-free.
5. **Replace fragile duck-typed cache access with a typed optional interface.** `renderAndCompositeLayer` casts layers to an inline `{ getOrCreateCache?, clearCache? }` shape. Promote this to a formal optional `CacheableLayer` contract in `core/types.ts`.
6. **Make `processFrame` honor a real remaining-frame budget**, and thread `viewportArea` into `DirtyRectAccumulator.coalesce()` auto-coalesce so the 50% full-promotion guard actually fires (today it never does on the automatic path).
7. **Harden input and host capability detection** for production: handle `pointercancel` / `lostpointercapture`, coalesce high-frequency pointer moves, avoid deprecated `navigator.platform` for the Windows desync guard, and make DOM/`navigator` access SSR-safe.

## Production-path contracts and invariants to preserve or strengthen

These are the load-bearing invariants. Every change below must preserve them; several explicitly strengthen them.

- **Zero domain knowledge.** No cell/row/col/sheet/freeze vocabulary in this package (`core/types.ts` documents the deliberate duplication of geometric primitives from contracts). Objective 4 *strengthens* this by removing the `CRITICAL_LAYER_IDS` leak.
- **Canonical coordinate formula.** `canvas = bounds + (doc − viewportOrigin − scrollOffset)·zoom` and its inverse exist *exactly once*, in `core/coordinate-space.ts`. No change may inline transform math or add a second copy. New region-intersection logic (objective 2) must compose `docToCanvas`/`canvasToDoc`, not re-derive.
- **Branded rects.** `DocSpaceRect` / `CanvasSpaceRect` / `RegionLocalRect` / `PhysicalRect` must keep their brands across the new union code; conversions only via the constructors and coordinate-space helpers.
- **`RenderScheduler` interface stability.** `markCellsDirty` / `markGeometryDirty` / `markAllDirty` are consumed by `kernel` (type-only `import('@mog/canvas-engine').RenderScheduler`) and implemented in `views/sheet-view`. This **interface is live and must not change shape.** It is distinct from the dead `PriorityScheduler` *class*; objective 1 touches the class, never the interface.
- **`CanvasLayer` render-mode contract.** `per-region` layers receive a context translated/scaled/clipped to region bounds; `once` layers draw in canvas-absolute CSS pixels. The dirty-rect clip for `per-region` must remain applied *after* translate+zoom in region-local coords (the subtle correctness note in `renderPerRegion`). Cache-path changes must not regress this.
- **Single rAF loop ownership.** The `PriorityScheduler` must remain a passive queue that never owns a rAF (documented invariant). Any wiring in objective 1 keeps the loop solely in `RenderLoop`.
- **Resume = full repaint.** `resume()` must keep forcing `markAllDirty()` + clearing scroll/size snapshots (GPU surface eviction recovery). Per-region scroll scoping (objective 3) must not weaken the resume path.
- **Deferred resize atomicity.** `host.flushResize()` applies canvas dimension changes inside the render frame to avoid blank-frame flash; keep this ordering.
- **Engine `pause`/`resume`/`dispose` lifecycle.** Public `CanvasEngine` surface (`start/stop/pause/resume/dispose/registerLayer/...`) and `CanvasEngineInstance` extensions stay backward compatible for all consumers.

## Concrete implementation plan

### Phase A — Scheduler: resolve the dead-code / telemetry defect (objective 1, 6)

1. Confirm the decision boundary in code: the **live** contract is the `RenderScheduler` *interface* (used by kernel + sheet-view), while the `PriorityScheduler` *class* and `RenderPriority` enum are unused. The class's only runtime effect today is producing the numbers behind `getStats()`.
2. **Preferred production path — make scheduling real:** introduce an engine method that lets consumers enqueue cheap invalidation callbacks at a `RenderPriority`, and route the existing `RenderScheduler` view-layer calls (currently calling `markGeometryDirty`/`markCellsDirty` straight into the registry via grid-renderer) through the scheduler so the priority/shedding/dedup logic finally governs invalidation under load. The render loop then calls `processFrame(remainingBudgetMs)` with a *computed* budget (see step 4). This realizes the design the file header describes ("microsecond dirty-marking operations, time-sliced by priority").
   - If, during Phase A investigation, wiring proves to change consumer behavior in ways outside this folder's scope, fall back to the **excision path**: delete `priority-scheduler.ts`, the `RenderPriority` enum, and the scheduler field from the engine, and re-source `getStats()` frame timing from the actual rAF cadence in `RenderLoop` (timestamp deltas between `onFrame` calls). Either way, the post-state must have **no dead queue** and **honest FPS telemetry**.
3. Fix `getStats().fps`: today `Math.min(60, round(1000 / max(16, avg)))` is computed from scheduler processing time, not frame cadence — it cannot exceed 60 and does not reflect real frame rate. Source it from real inter-frame `timestamp` deltas measured in `RenderLoop`, exposed to `getStats()`.
4. In `render-loop.ts:235`, replace the argument-less `this.scheduler.processFrame()` with a budget derived from time already consumed this frame (e.g. `TOTAL_FRAME_BUDGET − elapsedSinceFrameStart`), so the scheduler's time-slicing is meaningful when wired (or remove the call entirely on the excision path).

### Phase B — Dirty-union and scroll-scoping correctness/perf (objectives 2, 3, 6)

5. **`collectDirtyUnion` region intersection:** for each dirty `DocSpaceRect`, union it into a region only when the rect intersects that region's visible doc window. Compute the region's visible doc window from `bounds`, `viewportOrigin`, `scrollOffset`, `zoom` via `canvasToDoc` on the region's canvas-space bounds (compose existing helpers; do not inline). This keeps the union tight and prevents frozen-pane coordinate-space bleed.
6. **Per-region scroll promotion:** in `renderFrame`, track which region ids changed scroll offset, and in `promoteAllToFull` accept the affected region set. Promote a layer to full only if it actually renders into an affected region (or is a `once` layer whose content depends on scroll). Static frozen-pane-only layers stay partial. Preserve the existing previous-offset snapshotting.
7. **Thread `viewportArea` into auto-coalesce:** `DirtyRectAccumulator.add()` currently calls `coalesce()` with no `viewportArea`, so the `FULL_PROMOTION_RATIO` (0.5) guard never triggers automatically and a layer can hold a near-fullscreen single union that is *slower* than a full clear. Give the accumulator a `viewportArea` (set when the region layout/canvas size is known, e.g. via a setter the engine calls on `setLayout`/resize) and pass it on the auto-coalesce path.

### Phase C — Contract integrity (objectives 4, 5)

8. **De-domain the error boundary:** remove `CRITICAL_LAYER_IDS`. Add an optional `critical?: boolean` to `CanvasLayer` (default `false`) **or** a `criticalLayerIds`/`isCritical` hook on `CanvasEngineConfig`. `handleLayerError` consults that instead of a hardcoded spreadsheet set. Grid-renderer (out of scope here) will set the flag on its background/cells/selection layers in a follow-up; until then, document the new field. This removes domain vocabulary from the generic engine.
9. **Formalize `CacheableLayer`:** add an optional interface in `core/types.ts`:
   ```
   interface CacheableLayer {
     getOrCreateCache(w, h): { canvas; ctx } | null;
     clearCache(): void;
   }
   ```
   `renderAndCompositeLayer` narrows via a typed predicate instead of the inline `as CanvasLayer & {...}` cast. Document that `getOrCreateCache` returning `null` falls back to the direct-render path (preserving today's behavior for non-cacheable layers).

### Phase D — Input and capability-detection hardening (objective 7)

10. **`input-capture.ts`:** add `pointercancel` and `lostpointercapture` handlers that reset `PointerTracker` button state and emit a synthesized `up`/`leave` so drags cannot get stuck if capture is lost. Use `getCoalescedEvents()` on `pointermove` when available to emit intermediate positions for smooth drags/selection without flooding the callback. Only `preventDefault()` on `wheel`/pointer when the engine actually has a consumer (`onInput` set) to avoid blocking native scroll when the canvas is inert.
11. **`canvas-host.ts`:** replace the deprecated `navigator.platform` Windows desync guard with `navigator.userAgentData?.platform` (falling back to UA string parsing) so the desync-off-on-Windows safeguard keeps working as `navigator.platform` is removed. Keep the conservative default (desync off when platform is unknown-Windows).
12. **SSR/Node safety:** guard `detectCanvasMemoryLimit` (`navigator`, `document`) and `canvas-host` (`getComputedStyle`, `document`) with `typeof` checks consistent with the rest of the file, returning a safe default (`single-canvas` / no-op) in non-DOM environments. The engine is imported by `kernel` bridges (currently type-only), and this prevents a future value import from throwing under SSR/test-node.

### Phase E — Smaller robustness fixes (bundled, low-risk)

13. **`text-measurer.ts`:** handle words wider than `maxWidth` with a character-level break so wrapping cannot overflow the column, and cache the `'Mg'` line-height sample per-font rather than re-measuring every `measureWrappedText` call.
14. **`parseHex`:** the `#RRGGBBAA` branch parses RGB but silently drops alpha; either surface alpha in the return type used by `colorWithOpacity` or document that alpha is intentionally ignored, so callers don't assume alpha round-trips.

> Sequencing: Phases B and C are independent and can land in parallel. Phase A should land first or in coordination, because the FPS-telemetry change (A3) and the budget change (A4) touch `RenderLoop` near the dirty-union code (B5/B6). Phases D and E are fully independent.

## Tests and verification gates

> This planning task must not run build/test/typecheck. The gates below are the required verification once the work is implemented.

- **Existing engine suites must stay green** (run via the package's `jest`): `__tests__/render-loop.test.ts`, `render-loop-dirty-rects.test.ts`, `render-loop-caching.test.ts`, `priority-scheduler.test.ts`, `layer-registry.test.ts`, `canvas-host.test.ts`, `engine.test.ts`, `dirty-rect-accumulator.test.ts`, `transform-math.test.ts`, `utils.test.ts`, `core/__tests__/coordinate-space.test.ts`.
- **New/updated unit tests:**
  - `collectDirtyUnion` (B5): a dirty rect inside one of several regions produces a union confined to that region's canvas-space — assert it does **not** span all panes.
  - Per-region scroll promotion (B6): scrolling region A promotes A's layers but leaves a static-only layer in region B partial/clean.
  - `DirtyRectAccumulator` auto-coalesce (B7): adding many small rects whose union exceeds 50% of `viewportArea` promotes to full on the automatic path.
  - Error boundary (C8): a layer flagged `critical` is never disabled after `MAX_FAILURES_BEFORE_DISABLE`; a non-critical layer is — with **no** reference to literal `'background'/'cells'/'selection'`.
  - `CacheableLayer` (C9): typed cache path and non-cacheable fallback both render; partial composite still copies only the dirty rect (existing caching tests should cover, extend if needed).
  - Scheduler resolution (A): if wired, a scheduled task runs within budget and dedups by `layerId+hintKey`; FPS reported by `getStats()` reflects injected frame timestamps. If excised, assert the engine no longer exposes a `scheduler` field and `getStats().fps` tracks rAF cadence.
  - Input (D10): synthesized `pointercancel` clears `isDown` and emits a terminal event; coalesced move path emits intermediate points.
  - Capability detection (D11/D12): desync guard off for Windows UA via `userAgentData`; `detectCanvasMemoryLimit` returns a safe default when `navigator`/`document` are undefined.
- **Typecheck gate:** `tsc --noEmit` clean for `@mog/canvas-engine` and for downstream packages that import it (`grid-renderer`, `overlay`, `drawing-canvas`, `kernel`, `sheet-view`) — the `CacheableLayer` and optional `critical` additions must be backward compatible.
- **Consumer regression:** run `canvas/grid-renderer` integration suites that exercise the engine (`integration.test.ts`, `dirty-rect-animations.test.ts`, `once-layer-region-paint-containment.test.ts`, `text-clipping-contract.test.ts`) to confirm partial-repaint, frozen-pane containment, and marching-ants continuous frames still behave.
- **App-eval smoke (manual gate, not run here):** scroll + cell-edit + freeze-pane + window-resize + tab-hide/restore scenarios show no stale pixels, no frozen-pane bleed, and no blank-frame flash.

## Risks, edge cases, and non-goals

**Risks / edge cases**
- **Dirty-union region intersection (B5)** is the highest-risk change: under-unioning leaves stale pixels. Mitigate with the existing snap-safety margin (`ceil(1/dpr)`) plus the consumer freeze-pane containment tests; bias toward full repaint when intersection is ambiguous.
- **Per-region scroll scoping (B6)** must not under-promote `once`-mode chrome that visually depends on scroll (e.g. shadows at a freeze divider). Keep `once` layers conservative.
- **Scheduler resolution (A)** is the most consequential decision. The wiring path changes how invalidation flows from `views/sheet-view`/`grid-renderer`; it must be coordinated with those owners and must keep the rAF-ownership and `RenderScheduler`-interface invariants. The excision path is lower-risk but must re-home FPS telemetry; do not leave a half-wired queue.
- **`critical` flag migration (C8):** until grid-renderer sets the flag, *no* layer is critical, so error-disable could theoretically reach a core layer. Default the engine config to treat the previously-hardcoded ids as critical via config injection during the transition, or land the grid-renderer flag in the same change set.
- **Coalesced pointer events (D10):** must not double-emit the final event; guard against environments lacking `getCoalescedEvents`.

**Non-goals**
- No move to OffscreenCanvas/Worker-thread rendering or WebGL/WebGPU backends (large architectural effort; track separately).
- No change to the `RenderScheduler` *interface* shape (kernel/sheet-view depend on it).
- No change to the canonical coordinate formula or branded-rect design.
- No new domain concepts in this package.
- No reduction of the public `CanvasEngine` surface beyond removing the unused `scheduler` accessor *if* the excision path is chosen (which is itself a deliberate API cleanup, coordinated with consumers — verified to have no current callers).

## Parallelization notes and dependencies on other folders

- **Independent within this folder:** Phase B (dirty-union/scroll), Phase C (contracts), Phase D (input/host), Phase E (utils) touch largely disjoint files and can be implemented by separate workers. Phase A overlaps `RenderLoop` with B, so serialize A→B or assign both to one worker.
- **Cross-folder coordination required:**
  - Objective 1 (scheduler wiring path) and objective 4 (`critical` flag) require coordinated follow-ups in `canvas/grid-renderer` (sets the `critical` flag; consumes any new scheduling API) and possibly `views/sheet-view/src/viewport-wiring.ts` (routes invalidation through the scheduler). These consumer changes are **out of scope for this folder's edits** but are prerequisites for fully realizing the wiring path; the excision path has no consumer dependency beyond removing reads of `engine.scheduler` (none exist today).
  - `kernel/src/bridges/compute/*` depends only on the `RenderScheduler` *interface* (type-only). As long as that interface is untouched, kernel needs no change.
  - `canvas/overlay` and `canvas/drawing-canvas` reuse `DirtyRectAccumulator` and coordinate-space/transform-math; the `viewportArea` addition (B7) must keep the no-arg `coalesce()` overload working for them (backward-compatible optional parameter).
- **No dependency** on Rust core, wasm, or `@mog-sdk/contracts` builds for any change here (the package re-declares its geometric primitives by design).
