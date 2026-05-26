/**
 * Formulas Slice
 *
 * Manages state for formula-related UI.
 */

import type { StateCreator } from 'zustand';

export interface FormulasSlice {
  /** Whether the Insert Function dialog is open */
  insertFunctionDialogOpen: boolean;
  openInsertFunctionDialog: () => void;
  closeInsertFunctionDialog: () => void;
}

export const createFormulasSlice: StateCreator<FormulasSlice, [], [], FormulasSlice> = (set) => ({
  insertFunctionDialogOpen: false,

  openInsertFunctionDialog: () => {
    set({ insertFunctionDialogOpen: true });
  },

  closeInsertFunctionDialog: () => {
    set({ insertFunctionDialogOpen: false });
  },
});
