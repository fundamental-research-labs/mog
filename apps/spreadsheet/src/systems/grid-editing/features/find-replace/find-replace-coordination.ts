/**
 * Find & Replace Coordination
 *
 * Coordinates between the find-replace XState machine, search module,
 * and unified Workbook/Worksheet API to execute search and replace operations.
 *
 * ARCHITECTURE:
 * - Find-Replace machine owns UI state (query, options, current index, results)
 * - Coordinator executes side effects:
 * - Runs search queries via search module
 * - Navigates to matched cells by updating selection
 * - Executes replace operations via Worksheet API (setCell / setCells)
 * - Sends results back to the machine
 *
 * FLOW:
 * 1. User types search query -> machine sends SET_QUERY
 * 2. Coordinator detects debounced query change
 * 3. Coordinator executes searchInScope() with Worksheet API-based provider
 * 4. Coordinator sends SEARCH_COMPLETE with CellId-based results
 * 5. User clicks "Next" -> machine sends FIND_NEXT
 * 6. Coordinator resolves CellId to position, updates selection
 * 7. For replace: Coordinator sets cell value via ws.setCell(), re-runs search
 *
 */

import type { IdentifiedCellData, Workbook } from '@mog-sdk/contracts/api';
import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { SearchOptions, SearchResult } from '@mog-sdk/contracts/search';
import { guardBridgeMutation } from '../../../../actions/handlers/bridge-error-guard';
import {
  formatDisplayValue,
  searchInScope,
  type SearchDataProvider,
} from '../../../../domain/search';
import type {
  FindReplaceActor,
  FindReplaceState,
  SelectionActor,
} from '../../../shared/actor-types';

// =============================================================================
// Search Cache Types
// =============================================================================

/**
 * Cached cell data for a single cell, fetched via Worksheet API.
 * Extends IdentifiedCellData with displayValue alias for search compatibility.
 */
interface CachedCellData extends Omit<IdentifiedCellData, 'cellId'> {
  /** Branded CellId at the Worksheet API/cache boundary. */
  cellId: CellId;
  /** Alias: the value field used for search matching (same as `value`) */
  displayValue: CellValue | null;
  /** Whether this cell is hidden by its row or column. */
  isHidden: boolean;
}

/**
 * Pre-fetched search data for all sheets, built from Worksheet API.
 * Enables sync SearchDataProvider backed by async data.
 */
interface SearchCache {
  sheetIds: SheetId[];
  /** Per-sheet cell data, keyed by sheetId */
  sheets: Map<
    SheetId,
    {
      bounds: { maxRow: number; maxCol: number } | null;
      cells: CachedCellData[];
      /** CellId -> CachedCellData for O(1) lookup during replace */
      cellIndex: Map<CellId, CachedCellData>;
    }
  >;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies for FindReplaceCoordinator.
 */
export interface FindReplaceCoordinatorDependencies {
  /** Find-Replace XState actor */
  findReplaceActor: FindReplaceActor;
  /** Selection actor (for navigating to matches) */
  selectionActor: SelectionActor;
  /** Callback to invalidate the renderer (e.g. after search highlights change) */
  invalidateRenderer: () => void;
  /** Resolve a CellId to its current position (row, col, sheet). */
  resolveCellPosition: (
    cellId: CellId,
  ) => Promise<{ row: number; col: number; sheet: SheetId } | null>;
  /** Get active sheet ID */
  getActiveSheetId: () => SheetId;
  /** Unified Workbook API */
  workbook: Workbook;
  /** Switch the active sheet (for cross-sheet navigation) */
  setActiveSheet?: (sheetId: SheetId) => void;
  /** Override target sheet's saved cursor before switching to it */
  overrideTargetSheetViewState?: (sheetId: SheetId, row: number, col: number) => void;
}

/**
 * Configuration for find-replace coordinator setup.
 */
export interface FindReplaceCoordinatorConfig {
  /** Debounce delay for search (ms) */
  searchDebounceMs?: number;
}

/**
 * Result from setting up find-replace coordination.
 */
export interface FindReplaceCoordinationResult {
  /** Cleanup function */
  cleanup: () => void;
}

// =============================================================================
// Coordinator Implementation
// =============================================================================

/**
 * FindReplaceCoordinator - Wires Find/Replace UI to Search Module
 *
 * Follows coordinator pattern:
 * - Machine owns state (query, results, current index)
 * - Coordinator owns execution (search, navigation, replace)
 */
export class FindReplaceCoordinator {
  private deps: FindReplaceCoordinatorDependencies | null = null;
  private subscription: { unsubscribe: () => void } | null = null;
  private previousState: FindReplaceState | null = null;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private searchDebounceMs: number;
  /** Tracks the last event type that we need to differentiate on */
  private pendingReplaceAllEvent: boolean = false;
  /** Cached search data from last search execution */
  private searchCache: SearchCache | null = null;
  /** Last non-empty query that completed a search in the current coordinator lifetime. */
  private lastExecutedQuery: string = '';

