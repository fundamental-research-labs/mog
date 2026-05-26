/**
 * Selection Error Handlers
 *
 * Handlers for showing and clearing selection errors (red border for invalid operations).
 * Red Border for Invalid Operations
 *
 */

import { getUIStore, handled, type ActionHandler } from './helpers';

// =============================================================================
// Selection Error Handlers (Red Border for Invalid Operations)
// =============================================================================

/**
 * SET_SELECTION_ERROR - Show red border for invalid operation.
 *
 * Red Border for Invalid Operations
 *
 * Called when a selection operation is invalid, such as:
 * - Trying to paste into merged cells (merge_conflict)
 * - Trying to edit protected cells (protection)
 * - Trying to delete part of an array formula (array_formula)
 * - Invalid range reference (invalid_range)
 *
 * The error automatically clears after 2 seconds.
 *
 * @param deps - Action dependencies
 * @param payload - { type: 'merge_conflict' | 'protection' | 'array_formula' | 'invalid_range', message?: string }
 */
export const SET_SELECTION_ERROR: ActionHandler = (deps, payload) => {
  if (!payload?.type) {
    return { handled: false, reason: 'disabled' };
  }

  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return { handled: false, reason: 'disabled' };
  }

  uiStore.getState().setSelectionError(payload.type, payload.message);
  return handled();
};

/**
 * CLEAR_SELECTION_ERROR - Clear the selection error.
 *
 * Red Border for Invalid Operations
 *
 * Manually clears the selection error. Typically not needed since
 * errors auto-clear after 2 seconds.
 */
export const CLEAR_SELECTION_ERROR: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return { handled: false, reason: 'disabled' };
  }

  uiStore.getState().clearSelectionError();
  return handled();
};
