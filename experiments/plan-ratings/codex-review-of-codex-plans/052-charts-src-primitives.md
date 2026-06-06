Rating: 8/10

Summary judgment

This is a strong plan with unusually good production-path awareness. It correctly identifies that `charts/src/primitives` is not just a local rendering utility folder: it is the low-level contract for bridge-owned `ChartMark` rendering, chart DOM previews, worksheet canvas painting, browser image export, hit testing, scales, and native export adjacency. The plan is architecturally aligned with Mog's public/private boundary and pushes toward a single render and scale contract instead of continuing duplicated semantics.

The rating is not higher because several important behaviors are still framed as decisions to make during implementation rather than as specified outcomes. For a folder whose main problem is implicit contracts, the plan should choose the contracts for invalid scales, empty color ranges, UTC time behavior, WebGL production status, and native parity before assigning implementation slices.

Major strengths

- The scope is accurate and well bounded. It preserves `ChartMark` as the canonical public bridge IR and does not propose a charts-local schema fork.
- The production-path analysis is concrete. It covers `renderMark`, `renderMarks`, `CanvasRenderer`, the DOM chart engine, kernel worksheet painting, spreadsheet image export, and node/native export rather than optimizing a local test-only path.
- The renderer diagnosis matches the code: `CanvasRenderer` duplicates mark drawing logic while `renderMark` uses mark-specific renderers, making semantic drift likely.
- The scale diagnosis is also grounded. `ChartScale` currently lives in a deep `scales/types` path, while grammar scale creation aliases advertised `pow`, `sqrt`, and `symlog` behavior to linear and duplicates partial band/point/color/time logic.
- The verification section is much better than a generic "run tests" list. It names relevant package gates and adds production-adjacent browser exercises for worksheet chart rendering, resize, hit testing, and export.
- The parallelization slices are sensible: renderer, scales, resolver, hit testing, and production verification are separable but correctly require central integration ownership.

Major gaps or risks

- Too many contract choices are deferred. "Define log-scale behavior", "use a documented fallback or throw", "decide WebGL production status", and "update resize behavior or prove cached marks are invariant" are good prompts, but they are not final implementation specifications.
- The scale objective is very broad relative to the source folder. Implementing `pow`, `sqrt`, `symlog`, `quantile`, `quantize`, and `threshold` needs explicit semantics for domains, ranges, ticks, inversion, color use, axis/legend integration, and grammar schema compatibility. The plan lists the scale families but does not define their expected behavior.
- Native export parity is under-specified. The plan mentions node/native verification only when semantics change, but the proposed style contract includes gradients, shadows, line semantics, clips, and text behavior that may need explicit parity or explicit exclusion for `compute-chart-render`.
- The render equivalence harness is promising but underspecified. It should define how to compare operations when batching, gradients, text measurement, rich text, clips, and save/restore boundaries produce intentionally different call sequences.
- Public API cleanup lacks a migration strategy. Re-exporting `ChartScale` or removing deep imports can break consumers; the plan should specify package export tests, compatibility windows, and which import paths are canonical versus deprecated.
- Hit testing improvements are correct in direction, but the plan does not define target behavior for overlap ordering, hidden/non-renderable marks, marks with `fill: 'none'` but stroked geometry, or tolerance around thin strokes.

Contract and verification assessment

The plan has strong contract instincts: painter order, CSS-pixel coordinates, DPR responsibility, canvas state isolation, clip application, arc angle conventions, symbol area semantics, scale purity, categorical edge cases, and production-path equivalence are all called out. That is the main reason this rates highly.

The weakness is that several contracts are still expressed as categories to cover instead of executable acceptance criteria. A worker implementing this plan would still have to make policy decisions about invalid scale inputs, local versus UTC tick generation, color-scale empty ranges, WebGL fallback ordering, and native export support. Those decisions should be specified before implementation because they affect public behavior.

The verification gates are relevant and realistic: `@mog/charts` tests and typecheck, kernel chart tests and typecheck when bridge/cache behavior changes, spreadsheet export/UI checks for visible chart rendering, and node/Rust checks when native raster export changes. The plan should add package export/public API tests and at least one pixel or golden-image comparison gate for browser and export parity, because operation logs alone will not catch all rendered visual differences.

Concrete changes that would raise the rating

- Replace "define/decide" bullets with chosen contracts: invalid log domains, mixed-sign log behavior, UTC versus local time ticks, empty color ranges, unknown categorical values, and WebGL production status.
- Add a scale contract table with one row per advertised scale type and columns for domain shape, range shape, mapping, invert support, ticks, tick formatting, clamp/nice behavior, invalid input behavior, and axis/legend expectations.
- Specify the renderer equivalence harness in detail: fixture mark set, operation normalization rules, allowed batching differences, state-leak assertions, and when pixel comparison is required instead of operation comparison.
- Add explicit native export parity policy for each mark/style feature: supported in browser and native, browser-only with documented fallback, or rejected before export.
- Define public API migration rules for `@mog/charts` and `@mog/charts/primitives`, including package export tests and whether deep `scales/types` imports remain supported.
- Add acceptance criteria for DOM resize recompilation: which marks are dimension-dependent, when cached compiles are invalidated, and how browser tests prove worksheet and preview paths both redraw at the new logical size.
