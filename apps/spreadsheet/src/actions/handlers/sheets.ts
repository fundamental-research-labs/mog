/**
 * Sheet Action Handlers
 *
 * Handles sheet-level operations for the unified action system.
 * These handlers are called by the action dispatcher.
 *
 * Actions handled:
 * - MOVE_SHEET: Reorder a sheet within the workbook
 * - COPY_SHEET_TO_POSITION: Copy a sheet and position it
 * - OPEN_PROTECT_SHEET_DIALOG: Open sheet settings dialog for protection
 * - CLOSE_PROTECT_SHEET_DIALOG: Close sheet protection dialog
 * - OPEN_UNPROTECT_SHEET_DIALOG: Open password prompt when unprotecting a sheet
 * - CLOSE_UNPROTECT_SHEET_DIALOG: Close sheet unprotect dialog
 * - PROTECT_SHEET: Apply sheet protection with options and password
 * - UNPROTECT_SHEET: Remove sheet protection
 * - OPEN_PROTECT_WORKBOOK_DIALOG: Open workbook protection dialog
 * - CLOSE_PROTECT_WORKBOOK_DIALOG: Close workbook protection dialog
 * - PROTECT_WORKBOOK: Apply workbook structure protection
 * - UNPROTECT_WORKBOOK: Remove workbook structure protection
 * - SELECT_ALL_SHEETS: Select all visible sheets
 *
 * Excel Parity: Issue 3 (Sheet Tab Context Menu)
 */

