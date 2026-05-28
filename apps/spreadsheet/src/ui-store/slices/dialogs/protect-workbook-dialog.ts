/**
 * Protect Workbook Dialog Slice
 *
 * Manages state for the Protect Workbook dialog.
 * Allows users to configure workbook structure protection and optional password.
 *
 * Excel Parity: Protect Workbook Dialog
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Workbook protection options.
 * Currently only "structure" is supported (prevents sheet add/delete/move/rename/hide/unhide).
 *
 * TODO: Backend workbook protection not yet implemented.
 * When implemented, these options should be stored in workbook state.
 * @see contracts/src/protection.ts for sheet protection reference
 */
export interface WorkbookProtectionOptions {
  /** Protect workbook structure (prevents sheet operations) */
  structure: boolean;
  // Future: windows: boolean; // Protect window position and size
}

export type ProtectWorkbookDialogMode = 'protect' | 'unprotect';

/**
 * Protect Workbook dialog state
 */
export interface ProtectWorkbookDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Whether OK protects or unprotects workbook structure */
  mode: ProtectWorkbookDialogMode;
  /** Optional password (masked in UI) */
  password: string;
  /** Confirm password field (masked in UI) */
  confirmPassword: string;
  /** Protection options */
  options: WorkbookProtectionOptions;
}

export interface ProtectWorkbookDialogSlice {
  protectWorkbookDialog: ProtectWorkbookDialogState;
  openProtectWorkbookDialog: (
    currentOptions?: Partial<WorkbookProtectionOptions>,
    mode?: ProtectWorkbookDialogMode,
  ) => void;
  closeProtectWorkbookDialog: () => void;
  setProtectWorkbookPassword: (password: string) => void;
  setProtectWorkbookConfirmPassword: (confirmPassword: string) => void;
  setProtectWorkbookOption: (option: keyof WorkbookProtectionOptions, value: boolean) => void;
  resetProtectWorkbookDialog: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

/**
 * Default workbook protection options.
 * Structure protection enabled by default.
 */
const defaultProtectionOptions: WorkbookProtectionOptions = {
  structure: true,
};

const initialState: ProtectWorkbookDialogState = {
  isOpen: false,
  mode: 'protect',
  password: '',
  confirmPassword: '',
  options: { ...defaultProtectionOptions },
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createProtectWorkbookDialogSlice: StateCreator<
  ProtectWorkbookDialogSlice,
  [],
  [],
  ProtectWorkbookDialogSlice
> = (set) => ({
  protectWorkbookDialog: initialState,

  openProtectWorkbookDialog: (currentOptions, mode = 'protect') => {
    set({
      protectWorkbookDialog: {
        isOpen: true,
        mode,
        password: '',
        confirmPassword: '',
        options: {
          ...defaultProtectionOptions,
          ...currentOptions,
        },
      },
    });
  },

  closeProtectWorkbookDialog: () => {
    set({
      protectWorkbookDialog: initialState,
    });
  },

  setProtectWorkbookPassword: (password: string) => {
    set((state) => ({
      protectWorkbookDialog: {
        ...state.protectWorkbookDialog,
        password,
      },
    }));
  },

  setProtectWorkbookConfirmPassword: (confirmPassword: string) => {
    set((state) => ({
      protectWorkbookDialog: {
        ...state.protectWorkbookDialog,
        confirmPassword,
      },
    }));
  },

  setProtectWorkbookOption: (option: keyof WorkbookProtectionOptions, value: boolean) => {
    set((state) => ({
      protectWorkbookDialog: {
        ...state.protectWorkbookDialog,
        options: {
          ...state.protectWorkbookDialog.options,
          [option]: value,
        },
      },
    }));
  },

  resetProtectWorkbookDialog: () => {
    set({
      protectWorkbookDialog: initialState,
    });
  },
});
