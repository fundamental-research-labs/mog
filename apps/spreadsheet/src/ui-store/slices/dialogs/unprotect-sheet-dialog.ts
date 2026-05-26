/**
 * Unprotect Sheet Dialog Slice
 *
 * Tracks the password prompt shown when removing password-protected sheet
 * protection.
 */

import type { StateCreator } from 'zustand';

import type { SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Types
// =============================================================================

export interface UnprotectSheetDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Sheet whose protection is being removed */
  sheetId: SheetId | null;
  /** Password entered by the user */
  password: string;
  /** Validation or verification error to display */
  error: string | null;
}

export interface UnprotectSheetDialogSlice {
  unprotectSheetDialog: UnprotectSheetDialogState;
  openUnprotectSheetDialog: (sheetId: SheetId) => void;
  closeUnprotectSheetDialog: () => void;
  setUnprotectSheetPassword: (password: string) => void;
  setUnprotectSheetError: (error: string | null) => void;
  resetUnprotectSheetDialog: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialState: UnprotectSheetDialogState = {
  isOpen: false,
  sheetId: null,
  password: '',
  error: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createUnprotectSheetDialogSlice: StateCreator<
  UnprotectSheetDialogSlice,
  [],
  [],
  UnprotectSheetDialogSlice
> = (set) => ({
  unprotectSheetDialog: initialState,

  openUnprotectSheetDialog: (sheetId) => {
    set({
      unprotectSheetDialog: {
        isOpen: true,
        sheetId,
        password: '',
        error: null,
      },
    });
  },

  closeUnprotectSheetDialog: () => {
    set((state) => ({
      unprotectSheetDialog: {
        ...state.unprotectSheetDialog,
        isOpen: false,
        sheetId: null,
        password: '',
        error: null,
      },
    }));
  },

  setUnprotectSheetPassword: (password) => {
    set((state) => ({
      unprotectSheetDialog: {
        ...state.unprotectSheetDialog,
        password,
        error: null,
      },
    }));
  },

  setUnprotectSheetError: (error) => {
    set((state) => ({
      unprotectSheetDialog: {
        ...state.unprotectSheetDialog,
        error,
      },
    }));
  },

  resetUnprotectSheetDialog: () => {
    set({
      unprotectSheetDialog: initialState,
    });
  },
});
