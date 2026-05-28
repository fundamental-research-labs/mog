/**
 * Table Operations Module
 *
 * Standalone functions for table operations extracted from SheetAPI.
 * All mutation functions take DocumentContext as the first parameter.
 * Query functions that are workbook-scoped (by name) omit sheetId.
 *
 * @see sheet-api.ts - Main SheetAPI class that delegates to these functions
 */

import type { TableInfo } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { Table, TableHitRegion } from '../../../bridges/compute/compute-types.gen';
import type { TableDef } from '../../../bridges/compute/compute-wire-types';
import { colToLetter, letterToCol } from '../../internal/utils';
import type { DocumentContext, OperationResult } from './shared';
import { invalidRange, operationFailed, wrapOp } from './shared';
import { toCellInput } from './cell-input';
import {
  publicTableStyleId,
  tableStyleIdForCompute,
} from '../../../domain/tables/style-normalization';

// Re-export TableInfo so consumers can import from this module
export type { TableInfo } from '@mog-sdk/contracts/api';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse an A1 range string (e.g., "A1:D10") into numeric bounds (0-based).
 */
function parseA1Range(
  range: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    startCol: letterToCol(match[1]),
    startRow: parseInt(match[2], 10) - 1, // 1-based to 0-based
    endCol: letterToCol(match[3]),
    endRow: parseInt(match[4], 10) - 1,
  };
}

/**
 * Convert a bridge Table (from Rust via compute-table) into a TableInfo.
 * Converts range from SheetRange to A1 notation and built-in style IDs to
 * public table style presets. Other fields pass through directly.
 */
export function bridgeTableToTableInfo(table: Table): TableInfo {
  const startLetter = colToLetter(table.range.startCol);
  const endLetter = colToLetter(table.range.endCol);
  const startRowA1 = table.range.startRow + 1; // 0-based to 1-based
  const endRowA1 = table.range.endRow + 1;
  const range = `${startLetter}${startRowA1}:${endLetter}${endRowA1}`;

  return {
    ...table,
    displayName: table.displayName || table.name,
    columns: table.columns.map((col) => ({ ...col })),
    range,
    style: publicTableStyleId(table.style) ?? table.style,
  };
}

// =============================================================================
// Query Operations
// =============================================================================

/**
 * Get the table definition at a specific cell, or null if no table exists there.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns TableInfo if a table exists at the cell, null otherwise
 */
export async function getTableAtCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<TableInfo | null> {
  const table = await ctx.computeBridge.getTableAtCell(sheetId, row, col);
  if (!table) {
    return null;
  }
  return bridgeTableToTableInfo(table);
}

/**
 * Get a table definition by its name.
 * Tables are workbook-scoped, so no sheetId is needed.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table
 * @returns TableInfo if found, null otherwise
 */
export async function getTableByName(
  ctx: DocumentContext,
  tableName: string,
): Promise<TableInfo | null> {
  try {
    const table = await ctx.computeBridge.getTableByName(tableName);
    if (!table) {
      return null;
    }
    return bridgeTableToTableInfo(table);
  } catch {
    return null;
  }
}

/**
 * Get all tables in a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Array of TableInfo objects
 */
export async function getAllTablesInSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<TableInfo[]> {
  const tables = await ctx.computeBridge.getAllTablesInSheet(sheetId);
  return tables.map((t) => bridgeTableToTableInfo(t));
}

/**
 * Get the table hit region at a specific cell for table UI interactions.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns Hit region info or null
 */
