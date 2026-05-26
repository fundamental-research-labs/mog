/**
 * @mog/print-export
 *
 * Print and PDF export functionality for the spreadsheet engine.
 */

// ── New PDF Export API ──────────────────────────────────────────────────
export {
  SpreadsheetPdfExporter,
  type CellDataInput,
  type CellFormatInput,
  type PdfDataProvider,
  type PdfExportOptions,
  type PdfExportResult,
  type PdfWarning,
  type UsedRange,
} from './pdf/exporter';

export { createPdfExporter } from './pdf/create-exporter';

// ── Contracts ───────────────────────────────────────────────────────────
export * from './contracts/types';

// ── HTML Generation ─────────────────────────────────────────────────────
export { StyleGenerator, styleGenerator, type CSSStyles } from './html/style-generator';

export {
  TableGenerator,
  tableGenerator,
  type ITableDataProvider,
  type TableGeneratorOptions,
  type TableGeneratorResult,
} from './html/table-generator';

// ── Page Layout ─────────────────────────────────────────────────────────
export {
  PageLayout,
  pageLayout,
  type PageWrapperOptions,
  type PlaceholderContext,
  type RenderedHeaderFooter,
} from './html/page-layout';

// ── Print Handler ───────────────────────────────────────────────────────
export { PrintHandler, printHandler, type PrintHandlerOptions } from './print/print-handler';

// ── Pagination Engine (from pdf-layout) ─────────────────────────────────
export { PaginationEngine } from '@mog/pdf-layout';
export type {
  ContentMeasurer,
  LayoutWarning,
  MergedRegion,
  PageSetupInput,
  PageSlice,
  PaginationPlan,
} from '@mog/pdf-layout';
