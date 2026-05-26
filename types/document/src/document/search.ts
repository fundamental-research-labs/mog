/**
 * Search Types for Find/Replace
 *
 * Defines types for the Find/Replace system following the Cell Identity Architecture.
 * Search results store stable CellIds, not positions - positions are resolved at
 * navigation/render time.
 *
 * Key architectural decisions:
 * - CellId-based results survive row/col insert/delete operations
 * - Position is resolved from CellId at navigation time via GridIndex
 * - Search is a read-only query - NOT persistent state (not a domain module)
 * - XState machine manages search state (not Zustand) due to complex transitions
 *
 * @see docs/architecture/cell-identity.md
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { SheetId } from '@mog/types-core/core';

// =============================================================================
// Search Options
// =============================================================================

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

/**
 * Default search options.
 */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  searchIn: 'values',
  caseSensitive: false,
  matchEntireCell: false,
  useRegex: false,
  scope: 'sheet',
  direction: 'byRow',
};

// =============================================================================
// Search Result
// =============================================================================

/**
 * A single search result.
 *
 * ARCHITECTURE (Cell Identity):
 * - Uses CellId for stable identity per Cell Identity Architecture
 * - Position is NOT stored - resolved at navigation/render time via GridIndex.getPosition()
 * - This ensures results survive row/column insert/delete operations
 * - Deleted cells are gracefully skipped during navigation
 *
 * @example
 * // When navigating to a result:
 * const position = GridIndex.getPosition(ctx, result.cellId);
 * if (position) {
 *   selectionActor.send({ type: 'SELECT_CELL', row: position.row, col: position.col });
 * }
 * // If position is null, cell was deleted - skip to next result
 */
export interface SearchResult {
  /**
   * Sheet containing the match.
   * Used for cross-sheet navigation in workbook-wide search.
   */
  sheetId: SheetId;

  /**
   * Stable cell identity - survives row/col insert/delete.
   * Use GridIndex.getPosition(ctx, cellId) to get current position.
   */
  cellId: CellId;

  /**
   * The matched text substring.
   */
  matchedText: string;

  /**
   * Start position of match within cell text (0-indexed).
   */
  matchStart: number;

  /**
   * Length of matched text.
   */
  matchLength: number;

  /**
   * Whether match is in formula text (vs displayed value).
   * Affects Replace behavior:
   * - true: Replace modifies formula text
   * - false: Replace modifies cell value (only for non-formula cells)
   */
  isInFormula: boolean;
}

// =============================================================================
// Search Match Info
// =============================================================================

/**
 * Information about a match within cell text.
 * Used internally by search functions.
 */
export interface SearchMatchInfo {
  /** Matched text */
  text: string;
  /** Start position in original text */
  start: number;
  /** Length of match */
  length: number;
  /** Whether match is in formula */
  isInFormula: boolean;
}

// =============================================================================
// Replace Options
// =============================================================================

/**
 * Options for Replace operations.
 * Extends SearchOptions with replacement-specific settings.
 */
export interface ReplaceOptions extends SearchOptions {
  /**
   * Text to replace matches with.
   */
  replacement: string;
}

/**
 * Result of a replace operation.
 */
export interface ReplaceResult {
  /** Whether replacement was successful */
  success: boolean;

  /** Number of replacements made */
  replacedCount: number;

  /**
   * Number of matches skipped.
   * Reasons for skipping:
   * - Formula cell when searching in 'values' (Excel behavior)
   * - Cell was deleted since search
   */
  skippedCount: number;

  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Search Highlight (for rendering)
// =============================================================================

/**
 * Search highlight for rendering.
 * Position is resolved at render time from CellId.
 *
 * ARCHITECTURE:
 * - Canvas layer receives row/col (doesn't know about CellId)
 * - CellId → position resolution happens in React (SpreadsheetGrid.tsx)
 * - This keeps canvas layer pure and testable
 */
export interface SearchHighlight {
  /** Current row position (resolved from CellId at render time) */
  row: number;
  /** Current column position (resolved from CellId at render time) */
  col: number;
  /** Whether this is the current/active result */
  isCurrent: boolean;
}

// =============================================================================
// Search State (for XState machine context)
// =============================================================================

/**
 * Search state for XState machine context.
 * This is NOT stored in Zustand - it's in the XState machine.
 */
export interface FindReplaceState {
  /** Current search query */
  query: string;

  /** Replacement text (for replace operations) */
  replacement: string;

  /** Search options */
  options: SearchOptions;

  /**
   * Search results (computed on search).
   * Stores CellIds, not positions - per Cell Identity Architecture.
   */
  results: SearchResult[];

  /** Current result index for navigation (0-based, -1 if no results) */
  currentIndex: number;

  /**
   * Whether results are stale (cell VALUES changed since last search).
   *
   * IMPORTANT: Structure changes (insert/delete row/col) do NOT cause staleness
   * because we store CellId, not position. Only value changes cause staleness.
   */
  resultsStale: boolean;

  /** Whether showing replace UI (false = find-only mode) */
  showReplace: boolean;

  /** Error message if search/replace failed */
  errorMessage: string | null;
}
