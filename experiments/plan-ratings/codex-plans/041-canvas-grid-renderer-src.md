# 041 - Canvas Grid Renderer Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/canvas/grid-renderer/src`

Scope for this plan is the production grid renderer package source: layer composition, per-layer rendering contracts, cell painting, viewport position and merge indexes, coordinate conversion helpers, viewport hit testing, grid hit-test provider behavior, dirty-cell expansion, text measurement, and exported renderer utilities.

Adjacent production folders that must be considered:

- `mog/canvas/grid-canvas/src/renderer` because it constructs `ViewportPositionIndex`, `ViewportMergeIndex`, `CoordinateSystemImpl`, `GridCoordinateSystem`, `createGridLayers`, and the registered grid hit-test provider.
- `mog/canvas/grid-canvas/src/viewports` because it computes `ViewportLayout` and maps it into render regions consumed by `grid-renderer`.
- `mog/canvas/engine/src` because it owns `CanvasLayer`, region transforms, dirty rect collection, off-screen cache compositing, and hit-test provider priority.
- `mog/contracts/src/rendering`, `mog/types/viewport/src/rendering`, and `mog/views/sheet-view/src/viewport-wiring.ts` because they define the renderer data-source contracts, `GridRegionMeta`, binary viewport buffer wiring, and viewport reader updates.

This is a public Mog source folder. Implementation work belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`grid-renderer/src` is the core spreadsheet canvas rendering package. It is not the whole canvas application; `grid-canvas` composes it with the engine, drawing layer, overlay layer, scheduler, and app data adapters.

The folder currently owns these production responsibilities:

- Public package surface in `index.ts`, exporting layers, layout, coordinates, viewport helpers, cell painters, hit testing, feature renderers, text measurement, defaults, and `createGridLayers`.
- Layer factory in `factory.ts`, which takes position and merge indexes, data sources, an animation clock, optional text measurement and binary reader dependencies, and returns z-sorted `CanvasLayer`s plus named layer references.
- Shared layer mechanics in `layers/base-layer.ts`: dirty accumulation, `renderMode`, off-screen cache lifecycle, once-layer chrome exemptions, and region-band clipping.
- Main cell hot path in `layers/cells.ts`: resolve a binary cell reader, iterate visible cells, build `CellRenderInfoExtended`, render fills/borders/conditional formatting, then render text, rich text, wrapped text, icons, sparklines, in-cell images, indicators, and interactive elements.
- O(1) viewport-backed indexes in `coordinates/viewport-position-index.ts` and `coordinates/viewport-merge-index.ts`, replacing older dimension-provider and linear merge scans in the render path.
- Coordinate and layout utilities in `shared/cell-bounds.ts`, `layout/compute-visible-range.ts`, `layout/for-each-visible-cell.ts`, `layout/grid-coords.ts`, `coordinates/coordinate-system.ts`, and `viewports/*`.
- Input targeting helpers in `hit-test/grid-hit-test.ts`, `viewports/hit-testing.ts`, `features/formula-range-hit-test.ts`, `features/outline-renderer.ts`, and selection/fill/table handle helpers exported from `coordinates/coordinate-system.ts`.

The package already has substantial local tests: 98 TypeScript source files and 31 test files under `src`, including layer integration, dirty-rect animation, text clipping, overflow index, viewport index, visible range, hit testing, and once-layer paint containment tests. The remaining problem is not lack of local tests; it is that several production contracts are duplicated or only partially wired into the path users exercise.

## Improvement objectives

