/**
 * Chart UI Store Hooks
 *
 * Granular React hooks for Chart UI state from the Zustand store.
 * These hooks provide render isolation per Architecture Checklist section 14.
 *
 * Architecture:
 * - XState chart machine (via useChartUI): Selection, editing mode, creation wizard
 * - Zustand ChartUISlice (this file): Tooltips, errors, editor panel state
 *
 * Use these hooks when you need:
 * - Chart tooltip display state
 * - Chart error display state
 * - Editor panel tab state (without affecting other components)
 *
 * For chart selection/editing state, use useChartUI() from state/hooks/use-chart.ts.
 *
 * Chart Engine Rearchitecture - UI & Interaction Layer
 *
 * @module hooks/use-chart-ui-store
 */

import { useShallow } from 'zustand/react/shallow';

import { useUIStore } from '../../infra/context';
import type {
  ChartEditorTab,
  ChartError,
  ChartErrorCode,
  ChartTooltipData,
} from '../../ui-store/slices/charts/chart-ui';
import type { UIState } from '../../ui-store/types';

// =============================================================================
// TOOLTIP HOOKS
// =============================================================================

/**
 * Hook to check if a chart tooltip is visible.
 *
 * Use this for conditional rendering of tooltip components.
 *
 * @example
 * ```tsx
 * function ChartOverlay() {
 * const isVisible = useIsChartTooltipVisible;
 * if (!isVisible) return null;
 * return <ChartTooltip />;
 * }
 * ```
 */
export function useIsChartTooltipVisible(): boolean {
  return useUIStore((s: UIState) => s.tooltipChartId !== null && s.tooltipData !== null);
}

/**
 * Hook to get the current chart tooltip data and position.
 *
 * Returns null values when no tooltip is visible. Components should
 * check isVisible or use useIsChartTooltipVisible() before rendering.
 *
 * @example
 * ```tsx
 * function ChartTooltip() {
 * const { chartId, data, position } = useChartTooltip;
 * if (!data || !position) return null;
 * return (
 * <div style={{ left: position.x, top: position.y }}>
 * {data.seriesName}: {data.value}
 * </div>
 * );
 * }
 * ```
 */
export function useChartTooltip(): {
  chartId: string | null;
  data: ChartTooltipData | null;
  position: { x: number; y: number } | null;
} {
  return useUIStore(
    useShallow((s: UIState) => ({
      chartId: s.tooltipChartId,
      data: s.tooltipData,
      position: s.tooltipPosition,
    })),
  );
}

/**
 * Hook to get chart tooltip actions.
 *
 * @example
 * ```tsx
 * function ChartDataPoint({ chartId, data, x, y }) {
 * const { showChartTooltip, hideChartTooltip } = useChartTooltipActions;
 *
 * return (
 * <div
 * onMouseEnter={ => showChartTooltip(chartId, data, { x, y })}
 * onMouseLeave={ => hideChartTooltip}
 * />
 * );
 * }
 * ```
 */
export function useChartTooltipActions(): {
  showChartTooltip: (
    chartId: string,
    data: ChartTooltipData,
    position: { x: number; y: number },
  ) => void;
  hideChartTooltip: () => void;
} {
  return useUIStore(
    useShallow((s: UIState) => ({
      showChartTooltip: s.showChartTooltip,
      hideChartTooltip: s.hideChartTooltip,
    })),
  );
}

// =============================================================================
// ERROR HOOKS
// =============================================================================

/**
 * Hook to check if a specific chart has an error.
 *
 * @example
 * ```tsx
 * function ChartContainer({ chartId }) {
 * const hasError = useHasChartError(chartId);
 * return <div className={hasError ? 'error-border' : ''}>...</div>;
 * }
 * ```
 */
export function useHasChartError(chartId: string): boolean {
  return useUIStore((s: UIState) => s.chartErrors.has(chartId));
}

/**
 * Hook to get the error for a specific chart.
 *
 * @example
 * ```tsx
 * function ChartErrorBanner({ chartId }) {
 * const error = useChartError(chartId);
 * if (!error) return null;
 * return <div className="error">{error.message}</div>;
 * }
 * ```
 */
export function useChartError(chartId: string): ChartError | undefined {
  return useUIStore((s: UIState) => s.chartErrors.get(chartId));
}

/**
 * Hook to check if any charts have errors.
 *
 * @example
 * ```tsx
 * function ErrorIndicator() {
 * const hasErrors = useHasAnyChartErrors;
 * if (!hasErrors) return null;
 * return <Icon name="warning" />;
 * }
 * ```
 */
export function useHasAnyChartErrors(): boolean {
  return useUIStore((s: UIState) => s.chartErrors.size > 0);
}

/**
 * Hook to get all chart IDs that have errors.
 *
 * @example
 * ```tsx
 * function ErrorList() {
 * const errorIds = useChartIdsWithErrors;
 * return errorIds.map(id => <ChartErrorItem key={id} chartId={id} />);
 * }
 * ```
 */
