# 053 — Improve `mog/charts/src/export/ooxml` (chart OOXML export fidelity)

## Source folder and scope

- **Folder:** `mog/charts/src/export/ooxml`
- **Files (production):** `index.ts` (barrel), `chart-xml.ts` (chartSpace wrapper, title, drawing anchor), `axis-xml.ts` (cat/val/date/series axes), `legend-xml.ts`, `style-xml.ts` (colors/fills/lines/fonts/markers/dLbls), `shared-xml.ts` (shared `<c:ser>` cat/val builder, trendline, opacity), `data-util.ts` (series extraction for cartesian charts), `column-util.ts` (0-based index → A/B/…/AA), `bar-chart-xml.ts`, `line-chart-xml.ts` (incl. stock/OHLC), `pie-chart-xml.ts` (pie/doughnut/exploded), `scatter-chart-xml.ts` (scatter/bubble), `area-chart-xml.ts` (area/radar), `image-fallback.ts`, `pie-layer-detection.ts`, `stock-layer-detection.ts`.
- **Tests present:** only `__tests__/bar-chart-xml.test.ts` and `__tests__/scatter-chart-xml.test.ts` — thin coverage relative to the surface.
- **In scope (edit targets):** all of the above. The folder is the OOXML (ECMA-376 DrawingML chart) serializer: pure, side-effect-free functions that turn a compiled `ChartSpec` + `DataRow[]` into `xl/charts/chartN.xml` (plus drawing relationship/anchor and image-fallback fragments).
- **Out of scope (named for coupling, not edited here):**
  - `mog/charts/src/export/index.ts` (the `toOOXML` dispatcher and `getOOXMLChartElement`) and `mog/charts/src/export/ooxml-types.ts` (shared types + `DEFAULT_CHART_COLORS`) — sibling files one level up. This plan **requires additive changes** to `ooxml-types.ts` (new option fields) and to the dispatcher's wiring; those are flagged as cross-file dependencies, not in-folder edits, and must land as part of the same change set.
  - `grammar/spec.ts`, `grammar/compiler.ts` (`CompileResult`), `core/chart-ir/*` (`bar-geometry`, `fields`), `core/config-to-spec/*`, `algebra/group-by` — consumed read-only.
  - The XLSX package writer that actually emits the worksheet holding the cached series data and wires the chart drawing into a sheet (lives outside `charts/`, in the workbook export path). The `<c:f>` cell references this folder fabricates are only correct if that writer lays data out identically — this coupling is the single highest-fidelity-risk dependency and is called out repeatedly below.
  - `@mog/spreadsheet-utils` `quoteSheetName` (re-exported).

## Current role of this folder in Mog

This folder is the **native chart fidelity path** for Excel export. When a user exports a workbook containing a Mog chart, `toOOXML(spec, data, options)` dispatches by mark type to one of the generators here, which emit a complete `<c:chartSpace>` document. Charts with no Excel equivalent (violin, density transforms, complex >2-layer stacks, true heatmaps) are rejected via `ImageFallbackError` and rendered to PNG by the engine package instead.

Each generator follows the same shape: extract series → build chart-type content (`<c:barChart>` / `<c:lineChart>` / `<c:pieChart>` / `<c:scatterChart>` / `<c:bubbleChart>` / `<c:areaChart>` / `<c:radarChart>` / `<c:stockChart>`) → build axes → wrap in `chartSpace` via `wrapChartXML`. Data values are embedded **twice**: as a `<c:f>` formula reference into a worksheet range, and as a `<c:numCache>`/`<c:strCache>` literal cache so the chart renders even before recalculation.

The folder's quality bar is **round-trip and visual fidelity**: an exported chart should open in Excel without a repair prompt and look like the on-screen Mog chart (same colors, categories, number formats, legend placement, stacking, smoothing). The dominant failure modes are therefore (a) **invalid XML** → Excel "we found a problem" repair/drop, and (b) **silent visual drift** → chart opens but colors/axes/labels are wrong.

## Evidence (observed in the current tree)

