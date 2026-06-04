# 052 - charts/src/primitives Improvement Plan

## Source folder and scope

Public source folder: `/Users/guangyuyang/Code/mog-all/mog/charts/src/primitives`

Scope:
- Chart mark primitive APIs and Canvas2D rendering semantics in `marks/*`.
- Scale APIs and implementations in `scales/*`.
- Renderer integration in `renderer/*`, including `CanvasRenderer`, `WebGLRenderer`, and `GridHitTester`.
- Font helpers in `font.ts` only where they affect primitive text rendering.
- Production integration points that consume this folder: chart grammar/compiler, DOM chart engine, kernel chart bridge, spreadsheet chart image export, and node/native export.

Out of scope for the implementation itself unless required to preserve the production contract:
- Rewriting chart grammar/layout wholesale.
- Changing chart data extraction or workbook chart storage semantics.
- Replacing the canonical mark IR with a charts-local schema.
- Optimizing benchmark-only render paths.

## Current role of this folder in Mog

`charts/src/primitives` is the low-level render and scale layer for Mog charts. Its mark types are aliases over the canonical `ChartMark` bridge union from `@mog-sdk/contracts/bridges`, so this folder implements browser rendering behavior for bridge-owned IR rather than owning an independent schema.

The folder is also part of the public package surface. `@mog/charts` re-exports `renderMark`, `renderMarks`, and mark types, and `@mog/charts/primitives` exposes marks, scales, renderer helpers, and hit testing.

Production use is split across several paths:
- The kernel chart bridge compiles chart configs through `@mog/charts`, caches `ChartMark[]`, then paints worksheet charts synchronously through `renderMark` after applying chart bounds translation and clipping.
- The spreadsheet browser image exporter recompiles marks at export dimensions, scales an offscreen canvas by pixel ratio, fills a background, and calls `renderMarks`.
- The DOM chart engine creates a `CanvasRenderer` and uses its batched render path for preview/browser chart instances.
- Native/node export obtains marks at export size before handing them to the native rasterizer path.

Existing tests are broader than the local `src/primitives/__tests__/font.test.ts`: top-level `charts/__tests__/primitives/{marks,renderer,scales}.test.ts`, `charts/__tests__/batch-renderer.test.ts`, and production-adjacent kernel bridge tests already exercise significant behavior. The gap is not absence of tests; it is that important contracts are implicit, split across duplicated render paths, and not verified as production-path equivalence.

## Improvement objectives

1. Make `ChartMark` rendering a single explicit contract across `renderMark`, `renderMarks`, `CanvasRenderer.render`, worksheet chart painting, and image export.
2. Remove semantic drift between standalone mark renderers and the batched `CanvasRenderer` drawing implementation.
3. Define and enforce complete style renderability rules, including `fill: 'none'`, `stroke: 'none'`, paint specs, line styles, opacity composition, gradients, shadows, clipping, and text styles.
4. Bring primitive scales and grammar resolver scales into one coherent scale contract instead of maintaining partial wrappers that can diverge from primitive scale behavior.
5. Implement or explicitly reject every advertised chart scale type in the production resolver; do not silently alias `pow`, `sqrt`, or `symlog` to linear behavior.
6. Align hit testing with rendered geometry, including mark clipping, rotated/wrapped/rich text bounds, path geometry, arc/ring geometry, and symbol sizing.
7. Decide the production status of `WebGLRenderer`: either integrate it without violating painter order/clips/fallback semantics or keep it out of the production renderer contract.
8. Preserve public package boundaries: `mog` must not depend on `mog-internal`; any schema changes belong in public contracts, not internal planning.

## Production-path contracts and invariants to preserve or strengthen

- Canonical mark IR remains `ChartMark` from `@mog-sdk/contracts/bridges`; primitive type aliases must not fork the schema.
- Mark coordinates are chart-local CSS pixels. DPR handling belongs to renderer setup or caller context scaling, not to mark coordinates.
- Painter order is authoritative. `collectMarks` order and caller order must be preserved even when renderer batching is enabled.
- `renderMark`, `renderMarks`, `CanvasRenderer.render`, kernel worksheet painting, browser image export, and DOM chart rendering must produce equivalent mark semantics for the same mark list and logical size.
- Canvas state isolation is required. Rendering a mark or batch must not leak transform, clip, alpha, font, dash, shadow, or line style state into subsequent caller drawing.
- Rectangular `mark.clip` must apply before all mark drawing and hit testing for that mark.
- Arc angles remain `0` at 12 o'clock and increase clockwise. Symbol `size` remains area in square pixels, not radius or diameter.
- Scale functions remain pure callable objects with fluent configuration and copy independence.
- Continuous scale `invert`, `ticks`, `tickFormat`, `nice`, and `clamp` behavior must be deterministic for reversed domains/ranges, degenerate domains, and invalid inputs according to an explicit contract.
- Time scale behavior must be explicit about local time versus UTC, daylight-saving boundaries, invalid dates, and month/year interval approximation.
- Categorical scale behavior must define duplicate categories, unknown categories, empty domains, empty ranges, reversed ranges, padding, `align`, rounding, `bandwidth`, and `step`.
- Color scale behavior must define unknown values, empty color ranges, implicit domain extension, interpolation color space, and finite fallback colors.
- Tests must use the actual production render and scale paths, not test-only shortcuts.

