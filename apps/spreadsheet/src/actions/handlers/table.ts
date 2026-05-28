/**
 * Table Action Handlers
 *
 * Handlers for table operations: remove duplicates, convert to range,
 * toggle filter buttons, insert rows/columns, custom styles, resize.
 *
 *
 * Architecture Compliance:
 * - Unified Action System: All operations through dispatch()
 * - Action Handler Registration: HANDLER_MAP pattern
 * - State Management: Reads direct, Writes through Mutations/domain modules
 * - UI Store Patterns: Slices for dialog state
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { TableInfo, TableStyleConfig, Workbook, Worksheet } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

import type { UIState } from '../../ui-store/types';

// =============================================================================
// Table ID Resolution Helper
// =============================================================================

/**
 * Resolve a tableId from a payload or from the active cell.
 *
 * If `payload?.tableId` exists, returns it directly.
 * Otherwise, gets the active cell from the selection and looks up the
 * table at that cell position via the Worksheet tables API.
 *
 * @returns The tableId string, or null if no table could be resolved.
 */
async function resolveTableId(
  deps: ActionDependencies,
  payload?: { tableId?: string },
): Promise<string | null> {
  if (payload?.tableId) {
    return payload.tableId;
  }

  // Fall back to the table at the active cell
  const activeCell = deps.accessors.selection.getActiveCell();
  if (!activeCell) return null;

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const table = await ws.tables.getAtCell(activeCell.row, activeCell.col);
  return table?.name ?? null;
}

// =============================================================================
// Inline Table Range Helpers (using TableInfo from Worksheet API)
// =============================================================================

/** Column data range (excludes header and total rows). */
function getColumnDataRange(table: TableInfo, col: number): CellRange | null {
  const range = parseA1Range(table.range);
  if (!range) return null;
  if (col < range.startCol || col > range.endCol) return null;
  const startRow = table.hasHeaderRow ? range.startRow + 1 : range.startRow;
  const endRow = table.hasTotalsRow ? range.endRow - 1 : range.endRow;
  return { startRow, endRow, startCol: col, endCol: col };
}

/** Column data + header range (excludes total row only). */
function getColumnWithHeaderRange(table: TableInfo, col: number): CellRange | null {
  const range = parseA1Range(table.range);
  if (!range) return null;
  if (col < range.startCol || col > range.endCol) return null;
  const endRow = table.hasTotalsRow ? range.endRow - 1 : range.endRow;
  return { startRow: range.startRow, endRow, startCol: col, endCol: col };
}

/** Full column range (data + header + total). */
function getFullColumnRange(table: TableInfo, col: number): CellRange | null {
  const range = parseA1Range(table.range);
  if (!range) return null;
  if (col < range.startCol || col > range.endCol) return null;
  return { startRow: range.startRow, endRow: range.endRow, startCol: col, endCol: col };
}

/** Table data range (excludes header and total rows). */
function getDataRange(table: TableInfo): CellRange | null {
  const range = parseA1Range(table.range);
  if (!range) return null;
  const startRow = table.hasHeaderRow ? range.startRow + 1 : range.startRow;
  const endRow = table.hasTotalsRow ? range.endRow - 1 : range.endRow;
  return { startRow, endRow, startCol: range.startCol, endCol: range.endCol };
}

/** Full table range (header + data + total). */
function getTableRange(table: TableInfo): CellRange | null {
  return parseA1Range(table.range);
}

/** Single data row range across all table columns. */
function getTableRowRange(table: TableInfo, row: number): CellRange | null {
  const range = parseA1Range(table.range);
  if (!range) return null;
  const dataStart = table.hasHeaderRow ? range.startRow + 1 : range.startRow;
  const dataEnd = table.hasTotalsRow ? range.endRow - 1 : range.endRow;
  if (row < dataStart || row > dataEnd) return null;
  return { startRow: row, endRow: row, startCol: range.startCol, endCol: range.endCol };
}

// =============================================================================
// Workbook Table Lookup Helper (replacing TablesCore.getTable + TablesRangeResolution)
// =============================================================================

/** Convert 0-based column index to column letters (A, B, ..., Z, AA, ...). */
function colIndexToLetter(index: number): string {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

/** Convert column letters (A, B, ..., Z, AA, ...) to 0-based index. */
function colLetterToIndex(letters: string): number {
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  }
  return result - 1;
}

/** Parse an A1 range string (e.g., "A1:D10") into numeric bounds (0-based). */
function parseA1Range(
  range: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const parts = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!parts) return null;
  return {
    startCol: colLetterToIndex(parts[1]),
    startRow: parseInt(parts[2], 10) - 1,
    endCol: colLetterToIndex(parts[3]),
    endRow: parseInt(parts[4], 10) - 1,
  };
}

/**
 * Find a table by name across all sheets using the unified Worksheet API.
 * Returns the worksheet, table info, and parsed numeric range bounds.
 */
