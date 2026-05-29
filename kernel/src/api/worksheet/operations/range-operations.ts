/**
 * Range Operations Module
 *
 * Standalone functions for range-related operations (get, set, clear).
 * All functions take DocumentContext and sheetId as the first two parameters.
 *
 * @see sheet-api.ts for class-based API that wraps these functions
 */

import type { ClearResult } from '@mog-sdk/contracts/api';
import type { FormulaA1 } from '@mog-sdk/contracts/cells';
import type { SheetId } from '@mog-sdk/contracts/core';

import { KernelError } from '../../../errors';
import { normalizeRange } from '../../internal/utils';

import { normalizeCellValue } from '../../internal/value-conversions';
import { prepareExternalFormulaWrite } from '../../../services/external-formulas';
import type { CellData, CellRange, CellValue, CellValuePrimitive, DocumentContext } from './shared';
import { invalidRange, isValidAddress, isValidRange } from './shared';
import { toCellInput } from './cell-input';

// Re-export validation utilities from types for convenience
export { isValidAddress, isValidRange } from './shared';

// ==========================================================================
// Range Read Operations
// ==========================================================================

/**
 * Get all cell data in a range.
 *
 * Uses a single batch IPC call (queryRange) instead of per-cell calls.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - The range to read
 * @returns 2D array of CellData
 */
export async function getRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<CellData[][]> {
  const normalized = normalizeRange(range);

  const rangeResult = await ctx.computeBridge.queryRange(
    sheetId,
    normalized.startRow,
    normalized.startCol,
    normalized.endRow,
    normalized.endCol,
  );

  // Build lookup map from flat cells array
  const cellMap = new Map<string, (typeof rangeResult.cells)[number]>();
  for (const cell of rangeResult.cells) {
    cellMap.set(`${cell.row},${cell.col}`, cell);
  }

  // Reshape into 2D array
  const result: CellData[][] = [];
  for (let row = normalized.startRow; row <= normalized.endRow; row++) {
    const rowData: CellData[] = [];
    for (let col = normalized.startCol; col <= normalized.endCol; col++) {
      const cell = cellMap.get(`${row},${col}`);
      if (!cell) {
        rowData.push({ value: null });
      } else {
        const value = normalizeCellValue(cell.value);
        rowData.push({
          value: value ?? null,
          formula: cell.formula as FormulaA1 | undefined,
          format: cell.format ?? undefined,
          formatted: cell.formatted ?? undefined,
        });
      }
    }
    result.push(rowData);
  }
  return result;
}

/**
 * Get just the values from a range.
 *
 * Uses a single batch IPC call (queryRange) instead of per-cell calls.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - The range to read
 * @returns 2D array of values
 */
export async function getRangeValues(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<CellValue[][]> {
  const normalized = normalizeRange(range);

  // Single bridge call returns dense 2D array — replaces queryRange + reshape + normalize
  const raw = await ctx.computeBridge.getRangeValues2d(
    sheetId,
    normalized.startRow,
    normalized.startCol,
    normalized.endRow,
    normalized.endCol,
  );
  // Normalize error objects to display strings for API consumers
  return raw.map((row) => row.map((v) => normalizeCellValue(v) ?? null));
}

/**
 * Get just the formulas from a range.
 *
 * Uses a single batch IPC call (queryRange) instead of per-cell calls.
 * Returns null for cells that are not formula cells (plain values or empty).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - The range to read
 * @returns 2D array where each element is a formula string or null
 */
export async function getRangeFormulas(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<(string | null)[][]> {
  const normalized = normalizeRange(range);

  const rangeResult = await ctx.computeBridge.queryRange(
    sheetId,
    normalized.startRow,
    normalized.startCol,
    normalized.endRow,
    normalized.endCol,
  );

  const cellMap = new Map<string, (typeof rangeResult.cells)[number]>();
  for (const cell of rangeResult.cells) {
    cellMap.set(`${cell.row},${cell.col}`, cell);
  }

  const result: (string | null)[][] = [];
  for (let row = normalized.startRow; row <= normalized.endRow; row++) {
    const rowData: (string | null)[] = [];
    for (let col = normalized.startCol; col <= normalized.endCol; col++) {
      const cell = cellMap.get(`${row},${col}`);
      rowData.push(cell?.formula ?? null);
    }
    result.push(rowData);
  }
  return result;
}

// ==========================================================================
// Range Write Operations
// ==========================================================================

/**
 * Sets cell values starting at (startRow, startCol).
 *
 * Writes only the cells covered by the provided data array. Positions beyond
 * the data dimensions are not modified (ragged arrays are supported — each row
 * can have different column counts).
 *
 * To clear unfilled positions explicitly, pad the array with `null` values.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Starting row (0-based)
 * @param startCol - Starting column (0-based)
 * @param values - 2D array of values
 * @throws KernelError if the start address is invalid
 *
 * @example
 * ```typescript
 * setRange(ctx, sheetId, 0, 0, [
 *   ["Name", "Score", "Grade"],
 *   ["Alice", 100, "A"],
 *   ["Bob", 95, "A"],
 * ]);
 * ```
 */
export async function setRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  values: CellValuePrimitive[][],
): Promise<void> {
  if (!isValidAddress(startRow, startCol)) {
    throw KernelError.from(
      null,
      'COMPUTE_ERROR',
      `Invalid cell address: row=${startRow}, col=${startCol}`,
    );
  }

  if (!values.length || !values[0].length) {
    return;
  }

  const edits: Parameters<typeof ctx.computeBridge.setCellsByPosition>[1] = [];

  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const row = startRow + r;
      const col = startCol + c;
      const value = values[r][c];
      const preparedValue = await prepareExternalFormulaWrite(ctx, sheetId, row, col, value);
      // Route every SDK value through the shared helper so the
      // Literal/Parse/Clear distinction is preserved structurally — no
      // in-band \x00 sentinels.
      edits.push({ row, col, input: toCellInput(preparedValue as CellValuePrimitive) });
    }
  }

  await ctx.computeBridge.setCellsByPosition(sheetId, edits);
}

/**
 * Clear all values in a range.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - The range to clear
 * @returns ClearResult with cell count
 * @throws KernelError on invalid range; bridge errors propagate directly
 */
export async function clearRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<ClearResult> {
  if (!isValidRange(range)) {
    throw invalidRange(range.startRow, range.startCol, range.endRow, range.endCol);
  }

  const normalized = normalizeRange(range);

  await ctx.computeBridge.clearRangeByPosition(
    sheetId,
    normalized.startRow,
    normalized.startCol,
    normalized.endRow,
    normalized.endCol,
  );

  const cellCount =
    (normalized.endRow - normalized.startRow + 1) * (normalized.endCol - normalized.startCol + 1);

  return { cellCount };
}
