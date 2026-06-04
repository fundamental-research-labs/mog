Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for a real production path. It correctly treats print/PDF parity as the core product contract, identifies category-level failures rather than one-off defects, and sequences the highest-value work first. Most of the plan's evidence checks out in the current tree: PDF does not draw header/footer content, PDF ignores print UI options, HTML declares merged regions without rendering spans, visibility is cached for pagination but re-queried during rendering, and defaults are duplicated.

The rating is held below 9 because the central header/footer proposal has a contract gap: the PDF exporter currently consumes `PageSetupInput`, which is layout geometry, while header/footer text and first/odd-even semantics live in `PageSetup`. The plan also assumes `margins.header`/`margins.footer` are the layout reserve the engine uses, but `PaginationEngine` subtracts `headerHeight`/`footerHeight` instead. Those are fixable, but they need to be explicit before implementation.

Major strengths

- The plan is evidence-heavy and production-path focused. It reviews the actual PDF orchestrator, HTML print path, contracts, app integration, and performance path rather than proposing isolated renderer tweaks.
- The architecture direction is sound: shared header/footer resolution, provider-only data access, backend-command rendering, no direct PDF byte emission from this folder, and no reimplementation of pagination.
- It handles whole defect categories: header/footer parity, gridline/header visibility, merged-cell parity, floating-object placement, hidden-row/column performance, dead public contracts, and default drift.
- The phases are mostly well ordered. Shared header/footer logic before PDF rendering is the right dependency chain, while HTML merges, position resolution, render-pass visibility caching, and pagination caching can be parallelized.
- The test list is broad and mostly aligned with the risks: shared header/footer units, renderer command assertions, merged-cell clipping, visibility call-count regression, defaults, and print/PDF parity.

Major gaps or risks

- PDF header/footer data source is underspecified. `PdfDataProvider.getPageSetup()` and `PdfExportOptions.defaultPageSetup` return `PageSetupInput`, which has no `header`, `footer`, `differentFirstPage`, `differentOddEven`, `dateFormat`, or title fields. The plan needs an explicit API such as `getPrintPageSetup?(): PageSetup`, `PdfExportOptions.pageSetup?: PageSetup`, or a combined contract that keeps layout geometry separate from display header/footer semantics.
- Header/footer layout reservation is not correct as written. `file-io/pdf/layout/src/pagination-engine.ts` subtracts `setup.headerHeight` and `setup.footerHeight`; it does not consume `margins.header` or `margins.footer`. The plan should specify whether headers/footers render inside top/bottom margins without changing pagination, or whether both PDF and HTML must pass nonzero reserved heights into the pagination engine.
- `showGridlines` and `showHeaders` are print options, not provider data. Current app PDF export accepts `defaultPrintOptions` but does not pass them to `SpreadsheetPdfExporter`. The plan gestures at threading them through, but it should define the actual `PdfExportOptions` contract and app adapter changes.
- Row/column headers affect geometry, not just drawing. Adding an `A/B/C` band and `1/2/3` gutter changes available body width/height and page breaks. The plan should say how those dimensions are represented in `PageSetupInput` or the measurer so PDF and HTML paginate the same content.
- The cross-folder metadata/bookmark phase is too large for an in-folder implementation plan. It needs separate acceptance criteria for `@mog/pdf-graphics`, `PdfCanvas`, IPC/Rust PDF core, and package tests, or it should be deferred cleanly behind a non-silent unsupported status.
- HTML merged-cell support will not be visible in all production paths unless app providers are also updated. `usePrint`'s provider and `ViewportTableDataProvider` do not currently supply merged regions or hidden row/column state, so a source-folder-only table generator change would pass unit tests while missing real preview behavior.
- The header/footer format-code scope is not fully specified. The plan should define support for section markers, escaped ampersands, font names, font sizes, color grammar, unsupported image fields, and whether existing `leftImage`/`centerImage`/`rightImage` are implemented or explicitly out of scope.

Contract and verification assessment

The plan has good invariants, but the contracts need a more precise table before implementation. At minimum it should distinguish layout setup (`PageSetupInput`) from display setup (`PageSetup`), add a PDF export path for `PrintOptions`, define a shared deterministic `HeaderFooterContext` with injected `now`, and specify whether visibility caches become a reusable `VisibilityIndex`.

The verification plan is directionally good but not command-level enough. For TypeScript changes in this package, the required gates should name `pnpm --filter @mog/print-export test` and `pnpm --filter @mog/print-export typecheck` or the repository's exact equivalent. If `@mog/pdf-layout` or `@mog/pdf-graphics` contracts change, their package tests and typechecks must be included. If Rust PDF metadata/bookmark support changes, the relevant Rust tests must be listed. App-provider work should include a browser/eval path that exercises real print preview and PDF export through UI-facing adapters, not only renderer unit tests.

Concrete changes that would raise the rating

- Add a Phase 0 contract matrix listing each needed field, current owner, new API, fallback behavior, and app/provider consumer updates for headers/footers, print options, gridlines, row/column headers, merges, hidden visibility, metadata, and bookmarks.
- Correct the header/footer geometry model by explicitly using `headerHeight`/`footerHeight` or documenting that headers render inside existing top/bottom margins without reducing body content. Apply the same decision to both PDF and HTML.
- Define `PdfExportOptions.printOptions` and `PdfExportOptions.pageSetup` or equivalent provider methods, then require `usePdfExport` to pass the dialog/backstage settings into the exporter.
- Include production app adapter updates for `usePrint`, `usePdfExport`, and `ViewportTableDataProvider` where required, or split them into named dependent plans that block feature-complete acceptance.
- Split metadata/bookmark support into a separate cross-package workstream unless the plan includes exact `RenderBackend`, `PdfCanvas`, IPC/Rust, and verification changes.
- Replace "decide with owner" items with a default plan decision plus a compatibility path, especially for public contract removals and `NumberFormatRenderer`.
- Make the verification gates exact and include real app-level smoke/eval coverage for header/footer text, page numbers, gridlines, headings, merged cells, and hidden row/column behavior.