1. Make current `ViewportLayout` the single input geometry for hit testing, selection handles, formula handles, table handles, resize boundaries, and overlay-facing range bounds.
2. Collapse the two active coordinate stacks into one contract: rendering helpers, viewport hit tests, `GridHitTest`, and legacy `CoordinateSystemImpl` must compose the same canonical transforms from `@mog/canvas-engine`.
3. Fix frame-scoped mutable state in `CellsLayer` so clipped-cell maps, interactive elements, overflow dependency state, and other frame caches are cleared once per frame, not once per render region.
4. Make optional data-source and binary-reader updates explicit and clearable. A removed per-viewport reader, single reader, interactive collector, or center-across provider must not remain sticky because `undefined` means "do not update".
5. Split `CellsLayer` into a typed frame render plan plus focused painters, while preserving the production hot path and binary-buffer source-of-truth contract.
6. Move remaining per-cell metadata reads that still come from `CellDataSource` into batched viewport payloads or typed per-region metadata where possible.
7. Replace or retire legacy exported viewport helpers that still use linear scans and approximate "MVP/Future" scrollbar math, or reimplement them over `ViewportPositionIndex` with explicit non-hot-path labeling.
8. Tighten dirty rect and cache contracts so overflow, in-cell images, merged cells, selection, headers, and animated UI dirty only the required doc-space regions whenever the production data path can identify them.
9. Strengthen contract tests and browser verification around the real `grid-canvas` composition path, not only isolated helper functions.

## Production-path contracts and invariants to preserve or strengthen

- `grid-renderer` remains UI-framework independent. It may use Canvas 2D and browser canvas primitives, but it must not depend on React, app state machines, `mog-internal`, or private-only packages.
- Dependency direction stays public and acyclic: `grid-renderer` may depend on `@mog/canvas-engine`, `@mog-sdk/contracts`, `@mog/culture`, and `@mog/spreadsheet-utils`; it must not depend on `grid-canvas`, spreadsheet app internals, or kernel implementation details.
- Per-region layers draw in region-local unzoomed coordinates because `canvas-engine` pre-applies region translation and zoom. Layer code must use `docToRegionXY`, `cellRectInRegion`, `rangeRectInRegion`, `snapDocXToPixelGrid`, or canonical engine transforms instead of inline `viewportOrigin` or `scrollOffset` math.
- Once-mode layers draw in canvas-absolute coordinates and any per-region paint must be clipped with `BaseLayer.withRegionBandClip` or declared as legitimate chrome through `OnceLayerWithChrome`.
- `ViewportPositionIndex` and `ViewportMergeIndex` remain the render hot-path indexes. Visible-cell iteration, dirty rect resolution, hit testing, and selection geometry should not regress to per-row or per-merge linear scans for normal viewport work.
- The binary viewport buffer is the single source of truth for primary cell values, display strings, resolved formats, flags, and conditional-format visuals. `CellDataSource` should only provide metadata not yet migrated, and any migration must remove duplicate render reads rather than adding fallbacks.
- A region with `GridRegionMeta.viewportId` must resolve the correct per-viewport binary reader. Missing or mismatched viewport IDs may skip cells while data is loading, but the production layout pipeline should make that state observable and test-covered rather than silently erasing all cell content.
- Hit-test results must match rendered geometry under scroll, zoom, frozen panes, split panes, hidden headers, outline gutters, hidden rows/columns, RTL if supported, merged cells, and high-DPR pixel snapping.
- Hidden row and column behavior must be explicit: cell hits, resize hits, and hidden-boundary affordances need one shared rule for whether a hidden extent resolves to the next visible cell, previous visible cell, boundary target, or empty.
- Dirty rects passed into `forEachVisibleCell` are document-space rects. `CellsLayer` may convert canvas dirty rects to doc space, but downstream iteration must never compare canvas-space rects to document-space cell bounds.
- Dirty-cell expansion must include text overflow sources and destinations, merged-cell extents, and any pending in-cell image load/error invalidations before rects are resolved.
- Visual handle helpers, cursor feedback helpers, and drag-initiation hit tests must share the same handle geometry and tolerance constants so cursor affordance and click behavior agree.

## Concrete implementation plan

1. Define the canonical renderer geometry contract.

   - Add a small `RendererGeometry` or `GridGeometryContext` type in `grid-renderer` that carries current `ViewportLayout`, region layout metadata, `ViewportPositionIndex`, `ViewportMergeIndex`, header visibility, outline gutter dimensions, zoom, and total sheet dimensions.
   - Make `grid-canvas` update this context whenever viewport layout, headers, gutters, zoom, or indexes change.
   - Route `GridHitTest`, formula-range hit testing, outline hit testing, selection handle geometry, and legacy coordinate queries through this context.
   - Keep `shared/cell-bounds.ts` and `canvas-engine` transforms as the only places where doc/canvas/region formulas are implemented.

