/**
 * Tables Selection Module (Kernel Domain)
 *
 * Excel-compatible Column selection helpers for progressive selection.
 * Used for Ctrl+Space progressive selection within table columns.
 *
 * Copied from spreadsheet-model/src/tables/selection.ts
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type { TableConfig } from '@mog-sdk/contracts/tables';
import type { DocumentContext } from '../../context/types';
import { resolveTableRange } from './range-resolution';

/**
 * Get the data-only range for a specific column within a table.
 * Used for Ctrl+Space stage 0: select column data only.
 */
export function getColumnDataRange(
  ctx: DocumentContext,
  table: TableConfig,
  col: number,
): CellRange | null {
  const tableRange = resolveTableRange(ctx, table);
  if (!tableRange) return null;

  if (col < tableRange.startCol || col > tableRange.endCol) return null;

  const startRow = table.hasHeaderRow ? tableRange.startRow + 1 : tableRange.startRow;
  const endRow = table.hasTotalRow ? tableRange.endRow - 1 : tableRange.endRow;

  return {
    sheetId: table.sheetId,
    startRow,
    endRow,
    startCol: col,
    endCol: col,
  };
}

/**
 * Get the data + header range for a specific column within a table.
 * Used for Ctrl+Space stage 1: select column data + header.
 */
export function getColumnWithHeaderRange(
  ctx: DocumentContext,
  table: TableConfig,
  col: number,
): CellRange | null {
  const tableRange = resolveTableRange(ctx, table);
  if (!tableRange) return null;

  if (col < tableRange.startCol || col > tableRange.endCol) return null;

  const startRow = tableRange.startRow;
  const endRow = table.hasTotalRow ? tableRange.endRow - 1 : tableRange.endRow;

  return {
    sheetId: table.sheetId,
    startRow,
    endRow,
    startCol: col,
    endCol: col,
  };
}

/**
 * Get the full column range (data + header + total) for a specific column.
 * Used for Ctrl+Space stage 2: select entire column including all rows.
 */
export function getFullColumnRange(
  ctx: DocumentContext,
  table: TableConfig,
  col: number,
): CellRange | null {
  const tableRange = resolveTableRange(ctx, table);
  if (!tableRange) return null;

  if (col < tableRange.startCol || col > tableRange.endCol) return null;

  return {
    sheetId: table.sheetId,
    startRow: tableRange.startRow,
    endRow: tableRange.endRow,
    startCol: col,
    endCol: col,
  };
}

/**
 * Get the data row range (single row across all data columns).
 * Used for left-edge clicks on data rows.
 */
export function getTableRowRange(
  ctx: DocumentContext,
  table: TableConfig,
  row: number,
): CellRange | null {
  const tableRange = resolveTableRange(ctx, table);
  if (!tableRange) return null;

  const dataStartRow = table.hasHeaderRow ? tableRange.startRow + 1 : tableRange.startRow;
  const dataEndRow = table.hasTotalRow ? tableRange.endRow - 1 : tableRange.endRow;

  if (row < dataStartRow || row > dataEndRow) return null;

  return {
    sheetId: table.sheetId,
    startRow: row,
    endRow: row,
    startCol: tableRange.startCol,
    endCol: tableRange.endCol,
  };
}

/**
 * Get the table data range (all data cells, excludes header and total).
 * Used for corner click stage 0: select table data only.
 */
export function getTableDataRange(ctx: DocumentContext, table: TableConfig): CellRange | null {
  const tableRange = resolveTableRange(ctx, table);
  if (!tableRange) return null;

  const startRow = table.hasHeaderRow ? tableRange.startRow + 1 : tableRange.startRow;
  const endRow = table.hasTotalRow ? tableRange.endRow - 1 : tableRange.endRow;

  return {
    sheetId: table.sheetId,
    startRow,
    endRow,
    startCol: tableRange.startCol,
    endCol: tableRange.endCol,
  };
}

/**
 * Get the full table range (header + data + total).
 * Used for corner click stage 1: select entire table.
 */
export function getFullTableRange(ctx: DocumentContext, table: TableConfig): CellRange | null {
  const tableRange = resolveTableRange(ctx, table);
  if (!tableRange) return null;

  return {
    sheetId: table.sheetId,
    startRow: tableRange.startRow,
    endRow: tableRange.endRow,
    startCol: tableRange.startCol,
    endCol: tableRange.endCol,
  };
}
