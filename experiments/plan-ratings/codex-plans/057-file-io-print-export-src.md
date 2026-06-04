# 057 - File I/O Print Export Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/file-io/print-export/src`

Queue item: 57

Scope: the production `@mog/print-export` TypeScript package source for browser print, print preview HTML generation, PDF export orchestration, page setup contracts, spreadsheet-to-print data provider contracts, cell/floating-object PDF renderers, and the public package surface consumed by the spreadsheet app.

Files and integration points inspected:

- `file-io/print-export/src/index.ts`
- `file-io/print-export/src/contracts/types.ts`
- `file-io/print-export/src/html/page-layout.ts`
- `file-io/print-export/src/html/style-generator.ts`
- `file-io/print-export/src/html/table-generator.ts`
- `file-io/print-export/src/print/print-handler.ts`
- `file-io/print-export/src/pdf/*`
- `file-io/print-export/src/pdf/__tests__/*`
- `file-io/print-export/__tests__/*`
- `file-io/pdf/layout/src/*`
- `file-io/pdf/graphics/src/*`
- `file-io/pdf/core/src/*`
- `apps/spreadsheet/src/hooks/file-io/use-pdf-export.ts`
- `apps/spreadsheet/src/hooks/file-io/use-print.ts`
- `apps/spreadsheet/src/chrome/toolbar/backstage/PrintPreview.tsx`
- `apps/spreadsheet/src/chrome/toolbar/backstage/ExportPanel.tsx`
- `apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx`
- `apps/spreadsheet/src/components/grid/providers/ViewportTableDataProvider.ts`
- `kernel/src/api/worksheet/print.ts`
- `types/core/src/core.ts`

Scope this plan does not cover:

- Replacing `@mog/pdf-layout`; it already owns the format-agnostic pagination engine and should remain the layout source of truth.
- Replacing `@mog/pdf-graphics` or `file-io/pdf/core`; this plan depends on them for rendering commands and PDF byte serialization.
- Reworking the spreadsheet page setup dialog, ribbon controls, page break state machine, or grid renderer beyond the adapter contracts needed to feed print/export correctly.
- Adding test-only PDF paths, browser-only fallbacks, compatibility shims, or alternate export implementations that bypass the production renderer.
- Moving private/internal content into the public `mog` repository.

## Current role of this folder in Mog

`file-io/print-export/src` is the package boundary between spreadsheet workbook state and printed/exported output.

The current public package surface in `index.ts` exports:

- PDF export: `SpreadsheetPdfExporter`, `createPdfExporter`, `PdfDataProvider`, cell input types, PDF options/results/warnings, and used range types.
- Browser print and preview HTML: `PrintHandler`, `TableGenerator`, `StyleGenerator`, `PageLayout`, and singleton instances.
- Print contracts: `PrintOptions`, `PageSetup`, `PrintArea`, `PrintRange`, paper sizes, header/footer placeholders, and inch/pixel conversion helpers.
- `PaginationEngine` and selected `@mog/pdf-layout` types for callers that need page break calculations.

The browser print path is:

1. Spreadsheet callers build an `ITableDataProvider`.
2. `PrintHandler.calculateLayoutWithEngine()` adapts `PrintOptions`, `PageSetup`, `PrintArea`, dimensions, merges, hidden rows/cols, and manual breaks into `@mog/pdf-layout` inputs.
3. `PrintHandler.generatePreview()` or `print()` generates one HTML table per page, wraps it in header/footer HTML, and either returns preview HTML or prints through a hidden iframe.

The PDF path is:

1. Spreadsheet callers build a `PdfDataProvider`.
2. `SpreadsheetPdfExporter.export()` resolves sheet IDs, used ranges, page setup, content measurers, and pagination plans.
3. It renders each page through `RenderBackend`: cells, conditional formatting, sparklines, charts, drawings, and images.
4. `createPdfExporter()` wires `PdfCanvas` to `TauriFontBridge`, which can flush page content operations and font operations through Tauri IPC.

The adjacent production app path is not yet as complete as the renderer contracts. `usePdfExport.ts` currently adapts workbook cells mostly as `String(value)` with empty `format`, returns no charts/drawings/images/CF/sparklines, returns no page setup, and selection export only restricts sheet IDs. `use-print.ts`, `PrintPreview.tsx`, `SpreadsheetGrid.tsx`, and `ViewportTableDataProvider.ts` each contain separate conversions from `PrintSettings` or viewport data into print-export contracts.