2. Replace the registered grid hit-test provider with a layout-aware provider.

   - Rework `hit-test/grid-hit-test.ts` so it uses `hitTestLayout` and `canvasToCell` over the current `ViewportLayout` instead of subtracting fixed `rowHeaderWidth` and `colHeaderHeight`.
   - Remove hardcoded `rowHeaderWidth: 50` and `colHeaderHeight: 24` from the `grid-canvas` registration path and derive effective header and outline gutter dimensions from the same state used for rendering.
   - Compute header, resize, hidden-boundary, selection-border, fill-handle, table-resize, and formula-range targets from viewport/region-aware bounds.
   - Bound divider hits by the divider's actual span, not only distance to the divider line.
   - Preserve overlay and drawing hit-test priorities in `canvas-engine`; this change only makes the grid fallback and registered provider truthful after higher-priority providers miss.

3. Turn `CoordinateSystemImpl` into a compatibility facade over the same geometry.

   - Keep exported `CoordinateSystemImpl` and `createCoordinateSystem` for current consumers, but move its cell, range, viewport, and hit-test calculations onto the canonical geometry services.
   - Replace `rangeToViewport`'s single-rect shortcut with multi-region splitting for frozen and split viewports, then expose an explicit "primary rect" helper only for call sites that truly need one rect.
   - Make `documentToViewport` and `documentToLayerViewport` split or reject rects that cross frozen and scrollable boundaries instead of classifying by top-left only.
   - Audit `GridRendererImpl.hitTest()` so it either trusts the engine's grid hit result or deliberately calls the same layout-aware grid hit tester; it should not maintain a separate `classifyPoint` fallback with different geometry.

4. Add an explicit layer frame lifecycle.

   - Extend the canvas-engine layer contract, or add a duck-typed optional hook, for `beginFrame(frame, layout)` and `endFrame(frame, layout)`.
   - Move `CellsLayer` clearing of `clippedCells`, `interactiveElements`, and full-frame overflow-index state from `render()` into `beginFrame`.
   - Keep per-region temporary arrays local to region rendering, but aggregate frame-level tooltip, overflow, and interactive-element state across all frozen/split regions.
   - Add tests where two or more regions render in one frame and the final clipped-cell and interactive-element state includes entries from every region.

5. Make data-source updates explicit and nullable.

   - Replace `Partial<CellsLayerConfig>` update semantics for optional fields with a typed patch such as `{ binaryCellReader?: SetOrClear<BinaryCellReader> }` or fields that use `null` to clear and `undefined` to leave unchanged.
   - Apply the same semantics to `binaryCellReaderForViewport`, `interactiveElements`, `centerAcrossSpanProvider`, and any optional dependencies in `GridLayersConfig`.
   - Update `factory.ts` and `grid-canvas` render-context handlers so removed readers/providers clear the layer rather than leaving stale dependencies.
   - Add regression tests that install a reader, clear it, and prove the old reader is not used in a later render.

6. Refactor `CellsLayer` around a frame render plan.

   - Introduce a `CellFrameRenderPlan` that resolves the region reader, doc-space dirty rects, theme, editor state, sheet id, and visible cells once per region.
   - Introduce a typed `CellVisualRecord` or recyclable struct for the data currently held in `CellRenderInfoExtended`.
   - Split painters by responsibility: background/fill/border, conditional-format bars/icons, text layout, rich/wrapped/shrink/rotated text, indicators/interactive elements, sparklines, and in-cell images.
   - Preserve pass ordering exactly: fills/borders/data bars first, then content and indicators.
   - Replace string-key maps in the hot path where numeric row/column keys are sufficient, especially overflow and merge/center tracking.
   - Keep the refactor production-path only; do not create a separate test renderer.

7. Continue migrating metadata to the viewport payload.

   - Inventory every `cellData` call still made per visible cell in `CellsLayer`, including sparklines, filter headers, binding status, validation, dropdowns, and in-cell images.
   - For each category, choose either binary buffer fields, a per-region side table keyed by numeric cell key, or a batch metadata reader populated by viewport wiring.
   - Preserve contracts for data that is genuinely dynamic or not yet in Rust, but make the fallback explicit and measurable so the hot path can track remaining object allocations and source calls.

