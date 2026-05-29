/**
 * Format Operations
 *
 * Standalone functions for cell formatting operations extracted from SheetAPI.
 * All functions take `ctx: DocumentContext` and `sheetId: SheetId` as the first two params.
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  CellAddress,
  CellFormat,
  CellRange,
  DocumentContext,
  OperationResult,
} from './shared';
import {
  invalidCellAddress,
  operationFailed,
  validateAddress,
  validateRange,
  wrapOp,
} from './shared';

import { normalizeRange } from '../../internal/utils';
import { assertFormatOperationsAllowed, assertFormatRangesAllowed } from '../protection-guards';

/**
 * Threshold for enumerating individual cells in affectedCells.
 * Above this count, we skip enumeration — the visual refresh happens
 * anyway via the compute bridge's mutation result.
 */
const AFFECTED_CELLS_THRESHOLD = 10_000;

/**
 * Build affectedCells array for a normalized range, or return an empty array
 * if the range exceeds the threshold (to avoid O(n*m) allocation).
 */
function buildAffectedCells(
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): CellAddress[] {
  const cellCount = (endRow - startRow + 1) * (endCol - startCol + 1);
  if (cellCount > AFFECTED_CELLS_THRESHOLD) {
    // Large range: skip per-cell enumeration. Visual refresh is handled
    // by the compute bridge's mutation result independently.
    return [];
  }
  const affectedCells: CellAddress[] = [];
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      affectedCells.push({ sheetId, row, col });
    }
  }
  return affectedCells;
}

/**
 * Set format for a single cell.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @param format - Format properties to apply
 * @returns OperationResult indicating success or failure
 *
 * @example
 * ```typescript
 * setFormat(ctx, sheetId, 0, 0, {
 *   bold: true,
 *   fontColor: "#FF0000",
 *   backgroundColor: "#FFFF00",
 * });
 * ```
 */
export async function setFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  format: Partial<CellFormat>,
): Promise<OperationResult<void>> {
  const invalid = validateAddress(row, col);
  if (invalid) return invalid;

  try {
    await assertFormatOperationsAllowed(ctx, sheetId, ['formatCells']);
    await ctx.computeBridge.setFormatForRanges(
      sheetId,
      [[row, col, row, col]],
      format as CellFormat,
    );
    return {
      success: true,
      data: undefined,
      affectedCells: [{ sheetId, row, col }],
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('setFormat', String(e)),
    };
  }
}

/**
 * Set format for a range.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - The range to format
 * @param format - Format properties to apply
 * @returns OperationResult indicating success or failure
 *
 * @example
 * ```typescript
 * setRangeFormat(
 *   ctx,
 *   sheetId,
 *   { startRow: 0, startCol: 0, endRow: 0, endCol: 2 },
 *   { bold: true, backgroundColor: "#CCCCCC" }
 * );
 * ```
 */
export async function setRangeFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  format: Partial<CellFormat>,
): Promise<OperationResult<void>> {
  const invalid = validateRange(range);
  if (invalid) return invalid;

  const normalized = normalizeRange(range);

  try {
    await assertFormatRangesAllowed(ctx, sheetId, [range]);
    // Single range tuple — O(1) payload regardless of range size
    await ctx.computeBridge.setFormatForRanges(
      sheetId,
      [[normalized.startRow, normalized.startCol, normalized.endRow, normalized.endCol]],
      format as CellFormat,
    );

    const affectedCells = buildAffectedCells(
      sheetId,
      normalized.startRow,
      normalized.startCol,
      normalized.endRow,
      normalized.endCol,
    );

    return { success: true, data: undefined, affectedCells };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('setRangeFormat', String(e)),
    };
  }
}

/**
 * Apply format to multiple ranges with full row/column optimization.
 * Routes to setColFormat for full columns, setRowFormat for full rows,
 * and setCellFormatForRanges for bounded selections.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param ranges - Array of CellRange objects (may include isFullColumn/isFullRow flags)
 * @param format - Format properties to apply
 * @returns OperationResult indicating success or failure
 */