async function findTableInWorkbook(
  wb: Workbook,
  tableId: string,
): Promise<{ ws: Worksheet; table: TableInfo; range: CellRange } | null> {
  for (const name of await wb.getSheetNames()) {
    const ws = await wb.getSheet(name);
    const table = await ws.tables.get(tableId);
    if (table) {
      const range = parseA1Range(table.range);
      if (!range) return null;
      return { ws, table, range };
    }
  }
  return null;
}

// =============================================================================
// Dialog Handlers
// =============================================================================

/**
 * CLOSE_REMOVE_DUPLICATES_DIALOG
 *
 * Closes the remove duplicates dialog.
 * Note: OPEN is handled by data-tools slice which is already wired.
 */
export const CLOSE_REMOVE_DUPLICATES_DIALOG: ActionHandler = (
  deps: ActionDependencies,
): ActionResult => {
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (!uiStore) {
    return { handled: false, error: 'UIStore not available' };
  }

  const state = uiStore.getState();
  state.closeRemoveDuplicatesDialog();

  return { handled: true };
};

/**
 * OPEN_CUSTOM_TABLE_STYLE_DIALOG
 *
 * Opens the custom table style editor dialog.
 *
 * Payload:
 * - tableId?: string - Optional table ID for context (editing existing style)
 * - baseStyleId?: string - Optional base style to start from
 */
export const OPEN_CUSTOM_TABLE_STYLE_DIALOG: ActionHandler = (
  deps: ActionDependencies,
  payload?: {
    tableId?: string;
    baseStyleId?: string;
  },
): ActionResult => {
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (!uiStore) {
    return { handled: false, error: 'UIStore not available' };
  }

  const state = uiStore.getState();
  if (typeof state.openCustomTableStyleDialog === 'function') {
    state.openCustomTableStyleDialog(payload?.tableId, payload?.baseStyleId);
  }

  return { handled: true };
};

/**
 * CLOSE_CUSTOM_TABLE_STYLE_DIALOG
 *
 * Closes the custom table style editor dialog.
 */
export const CLOSE_CUSTOM_TABLE_STYLE_DIALOG: ActionHandler = (
  deps: ActionDependencies,
): ActionResult => {
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (!uiStore) {
    return { handled: false, error: 'UIStore not available' };
  }

  const state = uiStore.getState();
  if (typeof state.closeCustomTableStyleDialog === 'function') {
    state.closeCustomTableStyleDialog();
  }

  return { handled: true };
};

/**
 * OPEN_RESIZE_TABLE_DIALOG
 *
 * Opens the resize table dialog.
 *
 * Payload:
 * - tableId: string - The table to resize
 */
export const OPEN_RESIZE_TABLE_DIALOG: ActionHandler = (
  deps: ActionDependencies,
  payload?: { tableId: string },
): ActionResult => {
  if (!payload?.tableId) {
    return {
      handled: false,
      error: 'OPEN_RESIZE_TABLE_DIALOG requires payload with tableId',
    };
  }

  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (!uiStore) {
    return { handled: false, error: 'UIStore not available' };
  }

  const state = uiStore.getState();
  if (typeof state.openResizeTableDialog === 'function') {
    state.openResizeTableDialog(payload.tableId);
  }

  return { handled: true };
};

/**
 * CLOSE_RESIZE_TABLE_DIALOG
 *
 * Closes the resize table dialog.
 */
export const CLOSE_RESIZE_TABLE_DIALOG: ActionHandler = (
  deps: ActionDependencies,
): ActionResult => {
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (!uiStore) {
    return { handled: false, error: 'UIStore not available' };
  }

  const state = uiStore.getState();
  if (typeof state.closeResizeTableDialog === 'function') {
    state.closeResizeTableDialog();
  }

  return { handled: true };
};

/**
 * OPEN_CONVERT_TO_RANGE_DIALOG
 *
 * Opens the convert to range confirmation dialog.
 *
 * Payload:
 * - tableId?: string - The table to convert (resolved from active cell if omitted)
 */
export const OPEN_CONVERT_TO_RANGE_DIALOG: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId?: string },
): Promise<ActionResult> => {
  const tableId = await resolveTableId(deps, payload);
  if (!tableId) {
    return { handled: false, error: 'no-table' };
  }

  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (!uiStore) {
    return { handled: false, error: 'UIStore not available' };
  }

  const state = uiStore.getState();
  if (typeof state.openConvertToRangeDialog === 'function') {
    state.openConvertToRangeDialog(tableId);
  }

  return { handled: true };
};

/**
 * CLOSE_CONVERT_TO_RANGE_DIALOG
 *
 * Closes the convert to range confirmation dialog.
 */
export const CLOSE_CONVERT_TO_RANGE_DIALOG: ActionHandler = (
  deps: ActionDependencies,
): ActionResult => {
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (!uiStore) {
    return { handled: false, error: 'UIStore not available' };
  }

  const state = uiStore.getState();
  if (typeof state.closeConvertToRangeDialog === 'function') {
    state.closeConvertToRangeDialog();
  }

  return { handled: true };
};

// =============================================================================
// Table Operation Handlers
// =============================================================================

