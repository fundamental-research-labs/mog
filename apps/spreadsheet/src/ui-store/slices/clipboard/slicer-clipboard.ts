/**
 * Slicer Clipboard Slice
 *
 * Manages ephemeral clipboard state for slicer copy/cut/paste operations.
 *
 * Architecture:
 * - UIStore holds ephemeral clipboard state (not synced to Yjs)
 * - Copied slicer data is stored for paste
 * - Cut operation stores isCut flag for deletion after paste
 *
 */

import type { StateCreator } from 'zustand';

import type { Slicer } from '@mog-sdk/contracts/api';

/**
 * Slicer clipboard data for copy/cut/paste operations.
 */
export interface SlicerClipboardData {
  /** The slicer being copied/cut (API-level type from Worksheet.slicers.get) */
  slicer: Slicer;
  /** Whether this is a cut operation (original deleted after paste) */
  isCut: boolean;
  /** Source sheet ID for cross-sheet paste */
  sourceSheetId: string;
}

export interface SlicerClipboardSlice {
  /** Slicer clipboard state (null if clipboard empty) */
  slicerClipboard: SlicerClipboardData | null;

  /**
   * Set the slicer clipboard data.
   * Used by both copy and cut operations.
   */
  setSlicerClipboard: (data: SlicerClipboardData) => void;

  /**
   * Clear the slicer clipboard.
   * Called after paste (for cut) or when clipboard is cleared.
   */
  clearSlicerClipboard: () => void;
}

export const createSlicerClipboardSlice: StateCreator<
  SlicerClipboardSlice,
  [],
  [],
  SlicerClipboardSlice
> = (set) => ({
  slicerClipboard: null,

  setSlicerClipboard: (data: SlicerClipboardData) => {
    set({ slicerClipboard: data });
  },

  clearSlicerClipboard: () => {
    set({ slicerClipboard: null });
  },
});