The package already has meaningful unit coverage for renderer behavior. There are local tests for HTML style/table/page-layout behavior, print preview HTML, PDF exporter orchestration, cell rendering, borders, font resolving, conditional formatting, charts, drawings, images, sparklines, number-format rendering, and position resolving. The bigger gap is that production adapters and cross-format contracts are duplicated, partial, or not verified through the actual spreadsheet UI export path.

## Improvement objectives

1. Make `@mog/pdf-layout` the single pagination contract for browser print, print preview, page break preview, and PDF export.

2. Define one canonical print/export job model that represents sheet IDs, print scope, page ranges, print areas, manual breaks, print titles, page setup, output format, and unit space before any renderer runs.

3. Complete the spreadsheet data-provider adapter so PDF export receives the same production workbook information the renderer already supports: formatted display values, resolved cell formats, number formats, rich text, comments, hyperlinks, merged regions, hidden rows/cols, page setup, print areas, print titles, manual breaks, charts, drawings, images, conditional formatting, and sparklines.

4. Make PDF output finalization explicit. `SpreadsheetPdfExporter.export()` must return a concrete downloadable artifact or a backend-specific artifact handle, not only page counts and warnings while the app guesses for `blob`, `bytes`, or `dataUrl`.

5. Remove duplicated and conflicting contracts, especially the two different `PdfExportResult` interfaces and the separate browser-pixel vs PDF-point page setup conversions.

6. Normalize units and color spaces across all renderers. Layout units must be explicit at every boundary, and all PDF RGB tuples must use one `[0..1]` contract.

7. Resolve floating-object coordinate ownership so charts, drawings, and images are positioned exactly once relative to page margins, scale, repeat rows/cols, and content centering.

8. Wire currently isolated renderer capabilities into the main export path where production data exists, including number-format-aware rendering, comments, checkbox cells, inline images, CF `showValue`/`iconOnly`, header/footer variants, header/footer images, document metadata, bookmarks, and page order.

9. Improve render-time complexity by replacing per-cell linear merge scans and repeated async provider calls with per-sheet/page render plans and indexes.

10. Add production-path verification through package tests, app hook tests, Rust PDF bridge tests, and browser UI tests using real input paths.

## Production-path contracts and invariants to preserve or strengthen

Package boundaries:

- `@mog/print-export` remains a public Mog package under `mog`; it must not depend on `mog-internal`.
- `@mog/print-export` may depend on `@mog/pdf-layout`, `@mog/pdf-graphics`, `@mog-sdk/contracts`, and pure spreadsheet utility packages, but it must not import spreadsheet app internals.
- Spreadsheet app adapters may import `@mog/print-export`; `@mog/print-export` must not import React, app hooks, UIStore, or workbook implementation modules.
- `@mog/pdf-layout` remains format-agnostic. It should not learn about HTML, PDF, DOM, React, or workbook state.
- `@mog/pdf-graphics` remains backend-oriented. Spreadsheet semantics should stay in print-export or upstream adapters.

Layout and units:

- Pagination layout is computed exactly once per export/print job per sheet/range unless settings change.
- `PageSetupInput` uses points. Browser print may render CSS in inches/pixels, but the shared plan must make conversion explicit at the edge.
- Print options converted from contract `PrintSettings` must preserve paper size, custom paper dimensions, orientation, scale, fit-to-width/height, margins including header/footer margins, gridlines, headings, horizontal/vertical centering, page order, black-and-white, draft, first page number, comments/errors policy, and copies when output format supports them.
- `PrintArea`, manual row/column breaks, and print titles/repeat rows/cols must be read from the kernel mirror or worksheet print API, not recomputed independently in each UI component.
- `PaginationPlan` page ranges are inclusive; floating-object resolver ranges are half-open only inside its own adapter. Range conversion must be centralized and tested.
- Fit-to-page scale direction remains the `@mog/pdf-layout` contract: content-space capacity is `printableSize / scale`.

Rendering:

- PDF page render order remains page begin, graphics state save, page/margin/content transforms, repeated rows/cols, main cells, floating objects, restore, page end, with explicit tests for any change.
- Cell render order remains background, content, borders, with conditional formatting style overrides before base text and visual overlays after base cell rendering.
- Merged cells render only from the top-left source cell and their bounds are clipped to the visible page slice.
- Hidden rows and columns do not consume page content space or render cells/objects.
- Text clipping must remain per-cell for PDF rendering and safe for HTML generation.
- Browser print HTML must continue escaping cell values, sheet names, titles, and header/footer text.
- Header/footer placeholder substitution must preserve page number, total pages, date, time, file, and sheet semantics, and should be extended without breaking the current placeholder syntax.