/**
 * CONVERT_TO_RANGE
 *
 * Converts a table back to a regular range.
 * Removes table formatting but keeps cell data.
 *
 * Payload (optional):
 * - tableId?: string - The table to convert (resolved from active cell if omitted)
 */
export const CONVERT_TO_RANGE: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId?: string },
): Promise<ActionResult> => {
  const tableId = await resolveTableId(deps, payload);
  if (!tableId) {
    return { handled: false, error: 'no-table' };
  }

  // Use unified Worksheet API: find table across sheets, then convert table
  // metadata through the compute conversion path.
  const found = await findTableInWorkbook(deps.workbook, tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${tableId}` };
  }
  await found.ws.tables.convertToRange(tableId);

  // Close the dialog if it's open
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (uiStore) {
    const state = uiStore.getState();
    if (typeof state.closeConvertToRangeDialog === 'function') {
      state.closeConvertToRangeDialog();
    }
  }

  return { handled: true };
};

/**
 * TOGGLE_FILTER_BUTTONS
 *
 * Toggles the filter button visibility on a table.
 *
 * Payload:
 * - tableId: string - The table to toggle
 */
export const TOGGLE_FILTER_BUTTONS: ActionHandler = (
  _deps: ActionDependencies,
  payload?: { tableId: string },
): ActionResult => {
  if (!payload?.tableId) {
    return {
      handled: false,
      error: 'TOGGLE_FILTER_BUTTONS requires payload with tableId',
    };
  }

  // No ws equivalent — toggleFilterButtons is a table-metadata operation not on the Worksheet interface.
  // This is a no-op pending future API addition.
  console.warn(
    '[table handlers] TOGGLE_FILTER_BUTTONS: no unified API equivalent for tableId:',
    payload.tableId,
  );

  return { handled: true };
};

/**
 * RESIZE_TABLE
 *
 * Resizes a table to a new range.
 *
 * Payload:
 * - tableId: string - The table to resize
 * - newRange: CellRange - The new range for the table
 */
export const RESIZE_TABLE: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId: string; newRange: CellRange },
): Promise<ActionResult> => {
  if (!payload?.tableId || !payload?.newRange) {
    return {
      handled: false,
      error: 'RESIZE_TABLE requires payload with tableId and newRange',
    };
  }

  // Use unified Worksheet API: find table across sheets, then resizeTable
  const found = await findTableInWorkbook(deps.workbook, payload.tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${payload.tableId}` };
  }

  // Convert CellRange to A1 notation for ws.resizeTable
  const { startRow, startCol, endRow, endCol } = payload.newRange;
  const startColLetter = colIndexToLetter(startCol);
  const endColLetter = colIndexToLetter(endCol);
  const newRangeA1 = `${startColLetter}${startRow + 1}:${endColLetter}${endRow + 1}`;
  await found.ws.tables.resize(payload.tableId, newRangeA1);

  // Close the dialog if it's open
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (uiStore) {
    const state = uiStore.getState();
    if (typeof state.closeResizeTableDialog === 'function') {
      state.closeResizeTableDialog();
    }
  }

  return { handled: true };
};

/**
 * INSERT_TABLE_ROW_ABOVE
 *
 * Inserts a new row above the current selection in a table.
 * The table automatically expands to include the new row.
 *
 * Payload:
 * - tableId: string - The table to modify
 * - rowIndex: number - The absolute row index to insert above
 */
export const INSERT_TABLE_ROW_ABOVE: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId: string; rowIndex: number },
): Promise<ActionResult> => {
  if (!payload?.tableId || payload?.rowIndex === undefined) {
    return {
      handled: false,
      error: 'INSERT_TABLE_ROW_ABOVE requires payload with tableId and rowIndex',
    };
  }

  // Use unified Worksheet API: find table, parse range, validate, insert
  const found = await findTableInWorkbook(deps.workbook, payload.tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${payload.tableId}` };
  }

  const { ws, table, range: tableRange } = found;

  // Validate: cannot insert above header row
  if (table.hasHeaderRow && payload.rowIndex <= tableRange.startRow) {
    return { handled: false, error: 'Cannot insert above the header row' };
  }

  await ws.structure.insertRows(payload.rowIndex, 1);

  return { handled: true };
};

/**
 * INSERT_TABLE_ROW_BELOW
 *
 * Inserts a new row below the current selection in a table.
 * The table automatically expands to include the new row.
 *
 * Payload:
 * - tableId: string - The table to modify
 * - rowIndex: number - The absolute row index to insert below
 */
export const INSERT_TABLE_ROW_BELOW: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId: string; rowIndex: number },
): Promise<ActionResult> => {
  if (!payload?.tableId || payload?.rowIndex === undefined) {
    return {
      handled: false,
      error: 'INSERT_TABLE_ROW_BELOW requires payload with tableId and rowIndex',
    };
  }

  // Use unified Worksheet API: find table, parse range, validate, insert
  const found = await findTableInWorkbook(deps.workbook, payload.tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${payload.tableId}` };
  }

  const { ws, table, range: tableRange } = found;

  // Calculate data area boundaries
  const dataStartRow = table.hasHeaderRow ? tableRange.startRow + 1 : tableRange.startRow;
  const dataEndRow = table.hasTotalsRow ? tableRange.endRow - 1 : tableRange.endRow;

  // Validate: row must be in data area or at the end
  if (payload.rowIndex < dataStartRow || payload.rowIndex > dataEndRow) {
    return { handled: false, error: 'Row must be within the table data area' };
  }

  await ws.structure.insertRows(payload.rowIndex + 1, 1);

  return { handled: true };
};