  constructor(config: FindReplaceCoordinatorConfig = {}) {
    this.searchDebounceMs = config.searchDebounceMs ?? 150;
  }

  // ===========================================================================
  // DEPENDENCY INJECTION
  // ===========================================================================

  setDependencies(deps: FindReplaceCoordinatorDependencies): void {
    this.dispose();

    this.deps = deps;
    this.previousState = deps.findReplaceActor.getSnapshot();

    // Subscribe to find-replace machine state changes
    this.subscription = deps.findReplaceActor.subscribe((state) => {
      this.onStateChange(state);
    });

    // Intercept REPLACE_ALL events by wrapping the actor's send method
    // This allows us to track when REPLACE_ALL was triggered vs REPLACE
    const originalSend = deps.findReplaceActor.send.bind(deps.findReplaceActor);
    deps.findReplaceActor.send = (event: Parameters<typeof originalSend>[0]) => {
      if (
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        event.type === 'REPLACE_ALL'
      ) {
        this.pendingReplaceAllEvent = true;
      }
      return originalSend(event);
    };
  }

  hasDependencies(): boolean {
    return this.deps !== null;
  }

  dispose(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.previousState = null;
    this.deps = null;
    this.searchCache = null;
    this.lastExecutedQuery = '';
  }

  // ===========================================================================
  // STATE CHANGE HANDLER
  // ===========================================================================

  private onStateChange(state: FindReplaceState): void {
    if (!this.deps || !this.previousState) {
      this.previousState = state;
      return;
    }

    const ctx = state.context;
    const prevCtx = this.previousState.context;

    // Check for query or options change -> trigger debounced search
    // Only trigger if we're in an open state (not closed) and NOT currently searching
    // This prevents double-search when the machine also handles SEARCH event
    if (
      !state.matches('closed') &&
      !state.matches('searching') &&
      (ctx.query !== prevCtx.query || !optionsEqual(ctx.options, prevCtx.options))
    ) {
      this.debouncedSearch(ctx.query, ctx.options);
    }

    // Check for FIND_NEXT/FIND_PREVIOUS events -> navigate
    // We detect navigation by checking if currentIndex changed and we're in hasResults state
    if (
      state.matches('hasResults') &&
      ctx.currentIndex !== prevCtx.currentIndex &&
      ctx.results.length > 0
    ) {
      const result = ctx.results[ctx.currentIndex];
      if (result) {
        this.navigateToResult(result).catch((err) => {
          console.error('[FindReplace] Navigation failed:', err);
          // Navigation failure is non-fatal — results still visible.
          // Invalidate renderer to ensure display reflects Rust's actual state.
          this.deps?.invalidateRenderer();
        });
      }
    }

    // Check for entering 'replacing' state -> execute replace
    if (state.matches('replacing') && !this.previousState.matches('replacing')) {
      // Check if this was REPLACE_ALL vs REPLACE
      // We track this via the pendingReplaceAllEvent flag set before sending the event
      if (this.pendingReplaceAllEvent) {
        this.pendingReplaceAllEvent = false;
        this.executeReplaceAll().catch((err) => {
          console.error('[FindReplace] Replace all failed:', err);
          this.deps?.findReplaceActor.send({
            type: 'REPLACE_ERROR',
            message: err instanceof Error ? err.message : 'Replace all failed',
          });
        });
      } else {
        this.executeReplace(ctx.currentIndex).catch((err) => {
          console.error('[FindReplace] Replace failed:', err);
          this.deps?.findReplaceActor.send({
            type: 'REPLACE_ERROR',
            message: err instanceof Error ? err.message : 'Replace failed',
          });
        });
      }
    }

    this.previousState = state;
  }

  // ===========================================================================
  // SEARCH EXECUTION
  // ===========================================================================

