/**
 * Fill Module Types
 *
 * Types for autofill operations. This module defines types for:
 * - Formula adjustment (identity-native, no A1 round-tripping)
 * - Pattern detection (linear, growth, weekday, month, date series)
 * - Fill execution options and results
 *
 */

import type { CellId, IdentityFormula } from '@mog-sdk/contracts/cell-identity';
import type { CellFormat, SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Position Types
// =============================================================================

/**
 * A position in a spreadsheet (row, col, sheet).
 */
export interface Position {
  row: number;
  col: number;
  sheet: SheetId;
}

// CellRange imported from contracts - canonical single source of truth
import type { CellRange } from '@mog-sdk/contracts/core';
export type { CellRange };

// =============================================================================
// Formula Adjustment Types
// =============================================================================

/**
 * Adjusted position for a cell reference.
 * Returned by calculateAdjustedPositions() for single cell refs.
 */
export interface AdjustedCellRefPosition {
  type: 'cell';
  /** Index in formula.refs */
  refIndex: number;
  /** Calculated target row */
  targetRow: number;
  /** Calculated target col */
  targetCol: number;
  /** Sheet for the reference (PRESERVED from original ref) */
  targetSheet: SheetId;
  /** True if row < 0 or col < 0 or exceeds limits */
  outOfBounds: boolean;
}

/**
 * Adjusted positions for a range reference.
 * BOTH corners are adjusted independently based on their own absolute flags.
 */
export interface AdjustedRangeRefPosition {
  type: 'range';
  /** Index in formula.refs */
  refIndex: number;
  /** Start corner target row */
  startTargetRow: number;
  /** Start corner target col */
  startTargetCol: number;
  /** End corner target row */
  endTargetRow: number;
  /** End corner target col */
  endTargetCol: number;
  /** Sheet for the range (same for both corners) */
  targetSheet: SheetId;
  /** True if ANY corner is out of bounds */
  outOfBounds: boolean;
}

/**
 * Discriminated union of adjusted ref positions.
 */
export type AdjustedRefPosition = AdjustedCellRefPosition | AdjustedRangeRefPosition;

// =============================================================================
// Lookup Adapter Types
// =============================================================================

/**
 * Async lookup interface for formula A1 display.
 *
 * Provides position <-> CellId bidirectional lookup and sheet name resolution.
 * All methods are async (delegated to ComputeBridge).
 * Sheet name methods migrated from sync Yjs reads to async ComputeBridge.
 *
 * Used by formulaToA1() to generate human-readable formulas with
 * proper cross-sheet reference notation (e.g., "Sheet2!A1").
 */
export interface IFormulaDisplayLookup {
  /** Get the current position of a cell by its ID. */
  getPosition(cellId: CellId): Promise<{ row: number; col: number; sheet: SheetId } | null>;

  /** Get the positions of multiple cells by their IDs (batch). */
  getPositions(
    cellIds: CellId[],
  ): Promise<Array<{ row: number; col: number; sheet: SheetId } | null>>;

  /** Get the cell ID at a given position. */
  getCellId(sheet: SheetId, row: number, col: number): Promise<CellId | null>;

  /** Get an existing cell ID or create a new one at the given position. */
  getOrCreateCellId(sheet: SheetId, row: number, col: number): Promise<CellId>;

  /** Get the name of a sheet by its ID (async - ComputeBridge). */
  getSheetName(sheetId: SheetId): Promise<string | undefined>;

  /** Get a sheet ID by its name (async - ComputeBridge). */
  getSheetIdByName(name: string): Promise<SheetId | undefined>;
}

// =============================================================================
// Fill Pattern Types
// =============================================================================

/**
 * Types of fill patterns that can be detected or specified.
 */
export type FillPatternType =
  | 'copy' // No pattern, just copy value
  | 'linear' // 1,2,3 or 2,4,6 (constant step)
  | 'growth' // 2,4,8 or 3,9,27 (constant multiplier)
  | 'date' // Date increment
  | 'time' // Time increment (hours, minutes, seconds)
  | 'weekday' // Monday, Tuesday, Wednesday...
  | 'weekdayShort' // Mon, Tue, Wed...
  | 'month' // January, February, March...
  | 'monthShort' // Jan, Feb, Mar...
  | 'quarter' // Q1, Q2, Q3, Q4
  | 'ordinal' // 1st, 2nd, 3rd, 4th...
  | 'textWithNumber' // Item 1, Item 2... or ABC123, ABC124...
  | 'customList'; // User-defined custom lists

/**
 * Detected or specified fill pattern.
 */
export interface FillPattern {
  type: FillPatternType;
  /** Step for linear series */
  step?: number;
  /** Multiplier for growth series */
  multiplier?: number;
  /** Unit for date series */
  dateUnit?: 'day' | 'weekday' | 'month' | 'year';
  /** Unit for time series */
  timeUnit?: 'hour' | 'minute' | 'second';
  /** Starting index for cyclic patterns (weekday, month, ordinal) */
  startIndex?: number;
  /** Prefix for textWithNumber pattern (e.g., "Item " in "Item 1") */
  prefix?: string;
  /** Number of digits for padding in textWithNumber pattern (e.g., 2 for "Item 01") */
  numDigits?: number;
  /** Custom list ID for customList pattern */
  listId?: string;
}

// =============================================================================
// Fill Execution Types
// =============================================================================

/**
 * Fill direction.
 */
export type FillDirection = 'down' | 'right' | 'up' | 'left';

/**
 * Fill type - what to include in fill.
 */
export type AutoFillContentType = 'all' | 'formulas' | 'values' | 'formats';

/**
 * Series type - how to extend values.
 */
export type SeriesType = 'auto' | 'copy' | 'linear' | 'growth' | 'date';

/**
 * Options for fill execution.
 */
export interface FillOptions {
  /** Direction of fill */
  direction: FillDirection;
  /** What to fill */
  fillType: AutoFillContentType;
  /** How to extend series */
  seriesType: SeriesType;
  /** Unit for date series */
  dateUnit?: 'day' | 'weekday' | 'month' | 'year';
  /** Override step for linear/growth */
  step?: number;
  /** Include formulas in fill */
  includeFormulas: boolean;
  /** Include values in fill */
  includeValues: boolean;
  /** Include formats in fill */
  includeFormats: boolean;
  /** Enable smart pattern detection for values */
  smartFill: boolean;
  /**
   * Include data validation (schemas) in fill.
   * Default: true (validation is copied along with other cell properties)
   */
  includeValidation?: boolean;
  /**
   * Skip hidden rows during fill (respects filter state).
   * When true, hidden/filtered rows will not be filled.
   * Default: true
   */
  skipHiddenRows?: boolean;
  /**
   * Skip hidden columns during fill.
   * When true, hidden columns will not be filled.
   * Default: true
   */
  skipHiddenCols?: boolean;
  /**
   * Callback to check if a row is hidden (for filtered data fill).
   * Returns true if the row should be skipped (is hidden/filtered).
   */
  isRowHidden?: (row: number) => boolean;
  /**
   * Callback to check if a column is hidden.
   * Returns true if the column should be skipped (is hidden).
   */
  isColHidden?: (col: number) => boolean;
}

/**
 * Default fill options.
 */
export const DEFAULT_FILL_OPTIONS: FillOptions = {
  direction: 'down',
  fillType: 'all',
  seriesType: 'auto',
  includeFormulas: true,
  includeValues: true,
  includeFormats: true,
  smartFill: true,
  includeValidation: true,
  skipHiddenRows: true,
  skipHiddenCols: true,
};

/**
 * Error during fill operation.
 */
export interface FillError {
  row: number;
  col: number;
  error: string;
  /** Error type: 'error' for blocking errors, 'warning' for non-blocking issues */
  type?: 'error' | 'warning';
}

/**
 * Result of a fill operation.
 */
export interface FillResult {
  /** Whether fill succeeded */
  success: boolean;
  /** CellIds of filled cells */
  filledCells: CellId[];
  /** CellIds of cells that had data before fill (overwritten) */
  overwrittenCells: CellId[];
  /** Pattern that was detected/used */
  pattern: FillPattern | null;
  /** Any errors encountered */
  errors: FillError[];
}

// =============================================================================
// Pure Computation Types (Architecture Fix)
// =============================================================================
// These types enable the fill executor to return computed updates instead of
// mutating directly. All writes go through the Mutations layer.

/**
 * A value cell update (non-formula).
 * Used by fill operations to collect value updates for later application via Mutations.
 */
export interface FillValueUpdate {
  /** Target row index */
  row: number;
  /** Target column index */
  col: number;
  /** Raw value (string, number, boolean, or null) */
  rawValue: string | number | boolean | null;
}

/**
 * A formula cell update.
 * Contains the IdentityFormula directly - NO A1 round-tripping.
 * This respects the Cell Identity Model where IdentityFormula is the source of truth.
 */
export interface FillFormulaUpdate {
  /** Target row index */
  row: number;
  /** Target column index */
  col: number;
  /** The computed IdentityFormula with adjusted CellId references */
  identityFormula: IdentityFormula;
  /** A1 display string (derived from identityFormula, for the 'r' field) */
  displayFormula: string;
}

/**
 * A format cell update.
 * Used by fill operations to collect format updates for later application.
 */
export interface FillFormatUpdate {
  /** Target row index */
  row: number;
  /** Target column index */
  col: number;
  /** Format to copy from source cell */
  format: CellFormat;
}

/**
 * Aggregate of all updates computed by a fill operation.
 * Returned by computeFillUpdates() for the coordinator to apply via Mutations.
 * Separates value updates from formula updates to respect the Cell Identity Model.
 */
export interface FillUpdates {
  /** Value cell updates (non-formula) */
  valueUpdates: FillValueUpdate[];
  /** Formula cell updates (with IdentityFormula) */
  formulaUpdates: FillFormulaUpdate[];
  /** Format updates */
  formatUpdates: FillFormatUpdate[];
  /** CellIds of newly filled cells (for selection update) */
  filledCellIds: CellId[];
  /** CellIds of cells that had data before fill (overwritten) */
  overwrittenCellIds: CellId[];
  /** Pattern that was detected/used */
  pattern: FillPattern | null;
  /** Any errors encountered */
  errors: FillError[];
}

/**
 * Result of the pure computation phase of fill.
 * Contains all updates needed but does NOT mutate any state.
 */
export interface ComputedFillResult {
  /** Whether the fill computation succeeded */
  success: boolean;
  /** Computed updates to apply via Mutations layer */
  updates: FillUpdates;
}

/**
 * Result of multi-sheet fill computation.
 * Maps each sheet ID to its computed updates.
 */
export interface ComputedMultiSheetFillResult {
  /** Whether the fill computation succeeded for all sheets */
  success: boolean;
  /** Computed updates by sheet ID */
  updatesBySheet: Map<SheetId, FillUpdates>;
  /** Aggregated errors across all sheets */
  errors: FillError[];
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum row index (1 million rows, 0-indexed) */
export const MAX_ROWS = 1_000_000;

/** Maximum column index (16384 columns like Excel, 0-indexed) */
export const MAX_COLS = 16_384;

// =============================================================================
// Range Geometry Helpers
// =============================================================================

/**
 * Compute the fill direction from source range and drag end position.
 */
export function computeFillDirection(
  sourceRange: CellRange,
  targetEnd: { row: number; col: number },
): FillDirection {
  if (targetEnd.row > sourceRange.endRow) return 'down';
  if (targetEnd.row < sourceRange.startRow) return 'up';
  if (targetEnd.col > sourceRange.endCol) return 'right';
  if (targetEnd.col < sourceRange.startCol) return 'left';
  return 'down'; // Default
}

/**
 * Compute the target range from source range and fill end position.
 */
export function computeTargetRange(
  sourceRange: CellRange,
  fillEnd: { row: number; col: number },
): CellRange {
  const direction = computeFillDirection(sourceRange, fillEnd);

  switch (direction) {
    case 'down':
      return {
        startRow: sourceRange.endRow + 1,
        startCol: sourceRange.startCol,
        endRow: fillEnd.row,
        endCol: sourceRange.endCol,
      };

    case 'up':
      return {
        startRow: fillEnd.row,
        startCol: sourceRange.startCol,
        endRow: sourceRange.startRow - 1,
        endCol: sourceRange.endCol,
      };

    case 'right':
      return {
        startRow: sourceRange.startRow,
        startCol: sourceRange.endCol + 1,
        endRow: sourceRange.endRow,
        endCol: fillEnd.col,
      };

    case 'left':
      return {
        startRow: sourceRange.startRow,
        startCol: fillEnd.col,
        endRow: sourceRange.endRow,
        endCol: sourceRange.startCol - 1,
      };
  }
}

/**
 * Expand a source range to include the fill target.
 */
export function expandRange(
  sourceRange: CellRange,
  fillEnd: { row: number; col: number },
): CellRange {
  return {
    startRow: Math.min(sourceRange.startRow, fillEnd.row),
    startCol: Math.min(sourceRange.startCol, fillEnd.col),
    endRow: Math.max(sourceRange.endRow, fillEnd.row),
    endCol: Math.max(sourceRange.endCol, fillEnd.col),
  };
}
