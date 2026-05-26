/**
 * Data Tools Slice
 *
 * Manages state for data tools dialogs (remove duplicates, text to columns).
 */

import type { StateCreator } from 'zustand';
import type { CellRange } from '@mog-sdk/contracts/core';

export interface RemoveDuplicatesDialogTarget {
  range: CellRange;
  hasHeaders: boolean;
}

export interface DataToolsSlice {
  /** Whether the remove duplicates dialog is open */
  removeDuplicatesDialogOpen: boolean;
  removeDuplicatesDialogTarget: RemoveDuplicatesDialogTarget | null;
  /** Whether the text to columns dialog is open */
  textToColumnsDialogOpen: boolean;
  textToColumnsDialogRange: CellRange | null;
  openRemoveDuplicatesDialog: (target: RemoveDuplicatesDialogTarget) => void;
  closeRemoveDuplicatesDialog: () => void;
  openTextToColumnsDialog: (payload: { range: CellRange }) => void;
  closeTextToColumnsDialog: () => void;
}

export const createDataToolsSlice: StateCreator<DataToolsSlice, [], [], DataToolsSlice> = (
  set,
) => ({
  removeDuplicatesDialogOpen: false,
  removeDuplicatesDialogTarget: null,
  textToColumnsDialogOpen: false,
  textToColumnsDialogRange: null,

  openRemoveDuplicatesDialog: (target) => {
    set({ removeDuplicatesDialogOpen: true, removeDuplicatesDialogTarget: target });
  },

  closeRemoveDuplicatesDialog: () => {
    set({ removeDuplicatesDialogOpen: false, removeDuplicatesDialogTarget: null });
  },

  openTextToColumnsDialog: (payload) => {
    set({ textToColumnsDialogOpen: true, textToColumnsDialogRange: payload.range });
  },

  closeTextToColumnsDialog: () => {
    set({ textToColumnsDialogOpen: false, textToColumnsDialogRange: null });
  },
});