import type { ActionHandler, ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';

import { singleCellRange } from '../../systems/shared/types';
import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// Action Handlers
// =============================================================================

/**
 * MOVE_SHEET: Reorder a sheet within the workbook.
 *
 * Reads pending operation data from UIStore (set by MoveOrCopySheetDialog before dispatch):
 * - sourceSheetId: Sheet to move
 * - beforeSheetId: Target position (null = move to end)
 *
 * Uses unified Workbook API for sheet order lookup and move operations.
 */
export const MOVE_SHEET: AsyncActionHandler = async (deps) => {
  const wb = deps.workbook;

  // Read pending operation data from UIStore (set by dialog before dispatch)

  const { pendingMoveSheet } = getUIStore(deps).getState();
  if (!pendingMoveSheet) {
    return notHandled('disabled');
  }

  const { sourceSheetId, beforeSheetId } = pendingMoveSheet;

  // Get current sheet order via unified Workbook API
  const sheetNames = await wb.getSheetNames();
  const currentOrder: string[] = [];
  for (let i = 0; i < sheetNames.length; i++) {
    const ws = await wb.getSheetByIndex(i);
    currentOrder.push(ws.getSheetId());
  }
  const fromIndex = currentOrder.indexOf(sourceSheetId);

  if (fromIndex === -1) {
    // Source sheet not found

    getUIStore(deps).getState().clearPendingMoveSheet();
    return handled();
  }

  // Calculate target index
  let toIndex: number;
  if (beforeSheetId === null) {
    // Move to end
    toIndex = currentOrder.length - 1;
  } else {
    toIndex = currentOrder.indexOf(beforeSheetId);
    if (toIndex === -1) {
      // Target sheet not found, move to end
      toIndex = currentOrder.length - 1;
    } else if (toIndex > fromIndex) {
      // Adjust for removal of source sheet
      toIndex -= 1;
    }
  }

  // Move sheet via unified Workbook API (throws on error, e.g. protection)
  if (fromIndex !== toIndex) {
    try {
      await wb.sheets.move(sourceSheetId, toIndex);
    } catch {
      // Move failed (e.g. workbook protection) - clear pending data and return
      getUIStore(deps).getState().clearPendingMoveSheet();
      return handled();
    }
  }

  // Clear pending data

  getUIStore(deps).getState().clearPendingMoveSheet();
  return handled();
};

/**
 * COPY_SHEET_TO_POSITION: Copy a sheet and position it.
 *
 * Reads pending operation data from UIStore (set by MoveOrCopySheetDialog before dispatch):
 * - sourceSheetId: Sheet to copy
 * - beforeSheetId: Target position (null = copy to end)
 * - newName: Name for the copied sheet
 *
 * Uses unified Workbook API to copy the sheet. Sheet lifecycle focus is owned
 * by the workbook API/kernel path, not repaired by the app handler.
 */
export const COPY_SHEET_TO_POSITION: AsyncActionHandler = async (deps) => {
  const wb = deps.workbook;

  // Read pending operation data from UIStore (set by dialog before dispatch)

  const { pendingCopySheet } = getUIStore(deps).getState();
  if (!pendingCopySheet) {
    return notHandled('disabled');
  }

  const { sourceSheetId, beforeSheetId, newName } = pendingCopySheet;
  const sourceActiveCell = deps.accessors.selection.getActiveCell();

  let targetIndex: number | undefined;
  if (beforeSheetId !== null) {
    const sheetCount = await wb.getSheetCount();
    for (let i = 0; i < sheetCount; i++) {
      const ws = await wb.getSheetByIndex(i);
      if (ws.getSheetId() === beforeSheetId) {
        targetIndex = i;
        break;
      }
    }
  }

  // Copy the sheet via unified Workbook API.
  try {
    await wb.sheets.copy(sourceSheetId, newName, targetIndex);
    deps.commands.selection.setSelection(
      [singleCellRange(sourceActiveCell)],
      sourceActiveCell,
      sourceActiveCell,
      null,
      null,
      'restore',
    );
  } catch {
    // Copy failed
    getUIStore(deps).getState().clearPendingCopySheet();
    return handled();
  }

  // Clear pending data
  getUIStore(deps).getState().clearPendingCopySheet();
  return handled();
};

/**
 * SELECT_ALL_SHEETS: Select all visible sheets.
 *
 * Gets all sheet IDs via unified Workbook API, filters out hidden ones, and sets them as selected.
 */
export const SELECT_ALL_SHEETS: AsyncActionHandler = async (deps) => {
  const wb = deps.workbook;

  // Get all visible sheet IDs via unified Workbook API
  const sheetCount = await wb.getSheetCount();
  const visibleSheetIds: string[] = [];
  for (let i = 0; i < sheetCount; i++) {
    const ws = await wb.getSheetByIndex(i);
    if ((await ws.getVisibility()) === 'visible') {
      visibleSheetIds.push(ws.getSheetId());
    }
  }

  await wb.sheets.setSelectedIds(visibleSheetIds);

  return handled();
};

/**
 * OPEN_PROTECT_SHEET_DIALOG: Open Protect Sheet dialog.
 *
 * Reads pending sheetId from UIStore (set by context menu before dispatch).
 * Makes the sheet active first, then opens the Protect Sheet configuration dialog.
 *
 * Protect Sheet Configuration Dialog
 */
export const OPEN_PROTECT_SHEET_DIALOG: AsyncActionHandler = async (deps) => {
  const wb = deps.workbook;

  const state = getUIStore(deps).getState();
  const { pendingProtectSheetId } = state;

  if (pendingProtectSheetId) {
    // Make the sheet active first via unified Workbook API
    await wb.sheets.setActive(pendingProtectSheetId);
  }

  // Open Protect Sheet dialog (uses new UIStore slice)
  state.openProtectSheetDialog(undefined);

  // Clear pending data
  state.clearPendingProtectSheetId();

  return handled();
};

/**
 * OPEN_PROTECT_WORKBOOK_DIALOG: Open the workbook protection command workflow.
 *
 * Opens protect mode for unprotected workbooks and unprotect mode for protected
 * workbooks so every entrypoint can collect a password before unprotecting.
 * Currently structure protection only (prevents sheet add/delete/move/rename/hide/unhide).
 *
 * Protect Workbook Dialog
 */
export const OPEN_PROTECT_WORKBOOK_DIALOG: AsyncActionHandler = async (deps) => {
  const state = getUIStore(deps).getState();

  if (await deps.workbook.protection.isProtected()) {
    state.openProtectWorkbookDialog(undefined, 'unprotect');
    return handled();
  }

  state.openProtectWorkbookDialog();

  return handled();
};

/**
 * CLOSE_PROTECT_SHEET_DIALOG: Close Protect Sheet dialog.
 *
 * Closes the Protect Sheet configuration dialog without applying changes.
 *
 * Protect Sheet Configuration Dialog
 */
export const CLOSE_PROTECT_SHEET_DIALOG: ActionHandler = (deps) => {
  getUIStore(deps).getState().closeProtectSheetDialog();

  return handled();
};

/**
 * OPEN_UNPROTECT_SHEET_DIALOG: Open password prompt or directly unprotect.
 *
 * Passwordless sheets are unprotected immediately. Password-protected sheets
 * open a dialog so the user can provide the password through the canonical
 * UNPROTECT_SHEET action.
 */
export const OPEN_UNPROTECT_SHEET_DIALOG: AsyncActionHandler = async (deps, payload?: unknown) => {
  const { sheetId } = (payload || {}) as { sheetId?: string };
  const targetSheetId =
    (sheetId ? toSheetId(sheetId) : null) || getUIStore(deps).getState().activeSheetId;
  if (!targetSheetId) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.getSheetById(targetSheetId);
  const config = await ws.protection.getConfig();
  if (!config.isProtected) {
    return notHandled('disabled');
  }

  if (!config.hasPasswordSet) {
    return UNPROTECT_SHEET(deps, { sheetId: targetSheetId });
  }

  getUIStore(deps).getState().openUnprotectSheetDialog(targetSheetId);
  return handled();
};

/**
 * CLOSE_UNPROTECT_SHEET_DIALOG: Close the sheet unprotect password prompt.
 */
export const CLOSE_UNPROTECT_SHEET_DIALOG: ActionHandler = (deps) => {
  getUIStore(deps).getState().closeUnprotectSheetDialog();

  return handled();
};

/**
 * CLOSE_PROTECT_WORKBOOK_DIALOG: Close Protect Workbook dialog.
 *
 * Closes the Protect Workbook configuration dialog without applying changes.
 *
 * Protect Workbook Dialog
 */
export const CLOSE_PROTECT_WORKBOOK_DIALOG: ActionHandler = (deps) => {
  getUIStore(deps).getState().closeProtectWorkbookDialog();

  return handled();
};

/**
 * PROTECT_SHEET: Apply sheet protection with options and optional password.
 *
 * Reads protection configuration from the dialog state and applies it using
 * the unified Worksheet.protect() API, which hashes the password and merges default protection options.
 *
 * Protect Sheet Configuration Dialog
 */
export const PROTECT_SHEET: AsyncActionHandler = async (deps, payload?: unknown) => {
  // Get sheetId, password, and options from payload or active sheet
  const { sheetId, password, options } = (payload || {}) as {
    sheetId?: string;
    password?: string;
    options?: any;
  };

  const targetSheetId =
    (sheetId ? toSheetId(sheetId) : null) || getUIStore(deps).getState().activeSheetId;
  if (!targetSheetId) {
    return notHandled('disabled');
  }

  // Unified Worksheet API — hashes password and merges default protection options.
  const ws = deps.workbook.getSheetById(targetSheetId);
  if (options) {
    await ws.protection.protectWithOptions(password, options);
  } else {
    await ws.protection.protect(password);
  }

  // Close the dialog
  getUIStore(deps).getState().closeProtectSheetDialog();

  return handled();
};

/**
 * UNPROTECT_SHEET: Remove sheet protection.
 *
 * Removes protection from a sheet. If the sheet has a password,
 * the password must be verified first (handled by UI before dispatch).
 *
 * Protect Sheet Configuration Dialog
 */
export const UNPROTECT_SHEET: AsyncActionHandler = async (deps, payload?: unknown) => {
  // Get sheetId and password from payload or active sheet
  const { sheetId, password } = (payload || {}) as {
    sheetId?: string;
    password?: string;
  };

  const targetSheetId =
    (sheetId ? toSheetId(sheetId) : null) || getUIStore(deps).getState().activeSheetId;
  if (!targetSheetId) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.getSheetById(targetSheetId);
  const success = await ws.protection.unprotect(password);

  if (!success) {
    const state = getUIStore(deps).getState();
    if (state.unprotectSheetDialog.isOpen) {
      state.setUnprotectSheetError('The password you supplied is not correct.');
      return handled();
    }

    state.showProtectionAlert('The password you supplied is not correct.');
    return notHandled('disabled');
  }

  getUIStore(deps).getState().closeUnprotectSheetDialog();

  return handled();
};

/**
 * TOGGLE_SHEET_PROTECTION: Toggle sheet protection on the active sheet.
 *
 * Checks the protection state of the active sheet:
 * - If protected → delegates to OPEN_UNPROTECT_SHEET_DIALOG
 * - If not protected → delegates to OPEN_PROTECT_SHEET_DIALOG
 *
 * Mirrors the ReviewRibbon.tsx protect-sheet button onClick logic.
 */
export const TOGGLE_SHEET_PROTECTION: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const targetSheetId = getUIStore(deps).getState().activeSheetId;
  if (!targetSheetId) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.getSheetById(targetSheetId);
  const isProtected = await ws.protection.isProtected();

  if (isProtected) {
    return OPEN_UNPROTECT_SHEET_DIALOG(deps, { sheetId: targetSheetId });
  } else {
    return OPEN_PROTECT_SHEET_DIALOG(deps);
  }
};

