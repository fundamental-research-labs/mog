/**
 * Error Checking Dialog Slice
 *
 * Manages state for the Error Checking dialog, which helps users
 * navigate through and fix formula errors in the workbook.
 *
 * Features:
 * - Navigate through errors in sheet
 * - Display error explanation
 * - Suggested fixes
 * - Options to ignore, trace, or fix errors
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Error type enumeration
 */
export type FormulaErrorType =
  | 'Value'
  | 'Ref'
  | 'Name'
  | 'Div0'
  | 'Na'
  | 'Null'
  | 'Num'
  | 'Spill'
  | 'Calc'
  | 'inconsistent_formula'
  | 'number_stored_as_text'
  | 'empty_cell_reference'
  | 'unlocked_formula_cell'
  | 'formula_omits_cells';

/**
 * Information about a formula error
 */
export interface FormulaError {
  /** Unique ID for the error */
  id: string;
  /** Sheet ID where error was found */
  sheetId: string;
  /** Sheet name for display */
  sheetName: string;
  /** Cell row */
  row: number;
  /** Cell column */
  col: number;
  /** Cell reference string (e.g., "A1") */
  cellRef: string;
  /** The error type */
  errorType: FormulaErrorType;
  /** Human-readable error message */
  errorMessage: string;
  /** Detailed explanation of the error */
  explanation: string;
  /** The formula that caused the error */
  formula: string;
  /** Suggested fix actions */
  suggestedFixes: string[];
}

/**
 * Error checking status
 */
export type ErrorCheckingStatus = 'idle' | 'checking' | 'completed' | 'no-errors';

/**
 * Error Checking dialog state
 */
