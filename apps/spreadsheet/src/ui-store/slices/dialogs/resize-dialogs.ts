/**
 * Resize Dialogs Slice
 *
 * Manages state for row height and column width dialogs.
 */

import type { StateCreator } from 'zustand';

export interface ResizeDialogsSlice {
  /** Whether the row height dialog is open */
  rowHeightDialogOpen: boolean;
  /** Whether the column width dialog is open */
  columnWidthDialogOpen: boolean;
  openRowHeightDialog: () => void;
  closeRowHeightDialog: () => void;
  openColumnWidthDialog: () => void;
  closeColumnWidthDialog: () => void;
}

export const createResizeDialogsSlice: StateCreator<
  ResizeDialogsSlice,
  [],
  [],
  ResizeDialogsSlice
> = (set) => ({
  rowHeightDialogOpen: false,
  columnWidthDialogOpen: false,

  openRowHeightDialog: () => {
    set({ rowHeightDialogOpen: true });
  },

  closeRowHeightDialog: () => {
    set({ rowHeightDialogOpen: false });
  },

  openColumnWidthDialog: () => {
    set({ columnWidthDialogOpen: true });
  },

  closeColumnWidthDialog: () => {
    set({ columnWidthDialogOpen: false });
  },
});