export async function setFormatForRanges(
  ctx: DocumentContext,
  sheetId: SheetId,
  ranges: CellRange[],
  format: CellFormat,
): Promise<OperationResult<void>> {
  return wrapOp('setFormatForRanges', async () => {
    await assertFormatRangesAllowed(ctx, sheetId, ranges);
    const boundedRanges: Array<[number, number, number, number]> = [];
    const promises: Promise<unknown>[] = [];

    for (const range of ranges) {
      if (range.isFullColumn) {
        for (let col = range.startCol; col <= range.endCol; col++) {
          promises.push(ctx.computeBridge.setColFormat(sheetId, col, format));
        }
      } else if (range.isFullRow) {
        for (let row = range.startRow; row <= range.endRow; row++) {
          promises.push(ctx.computeBridge.setRowFormat(sheetId, row, format));
        }
      } else {
        boundedRanges.push([range.startRow, range.startCol, range.endRow, range.endCol]);
      }
    }

    if (boundedRanges.length > 0) {
      promises.push(ctx.computeBridge.setFormatForRanges(sheetId, boundedRanges, format));
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  });
}

/**
 * Set format for an entire row.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param format - Format properties to apply
 * @returns OperationResult indicating success or failure
 *
 * @example
 * ```typescript
 * setRowFormat(ctx, sheetId, 0, { bold: true, backgroundColor: "#CCCCCC" });
 * ```
 */
export async function setRowFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  format: Partial<CellFormat>,
): Promise<OperationResult<void>> {
  if (!Number.isInteger(row) || row < 0) {
    return { success: false, error: invalidCellAddress(row, 0) };
  }

  return wrapOp('setRowFormat', async () => {
    await assertFormatOperationsAllowed(ctx, sheetId, ['formatRows']);
    await ctx.computeBridge.setRowFormat(sheetId, row, format);
  });
}

/**
 * Set format for an entire column.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param col - Column index (0-based)
 * @param format - Format properties to apply
 * @returns OperationResult indicating success or failure
 *
 * @example
 * ```typescript
 * setColFormat(ctx, sheetId, 0, { bold: true, backgroundColor: "#CCCCCC" });
 * ```
 */
export async function setColFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
  format: Partial<CellFormat>,
): Promise<OperationResult<void>> {
  if (!Number.isInteger(col) || col < 0) {
    return { success: false, error: invalidCellAddress(0, col) };
  }

  return wrapOp('setColFormat', async () => {
    await assertFormatOperationsAllowed(ctx, sheetId, ['formatColumns']);
    await ctx.computeBridge.setColFormat(sheetId, col, format);
  });
}

/**
 * Clear format from a cell.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns OperationResult indicating success or failure
 */
export async function clearFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<OperationResult<void>> {
  const invalid = validateAddress(row, col);
  if (invalid) return invalid;

  try {
    await assertFormatOperationsAllowed(ctx, sheetId, ['formatCells']);
    await ctx.computeBridge.clearFormatForRanges(sheetId, [[row, col, row, col]]);
    return {
      success: true,
      data: undefined,
      affectedCells: [{ sheetId, row, col }],
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('clearFormat', String(e)),
    };
  }
}

// =============================================================================
// Format Painter: Apply format with pattern replication
// =============================================================================

/**
 * Apply format from a source range to a target range with pattern replication.
 *
 * When the target range is larger than the source range, the source format pattern
 * is tiled to fill the target (like how Excel's Format Painter works with multi-cell sources).
 *
 * For simple format application (no source range or single-cell source),
 * this function uses O(1) row/column format writes for full row/column selections.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param sourceFormat - The format to apply (used when sourceRange is null or single-cell)
 * @param sourceRange - Source range for pattern replication (can be null for simple case)
 * @param targetRange - Target range to apply formats to
 */