1. **Number-format codes are injected into XML attributes without escaping.** `axis-xml.ts:126` emits `<c:numFmt formatCode="${format}" .../>` where `format = channel?.format ?? config?.format`. `escapeXml` (`style-xml.ts:19`) is applied only to text-node content elsewhere and is **never** applied here. Excel custom format codes routinely contain `"` (literal text, e.g. `"$"#,##0`) and `&`; either produces malformed attribute XML → Excel repair/reject. The date axis (`axis-xml.ts:174`) hardcodes `m/d/yyyy` so it is safe, but the value axis is exposed.

2. **Cached series number format is always `General`.** Every `<c:numCache>` hardcodes `<c:formatCode>General</c:formatCode>` (`shared-xml.ts:83`, `pie-chart-xml.ts:222,642`, `scatter-chart-xml.ts:219,229,309,319,329`, `line-chart-xml.ts:438`). The value axis can carry a format, but data labels, tooltips, and the data-table view read the cache format. Currency/percent/date series therefore render values as raw numbers regardless of the spec's resolved number format.

3. **Date and numeric categories are forced to strings.** `generateCategoryValueSeriesXML` (`shared-xml.ts:70-78`) always wraps categories in `<c:cat><c:strRef><c:strCache>` and serializes each with `escapeXml(String(cat))`. `SeriesData.categories` is typed `(string | number | Date)[]` (`ooxml-types.ts`), so a `Date` becomes the JS string `"Mon Jan 01 2024 …"` and a number becomes a text category. `generateDateAxisXML` exists (`axis-xml.ts:152`) but **no generator calls it** — bar/line/area always pair a `catAx` with `strRef` categories. Time-series and quantitative-x charts lose axis semantics and sort order.

4. **Fabricated `<c:f>` cell references assume a data layout this folder never writes.** Cartesian series hardcode categories to column `A` rows `2..N` and values to `columnLetter(index+1)` (`shared-xml.ts:53-61`); scatter uses `index*2`/`index*2+1` (`scatter-chart-xml.ts:187-190`); bubble uses `index*3..+2` (`:283-288`); pie uses `A` + `columnLetter(index+1)` (`pie-chart-xml.ts:196-198`). These ranges are only valid if the external workbook writer materializes data in exactly this shape. There is no shared constant or contract tying the two together, so any drift silently produces references that point at the wrong/empty cells (cache still renders, but "Edit Data" / recalculation break).

5. **Color-grouped multi-series collide on the same category column.** `extractSeriesData` (`data-util.ts:72-88`) groups rows by the color field, so each series can have a **different** category set, yet `generateCategoryValueSeriesXML` references `A$2:A$<thisSeriesCount>` for *every* series and emits each series' own `<c:strCache>`. When groups are sparse or unequal-length (series A = {Q1,Q2}, series B = {Q2,Q3}), Excel cannot align them on a shared category axis — real spreadsheets align by the union of categories. Bars/points land on the wrong category.

6. **Resolved color-scale colors are ignored for all cartesian charts.** `extractSeriesData` and the scatter/bubble extractors always assign `getDefaultColor(index)` (`data-util.ts:65,83`, `scatter-chart-xml.ts:384,402,436,457`), discarding `encoding.color.scale.range` and any compiled color scale. Pie **does** read `encoding.color?.scale?.range` (`pie-chart-xml.ts:430-435`, `colorRangeForEncoding`), proving the data is reachable. Exported bar/line/area/scatter/radar charts therefore use the default Excel palette even when the on-screen chart uses a custom scheme — a guaranteed visual mismatch. The documented `options.compileResult` (`ooxml-types.ts` `ExportOptions`) is never consulted for color or domain.

7. **`<a:srgbClr>` is emitted inline without normalization in most generators.** `generateSrgbColorXML` (`style-xml.ts:44`) correctly strips a leading `#` and uppercases, but bar (`bar-chart-xml.ts:130`), line (`line-chart-xml.ts:161`), area (`area-chart-xml.ts:119,124`), scatter/bubble (`scatter-chart-xml.ts:195,221,298`), radar (`area-chart-xml.ts:253,262,267`), and stock (`line-chart-xml.ts`) interpolate `val="${series.color}"` directly. Pie normalizes via `normalizeHexColor` (`pie-chart-xml.ts:277`). If any color source ever yields `#4472C4` or lowercase, the non-pie paths emit invalid `val="#4472c4"`. Inconsistent and fragile.

