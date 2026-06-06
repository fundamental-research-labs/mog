/**
 * Find-Replace State Machine
 *
 * Manages Find/Replace operations using XState for complex state transitions.
 *
 * States:
 * - closed: Dialog not open
 * - idle: Dialog open, no search performed yet
 * - searching: Search in progress (async for large sheets)
 * - hasResults: Results available, can navigate/replace
 * - replacing: Replace operation in progress
 *
 * Key architectural decisions:
 * - XState (not Zustand) because: complex state transitions, coordination with
 * selection machine, async operations, structure change handling
 * - Results store CellId (not position) per Cell Identity Architecture
 * - Machine owns state (pure), coordinator executes side effects
 *
 * @see docs/renderer/README.md (coordinator pattern)
 */

import type { ActorRefFrom, SnapshotFrom } from 'xstate';
import { assign, setup } from 'xstate';

import { findReplaceSelectors } from '../../../selectors';
import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { SearchOptions, SearchResult } from '@mog-sdk/contracts/search';
import { DEFAULT_SEARCH_OPTIONS } from '@mog-sdk/contracts/search';

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * Find-Replace machine context.
 *
 * ARCHITECTURE:
 * - Results store CellIds, not positions (per Cell Identity Architecture)
 * - Position is resolved at navigation/render time via GridIndex.getPosition()
 * - Structure changes don't invalidate results (CellIds are stable)
 * - Only value changes mark results as stale
 */
export interface FindReplaceContext {
  /** Current search query */
  query: string;

  /** Replacement text (for replace operations) */
  replacement: string;

  /** Search options */
  options: SearchOptions;

  /**
   * Search results - stores CellIds, not positions.
   * Position is resolved at navigation/render time.
   */
  results: SearchResult[];

  /** Current result index (0-based, -1 if no results) */
  currentIndex: number;

  /**
   * Whether results are stale (cell values changed).
   * Structure changes (insert/delete row/col) do NOT cause staleness
   * because we store CellId, not position.
   */
  resultsStale: boolean;

  /** Whether showing replace UI (false = find-only mode) */
  showReplace: boolean;

  /** Error message if search/replace failed */
  errorMessage: string | null;

  /** Sheet to search in (for sheet scope) */
  activeSheetId: SheetId | null;
}

/**
 * Initial context for the machine.
 */
const initialContext: FindReplaceContext = {
  query: '',
  replacement: '',
  options: DEFAULT_SEARCH_OPTIONS,
  results: [],
  currentIndex: -1,
  resultsStale: false,
  showReplace: false,
  errorMessage: null,
  activeSheetId: null,
};

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Find-Replace machine events.
 */