export async function applyFormatToRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  sourceFormat: CellFormat,
  sourceRange: CellRange | null,
  targetRange: CellRange,
): Promise<void> {
  await assertFormatRangesAllowed(ctx, sheetId, [targetRange]);
  const normalized = normalizeRange(targetRange);

  // Simple case: no source range - apply same format to all cells
  if (!sourceRange) {
    await setFormatForRanges(ctx, sheetId, [targetRange], sourceFormat);
    return;
  }

  // Calculate source dimensions
  const sourceRows = sourceRange.endRow - sourceRange.startRow + 1;
  const sourceCols = sourceRange.endCol - sourceRange.startCol + 1;

  // For single-cell source, use simple format application with optimization
  if (sourceRows === 1 && sourceCols === 1) {
    await setFormatForRanges(ctx, sheetId, [targetRange], sourceFormat);
    return;
  }

  // Multi-cell source: apply pattern replication
  // Batch-fetch all source cells in 1 IPC call
  const rangeData = await ctx.computeBridge.queryRange(
    sheetId,
    sourceRange.startRow,
    sourceRange.startCol,
    sourceRange.endRow,
    sourceRange.endCol,
  );

  // Build format lookup from batch result
  const sourceFormats: Map<string, CellFormat> = new Map();
  for (const vc of rangeData.cells) {
    if (vc.format) {
      const r = vc.row - sourceRange.startRow;
      const c = vc.col - sourceRange.startCol;
      sourceFormats.set(`${r}:${c}`, vc.format as CellFormat);
    }
  }

  // Group by format to minimize IPC calls.
  // For large ranges, we group into row-stripe ranges instead of per-cell entries.
  const formatToRanges = new Map<string, Array<[number, number, number, number]>>();

  const targetRows = normalized.endRow - normalized.startRow + 1;
  const targetCols = normalized.endCol - normalized.startCol + 1;
  const cellCount = targetRows * targetCols;

  if (cellCount > AFFECTED_CELLS_THRESHOLD) {
    // Row-stripe optimization: iterate row-by-row, grouping consecutive cells
    // with the same source format offset into contiguous row stripes.
    for (let row = normalized.startRow; row <= normalized.endRow; row++) {
      const srcRowOffset = (row - normalized.startRow) % sourceRows;

      let stripeStart: number | null = null;
      let stripeKey: string | null = null;

      for (let col = normalized.startCol; col <= normalized.endCol + 1; col++) {
        let currentKey: string | null = null;
        if (col <= normalized.endCol) {
          const srcColOffset = (col - normalized.startCol) % sourceCols;
          const key = `${srcRowOffset}:${srcColOffset}`;
          if (sourceFormats.has(key)) {
            currentKey = key;
          }
        }

        if (currentKey !== stripeKey) {
          // Flush previous stripe
          if (stripeKey !== null && stripeStart !== null) {
            let rangesForFormat = formatToRanges.get(stripeKey);
            if (!rangesForFormat) {
              rangesForFormat = [];
              formatToRanges.set(stripeKey, rangesForFormat);
            }
            rangesForFormat.push([row, stripeStart, row, col - 1]);
          }
          stripeStart = currentKey !== null ? col : null;
          stripeKey = currentKey;
        }
      }
    }
  } else {
    // Small range: per-cell grouping (original behavior)
    for (let row = normalized.startRow; row <= normalized.endRow; row++) {
      for (let col = normalized.startCol; col <= normalized.endCol; col++) {
        const srcRowOffset = (row - normalized.startRow) % sourceRows;
        const srcColOffset = (col - normalized.startCol) % sourceCols;
        const key = `${srcRowOffset}:${srcColOffset}`;

        const format = sourceFormats.get(key);
        if (format) {
          let rangesForFormat = formatToRanges.get(key);
          if (!rangesForFormat) {
            rangesForFormat = [];
            formatToRanges.set(key, rangesForFormat);
          }
          rangesForFormat.push([row, col, row, col]);
        }
      }
    }
  }

  // Fire one IPC call per distinct source format
  const ipcPromises: Promise<unknown>[] = [];
  for (const [key, ranges] of formatToRanges) {
    const format = sourceFormats.get(key)!;
    ipcPromises.push(ctx.computeBridge.setFormatForRanges(sheetId, ranges, format));
  }
  await Promise.all(ipcPromises);
}

// =============================================================================
// Bulk Property Operations
// =============================================================================

/**
 * Get row-level formats for the specified rows.
 *
 * Returns a Map from row index to CellFormat (only rows with explicit
 * formats are included; rows with no format are omitted).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param rows - Row indices (0-based)
 * @returns Map of row index to CellFormat
 */
export async function getRowProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  rows: number[],
): Promise<OperationResult<Map<number, CellFormat>>> {
  return wrapOp('getRowProperties', async () => {
    const result: Array<[number, CellFormat | null]> = await ctx.computeBridge.getRowFormats(
      sheetId,
      rows,
    );
    const map = new Map<number, CellFormat>();
    for (const [row, fmt] of result) {
      if (fmt != null) {
        map.set(row, fmt);
      }
    }
    return map;
  });
}

/**
 * Set row-level formats for multiple rows.
 *
 * Each entry maps a row index to a CellFormat. Formats merge with
 * existing row formats on a per-property basis.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param updates - Map of row index to CellFormat
 * @returns OperationResult indicating success or failure
 */
export async function setRowProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  updates: Map<number, CellFormat>,
): Promise<OperationResult<void>> {
  return wrapOp('setRowProperties', async () => {
    await assertFormatOperationsAllowed(ctx, sheetId, ['formatRows']);
    const entries: Array<[number, CellFormat]> = Array.from(updates.entries());
    await ctx.computeBridge.setRowFormats(sheetId, entries);
  });
}

/**
 * Get column-level formats for the specified columns.
 *
 * Returns a Map from column index to CellFormat (only columns with
 * explicit formats are included).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cols - Column indices (0-based)
 * @returns Map of column index to CellFormat
 */
