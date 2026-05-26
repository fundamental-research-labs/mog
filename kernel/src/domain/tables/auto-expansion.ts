/**
 * Tables Auto-Expansion Module (Kernel Domain)
 *
 * Excel-compatible Auto-expansion feature.
 * Delegates to ComputeBridge for auto-expansion detection and application.
 */

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { TableConfig } from '@mog-sdk/contracts/tables';
import type { DocumentContext } from '../../context/types';
import { getTable, getTablesInSheet, isInTable } from './core';
import { renameColumn, resizeTable } from './operations';
import { resolveTableRange } from './range-resolution';

/**
 * Check if a cell is immediately adjacent to a table (for auto-expansion).
 * Returns the table and the direction of adjacency.
 */
export async function getAdjacentTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<{ table: TableConfig; direction: 'bottom' | 'right' } | undefined> {
  const tables = await getTablesInSheet(ctx, sheetId);

  for (const table of tables) {
    if (!table.autoExpand) continue;

    const range = resolveTableRange(ctx, table);
    if (!range) continue;

    const isImmediatelyBelow =
      row === range.endRow + 1 && col >= range.startCol && col <= range.endCol;

    if (isImmediatelyBelow) {
      return { table, direction: 'bottom' };
    }

    const dataStartRow = table.hasHeaderRow ? range.startRow + 1 : range.startRow;
    const dataEndRow = table.hasTotalRow ? range.endRow - 1 : range.endRow;
    const isImmediatelyRight = col === range.endCol + 1 && row >= dataStartRow && row <= dataEndRow;

    if (isImmediatelyRight) {
      return { table, direction: 'right' };
    }
  }

  return undefined;
}

/**
 * Auto-expand a table to include a new row at the bottom.
 */
export async function autoExpandTableRow(ctx: DocumentContext, tableId: string): Promise<boolean> {
  const table = await getTable(ctx, tableId);
  if (!table || !table.autoExpand) return false;

  const range = resolveTableRange(ctx, table);
  if (!range) return false;

  const newEndRow = range.endRow + 1;

  const newRange: CellRange = {
    ...range,
    endRow: newEndRow,
  };

  await resizeTable(ctx, tableId, newRange);

  return true;
}

/**
 * Auto-expand a table to include a new column on the right.
 */
export async function autoExpandTableColumn(
  ctx: DocumentContext,
  tableId: string,
  newColumnName?: string,
): Promise<boolean> {
  const table = await getTable(ctx, tableId);
  if (!table || !table.autoExpand) return false;

  const range = resolveTableRange(ctx, table);
  if (!range) return false;

  const newRange: CellRange = {
    ...range,
    endCol: range.endCol + 1,
  };

  const columnName = newColumnName || `Column${table.columns.length + 1}`;

  await resizeTable(ctx, tableId, newRange);

  const updatedTable = await getTable(ctx, tableId);
  if (updatedTable && updatedTable.columns.length > table.columns.length) {
    const newColumnIndex = updatedTable.columns.length - 1;
    if (updatedTable.columns[newColumnIndex].name !== columnName) {
      await renameColumn(ctx, tableId, newColumnIndex, columnName);
    }
  }

  return true;
}

/**
 * Check if a setCellValue operation should trigger table auto-expansion.
 */
export async function checkAutoExpansion(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<{ table: TableConfig; direction: 'bottom' | 'right' } | undefined> {
  if (await isInTable(ctx, sheetId, row, col)) return undefined;
  return await getAdjacentTable(ctx, sheetId, row, col);
}