## Concrete implementation plan

1. Contract inventory and public API cleanup
- Write a short public contract document or inline test matrix for `ChartMark`, `MarkStyle`, paint specs, `ChartScale`, and each primitive renderer entry point.
- Re-export `ChartScale` from `charts/src/primitives/scales/index.ts` if it is intended as public API; otherwise move production imports away from deep `scales/types` paths.
- Add missing type surface for runtime APIs such as band `rangeRound`, or remove unsupported methods if they are not part of the intended API.
- Audit all `@mog/charts/primitives` and root `@mog/charts` exports so the public surface has one intentional import path per concept.

2. Shared mark painting core
- Extract a shared mark painting core that separates three concerns: normalize style, build mark geometry/path, and draw/fill/stroke that geometry.
- Make `renderMark` and `CanvasRenderer` call the same mark-specific drawing functions. `CanvasRenderer` may keep batching, but it should not duplicate rect/arc/path/symbol/text semantics.
- Centralize style normalization so all paths agree on `none`, `transparent`, fill/stroke paint priority, line opacity, global opacity, dash reset, line cap/join/miter, gradients, patterns, shadows, and fallback strings.
- Add explicit handling for legacy string sentinels such as `fill: 'none'` and `stroke: 'none'` because production emitters still generate them.
- Keep `renderMark` as the canonical slow path and make batched rendering a proven optimization over that exact behavior.

3. Renderer integration and lifecycle
- Add an equivalence test harness that feeds representative `ChartMark[]` through `renderMarks` and `CanvasRenderer.render` using a recording canvas context, then compares semantic drawing operations after allowing for expected batching differences.
- Preserve adjacent-only batching so painter order is never reordered.
- Update DOM chart resize behavior so dimension-dependent marks are recompiled on logical size changes, or formally prove and document which cached marks are resize-invariant. The export path already recompiles at target dimensions; normal DOM rendering should not silently redraw stale layout marks after resize.
- Ensure export-with-background in the DOM chart engine uses the same rendering semantics as normal rendering, not a separate direct loop that can diverge.
- Define renderer destroy/getContext behavior after destruction so callers cannot accidentally render through a null context.

4. Scale contract and resolver unification
- Build a table-driven scale test matrix for linear, log, time, band, point, generic ordinal, ordinal color, sequential color, and diverging color scales.
- Cover empty, singleton, reversed, duplicate, non-finite, and out-of-domain inputs for every scale family.
- Implement complete primitive support for declared grammar scale types: `linear`, `log`, `time`, `utc`, `pow`, `sqrt`, `symlog`, `quantile`, `quantize`, `threshold`, `band`, `point`, ordinal/categorical color, sequential color, and diverging color.
- Refactor `grammar/encoding-resolver.ts` to construct or wrap primitive scales through shared factories rather than duplicating partial scale logic.
- Fix categorical `align` so it affects band/point placement, including reversed ranges and rounded output.
- Define log-scale behavior for zero, mixed-sign domains, negative domains, and invalid bases without silent coercion that hides user-visible scale errors.
- Define time versus UTC scales separately. Use UTC date methods for `utc` ticks/formatting if the grammar advertises UTC.
- Ensure color scales never return `undefined` when their type promises `string`; empty ranges should use a documented fallback or throw at scale construction based on the chosen contract.

5. Hit testing and bounds alignment
- Introduce shared geometry/bounds helpers used by both renderers and hit testing.
- Apply `mark.clip` during hit testing before narrow-phase geometry.
- Replace path bounding-box-only hit testing with Canvas2D `Path2D`/recorded path geometry where available, with a deterministic fallback for non-DOM tests.
- Align text hit bounds with `getTextBounds`, rich text measurement, wrapping, max width, line height, alignment, baseline, rotation, underline/strikethrough decorations where applicable.
- Expand `GridHitTester` tests so spatial indexing is only broad phase; mark-specific narrow phase must match rendered geometry.

6. WebGL production decision
- Treat current `WebGLRenderer` as experimental unless it can preserve painter order, clipping, mark style semantics, fallback clearing, and DOM overlay lifecycle.
- If promoted, make it render only contiguous compatible circle-symbol runs so it does not pull all circles ahead of non-circle marks.
- Support clip rectangles, opacity, DPR, fallback canvas clearing, and fallback canvas DOM removal on destroy.
- If not promoted, keep it exported as experimental or remove it from production selection paths; do not route worksheet charts through it until the equivalence gates pass.

