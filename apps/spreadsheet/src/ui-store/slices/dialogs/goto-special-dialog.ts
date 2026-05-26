/**
 * Go To Special Dialog Slice
 *
 * Manages state for the Go To Special dialog (Ctrl+G, then "Special" or Alt+S).
 * This dialog allows selecting cells by type: blanks, formulas, constants, etc.
 *
 * Excel parity 14.1: Go To Special Dialog
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Go To Special selection type options.
 * Maps to Excel's Go To Special dialog options.
 */
export type GoToSpecialType =
  | 'comments'
  | 'constants'
  | 'formulas'
  | 'blanks'
  | 'currentRegion'
  | 'currentArray'
  | 'objects'
  | 'rowDifferences'
  | 'columnDifferences'
  | 'precedents'
  | 'dependents'
  | 'lastCell'
  | 'visibleCellsOnly'
  | 'conditionalFormats'
  | 'dataValidation'
  | 'sameValidation';

/**
 * For formulas/constants, can further filter by value type.
 */
export type ValueTypeFilter = {
  numbers: boolean;
  text: boolean;
  logicals: boolean;
  errors: boolean;
};

/**
 * Go To Special dialog state
 */
export interface GoToSpecialDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Currently selected type */
  selectedType: GoToSpecialType;
  /** Value type filters (for formulas/constants) */
  valueTypeFilters: ValueTypeFilter;
}

export interface GoToSpecialDialogSlice {
  goToSpecialDialog: GoToSpecialDialogState;
  openGoToSpecialDialog: () => void;
  closeGoToSpecialDialog: () => void;
  setGoToSpecialType: (type: GoToSpecialType) => void;
  setGoToSpecialValueTypeFilter: (filter: Partial<ValueTypeFilter>) => void;
  resetGoToSpecialDialog: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const defaultValueTypeFilters: ValueTypeFilter = {
  numbers: true,
  text: true,
  logicals: true,
  errors: true,
};

const initialState: GoToSpecialDialogState = {
  isOpen: false,
  selectedType: 'blanks',
  valueTypeFilters: { ...defaultValueTypeFilters },
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createGoToSpecialDialogSlice: StateCreator<
  GoToSpecialDialogSlice,
  [],
  [],
  GoToSpecialDialogSlice
> = (set) => ({
  goToSpecialDialog: initialState,

  openGoToSpecialDialog: () => {
    set({
      goToSpecialDialog: {
        ...initialState,
        isOpen: true,
      },
    });
  },

  closeGoToSpecialDialog: () => {
    set((state) => ({
      goToSpecialDialog: {
        ...state.goToSpecialDialog,
        isOpen: false,
      },
    }));
  },

  setGoToSpecialType: (type: GoToSpecialType) => {
    set((state) => ({
      goToSpecialDialog: {
        ...state.goToSpecialDialog,
        selectedType: type,
      },
    }));
  },

  setGoToSpecialValueTypeFilter: (filter: Partial<ValueTypeFilter>) => {
    set((state) => ({
      goToSpecialDialog: {
        ...state.goToSpecialDialog,
        valueTypeFilters: {
          ...state.goToSpecialDialog.valueTypeFilters,
          ...filter,
        },
      },
    }));
  },

  resetGoToSpecialDialog: () => {
    set({
      goToSpecialDialog: initialState,
    });
  },
});