8. **Spec-requested data labels are dropped on cartesian charts.** Bar/line/area/scatter/bubble/radar always call `generateDataLabelsXML()` with all flags false (`bar-chart-xml.ts:114`, `line-chart-xml.ts:134`, etc.), so value/category/series labels are never exported even when the spec requests them. `DataLabelConfig` is defined in `ooxml-types.ts` but unused on the production path. Pie is the only chart that conditionally shows labels, and only `showPercent`, gated on `DATA_LABEL_VISIBLE_FIELD` (`pie-chart-xml.ts:264-275`).

9. **Dual-axis ("independent y") support is a dead, incomplete path.** `wrapChartXMLFromSpec` (`chart-xml.ts:98-121`) adds a `SECONDARY_VALUE` axis when `spec.resolve.scale.y === 'independent'`, but (a) `toOOXML` calls each generator's own `wrapChartXML` directly and **never** calls `wrapChartXMLFromSpec`, so the branch is unreachable in production; and (b) even if reached, no series is assigned to the secondary axis and no second plot group is emitted, so the axis would float with nothing plotted on it. Dual-axis charts export as single-axis.

10. **`Number(x) || 0` discards blanks, gaps, and legitimate zeros differently across chart families.** Scatter/bubble (`scatter-chart-xml.ts:375-377,399-405`), stock (`line-chart-xml.ts:412`) coerce with `Number(row[f]) || 0`, collapsing `null`/`NaN`/missing into `0`. `data-util.ts` `valueForExport` correctly preserves blanks as `null` (and `shared-xml.ts:87` omits null points from the cache). Blank-handling is thus inconsistent: bar/line/area honor `displayBlanksAs`, scatter/bubble/stock cannot.

11. **`generateBoxWhiskerChartXML` emits an element that does not exist in the `c:` namespace.** `bar-chart-xml.ts:276` produces `<c:boxWhiskerChart>`; box-and-whisker is a `cx:` (chartex / `chartEx`) construct in real OOXML. `index.ts` already routes `boxplot` to `ImageFallbackError` (`export/index.ts:161-166`), so this function is dead **and** invalid — a latent foot-gun if anything ever calls it.

12. **Drawing anchor emits a zero extent and fixed identifiers.** `generateTwoCellAnchorXML` (`chart-xml.ts:347-350`) writes `<a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` and a hardcoded `cNvPr id="2"`. `generateImageEmbedXML` (`image-fallback.ts:206-211`) hardcodes the `to` anchor to `col=8,row=15` regardless of the `width`/`height` passed in, so the image fallback ignores its own sizing inputs. Multiple charts/images on one sheet will collide on id `2`.

13. **Legend decisions are duplicated and inconsistent.** Three independent code paths decide the legend: per-generator `showLegend` heuristics that hardcode `{ position: 'r' }` (bar/line/area/scatter), `extractLegendPosition` (`chart-xml.ts:233-274`, used only by the dead `wrapChartXMLFromSpec`), and `legendPositionForSpec` (`pie-chart-xml.ts:500-510`, the only one that honors `legend.orient`, `legend === null`, `orient: 'none'`, and `overlay`). Non-pie charts ignore the spec's requested legend orientation and overlay.

14. **Declared namespaces are unused; modern-Excel markup cannot be emitted.** `CHART_NAMESPACES` (`chart-xml.ts:23-30`) defines `mc`, `c14`, `c16r2`, but `wrapChartXML` (`chart-xml.ts:58-60`) only declares `c`, `a`, `r`. There is no `AlternateContent` / `c16` series-unique-id emission, which newer Excel writes; not fatal, but limits forward fidelity and dedupe-on-reopen behavior.