export async function getTableHitRegion(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<TableHitRegion | null> {
  return ctx.computeBridge.getTableHitRegion(sheetId, row, col);
}

// =============================================================================
// Mutation Operations
// =============================================================================

/**
 * Remove a table by name. This removes the table definition and converts back to a plain range.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table to remove
 * @returns OperationResult indicating success or failure
 */
export async function removeTable(
  ctx: DocumentContext,
  tableName: string,
): Promise<OperationResult<void>> {
  return wrapOp('removeTable', async () => {
    await ctx.computeBridge.deleteTable(tableName);
  });
}

/**
 * Resize a table to new boundaries.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table to resize
 * @param bounds - New boundaries (0-based, inclusive)
 * @returns OperationResult indicating success or failure
 */
export async function resizeTable(
  ctx: DocumentContext,
  tableName: string,
  bounds: Pick<CellRange, 'startRow' | 'startCol' | 'endRow' | 'endCol'>,
): Promise<OperationResult<void>> {
  const { startRow, startCol, endRow, endCol } = bounds;
  if (startRow < 0 || startCol < 0 || endRow < startRow || endCol < startCol) {
    return {
      success: false,
      error: invalidRange(startRow, startCol, endRow, endCol),
    };
  }

  return wrapOp('resizeTable', async () => {
    await ctx.computeBridge.resizeTable(tableName, startRow, startCol, endRow, endCol);
  });
}

/**
 * Set a table's visual style.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table
 * @param styleName - Style name to apply (e.g., "TableStyleLight1")
 * @returns OperationResult indicating success or failure
 */
export async function setTableStyle(
  ctx: DocumentContext,
  tableName: string,
  styleName: string,
): Promise<OperationResult<void>> {
  return wrapOp('setTableStyle', async () => {
    await ctx.computeBridge.setTableStyle(
      tableName,
      tableStyleIdForCompute(styleName) ?? styleName,
    );
  });
}

/**
 * Rename a table.
 *
 * @param ctx - Store context
 * @param oldName - Current table name
 * @param newName - New table name
 * @returns OperationResult indicating success or failure
 */
export async function renameTable(
  ctx: DocumentContext,
  oldName: string,
  newName: string,
): Promise<OperationResult<void>> {
  return wrapOp('renameTable', async () => {
    await ctx.computeBridge.renameTable(oldName, newName);
  });
}

/**
 * Add a column to a table.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table
 * @param columnName - Name for the new column
 * @param position - Column position (0-based index)
 * @returns OperationResult indicating success or failure
 */
export async function addTableColumn(
  ctx: DocumentContext,
  tableName: string,
  columnName: string,
  position: number,
): Promise<OperationResult<void>> {
  return wrapOp('addTableColumn', async () => {
    await ctx.computeBridge.addTableColumn(tableName, columnName, position);
  });
}

/**
 * Remove a column from a table by index.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table
 * @param columnIndex - Index of the column to remove (0-based)
 * @returns OperationResult indicating success or failure
 */
export async function removeTableColumn(
  ctx: DocumentContext,
  tableName: string,
  columnIndex: number,
): Promise<OperationResult<void>> {
  return wrapOp('removeTableColumn', async () => {
    await ctx.computeBridge.removeTableColumn(tableName, columnIndex);
  });
}

/**
 * Create or update a table definition via setTable.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID (used as table.sheet)
 * @param table - TableDef to create/update
 * @returns OperationResult indicating success or failure
 */
export async function createTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  table: TableDef,
): Promise<OperationResult<void>> {
  return wrapOp('createTable', async () => {
    await ctx.computeBridge.createTable(
      sheetId,
      table.name,
      table.start_row,
      table.start_col,
      table.end_row,
      table.end_col,
      table.columns,
      table.has_headers,
    );
  });
}

/**
 * Toggle the totals row on a table.
 * Bridge: toggleTotalsRow(tableName) → MutationResult
 */
export async function toggleTotalsRow(
  ctx: DocumentContext,
  tableName: string,
): Promise<OperationResult<void>> {
  return wrapOp('toggleTotalsRow', async () => {
    await ctx.computeBridge.toggleTotalsRow(tableName);
  });
}

/**
 * Toggle the header row on a table.
 * Bridge: toggleHeaderRow(tableName) → MutationResult
 */
export async function toggleHeaderRow(
  ctx: DocumentContext,
  tableName: string,
): Promise<OperationResult<void>> {
  return wrapOp('toggleHeaderRow', async () => {
    await ctx.computeBridge.toggleHeaderRow(tableName);
  });
}

/**
 * Apply auto-expansion to a table.
 * Bridge: applyAutoExpansion(sheetId, tableName) → MutationResult
 */
export async function applyAutoExpansion(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableName: string,
): Promise<OperationResult<void>> {
  return wrapOp('applyAutoExpansion', async () => {
    await ctx.computeBridge.applyAutoExpansion(sheetId, tableName);
  });
}

/**
 * Get all data cell positions for a table column.
 * Pure computation: reads table def, computes data row range, returns positions.
 *
 * @param table - TableInfo (from getTableByName or getTableAtCell)
 * @param colIndex - Column index within the table (0-based)
 * @returns Array of { row, col } positions for all data cells in the column
 */
export function getTableColumnDataCellsFromInfo(
  table: TableInfo,
  colIndex: number,
): Array<{ row: number; col: number }> {
  const parsed = parseA1Range(table.range);
  if (!parsed) return [];

  // Data rows = all rows except header (if hasHeaderRow) and totals (if hasTotalsRow)
  const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
  const dataEndRow = table.hasTotalsRow ? parsed.endRow - 1 : parsed.endRow;

  if (dataStartRow > dataEndRow) return [];

  // Column position = startCol + colIndex
  const col = parsed.startCol + colIndex;
  if (col > parsed.endCol) return [];

  const cells: Array<{ row: number; col: number }> = [];
  for (let row = dataStartRow; row <= dataEndRow; row++) {
    cells.push({ row, col });
  }
  return cells;
}