PDF artifact contract:

- A successful app-level PDF export must produce a downloadable PDF artifact in the same call path that rendered the pages.
- Page count and warnings are metadata, not the artifact.
- In unsupported browser-only environments, failure must be explicit and deterministic before or during backend creation; it must not look like a successful export with no bytes.
- Cancellation must not leave a partially finalized artifact presented as successful output.

Data-provider contracts:

- Data providers are adapters, not business logic. They should translate workbook/kernel state into print-export input types without losing information the renderer can consume.
- Synchronous dimension reads in renderer/layout contracts must be backed by real prefetched maps or indexes, not casts or accidental async calls.
- Cell display values should come from the same formatting engine/user-visible display pipeline used by the grid, not raw `String(value)` conversion.
- Cell formats must be resolved before rendering: font, alignment, wrap/shrink/rotation, indent, fills, borders, rich text, hyperlink, comments, data validation checkbox state, number-format classification, and any print-specific black-and-white/draft adjustments.
- Conditional formatting and sparklines must be read from production kernel/compute APIs once those APIs are exposed; until then, the plan must identify that dependency rather than stubbing silently.
- Floating objects must honor printability flags, anchors, z-order, image bytes, chart rasterization, and drawing geometry.

Determinism and performance:

- Export warnings must be deterministic and typed.
- Large sheets should build a per-sheet render plan with indexed merges, hidden sets, row/column dimensions, and cell batches instead of scanning merges and awaiting hidden/cell reads per cell.
- Progress should report total pages and rendered pages consistently for active sheet, selected sheets, workbook scope, page ranges, and cancellation.
- No performance work should target only mocks or tests. Any profiling should exercise the spreadsheet app path that users run.

## Concrete implementation plan

### 1. Define a canonical print/export job model

Add a package-local contract layer such as `src/contracts/job.ts` and re-export intentional public types from `index.ts`.

The job model should include:

- `PrintExportJob`: workbook/job metadata, output format, file name, sheet jobs, selected page range, and cancellation/progress hooks.
- `SheetPrintJob`: sheet ID/name, used range, explicit print area, manual breaks, print titles, page setup, print options, object policy, comments/errors policy, and source print settings provenance.
- `ResolvedPageSetup`: one canonical structure that can lower to `@mog/pdf-layout` points, browser CSS inches, and UI preview pixels.
- `ResolvedPrintScope`: active sheet, selected sheets, workbook, current selection, explicit area, and selected page range.
- `PrintExportWarning`: a typed union that includes layout warnings, empty sheets, unsupported artifacts, font fallback, image unsupported, object skipped, data unavailable, and adapter incompleteness.

Then move repeated conversion logic out of:

- `PrintPreview.tsx`
- `SpreadsheetGrid.tsx`
- `use-print.ts`
- `use-pdf-export.ts`
- `PrintHandler.buildPageSetupInput()`

into pure conversion helpers owned by `@mog/print-export` or a public app adapter package that does not import app internals.

The first invariant is that browser print, print preview, page-break preview, and PDF export all receive the same `SheetPrintJob` for the same workbook state.

### 2. Make `PrintSettings` conversion complete and testable

Add pure conversion helpers:

- `printSettingsToPrintOptions(settings: PrintSettings): PrintOptions`
- `printSettingsToPageSetup(settings: PrintSettings, titles?: PrintTitles): PageSetup`
- `printSettingsToPageSetupInput(settings: PrintSettings, area, titles, breaks): PageSetupInput`
- `paperSizeToDimensions(settings): { widthPt; heightPt; widthIn; heightIn }`
- `parseCustomPaperDimension(value: string): points`

Coverage must include:

- OOXML paper sizes currently mapped by the app: letter, legal, A4, A3.
- Custom paper width/height strings such as `210mm`, `8.5in`, and point-equivalent values.
- Null defaults from `DEFAULT_SHEET_PRINT_SETTINGS`.
- Six-margin conversion: top, bottom, left, right, header, footer.
- Orientation swapping exactly once.
- Scale percentage vs decimal scale.
- Fit-to-width/height and `pageSetupProperties.fitToPage`.
- Gridlines/headings.
- Horizontal/vertical centering.
- Page order: `overThenDown` and `downThenOver`.
- First page number, comments, errors, black-and-white, draft, and copies as preserved job metadata even if not every renderer uses them immediately.

