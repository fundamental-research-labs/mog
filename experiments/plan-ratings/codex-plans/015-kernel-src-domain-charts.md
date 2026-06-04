# 015 - Kernel Chart Domain Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/domain/charts`

Queue item: 15

Scope: kernel-side chart domain code that bridges compute-owned chart floating objects, workbook data/range resolution, `@mog/charts` compilation, canvas cached rendering, chart layout/export snapshots, chart positioning/z-order/table-link helpers, and wire-to-public chart config conversion.

Files and integration points inspected:

- `kernel/src/domain/charts/index.ts`
- `kernel/src/domain/charts/chart-bridge.ts`
- `kernel/src/domain/charts/chart-store.ts`
- `kernel/src/domain/charts/chart-crud.ts`
- `kernel/src/domain/charts/chart-range-references.ts`
- `kernel/src/domain/charts/chart-position.ts`
- `kernel/src/domain/charts/chart-z-order.ts`
- `kernel/src/domain/charts/chart-table-links.ts`
- `kernel/src/domain/charts/chart-manager*.ts`
- `kernel/src/domain/charts/chart-*-converters.ts`
- `kernel/src/domain/charts/bridge/*`
- `kernel/src/domain/charts/__tests__/*`
- `types/bridges/src/chart-bridge.ts`
- `kernel/src/context/kernel-context.ts`
- `kernel/src/document/document-lifecycle-system.ts`
- `kernel/src/api/workbook/workbook-impl.ts`
- `kernel/src/api/worksheet/charts.ts`
- `canvas/grid-canvas/src/renderer/grid-renderer.ts`
- `apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx`
- `runtime/sdk/src/chart-export/node-chart-image-exporter.ts`

Scope this plan does not cover:

- Replacing the `@mog/charts` compiler/rendering package.
- Moving compute-owned chart storage, CellId identity, or mutation ownership into TypeScript.
- Optimizing benchmark-only or mock-only paths.
- Changing public resolved-spec snapshot fields without an intentional schema-versioned contract update.
- Building temporary compatibility shims to avoid repairing production callers.

## Current role of this folder in Mog

`kernel/src/domain/charts` is the public kernel chart domain bridge. It is not the chart storage engine and not the chart renderer itself. Its current production role is to compose several owners:

- Rust compute, exposed through `ComputeBridge`, owns chart floating-object storage, mutation results, CellId-backed range and anchor identity, table-link persistence, sheet metadata, hidden rows/columns, resolved formats, and workbook theme data.
- `kernel/src/domain/charts/chart-store.ts` is a thin compute delegate for chart CRUD. Mutation event emission is intentionally left to compute mutation handling.
- `ChartBridge` implements `IChartBridge` from `@mog-sdk/contracts/bridges`. It owns lifecycle, EventBus subscriptions, synchronous cached canvas painting, async compile orchestration, and public chart data/layout/export methods.
- `ChartRenderCache`, `ChartRenderCacheState`, and `ChartSheetIndex` own paint-path cache state, dirty/pending flags, import render statuses, frame-aware cache keys, and duplicate imported `chartId` isolation across sheets.
- `ChartDataResolver` turns a `ChartFloatingObject` into a renderable `ChartConfig` plus `@mog/charts` data by resolving ranges, fetching cells, applying hidden-cell policy, source-linked number formats, imported caches, bubble validation, and workbook theme colors.
- `chart-range-references.ts` resolves CellId identity ranges and A1 strings into workbook-scoped `CellRange` values and diagnostics.
- `chart-config-normalizer.ts` and `chart-*-converters.ts` are the sanctioned wire-to-contract narrowing boundary from generated compute wire data into public chart config types.
- `chart-compiler.ts` is the shared production compiler adapter from resolved config/data into chart marks, layout snapshots, and export snapshots. It optionally applies injected chart WASM transforms before the TypeScript grammar compiler.
- `resolved-spec-*` modules build the semantic snapshot used by diagnostics/export. They encode ranges, series projections, geometry traces, package authority, compiler path, hashes, layout, and unsupported-feature diagnostics.
- `chart-position`, `chart-z-order`, `chart-table-links`, and `chart-manager*` provide spreadsheet-specific helpers around compute-backed chart objects and floating-object interaction.

Important observed production callers:

