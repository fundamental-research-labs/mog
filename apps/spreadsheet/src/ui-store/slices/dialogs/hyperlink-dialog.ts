/**
 * Hyperlink Dialog Slice
 *
 * Manages state for the hyperlink dialog
 */

import type { StateCreator } from 'zustand';

/**
 * Hyperlink dialog state
 */
export interface HyperlinkDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Current mode: 'insert' or 'edit' */
  mode: 'insert' | 'edit';
  /** Target cell for the hyperlink */
  targetRow: number;
  targetCol: number;
  /** Existing hyperlink URL (for edit mode) */
  existingUrl: string | null;
}

export interface HyperlinkDialogSlice {
  hyperlinkDialog: HyperlinkDialogState;
  openHyperlinkDialog: (row: number, col: number, existingUrl?: string) => void;
  closeHyperlinkDialog: () => void;
}

const initialState: HyperlinkDialogState = {
  isOpen: false,
  mode: 'insert',
  targetRow: 0,
  targetCol: 0,
  existingUrl: null,
};

export const createHyperlinkDialogSlice: StateCreator<
  HyperlinkDialogSlice,
  [],
  [],
  HyperlinkDialogSlice
> = (set) => ({
  hyperlinkDialog: initialState,

  openHyperlinkDialog: (row: number, col: number, existingUrl?: string) => {
    set({
      hyperlinkDialog: {
        isOpen: true,
        mode: existingUrl ? 'edit' : 'insert',
        targetRow: row,
        targetCol: col,
        existingUrl: existingUrl ?? null,
      },
    });
  },

  closeHyperlinkDialog: () => {
    set({ hyperlinkDialog: initialState });
  },
});
