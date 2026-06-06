# 050 - Charts Core Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/charts/src/core`

Queue item: 50

Scope: the pure `@mog/charts` core that extracts chart data, converts public `ChartConfig` plus `ChartData` into grammar `ChartSpec`, defines reusable chart IR fields and geometry helpers, resolves chart style context into paint/line/text primitives, and exposes pure helpers consumed by DOM rendering, grammar marks, OOXML export, and kernel chart compilation.

Files and integration points inspected:

- `charts/src/core/index.ts`
- `charts/src/core/chart-engine.ts`
- `charts/src/core/config-to-spec.ts`
- `charts/src/core/config-to-spec/*`
- `charts/src/core/config-to-spec/layers/*`
- `charts/src/core/chart-ir/*`
- `charts/src/core/style-resolver/*`
- `charts/src/core/data-extractor*.ts`
- `charts/src/core/series-identity.ts`
- `charts/src/core/stock-semantics.ts`
- `charts/src/core/radar-semantics.ts`
- `charts/src/core/chart-type-bridge.ts`
- `charts/src/core/__tests__/*`
- `charts/src/types/chart-types.ts`
- `types/data/src/data/charts.ts`
- `charts/src/dom/chart-engine.ts`
- `charts/src/grammar/*` consumers of core IR fields
- `charts/src/export/ooxml/*` consumers of core IR fields
- `mog-internal/plans/active/experiments/plan-ratings/codex-plans/015-kernel-src-domain-charts.md` as a boundary reference for the kernel-to-`@mog/charts` split

Scope this plan does not cover:

- Replacing the grammar compiler, primitive mark renderer, DOM chart engine, or OOXML exporter.
- Moving workbook state, range identity resolution, cache invalidation, or live compute access into `@mog/charts`; those stay with kernel/compute.
- Adding test-only adapters, compatibility shims, or alternate benchmark paths.
- Changing public `@mog-sdk/contracts` chart types without an intentional contract update.

## Current role of this folder in Mog

`charts/src/core` is the production chart compiler and extraction center for `@mog/charts`. It is pure TypeScript with no DOM dependency and no workbook ownership. Its job is to accept already-resolved chart configuration and chart data, lower them into chart grammar specs, and expose reusable algorithms that the renderer, exporter, and kernel compilation paths can trust.

Observed responsibilities:

- `config-to-spec/index.ts` is the main dispatcher from `ChartConfig + ChartData` to `ChartSpec`. It handles stock projection, data rows, pie/doughnut geometry rows, encoding, mark construction, config/style frames, surface/3D/radar/combo/stock/funnel/waterfall/pareto/layered chart families, annotation layers, and preserved-only ChartEx families.
- `config-to-spec/*` contains family-specific production contracts for axes, legend domains, data rows, blank semantics, bubble sizing, series identity, marker/data-label/error-bar/trendline/data-table rows, Excel cartesian geometry, bar geometry, stock visuals, radar visuals, surface charts, and layout hints.
- `chart-ir/*` defines constants and geometry helpers consumed outside core by grammar marks/traces and OOXML export. These field names are effectively an internal public contract inside `@mog/charts`.
- `data-extractor*` converts cell-accessor ranges or imported series refs/caches into `ChartData`, including explicit range layouts, Excel table detection, imported live-vs-cache dimensions, category levels, bubble x/y/size extraction, hidden-cell sentinels, stock role plans, and source series identity.
- `style-resolver/*` resolves workbook theme colors, chart-local color mappings, style owners, direct ergonomic formats, fill/line/font/shadow paint, and owner rich text. Style owner lookup is currently string-key based and used throughout config conversion.
- `series-identity.ts`, `stock-semantics.ts`, and `radar-semantics.ts` provide shared semantics that prevent data projection, legend identity, row ordering, stock subtype inference, and radar scales from being reimplemented in every layer.
- `chart-engine.ts` wraps the pure conversion entry point and defines `collectMarks`, including the render-order contract where axis gridlines draw behind data marks and foreground axes draw above them.
- `chart-type-bridge.ts` maps Rust OOXML chart type values to TS chart types and back for roundtrip alignment.