export type FindReplaceEvent =
  // Lifecycle
  | { type: 'OPEN'; showReplace?: boolean; sheetId?: SheetId }
  | { type: 'CLOSE' }
  // Query/options
  | { type: 'SET_QUERY'; query: string }
  | { type: 'SET_REPLACEMENT'; replacement: string }
  | { type: 'SET_OPTIONS'; options: Partial<SearchOptions> }
  | { type: 'SET_ACTIVE_SHEET'; sheetId: SheetId }
  // Search
  | { type: 'SEARCH' }
  | { type: 'SEARCH_COMPLETE'; results: SearchResult[]; initialCurrentIndex?: number }
  | { type: 'SEARCH_ERROR'; message: string }
  // Navigation
  | { type: 'FIND_NEXT' }
  | { type: 'FIND_PREVIOUS' }
  // Replace
  | { type: 'REPLACE' }
  | { type: 'REPLACE_COMPLETE'; success: boolean; newCurrentIndex?: number }
  | { type: 'REPLACE_ALL' }
  | { type: 'REPLACE_ALL_COMPLETE'; replacedCount: number; skippedCount: number }
  | { type: 'REPLACE_ERROR'; message: string }
  // Invalidation
  | { type: 'MARK_STALE' }
  | { type: 'CELL_DELETED'; cellId: CellId }
  | { type: 'CLEAR_RESULTS' };

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the Find-Replace machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const FindReplaceEvents = {
  /** Open dialog (optionally with replace panel visible) */
  open: (showReplace = false, sheetId?: SheetId): FindReplaceEvent => ({
    type: 'OPEN',
    showReplace,
    sheetId,
  }),

  /** Close dialog */
  close: (): FindReplaceEvent => ({ type: 'CLOSE' }),

  /** Set search query */
  setQuery: (query: string): FindReplaceEvent => ({ type: 'SET_QUERY', query }),

  /** Set replacement text */
  setReplacement: (replacement: string): FindReplaceEvent => ({
    type: 'SET_REPLACEMENT',
    replacement,
  }),

  /** Update search options */
  setOptions: (options: Partial<SearchOptions>): FindReplaceEvent => ({
    type: 'SET_OPTIONS',
    options,
  }),

  /** Update active sheet ID */
  setActiveSheet: (sheetId: SheetId): FindReplaceEvent => ({
    type: 'SET_ACTIVE_SHEET',
    sheetId,
  }),

  /** Execute search */
  search: (): FindReplaceEvent => ({ type: 'SEARCH' }),

  /** Search completed with results */
  searchComplete: (results: SearchResult[], initialCurrentIndex?: number): FindReplaceEvent => ({
    type: 'SEARCH_COMPLETE',
    results,
    initialCurrentIndex,
  }),

  /** Search failed */
  searchError: (message: string): FindReplaceEvent => ({
    type: 'SEARCH_ERROR',
    message,
  }),

  /** Navigate to next result */
  findNext: (): FindReplaceEvent => ({ type: 'FIND_NEXT' }),

  /** Navigate to previous result */
  findPrevious: (): FindReplaceEvent => ({ type: 'FIND_PREVIOUS' }),

  /** Replace current match */
  replace: (): FindReplaceEvent => ({ type: 'REPLACE' }),

  /** Replace completed */
  replaceComplete: (success: boolean, newCurrentIndex?: number): FindReplaceEvent => ({
    type: 'REPLACE_COMPLETE',
    success,
    newCurrentIndex,
  }),

  /** Replace all matches */
  replaceAll: (): FindReplaceEvent => ({ type: 'REPLACE_ALL' }),

  /** Replace all completed */
  replaceAllComplete: (replacedCount: number, skippedCount: number): FindReplaceEvent => ({
    type: 'REPLACE_ALL_COMPLETE',
    replacedCount,
    skippedCount,
  }),

  /** Replace operation failed (IPC/bridge error) */
  replaceError: (message: string): FindReplaceEvent => ({
    type: 'REPLACE_ERROR',
    message,
  }),

  /** Mark results as stale (cell value changed) */
  markStale: (): FindReplaceEvent => ({ type: 'MARK_STALE' }),

  /** Remove result for deleted cell (Cell Identity pattern) */
  cellDeleted: (cellId: CellId): FindReplaceEvent => ({
    type: 'CELL_DELETED',
    cellId,
  }),

  /** Clear all results */
  clearResults: (): FindReplaceEvent => ({ type: 'CLEAR_RESULTS' }),
} as const;

// =============================================================================
// MACHINE DEFINITION
// =============================================================================

/**
 * Find-Replace XState machine.
 *
 * ARCHITECTURE:
 * - Machine owns state (pure) - no side effects in actions
 * - Coordinator subscribes to machine state and executes side effects:
 * - Search execution (when entering 'searching' state)
 * - Navigation (when FIND_NEXT/FIND_PREVIOUS handled)
 * - Replace operations (when entering 'replacing' state)
 *
 * This follows the same pattern as clipboard-machine.ts.
 */
