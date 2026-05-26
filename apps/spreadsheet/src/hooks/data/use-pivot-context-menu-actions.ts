/**
 * Pivot Context Menu Actions Hook
 *
 * Provides action handlers for the pivot table context menu.
 * Routes actions through appropriate channels:
 * - Pivot operations: ws.pivots.* (unified API -> bridge -> Rust)
 * - Dialog state: UIStore
 *
 * Architecture notes:
 * - Follows the coordinator pattern
 * - All pivot config changes go through ws.pivots.* unified API
 * - Expansion state accessed via ws.pivots.getExpansionState
 *
 * @module hooks/use-pivot-context-menu-actions
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AggregateFunction,
  PivotFieldItems,
  PivotFilter,
  PivotTableLayout,
  ShowValuesAs,
  ShowValuesAsConfig,
  SortOrder,
} from '@mog-sdk/contracts/pivot';

import { useActiveSheetId, useUIStore, useWorkbook } from '../../infra/context';
import { useDispatch } from '../toolbar/use-action-dependencies';

import { usePivotTables } from './use-pivot-tables';

// =============================================================================
// Types
// =============================================================================

export interface UsePivotContextMenuActionsOptions {
  /** The pivot table ID from context menu state */
  pivotId?: string;
  /** The header key if right-clicked on a row/column header */
  headerKey?: string;
  /** The field ID if right-clicked on a specific field */
  fieldId?: string;
}

/** Show Values As calculation types (PivotTable Context Menu Enhancements) */
export type ShowValuesAsType = ShowValuesAs;

export interface PivotFilterFieldOption extends PivotFieldItems {
  currentFilter: PivotFilter | undefined;
}

export interface UsePivotContextMenuActionsReturn {
  // Pivot operations
  /** Edit pivot (opens field panel) */
  editPivot: () => void;
  /** Refresh pivot data from source */
  refreshPivot: () => void;
  /** Delete the pivot table */
  deletePivot: () => void;

  // Expand/Collapse operations
  /** Expand the header at the current position */
  expandHeader: () => void;
  /** Collapse the header at the current position */
  collapseHeader: () => void;
  /** Expand all headers in the pivot */
  expandAll: () => void;
  /** Collapse all headers in the pivot */
  collapseAll: () => void;
  /** Whether the header is currently expanded */
  isHeaderExpanded: boolean;

  // Sort operations
  /** Sort ascending by labels */
  sortAscending: () => void;
  /** Sort descending by labels */
  sortDescending: () => void;
  /** Clear sort */
  clearSort: () => void;
  /** Current sort order for the field (if any) */
  currentSortOrder: SortOrder | undefined;

  // Aggregate operations (for value fields)
  /** Set aggregate function */
  setAggregateFunction: (aggregateFunction: AggregateFunction) => void;
  /** Current aggregate function for the field (if any) */
  currentAggregateFunction: AggregateFunction | undefined;

  // Show Values As operations (for value fields)
  /** Set show values as calculation type */
  setShowValuesAs: (calculationType: ShowValuesAsType) => void;
  /** Current show values as type for the field (if any) */
  currentShowValuesAs: ShowValuesAsType | undefined;

  // Grand total layout operations
  /** Set row/column grand total visibility */
  setGrandTotals: (
    layout: Pick<PivotTableLayout, 'showRowGrandTotals' | 'showColumnGrandTotals'>,
  ) => void;
  /** Current row grand total visibility */
  showRowGrandTotals: boolean;
  /** Current column grand total visibility */
  showColumnGrandTotals: boolean;

  // Page-filter operations
  /** Filter fields with their visible pivot item values */
  pivotFilterFields: PivotFilterFieldOption[];
  /** Set include/exclude filter criteria for a pivot field */
  setPivotFilter: (fieldId: string, filter: Omit<PivotFilter, 'fieldId'>) => void;

  // Group/Ungroup operations
  /** Group selected items */
  groupItems: () => void;
  /** Ungroup selected items */
  ungroupItems: () => void;
  /** Whether grouping is available (requires multiple items selected) */
  canGroup: boolean;
  /** Whether ungrouping is available (requires grouped items selected) */
  canUngroup: boolean;

  // Field operations
  /** Remove the field from its current area */
  removeField: () => void;

