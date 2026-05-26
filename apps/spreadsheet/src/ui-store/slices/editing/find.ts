/**
 * Find Slice
 *
 * Manages find/replace functionality that works across all views.
 * The find dialog allows searching for text/values in the current view
 * and optionally replacing them.
 */

import type { StateCreator } from 'zustand';

/**
 * Find state
 */
export interface FindState {
  /** Whether the find dialog is open */
  open: boolean;
  /** Current search query */
  query: string;
  /** Whether replace mode is active */
  replaceMode: boolean;
}

export interface FindSlice extends FindState {
  /** Open the find dialog */
  openFind: (replaceMode?: boolean) => void;
  /** Close the find dialog */
  closeFind: () => void;
  /** Toggle the find dialog */
  toggleFind: () => void;

  /** Set the search query */
  setFindQuery: (query: string) => void;

  /** Enable replace mode */
  enableReplaceMode: () => void;
  /** Disable replace mode */
  disableReplaceMode: () => void;
  /** Toggle replace mode */
  toggleReplaceMode: () => void;

  /** Reset find state to initial values */
  resetFind: () => void;
}

const initialState: FindState = {
  open: false,
  query: '',
  replaceMode: false,
};

export const createFindSlice: StateCreator<FindSlice, [], [], FindSlice> = (set) => ({
  ...initialState,

  openFind: (replaceMode = false) => {
    set({ open: true, replaceMode });
  },

  closeFind: () => {
    set({ open: false });
  },

  toggleFind: () => {
    set((s) => ({ open: !s.open }));
  },

  setFindQuery: (query: string) => {
    set({ query });
  },

  enableReplaceMode: () => {
    set({ replaceMode: true });
  },

  disableReplaceMode: () => {
    set({ replaceMode: false });
  },

  toggleReplaceMode: () => {
    set((s) => ({ replaceMode: !s.replaceMode }));
  },

  resetFind: () => {
    set(initialState);
  },
});
