/**
 * Table Hit Testing Module
 *
 * Provides utilities for detecting which region of a table a click occurred in.
 * Delegates to ComputeBridge for table lookup, computes regions locally.
 */

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { TableConfig } from '@mog-sdk/contracts/tables';
import type { DocumentContext } from '../../context/types';
import { getTableAtCell } from './core';
import { resolveTableRange } from './range-resolution';

// =============================================================================
// Types
// =============================================================================

/**
 * Table regions for hit testing.
 */
export type TableRegion =
  | 'header' // Header row cell
  | 'data' // Data area cell
  | 'total' // Total row cell
  | 'header-left-edge' // Left edge of header cell (for row-like selection)
  | 'data-left-edge' // Left edge of data row (for row selection)
  | 'total-left-edge' // Left edge of total row cell
  | 'corner' // Top-left corner of header (for table selection)
  | 'column-resize-edge' // Right edge of header (for auto-fit on double-click)
  | 'outside'; // Not in table

/**
 * Result of table hit testing.
 */
export interface TableHitResult {
  table: TableConfig | null;
  region: TableRegion;
  cell: { row: number; col: number };
  tableRange: CellRange | null;
  tableColumnIndex: number | null;
  tableRowIndex: number | null;
}

/**
 * Options for table hit testing.
 */
export interface TableHitTestOptions {
  clickXInCell: number;
  clickYInCell: number;
  cellWidth: number;
  cellHeight: number;
}

// =============================================================================
// Constants
// =============================================================================

const LEFT_EDGE_WIDTH = 4;
const CORNER_WIDTH = 6;
const COLUMN_RESIZE_EDGE_WIDTH = 4;

// =============================================================================
// Hit Testing Functions
// =============================================================================

/**
 * Determine which region of a table was hit by a click.
 */
export async function getTableHitRegion(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  options?: TableHitTestOptions,
): Promise<TableHitResult> {
  const table = await getTableAtCell(ctx, sheetId, row, col);

  if (!table) {
    return {
      table: null,
      region: 'outside',
      cell: { row, col },
      tableRange: null,
      tableColumnIndex: null,
      tableRowIndex: null,
    };
  }

  const tableRange = resolveTableRange(ctx, table);
  if (!tableRange) {
    return {
      table: null,
      region: 'outside',
      cell: { row, col },
      tableRange: null,
      tableColumnIndex: null,
      tableRowIndex: null,
    };
  }

  // Calculate table-relative indices
  const tableColumnIndex = col - tableRange.startCol;
  const dataStartRow = table.hasHeaderRow ? tableRange.startRow + 1 : tableRange.startRow;
  const dataEndRow = table.hasTotalRow ? tableRange.endRow - 1 : tableRange.endRow;

  const isHeaderRow = table.hasHeaderRow && row === tableRange.startRow;
  const isTotalRow = table.hasTotalRow && row === tableRange.endRow;
  const isDataRow = row >= dataStartRow && row <= dataEndRow;

  const tableRowIndex = isDataRow ? row - dataStartRow : null;

  // If no sub-cell options provided, return basic region
  if (!options) {
    let region: TableRegion;
    if (isHeaderRow) {
      region = 'header';
    } else if (isTotalRow) {
      region = 'total';
    } else {
      region = 'data';
    }

    return {
      table,
      region,
      cell: { row, col },
      tableRange,
      tableColumnIndex,
      tableRowIndex,
    };
  }

  // Sub-cell hit testing for edge detection
  const { clickXInCell, clickYInCell, cellWidth, cellHeight: _cellHeight } = options;
  void _cellHeight;
  const isOnLeftEdge = clickXInCell <= LEFT_EDGE_WIDTH;
  const isOnRightEdge = clickXInCell >= cellWidth - COLUMN_RESIZE_EDGE_WIDTH;
  const isFirstColumn = col === tableRange.startCol;

  let region: TableRegion;

  if (isHeaderRow) {
    if (isFirstColumn && isOnLeftEdge && clickYInCell <= CORNER_WIDTH) {
      region = 'corner';
    } else if (isOnRightEdge) {
      region = 'column-resize-edge';
    } else if (isOnLeftEdge) {
      region = 'header-left-edge';
    } else {
      region = 'header';
    }
  } else if (isTotalRow) {
    if (isOnLeftEdge) {
      region = 'total-left-edge';
    } else {
      region = 'total';
    }
  } else {
    if (isOnLeftEdge) {
      region = 'data-left-edge';
    } else {
      region = 'data';
    }
  }

  return {
    table,
    region,
    cell: { row, col },
    tableRange,
    tableColumnIndex,
    tableRowIndex,
  };
}

/**
 * Check if a cell is in the header row of a table.
 */
export async function isTableHeaderCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  const table = await getTableAtCell(ctx, sheetId, row, col);
  if (!table || !table.hasHeaderRow) return false;

  const tableRange = resolveTableRange(ctx, table);
  if (!tableRange) return false;

  return row === tableRange.startRow;
}

/**
 * Check if a cell is in the total row of a table.
 */
export async function isTableTotalCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  const table = await getTableAtCell(ctx, sheetId, row, col);
  if (!table || !table.hasTotalRow) return false;

  const tableRange = resolveTableRange(ctx, table);
  if (!tableRange) return false;

  return row === tableRange.endRow;
}

/**
 * Check if a cell is in the data area of a table (not header or total).
 */
export async function isTableDataCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  const table = await getTableAtCell(ctx, sheetId, row, col);
  if (!table) return false;

  const range = resolveTableRange(ctx, table);
  if (!range) return false;

  const dataStartRow = table.hasHeaderRow ? range.startRow + 1 : range.startRow;
  const dataEndRow = table.hasTotalRow ? range.endRow - 1 : range.endRow;

  return row >= dataStartRow && row <= dataEndRow;
}

/**
 * Get the table at a cell and its resolved range.
 */
export async function getTableAndRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<{ table: TableConfig; range: CellRange } | null> {
  const table = await getTableAtCell(ctx, sheetId, row, col);
  if (!table) return null;

  const range = resolveTableRange(ctx, table);
  if (!range) return null;

  return { table, range };
}