/**
 * PROTECT_WORKBOOK: Apply workbook structure protection with optional password.
 *
 * Uses unified Workbook.protect() which manages workbook protection settings.
 *
 * Protect Workbook Dialog
 *
 * Prevents sheet structure operations (add, delete, move, rename, hide, unhide).
 */
export const PROTECT_WORKBOOK: AsyncActionHandler = async (deps, payload?: unknown) => {
  // Get password and options from payload
  const { password, options } = (payload || {}) as {
    password?: string;
    options?: import('@mog-sdk/contracts/protection').WorkbookProtectionOptions;
  };

  await deps.workbook.protection.protect(password, options);

  // Close the dialog
  getUIStore(deps).getState().closeProtectWorkbookDialog();

  return handled();
};

/**
 * UNPROTECT_WORKBOOK: Remove workbook structure protection.
 *
 * Uses unified Workbook.unprotect() which verifies the password and manages
 * workbook settings.
 *
 * Protect Workbook Dialog
 *
 * If workbook has a password, it must be verified before unprotecting.
 */
export const UNPROTECT_WORKBOOK: AsyncActionHandler = async (deps, payload?: unknown) => {
  // Get password from payload
  const { password } = (payload || {}) as {
    password?: string;
  };

  const success = await deps.workbook.protection.unprotect(password);

  if (!success) {
    // Password verification failed - show protection alert
    getUIStore(deps).getState().showProtectionAlert('The password you supplied is not correct.');
    return notHandled('disabled');
  }

  getUIStore(deps).getState().closeProtectWorkbookDialog();

  return handled();
};

