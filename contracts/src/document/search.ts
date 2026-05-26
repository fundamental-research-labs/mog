/**
 * Public search contracts.
 */
import type { CellId } from '../cells/cell-identity';
import type { SheetId } from '../core/core';

/**
 * Options for Find/Replace operations.
 */
export interface SearchOptions {
  /**
   * Where to search: displayed values, formula text, or both.
   *
   * - 'values': Search in displayed/computed values (default)
   * - 'formulas': Search in formula text (=SUM(A1:B10))
   * - 'both': Search in both values and formulas
   */
  searchIn: 'values' | 'formulas' | 'both';

  /**
   * Case-sensitive matching.
   * @default false
   */
  caseSensitive: boolean;

  /**
   * Match entire cell contents only.
   * If true, "test" won't match a cell containing "testing".
   * @default false
   */
  matchEntireCell: boolean;

  /**
   * Enable regular expression matching.
   * When true, the query is treated as a regex pattern.
   * @default false
   */
  useRegex: boolean;

  /**
   * Search scope: current sheet or entire workbook.
   * @default 'sheet'
   */
  scope: 'sheet' | 'workbook';

  /**
   * Search direction for result ordering.
   * - 'byRow': Left-to-right, top-to-bottom (row-major)
   * - 'byColumn': Top-to-bottom, left-to-right (column-major)
   * @default 'byRow'
   */
  direction: 'byRow' | 'byColumn';
}

/** Default options for Find/Replace search operations. */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  searchIn: 'values',
  caseSensitive: false,
  matchEntireCell: false,
  useRegex: false,
  scope: 'sheet',
  direction: 'byRow',
};

/**
 * A single search result.
 *
 * Results store CellIds, not positions. Positions are resolved at navigation
 * or render time so results can survive row/column structure changes.
 */
export interface SearchResult {
  /** Sheet containing the match. */
  sheetId: SheetId;
  /** Stable cell identity; resolve to current position at use time. */
  cellId: CellId;
  /** The matched text substring. */
  matchedText: string;
  /** Start position of match within cell text (0-indexed). */
  matchStart: number;
  /** Length of matched text. */
  matchLength: number;
  /** Whether match is in formula text instead of displayed value. */
  isInFormula: boolean;
}

/**
 * Information about a match within cell text.
 */
export interface SearchMatchInfo {
  /** Matched text. */
  text: string;
  /** Start position in original text. */
  start: number;
  /** Length of match. */
  length: number;
  /** Whether match is in formula text. */
  isInFormula: boolean;
}

/**
 * Options for Replace operations.
 */
export interface ReplaceOptions extends SearchOptions {
  /** Text to replace matches with. */
  replacement: string;
}

/**
 * Result of a replace operation.
 */
export interface ReplaceResult {
  /** Whether replacement was successful. */
  success: boolean;
  /** Number of replacements made. */
  replacedCount: number;
  /** Number of matches skipped. */
  skippedCount: number;
  /** Error message if failed. */
  error?: string;
}

/**
 * Search highlight for rendering.
 * Position is resolved from CellId before this reaches the canvas layer.
 */
export interface SearchHighlight {
  /** Current row position. */
  row: number;
  /** Current column position. */
  col: number;
  /** Whether this is the current/active result. */
  isCurrent: boolean;
}

/**
 * Search state for XState machine context.
 */
export interface FindReplaceState {
  /** Current search query. */
  query: string;
  /** Replacement text for replace operations. */
  replacement: string;
  /** Search options. */
  options: SearchOptions;
  /** Search results computed on search. */
  results: SearchResult[];
  /** Current result index for navigation (0-based, -1 if no results). */
  currentIndex: number;
  /** Whether results are stale because cell values changed since last search. */
  resultsStale: boolean;
  /** Whether showing replace UI (false = find-only mode). */
  showReplace: boolean;
  /** Error message if search/replace failed. */
  errorMessage: string | null;
}
