/**
 * Filter Actions Hook
 *
 * Provides filter state for toolbar button enable/disable logic.
 * Follows the same pattern as useGroupingActions.
 *
 * Reads filter state via ws.filters.list() (async, unified Worksheet API).
 * Active filter counts derived from returned filter objects' columnFilters and
 * advanced filter state.
 *
 * DESIGN NOTE: This hook is optimized for toolbar/low-frequency UI contexts.
 * It subscribes to filter events and updates state reactively, which is appropriate
 * for ribbon buttons that are not re-rendered frequently. Do NOT use this hook in
 * high-frequency render contexts (e.g., cell renderers, scroll handlers) as the
 * event subscriptions and state updates may cause performance issues.
 *
 * @module hooks/use-filter-actions
 */

import { useCallback, useEffect, useState } from 'react';

import { useActiveSheetId, useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

interface FilterStateInfo {
  hasFilters: boolean;
  hasActiveFilters: boolean;
  activeFilterCount: number;
}

export interface UseFilterActionsReturn {
  /** True if there are active column or advanced filters to clear */
  canClearFilters: boolean;
  /** True if there are any filters to reapply */
  canReapplyFilters: boolean;
  /** Number of active column filters plus active advanced filters */
  activeFilterCount: number;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Derive filter state info from an array of filter objects returned by ws.filters.list().
 * Mirrors the logic previously in Filters.getActiveFilters / getActiveFilterCount.
 */
function deriveFilterStateInfo(allFilters: any[]): FilterStateInfo {
  let activeFilterCount = 0;
  let hasActiveFilters = false;

  for (const filter of allFilters) {
    const columnFilterKeys = filter.columnFilters ? Object.keys(filter.columnFilters).length : 0;
    if (columnFilterKeys > 0) {
      hasActiveFilters = true;
      activeFilterCount += columnFilterKeys;
    }
    if (filter.advancedFilter?.active === true) {
      hasActiveFilters = true;
      activeFilterCount += 1;
    }
  }

  return {
    hasFilters: allFilters.length > 0,
    hasActiveFilters,
    activeFilterCount,
  };
}

const EMPTY_FILTER_STATE: FilterStateInfo = {
  hasFilters: false,
  hasActiveFilters: false,
  activeFilterCount: 0,
};

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook that provides filter state for toolbar buttons.
 *
 * Subscribes to filter events and returns:
 * - canClearFilters: true if there are active column filters to clear
 * - canReapplyFilters: true if there are any filters on the sheet (nothing to reapply if no filters)
 * - activeFilterCount: total number of active column filter criteria
 *
 * @returns Filter state for toolbar button enable/disable logic
 */
export function useFilterActions(): UseFilterActionsReturn {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);

  // Start with empty state; async fetch populates it
  const [filterState, setFilterState] = useState<FilterStateInfo>(EMPTY_FILTER_STATE);

  // Async fetch via unified Worksheet API
  const updateFilterState = useCallback(async () => {
    if (!activeSheetId) {
      setFilterState(EMPTY_FILTER_STATE);
      return;
    }

    try {
      const allFilters = await ws.filters.list();
      setFilterState(deriveFilterStateInfo(allFilters));
    } catch {
      // On error, fall back to empty state
      setFilterState(EMPTY_FILTER_STATE);
    }
  }, [ws, activeSheetId]);

  useEffect(() => {
    if (!activeSheetId) {
      setFilterState(EMPTY_FILTER_STATE);
      return;
    }

    // Initial load (async)
    void updateFilterState();

    // Subscribe to filter events via ws.on() (fine-grained event types).
    // Complete list of filter events verified from contracts/src/events.ts:
    // - filter:created, filter:deleted, filter:updated, filter:cleared, filter:applied
    // Fine-grained strings passed via SpreadsheetEventType passthrough in WorksheetImpl.on().
    const handler = () => void updateFilterState();
    const unsubs = [
      ws.on('filter:created', handler),
      ws.on('filter:deleted', handler),
      ws.on('filter:updated', handler),
      ws.on('filter:cleared', handler),
      ws.on('filter:applied', handler),
    ];

    // Cleanup: unsubscribe from events when component unmounts or activeSheetId changes
    // This ensures we don't leak subscriptions and properly re-subscribe to the new sheet
    return () => {
      for (const u of unsubs) u();
    };
  }, [ws, activeSheetId, updateFilterState]); // Re-run when activeSheetId changes to re-subscribe to correct sheet

  return {
    canClearFilters: filterState.hasActiveFilters,
    canReapplyFilters: filterState.hasFilters,
    activeFilterCount: filterState.activeFilterCount,
  };
}
