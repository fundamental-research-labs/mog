/**
 * Selection Handlers - Table Progressive Selection
 *
 * Handles progressive selection within tables:
 * - CYCLE_TABLE_COLUMN_SELECTION - Ctrl+Space in table context
 * - CYCLE_TABLE_SELECTION - Ctrl+A in table context
 *
 * Progressive selection cycles through stages of selection,
 * from column data to full column, or from table data to full table to worksheet.
 *
 * Uses the unified Worksheet API (ws.tables.getAtCell()) which returns TableInfo
 * with an A1-notation range string, hasHeaders, and showTotals.
 *
 */

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { TableInfo } from '@mog-sdk/contracts/api';
import { getUIStore, handled } from './helpers';
import { selectCurrentRegion } from './current-region';

// =============================================================================
// A1 Range Parsing
// =============================================================================

interface RangeBounds {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Parse an A1-notation range string (e.g. "A1:D10") into 0-based row/col bounds.
 */
function parseA1Range(range: string): RangeBounds | null {
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
// Inline Range Helpers (using TableInfo from Worksheet API)
// =============================================================================

/**
 * Get column data range from table info (excludes header and total rows).
 */
function getColumnDataRange(table: TableInfo, col: number): RangeBounds | null {
  const bounds = parseA1Range(table.range);
  if (!bounds) return null;
  if (col < bounds.startCol || col > bounds.endCol) return null;
  const startRow = table.hasHeaderRow ? bounds.startRow + 1 : bounds.startRow;
  const endRow = table.hasTotalsRow ? bounds.endRow - 1 : bounds.endRow;
  return { startRow, endRow, startCol: col, endCol: col };
}

/**
 * Get column data + header range from table info (excludes total row only).
 */
function getColumnWithHeaderRange(table: TableInfo, col: number): RangeBounds | null {
  const bounds = parseA1Range(table.range);
  if (!bounds) return null;
  if (col < bounds.startCol || col > bounds.endCol) return null;
  const endRow = table.hasTotalsRow ? bounds.endRow - 1 : bounds.endRow;
  return { startRow: bounds.startRow, endRow, startCol: col, endCol: col };
}

/**
 * Get full column range from table info (data + header + total).
 */
function getFullColumnRange(table: TableInfo, col: number): RangeBounds | null {
  const bounds = parseA1Range(table.range);
  if (!bounds) return null;
  if (col < bounds.startCol || col > bounds.endCol) return null;
  return {
    startRow: bounds.startRow,
    endRow: bounds.endRow,
    startCol: col,
    endCol: col,
  };
}

/**
 * Get the data range of a table (excludes header and total rows).
 */
function getDataRange(table: TableInfo): RangeBounds | null {
  const bounds = parseA1Range(table.range);
  if (!bounds) return null;
  const startRow = table.hasHeaderRow ? bounds.startRow + 1 : bounds.startRow;
  const endRow = table.hasTotalsRow ? bounds.endRow - 1 : bounds.endRow;
  return { startRow, endRow, startCol: bounds.startCol, endCol: bounds.endCol };
}

/**
 * Get the full table range (including header and total rows).
 */
function getTableRange(table: TableInfo): RangeBounds | null {
  const bounds = parseA1Range(table.range);
  if (!bounds) return null;
  return {
    startRow: bounds.startRow,
    endRow: bounds.endRow,
    startCol: bounds.startCol,
    endCol: bounds.endCol,
  };
}

// =============================================================================
// Table Progressive Selection
// =============================================================================

/**
 * CYCLE_TABLE_COLUMN_SELECTION - Ctrl+Space in table context
 *
 * Progressive Column Selection
 * - Stage 0: Select column data only (excludes header and total)
 * - Stage 1: Select column data + header
 * - Stage 2: Select full column (data + header + total)
 *
 * If not in a table, falls back to SELECT_ENTIRE_COLUMN behavior.
 */
export const CYCLE_TABLE_COLUMN_SELECTION: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();

  // Check if active cell is in a table via Worksheet API
  const ws = deps.workbook.getSheetById(sheetId);
  const table = await ws.tables.getAtCell(activeCell.row, activeCell.col);

  if (!table) {
    // Not in a table - fall back to SELECT_ENTIRE_COLUMN
    // fromKeyboard=true since this is triggered by keyboard shortcut
    deps.commands.selection.selectColumn(activeCell.col, false, false, true);
    return handled();
  }

  // Get UIStore for progressive selection state
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return handled();
  }

