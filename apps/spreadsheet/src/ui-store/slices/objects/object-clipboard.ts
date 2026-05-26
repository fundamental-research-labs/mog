/**
 * Object Clipboard Slice
 *
 * Manages ephemeral clipboard state for floating object copy/cut/paste operations.
 *
 * Architecture:
 * - UIStore holds ephemeral clipboard state (not synced to Yjs)
 * - Copied object data is stored for paste
 * - Cut operation stores isCut flag for deletion after paste
 *
 */

import type { StateCreator } from 'zustand';

import type { FloatingObjectInfo } from '@mog-sdk/contracts/api';

/**
 * Object clipboard data for copy/cut/paste operations.
 */
export interface ObjectClipboardData {
  /** The floating object being copied/cut (summary info — paste uses .id) */
  object: FloatingObjectInfo;
  /** Whether this is a cut operation (original deleted after paste) */
  isCut: boolean;
  /** Source sheet ID for cross-sheet paste */
  sourceSheetId: string;
}

export interface ObjectClipboardSlice {
  /** Object clipboard state (null if clipboard empty) */
  objectClipboard: ObjectClipboardData | null;

  /**
   * Set the object clipboard data.
   * Used by both copy and cut operations.
   */
  setObjectClipboard: (data: ObjectClipboardData) => void;

  /**
   * Clear the object clipboard.
   * Called after paste (for cut) or when clipboard is cleared.
   */
  clearObjectClipboard: () => void;
}

export const createObjectClipboardSlice: StateCreator<
  ObjectClipboardSlice,
  [],
  [],
  ObjectClipboardSlice
> = (set) => ({
  objectClipboard: null,

  setObjectClipboard: (data: ObjectClipboardData) => {
    set({ objectClipboard: data });
  },

  clearObjectClipboard: () => {
    set({ objectClipboard: null });
  },
});
