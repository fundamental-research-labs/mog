# Plan 041 — Harden `mog/canvas/grid-renderer/src` (core grid rendering, viewport, hit-test)

## Source folder and scope

- **Folder:** `mog/canvas/grid-renderer/src`
- **Package:** `@mog/grid-renderer` — *"Spreadsheet cell painting — grid layers implementing CanvasLayer interface."* (`src/index.ts:1-9`). The package's stated contract: **no React, no DOM (except `CanvasRenderingContext2D`), no Yjs**; depends only on `@mog/canvas-engine` and `@mog-sdk/contracts`.
- **Subsystems in scope (67 non-test `.ts` files, ~23k LOC):**
  - `layers/` — the eleven `CanvasLayer` implementations (`cells.ts` 1204 LOC, `ui.ts` 1071, `headers.ts` 961, `selection.ts` 922, plus `background`, `dividers`, `page-breaks`, `remote-cursors`, `sticky-headers`, `trace-arrows`, `validation-circles`) and the `BaseLayer` abstract base / `OnceLayerWithChrome` contract (`layers/base-layer.ts`).
  - `cells/` — the cell-content render primitives: `text.ts`, `text-wrap.ts`, `text-overflow.ts`, `alignment.ts` (641 LOC), `rich-text.ts`, `rotated-text.ts`, `shrink-to-fit.ts`, `borders.ts`, `fills.ts`, `merged-cells.ts`, `data-bars.ts`, `icon-sets.ts`, `indicators.ts`, `sparklines.ts`, `interactive-elements.ts`, `center-across.ts`, `format-value.ts`.
  - `coordinates/` — `coordinate-system.ts` (1275 LOC, *"single source of truth for all coordinate conversions"*, `coordinates/coordinate-system.ts:1-6`), `viewport-position-index.ts`, `viewport-merge-index.ts`.
  - `viewports/` — `viewport.ts`, `scroll.ts`, `hit-testing.ts`.
  - `layout/` — `compute-visible-range.ts`, `for-each-visible-cell.ts`, `grid-coords.ts`.
  - `hit-test/` — `grid-hit-test.ts` (520 LOC).
  - `services/` — `text-measurement-service.ts` (1098 LOC).
  - `features/` — `pivot-renderer.ts`, `table-styles.ts`, `outline-renderer.ts` (869 LOC), `formula-range-hit-test.ts`, `collaborator-cursor-renderer.ts`, `chart-position.ts`.
  - `shared/` — `excel-patterns.ts`, `border-styles.ts`, `theme-constants.ts`, `font-utils.ts`, `cell-bounds.ts`, `constants.ts`.
  - `factory.ts` (`createGridLayers`), `index.ts` (barrel), `overflow-index.ts`, `data/defaults.ts` (NULL data sources).
- **Charter (must be preserved):** purity (no React/DOM/Yjs), the `CanvasLayer` interface from `@mog/canvas-engine`, and the data-source-injection model — every layer consumes a typed `*DataSource` interface from `@mog-sdk/contracts/rendering` and is independently testable. This plan **must not** add DOM/framework dependencies or break the injection seam.

## Current role of this folder in Mog

