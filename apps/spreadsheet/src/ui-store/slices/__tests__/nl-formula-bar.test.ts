import { create } from 'zustand';

import { createNLFormulaBarSlice, type NLFormulaBarSlice } from '../nl-formula/nl-formula-bar';

function createTestStore() {
  return create<NLFormulaBarSlice>()(createNLFormulaBarSlice);
}

const TEST_EXPLAIN_REQUEST = {
  requestId: 1,
  source: 'active-cell' as const,
  cellAddress: 'B2',
  sheetName: 'Sheet1',
};

describe('NLFormulaBarSlice', () => {
  describe('visibility', () => {
    it('starts hidden', () => {
      const store = createTestStore();
      expect(store.getState().nlBarVisible).toBe(false);
    });

    it('toggleNLBar flips visibility', () => {
      const store = createTestStore();
      store.getState().toggleNLBar();
      expect(store.getState().nlBarVisible).toBe(true);
      store.getState().toggleNLBar();
      expect(store.getState().nlBarVisible).toBe(false);
    });

    it('setNLBarVisible sets visibility directly', () => {
      const store = createTestStore();
      store.getState().setNLBarVisible(true);
      expect(store.getState().nlBarVisible).toBe(true);
      store.getState().setNLBarVisible(false);
      expect(store.getState().nlBarVisible).toBe(false);
    });
  });

  describe('nlSubmitExplain', () => {
    it('stores request metadata without formula or workbook context', () => {
      const store = createTestStore();
      store.getState().nlSubmitExplain(TEST_EXPLAIN_REQUEST);

      expect(store.getState().nlExplainRequest).toEqual(TEST_EXPLAIN_REQUEST);
      expect(JSON.stringify(store.getState().nlExplainRequest)).not.toContain('SUM');
    });

    it('sets loading and clears stale terminal state', () => {
      const store = createTestStore();
      store.getState().nlExplainResponseError('timeout');

      store.getState().nlSubmitExplain(TEST_EXPLAIN_REQUEST);

      expect(store.getState().nlExplainResult).toBeNull();
      expect(store.getState().nlExplainError).toBeNull();
      expect(store.getState().nlExplainLoading).toBe(true);
    });

    it('is a no-op while already loading', () => {
      const store = createTestStore();
      store.getState().nlSubmitExplain(TEST_EXPLAIN_REQUEST);
      const firstRequest = store.getState().nlExplainRequest;

      store.getState().nlSubmitExplain({ ...TEST_EXPLAIN_REQUEST, requestId: 2 });

      expect(store.getState().nlExplainRequest).toBe(firstRequest);
    });
  });

  describe('response transitions', () => {
    it('stores successful explanation and clears loading', () => {
      const store = createTestStore();
      store.getState().nlSubmitExplain(TEST_EXPLAIN_REQUEST);

      store.getState().nlExplainResponseSuccess('Sums column B.');

      expect(store.getState().nlExplainResult).toBe('Sums column B.');
      expect(store.getState().nlExplainError).toBeNull();
      expect(store.getState().nlExplainLoading).toBe(false);
    });

    it('stores error and clears stale result/loading', () => {
      const store = createTestStore();
      store.getState().nlExplainResponseSuccess('Sums column B.');

      store.getState().nlExplainResponseError('Could not explain this formula.');

      expect(store.getState().nlExplainResult).toBeNull();
      expect(store.getState().nlExplainError).toBe('Could not explain this formula.');
      expect(store.getState().nlExplainLoading).toBe(false);
    });

    it('nlExplainResponseLoading clears terminal state', () => {
      const store = createTestStore();
      store.getState().nlExplainResponseSuccess('Sums column B.');

      store.getState().nlExplainResponseLoading();

      expect(store.getState().nlExplainResult).toBeNull();
      expect(store.getState().nlExplainError).toBeNull();
      expect(store.getState().nlExplainLoading).toBe(true);
    });
  });

  describe('dismiss', () => {
    it('nlExplainDismiss clears only explanation state', () => {
      const store = createTestStore();
      store.getState().setNLBarVisible(true);
      store.getState().nlSubmitExplain(TEST_EXPLAIN_REQUEST);
      store.getState().nlExplainResponseSuccess('Sums column B.');

      store.getState().nlExplainDismiss();

      expect(store.getState().nlBarVisible).toBe(true);
      expect(store.getState().nlExplainRequest).toBeNull();
      expect(store.getState().nlExplainResult).toBeNull();
      expect(store.getState().nlExplainError).toBeNull();
      expect(store.getState().nlExplainLoading).toBe(false);
    });

    it('nlDismiss clears explanation state and hides the bar', () => {
      const store = createTestStore();
      store.getState().setNLBarVisible(true);
      store.getState().nlSubmitExplain(TEST_EXPLAIN_REQUEST);

      store.getState().nlDismiss();

      expect(store.getState().nlBarVisible).toBe(false);
      expect(store.getState().nlExplainRequest).toBeNull();
      expect(store.getState().nlExplainResult).toBeNull();
      expect(store.getState().nlExplainError).toBeNull();
      expect(store.getState().nlExplainLoading).toBe(false);
    });
  });
});
