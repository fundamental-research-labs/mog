/**
 * Quick Analysis Slice
 *
 * UI state for the Quick Analysis panel
 * (`apps/spreadsheet/src/components/quick-analysis/QuickAnalysisPanel.tsx`).
 *
 * The action `OPEN_QUICK_ANALYSIS` previously fired through the legacy
 * `onUIAction` escape hatch, which is `undefined` on web and silently
 * swallowed the trigger. will rewrite the handler to call
 * `getUIStore(deps).getState().openQuickAnalysis()`; that requires the
 * slice to exist first (this file).
 *
 * The panel is positional — Excel renders it at the cursor / selection
 * corner — so the slice carries an optional `anchor` rect. A panel host
 * subscribed to `quickAnalysis.isOpen` must render the panel at the
 * stored anchor when set.
 */

import type { StateCreator } from 'zustand';

export interface QuickAnalysisAnchor {
  x: number;
  y: number;
}

export interface QuickAnalysisState {
  isOpen: boolean;
  anchor: QuickAnalysisAnchor | null;
}

export interface QuickAnalysisSlice {
  quickAnalysis: QuickAnalysisState;
  openQuickAnalysis: (anchor?: QuickAnalysisAnchor) => void;
  closeQuickAnalysis: () => void;
}

const initialState: QuickAnalysisState = {
  isOpen: false,
  anchor: null,
};

export const createQuickAnalysisSlice: StateCreator<
  QuickAnalysisSlice,
  [],
  [],
  QuickAnalysisSlice
> = (set) => ({
  quickAnalysis: initialState,

  openQuickAnalysis: (anchor) => {
    set({
      quickAnalysis: {
        isOpen: true,
        anchor: anchor ?? null,
      },
    });
  },

  closeQuickAnalysis: () => {
    set({ quickAnalysis: initialState });
  },
});