The folder already has substantial tests for conversion behavior: style resolver integration, axis contracts, axis font defaults, date axes, annotations, bar colors, blank semantics, invisible series, bubble, radar, stock, 3D plots, surface contour, ChartEx family behavior, layout hints, row generation, and imported data provenance.

## Improvement objectives

1. Make the chart core pipeline explicit and contract-driven: `ChartConfig + ChartData -> normalized chart plan -> typed chart IR rows -> family spec -> grammar compile -> marks`.

2. Replace scattered chart-family branching with an exhaustive chart-family registry that covers every `ChartType` from `@mog-sdk/contracts/data/charts`, including implemented families, preservation-only families, and explicit unsupported/export-only behavior.

3. Treat chart IR fields as a real schema. Field names, value types, row ownership, and grammar/export consumers should be defined once and verified systematically.

4. Make style resolution authoritative and typed. Raw owner-key strings should be generated by one owner-key module, parsed by one fallback module, and reported through deterministic style/color authority snapshots.

5. Normalize data extraction into reusable extraction plans that preserve current live range, imported cache, hidden-cell, blank, stock, bubble, category-level, and series-identity semantics without relying on branch order.

6. Strengthen axis and layout contracts by extending the existing normalization pattern to primary/secondary, category/value/date/radar/stock axes and to layout-hint ownership.

7. Keep `configToSpec` deterministic, pure, and production-path compatible while making each phase independently testable.

8. Preserve the existing public `@mog/charts` export surface unless a public contract change is deliberately versioned and coordinated with contracts/kernel/export callers.

## Production-path contracts and invariants to preserve or strengthen

Purity and ownership:

- `charts/src/core` must remain DOM-free and workbook-state-free.
- `configToSpec(config, data)` must be a pure deterministic function for equivalent inputs.
- The kernel remains responsible for resolving live workbook ranges, hidden dimensions, themes, source-linked formats, and imported chart status before calling `@mog/charts`.
- Public chart type definitions remain canonical in `@mog-sdk/contracts/data/charts`; `charts/src/types/chart-types.ts` may extend them only for package-local runtime/storage helpers.

Data extraction:

- `CellDataAccessor.getValue(row, col, sheetId?)` stays the synchronous extraction contract.
- `CellRange.sheetId` must be passed through every range read so cross-sheet references remain possible.
- `HIDDEN_CHART_CELL` must produce hidden chart points and must not be confused with blanks.
- Cell blanks, missing cells, non-numeric values, non-finite values, and hidden cells must preserve their current `ChartDataPoint.valueState` semantics.
- `plotVisibleOnly` masking from kernel must remain expressible through hidden sentinel values.
- Imported series refs must prefer live ranges unless the source kind is `literal` or `cacheFallback`; caches remain renderable when no live range is available.
- Category levels and category format codes must survive imported and live extraction paths.
- Stock role plans, source role order, and rendered point projection must remain stable for OHLC/HLC/volume chart variants.
- Bubble extraction must preserve x/y/size grouping, hidden propagation across all three dimensions, and `sizeRepresents` behavior.

Chart IR and rows:

- Field constants in `chart-ir/fields.ts` are shared by config conversion, grammar marks/traces, and OOXML export; renames require coordinated consumers and tests.
- Row order must remain stable by category index, rendered series index, source series identity, and family-specific ordering rules.
- `SOURCE_SERIES_INDEX_FIELD`, `SOURCE_SERIES_KEY_FIELD`, and `SERIES_ORDER_FIELD` must represent source identity consistently across imported, pivot, hidden, and projected series.
- Stable category keys must continue to distinguish duplicate and blank category labels where the grammar scale needs identity instead of display text.
- Blank rows, line segment fields, raw category/value fields, bubble raw/normalized sizes, pie point keys, waterfall totals, stock fields, marker fields, data-label fields, and error-bar fields must have one owning builder each.

Config-to-spec:

- `configToSpec` remains the single public pure conversion entry point.
- `collectMarks` must preserve render order: background, axis gridlines, data marks, foreground axes, legends, title.
- Surface contour and surface 3D chart families must keep their specialized specs rather than falling through to generic marks.
- Treemap, sunburst, and regionMap currently preserve data/export semantics without rendering placeholder geometry; that explicit behavior must remain intentional and tested.
- Combo and dual-axis charts must keep per-series type, x-role, y-axis binding, marker visibility, bar grouping, stacked area grouping, and Excel cartesian geometry contracts.
- Stock charts must preserve source role semantics, separate/same value-axis policy, source role overlay layers, and price-axis authority metadata.
- Radar charts must preserve Excel blank-policy defaults, scale authority, radial geometry, marker defaults, and style-fidelity diagnostics.
- Pie/doughnut/ofPie variants must preserve first-slice angle, explosion, ring geometry, legend identity, label geometry, and style-context footprint classification.

Style and authority:

- Direct ergonomic format fields override owner style context property-by-property without dropping owner siblings.
- Workbook theme colors and chart-local color map overrides must resolve through the same style resolver for frames, axes, titles, series, points, markers, data labels, trendlines, and stock visuals.
- Owner key compatibility must be deliberate: exact owner keys win, legacy aliases are parsed centrally, and unmatched owners remain diagnosable.
- Color authority snapshots must stay consistent with actual rendered colors and fallback order: series color, direct/owner fill, direct/owner line, marker colors, config palette, workbook theme, stock role defaults, default palette, unknown.
- Fill, line, dash, opacity, shadow, and text conversions should have one implementation path, not duplicated local variants.

Chart type bridges:

- `MARK_TYPE_MAP`, preserved-only family logic, chart-type bridge mappings, export handling, and family-specific conversion support must be exhaustive over the canonical `ChartType` union.
- Standard OOXML families and ChartEx families may have different render/export policies, but those policies must be explicit and test-covered.

## Concrete implementation plan

### 1. Establish a chart-family contract registry

Add a core-local `chart-family-registry.ts` that defines one exhaustive entry for every `ChartType` from `@mog-sdk/contracts/data/charts`.

Each entry should describe:

- Family: bar, line, area, pie-like, xy-point, combo, radar, stock, waterfall, funnel, pareto, histogram, boxplot, heatmap, violin, surface, 3D, hierarchical, geographic, or preservation-only.
- Base mark type or specialized spec builder.
- Data extraction shape: range table, explicit series refs, stock role refs, bubble triplets, category levels, or preservation-only.
- Axis topology: none, cartesian category/value, xy quantitative, dual y, stock price/volume, radar radial, surface grid.
- Legend topology: series, point/category, stock role, none.
- Blank policy owner and default.
- Style owner domains used by that family.
- Render support status: rendered, rendered approximation with diagnostics, preserved for export only, or unsupported invalid input.
- Export bridge policy for standard OOXML and ChartEx.

Then update existing maps and branch helpers to consume or validate against the registry:

- `MARK_TYPE_MAP`
- `isPreservedOnlyChartExFamily`
- `isLayeredXYPointChart`
- `isPieLikeChartType` and related pie helpers
- bar/decorative 3D helpers
- surface helpers
- combo supported-series helpers
- `chart-type-bridge.ts`

Use `satisfies Record<ChartType, ChartFamilyContract>` so TypeScript fails when a new `ChartType` is added without a production policy.

### 2. Introduce named config-to-spec pipeline contracts

Keep `configToSpec(config, data)` as the public entry point, but split its current inline orchestration into named phases:

- `normalizeChartInput(config, data)`: applies stock projection and family registry policy.
- `buildChartRows(normalized)`: returns typed row arrays plus row diagnostics/metadata.
- `buildChartEncoding(normalized, rows)`: produces base encoding and axis bundle.
- `buildChartMark(normalized, encoding)`: produces the primary mark contract.
- `buildChartConfigSpec(normalized, encoding, rows)`: produces frame/style/layout hints.
- `buildChartFamilySpec(normalized, rows, encoding, mark, configSpec)`: dispatches to the registered family builder.

The result should be a `ChartSpecBuildResult` containing:

- `spec`
- `family`
- `rows`
- `encoding`
- `styleAuthority` or `colorAuthority` summaries where already available
- internal diagnostics for unsupported/preserved behavior, without changing public output until a public snapshot contract is deliberately added

