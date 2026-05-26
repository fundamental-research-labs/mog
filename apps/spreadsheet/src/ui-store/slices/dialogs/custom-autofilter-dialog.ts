/**
 * Custom AutoFilter Dialog Slice
 *
 * Manages state for the Custom AutoFilter dialog that allows users
 * to define two filter conditions with AND/OR logic.
 *
 * Excel parity 14.3: Custom AutoFilter Dialog
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Filter operators supported by Custom AutoFilter.
 * Matches Excel's operator list.
 */
export type CustomFilterOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterOrEqual'
  | 'lessOrEqual'
  | 'beginsWith'
  | 'endsWith'
  | 'contains'
  | 'notContains';

/**
 * A single filter condition.
 */
export interface CustomFilterCondition {
  /** The comparison operator */
  operator: CustomFilterOperator;
  /** The value to compare against (supports wildcards: * and ?) */
  value: string;
}

/**
 * Custom AutoFilter dialog state
 */
export interface CustomAutoFilterDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** The filter ID this dialog is editing */
  filterId: string | null;
  /** The column index (0-based) being filtered */
  columnIndex: number | null;
  /** Display name of the column for the dialog title */
  columnName: string | null;
  /** First filter condition */
  condition1: CustomFilterCondition;
  /** Second filter condition (optional) */
  condition2: CustomFilterCondition;
  /** Logical operator between conditions */
  logicalOperator: 'and' | 'or';
  /** Error message to display */
  errorMessage: string | null;
}

export interface CustomAutoFilterDialogSlice {
  customAutoFilterDialog: CustomAutoFilterDialogState;
  /**
   * Open the Custom AutoFilter dialog for a specific column.
   * @param filterId - The filter ID
   * @param columnIndex - The column index (0-based)
   * @param columnName - Optional display name for the column
   * @param existingConditions - Optional existing conditions to pre-populate
   */
  openCustomAutoFilterDialog: (
    filterId: string,
    columnIndex: number,
    columnName?: string,
    existingConditions?: {
      condition1?: Partial<CustomFilterCondition>;
      condition2?: Partial<CustomFilterCondition>;
      logicalOperator?: 'and' | 'or';
    },
  ) => void;
  /** Close the Custom AutoFilter dialog */
  closeCustomAutoFilterDialog: () => void;
  /** Update the first filter condition */
  setCondition1: (condition: Partial<CustomFilterCondition>) => void;
  /** Update the second filter condition */
  setCondition2: (condition: Partial<CustomFilterCondition>) => void;
  /** Set the logical operator (AND/OR) */
  setLogicalOperator: (op: 'and' | 'or') => void;
  /** Set an error message */
  setCustomAutoFilterError: (message: string | null) => void;
  /** Reset the dialog to initial state */
  resetCustomAutoFilterDialog: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const defaultCondition: CustomFilterCondition = {
  operator: 'equals',
  value: '',
};

const initialState: CustomAutoFilterDialogState = {
  isOpen: false,
  filterId: null,
  columnIndex: null,
  columnName: null,
  condition1: { ...defaultCondition },
  condition2: { ...defaultCondition },
  logicalOperator: 'and',
  errorMessage: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createCustomAutoFilterDialogSlice: StateCreator<
  CustomAutoFilterDialogSlice,
  [],
  [],
  CustomAutoFilterDialogSlice
> = (set) => ({
  customAutoFilterDialog: initialState,

  openCustomAutoFilterDialog: (filterId, columnIndex, columnName, existingConditions) => {
    set({
      customAutoFilterDialog: {
        isOpen: true,
        filterId,
        columnIndex,
        columnName: columnName ?? null,
        condition1: existingConditions?.condition1
          ? { ...defaultCondition, ...existingConditions.condition1 }
          : { ...defaultCondition },
        condition2: existingConditions?.condition2
          ? { ...defaultCondition, ...existingConditions.condition2 }
          : { ...defaultCondition },
        logicalOperator: existingConditions?.logicalOperator ?? 'and',
        errorMessage: null,
      },
    });
  },

  closeCustomAutoFilterDialog: () => {
    set((state) => ({
      customAutoFilterDialog: {
        ...state.customAutoFilterDialog,
        isOpen: false,
      },
    }));
  },

  setCondition1: (condition) => {
    set((state) => ({
      customAutoFilterDialog: {
        ...state.customAutoFilterDialog,
        condition1: {
          ...state.customAutoFilterDialog.condition1,
          ...condition,
        },
        errorMessage: null,
      },
    }));
  },

  setCondition2: (condition) => {
    set((state) => ({
      customAutoFilterDialog: {
        ...state.customAutoFilterDialog,
        condition2: {
          ...state.customAutoFilterDialog.condition2,
          ...condition,
        },
        errorMessage: null,
      },
    }));
  },

  setLogicalOperator: (op) => {
    set((state) => ({
      customAutoFilterDialog: {
        ...state.customAutoFilterDialog,
        logicalOperator: op,
      },
    }));
  },

  setCustomAutoFilterError: (message) => {
    set((state) => ({
      customAutoFilterDialog: {
        ...state.customAutoFilterDialog,
        errorMessage: message,
      },
    }));
  },

  resetCustomAutoFilterDialog: () => {
    set({
      customAutoFilterDialog: initialState,
    });
  },
});
