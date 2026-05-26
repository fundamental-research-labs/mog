/**
 * Selection Handlers - Table Navigation
 *
 * Handles table-aware navigation actions:
 * - MOVE_TO_TABLE_START - Ctrl+Home when in table (goes to first data cell)
 * - MOVE_TO_TABLE_END - Ctrl+End when in table (goes to last data cell)
 * - MOVE_TO_TABLE_EDGE_UP/DOWN/LEFT/RIGHT - Ctrl+Arrow constrained to table bounds
 *
 * When cursor is inside a table, these handlers constrain navigation to table
 * boundaries (excluding header and total rows for data navigation).
 * Falls back to regular navigation when not in a table.
 *
 * Uses the unified Worksheet API (ws.tables.getAtCell()) which returns TableInfo
 * with an A1-notation range string, hasHeaders, and showTotals.
 *
 */

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { SheetId } from '@mog-sdk/contracts/core';
import { findLastUsedCell } from '../../../infra/utils';
import {
  createCellValueGetter,
  handled,
  type ActionDependencies,
  type ActionResult,
  type CellCoord,
  type Direction,
} from './helpers';

// =============================================================================
// Types
// =============================================================================

/**
 * Table bounds for navigation, derived from Worksheet API getTableAtCell() response.
 * The API returns TableInfo with an A1 range string, hasHeaders, and showTotals.
 */
interface TableBounds {
  dataStartRow: number;
  dataEndRow: number;
  startCol: number;
  endCol: number;
}

// =============================================================================
// A1 Range Parsing
// =============================================================================

/**
 * Parse an A1-notation range string (e.g. "A1:D10") into 0-based row/col bounds.
 */
function parseA1Range(
  range: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!m) return null;
  const colToIndex = (s: string): number => {
    let r = 0;
    for (const ch of s.toUpperCase()) r = r * 26 + ch.charCodeAt(0) - 64;
    return r - 1;
  };
  return {
    startCol: colToIndex(m[1]),
    startRow: +m[2] - 1,
    endCol: colToIndex(m[3]),
    endRow: +m[4] - 1,
  };
}

// =============================================================================
// Table Bounds Helper
// =============================================================================

/**
 * Helper: Get table boundary info for a cell if it's in a table.
 * Returns the table data bounds (excluding header and total rows for navigation).
 *
 * Uses the Worksheet API getTableAtCell() which returns TableInfo with an
 * A1-notation range string, hasHeaders, and showTotals.
 */
