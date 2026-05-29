/**
 * NL Formula Bar Slice
 *
 * Manages state for the natural-language formula bar: visibility,
 * prompt text, request/response lifecycle, retry, accept, and dismiss.
 */

import type { StateCreator } from 'zustand';

export interface SpreadsheetContext {
  cellAddress: string;
  sheetName: string;
  headers: string[];
  dataTypes: Record<string, string>;
  namedRanges?: string[];
  selectionRange?: string;
  currentFormula?: string;
}

export interface NLFormulaResult {
  formula: string;
  explanation: string;
}

export interface NLFormulaBarSlice {
  nlBarVisible: boolean;
  toggleNLBar: () => void;
  setNLBarVisible: (visible: boolean) => void;

  nlPrompt: string;
  setNLPrompt: (prompt: string) => void;

  nlRequest: { prompt: string; context: SpreadsheetContext } | null;
  nlLastRequest: { prompt: string; context: SpreadsheetContext } | null;
  nlResult: NLFormulaResult | null;
  nlLoading: boolean;
  nlError: string | null;

  nlSubmitPrompt: (context: SpreadsheetContext) => void;
  nlAcceptFormula: () => void;
  nlRetry: () => void;
  nlDismiss: () => void;

  nlResponseLoading: () => void;
  nlResponseSuccess: (result: NLFormulaResult) => void;
  nlResponseError: (error: string) => void;

  // Explain feature
  nlExplainRequest: { formula: string; context: SpreadsheetContext } | null;
  nlExplainResult: string | null;
  nlExplainLoading: boolean;
  nlExplainError: string | null;
  nlSubmitExplain: (formula: string, context: SpreadsheetContext) => void;
  nlExplainDismiss: () => void;
  nlExplainResponseLoading: () => void;
  nlExplainResponseSuccess: (explanation: string) => void;
  nlExplainResponseError: (error: string) => void;
}

const INITIAL_NL_STATE = {
  nlPrompt: '',
  nlRequest: null,
  nlLastRequest: null,
  nlResult: null,
  nlLoading: false,
  nlError: null,
} as const;

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
  ...INITIAL_NL_STATE,
  ...INITIAL_EXPLAIN_STATE,

  toggleNLBar: () => {
    set((prev) => ({ nlBarVisible: !prev.nlBarVisible }));
  },

  setNLBarVisible: (visible) => {
    set({ nlBarVisible: visible });
  },

  setNLPrompt: (prompt) => {
    set({ nlPrompt: prompt });
  },

  nlSubmitPrompt: (context) => {
    if (get().nlLoading) return;
    set({
      nlRequest: { prompt: get().nlPrompt, context },
      nlLastRequest: { prompt: get().nlPrompt, context },
      nlResult: null,
      nlError: null,
      nlLoading: true,
      // Clear explain state when starting a generate
      ...INITIAL_EXPLAIN_STATE,
    });
  },

  nlResponseLoading: () => {
    set({ nlLoading: true });
  },

  nlResponseSuccess: (result) => {
    set({ nlResult: result, nlLoading: false });
  },

  nlResponseError: (error) => {
    set({ nlError: error, nlLoading: false });
  },

  nlRetry: () => {
    const lastRequest = get().nlLastRequest;
    if (!lastRequest) {
      set({ nlResult: null, nlError: null, nlRequest: null, nlLoading: false });
      return;
    }
    set({
      nlResult: null,
      nlError: null,
      nlRequest: { ...lastRequest },
      nlLoading: true,
    });
  },

  nlAcceptFormula: () => {
    set({ ...INITIAL_NL_STATE, nlLastRequest: null });
  },

  nlDismiss: () => {
    set({
      ...INITIAL_NL_STATE,
      nlLastRequest: null,
      ...INITIAL_EXPLAIN_STATE,
      nlBarVisible: false,
    });
  },

  // Explain feature
  nlSubmitExplain: (formula, context) => {
    if (get().nlExplainLoading) return;
    set({
      nlExplainRequest: { formula, context },
      nlExplainResult: null,
      nlExplainError: null,
      nlExplainLoading: true,
      // Clear generate state when starting an explain
      ...INITIAL_NL_STATE,
    });
  },

  nlExplainDismiss: () => {
    set({ ...INITIAL_EXPLAIN_STATE });
  },

  nlExplainResponseLoading: () => {
    set({ nlExplainLoading: true });
  },

  nlExplainResponseSuccess: (explanation) => {
    set({ nlExplainResult: explanation, nlExplainLoading: false });
  },

  nlExplainResponseError: (error) => {
    set({ nlExplainError: error, nlExplainLoading: false });
  },
});
