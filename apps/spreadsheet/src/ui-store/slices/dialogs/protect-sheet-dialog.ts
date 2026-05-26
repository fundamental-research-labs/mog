/**
 * Protect Sheet Dialog Slice
 *
 * Manages state for the Protect Sheet dialog.
 * Allows users to configure sheet protection options and optional password.
 *
 * Excel Parity: Protect Sheet Configuration Dialog
 */

import type { StateCreator } from 'zustand';

import type { SheetProtectionOptions } from '@mog-sdk/contracts/protection';

// =============================================================================
// Types
// =============================================================================

/**
 * Protect Sheet dialog state
 */
export interface ProtectSheetDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Optional password (masked in UI) */
  password: string;
  /** Confirm password field (masked in UI) */
  confirmPassword: string;
  /** Protection options (what operations to allow) */
  options: SheetProtectionOptions;
}

export interface ProtectSheetDialogSlice {
  protectSheetDialog: ProtectSheetDialogState;
  openProtectSheetDialog: (currentOptions?: Partial<SheetProtectionOptions>) => void;
  closeProtectSheetDialog: () => void;
  setProtectSheetPassword: (password: string) => void;
  setProtectSheetConfirmPassword: (confirmPassword: string) => void;
  setProtectSheetOption: (option: keyof SheetProtectionOptions, value: boolean) => void;
  resetProtectSheetDialog: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

/**
 * Default protection options.
 * Selection enabled, all other operations blocked.
 */
const defaultProtectionOptions: SheetProtectionOptions = {
  // Selection defaults to true (users can always select cells)
  selectLockedCells: true,
  selectUnlockedCells: true,
  // All other operations blocked by default
  insertRows: false,
  insertColumns: false,
  insertHyperlinks: false,
  deleteRows: false,
  deleteColumns: false,
  formatCells: false,
  formatColumns: false,
  formatRows: false,
  sort: false,
  useAutoFilter: false,
  usePivotTableReports: false,
  editObjects: false,
  editScenarios: false,
};

const initialState: ProtectSheetDialogState = {
  isOpen: false,
  password: '',
  confirmPassword: '',
  options: { ...defaultProtectionOptions },
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createProtectSheetDialogSlice: StateCreator<
  ProtectSheetDialogSlice,
  [],
  [],
  ProtectSheetDialogSlice
> = (set) => ({
  protectSheetDialog: initialState,

  openProtectSheetDialog: (currentOptions) => {
    set({
      protectSheetDialog: {
        isOpen: true,
        password: '',
        confirmPassword: '',
        options: {
          ...defaultProtectionOptions,
          ...currentOptions,
        },
      },
    });
  },

  closeProtectSheetDialog: () => {
    set((state) => ({
      protectSheetDialog: {
        ...state.protectSheetDialog,
        isOpen: false,
      },
    }));
  },

  setProtectSheetPassword: (password: string) => {
    set((state) => ({
      protectSheetDialog: {
        ...state.protectSheetDialog,
        password,
      },
    }));
  },

  setProtectSheetConfirmPassword: (confirmPassword: string) => {
    set((state) => ({
      protectSheetDialog: {
        ...state.protectSheetDialog,
        confirmPassword,
      },
    }));
  },

  setProtectSheetOption: (option: keyof SheetProtectionOptions, value: boolean) => {
    set((state) => ({
      protectSheetDialog: {
        ...state.protectSheetDialog,
        options: {
          ...state.protectSheetDialog.options,
          [option]: value,
        },
      },
    }));
  },

  resetProtectSheetDialog: () => {
    set({
      protectSheetDialog: initialState,
    });
  },
});
