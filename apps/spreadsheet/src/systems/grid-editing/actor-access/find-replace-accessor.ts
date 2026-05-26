/**
 * Find-Replace Actor Access Implementation
 *
 * Implements FindReplaceAccessor using selectors.
 * THIS IS THE ONLY PLACE that calls actor.getSnapshot() for find-replace handlers.
 *
 * @module engine/state/coordinator/actor-access/find-replace
 */

import { findReplaceSelectors } from '../../../selectors';
import type { FindReplaceAccessor, FindReplaceState } from '@mog-sdk/contracts/actors';

/**
 * Minimal actor interface for find-replace accessor.
 * Uses getSnapshot() to capture point-in-time state.
 */
export type FindReplaceActor = { getSnapshot(): FindReplaceState };

/**
 * Creates a FindReplaceAccessor for point-in-time reads in handlers.
 *
 * Each method delegates to the corresponding selector with a fresh snapshot.
 * This ensures handlers always get current state at the moment of call.
 *
 * @param actor - The XState find-replace actor
 * @returns FindReplaceAccessor interface for handlers
 */
export function createFindReplaceAccessor(actor: FindReplaceActor): FindReplaceAccessor {
  const snap = () => actor.getSnapshot();

  return {
    // Value accessors
    getQuery: () => findReplaceSelectors.query(snap()),
    getReplacement: () => findReplaceSelectors.replacement(snap()),
    getOptions: () => findReplaceSelectors.options(snap()),
    getResults: () => findReplaceSelectors.results(snap()),
    getCurrentIndex: () => findReplaceSelectors.currentIndex(snap()),
    getResultsStale: () => findReplaceSelectors.resultsStale(snap()),
    getShowReplace: () => findReplaceSelectors.showReplace(snap()),
    getErrorMessage: () => findReplaceSelectors.errorMessage(snap()),
    getActiveSheetId: () => findReplaceSelectors.activeSheetId(snap()),

    // Derived value accessors
    getResultCount: () => findReplaceSelectors.resultCount(snap()),
    getCurrentResultNumber: () => findReplaceSelectors.currentResultNumber(snap()),
    hasResults: () => findReplaceSelectors.hasResults(snap()),
    getCurrentResult: () => findReplaceSelectors.currentResult(snap()),

    // State matching accessors
    isClosed: () => findReplaceSelectors.isClosed(snap()),
    isIdle: () => findReplaceSelectors.isIdle(snap()),
    isSearching: () => findReplaceSelectors.isSearching(snap()),
    hasResultsState: () => findReplaceSelectors.hasResultsState(snap()),
    isReplacing: () => findReplaceSelectors.isReplacing(snap()),

    // Compound accessors
    isOpen: () => findReplaceSelectors.isOpen(snap()),
    canNavigate: () => findReplaceSelectors.canNavigate(snap()),
    canReplace: () => findReplaceSelectors.canReplace(snap()),
  };
}
