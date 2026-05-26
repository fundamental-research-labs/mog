/**
 * Find & Replace Hook
 *
 * React hook that wraps the find-replace state machine actor.
 * Provides type-safe access to find/replace state and actions.
 *
 * This is the SINGLE find-replace hook - all find/replace operations go through here.
 * The hook handles:
 * - XState machine state and events
 * - Search options (case sensitivity, match entire cell, regex)
 * - Result navigation (next, previous)
 * - Replace operations (single, all)
 *
 * Architecture: Actor Access Layer (
 * - All reactive reads use imported selectors with useSelector
 * - All writes use commands from createFindReplaceCommands
 * - NO inline selector functions
 * - NO direct .send() calls
 *
 * @see docs/renderer/README.md - Find-Replace Machine
 */

import { useSelector } from '@xstate/react';
import { useMemo } from 'react';

import { findReplaceSelectors } from '../../selectors';
import type { FindReplaceState } from '@mog-sdk/contracts/actors';
import type { SearchOptions, SearchResult } from '@mog-sdk/contracts/search';

import { createFindReplaceCommands } from '../../coordinator/actor-access';
import { useCoordinator } from '../shared/use-coordinator';

// Type-safe selector wrapper to handle XState snapshot type compatibility

type AnySelector<T> = (state: any) => T;
const asSelector = <T>(selector: (state: FindReplaceState) => T): AnySelector<T> => selector;

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseFindReplaceReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Whether the find panel/dialog is open */
  isOpen: boolean;

  /** Whether showing find-only mode (vs find-replace mode) */
  showReplace: boolean;

  /** Whether currently searching */
  isSearching: boolean;

  /** Whether currently replacing */
  isReplacing: boolean;

  /** Current search query */
  query: string;

  /** Current replacement text */
  replacement: string;

  /** Total number of matches */
  resultCount: number;

  /** Current result number (1-based for display, 0 if no results) */
  currentResultNumber: number;

  /** Whether there are any results */
  hasResults: boolean;

  /** Whether results are stale (need re-search) */
  resultsStale: boolean;

  /** Error message if search failed */
  errorMessage: string | null;

  /** Current search options */
  options: SearchOptions;

  // ═══════════════════════════════════════════════════════════════════════════
  // DIALOG ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Open the find dialog (Ctrl+F) */
  openFind: () => void;

  /** Open the find & replace dialog (Ctrl+H) */
  openFindReplace: () => void;

  /** Close the dialog */
  close: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Update the search query */
  setQuery: (query: string) => void;

  /** Update the replacement text */
  setReplacement: (text: string) => void;

  /** Update search options */
  setOptions: (options: Partial<SearchOptions>) => void;

  /** Execute search */
  search: () => void;

  /** Navigate to the next match (F3 / Enter) */
  findNext: () => void;

  /** Navigate to the previous match (Shift+F3 / Shift+Enter) */
  findPrevious: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // REPLACE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Replace the current match and move to next */
  replace: () => void;

  /** Replace all matches */
  replaceAll: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULT ACTIONS (called by coordinator after search execution)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set search results (called by coordinator) */
  setResults: (results: SearchResult[]) => void;

  /** Report search error */
  setError: (message: string) => void;

  /** Report replace completion */
  replaceComplete: (success: boolean, newCurrentIndex?: number) => void;

  /** Report replace-all completion */
  replaceAllComplete: (replacedCount: number, skippedCount: number) => void;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for Find & Replace operations.
 *
 * Provides access to the find-replace state machine for searching and
 * replacing cell content.
 *
 * @example
 * ```tsx
 * function FindDialog() {
 * const {
 * isOpen,
 * query,
 * resultCount,
 * currentResultNumber,
 * setQuery,
 * findNext,
 * findPrevious,
 * close
 * } = useFindReplace;
 *
 * if (!isOpen) return null;
 *
 * return (
 * <Dialog onClose={close}>
 * <input
 * value={query}
 * onChange={(e) => setQuery(e.target.value)}
 * placeholder="Find..."
 * />
 * <span>{resultCount > 0 ? `${currentResultNumber} of ${resultCount}` : 'No results'}</span>
 * <button onClick={findPrevious}>Previous</button>
 * <button onClick={findNext}>Next</button>
 * </Dialog>
 * );
 * }
 * ```
 */
export function useFindReplace(): UseFindReplaceReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.findReplace;

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE - Using imported selectors (Actor Access Layer pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  const isOpen = useSelector(actor, asSelector(findReplaceSelectors.isOpen));
  const showReplace = useSelector(actor, asSelector(findReplaceSelectors.showReplace));
  const isSearching = useSelector(actor, asSelector(findReplaceSelectors.isSearching));
  const isReplacing = useSelector(actor, asSelector(findReplaceSelectors.isReplacing));
  const query = useSelector(actor, asSelector(findReplaceSelectors.query));
  const replacement = useSelector(actor, asSelector(findReplaceSelectors.replacement));
  const resultCount = useSelector(actor, asSelector(findReplaceSelectors.resultCount));
  const currentResultNumber = useSelector(
    actor,
    asSelector(findReplaceSelectors.currentResultNumber),
  );
  const hasResults = useSelector(actor, asSelector(findReplaceSelectors.hasResults));
  const resultsStale = useSelector(actor, asSelector(findReplaceSelectors.resultsStale));
  const errorMessage = useSelector(actor, asSelector(findReplaceSelectors.errorMessage));
  const options = useSelector(actor, asSelector(findReplaceSelectors.options));

  // ═══════════════════════════════════════════════════════════════════════════
  // COMMANDS - Using createFindReplaceCommands (Actor Access Layer pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  const commands = useMemo(() => createFindReplaceCommands(actor), [actor]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // State
      isOpen,
      showReplace,
      isSearching,
      isReplacing,
      query,
      replacement,
      resultCount,
      currentResultNumber,
      hasResults,
      resultsStale,
      errorMessage,
      options,

      // Dialog actions - using commands with wrapper for correct signature
      openFind: () => commands.open(false),
      openFindReplace: () => commands.open(true),
      close: commands.close,

      // Search actions - using commands
      setQuery: commands.setQuery,
      setReplacement: commands.setReplacement,
      setOptions: commands.setOptions,
      search: commands.search,
      findNext: commands.findNext,
      findPrevious: commands.findPrevious,

      // Replace actions - using commands
      replace: commands.replace,
      replaceAll: commands.replaceAll,

      // Result actions - using commands
      setResults: commands.searchComplete,
      setError: commands.searchError,
      replaceComplete: commands.replaceComplete,
      replaceAllComplete: commands.replaceAllComplete,
    }),
    [
      isOpen,
      showReplace,
      isSearching,
      isReplacing,
      query,
      replacement,
      resultCount,
      currentResultNumber,
      hasResults,
      resultsStale,
      errorMessage,
      options,
      commands,
    ],
  );
}
