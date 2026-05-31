# Charts

Internal implementation notes for the Mog chart system. The production path spans public chart contracts, Rust-backed floating-object storage, a TypeScript kernel bridge, the workspace-internal `@mog/charts` rendering engine, canvas drawing integration, XLSX import/export fidelity, and runtime image export.

## Table of Contents

- [Overview](#overview)
- [Surface Status](#surface-status)
- [Source Layout](#source-layout)
- [Architecture](#architecture)
- [Contracts and Data Model](#contracts-and-data-model)
- [Persistent Storage and Worksheet API](#persistent-storage-and-worksheet-api)
- [Data Resolution](#data-resolution)
- [Compilation and Rendering](#compilation-and-rendering)
- [Chart Rendering Engine](#chart-rendering-engine)
- [UI Integration](#ui-integration)
- [XLSX Import and Export](#xlsx-import-and-export)
- [Image Export](#image-export)
- [Reactive Invalidation](#reactive-invalidation)
- [Extension Checklist](#extension-checklist)
- [Verification Map](#verification-map)
- [File Reference](#file-reference)

---

## Overview

Charts are modeled as worksheet floating objects whose chart-specific data is rendered through a cache-backed bridge. The renderer never resolves cells or compiles chart specs while painting. Instead, the synchronous canvas path asks `IChartBridge.renderCached()` for already-compiled marks; cache misses paint a placeholder and schedule async compilation.

The chart subsystem has three distinct contracts:

1. **Public API contract**: `ChartConfig`, `Chart`, `WorksheetCharts`, chart events, and `IChartBridge` are exported through `@mog-sdk/contracts`.
2. **Storage/import contract**: Rust domain types and generated bridge types carry the durable floating-object and XLSX fidelity model.
3. **Render contract**: `@mog/charts` converts chart config plus resolved data into a Vega-Lite-like grammar, compiles it into mark IR, and renders or exports those marks.

Keeping these contracts separate is intentional. Public consumers should use worksheet chart APIs and shipped runtime packages. Workspace packages such as `@mog/charts`, `@mog-sdk/kernel`, `canvas/*`, and `file-io/*` are implementation surfaces unless their manifests and package inventory say otherwise.

## Surface Status

| Surface | Status | Notes |
| --- | --- | --- |
| `@mog-sdk/contracts/data/charts` | public contract | Canonical TypeScript chart config, formatting, render snapshot, image-export, and diagnostic types. Source is `types/data/src/data/charts.ts`, re-exported by `contracts/src/data/charts.ts`. |
| `@mog-sdk/contracts/bridges` chart bridge | public contract | Defines `IChartBridge`, chart mark IR, cache rendering, layout snapshots, and data-resolution errors. Source is `types/bridges/src/chart-bridge.ts`. |
| `Worksheet.charts` API | public contract, kernel implementation | API shape lives in contracts; implementation is `kernel/src/api/worksheet/charts.ts`. |
| `@mog/charts` | workspace-internal package | Pure chart engine plus DOM helper, grammar compiler, primitives, export helpers, interactions, math, and tests. `charts/package.json` is private. |
| `@mog-sdk/kernel` chart bridge | workspace-internal package | Owns data resolution, render cache, event subscriptions, and chart bridge lifecycle. |
| `compute-charts` | workspace-internal Rust crate | Optional WASM-backed transform/statistics path for chart grammar transforms. `publish = false`. |
| `compute-chart-render` | workspace-internal Rust crate | Native headless rasterizer for Node SDK image export. `publish = false`. |
| XLSX chart parser/writer | workspace-internal file I/O | Parses standard `c:chartSpace`, ChartEx `cx:chartSpace`, drawing anchors, auxiliary parts, and package ownership metadata. |
| Spreadsheet chart UI | app-internal | Dialogs, ribbons, chart machine, hooks, action handlers, and preview components in `apps/spreadsheet`. |

## Source Layout

| Area | Primary paths |
| --- | --- |
| Public data and bridge contracts | [`types/data/src/data/charts.ts`](../../../types/data/src/data/charts.ts), [`types/bridges/src/chart-bridge.ts`](../../../types/bridges/src/chart-bridge.ts), [`types/events/src/chart-events.ts`](../../../types/events/src/chart-events.ts), [`types/machines/src/actors/chart.ts`](../../../types/machines/src/actors/chart.ts) |
| Contract re-export shims | [`contracts/src/data/charts.ts`](../../../contracts/src/data/charts.ts), [`contracts/src/bridges/chart-bridge.ts`](../../../contracts/src/bridges/chart-bridge.ts) |
| Worksheet API | [`kernel/src/api/worksheet/charts.ts`](../../../kernel/src/api/worksheet/charts.ts), [`kernel/src/api/worksheet/handles/chart-handle-impl.ts`](../../../kernel/src/api/worksheet/handles/chart-handle-impl.ts) |
| Kernel chart domain | [`kernel/src/domain/charts/`](../../../kernel/src/domain/charts/) |
| Render bridge internals | [`kernel/src/domain/charts/chart-bridge.ts`](../../../kernel/src/domain/charts/chart-bridge.ts), [`kernel/src/domain/charts/bridge/`](../../../kernel/src/domain/charts/bridge/) |
| Chart engine package | [`charts/src/`](../../../charts/src/) |
| Rust transform and raster crates | [`compute/core/crates/compute-charts/`](../../../compute/core/crates/compute-charts/), [`compute/core/crates/compute-chart-render/`](../../../compute/core/crates/compute-chart-render/) |
| Rust storage bridge methods | [`compute/core/src/storage/engine/objects/charts.rs`](../../../compute/core/src/storage/engine/objects/charts.rs), [`compute/core/src/storage/engine/services/objects/charts.rs`](../../../compute/core/src/storage/engine/services/objects/charts.rs) |
| Rust chart domain/XLSX model | [`domain-types/src/domain/chart/`](../../../domain-types/src/domain/chart/), [`file-io/xlsx/parser/src/domain/charts/`](../../../file-io/xlsx/parser/src/domain/charts/) |
| Spreadsheet UI | [`apps/spreadsheet/src/components/charts/`](../../../apps/spreadsheet/src/components/charts/), [`apps/spreadsheet/src/hooks/charts/`](../../../apps/spreadsheet/src/hooks/charts/), [`apps/spreadsheet/src/actions/handlers/charts.ts`](../../../apps/spreadsheet/src/actions/handlers/charts.ts), [`apps/spreadsheet/src/systems/objects/machines/chart-machine.ts`](../../../apps/spreadsheet/src/systems/objects/machines/chart-machine.ts) |
| Canvas integration | [`canvas/drawing-canvas/src/renderers/chart.ts`](../../../canvas/drawing-canvas/src/renderers/chart.ts), [`canvas/grid-canvas/src/renderer/grid-renderer.ts`](../../../canvas/grid-canvas/src/renderer/grid-renderer.ts) |
| Runtime image export | [`apps/spreadsheet/src/infra/services/chart-image-exporter.ts`](../../../apps/spreadsheet/src/infra/services/chart-image-exporter.ts), [`runtime/sdk/src/chart-export/node-chart-image-exporter.ts`](../../../runtime/sdk/src/chart-export/node-chart-image-exporter.ts) |

## Architecture

```text
+-------------------------------------------------------------------+
|                         Spreadsheet UI                             |
|  dialogs, ribbons, actions, hooks, ChartPreview, chart machine      |
+-----------------------------------+-------------------------------+
                                    |
                                    | Worksheet.charts API
                                    v
+-------------------------------------------------------------------+
|                           Kernel API                               |
|  WorksheetChartsImpl                                               |
|  - public config <-> ChartFloatingObject conversion                 |
|  - CRUD, series, axis, z-order, table-linking, layout, image export |
+--------------------+----------------------------------------------+
                     |
                     | generated ComputeBridge methods
                     v
+-------------------------------------------------------------------+
|                         Rust Storage                               |
|  charts are typed floating objects                                 |
|  - create/update/delete/get/list                                   |
|  - z-order shared with other floating objects                       |
|  - MutationResult emits floatingObjectChanges                       |
+--------------------+----------------------------------------------+
                     |
                     | events + reads
                     v
+-------------------------------------------------------------------+
|                       Kernel ChartBridge                           |
|  ChartDataResolver -> ChartRenderOrchestrator -> ChartRenderCache   |
|  - resolve references and cell values                               |
|  - normalize wire config into ChartConfig                           |
|  - compile via @mog/charts                                          |
|  - serve synchronous renderCached()                                 |
+--------------------+----------------------------------------------+
                     |
                     | ChartConfig + ChartData
                     v
+-------------------------------------------------------------------+
|                         @mog/charts                                |
|  configToSpec -> compile -> collectMarks                            |
|  - grammar transforms, scales, layout                               |
|  - mark IR: rect/path/arc/text/symbol                               |
|  - Canvas2D render, DOM preview, OOXML export helpers               |
+--------------------+----------------------------------------------+
                     |
                     | cached marks
                     v
+-------------------------------------------------------------------+
|                         Canvas/Export                              |
|  Drawing canvas calls renderChart -> IChartBridge.renderCached()    |
|  DOM/Node image exporters call getMarksAtSize() then rasterize      |
+-------------------------------------------------------------------+
```

## Contracts and Data Model

`ChartConfig` is the public user-facing shape. It contains chart type, position, range bindings, series, axes, legend, formatting, labels, trendlines, chart-type-specific options, theme/style context, import projection metadata, and export settings.

Important contract boundaries:

- `types/data/src/data/charts.ts` is the canonical TypeScript chart type source. The files under `contracts/src/*` are re-export shims.
- `ChartConfig` stores public position fields as cell coordinates (`anchorRow`, `anchorCol`, `width`, `height`) and optional point fields (`heightPt`, `widthPt`, `leftPt`, `topPt`). Chart-sheet render paths carry `layoutAuthority: 'chartSheet'`.
- `SeriesConfig` can point at live A1 ranges (`values`, `categories`, `bubbleSize`) or imported caches (`valueCache`, `categoryCache`, `bubbleSizeCache`). Projection authority fields explain whether a series is live, literal, fallback-cache-backed, pivot-projected, or unavailable.
- `ResolvedChartSpecSnapshot` is the diagnostics/export snapshot emitted from the production compile path. It records render dimensions, source ranges, resolved series data, bar geometry, layout, compiler path, hashes, and unsupported features.
- `ChartMark` is the render IR consumed by browser canvas and the native Node rasterizer. It is intentionally smaller than the full chart grammar and currently includes `rect`, `path`, `arc`, `text`, and `symbol` marks plus richer style fields.

The chart engine package also defines `StoredChartConfig` in `charts/src/types/chart-types.ts`. That extends `ChartConfig` with implementation-only fields such as stable IDs, CellId-based anchors/ranges, z-order, and table-linking metadata. Do not make those fields part of public setup guidance unless they are intentionally promoted through contracts.

## Persistent Storage and Worksheet API

The current production storage path treats charts as typed floating objects in Rust compute storage:

1. `WorksheetChartsImpl.add()` validates public `ChartConfig`, converts it to a generated `ChartFloatingObject` payload, and calls `ComputeBridge.createChart()`.
2. Rust `YrsComputeEngine::create_chart()` delegates to floating-object storage and returns a `MutationResult` with `floating_object_changes`.
3. Reads call `getChart()` or `getAllCharts()` and filter objects whose type is chart.
4. Z-order operations delegate to unified floating-object z-order so charts interleave correctly with shapes, images, and other drawing objects.

The worksheet API owns public ergonomics:

- Core CRUD: `add`, `get`, `update`, `remove`, `list`, `clear`.
- Convenience: duplicate, data range/type setters, count/name lookup.
- Z-order: bring/send front/back/forward/backward.
- Table linking: link/unlink/query table source.
- Series, point, trendline, axis, data table, and layout helpers.
- Image export delegation through an injected `ChartImageExporter`.

`ChartHandleImpl` is deliberately hosting-oriented. It inherits floating-object operations and exposes chart object data, while content operations remain on `ws.charts`.

## Data Resolution

`ChartDataResolver` is the sanctioned wire-to-render data boundary.

```text
ChartFloatingObject
  -> resolveChartRangeReferences()
  -> toChartConfig()
  -> createCellAccessor()
  -> @mog/charts extractChartData() / extractChartDataFromRange()
  -> theme, hidden-cell, source-linked-axis, cache-fallback normalization
  -> ChartConfig + ChartData
```

Key responsibilities:

- It reads charts through `chart-store`, which delegates to `ComputeBridge`.
- It rejects terminal `importStatus` values before render and maps them to chart errors.
- It resolves both CellId-backed ranges and A1 references. A1 references can include sheet names; unqualified references resolve against the chart's owning sheet.
- It supports explicit per-series range references and classic rectangular `dataRange` extraction.
- It loads hidden row/column visibility when `plotVisibleOnly` is true.
- It attaches workbook theme context so style resolution can happen in the chart package instead of pre-mutating colors.
- It applies source-linked axis number formats and imported cache fallback where live ranges are missing but chart caches are renderable.
- It normalizes imported blank/category behavior before compilation.

Range invalidation uses the same reference resolver. `getChartsAffectedByRange()` scans workbook charts, resolves every relevant chart range, and invalidates charts whose resolved ranges overlap the changed cells.

## Compilation and Rendering

The production render path is split between `ChartBridge`, `ChartRenderOrchestrator`, `ChartRenderCache`, and `@mog/charts`.

### Cache-Backed UI Rendering

`IChartBridge.renderCached(chartId, ctx, bounds, sheetId, renderFrame)` is synchronous and must stay synchronous. It is called inside the canvas drawing dispatch loop after viewport transforms are already active.

Paint behavior:

- Fresh marks: draw immediately.
- Missing marks: draw a "Chart loading..." placeholder and schedule `ensureCompiled()`.
- Dirty marks: draw stale marks to avoid blank frames and schedule background recompilation.
- Error/import-status state: draw the chart error synchronously.

`ChartRenderCache` keys cache entries by chart ID, owning sheet ID, and optional render frame. It keeps a chart-ID-to-sheet index because imported files can contain duplicate chart IDs across sheets. Cache commits notify listeners; the spreadsheet grid subscribes to those notifications and invalidates the drawing layer.

### One-Off Export and Diagnostics

`getMarksAtSize()` and `getRenderSnapshotAtSize()` compile at explicit dimensions without mutating the UI render cache. This matters because axes, labels, and layout are size-dependent. Exporters and workbook diagnostics should use these APIs instead of reusing viewport-sized cached marks.

### Compiler Path

`ChartRenderOrchestrator` compiles as follows:

1. Resolve `ChartConfig` and `ChartData`.
2. Call `configToSpec(config, data)`.
3. Optionally apply WASM transform acceleration through `compute-charts` when `initChartWasm()` has registered exports.
4. Call the TypeScript grammar `compile()` with optional dimensions.
5. Flatten the result with `collectMarks()`.
6. Extract a normalized layout snapshot for bridge consumers.

If WASM transform application fails, the bridge logs and falls back to the TypeScript grammar path. The compiler path ID is captured in resolved chart snapshots.

## Chart Rendering Engine

`@mog/charts` is a private workspace package, but it is the core chart rendering engine. Its important submodules are:

- `types`: re-exports public chart contracts and adds internal/runtime types.
- `core`: data extraction, config-to-spec conversion, style resolution, series identity, stock semantics, bar geometry, and pure chart-engine helpers.
- `grammar`: Vega-Lite-like spec types, transform pipeline, layout, scale/encoding resolution, layer compilation, mark generation, axes, legends, and title generation.
- `primitives`: mark types, Canvas2D renderer, hit testing, fonts, scales, and low-level mark drawing.
- `components`: fluent chart-builder helpers used by standalone scenarios and tests.
- `dom`: `ChartEngine` and `createChart()` for browser DOM instances such as chart previews.
- `export`: OOXML chart XML helpers and image-export option normalization.
- `interaction`, `algebra`, and `math`: brush/zoom/pick/tooltip helpers, data transformations, stacking/grouping, statistics, and regression utilities.

The main pure pipeline is:

```text
ChartConfig + ChartData
  -> chartDataToRows()
  -> buildEncoding(), buildMark(), buildConfigSpec(), build layers
  -> ChartSpec
  -> compile()
  -> CompileResult
  -> collectMarks()
  -> ChartMark[]
```

Unit specs cover the standard single-mark families plus specialized mark generators for histogram, boxplot, violin, surface/contour, and radar charts. Radar charts compile to a polar `radar` mark that draws radial grid rings, spokes, category labels, value labels, closed series polygons, optional fills, and optional markers.

Layered specs cover combo charts, stock charts, waterfall, funnel, Pareto, data labels, data tables, markers, trendlines, error bars, and annotation lines. Some imported ChartEx families such as treemap, sunburst, and region maps currently preserve typed/imported state while rendering as empty/preserved-only specs.

## UI Integration

The spreadsheet app uses chart UI state and chart data operations separately:

- `chart-machine.ts` owns pure chart UI state: editing, creation wizard, element selection, series/point selection, and title editing.
- The object-interaction actor owns selection, dragging, resizing, and multi-select for all floating objects, including charts. The chart machine receives synchronized chart IDs.
- `use-charts.ts`, `use-chart.ts`, and action handlers call `ws.charts.*` for actual writes.
- Chart editor, gallery, preview, contextual ribbons, and insert dialogs live under `apps/spreadsheet/src/components/charts/` and related dialog/chrome paths.
- `ChartPreview` uses the DOM chart engine directly for local previews; that is not the production worksheet canvas render path.

Canvas integration is intentionally thin:

1. `SpreadsheetGrid` provides a `renderChart` callback that calls `wb.charts.renderCached()`.
2. `grid-renderer` injects that callback into `drawing-canvas` through `setChartBridge()`.
3. `drawing-canvas` renders chart scene objects by delegating to the injected bridge after applying object transforms.

## XLSX Import and Export

XLSX chart work has two related but different goals: render supported chart semantics and preserve imported package fidelity.

Read-side responsibilities:

- `file-io/xlsx/parser/src/domain/charts/` parses standard chart parts, axes, series, labels, formatting, legends, data sources, chart groups, and drawing-frame metadata.
- ChartEx parts are parsed under `domain/charts/chart_ex/` and projected through `output/to_parse_output/features/chart_ex_projection.rs`.
- `domain-types/src/domain/chart/` defines the durable Rust chart domain model. It includes `ChartDefinition`, `ChartType`, style context, axes, series, labels, data tables, 3D view metadata, OOXML mirror types, ChartEx replay data, standard-chart provenance, and export authority.
- Imported drawing anchors and non-visual frame properties are stored so charts can remain ordered and round-trippable with other drawing objects.
- `importStatus` communicates unsupported, stale, or not-renderable imported states to the bridge and renderer.

Write-side responsibilities:

- Structured chart writers reconstruct standard chart XML from typed chart state where the model has authority.
- Package ownership rules guard when chart, ChartEx, drawing, media, style, color, and auxiliary parts may be replayed or must be regenerated.
- ChartEx opaque replay is only for unmodified imported charts with valid drawing identity and package-graph-owned relationships.
- `@mog/charts/export` can generate native OOXML for grammar specs that map cleanly to Excel chart XML; unsupported mark families require image fallback or richer writer support.

## Image Export

There are two image export paths with the same semantic source:

- Browser/app export: `ChartImageExporterImpl` asks `IChartBridge.getMarksAtSize()`, creates an off-screen canvas, renders marks with `@mog/charts`, and returns a data URL.
- Node SDK export: `NodeChartImageExporter` asks `getMarksAtSize()`, serializes a versioned subset of `ChartMark`, calls the native `compute-chart-render` N-API rasterizer, and returns a data URL.

Both paths compile at requested export dimensions rather than reusing UI cache marks. The native rasterizer is deliberately semantic-light: chart semantics stay in TypeScript; Rust only rasterizes the already-compiled mark IR.

## Reactive Invalidation

`ChartBridge.start()` subscribes to:

- Cell changes and cell batch changes.
- Chart updates.
- Workbook theme changes.
- Floating-object create/update/delete events.
- Sheet deletion.
- Row and column insert/delete events.

The invalidation policy is range-aware for cell/structural changes and object-aware for chart lifecycle changes. Position-only updates should avoid unnecessary mark recompilation where possible; chart bounds and scene graph movement are floating-object concerns, while chart data/style/spec changes dirty the render cache.

Cache listeners are renderer notifications, not business events. They signal that a chart compile committed marks or an error so the drawing layer should repaint.

## Extension Checklist

When improving charts, update the complete contract set for the category being changed.

For a new chart type:

- Add or confirm the public `ChartType` token and chart-specific config in `types/data/src/data/charts.ts`.
- Add Rust domain coverage in `domain-types/src/domain/chart/` and generated bridge/wire mappings where storage or import/export needs it.
- Update `kernel/src/api/worksheet/charts.ts` conversion helpers and `kernel/src/domain/charts/chart-type-converters.ts`.
- Add data extraction behavior in `@mog/charts/core` if the type needs a different data shape.
- Add `config-to-spec` mapping, layers, mark generation, layout, legend/axis behavior, and snapshots.
- Update XLSX import projection and write/export behavior, including unsupported/import-status policy.
- Add tests at contracts/converter, chart-engine, kernel bridge, XLSX, and UI/action layers as appropriate.

For a new formatting property:

- Add the public TypeScript contract and Rust domain field.
- Parse/import it from OOXML or authoring APIs.
- Convert wire to `ChartConfig` at the kernel boundary.
- Resolve theme/style precedence in `@mog/charts` rather than pre-flattening when possible.
- Propagate it into `ChartSpec`, mark styles, snapshots, and export writer output.
- Add diagnostics for preserved-only, approximated, dropped, or unsupported behavior.

For performance work:

- Optimize the production path: `ChartDataResolver`, `ChartRenderOrchestrator`, `ChartRenderCache`, `@mog/charts` compile/mark generation, and canvas/native rasterization.
- Do not optimize only `ChartPreview`, test fixtures, or standalone component builders unless the task is explicitly about those surfaces.
- Preserve the synchronous `renderCached()` contract. Async work belongs before or after paint, not inside it.

## Verification Map

Use the smallest gates that cover the changed layer:

| Change area | Suggested gates |
| --- | --- |
| Chart contracts or worksheet API | `pnpm --filter @mog-sdk/contracts typecheck`, `pnpm --filter @mog-sdk/kernel test -- charts`, plus API tests that cover the changed method |
| `@mog/charts` render engine | `pnpm --filter @mog/charts test`, `pnpm --filter @mog/charts typecheck` |
| Kernel chart bridge/cache/data resolver | `pnpm --filter @mog-sdk/kernel test -- charts`, `pnpm --filter @mog-sdk/kernel typecheck` |
| Spreadsheet UI/actions | Relevant app tests under `apps/spreadsheet`, plus a browser/dev-server exercise for visible UI changes |
| Rust transform crate | `cargo test -p compute-charts`, `cargo clippy -p compute-charts` |
| Native image rasterizer | `cargo test -p compute-chart-render`, `cargo clippy -p compute-chart-render`, Node chart export tests |
| XLSX import/export | Targeted `cargo test` for parser chart modules or roundtrip tests, plus package-ownership/fidelity tests for affected package parts |

For docs-only changes in this page, `git diff --check` is usually sufficient.

## File Reference

- Chart public data contracts: [`types/data/src/data/charts.ts`](../../../types/data/src/data/charts.ts)
- Chart bridge contract: [`types/bridges/src/chart-bridge.ts`](../../../types/bridges/src/chart-bridge.ts)
- Worksheet chart API implementation: [`kernel/src/api/worksheet/charts.ts`](../../../kernel/src/api/worksheet/charts.ts)
- Kernel chart bridge facade: [`kernel/src/domain/charts/chart-bridge.ts`](../../../kernel/src/domain/charts/chart-bridge.ts)
- Data resolver: [`kernel/src/domain/charts/bridge/chart-data-resolver.ts`](../../../kernel/src/domain/charts/bridge/chart-data-resolver.ts)
- Render orchestrator: [`kernel/src/domain/charts/bridge/chart-render-orchestrator.ts`](../../../kernel/src/domain/charts/bridge/chart-render-orchestrator.ts)
- Render cache: [`kernel/src/domain/charts/bridge/chart-render-cache.ts`](../../../kernel/src/domain/charts/bridge/chart-render-cache.ts)
- Range resolver: [`kernel/src/domain/charts/chart-range-references.ts`](../../../kernel/src/domain/charts/chart-range-references.ts)
- Chart engine exports: [`charts/src/index.ts`](../../../charts/src/index.ts)
- Config-to-spec bridge: [`charts/src/core/config-to-spec/index.ts`](../../../charts/src/core/config-to-spec/index.ts)
- Grammar compiler: [`charts/src/grammar/compiler.ts`](../../../charts/src/grammar/compiler.ts)
- Canvas renderer: [`charts/src/primitives/renderer/canvas-renderer.ts`](../../../charts/src/primitives/renderer/canvas-renderer.ts)
- Rust chart storage bridge: [`compute/core/src/storage/engine/objects/charts.rs`](../../../compute/core/src/storage/engine/objects/charts.rs)
- Rust chart storage services: [`compute/core/src/storage/engine/services/objects/charts.rs`](../../../compute/core/src/storage/engine/services/objects/charts.rs)
- Rust chart transform crate: [`compute/core/crates/compute-charts/src/lib.rs`](../../../compute/core/crates/compute-charts/src/lib.rs)
- Rust native rasterizer: [`compute/core/crates/compute-chart-render/src/lib.rs`](../../../compute/core/crates/compute-chart-render/src/lib.rs)
- XLSX chart domain parser: [`file-io/xlsx/parser/src/domain/charts/`](../../../file-io/xlsx/parser/src/domain/charts/)
- Rust chart domain model: [`domain-types/src/domain/chart/`](../../../domain-types/src/domain/chart/)
- Spreadsheet chart machine: [`apps/spreadsheet/src/systems/objects/machines/chart-machine.ts`](../../../apps/spreadsheet/src/systems/objects/machines/chart-machine.ts)
- Spreadsheet canvas bridge wiring: [`apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx`](../../../apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx)