  private debouncedSearch(query: string, options: SearchOptions): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    this.searchDebounceTimer = setTimeout(() => {
      this.executeSearch(query, options).catch((err) => {
        // executeSearch has its own try/catch that sends SEARCH_ERROR,
        // so this only fires for truly unexpected failures
        console.error('[FindReplace] Unhandled search error:', err);
        this.deps?.findReplaceActor.send({
          type: 'SEARCH_ERROR',
          message: 'Unexpected search failure',
        });
      });
    }, this.searchDebounceMs);
  }

  /**
   * Build a search cache by pre-fetching all cell data from the unified Worksheet API.
   * This converts the async Worksheet API into a sync-friendly cache
   * that the SearchDataProvider interface requires.
   */
  private async buildSearchCache(): Promise<SearchCache> {
    if (!this.deps) throw new Error('Dependencies not set');

    const workbook = this.deps.workbook;
    const names = await workbook.getSheetNames();
    const sheetIds: SheetId[] = [];
    for (const name of names) {
      const ws = await workbook.getSheet(name);
      sheetIds.push(ws.getSheetId());
    }

    const sheets = new Map<
      SheetId,
      {
        bounds: { maxRow: number; maxCol: number } | null;
        cells: CachedCellData[];
        cellIndex: Map<CellId, CachedCellData>;
      }
    >();

    for (const sheetId of sheetIds) {
      let dataBounds: { minRow: number; minCol: number; maxRow: number; maxCol: number } | null =
        null;
      try {
        const ws = workbook.getSheetById(sheetId);
        const usedRange = await ws.getUsedRange();
        if (usedRange) {
          dataBounds = {
            minRow: usedRange.startRow,
            minCol: usedRange.startCol,
            maxRow: usedRange.endRow,
            maxCol: usedRange.endCol,
          };
        }
      } catch {
        dataBounds = null;
      }

      if (!dataBounds) {
        sheets.set(sheetId, { bounds: null, cells: [], cellIndex: new Map() });
        continue;
      }

      const bounds = { maxRow: dataBounds.maxRow, maxCol: dataBounds.maxCol };

      // Use unified Worksheet API -- returns cells with CellId, value, formula, display string
      const ws = workbook.getSheetById(sheetId);
      const [identifiedCells, hiddenRows, hiddenCols] = await Promise.all([
        ws.getRangeWithIdentity(
          dataBounds.minRow,
          dataBounds.minCol,
          dataBounds.maxRow,
          dataBounds.maxCol,
        ),
        ws.layout.getHiddenRowsBitmap(),
        ws.layout.getHiddenColumnsBitmap(),
      ]);

      const cells: CachedCellData[] = [];
      const cellIndex = new Map<CellId, CachedCellData>();

      for (const ic of identifiedCells) {
        const cached: CachedCellData = {
          ...ic,
          cellId: toCellId(ic.cellId),
          displayValue: ic.value,
          isHidden: hiddenRows.has(ic.row) || hiddenCols.has(ic.col),
        };
        cells.push(cached);
        cellIndex.set(cached.cellId, cached);
      }

      sheets.set(sheetId, { bounds, cells, cellIndex });
    }

    return { sheetIds, sheets };
  }