/**
 * INSERT_TABLE_COLUMN_LEFT
 *
 * Inserts a new column to the left of the current selection in a table.
 * The table automatically expands to include the new column.
 *
 * Payload:
 * - tableId: string - The table to modify
 * - columnIndex: number - The absolute column index to insert left of
 */
export const INSERT_TABLE_COLUMN_LEFT: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId: string; columnIndex: number },
): Promise<ActionResult> => {
  if (!payload?.tableId || payload?.columnIndex === undefined) {
    return {
      handled: false,
      error: 'INSERT_TABLE_COLUMN_LEFT requires payload with tableId and columnIndex',
    };
  }

  // Use unified Worksheet API: find table, parse range, validate, insert
  const found = await findTableInWorkbook(deps.workbook, payload.tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${payload.tableId}` };
  }

  const { ws, table, range: tableRange } = found;

  // Validate: column must be within the table
  if (payload.columnIndex < tableRange.startCol || payload.columnIndex > tableRange.endCol) {
    return { handled: false, error: 'Column must be within the table' };
  }

  await ws.structure.insertColumns(payload.columnIndex, 1);

  // Use Worksheet API to add table column
  const relativeColIndex = payload.columnIndex - tableRange.startCol;
  const columnName = `Column${table.columns.length + 1}`;
  await ws.tables.addColumn(table.name, columnName, relativeColIndex);

  return { handled: true };
};

/**
 * INSERT_TABLE_COLUMN_RIGHT
 *
 * Inserts a new column to the right of the current selection in a table.
 * The table automatically expands to include the new column.
 *
 * Payload:
 * - tableId: string - The table to modify
 * - columnIndex: number - The absolute column index to insert right of
 */
export const INSERT_TABLE_COLUMN_RIGHT: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId: string; columnIndex: number },
): Promise<ActionResult> => {
  if (!payload?.tableId || payload?.columnIndex === undefined) {
    return {
      handled: false,
      error: 'INSERT_TABLE_COLUMN_RIGHT requires payload with tableId and columnIndex',
    };
  }

  // Use unified Worksheet API: find table, parse range, validate, insert
  const found = await findTableInWorkbook(deps.workbook, payload.tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${payload.tableId}` };
  }

  const { ws, table, range: tableRange } = found;

  // Validate: column must be within the table
  if (payload.columnIndex < tableRange.startCol || payload.columnIndex > tableRange.endCol) {
    return { handled: false, error: 'Column must be within the table' };
  }

  await ws.structure.insertColumns(payload.columnIndex + 1, 1);

  // Use Worksheet API to add table column
  const relativeColIndex = payload.columnIndex - tableRange.startCol + 1;
  const columnName = `Column${table.columns.length + 1}`;
  await ws.tables.addColumn(table.name, columnName, relativeColIndex);

  return { handled: true };
};

/**
 * DELETE_TABLE_ROWS
 *
 * Deletes rows from a table. Cannot delete the header row or all data rows.
 *
 * Payload:
 * - tableId: string - The table to modify
 * - startRow: number - The start row index to delete (absolute)
 * - endRow: number - The end row index to delete (inclusive, absolute)
 */
