# 057 — Improve `mog/file-io/print-export/src` (print, PDF, and exported layout pipeline)

## Source folder and scope

- **Folder:** `mog/file-io/print-export/src` (package `ln`, formerly `@mog/print-export`).
- **Size:** ~6,605 lines of `.ts` across `src` (excluding `dist`/`node_modules`). Top files: `pdf/cell-renderer.ts` (923), `pdf/exporter.ts` (812), `print/print-handler.ts` (709), `pdf/cf-renderer.ts` (535), `pdf/sparkline-renderer.ts` (471), `html/page-layout.ts` (442), `contracts/types.ts` (441), `html/style-generator.ts` (434), `html/table-generator.ts` (422), `pdf/number-format-renderer.ts` (395).
- **In scope (edit targets):**
  - **PDF orchestration & rendering (`pdf/`):** `exporter.ts` (`SpreadsheetPdfExporter`, the orchestrator), `create-exporter.ts` (factory wiring `PdfCanvas` + `TauriFontBridge`), `cell-renderer.ts`, `cf-renderer.ts`, `sparkline-renderer.ts`, `border-renderer.ts`, `number-format-renderer.ts`, `font-resolver.ts`, `position-resolver.ts`, `render-shared.ts`, `chart-renderer.ts`, `drawing-pdf-renderer.ts`, `image-renderer.ts`.
  - **Browser-print/HTML path (`html/`, `print/`):** `print/print-handler.ts` (`PrintHandler` — iframe print + preview), `html/table-generator.ts`, `html/style-generator.ts`, `html/page-layout.ts`.
  - **Contracts (`contracts/`):** `types.ts` (the public option/result types) and the barrel `index.ts`.
- **Out of scope (named for coupling, not edited here):**
  - **`@mog/pdf-layout`** — `PaginationEngine`, `ContentMeasurer`, `PageSetupInput`, `PageSlice`, `PaginationPlan`. Re-exported from this folder's `index.ts:48-56`; treated as a fixed upstream contract. Page-break math lives there, not here.
  - **`@mog/pdf-graphics`** — `RenderBackend`, `PdfCanvas`, `TauriFontBridge`, gradient/pattern helpers, text-run measurement/drawing. The backend boundary is a contract to preserve; this folder only emits backend commands.
  - **App integration (`mog/apps/spreadsheet/src/hooks/file-io/use-pdf-export.ts`, `use-print.ts`, `dialogs/print/PrintPdfDialog.tsx`, `chrome/toolbar/backstage/PrintPreview.tsx`, `ExportPanel.tsx`, `components/grid/providers/ViewportTableDataProvider.ts`)** — these implement `PdfDataProvider` / `ITableDataProvider` and own data access. Changes that require new provider methods are flagged below as cross-folder dependencies, but the app files themselves are not edited under this plan.
  - `@mog-sdk/contracts/*` (`HeaderVisibility`, `CellData`, `CellValue`), `@mog/spreadsheet-utils/*`.

## Current role of this folder in Mog

This folder is the **single owner of "make this workbook printable/exportable"** for the desktop spreadsheet. It has two parallel output paths that are *supposed* to agree:

1. **PDF export path (`pdf/`).** `SpreadsheetPdfExporter` (`pdf/exporter.ts:274`) is a thin orchestrator. For each sheet it: resolves a `PageSetupInput`, builds a `ContentMeasurer` from the `PdfDataProvider`, runs `PaginationEngine.calculateLayout()` to get a `PaginationPlan`, then for each `PageSlice` issues `backend.beginPage()` → margin translate → scale → render repeat rows/cols → render the cell grid (delegating each cell to `CellRenderer`, with CF overlays via `CFRenderer` and sparklines via `SparklineRenderer`) → render floating objects (charts/drawings/images positioned by `DefaultPositionResolver`) → `backend.endPage()`. `create-exporter.ts` wires the production Rust-backed `PdfCanvas`/`TauriFontBridge`.

