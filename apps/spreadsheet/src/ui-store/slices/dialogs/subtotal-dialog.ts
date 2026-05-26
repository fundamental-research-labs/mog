/**
 * Subtotal Dialog Slice
 *
 * Manages state for the subtotals dialog
 */

import type { StateCreator } from 'zustand';
import type { CellRange } from '@mog-sdk/contracts/core';

/**
 * Subtotals dialog state
 */
export interface SubtotalDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  range: CellRange | null;
  hasHeaders: boolean;
}

export interface SubtotalDialogSlice {
  subtotalDialog: SubtotalDialogState;
  openSubtotalDialog: (payload: { range: CellRange; hasHeaders: boolean }) => void;
  closeSubtotalDialog: () => void;
}

const initialState: SubtotalDialogState = {
  isOpen: false,
  range: null,
  hasHeaders: false,
};

export const createSubtotalDialogSlice: StateCreator<
  SubtotalDialogSlice,
  [],
  [],
  SubtotalDialogSlice
> = (set) => ({
  subtotalDialog: initialState,

  openSubtotalDialog: (payload) => {
    set({
      subtotalDialog: {
        isOpen: true,
        range: payload.range,
        hasHeaders: payload.hasHeaders,
      },
    });
  },

  closeSubtotalDialog: () => {
    set({ subtotalDialog: initialState });
  },
});