export const DELETE_TABLE_ROWS: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId: string; startRow: number; endRow: number },
): Promise<ActionResult> => {
  if (!payload?.tableId || payload?.startRow === undefined || payload?.endRow === undefined) {
    return {
      handled: false,
      error: 'DELETE_TABLE_ROWS requires payload with tableId, startRow, and endRow',
    };
  }

  // Use unified Worksheet API: find table, parse range, validate, delete
  const found = await findTableInWorkbook(deps.workbook, payload.tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${payload.tableId}` };
  }

  const { ws, table, range: tableRange } = found;

  // Calculate data area boundaries
  const dataStartRow = table.hasHeaderRow ? tableRange.startRow + 1 : tableRange.startRow;
  const dataEndRow = table.hasTotalsRow ? tableRange.endRow - 1 : tableRange.endRow;

  // Validate: cannot delete header row
  if (table.hasHeaderRow && payload.startRow <= tableRange.startRow) {
    return { handled: false, error: 'Cannot delete the header row' };
  }

  // Validate: cannot delete total row
  if (table.hasTotalsRow && payload.endRow >= tableRange.endRow) {
    return { handled: false, error: 'Cannot delete the total row' };
  }

  // Validate: must be within data area
  const deleteStart = Math.max(payload.startRow, dataStartRow);
  const deleteEnd = Math.min(payload.endRow, dataEndRow);

  if (deleteStart > deleteEnd) {
    return { handled: false, error: 'No valid rows to delete' };
  }

  // Validate: cannot delete all data rows (must leave at least 1)
  const dataRowCount = dataEndRow - dataStartRow + 1;
  const deleteCount = deleteEnd - deleteStart + 1;
  if (deleteCount >= dataRowCount) {
    return { handled: false, error: 'Cannot delete all data rows from table' };
  }

  await ws.structure.deleteRows(deleteStart, deleteCount);

  return { handled: true };
};

/**
 * DELETE_TABLE_COLUMNS
 *
 * Deletes columns from a table. Cannot delete all columns.
 *
 * Payload:
 * - tableId: string - The table to modify
 * - startCol: number - The start column index to delete (absolute)
 * - endCol: number - The end column index to delete (inclusive, absolute)
 */
export const DELETE_TABLE_COLUMNS: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId: string; startCol: number; endCol: number },
): Promise<ActionResult> => {
  if (!payload?.tableId || payload?.startCol === undefined || payload?.endCol === undefined) {
    return {
      handled: false,
      error: 'DELETE_TABLE_COLUMNS requires payload with tableId, startCol, and endCol',
    };
  }

  // Use unified Worksheet API: find table, parse range, validate, delete
  const found = await findTableInWorkbook(deps.workbook, payload.tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${payload.tableId}` };
  }

  const { ws, table, range: tableRange } = found;

  // Validate: columns must be within the table
  const deleteStart = Math.max(payload.startCol, tableRange.startCol);
  const deleteEnd = Math.min(payload.endCol, tableRange.endCol);

  if (deleteStart > deleteEnd) {
    return { handled: false, error: 'No valid columns to delete' };
  }

  // Validate: cannot delete all columns (must leave at least 1)
  const totalColCount = tableRange.endCol - tableRange.startCol + 1;
  const deleteCount = deleteEnd - deleteStart + 1;
  if (deleteCount >= totalColCount) {
    return { handled: false, error: 'Cannot delete all columns from table' };
  }

  await ws.structure.deleteColumns(deleteStart, deleteCount);

  // Use Worksheet API to remove table columns
  // Remove columns from highest index to lowest to avoid shifting issues
  for (let i = deleteCount - 1; i >= 0; i--) {
    const relativeCol = deleteStart - tableRange.startCol + i;
    await ws.tables.removeColumn(table.name, relativeCol);
  }

  return { handled: true };
};

/**
 * REMOVE_DUPLICATES
 *
 * Removes duplicate rows from a table or range.
 *
 * Payload:
 * - tableId?: string - Optional table ID (if in table context)
 * - range?: CellRange - Optional explicit range
 * - columnsToCheck: number[] - Column indices to check for duplicates
 * - hasHeaders: boolean - Whether the range has header row
 */
export const REMOVE_DUPLICATES: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    tableId?: string;
    range?: CellRange;
    columnsToCheck: number[];
    hasHeaders: boolean;
  },
): Promise<ActionResult> => {
  if (!payload) {
    return {
      handled: false,
      error: 'REMOVE_DUPLICATES requires payload',
    };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Use Worksheet API for removeDuplicates
  if (payload.range) {
    const startColLetter = colIndexToLetter(payload.range.startCol);
    const endColLetter = colIndexToLetter(payload.range.endCol);
    const rangeA1 = `${startColLetter}${payload.range.startRow + 1}:${endColLetter}${payload.range.endRow + 1}`;
    await ws.structure.removeDuplicates(rangeA1, payload.columnsToCheck, payload.hasHeaders);
  }

  // Close the dialog
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (uiStore) {
    const state = uiStore.getState();
    state.closeRemoveDuplicatesDialog();
  }

  return { handled: true };
};

/**
 * CREATE_CUSTOM_TABLE_STYLE
 *
 * Creates a new custom table style.
 * Custom Table Styles
 *
 * Payload:
 * - name: string - Name for the custom style
 * - style: CustomTableStyleConfig (partial, without id/timestamps)
 */
export const CREATE_CUSTOM_TABLE_STYLE: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    name: string;
    style: TableStyleConfig;
  },
): Promise<ActionResult> => {
  if (!payload?.name) {
    return {
      handled: false,
      error: 'CREATE_CUSTOM_TABLE_STYLE requires payload with name',
    };
  }

  // Use Workbook API for custom table style creation
  await deps.workbook.tableStyles.add(payload.name, payload.style ?? {});

  // Close the dialog
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (uiStore) {
    const state = uiStore.getState();
    if (typeof state.closeCustomTableStyleDialog === 'function') {
      state.closeCustomTableStyleDialog();
    }
  }

  return { handled: true };
};

/**
 * MODIFY_TABLE_STYLE
 *
 * Modifies an existing custom table style.
 * Custom Table Styles
 *
 * Payload:
 * - styleId: string - ID of the style to modify
 * - updates: Partial<CustomTableStyleConfig>
 */