  const progressiveState = uiStore.getState();

  // Check if we're continuing a progressive selection on the same table/column
  const currentInfo =
    progressiveState.stage !== null &&
    progressiveState.tableId === table.name &&
    progressiveState.columnIndex === activeCell.col;

  let stage: 0 | 1 | 2;
  if (currentInfo) {
    // Advance to next stage
    progressiveState.advanceProgressiveSelection();
    stage = progressiveState.stage as 0 | 1 | 2;
  } else {
    // Start new progressive selection at stage 0
    progressiveState.startProgressiveSelection(table.name, activeCell.col);
    stage = 0;
  }

  // Get the appropriate range based on stage
  let range: { startRow: number; startCol: number; endRow: number; endCol: number } | null = null;

  switch (stage) {
    case 0:
      range = getColumnDataRange(table, activeCell.col);
      break;
    case 1:
      range = getColumnWithHeaderRange(table, activeCell.col);
      break;
    case 2:
      range = getFullColumnRange(table, activeCell.col);
      break;
  }

  if (!range) {
    return handled();
  }

  // Apply the selection
  deps.commands.selection.setSelection([range], activeCell);

  return handled();
};

/**
 * CYCLE_TABLE_SELECTION - Ctrl+A in table context
 *
 * Progressive Table Selection
 * - Stage 0: Select table data (excludes headers and totals)
 * - Stage 1: Select full table (data + headers + totals)
 * - Stage 2: Select entire worksheet
 *
 * If not in a table, falls back to SELECT_CURRENT_REGION then SELECT_ALL.
 */
export const CYCLE_TABLE_SELECTION: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();
  const ranges = deps.accessors.selection.getRanges();

  // Check if active cell is in a table via Worksheet API
  const ws = deps.workbook.getSheetById(sheetId);
  const table = await ws.tables.getAtCell(activeCell.row, activeCell.col);

  if (!table) {
    // Not in a table - fall back to SELECT_CURRENT_REGION (which handles two-press)
    return selectCurrentRegion(deps);
  }

  // Get UIStore for tracking table selection cycle
  const uiStore = getUIStore(deps);

  // Get table ranges from TableInfo A1 range
  const tableRange = getTableRange(table);
  const dataRange = getDataRange(table);
  if (!tableRange || !dataRange) return handled();

  const currentRange = ranges[0];

  // Determine current stage by comparing to known ranges
  const isDataRange =
    currentRange &&
    currentRange.startRow === dataRange.startRow &&
    currentRange.endRow === dataRange.endRow &&
    currentRange.startCol === dataRange.startCol &&
    currentRange.endCol === dataRange.endCol;

  const isFullTable =
    currentRange &&
    currentRange.startRow === tableRange.startRow &&
    currentRange.endRow === tableRange.endRow &&
    currentRange.startCol === tableRange.startCol &&
    currentRange.endCol === tableRange.endCol;

  if (isFullTable) {
    // Stage 2: Select entire worksheet
    deps.commands.selection.selectAll();
    if (uiStore) {
      uiStore.getState().resetProgressiveSelection();
    }
  } else if (isDataRange) {
    // Stage 1: Select full table
    deps.commands.selection.setSelection([tableRange], activeCell);
  } else {
    // Stage 0: Select table data
    deps.commands.selection.setSelection([dataRange], activeCell);
  }

  return handled();
};
