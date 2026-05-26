/**
 * Print/PDF Export Types
 *
 * Type definitions for print and PDF export functionality.
 */

// ============================================================================
// Paper Size Types
// ============================================================================

/**
 * Standard paper sizes
 */
export type PaperSize = 'letter' | 'legal' | 'a4' | 'a3' | 'custom';

/**
 * Page orientation
 */
export type PageOrientation = 'portrait' | 'landscape';

// ============================================================================
// Print Options
// ============================================================================

/**
 * Page margins in inches
 */
export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Custom paper size in inches
 */
export interface CustomPaperSize {
  width: number;
  height: number;
}

/**
 * Fit to page options
 */
export interface FitToPage {
  /** Number of pages wide */
  width?: number;
  /** Number of pages tall */
  height?: number;
}

/**
 * Center content on page options
 */
export interface CenterOnPage {
  horizontal: boolean;
  vertical: boolean;
}

/**
 * Main print options
 */
export interface PrintOptions {
  /** Paper size */
  paperSize: PaperSize;

  /** Custom size in inches (if paperSize is 'custom') */
  customSize?: CustomPaperSize;

  /** Orientation */
  orientation: PageOrientation;

  /** Margins in inches */
  margins: PageMargins;

  /** Scale factor (0.5 = 50%, 1.0 = 100%, 2.0 = 200%) */
  scale: number;

  /** Fit to page options */
  fitTo?: FitToPage;

  /** Print gridlines */
  showGridlines: boolean;

  /** Print row/column headers (1, 2, 3... and A, B, C...) */
  showHeaders: boolean;

  /** Center content on page */
  center: CenterOnPage;

  /**
   * Repeat table headers on each printed page.
   * When true, table header rows are repeated at the top of each page
   * when a table spans multiple pages.
   */
  repeatTableHeaders?: boolean;
}

/**
 * Default print options
 */
export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  paperSize: 'letter',
  orientation: 'portrait',
  margins: {
    top: 0.75,
    right: 0.7,
    bottom: 0.75,
    left: 0.7,
  },
  scale: 1.0,
  showGridlines: true,
  showHeaders: false,
  center: {
    horizontal: false,
    vertical: false,
  },
};

// ============================================================================
// Page Setup
// ============================================================================

/**
 * Header/footer section content
 */
export interface HeaderFooterSection {
  left?: string;
  center?: string;
  right?: string;
  /** Image data for left section (base64 or URL) */
  leftImage?: string;
  /** Image data for center section (base64 or URL) */
  centerImage?: string;
  /** Image data for right section (base64 or URL) */
  rightImage?: string;
}

/**
 * Page setup options (headers, footers, repeat rows/cols)
 * Stream F: Enhanced with different first/odd/even page support
 */
export interface PageSetup {
  /** Header content (left, center, right sections) */
  header?: HeaderFooterSection;

  /** Footer content */
  footer?: HeaderFooterSection;

  // === Stream F: Advanced Header/Footer Features ===
  /**
   * F1: Different first page header/footer.
   * When true, firstPageHeader and firstPageFooter are used for page 1.
   */
  differentFirstPage?: boolean;

  /** F1: First page header (only used if differentFirstPage is true) */
  firstPageHeader?: HeaderFooterSection;

  /** F1: First page footer (only used if differentFirstPage is true) */
  firstPageFooter?: HeaderFooterSection;

  /**
   * F2: Different odd/even page headers/footers.
   * When true, odd pages use header/footer, even pages use evenPageHeader/evenPageFooter.
   */
  differentOddEven?: boolean;

  /** F2: Even page header (only used if differentOddEven is true) */
  evenPageHeader?: HeaderFooterSection;

  /** F2: Even page footer (only used if differentOddEven is true) */
  evenPageFooter?: HeaderFooterSection;

  /** Rows to repeat at top of each page (e.g., [0, 2] for rows 1-3) */
  repeatRows?: [number, number];

  /** Columns to repeat at left of each page */
  repeatCols?: [number, number];

  /** Print title (appears in header) */
  title?: string;

  /** Date format in header/footer */
  dateFormat?: string;
}

// ============================================================================
// PDF Document Properties (E1)
// ============================================================================

/**
 * PDF document metadata properties
 * These are embedded in the PDF and appear in document properties dialogs
 */
export interface PdfDocumentProperties {
  /** Document title (defaults to filename if not specified) */
  title?: string;

  /** Document author */
  author?: string;

  /** Document subject/description */
  subject?: string;

  /** Keywords for search/categorization (comma-separated or array) */
  keywords?: string | string[];

  /** Application that created the document */
  creator?: string;

  /** PDF producer (usually the library name) */
  producer?: string;

  /** Creation date (defaults to current date if not specified) */
  creationDate?: Date;
}

// ============================================================================
// PDF Bookmark/Outline (E2)
// ============================================================================