export const findReplaceMachine = setup({
  types: {
    context: {} as FindReplaceContext,
    events: {} as FindReplaceEvent,
  },
  actions: {
    // ==========================================================================
    // Query/Options Actions
    // ==========================================================================

    /** Store search query and mark results stale */
    setQuery: assign(({ context, event }) => {
      if (event.type !== 'SET_QUERY') return {};
      return {
        query: event.query,
        resultsStale: context.results.length > 0, // Only stale if we had results
      };
    }),

    /** Store replacement text */
    setReplacement: assign(({ event }) => {
      if (event.type !== 'SET_REPLACEMENT') return {};
      return { replacement: event.replacement };
    }),

    /** Update search options */
    setOptions: assign(({ context, event }) => {
      if (event.type !== 'SET_OPTIONS') return {};
      return {
        options: { ...context.options, ...event.options },
        resultsStale: context.results.length > 0, // Options change invalidates results
      };
    }),

    /** Update active sheet ID */
    setActiveSheet: assign(({ event }) => {
      if (event.type !== 'SET_ACTIVE_SHEET') return {};
      return { activeSheetId: event.sheetId };
    }),

    // ==========================================================================
    // Search Actions
    // ==========================================================================

    /** Store search results */
    storeResults: assign(({ event }) => {
      if (event.type !== 'SEARCH_COMPLETE') return {};
      const maxIndex = event.results.length - 1;
      const initialCurrentIndex =
        event.initialCurrentIndex == null
          ? event.results.length > 0
            ? 0
            : -1
          : Math.max(-1, Math.min(event.initialCurrentIndex, maxIndex));
      return {
        results: event.results,
        currentIndex: initialCurrentIndex,
        resultsStale: false,
        errorMessage: null,
      };
    }),

    /** Store search error */
    storeError: assign(({ event }) => {
      if (event.type !== 'SEARCH_ERROR') return {};
      return { errorMessage: event.message };
    }),

    // ==========================================================================
    // Navigation Actions
    // ==========================================================================

    /** Increment current index (wrap around) */
    incrementIndex: assign(({ context }) => {
      if (context.results.length === 0) return { currentIndex: -1 };
      return {
        currentIndex: (context.currentIndex + 1) % context.results.length,
      };
    }),

    /** Decrement current index (wrap around) */
    decrementIndex: assign(({ context }) => {
      if (context.results.length === 0) return { currentIndex: -1 };
      if (context.currentIndex < 0) {
        return { currentIndex: context.results.length - 1 };
      }
      return {
        currentIndex: (context.currentIndex - 1 + context.results.length) % context.results.length,
      };
    }),

    // ==========================================================================
    // Replace Actions
    // ==========================================================================

    /** Handle replace completion - may update current index */
    handleReplaceComplete: assign(({ event }) => {
      if (event.type !== 'REPLACE_COMPLETE') return {};

      // If replacement was successful and coordinator provided a new index, use it
      // Otherwise, keep current (coordinator handles navigation)
      if (event.success && event.newCurrentIndex !== undefined) {
        return { currentIndex: event.newCurrentIndex };
      }
      return {};
    }),

    // ==========================================================================
    // Invalidation Actions
    // ==========================================================================

    /** Mark results as stale */
    markStale: assign(() => ({ resultsStale: true })),

    /**
     * Remove result for deleted cell (Cell Identity pattern).
     * When a cell is deleted, remove it from results rather than
     * invalidating the entire search.
     */
    removeDeletedCell: assign(({ context, event }) => {
      if (event.type !== 'CELL_DELETED') return {};

      const newResults = context.results.filter((r) => r.cellId !== event.cellId);
      let newIndex = context.currentIndex;

      // Adjust current index if needed
      if (newResults.length === 0) {
        newIndex = -1;
      } else if (context.currentIndex >= newResults.length) {
        newIndex = newResults.length - 1;
      }

      return {
        results: newResults,
        currentIndex: newIndex,
      };
    }),

    /** Clear all results and related state */
    clearAll: assign(() => ({
      results: [],
      currentIndex: -1,
      resultsStale: false,
      errorMessage: null,
    })),

    // ==========================================================================
    // Lifecycle Actions
    // ==========================================================================

    /** Set showReplace flag from OPEN event */
    setShowReplace: assign(({ event }) => {
      if (event.type !== 'OPEN') return {};
      return {
        showReplace: event.showReplace ?? false,
        activeSheetId: event.sheetId ?? null,
      };
    }),

    /** Reset to initial state on close */
    resetOnClose: assign(() => ({
      results: [],
      currentIndex: -1,
      resultsStale: false,
      errorMessage: null,
      // Note: Keep query and replacement for next open (Excel behavior)
    })),
  },
  guards: {
    /** Check if we have search results */
    hasResults: ({ context }) => context.results.length > 0,

    /** Check if we have a non-empty query */
    hasQuery: ({ context }) => context.query.trim().length > 0,

    /** Check if results are stale */
    isStale: ({ context }) => context.resultsStale,

    /** Check if we can replace */
    canReplace: ({ context }) => context.results.length > 0,
  },
}).createMachine({
  id: 'findReplace',
  initial: 'closed',
  context: initialContext,

  states: {
    // =========================================================================
    // CLOSED - Dialog not open
    // =========================================================================
    closed: {
      on: {
        OPEN: {
          target: 'idle',
          actions: 'setShowReplace',
        },
      },
    },

    // =========================================================================
    // IDLE - Dialog open, waiting for search
    // =========================================================================
    idle: {
      on: {
        CLOSE: {
          target: 'closed',
          actions: 'resetOnClose',
        },
        SET_QUERY: {
          actions: 'setQuery',
        },
        SET_REPLACEMENT: {
          actions: 'setReplacement',
        },
        SET_OPTIONS: {
          actions: 'setOptions',
        },
        SET_ACTIVE_SHEET: {
          actions: 'setActiveSheet',
        },
        SEARCH: {
          target: 'searching',
          guard: 'hasQuery',
        },
        // Can also go directly to hasResults if we have previous results
        FIND_NEXT: {
          target: 'hasResults',
          guard: 'hasResults',
          actions: 'incrementIndex',
        },
        FIND_PREVIOUS: {
          target: 'hasResults',
          guard: 'hasResults',
          actions: 'decrementIndex',
        },
      },
    },

    // =========================================================================
    // SEARCHING - Search in progress
    // =========================================================================
    searching: {
      on: {
        // Allow user to continue typing while search is in progress
        // Transition back to idle so coordinator can reschedule debounced search
        SET_QUERY: {
          target: 'idle',
          actions: 'setQuery',
        },
        SET_REPLACEMENT: {
          actions: 'setReplacement',
        },
        SET_OPTIONS: {
          target: 'idle',
          actions: 'setOptions',
        },
        SET_ACTIVE_SHEET: {
          actions: 'setActiveSheet',
        },
        SEARCH_COMPLETE: {
          target: 'hasResults',
          actions: 'storeResults',
        },
        SEARCH_ERROR: {
          target: 'idle',
          actions: 'storeError',
        },
        CLOSE: {
          target: 'closed',
          actions: 'resetOnClose',
        },
      },
    },

    // =========================================================================
    // HAS_RESULTS - Results available, can navigate/replace
    // =========================================================================
    hasResults: {
      on: {
        CLOSE: {
          target: 'closed',
          actions: 'resetOnClose',
        },
        SET_QUERY: {
          target: 'idle',
          actions: 'setQuery',
        },
        SET_REPLACEMENT: {
          actions: 'setReplacement',
        },
        SET_OPTIONS: {
          target: 'idle',
          actions: 'setOptions',
        },
        SET_ACTIVE_SHEET: {
          actions: 'setActiveSheet',
        },
        SEARCH: {
          target: 'searching',
          guard: 'hasQuery',
        },
        FIND_NEXT: {
          actions: 'incrementIndex',
        },
        FIND_PREVIOUS: {
          actions: 'decrementIndex',
        },
        REPLACE: {
          target: 'replacing',
          guard: 'canReplace',
        },
        REPLACE_ALL: {
          target: 'replacing',
        },
        MARK_STALE: {
          actions: 'markStale',
        },
        CELL_DELETED: {
          actions: 'removeDeletedCell',
        },
        CLEAR_RESULTS: {
          target: 'idle',
          actions: 'clearAll',
        },
      },
    },

    // =========================================================================
    // REPLACING - Replace operation in progress
    // =========================================================================
    replacing: {
      on: {
        REPLACE_COMPLETE: {
          target: 'hasResults',
          actions: 'handleReplaceComplete',
        },
        REPLACE_ALL_COMPLETE: {
          target: 'idle',
          actions: 'clearAll',
        },
        REPLACE_ERROR: {
          target: 'hasResults',
          actions: 'storeError',
        },
        CLOSE: {
          target: 'closed',
          actions: 'resetOnClose',
        },
      },
    },
  },
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

/** Actor type for the Find-Replace machine */
export type FindReplaceActor = ActorRefFrom<typeof findReplaceMachine>;

/** State snapshot type for the Find-Replace machine */
export type FindReplaceState = SnapshotFrom<typeof findReplaceMachine>;

/** Machine type */
export type FindReplaceMachine = typeof findReplaceMachine;

// =============================================================================
// SNAPSHOT HELPER
// =============================================================================

/**
 * Extract a simplified snapshot from machine state for external consumers.
 *
 * ARCHITECTURE: This function composes selectors - the single source of truth.
 * All extraction logic is delegated to findReplaceSelectors.
 * @see contracts/src/actors/find-replace.ts
 */
export function getFindReplaceSnapshot(state: FindReplaceState): {
  isOpen: boolean;
  isSearching: boolean;
  isReplacing: boolean;
  hasResults: boolean;
  query: string;
  replacement: string;
  resultCount: number;
  currentResultNumber: number;
  resultsStale: boolean;
  showReplace: boolean;
  errorMessage: string | null;
  options: SearchOptions;
} {
  // Cast state to selector-compatible type
  const s = state as Parameters<(typeof findReplaceSelectors)['query']>[0];

  return {
    // State matching selectors
    isOpen: findReplaceSelectors.isOpen(s),
    isSearching: findReplaceSelectors.isSearching(s),
    isReplacing: findReplaceSelectors.isReplacing(s),
    hasResults: findReplaceSelectors.hasResultsState(s),

    // Value selectors
    query: findReplaceSelectors.query(s),
    replacement: findReplaceSelectors.replacement(s),
    resultCount: findReplaceSelectors.resultCount(s),
    currentResultNumber: findReplaceSelectors.currentResultNumber(s),
    resultsStale: findReplaceSelectors.resultsStale(s),
    showReplace: findReplaceSelectors.showReplace(s),
    errorMessage: findReplaceSelectors.errorMessage(s),
    options: findReplaceSelectors.options(s),
  };
}
