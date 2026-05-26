/**
 * Formula Action Handlers
 *
 * Pure handler functions for formula-related ribbon actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps, payload?) => ActionResult
 * - They access actor state through deps.accessors (reads) and deps.commands (writes)
 * - They access UI state through deps.uiStore
 *
 * This file handles:
 * - INSERT_FUNCTION: Insert a specific function into the active cell or at cursor position
 * - TOGGLE_SHOW_FORMULAS: Toggle formula display mode (Ctrl+`)
 * - SET_CALCULATION_MODE: Set calculation mode (auto/manual)
 *
 */

import type { ActionHandler, ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';

import { getUIStore, handled, notHandled } from './handler-utils';
import { beginEditSessionFromAction } from './edit-entry';

// =============================================================================
// INSERT_FUNCTION Handler
// =============================================================================

/**
 * Insert a specific function into the active cell or at cursor position.
 *
 * Behavior:
 * - If NOT currently editing: Start editing with `=FUNCTION(`
 * - If currently editing: Insert `FUNCTION(` at the current cursor position
 *
 * This handler is triggered from the FormulasRibbon when a user selects
 * a function from the Insert Function dialog or ribbon gallery.
 *
 * @param deps Action dependencies
 * @param payload { functionName: string } - The function name to insert (e.g., "SUM", "VLOOKUP")
 *
 * @see engine/src/hooks/use-insert-function.ts - Original hook implementation
 */
export const INSERT_FUNCTION: AsyncActionHandler = async (
  deps,
  payload: any,
): Promise<ActionResult> => {
  const { functionName } = payload as { functionName: string };

  if (!functionName) {
    return notHandled('disabled');
  }

  // The text to insert: "FUNCTION(" - user will complete the arguments
  const insertion = `${functionName}(`;

  // Check if currently editing via accessor
  const isEditing = deps.accessors.editor.isEditing();
  const isFormulaEditing = deps.accessors.editor.isFormulaEditing();

  if (isEditing || isFormulaEditing) {
    // Already editing - insert at cursor position
    const currentValue = deps.accessors.editor.getValue() || '';
    const cursorPos = deps.accessors.editor.getCursorPosition() || 0;

    // Split value at cursor and insert function
    const before = currentValue.slice(0, cursorPos);
    const after = currentValue.slice(cursorPos);
    const newValue = before + insertion + after;
    const newCursor = cursorPos + insertion.length;

    // Update the value via commands.
    // Pass the post-insert cursor so the machine doesn't fall back to
    // end-of-value before the setCursor below corrects it.
    deps.commands.editor.input(newValue, newCursor);

    // Set cursor position to after the inserted function name and opening paren
    deps.commands.editor.setCursor(newCursor);
  } else {
    // Not editing - start editing with the formula
    const activeCell = deps.accessors.selection.getActiveCell();
    const sheetId = deps.getActiveSheetId();

    // Auto-deactivate selection modes on edit start (Excel behavior).
    // routed through the selection actor.
    deps.commands.selection.exitAllModes();

    // Start editing with "=FUNCTION(" - cursor will be at end (after opening paren)
    await beginEditSessionFromAction(deps, {
      sheetId,
      cell: activeCell,
      entryMode: 'typing',
      initialTextHint: `=${insertion}`,
    });
  }

  return handled();
};

// =============================================================================
// TOGGLE_SHOW_FORMULAS Handler
// =============================================================================

/**
 * Toggle formula display mode (Ctrl+`).
 *
 * When enabled, cells display their formulas instead of calculated values.
 * This is useful for auditing and debugging formulas in the spreadsheet.
 *
 * Persists as a per-sheet worksheet view option.
 */
export const TOGGLE_SHOW_FORMULAS: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const showFormulas = deps.workbook.mirror.getViewOptions(sheetId).showFormulas;
  await ws.view.setShowFormulas(!showFormulas);
  return handled();
};

// =============================================================================
// SET_CALCULATION_MODE Handler
// =============================================================================

/**
 * Set calculation mode (auto/manual).
 *
 * - 'auto': Formulas are recalculated automatically when dependencies change
 * - 'manual': Formulas are only recalculated when explicitly triggered (F9)
 *
 * This is typically accessed from the Formulas ribbon > Calculation Options dropdown.
 *
 * @param deps Action dependencies
 * @param payload { mode: 'auto' | 'manual' } - The calculation mode to set
 */
export const SET_CALCULATION_MODE: AsyncActionHandler = async (
  deps,
  payload: any,
): Promise<ActionResult> => {
  const { mode } = payload as { mode: 'auto' | 'manual' };

  if (!mode || (mode !== 'auto' && mode !== 'manual')) {
    return notHandled('disabled');
  }

  await deps.workbook.setCalculationMode(mode);
  return handled();
};