/**
 * PDF bookmark (outline) entry
 * Used to create navigable bookmarks in the PDF
 */
export interface PdfBookmark {
  /** Bookmark title displayed in the outline panel */
  title: string;

  /** Target page number (1-indexed) */
  pageNumber: number;

  /** Child bookmarks for hierarchical structure */
  children?: PdfBookmark[];
}

// ============================================================================
// Header/Footer Format Codes (E4)
// ============================================================================

/**
 * Excel-compatible header/footer format codes
 * These codes control font formatting within header/footer text
 */
export const HEADER_FOOTER_FORMAT_CODES = {
  /** Bold text start/end toggle */
  BOLD: '&B',
  /** Italic text start/end toggle */
  ITALIC: '&I',
  /** Underline text start/end toggle */
  UNDERLINE: '&U',
  /** Strikethrough text start/end toggle */
  STRIKETHROUGH: '&S',
  /** Font name: &"fontname" */
  FONT: '&"',
  /** Font size: &nn */
  FONT_SIZE: '&',
  /** Superscript text toggle */
  SUPERSCRIPT: '&X',
  /** Subscript text toggle */
  SUBSCRIPT: '&Y',
} as const;

/**
 * Parsed formatted text segment for header/footer rendering
 * F4: Enhanced with full Excel format code support
 */
export interface FormattedTextSegment {
  /** Text content */
  text: string;
  /** Bold formatting */
  bold?: boolean;
  /** Italic formatting */
  italic?: boolean;
  /** Underline formatting */
  underline?: boolean;
  /** Strikethrough formatting */
  strikethrough?: boolean;
  /** Font family name */
  fontFamily?: string;
  /** Font size in points */
  fontSize?: number;
  /** F4: Text color (hex format: #FF0000) */
  color?: string;
}

/**
 * Default page setup
 */
export const DEFAULT_PAGE_SETUP: PageSetup = {
  header: {
    center: '&[Sheet]',
  },
  footer: {
    center: 'Page &[Page] of &[Pages]',
  },
};

// ============================================================================
// Print Area
// ============================================================================

/**
 * Range definition for print area
 */
export interface PrintRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Print area configuration
 */
export interface PrintArea {
  /** Sheet ID */
  sheetId: string;

  /** Range to print (if undefined, print used range) */
  range?: PrintRange;

  /** Manual row page breaks (row indices where new pages start) */
  rowPageBreaks?: number[];

  /** Manual column page breaks (column indices where new pages start) */
  colPageBreaks?: number[];
}

// ============================================================================
// Results
// ============================================================================

/**
 * Statistics from print/export operation
 */
export interface PrintStats {
  /** Number of pages generated */
  pagesGenerated: number;
  /** Number of cells rendered */
  cellsRendered: number;
  /** Time taken in milliseconds */
  timeMs: number;
}

/**
 * Result of print operation
 */
export interface PrintResult {
  success: boolean;
  error?: string;
  stats: PrintStats;
}

/**
 * Result of PDF export operation
 */
export interface PdfExportResult extends PrintResult {
  /** PDF blob for download */
  blob?: Blob;

  /** PDF data URL for preview */
  dataUrl?: string;
}

// ============================================================================
// Page Layout
// ============================================================================

/**
 * Individual page info in layout result
 */
export interface PageInfo {
  pageNumber: number;
  sheetId: string;
  rowRange: [number, number];
  colRange: [number, number];
}

/**
 * Result of page layout calculation
 */
export interface PageLayoutResult {
  /** Total pages */
  pageCount: number;

  /** Page dimensions in pixels at 96 DPI */
  pageSize: { width: number; height: number };

  /** Printable area per page */
  printableArea: { width: number; height: number };

  /** Page breakdown */
  pages: PageInfo[];
}

// ============================================================================
// Header/Footer Placeholders
// ============================================================================

/**
 * Supported header/footer placeholders (Excel-compatible)
 */
export const HEADER_FOOTER_PLACEHOLDERS = {
  PAGE: '&[Page]',
  PAGES: '&[Pages]',
  DATE: '&[Date]',
  TIME: '&[Time]',
  FILE: '&[File]',
  SHEET: '&[Sheet]',
} as const;

// ============================================================================
// Standard Paper Sizes (in inches)
// ============================================================================

/**
 * Paper size dimensions in inches
 */
export const PAPER_SIZES: Record<Exclude<PaperSize, 'custom'>, CustomPaperSize> = {
  letter: { width: 8.5, height: 11 },
  legal: { width: 8.5, height: 14 },
  a4: { width: 8.27, height: 11.69 },
  a3: { width: 11.69, height: 16.54 },
};

/**
 * Convert inches to pixels at 96 DPI
 */
export function inchesToPixels(inches: number): number {
  return Math.round(inches * 96);
}

/**
 * Convert pixels to inches at 96 DPI
 */
export function pixelsToInches(pixels: number): number {
  return pixels / 96;
}