7. Production integration updates
- Update kernel chart bridge tests when renderer semantics change, especially `renderChartMarks` translation/clip behavior and sync cached paint.
- Update spreadsheet image export tests so export-sized recompilation and `renderMarks` semantics remain covered.
- Add at least one real worksheet chart browser exercise after implementation: insert or load a chart, resize it, export it, and compare that marks render visibly through the worksheet canvas path rather than only `ChartPreview`.

## Tests and verification gates

Required for any implementation touching this folder:
- `pnpm --filter @mog/charts test`
- `pnpm --filter @mog/charts typecheck`

Required when changes affect worksheet rendering, bridge compilation, chart cache behavior, or exported mark dimensions:
- `pnpm --filter @mog-sdk/kernel test -- charts`
- `pnpm --filter @mog-sdk/kernel typecheck`

Required when browser chart image export or visible spreadsheet chart rendering changes:
- Relevant `@mog/app-spreadsheet` chart/export tests.
- `pnpm --filter @mog/app-spreadsheet typecheck`
- Start the spreadsheet dev server and exercise the real worksheet chart path in a browser using normal UI input: create or load a chart, resize it, hover/select if hit testing changed, and export image if export semantics changed.

Required when node/native raster export semantics change:
- `pnpm --filter @mog-sdk/node test -- node-chart-image-exporter`
- If `compute-chart-render` changes, run `cargo test -p compute-chart-render` and `cargo clippy -p compute-chart-render`.

Focused tests to add or strengthen:
- `renderMark` versus `CanvasRenderer.render` operation equivalence for rect, path, arc, text, symbol, clips, gradients, shadows, opacity, dashes, and rich text.
- Style renderability matrix for string and paint-spec `none`, transparent colors, fill/stroke fallback priority, line opacity, and global opacity.
- Scale matrix for every advertised scale type and every edge category listed above.
- Resolver integration tests proving grammar scale specs use the same semantics as primitive scales.
- Hit-testing tests proving `GridHitTester` honors clips and matches rendered geometry.
- Resize/export tests proving dimension-dependent marks are recompiled when logical render size changes.

## Risks, edge cases, and non-goals

Risks:
- Refactoring renderer code can introduce visual drift if equivalence tests are not established first.
- Tightening invalid scale input handling may reveal existing callers that depend on silent coercion.
- Correct hit testing for paths and rotated/rich text may require environment-specific Canvas APIs; the fallback path must stay deterministic in Jest.
- WebGL integration can easily violate painter order because the current implementation separates all circle symbols from other marks.
- Public export changes can break consumers that import deep paths, even inside the monorepo.

Edge cases:
- Empty mark arrays, zero-size marks, negative rect dimensions, zero-radius arcs, full-circle arcs, doughnut arcs, very small symbols, and non-finite coordinates.
- Path commands with relative coordinates, smooth curves, elliptical arcs, malformed numeric tokens, and empty paths.
- Text with theme font tokens, quoted font families, max width, newlines, long unbreakable words, rich text runs, rotation, and non-default baseline/alignment.
- Categorical duplicate labels, empty color ranges, reversed ranges, negative log domains, DST transitions, UTC ticks, and degenerate scale domains.

Non-goals:
- Do not move canonical mark definitions from `@mog-sdk/contracts` into `@mog/charts`.
- Do not optimize benchmark-only renderer code.
- Do not add compatibility shims that preserve known-wrong scale or render behavior.
- Do not make `ChartPreview` the only verification path for worksheet chart behavior.
- Do not leak internal planning content into the public `mog` repo.

## Parallelization notes and dependencies on other folders, if any

This improvement is naturally parallelizable, but integration must be centrally owned because the contracts cross package boundaries.

Parallel slices:
- Renderer worker: shared mark painting core, style normalization, render equivalence tests.
- Scale worker: primitive scale matrix, missing scale type implementations, `ChartScale` API cleanup.
- Resolver worker: `grammar/encoding-resolver.ts` factory unification and axis/legend integration tests.
- Hit-test worker: shared geometry/bounds helpers and `GridHitTester` narrow-phase alignment.
- Production verification worker: kernel bridge, spreadsheet export, node/native export, and browser worksheet chart exercise.

Dependencies:
- `mog/types/bridges` or the current contracts package for `ChartMark`, paint, style, and clip schema changes.
- `mog/charts/src/grammar` for scale resolver, compiler clipping, and generated mark semantics.
- `mog/charts/src/core` for `collectMarks` render order and config-to-spec output.
- `mog/kernel/src/domain/charts` for cached worksheet chart paint and compile orchestration.
- `mog/apps/spreadsheet/src/infra/services/chart-image-exporter.ts` for browser export.
- `mog/runtime/sdk/src/chart-export` and `compute-chart-render` only if native raster export semantics change.