- Spreadsheet grid rendering wires `wb.charts.renderCached(chartId, canvasCtx, bounds, activeSheetId)` and invalidates drawing on `onCacheUpdate`.
- Drawing canvas expects the chart renderer callback to stay synchronous inside the canvas dispatch frame.
- Workbook and worksheet APIs expose the concrete bridge through `IChartBridge`, including layout and export snapshot methods.
- Runtime SDK and spreadsheet image export use `getMarksAtSize`.
- Document lifecycle injects chart WASM exports by dynamically importing `initChartWasm`.

The folder already has substantial tests for render cache behavior, bridge subscriptions, sheet-scoped cache keys, stop races, range resolution, structural A1 updates, data resolver semantics, config conversion, import render status, resolved-spec snapshots, package authority, geometry snapshots, theme colors, and hidden visibility.

## Improvement objectives

1. Make chart ownership boundaries explicit and enforceable: compute owns storage and identity; kernel chart domain owns projection, live resolution, cache lifecycle, and public bridge behavior; `@mog/charts` owns compiler semantics; canvas owns paint scheduling; contracts own public API and snapshot shapes.

2. Turn the chart render pipeline into named production contracts instead of a loose sequence of helper calls: `ChartFloatingObject -> resolved ranges -> render config -> chart data -> normalized render data -> compiler result -> marks/layout/resolved spec`.

3. Make range resolution and resolved-spec diagnostics deterministic by construction. Avoid shared mutable diagnostics across parallel promise paths, stable-sort diagnostics by chart path, and make resolved-spec hashes insensitive to task scheduling.

4. Improve production invalidation without touching test-only paths. Replace workbook-wide per-change re-resolution scans with a chart dependency index that is updated from the same production events that currently invalidate caches.

5. Batch production data access in the resolver. Replace per-cell sequential `getValue` loops with range-level reads where semantics match, while preserving error-to-null behavior, hidden-cell masking, cross-sheet aliases, and source-linked format lookup.

6. Strengthen cache identity and lifecycle contracts. Make sheet ID and render frame explicit wherever the production path has that context, and confine legacy raw-`chartId` aliases to documented migration compatibility.

7. Keep public export and diagnostics paths on the same compiler path as UI rendering. `getMarksAtSize` and `getRenderSnapshotAtSize` must stay one-off compiles that do not mutate UI render caches.

8. Complete and guard the wire-to-config conversion boundary. Unknown wire enum values should be narrowed or diagnosed only at the sanctioned converter boundary, and chart domain code outside that boundary should not mix generated `*Data` and public `*Config` types.

9. Make resolved-spec ownership clear. Separate source-model facts, compiler-output facts, package-authority facts, and unsupported-rendering diagnostics so future chart-family support can be added systematically.

## Production-path contracts and invariants to preserve or strengthen

Bridge and rendering:

- `IChartBridge.renderCached` must remain synchronous. It may read committed cache state, paint placeholders/errors/stale marks, and schedule async compilation fire-and-forget, but it must not await or yield.
- A cache miss paints a placeholder and starts compilation only when compilation is not already pending.
- Dirty charts with stale marks paint stale marks and recompile in the background.
- Error state paints synchronously and does not retry until an invalidation clears the error.
- Cache commits after `stop()` must be rejected and pending aliases cleared so in-flight async work cannot repopulate stopped bridge state.
- `onCacheUpdate` fires only on real cache outcomes or the `'*'` clear-all sentinel.
- `getMarksAtSize` and `getRenderSnapshotAtSize` must not update UI mark/layout caches.
- Render-frame dimensions must be normalized to finite integer dimensions of at least 1.

Identity and ownership:

- Chart storage and mutations remain delegated to `ComputeBridge`.
- Chart mutations do not emit chart events manually from this folder; compute mutation handling remains the event source.
- Sheet ID is part of chart identity when possible because imported/replayed workbooks can contain duplicate chart IDs on different sheets.
- Explicit sheet context wins over cache index lookup. Unscoped chart ID lookup is valid only when the chart ID is unambiguous.
- Chart sheets, embedded worksheet charts, export-sized renders, and active viewport renders must not share cache entries unless their render-frame contract says they are identical.

Range and data resolution:

