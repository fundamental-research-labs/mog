/**
 * Data Validation Dialog Slice
 *
 * Manages state for the data validation dialog.
 */

import type { StateCreator } from 'zustand';

/**
 * Data Validation type for the dialog
 *
 * Added 'any' and 'time' validation types for Excel-compatible behavior.
 * - any: No validation (Excel's default "Any value")
 * - time: Time value validation
 */
export type DVValidationType =
  | 'any'
  | 'list'
  | 'wholeNumber'
  | 'decimal'
  | 'date'
  | 'time'
  | 'textLength'
  | 'custom';

/**
 * Data Validation dialog state
 */
export interface DVDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Current mode: 'create' or 'edit' */
  mode: 'create' | 'edit';
  /** Schema being edited (for edit mode) */
  editingSchemaId: string | null;
  /** Selected validation type */
  selectedValidationType: DVValidationType;
}

export interface DVDialogSlice {
  dvDialog: DVDialogState;
  openDVDialog: (mode?: 'create' | 'edit', schemaId?: string) => void;
  closeDVDialog: () => void;
  setDVValidationType: (validationType: DVValidationType) => void;
}

const initialState: DVDialogState = {
  isOpen: false,
  mode: 'create',
  editingSchemaId: null,
  // Default to 'any' (no validation) to match Excel's default
  selectedValidationType: 'any',
};

export const createDVDialogSlice: StateCreator<DVDialogSlice, [], [], DVDialogSlice> = (set) => ({
  dvDialog: initialState,

  openDVDialog: (mode = 'create', schemaId) => {
    set({
      dvDialog: {
        isOpen: true,
        mode,
        editingSchemaId: schemaId ?? null,
        // Default to 'any' (no validation) to match Excel's default
        selectedValidationType: 'any',
      },
    });
  },

  closeDVDialog: () => {
    set({ dvDialog: initialState });
  },

  setDVValidationType: (validationType: DVValidationType) => {
    set((s) => ({
      dvDialog: {
        ...s.dvDialog,
        selectedValidationType: validationType,
      },
    }));
  },
});
