/**
 * types.ts — Format-agnostic pagination types
 *
 * This module defines all type contracts for the pagination engine.
 * No PDF, HTML, or rendering concepts — purely dimensional layout.
 */

// ============================================================================
// Merged Region
// ============================================================================

/**
 * A rectangular merged region in the grid.
 * All indices are 0-based and inclusive.
 */
export interface MergedRegion {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

// ============================================================================
// Content Measurer
// ============================================================================

/**
 * Interface for measuring content dimensions.
 * The caller resolves dynamic row heights (e.g., text wrapping)
 * BEFORE calling the layout engine. Heights/widths returned here
 * are pre-calculated final values in points.
 */
export interface ContentMeasurer {
  /** Get the height of a row in points. */
  getRowHeight(row: number): number;

  /** Get the width of a column in points. */
  getColumnWidth(col: number): number;

  /** Get all merged regions in the content area. */
  getMergedRegions(): MergedRegion[];

  /** Whether a row is hidden (should be skipped). */
  isRowHidden(row: number): boolean;

  /** Whether a column is hidden (should be skipped). */
  isColHidden(col: number): boolean;
}

// ============================================================================
// Page Setup Input
// ============================================================================

/**
 * 6-margin model (Excel-compatible).
 * All values in points.
 */
export interface PageMargins6 {
  top: number;
  bottom: number;
  left: number;
  right: number;
  header: number;
  footer: number;
}

/**
 * Format-agnostic page setup. No PDF/HTML concepts.
 * All dimensional values in points (1/72 inch).
 */
export interface PageSetupInput {
  /** Page width in points. */
  pageWidth: number;

  /** Page height in points. */
  pageHeight: number;

  /** 6-margin model. */
  margins: PageMargins6;

  /** Page orientation. */
  orientation: 'portrait' | 'landscape';

  /** Manual scale factor (1.0 = 100%). */
  scale: number;

  /** Fit-to-page constraints (number of pages wide/tall). */
  fitTo?: { width?: number; height?: number };

  /** Rows to repeat at top of each page [startRow, endRow] (inclusive). */
  repeatRows?: [number, number];

  /** Columns to repeat at left of each page [startCol, endCol] (inclusive). */
  repeatCols?: [number, number];

  /** Center content horizontally on page. */
  centerHorizontal?: boolean;

  /** Center content vertically on page. */
  centerVertical?: boolean;

  /** Page order for multi-page layouts. */
  pageOrder?: 'overThenDown' | 'downThenOver';

  /** Restrict pagination to this area. */
  printArea?: { startRow: number; startCol: number; endRow: number; endCol: number };

  /** Manual row page breaks (row indices where new pages start). */
  rowPageBreaks?: number[];

  /** Manual column page breaks (column indices where new pages start). */
  colPageBreaks?: number[];

  /** Column groups that should stay together on the same page. */
  columnGroups?: [number, number][];

  /** Height reserved for header content in points. */
  headerHeight?: number;

  /** Height reserved for footer content in points. */
  footerHeight?: number;
}

// ============================================================================
// Pagination Plan (Output)
// ============================================================================

/**
 * Warning types emitted during layout.
 */
export type LayoutWarningType =
  | 'fit_unreadable'
  | 'merge_overflow_row'
  | 'merge_overflow_col'
  | 'orphan_column'
  | 'manual_break_in_merge'
  | 'empty_print_area';

/**
 * A warning produced during layout calculation.
 */
export interface LayoutWarning {
  type: LayoutWarningType;
  message: string;
}

/**
 * A single page in the pagination plan.
 */
export interface PageSlice {
  /** 1-based page number. */
  pageNumber: number;

  /** Inclusive row range [startRow, endRow]. */
  rowRange: [startRow: number, endRow: number];

  /** Inclusive column range [startCol, endCol]. */
  colRange: [startCol: number, endCol: number];

  /** Repeat rows to render at top of this page (if applicable). */
  repeatRows?: [startRow: number, endRow: number];

  /** Repeat columns to render at left of this page (if applicable). */
  repeatCols?: [startCol: number, endCol: number];

  /** Content offset for centering (x, y in points). */
  contentOffset: { x: number; y: number };

  /** Whether this page was triggered by a manual break. */
  isManualBreak: boolean;
}

/**
 * The complete pagination plan output.
 */
export interface PaginationPlan {
  /** Ordered list of pages. */
  pages: PageSlice[];

  /** Total number of pages. */
  totalPages: number;

  /** Effective scale factor applied to content. */
  scale: number;

  /** Warnings produced during layout. */
  warnings: LayoutWarning[];
}

// ============================================================================
// Fit-to-Page Result
// ============================================================================

/**
 * Result of fit-to-page calculation.
 */
export interface FitToPageResult {
  /** The actual scale factor to apply. */
  actualScale: number;

  /** Whether the content is readable at this scale. */
  readableAtScale: boolean;

  /** Suggested orientation if current one is too small. */
  suggestedOrientation?: 'portrait' | 'landscape';

  /** Suggested paper size (width x height in points) if current is too small. */
  suggestedPaperSize?: { width: number; height: number };
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Computed page dimensions after applying margins, headers/footers, and scale.
 */
export interface PageDimensions {
  /** Total page width in points. */
  pageWidth: number;

  /** Total page height in points. */
  pageHeight: number;

  /** Printable width after margins. */
  printableWidth: number;

  /** Printable height after margins. */
  printableHeight: number;

  /** Height consumed by repeat rows (in content-scale points). */
  repeatRowsHeight: number;

  /** Width consumed by repeat columns (in content-scale points). */
  repeatColsWidth: number;

  /** Available width for content per page. */
  contentWidth: number;

  /** Available height for content per page. */
  contentHeight: number;
}

/**
 * Internal break positions.
 */
export interface PageBreaks {
  /** Row indices where each new page starts. */
  rowBreaks: RowBreakInfo[];

  /** Column indices where each new page starts. */
  colBreaks: ColBreakInfo[];
}

/**
 * Row break information.
 */
export interface RowBreakInfo {
  /** Row index where this page section starts. */
  startRow: number;

  /** Whether this break was triggered by a manual page break. */
  isManualBreak: boolean;
}

/**
 * Column break information.
 */
export interface ColBreakInfo {
  /** Column index where this page section starts. */
  startCol: number;

  /** Whether this break was triggered by a manual page break. */
  isManualBreak: boolean;
}
