/**
 * Contextual Tabs Slice
 *
 * Manages state for contextual tab visibility detection.
 * This slice is updated by coordinator modules that watch selection changes
 * and compute derived boolean state for contextual tab visibility.
 *
 * PERFORMANCE: By storing derived boolean state in UIStore, we decouple
 * the toolbar from high-frequency selection subscriptions. The toolbar only
 * re-renders when contextual tab visibility ACTUALLY changes, not on every
 * cell selection.
 *
 * Architecture:
 * - Selection changes are watched by coordinator modules (e.g., SparklineSelectionCoordination)
 * - Coordinators compute "hasSparklineInActiveCell" and update UIStore
 * - useContextualTabs subscribes to these booleans instead of selection state
 *
 * @see engine/src/state/coordinator/features/sparkline/sparkline-selection-coordination.ts
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * State for contextual tab visibility detection.
 * Each boolean represents whether a contextual tab should be shown.
 */
export interface ContextualTabsState {
  /** Whether the active cell contains a sparkline (shows Sparkline Tools tab) */
  hasSparklineInActiveCell: boolean;
  /** Whether object selection currently contains a chart object */
  hasSelectedChartObject: boolean;
}

/**
 * Contextual tabs slice interface.
 */
export interface ContextualTabsSlice {
  contextualTabs: ContextualTabsState;

  /** Set whether active cell has a sparkline (called by SparklineSelectionCoordination) */
  setHasSparklineInActiveCell: (hasSparkline: boolean) => void;
  /** Set whether object selection contains a chart (called by ChartCoordination) */
  setHasSelectedChartObject: (hasSelectedChart: boolean) => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialContextualTabsState: ContextualTabsState = {
  hasSparklineInActiveCell: false,
  hasSelectedChartObject: false,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createContextualTabsSlice: StateCreator<
  ContextualTabsSlice,
  [],
  [],
  ContextualTabsSlice
> = (set) => ({
  contextualTabs: initialContextualTabsState,

  setHasSparklineInActiveCell: (hasSparkline: boolean) => {
    set((state) => {
      // Only update if the value actually changed (optimization)
      if (state.contextualTabs.hasSparklineInActiveCell === hasSparkline) {
        return state;
      }
      return {
        contextualTabs: {
          ...state.contextualTabs,
          hasSparklineInActiveCell: hasSparkline,
        },
      };
    });
  },

  setHasSelectedChartObject: (hasSelectedChart: boolean) => {
    set((state) => {
      if (state.contextualTabs.hasSelectedChartObject === hasSelectedChart) {
        return state;
      }
      return {
        contextualTabs: {
          ...state.contextualTabs,
          hasSelectedChartObject: hasSelectedChart,
        },
      };
    });
  },
});
