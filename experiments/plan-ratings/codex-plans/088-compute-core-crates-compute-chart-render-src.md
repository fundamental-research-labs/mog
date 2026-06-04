# Improve compute-chart-render Native Chart Raster Surface

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/crates/compute-chart-render/src`

Scope is the public Rust crate source for `compute-chart-render`, currently a single `lib.rs` implementing the headless chart mark rasterizer used by Node SDK chart image export. The plan may require coordinated changes in public sibling folders that feed or consume this crate, especially `mog/runtime/sdk/src/chart-export/node-chart-image-exporter.ts`, `mog/compute/napi/src/chart_render.rs`, `mog/types/bridges/src/chart-bridge.ts`, and `mog/charts/src/primitives`, but the improvement target is the native renderer surface and its production request contract.

## Current role of this folder in Mog

`compute-chart-render` is the native raster backend for chart export in headless Node paths. TypeScript chart semantics remain in `@mog/charts`: the SDK asks `IChartBridge.getMarksAtSize()` for the production `ChartMark[]` IR, serializes a versioned JSON request, calls the N-API `render_chart_marks_image` function, and receives encoded PNG/JPEG bytes plus physical image dimensions.

The current Rust source accepts version `1` JSON, normalizes format/size/DPR/background/quality, paints marks onto a `tiny_skia::Pixmap`, and encodes PNG or JPEG. It supports rect, path/line/area, arc, symbol, and text marks, plus a reduced style projection: fill, stroke, stroke width, dash, opacity, corner radius, rectangular clip for non-text paths, a small color parser, SVG path parsing, symbol geometry, basic font fallback, and text shaping with bundled fonts.

The production browser exporter renders the same canonical `ChartMark` IR through Canvas2D. That IR includes richer style and text fields that the native path currently drops or simplifies through the SDK serializer: `fillPaint`, `strokePaint`, `line`, gradients, shadows/effects, line cap/join/miter, `richText`, `maxWidth`, `lineHeight`, underline, strikethrough, and text clipping. This makes native export a subset renderer instead of a true headless equivalent of the browser chart renderer.

## Improvement objectives

1. Make the native renderer a production-path peer of the browser Canvas2D renderer for the canonical `ChartMark` IR, not a reduced projection hidden behind the SDK serializer.
2. Replace stringly typed raw marks with a strict, versioned Rust request schema that mirrors the public bridge contract and produces precise validation errors.
3. Strengthen rendering parity for paints, line styles, geometry, clipping, text layout, alpha compositing, and image encoding.
4. Bound memory and CPU costs for production exports before allocation or raster work begins.
5. Establish golden and end-to-end verification that compares browser and native output through real SDK/export paths.
6. Keep chart semantic compilation in `@mog/charts`; this crate should rasterize already-compiled marks and should not duplicate chart grammar, scale, or data extraction logic.

## Production-path contracts and invariants to preserve or strengthen

- `render_chart_marks_image_from_json()` and `render_chart_marks_image()` remain the Rust entry points, and the N-API bridge continues to return `{ bytes, format, width, height }`.
- Request coordinates stay in logical chart pixels. `pixelRatio` is the only logical-to-physical transform, and returned dimensions must exactly equal normalized `width * pixelRatio` and `height * pixelRatio`.
- Mark order is paint order. Later marks composite over earlier marks exactly once.
- Versioned request handling is strict: unsupported versions reject; schema evolution must be explicit rather than silently accepting unknown semantics.
- Browser and Node export should render the same canonical marks with the same supported semantics. When the browser renderer intentionally treats a paint as non-renderable, native should match that behavior rather than inventing fallback visuals.
- Empty compiled mark arrays, unsupported formats, invalid colors, non-finite numeric fields, invalid path data, and impossible allocations reject deterministically with actionable error paths.
- The crate must stay public-repo only and must not depend on `mog-internal`.
- Performance work must target the production SDK/N-API renderer path, not a standalone benchmark-only path.

## Concrete implementation plan

1. Split `lib.rs` into explicit renderer modules without changing public entry points:
   - `request.rs`: versioned request, normalized options, typed marks, validation.
   - `style.rs` and `color.rs`: paint, line, opacity, shadow, and CSS color normalization.
   - `path.rs`, `geometry.rs`, and `symbols.rs`: SVG path parsing, arc conversion, rect/arc/symbol path builders.
   - `text.rs`: font resolution, shaping, wrapping, rich text runs, decorations, and text metrics.
   - `surface.rs`: pixmap ownership, clipping, compositing, shadow passes, DPR transforms.
   - `encode.rs`: PNG/JPEG encoding and alpha flattening rules.
   Keep the exported API stable and make all internal modules testable through crate-local unit tests.

2. Promote the native request to the canonical mark contract:
   - Model `ChartMark` as Rust enums/structs instead of `RawMark` with optional fields and string dispatch.
   - Include the full public style/text surface from `mog/types/bridges/src/chart-bridge.ts`: paint specs, line style, shadow/effects, rich text runs, max width, line height, underline, strikethrough, and clip.
   - Update the SDK serializer to emit this full request directly from `ChartMark[]`; remove lossy projection logic that collapses gradients/shadows/rich text before native render.
   - Add contract fixtures that assert every serializable mark variant and symbol shape crosses the TS-to-Rust boundary with no dropped fields.

3. Implement paint and line-style parity with Canvas2D:
   - Parse solid colors through a complete CSS color parser rather than the current small named-color and comma-rgb subset.
   - Implement `solid`, `none`, `groupInherited`, and `pattern` behavior to match `paintToCanvasStyle()` in `@mog/charts`.
   - Implement linear, radial, and rectangular gradients with mark bounds matching the browser renderer.
   - Implement line width, dash, cap, join, and miter limit using tiny-skia stroke capabilities.
   - Implement shadows/effects as an offscreen mask/pixmap pass with offset, blur, color, and opacity, matching browser semantics closely enough for golden tolerances.

4. Close geometry and clipping gaps:
   - Apply clip regions to every mark type, including text and shadow passes, with clipping performed in logical coordinates after DPR normalization.
   - Cache identical clip masks per render request instead of allocating a full-surface mask for every clipped mark.
   - Define systematic behavior for zero and negative geometry. Either reject invalid mark geometry at the contract boundary or match Canvas2D behavior consistently; do not silently no-op only some mark types.
   - Replace polyline-only SVG arc rendering with cubic/ellipse-quality approximation for non-uniform radii and rotation, preserving relative/absolute commands, smooth curves, repeated coordinate groups, close-path behavior, and degenerate arc fallback.
   - Keep symbol geometry in lockstep with `charts/src/primitives/marks/symbol.ts`, including open-line symbols (`x`, `dash`) using fill-as-stroke behavior when the browser path would otherwise stroke them.

5. Bring text rendering to browser-path parity:
   - Use the same measurement function for layout and drawing so wrapped text, rich text, and decorations stay aligned.
   - Support `maxWidth`, `lineHeight`, newlines, word wrapping, long-word breaking, `richText` runs, underline, strikethrough, run-level fill/stroke/font overrides, rotation, and clip.
   - Preserve existing bundled font fallback, but make fallback decisions deterministic and visible in tests for `system-ui`, Carlito, bold, and italic.
   - Decide and document the acceptable tolerance for native font rasterization versus browser Canvas2D, since exact pixel equality is not realistic across engines.

6. Strengthen option normalization and encoding:
   - Add a production image size budget, such as max physical pixel count and max encoded work estimate, before pixmap allocation.
   - Keep exact physical-dimension validation aligned with `normalizeImageExportOptions()`.
   - Reject `quality` on PNG at the shared options layer and map JPEG quality exactly once.
   - Define JPEG alpha behavior and flatten against the normalized background so transparent marks/backgrounds do not leak arbitrary RGB data when alpha is dropped.

7. Improve diagnostics:
   - Include mark index and field path in Rust errors, for example `marks[12].style.fillPaint.stops[1].color`.
   - Preserve useful N-API messages while avoiding generic `chart render failed` errors that hide the invalid field.
   - Add lightweight render metadata in debug/test-only assertions only; do not change the public result shape unless a versioned request/result contract is intentionally introduced.

8. Add production-path verification fixtures:
   - Build fixture charts through `IChartBridge.getMarksAtSize()` and the Node SDK export path, not hand-authored mock-only marks.
   - Cover chart families that exercise every mark category and style category: bar/column, line, area, scatter, bubble, pie/doughnut, radar, stock, box/whisker, heatmap, violin, data labels, legends, titles, and chart/plot frames.
   - Add focused renderer fixtures for edge cases that production chart compilation can emit: gradients, shadows, dashed strokes, clipped labels, rotated axis text, wrapped data labels, rich text titles, transparent backgrounds, high DPR, and JPEG export.

## Tests and verification gates

- Rust unit and fixture tests for the renderer crate:
  - `cargo test -p compute-chart-render`
  - `cargo clippy -p compute-chart-render`
- N-API bridge coverage after request/result contract changes:
  - `cargo test -p compute-napi` if the package has tests for the bridge, otherwise add a focused bridge test and run the package-level Rust gate that owns `compute/napi`.
- TypeScript serializer and SDK export tests:
  - Run the runtime SDK tests covering `runtime/sdk/__tests__/node-chart-image-exporter.test.ts`.
  - Run the production Node SDK chart export tests covering `runtime/sdk/__tests__/chart-export.test.ts`.
  - Run `pnpm typecheck` for TypeScript contract/serializer changes.
- Browser/native parity gate:
  - Add a golden comparison harness that renders the same production `ChartMark[]` through browser Canvas2D and the native N-API backend, then compares decoded pixels with documented tolerances for text antialiasing and gradients.
  - Include a zero-tolerance metadata assertion for format, physical width, physical height, and data URL MIME type.
- XLSX/export production gate:
  - Exercise `Workbook.toXlsx()` with charts so embedded fallback image generation uses the native backend through the same SDK path.
- Robustness gates:
  - Property/fuzz tests for SVG path parsing and CSS color parsing.
  - Rejection tests for non-finite numbers, impossible dimensions, invalid clips, invalid gradient stops, malformed paths, unsupported request versions, and oversized render requests.

## Risks, edge cases, and non-goals

- Native and browser text rasterization will not be byte-identical. The contract should be layout and visual parity within tolerances, with exact assertions reserved for dimensions, validation, and non-text geometry where possible.
- Gradient and shadow algorithms may differ slightly between Canvas2D and tiny-skia. The implementation should match coordinate systems, opacity, and compositing first, then use golden tolerances for engine-specific antialiasing.
- Full CSS color acceptance can expand the set of valid exported charts. That is acceptable only if it matches browser Canvas color semantics and is covered by contract tests.
- This plan does not move chart compilation, scale calculation, chart grammar, or data extraction into Rust. The native crate rasterizes marks only.
- This plan does not add SVG export, PDF rendering, or alternate image fallbacks.
- This plan does not introduce compatibility shims for old private request shapes; the single-branch repo model allows the SDK serializer and Rust schema to evolve together.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the request schema is agreed:

- Agent A: schema and serializer contract across `types/bridges`, `runtime/sdk`, `compute/napi`, and `compute-chart-render`.
- Agent B: Rust paint, line style, color, shadow, and encoding implementation.
- Agent C: Rust path, geometry, symbol, clip, and bounded surface implementation.
- Agent D: Rust text layout, shaping, rich text, wrapping, and decoration implementation.
- Agent E: production fixture generation, browser/native golden harness, SDK export tests, and oversized-request robustness tests.

Dependencies:

- `mog/types/bridges/src/chart-bridge.ts` is the canonical public `ChartMark` contract.
- `mog/charts/src/primitives` is the browser renderer behavior to match.
- `mog/runtime/sdk/src/chart-export/node-chart-image-exporter.ts` owns serialization into the native request.
- `mog/compute/napi/src/chart_render.rs` owns the public native addon bridge.
- `compute-text-measurement` and existing screenshot rendering code are useful references for font and raster conventions, but `compute-chart-render` should remain an independent production renderer crate.
