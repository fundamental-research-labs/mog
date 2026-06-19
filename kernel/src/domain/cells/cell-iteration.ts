/**
 * Cell Iteration Module
 *
 * Functions for traversing cells, clearing ranges, relocating cells, and detecting regions.
 *
 * Write operations delegate to ComputeBridge (Rust compute core).
 * Read operations are async, querying ComputeBridge.
 * MutationResultHandler handles event emission -- no manual event emission here.
 *
 * RESPONSIBILITIES:
 * - Iterate cells (all cells, cells in range)
 * - Clear cell ranges (via ComputeBridge.batchClearCells)
 * - Relocate cells (via ComputeBridge.relocateCells)
 * - Current region detection (via ComputeBridge queries)
 *
 */

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { FormulaA1 } from '@mog-sdk/contracts/cells';
import type {
  CellError,
  CellRange,
  CellRawValue,
  CellValue,
  SheetId,
} from '@mog-sdk/contracts/core';

import type { StoreCellData } from '@mog-sdk/contracts/store';
import type { DocumentContext } from '../../context/types';

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Convert a CellValue (now plain JSON primitive from Rust) to a raw value suitable for StoreCellData.
 * After wire unification, Rust sends plain primitives: number, string, boolean, null,
 * or error objects { type: 'error', value: 'Div0' }.
 */
export function computeValueToRaw(value: CellValue | undefined): CellRawValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value;
  // Error objects
  if (typeof value === 'object' && 'type' in value && value.type === 'error') {
    return null;
  }
  return null;
}

/**
 * Convert a CellValue (now plain JSON primitive from Rust) to a CellValue for the computed field.
 */
export function computeValueToCellValue(value: CellValue | undefined): CellValue | undefined {
  if (value === null || value === undefined) return undefined;
  // Plain primitives and error objects are already CellValue
  return value;
}

// =============================================================================
// Clear Cells
// =============================================================================

/**
 * Clear cells in a range.
 * Clears both cell values and properties (metadata), but preserves format.
 *
 * Delegates to ComputeBridge.batchClearCells(). Rust handles:
 * - Converting cells to marker cells (preserves CellId for formulas)
 * - Format preservation
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row (inclusive)
 * @param startCol - Start column (inclusive)
 * @param endRow - End row (inclusive)
 * @param endCol - End column (inclusive)
 */
export function clearRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): void {
  // Collect cell IDs in range and clear them via CB
  void (async () => {
    const rangeData = await ctx.computeBridge.queryRange(
      sheetId,
      startRow,
      startCol,
      endRow,
      endCol,
    );

    const cellIds: CellId[] = [];
    if (rangeData?.cells) {
      for (const cell of rangeData.cells) {
        if (cell.cellId) {
          cellIds.push(toCellId(cell.cellId));
        }
      }
    }

    if (cellIds.length > 0) {
      void ctx.computeBridge.batchClearCells(cellIds);
    }
  })();
}

/**
 * Clear all cells in a range and return their CellIds.
 * Accepts CellRange object (convenience overload of clearRange).
 *
 * Used by cell relocation operations to clear target cells before moving.
 * Unlike clearRange, this:
 * - Takes a CellRange object
 * - Returns the CellIds that were cleared
 * - Fully deletes cells (no format preservation)
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - Cell range to clear
 * @param excludeCellIds - Optional set of CellIds to NOT clear (for overlapping moves)
 * @returns Array of CellIds that were cleared
 */
export async function clearRangeAndReturnIds(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  excludeCellIds?: Set<CellId>,
): Promise<CellId[]> {
  const rangeData = await ctx.computeBridge.queryRange(
    sheetId,
    range.startRow,
    range.startCol,
    range.endRow,
    range.endCol,
  );

  const cellIds: CellId[] = [];
  if (rangeData?.cells) {
    for (const cell of rangeData.cells) {
      if (cell.cellId) {
        const cellId = toCellId(cell.cellId);
        if (excludeCellIds?.has(cellId)) continue;
        cellIds.push(cellId);
      }
    }
  }

  if (cellIds.length > 0) {
    void ctx.computeBridge.batchClearCells(cellIds);
  }

  return cellIds;
}

// =============================================================================
// Cell Relocation (Cut-Paste, Drag-Move)
// =============================================================================

/**
 * Result of a cell relocation operation.
 */
