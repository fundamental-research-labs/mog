/**
 * Find-Replace Command Factory
 *
 * Type-safe wrappers around actor.send() for find-replace state machine events.
 *
 * Extracted from coordinator/actor-access/commands.ts
 *
 * @module systems/grid-editing/actor-access/find-replace-commands
 */

import type { FindReplaceCommands } from '@mog-sdk/contracts/actors';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { SearchOptions, SearchResult } from '@mog-sdk/contracts/search';

// =============================================================================
// TYPES
// =============================================================================

/** Minimal actor interface for sending events */
interface MinimalActor {
  send(event: any): void;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create find-replace commands from a find-replace actor.
 * Wraps actor.send() with type-safe methods for find-replace events.
 *
 * @param actor - The find-replace state machine actor
 * @returns FindReplaceCommands interface implementation
 *
 * @see state-machines/src/find-replace-machine.ts for event definitions
 */
export function createFindReplaceCommands(actor: MinimalActor): FindReplaceCommands {
  return {
    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------
    open: (showReplace?: boolean, sheetId?: SheetId) =>
      actor.send({ type: 'OPEN', showReplace, sheetId }),

    close: () => actor.send({ type: 'CLOSE' }),

    // -------------------------------------------------------------------------
    // Query/Options
    // -------------------------------------------------------------------------
    setQuery: (query: string) => actor.send({ type: 'SET_QUERY', query }),

    setReplacement: (replacement: string) => actor.send({ type: 'SET_REPLACEMENT', replacement }),

    setOptions: (options: Partial<SearchOptions>) => actor.send({ type: 'SET_OPTIONS', options }),

    setActiveSheet: (sheetId: SheetId) => actor.send({ type: 'SET_ACTIVE_SHEET', sheetId }),

    // -------------------------------------------------------------------------
    // Search
    // -------------------------------------------------------------------------
    search: () => actor.send({ type: 'SEARCH' }),

    searchComplete: (results: SearchResult[]) => actor.send({ type: 'SEARCH_COMPLETE', results }),

    searchError: (message: string) => actor.send({ type: 'SEARCH_ERROR', message }),

    // -------------------------------------------------------------------------
    // Navigation
    // -------------------------------------------------------------------------
    findNext: () => actor.send({ type: 'FIND_NEXT' }),

    findPrevious: () => actor.send({ type: 'FIND_PREVIOUS' }),

    // -------------------------------------------------------------------------
    // Replace
    // -------------------------------------------------------------------------
    replace: () => actor.send({ type: 'REPLACE' }),

    replaceComplete: (success: boolean, newCurrentIndex?: number) =>
      actor.send({ type: 'REPLACE_COMPLETE', success, newCurrentIndex }),

    replaceAll: () => actor.send({ type: 'REPLACE_ALL' }),

    replaceAllComplete: (replacedCount: number, skippedCount: number) =>
      actor.send({ type: 'REPLACE_ALL_COMPLETE', replacedCount, skippedCount }),

    // -------------------------------------------------------------------------
    // Invalidation
    // -------------------------------------------------------------------------
    markStale: () => actor.send({ type: 'MARK_STALE' }),

    cellDeleted: (cellId: string) => actor.send({ type: 'CELL_DELETED', cellId }),

    clearResults: () => actor.send({ type: 'CLEAR_RESULTS' }),
  };
}
