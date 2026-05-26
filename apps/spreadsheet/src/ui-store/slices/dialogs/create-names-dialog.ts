/**
 * Create Names Dialog Slice
 *
 * Manages UI state for the Create Names from Selection dialog.
 * This dialog allows users to create named ranges from row/column labels
 * in a selected range (Excel's Ctrl+Shift+F3 functionality).
 *
 * This is a Zustand slice (simple UI toggle), NOT an XState machine,
 * because the dialog has simple open/closed state without complex
 * state transitions or cross-machine coordination.
 *
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Slice
// =============================================================================

export interface CreateNamesDialogSlice {
  /** Whether the Create Names from Selection dialog is open */
  createNamesDialogOpen: boolean;
  /** Open the Create Names from Selection dialog */
  openCreateNamesDialog: () => void;
  /** Close the Create Names from Selection dialog */
  closeCreateNamesDialog: () => void;
}

export const createCreateNamesDialogSlice: StateCreator<
  CreateNamesDialogSlice,
  [],
  [],
  CreateNamesDialogSlice
> = (set) => ({
  createNamesDialogOpen: false,

  openCreateNamesDialog: () => {
    set({ createNamesDialogOpen: true });
  },

  closeCreateNamesDialog: () => {
    set({ createNamesDialogOpen: false });
  },
});
