# Plan 053: Chart OOXML Export Fidelity

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/charts/src/export/ooxml`.

Scope covers the TypeScript chart OOXML export layer exposed through `@mog/charts/export`: chart type dispatch, chartSpace wrapping, axis/legend/style/data-label serialization, chart-family XML emitters, source data references, cached values, native-vs-image-fallback decisions, and the tests that prove generated chart parts are valid in the production XLSX path.

Out of scope for this folder: Rust package graph ownership, ZIP assembly, imported chart replay, and drawing anchor preservation in `file-io/xlsx/parser`. Those are integration dependencies and verification targets, not the primary implementation home for new chart XML semantics.

## Current role of this folder in Mog

`charts/src/export/index.ts` exposes `toOOXML(spec, data, options)` and routes supported `ChartSpec` marks/layers to chart-specific emitters under `charts/src/export/ooxml`. The folder currently emits raw XML strings for classic Excel chart parts:

- `chart-xml.ts` wraps chart content in `<c:chartSpace>`, emits title, legend, plot-area, axes, drawing relationship XML, and two-cell anchor XML.
- `bar-chart-xml.ts`, `line-chart-xml.ts`, `area-chart-xml.ts`, `pie-chart-xml.ts`, and `scatter-chart-xml.ts` produce native chart XML for bar/column, line, stock, area/radar, pie/doughnut/exploded pie, scatter, and bubble charts.
- `shared-xml.ts` and `data-util.ts` centralize part of the category/value series path used by bar, line, area, and radar.
- `axis-xml.ts`, `legend-xml.ts`, and `style-xml.ts` serialize common chart vocabulary.
- `image-fallback.ts` decides when unsupported chart families should not be represented as native OOXML.

Important current gaps from source inspection:

- Series formulas are synthesized by per-chart column conventions (`A:B`, `A/C/E`, `A/B/C`, stock `B:F`, etc.) instead of being derived from a typed source range contract that the workbook writer must also satisfy.
- `ExportOptions.compileResult` is documented but not used, so the export path recomputes lossy series/scale structures instead of preserving production compiler decisions.
- Tests mostly assert string fragments and lightweight well-formedness. They do not validate full XML element ordering, source formulas against workbook data, package integrity from the TypeScript export path, or Excel/LibreOffice openability.
- The support matrix is inconsistent: `canExportToOOXML` reports boxplot as exportable while `toOOXML` throws `ImageFallbackError`; `generateBoxWhiskerChartXML` exists but is not on the production route.
- Axis, style, marker, data label, trendline, error bar, date-axis, secondary-axis, and point/series formatting semantics are only partially mapped from the richer `configToSpec` and chart-IR internal fields.

## Improvement objectives

1. Make native OOXML export fidelity a contract, not a collection of string snippets.
2. Define one authoritative chart source-data/reference model used by every chart family and by any workbook/package integration that writes the referenced data.
3. Make the native support matrix explicit and truthful for each chart family, including ChartEx-only families and image fallback.
4. Preserve the production chart semantics already computed by `configToSpec` and the grammar compiler: series order, point order, blank semantics, date/category/numeric axis type, scale domains, labels, colors, markers, bubble sizes, stock roles, and layer reductions.
5. Replace fragment-only tests with validation that generated chart XML is schema/order-valid enough for Excel consumers and points at real workbook cells.
6. Keep `mog` independent of `mog-internal`; any internal fixtures or reports must stay in internal repos, while public source changes and public tests live in `mog`.

## Production-path contracts and invariants to preserve or strengthen

- `toOOXML` must be pure and deterministic for the same `ChartSpec`, data rows, and export context.
- Every emitted `<c:f>` formula must reference a worksheet range that exists in the exported workbook or in the returned/export-context data table plan. No chart emitter may invent columns privately.
- Cache invariants must hold for every series: `ptCount` equals the logical source point count; omitted blank points keep their original `idx`; non-finite numeric values never serialize as `NaN`, `Infinity`, or `-Infinity`; string values are XML-escaped.
- Sheet names and formulas must use the canonical spreadsheet quoting/escaping utilities, including spaces, apostrophes, punctuation, external-looking names, and absolute references.
- Axis IDs must be unique within a chart part and cross-reference correctly. Secondary axes require complete category/value axis pairs and chart series must reference the intended axis pair.
- Classic chart XML must use classic chart namespaces and element ordering; ChartEx-only features must use the correct ChartEx path or be routed to image fallback with an explicit reason.
- The support decision APIs (`canExportToOOXML`, `getOOXMLChartElement`, and `toOOXML`) must agree.
- Styling and labels must be exported from the same production fields used for rendering, not from parallel defaults.
- Existing package graph invariants in `file-io/xlsx/parser` remain intact: chart parts have content types, drawing relationships point to the registered chart part, chart-owned relationships are emitted only when needed, and package integrity validation passes.

## Concrete implementation plan

1. Establish the export contract matrix.
   - Add a table-driven inventory for every public chart config/type currently routed through `configToSpec`: bar, column, stacked/100% variants, line/smooth/marker variants, area, radar, pie, doughnut, exploded pie, scatter, bubble, HLC/OHLC/volume stock, simple combo/layer reductions, boxplot, violin, heatmap/rect, surface/contour, waterfall, funnel, Pareto, and unsupported layered cases.
   - For each entry define: native classic chart, native ChartEx chart, image fallback, or blocked by missing workbook support.
   - Make `canExportToOOXML`, `getOOXMLChartElement`, and `toOOXML` consume that shared decision table so they cannot drift.

2. Introduce a typed `ChartOOXMLExportModel`.
   - Build one model from `ChartSpec`, data rows, optional `compileResult`, and an explicit `ChartOOXMLExportContext`.
   - Include chart kind, series descriptors, source data columns/ranges, cache values, blank/null policy, axis descriptors, legend descriptors, style descriptors, label descriptors, and fallback reason.
   - Move series extraction out of individual emitters. Category/value, scatter/bubble, pie/doughnut, stock, and radar emitters should consume the same typed model with chart-family-specific projections.
   - Use `compileResult` when provided for resolved scales, domains, mark/layer order, and geometry-derived fields; fall back to compiling once only when the caller did not provide it and the chart family needs compiler output.

3. Replace private column math with a source-reference contract.
   - Add a `ChartDataReferencePlan` to the export model/result that describes the exact helper table/ranges required by the chart: sheet name, start cell, headers, columns, row count, series-to-column bindings, and cell references.
   - Support caller-provided source ranges for charts created from existing workbook data and generated helper-table ranges for in-memory chart data.
   - Update all emitters to reference model-provided `catRef`, `valRef`, `xRef`, `yRef`, and `bubbleSizeRef` values instead of calculating columns locally.
   - Enforce formulas against the reference plan in tests, including multi-series beyond column `Z`, blank middle points, ragged series, filtered/hidden rows, and quoted sheet names.

4. Add a small XML serialization layer for chart parts.
   - Introduce local helpers for ordered elements, attributes, namespace declarations, text escaping, optional children, and numeric attributes.
   - Keep output as strings at the package boundary, but stop assembling large XML documents through untyped interpolation in chart emitters.
   - Encode chart-specific element order in serializers for `chartSpace`, plot area, axes, series, data labels, trendlines, and extension lists.
   - Validate color strings, marker symbols, line widths, alpha, angle units, and enum values before serialization.

5. Complete chart-family mappings systematically.
   - Category/value charts: bar/column/line/area/radar must share series extraction, reference generation, blank handling, data labels, series style, markers, trendlines, error bars, stack/grouping, gap width, overlap, and axis mapping.
   - XY charts: scatter/bubble must preserve raw x/y/bubble sizes, series identity from `SERIES_FIELD`, marker/style fields, negative bubble policy, size representation, and numeric axis formats.
   - Pie/doughnut charts: preserve point order, slice colors, explosion, first slice angle, multiple doughnut rings, legend keys, data label visibility, zero/blank behavior, and stable category/value references.
   - Stock charts: preserve HLC/OHLC/volume ordering, stock role visuals, high-low lines, up/down bars, volume axis policy, marker visibility, and axis pairing for volume combos.
   - Secondary/combo axes: support only combinations with complete axis and source-range contracts; otherwise route to explicit fallback rather than silently exporting the wrong single-axis chart.
   - ChartEx-only families: either implement proper ChartEx output and package dependencies or mark them unsupported in the shared decision table. Do not keep dead native emitters that are unreachable or invalid.

6. Strengthen axis, legend, and style fidelity.
   - Choose `dateAx`, `catAx`, or `valAx` from channel type and source values, not from chart-family defaults.
   - Map scale domains, min/max, reverse/log where supported, major/minor units, tick label position, label rotation, number formats, and gridline visibility from resolved chart config.
   - Map legend orientation, overlay, label font size, and hidden entries from `LegendSpec` and series visibility.
   - Map theme/sRGB colors, opacity, line/fill/stroke, marker shape/size, data labels, and per-point overrides from the chart-IR fields in `charts/src/core/chart-ir/fields.ts`.

7. Connect to the production XLSX path.
   - Update the public export result contract so callers can write the chart XML and its referenced data plan together.
   - Add an integration seam for the workbook writer or bridge layer that materializes helper data ranges before adding chart parts.
   - Keep `file-io/xlsx/parser` package graph ownership unchanged; use its existing integrity validation as the downstream proof that emitted chart parts integrate correctly.

8. Remove misleading or duplicate surfaces.
   - Delete or route unreachable native emitters such as the current box-whisker function once the support matrix decides ChartEx/native/fallback.
   - Consolidate duplicate legend extraction and chart wrapping paths so chart-level options are computed once.
   - Keep image fallback reasons deterministic and user-actionable.

## Tests and verification gates

Required test additions:

- Unit tests for `ChartOOXMLExportModel` and `ChartDataReferencePlan`: series order, reference ranges, quoted sheet names, column overflow past `Z`, ragged series, blank/null points, dates, strings, and non-finite numbers.
- XML serializer tests that parse generated XML with a real XML parser and verify required element order for each chart family.
- Golden fixture tests for the full support matrix, comparing normalized chart XML for representative Excel-compatible outputs.
- End-to-end TypeScript export tests from `ChartConfig -> chartDataToRows -> configToSpec -> compile -> toOOXML`, asserting formulas, caches, axes, labels, styles, and fallback decisions.
- XLSX integration tests that write chart parts plus their referenced data and validate the archived package contains matching worksheet ranges, chart XML, drawing relationships, content types, and no orphan chart-owned relationships.
- Roundtrip/openability gates for a focused corpus of generated workbooks in Excel/LibreOffice-compatible validators where available.

Verification commands for the implementation workstream:

- `cd /Users/guangyuyang/Code/mog-all/mog/charts && pnpm test -- src/export/ooxml __tests__/export/ooxml-export.test.ts __tests__/integration/full-pipeline-export.test.ts`
- `cd /Users/guangyuyang/Code/mog-all/mog/charts && pnpm typecheck`
- `cd /Users/guangyuyang/Code/mog-all/mog && cargo test -p xlsx-parser charts`
- If the implementation changes public TypeScript contracts outside `charts`, run the narrowed package tests for those packages plus the repo's required TypeScript type gate.

## Risks, edge cases, and non-goals

- Risk: Excel accepts some invalid-looking chart XML by repairing it, while stricter validators reject it. The gate should prefer a strict contract and record any intentional Excel-specific compatibility behavior.
- Risk: a helper data table changes workbook shape. The plan must define where generated chart data lives and how hidden/helper sheets are named so formulas stay stable and do not collide with user sheets.
- Risk: using compiler output can expose differences between render-time geometry and export-time chart semantics. Treat the compiler as authoritative and fix export semantics around it.
- Risk: ChartEx families require package relationships, content types, and alternate chart parts. Do not fake these as classic `<c:*>` charts.
- Edge cases: empty data, single-point series, all blanks, negative/zero pie values, dates stored as JS `Date` vs Excel serial numbers, strings that look like formulas, sheet names with apostrophes, series counts beyond 26 columns, hidden series, and multi-layer specs with partial native support.
- Non-goals: preserving arbitrary imported raw chart XML in this TypeScript folder, optimizing benchmark-only paths, adding internal-only planning artifacts to public repos, or broad XLSX package graph rewrites that belong in `file-io/xlsx/parser`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the shared support matrix and export model interfaces are agreed:

- Agent A: build the support matrix and fixture inventory across `charts/src/core/config-to-spec`, `charts/src/grammar`, and `charts/src/export`.
- Agent B: implement the source-reference model and cache invariants in `charts/src/export/ooxml`.
- Agent C: implement XML serializer helpers plus axis/legend/style/data-label mappings.
- Agent D: migrate chart-family emitters in parallel by family: category/value, XY/bubble, pie/doughnut, stock/radar, and fallback/ChartEx decisions.
- Agent E: integrate XLSX package validation through `file-io/xlsx/parser` tests and workbook fixtures.

Dependencies:

- `charts/src/core/config-to-spec` and `charts/src/core/chart-ir/fields.ts` for production rows, point metadata, style fields, blank semantics, stock fields, and bubble sizes.
- `charts/src/grammar/compiler` for resolved scales, domains, marks, and layer ordering.
- `@mog/spreadsheet-utils` for canonical sheet name quoting and A1 formula utilities.
- `file-io/xlsx/parser` for downstream package graph registration, relationship/content-type validation, and XLSX archive integrity tests.
- `file-io/ooxml/types` if the implementation chooses to share typed OOXML vocabulary or validators across Rust and TypeScript boundaries.