export async function getColumnProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  cols: number[],
): Promise<OperationResult<Map<number, CellFormat>>> {
  return wrapOp('getColumnProperties', async () => {
    const result: Array<[number, CellFormat | null]> = await ctx.computeBridge.getColFormats(
      sheetId,
      cols,
    );
    const map = new Map<number, CellFormat>();
    for (const [col, fmt] of result) {
      if (fmt != null) {
        map.set(col, fmt);
      }
    }
    return map;
  });
}

/**
 * Set column-level formats for multiple columns.
 *
 * Each entry maps a column index to a CellFormat. Formats merge with
 * existing column formats on a per-property basis.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param updates - Map of column index to CellFormat
 * @returns OperationResult indicating success or failure
 */
export async function setColumnProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  updates: Map<number, CellFormat>,
): Promise<OperationResult<void>> {
  return wrapOp('setColumnProperties', async () => {
    await assertFormatOperationsAllowed(ctx, sheetId, ['formatColumns']);
    const entries: Array<[number, CellFormat]> = Array.from(updates.entries());
    await ctx.computeBridge.setColFormats(sheetId, entries);
  });
}

/**
 * Get effective (resolved) cell formats for a rectangular range.
 *
 * Returns a 2D array (row-major) where each element is the fully resolved
 * format from the 5-layer cascade (default -> col -> row -> table -> cell).
 * Cells with no explicit format may return null.
 *
 * Range is capped at 10,000 cells (Rust guard).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - The range to query
 * @returns 2D array of CellFormat (or null for cells with default format)
 */
export async function getCellProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<OperationResult<Array<Array<CellFormat | null>>>> {
  const invalid = validateRange(range);
  if (invalid) return invalid;

  const normalized = normalizeRange(range);

  return wrapOp('getCellProperties', () =>
    ctx.computeBridge.queryRangeProperties(
      sheetId,
      normalized.startRow,
      normalized.startCol,
      normalized.endRow,
      normalized.endCol,
    ),
  );
}

/**
 * Set cell formats for a batch of individual cells with heterogeneous formats.
 *
 * Unlike setRangeFormat (which applies one format to all cells), this allows
 * each cell to receive a different format. Formats merge with existing cell
 * formats on a per-property basis.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param updates - Array of {row, col, format} entries
 * @returns OperationResult indicating success or failure
 */
export async function setCellProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  updates: Array<{ row: number; col: number; format: CellFormat }>,
): Promise<OperationResult<void>> {
  return wrapOp('setCellProperties', async () => {
    await assertFormatOperationsAllowed(ctx, sheetId, ['formatCells']);
    const tuples: Array<[number, number, CellFormat]> = updates.map((u) => [
      u.row,
      u.col,
      u.format,
    ]);
    await ctx.computeBridge.setCellPropertiesBatch(sheetId, tuples);
  });
}

// =============================================================================
// Displayed (CF-merged) Cell Properties
// =============================================================================

/**
 * Get the "displayed" format for a single cell.
 *
 * Returns the fully-resolved format after all cascading and conditional
 * formatting rules are applied:
 * 1. 5-layer cascade: default -> column -> row -> table -> cell
 * 2. Theme color resolution
 * 3. CF merge (6th layer)
 *
 * This is the format a user would visually see in the spreadsheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns The displayed CellFormat
 */
export async function getDisplayedCellProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<OperationResult<CellFormat>> {
  const invalid = validateAddress(row, col);
  if (invalid) return invalid;

  return wrapOp('getDisplayedCellProperties', () =>
    ctx.computeBridge.getDisplayedCellProperties(sheetId, row, col),
  );
}

/**
 * Get displayed (CF-merged) cell formats for a rectangular range.
 *
 * Returns a 2D array (row-major) where each element is the fully-resolved
 * format after all cascading and conditional formatting:
 * 1. 5-layer cascade: default -> column -> row -> table -> cell
 * 2. Theme color resolution
 * 3. CF merge (6th layer)
 *
 * Range is capped at 10,000 cells (Rust guard).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - The range to query
 * @returns 2D array of displayed CellFormat
 */
export async function getDisplayedRangeProperties(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<OperationResult<CellFormat[][]>> {
  const invalid = validateRange(range);
  if (invalid) return invalid;

  const normalized = normalizeRange(range);

  return wrapOp('getDisplayedRangeProperties', () =>
    ctx.computeBridge.getDisplayedRangeProperties(
      sheetId,
      normalized.startRow,
      normalized.startCol,
      normalized.endRow,
      normalized.endCol,
    ),
  );
}
