/**
 * Undo Slice
 *
 * Manages state for undo/redo UI (stack sizes, dropdown).
 * NOTE: The actual undo operations are handled by Y.UndoManager.
 * This slice is for reactive UI state only.
 */

import type { StateCreator } from 'zustand';

/**
 * Undo history entry for displaying in dropdown.
 * NOTE: This is derived from SpreadsheetStore.getUndoHistory() which reads
 * directly from the Y.UndoManager stack (single source of truth).
 */
export interface UndoHistoryEntry {
  /** Timestamp when the operation was performed */
  timestamp: number;
  /** Human-readable description of the operation */
  description: string;
  /** Unique ID for this entry */
  id: string;
}

export interface UndoSlice {
  /** Number of items in the undo stack */
  undoStackSize: number;
  /** Number of items in the redo stack */
  redoStackSize: number;
  /** Whether the undo dropdown is open */
  undoDropdownOpen: boolean;
  /** Whether the next undo gesture should be consumed as a no-op. */
  shouldSuppressNextUndo: boolean;
  setUndoStackSize: (size: number) => void;
  setRedoStackSize: (size: number) => void;
  suppressNextUndo: () => void;
  consumeSuppressNextUndo: () => boolean;
  openUndoDropdown: () => void;
  closeUndoDropdown: () => void;
}

export const createUndoSlice: StateCreator<UndoSlice, [], [], UndoSlice> = (set) => ({
  // Stack sizes start at 0 and update reactively via subscriptions
  undoStackSize: 0,
  redoStackSize: 0,
  undoDropdownOpen: false,
  shouldSuppressNextUndo: false,

  setUndoStackSize: (size: number) => {
    set({ undoStackSize: size });
  },

  setRedoStackSize: (size: number) => {
    set({ redoStackSize: size });
  },

  suppressNextUndo: () => {
    set({ shouldSuppressNextUndo: true });
  },

  consumeSuppressNextUndo: () => {
    let shouldSuppress = false;
    set((state) => {
      shouldSuppress = state.shouldSuppressNextUndo;
      return shouldSuppress ? { shouldSuppressNextUndo: false } : state;
    });
    return shouldSuppress;
  },

  // NOTE: Undo history is read directly from SpreadsheetStore.getUndoHistory()
  openUndoDropdown: () => {
    set({ undoDropdownOpen: true });
  },

  closeUndoDropdown: () => {
    set({ undoDropdownOpen: false });
  },
});