Replace the partial conversions in `PrintPreview.tsx`, `SpreadsheetGrid.tsx`, and `use-pdf-export.ts` with these helpers.

### 3. Build one production workbook adapter for print/export

Create a shared spreadsheet adapter in the public app layer or a dedicated public package boundary, for example:

- `apps/spreadsheet/src/hooks/file-io/print-export-adapter.ts`, if it must use `Workbook`/`Worksheet` APIs.
- Or `file-io/print-export/src/adapters/workbook-contracts.ts`, only if it depends solely on public `@mog-sdk/contracts/api` types and not React/app internals.

This adapter should build both current interfaces during transition:

- `ITableDataProvider` for HTML/browser print.
- `PdfDataProvider` for PDF export.

But internally it should use one `ResolvedSheetExportData` cache:

- Sheet name and ID.
- Used range and print area.
- Row heights and column widths in both points and pixels where needed.
- Hidden row/column sets.
- Merged-region index.
- Cell batch cache keyed by numeric row/col.
- Resolved display strings and value types.
- Resolved `CellFormatInput`, rich text, hyperlinks, comments, checkbox state, and print-error display policy.
- Page setup, print titles, and manual breaks.
- Charts, drawings, images, conditional formatting, and sparklines when the corresponding public APIs exist.

Do not keep separate one-off providers in `use-print.ts`, `use-pdf-export.ts`, `PrintPreview.tsx`, and `ViewportTableDataProvider.ts` once this adapter exists. Those call sites should differ only by scope and renderer target.

### 4. Complete the PDF data-provider mapping

Upgrade `usePdfExport.ts`'s provider path from raw-cell string conversion to the production adapter.

Concrete data categories to map:

- Display value: use the grid/compute display string, not `String(value)`.
- Value type: distinguish string, number, boolean, error, date, and empty from canonical cell data.
- Number format: provide a format classification or preformatted string so `NumberFormatRenderer` can be used intentionally.
- Font properties: family, size, bold, italic, underline, strikethrough, color.
- Alignment: horizontal, vertical, wrap, shrink-to-fit, rotation, indent.
- Fills: solid, pattern, gradient.
- Borders: all sides and diagonals in the `BorderStyle` union.
- Rich text segments, including superscript/subscript where source data carries it.
- Hyperlinks and comments.
- Checkbox/form-control cells where source data exposes them.
- Merged regions.
- Hidden rows/columns from mirror-backed worksheet print/layout APIs.
- Print area from `ws.print.getArea()`.
- Print titles from `ws.print.getPrintTitleRows()` and `getPrintTitleColumns()` or mirror equivalents.
- Manual breaks from `ws.print.getPageBreaks()`.
- Per-sheet page setup from `ws.print.getSettings()`.
- Charts, drawings, images, CF results, and sparklines through public APIs; if an API is missing, add a typed warning and a small upstream task rather than silently returning empty arrays forever.

Add adapter-level tests that prove a workbook with formatting, merges, hidden rows/cols, page settings, print area, print titles, and manual breaks produces the exact `PdfDataProvider` and `ITableDataProvider` data expected by the renderers.

### 5. Fix PDF finalization and result ownership

Resolve the current artifact gap: `SpreadsheetPdfExporter.export()` returns `{ pageCount, warnings }`, while the app hook tries to download `blob`, `bytes`, or `dataUrl`.

The production path should become one of these explicit designs:

- Preferred: extend the backend bridge with a document lifecycle:
  - `beginDocument(metadata)`
  - `writeContentOps(pageIndex, ops)`
  - `finalizeFonts()`
  - `endDocument(): Promise<Uint8Array>`
- Or: wrap `PdfCanvas`/`TauriFontBridge` in a `PdfDocumentBackend` that owns page content, fonts, resources, metadata, and Rust serialization, returning bytes at finalization.

Required changes across adjacent folders:

- `file-io/pdf/graphics/src/ipc-bridge.ts`: add a typed finalize/export command for bytes, or move document lifecycle into a new bridge interface.
- `runtime/src-tauri` or the relevant Tauri command owner: implement the bridge commands using `file-io/pdf/core` document building and `serialize_document_to_bytes`.
- `file-io/print-export/src/pdf/create-exporter.ts`: create the production backend and expose a result that includes `bytes` or `blob`.
- `file-io/print-export/src/pdf/exporter.ts`: return a single `PdfExportResult` with artifact plus metadata.
- `apps/spreadsheet/src/hooks/file-io/use-pdf-export.ts`: remove speculative result casting and download only the explicit artifact.

