/**
 * NL Formula Bar Slice Tests
 *
 * Tests for the natural-language formula bar state machine:
 * visibility toggles, prompt management, request/response lifecycle,
 * retry, accept, and dismiss transitions.
 */

import { create } from 'zustand';

import {
  createNLFormulaBarSlice,
  type NLFormulaBarSlice,
  type SpreadsheetContext,
} from '../nl-formula/nl-formula-bar';

function createTestStore() {
  return create<NLFormulaBarSlice>()(createNLFormulaBarSlice);
}

const TEST_CONTEXT: SpreadsheetContext = {
  cellAddress: 'B2',
  sheetName: 'Sheet1',
  headers: ['Name', 'Revenue', 'Cost'],
  dataTypes: { Name: 'string', Revenue: 'number', Cost: 'number' },
};

describe('NLFormulaBarSlice', () => {
  describe('visibility', () => {
    it('should start with nlBarVisible false', () => {
      const store = createTestStore();
      expect(store.getState().nlBarVisible).toBe(false);
    });

    it('toggleNLBar flips nlBarVisible from false to true', () => {
      const store = createTestStore();
      store.getState().toggleNLBar();
      expect(store.getState().nlBarVisible).toBe(true);
    });

    it('toggleNLBar flips nlBarVisible from true to false', () => {
      const store = createTestStore();
      store.getState().toggleNLBar();
      store.getState().toggleNLBar();
      expect(store.getState().nlBarVisible).toBe(false);
    });

    it('setNLBarVisible(true) sets nlBarVisible to true', () => {
      const store = createTestStore();
      store.getState().setNLBarVisible(true);
      expect(store.getState().nlBarVisible).toBe(true);
    });

    it('setNLBarVisible(false) sets nlBarVisible to false', () => {
      const store = createTestStore();
      store.getState().setNLBarVisible(true);
      store.getState().setNLBarVisible(false);
      expect(store.getState().nlBarVisible).toBe(false);
    });
  });

  describe('prompt', () => {
    it('should start with empty nlPrompt', () => {
      const store = createTestStore();
      expect(store.getState().nlPrompt).toBe('');
    });

    it('setNLPrompt updates nlPrompt', () => {
      const store = createTestStore();
      store.getState().setNLPrompt('sum of revenue');
      expect(store.getState().nlPrompt).toBe('sum of revenue');
    });
  });

  describe('nlSubmitPrompt', () => {
    it('sets nlRequest with prompt and context', () => {
      const store = createTestStore();
      store.getState().setNLPrompt('sum of revenue');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);

      const { nlRequest } = store.getState();
      expect(nlRequest).toEqual({
        prompt: 'sum of revenue',
        context: TEST_CONTEXT,
      });
    });

    it('clears prior nlResult and nlError', () => {
      const store = createTestStore();

      // Seed a prior result
      store.getState().setNLPrompt('first');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);
      store.getState().nlResponseSuccess({ formula: '=SUM(B:B)', explanation: 'sums B' });

      // Submit again
      store.getState().setNLPrompt('second');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);

      expect(store.getState().nlResult).toBeNull();
      expect(store.getState().nlError).toBeNull();
    });

    it('sets nlLoading to true', () => {
      const store = createTestStore();
      store.getState().setNLPrompt('test');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);
      expect(store.getState().nlLoading).toBe(true);
    });

    it('is a no-op when already loading', () => {
      const store = createTestStore();
      store.getState().setNLPrompt('first prompt');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);

      const requestAfterFirst = store.getState().nlRequest;

      store.getState().setNLPrompt('second prompt');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);

      // nlRequest should not have changed
      expect(store.getState().nlRequest).toBe(requestAfterFirst);
    });
  });

  describe('nlResponseLoading', () => {
    it('sets nlLoading to true', () => {
      const store = createTestStore();
      expect(store.getState().nlLoading).toBe(false);
      store.getState().nlResponseLoading();
      expect(store.getState().nlLoading).toBe(true);
    });
  });

  describe('nlResponseSuccess', () => {
    it('sets nlResult and clears nlLoading', () => {
      const store = createTestStore();
      store.getState().setNLPrompt('test');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);
      expect(store.getState().nlLoading).toBe(true);

      const result = { formula: '=SUM(B:B)', explanation: 'Sums column B' };
      store.getState().nlResponseSuccess(result);

      expect(store.getState().nlResult).toEqual(result);
      expect(store.getState().nlLoading).toBe(false);
    });
  });

  describe('nlResponseError', () => {
    it('sets nlError and clears nlLoading', () => {
      const store = createTestStore();
      store.getState().setNLPrompt('test');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);
      expect(store.getState().nlLoading).toBe(true);

      store.getState().nlResponseError('API timeout');

      expect(store.getState().nlError).toBe('API timeout');
      expect(store.getState().nlLoading).toBe(false);
    });
  });

  describe('nlRetry', () => {
    it('clears nlResult and nlError, then resubmits the last request', () => {
      const store = createTestStore();
      store.getState().setNLPrompt('test');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);
      store.getState().nlResponseError('fail');

      store.getState().nlRetry();

      expect(store.getState().nlResult).toBeNull();
      expect(store.getState().nlError).toBeNull();
      expect(store.getState().nlRequest).toEqual({ prompt: 'test', context: TEST_CONTEXT });
      expect(store.getState().nlLoading).toBe(true);
    });

    it('keeps nlPrompt intact', () => {
      const store = createTestStore();
      store.getState().setNLPrompt('sum of revenue');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);
      store.getState().nlResponseError('fail');

      store.getState().nlRetry();

      expect(store.getState().nlPrompt).toBe('sum of revenue');
    });
  });

  describe('nlAcceptFormula', () => {
    it('resets prompt, request, result, error, and loading', () => {
      const store = createTestStore();
      store.getState().setNLPrompt('test');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);
      store.getState().nlResponseSuccess({ formula: '=SUM(B:B)', explanation: 'sums B' });

      store.getState().nlAcceptFormula();

      expect(store.getState().nlPrompt).toBe('');
      expect(store.getState().nlRequest).toBeNull();
      expect(store.getState().nlResult).toBeNull();
      expect(store.getState().nlError).toBeNull();
      expect(store.getState().nlLoading).toBe(false);
    });

    it('keeps bar visible', () => {
      const store = createTestStore();
      store.getState().setNLBarVisible(true);
      store.getState().setNLPrompt('test');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);
      store.getState().nlResponseSuccess({ formula: '=SUM(B:B)', explanation: 'sums B' });

      store.getState().nlAcceptFormula();

      expect(store.getState().nlBarVisible).toBe(true);
    });
  });

  describe('nlDismiss', () => {
    it('resets all NL state AND hides bar', () => {
      const store = createTestStore();
      store.getState().setNLBarVisible(true);
      store.getState().setNLPrompt('test');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);
      store.getState().nlResponseSuccess({ formula: '=SUM(B:B)', explanation: 'sums B' });

      store.getState().nlDismiss();

      expect(store.getState().nlBarVisible).toBe(false);
      expect(store.getState().nlPrompt).toBe('');
      expect(store.getState().nlRequest).toBeNull();
      expect(store.getState().nlResult).toBeNull();
      expect(store.getState().nlError).toBeNull();
      expect(store.getState().nlLoading).toBe(false);
    });

    it('also clears explain state', () => {
      const store = createTestStore();
      store.getState().setNLBarVisible(true);
      store.getState().nlSubmitExplain('=SUM(A:A)', TEST_CONTEXT);
      store.getState().nlExplainResponseSuccess('Sums column A');

      store.getState().nlDismiss();

      expect(store.getState().nlExplainRequest).toBeNull();
      expect(store.getState().nlExplainResult).toBeNull();
      expect(store.getState().nlExplainError).toBeNull();
      expect(store.getState().nlExplainLoading).toBe(false);
    });
  });

  describe('nlSubmitExplain', () => {
    it('sets nlExplainRequest with formula and context', () => {
      const store = createTestStore();
      store.getState().nlSubmitExplain('=SUM(B:B)', TEST_CONTEXT);

      expect(store.getState().nlExplainRequest).toEqual({
        formula: '=SUM(B:B)',
        context: TEST_CONTEXT,
      });
    });

    it('sets nlExplainLoading to true', () => {
      const store = createTestStore();
      store.getState().nlSubmitExplain('=SUM(B:B)', TEST_CONTEXT);
      expect(store.getState().nlExplainLoading).toBe(true);
    });

    it('clears generate state when starting explain', () => {
      const store = createTestStore();
      store.getState().setNLPrompt('sum');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);
      store.getState().nlResponseSuccess({ formula: '=SUM(B:B)', explanation: 'sums B' });

      store.getState().nlSubmitExplain('=SUM(B:B)', TEST_CONTEXT);

      expect(store.getState().nlRequest).toBeNull();
      expect(store.getState().nlResult).toBeNull();
      expect(store.getState().nlLoading).toBe(false);
      expect(store.getState().nlPrompt).toBe('');
    });

    it('is a no-op when already loading', () => {
      const store = createTestStore();
      store.getState().nlSubmitExplain('=SUM(A:A)', TEST_CONTEXT);
      const firstRequest = store.getState().nlExplainRequest;

      store.getState().nlSubmitExplain('=AVERAGE(B:B)', TEST_CONTEXT);
      expect(store.getState().nlExplainRequest).toBe(firstRequest);
    });
  });

  describe('nlSubmitPrompt clears explain state', () => {
    it('clears explain state when starting a generate', () => {
      const store = createTestStore();
      store.getState().nlSubmitExplain('=SUM(A:A)', TEST_CONTEXT);
      store.getState().nlExplainResponseSuccess('Sums column A');

      store.getState().setNLPrompt('average');
      store.getState().nlSubmitPrompt(TEST_CONTEXT);

      expect(store.getState().nlExplainRequest).toBeNull();
      expect(store.getState().nlExplainResult).toBeNull();
      expect(store.getState().nlExplainLoading).toBe(false);
    });
  });

  describe('nlExplainResponseSuccess', () => {
    it('sets nlExplainResult and clears nlExplainLoading', () => {
      const store = createTestStore();
      store.getState().nlSubmitExplain('=SUM(B:B)', TEST_CONTEXT);
      expect(store.getState().nlExplainLoading).toBe(true);

      store.getState().nlExplainResponseSuccess('Sums column B');

      expect(store.getState().nlExplainResult).toBe('Sums column B');
      expect(store.getState().nlExplainLoading).toBe(false);
    });
  });

  describe('nlExplainResponseError', () => {
    it('sets nlExplainError and clears nlExplainLoading', () => {
      const store = createTestStore();
      store.getState().nlSubmitExplain('=SUM(B:B)', TEST_CONTEXT);

      store.getState().nlExplainResponseError('API timeout');

      expect(store.getState().nlExplainError).toBe('API timeout');
      expect(store.getState().nlExplainLoading).toBe(false);
    });
  });

  describe('nlExplainDismiss', () => {
    it('resets explain state', () => {
      const store = createTestStore();
      store.getState().nlSubmitExplain('=SUM(B:B)', TEST_CONTEXT);
      store.getState().nlExplainResponseSuccess('Sums column B');

      store.getState().nlExplainDismiss();

      expect(store.getState().nlExplainRequest).toBeNull();
      expect(store.getState().nlExplainResult).toBeNull();
      expect(store.getState().nlExplainError).toBeNull();
      expect(store.getState().nlExplainLoading).toBe(false);
    });
  });
});
