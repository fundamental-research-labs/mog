/**
 * State for the formula syntax error dialog.
 *
 * The editor commit coordinator owns the validation decision, but it lives
 * above React UI. This slice is the bridge that lets that coordinator surface
 * the modal while keeping the retry/accept callbacks out of serializable state.
 */

import type { StateCreator } from 'zustand';

export interface FormulaErrorDialogState {
  formulaErrorDialog: {
    isOpen: boolean;
    formula: string;
    errorMessage: string;
    errorPosition?: number;
  };
}

export interface FormulaErrorDialogActions {
  showFormulaError: (
    formula: string,
    errorMessage: string,
    onEdit: () => void,
    onAcceptAsText: () => void,
    errorPosition?: number,
  ) => void;
  closeFormulaError: () => void;
  getFormulaErrorCallbacks: () => {
    onEdit: () => void;
    onAcceptAsText: () => void;
  };
}

export type FormulaErrorDialogSlice = FormulaErrorDialogState & FormulaErrorDialogActions;

export const initialFormulaErrorDialogState: FormulaErrorDialogState = {
  formulaErrorDialog: {
    isOpen: false,
    formula: '',
    errorMessage: '',
  },
};

let _formulaErrorCallbacks = {
  onEdit: () => {},
  onAcceptAsText: () => {},
};

export const createFormulaErrorDialogSlice: StateCreator<
  FormulaErrorDialogSlice,
  [],
  [],
  FormulaErrorDialogSlice
> = (set) => ({
  ...initialFormulaErrorDialogState,

  showFormulaError: (formula, errorMessage, onEdit, onAcceptAsText, errorPosition) => {
    _formulaErrorCallbacks = { onEdit, onAcceptAsText };
    set({
      formulaErrorDialog: {
        isOpen: true,
        formula,
        errorMessage,
        ...(errorPosition == null ? {} : { errorPosition }),
      },
    });
  },

  closeFormulaError: () => {
    set(initialFormulaErrorDialogState);
  },

  getFormulaErrorCallbacks: () => _formulaErrorCallbacks,
});