Unify the two current `PdfExportResult` names. Use separate names if needed:

- `PdfRenderResult`: page count and warnings from the renderer.
- `PdfArtifactResult`: bytes/blob/data URL and metadata from the export boundary.

Do not leave two root-exported interfaces with the same name and different semantics.

### 6. Normalize color and unit contracts

Add explicit type aliases in `print-export` or shared contracts:

- `PdfRgb = readonly [number, number, number]` with values in `[0, 1]`.
- `CssColorString`.
- `Point`, `Pixel96`, and `Inch` branded or clearly named types where practical.

Then audit every renderer:

- `cell-renderer.ts`
- `cf-renderer.ts`
- `number-format-renderer.ts`
- `sparkline-renderer.ts`
- `chart-renderer.ts`
- `image-renderer.ts`
- `drawing-pdf-renderer.ts`
- `border-renderer.ts`
- `font-resolver.ts`
- `style-generator.ts`

Fix any path where comments, tests, or runtime values mix `[0..255]` and `[0..1]`. Conditional-format color scale must not assign `[0..255]` directly into `CellFormat.backgroundColor` if `CellRenderer` expects `[0..1]`.

Add guard tests for:

- CF data bars, color scales, and icon colors.
- Sparkline series/marker colors.
- Number-format color names.
- Border/fill/font colors.
- Hyperlink/comment indicator colors.
- Black-and-white print settings if implemented.

### 7. Centralize pagination plan generation and remove double layout passes

Add a `PaginationPlanner` or pure helper that accepts `SheetPrintJob` plus a content measurer and returns:

- `PageSetupInput`
- `PaginationPlan`
- `PageLayoutResult` compatibility shape for existing callers
- typed layout warnings
- total page count

Use it in:

- `PrintHandler.print()`
- `PrintHandler.generatePreview()`
- `PrintHandler.calculateLayoutWithEngine()`
- `SpreadsheetPdfExporter.export()`
- page-break preview calculations in `SpreadsheetGrid.tsx`
- canvas `PrintPreview.tsx`

`PrintHandler.print()` and `generatePreview()` currently calculate layout once to total pages and again while rendering. Replace that with a single planning pass whose result is reused for both total pages and per-page rendering.

The planner should also own conversion between `PaginationPlan` and legacy `PageLayoutResult`, so inclusive range semantics and page numbering are defined once.

### 8. Resolve floating-object coordinate ownership

The current PDF exporter applies margin/scale/content translations before rendering cells, while the floating-object `PositionResolver` returns page coordinates that already include margins/content offsets. Define exactly one coordinate space for floating object renderers:

- Either object renderers receive page-space coordinates and render outside the already-translated cell-grid context.
- Or object renderers receive content-space coordinates and run inside the same transformed context as cells.

Preferred contract:

- `PositionResolver` returns content-space position relative to the current page slice.
- The exporter applies the same page/margin/scale/content transform to cells and objects.
- Object renderers do not re-add margins.

Update:

- `position-resolver.ts`
- `SpreadsheetPdfExporter.buildPositionResolver()`
- `ChartPdfRenderer`
- `DrawingPdfRenderer`
- `ImagePdfRenderer`
- tests for objects on first page, split pages, centered pages, scaled pages, repeated rows/cols, and hidden rows/cols.

Also add printability and clipping rules:

- Objects anchored outside all page slices are skipped with a warning.
- Objects marked non-printable are skipped without layout side effects.
- Objects that cross page boundaries must either clip to the page or render on all intersecting pages according to the chosen Excel-compatible policy.

### 9. Wire existing renderer capabilities into the main exporter

Several modules are tested but not fully integrated in `SpreadsheetPdfExporter.renderSingleCell()`.

Add a typed `CellRenderPlan` that can include:

- Base `CellRenderData`.
- Base `CellFormat`.
- Number-format render metadata.
- Conditional-format result.
- Sparkline data.
- Inline image data.
- Comment indicator.
- Checkbox state.
- Error display policy.
- Hyperlink metadata.

Then update rendering so:

- `NumberFormatRenderer` is used when number-format metadata requires accounting/fraction/scientific/color behavior not covered by the plain cell renderer.
- Comment indicators call `CellRenderer.renderCommentIndicator()`.
- Checkbox cells call `CellRenderer.renderCheckbox()`.
- Inline images call `ImagePdfRenderer.renderInlineImage()`.
- CF `showValue: false` and icon-only/data-bar-only policies affect text rendering.
- Sparklines render after base cell content according to the existing overlay contract.

Keep one render order contract and update tests to assert ordering.

### 10. Implement header/footer, metadata, bookmarks, and page variants

The contracts already include document properties, bookmarks, first/odd/even headers and footers, header/footer images, and formatted text segments, but implementation is partial.

Add a shared header/footer renderer contract:

- Parsed Excel sections: left, center, right.
- Placeholder expansion: page, pages, date, time, file, sheet.
- Formatting codes: bold, italic, underline, strike, font family, font size, superscript/subscript, color where supported.
- First page and odd/even variants.
- Header/footer images by section.
- Header/footer margins and alignment with page margins.
- Scale-with-document behavior.

Use the shared renderer for:

- Browser print HTML.
- Canvas print preview if it stays separate.
- PDF export.

Add PDF metadata/bookmark support through the artifact backend:

- title, author, subject, keywords, creator, producer, creation date.
- sheet-level bookmarks and optional page/range bookmarks.

Tests should cover both HTML escaping and PDF drawing/metadata commands.

### 11. Build per-sheet render plans and indexes

Replace repeated per-cell work in `SpreadsheetPdfExporter` with a per-sheet render plan:

- `MergeIndex`: map each covered cell to its merge and each top-left cell to its bounds metadata.
- `HiddenIndex`: row/col hidden sets.
- `DimensionIndex`: row/col dimensions and cumulative offsets.
- `CellBatch`: page-relevant cell data fetched in batches.
- `ObjectIndex`: charts/drawings/images by anchor/page intersection.
- `CfSparklineIndex`: lookup maps keyed by numeric row/col.
- `PageSlicePlan`: page slice plus repeat ranges, visible rows/cols, x/y offsets, and object intersections.

Then update `renderRowRange()` and `calculateMergedBounds()` to use indexes instead of:

- `findMerge()` linear scan for every cell.
- `await isRowHidden()` and `await isColHidden()` inside nested loops.
- repeated `getCellData()` calls that could be batched for a page.

This is production-path performance work. Measure through app export/preview paths, not only isolated mocks.

### 12. Consolidate browser print HTML generation

Keep browser print support, but make it a renderer of the same planned pages rather than its own layout system.

Changes:

- `TableGenerator.generate()` should accept a page slice/render plan, including repeated rows/cols and visible rows/cols, instead of only a rectangular `PrintRange`.
- Table generation should handle hidden rows/cols and merged regions consistently with PDF.
- `StyleGenerator` should reuse normalized print options and header visibility contracts.
- `PageLayout` should consume the shared header/footer renderer.
- `PrintHandler.generatePrintDocument()` should not emit conflicting `@page` rules from both `StyleGenerator` and `PrintHandler.generatePrintCSS()`.

Add tests that compare page ranges and repeat headers between browser print and PDF planning for the same input.

### 13. Replace app-level duplicate adapters

After the job model and adapter exist, update app callers:

- `usePrint()` creates a job from active sheet/selection and calls `PrintHandler`.
- `usePdfExport()` creates a job from active sheet/selection/workbook scope and calls `createPdfExporter`.
- `PrintPreview.tsx` uses the shared planner and adapter data rather than a separate viewport approximation.
- `SpreadsheetGrid.tsx` page break preview uses the shared planner for automatic breaks.
- `ViewportTableDataProvider` is either retired, reduced to a thin compatibility wrapper around the shared adapter, or explicitly scoped to viewport-only temporary preview if full workbook data is unavailable.

The UI should stop maintaining separate logic for paper size, margins, fit-to-page, headers/footers, used range, and print area.

### 14. Make warnings actionable and visible

Define stable warnings for:

- Empty sheet or empty print area.
- Unsupported browser/Tauri/PDF backend.
- Missing PDF artifact finalization.
- Unsupported image format.
- Font fallback.
- Missing chart/drawing/image/CF/sparkline provider API.
- Object outside page or non-printable object skipped.
- Fit-to-page unreadable scale.
- Merge overflow.
- Header/footer feature unsupported in a target.
- Page range outside generated pages.

Expose warnings in:

- `PdfExportResult`.
- print result stats where useful.
- app status messages for failed/partial exports.

Do not present partial exports as fully successful when important workbook content is omitted without warning.

## Tests and verification gates

Required focused package gates during implementation:

- `cd /Users/guangyuyang/Code/mog-all/mog/file-io/print-export && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog/file-io/print-export && pnpm typecheck`
- `cd /Users/guangyuyang/Code/mog-all/mog/file-io/pdf/layout && pnpm test` for pagination contract changes.
- `cd /Users/guangyuyang/Code/mog-all/mog/file-io/pdf/layout && pnpm typecheck` for pagination contract changes.
- `cd /Users/guangyuyang/Code/mog-all/mog/file-io/pdf/graphics && pnpm test` for backend/bridge/render command changes.
- `cd /Users/guangyuyang/Code/mog-all/mog/file-io/pdf/graphics && pnpm typecheck` for backend/bridge/render command changes.
- Rust PDF core command when `file-io/pdf/core` changes: `cargo test -p pdf-core` and `cargo clippy -p pdf-core`.
- Spreadsheet app gates when hooks, adapters, or UI callers change: `cd /Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet && pnpm test` and `cd /Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet && pnpm typecheck`.
- `pnpm typecheck` from `/Users/guangyuyang/Code/mog-all/mog` for any exported TypeScript contract or cross-package import change.

Specific tests to add or strengthen:

- Contract tests for `PrintSettings -> PrintOptions/PageSetup/PageSetupInput`, including custom paper sizes, margins, page order, fit-to-page, print titles, print area, manual breaks, and null defaults.
- Adapter tests that build a real-ish workbook/worksheet mock and assert resolved cells, formats, dimensions, merges, hidden sets, page setup, print area, titles, and breaks.
- PDF artifact tests proving `export()` returns explicit bytes/blob or a typed unsupported-backend error; no speculative casting in app code.
- Golden command-buffer tests for rendered cells with formats, number formats, comments, checkboxes, inline images, CF data bars/icon-only/show-value, sparklines, merged cells, hidden rows/cols, and repeat titles.
- Floating-object position tests for margins, scale, centering, page splits, repeat rows/cols, and non-printable/skipped objects.
- Header/footer tests for first page, odd/even pages, formatted codes, image sections, placeholders, file/sheet/page counts, and HTML escaping.
- Browser print document tests proving no conflicting `@page` output, correct page count, correct repeated rows/cols, and hidden row/col handling.
- Progress/cancellation tests for active sheet, selected sheets, workbook scope, page range, empty sheets, and cancellation before/mid export.
- App hook tests for `usePdfExport` and `usePrint` that use production adapters and verify status messages, warnings, artifact download, and unsupported backend errors.
- Action/UI tests proving Backstage Export PDF triggers the production renderer, not only panel navigation.

Required browser verification for UI changes:

- Run the spreadsheet dev server and exercise the real UI path for Backstage > Export > Export as PDF.
- Exercise Print Preview from the UI with real print settings changes: paper size, orientation, scale, margins, fit-to-page, gridlines/headings, print area, print titles, and manual page breaks.
- Verify page break preview automatic break lines after changing page setup and dragging manual breaks.
- Use real mouse/keyboard input paths for E2E; do not mutate workbook state or call export internals directly to reach a test condition.
- In Tauri/desktop-capable verification, confirm the exported artifact starts with a PDF header, opens, has expected page count, and includes representative formatted cells/objects.

Performance verification:

- Use the spreadsheet app production export/preview path with a large sheet containing formatting, merges, hidden rows/cols, CF, sparklines, and objects.
- Record page count, cells rendered, time to first page, total export time, per-page render time, cell batch count, merge lookup count, provider calls, warnings, and artifact size.
- Compare before/after for the render-plan/index refactor. Do not claim performance wins from isolated mocks only.

## Risks, edge cases, and non-goals

Risks:

- Unifying result types and artifact finalization crosses package boundaries into `@mog/pdf-graphics`, Rust PDF core, and Tauri runtime commands. Sequence this behind a small backend contract spec before implementation.
- Moving app conversions into a shared adapter may expose mismatches between viewport data, workbook API data, and kernel mirror data. Prefer the canonical workbook/worksheet API for export; use viewport data only for explicitly viewport-scoped previews.
- Completing PDF provider mapping depends on public APIs for charts, drawings, images, conditional formatting, and sparklines. Missing APIs are blockers for those data categories, not reasons to keep silent empty stubs.
- Unit normalization can break existing tests that used `[0..255]` colors accidentally. Fix tests to match the production `RenderBackend` contract rather than preserving mixed units.
- Header/footer rendering differs between browser CSS paged media and PDF drawing. Shared parsing and layout metadata can be common even if final rendering is target-specific.
- Browser print support cannot guarantee identical pagination in every browser if native print engines apply their own table/paged-media rules. The plan should make planned page slices explicit and generate page containers to minimize browser discretion.
- PDF byte finalization needs lifecycle cleanup on cancellation and error paths; partial pages must not leak into the next export.

Edge cases to cover:

- Empty workbook, empty sheet, empty print area, and print area outside used range.
- Selection export with non-rectangular/multi-range selection if the UI supports it.
- Very large sheets with sparse cells.
- Hidden first/last rows or columns in a print area.
- Manual page breaks inside merged cells.
- Repeat rows/cols larger than printable area.
- Fit-to-page scale below readable threshold.
- Landscape custom paper with custom margins and header/footer margins.
- First page number override and selected page range.
- Different first page and odd/even headers/footers.
- Header/footer text with Excel codes, literal ampersands, long text, unsupported image references, and HTML-sensitive characters.
- Rich text with mixed font families, superscript/subscript, wrapping, shrink-to-fit, rotation, and CJK/non-Latin text.
- Cell errors with print-errors policy: displayed, blank, dash, and `#N/A`.
- Comments printed as displayed, at end, or omitted.
- Hyperlinks and comment indicators.
- Conditional formatting icon-only and data-bar show-value false.
- Inline images vs floating images.
- Charts/drawings/images crossing page boundaries or anchored in repeated rows/cols.
- Non-printable objects.
- Tauri runtime unavailable in browser.
- Export cancellation before render, during render, and during finalization.

Non-goals:

- Do not add a second PDF renderer or HTML-to-PDF fallback.
- Do not optimize a benchmark-only path.
- Do not keep compatibility shims for wrong result contracts or wrong unit/color semantics.
- Do not make the print-export package depend on spreadsheet app internals.
- Do not bypass the unified workbook/kernel data path with direct state mutation in E2E tests.
- Do not redesign print UI chrome as part of this plan; UI changes should be limited to consuming the corrected contracts and surfacing warnings/results.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the canonical job/result contracts are written down.

- Agent A: define `PrintExportJob`, `SheetPrintJob`, `ResolvedPageSetup`, warning types, result type split, and conversion helpers for `PrintSettings`.
- Agent B: build the shared workbook/worksheet adapter and replace the separate `usePrint`, `usePdfExport`, `PrintPreview`, and page-break-preview provider logic.
- Agent C: implement PDF artifact finalization across `@mog/pdf-graphics`, Tauri commands, and `file-io/pdf/core`, then update `createPdfExporter()` and app download handling.
- Agent D: normalize color/unit contracts across PDF renderers and update affected tests.
- Agent E: centralize pagination planning and remove double layout passes in `PrintHandler`, PDF exporter, Print Preview, and page break preview.
- Agent F: resolve floating-object coordinate space and object printability/clipping rules.
- Agent G: wire `CellRenderPlan` features into `SpreadsheetPdfExporter`: number formats, comments, checkboxes, inline images, CF policies, and sparklines.
- Agent H: implement shared header/footer parsing/render metadata and PDF/browser target renderers for first/odd/even pages, images, and formatted codes.
- Agent I: build per-sheet/page render plans and indexes for merges, hidden rows/cols, dimensions, cells, objects, CF, and sparklines.
- Agent J: own app-level UI/E2E verification through Backstage export, Print Preview, and page break preview using real browser input paths.

Dependencies:

- Contract work should land first so all implementation agents target the same job, unit, warning, and result shapes.
- PDF finalization depends on `file-io/pdf/graphics`, runtime Tauri command ownership, and `file-io/pdf/core` serialization APIs.
- Provider completeness depends on public workbook/worksheet APIs for formatted display values, resolved styles, charts, drawings, images, conditional formatting, and sparklines.
- Pagination planning depends on `@mog/pdf-layout`; any layout engine changes must be coordinated with its tests before print-export callers change.
- Floating-object coordinate fixes should land before object provider wiring, otherwise newly wired objects may be positioned against the wrong coordinate contract.
- Browser/UI verification should run after adapter consolidation and artifact finalization so it exercises the real production path end to end.
