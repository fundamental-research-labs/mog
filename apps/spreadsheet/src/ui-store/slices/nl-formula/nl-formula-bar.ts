/**
 * NL Formula Bar Slice
 *
 * Keeps only document-local visibility and explanation lifecycle state. Formula
 * text and workbook context stay in component scope so the global UI store does
 * not retain AI payloads.
 */

import type { StateCreator } from 'zustand';

export type NLFormulaExplainSource = 'typed' | 'active-cell';

export interface NLFormulaExplainRequest {
  requestId: number;
  source: NLFormulaExplainSource;
  cellAddress?: string;
  sheetName?: string;
  selectionRange?: string;
}

export interface NLFormulaBarSlice {
  nlBarVisible: boolean;
  toggleNLBar: () => void;
  setNLBarVisible: (visible: boolean) => void;

  nlExplainRequest: NLFormulaExplainRequest | null;
  nlExplainResult: string | null;
  nlExplainLoading: boolean;
  nlExplainError: string | null;
  nlSubmitExplain: (request: NLFormulaExplainRequest) => void;
  nlDismiss: () => void;
  nlExplainDismiss: () => void;
  nlExplainResponseLoading: () => void;
  nlExplainResponseSuccess: (explanation: string) => void;
  nlExplainResponseError: (error: string) => void;
}

const INITIAL_EXPLAIN_STATE = {
  nlExplainRequest: null,
  nlExplainResult: null,
  nlExplainLoading: false,
  nlExplainError: null,
} as const;

export const createNLFormulaBarSlice: StateCreator<NLFormulaBarSlice, [], [], NLFormulaBarSlice> = (
  set,
  get,
) => ({
  nlBarVisible: false,
  ...INITIAL_EXPLAIN_STATE,

  toggleNLBar: () => {
    set((prev) => ({ nlBarVisible: !prev.nlBarVisible }));
  },

  setNLBarVisible: (visible) => {
    set({ nlBarVisible: visible });
  },

  nlSubmitExplain: (request) => {
    if (get().nlExplainLoading) return;
    set({
      nlExplainRequest: request,
      nlExplainResult: null,
      nlExplainError: null,
      nlExplainLoading: true,
    });
  },

  nlDismiss: () => {
    set({
      ...INITIAL_EXPLAIN_STATE,
      nlBarVisible: false,
    });
  },

  nlExplainDismiss: () => {
    set({ ...INITIAL_EXPLAIN_STATE });
  },

  nlExplainResponseLoading: () => {
    set({ nlExplainResult: null, nlExplainError: null, nlExplainLoading: true });
  },

  nlExplainResponseSuccess: (explanation) => {
    set({ nlExplainResult: explanation, nlExplainError: null, nlExplainLoading: false });
  },

  nlExplainResponseError: (error) => {
    set({ nlExplainResult: null, nlExplainError: error, nlExplainLoading: false });
  },
});
