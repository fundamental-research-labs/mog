/**
 * Total Row Action Handlers
 *
 * Handlers for total row function dropdown operations in tables.
 *
 * Total Row Function Dropdown
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { TotalFunction } from '@mog-sdk/contracts/tables';

import type { UIState } from '../../ui-store/types';
import { guardBridgeMutation } from './bridge-error-guard';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Find a table by name across all sheets using the unified Worksheet API.
 */
async function findTable(wb: Workbook, tableId: string) {
  for (const name of await wb.getSheetNames()) {
    const ws = await wb.getSheet(name);
    const table = await ws.tables.get(tableId);
    if (table) return { ws, table };
  }
  return null;
}

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * OPEN_TOTAL_ROW_DROPDOWN
 *
 * Opens the total row function dropdown for a specific table column.
 *
 * Payload:
 * - tableId: string - ID of the table
 * - columnIndex: number - Column index within the table
 * - position: { x: number; y: number } - Screen coordinates
 * - currentFunction: TotalFunction | null - Currently applied function
 */
export const OPEN_TOTAL_ROW_DROPDOWN: ActionHandler = (
  deps: ActionDependencies,
  payload?: {
    tableId: string;
    columnIndex: number;
    position: { x: number; y: number };
    currentFunction: TotalFunction | null;
  },
): ActionResult => {
  if (!payload) {
    return {
      handled: false,
      error: 'OPEN_TOTAL_ROW_DROPDOWN requires payload with tableId, columnIndex, position',
    };
  }

  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (!uiStore) {
    return { handled: false, error: 'UIStore not available' };
  }

  const state = uiStore.getState();
  state.openTotalRowDropdown(
    payload.tableId,
    payload.columnIndex,
    payload.position,
    payload.currentFunction,
  );

  return { handled: true };
};

/**
 * CLOSE_TOTAL_ROW_DROPDOWN
 *
 * Closes the total row function dropdown.
 */
export const CLOSE_TOTAL_ROW_DROPDOWN: ActionHandler = (deps: ActionDependencies): ActionResult => {
  const uiStore = deps.uiStore as { getState: () => UIState } | undefined;
  if (!uiStore) {
    return { handled: false, error: 'UIStore not available' };
  }

  const state = uiStore.getState();
  state.closeTotalRowDropdown();

  return { handled: true };
};

/**
 * SET_TOTAL_ROW_FUNCTION
 *
 * Sets the aggregation function for a total row column.
 *
 * Payload:
 * - tableId: string - ID of the table
 * - columnIndex: number - Column index within the table
 * - fn: TotalFunction - The function to apply ('none', 'sum', 'average', etc.)
 */
export const SET_TOTAL_ROW_FUNCTION: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    tableId: string;
    columnIndex: number;
    fn: TotalFunction;
  },
): Promise<ActionResult> => {
  if (!payload) {
    return {
      handled: false,
      error: 'SET_TOTAL_ROW_FUNCTION requires payload with tableId, columnIndex, fn',
    };
  }

  const { tableId, columnIndex, fn } = payload;

  // Use unified Worksheet API: find table across sheets
  const found = await findTable(deps.workbook, tableId);
  if (!found) {
    return { handled: false, error: `Table not found: ${tableId}` };
  }

  const { ws, table } = found;

  // Verify the table has a total row
  if (!table.hasTotalsRow) {
    return { handled: false, error: 'Table does not have a total row enabled' };
  }

  // Map TotalFunction to a SUBTOTAL formula or clear the cell
  // The total row cell is the last row of the table range at the given column
  const totalRowFormula = totalFunctionToFormula(fn, table.name, table.columns[columnIndex]?.name);
  if (totalRowFormula !== null) {
    // Get the total row position from the table range
    const rangeMatch = table.range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
    if (rangeMatch) {
      const endRow = parseInt(rangeMatch[4], 10) - 1; // 0-based
      const startCol = colLettersToIndex(rangeMatch[1]);
      const totalCol = startCol + columnIndex;
      const ok = await guardBridgeMutation(() => ws.setCell(endRow, totalCol, totalRowFormula));
      if (!ok) return { handled: true };
    }
  }

  return { handled: true };
};

// =============================================================================
// Helpers for total row formula generation
// =============================================================================

/** Convert column letters to 0-based index. */
function colLettersToIndex(letters: string): number {
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  }
  return result - 1;
}

/** Map TotalFunction to SUBTOTAL formula string, or null for 'none'. */
function totalFunctionToFormula(
  fn: TotalFunction,
  tableName: string,
  columnName: string | undefined,
): string | null {
  if (!columnName) return null;
  const ref = `${tableName}[${columnName}]`;
  switch (fn) {
    case 'none':
      return '';
    case 'sum':
      return `=SUBTOTAL(109,${ref})`;
    case 'average':
      return `=SUBTOTAL(101,${ref})`;
    case 'count':
      return `=SUBTOTAL(102,${ref})`;
    case 'countNums':
      return `=SUBTOTAL(103,${ref})`;
    case 'max':
      return `=SUBTOTAL(104,${ref})`;
    case 'min':
      return `=SUBTOTAL(105,${ref})`;
    case 'stdDev':
      return `=SUBTOTAL(107,${ref})`;
    case 'var':
      return `=SUBTOTAL(110,${ref})`;
    default:
      return null;
  }
}