export const MODIFY_TABLE_STYLE: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    styleId: string;
    updates: Partial<TableStyleConfig>;
  },
): Promise<ActionResult> => {
  if (!payload?.styleId) {
    return {
      handled: false,
      error: 'MODIFY_TABLE_STYLE requires payload with styleId',
    };
  }

  // Use Workbook API for custom table style update
  await deps.workbook.tableStyles.update(payload.styleId, payload.updates ?? {});

  // Close the dialog
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (uiStore) {
    const state = uiStore.getState();
    if (typeof state.closeCustomTableStyleDialog === 'function') {
      state.closeCustomTableStyleDialog();
    }
  }

  return { handled: true };
};

/**
 * DUPLICATE_TABLE_STYLE
 *
 * Duplicates an existing custom table style.
 * Custom Table Styles
 *
 * Payload:
 * - styleId: string - ID of the style to duplicate
 * - newName?: string - Name for the duplicate (optional)
 */
export const DUPLICATE_TABLE_STYLE: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    styleId: string;
    newName?: string;
  },
): Promise<ActionResult> => {
  if (!payload?.styleId) {
    return {
      handled: false,
      error: 'DUPLICATE_TABLE_STYLE requires payload with styleId',
    };
  }

  // Use Workbook API for custom table style duplication
  try {
    const allStyles = await deps.workbook.tableStyles.list();
    const sourceStyle = allStyles?.find(
      (s: any) => s.name === payload.styleId || s.id === payload.styleId,
    );
    if (sourceStyle) {
      const dupName = payload.newName || `${sourceStyle.name} (Copy)`;
      await deps.workbook.tableStyles.add(dupName, { ...sourceStyle, name: dupName });
    }
  } catch (err) {
    console.warn('[table handlers] Duplicate table style failed:', err);
  }

  return { handled: true };
};

/**
 * DELETE_CUSTOM_TABLE_STYLE
 *
 * Deletes a custom table style.
 * Custom Table Styles
 *
 * Payload:
 * - styleId: string - ID of the style to delete
 */
export const DELETE_CUSTOM_TABLE_STYLE: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { styleId: string },
): Promise<ActionResult> => {
  if (!payload?.styleId) {
    return {
      handled: false,
      error: 'DELETE_CUSTOM_TABLE_STYLE requires payload with styleId',
    };
  }

  // Use Workbook API for custom table style deletion
  await deps.workbook.tableStyles.remove(payload.styleId);

  return { handled: true };
};

// =============================================================================
// Table Click Selection Handlers
// =============================================================================

/**
 * SELECT_TABLE_COLUMN
 *
 * Selects a table column with progressive selection behavior.
 * Stage 0: Data only
 * Stage 1: Data + header
 * Stage 2: Full column (data + header + total)
 *
 * Payload:
 * - sheetId: SheetId - The sheet ID
 * - row: number - Row of clicked cell
 * - col: number - Column index (absolute)
 * - stage: 0 | 1 | 2 - Selection stage
 */
export const SELECT_TABLE_COLUMN: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sheetId: SheetId;
    row: number;
    col: number;
    stage: 0 | 1 | 2;
  },
): Promise<ActionResult> => {
  if (!payload) {
    return {
      handled: false,
      error: 'SELECT_TABLE_COLUMN requires payload',
    };
  }

  const ws = deps.workbook.getSheetById(payload.sheetId);
  const table = await ws.tables.getAtCell(payload.row, payload.col);
  if (!table) {
    return { handled: false, error: 'No table at the specified cell' };
  }

  // Get the appropriate range based on stage using inline helpers
  let range: CellRange | null = null;
  switch (payload.stage) {
    case 0:
      range = getColumnDataRange(table, payload.col);
      break;
    case 1:
      range = getColumnWithHeaderRange(table, payload.col);
      break;
    case 2:
      range = getFullColumnRange(table, payload.col);
      break;
  }

  if (!range) {
    return { handled: false, error: 'Failed to compute selection range' };
  }

  // Set selection via command
  deps.commands.selection.setSelection([range], { row: range.startRow, col: range.startCol });

  return { handled: true };
};

/**
 * SELECT_TABLE_ROW
 *
 * Selects a table row (data row only, across all columns).
 *
 * Payload:
 * - sheetId: SheetId - The sheet ID
 * - row: number - Row index (absolute)
 * - col: number - Column to set as active
 */
export const SELECT_TABLE_ROW: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sheetId: SheetId;
    row: number;
    col: number;
  },
): Promise<ActionResult> => {
  if (!payload) {
    return {
      handled: false,
      error: 'SELECT_TABLE_ROW requires payload',
    };
  }

  const ws = deps.workbook.getSheetById(payload.sheetId);
  const table = await ws.tables.getAtCell(payload.row, payload.col);
  if (!table) {
    return { handled: false, error: 'No table at the specified cell' };
  }

  // Get the row range using inline helper
  const range = getTableRowRange(table, payload.row);
  if (!range) {
    return { handled: false, error: 'Row is not in table data area' };
  }

  // Set selection via command
  deps.commands.selection.setSelection([range], { row: range.startRow, col: range.startCol });

  return { handled: true };
};