  private async executeSearch(query: string, options: SearchOptions): Promise<void> {
    if (!this.deps) return;

    // Skip empty searches
    if (query.trim() === '') {
      this.deps.findReplaceActor.send({ type: 'SEARCH_COMPLETE', results: [] });
      return;
    }

    try {
      // Pre-fetch all search data from Worksheet API, then create sync provider
      this.searchCache = await this.buildSearchCache();
      const provider = createSearchProviderFromCache(this.searchCache);
      const activeSheetId = this.deps.getActiveSheetId();

      // Execute search (sync -- backed by cached data)
      const rawResults = searchInScope(provider, query, options, activeSheetId);
      const results = this.prioritizeWholeCellValueMatches(rawResults, query, options);

      const isReplacementQuery =
        this.lastExecutedQuery.trim() !== '' && this.lastExecutedQuery !== query;
      const activeCellBeforeSearch = this.getActiveCell();
      const firstResultPosition = results[0] ? this.getCachedResultPosition(results[0]) : null;
      const activeWasFirstResult =
        firstResultPosition !== null &&
        firstResultPosition.sheet === activeSheetId &&
        activeCellBeforeSearch?.row === firstResultPosition.row &&
        activeCellBeforeSearch?.col === firstResultPosition.col;
      const initialCurrentIndex =
        results.length === 0 ? undefined : isReplacementQuery || !activeWasFirstResult ? -1 : 0;

      // Send results to machine. Replacement searches keep results highlighted
      // but leave navigation unselected so the first explicit Enter lands on
      // the first result instead of skipping to the second. Fresh searches do
      // the same when live search moves the active cell to a different first
      // result; if the active cell was already the first result, Enter advances.
      this.deps.findReplaceActor.send({
        type: 'SEARCH_COMPLETE',
        results,
        initialCurrentIndex,
      });
      this.lastExecutedQuery = query;

      // If there are results for a fresh query, live-search to the first one.
      // Keep currentIndex at -1 when this is a new jump so the first Enter
      // confirms that result instead of skipping past it.
      if (results.length > 0 && !isReplacementQuery && !activeWasFirstResult) {
        await this.navigateToResult(results[0]);
      }

      // Invalidate renderer to show highlights
      this.deps.invalidateRenderer();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Search failed';
      this.deps.findReplaceActor.send({ type: 'SEARCH_ERROR', message });
    }
  }

  // ===========================================================================
  // NAVIGATION
  // ===========================================================================

  private async navigateToResult(result: SearchResult): Promise<void> {
    if (!this.deps) return;

    // Resolve from cache first (O(1)), fallback to deps
    const position =
      this.getCachedResultPosition(result) ?? (await this.deps.resolveCellPosition(result.cellId));
    if (!position) {
      console.warn('[FindReplaceCoordinator] Could not resolve position for', result.cellId);
      return;
    }

    // Switch sheet if the match is on a different sheet
    // Switch sheet if the match is on a different sheet
    if (position.sheet !== this.deps.getActiveSheetId() && this.deps.setActiveSheet) {
      // Pre-set the target sheet's saved cursor to the find result so that
      // the sheet-switch coordination restores the correct cell when the
      // renderer finishes switching (not the old remembered position).
      this.deps.overrideTargetSheetViewState?.(position.sheet, position.row, position.col);
      this.deps.setActiveSheet(position.sheet);
    }

    // Update selection to the matched cell
    this.deps.selectionActor.send({
      type: 'SET_SELECTION',
      ranges: [
        {
          startRow: position.row,
          startCol: position.col,
          endRow: position.row,
          endCol: position.col,
        },
      ],
      activeCell: { row: position.row, col: position.col },
    });

    // Invalidate to ensure the view updates
    this.deps.invalidateRenderer();
  }

  // ===========================================================================
  // REPLACE OPERATIONS
  // ===========================================================================

  /**
   * Execute a single replace operation on the current match.
   */
  private async executeReplace(currentIndex: number): Promise<void> {
    if (!this.deps) return;

    const state = this.deps.findReplaceActor.getSnapshot();
    const { results, replacement, query, options } = state.context;
    const targetIndex = currentIndex >= 0 ? currentIndex : 0;

    if (targetIndex < 0 || targetIndex >= results.length) {
      this.deps.findReplaceActor.send({ type: 'REPLACE_COMPLETE', success: false });
      return;
    }

    const result = results[targetIndex];
    // Resolve from cache first (O(1)), fallback to deps
    const cached = this.searchCache?.sheets.get(result.sheetId)?.cellIndex.get(result.cellId);
    const position = cached
      ? { row: cached.row, col: cached.col, sheet: result.sheetId }
      : await this.deps.resolveCellPosition(result.cellId);

    if (!position) {
      // Cell was deleted - notify machine and fail gracefully
      this.deps.findReplaceActor.send({ type: 'CELL_DELETED', cellId: result.cellId });
      this.deps.findReplaceActor.send({ type: 'REPLACE_COMPLETE', success: false });
      return;
    }

    // Get current cell value and perform replacement
    const currentValue = await this.getCellDisplayValueByCellId(result.cellId);
    const newValue = this.performReplacement(currentValue, query, replacement, options);

    // Set the new value via unified Worksheet API
    const ws = this.deps.workbook.getSheetById(result.sheetId);
    const ok = await guardBridgeMutation(() => ws.setCell(position.row, position.col, newValue));
    if (!ok) {
      this.deps.findReplaceActor.send({ type: 'REPLACE_COMPLETE', success: false });
      return;
    }

    // Re-run search to update results
    await this.executeSearch(query, options);

    // Signal completion
    this.deps.findReplaceActor.send({ type: 'REPLACE_COMPLETE', success: true });
  }