2. **Browser-print / HTML path (`print/`, `html/`).** `PrintHandler.print()` (`print/print-handler.ts:127`) uses the **same** `PaginationEngine` (so page breaks match PDF), then builds an HTML `<table>` per page via `TableGenerator`, wraps it with header/footer HTML via `PageLayout`, assembles a full document with `StyleGenerator` CSS, and prints through a hidden iframe (`printViaIframe`, `:543`). `generatePreview()` (`:610`) produces the same document for on-screen preview.

`contracts/types.ts` is the public option surface shared by both paths and by the app dialogs: `PrintOptions`, `PageSetup`, `PageMargins`, `PaperSize`, `PrintArea`, header/footer placeholder + format-code tables, and result types. `cell-renderer.ts` is the hot path — *every cell of every exported PDF* flows through `renderCell()`.

The defining property of this folder is that **the PDF path and the print path must be visually equivalent** (same pagination, same headers/footers, same cell fidelity). Today they have diverged, and the PDF path is missing whole feature categories that the contracts already promise.

## Evidence (observed in the current tree)

- **PDF export draws no headers, footers, or page numbers at all.** `exporter.ts` reserves a header/footer band in margins (`DEFAULT_MARGINS.header = 18`, `.footer = 18`, `:249-250`) but the render loop (`:377-469`) only renders repeat rows/cols, the cell grid, and floating objects — there is no call that draws header/footer text or substitutes placeholders. A repo grep for header/footer/placeholder drawing in `pdf/` returns only the *repeat-column* helper `renderColHeaders` and the margin constants. So an exported PDF has blank top/bottom bands where `Page 1 of N` / the sheet name belong. The browser-print path *does* render them (`page-layout.ts:239-296`). This is the single largest fidelity gap and a direct print-vs-PDF divergence.

- **Placeholders are never substituted in PDF.** `DEFAULT_PAGE_SETUP` in `contracts/types.ts:292-299` declares `header.center = '&[Sheet]'` and `footer.center = 'Page &[Page] of &[Pages]'`, and `HEADER_FOOTER_PLACEHOLDERS` (`:406-413`) enumerates `&[Page] &[Pages] &[Date] &[Time] &[File] &[Sheet]`. Only `PageLayout.substitutePlaceholders` (`page-layout.ts:65-107`, HTML path) consumes them. The PDF path has no equivalent.

- **PDF export ignores `showGridlines` and `showHeaders`.** `PrintOptions.showGridlines`/`showHeaders` (`contracts/types.ts:84-87`) are honored by the HTML path (`table-generator.ts` `headerVisibility`, `style-generator.ts`) but `pdf/exporter.ts` never reads them — no gridline pass, no row/column header band (`1,2,3…` / `A,B,C…`). PDF output therefore cannot show gridlines or sheet headers even when the user asks for them.

- **A whole tier of declared contracts is dead code.** `differentFirstPage` / `firstPageHeader` / `firstPageFooter` (Stream F1), `differentOddEven` / `evenPageHeader` / `evenPageFooter` (F2), `FormattedTextSegment` + `HEADER_FOOTER_FORMAT_CODES` (E4 in-header font formatting), `PdfDocumentProperties` (E1 metadata), and `PdfBookmark` (E2 outline) are all defined in `contracts/types.ts` (`:144-287`) and **referenced nowhere else in the repo** (grep: only their own definitions plus a date-tagged plan log). They are aspirational types with no producer or consumer — either unfinished features or contract rot.

- **The HTML print path silently ignores merged cells.** `ITableDataProvider.getMergedRegions?()` is declared (`table-generator.ts:50`) but never called: a grep for `merge|colspan|rowspan|span` across `html/` matches only that one declaration. So `TableGenerator` emits one `<td>` per cell with no `colspan`/`rowspan`, breaking the layout of any merged region in browser print and preview — whereas the PDF path *does* honor merges (`exporter.ts:594-631`, `calculateMergedBounds` `:780-811`). This is a correctness divergence between the two paths and against the on-screen grid.

- **Floating-object positioning double-counts hidden rows/columns.** `DefaultPositionResolver` builds cumulative row-height/col-width sums over the raw arrays with no hidden-state awareness (`position-resolver.ts:140-152`), and the exporter populates those arrays for every index in the used range including hidden ones (`exporter.ts:541-546`). But the cell grid render *skips* hidden rows/cols (`exporter.ts:583,589`). When a chart/drawing/image is anchored after a hidden row or column on the same page, its computed offset includes the hidden extent the grid omitted, so the object drifts down/right of its true cell anchor.

