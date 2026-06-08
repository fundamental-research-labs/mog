/**
 * Paste Overwrite Confirm Dialog Slice
 *
 * Manages the cut-paste overwrite confirmation dialog state.
 *
 * Excel/Sheets parity: when a cut-paste's destination contains existing
 * non-empty cells, surface a "Do you want to replace the contents of the
 * destination cells?" confirmation BEFORE any writes happen.
 *
 * - Confirm (Enter / OK) → proceed with paste, source is cleared, destination
 * is overwritten.
 * - Cancel (Escape / Cancel) → abort. Source preserved, destination preserved,
 * marching-ants cleared (the cut is cancelled).
 *
 * Plain copy-paste does NOT trigger this dialog (Excel parity — copy-paste
 * always overwrites silently). Cut paste-special keeps its selected paste
 * mode when the user confirms.
 *
 */

import type { StateCreator } from 'zustand';
import type { PasteSpecialOptions } from '../../../systems/shared/types';

/**
 * Pending cut-paste data stored while dialog is open.
 * Carries enough info to re-trigger the paste with skipOverwriteCheck=true
 * after the user confirms.
 */
export interface PendingCutPasteData {
  /** Target cell at which the paste was requested */
  targetCell: { row: number; col: number };
  /** Sheet ID where paste will occur */
  sheetId: string;
  /** Original paste-special options, or null for plain paste */
  pasteOptions: PasteSpecialOptions | null;
}

/**
 * Paste overwrite confirm dialog state.
 */
export interface PasteOverwriteConfirmDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Pending data needed to complete the paste on confirm */
  pendingData: PendingCutPasteData | null;
}

/**
 * Paste Overwrite Confirm Dialog Slice interface.
 */
export interface PasteOverwriteConfirmDialogSlice {
  pasteOverwriteConfirmDialog: PasteOverwriteConfirmDialogState;
  /** Open the dialog with the pending paste data (called from paste integration) */
  openPasteOverwriteConfirmDialog: (pendingData: PendingCutPasteData) => void;
  /** Close the dialog (does not by itself confirm or cancel — handlers do that) */
  closePasteOverwriteConfirmDialog: () => void;
}

const DEFAULT_STATE: PasteOverwriteConfirmDialogState = {
  isOpen: false,
  pendingData: null,
};

export const createPasteOverwriteConfirmDialogSlice: StateCreator<
  PasteOverwriteConfirmDialogSlice,
  [],
  [],
  PasteOverwriteConfirmDialogSlice
> = (set) => ({
  pasteOverwriteConfirmDialog: DEFAULT_STATE,

  openPasteOverwriteConfirmDialog: (pendingData) => {
    set({
      pasteOverwriteConfirmDialog: {
        isOpen: true,
        pendingData,
      },
    });
  },

  closePasteOverwriteConfirmDialog: () => {
    set({ pasteOverwriteConfirmDialog: DEFAULT_STATE });
  },
});