  /**
   * Execute Replace All - replaces all matches in a single batch operation.
   *
   * ARCHITECTURE:
   * - Iterates by CellId (stable identity), not position
   * - Order doesn't matter for CellId-based operations (no reverse-order trick needed)
   * - Deleted cells are skipped gracefully
   * - Wrapped in wb.undoGroup() for single undo step
   */
  private async executeReplaceAll(): Promise<void> {
    if (!this.deps) return;

    const state = this.deps.findReplaceActor.getSnapshot();
    const { results, replacement, query, options } = state.context;

    if (results.length === 0) {
      this.deps.findReplaceActor.send({
        type: 'REPLACE_ALL_COMPLETE',
        replacedCount: 0,
        skippedCount: 0,
      });
      return;
    }

    let replacedCount = 0;
    let skippedCount = 0;

    // Wrap in batch for single undo step
    await this.deps.workbook.undoGroup(async () => {
      // Write per-cell so a single PartialArrayWrite (e.g. a cell inside a
      // dynamic-array spill range) skips just that cell and the loop keeps
      // going (Excel parity for Replace All).
      for (const result of results) {
        // Resolve from cache first (O(1)), fallback to deps
        const cached = this.searchCache?.sheets.get(result.sheetId)?.cellIndex.get(result.cellId);
        const position = cached
          ? { row: cached.row, col: cached.col, sheet: result.sheetId }
          : await this.deps!.resolveCellPosition(result.cellId);

        if (!position) {
          skippedCount++;
          continue;
        }

        const currentValue = await this.getCellDisplayValueByCellId(result.cellId);
        const newValue = this.performReplacement(currentValue, query, replacement, options);

        if (newValue === currentValue) {
          skippedCount++;
          continue;
        }

        const ws = this.deps!.workbook.getSheetById(result.sheetId);
        const ok = await guardBridgeMutation(() =>
          ws.setCell(position.row, position.col, newValue),
        );
        if (ok) {
          replacedCount++;
        } else {
          skippedCount++;
        }
      }
    });

    // Invalidate renderer
    this.deps.invalidateRenderer();

    // Signal completion
    this.deps.findReplaceActor.send({
      type: 'REPLACE_ALL_COMPLETE',
      replacedCount,
      skippedCount,
    });
  }

  /**
   * Get cell display value using CellId directly.
   *
   * First checks the search cache (populated during executeSearch).
   * Falls back to Worksheet API for freshest data during replace.
   */
  private async getCellDisplayValueByCellId(cellId: CellId): Promise<string> {
    if (!this.deps) return '';

    // Fast path: use search cache if available (O(1) lookup)
    if (this.searchCache) {
      for (const [, sheetData] of this.searchCache.sheets) {
        const cached = sheetData.cellIndex.get(cellId);
        if (cached) return cached.displayString;
      }
    }

    // Fallback: fetch from unified Worksheet API
    const position = await this.deps.resolveCellPosition(cellId);
    if (!position) return '';

    try {
      const ws = this.deps.workbook.getSheetById(position.sheet);
      return await ws.getDisplayValue(position.row, position.col);
    } catch {
      return '';
    }
  }

  private performReplacement(
    currentValue: string,
    query: string,
    replacement: string,
    options: SearchOptions,
  ): string {
    if (options.useRegex) {
      try {
        const flags = options.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(query, flags);
        return currentValue.replace(regex, replacement);
      } catch {
        // Invalid regex - fall back to literal replacement
        return currentValue.split(query).join(replacement);
      }
    }

    // Literal replacement
    if (options.caseSensitive) {
      return currentValue.split(query).join(replacement);
    }

    // Case-insensitive literal replacement
    const regex = new RegExp(escapeRegExp(query), 'gi');
    return currentValue.replace(regex, replacement);
  }

  private getCachedResultPosition(
    result: SearchResult,
  ): { row: number; col: number; sheet: SheetId } | null {
    const cached = this.searchCache?.sheets.get(result.sheetId)?.cellIndex.get(result.cellId);
    return cached ? { row: cached.row, col: cached.col, sheet: result.sheetId } : null;
  }