// =============================================================================
// Delete-sheet confirmation flow
// =============================================================================

/**
 * OPEN_DELETE_SHEET_CONFIRM_DIALOG: Open the confirmation dialog for a non-empty sheet.
 *
 * Payload:
 * - sheetId: SheetId — the sheet pending deletion
 *
 * The caller (handleDeleteSheet) is responsible for the emptiness check and only
 * dispatches this when the sheet has data. The dialog name is read from the
 * Workbook so it stays accurate even if the sheet was renamed since the
 * context menu opened.
 */
export const OPEN_DELETE_SHEET_CONFIRM_DIALOG: ActionHandler = (deps, payload?: unknown) => {
  const { sheetId } = (payload || {}) as { sheetId?: string };
  if (!sheetId) return notHandled('disabled');

  const ws = deps.workbook.getSheetById(toSheetId(sheetId));
  getUIStore(deps).getState().openDeleteSheetConfirmDialog(toSheetId(sheetId), ws.name);
  return handled();
};

/**
 * CLOSE_DELETE_SHEET_CONFIRM_DIALOG: Dismiss the dialog without deleting.
 */
export const CLOSE_DELETE_SHEET_CONFIRM_DIALOG: ActionHandler = (deps) => {
  getUIStore(deps).getState().closeDeleteSheetConfirmDialog();
  return handled();
};

/**
 * CONFIRM_DELETE_SHEET: Confirmed path — actually remove the sheet.
 *
 * Payload (optional):
 * - sheetId: SheetId — falls back to the sheetId stored in the dialog state.
 *
 * Calls wb.sheets.remove and closes the dialog. Sheet lifecycle focus is
 * owned by the workbook API/kernel path, not repaired by the app handler.
 *
 * Always closes the dialog before returning, even if removal fails (e.g. last
 * remaining sheet, workbook protection), so the user is never trapped behind
 * the modal.
 */
export const CONFIRM_DELETE_SHEET: AsyncActionHandler = async (deps, payload?: unknown) => {
  const wb = deps.workbook;
  const ui = getUIStore(deps).getState();

  const explicitId = (payload as { sheetId?: string } | undefined)?.sheetId;
  const target = explicitId ? toSheetId(explicitId) : ui.deleteSheetConfirmDialog.sheetId;
  if (!target) {
    ui.closeDeleteSheetConfirmDialog();
    return notHandled('disabled');
  }

  const sheetCount = await wb.getSheetCount();
  if (sheetCount <= 1) {
    // Workbook would be empty — refuse and close. Should not normally reach
    // here because the menu disables Delete on the last sheet.
    ui.closeDeleteSheetConfirmDialog();
    return notHandled('disabled');
  }

  try {
    await wb.sheets.remove(target);
  } finally {
    ui.closeDeleteSheetConfirmDialog();
  }

  return handled();
};
