/**
 * Custom Lists Handlers
 *
 * Manages user-defined custom lists for autofill series.
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';

import { getUIStore, handled } from './types';

/**
 * OPEN_CUSTOM_LISTS_DIALOG
 *
 * Opens the Custom Lists management dialog.
 */
export const OPEN_CUSTOM_LISTS_DIALOG: ActionHandler = (deps: ActionDependencies): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().openCustomListsDialog();
  return handled();
};

/**
 * CLOSE_CUSTOM_LISTS_DIALOG
 *
 * Closes the Custom Lists management dialog.
 */
export const CLOSE_CUSTOM_LISTS_DIALOG: ActionHandler = (
  deps: ActionDependencies,
): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closeCustomListsDialog();
  return handled();
};

/**
 * ADD_CUSTOM_LIST
 *
 * Adds a new user-defined custom list.
 *
 * @param deps - Action dependencies
 * @param payload - { name: string, values: string[] }
 */
export const ADD_CUSTOM_LIST: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { name: string; values: string[] },
): Promise<ActionResult> => {
  if (!payload || !payload.name || !payload.values || payload.values.length === 0) {
    return { handled: false, reason: 'disabled', error: 'Invalid custom list data' };
  }

  const uiStore = getUIStore(deps);
  const wb = deps.workbook;

  const list = await wb.addCustomList({
    name: payload.name,
    values: payload.values,
  });

  // Exit add mode in the dialog
  uiStore.getState().cancelEditingCustomList();

  uiStore.getState().selectCustomList(list.id);

  return handled();
};

/**
 * EDIT_CUSTOM_LIST
 *
 * Edits an existing user-defined custom list.
 *
 * @param deps - Action dependencies
 * @param payload - { id: string, values: string[] }
 */
export const EDIT_CUSTOM_LIST: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { id: string; values: string[] },
): Promise<ActionResult> => {
  if (!payload || !payload.id || !payload.values) {
    return { handled: false, reason: 'disabled', error: 'Invalid custom list data' };
  }

  const uiStore = getUIStore(deps);
  const wb = deps.workbook;

  const updated = await wb.updateCustomList(payload.id, { values: payload.values });
  if (!updated) {
    return {
      handled: true,
      error: 'Failed to update custom list (may be a built-in list)',
    };
  }

  // Exit edit mode in the dialog
  uiStore.getState().cancelEditingCustomList();

  return handled();
};

/**
 * DELETE_CUSTOM_LIST
 *
 * Deletes a user-defined custom list.
 *
 * @param deps - Action dependencies
 * @param payload - { id: string }
 */
export const DELETE_CUSTOM_LIST: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { id: string },
): Promise<ActionResult> => {
  if (!payload || !payload.id) {
    return { handled: false, reason: 'disabled', error: 'No list ID provided' };
  }

  const uiStore = getUIStore(deps);
  const wb = deps.workbook;

  const deleted = await wb.deleteCustomList(payload.id);
  if (!deleted) {
    return {
      handled: true,
      error: 'Failed to delete custom list (may be a built-in list or not found)',
    };
  }

  // Clear selection in the dialog
  uiStore.getState().selectCustomList(null);

  return handled();
};