  private prioritizeWholeCellValueMatches(
    results: SearchResult[],
    query: string,
    options: SearchOptions,
  ): SearchResult[] {
    if (results.length <= 1 || options.matchEntireCell || options.useRegex) {
      return results;
    }

    const exact: SearchResult[] = [];
    const partial: SearchResult[] = [];

    for (const result of results) {
      if (this.isWholeCellValueMatch(result, query, options)) {
        exact.push(result);
      } else {
        partial.push(result);
      }
    }

    return exact.length > 0 ? [...exact, ...partial] : results;
  }

  private isWholeCellValueMatch(
    result: SearchResult,
    query: string,
    options: SearchOptions,
  ): boolean {
    if (result.isInFormula) {
      return this.textEqualsQuery(
        this.searchCache?.sheets.get(result.sheetId)?.cellIndex.get(result.cellId)?.formulaText ??
          '',
        query,
        options.caseSensitive,
      );
    }

    const cached = this.searchCache?.sheets.get(result.sheetId)?.cellIndex.get(result.cellId);
    if (!cached) return false;

    return this.textEqualsQuery(
      formatDisplayValue(cached.displayValue),
      query,
      options.caseSensitive,
    );
  }

  private textEqualsQuery(text: string, query: string, caseSensitive: boolean): boolean {
    return caseSensitive ? text === query : text.toLocaleLowerCase() === query.toLocaleLowerCase();
  }

  private getActiveCell(): { row: number; col: number } | null {
    try {
      return this.deps?.selectionActor.getSnapshot().context.activeCell ?? null;
    } catch {
      return null;
    }
  }
}

// =============================================================================
// Search Provider Factory
// =============================================================================

/**
 * Create a sync SearchDataProvider backed by a pre-fetched SearchCache.
 * All data has already been fetched from the Worksheet API; the provider
 * just reads from the in-memory cache.
 */
function createSearchProviderFromCache(cache: SearchCache): SearchDataProvider {
  return {
    getSheetIds: () => cache.sheetIds,

    getCellsInSheet: (sheetId, direction) => {
      const sheetData = cache.sheets.get(sheetId);
      if (!sheetData) return [];

      // Copy and sort by direction
      const sorted = sheetData.cells.filter((cell) => !cell.isHidden);
      if (direction === 'byRow') {
        sorted.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));
      } else {
        sorted.sort((a, b) => (a.col !== b.col ? a.col - b.col : a.row - b.row));
      }

      return sorted.map((c) => ({
        cellId: c.cellId,
        row: c.row,
        col: c.col,
        displayValue: c.displayValue,
        formulaText: c.formulaText,
      }));
    },

    getSheetBounds: (sheetId) => {
      const sheetData = cache.sheets.get(sheetId);
      return sheetData?.bounds ?? null;
    },
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function optionsEqual(a: SearchOptions, b: SearchOptions): boolean {
  return (
    a.caseSensitive === b.caseSensitive &&
    a.matchEntireCell === b.matchEntireCell &&
    a.useRegex === b.useRegex &&
    a.searchIn === b.searchIn &&
    a.scope === b.scope &&
    a.direction === b.direction
  );
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// Factory Function
// =============================================================================

export function createFindReplaceCoordinator(
  config?: FindReplaceCoordinatorConfig,
): FindReplaceCoordinator {
  return new FindReplaceCoordinator(config);
}

// =============================================================================
// Setup Function (for use in SheetCoordinator)
// =============================================================================

/**
 * Setup find-replace coordination.
 *
 * Usage in SheetCoordinator:
 * ```typescript
 * const findReplaceResult = setupFindReplaceCoordination({
 * findReplaceActor: this.grid.access.actors.findReplace,
 * selectionActor: this.grid.access.actors.selection,
 * invalidateRenderer: => this.renderer.invalidate('find-replace'),
 * resolveCellPosition,
 * getActiveSheetId: => activeSheetId,
 * workbook
 * });
 * this.crossWiringCleanups.push(findReplaceResult.cleanup);
 * ```
 */
export function setupFindReplaceCoordination(
  deps: FindReplaceCoordinatorDependencies,
  config?: FindReplaceCoordinatorConfig,
): FindReplaceCoordinationResult {
  const coordinator = createFindReplaceCoordinator(config);
  coordinator.setDependencies(deps);

  return {
    cleanup: () => coordinator.dispose(),
  };
}
