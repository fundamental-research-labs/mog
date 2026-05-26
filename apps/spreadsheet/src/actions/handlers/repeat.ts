/**
 * Repeat Action Handler
 *
 * Handles F4 repeat last action functionality.
 * In grid context, F4 has dual behavior:
 * 1. If active cell has list validation: open dropdown
 * 2. Otherwise: repeat the last formatting/structural action
 * In formula editing context, F4 cycles reference types (handled by editor).
 *
 */

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';

import type { RepeatActionSlice } from '../../ui-store/slices/editing/repeat-action';

// Import dispatcher for action delegation (via indirection to avoid cycle)
import { dispatch } from '../dispatcher-types';
import { handled, notHandled } from './handler-utils';
import {
  isPickerBackedValidation,
  peekValidationEditorConfig,
} from '../../systems/grid-editing/coordination/editor-validation-resolution';

// =============================================================================
// Repeat Action Handler
// =============================================================================

/**
 * REPEAT_LAST_ACTION - F4 key handler in grid context.
 *
 * Dual behavior in grid context:
 * 1. If active cell has list validation: open dropdown (alternative to Alt+Down)
 * 2. Otherwise: repeat the last formatting/structural action
 *
 * Behavior for repeat:
 * - If no last action stored: return notHandled('disabled')
 * - Otherwise: re-dispatch the last action with its payload
 * - The action applies to the CURRENT selection (not the original)
 * - Creates its own undo step (does not merge with original action)
 *
 * Note: In formula editing context, F4 maps to CYCLE_REFERENCE instead.
 * Context determines which action is dispatched by the keyboard handler.
 */
export const REPEAT_LAST_ACTION: AsyncActionHandler = async (deps) => {
  // F4 opens dropdown if active cell has list validation
  // This takes precedence over repeat last action
  const sheetId = deps.getActiveSheetId?.();

  if (sheetId) {
    // Use Actor Access Layer to get active cell
    const activeCell = deps.accessors.selection.getActiveCell();

    if (activeCell) {
      // Check if active cell has picker-backed validation. Cold metadata delegates
      // to OPEN_DROPDOWN so the edit-entry service can hydrate without blocking.
      const ws = deps.workbook.getSheetById(sheetId);
      const validationResolution = peekValidationEditorConfig(ws, activeCell.row, activeCell.col);
      const rule = ws.validations.peek(activeCell.row, activeCell.col);
      if (
        validationResolution.state === 'cold' ||
        (validationResolution.state === 'ready' && isPickerBackedValidation(rule))
      ) {
        const dropdownResult = dispatch('OPEN_DROPDOWN', deps);
        return dropdownResult instanceof Promise ? await dropdownResult : dropdownResult;
      }
    }
  }

  // No list validation - proceed with repeat last action
  // Get last repeatable action from UIStore

  // Note: deps.uiStore is typed as `unknown` in contracts.
  // Cast to access RepeatActionSlice for last repeatable action.
  const uiStore = deps.uiStore as { getState: () => RepeatActionSlice } | undefined;

  if (!uiStore) {
    return notHandled('disabled');
  }

  const lastAction = uiStore.getState().lastRepeatableAction;

  if (!lastAction) {
    // No action to repeat
    return notHandled('disabled');
  }

  // Re-dispatch the last action with its original payload
  // Note: Selection may have changed, so action applies to new selection
  const dispatchResult = dispatch(lastAction.actionType, deps, lastAction.payload);

  // Note: We don't emit an event here because the re-dispatched action
  // will emit its own events. If we wanted to track repeats specifically,
  // we could emit an 'action:repeated' event here.

  // Handle both sync and async results from dispatch
  const result = dispatchResult instanceof Promise ? await dispatchResult : dispatchResult;

  return result.handled ? handled() : result;
};