export interface ErrorCheckingDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Current error checking status */
  status: ErrorCheckingStatus;
  /** Current error being displayed */
  currentError: FormulaError | null;
  /** Index of current error in the errors list */
  currentErrorIndex: number;
  /** All found formula errors */
  errors: FormulaError[];
  /** Errors that have been ignored */
  ignoredErrorIds: Set<string>;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface ErrorCheckingDialogSlice {
  /** Error Checking dialog state */
  errorCheckingDialog: ErrorCheckingDialogState;

  /** Open the Error Checking dialog and start checking */
  openErrorCheckingDialog: () => void;

  /** Close the Error Checking dialog */
  closeErrorCheckingDialog: () => void;

  /** Set the error checking status */
  setErrorCheckingStatus: (status: ErrorCheckingStatus) => void;

  /** Set the list of formula errors found */
  setFormulaErrors: (errors: FormulaError[]) => void;

  /** Move to the next error */
  nextFormulaError: () => void;

  /** Move to the previous error */
  previousFormulaError: () => void;

  /** Ignore the current error */
  ignoreCurrentError: () => void;

  /** Mark current error as resolved and move to next */
  resolveCurrentFormulaError: () => void;

  /** Clear all ignored errors (re-check them) */
  clearIgnoredErrors: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialErrorCheckingDialogState: ErrorCheckingDialogState = {
  isOpen: false,
  status: 'idle',
  currentError: null,
  currentErrorIndex: -1,
  errors: [],
  ignoredErrorIds: new Set(),
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createErrorCheckingDialogSlice: StateCreator<
  ErrorCheckingDialogSlice,
  [],
  [],
  ErrorCheckingDialogSlice
> = (set, get) => ({
  errorCheckingDialog: initialErrorCheckingDialogState,

  openErrorCheckingDialog: () => {
    set({
      errorCheckingDialog: {
        ...initialErrorCheckingDialogState,
        isOpen: true,
        status: 'checking',
        // Preserve ignored errors between opens
        ignoredErrorIds: get().errorCheckingDialog.ignoredErrorIds,
      },
    });
  },

  closeErrorCheckingDialog: () => {
    set((state) => ({
      errorCheckingDialog: {
        ...initialErrorCheckingDialogState,
        // Preserve ignored errors
        ignoredErrorIds: state.errorCheckingDialog.ignoredErrorIds,
      },
    }));
  },

  setErrorCheckingStatus: (status) => {
    set((state) => ({
      errorCheckingDialog: {
        ...state.errorCheckingDialog,
        status,
      },
    }));
  },

  setFormulaErrors: (errors) => {
    const ignoredIds = get().errorCheckingDialog.ignoredErrorIds;
    // Filter out ignored errors
    const activeErrors = errors.filter((e) => !ignoredIds.has(e.id));
    const firstError = activeErrors.length > 0 ? activeErrors[0] : null;

    set((state) => ({
      errorCheckingDialog: {
        ...state.errorCheckingDialog,
        errors: activeErrors,
        currentError: firstError,
        currentErrorIndex: firstError ? 0 : -1,
        status: activeErrors.length > 0 ? 'checking' : 'no-errors',
      },
    }));
  },

  nextFormulaError: () => {
    const state = get().errorCheckingDialog;
    const nextIndex = state.currentErrorIndex + 1;

    if (nextIndex >= state.errors.length) {
      // Wrap around to first error
      const firstError = state.errors.length > 0 ? state.errors[0] : null;
      set({
        errorCheckingDialog: {
          ...state,
          currentError: firstError,
          currentErrorIndex: firstError ? 0 : -1,
          status: state.errors.length > 0 ? 'checking' : 'completed',
        },
      });
    } else {
      set({
        errorCheckingDialog: {
          ...state,
          currentError: state.errors[nextIndex],
          currentErrorIndex: nextIndex,
        },
      });
    }
  },

  previousFormulaError: () => {
    const state = get().errorCheckingDialog;
    const prevIndex = state.currentErrorIndex - 1;

    if (prevIndex < 0) {
      // Wrap around to last error
      const lastIndex = state.errors.length - 1;
      const lastError = state.errors.length > 0 ? state.errors[lastIndex] : null;
      set({
        errorCheckingDialog: {
          ...state,
          currentError: lastError,
          currentErrorIndex: lastError ? lastIndex : -1,
        },
      });
    } else {
      set({
        errorCheckingDialog: {
          ...state,
          currentError: state.errors[prevIndex],
          currentErrorIndex: prevIndex,
        },
      });
    }
  },

  ignoreCurrentError: () => {
    const state = get().errorCheckingDialog;
    const currentError = state.currentError;

    if (!currentError) return;

    // Add to ignored set
    const newIgnoredIds = new Set(state.ignoredErrorIds);
    newIgnoredIds.add(currentError.id);

    // Remove from active errors
    const remainingErrors = state.errors.filter((e) => e.id !== currentError.id);
    const nextIndex = Math.min(state.currentErrorIndex, remainingErrors.length - 1);
    const nextError = remainingErrors.length > 0 ? remainingErrors[Math.max(0, nextIndex)] : null;

    set({
      errorCheckingDialog: {
        ...state,
        ignoredErrorIds: newIgnoredIds,
        errors: remainingErrors,
        currentError: nextError,
        currentErrorIndex: nextError ? Math.max(0, nextIndex) : -1,
        status: remainingErrors.length > 0 ? 'checking' : 'completed',
      },
    });
  },

  resolveCurrentFormulaError: () => {
    const state = get().errorCheckingDialog;

    // Remove current error from list
    const remainingErrors = state.errors.filter((_, idx) => idx !== state.currentErrorIndex);

    // Get next error
    const nextIndex = Math.min(state.currentErrorIndex, remainingErrors.length - 1);
    const nextError = remainingErrors.length > 0 ? remainingErrors[Math.max(0, nextIndex)] : null;

    set({
      errorCheckingDialog: {
        ...state,
        errors: remainingErrors,
        currentError: nextError,
        currentErrorIndex: nextError ? Math.max(0, nextIndex) : -1,
        status: remainingErrors.length > 0 ? 'checking' : 'completed',
      },
    });
  },

  clearIgnoredErrors: () => {
    set((state) => ({
      errorCheckingDialog: {
        ...state.errorCheckingDialog,
        ignoredErrorIds: new Set(),
      },
    }));
  },
});