This is the rendering engine for the spreadsheet grid: given injected data sources (cells, selection, sheet, collaboration, trace, grouping, page-break) plus a `ViewportPositionIndex`/`ViewportMergeIndex` and an `AnimationClock`, it paints every visible pixel of the grid onto layered canvases and answers hit-tests (what's under the pointer). It sits between the canvas-engine render loop (which schedules frames, manages dirty rects, and composites layers by z-index) and the kernel/app (which supplies the data sources and a binary viewport buffer).

Key architectural facts established from the source:

1. **Layered, z-ordered, dirty-tracked.** `createGridLayers` (`factory.ts:144`) instantiates 11 layers, each with a fixed z-index (background 0 → cells 100 → … → selection 850 → headers 800 → dividers 900) and `renderMode` of `'per-region'` or `'once'`. `BaseLayer` (`layers/base-layer.ts:64`) owns dirty accumulation (`DirtyRectAccumulator`), off-screen per-layer caching, and the `withRegionBandClip` helper that prevents freeze-divider bleed.
2. **Binary viewport buffer is the single source of truth for cell content.** `CellsLayer.render` resolves a `BinaryCellReader` (duck-typed to kernel's `CellAccessor`, `layers/cells.ts:95`) and **returns early with no paint if the reader is absent** (`cells.ts:371-373`) — cell content is skipped for 1–2 frames on sheet switch while grid/selection/headers still paint. `CellDataSource` supplies only metadata not yet in the binary buffer (sparklines, filters, bindings).
3. **Two-pass cell render.** Pass 1 paints fills/borders/data-bars and collects `CellRenderInfo` into a per-frame cache; Pass 2 reuses that cache to paint text/icons/indicators (`cells.ts:1-9, 353-354`).
4. **Coordinate authority.** `CoordinateSystemImpl` (`coordinates/coordinate-system.ts`) is declared the *single source of truth* for document↔viewport↔layer↔cell conversions; `ViewportPositionIndex` gives O(1) row/col position lookups.
5. **`'once'` layer containment is structurally enforced.** `__tests__/once-layer-region-paint-containment.test.ts` asserts every paint a `'once'` layer issues is contained in a per-region band or a declared chrome rect (`OnceLayerWithChrome.getChromeExemptions`, `base-layer.ts:48-62`). This is a real, load-bearing invariant the plan must preserve.

### Evidence-backed problems found

1. **Unbounded image cache — memory leak on image-heavy sheets.** `CellsLayer.imageCache` is a plain `Map` with no size bound and no eviction (`layers/cells.ts:235`; only `.get`/`.set` at `984-996`). Every distinct in-cell image `src` ever scrolled into view retains an `HTMLImageElement` for the layer's lifetime. A workbook with thousands of unique cell images accumulates detached image elements that never GC. By contrast the text caches *do* bound themselves (below), so this is an inconsistency as much as a leak.

2. **O(n) LRU in the per-character/per-string measurement hot path.** `TextMeasurementServiceImpl` maintains `accessOrder` as an array and does `indexOf` + `splice` on every touch (`services/text-measurement-service.ts:188-193`) and `shift()` (O(n) array re-index) on every eviction (`text-measurement-service.ts:199-201`). With `MAX_TEXT_CACHE_SIZE = 10000`, a churny viewport (rapid scroll over varied text) pays O(n) per measurement at exactly the moment the cache is most useful. The correct structure is a `Map`-backed LRU (insertion-ordered `Map` + delete/re-set, or a doubly-linked list) giving O(1) touch and evict.

3. **Per-frame allocations inside the cell render loop.** Each `CellsLayer.render` allocates: `cellInfoCache: CellRenderInfoExtended[]` (`cells.ts:354`) plus one `CellRenderInfo` object **per visible cell** (`cells.ts:471`), `frame.dirtyRects.map(canvasToDoc)` (`cells.ts:378`), and per-cell `{row,col}` coord objects (`cells.ts:385`). `forEachVisibleCell` allocates a `Set<string> visitedMerges` per call (`layout/for-each-visible-cell.ts:91`) and `expandDirtyCells` a `Map` per call (`cells.ts:290`). At 1000+ visible cells × 60fps these are real GC pressure. The two-pass design *requires* a per-cell info store, but the array, the coord objects, and the dirty-rect conversion array are poolable across frames.

4. **No fault isolation around injected data-source calls.** Inside the per-cell loop the layer calls `cellData.getSparklineRenderData`, `getFilterHeaderInfo`, `getCellBindingStatus` (`cells.ts:447-450`) with no try/catch. A single throwing data-source call aborts the entire frame's cell paint (and, because the dirty rect was consumed, may not repaint until the next invalidation). For a rendering engine consuming app-supplied sources, one bad cell should not blank the grid.

5. **Silent frame-skip with no diagnostic signal.** When the binary reader is unavailable the layer returns with no paint and no log/metric (`cells.ts:371-373`); likewise `reader.moveTo` failures skip cells silently (`cells.ts:410`). This is *correct* behavior (avoid showing stale/divergent data), but it is unobservable — a buffer that never arrives looks identical to "empty sheet," with no counter or one-shot warning to distinguish a bug from steady state.

6. **`scroll.ts` uses `console.warn` for contract violations.** `viewports/scroll.ts:67,72` warn when a linked-viewport lookup is missing or a linked viewport id isn't found. Raw `console.warn` in a render-path library is both un-throttleable (can spam per frame) and invisible to the host's telemetry. These should route through an injectable diagnostics sink (or be typed errors), consistent with how the rest of the engine surfaces problems.

7. **Heavy structural duplication across the seven alignment renderers.** `renderFillAlignmentText`, `renderCenterContinuousText`, `renderDistributedHorizontalText`, `renderJustifyVerticalText`, `renderDistributedVerticalText`, `renderAccountingText` (`cells/alignment.ts:43,140,255,343,397,518`) each repeat the same prologue: `getCellStyle` → `buildCellFont` → `mapVerticalAlign` → `ctx.save()` → clip → render → `ctx.restore()`. The shared setup is not factored out (`renderAlignedLine` at `alignment.ts:616` extracts only the innermost line draw). This is six places to get save/restore balance and clip rects right, and six places a future style field must be threaded — a correctness hazard, not just verbosity.

8. **Unit-test coverage is concentrated in a few subsystems; most render primitives have only integration coverage.** Files with **no** co-located `__tests__`: nearly all of `cells/` (`alignment.ts`, `borders.ts`, `fills.ts`, `data-bars.ts`, `icon-sets.ts`, `indicators.ts`, `rotated-text.ts`, `shrink-to-fit.ts`, `sparklines.ts`, `text-overflow.ts`, `text-wrap.ts`, `format-value.ts`, `center-across.ts`), `coordinates/coordinate-system.ts` (the 1275-LOC coordinate authority — covered only indirectly via the smaller index tests), all of `features/` (`pivot-renderer`, `outline-renderer`, `formula-range-hit-test`, `collaborator-cursor-renderer`, `chart-position`, `table-styles`), and all of `shared/`. The highest-risk gaps are `coordinate-system.ts` (every conversion routes through it) and the alignment/overflow primitives (visually subtle, regression-prone).

9. **Open `'once'` author-trap is documented but only test-enforced.** The `OnceLayerWithChrome` author note (`base-layer.ts:42-46`) warns that declaring per-region paint as chrome is "the original bug dressed up as a fix." This invariant lives only in a structural test + a prose comment; there is no type-level or assertion-level guard that a chrome rect is genuinely canvas-spanning. Acceptable today, but worth strengthening as the layer count grows.

10. **Type-safety pockets at platform seams.** `getContext('2d')` non-null assertions / casts at `base-layer.ts:206,219-221`, `shared/excel-patterns.ts:46,51`; the cache-context cast is the documented OffscreenCanvas/HTMLCanvas split but is uncommented at the call site. The single active `TODO` (`features/outline-renderer.ts:166` — *"Uncomment when viewportLayout is added to OutlineRenderContext"*) marks a known incomplete seam in the outline render context.

## Improvement objectives

1. **Bound every cache.** Give `imageCache` an explicit max-entry LRU bound with eviction parity to the text caches; document the bound and its rationale next to the field.
2. **Make text measurement O(1) on the hot path.** Replace the array-based `accessOrder` LRU in `TextMeasurementServiceImpl` with an insertion-ordered `Map` (or linked-list) LRU so touch and evict are O(1), preserving identical cache semantics and `MAX_*` bounds.
3. **Cut per-frame allocations in the cell loop** by pooling/reusing the `cellInfoCache` array, the per-cell coord object, and the dirty-rect conversion array across frames — without changing the two-pass `CellRenderInfo` contract.
4. **Add fault isolation** so a single throwing data-source call or one malformed cell degrades to "that cell unpainted," never "frame aborted." Route the failure to an injectable diagnostics sink.
5. **Replace render-path `console.warn` with an injectable, throttled diagnostics sink** (default no-op), and make silent-but-correct skips (missing binary reader, `moveTo` miss) observable via a counter/one-shot signal on that same sink.
6. **De-duplicate the alignment renderers** behind a shared "aligned-text context" setup helper, leaving one place to manage save/clip/restore and style resolution.
7. **Raise unit coverage where risk is highest:** `coordinate-system.ts` round-trip/invariant tests, and characterization tests for the alignment/overflow/border/fill/indicator primitives.
8. **Strengthen the `'once'`-layer containment invariant** with a runtime dev-assertion (behind a debug flag) complementing the structural test, so chrome-vs-band mistakes are caught in app-eval, not only in unit CI.

## Production-path contracts and invariants to preserve or strengthen

**Preserve (do not regress):**
- **Package purity:** no React, no DOM beyond `CanvasRenderingContext2D`/`OffscreenCanvas`, no Yjs (`index.ts:8`). Diagnostics sink must be a plain injected interface, not a global or DOM hook.
- **`CanvasLayer` contract** from `@mog/canvas-engine`: `id`, `zIndex`, `renderMode`, `canvas`, `isDirty`/`markDirty`/`markClean`/`getDirtyRects`/`isFullDirty`, `dispose`, and `render(ctx, region, frame)` (`base-layer.ts:64-118`). Z-indices and `renderMode`s in `factory.ts` are a wire contract with the compositor — unchanged.
- **Binary-buffer-as-truth + skip-when-absent** semantics (`cells.ts:368-373, 406-410`): correctness depends on *not* falling back to a divergent source. Diagnostics may observe the skip but must not paint stale data.
- **`'once'` paint containment:** `once-layer-region-paint-containment.test.ts` must continue to pass; `getChromeExemptions` semantics unchanged.
- **`withRegionBandClip` `try/finally`** (`base-layer.ts:175-179`) — load-bearing for multi-region once-layers; any refactor keeps the clip-restore guarantee.
- **`CoordinateSystem` as single source of truth** (`coordinate-system.ts:1-6`): no new ad-hoc conversion paths; new tests lock current conversions before any refactor.
- **Data-source injection seam:** `*DataSource` interfaces and `NULL_*` defaults (`data/defaults.ts`) stay the integration boundary; the public barrel (`index.ts`) keeps all currently-exported names.

**Strengthen (turn into enforced invariants):**
- *Bounded memory:* every per-layer/per-service cache has a documented max size and eviction (image cache joins text caches).
- *O(1) LRU:* measurement cache touch/evict complexity is part of the perf contract, asserted by a microbenchmark-style test.
- *Frame robustness:* "one bad cell ≠ blank grid" becomes a tested invariant (inject a throwing data source; assert other cells paint).
- *Observable skips:* missing-reader and `moveTo`-miss increment a diagnostics counter.

## Concrete implementation plan

> All edits are inside `mog/canvas/grid-renderer/src` plus its co-located `__tests__`. Anything touching `@mog/canvas-engine`'s `CanvasLayer`/`FrameContext` types, or `@mog-sdk/contracts/rendering` data-source interfaces, is **out of this plan's edit scope** and must be coordinated with the owning folder (see Dependencies). Where a diagnostics sink type is shared, prefer defining a minimal local interface and adopting a contracts type later, to avoid cross-package churn in this plan.

1. **Bound the image cache (`layers/cells.ts`).** Introduce a small LRU wrapper (or reuse the measurement LRU once built in step 2) around `imageCache` with an explicit `MAX_IMAGE_CACHE_SIZE`. On eviction, drop the `HTMLImageElement` reference; in-flight `'loading'` entries are evicted only after settle. Add a field-level comment stating the bound and that `'loading'`/`'error'` sentinels are retained until resolved. Confirm no behavior change for the common (small image-set) case.

2. **Replace the measurement LRU (`services/text-measurement-service.ts`).** Swap `accessOrder: string[]` + `indexOf/splice/shift` for an insertion-ordered `Map<string, number>` LRU: on hit, `delete` then `set` to move to the end; on insert past `MAX_TEXT_CACHE_SIZE`, delete `map.keys().next().value`. Preserve `makeKey`, both cache sizes, and the per-font char-width cache (`getOrCreateCharWidthCache`, `text-measurement-service.ts:208`). Extract the LRU into a tiny reusable helper so step 1 can share it.

3. **Pool per-frame allocations in `CellsLayer` (`layers/cells.ts`).** (a) Promote `cellInfoCache` to an instance field cleared (`length = 0`) at the top of `render` instead of re-allocated. (b) Reuse a single scratch coord object for the `overflowIndex.removeCell`/editor-skip checks instead of `{ row, col }` per cell where a fresh object isn't escaping. (c) Cache/reuse the `dirtyRectsDoc` array (clear-and-refill) rather than `.map` per frame. Keep the produced `CellRenderInfo` objects' shape and the Pass-1→Pass-2 reuse contract intact; do **not** pool objects that are stored in `cellInfoCache` and read in Pass 2 within the same frame (those must stay distinct per cell). Add a comment explaining which structures are safe to pool and why.

4. **Add an injectable diagnostics sink.** Define a minimal `RendererDiagnostics` interface (`{ warn(code, detail?), count(code) }`) in a new `shared/diagnostics.ts`, with a default no-op implementation and a throttling wrapper (collapse repeats by `code` within a frame/time window). Thread it through `GridLayersConfig` (`factory.ts`) as an optional field defaulting to the no-op, and into the layers that currently warn or skip silently.

5. **Wire diagnostics into the silent/loud paths.** Replace `console.warn` in `viewports/scroll.ts:67,72` with `diagnostics.warn(...)`. Increment `diagnostics.count('cells.reader-missing')` on the early return at `cells.ts:371-373` and `diagnostics.count('cells.movefail')` on `moveTo` miss (`cells.ts:410`), throttled so a steady missing buffer doesn't flood. Behavior (skipping paint) is unchanged; only observability is added.

6. **Fault-isolate per-cell data-source calls (`layers/cells.ts`).** Wrap the metadata fetches (`getSparklineRenderData`, `getFilterHeaderInfo`, `getCellBindingStatus`, and the optional `getCellImage`) so a throw is caught, reported once via `diagnostics`, and treated as "no metadata for this cell." The cell still paints its value/format; the frame completes. Keep the binary-reader reads (the hot path) un-try/catched — they are internal and a throw there is a real bug.

7. **Extract the alignment-renderer prologue (`cells/alignment.ts`).** Add an internal `withAlignedTextContext(ctx, info, theme, fn)` (or a `resolveAlignedText(...)` that returns the computed font/style/valign plus a scoped clip runner) capturing the shared `getCellStyle`→`buildCellFont`→`mapVerticalAlign`→save/clip/restore sequence. Refactor the six renderers to call it. Pure internal refactor; exported function names/signatures in `index.ts:165-174` unchanged. Gate on the new characterization tests from step 9.

8. **Add a dev-mode `'once'`-containment assertion (`layers/base-layer.ts`).** Behind a debug flag (env/`config.debugContainment`), have `withRegionBandClip` (and an optional `assertChromeContains` helper) validate at runtime that paints fall inside the band/chrome, logging via `diagnostics` rather than throwing in production. Complements `once-layer-region-paint-containment.test.ts` so violations surface in app-eval, not only structural CI. No-op when the flag is off.

9. **Backfill unit tests** (co-located `__tests__`, no production behavior change):
   - `coordinates/__tests__/coordinate-system-roundtrip.test.ts` — document↔viewport↔layer↔cell round trips, frozen panes, zoom ≠ 1, hidden rows/cols, header-visibility variants.
   - `cells/__tests__/alignment.test.ts` — one case per alignment renderer (asserting save/restore balance via a ctx spy) to lock behavior **before** step 7's refactor.
   - `cells/__tests__/` characterization tests for `text-overflow`, `borders`, `fills`, `indicators`, `data-bars`/`icon-sets` (geometry + key branch coverage).
   - `services/__tests__/text-measurement-lru.test.ts` — LRU hit/evict order parity + a complexity guard (eviction cost flat as size grows).
   - `layers/__tests__/cells-fault-isolation.test.ts` — throwing data source → other cells still paint; counter incremented.

10. **Address the outline TODO seam (`features/outline-renderer.ts:166`)** *only if* `OutlineRenderContext` gaining `viewportLayout` is in scope for this folder. If it requires a contracts change, leave the TODO, document the dependency in the Dependencies section, and do not stub a shim.

## Tests and verification gates

- **No production-code edits outside this folder.** All new tests are co-located under `mog/canvas/grid-renderer/src/**/__tests__`.
- **Regression gate — existing suites must stay green**, especially the invariant tests: `__tests__/once-layer-region-paint-containment.test.ts`, `__tests__/text-clipping-contract.test.ts`, `__tests__/shimmer-contract.test.ts`, `__tests__/overflow-index.test.ts`, `__tests__/dirty-rect-animations.test.ts`, `__tests__/integration.test.ts`, and the `layers/`, `coordinates/`, `layout/`, `viewports/`, `hit-test/` suites.
- **New gates introduced by this plan:**
  1. Coordinate round-trip/invariant suite (step 9) passes and is required before any future coordinate refactor.
  2. Measurement-LRU parity + complexity guard (step 9) — asserts identical eviction order to the old array LRU and flat eviction cost.
  3. Alignment characterization suite (step 9) passes both before and after the step-7 refactor (the refactor's safety net).
  4. Fault-isolation test (step 9) — throwing data source does not blank the grid; diagnostics counter increments.
  5. Image-cache bound test — exceeding `MAX_IMAGE_CACHE_SIZE` evicts oldest, never grows unbounded.
- **Manual/app-eval verification (run by a human or a later non-restricted worker — this plan does not run them):** scroll a large, image- and text-dense sheet and watch for GC sawtooth reduction; verify freeze-pane rendering and selection borders are pixel-identical (the `'once'` containment + `withRegionBandClip` paths); toggle the debug-containment flag and confirm no production console noise when off.
- **Out-of-scope commands** (per task constraints): this plan does **not** run cargo/pnpm/npm/build/typecheck/format; the gates above describe what CI/a later worker must run.

## Risks, edge cases, and non-goals

**Risks & edge cases:**
- **LRU eviction-order parity.** A `Map`-backed LRU must reproduce the array LRU's exact victim selection or subtle "measured a stale width" bugs appear under churn. Mitigated by the parity test (gate 2) written against the current implementation first.
- **Allocation pooling aliasing.** Pooling a structure that's still read later in the same frame (Pass 2 reads Pass 1's `CellRenderInfo`) would corrupt output. The plan explicitly pools only the *container* array, the dirty-rect array, and non-escaping scratch coords — never the per-cell info objects stored for Pass 2. The fault-isolation and integration tests guard this.
- **Diagnostics throttling.** A naive sink could itself allocate per frame (defeating step 3) or spam. The throttling wrapper must be allocation-light and collapse by `code`.
- **Alignment refactor regressions.** Visually subtle (distributed/justify/accounting/center-continuous). The characterization tests (gate 3) are written *before* the refactor; the refactor is rejected if they change.
- **`OffscreenCanvas` absence.** `base-layer.ts:210-217` already branches on `typeof OffscreenCanvas`; the bounded-cache and diagnostics work must not assume one backend.

**Non-goals:**
- Changing z-index order, `renderMode`s, layer count, or the `CanvasLayer`/`FrameContext`/data-source contracts (those belong to `@mog/canvas-engine` / `@mog-sdk/contracts`).
- Replacing the binary-buffer-as-truth model or adding a fallback data path (intentional divergence-avoidance design).
- Rewriting `coordinate-system.ts` — this plan *locks it with tests* and leaves a future refactor to a follow-up once coverage exists.
- Test-only "fixes," compatibility shims, or feature-flagged reduced scope. Every change is a production-path improvement.
- Visual/feature additions (new CF visuals, new alignment modes); scope is hardening existing behavior.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable within this folder:** image-cache bound (1), measurement LRU (2), allocation pooling (3), alignment refactor (7), and most test backfill (9) touch disjoint files and can proceed concurrently. The diagnostics sink (4) is a prerequisite for (5) and (6) and should land first among those three.
- **Cross-folder dependencies (coordinate, do not edit here):**
  - `@mog/canvas-engine` (`mog/canvas/canvas-engine`) — owns `CanvasLayer`, `FrameContext`, `DirtyRectAccumulator`, `canvasToDoc`, `snapToPixelGrid`. If the diagnostics sink should ultimately live in the engine's frame context rather than `GridLayersConfig`, that is an engine-folder change to coordinate; this plan defines a local interface to stay self-contained.
  - `@mog-sdk/contracts/rendering` (`mog/contracts` / `types/rendering`, see Plans 001–008) — owns the `*DataSource` interfaces, `GridRegionMeta`, and `CoordinateSystem`. The fault-isolation work (6) treats these as given; if a data-source method's error contract should be tightened (e.g. "never throws"), that is a contracts-folder decision.
  - `@mog/spreadsheet-utils` — supplies `resolveCellTextStyle`, font helpers, and `getEffectiveHeaderDimensions` used by `coordinate-system.ts` and the cell text path; no edits proposed, but the coordinate round-trip tests depend on its header-dimension behavior staying stable.
  - **`features/outline-renderer.ts:166` TODO** depends on `OutlineRenderContext` (contracts) gaining `viewportLayout`; resolving it requires the contracts owner (step 10), otherwise it stays as-is.
- **No dependency on** the kernel's binary-buffer producer beyond the duck-typed `BinaryCellReader` shape (`cells.ts:95`); diagnostics observe its absence but this plan does not modify the producer.