- **Floating objects are dropped, not clipped, at page boundaries.** `resolvePosition` (`position-resolver.ts:154-184`) only returns a position when the object's **top-left anchor** falls inside a page slice. An object whose anchor sits on page *N* but whose body extends onto page *N+1* is rendered once (uncut) and overflows; an object whose body is visible on a page but whose anchor was paginated onto an earlier/other page returns `null` and vanishes. There is no split/clip handling and no warning emitted.

- **The cell grid issues O(rows×cols) async hidden-state probes despite a pre-built cache.** `buildContentMeasurer` (`exporter.ts:499-523`) already pre-caches `hiddenRows`/`hiddenCols` as `Set<number>` for the used range. But `renderRowRange` re-`await`s `this.dataProvider.isRowHidden`/`isColHidden` *per cell* (`exporter.ts:583,589`), and `calculateMergedBounds` again (`:795,805`) — five separate `await … isRowHidden/isColHidden` sites (grep-confirmed). On a large sheet this is thousands of redundant async round-trips through the provider/IPC bridge during the render pass.

- **`NumberFormatRenderer` is unreferenced within the package.** `pdf/number-format-renderer.ts` (395 lines) plus `FORMAT_COLORS`/`resolveFormatColor` are exercised only by their own unit test; they are not imported by `exporter.ts` (which renders the provider-supplied, pre-formatted `displayValue`, see `CellDataInput.displayValue` doc at `exporter.ts:135`) and are **not re-exported from `index.ts`**. Either the package is meant to own number formatting (negative-red, format-driven font color, etc.) and the wiring was never finished, or this is dead weight.

- **Pagination is computed twice per area in both print and preview.** `PrintHandler.print()` calls `calculateLayoutWithEngine` once to sum `totalPages` (`:146-155`) and again to emit content (`:160-208`); `generatePreview()` repeats the same double pass (`:622-678`). `PaginationEngine.calculateLayout` plus the per-area `ContentMeasurer` build run twice for identical inputs.

- **Three drifting copies of the defaults.** `DEFAULT_PRINT_OPTIONS` / `DEFAULT_PAGE_SETUP` live in `contracts/types.ts:103-119, 292-299`; `print-handler.ts` redeclares its own `DEFAULT_OPTIONS` / `DEFAULT_SETUP` (`:73-101`); `exporter.ts` redeclares `DEFAULT_MARGINS` / `DEFAULT_PAGE_SETUP` in point space (`:244-260`). The values can (and the margins do) differ between paths, so "the default print" is not well-defined.

- **`PageLayout.formatDate` uses non-global, order-sensitive replaces.** `page-layout.ts:350-366`: `String.prototype.replace` with a string pattern replaces only the **first** occurrence, so a format like `DD/MM/DD` mis-substitutes; and `'YYYY'`→`'YY'`→`'M'`→`'D'` ordering can clobber already-substituted output. Also `formatDate`/`formatTime` read `new Date()` directly, making header/footer output non-deterministic and untestable without clock injection.

- **Redundant header/footer styling strategies.** `page-layout.ts:212-231` emits both CSS Paged-Media `position: running(header)` / `@page { @top-center { content: element(header) } }` *and* inline `.page-header` divs per page (`:251-256`). Browsers that don't support `running()`/`element()` (most) use the inline divs; the running-element CSS is dead in those engines and risks double-rendering where supported.

## Improvement objectives

