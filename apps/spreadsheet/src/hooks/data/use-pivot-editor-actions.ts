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
  PivotTableConfig,
  PivotTableWithResult,
} from '@mog-sdk/contracts/pivot';

import { useActiveSheetId } from '../../infra/context';

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
  pivotTables: PivotTableWithResult[];
  editingPivotId: string | null;
  editingPivot: PivotTableWithResult | null;

  // Field panel handlers
  handlePivotAddField: (
    fieldId: string,
    area: PivotFieldArea,
    options?: { aggregateFunction?: AggregateFunction },
  ) => void;
  handlePivotRemoveField: (fieldId: string, area: PivotFieldArea) => void;
  handlePivotMoveField: (
    fieldId: string,
    fromArea: PivotFieldArea,
    toArea: PivotFieldArea,
    position: number,
  ) => void;
  handlePivotAggregateChange: (fieldId: string, aggregate: AggregateFunction) => void;
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
    addFieldToArea,
    removeFieldFromArea,
    moveField,
    setAggregateFunction,
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
  const editingPivotReadOnly = editingPivot?.config.id.startsWith('imported:') ?? false;

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
      options?: { aggregateFunction?: AggregateFunction },
    ) => {
      if (editingPivotId && !editingPivotReadOnly) {
        addFieldToArea(editingPivotId, fieldId, area, options);
      }
    },
    [editingPivotId, editingPivotReadOnly, addFieldToArea],
  );

  /**
   * Remove a field from a pivot area.
   */
  const handlePivotRemoveField = useCallback(
    (fieldId: string, area: PivotFieldArea) => {
      if (editingPivotId && !editingPivotReadOnly) {
        removeFieldFromArea(editingPivotId, fieldId, area);
      }
    },
    [editingPivotId, editingPivotReadOnly, removeFieldFromArea],
  );

  /**
   * Move a field between pivot areas or reorder within an area.
   */
  const handlePivotMoveField = useCallback(
    (fieldId: string, fromArea: PivotFieldArea, toArea: PivotFieldArea, position: number) => {
      if (editingPivotId && !editingPivotReadOnly) {
        moveField(editingPivotId, fieldId, fromArea, toArea, position);
      }
    },
    [editingPivotId, editingPivotReadOnly, moveField],
  );

  /**
   * Change the aggregate function for a value field.
   */
  const handlePivotAggregateChange = useCallback(
    (fieldId: string, aggregate: AggregateFunction) => {
      if (editingPivotId && !editingPivotReadOnly) {
        setAggregateFunction(editingPivotId, fieldId, aggregate);
      }
    },
    [editingPivotId, editingPivotReadOnly, setAggregateFunction],
  );

  /**
   * Refresh the pivot table data from source.
   */
  const handlePivotRefresh = useCallback(() => {
    if (editingPivotId && !editingPivotReadOnly) {
      refreshPivotTable(editingPivotId);
    }
  }, [editingPivotId, editingPivotReadOnly, refreshPivotTable]);

  /**
   * Delete the currently editing pivot table and close the editor.
   */
  const handlePivotDelete = useCallback(() => {
    if (editingPivotId && !editingPivotReadOnly) {
      deletePivotTable(editingPivotId);
      stopEditingPivot();
    }
  }, [editingPivotId, editingPivotReadOnly, deletePivotTable, stopEditingPivot]);

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
    handlePivotRefresh,
    handlePivotDelete,

    // Dialog/creation actions
    createPivotTable,
    detectFields,
    startEditingPivot,
    stopEditingPivot,
  };
}
