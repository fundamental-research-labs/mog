/**
 * Shared types for all state machines in the renderer architecture.
 *
 * These types are the foundational contracts that ALL machines and components depend on.
 * Changes here affect the entire system - modify with care.
 *
 * @see ARCHITECTURE.md for design decisions
 */

import type { CellBorders, CellFormat, CellRange } from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import type {
  ChartSnapshot,
  ChartUIState,
  ClipboardSnapshot,
  Direction as DirectionType,
  EditorSnapshot,
  FocusLayerType,
  FocusSnapshot,
  RendererSnapshot,
  RendererStatus,
  SelectionDirection,
  SelectionSnapshot,
} from '@mog-sdk/contracts/machines';
import type {
  CellCoord as CellCoordType,
  FrozenPanes,
  LayerName,
  RemoteCursor,
  RenderPriority,
  ScrollViewport,
} from '@mog-sdk/contracts/rendering';
import type { Point, Rect } from '@mog-sdk/contracts/viewport';
import { cellRangeToA1, colToLetter } from '@mog/spreadsheet-utils/a1';
import {
  isCellInRange as isCellInRangeFromContracts,
  normalizeRange as normalizeRangeFromContracts,
  rangesEqual as rangesEqualFromContracts,
} from '@mog/spreadsheet-utils/range';

/**
 * Read-only view of a Zustand StoreApi.
 *
 * StoreApi<T> is invariant because setState takes T as input.
 * ReadableStoreApi<T> is covariant because T only appears in output positions
 * (getState returns T; subscribe's listener receives T as a callback parameter,
 * which is double-contravariant = covariant).
 *
 * We use an explicit interface with `out T` instead of Pick<StoreApi<T>, ...>
 * so TypeScript recognizes the covariance. This allows StoreApi<UIState> to be
 * passed where ReadableStoreApi<SliceSubset> is expected, as long as UIState
 * extends SliceSubset.
 */
export interface ReadableStoreApi<out T> {
  getState(): T;
  subscribe(listener: (state: T, prevState: T) => void): () => void;
}

// Import types for local use (functions use them in signatures)
type CellCoord = CellCoordType;
type Direction = DirectionType;

// Re-export CellRange from contracts - this is the canonical type for ranges
export type { CellRange };

// Re-export CellFormat and CellBorders from contracts - these are canonical types
export type { CellBorders, CellFormat };

// Re-export CellRange utilities from spreadsheet-utils
export { cellRangeToA1, colToLetter } from '@mog/spreadsheet-utils/a1';
export {
  isCellInRange as isCellInRangeFlat,
  normalizeRange as normalizeRangeFlat,
  rangesEqual as rangesEqualFlat,
} from '@mog/spreadsheet-utils/range';

// =============================================================================
// CELL COORDINATE TYPE - Re-exported from contracts
// =============================================================================

export type { CellCoord };

// =============================================================================
// SELECTION DIRECTION TYPE - Re-exported from contracts
// =============================================================================

export type { SelectionDirection };

// =============================================================================
// COORDINATE TYPES - Re-exported from contracts
// =============================================================================

// Re-export Point, Rect, ScrollViewport, and FrozenPanes from contracts.
// These are the canonical definitions in contracts/src/rendering/.
export type { FrozenPanes, Point, Rect, RemoteCursor, ScrollViewport };

// =============================================================================
// API-COMPATIBLE LEGACY TYPES
// =============================================================================

/**
 * Selection state for API contracts.
 * Used by internal-api and external consumers.
 */
export interface Selection {
  /** Active cell row (0-indexed) */
  activeRow: number;
  /** Active cell column (0-indexed) */
  activeCol: number;
  /** Selected ranges (can be multiple with Ctrl+click) */
  ranges: CellRange[];
}

/**
 * Edit mode state for API contracts.
 */
export interface EditState {
  /** Currently editing cell row (null if not editing) */
  row: number | null;
  /** Currently editing cell column (null if not editing) */
  col: number | null;
  /** Current edit value */
  value: string;
  /** Edit source */
  source: 'cell' | 'formulaBar';
}

/**
 * Clipboard state for API contracts.
 */
export interface ClipboardState {
  type: 'cut' | 'copy';
  sheetId: string;
  range: CellRange;
}

