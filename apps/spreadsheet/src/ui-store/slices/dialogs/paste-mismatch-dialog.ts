/**
 * Paste Size Mismatch Dialog Slice
 *
 * Manages the paste size mismatch warning dialog state.
 * Shown when pasting data that doesn't match the target selection size.
 *
 * Paste Size Mismatch Warning Dialog
 */

import type { StateCreator } from 'zustand';

import type { CellRange } from '@mog-sdk/contracts/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Size dimensions for paste data or target selection
 */
export interface PasteSize {
  rows: number;
  cols: number;
}

/**
 * Pending paste data stored while dialog is open
 */
export interface PendingPasteData {
  /** The target cell where paste will start */
  targetCell: { row: number; col: number };
  /** The sheet ID where paste will occur */
  sheetId: string;
  /** The selection range at the time of paste attempt */
  targetRange: CellRange;
}

/**
 * Paste size mismatch dialog state
 */
export interface PasteMismatchDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Size of the clipboard data being pasted */
  sourceSize: PasteSize | null;
  /** Size of the target selection */
  targetSize: PasteSize | null;
  /** Pending paste data to execute if user confirms */
  pendingPasteData: PendingPasteData | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

/**
 * Paste Size Mismatch Dialog Slice interface
 */
export interface PasteMismatchDialogSlice {
  pasteMismatchDialog: PasteMismatchDialogState;
  /** Open the paste size mismatch warning dialog */
  openPasteMismatchDialog: (
    sourceSize: PasteSize,
    targetSize: PasteSize,
    pendingData: PendingPasteData,
  ) => void;
  /** Close the paste size mismatch warning dialog */
  closePasteMismatchDialog: () => void;
}

// =============================================================================
// Default State
// =============================================================================

const DEFAULT_PASTE_MISMATCH_DIALOG: PasteMismatchDialogState = {
  isOpen: false,
  sourceSize: null,
  targetSize: null,
  pendingPasteData: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the paste mismatch dialog slice
 */
export const createPasteMismatchDialogSlice: StateCreator<
  PasteMismatchDialogSlice,
  [],
  [],
  PasteMismatchDialogSlice
> = (set) => ({
  pasteMismatchDialog: DEFAULT_PASTE_MISMATCH_DIALOG,

  openPasteMismatchDialog: (
    sourceSize: PasteSize,
    targetSize: PasteSize,
    pendingData: PendingPasteData,
  ) => {
    set({
      pasteMismatchDialog: {
        isOpen: true,
        sourceSize,
        targetSize,
        pendingPasteData: pendingData,
      },
    });
  },

  closePasteMismatchDialog: () => {
    set({ pasteMismatchDialog: DEFAULT_PASTE_MISMATCH_DIALOG });
  },
});
