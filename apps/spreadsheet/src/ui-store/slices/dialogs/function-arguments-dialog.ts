/**
 * Function Arguments Dialog Slice
 *
 * Manages state for the function arguments dialog UI.
 */

import type { StateCreator } from 'zustand';

export interface FunctionArgumentsDialogSlice {
  /** Whether the Function Arguments dialog is open */
  functionArgumentsDialogOpen: boolean;
  openFunctionArgumentsDialog: () => void;
  closeFunctionArgumentsDialog: () => void;
}

export const createFunctionArgumentsDialogSlice: StateCreator<
  FunctionArgumentsDialogSlice,
  [],
  [],
  FunctionArgumentsDialogSlice
> = (set) => ({
  functionArgumentsDialogOpen: false,

  openFunctionArgumentsDialog: () => {
    set({ functionArgumentsDialogOpen: true });
  },

  closeFunctionArgumentsDialog: () => {
    set({ functionArgumentsDialogOpen: false });
  },
});