  // State
  /** Whether we have a valid pivot context */
  hasPivotContext: boolean;
  /** Whether we have a valid header context (for expand/collapse) */
  hasHeaderContext: boolean;
  /** Whether we have a valid field context (for field operations) */
  hasFieldContext: boolean;
  /** The current pivot table (if any) */
  pivotConfig: ReturnType<typeof usePivotTables>['pivotTables'][0]['config'] | null;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function usePivotContextMenuActions(
  options: UsePivotContextMenuActionsOptions = {},
): UsePivotContextMenuActionsReturn {
  const { pivotId, headerKey, fieldId } = options;

  const activeSheetId = useActiveSheetId();
  const dispatchAction = useDispatch();
  const closeContextMenu = useUIStore((s) => s.closeContextMenu);
  const startEditingPivot = useUIStore((s) => s.startEditingPivot);

  // Get pivot operations from the main pivot hook
  const {
    pivotTables,
    deletePivotTable,
    refreshPivotTable,
    toggleRowExpanded,
    setAllExpanded,
    setSortOrder,
    setAggregateFunction: setAggregate,
    removeFieldFromArea,
  } = usePivotTables({ sheetId: activeSheetId });

  // Get worksheet for expansion state queries via ws.pivots
  const wb = useWorkbook();
  const ws = useMemo(() => wb.getSheetById(activeSheetId), [wb, activeSheetId]);

  // ==========================================================================
  // Computed Values
  // ==========================================================================

  const hasPivotContext = !!pivotId;
  const hasHeaderContext = !!pivotId && !!headerKey;
  const hasFieldContext = !!pivotId && !!fieldId;

  // Get the current pivot table config
  const pivotConfig = useMemo(() => {
    if (!pivotId) return null;
    const pivot = pivotTables.find((p) => p.config.id === pivotId);
    return pivot?.config ?? null;
  }, [pivotId, pivotTables]);

  const effectiveValueFieldId = useMemo(() => {
    if (fieldId) return fieldId;
    return pivotConfig?.placements.find((p) => p.area === 'value')?.fieldId;
  }, [fieldId, pivotConfig]);

  // Get expansion state for the header
  // ws.pivots.getExpansionState is async, so we use local state
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
  const [pivotItems, setPivotItems] = useState<PivotFieldItems[]>([]);
  useEffect(() => {
    if (!pivotId || !headerKey) {
      setIsHeaderExpanded(false);
      return;
    }
    const name = pivotConfig?.name ?? pivotId;
    void ws.pivots.getExpansionState(name).then((expansionState) => {
      const expanded =
        expansionState.expandedRows[headerKey] ?? expansionState.expandedColumns[headerKey] ?? true;
      setIsHeaderExpanded(expanded);
    });
  }, [pivotId, pivotConfig, headerKey, ws]);

  useEffect(() => {
    let cancelled = false;
    if (!pivotConfig) {
      setPivotItems([]);
      return;
    }

    void ws.pivots
      .getAllPivotItems(pivotConfig.name)
      .then((items) => {
        if (!cancelled) setPivotItems(items);
      })
      .catch(() => {
        if (!cancelled) setPivotItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [pivotConfig, ws]);

  // Get current sort order for the field
  const currentSortOrder = useMemo(() => {
    if (!pivotConfig || !fieldId) return undefined;
    const placement = pivotConfig.placements.find((p) => p.fieldId === fieldId);
    return placement?.sortOrder;
  }, [pivotConfig, fieldId]);

  // Get current aggregate function for the field
  const currentAggregateFunction = useMemo(() => {
    if (!pivotConfig || !effectiveValueFieldId) return undefined;
    const placement = pivotConfig.placements.find(
      (p) => p.fieldId === effectiveValueFieldId && p.area === 'value',
    );
    return placement?.aggregateFunction;
  }, [pivotConfig, effectiveValueFieldId]);

  // Get the area for the current field
  const fieldArea = useMemo(() => {
    if (!pivotConfig || !fieldId) return undefined;
    const placement = pivotConfig.placements.find((p) => p.fieldId === fieldId);
    return placement?.area;
  }, [pivotConfig, fieldId]);

  // ==========================================================================
  // Pivot Operations
  // ==========================================================================

  const editPivot = useCallback(() => {
    if (pivotId) {
      startEditingPivot(pivotId);
      closeContextMenu();
    }
  }, [pivotId, startEditingPivot, closeContextMenu]);

  const refreshPivot = useCallback(() => {
    if (pivotId) {
      refreshPivotTable(pivotId);
      closeContextMenu();
    }
  }, [pivotId, refreshPivotTable, closeContextMenu]);

  const deletePivot = useCallback(() => {
    if (pivotId) {
      deletePivotTable(pivotId);
      closeContextMenu();
    }
  }, [pivotId, deletePivotTable, closeContextMenu]);

  // ==========================================================================
  // Expand/Collapse Operations
  // ==========================================================================

  const expandHeader = useCallback(() => {
    if (pivotId && headerKey) {
      // For now, we use row expansion (most common case)
      // The expand/collapse logic actually toggles, so we call it
      toggleRowExpanded(pivotId, headerKey);
      closeContextMenu();
    }
  }, [pivotId, headerKey, toggleRowExpanded, closeContextMenu]);

  const collapseHeader = useCallback(() => {
    if (pivotId && headerKey) {
      // Same as expand - it's a toggle
      toggleRowExpanded(pivotId, headerKey);
      closeContextMenu();
    }
  }, [pivotId, headerKey, toggleRowExpanded, closeContextMenu]);

  const expandAll = useCallback(() => {
    if (pivotId) {
      setAllExpanded(pivotId, true);
      closeContextMenu();
    }
  }, [pivotId, setAllExpanded, closeContextMenu]);

  const collapseAll = useCallback(() => {
    if (pivotId) {
      setAllExpanded(pivotId, false);
      closeContextMenu();
    }
  }, [pivotId, setAllExpanded, closeContextMenu]);

  // ==========================================================================
  // Sort Operations
  // ==========================================================================

  const sortAscending = useCallback(() => {
    if (pivotId && fieldId) {
      setSortOrder(pivotId, fieldId, 'asc');
      closeContextMenu();
    }
  }, [pivotId, fieldId, setSortOrder, closeContextMenu]);

  const sortDescending = useCallback(() => {
    if (pivotId && fieldId) {
      setSortOrder(pivotId, fieldId, 'desc');
      closeContextMenu();
    }
  }, [pivotId, fieldId, setSortOrder, closeContextMenu]);

  const clearSort = useCallback(() => {
    if (pivotId && fieldId) {
      setSortOrder(pivotId, fieldId, 'none');
      closeContextMenu();
    }
  }, [pivotId, fieldId, setSortOrder, closeContextMenu]);

  // ==========================================================================
  // Aggregate Operations
  // ==========================================================================

  const setAggregateFunction = useCallback(
    (aggregateFunction: AggregateFunction) => {
      if (pivotId && effectiveValueFieldId) {
        setAggregate(pivotId, effectiveValueFieldId, aggregateFunction);
        closeContextMenu();
      }
    },
    [pivotId, effectiveValueFieldId, setAggregate, closeContextMenu],
  );

  // ==========================================================================
  // Show Values As Operations
  // ==========================================================================

  const currentShowValuesAs: ShowValuesAsType | undefined = useMemo(() => {
    if (!pivotConfig || !effectiveValueFieldId) return undefined;
    const placement = pivotConfig.placements.find(
      (p) => p.fieldId === effectiveValueFieldId && p.area === 'value',
    );
    return placement?.showValuesAs?.type;
  }, [pivotConfig, effectiveValueFieldId]);

  const setShowValuesAs = useCallback(
    (calculationType: ShowValuesAsType) => {
      if (pivotConfig && effectiveValueFieldId) {
        const showValuesAs: ShowValuesAsConfig | null =
          calculationType === 'noCalculation' ? null : { type: calculationType };
        dispatchAction('PIVOT_SET_SHOW_VALUES_AS', {
          sheetId: activeSheetId,
          pivotName: pivotConfig.name,
          fieldId: effectiveValueFieldId,
          showValuesAs,
        });
        closeContextMenu();
      }
    },
    [activeSheetId, pivotConfig, effectiveValueFieldId, dispatchAction, closeContextMenu],
  );

  // ==========================================================================
  // Grand Total Operations
  // ==========================================================================

  const showRowGrandTotals = pivotConfig?.layout?.showRowGrandTotals ?? true;
  const showColumnGrandTotals = pivotConfig?.layout?.showColumnGrandTotals ?? true;

  const setGrandTotals = useCallback(
    (layout: Pick<PivotTableLayout, 'showRowGrandTotals' | 'showColumnGrandTotals'>) => {
      if (pivotConfig) {
        dispatchAction('PIVOT_SET_GRAND_TOTALS', {
          sheetId: activeSheetId,
          pivotName: pivotConfig.name,
          showRowGrandTotals: layout.showRowGrandTotals,
          showColumnGrandTotals: layout.showColumnGrandTotals,
        });
        closeContextMenu();
      }
    },
    [activeSheetId, pivotConfig, dispatchAction, closeContextMenu],
  );

  // ==========================================================================
  // Page Filter Operations
  // ==========================================================================

  const pivotFilterFields: PivotFilterFieldOption[] = useMemo(() => {
    if (!pivotConfig) return [];
    return pivotItems
      .filter((fieldItems) => fieldItems.area === 'filter')
      .map((fieldItems) => ({
        ...fieldItems,
        currentFilter: pivotConfig.filters.find((filter) => filter.fieldId === fieldItems.fieldId),
      }));
  }, [pivotConfig, pivotItems]);

  const setPivotFilter = useCallback(
    (targetFieldId: string, filter: Omit<PivotFilter, 'fieldId'>) => {
      if (!pivotConfig) return;
      dispatchAction('PIVOT_SET_FILTER', {
        sheetId: activeSheetId,
        pivotName: pivotConfig.name,
        fieldId: targetFieldId,
        filter,
      });
      closeContextMenu();
    },
    [activeSheetId, pivotConfig, dispatchAction, closeContextMenu],
  );

  // ==========================================================================
  // Group/Ungroup Operations
  // ==========================================================================

  const canGroup = false;
  const canUngroup = false;

  const groupItems = useCallback(() => {
    closeContextMenu();
  }, [closeContextMenu]);

  const ungroupItems = useCallback(() => {
    closeContextMenu();
  }, [closeContextMenu]);

  // ==========================================================================
  // Field Operations
  // ==========================================================================

  const removeField = useCallback(() => {
    if (pivotId && fieldId && fieldArea) {
      removeFieldFromArea(pivotId, fieldId, fieldArea);
      closeContextMenu();
    }
  }, [pivotId, fieldId, fieldArea, removeFieldFromArea, closeContextMenu]);

  // ==========================================================================
  // Return
  // ==========================================================================

  return useMemo(
    () => ({
      // Pivot operations
      editPivot,
      refreshPivot,
      deletePivot,

      // Expand/Collapse
      expandHeader,
      collapseHeader,
      expandAll,
      collapseAll,
      isHeaderExpanded,

      // Sort
      sortAscending,
      sortDescending,
      clearSort,
      currentSortOrder,

      // Aggregate
      setAggregateFunction,
      currentAggregateFunction,

      // Show Values As
      setShowValuesAs,
      currentShowValuesAs,

      // Grand totals
      setGrandTotals,
      showRowGrandTotals,
      showColumnGrandTotals,
      pivotFilterFields,
      setPivotFilter,

      // Group/Ungroup
      groupItems,
      ungroupItems,
      canGroup,
      canUngroup,

      // Field
      removeField,

      // State
      hasPivotContext,
      hasHeaderContext,
      hasFieldContext,
      pivotConfig,
    }),
    [
      editPivot,
      refreshPivot,
      deletePivot,
      expandHeader,
      collapseHeader,
      expandAll,
      collapseAll,
      isHeaderExpanded,
      sortAscending,
      sortDescending,
      clearSort,
      currentSortOrder,
      setAggregateFunction,
      currentAggregateFunction,
      setShowValuesAs,
      currentShowValuesAs,
      setGrandTotals,
      showRowGrandTotals,
      showColumnGrandTotals,
      pivotFilterFields,
      setPivotFilter,
      groupItems,
      ungroupItems,
      canGroup,
      canUngroup,
      removeField,
      hasPivotContext,
      hasHeaderContext,
      hasFieldContext,
      pivotConfig,
    ],
  );
}