1. **Close the PDF header/footer/page-number gap** so PDF export renders headers, footers, and page-number placeholders with the same content and positioning as browser print.
2. **Unify header/footer logic** into one path-agnostic engine (placeholder substitution + section layout) shared by `pdf/` and `html/`, eliminating the divergence by construction.
3. **Honor `showGridlines` and `showHeaders` (row/column headers) in PDF export**, matching the HTML path.
4. **Make merged cells render correctly in the HTML/print path** (colspan/rowspan), matching the PDF path and the grid.
5. **Decide and act on the dead contract tier** (F1/F2 different-first/odd-even, E4 format codes, E1 metadata, E2 bookmarks): implement the ones the product needs (document properties + page-number footers are clearly needed); for the rest, either implement or remove from the public surface so the contract stops lying.
6. **Fix floating-object positioning** to be hidden-row/col aware and to clip/split (or at minimum warn) at page boundaries.
7. **Remove the per-cell async hidden probes** by threading the already-built hidden sets through the render pass.
8. **Resolve `NumberFormatRenderer`**: either wire it into the export pipeline (format-driven colors) and re-export it, or delete it.
9. **De-duplicate defaults and pagination work** across the two paths.

## Production-path contracts and invariants to preserve or strengthen

- **Print/PDF parity (strengthen).** Page breaks already come from one `PaginationEngine` for both paths (`print-handler.ts:121`, `exporter.ts:281`). Extend that parity to headers/footers, gridlines, row/col headers, and merged-cell layout. Any new feature must be implemented once and consumed by both paths.
- **Backend boundary (preserve).** `pdf/` may only talk to the `RenderBackend` interface from `@mog/pdf-graphics`; no direct PDF/byte emission, no DOM. New header/footer drawing must go through `backend.drawText`/`drawTextRuns`/`measureText`.
- **Provider as the only data source (preserve).** The exporter and table generator must not reach into any concrete model — all sheet data flows through `PdfDataProvider` / `ITableDataProvider`. New needs (e.g. gridline color, row/col header labels, merged regions for HTML) are added as provider methods (optional, with safe fallbacks), not back-doors.
- **`PaginationEngine` is authoritative for page geometry (preserve).** This folder consumes `PaginationPlan`/`PageSlice` and must not re-derive page breaks. Header/footer bands occupy the `margins.header`/`margins.footer` reserve the engine already accounts for; the body content offset is unchanged.
- **Pure data in `render-shared.ts` (preserve).** `CellBounds`/`BorderStyle` stay logic-free and backend-free to keep the no-import-cycle property (`render-shared.ts:1-10`).
- **Public barrel stability (preserve, then extend deliberately).** `index.ts` is the package's API. Removing dead types (F1/F2 etc.) is a breaking surface change — coordinate with app consumers (only `ln`/`@mog/print-export` importers in `mog/apps/spreadsheet`); adding a header/footer renderer export is additive.
- **Determinism (strengthen).** Header/footer date/time must be injectable (a clock/`now` parameter or context field) so export output is reproducible and testable; today `page-layout.ts` reads `new Date()` directly.
- **Coordinate-space discipline (preserve).** PDF path is in points (72/in); HTML path is in pixels (96 DPI) — see `print-handler.ts:254` and `inchesToPixels` (`contracts/types.ts:432`). Shared header/footer logic must be unit-agnostic (operate on a passed-in band rect), not bake in a DPI.

## Concrete implementation plan

### Phase 1 — Shared header/footer engine (objectives 1, 2, 5-partial)

1. Extract placeholder substitution + section (left/center/right) resolution + Excel format-code parsing out of `PageLayout` into a unit-agnostic module, e.g. `src/shared/header-footer.ts`:
   - `resolvePlaceholders(text, context)` — port from `page-layout.ts:65-107`, but make replacement **global** and single-pass (one regex alternation over all `&[…]` tokens, replaced via a callback) and accept an injected `now: Date` in `context`.
   - `parseFormatCodes(text): FormattedTextSegment[]` — finally consume `HEADER_FOOTER_FORMAT_CODES`/`FormattedTextSegment` (`contracts/types.ts:247-287`), turning `&B`/`&I`/`&U`/`&S`/`&"font"`/`&nn`/color codes into segments.
   - `selectSection(pageSetup, pageNumber)` — implement F1/F2 selection: first page → `firstPageHeader/Footer` when `differentFirstPage`; even pages → `evenPageHeader/Footer` when `differentOddEven`; else `header/footer`.