export interface RelocationResult {
  /** CellIds that were moved to new positions */
  movedCellIds: CellId[];
  /** CellIds that were cleared at target (not part of the move) */
  targetCellsCleared: CellId[];
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Relocate cells from source range to target position.
 *
 * Delegates to ComputeBridge.relocateCellsYrs() — the yrs-routed mutation
 * handler `mutation_relocate_cells` which emits Null patches for vacated
 * source positions and write patches for every target position. Same path
 * the cross-sheet variant uses; same-sheet is just `targetSheetId === sourceSheetId`.
 *
 * Rust handles:
 * - CellId preservation (stable identities)
 * - Position updates
 * - Grid index rebuild
 * - Formula reference updates
 * - Target cell clearing
 * - Source viewport-buffer clear (Null `CellChange` per vacated cell)
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sourceSheetId - Source sheet ID
 * @param sourceRange - Source range to move
 * @param targetSheetId - Target sheet ID (may equal sourceSheetId for same-sheet move)
 * @param targetStart - Top-left of target range
 * @param _options - Optional settings (handled by Rust)
 * @returns RelocationResult with moved CellIds and cleared CellIds
 */
export async function relocateCells(
  ctx: DocumentContext,
  sourceSheetId: SheetId,
  sourceRange: CellRange,
  targetSheetId: SheetId,
  targetStart: { row: number; col: number },
  _options: { clearTarget?: boolean } = { clearTarget: true },
): Promise<RelocationResult> {
  try {
    await ctx.computeBridge.relocateCellsYrs(
      sourceSheetId,
      sourceRange.startRow,
      sourceRange.startCol,
      sourceRange.endRow,
      sourceRange.endCol,
      targetSheetId,
      targetStart.row,
      targetStart.col,
    );

    return {
      movedCellIds: [],
      targetCellsCleared: [],
      success: true,
    };
  } catch (err) {
    return {
      movedCellIds: [],
      targetCellsCleared: [],
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// Iterate Cells
// =============================================================================

/**
 * Iterate over all non-empty cells in a sheet.
 *
 * Queries ComputeBridge for all cells in the sheet's data bounds,
 * then calls the callback for each cell.
 *
 * NOTE: This is async because it queries the ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param callback - Called for each non-empty cell
 */
export async function forEach(
  ctx: DocumentContext,
  sheetId: SheetId,
  callback: (row: number, col: number, data: StoreCellData) => void,
): Promise<void> {
  // Get data bounds to know the full range
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);
  if (!bounds) return;

  const rangeData = await ctx.computeBridge.queryRange(
    sheetId,
    bounds.minRow,
    bounds.minCol,
    bounds.maxRow,
    bounds.maxCol,
  );

  if (!rangeData?.cells) return;

  for (const cell of rangeData.cells) {
    const cellData: StoreCellData = {
      id: toCellId(cell.cellId),
      row: cell.row,
      col: cell.col,
      raw: computeValueToRaw(cell.value),
      computed: computeValueToCellValue(cell.value),
      formula: cell.formula as FormulaA1 | undefined,
      hyperlink: cell.hyperlinkUrl,
    };
    callback(cell.row, cell.col, cellData);
  }
}

/**
 * Iterate over cells in a specific range.
 *
 * Queries ComputeBridge for cells in the range, then calls the callback
 * for each position (including empty cells).
 *
 * NOTE: This is async because it queries the ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row (inclusive)
 * @param startCol - Start column (inclusive)
 * @param endRow - End row (inclusive)
 * @param endCol - End column (inclusive)
 * @param callback - Called for each cell in range (including empty cells)
 */
export async function forEachInRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  callback: (row: number, col: number, data: StoreCellData | undefined) => void,
): Promise<void> {
  const rangeData = await ctx.computeBridge.queryRange(sheetId, startRow, startCol, endRow, endCol);

  // Build cell lookup map
  const cellMap = new Map<string, any>();
  if (rangeData?.cells) {
    for (const cell of rangeData.cells) {
      cellMap.set(`${cell.row},${cell.col}`, cell);
    }
  }

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const cell = cellMap.get(`${row},${col}`);
      if (cell) {
        const cellData: StoreCellData = {
          id: toCellId(cell.cellId),
          row: cell.row,
          col: cell.col,
          raw: computeValueToRaw(cell.value),
          computed: computeValueToCellValue(cell.value),
          formula: cell.formula as FormulaA1 | undefined,
          hyperlink: cell.hyperlinkUrl,
        };
        callback(row, col, cellData);
      } else {
        callback(row, col, undefined);
      }
    }
  }
}

// =============================================================================
// Current Region Detection
// =============================================================================

/**
 * Get the current region around a cell.
 * The current region is the contiguous block of cells containing data
 * that surrounds the specified cell, bounded by empty rows/columns.
 *
 * This is what Excel selects with Ctrl+Shift+* (Select Current Region).
 *
 * Queries ComputeBridge to read cell values for expansion.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Starting row
 * @param startCol - Starting column
 * @param maxRow - Maximum row to search (prevents infinite search)
 * @param maxCol - Maximum column to search
 * @returns Range of the current region, or single cell if cell is empty
 */