export function useChartIdsWithErrors(): string[] {
  return useUIStore(useShallow((s: UIState) => Array.from(s.chartErrors.keys())));
}

/**
 * Hook to get chart error actions.
 *
 * @example
 * ```tsx
 * function ChartRenderer({ chartId }) {
 * const { setChartError, clearChartError } = useChartErrorActions;
 *
 * useEffect( => {
 * try {
 * renderChart;
 * clearChartError(chartId);
 * } catch (e) {
 * setChartError(chartId, {
 * code: 'render_failed',
 * message: e.message,
 * timestamp: Date.now,
 * recoverable: true,
 * });
 * }
 * }, [chartId]);
 * }
 * ```
 */
export function useChartErrorActions(): {
  setChartError: (chartId: string, error: ChartError) => void;
  clearChartError: (chartId: string) => void;
  clearAllChartErrors: () => void;
} {
  return useUIStore(
    useShallow((s: UIState) => ({
      setChartError: s.setChartError,
      clearChartError: s.clearChartError,
      clearAllChartErrors: s.clearAllChartErrors,
    })),
  );
}

// =============================================================================
// EDITOR PANEL HOOKS
// =============================================================================

/**
 * Hook to get the active editor tab.
 *
 * @example
 * ```tsx
 * function ChartEditorTabs() {
 * const activeTab = useChartEditorTab;
 * return (
 * <Tabs activeTab={activeTab}>
 * <Tab id="data">Data</Tab>
 * <Tab id="style">Style</Tab>
 * <Tab id="layout">Layout</Tab>
 * </Tabs>
 * );
 * }
 * ```
 */
export function useChartEditorTab(): ChartEditorTab {
  return useUIStore((s: UIState) => s.chartEditorTab);
}

/**
 * Hook to set the active editor tab.
 *
 * @example
 * ```tsx
 * function ChartEditorTabButton({ tab }) {
 * const setTab = useSetChartEditorTab;
 * return <button onClick={ => setTab(tab)}>{tab}</button>;
 * }
 * ```
 */
export function useSetChartEditorTab(): (tab: ChartEditorTab) => void {
  return useUIStore((s: UIState) => s.setChartEditorTab);
}

// =============================================================================
// COMBINED HOOKS
// =============================================================================

/**
 * Hook to get all chart UI state and actions from the Zustand store.
 *
 * Prefer using the granular hooks above for better render isolation.
 * Use this hook only when you need most of the chart UI state.
 *
 * @example
 * ```tsx
 * function ChartUIManager() {
 * const {
 * tooltip,
 * chartErrors,
 * editorTab,
 * showTooltip,
 * hideTooltip,
 * setError,
 * clearError,
 * setEditorTab,
 * } = useChartUIStore;
 * // ...
 * }
 * ```
 */
export function useChartUIStore(): {
  // Tooltip state
  tooltip: {
    chartId: string | null;
    data: ChartTooltipData | null;
    position: { x: number; y: number } | null;
  };
  isTooltipVisible: boolean;
  // Error state
  chartErrors: Map<string, ChartError>;
  hasAnyErrors: boolean;
  // Editor state
  editorTab: ChartEditorTab;
  // Actions
  showTooltip: (
    chartId: string,
    data: ChartTooltipData,
    position: { x: number; y: number },
  ) => void;
  hideTooltip: () => void;
  setError: (chartId: string, error: ChartError) => void;
  clearError: (chartId: string) => void;
  clearAllErrors: () => void;
  setEditorTab: (tab: ChartEditorTab) => void;
} {
  return useUIStore(
    useShallow((s: UIState) => ({
      // Tooltip state
      tooltip: {
        chartId: s.tooltipChartId,
        data: s.tooltipData,
        position: s.tooltipPosition,
      },
      isTooltipVisible: s.tooltipChartId !== null && s.tooltipData !== null,
      // Error state
      chartErrors: s.chartErrors,
      hasAnyErrors: s.chartErrors.size > 0,
      // Editor state
      editorTab: s.chartEditorTab,
      // Actions
      showTooltip: s.showChartTooltip,
      hideTooltip: s.hideChartTooltip,
      setError: s.setChartError,
      clearError: s.clearChartError,
      clearAllErrors: s.clearAllChartErrors,
      setEditorTab: s.setChartEditorTab,
    })),
  );
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a chart error object.
 *
 * @example
 * ```tsx
 * const error = createChartError('data_empty', 'No data in selected range');
 * setChartError(chartId, error);
 * ```
 */
export function createChartError(
  code: ChartErrorCode,
  message: string,
  recoverable: boolean = true,
): ChartError {
  return {
    code,
    message,
    timestamp: Date.now(),
    recoverable,
  };
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export type { ChartEditorTab, ChartError, ChartErrorCode, ChartTooltipData };