// =============================================================================
// INTERACTION TYPES - Re-exported from contracts
// =============================================================================

export type { Direction };

// =============================================================================
// RENDERING TYPES - Re-exported from contracts
// =============================================================================

export type { LayerName };

// =============================================================================
// MACHINE SNAPSHOT TYPES - Re-exported from contracts
// =============================================================================

export type {
  ChartSnapshot,
  ChartUIState,
  ClipboardSnapshot,
  EditorSnapshot,
  FocusLayerType,
  FocusSnapshot,
  RendererSnapshot,
  RendererStatus,
  SelectionSnapshot,
};

// =============================================================================
// COLLABORATION TYPES - Re-exported from contracts
// =============================================================================

// =============================================================================
// CLIPBOARD DATA TYPES
// =============================================================================

/**
 * Internal clipboard data structure.
 * Contains full fidelity data (values, formulas, formats).
 */
export interface ClipboardData {
  /** The ranges that were copied/cut */
  sourceRanges: CellRange[];
  /** Cell data indexed by relative position from top-left (e.g., "0,0", "0,1") */
  cells: Record<string, ClipboardCellData>;
  /** Original sheet ID for cross-sheet paste detection */
  sourceSheetId: string;
  /**
   * Text signature written to system clipboard (TSV format).
   * Used to detect if system clipboard was overwritten by another app.
   * On paste, we compare system clipboard text with this signature:
   * - Match: user is pasting our copy → use rich internal data (formulas, formats)
   * - Mismatch: user copied from elsewhere → parse external clipboard
   */
  textSignature?: string;
  /**
   * Merged regions within the copied range (
   * Positions are relative to sourceRanges[0] origin.
   * On paste, these are translated to the target position.
   */
  merges?: RelativeMerge[];
  /**
   * Data validation rules within the copied range (Data Validation).
   * Positions are relative to sourceRanges[0] origin.
   * On paste, these are translated to the target position.
   */
  validation?: RelativeValidation[];
  /**
   * Conditional formatting rules within the copied range.
   * Positions are relative to sourceRanges[0] origin.
   * On paste, these are translated to the target position with new IDs.
   */
  conditionalFormatting?: RelativeConditionalFormat[];
  /**
   * Source column widths for "Keep Source Column Widths" paste option.
   * Array indexed by relative column index (0 = first copied column).
   * Values are in pixels. undefined means use default column width.
   */
  sourceColumnWidths?: (number | undefined)[];
}

/**
 * A merged region with positions relative to clipboard origin.
 * Used for preserving merges during copy/paste operations.
 */
export interface RelativeMerge {
  /** Offset from source origin row */
  startRowOffset: number;
  /** Offset from source origin column */
  startColOffset: number;
  /** Offset from source origin row for end */
  endRowOffset: number;
  /** Offset from source origin column for end */
  endColOffset: number;
}

/**
 * A conditional formatting rule with positions relative to clipboard origin.
 * Used for preserving conditional formatting during copy/paste operations.
 */
export interface RelativeConditionalFormat {
  /**
   * The CF rules (without IDs - new IDs will be generated on paste).
   * Contains the full rule definition (type, operator, values, style, etc.)
   */
  rules: Array<{
    type: string;
    priority: number;
    stopIfTrue?: boolean;
    // Rule-specific properties stored as generic object
    [key: string]: unknown;
  }>;
  /**
   * Range offsets relative to clipboard origin (where CF applies).
   * Multiple ranges supported per CF rule.
   */
  ranges: Array<{
    startRowOffset: number;
    startColOffset: number;
    endRowOffset: number;
    endColOffset: number;
  }>;
}

/**
 * A data validation rule with positions relative to clipboard origin.
 * Used for preserving validation during copy/paste operations.
 * Data Validation - Clipboard integration
 */
export interface RelativeValidation {
  /**
   * Original schema definition.
   * Contains the cell schema (type and constraints) from CellSchema.
   */
  schema: {
    type?: string;
    constraints?: Record<string, unknown>;
  };
  /**
   * Enforcement level for the validation rule.
   * Maps to EnforcementLevel: 'none' | 'info' | 'warning' | 'strict'
   */
  enforcement: 'none' | 'info' | 'warning' | 'strict';
  /**
   * UI configuration (optional).
   * Contains showDropdown and message settings.
   */
  ui?: {
    showDropdown?: boolean;
    inputMessage?: { title?: string; message?: string };
    errorMessage?: { title?: string; message?: string };
  };
  /** Range offsets relative to clipboard origin (where validation applies) */
  ranges: Array<{
    startRowOffset: number;
    startColOffset: number;
    endRowOffset: number;
    endColOffset: number;
  }>;
}