/**
 * SELECT_TABLE_DATA
 *
 * Selects the entire table data area (excludes header and total).
 * Used for corner click stage 0.
 *
 * Payload:
 * - sheetId: SheetId - The sheet ID
 * - row: number - Row of clicked cell
 * - col: number - Column of clicked cell
 */
export const SELECT_TABLE_DATA: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sheetId: SheetId;
    row: number;
    col: number;
  },
): Promise<ActionResult> => {
  if (!payload) {
    return {
      handled: false,
      error: 'SELECT_TABLE_DATA requires payload',
    };
  }

  const ws = deps.workbook.getSheetById(payload.sheetId);
  const table = await ws.tables.getAtCell(payload.row, payload.col);
  if (!table) {
    return { handled: false, error: 'No table at the specified cell' };
  }

  // Get the table data range using inline helper
  const range: CellRange | null = getDataRange(table);
  if (!range) {
    return { handled: false, error: 'Failed to compute table data range' };
  }

  // Set selection via command
  deps.commands.selection.setSelection([range], { row: range.startRow, col: range.startCol });

  return { handled: true };
};

/**
 * SELECT_FULL_TABLE
 *
 * Selects the entire table (header + data + total).
 * Used for corner click stage 1.
 *
 * Payload:
 * - sheetId: SheetId - The sheet ID
 * - row: number - Row of clicked cell
 * - col: number - Column of clicked cell
 */
export const SELECT_FULL_TABLE: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sheetId: SheetId;
    row: number;
    col: number;
  },
): Promise<ActionResult> => {
  if (!payload) {
    return {
      handled: false,
      error: 'SELECT_FULL_TABLE requires payload',
    };
  }

  const ws = deps.workbook.getSheetById(payload.sheetId);
  const table = await ws.tables.getAtCell(payload.row, payload.col);
  if (!table) {
    return { handled: false, error: 'No table at the specified cell' };
  }

  // Get the full table range using inline helper (replaces TablesSelection.getFullTableRange)
  const range = getTableRange(table);
  if (!range) {
    return { handled: false, error: 'Failed to compute full table range' };
  }

  // Set selection via command
  deps.commands.selection.setSelection([range], { row: range.startRow, col: range.startCol });

  return { handled: true };
};

// =============================================================================
// AutoCorrect Options Handlers
// =============================================================================

/**
 * TOGGLE_AUTO_CALCULATED_COLUMNS
 *
 * Enables or disables automatic calculated column creation for a table.
 * When disabled, entering a formula in a table column will NOT auto-fill
 * to other rows in the column.
 *
 * Payload:
 * - tableId: string - The table to modify
 * - enabled: boolean - Whether to enable auto-calculated columns
 */
export const TOGGLE_AUTO_CALCULATED_COLUMNS: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId: string; enabled: boolean },
): Promise<ActionResult> => {
  if (!payload?.tableId || payload?.enabled === undefined) {
    return {
      handled: false,
      error: 'TOGGLE_AUTO_CALCULATED_COLUMNS requires payload with tableId and enabled',
    };
  }

  // Use unified Worksheet API: find table, then update it
  const found = await findTableInWorkbook(deps.workbook, payload.tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${payload.tableId}` };
  }

  await found.ws.tables.update(payload.tableId, {
    autoCalculatedColumns: payload.enabled,
  });

  // Hide the AutoCorrect options button
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (uiStore) {
    const state = uiStore.getState();
    if (typeof state.hideTableAutoCorrectOptions === 'function') {
      state.hideTableAutoCorrectOptions();
    }
  }

  return { handled: true };
};

/**
 * OVERWRITE_CALCULATED_COLUMN
 *
 * Overwrites all cells in a table column with the calculated formula.
 * Used when the column has mixed content (some cells with different values).
 *
 * Payload:
 * - tableId: string - The table to modify
 * - columnIndex: number - Column index within the table
 * - formula: string - The formula to apply to all cells
 */
export const OVERWRITE_CALCULATED_COLUMN: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId: string; columnIndex: number; formula: string },
): Promise<ActionResult> => {
  if (!payload?.tableId || payload?.columnIndex === undefined || !payload?.formula) {
    return {
      handled: false,
      error: 'OVERWRITE_CALCULATED_COLUMN requires payload with tableId, columnIndex, and formula',
    };
  }

  // Use unified Worksheet API: find table, then set calculated column
  const found = await findTableInWorkbook(deps.workbook, payload.tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${payload.tableId}` };
  }

  // Fill all data cells via unified Worksheet API
  await found.ws.tables.setCalculatedColumn(found.table.name, payload.columnIndex, payload.formula);

  // Hide the AutoCorrect options button
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (uiStore) {
    const state = uiStore.getState();
    if (typeof state.hideTableAutoCorrectOptions === 'function') {
      state.hideTableAutoCorrectOptions();
    }
  }

  return { handled: true };
};

