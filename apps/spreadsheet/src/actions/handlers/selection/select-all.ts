/**
 * Select-All Action Handlers
 *
 * Handlers for select-all operations (SELECT_ALL, SELECT_ENTIRE_ROW, SELECT_ENTIRE_COLUMN,
 * SELECT_CURRENT_REGION).
 *
 * SELECT_CURRENT_REGION implements Excel's Ctrl+A three-press behavior:
 * - First press: Select current data region (contiguous cells around active cell)
 * - Second press (within 500ms): Select entire sheet
 * - Third press (within 500ms, when all cells selected): Select all floating objects
 *
 * Selection Handlers Split
 *
 */

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';

import { handled, type ActionHandler } from './helpers';
import { selectCurrentRegion } from './current-region';

// =============================================================================
// Select-All Handlers
// =============================================================================

/**
 * SELECT_ALL - Ctrl+Shift+Space handler
 *
 * Selects all cells in the sheet.
 */
export const SELECT_ALL: ActionHandler = (deps) => {
  deps.commands.selection.selectAll();
  return handled();
};

/**
 * SELECT_ENTIRE_ROW - Shift+Space handler
 *
 * Selects the entire row(s) of the current selection.
 * fromKeyboard=true to stay in idle state (no drag tracking needed for keyboard selection).
 */
export const SELECT_ENTIRE_ROW: ActionHandler = (deps) => {
  // SELECT_ENTIRE_ROW is not directly exposed in commands, need to get active cell
  const activeCell = deps.accessors.selection.getActiveCell();
  deps.commands.selection.selectRow(activeCell.row, false, false, true); // fromKeyboard=true
  return handled();
};

/**
 * SELECT_ENTIRE_COLUMN - Ctrl+Space handler
 *
 * Selects the entire column(s) of the current selection.
 * fromKeyboard=true to stay in idle state (no drag tracking needed for keyboard selection).
 */
export const SELECT_ENTIRE_COLUMN: ActionHandler = (deps) => {
  // SELECT_ENTIRE_COLUMN is not directly exposed in commands, need to get active cell
  const activeCell = deps.accessors.selection.getActiveCell();
  deps.commands.selection.selectColumn(activeCell.col, false, false, true); // fromKeyboard=true
  return handled();
};

/**
 * SELECT_CURRENT_REGION - Ctrl+A progressive selection (Excel behavior)
 *
 * Excel Parity 2.2:
 * - First press: Select current data region (contiguous cells around active cell)
 * - If active cell is isolated (no adjacent data), skip directly to select all
 * - If active cell is empty but surrounded by data, select the surrounding region
 * - Second press (within 500ms): Select entire sheet
 * - Third press (within 500ms, when all cells selected): Select all floating objects
 *
 * Uses UIStore's CtrlAStateSlice for state management instead of module-level variables.
 * This provides:
 * - Session isolation for collaborative editing
 * - Testability with proper state management
 * - Consistency with other UI state patterns
 */
export const SELECT_CURRENT_REGION: AsyncActionHandler = selectCurrentRegion;
