/**
 * Pivot Context Menu Actions Hook
 *
 * Provides action handlers for the pivot table context menu.
 * Routes actions through appropriate channels:
 * - Pivot operations: PivotTableHandle methods from the worksheet API
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
  CalculatedField,
  PivotFieldItems,
  PivotFilter,
  PivotTableLayout,
  ShowValuesAs,
  ShowValuesAsConfig,
  SortOrder,
} from '@mog-sdk/contracts/pivot';

import { useActiveSheetId, useUIStore } from '../../infra/context';
import type { PivotCapabilities } from '../../pivot/pivot-capabilities';

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
  /** Change the pivot data source through the selected pivot handle. */
  setDataSource: (dataSource: string) => void;
  /** Add a calculated field through the selected pivot handle. */
  addCalculatedField: (field: CalculatedField) => void;

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
  /** Operation capabilities for the current pivot table. */
  pivotCapabilities: PivotCapabilities | null;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function usePivotContextMenuActions(
  options: UsePivotContextMenuActionsOptions = {},
): UsePivotContextMenuActionsReturn {
  const { pivotId, headerKey, fieldId } = options;

  const activeSheetId = useActiveSheetId();
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
    setShowValuesAs: setPivotShowValuesAs,
    setLayout,
    setFilter,
    removeFieldFromArea,
  } = usePivotTables({ sheetId: activeSheetId });

  // ==========================================================================
  // Computed Values
  // ==========================================================================

  const hasPivotContext = !!pivotId;
  const hasHeaderContext = !!pivotId && !!headerKey;
  const hasFieldContext = !!pivotId && !!fieldId;

  // Get the current pivot table config
  const pivot = useMemo(() => {
    if (!pivotId) return null;
    return pivotTables.find((p) => p.config.id === pivotId) ?? null;
  }, [pivotId, pivotTables]);
  const pivotConfig = pivot?.config ?? null;
  const pivotCapabilities = pivot?.capabilities ?? null;
  const canEditFields = pivotCapabilities?.canEditFields ?? false;
  const canRemoveFields = pivotCapabilities?.canRemoveFields ?? false;
  const canChangeAggregate = pivotCapabilities?.canChangeAggregate ?? false;
  const canRefresh = pivotCapabilities?.canRefresh ?? false;
  const canDelete = pivotCapabilities?.canDelete ?? false;

  const effectiveValueFieldId = useMemo(() => {
    if (fieldId) return fieldId;
    return pivotConfig?.placements.find((p) => p.area === 'value')?.fieldId;
  }, [fieldId, pivotConfig]);

  // Get expansion state for the header through the selected pivot handle.
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
  const [pivotItems, setPivotItems] = useState<PivotFieldItems[]>([]);
  useEffect(() => {
    if (!pivotConfig || !headerKey || !canEditFields) {
      setIsHeaderExpanded(false);
      return;
    }
    void pivot?.handle?.getExpansionState().then((expansionState) => {
      const expanded =
        expansionState.expandedRows[headerKey] ?? expansionState.expandedColumns[headerKey] ?? true;
      setIsHeaderExpanded(expanded);
    });
  }, [pivot, pivotConfig, headerKey, canEditFields]);

  useEffect(() => {
    let cancelled = false;
    if (!pivotConfig || !canEditFields) {
      setPivotItems([]);
      return;
    }

    void pivot?.handle
      ?.getAllItems()
      .then((items) => {
        if (!cancelled) setPivotItems(items);
      })
      .catch(() => {
        if (!cancelled) setPivotItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [pivot, pivotConfig, canEditFields]);

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
    if (pivotId && canRefresh) {
      refreshPivotTable(pivotId);
      closeContextMenu();
    }
  }, [pivotId, canRefresh, refreshPivotTable, closeContextMenu]);

  const deletePivot = useCallback(() => {
    if (pivotId && canDelete) {
      deletePivotTable(pivotId);
      closeContextMenu();
    }
  }, [pivotId, canDelete, deletePivotTable, closeContextMenu]);

  const setDataSource = useCallback(
    (dataSource: string) => {
      if (!pivot?.handle || !canEditFields) return;
      void pivot.handle.setDataSource(dataSource);
      closeContextMenu();
    },
    [pivot, canEditFields, closeContextMenu],
  );

  const addCalculatedField = useCallback(
    (field: CalculatedField) => {
      if (!pivot?.handle || !canEditFields) return;
      void pivot.handle.addCalculatedField(field).then(() => pivot.handle?.refresh());
      closeContextMenu();
    },
    [pivot, canEditFields, closeContextMenu],
  );

  // ==========================================================================
  // Expand/Collapse Operations
  // ==========================================================================

  const expandHeader = useCallback(() => {
    if (pivotId && headerKey && canEditFields) {
      // For now, we use row expansion (most common case)
      // The expand/collapse logic actually toggles, so we call it
      toggleRowExpanded(pivotId, headerKey);
      closeContextMenu();
    }
  }, [pivotId, headerKey, canEditFields, toggleRowExpanded, closeContextMenu]);

  const collapseHeader = useCallback(() => {
    if (pivotId && headerKey && canEditFields) {
      // Same as expand - it's a toggle
      toggleRowExpanded(pivotId, headerKey);
      closeContextMenu();
    }
  }, [pivotId, headerKey, canEditFields, toggleRowExpanded, closeContextMenu]);

  const expandAll = useCallback(() => {
    if (pivotId && canEditFields) {
      setAllExpanded(pivotId, true);
      closeContextMenu();
    }
  }, [pivotId, canEditFields, setAllExpanded, closeContextMenu]);

  const collapseAll = useCallback(() => {
    if (pivotId && canEditFields) {
      setAllExpanded(pivotId, false);
      closeContextMenu();
    }
  }, [pivotId, canEditFields, setAllExpanded, closeContextMenu]);

  // ==========================================================================
  // Sort Operations
  // ==========================================================================

  const sortAscending = useCallback(() => {
    if (pivotId && fieldId && canEditFields) {
      setSortOrder(pivotId, fieldId, 'asc');
      closeContextMenu();
    }
  }, [pivotId, fieldId, canEditFields, setSortOrder, closeContextMenu]);

  const sortDescending = useCallback(() => {
    if (pivotId && fieldId && canEditFields) {
      setSortOrder(pivotId, fieldId, 'desc');
      closeContextMenu();
    }
  }, [pivotId, fieldId, canEditFields, setSortOrder, closeContextMenu]);

  const clearSort = useCallback(() => {
    if (pivotId && fieldId && canEditFields) {
      setSortOrder(pivotId, fieldId, 'none');
      closeContextMenu();
    }
  }, [pivotId, fieldId, canEditFields, setSortOrder, closeContextMenu]);

  // ==========================================================================
  // Aggregate Operations
  // ==========================================================================

  const setAggregateFunction = useCallback(
    (aggregateFunction: AggregateFunction) => {
      if (pivotId && effectiveValueFieldId && canChangeAggregate) {
        setAggregate(pivotId, effectiveValueFieldId, aggregateFunction);
        closeContextMenu();
      }
    },
    [pivotId, effectiveValueFieldId, canChangeAggregate, setAggregate, closeContextMenu],
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
      if (pivotId && effectiveValueFieldId && canChangeAggregate) {
        const showValuesAs: ShowValuesAsConfig | null =
          calculationType === 'noCalculation' ? null : { type: calculationType };
        setPivotShowValuesAs(pivotId, effectiveValueFieldId, showValuesAs);
        closeContextMenu();
      }
    },
    [pivotId, effectiveValueFieldId, canChangeAggregate, setPivotShowValuesAs, closeContextMenu],
  );

  // ==========================================================================
  // Grand Total Operations
  // ==========================================================================

  const showRowGrandTotals = pivotConfig?.layout?.showRowGrandTotals ?? true;
  const showColumnGrandTotals = pivotConfig?.layout?.showColumnGrandTotals ?? true;

  const setGrandTotals = useCallback(
    (layout: Pick<PivotTableLayout, 'showRowGrandTotals' | 'showColumnGrandTotals'>) => {
      if (pivotId && canEditFields) {
        setLayout(pivotId, layout);
        closeContextMenu();
      }
    },
    [pivotId, canEditFields, setLayout, closeContextMenu],
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
      if (!pivotId || !canEditFields) return;
      setFilter(pivotId, targetFieldId, filter);
      closeContextMenu();
    },
    [pivotId, canEditFields, setFilter, closeContextMenu],
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
    if (pivotId && fieldId && fieldArea && canRemoveFields) {
      removeFieldFromArea(pivotId, fieldId, fieldArea);
      closeContextMenu();
    }
  }, [pivotId, fieldId, fieldArea, canRemoveFields, removeFieldFromArea, closeContextMenu]);

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
      setDataSource,
      addCalculatedField,

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
      pivotCapabilities,
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
      setDataSource,
      addCalculatedField,
      groupItems,
      ungroupItems,
      canGroup,
      canUngroup,
      removeField,
      hasPivotContext,
      hasHeaderContext,
      hasFieldContext,
      pivotConfig,
      pivotCapabilities,
    ],
  );
}
