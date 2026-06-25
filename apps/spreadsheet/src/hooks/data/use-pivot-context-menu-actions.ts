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

import type { PivotHandleMutationReceipt, PivotRefreshReceipt } from '@mog-sdk/contracts/api';
import type {
  AggregateFunction,
  CalculatedField,
  PlacementId,
  PivotFieldPlacementFlat,
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

function pivotRefreshReceiptMessage(receipt: PivotRefreshReceipt): string {
  return (
    receipt.diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
    receipt.diagnostics[0]?.message ??
    `Pivot refresh did not apply: ${receipt.status}.`
  );
}

function warnPivotRefresh(receipt: PivotRefreshReceipt | null | undefined): void {
  if (!receipt || receipt.status === 'applied') return;
  console.warn(pivotRefreshReceiptMessage(receipt), receipt);
}

function warnPivotMutation(operation: string, receipt: PivotHandleMutationReceipt): boolean {
  if (receipt.status === 'applied') return false;
  console.warn(
    receipt.diagnostics?.[0]?.message ??
      receipt.kernelReceipt?.error?.message ??
      `Pivot ${operation} did not apply: ${receipt.status}.`,
    receipt,
  );
  return true;
}

function warnPivotOperationError(operation: string, error: unknown): void {
  console.warn(
    `Pivot ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
    error,
  );
}

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
  /** The placement ID if right-clicked on a specific field placement */
  placementId?: PlacementId;
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
  /** Whether we have a row/column placement context for label sorting */
  hasSortContext: boolean;
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
  const { pivotId, headerKey, fieldId, placementId } = options;

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
    setPlacementSortOrder,
    setAggregateFunction: setAggregate,
    setShowValuesAs: setPivotShowValuesAs,
    setLayout,
    setFilter,
    removeFieldFromArea,
    removePlacement,
  } = usePivotTables({ sheetId: activeSheetId });

  // ==========================================================================
  // Computed Values
  // ==========================================================================

  const hasPivotContext = !!pivotId;
  const hasHeaderContext = !!pivotId && !!headerKey;
  const hasFieldContext = !!pivotId && (!!fieldId || !!placementId);

  // Get the current pivot table config
  const pivot = useMemo(() => {
    if (!pivotId) return null;
    return (
      pivotTables.find(
        (p) => p.config.id === pivotId || p.alternateIds?.includes(pivotId) === true,
      ) ?? null
    );
  }, [pivotId, pivotTables]);
  const pivotConfig = pivot?.config ?? null;
  const pivotCapabilities = pivot?.capabilities ?? null;
  const canEditFields = pivotCapabilities?.canEditFields ?? false;
  const canRemoveFields = pivotCapabilities?.canRemoveFields ?? false;
  const canChangeAggregate = pivotCapabilities?.canChangeAggregate ?? false;
  const canRefresh = pivotCapabilities?.canRefresh ?? false;
  const canDelete = pivotCapabilities?.canDelete ?? false;
  const canSortLabels = pivotCapabilities?.canSortLabels ?? false;

  const targetPlacement = useMemo<PivotFieldPlacementFlat | undefined>(() => {
    if (!pivotConfig) return undefined;
    if (placementId) {
      const placement = pivotConfig.placements.find(
        (candidate) => candidate.placementId === placementId,
      );
      if (placement) return placement;
    }
    if (!fieldId) return undefined;
    return pivotConfig.placements.find((placement) => placement.fieldId === fieldId);
  }, [fieldId, pivotConfig, placementId]);

  const effectiveFieldId = fieldId ?? targetPlacement?.fieldId;
  const sortPlacement = useMemo(
    () =>
      targetPlacement?.area === 'row' || targetPlacement?.area === 'column'
        ? targetPlacement
        : undefined,
    [targetPlacement],
  );
  const hasSortContext = !!pivotId && !!sortPlacement;

  const effectiveValuePlacement = useMemo<PivotFieldPlacementFlat | undefined>(() => {
    if (!pivotConfig) return undefined;
    if (targetPlacement?.area === 'value') return targetPlacement;
    if (fieldId) {
      const valuePlacementForField = pivotConfig.placements.find(
        (placement) => placement.area === 'value' && placement.fieldId === fieldId,
      );
      if (valuePlacementForField) return valuePlacementForField;
    }
    return pivotConfig.placements.find((placement) => placement.area === 'value');
  }, [fieldId, pivotConfig, targetPlacement]);
  const effectiveValueTargetId = effectiveValuePlacement?.placementId;

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
    if (!pivotConfig || !sortPlacement) return undefined;
    return sortPlacement.sortOrder;
  }, [pivotConfig, sortPlacement]);

  // Get current aggregate function for the field
  const currentAggregateFunction = useMemo(() => {
    return effectiveValuePlacement?.aggregateFunction;
  }, [effectiveValuePlacement]);

  // Get the area for the current field
  const fieldArea = useMemo(() => {
    if (targetPlacement) return targetPlacement.area;
    if (!pivotConfig || !effectiveFieldId) return undefined;
    const placement = pivotConfig.placements.find((p) => p.fieldId === effectiveFieldId);
    return placement?.area;
  }, [pivotConfig, effectiveFieldId, targetPlacement]);

  // ==========================================================================
  // Pivot Operations
  // ==========================================================================

  const editPivot = useCallback(() => {
    if (pivotConfig) {
      startEditingPivot(pivotConfig.id);
      closeContextMenu();
    }
  }, [pivotConfig, startEditingPivot, closeContextMenu]);

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
      const handle = pivot?.handle;
      if (!handle || !canEditFields) return;
      void handle
        .setDataSource(dataSource)
        .then((receipt) => {
          warnPivotMutation('set data source', receipt);
        })
        .catch((error) => warnPivotOperationError('set data source', error));
      closeContextMenu();
    },
    [pivot, canEditFields, closeContextMenu],
  );

  const addCalculatedField = useCallback(
    (field: CalculatedField) => {
      const handle = pivot?.handle;
      if (!handle || !canEditFields) return;
      void handle
        .addCalculatedField(field)
        .then(async (receipt) => {
          if (warnPivotMutation('add calculated field', receipt)) return;
          warnPivotRefresh(await handle.refresh());
        })
        .catch((error) => warnPivotOperationError('add calculated field', error));
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
    if (pivotId && sortPlacement && canSortLabels) {
      setPlacementSortOrder(pivotId, sortPlacement.placementId, 'asc');
      closeContextMenu();
      return;
    }
    if (pivotId && effectiveFieldId && !placementId && !targetPlacement && canSortLabels) {
      setSortOrder(pivotId, effectiveFieldId, 'asc');
      closeContextMenu();
    }
  }, [
    pivotId,
    sortPlacement,
    canSortLabels,
    setPlacementSortOrder,
    closeContextMenu,
    effectiveFieldId,
    placementId,
    targetPlacement,
    setSortOrder,
  ]);

  const sortDescending = useCallback(() => {
    if (pivotId && sortPlacement && canSortLabels) {
      setPlacementSortOrder(pivotId, sortPlacement.placementId, 'desc');
      closeContextMenu();
      return;
    }
    if (pivotId && effectiveFieldId && !placementId && !targetPlacement && canSortLabels) {
      setSortOrder(pivotId, effectiveFieldId, 'desc');
      closeContextMenu();
    }
  }, [
    pivotId,
    sortPlacement,
    canSortLabels,
    setPlacementSortOrder,
    closeContextMenu,
    effectiveFieldId,
    placementId,
    targetPlacement,
    setSortOrder,
  ]);

  const clearSort = useCallback(() => {
    if (pivotId && sortPlacement && canSortLabels) {
      setPlacementSortOrder(pivotId, sortPlacement.placementId, null);
      closeContextMenu();
      return;
    }
    if (pivotId && effectiveFieldId && !placementId && !targetPlacement && canSortLabels) {
      setSortOrder(pivotId, effectiveFieldId, 'none');
      closeContextMenu();
    }
  }, [
    pivotId,
    sortPlacement,
    canSortLabels,
    setPlacementSortOrder,
    closeContextMenu,
    effectiveFieldId,
    placementId,
    targetPlacement,
    setSortOrder,
  ]);

  // ==========================================================================
  // Aggregate Operations
  // ==========================================================================

  const setAggregateFunction = useCallback(
    (aggregateFunction: AggregateFunction) => {
      if (pivotId && effectiveValueTargetId && canChangeAggregate) {
        setAggregate(pivotId, effectiveValueTargetId, aggregateFunction);
        closeContextMenu();
      }
    },
    [pivotId, effectiveValueTargetId, canChangeAggregate, setAggregate, closeContextMenu],
  );

  // ==========================================================================
  // Show Values As Operations
  // ==========================================================================

  const currentShowValuesAs: ShowValuesAsType | undefined = useMemo(() => {
    return effectiveValuePlacement?.showValuesAs?.type;
  }, [effectiveValuePlacement]);

  const setShowValuesAs = useCallback(
    (calculationType: ShowValuesAsType) => {
      if (pivotId && effectiveValueTargetId && canChangeAggregate) {
        const showValuesAs: ShowValuesAsConfig | null =
          calculationType === 'noCalculation' ? null : { type: calculationType };
        setPivotShowValuesAs(pivotId, effectiveValueTargetId, showValuesAs);
        closeContextMenu();
      }
    },
    [pivotId, effectiveValueTargetId, canChangeAggregate, setPivotShowValuesAs, closeContextMenu],
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
    if (pivotId && targetPlacement && canRemoveFields) {
      removePlacement(pivotId, targetPlacement.placementId);
      closeContextMenu();
      return;
    }
    if (pivotId && effectiveFieldId && fieldArea && canRemoveFields) {
      removeFieldFromArea(pivotId, effectiveFieldId, fieldArea);
      closeContextMenu();
    }
  }, [
    pivotId,
    targetPlacement,
    canRemoveFields,
    removePlacement,
    closeContextMenu,
    effectiveFieldId,
    fieldArea,
    removeFieldFromArea,
  ]);

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
      hasSortContext,
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
      hasSortContext,
      pivotConfig,
      pivotCapabilities,
    ],
  );
}