async function getTableBoundsForCell(
  deps: ActionDependencies,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<TableBounds | null> {
  const ws = deps.workbook.getSheetById(sheetId);
  const table = await ws.tables.getAtCell(row, col);
  if (!table) return null;

  const bounds = parseA1Range(table.range);
  if (!bounds) return null;

  // Calculate data row bounds (excluding header and total)
  const dataStartRow = table.hasHeaderRow ? bounds.startRow + 1 : bounds.startRow;
  const dataEndRow = table.hasTotalsRow ? bounds.endRow - 1 : bounds.endRow;

  return {
    dataStartRow,
    dataEndRow,
    startCol: bounds.startCol,
    endCol: bounds.endCol,
  };
}

// =============================================================================
// Table Start/End Navigation
// =============================================================================

/**
 * MOVE_TO_TABLE_START (Ctrl+Home when in table)
 *
 * When cursor is inside a table, Ctrl+Home goes to the first
 * data cell (top-left of data area, not the header row).
 *
 * If not in a table, falls back to A1.
 */
export const MOVE_TO_TABLE_START: AsyncActionHandler = async (deps) => {
  const activeCell = deps.accessors.selection.getActiveCell();
  const sheetId = deps.getActiveSheetId();

  const tableBounds = await getTableBoundsForCell(deps, sheetId, activeCell.row, activeCell.col);

  if (tableBounds) {
    deps.commands.selection.goTo({ row: tableBounds.dataStartRow, col: tableBounds.startCol });
  } else {
    deps.commands.selection.keyHome(true, false);
  }

  return handled();
};

/**
 * MOVE_TO_TABLE_END (Ctrl+End when in table)
 *
 * When cursor is inside a table, Ctrl+End goes to the last
 * data cell (bottom-right of data area, not the total row).
 *
 * If not in a table, falls back to last used cell.
 */
export const MOVE_TO_TABLE_END: AsyncActionHandler = async (deps) => {
  const activeCell = deps.accessors.selection.getActiveCell();
  const sheetId = deps.getActiveSheetId();

  const tableBounds = await getTableBoundsForCell(deps, sheetId, activeCell.row, activeCell.col);

  if (tableBounds) {
    deps.commands.selection.goTo({ row: tableBounds.dataEndRow, col: tableBounds.endCol });
  } else {
    const getCellValue = createCellValueGetter(deps);
    const lastUsed = findLastUsedCell(getCellValue, 10000, 1000);
    deps.commands.selection.goTo(lastUsed);
  }

  return handled();
};

// =============================================================================
// Table-Aware Edge Navigation Helpers
// =============================================================================

/**
 * Table-aware data edge navigation helper.
 *
 * Ctrl+Arrow in a table should stop at the table boundary
 * rather than continuing to the sheet boundary.
 * Includes hidden row/column awareness.
 *
 * This wraps the regular findDataEdge but constrains the search to table bounds.
 */
async function findTableAwareDataEdge(
  deps: ActionDependencies,
  startCell: CellCoord,
  direction: Direction,
): Promise<CellCoord> {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.activeSheet;

  const tableBounds = await getTableBoundsForCell(deps, sheetId, startCell.row, startCell.col);

  const edgeResult = await ws.findDataEdge(startCell.row, startCell.col, direction);

  if (!tableBounds) {
    return edgeResult;
  }

  // We are in a table - constrain navigation to table bounds
  let finalRow = edgeResult.row;
  let finalCol = edgeResult.col;

  if (direction === 'up') {
    finalRow = Math.max(finalRow, tableBounds.dataStartRow);
  } else if (direction === 'down') {
    finalRow = Math.min(finalRow, tableBounds.dataEndRow);
  } else if (direction === 'left') {
    finalCol = Math.max(finalCol, tableBounds.startCol);
  } else if (direction === 'right') {
    finalCol = Math.min(finalCol, tableBounds.endCol);
  }

  return { row: finalRow, col: finalCol };
}

/**
 * Move to table-aware data edge.
 * If in a table, stops at table boundary.
 * If not in a table, uses regular data edge behavior.
 */
async function moveToTableAwareDataEdge(
  deps: ActionDependencies,
  direction: Direction,
): Promise<ActionResult> {
  const activeCell = deps.accessors.selection.getActiveCell();

  const targetCell = await findTableAwareDataEdge(deps, activeCell, direction);
  deps.commands.selection.goTo(targetCell);

  return handled();
}

// =============================================================================
// Table Edge Navigation Handlers
// =============================================================================

/**
 * Table-aware Ctrl+Arrow handlers.
 * These replace the regular MOVE_TO_EDGE_* when table navigation is enabled.
 */
export const MOVE_TO_TABLE_EDGE_UP: AsyncActionHandler = async (deps) =>
  moveToTableAwareDataEdge(deps, 'up');
export const MOVE_TO_TABLE_EDGE_DOWN: AsyncActionHandler = async (deps) =>
  moveToTableAwareDataEdge(deps, 'down');
export const MOVE_TO_TABLE_EDGE_LEFT: AsyncActionHandler = async (deps) =>
  moveToTableAwareDataEdge(deps, 'left');
export const MOVE_TO_TABLE_EDGE_RIGHT: AsyncActionHandler = async (deps) =>
  moveToTableAwareDataEdge(deps, 'right');