15. **Otherwise clean baseline.** Pure functions throughout (no I/O, no globals); `columnLetter` correctly handles ≥26 columns; `sanitizeNumericValue` guards NaN/Infinity; `quoteSheetName` is used consistently for sheet references; pie data-point colors, explosion, and doughnut hole-size are handled with care. The work below is **fidelity tightening and consolidation**, not a rewrite.

## Improvement objectives

1. **Never emit invalid XML.** Escape every value that lands in an attribute (number-format codes first), normalize every color through one helper, and guarantee well-formed output for arbitrary user input (custom formats, Unicode, `&`/`<`/`"`/`'`, leading-`#` colors).
2. **Preserve number formats end-to-end.** Carry the resolved Excel format code from the spec into both the value axis *and* the series `<c:numCache>`/data labels.
3. **Preserve category type and ordering.** Emit `<c:numRef>` + a numeric/date axis for quantitative/temporal x; reserve `<c:strRef>` + `catAx` for nominal/ordinal x. Wire the already-built `generateDateAxisXML`.
4. **Preserve colors.** Use the resolved color-scale range (and `compileResult` when present) for cartesian series, matching the pie path, so exported colors equal on-screen colors.
5. **Make data references consistent and contract-bound.** Centralize the `<c:f>` range layout in one module with an explicit, documented contract shared with the workbook writer, and align color-grouped multi-series on a shared category axis.
6. **Consolidate the three legend decisions and the three color-emission idioms into one path each.**
7. **Either implement or remove dead/invalid paths** (`wrapChartXMLFromSpec` dual-axis, `generateBoxWhiskerChartXML`) so the production surface is honest.
8. **Honor spec data labels and legend orientation/overlay across all chart types.**

## Production-path contracts and invariants to preserve or strengthen

