/**
 * Find-Replace Actor Selectors
 *
 * Pure functions that extract data from find-replace state.
 * Moved from contracts to kernel (contracts holds types only).
 *
 * @module @mog-sdk/kernel/selectors
 */

import type { FindReplaceState } from '@mog-sdk/contracts/actors/find-replace';

export { type FindReplaceState } from '@mog-sdk/contracts/actors/find-replace';

export const findReplaceSelectors = {
  // ---------------------------------------------------------------------------
  // Value selectors
  // ---------------------------------------------------------------------------
  query: (state: FindReplaceState): string => state.context.query,
  replacement: (state: FindReplaceState): string => state.context.replacement,
  options: (state: FindReplaceState): FindReplaceState['context']['options'] =>
    state.context.options,
  results: (state: FindReplaceState): FindReplaceState['context']['results'] =>
    state.context.results,
  currentIndex: (state: FindReplaceState): number => state.context.currentIndex,
  resultsStale: (state: FindReplaceState): boolean => state.context.resultsStale,
  showReplace: (state: FindReplaceState): boolean => state.context.showReplace,
  errorMessage: (state: FindReplaceState): FindReplaceState['context']['errorMessage'] =>
    state.context.errorMessage,
  activeSheetId: (state: FindReplaceState): FindReplaceState['context']['activeSheetId'] =>
    state.context.activeSheetId,

  // ---------------------------------------------------------------------------
  // Derived value selectors
  // ---------------------------------------------------------------------------
  resultCount: (state: FindReplaceState): number => state.context.results.length,
  currentResultNumber: (state: FindReplaceState): number =>
    state.context.currentIndex >= 0 ? state.context.currentIndex + 1 : 0,
  hasResults: (state: FindReplaceState): boolean => state.context.results.length > 0,
  currentResult: (
    state: FindReplaceState,
  ): FindReplaceState['context']['results'][number] | null => {
    const index = state.context.currentIndex;
    return index >= 0 && index < state.context.results.length ? state.context.results[index] : null;
  },

  // ---------------------------------------------------------------------------
  // State matching selectors
  // ---------------------------------------------------------------------------
  isClosed: (state: FindReplaceState): boolean => state.matches('closed'),
  isIdle: (state: FindReplaceState): boolean => state.matches('idle'),
  isSearching: (state: FindReplaceState): boolean => state.matches('searching'),
  hasResultsState: (state: FindReplaceState): boolean => state.matches('hasResults'),
  isReplacing: (state: FindReplaceState): boolean => state.matches('replacing'),

  // ---------------------------------------------------------------------------
  // Compound selectors
  // ---------------------------------------------------------------------------
  isOpen: (state: FindReplaceState): boolean => !state.matches('closed'),
  canNavigate: (state: FindReplaceState): boolean =>
    state.matches('hasResults') && state.context.results.length > 0,
  canReplace: (state: FindReplaceState): boolean =>
    state.matches('hasResults') &&
    state.context.results.length > 0 &&
    state.context.currentIndex >= 0,
};
