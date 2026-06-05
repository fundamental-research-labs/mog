/**
 * Pivot Editor Actions Hook
 *
 * Handles all pivot table editor-related operations for the spreadsheet.
 * Extracted from Spreadsheet.tsx to improve maintainability and testability.
 *
 * Features:
 * - Add/remove/move fields between areas
 * - Change aggregate functions
 * - Refresh pivot table data
 * - Delete pivot table
 * - Create new pivot table (for dialog)
 */

import { useCallback, useMemo } from 'react';

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type {
  AggregateFunction,
  PivotField,
  PivotFieldArea,
  PivotFieldPlacementFlat,
  PivotTableConfig,
  SortOrder,
} from '@mog-sdk/contracts/pivot';

import { useActiveSheetId } from '../../infra/context';
import type { PivotViewModel } from '../../pivot/pivot-capabilities';

import type { PivotOutputLocation } from './use-pivot-tables';
import { usePivotTables } from './use-pivot-tables';

// =============================================================================
// Types
// =============================================================================

export interface UsePivotEditorActionsOptions {
  /** Override active sheet ID (defaults to store's active sheet) */
  sheetId?: SheetId;
}

export interface UsePivotEditorActionsReturn {
  // Pivot state
  pivotTables: PivotViewModel[];
  editingPivotId: string | null;
  editingPivot: PivotViewModel | null;

  // Field panel handlers
  handlePivotAddField: (
    fieldId: string,
    area: PivotFieldArea,
    options?: { position?: number; aggregateFunction?: AggregateFunction },
  ) => void;
  handlePivotRemoveField: (fieldId: string, area: PivotFieldArea) => void;
  handlePivotMoveField: (
    fieldId: string,
    fromArea: PivotFieldArea,
    toArea: PivotFieldArea,
    position: number,
  ) => void;
  handlePivotAggregateChange: (fieldId: string, aggregate: AggregateFunction) => void;
  handlePivotAddPlacement: (
    fieldId: string,
    area: PivotFieldArea,
    position: number,
    options?: { aggregateFunction?: AggregateFunction },
  ) => void;
  handlePivotRemovePlacement: (placementId: string) => void;
  handlePivotMovePlacement: (placementId: string, toArea: PivotFieldArea, position: number) => void;
  handlePivotPlacementAggregateChange: (
    placementId: string,
    aggregate: AggregateFunction,
  ) => void;
  handlePivotPlacementSortOrderChange: (
    placementId: string,
    sortOrder: SortOrder,
  ) => void;
  handlePivotValueSortChange: (valuePlacementId: string, sortOrder: SortOrder) => void;
  handlePivotRefresh: () => void;
  handlePivotDelete: () => void;

  // Dialog/creation actions
  /**
   * Create a new pivot table with location selection support.
   *
   * @param name - Pivot table name
   * @param sourceRange - Source data range
   * @param sourceSheetId - Sheet containing the source data (defaults to active sheet)
   * @param outputLocation - Where to place the pivot table (defaults to new worksheet)
   * @returns Object containing the created pivot config and the output sheet ID
   */
  createPivotTable: (
    name: string,
    sourceRange: CellRange,
    sourceSheetId?: SheetId,
    outputLocation?: PivotOutputLocation,
  ) => Promise<{ config: PivotTableConfig; outputSheetId: SheetId }>;
  detectFields: (sourceRange: CellRange, sourceSheetId?: SheetId) => Promise<PivotField[]>;
  startEditingPivot: (pivotId: string) => void;
  stopEditingPivot: () => void;
}

function getPlacementId(placement: PivotFieldPlacementFlat): string {
  return String(placement.placementId);
}

function orderedPlacements(
  config: PivotTableConfig,
  area: PivotFieldArea,
): PivotFieldPlacementFlat[] {
  return config.placements
    .filter((placement) => placement.area === area)
    .sort((left, right) => left.position - right.position);
}

export function getDefaultValueSortAxisPlacement(
  config: PivotTableConfig,
): PivotFieldPlacementFlat | null {
  return orderedPlacements(config, 'row')[0] ?? orderedPlacements(config, 'column')[0] ?? null;
}