export async function getCurrentRegion(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  maxRow: number = 10000,
  maxCol: number = 500,
): Promise<CellRange> {
  // First, get the data bounds to limit our search
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);
  if (!bounds) {
    return { sheetId, startRow, startCol, endRow: startRow, endCol: startCol };
  }

  // Constrain search to the provider-reported data bounds. Current-region
  // detection must see deferred/imported data beyond the viewport and beyond
  // the old 1000-row sampling window.
  const searchMinRow = Math.max(0, Math.min(startRow, bounds.minRow));
  const searchMinCol = Math.max(0, Math.min(startCol, bounds.minCol));
  const searchMaxRow = Math.min(maxRow, Math.max(startRow, bounds.maxRow));
  const searchMaxCol = Math.min(maxCol, Math.max(startCol, bounds.maxCol));

  const rangeData = await ctx.computeBridge.queryRange(
    sheetId,
    searchMinRow,
    searchMinCol,
    searchMaxRow,
    searchMaxCol,
  );

  // Build set of non-empty positions
  const nonEmpty = new Set<string>();
  if (rangeData?.cells) {
    for (const cell of rangeData.cells) {
      const value = cell.value;
      if ((value !== null && value !== undefined) || cell.formula) {
        nonEmpty.add(`${cell.row},${cell.col}`);
      }
    }
  }

  const hasData = (row: number, col: number): boolean => nonEmpty.has(`${row},${col}`);

  // Check if start cell has data
  const startHasData = hasData(startRow, startCol);

  // Initialize bounds
  let top = startRow;
  let bottom = startRow;
  let left = startCol;
  let right = startCol;

  // If start cell is empty, check adjacent cells
  if (!startHasData) {
    const hasDataAbove = startRow > 0 && hasData(startRow - 1, startCol);
    const hasDataBelow = startRow < searchMaxRow && hasData(startRow + 1, startCol);
    const hasDataLeft = startCol > 0 && hasData(startRow, startCol - 1);
    const hasDataRight = startCol < searchMaxCol && hasData(startRow, startCol + 1);

    if (!hasDataAbove && !hasDataBelow && !hasDataLeft && !hasDataRight) {
      return { sheetId, startRow, startCol, endRow: startRow, endCol: startCol };
    }
  }

  // Keep expanding until no more non-empty cells found
  let expanded = true;
  while (expanded) {
    expanded = false;

    // Try expanding up
    if (top > 0) {
      let rowHasData = false;
      for (let col = left; col <= right; col++) {
        if (hasData(top - 1, col)) {
          rowHasData = true;
          break;
        }
      }
      if (rowHasData) {
        top--;
        expanded = true;
      }
    }

    // Try expanding down
    if (bottom < searchMaxRow) {
      let rowHasData = false;
      for (let col = left; col <= right; col++) {
        if (hasData(bottom + 1, col)) {
          rowHasData = true;
          break;
        }
      }
      if (rowHasData) {
        bottom++;
        expanded = true;
      }
    }

    // Try expanding left
    if (left > 0) {
      let colHasData = false;
      for (let row = top; row <= bottom; row++) {
        if (hasData(row, left - 1)) {
          colHasData = true;
          break;
        }
      }
      if (colHasData) {
        left--;
        expanded = true;
      }
    }

    // Try expanding right
    if (right < searchMaxCol) {
      let colHasData = false;
      for (let row = top; row <= bottom; row++) {
        if (hasData(row, right + 1)) {
          colHasData = true;
          break;
        }
      }
      if (colHasData) {
        right++;
        expanded = true;
      }
    }
  }

  return {
    sheetId,
    startRow: top,
    startCol: left,
    endRow: bottom,
    endCol: right,
  };
}

/**
 * Constrain a full column/row selection to actual data bounds.
 *
 * When a user selects an entire column (by clicking the header) and performs
 * an operation like sort, Excel behavior is to detect the actual data range
 * and operate only on that, not all 1M+ rows.
 *
 * For normal selections (not full column/row), returns the range unchanged.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - The selection range (may be full column/row with isFullColumn/isFullRow flags)
 * @returns Constrained range with actual data bounds, or null if no data found
 */
export async function getDataBoundsForRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<CellRange | null> {
  // If not a full column/row selection, use range as-is
  if (!range.isFullColumn && !range.isFullRow) {
    return range;
  }

  const bounds = await ctx.computeBridge.getDataBounds(sheetId);
  if (!bounds) return null;

  if (range.isFullColumn) {
    // Constrain to actual data rows
    const dataRegion = await getCurrentRegion(ctx, sheetId, bounds.minRow, range.startCol);

    return {
      sheetId,
      startRow: dataRegion.startRow,
      startCol: range.startCol,
      endRow: dataRegion.endRow,
      endCol: range.endCol,
    };
  }

  if (range.isFullRow) {
    // Constrain to actual data columns
    const dataRegion = await getCurrentRegion(ctx, sheetId, range.startRow, bounds.minCol);

    return {
      sheetId,
      startRow: range.startRow,
      startCol: dataRegion.startCol,
      endRow: range.endRow,
      endCol: dataRegion.endCol,
    };
  }

  return range;
}