/**
 * A comment with position relative to clipboard origin.
 * Used for preserving comments during copy/paste operations.
 * Comments in Clipboard
 */
export interface RelativeComment {
  /** Offset from source origin row */
  rowOffset: number;
  /** Offset from source origin column */
  colOffset: number;
  /** Author name */
  author: string;
  /** Author ID (optional) */
  authorId?: string;
  /** Comment content (rich text as plain string for clipboard) */
  content: string;
  /** Original created timestamp */
  createdAt: number;
  /** Whether the comment was resolved */
  resolved?: boolean;
  /** Comment kind from the worksheet API. */
  commentType?: 'note' | 'threadedComment';
  /** Thread grouping for threaded comments. */
  threadId?: string | null;
  /** Parent comment ID for replies. */
  parentId?: string | null;
}

/**
 * Individual cell data in clipboard.
 *
 * Field naming follows cell-schema.ts conventions:
 * - raw: The cell value (matches CellData.raw)
 * - formula: A1-style formula string
 * - format: Cell formatting
 * - comments: Clipboard-specific comment transport (NOT the same as CellData.note)
 * - hyperlink: URL (matches CellData.hyperlink)
 */
export interface ClipboardCellData {
  raw: unknown;
  formula?: string;
  format?: CellFormat;
  /** Comments attached to this cell position */
  comments?: RelativeComment[];
  /** Hyperlink URL attached to this cell */
  hyperlink?: string;
}

// =============================================================================
// PASTE SPECIAL OPTIONS
// =============================================================================

/**
 * Options for paste special operations.
 */
export interface PasteSpecialOptions {
  /** Paste only values (no formulas) */
  values?: boolean;
  /** Paste formulas (default true) */
  formulas?: boolean;
  /** Paste formats */
  formats?: boolean;
  /** Paste data validation rules (Data Validation) */
  validation?: boolean;
  /**
   * Paste conditional formatting rules.
   * When true (default for paste all), CF rules are pasted.
   * When false (explicit), CF rules are excluded from paste.
   */
  conditionalFormatting?: boolean;
  /**
   * Paste comments.
   * When true (default for paste all), comments are pasted.
   * When false (explicit), comments are excluded from paste.
   */
  comments?: boolean;
  /** Transpose rows/columns */
  transpose?: boolean;
  /** Arithmetic operation to apply */
  operation?: 'none' | 'add' | 'subtract' | 'multiply' | 'divide';
  /** Skip blank cells in source */
  skipBlanks?: boolean;
  /** Paste as links (create formula references to source cells) */
  pasteLink?: boolean;
  /**
   * Skip hidden rows in the target when pasting.
   * When true, paste only to visible rows, skipping hidden/filtered rows.
   * This matches Excel behavior when pasting into filtered data.
   */
  skipHiddenRows?: boolean;
  /**
   * Set of target cell keys to skip during paste.
   * Keys are in format "row,col" where row/col are absolute target positions.
   * Used to skip protected cells during paste on protected sheets.
   */
  skipCells?: Set<string>;
  /**
   * Keep source column widths when pasting.
   * When true, applies source column widths to target columns.
   * Available when ClipboardData.sourceColumnWidths is present.
   */
  columnWidths?: boolean;
  /**
   * Progress callback for large paste operations.
   * Called periodically during large paste operations to report progress.
   * Useful for showing progress UI during paste of 100K+ cells.
   */
  onProgress?: (progress: {
    processed: number;
    total: number;
    percent: number;
    estimatedTimeRemaining: number | null;
  }) => void;
  /**
   * AbortSignal for cancellation support.
   * When aborted, paste operation stops and returns partial result.
   */
  signal?: AbortSignal;
}

