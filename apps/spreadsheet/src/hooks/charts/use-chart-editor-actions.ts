/**
 * Chart Editor Actions Hook
 *
 * Handles all chart editor-related operations for the spreadsheet.
 * Extracted from Spreadsheet.tsx to improve maintainability and testability.
 *
 * Features:
 * - Insert new chart from selection
 * - Update chart configuration
 * - Delete chart
 * - Close chart editor
 */

import { useCallback, useMemo } from 'react';

import type { ChartType } from '@mog/charts';

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { ChartAxisRole } from '@mog-sdk/contracts/data/chart-app-model';
import { cellRangeToA1 } from '@mog/spreadsheet-utils/a1';
import type { StoredChartConfigUpdateDraft } from '../../adapters/charts/chart-config-adapter';
import { useActiveSheetId } from '../../infra/context';
import { useSelectionRanges } from '../selection/use-granular-selection';
import { useCoordinator } from '../shared/use-coordinator';

import { useCharts, type ChartDefinition } from './use-charts';

// =============================================================================
// Types
// =============================================================================

export interface UseChartEditorActionsOptions {
  /** Override active sheet ID (defaults to store's active sheet) */
  sheetId?: SheetId;
  /** Override selection (defaults to store's XState selection) */
  selection?: { ranges: CellRange[] };
}

export interface UseChartEditorActionsReturn {
  // Chart state
  charts: ChartDefinition[];
  editingChartId: string | null;
  editingChart: ChartDefinition | undefined;

  // Actions
  handleInsertChart: (
    type: ChartType,
    subType?: string,
    config?: StoredChartConfigUpdateDraft,
  ) => void;
  handleChartEditorChange: (updates: StoredChartConfigUpdateDraft) => void;
  handleChartLegendVisibleChange: (visible: boolean) => void;
  handleChartAxisTitleChange: (axisRole: ChartAxisRole, title: string) => void;
  handleChartEditorClose: () => void;
  handleChartEditorDelete: () => void;

  // Derived state for UI
  chartDisabled: boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useChartEditorActions(
  options: UseChartEditorActionsOptions = {},
): UseChartEditorActionsReturn {
  const storeActiveSheetId = useActiveSheetId();
  // Performance optimization: Only subscribe to ranges, not full selection state
  const storeRanges = useSelectionRanges();
  const coordinator = useCoordinator();

  // Allow overrides for testing or custom use cases
  const activeSheetId = options.sheetId ?? storeActiveSheetId;
  const ranges = options.selection?.ranges ?? storeRanges;

  // ==========================================================================
  // ON-DEMAND SELECTION READ (for actions)
  // Point-in-time read - does NOT cause re-renders when selection changes
  // @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
  // ==========================================================================
  const getRangesOnDemand = useCallback(() => {
    const snapshot = coordinator.grid.getSelectionSnapshot();
    return snapshot.ranges;
  }, [coordinator]);

  // Use the charts hook for underlying chart operations
  const {
    charts,
    editingChartId,
    createChartFromSelection,
    updateChart,
    setLegendVisible,
    setAxisTitle,
    removeChart,
    stopEditingChart,
  } = useCharts({ sheetId: activeSheetId });

  // ==========================================================================
  // Computed Values
  // ==========================================================================

  /**
   * Get the chart currently being edited.
   */
  const editingChart = useMemo(
    () => charts.find((c) => c.id === editingChartId),
    [charts, editingChartId],
  );

  /**
   * Whether chart insertion is disabled (no selection).
   */
  const chartDisabled = ranges.length === 0;

  // ==========================================================================
  // Handlers
  // ==========================================================================

  /**
   * Insert a new chart using the current selection as data range.
   * Supports optional subType (clustered, stacked, etc.) and config overrides.
   *
   */
  const handleInsertChart = useCallback(
    (type: ChartType, subType?: string, config?: StoredChartConfigUpdateDraft) => {
      const currentRanges = getRangesOnDemand();
      console.log('[ChartEditorActions] handleInsertChart', {
        type,
        subType,
        config,
        rangesCount: currentRanges.length,
        ranges: currentRanges,
      });

      if (currentRanges.length > 0) {
        const range = currentRanges[0];
        const dataRange = cellRangeToA1(range);
        console.log('[ChartEditorActions] creating chart with dataRange:', dataRange);
        const chartId = createChartFromSelection(type, dataRange, subType, config);
        console.log('[ChartEditorActions] chart created with id:', chartId);
      } else {
        console.log('[ChartEditorActions] no ranges selected, skipping chart creation');
      }
    },
    [getRangesOnDemand, createChartFromSelection],
  );

  /**
   * Update the currently editing chart's configuration.
   */
  const handleChartEditorChange = useCallback(
    (updates: StoredChartConfigUpdateDraft) => {
      if (editingChartId) {
        updateChart(editingChartId, updates);
      }
    },
    [editingChartId, updateChart],
  );

  const handleChartLegendVisibleChange = useCallback(
    (visible: boolean) => {
      if (editingChartId) {
        void setLegendVisible(editingChartId, visible);
      }
    },
    [editingChartId, setLegendVisible],
  );

  const handleChartAxisTitleChange = useCallback(
    (axisRole: ChartAxisRole, title: string) => {
      if (editingChartId) {
        void setAxisTitle(editingChartId, axisRole, title);
      }
    },
    [editingChartId, setAxisTitle],
  );

  /**
   * Close the chart editor panel.
   */
  const handleChartEditorClose = useCallback(() => {
    stopEditingChart();
  }, [stopEditingChart]);

  /**
   * Delete the currently editing chart and close the editor.
   */
  const handleChartEditorDelete = useCallback(() => {
    if (editingChartId) {
      removeChart(editingChartId);
      stopEditingChart();
    }
  }, [editingChartId, removeChart, stopEditingChart]);

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    // Chart state
    charts,
    editingChartId,
    editingChart,

    // Actions
    handleInsertChart,
    handleChartEditorChange,
    handleChartLegendVisibleChange,
    handleChartAxisTitleChange,
    handleChartEditorClose,
    handleChartEditorDelete,

    // Derived state
    chartDisabled,
  };
}
