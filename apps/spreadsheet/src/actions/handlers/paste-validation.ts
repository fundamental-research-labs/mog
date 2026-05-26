/**
 * Paste Validation Action Handlers
 *
 * Pure handler functions for paste validation summary dialog actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps, payload?) => ActionResult
 * - They access UIStore through deps.uiStore
 * - They do NOT store references to deps
 *
 * This file handles:
 * - SHOW_PASTE_VALIDATION_SUMMARY - Opens dialog after paste with validation violations
 * - CLOSE_PASTE_VALIDATION_SUMMARY - Closes the dialog
 * - CONFIRM_PASTE_WITH_INVALID - User confirms keeping invalid pasted values
 * - REVERT_INVALID_PASTE - User reverts paste that contained invalid values
 * - HIGHLIGHT_INVALID_CELLS - Highlight cells that failed validation after paste
 *
 */

import type { ActionHandler, AsyncActionHandler } from '@mog-sdk/contracts/actions';

import type { PasteValidationSummary } from '../../ui-store/slices/clipboard/paste-validation';

import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// Payload Types
// =============================================================================

/**
 * Payload for SHOW_PASTE_VALIDATION_SUMMARY action.
 */
export interface ShowPasteValidationSummaryPayload {
  summary: PasteValidationSummary;
}

// =============================================================================
// Paste Validation Dialog Handlers
// =============================================================================

/**
 * Show the paste validation summary dialog.
 *
 * Called after a paste operation when some pasted values violate
 * the validation rules at their target cells.
 *
 * @param deps - Action dependencies
 * @param payload - { summary: PasteValidationSummary }
 */
export const SHOW_PASTE_VALIDATION_SUMMARY: ActionHandler = (deps, payload) => {
  const data = payload as ShowPasteValidationSummaryPayload | undefined;

  if (!data?.summary) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().showPasteValidationSummary(data.summary);

  return handled();
};

/**
 * Close the paste validation summary dialog.
 *
 * Called when user clicks the X button or presses Escape.
 *
 * @param deps - Action dependencies
 */
export const CLOSE_PASTE_VALIDATION_SUMMARY: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closePasteValidationSummary();
  return handled();
};

/**
 * Confirm keeping invalid pasted values.
 *
 * Called when user clicks "Keep Values" in the summary dialog.
 * Closes the dialog without reverting - the values remain as pasted.
 *
 * @param deps - Action dependencies
 */
export const CONFIRM_PASTE_WITH_INVALID: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);

  // Simply close the dialog - values are already in place
  uiStore.getState().closePasteValidationSummary();

  return handled();
};

/**
 * Revert the paste operation that contained invalid values.
 *
 * Called when user clicks "Undo Paste" in the summary dialog.
 * Triggers an undo operation to revert the paste, then closes the dialog.
 *
 * @param deps - Action dependencies
 */
export const REVERT_INVALID_PASTE: AsyncActionHandler = async (deps) => {
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  // Check if dialog is open
  if (!state.pasteValidationDialog.isOpen) {
    return notHandled('disabled');
  }

  // Perform undo operation via Unified Workbook API
  try {
    await deps.workbook.history.undo();
  } catch (error) {
    console.warn('[PasteValidation] Failed to undo paste:', error);
  }

  // Close the dialog
  state.closePasteValidationSummary();

  return handled();
};

/**
 * Highlight cells that failed validation after paste.
 *
 * Called when user clicks "Highlight Cells" in the summary dialog.
 * Selects the cells that had validation violations so user can see them.
 *
 * @param deps - Action dependencies
 */
export const HIGHLIGHT_INVALID_CELLS: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  // Check if dialog is open and has violations
  if (
    !state.pasteValidationDialog.isOpen ||
    !state.pasteValidationDialog.summary?.violations.length
  ) {
    return notHandled('disabled');
  }

  const { violations, sheetId } = state.pasteValidationDialog.summary;

  // Create ranges for each violation cell
  // Note: For a single cell, start and end are the same
  const ranges = violations.map((v) => ({
    sheetId,
    startRow: v.row,
    startCol: v.col,
    endRow: v.row,
    endCol: v.col,
  }));

  // Update selection to highlight all invalid cells using Actor Access Layer
  if (ranges.length > 0) {
    deps.commands.selection.setSelection(ranges, {
      row: violations[0].row,
      col: violations[0].col,
    });
  }

  // Close the dialog after highlighting
  state.closePasteValidationSummary();

  return handled();
};