/**
 * TOGGLE_TABLE_AUTO_EXPAND
 *
 * Enables or disables automatic table expansion when users type in adjacent cells.
 *
 * Payload:
 * - tableId: string - The table to modify
 * - enabled: boolean - Whether to enable auto-expansion
 */
export const TOGGLE_TABLE_AUTO_EXPAND: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId: string; enabled: boolean },
): Promise<ActionResult> => {
  if (!payload?.tableId || payload?.enabled === undefined) {
    return {
      handled: false,
      error: 'TOGGLE_TABLE_AUTO_EXPAND requires payload with tableId and enabled',
    };
  }

  // Use unified Worksheet API: find table, then update it
  const found = await findTableInWorkbook(deps.workbook, payload.tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${payload.tableId}` };
  }

  await found.ws.tables.update(payload.tableId, {
    autoExpand: payload.enabled,
  });

  // Hide the AutoCorrect options button
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (uiStore) {
    const state = uiStore.getState();
    if (typeof state.hideTableAutoCorrectOptions === 'function') {
      state.hideTableAutoCorrectOptions();
    }
  }

  return { handled: true };
};

// =============================================================================
// Additional Table Operation Handlers
// =============================================================================

/**
 * DELETE_TABLE
 *
 * Deletes a table, converting it back to a regular range.
 * This is a convenience handler that wraps CONVERT_TO_RANGE.
 *
 * Payload (optional):
 * - tableId?: string - The table to delete (resolved from active cell if omitted)
 */
export const DELETE_TABLE: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId?: string },
): Promise<ActionResult> => {
  // DELETE_TABLE is effectively CONVERT_TO_RANGE
  return CONVERT_TO_RANGE(deps, payload);
};

/**
 * TOGGLE_TABLE_TOTALS_ROW
 *
 * Toggles the totals row visibility for a table.
 *
 * Payload (optional):
 * - tableId?: string - The table to modify (resolved from active cell if omitted)
 */
export const TOGGLE_TABLE_TOTALS_ROW: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId?: string },
): Promise<ActionResult> => {
  const tableId = await resolveTableId(deps, payload);
  if (!tableId) {
    return { handled: false, error: 'no-table' };
  }

  // Use unified Worksheet API: find table across sheets, then toggle totals row
  const found = await findTableInWorkbook(deps.workbook, tableId);
  if (found) {
    const table = await found.ws.tables.get(tableId);
    if (table) await found.ws.tables.setShowTotals(tableId, !table.hasTotalsRow);
  }

  return { handled: true };
};

/**
 * TOGGLE_TABLE_HEADER_ROW
 *
 * Toggles the header row visibility for a table.
 *
 * Payload (optional):
 * - tableId?: string - The table to modify (resolved from active cell if omitted)
 */
export const TOGGLE_TABLE_HEADER_ROW: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId?: string },
): Promise<ActionResult> => {
  const tableId = await resolveTableId(deps, payload);
  if (!tableId) {
    return { handled: false, error: 'no-table' };
  }

  // Use unified Worksheet API: find table across sheets, then toggle header row
  const found = await findTableInWorkbook(deps.workbook, tableId);
  if (found) {
    const table = await found.ws.tables.get(tableId);
    if (table) await found.ws.tables.setShowHeaders(tableId, !table.hasHeaderRow);
  }

  return { handled: true };
};

/**
 * TOGGLE_TABLE_BANDED_ROWS
 *
 * Toggles banded row styling for a table.
 *
 * Payload (optional):
 * - tableId?: string - The table to modify (resolved from active cell if omitted)
 */
export const TOGGLE_TABLE_BANDED_ROWS: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId?: string },
): Promise<ActionResult> => {
  const tableId = await resolveTableId(deps, payload);
  if (!tableId) {
    return { handled: false, error: 'no-table' };
  }

  // Use unified Worksheet API: find table across sheets, then toggle banded rows
  const found = await findTableInWorkbook(deps.workbook, tableId);
  if (found) {
    const table = await found.ws.tables.get(tableId);
    if (table) await found.ws.tables.update(tableId, { bandedRows: !table.bandedRows });
  }

  return { handled: true };
};

/**
 * SET_TABLE_STYLE
 *
 * Sets the style for a table.
 *
 * Payload:
 * - tableId: string - The table to modify
 * - styleId: string - The style ID to apply (e.g., 'light1', 'medium2', 'dark3')
 */
export const SET_TABLE_STYLE: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { tableId: string; styleId: string },
): Promise<ActionResult> => {
  if (!payload?.tableId || !payload?.styleId) {
    return {
      handled: false,
      error: 'SET_TABLE_STYLE requires payload with tableId and styleId',
    };
  }

  // Use unified Worksheet API: find table across sheets, then setTableStylePreset
  const found = await findTableInWorkbook(deps.workbook, payload.tableId);
  if (found) {
    await found.ws.tables.setStylePreset(payload.tableId, payload.styleId);
  }

  return { handled: true };
};