export interface ExternalPastePayload {
  text: string;
  targetCell: CellCoord;
  targetRange?: CellRange | null;
  html?: string;
  options?: PasteSpecialOptions;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Create a cell key string from a CellCoord (for Map keys).
 */
export function cellKey(cell: CellCoord): string {
  return `${cell.row},${cell.col}`;
}

/**
 * Parse a cell key string back to CellCoord.
 */
export function parseCellKey(key: string): CellCoord {
  const [row, col] = key.split(',').map(Number);
  return { row, col };
}

/**
 * Check if two CellCoords are equal.
 */
export function cellsEqual(a: CellCoord, b: CellCoord): boolean {
  return a.row === b.row && a.col === b.col;
}

/**
 * Normalize a CellRange so startRow/startCol <= endRow/endCol.
 * Wrapper around contracts normalizeRange.
 */
export function normalizeRange(range: CellRange): CellRange {
  return normalizeRangeFromContracts(range);
}

/**
 * Check if two CellRanges are equal (same bounds).
 * Wrapper around contracts rangesEqual.
 */
export function rangesEqual(a: CellRange, b: CellRange): boolean {
  return rangesEqualFromContracts(a, b);
}

/**
 * Check if a cell is within a range.
 */
export function isCellInRange(cell: CellCoord, range: CellRange): boolean {
  return isCellInRangeFromContracts(cell.row, cell.col, range);
}

/**
 * Check if a cell is in any of the given ranges.
 */
export function isCellInRanges(cell: CellCoord, ranges: CellRange[]): boolean {
  return ranges.some((range) => isCellInRange(cell, range));
}

/**
 * Get the dimensions of a range.
 */
export function getRangeDimensions(range: CellRange): { rows: number; cols: number } {
  const normalized = normalizeRange(range);
  return {
    rows: normalized.endRow - normalized.startRow + 1,
    cols: normalized.endCol - normalized.startCol + 1,
  };
}

/**
 * Clamp a cell coordinate to valid sheet bounds.
 * Single source of truth for bounds enforcement.
 */
export function clampCell(cell: CellCoord): CellCoord {
  return {
    row: Math.max(0, Math.min(MAX_ROWS - 1, cell.row)),
    col: Math.max(0, Math.min(MAX_COLS - 1, cell.col)),
  };
}

/**
 * Move a cell reference in a direction.
 * Automatically clamps to sheet bounds (0 to MAX_ROWS-1, 0 to MAX_COLS-1).
 */
export function moveCell(cell: CellCoord, direction: Direction, amount: number = 1): CellCoord {
  switch (direction) {
    case 'up':
      return { row: Math.max(0, cell.row - amount), col: cell.col };
    case 'down':
      return { row: Math.min(MAX_ROWS - 1, cell.row + amount), col: cell.col };
    case 'left':
      return { row: cell.row, col: Math.max(0, cell.col - amount) };
    case 'right':
      return { row: cell.row, col: Math.min(MAX_COLS - 1, cell.col + amount) };
  }
}

/**
 * Move a cell in a direction, skipping hidden rows/columns.
 * Used for keyboard navigation to skip over filtered/hidden rows.
 *
 * L0.5 - Filter State Foundation
 *
 * @param cell - Starting cell position
 * @param direction - Direction to move (up/down/left/right)
 * @param amount - Number of visible cells to move (default 1)
 * @param isRowHidden - Callback to check if a row is hidden
 * @param isColHidden - Callback to check if a column is hidden
 * @returns New cell position after skipping hidden rows/cols
 */
export function moveCellSkipHidden(
  cell: CellCoord,
  direction: Direction,
  amount: number = 1,
  isRowHidden?: (row: number) => boolean,
  isColHidden?: (col: number) => boolean,
): CellCoord {
  // If no visibility callbacks, fall back to regular moveCell
  if (!isRowHidden && !isColHidden) {
    return moveCell(cell, direction, amount);
  }

  let { row, col } = cell;
  let moved = 0;

  // Safety limit to prevent infinite loops (max 10000 iterations)
  let iterations = 0;
  const maxIterations = 10000;

  while (moved < amount && iterations < maxIterations) {
    iterations++;

    // Move one step in direction
    switch (direction) {
      case 'up':
        if (row <= 0) break;
        row--;
        break;
      case 'down':
        if (row >= MAX_ROWS - 1) break;
        row++;
        break;
      case 'left':
        if (col <= 0) break;
        col--;
        break;
      case 'right':
        if (col >= MAX_COLS - 1) break;
        col++;
        break;
    }

    // Check only the moving axis. A hidden stationary column must not block
    // vertical movement within that column, and vice versa for hidden rows.
    const hiddenOnMovingAxis =
      direction === 'up' || direction === 'down'
        ? (isRowHidden?.(row) ?? false)
        : (isColHidden?.(col) ?? false);

    // If not hidden, count as a successful move
    if (!hiddenOnMovingAxis) {
      moved++;
    }

    // Safety: stop if we've hit a boundary
    if (
      (direction === 'up' && row === 0) ||
      (direction === 'down' && row === MAX_ROWS - 1) ||
      (direction === 'left' && col === 0) ||
      (direction === 'right' && col === MAX_COLS - 1)
    ) {
      // If we're at boundary and it's hidden, try to stay at visible cell
      const atHidden =
        direction === 'up' || direction === 'down'
          ? (isRowHidden?.(row) ?? false)
          : (isColHidden?.(col) ?? false);
      if (atHidden && moved === 0) {
        // Couldn't find any visible cell in that direction, stay at original
        return cell;
      }
      break;
    }
  }

  return { row, col };
}

/**
 * Convert cell reference to A1 notation: {row:0, col:0} => 'A1'
 */
export function cellToA1(cell: CellCoord): string {
  return `${colToLetter(cell.col)}${cell.row + 1}`;
}

/**
 * Convert range to A1 notation: {startRow:0, startCol:0, endRow:2, endCol:2} => 'A1:C3'
 */
export function rangeToA1(range: CellRange): string {
  return cellRangeToA1(range);
}

// =============================================================================
// FULL COLUMN/ROW RANGE UTILITIES
// =============================================================================

/**
 * Create a range representing an entire column selection.
 * Used when clicking a column header (e.g., clicking "B" selects B1:B1048576).
 */
export function createFullColumnRange(col: number): CellRange {
  return {
    startRow: 0,
    startCol: col,
    endRow: MAX_ROWS - 1,
    endCol: col,
    isFullColumn: true,
  };
}

/**
 * Create a range representing an entire row selection.
 * Used when clicking a row header (e.g., clicking "3" selects A3:XFD3).
 */
export function createFullRowRange(row: number): CellRange {
  return {
    startRow: row,
    startCol: 0,
    endRow: row,
    endCol: MAX_COLS - 1,
    isFullRow: true,
  };
}

/**
 * Create a range representing multiple entire columns.
 * Used when dragging across column headers (e.g., dragging B to D selects B:D).
 */
export function createFullColumnRangeSpan(startCol: number, endCol: number): CellRange {
  return {
    startRow: 0,
    startCol: Math.min(startCol, endCol),
    endRow: MAX_ROWS - 1,
    endCol: Math.max(startCol, endCol),
    isFullColumn: true,
  };
}

/**
 * Create a range representing multiple entire rows.
 * Used when dragging across row headers (e.g., dragging 3 to 5 selects rows 3:5).
 */
export function createFullRowRangeSpan(startRow: number, endRow: number): CellRange {
  return {
    startRow: Math.min(startRow, endRow),
    startCol: 0,
    endRow: Math.max(startRow, endRow),
    endCol: MAX_COLS - 1,
    isFullRow: true,
  };
}

/**
 * Check if a range represents a full column selection.
 */
export function isFullColumnSelection(range: CellRange): boolean {
  return range.isFullColumn === true;
}

/**
 * Check if a range represents a full row selection.
 */
export function isFullRowSelection(range: CellRange): boolean {
  return range.isFullRow === true;
}

/**
 * Create a single-cell CellRange from a CellCoord.
 */
export function singleCellRange(cell: CellCoord): CellRange {
  return {
    startRow: cell.row,
    startCol: cell.col,
    endRow: cell.row,
    endCol: cell.col,
  };
}

/**
 * Create a CellRange from anchor and current cell (for drag selection).
 */
export function rangeFromAnchorAndCell(anchor: CellCoord, current: CellCoord): CellRange {
  return normalizeRange({
    startRow: anchor.row,
    startCol: anchor.col,
    endRow: current.row,
    endCol: current.col,
  });
}

/**
 * Get the start cell (top-left) of a normalized range.
 */
export function getRangeStartCell(range: CellRange): CellCoord {
  const normalized = normalizeRange(range);
  return { row: normalized.startRow, col: normalized.startCol };
}

/**
 * Get the end cell (bottom-right) of a normalized range.
 */
export function getRangeEndCell(range: CellRange): CellCoord {
  const normalized = normalizeRange(range);
  return { row: normalized.endRow, col: normalized.endCol };
}

/**
 * Get the "moving edge" of a selection range - the corner opposite the anchor.
 *
 * When extending a selection with Shift+Arrow, the anchor stays fixed and the
 * opposite corner moves. This function finds that moving corner.
 *
 * Example:
 * - Range B3:B5 with anchor at B5: moving edge is B3 (top of range)
 * - Range B5:B7 with anchor at B5: moving edge is B7 (bottom of range)
 * - Range A5:C5 with anchor at B5: moving edge is A5 or C5 depending on direction
 *
 * The moving edge is computed by taking the corner of the range that is
 * furthest from the anchor in each dimension.
 */
export function getMovingEdge(range: CellRange, anchor: CellCoord): CellCoord {
  const normalized = normalizeRange(range);

  // For each dimension, pick the edge that is NOT at the anchor
  // If anchor is at startRow, moving edge is at endRow (and vice versa)
  // If anchor is between start and end, prefer the edge further from anchor
  const row =
    Math.abs(normalized.startRow - anchor.row) >= Math.abs(normalized.endRow - anchor.row)
      ? normalized.startRow
      : normalized.endRow;

  const col =
    Math.abs(normalized.startCol - anchor.col) >= Math.abs(normalized.endCol - anchor.col)
      ? normalized.startCol
      : normalized.endCol;

  return { row, col };
}

/**
 * True when a range semantically represents the entire worksheet.
 *
 * Select-all is not just a very large rectangle for interaction purposes: it
 * selects all row and column headers, while the active cell remains the anchor.
 * Consumers that need a navigation/follow target must not use the range's
 * bottom-right edge.
 */
export function isWholeSheetSelectionRange(range: CellRange): boolean {
  const coversAllRows = range.startRow === 0 && range.endRow === MAX_ROWS - 1;
  const coversAllCols = range.startCol === 0 && range.endCol === MAX_COLS - 1;
  return coversAllRows && coversAllCols;
}

/**
 * Resolve the cell that viewport-follow should bring into view for a selection.
 *
 * Extended selections follow the moving edge so keyboard Shift+Arrow/Page
 * remains visible. Whole-sheet select-all follows the active cell instead of
 * XFD1048576 because the full-sheet range is symbolic chrome state, not a
 * request to navigate to the worksheet's bottom-right corner.
 */
export function getSelectionViewportFollowCell(
  range: CellRange,
  activeCell: CellCoord,
  anchor: CellCoord | null,
): CellCoord {
  if (!anchor || isWholeSheetSelectionRange(range)) {
    return activeCell;
  }

  const movingEdge = getMovingEdge(range, anchor);
  const normalized = normalizeRange(range);
  const isFullRowRange =
    range.isFullRow === true && normalized.startCol === 0 && normalized.endCol === MAX_COLS - 1;
  if (isFullRowRange) {
    return { row: movingEdge.row, col: activeCell.col };
  }

  const isFullColumnRange =
    range.isFullColumn === true && normalized.startRow === 0 && normalized.endRow === MAX_ROWS - 1;
  if (isFullColumnRange) {
    return { row: activeCell.row, col: movingEdge.col };
  }

  return movingEdge;
}

// =============================================================================
// PENDING ACTIONS (for renderer queue)
// =============================================================================

/**
 * Actions that can be queued when renderer is not ready.
 * Applied when renderer transitions to 'ready' state.
 */
export type PendingAction =
  | { type: 'setSelection'; ranges: CellRange[]; activeCell: CellCoord }
  | { type: 'scrollTo'; top: number; left: number }
  | { type: 'updateRemoteCursors'; cursors: RemoteCursor[] }
  | { type: 'invalidate'; priority: RenderPriority; regions?: CellRange[] };

// =============================================================================
// METRICS
// =============================================================================

/**
 * Metric for observability.
 */
export interface Metric {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: number;
}

export { getNextFormulaRangeColor } from '@mog/spreadsheet-utils/machines/types';