- **Purity.** Every export function stays pure and synchronous (no I/O, no `Date.now`, no global state). Preserve.
- **Cache + reference duality.** Every numeric/category series must emit both a `<c:f>` reference and a literal cache; the cache must remain valid OOXML even when the reference points nowhere. Preserve and strengthen (caches must carry correct format codes and types).
- **Fallback boundary.** Charts without an Excel equivalent must throw `ImageFallbackError`, never emit a malformed native chart. Preserve; do not widen native coverage to types that cannot be faithfully represented.
- **Well-formedness invariant (strengthen).** *All* text inserted into an XML attribute is escaped; *all* colors pass through one normalizer; output always parses and opens in Excel without repair. This is currently violated (Evidence 1, 7).
- **Axis-ID uniqueness (strengthen).** Axis IDs must be unique within a chart and consistent between each plot group's `<c:axId>` and the axis element. Today a single shared `AXIS_IDS` constant works only because no production chart emits two same-type plot groups with distinct axes; dual-axis support must allocate unique IDs per plot group.
- **Data-layout contract (introduce).** The `<c:f>` range mapping (which column/row holds which series' categories and values) must be a single named contract shared with the workbook writer, not re-derived independently in five files.
- **Blank semantics (unify).** A blank/missing data value maps to one representation across all chart families, consistent with `displayBlanksAs`.

## Concrete implementation plan

Sequenced so correctness/validity fixes (no behavior risk) land first, then fidelity features, then consolidation.

### Phase 1 — XML validity hardening (no visual change, pure safety)
1. **Attribute-escape number formats.** Add an `escapeXmlAttr` helper to `style-xml.ts` (escape `& < > " '`) and apply it wherever a value enters an attribute: `axis-xml.ts:126` (`formatCode`), any title/format attribute paths. Audit every template literal in the folder for `="${...}"` interpolation of non-numeric, non-enum values and route through it. (Numeric/enum interpolations — axis ids, val flags — are safe and left alone.)
2. **Single color normalizer.** Replace every inline `<a:srgbClr val="${color}"/>` in bar/line/area/scatter/bubble/radar/stock with `generateSrgbColorXML(color)` (already strips `#`, uppercases). Confirm pie's `normalizeHexColor` and `generateSrgbColorXML` agree and collapse to one function.
3. **Unify blank handling.** Introduce a shared `valueForExport`-style mapping (lift the one in `data-util.ts`) and use it in scatter/bubble/stock so `null`/`NaN`/missing follow the same rule as bar/line/area instead of `Number(x) || 0`.

### Phase 2 — Number-format and category-type fidelity
4. **Thread the resolved format code into series caches.** Extend `CategoryValueSeriesXMLOptions` (and the scatter/bubble/pie series builders) with an optional `valueFormatCode` (default `General`) and emit it in `<c:numCache><c:formatCode>`. Source it from `encoding.y.format` (cartesian), `encoding.theta`/value channel (pie), `encoding.size` (bubble size cache), falling back to `compileResult` axis format when present.
5. **Category type detection.** In `data-util.ts` / a new `category-ref.ts`, detect category channel type (`nominal`/`ordinal` → string; `quantitative` → numeric; `temporal` → date). Extend `generateCategoryValueSeriesXML` to emit `<c:numRef>` for numeric/temporal categories and `<c:strRef>` for string categories.
6. **Wire the date/value axis selection.** In bar/line/area, choose `generateDateAxisXML` for temporal x and `generateValueAxisXML` for quantitative x (with the resolved unit), instead of always `generateCategoryAxisXML`. Pass the channel format through.

### Phase 3 — Color fidelity
7. **Resolve series colors from the scale.** Add a `resolveSeriesColors(encoding, seriesNames, compileResult?)` helper (generalizing pie's `colorRangeForEncoding`) that returns the color-scale range mapped to series, falling back to `getDefaultColor`. Use it in `extractSeriesData` and the scatter/bubble extractors so cartesian colors match on-screen.

### Phase 4 — Data-reference contract and multi-series alignment
8. **Centralize the cell-reference layout.** Create `data-layout.ts` exporting the canonical column/row mapping (category column, per-series value column, scatter x/y stride, bubble x/y/size stride, start row) as named functions, and a documented contract string. Replace the hardcoded arithmetic in `shared-xml.ts`, `scatter-chart-xml.ts`, `pie-chart-xml.ts`, and `line-chart-xml.ts` (stock) with calls into it. Add a top-of-module note pointing at the workbook writer that must honor it.
9. **Align color-grouped series on a shared category axis.** When `extractSeriesData` groups by color, compute the **union of categories** in stable order and project each series' values onto that union (missing → `null`/gap). Each `<c:ser>` then shares the same category reference and length, fixing sparse-group misalignment (Evidence 5).

### Phase 5 — Legend, data labels, dual-axis, dead code
10. **One legend decision.** Promote `legendPositionForSpec` (pie's, the most complete) into `legend-xml.ts` as the single resolver honoring `orient`, `null`, `'none'`, and `overlay`; call it from every generator. Delete the per-generator `{ position: 'r' }` heuristics and reconcile/remove the now-redundant `extractLegendPosition`.
11. **Honor data-label config.** Map the spec's data-label settings (and `DataLabelConfig`) into `generateDataLabelsXML` flags + label `numFmt`, for cartesian and pie alike, instead of all-false.
12. **Dual-axis: implement or gate.** Either (a) implement real secondary-axis support — allocate unique axis IDs per plot group, assign secondary-mapped series to a second plot group bound to `SECONDARY_VALUE`/`SECONDARY_CATEGORY`, and route `toOOXML` through `wrapChartXMLFromSpec`; or (b) if out of scope for this change, delete the unreachable `wrapChartXMLFromSpec` dual-axis branch so the surface is honest. Prefer (a); pick (b) only if cross-folder series-grouping is unavailable.
13. **Remove `generateBoxWhiskerChartXML`** (invalid `c:boxWhiskerChart`, already image-fallback-routed) — or, if native box/whisker is desired, reimplement it in the `cx:`/chartEx namespace as a separate, correctly-namespaced document. Default: remove.
14. **Drawing anchor correctness.** Make `generateTwoCellAnchorXML` accept a frame extent (or compute from anchor cells) instead of `cx=0 cy=0`, and parameterize `cNvPr id` so multiple charts/images on one sheet don't collide. Make `generateImageEmbedXML` derive its `to` anchor from the passed width/height instead of the fixed `col=8,row=15`.

## Tests and verification gates

(Tests are proposed for the implementing change; this planning task writes no test code.)

- **Well-formedness gate (new, highest value):** parse every generator's output with an XML parser in unit tests; assert no parse error for adversarial inputs — series names and categories containing `& < > " '` and Unicode, custom number formats containing `"` and `&`, colors with and without leading `#`, empty/one-point series, all-blank series.
- **Number-format fidelity:** assert the series `<c:numCache><c:formatCode>` equals the resolved channel format (currency/percent/date cases), not `General`.
- **Category-type fidelity:** temporal x emits `dateAx` + `numRef`; quantitative x emits `valAx` + `numRef`; nominal x emits `catAx` + `strRef`. Date categories are not JS date strings.
- **Color fidelity:** a spec with `encoding.color.scale.range` produces series fills equal to that range across bar/line/area/scatter/radar (parity with the existing pie behavior).
- **Multi-series alignment:** sparse color groups produce equal-length series sharing one category reference, with gaps as `null`.
- **Legend parity:** `orient: 'top'|'bottom'|'left'|'none'` and `overlay` are honored on bar/line/area/scatter (parity with pie).
- **Reference-layout contract:** a single test pins the `<c:f>` layout and is referenced by the workbook-writer tests (cross-folder) so the two cannot drift silently.
- **Round-trip / golden gate:** extend the existing XLSX round-trip eval corpus with chart fixtures per chart type; assert exported workbooks open without repair (validated against the OOXML schema or a strict reader) and that a re-import reproduces colors/format/categories. Run `roundtrip` and the charts package unit suite.
- **Regression:** keep `__tests__/bar-chart-xml.test.ts` and `scatter-chart-xml.test.ts` green; the bar-geometry clamping assertions must be unchanged.

## Risks, edge cases, and non-goals

- **Cross-folder coupling is the dominant risk.** The data-reference contract (Phase 4) and dual-axis routing (Phase 5) require coordinated changes in the workbook writer and possibly `export/index.ts`/`ooxml-types.ts`. Land the contract module and the writer change together; do not ship reference changes unilaterally.
- **Color resolution depends on the compiled scale.** If `encoding.color.scale.range` is not populated for some specs, the helper must fall back to `getDefaultColor` exactly as today — never throw, never emit `undefined`.
- **Category union projection** must preserve the on-screen category order (use the compiler's domain order when available) and must not reorder single-series charts.
- **Edge cases to cover:** empty data, single category, all-null values, duplicate category labels within a series, extremely long category lists (>26 and >702 columns — `columnLetter` already handles), NaN/Infinity (already sanitized), non-ASCII series/category text.
- **Non-goals:** widening native coverage to chart types that genuinely lack an Excel equivalent (violin, density, true heatmaps, >2-layer composites) — they must keep image-fallback; introducing 3-D charts; theme-color (schemeClr) mapping for series fills beyond what the scale provides (keep sRGB); changing the public `toOOXML` signature beyond additive options.

## Parallelization notes and dependencies on other folders

- **Independent within this folder:** Phase 1 (validity), Phase 3 (color), Phase 5 items 10/11/13 can proceed in parallel — each touches distinct functions and has no shared mutable state.
- **Sequential:** Phase 2 (format/type) should precede Phase 4 item 8 (both touch `shared-xml.ts`/series builders); Phase 4 item 9 depends on item 8's layout module; Phase 5 item 12 (dual-axis) depends on axis-ID allocation and is the most cross-folder-coupled.
- **Cross-folder dependencies:** (a) the **workbook/XLSX writer** (outside `charts/`) for the data-reference contract and chart-drawing extent; (b) `export/index.ts` for dual-axis routing and any new `ExportOptions`; (c) `ooxml-types.ts` for additive option fields (`valueFormatCode`, data-label config wiring); (d) `grammar/compiler.ts` `CompileResult` as the authoritative source for resolved colors, domains, and format codes. None of these are edited by this folder's plan, but the format/color/reference work is only fully faithful when fed by the compiler's resolved output — prefer consuming `options.compileResult` rather than re-deriving.