8. Fix targeted dirtying for image loads and overflow.

   - Track source cell coordinates for each in-cell image load/error and mark only that cell's document rect, expanded for merge and overflow dependencies where relevant.
   - Make image dirty scheduling use the existing `GridRenderScheduler` or a renderer-layer callback rather than calling full cells dirty from inside an image event.
   - Keep `OverflowIndex` incremental behavior, but verify it survives multi-region frame rendering after the frame lifecycle change.
   - Add tests for image load/error invalidating only the affected cell or merge, and for overflow text repainting both source and destination cells.

9. Modernize or quarantine legacy viewport helpers.

   - Audit all exports from `viewports/index.ts` and `viewports/viewport.ts`.
   - Reimplement `calculateViewport`, `pixelToCell`, header helpers, and total-size helpers over `ViewportPositionIndex` where they remain useful.
   - If a helper is no longer production-path, remove it from the public barrel or mark it as legacy internal and replace consumers with `computeViewportLayout`, `computeVisibleRange`, and layout-aware hit testing.
   - Remove "MVP/Future" approximation comments once the contract is explicit; approximations may remain only when they are named as scrollbar estimates and covered by tests.

10. Lock package boundaries and observability.

   - Keep `.eslintrc.cjs` coordinate-boundary enforcement, and add any new geometry helper files to the allowlist only if they implement the formula rather than consume it.
   - Add lightweight debug metrics for visible-cell count, skipped cells due to missing reader, per-cell metadata fallback calls, image dirty count, and hit-test path used.
   - Do not add `grid-canvas` imports into `grid-renderer`; pass layout and geometry contracts in through types from public contracts or viewport packages.

## Tests and verification gates

Required focused tests during implementation:

- `cd mog/canvas/grid-renderer && pnpm test`
- `cd mog/canvas/grid-renderer && pnpm typecheck`
- `cd mog/canvas/grid-canvas && pnpm test`
- `cd mog/canvas/grid-canvas && pnpm typecheck`
- `pnpm typecheck` from `mog` for any change that touches exported package contracts or cross-package imports.

Specific contract tests to add or strengthen:

- `GridHitTest` under scroll, zoom, frozen panes, split panes, hidden headers, outline gutters, hidden rows/columns, merged cells, table handles, formula handles, selection borders, fill handles, and divider spans.
- A `grid-canvas` composition test proving the registered engine grid hit-test provider and `GridRendererImpl.hitTest()` return the same target for the same point after overlay/drawing providers miss.
- Multi-region frame rendering tests where `CellsLayer` accumulates clipped cells, overflow dependencies, and interactive elements across frozen corner, frozen rows, frozen columns, and main regions.
- Optional-reader clearing tests for `binaryCellReader`, `binaryCellReaderForViewport`, interactive collector, and center-across provider.
- Dirty rect tests for overflow source/destination repaint, merged-cell dirty expansion, in-cell image load/error targeted invalidation, and partial cache compositing.
- Coordinate splitting tests for `rangeToViewport`, `documentToViewport`, and `documentToLayerViewport` across frozen and split regions.
- Barrel/export contract tests or type tests if public exports are removed, renamed, or narrowed.

Required browser verification for UI changes:

- Run the spreadsheet dev server and exercise real pointer and keyboard input paths in a browser.
- Verify clicking, selecting, dragging fill handles, resizing headers, formula range dragging, table resizing, and object-overlay pass-through after scroll, zoom, freeze panes, split panes, hidden headers, and hidden rows/columns.
- Use real UI events and clipboard/input paths for E2E coverage; do not shortcut by directly mutating renderer state.

Performance verification must use the production renderer path in `grid-canvas` and `canvas-engine`, not isolated mocks. Record frame time, rendered visible-cell count, skipped cells due to reader gaps, metadata fallback calls, allocations where available, dirty rect count, and full-vs-partial repaint count before and after the cells-layer refactor.

## Risks, edge cases, and non-goals

Risks:

- Unifying hit testing can expose existing app code that depended on the legacy `CoordinateSystemImpl.classifyPoint` shape. Keep exported result types stable or update all consumers deliberately.
- Multi-region splitting can change overlay placement for ranges spanning frozen boundaries. Tests must define the expected list of rects and preserve existing single-rect consumers only through explicit primary-rect helpers.
- Moving frame-scoped clears out of `CellsLayer.render()` requires canvas-engine lifecycle changes or a carefully documented duck-typed hook. If only one layer uses it initially, still make the hook general enough for future layers.
- Optional-reader clearing can make transient missing-reader frames visible. That is correct if the buffer is absent, but tests should distinguish real loading gaps from stale-reader regressions.
- Refactoring `CellsLayer` can accidentally change painter order. Keep pass ordering and clipping contracts under test before splitting the file.
- Reducing allocations with numeric keys can introduce collisions if row/column limits or sheet IDs are not encoded correctly.

Edge cases to cover:

- Rapid scroll where `BinaryCellReader.moveTo()` returns false for some visible cells.
- Sheet switch where old readers, clipped-cell state, interactive elements, and image load callbacks must not leak into the new sheet.
- Frozen panes with a selection or merged range crossing the frozen boundary.
- Split panes with different scroll offsets and overlapping z-order.
- Hidden row/column boundaries adjacent to merged cells and resize handles.
- Header visibility toggled while hit-test providers are registered.
- Outline gutters with row and column grouping level buttons.
- High-DPR displays, fractional zoom, and pixel-snapped grid/header/divider lines.
- Text overflow left and right, center-across selection spans, wrapped text, shrink-to-fit, rich text, rotated text, CJK fallback fonts, and clipped-text tooltips.
- In-cell images loading after their source cell has scrolled out, changed sheet, or been deleted.
- Very large merges in `ViewportMergeIndex`, including memory behavior for full-row or full-column merges.

Non-goals:

- Do not replace `@mog/canvas-engine` or create a grid-specific render loop.
- Do not optimize test-only render helpers or mocks as the primary outcome.
- Do not reintroduce a dimension-provider fallback for the production hot path.
- Do not add compatibility shims that preserve wrong geometry behind flags.
- Do not add dependencies from `mog` to `mog-internal`, or from `grid-renderer` to app-specific spreadsheet packages.
- Do not make broad UI redesign changes; this plan targets renderer correctness, contracts, hit testing, and performance.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable once the geometry contract is written down.

- Agent A: define the canonical geometry contract and refactor `GridHitTest`, `viewports/hit-testing.ts`, formula-range hit testing, and divider/header hit tests around current `ViewportLayout`.
- Agent B: convert `CoordinateSystemImpl` into a compatibility facade, implement multi-region range/rect splitting, and update `GridRendererImpl.hitTest()` to use the same grid hit-test path.
- Agent C: add the layer frame lifecycle hook in `canvas-engine`, update `CellsLayer` frame-scoped state, and cover frozen/split multi-region rendering.
- Agent D: implement explicit nullable update semantics for optional layer dependencies and update `factory.ts` plus `grid-canvas` render-context handlers.
- Agent E: refactor `CellsLayer` into a render plan and painters, then reduce hot-path allocations without changing painter order.
- Agent F: audit and migrate remaining per-cell metadata reads into viewport payloads or batched side tables.
- Agent G: modernize or quarantine legacy viewport exports and update consumers.
- Agent H: run browser verification and performance measurement on the production spreadsheet renderer.

Dependencies:

- The geometry contract should land before hit-test and coordinate-system rewrites so all agents target the same transform semantics.
- The frame lifecycle hook requires `canvas-engine` changes before `CellsLayer` can safely aggregate per-frame state across regions.
- Optional-reader clearing can be implemented independently and should land early because it removes stale-data ambiguity during the larger renderer refactor.
- Cells-layer painter decomposition should wait until frame lifecycle and explicit update semantics are in place, because both change the layer's orchestration surface.
- Metadata migration depends on viewport reader and contracts changes outside `grid-renderer`; those changes should be planned with `views/sheet-view`, `contracts`, and any Rust viewport-buffer producers.
