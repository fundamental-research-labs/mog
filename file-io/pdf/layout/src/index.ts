/**
 * @mog/pdf-layout — Format-Agnostic Pagination Engine
 *
 * This package calculates pagination layouts for any output format.
 * It knows nothing about PDF, HTML, or rendering. It takes content
 * dimensions and produces a pagination plan.
 *
 * Usage:
 *   import { PaginationEngine } from '@mog/pdf-layout';
 *
 *   const engine = new PaginationEngine();
 *   const plan = engine.calculateLayout(measurer, setup);
 */

// ── Types ──
export type {
  ColBreakInfo,
  ContentMeasurer,
  FitToPageResult,
  LayoutWarning,
  LayoutWarningType,
  MergedRegion,
  PageBreaks,
  PageDimensions,
  PageMargins6,
  PageSetupInput,
  PageSlice,
  PaginationPlan,
  RowBreakInfo,
} from './types';

// ── Engine ──
export { PaginationEngine } from './pagination-engine';

// ── Submodules (for advanced use) ──
export { calculateRowBreaks } from './row-breaks';
export type { RowBreakParams, RowBreakResult } from './row-breaks';

export { calculateColBreaks } from './col-breaks';
export type { ColBreakParams, ColBreakResult } from './col-breaks';

export { calculateFitToScale, measureContentDimensions } from './fit-to-page';
export type { FitToPageParams } from './fit-to-page';

export { assemblePages } from './page-order';
export type { PageAssemblyParams } from './page-order';
