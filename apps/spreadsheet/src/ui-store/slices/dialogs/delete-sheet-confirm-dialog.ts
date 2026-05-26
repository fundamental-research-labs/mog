/**
 * Delete Sheet Confirm Dialog Slice
 *
 * Manages state for the confirmation dialog shown before deleting a non-empty
 * sheet. Excel parity: deleting a sheet that contains data prompts the user
 * to confirm; deleting an empty sheet skips the prompt.
 */

import type { StateCreator } from 'zustand';

import type { SheetId } from '@mog-sdk/contracts/core';

export interface DeleteSheetConfirmDialogState {
  isOpen: boolean;
  /** Sheet pending deletion. null when the dialog is closed. */
  sheetId: SheetId | null;
  /** Display name of the pending sheet, used in the dialog body. */
  sheetName: string | null;
}

export interface DeleteSheetConfirmDialogSlice {
  deleteSheetConfirmDialog: DeleteSheetConfirmDialogState;
  openDeleteSheetConfirmDialog: (sheetId: SheetId, sheetName: string) => void;
  closeDeleteSheetConfirmDialog: () => void;
}

const initialState: DeleteSheetConfirmDialogState = {
  isOpen: false,
  sheetId: null,
  sheetName: null,
};

export const createDeleteSheetConfirmDialogSlice: StateCreator<
  DeleteSheetConfirmDialogSlice,
  [],
  [],
  DeleteSheetConfirmDialogSlice
> = (set) => ({
  deleteSheetConfirmDialog: initialState,

  openDeleteSheetConfirmDialog: (sheetId, sheetName) => {
    set({
      deleteSheetConfirmDialog: {
        isOpen: true,
        sheetId,
        sheetName,
      },
    });
  },

  closeDeleteSheetConfirmDialog: () => {
    set({ deleteSheetConfirmDialog: initialState });
  },
});