This makes the production path easier to reason about while preserving the public return type of `configToSpec`.

### 3. Turn chart IR rows into a schema

Create a `chart-ir/row-schema.ts` module that defines:

- `ChartIrField<T>` metadata for each field constant: field name, value type, owner module, and known consumers.
- Typed row fragments for common, cartesian point, pie/doughnut, marker, point-style, data-label, error-bar, trendline, analysis-line, data-table, waterfall, funnel, stock, surface, and annotation rows.
- Field setter helpers for common repeated groups: series identity, point identity, raw values, point style, marker style, data label, error bars, stock values, waterfall totals, and pie keys.

Refactor row writers to call the owning helpers:

- `data-row-base.ts`
- `data-row-style.ts`
- `data-label-row(s).ts`
- `error-bar-rows.ts`
- `data-row-stock.ts`
- `data-row-waterfall.ts`
- `layers/funnel.ts`
- `layers/pareto.ts`
- `layers/trendline-*`
- `layers/data-table.ts`
- `layers/analysis-line-*`

Keep `chart-ir/fields.ts` as the stable source of string constants and re-export from `config-to-spec/fields.ts` for compatibility. Do not rename fields as part of the refactor unless every grammar/export consumer is updated in the same implementation slice.

### 4. Normalize extraction through explicit extraction plans

Add a `ChartExtractionPlan` and `ImportedDimensionPlan` layer before extracting data.

For range extraction, the plan should capture:

- Range dimensions and orientation.
- Whether layout is explicit or auto-detected.
- Single-row/single-column behavior.
- Excel table shape detection.
- Category range and series range ownership.
- Bubble vertical/horizontal triplet layout.

For imported extraction, the plan should capture:

- Per-series value/category/bubble/name refs.
- Source kind policy: live range, literal, cache fallback.
- Cache cardinality and category-level cardinality.
- Selected category label level.
- Stock role plan and source role evidence.
- Series identity and visible order.

Then refactor `extractChartData`, `extractChartDataFromRange`, and `extractChartDataFromSeriesRefs` to execute these plans. Preserve all current semantics, but make branch precedence explicit and testable.

Add plan-level diagnostics internally for malformed ranges, missing stock roles, incompatible category-level shapes, and unsupported bubble triplets. The diagnostics can remain test-only/internal until a public resolved-spec contract consumes them.

### 5. Centralize typed style owner keys and fallback matching

Add `style-resolver/owner-keys.ts` with factory functions and parser support:

- `chartAreaOwnerKey()`
- `plotAreaOwnerKey()`
- `titleOwnerKey()`
- `axisOwnerKey(axisRole)`
- `seriesOwnerKey(sourceSeriesIndex)`
- `markerOwnerKey(sourceSeriesIndex)`
- `pointOwnerKey(sourceSeriesIndex, pointIndex)`
- `markerPointOwnerKey(sourceSeriesIndex, pointIndex)`
- `dataLabelOwnerKey(sourceSeriesIndex, pointIndex?)`
- `errorBarsOwnerKey(sourceSeriesIndex, axis)`
- `trendlineOwnerKey(sourceSeriesIndex, trendlineIndex?)`
- `stockOwnerKey(role)`

Move the regex fallback logic currently embedded in `style-resolver/resolver.ts` into this module. Exact owner keys should still win, and legacy aliases should still work, but every alias should have an owner kind and a documented fallback priority.

Refactor all raw template strings such as `series(${sourceSeriesIndex})`, `point(seriesIdx=...,pointIdx=...)`, `marker(...)`, `errorBars(...)`, and axis owner literals to use the factories.

Unify duplicate line dash/opacity helpers between `style-resolver/resolver.ts` and `config-to-spec/style.ts` so every mark, row, frame, axis, and authority snapshot uses the same paint conversion rules.

### 6. Make color and style authority match rendered output

Build a small style authority contract around the resolver:

- `ResolvedStyleOwnerMatch`: exact, alias, fallback, or none.
- `ResolvedPaintComponent`: source, owner key, direct-vs-owner-vs-palette authority, theme slot, resolved color, opacity, and fallback flag.
- `ResolvedElementStyle`: paint, line, text, shadow, rounded frame, rich text, diagnostics.

Refactor `resolveSeriesColorAuthority`, `resolvedCategoryColors`, `resolveSeriesColor`, point colors, marker colors, stock visuals, data labels, and axis/title/frame styles to use the same component resolver rather than separate fallback sequences.

Important preservation rules:

- Series color should still take precedence over series fill/line where it does today.
- Stroke-colored series should still prefer line color before fill color.
- Theme repeat behavior for repeated accent slots must remain.
- Stock role default colors must remain a stock-specific fallback.
- Pie/doughnut point-category colors must still honor point visual formats and fallback palettes.

### 7. Extend axis normalization into a complete axis bundle

The axis code already has useful normalizers for tick marks, label positions, display units, date units, and crossing plans. Extend that pattern into a `NormalizedAxisBundle` consumed by encoding, combo, stock, radar, layout hints, and data labels.

The bundle should include:

- Primary category/value axes.
- Secondary category/value axes.
- Physical channel after chart orientation.
- Date-serial category behavior.
- Quantitative x behavior for scatter/bubble/combo.
- Category crossing application and unsupported crossing reasons.
- Display-unit and source-linked format status.
- Gridline/minor-gridline streams.
- Label/title style owner keys.
- Axis layout authority for manual and imported hints.

Then update `encoding.ts`, `layers/combo.ts`, `layers/stock.ts`, `layout-hints-axis.ts`, `excel-cartesian-geometry.ts`, and `radar-visual-contract.ts` to consume the normalized bundle. This reduces branch-specific axis adjustments while preserving current rendered output.

### 8. Split family builders behind the registry without changing output

Move the family-specific returns currently embedded in `config-to-spec/index.ts` behind registry builder functions:

- `buildSurfaceContourFamilySpec`
- `buildSurface3DFamilySpec`
- `buildRadarFamilySpec`
- `buildXYPointFamilySpec`
- `buildComboFamilySpec`
- `buildStockFamilySpec`
- `buildFunnelFamilySpec`
- `buildWaterfallFamilySpec`
- `buildParetoFamilySpec`
- `buildPieDoughnutFamilySpec`
- `buildPerSeriesLineFamilySpec`
- `buildAnnotationCompositeFamilySpec`
- `buildSimpleUnitFamilySpec`
- `buildPreservedOnlyFamilySpec`

The refactor should be behavior-preserving first. After output equivalence is locked down, complete missing explicit family policies for heatmap and violin so they do not accidentally render as generic rect/violin marks without a documented data/axis/style contract.

### 9. Add deterministic contract snapshots for the pure production path

Create focused fixture matrices that cover all chart types and important subtypes:

- Minimal config/data for every `ChartType`.
- Imported data with caches, live refs, category levels, hidden sentinels, and source identities.
- Axis matrix: category/value/date/log/reverse/display units/crossing/primary-secondary.
- Style matrix: direct formats, owner formats, theme colors, color map overrides, rich text, shadows, gradients, patterns, no-fill/no-line.
- Row matrix: blanks as gap/span/zero, duplicate categories, scatter quantitative x, bubble sizes, stock dropped points, pie explosions, waterfall totals, funnel ordering.

For each fixture, verify:

- `configToSpec` output is stable.
- `compile(configToSpec(...))` succeeds where render support is declared.
- Preserved-only families emit no placeholder marks.
- `collectMarks` preserves render order.
- Color/style authority matches the mark/spec fields that will render.
- No row contains unknown or unowned `__mog*` fields.

Use snapshots sparingly for full specs; prefer targeted structural assertions for fields with numeric geometry tolerance.

## Tests and verification gates

Required checks for an implementation of this plan:

- `pnpm --filter @mog/charts test`
- `pnpm --filter @mog/charts typecheck`
- `pnpm typecheck` for cross-package TypeScript contracts, unless the implementing workstream has a narrower explicit type gate and reports why.
- Existing core tests under `charts/src/core/__tests__` and `charts/src/core/style-resolver/__tests__`.
- Grammar/export consumer tests that import core IR fields, especially `charts/src/export/ooxml/__tests__/*` and grammar mark/trace tests touched by row schema changes.
- Browser or app-level smoke only if the implementation changes DOM-facing behavior or public exported chart helpers used by UI callers.

New or strengthened test suites:

- `chart-family-registry.test.ts`: every `ChartType` has a registry policy, every policy maps to mark/spec/export behavior, and every preservation-only family is explicit.
- `chart-ir-row-schema.test.ts`: every `__mog*` field emitted by `chartDataToRows` or layer row builders is declared in the schema and has a known consumer or intentional no-consumer status.
- `data-extraction-plan.test.ts`: range, explicit-layout, Excel-table, imported-cache, live-ref, category-level, stock, and bubble extraction plans preserve current `ChartData`.
- `style-owner-keys.test.ts`: owner key factories, parser, exact matching, legacy aliases, and fallback priority.
- `style-authority-contract.test.ts`: rendered colors/lines/text match authority snapshots for series, points, markers, axes, titles, chart frames, plot frames, stock roles, and pie/doughnut categories.
- `axis-bundle-contract.test.ts`: primary/secondary, category/value/date/log/radar/stock axis bundles match current spec and compiled mark behavior.
- `all-chart-types-smoke.test.ts`: every canonical chart type either compiles to expected marks or produces an explicit preservation-only empty mark result.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Owner-key refactors can silently break imported OOXML style application if legacy aliases are not exhaustively preserved.
- IR field schema work can break grammar/export deep imports if fields are renamed or moved without compatibility exports.
- Family registry work can expose chart types that currently fall through to generic behavior. The correct fix is to declare and implement the production policy, not hide the gap.
- Stock, radar, pie/doughnut, and Excel cartesian geometry have high numeric sensitivity; tests need tolerances and targeted assertions rather than brittle full snapshots.
- Imported cache and live range behavior is subtle. Literal/cacheFallback source kinds must not accidentally read live ranges, and live hidden cells must not fall back to caches.
- Axis bundle normalization must preserve horizontal bar channel swapping and combo per-series y-axis binding.
- Style/color authority must describe actual rendered output, not merely imported OOXML intent.

Non-goals:

- No rewrite of the grammar compiler or primitive renderer.
- No workbook range identity or EventBus work inside `@mog/charts`.
- No test-only extraction or rendering shortcuts.
- No broad public chart contract changes without coordinating `@mog-sdk/contracts`, kernel, exporter, and app callers.
- No temporary fallback that maps unsupported chart families to plausible-looking generic marks without an explicit production support policy.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the family registry and row-schema contracts are sketched.

Recommended parallel slices:

- Agent A: Build the chart-family registry and exhaustive chart-type policy tests. Dependencies: `types/data/src/data/charts.ts`, `config-to-spec/constants.ts`, `chart-type-bridge.ts`, export policy.
- Agent B: Define the chart IR row schema and migrate row writers. Dependencies: grammar mark/trace consumers and OOXML export consumers.
- Agent C: Implement typed style owner keys and resolver fallback tests. Dependencies: `types/data/src/data/charts.ts` style context owner shape and current imported owner-key vocabulary.
- Agent D: Normalize extraction plans for range and imported data. Dependencies: kernel remains the live range resolver; this slice should not add workbook access.
- Agent E: Build the normalized axis bundle and migrate encoding/combo/stock/radar/layout-hint consumers.
- Agent F: Expand contract fixtures and smoke tests across all chart types, then verify output equivalence.

Dependency ordering:

1. Family registry and row-schema contracts first, because they define the boundaries other slices consume.
2. Style owner key factories before broad style authority rewrites, so migrated modules use one key vocabulary.
3. Extraction plan refactor can proceed in parallel with style work because it only depends on stable `ChartData` and series identity contracts.
4. Axis bundle work should happen before final family-builder cleanup because several family builders consume axis behavior.
5. Final integration should run the full `@mog/charts` test/typecheck gates plus cross-package typecheck to catch grammar/export/public export drift.