- CellId identity ranges take precedence over stale A1 strings and resolve at render time through compute.
- Deleted identity endpoints produce diagnostics and must not fall back to stale A1 refs.
- Unqualified A1 refs resolve against the chart owner sheet only when one exists.
- Sheet-qualified A1 refs must resolve by workbook sheet name and must not silently fall back on unknown sheets.
- Resolved ranges carry `sheetId` so cross-sheet chart references read and invalidate the referenced sheet, not the active sheet.
- Imported series references and fallback caches remain renderable when live refs are unavailable and the cache is marked renderable.
- Hidden-row/hidden-column policy for `plotVisibleOnly` must mask source cells and filter fully hidden imported series without falling back to imported caches for hidden live source dimensions.
- Cell errors remain chart nulls unless a future public chart contract deliberately represents error points.
- Workbook theme colors and source-linked number formats must be invalidated when their sources change.

Resolved spec and export:

- Resolved spec snapshots are public diagnostics/export contracts. Schema changes require an intentional version bump and fixture/snapshot updates.
- `compilerInputHash` must be stable for equivalent chart inputs regardless of object key order or async scheduling.
- Snapshot diagnostics must be deterministic and deduplicated where the contract says they are deduplicated.
- Package authority status must consistently classify current, stale, and unknown authority from OOXML provenance and relationship-closure evidence.
- Unsupported-feature diagnostics must distinguish preserved-but-not-rendered features from invalid specs and from terminal import render statuses.
- Compiler path IDs must accurately distinguish TypeScript grammar vs WASM-transform-plus-TypeScript grammar paths.

Conversion boundary:

- `chart-type-converters.ts` remains the only sanctioned generated-wire to public-config narrowing boundary.
- Kernel chart code outside converter modules should not import both generated chart data types and public chart config types in the same implementation file.
- Unknown wire enum strings must either produce diagnostics or be dropped at the boundary, not flow into public config unchecked.

## Concrete implementation plan

### 1. Write down and enforce the chart ownership map

Add a public-repo architecture note adjacent to this folder, or a compact module-level contract file, that names each owner and the direction of dependencies:

- Compute bridge: storage, mutations, CellId identity, sheet metadata, theme, resolved formats, hidden dimensions, table links.
- Kernel chart domain: projection, live data resolution, bridge lifecycle, invalidation, resolved-spec snapshots, manager helpers.
- `@mog/charts`: extraction, grammar/spec compilation, marks, geometry traces, chart-family algorithms.
- Canvas/apps: synchronous paint loop, invalidation scheduling, UI input paths.
- Contracts/types: `IChartBridge`, chart snapshots, public chart config/data shapes.

Then add a small boundary checker or lint rule extension for this folder:

- Converter modules may import generated chart wire data and public chart config types.
- Resolver/compiler/snapshot modules may consume public chart config and `ChartFloatingObject`, but they should not perform ad hoc enum narrowing outside the converter boundary.
- `chart-store` remains the only chart CRUD delegate module.

### 2. Introduce named pipeline contracts for resolved render inputs

Create explicit internal types for the production render pipeline, for example:

- `ChartSourceObject`: chart ID, owner sheet, raw compute object, import status.
- `ChartResolvedRanges`: stable range references plus ordered diagnostics.
- `ChartRenderConfigProjection`: normalized `ChartConfig`, render extra/provenance, fallback-cache authority.
- `ChartResolvedRenderInput`: chart object, resolved ranges, config, hidden visibility, source-linked format resolutions, workbook theme, normalized `ChartData`.
- `ChartCompiledRenderOutput`: marks, layout, compiler path, compile input, geometry traces.

Refactor `ChartDataResolver` and `chart-compiler.ts` to pass these named contracts between phases. The goal is not to add abstraction for its own sake; it is to make each production contract independently testable and prevent future features from smuggling state through loosely typed helper arguments.

### 3. Make range resolution deterministic and indexable

Refactor `chart-range-references.ts` so every resolver returns `{ reference, diagnostics }` instead of mutating one shared diagnostics array while running inside `Promise.all`.

Implementation details:

- Define a stable path order for diagnostics: top-level `dataRange`, `categoryRange`, `seriesRange`, then per-series `name`, `values`, `categories`, `bubbleSizes` by series index.
- Resolve workbook sheet names once per `resolveChartRangeReferences` call and pass a sheet-name index to A1 resolvers.
- Preserve identity-before-A1 precedence exactly.
- Preserve current special cases for explicit per-series value ranges without `dataRange`, first-series category fallback, and sparse cache point-count semantics.
- Return resolved ranges plus ordered diagnostics assembled from resolver results after all parallel work finishes.
- Add a stable `rangeDependencyKey` for each resolved reference: `sheetId:startRow:startCol:endRow:endCol:kind:seriesIndex`.

### 4. Build a production chart dependency index

Replace repeated workbook-wide scans on cell events with a dependency index owned by the chart bridge lifecycle.

Target behavior:

- On chart create/update/delete and sheet delete, update dependency entries for the affected chart and sheet context.
- On initial bridge start, lazily populate dependencies as charts are first observed or on first data-affecting event.
- On `cell:changed` and `cells:batch-changed`, query the dependency index for overlapping ranges and invalidate only affected chart owner sheets.
- If dependency resolution fails because the chart has malformed/unknown/deleted ranges, keep a conservative invalidation entry for the chart until the next successful chart update.
- Keep a slow fallback path only as a production correctness fallback when the index is cold or explicitly invalidated, not as the steady-state path.
- Invalidate the dependency index on sheet rename, sheet reorder if identity requires it, chart update, table-link update, and structural row/column operations.

This must target the real EventBus and `ChartBridge` production subscriptions. Do not add a separate benchmark-only invalidation path.

### 5. Batch chart cell and format reads through production compute APIs

Refactor `createCellAccessor` and source-linked axis format resolution to reduce per-cell and per-axis IPC without changing semantics.

Implementation details:

- Use `computeBridge.getRangeValues2d(sheetId, startRow, startCol, endRow, endCol)` for rectangular value reads when its returned value semantics match chart extraction needs.
- Where `getRangeValues2d` does not preserve current `getValue` behavior, add or use a production bridge method that returns the chart extraction value shape directly. Do not add a test-only batch reader.
- Group ranges by sheet and coalesce overlapping rectangles before fetching.
- Preserve current behavior where duplicate cells are read once, hidden cells return `HIDDEN_CHART_CELL`, and cell error objects become null chart values.
- Keep sheet-name aliases for explicit series refs.
- Batch `getResolvedFormat` lookups by selecting the first visible source cell per source-linked axis role, then deduplicate repeated `(sheet,row,col)` requests before calling compute.
- Add cache invalidation for source-linked format results when formatting events exist; if the current EventBus lacks sufficient format events, document the smallest event contract needed and keep conservative chart invalidation on broad format/theme changes.

### 6. Strengthen cache keys and lifecycle APIs

Introduce a typed `ChartRenderCacheKey` helper that takes `{ chartId, sheetId, frame }` and centralizes all string key construction. Use it from `ChartRenderCache`, `ChartRenderCacheState`, and any diagnostics that need cache identity.

Implementation details:

- Make sheet-scoped keys the normal path for every caller that has sheet context.
- Keep raw `chartId` alias lookup only for documented legacy/import replay transitions and remove it once all production create/update/render paths pass sheet context.
- Extend frame suffix coverage if chart sheets, print/export page context, or zoom-to-fit need distinct layout authority.
- Preserve stale-mark repaint during dirty recompiles.
- Preserve stopped-bridge commit rejection and pending cleanup.
- Ensure import render status precedence remains terminal and sheet-scoped.
- Add tests that duplicate chart IDs on different sheets cannot collide across marks, errors, layouts, import statuses, dirty flags, pending flags, and frame-sized entries.

### 7. Split resolved-spec builder responsibilities without changing schema by accident

Refactor `resolved-spec-snapshot.ts` into a coordinator over smaller contract builders:

- Source object snapshot: chart object, owner sheet, layout authority, render frame, package authority.
- Source data snapshot: ranges, category levels, series source inventory, render authority.
- Compiler evidence snapshot: compiler path, input hash, chart area, plot area, layout, geometry traces.
- Chart-family support snapshot: family support, approximation status, feature coverage.
- Diagnostics snapshot: range diagnostics, render authority diagnostics, package authority, import diagnostics, unsupported/preserved-only features.