export function axisSortTargetsValuePlacement(
  axisPlacement: PivotFieldPlacementFlat | null | undefined,
  valuePlacementId: string,
  valueFieldId?: string,
): boolean {
  if (!axisPlacement?.sortByValue) return false;
  return (
    axisPlacement.sortByValue.valuePlacementId === valuePlacementId ||
    axisPlacement.sortByValue.valueFieldId === valuePlacementId ||
    (valueFieldId !== undefined && axisPlacement.sortByValue.valueFieldId === valueFieldId)
  );
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function usePivotEditorActions(
  options: UsePivotEditorActionsOptions = {},
): UsePivotEditorActionsReturn {
  const storeActiveSheetId = useActiveSheetId();

  // Allow override for testing or custom use cases
  const activeSheetId = options.sheetId ?? storeActiveSheetId;

  // Use the pivot tables hook for underlying operations
  const {
    pivotTables,
    editingPivotId,
    createPivotTable,
    detectFields,
    deletePivotTable,
    addPlacement,
    removeFieldFromArea,
    removePlacement,
    moveField,
    movePlacement,
    setAggregateFunction,
    setPlacementAggregateFunction,
    setPlacementSortOrder,
    setSortByValue,
    refreshPivotTable,
    startEditingPivot,
    stopEditingPivot,
  } = usePivotTables({ sheetId: activeSheetId });

  // ==========================================================================
  // Computed Values
  // ==========================================================================

  /**
   * Get the pivot table currently being edited.
   */
  const editingPivot = useMemo(
    () => pivotTables.find((p) => p.config.id === editingPivotId) ?? null,
    [pivotTables, editingPivotId],
  );
  const editingPivotCapabilities = editingPivot?.capabilities;

  // ==========================================================================
  // Field Panel Handlers
  // ==========================================================================

  /**
   * Add a field to a pivot area (rows, columns, values, filters).
   */
  const handlePivotAddField = useCallback(
    (
      fieldId: string,
      area: PivotFieldArea,
      options?: { position?: number; aggregateFunction?: AggregateFunction },
    ) => {
      if (editingPivotId && editingPivotCapabilities?.canEditFields) {
        addPlacement(editingPivotId, {
          fieldId,
          area,
          position: options?.position,
          aggregateFunction: options?.aggregateFunction,
        });
      }
    },
    [editingPivotId, editingPivotCapabilities, addPlacement],
  );

  /**
   * Remove a field from a pivot area.
   */
  const handlePivotRemoveField = useCallback(
    (fieldId: string, area: PivotFieldArea) => {
      if (editingPivotId && editingPivotCapabilities?.canRemoveFields) {
        removeFieldFromArea(editingPivotId, fieldId, area);
      }
    },
    [editingPivotId, editingPivotCapabilities, removeFieldFromArea],
  );

  /**
   * Move a field between pivot areas or reorder within an area.
   */
  const handlePivotMoveField = useCallback(
    (fieldId: string, fromArea: PivotFieldArea, toArea: PivotFieldArea, position: number) => {
      if (editingPivotId && editingPivotCapabilities?.canReorderFields) {
        moveField(editingPivotId, fieldId, fromArea, toArea, position);
      }
    },
    [editingPivotId, editingPivotCapabilities, moveField],
  );

  /**
   * Change the aggregate function for a value field.
   */
  const handlePivotAggregateChange = useCallback(
    (fieldId: string, aggregate: AggregateFunction) => {
      if (editingPivotId && editingPivotCapabilities?.canChangeAggregate) {
        setAggregateFunction(editingPivotId, fieldId, aggregate);
      }
    },
    [editingPivotId, editingPivotCapabilities, setAggregateFunction],
  );

  const handlePivotAddPlacement = useCallback(
    (
      fieldId: string,
      area: PivotFieldArea,
      position: number,
      options?: { aggregateFunction?: AggregateFunction },
    ) => {
      if (!editingPivotId || !editingPivotCapabilities?.canEditFields) return;
      const spec: Parameters<typeof addPlacement>[1] = {
        fieldId,
        area,
        position,
      };
      if (options?.aggregateFunction) {
        spec.aggregateFunction = options.aggregateFunction;
      }
      addPlacement(editingPivotId, spec);
    },
    [addPlacement, editingPivotCapabilities, editingPivotId],
  );

  const handlePivotRemovePlacement = useCallback(
    (placementId: string) => {
      const canRemove =
        (editingPivotCapabilities?.canRemove ?? editingPivotCapabilities?.canRemoveFields) === true;
      if (editingPivotId && canRemove) {
        removePlacement(editingPivotId, placementId);
      }
    },
    [editingPivotId, editingPivotCapabilities, removePlacement],
  );

  const handlePivotMovePlacement = useCallback(
    (placementId: string, toArea: PivotFieldArea, position: number) => {
      const canMove =
        (editingPivotCapabilities?.canMove ?? editingPivotCapabilities?.canReorderFields) === true;
      if (editingPivotId && canMove) {
        movePlacement(editingPivotId, placementId, toArea, position);
      }
    },
    [editingPivotId, editingPivotCapabilities, movePlacement],
  );

  const handlePivotPlacementAggregateChange = useCallback(
    (placementId: string, aggregate: AggregateFunction) => {
      if (editingPivotId && editingPivotCapabilities?.canChangeAggregate) {
        setPlacementAggregateFunction(editingPivotId, placementId, aggregate);
      }
    },
    [editingPivotId, editingPivotCapabilities, setPlacementAggregateFunction],
  );

  const handlePivotPlacementSortOrderChange = useCallback(
    (placementId: string, sortOrder: SortOrder) => {
      if (editingPivotId && editingPivotCapabilities?.canSortLabels) {
        setPlacementSortOrder(editingPivotId, placementId, sortOrder);
      }
    },
    [editingPivotId, editingPivotCapabilities, setPlacementSortOrder],
  );

  const handlePivotValueSortChange = useCallback(
    (valuePlacementId: string, sortOrder: SortOrder) => {
      if (!editingPivotId || !editingPivot || !editingPivotCapabilities?.canSortByValue) return;
      const axisPlacement = getDefaultValueSortAxisPlacement(editingPivot.config);
      if (!axisPlacement) return;
      const valuePlacement = editingPivot.config.placements.find(
        (placement) => String(placement.placementId) === valuePlacementId,
      );
      const axisPlacementId = getPlacementId(axisPlacement);
      const config: { order: Exclude<SortOrder, 'none'> } | null =
        sortOrder === 'none'
          ? null
          : {
              order: sortOrder,
            };
      if (
        config === null &&
        !axisSortTargetsValuePlacement(axisPlacement, valuePlacementId, valuePlacement?.fieldId)
      ) {
        return;
      }
      setSortByValue(editingPivotId, axisPlacementId, valuePlacementId, config);
    },
    [editingPivot, editingPivotCapabilities, editingPivotId, setSortByValue],
  );

  /**
   * Refresh the pivot table data from source.
   */
  const handlePivotRefresh = useCallback(() => {
    if (editingPivotId && editingPivotCapabilities?.canRefresh) {
      refreshPivotTable(editingPivotId);
    }
  }, [editingPivotId, editingPivotCapabilities, refreshPivotTable]);

  /**
   * Delete the currently editing pivot table and close the editor.
   */
  const handlePivotDelete = useCallback(() => {
    if (editingPivotId && editingPivotCapabilities?.canDelete) {
      deletePivotTable(editingPivotId);
      stopEditingPivot();
    }
  }, [editingPivotId, editingPivotCapabilities, deletePivotTable, stopEditingPivot]);

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    // Pivot state
    pivotTables,
    editingPivotId,
    editingPivot,

    // Field panel handlers
    handlePivotAddField,
    handlePivotRemoveField,
    handlePivotMoveField,
    handlePivotAggregateChange,
    handlePivotAddPlacement,
    handlePivotRemovePlacement,
    handlePivotMovePlacement,
    handlePivotPlacementAggregateChange,
    handlePivotPlacementSortOrderChange,
    handlePivotValueSortChange,
    handlePivotRefresh,
    handlePivotDelete,

    // Dialog/creation actions
    createPivotTable,
    detectFields,
    startEditingPivot,
    stopEditingPivot,
  };
}
