/**
 * Chart UI Slice
 *
 * Manages ephemeral UI state for charts that doesn't belong in the XState chart machine.
 * This includes tooltip state, error state, and other transient UI concerns.
 *
 * Architecture:
 * - XState chart machine handles: selection, editing, creation (complex state graphs)
 * - This Zustand slice handles: tooltips, errors, simple UI state (just data)
 *
 * Chart Engine Rearchitecture - UI & Interaction Layer
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Data displayed in chart tooltips when hovering over data points.
 */
export interface ChartTooltipData {
  /** The series name or label */
  seriesName: string;
  /** The data point value */
  value: number | string;
  /** The category/x-axis label */
  category: string;
  /** Percentage if applicable (for pie charts, etc.) */
  percentage?: number;
  /** Additional data fields for the tooltip */
  extras?: Record<string, string | number>;
}

/**
 * Error information for chart rendering/data issues.
 */
export interface ChartError {
  /** Error code for programmatic handling */
  code: ChartErrorCode;
  /** Human-readable error message */
  message: string;
  /** Timestamp when error occurred */
  timestamp: number;
  /** Whether the error is recoverable */
  recoverable: boolean;
}

/**
 * Error codes for chart errors.
 */
export type ChartErrorCode =
  | 'data_range_invalid'
  | 'data_empty'
  | 'data_type_mismatch'
  | 'render_failed'
  | 'config_invalid'
  | 'unknown';

/**
 * Chart editor tab options.
 */
export type ChartEditorTab = 'data' | 'style' | 'layout';

// =============================================================================
// State Interface
// =============================================================================

/**
 * Chart UI state managed by this slice.
 */
export interface ChartUIState {
  // Tooltip state
  /** Chart ID currently showing a tooltip */
  tooltipChartId: string | null;
  /** Tooltip data to display */
  tooltipData: ChartTooltipData | null;
  /** Tooltip position in screen coordinates */
  tooltipPosition: { x: number; y: number } | null;

  // Error state
  /** Map of chart ID to error information */
  chartErrors: Map<string, ChartError>;

  // Editor panel state (supplements XState machine)
  /** Currently active tab in the chart editor panel */
  chartEditorTab: ChartEditorTab;

  // Title editing state
  /** Chart ID currently being title-edited via modal (null if not editing) */
  editingChartTitleId: string | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

/**
 * Chart UI slice with state and actions.
 */
export interface ChartUISlice extends ChartUIState {
  // Tooltip actions
  /**
   * Show a tooltip for a chart data point.
   * @param chartId - The chart ID
   * @param data - Tooltip data to display
   * @param position - Screen position for the tooltip
   */
  showChartTooltip: (
    chartId: string,
    data: ChartTooltipData,
    position: { x: number; y: number },
  ) => void;

  /**
   * Hide the currently shown tooltip.
   */
  hideChartTooltip: () => void;

  // Error actions
  /**
   * Set an error for a specific chart.
   * @param chartId - The chart ID
   * @param error - Error information
   */
  setChartError: (chartId: string, error: ChartError) => void;

  /**
   * Clear the error for a specific chart.
   * @param chartId - The chart ID
   */
  clearChartError: (chartId: string) => void;

  /**
   * Clear all chart errors.
   */
  clearAllChartErrors: () => void;

  // Editor panel actions
  /**
   * Set the active tab in the chart editor panel.
   * @param tab - The tab to activate
   */
  setChartEditorTab: (tab: ChartEditorTab) => void;

  // Helper to check for errors
  /**
   * Check if a specific chart has an error.
   * @param chartId - The chart ID
   * @returns true if the chart has an error
   */
  hasChartError: (chartId: string) => boolean;

  /**
   * Get the error for a specific chart.
   * @param chartId - The chart ID
   * @returns The chart error or undefined
   */
  getChartError: (chartId: string) => ChartError | undefined;

  // Title editing actions
  /**
   * Open the chart title editor modal for a specific chart.
   * @param chartId - The chart ID to edit the title of
   */
  openChartTitleEditor: (chartId: string) => void;

  /**
   * Close the chart title editor modal.
   */
  closeChartTitleEditor: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialChartUIState: ChartUIState = {
  tooltipChartId: null,
  tooltipData: null,
  tooltipPosition: null,
  chartErrors: new Map(),
  chartEditorTab: 'data',
  editingChartTitleId: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the Chart UI slice.
 */
export const createChartUISlice: StateCreator<ChartUISlice, [], [], ChartUISlice> = (set, get) => ({
  // Initial state
  ...initialChartUIState,

  // Tooltip actions
  showChartTooltip: (
    chartId: string,
    data: ChartTooltipData,
    position: { x: number; y: number },
  ) => {
    set({
      tooltipChartId: chartId,
      tooltipData: data,
      tooltipPosition: position,
    });
  },

  hideChartTooltip: () => {
    set({
      tooltipChartId: null,
      tooltipData: null,
      tooltipPosition: null,
    });
  },

  // Error actions
  setChartError: (chartId: string, error: ChartError) => {
    set((state) => {
      const newErrors = new Map(state.chartErrors);
      newErrors.set(chartId, error);
      return { chartErrors: newErrors };
    });
  },

  clearChartError: (chartId: string) => {
    set((state) => {
      const newErrors = new Map(state.chartErrors);
      newErrors.delete(chartId);
      return { chartErrors: newErrors };
    });
  },

  clearAllChartErrors: () => {
    set({ chartErrors: new Map() });
  },

  // Editor panel actions
  setChartEditorTab: (tab: ChartEditorTab) => {
    set({ chartEditorTab: tab });
  },

  // Helper methods
  hasChartError: (chartId: string) => {
    return get().chartErrors.has(chartId);
  },

  getChartError: (chartId: string) => {
    return get().chartErrors.get(chartId);
  },

  // Title editing actions
  openChartTitleEditor: (chartId: string) => {
    set({ editingChartTitleId: chartId });
  },

  closeChartTitleEditor: () => {
    set({ editingChartTitleId: null });
  },
});

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select whether a tooltip is currently visible.
 */
export function selectIsChartTooltipVisible(state: ChartUISlice): boolean {
  return state.tooltipChartId !== null && state.tooltipData !== null;
}

/**
 * Select the tooltip display state.
 */
export function selectChartTooltip(state: ChartUISlice): {
  chartId: string | null;
  data: ChartTooltipData | null;
  position: { x: number; y: number } | null;
} {
  return {
    chartId: state.tooltipChartId,
    data: state.tooltipData,
    position: state.tooltipPosition,
  };
}

/**
 * Select whether any charts have errors.
 */
export function selectHasAnyChartErrors(state: ChartUISlice): boolean {
  return state.chartErrors.size > 0;
}

/**
 * Select all chart IDs with errors.
 */
export function selectChartIdsWithErrors(state: ChartUISlice): string[] {
  return Array.from(state.chartErrors.keys());
}

/**
 * Select whether the chart title editor modal is open.
 * Chart Canvas Rendering
 */
export function selectIsChartTitleEditorOpen(state: ChartUISlice): boolean {
  return state.editingChartTitleId !== null;
}

/**
 * Select the ID of the chart being title-edited.
 * Chart Canvas Rendering
 */
export function selectEditingChartTitleId(state: ChartUISlice): string | null {
  return state.editingChartTitleId;
}
