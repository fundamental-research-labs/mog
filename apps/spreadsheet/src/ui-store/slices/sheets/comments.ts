/**
 * Comments UI Slice
 *
 * Manages comment visibility UI state.
 * The actual comments data is stored in Yjs (see state/store/domains/comments.ts).
 * This slice only handles UI concerns like "Show All Comments" toggle.
 *
 * Review Tab - Comments Group
 */

import type { StateCreator } from 'zustand';

export interface CommentsUISlice {
  /** Whether all comments are visible (Show All Comments toggle) */
  showAllComments: boolean;

  /** Toggle show all comments visibility */
  toggleShowAllComments: () => void;

  /** Set show all comments visibility explicitly */
  setShowAllComments: (show: boolean) => void;
}

export const createCommentsUISlice: StateCreator<CommentsUISlice, [], [], CommentsUISlice> = (
  set,
) => ({
  showAllComments: false,

  toggleShowAllComments: () => {
    set((s) => ({ showAllComments: !s.showAllComments }));
  },

  setShowAllComments: (show: boolean) => {
    set({ showAllComments: show });
  },
});