Keep the existing output schema unless a versioned change is explicitly part of the implementation. This makes future chart-family improvements systematic: each new chart family must decide its source facts, compiler evidence, approximation evidence, and unsupported feature diagnostics.

### 8. Complete converter boundary coverage and remove unsanctioned casts

Audit all chart converter modules and call sites for broad casts and mixed wire/config ownership.

Implementation details:

- Replace `updates as ChartFloatingObject` in `chart-store.update` with a named `ChartFloatingObjectPatch` type or a compute bridge overload that accepts partial chart updates.
- Add exhaustive converter tests for every chart enum-like field in axis, legend, annotation, format, option, kind, and series conversion modules.
- Keep `wireChartTypeToConfig` diagnostics as the single chart-type narrowing authority.
- Add a checker that flags new imports of generated chart `*Data` types outside converter modules unless explicitly allowed.
- Document which public contract fields are intentionally unrestricted strings, such as series-level chart type where current contracts allow that.

### 9. Reconcile chart manager helpers with floating-object ownership

Keep charts out of the generic floating-object CRDT map, but make the manager helper boundary sharper:

- `convertChartToFloatingObject` should accept only compute-backed chart objects and return a view object for selection/interaction.
- Position conversion must preserve rotation, flips, visibility, lock/print flags, z-index, and anchor identity semantics.
- Position updates remain compute mutations through chart-store.
- Table-link helpers should use compute-native link/unlink APIs for persistence and only write optional metadata through chart updates.
- Structural A1 updates should remain legacy-only and never rewrite identity-backed ranges.

Add tests that exercise these through production helper APIs rather than mutating manager internals.

### 10. Integrate through public contracts and generated artifacts

After the folder refactor, update all production consumers coherently:

- `types/bridges/src/chart-bridge.ts` if the bridge method contracts need explicit sheet/frame overload docs.
- `kernel/src/context/kernel-context.ts` for lifecycle creation.
- `apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx` if render frame or sheet context propagation changes.
- `canvas/grid-canvas` and drawing canvas bridge types if frame metadata becomes part of the renderer callback.
- `kernel/src/api/worksheet/charts.ts` for layout and diagnostics callers.
- `runtime/sdk` image export if export-sized snapshot contracts change.
- `@mog/charts` tests if compiler evidence or chart-family traces become more complete.

Do not add compatibility shims in front of stale contracts. Update the public contract and every production caller in the same implementation slice.

## Tests and verification gates

Run these after implementation, in order, from `/Users/guangyuyang/Code/mog-all/mog` unless noted otherwise:

1. Focused kernel chart tests:
   - `pnpm --filter ./kernel test -- kernel/src/domain/charts`
2. Additional targeted tests for any touched neighboring production paths:
   - `pnpm --filter ./kernel test -- kernel/src/api/worksheet/charts`
   - `pnpm --filter ./kernel test -- kernel/src/api/workbook`
   - `pnpm --filter ./runtime/sdk test -- chart-export`
   - `pnpm --filter ./canvas/grid-canvas test`
   - `pnpm --filter ./apps/spreadsheet test -- chart`
3. Chart compiler package tests if any `@mog/charts` assumptions, traces, or extraction contracts change:
   - `pnpm --filter ./charts test`
4. Kernel type gate:
   - `pnpm --filter ./kernel typecheck`
5. Type gates for any touched consumers:
   - `pnpm --filter ./runtime/sdk typecheck`
   - `pnpm --filter ./apps/spreadsheet typecheck`
   - `pnpm --filter ./canvas/grid-canvas typecheck`
6. Repo-wide TypeScript gate after integration:
   - `pnpm typecheck`
7. If compute bridge signatures, generated bridge types, or Rust chart storage/range APIs change, also run the relevant Rust gates:
   - `cargo test -p compute-core`
   - `cargo clippy -p compute-core`
8. If UI chart insertion/editing/rendering behavior changes, run the spreadsheet dev server and exercise the real UI input path:
   - create a chart from selected cells
   - edit source cells and verify cache invalidation/repaint
   - hide rows/columns with `plotVisibleOnly`
   - move/resize a chart
   - import a workbook with duplicate chart IDs on different sheets
   - export chart image or diagnostics snapshot

New or strengthened tests to add:

- Deterministic `resolveChartRangeReferences` diagnostics order under parallel resolution.
- Dependency-index invalidation for same-sheet and cross-sheet top-level ranges, explicit per-series ranges, bubble-size ranges, unknown sheets, malformed refs, and deleted identity ranges.
- Batching tests proving cell values are fetched once per coalesced range and hidden/error/null semantics match the current accessor.
- Source-linked axis format tests for deduped live format reads and conservative fallback when format lookup fails.
- Cache-key tests covering duplicate chart IDs, frame-sized renders, chart sheets, import status, dirty flags, pending flags, and stopped-bridge races.
- Resolved-spec snapshot tests proving equivalent inputs produce identical hashes and diagnostics regardless of object key order and async resolver completion order.
- Converter boundary tests for every enum-like wire field and a negative import-boundary test for generated chart data types outside converter modules.

## Risks, edge cases, and non-goals

Risks and edge cases:

- `getRangeValues2d` may not currently return exactly the same value semantics as `getValue`; verify error, formula, rich text, blank, and materialized range-backed cells before switching the resolver.
- A dependency index can go stale if it misses chart updates, sheet rename/delete, table-link changes, structural edits, or import-status transitions. Keep conservative invalidation for cold or failed index entries.
- Duplicate imported chart IDs are already a known edge. Any cache-key migration must prove marks, errors, layouts, import statuses, dirty state, pending state, and listeners remain sheet-scoped.
- Resolved-spec snapshots are public diagnostic artifacts. Even beneficial field movement can become a breaking change if it changes existing schema or hash semantics unintentionally.
- Batching and range coalescing can change read order. Diagnostics, hash inputs, and extracted chart data must remain stable.
- Workbook theme caching is currently resolver-owned and cleared by full cache clear. More granular theme invalidation must still clear the resolver cache, not only mark render marks dirty.
- Structural range updates intentionally ignore identity-backed ranges. Do not rewrite identity ranges from TypeScript.
- Chart sheets and print/export frames can require different layout authority than embedded worksheet charts.
- Console warnings in converters are not a contract. Diagnostics should be represented in typed results where production callers need them.

Non-goals:

- Do not store charts in the generic floating-object CRDT map.
- Do not make canvas rendering await chart compilation.
- Do not add a benchmark-only invalidation path.
- Do not bypass `ComputeBridge` for chart storage or CellId resolution.
- Do not paper over converter gaps with `as unknown as` casts.
- Do not downgrade import/render diagnostics to placeholders when the resolved-spec path can preserve exact provenance.
- Do not introduce private `mog-internal` dependencies into public Mog source.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable if the ownership contracts above are written first.

Suggested split:

- Agent A: ownership map, import-boundary checker, converter-boundary audit, and chart-store patch typing.
- Agent B: deterministic range resolver, ordered diagnostics, sheet-name index, and dependency-key generation.
- Agent C: chart dependency index and EventBus subscription integration for create/update/delete/sheet/cell/structural events.
- Agent D: resolver batching for values, hidden visibility, source-linked formats, and workbook theme invalidation.
- Agent E: cache key/lifecycle cleanup across sheet/frame/import-status/dirty/pending/layout states.
- Agent F: resolved-spec builder split, deterministic hashes, package authority, and chart-family diagnostic fixtures.
- Agent G: production consumer integration in spreadsheet grid, canvas bridge types, worksheet/workbook APIs, and runtime SDK export.
- Integrator: run the full test/type/UI verification matrix, reconcile public contract changes, and remove any temporary overlap left by parallel slices.

Dependencies:

- `mog/charts` because extraction, compiler specs, marks, traces, family support, and data normalization live there.
- `mog/types/bridges/src/chart-bridge.ts` and `mog/contracts` because `IChartBridge`, chart snapshots, and chart config/data contracts are public.
- `mog/kernel/src/bridges/compute` and compute-core if bridge APIs or chart storage/range methods change.
- `mog/canvas/grid-canvas` and `mog/canvas/drawing-canvas` because sync cached chart painting flows through canvas bridge callbacks.
- `mog/apps/spreadsheet` because it wires active sheet context, cache-update invalidation, and real UI chart workflows.
- `mog/runtime/sdk` because image export compiles chart marks through `IChartBridge`.
- `mog/file-io` and compute import normalization paths if OOXML import provenance, package authority, or import render statuses change.