// =============================================================================
// Sub-Range Helpers
// =============================================================================

/**
 * Compute the A1-notation range for the data body of a table.
 *
 * The data body excludes the header row (if present) and the totals row (if present).
 * Returns null if the table has no data body rows (e.g., only header + totals).
 *
 * @param table - TableInfo object
 * @returns A1-notation range string, or null if no data rows exist
 */
export function getDataBodyRangeFromInfo(table: TableInfo): string | null {
  const parsed = parseA1Range(table.range);
  if (!parsed) return null;

  const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
  const dataEndRow = table.hasTotalsRow ? parsed.endRow - 1 : parsed.endRow;

  if (dataStartRow > dataEndRow) return null;

  const startLetter = colToLetter(parsed.startCol);
  const endLetter = colToLetter(parsed.endCol);
  return `${startLetter}${dataStartRow + 1}:${endLetter}${dataEndRow + 1}`;
}

/**
 * Compute the A1-notation range for the header row of a table.
 *
 * Returns null if the table has no header row (`hasHeaders` is false).
 *
 * @param table - TableInfo object
 * @returns A1-notation range string, or null if the table has no header row
 */
export function getHeaderRowRangeFromInfo(table: TableInfo): string | null {
  if (!table.hasHeaderRow) return null;

  const parsed = parseA1Range(table.range);
  if (!parsed) return null;

  const startLetter = colToLetter(parsed.startCol);
  const endLetter = colToLetter(parsed.endCol);
  const headerRow = parsed.startRow + 1; // 0-based to 1-based
  return `${startLetter}${headerRow}:${endLetter}${headerRow}`;
}

/**
 * Compute the A1-notation range for the totals row of a table.
 *
 * Returns null if the table has no totals row (`hasTotalsRow` is false).
 *
 * @param table - TableInfo object
 * @returns A1-notation range string, or null if the table has no totals row
 */
export function getTotalRowRangeFromInfo(table: TableInfo): string | null {
  if (!table.hasTotalsRow) return null;

  const parsed = parseA1Range(table.range);
  if (!parsed) return null;

  const startLetter = colToLetter(parsed.startCol);
  const endLetter = colToLetter(parsed.endCol);
  const totalRow = parsed.endRow + 1; // 0-based to 1-based
  return `${startLetter}${totalRow}:${endLetter}${totalRow}`;
}

/**
 * Set a calculated column formula for a table column.
 * Fills all data cells in the column with the given formula via batch IPC.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param tableName - Table name
 * @param colIndex - Column index within the table (0-based)
 * @param formula - The formula to set (e.g., "=[@Price]*[@Quantity]")
 * @returns OperationResult indicating success or failure
 */
export async function setCalculatedColumnFormula(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableName: string,
  colIndex: number,
  formula: string,
): Promise<OperationResult<void>> {
  const table = await getTableByName(ctx, tableName);
  if (!table) {
    return {
      success: false,
      error: operationFailed('setCalculatedColumnFormula', 'Table not found'),
    };
  }

  const cells = getTableColumnDataCellsFromInfo(table, colIndex);
  if (cells.length === 0) return { success: true, data: undefined };

  return wrapOp('setCalculatedColumnFormula', async () => {
    const edits = cells.map(({ row, col }) => ({ row, col, input: toCellInput(formula) }));
    await ctx.computeBridge.setCellsByPosition(sheetId, edits);
  });
}

/**
 * Clear a calculated column formula from a table column.
 * Clears formulas from all data cells in the column, replacing them with empty values.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param tableName - Table name
 * @param colIndex - Column index within the table (0-based)
 * @returns OperationResult indicating success or failure
 */
export async function clearCalculatedColumnFormula(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableName: string,
  colIndex: number,
): Promise<OperationResult<void>> {
  const table = await getTableByName(ctx, tableName);
  if (!table) {
    return {
      success: false,
      error: operationFailed('clearCalculatedColumnFormula', 'Table not found'),
    };
  }

  const cells = getTableColumnDataCellsFromInfo(table, colIndex);
  if (cells.length === 0) return { success: true, data: undefined };

  return wrapOp('clearCalculatedColumnFormula', async () => {
    const edits = cells.map(({ row, col }) => ({ row, col, input: toCellInput(null) }));
    await ctx.computeBridge.setCellsByPosition(sheetId, edits);
  });
}
