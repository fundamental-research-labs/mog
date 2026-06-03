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
    const direct = await ws.tables.get(tableId);
    if (direct) return { ws, table: direct };

    const tables = await ws.tables.list();
    const match = tables.find((table) => table.id === tableId || table.name === tableId);
    if (match) return { ws, table: match };
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

  // Delegate metadata and totals-cell formula updates to the table API.
  const columnName = table.columns[columnIndex]?.name;
  if (!columnName) {
    return { handled: false, error: `Column index out of range: ${columnIndex}` };
  }

  const ok = await guardBridgeMutation(() =>
    ws.tables.setTotalsFunction(table.name, columnName, fn),
  );
  if (!ok) return { handled: true };

  return { handled: true };
};