2. Refactor `PageLayout` (`html/page-layout.ts`) to delegate to the shared module for substitution/selection, rendering `FormattedTextSegment[]` to inline-styled spans. Keep `wrapPageContent` HTML structure. Remove the dead Paged-Media `running()` CSS (`:212-231`) or gate it behind a capability flag; keep the inline-div strategy that actually renders.
3. Fix `formatDate` (`:350-366`): drive off the injected `now`, use global token replacement with a documented token set.

### Phase 2 — PDF header/footer + gridlines + row/col headers (objectives 1, 3)

4. Add a `HeaderFooterPdfRenderer` (new `pdf/header-footer-renderer.ts`) that, given the page rect, the resolved `FormattedTextSegment[]` for left/center/right, and a `FontResolver`, draws into the top (`margins.header`) and bottom (`margins.footer`) bands using `backend.drawTextRuns`. Reuse `CellRenderer`'s rich-run → `TextRun` mapping (factor that mapping out of `cell-renderer.ts:452-474` into a shared helper to avoid a third copy).
5. In `exporter.ts` `export()` loop (`:377-469`), after `beginPage` and before/after the body translate as appropriate, call the new renderer with the page's `PlaceholderContext` (sheet name from provider, `pageNumber`, the already-computed `totalPages` at `:354-357`, file name, injected `now`). Resolve the section via the shared F1/F2 selector.
6. Add a **gridline pass**: when `PageSetupInput`/options request gridlines, stroke light horizontal/vertical lines along the visible row/col boundaries of the body range (reuse the row-height/col-width walk already in `renderRowRange`). Gridline color comes from a new optional `PdfDataProvider.getGridlineColor?()` with an Excel-default fallback.
7. Add an optional **row/column header band** (`A,B,C` / `1,2,3`) when `showHeaders` is set, mirroring `headerVisibility` semantics from the HTML path; labels via a small column-letter helper (and a new optional provider hook only if custom labels are needed — default is computed).
8. Thread `PrintOptions.showGridlines`/`showHeaders` into `PageSetupInput` (extend the `pdf-layout` input mapping in `create-exporter.ts`/the app provider; if `PageSetupInput` cannot carry them, pass via `PdfExportOptions` instead — keep the change inside this folder's option types).

### Phase 3 — PDF document properties + bookmarks (objective 5)

9. Consume `PdfDocumentProperties` (`contracts/types.ts:197-218`): pass through `PdfExportOptions` and emit via a `RenderBackend.setDocumentProperties?()` hook (add to the `@mog/pdf-graphics` contract — **cross-folder dependency**, flagged). If the backend cannot yet accept metadata, implement the plumbing in this folder and leave a single well-named `not-yet-wired` seam rather than a silent no-op.
10. Consume `PdfBookmark` (`:228-237`): accept an outline tree in `PdfExportOptions`, validate page numbers against the produced `pageCount`, and forward to a backend outline hook. Same cross-folder caveat as (9).
11. For any of F1/F2/E1/E2/E4 the product does **not** want now: remove the type from `contracts/types.ts` and `index.ts` so the public surface stops advertising unimplemented capability. (Pick implement-vs-remove per the objectives decision in Phase 0 review; default recommendation: implement page-number/sheet/date placeholders + doc properties; implement F1/F2 since they're cheap once the section selector exists; remove E2 bookmarks only if no backend support is planned.)

### Phase 4 — HTML merged-cell fidelity (objective 4)

12. In `TableGenerator.generate` (`html/table-generator.ts`), fetch `getMergedRegions(sheetId)`, intersect with the page range, and emit `colspan`/`rowspan` on the top-left cell of each merge while skipping covered cells (mirror the PDF logic at `exporter.ts:594-631`). Clip spans to the page slice so a merge that crosses a page break renders correctly on each page.

### Phase 5 — Floating-object correctness (objective 6)

13. Make `DefaultPositionResolver` hidden-aware: pass it the hidden row/col sets (already available from `buildContentMeasurer`) and exclude hidden extents from the cumulative sums in `position-resolver.ts:140-152`, so anchors align with the grid that skipped them.
14. Handle off-page/overflow anchors: when an object's anchor is outside all slices but its bounding box intersects a slice, resolve against that slice with a negative offset and clip to the page; emit a `layout_warning` (`PdfWarning`, `exporter.ts:211-217`) when an object is clipped or dropped instead of silently vanishing.

### Phase 6 — Perf and de-duplication (objectives 7, 9)

15. Replace per-cell `await isRowHidden/isColHidden` (`exporter.ts:583,589,674,795,805`) with lookups into the pre-built `hiddenRows`/`hiddenCols` sets; thread the sets (or a small sync `VisibilityIndex`) into `renderRowRange`/`renderColHeaders`/`calculateMergedBounds`. The render pass becomes synchronous w.r.t. visibility.
16. Cache the `PaginationPlan` per area in `PrintHandler` so `print()`/`generatePreview()` paginate **once** (compute all plans, sum `totalPages`, then emit) instead of twice (`print-handler.ts:146-208, 622-678`).
17. Collapse the defaults: have `print-handler.ts` and `exporter.ts` derive from the single `DEFAULT_PRINT_OPTIONS`/`DEFAULT_PAGE_SETUP` in `contracts/types.ts` (with one documented inches→points conversion), deleting the local copies (`print-handler.ts:73-101`, `exporter.ts:244-260`).

### Phase 7 — Number-format renderer decision (objective 8)

18. Decide with the export owner: (a) **wire it** — feed raw value + number-format string through `NumberFormatRenderer` to derive format-driven font color (negative-red) and re-export from `index.ts`, with the provider supplying the format string alongside `displayValue`; or (b) **remove** `pdf/number-format-renderer.ts` and its test. Do not leave it half-connected. Recommendation: (a) if the provider already knows the format (it formats `displayValue` upstream), since format-driven color is a real fidelity feature the current pre-formatted-string contract cannot express.

## Tests and verification gates

> Per constraints, this plan does not run builds/tests. The following are the gates a subsequent implementation must satisfy; existing suites live in `mog/file-io/print-export/__tests__/` and `src/**/__tests__/`.

- **Unit — shared header/footer.** New `header-footer.test.ts`: placeholder substitution with multiple repeats (`DD/MM/DD`), all `&[…]` tokens, injected `now`; F1/F2 section selection for page 1 / odd / even / `differentFirstPage` off; format-code parsing for each `HEADER_FOOTER_FORMAT_CODES` entry → expected `FormattedTextSegment[]`.
- **Unit — PDF header/footer renderer.** Assert `backend.drawTextRuns` is invoked for non-empty sections at expected band coordinates; no draws for empty sections; page-number placeholder resolves against `totalPages`.
- **Unit — gridlines & row/col headers.** With `showGridlines`/`showHeaders` on, assert stroke/label commands count matches visible row/col boundaries; with them off, none.
- **Unit — merged cells (HTML).** Extend `table-generator.test.ts`: a 2×2 merge yields one `<td colspan=2 rowspan=2>` and three skipped cells; a merge spanning a page break clips per page.
- **Unit — position resolver.** Extend `position-resolver.test.ts`: anchor after a hidden row/col lands at the grid-aligned offset; object overflowing a page boundary is clipped + warns; off-page anchor with on-page body resolves rather than returning `null`.
- **Unit — exporter visibility.** Add a `PdfDataProvider` spy asserting `isRowHidden`/`isColHidden` are called O(rows+cols), not O(rows×cols), and not awaited inside the inner cell loop.
- **Unit — defaults.** Assert `print-handler` and `exporter` defaults are derived from `DEFAULT_PRINT_OPTIONS`/`DEFAULT_PAGE_SETUP` (same paper/margins after unit conversion).
- **Regression — print/PDF parity.** A fixture workbook (multi-sheet, merges, hidden rows, a header/footer with placeholders) drives both `PrintHandler.generatePreview` and `SpreadsheetPdfExporter.export`; assert identical `pageCount` and matching header/footer text per page.
- **Contract — barrel.** A test that imports every symbol from `index.ts` (and one asserting removed F1/F2/E2 types are gone if Phase 3 removes them) to catch surface drift.
- **Gates:** package `tsc` build, the existing `jest` suites under `__tests__/` and `src/**/__tests__/`, repo lint (including the "no Excel in source" rule — see Risks), and the app-level print/PDF eval scenarios if present. No `dist/` artifacts are committed.

## Risks, edge cases, and non-goals

- **Backend capability for metadata/bookmarks (cross-folder).** Phases 3's doc-properties and bookmark hooks require `@mog/pdf-graphics` `RenderBackend` additions. If the Rust-backed `PdfCanvas` can't yet accept them, ship the plumbing with one clearly-named unimplemented seam rather than a silent drop, and split this phase out so the header/footer work (Phase 1-2, highest value) lands independently.
- **Public API break.** Removing dead contract types is breaking for `ln`/`@mog/print-export` importers. Grep shows the only importer is `mog/apps/spreadsheet`; coordinate the removal there. Adding the header/footer renderer + gridline/showHeaders options is additive.
- **"No Excel in source" memory.** This folder's comments reference Excel heavily (`cell-renderer.ts:10`, `position-resolver.ts:18`, `page-layout.ts:401`, etc.). Per the project's `no-excel-in-code` convention, any comments authored or moved during this work must avoid naming "Excel" — describe the behavior (e.g. "spreadsheet-standard header codes") instead. Do not mass-rewrite untouched comments under this plan.
- **Coordinate space.** PDF (points) vs HTML (96 DPI px). The shared header/footer module must take a band rect and font sizes in the caller's units; it must not assume a DPI.
- **Page-break merges & repeat rows.** Merged-cell colspan/rowspan clipping interacts with `repeatRows`/`repeatCols` and with the engine's `MergedRegion` handling — verify a merge inside a repeat band renders on every page without double counting.
- **Determinism / locale.** `formatDate`/`formatTime` currently use locale + live clock. Injecting `now` fixes reproducibility but locale-dependent default formatting remains; keep behavior unless the product specifies a fixed format.
- **Non-goals:** changing `PaginationEngine` page-break math (`@mog/pdf-layout`); changing the `RenderBackend`/Rust PDF byte emission beyond adding metadata/outline hooks; building chart/drawing/image *data* sources (the app stubs them today — `use-pdf-export.ts:208-225`); reworking the `PdfDataProvider`/`ITableDataProvider` split into one interface (worth doing later but out of scope here); any test-only or shim "fix" that papers over the header/footer gap instead of rendering them.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable within this folder:**
  - Phase 4 (HTML merged cells) — touches only `html/table-generator.ts`.
  - Phase 5 (position resolver) — touches only `pdf/position-resolver.ts` + its exporter wiring.
  - Phase 6 step 15-16 (perf, pagination cache) — `pdf/exporter.ts` and `print/print-handler.ts` respectively.
  - Phase 7 (number-format decision) — isolated to `pdf/number-format-renderer.ts` + `index.ts`.
- **Sequential chain:** Phase 1 (shared header/footer module) must land before Phase 2 (PDF header/footer renderer) and the `PageLayout` refactor; Phase 2 before the parity regression test.
- **Cross-folder dependencies (coordinate, do not edit under this plan):**
  - `@mog/pdf-graphics` (`RenderBackend`): new `setDocumentProperties?()` / outline hook for Phase 3; reuse of `drawTextRuns`/`measureText` for Phase 2 (already present).
  - `@mog/pdf-layout` (`PageSetupInput`): may need to carry `showGridlines`/`showHeaders` for Phase 2 step 8 — otherwise carry them in this folder's `PdfExportOptions`.
  - `mog/apps/spreadsheet` provider implementations (`use-pdf-export.ts`, `ViewportTableDataProvider.ts`): must supply `getPageSetup()` with real header/footer content (today returns `undefined`, `use-pdf-export.ts:229`), `getMergedRegions()` for the HTML path, and any new optional hooks (gridline color, format strings). These are the consumers that turn the new capabilities on; without them the renderers fall back to safe defaults but the feature stays invisible.
- **Recommended landing order:** Phase 1 → Phase 2 (header/footer + gridlines: the headline win) → Phase 4/5/6 in parallel → Phase 3 (gated on backend hooks) → Phase 7 (owner decision).
