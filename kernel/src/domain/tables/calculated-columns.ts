/**
 * Tables Calculated Columns Module
 *
 * Calculated column formulas.
 * Delegates to ComputeBridge for all mutations and queries.
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { DocumentContext } from '../../context/types';
// Import from sibling modules
import { getTable, getTableAtCell } from './core';
import { resolveTableRange } from './range-resolution';

/**
 * Set a calculated column formula for a table column.
 * All data cells in the column will use this formula.
 */
export async function setCalculatedColumnFormula(
  ctx: DocumentContext,
  tableId: string,
  columnIndex: number,
  formula: string,
): Promise<void> {
  const table = await getTable(ctx, tableId);
  if (!table) return;

  if (columnIndex < 0 || columnIndex >= table.columns.length) return;

  void ctx.computeBridge.setCalculatedColumnFormula(table.name, columnIndex, formula);
}

/**
 * Clear a calculated column formula.
 */
export async function clearCalculatedColumnFormula(
  ctx: DocumentContext,
  tableId: string,
  columnIndex: number,
): Promise<void> {
  const table = await getTable(ctx, tableId);
  if (!table) return;

  if (columnIndex < 0 || columnIndex >= table.columns.length) return;

  // Clear by setting empty formula
  void ctx.computeBridge.setCalculatedColumnFormula(table.name, columnIndex, '');
}

/**
 * Get the calculated formula for a table column.
 */
export async function getCalculatedColumnFormula(
  ctx: DocumentContext,
  tableId: string,
  columnIndex: number,
): Promise<string | undefined> {
  const table = await getTable(ctx, tableId);
  if (!table) return undefined;

  if (columnIndex < 0 || columnIndex >= table.columns.length) return undefined;

  return table.columns[columnIndex].calculatedFormula;
}

/**
 * Check if a cell is in a calculated column and needs the formula applied.
 */
export async function getCalculatedFormulaForCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string | undefined> {
  const table = await getTableAtCell(ctx, sheetId, row, col);
  if (!table) return undefined;

  const range = resolveTableRange(ctx, table);
  if (!range) return undefined;

  // Only apply to data rows (not header or total)
  const dataStartRow = table.hasHeaderRow ? range.startRow + 1 : range.startRow;
  const dataEndRow = table.hasTotalRow ? range.endRow - 1 : range.endRow;

  if (row < dataStartRow || row > dataEndRow) return undefined;

  // Get column index within table
  const tableColIndex = col - range.startCol;
  if (tableColIndex < 0 || tableColIndex >= table.columns.length) return undefined;

  return table.columns[tableColIndex].calculatedFormula;
}

/**
 * Get all data cells in a table column that should receive a calculated formula.
 */
export async function getColumnDataCells(
  ctx: DocumentContext,
  tableId: string,
  columnIndex: number,
): Promise<Array<{ row: number; col: number }>> {
  const table = await getTable(ctx, tableId);
  if (!table) return [];

  const range = resolveTableRange(ctx, table);
  if (!range) return [];

  if (columnIndex < 0 || columnIndex >= table.columns.length) return [];

  const cells: Array<{ row: number; col: number }> = [];
  const dataStartRow = table.hasHeaderRow ? range.startRow + 1 : range.startRow;
  const dataEndRow = table.hasTotalRow ? range.endRow - 1 : range.endRow;
  const col = range.startCol + columnIndex;

  for (let row = dataStartRow; row <= dataEndRow; row++) {
    cells.push({ row, col });
  }

  return cells;
}
