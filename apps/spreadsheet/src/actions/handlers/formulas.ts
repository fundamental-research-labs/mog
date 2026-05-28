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

import type { ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';

import { handled, notHandled } from './handler-utils';
import { beginEditSessionFromAction } from './edit-entry';

async function insertFormulaToken(
  deps: Parameters<AsyncActionHandler>[0],
  token: string,
): Promise<void> {
  const isEditing = deps.accessors.editor.isEditing();
  const isFormulaEditing = deps.accessors.editor.isFormulaEditing();

  if (isEditing || isFormulaEditing) {
    const currentValue = deps.accessors.editor.getValue() || '';
    const cursorPos = deps.accessors.editor.getCursorPosition() || 0;
    const prefix = currentValue.startsWith('=') || isFormulaEditing ? '' : '=';
    const adjustedCursor = cursorPos + prefix.length;
    const before = currentValue.slice(0, cursorPos);
    const after = currentValue.slice(cursorPos);
    const newValue = prefix + before + token + after;
    const newCursor = adjustedCursor + token.length;

    deps.commands.editor.input(newValue, newCursor);
    deps.commands.editor.setCursor(newCursor);
  } else {
    const activeCell = deps.accessors.selection.getActiveCell();
    const sheetId = deps.getActiveSheetId();

    deps.commands.selection.exitAllModes();

    await beginEditSessionFromAction(deps, {
      sheetId,
      cell: activeCell,
      entryMode: 'typing',
      initialTextHint: `=${token}`,
    });
  }
}

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

  await insertFormulaToken(deps, `${functionName}(`);

  return handled();
};

export const PASTE_NAME_IN_FORMULA: AsyncActionHandler = async (
  deps,
  payload: any,
): Promise<ActionResult> => {
  const { name } = payload as { name?: string };

  if (!name) {
    return notHandled('disabled');
  }

  await insertFormulaToken(deps, name);
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
