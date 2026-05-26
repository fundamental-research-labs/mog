/**
 * Find-Replace Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * States:
 * - closed: Dialog not open
 * - idle: Dialog open, no search performed yet
 * - searching: Search in progress
 * - hasResults: Results available, can navigate/replace
 * - replacing: Replace operation in progress
 *
 * @see state-machines/src/find-replace-machine.ts
 */

import type { SheetId } from '@mog/types-core';
import type { SearchOptions, SearchResult } from '@mog-sdk/types-document/document/search';

// =============================================================================
// STATE TYPE (matches XState snapshot shape)
// =============================================================================

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 */
export interface FindReplaceState {
  context: {
    /** Current search query */
    query: string;
    /** Replacement text */
    replacement: string;
    /** Search options */
    options: SearchOptions;
    /** Search results */
    results: SearchResult[];
    /** Current result index (0-based, -1 if no results) */
    currentIndex: number;
    /** Whether results are stale */
    resultsStale: boolean;
    /** Whether showing replace UI */
    showReplace: boolean;
    /** Error message if any */
    errorMessage: string | null;
    /** Active sheet ID */
    activeSheetId: SheetId | null;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
  value: string;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

export interface FindReplaceAccessor {
  // Value accessors
  getQuery(): string;
  getReplacement(): string;
  getOptions(): SearchOptions;
  getResults(): SearchResult[];
  getCurrentIndex(): number;
  getResultsStale(): boolean;
  getShowReplace(): boolean;
  getErrorMessage(): string | null;
  getActiveSheetId(): SheetId | null;

  // Derived value accessors
  getResultCount(): number;
  getCurrentResultNumber(): number;
  hasResults(): boolean;
  getCurrentResult(): SearchResult | null;

  // State matching accessors
  isClosed(): boolean;
  isIdle(): boolean;
  isSearching(): boolean;
  hasResultsState(): boolean;
  isReplacing(): boolean;

  // Compound accessors
  isOpen(): boolean;
  canNavigate(): boolean;
  canReplace(): boolean;
}

// =============================================================================
// COMMANDS INTERFACE
// =============================================================================

export interface FindReplaceCommands {
  // Lifecycle
  open(showReplace?: boolean, sheetId?: SheetId): void;
  close(): void;

  // Query/options
  setQuery(query: string): void;
  setReplacement(replacement: string): void;
  setOptions(options: Partial<SearchOptions>): void;
  setActiveSheet(sheetId: SheetId): void;

  // Search
  search(): void;
  searchComplete(results: SearchResult[]): void;
  searchError(message: string): void;

  // Navigation
  findNext(): void;
  findPrevious(): void;

  // Replace
  replace(): void;
  replaceComplete(success: boolean, newCurrentIndex?: number): void;
  replaceAll(): void;
  replaceAllComplete(replacedCount: number, skippedCount: number): void;

  // Invalidation
  markStale(): void;
  cellDeleted(cellId: string): void;
  clearResults(): void;
}
