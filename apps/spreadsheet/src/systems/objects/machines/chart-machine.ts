/**
 * Chart State Machine
 *
 * Manages chart UI interactions including selection, editing, and creation wizard.
 * This replaces the implicit state machine in ui-store.ts with explicit XState states.
 *
 * States:
 * - idle: No chart selected or being created
 * - selected: Chart selected (shows selection handles)
 * - editing: Chart editor panel open
 * - creating: Chart creation wizard open (3 steps)
 *
 * Architecture:
 * - Machine owns STATE (pure transitions)
 * - Coordinator owns EXECUTION (side effects like store.createChart, store.deleteChart)
 *
 */

import type { ChartType } from '@mog-sdk/contracts/actors';
import { chartSelectors } from '../../../selectors';
import { assign, setup, type ActorRefFrom } from 'xstate';

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * Chart element types that can be selected.
 * Used for element-level selection and event handling.
 */
export type ChartElementType =
  | 'title' // Chart title
  | 'legend' // Legend component
  | 'xAxis' // X-axis (labels, line)
  | 'yAxis' // Y-axis (labels, line)
  | 'series' // Data series (bars, lines, etc.)
  | 'dataPoint' // Individual data point
  | 'gridLine' // Grid lines
  | 'tooltip'; // Tooltip (if clicked)

export interface ChartContext {
  /**
   * Currently selected chart IDs (13.9: Multi-Select Charts).
   * Using Set for efficient add/remove/has operations.
   * NOTE: This is synced FROM objectInteractionActor via SYNC_SELECTION event.
   * Chart selection/drag/resize is now handled by objectInteractionActor.
   */
  selectedChartIds: Set<string>;
  /** Chart being edited (when editor panel is open) */
  editingChartId: string | null;
  /** Chart creation wizard state */
  creationChartType: ChartType | null;
  /** Data range for chart creation (e.g., "A1:D10") */
  creationDataRange: string | null;
  /** Current step in creation wizard (0=type, 1=data, 2=options) */
  creationStep: number;

  // Element-Level Selection Hierarchy
  /**
   * Currently selected chart element type (null = chart body selected, not element).
   * When a specific element is clicked, this tracks which type of element.
   */
  selectedElement: ChartElementType | null;
  /**
   * Index of the selected series (for series/dataPoint selection).
   * Null when no series is selected.
   */
  selectedSeriesIndex: number | null;
  /**
   * Index of the selected data point within a series (for dataPoint selection).
   * Null when no specific data point is selected.
   */
  selectedPointIndex: number | null;
  /**
   * Original title value before editing (for cancel/revert).
   */
  titleEditOriginalValue: string | null;
}

/**
 * @deprecated Use selectedChartIds instead. Legacy helper for single-select behavior.
 */
export function getSelectedChartId(context: ChartContext): string | null {
  if (context.selectedChartIds.size === 0) return null;
  // Return the first selected chart (for backwards compatibility)
  return context.selectedChartIds.values().next().value ?? null;
}

// =============================================================================
// EVENTS
// =============================================================================

export type ChartEvent =
  // Sync selection from objectInteractionActor (coordinator sends this when charts are selected)
  | { type: 'SYNC_SELECTION'; chartIds: string[] }
  // Editing events
  | { type: 'START_EDIT' }
  | { type: 'STOP_EDIT' }
  // Creation wizard events
  | { type: 'CREATE'; initialDataRange?: string }
  | { type: 'SET_TYPE'; chartType: ChartType }
  | { type: 'SET_DATA_RANGE'; dataRange: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'CANCEL' }
  | { type: 'CONFIRM' }
  // Deletion (coordinator handles actual deletion, this just clears state)
  | { type: 'DELETE' }
  // Sheet switch - clear chart state
  | { type: 'SHEET_SWITCHED' }
  // Remote events (collaboration)
  | { type: 'REMOTE_CHART_DELETED'; chartId: string }
  // Element-Level Selection Events
  // Click on specific chart elements (axes, legend, series, data points)
  | { type: 'CLICK_ELEMENT'; elementType: ChartElementType }
  | { type: 'DOUBLE_CLICK'; elementType?: ChartElementType }
  | { type: 'CLICK_SERIES'; seriesIndex: number }
  | { type: 'CLICK_POINT'; seriesIndex: number; pointIndex: number }
  // Title editing events (enter/exit title edit mode)
  | { type: 'START_TITLE_EDIT'; originalValue: string }
  | { type: 'END_TITLE_EDIT' }
  | { type: 'CANCEL_TITLE_EDIT' }
  // Clear element selection (click on chart body, not element)
  | { type: 'CLEAR_ELEMENT_SELECTION' };

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the chart machine.
 * Use these instead of inline object literals to prevent magic string drift.
 *
 * NOTE: Selection/drag/resize events have been moved to objectInteractionActor.
 * Chart selection is now synced via SYNC_SELECTION event from coordinator.
 */
export const ChartEvents = {
  /**
   * Sync chart selection from objectInteractionActor.
   * Sent by coordinator when charts are selected/deselected via objectInteraction.
   * @param chartIds - Array of selected chart IDs (empty array = no selection)
   */
  syncSelection: (chartIds: string[]): ChartEvent => ({
    type: 'SYNC_SELECTION',
    chartIds,
  }),

  // Editing events
  startEdit: (): ChartEvent => ({
    type: 'START_EDIT',
  }),

  stopEdit: (): ChartEvent => ({
    type: 'STOP_EDIT',
  }),

  // Creation wizard events
  create: (initialDataRange?: string): ChartEvent => ({
    type: 'CREATE',
    initialDataRange,
  }),

  setType: (chartType: ChartType): ChartEvent => ({
    type: 'SET_TYPE',
    chartType,
  }),

  setDataRange: (dataRange: string): ChartEvent => ({
    type: 'SET_DATA_RANGE',
    dataRange,
  }),

  nextStep: (): ChartEvent => ({
    type: 'NEXT_STEP',
  }),

  prevStep: (): ChartEvent => ({
    type: 'PREV_STEP',
  }),

  cancel: (): ChartEvent => ({
    type: 'CANCEL',
  }),

  confirm: (): ChartEvent => ({
    type: 'CONFIRM',
  }),

  // Deletion
  delete: (): ChartEvent => ({
    type: 'DELETE',
  }),

  // Sheet switch
  sheetSwitched: (): ChartEvent => ({
    type: 'SHEET_SWITCHED',
  }),

  // Remote events
  remoteChartDeleted: (chartId: string): ChartEvent => ({
    type: 'REMOTE_CHART_DELETED',
    chartId,
  }),

  // Element-Level Selection Events
  /**
   * Click on a chart element (axis, legend, title, etc.).
   * Transitions to elementSelected state.
   */
  clickElement: (elementType: ChartElementType): ChartEvent => ({
    type: 'CLICK_ELEMENT',
    elementType,
  }),

  /**
   * Double-click on a chart element.
   * If on title, enters title editing mode.
   */
  doubleClick: (elementType?: ChartElementType): ChartEvent => ({
    type: 'DOUBLE_CLICK',
    elementType,
  }),

  /**
   * Click on a data series (selects all points in series).
   */
  clickSeries: (seriesIndex: number): ChartEvent => ({
    type: 'CLICK_SERIES',
    seriesIndex,
  }),

  /**
   * Click on a specific data point.
   */
  clickPoint: (seriesIndex: number, pointIndex: number): ChartEvent => ({
    type: 'CLICK_POINT',
    seriesIndex,
    pointIndex,
  }),

  /**
   * Start editing the chart title.
   * @param originalValue - The current title value (for revert on cancel)
   */
  startTitleEdit: (originalValue: string): ChartEvent => ({
    type: 'START_TITLE_EDIT',
    originalValue,
  }),

  /**
   * End title editing (commit changes).
   */
  endTitleEdit: (): ChartEvent => ({
    type: 'END_TITLE_EDIT',
  }),

  /**
   * Cancel title editing (revert to original value).
   */
  cancelTitleEdit: (): ChartEvent => ({
    type: 'CANCEL_TITLE_EDIT',
  }),

  /**
   * Clear element selection (click on chart body, not element).
   * Returns to idle state (chart body clicks now go through objectInteraction).
   */
  clearElementSelection: (): ChartEvent => ({
    type: 'CLEAR_ELEMENT_SELECTION',
  }),
} as const;

// =============================================================================
// INITIAL CONTEXT
// =============================================================================

const initialContext: ChartContext = {
  selectedChartIds: new Set<string>(),
  editingChartId: null,
  creationChartType: null,
  creationDataRange: null,
  creationStep: 0,
  // Element-Level Selection State
  selectedElement: null,
  selectedSeriesIndex: null,
  selectedPointIndex: null,
  titleEditOriginalValue: null,
};

// =============================================================================
// STATE MACHINE
// =============================================================================

export const chartMachine = setup({
  types: {
    context: {} as ChartContext,
    events: {} as ChartEvent,
  },
  guards: {
    hasSelectedChart: ({ context }) => context.selectedChartIds.size > 0,
    isEditingChart: ({ context }) => context.editingChartId !== null,
    canGoNextStep: ({ context }) => context.creationStep < 2,
    canGoPrevStep: ({ context }) => context.creationStep > 0,
    isSelectedChartDeleted: ({ context, event }) => {
      if (event.type !== 'REMOTE_CHART_DELETED') return false;
      return context.selectedChartIds.has(event.chartId);
    },
    isEditingChartDeleted: ({ context, event }) => {
      if (event.type !== 'REMOTE_CHART_DELETED') return false;
      return context.editingChartId === event.chartId;
    },
    // Multi-select guards
    hasMultipleSelected: ({ context }) => context.selectedChartIds.size > 1,
    hasSingleSelected: ({ context }) => context.selectedChartIds.size === 1,
    // Element selection guards
    hasElementSelected: ({ context }) => context.selectedElement !== null,
    hasSeriesSelected: ({ context }) => context.selectedSeriesIndex !== null,
    hasPointSelected: ({ context }) => context.selectedPointIndex !== null,
    isDoubleClickOnTitle: ({ event }) =>
      event.type === 'DOUBLE_CLICK' && event.elementType === 'title',
    // Sync selection guards
    hasSyncedSelection: ({ event }) => event.type === 'SYNC_SELECTION' && event.chartIds.length > 0,
    hasNoSyncedSelection: ({ event }) =>
      event.type === 'SYNC_SELECTION' && event.chartIds.length === 0,
  },
  actions: {
    /**
     * Sync selection from objectInteractionActor.
     * Updates selectedChartIds to match what objectInteraction has selected.
     */
    syncSelection: assign(({ event }) => {
      if (event.type !== 'SYNC_SELECTION') return {};
      return {
        selectedChartIds: new Set(event.chartIds),
      };
    }),

    /**
     * Clear selection (used when syncing empty selection from objectInteraction).
     */
    clearSelection: assign(() => ({
      selectedChartIds: new Set<string>(),
      // Also clear element selection state
      selectedElement: null,
      selectedSeriesIndex: null,
      selectedPointIndex: null,
      titleEditOriginalValue: null,
    })),

    removeChartFromSelection: assign(({ context, event }) => {
      if (event.type !== 'REMOTE_CHART_DELETED') return {};
      const newSelection = new Set(context.selectedChartIds);
      newSelection.delete(event.chartId);
      return {
        selectedChartIds: newSelection,
        // Also clear editing if the deleted chart was being edited
        editingChartId: context.editingChartId === event.chartId ? null : context.editingChartId,
      };
    }),

    // Editing actions
    startEditing: assign(({ context }) => ({
      // Edit the first selected chart (multi-edit not supported yet)
      editingChartId: getSelectedChartId(context),
    })),

    stopEditing: assign(() => ({
      editingChartId: null,
    })),

    // Creation wizard actions
    openCreationWizard: assign(({ event }) => {
      if (event.type !== 'CREATE') return {};
      return {
        creationChartType: 'column' as ChartType, // Default type
        creationDataRange: event.initialDataRange ?? null,
        creationStep: 0,
      };
    }),

    setCreationType: assign(({ event }) => {
      if (event.type !== 'SET_TYPE') return {};
      return {
        creationChartType: event.chartType,
      };
    }),

    setCreationDataRange: assign(({ event }) => {
      if (event.type !== 'SET_DATA_RANGE') return {};
      return {
        creationDataRange: event.dataRange,
      };
    }),

    nextStep: assign(({ context }) => ({
      creationStep: Math.min(context.creationStep + 1, 2),
    })),

    prevStep: assign(({ context }) => ({
      creationStep: Math.max(context.creationStep - 1, 0),
    })),

    resetCreation: assign(() => ({
      creationChartType: null,
      creationDataRange: null,
      creationStep: 0,
    })),

    // Clear all state (used on sheet switch, delete, etc.)
    clearAll: assign(() => ({
      selectedChartIds: new Set<string>(),
      editingChartId: null,
      creationChartType: null,
      creationDataRange: null,
      creationStep: 0,
      // Clear element selection state
      selectedElement: null,
      selectedSeriesIndex: null,
      selectedPointIndex: null,
      titleEditOriginalValue: null,
    })),

    // Delete action - clears selected/editing chart
    clearDeletedChart: assign(() => ({
      selectedChartIds: new Set<string>(),
      editingChartId: null,
      // Clear element selection state
      selectedElement: null,
      selectedSeriesIndex: null,
      selectedPointIndex: null,
      titleEditOriginalValue: null,
    })),

    // Element-Level Selection Actions
    /**
     * Select a chart element (axis, legend, title, etc.).
     * Handles both CLICK_ELEMENT and DOUBLE_CLICK events.
     */
    selectElement: assign(({ event }) => {
      if (event.type === 'CLICK_ELEMENT') {
        return {
          selectedElement: event.elementType,
          selectedSeriesIndex: null,
          selectedPointIndex: null,
        };
      }
      if (event.type === 'DOUBLE_CLICK' && event.elementType) {
        return {
          selectedElement: event.elementType,
          selectedSeriesIndex: null,
          selectedPointIndex: null,
        };
      }
      return {};
    }),

    /**
     * Select a data series (all points in series).
     */
    selectSeries: assign(({ event }) => {
      if (event.type !== 'CLICK_SERIES') return {};
      return {
        selectedElement: 'series' as ChartElementType,
        selectedSeriesIndex: event.seriesIndex,
        selectedPointIndex: null,
      };
    }),

    /**
     * Select a specific data point.
     */
    selectPoint: assign(({ event }) => {
      if (event.type !== 'CLICK_POINT') return {};
      return {
        selectedElement: 'dataPoint' as ChartElementType,
        selectedSeriesIndex: event.seriesIndex,
        selectedPointIndex: event.pointIndex,
      };
    }),

    /**
     * Clear element selection (return to chart-selected state).
     */
    clearElementSelection: assign(() => ({
      selectedElement: null,
      selectedSeriesIndex: null,
      selectedPointIndex: null,
    })),

    /**
     * Start title editing mode.
     */
    startTitleEdit: assign(({ event }) => {
      if (event.type !== 'START_TITLE_EDIT') return {};
      return {
        selectedElement: 'title' as ChartElementType,
        titleEditOriginalValue: event.originalValue,
      };
    }),

    /**
     * End title editing (commit changes).
     */
    endTitleEdit: assign(() => ({
      selectedElement: null,
      titleEditOriginalValue: null,
    })),

    /**
     * Cancel title editing (revert to original value).
     * Note: Coordinator handles actual value revert using titleEditOriginalValue.
     */
    cancelTitleEdit: assign(() => ({
      selectedElement: null,
      titleEditOriginalValue: null,
    })),
  },
}).createMachine({
  id: 'chart',
  initial: 'idle',
  context: initialContext,
  states: {
    // =========================================================================
    // IDLE - No chart interaction (selection handled by objectInteractionActor)
    // =========================================================================
    idle: {
      on: {
        // Sync selection from objectInteractionActor
        // When charts are selected via objectInteraction, coordinator sends SYNC_SELECTION
        SYNC_SELECTION: [
          {
            guard: 'hasSyncedSelection',
            target: 'selected', // Transition to selected state when charts are selected
            actions: 'syncSelection',
          },
          {
            // Empty selection - clear any remaining state
            actions: 'clearSelection',
          },
        ],
        // Element-Level Selection Events
        // These are triggered by UI interactions within a selected chart
        CLICK_ELEMENT: {
          target: 'elementSelected',
          actions: 'selectElement',
        },
        CLICK_SERIES: {
          target: 'seriesSelected',
          actions: 'selectSeries',
        },
        CLICK_POINT: {
          target: 'pointSelected',
          actions: 'selectPoint',
        },
        // Double-click events
        DOUBLE_CLICK: [
          {
            guard: 'isDoubleClickOnTitle',
            target: 'titleEditing',
            actions: 'selectElement',
          },
          {
            // Double-click elsewhere opens the chart editor
            target: 'editing',
            actions: 'startEditing',
          },
        ],
        START_EDIT: {
          target: 'editing',
          actions: 'startEditing',
        },
        CREATE: {
          target: 'creating',
          actions: 'openCreationWizard',
        },
        DELETE: {
          // Coordinator handles store.deleteChart(), this just clears state
          actions: 'clearDeletedChart',
        },
        SHEET_SWITCHED: {
          actions: 'clearAll',
        },
        REMOTE_CHART_DELETED: {
          actions: 'removeChartFromSelection',
        },
      },
    },

    // =========================================================================
    // SELECTED - One or more charts selected (objectInteractionActor owns drag/resize)
    // Selection is synced FROM objectInteractionActor via SYNC_SELECTION.
    // =========================================================================
    selected: {
      on: {
        SYNC_SELECTION: [
          {
            guard: 'hasSyncedSelection',
            target: 'selected', // Stay selected, update which charts are selected
            actions: 'syncSelection',
          },
          {
            // Empty selection - charts deselected
            target: 'idle',
            actions: 'clearSelection',
          },
        ],
        // Element-Level Selection Events
        CLICK_ELEMENT: {
          target: 'elementSelected',
          actions: 'selectElement',
        },
        CLICK_SERIES: {
          target: 'seriesSelected',
          actions: 'selectSeries',
        },
        CLICK_POINT: {
          target: 'pointSelected',
          actions: 'selectPoint',
        },
        // Double-click events
        DOUBLE_CLICK: [
          {
            guard: 'isDoubleClickOnTitle',
            target: 'titleEditing',
            actions: 'selectElement',
          },
          {
            target: 'editing',
            actions: 'startEditing',
          },
        ],
        START_EDIT: {
          target: 'editing',
          actions: 'startEditing',
        },
        DELETE: {
          target: 'idle',
          actions: 'clearDeletedChart',
        },
        SHEET_SWITCHED: {
          target: 'idle',
          actions: 'clearAll',
        },
        REMOTE_CHART_DELETED: [
          {
            guard: 'isSelectedChartDeleted',
            target: 'idle',
            actions: 'removeChartFromSelection',
          },
          {
            actions: 'removeChartFromSelection',
          },
        ],
      },
    },

    // =========================================================================
    // ELEMENT SELECTED - A chart element (axis, legend, etc.) is selected
    // Element-Level Selection Hierarchy
    // =========================================================================
    elementSelected: {
      on: {
        // Sync selection from objectInteractionActor
        SYNC_SELECTION: [
          {
            guard: 'hasNoSyncedSelection',
            target: 'idle',
            actions: ['clearElementSelection', 'clearSelection'],
          },
          {
            // Selection changed but still have charts selected
            actions: 'syncSelection',
          },
        ],
        // Switch to different element
        CLICK_ELEMENT: {
          actions: 'selectElement',
        },
        CLICK_SERIES: {
          target: 'seriesSelected',
          actions: 'selectSeries',
        },
        CLICK_POINT: {
          target: 'pointSelected',
          actions: 'selectPoint',
        },
        // Clear element selection (click on chart body)
        CLEAR_ELEMENT_SELECTION: {
          target: 'idle',
          actions: 'clearElementSelection',
        },
        // Double-click on title enters edit mode
        DOUBLE_CLICK: [
          {
            guard: 'isDoubleClickOnTitle',
            target: 'titleEditing',
            actions: 'selectElement',
          },
          {
            // Double-click elsewhere opens the chart editor
            target: 'editing',
            actions: 'startEditing',
          },
        ],
        // Escape clears element selection, returns to idle
        CANCEL: {
          target: 'idle',
          actions: 'clearElementSelection',
        },
        SHEET_SWITCHED: {
          target: 'idle',
          actions: 'clearAll',
        },
        DELETE: {
          target: 'idle',
          actions: 'clearDeletedChart',
        },
      },
    },

    // =========================================================================
    // SERIES SELECTED - A data series is selected (all points in series)
    // Element-Level Selection Hierarchy
    // =========================================================================
    seriesSelected: {
      on: {
        // Sync selection from objectInteractionActor
        SYNC_SELECTION: [
          {
            guard: 'hasNoSyncedSelection',
            target: 'idle',
            actions: ['clearElementSelection', 'clearSelection'],
          },
          {
            actions: 'syncSelection',
          },
        ],
        // Click different series
        CLICK_SERIES: {
          actions: 'selectSeries',
        },
        // Click specific point in series
        CLICK_POINT: {
          target: 'pointSelected',
          actions: 'selectPoint',
        },
        // Click non-series element
        CLICK_ELEMENT: {
          target: 'elementSelected',
          actions: 'selectElement',
        },
        // Clear series selection
        CLEAR_ELEMENT_SELECTION: {
          target: 'idle',
          actions: 'clearElementSelection',
        },
        // Escape returns to idle
        CANCEL: {
          target: 'idle',
          actions: 'clearElementSelection',
        },
        SHEET_SWITCHED: {
          target: 'idle',
          actions: 'clearAll',
        },
        DELETE: {
          target: 'idle',
          actions: 'clearDeletedChart',
        },
      },
    },

    // =========================================================================
    // POINT SELECTED - A specific data point is selected
    // Element-Level Selection Hierarchy
    // =========================================================================
    pointSelected: {
      on: {
        // Sync selection from objectInteractionActor
        SYNC_SELECTION: [
          {
            guard: 'hasNoSyncedSelection',
            target: 'idle',
            actions: ['clearElementSelection', 'clearSelection'],
          },
          {
            actions: 'syncSelection',
          },
        ],
        // Click different point
        CLICK_POINT: {
          actions: 'selectPoint',
        },
        // Click series (selects all points)
        CLICK_SERIES: {
          target: 'seriesSelected',
          actions: 'selectSeries',
        },
        // Click other element
        CLICK_ELEMENT: {
          target: 'elementSelected',
          actions: 'selectElement',
        },
        // Clear point selection
        CLEAR_ELEMENT_SELECTION: {
          target: 'idle',
          actions: 'clearElementSelection',
        },
        // Escape returns to idle
        CANCEL: {
          target: 'idle',
          actions: 'clearElementSelection',
        },
        SHEET_SWITCHED: {
          target: 'idle',
          actions: 'clearAll',
        },
        DELETE: {
          target: 'idle',
          actions: 'clearDeletedChart',
        },
      },
    },

    // =========================================================================
    // TITLE EDITING - Chart title is being edited inline
    // Element-Level Selection Hierarchy
    // =========================================================================
    titleEditing: {
      on: {
        // Sync selection from objectInteractionActor
        SYNC_SELECTION: [
          {
            guard: 'hasNoSyncedSelection',
            target: 'idle',
            actions: ['cancelTitleEdit', 'clearSelection'],
          },
          {
            actions: 'syncSelection',
          },
        ],
        // Start title editing with original value (for coordinator to track)
        START_TITLE_EDIT: {
          actions: 'startTitleEdit',
        },
        // Commit title changes
        END_TITLE_EDIT: {
          target: 'idle',
          actions: 'endTitleEdit',
        },
        // Cancel title editing (revert to original)
        CANCEL_TITLE_EDIT: {
          target: 'idle',
          actions: 'cancelTitleEdit',
        },
        // Escape cancels title edit
        CANCEL: {
          target: 'idle',
          actions: 'cancelTitleEdit',
        },
        SHEET_SWITCHED: {
          target: 'idle',
          actions: 'clearAll',
        },
      },
    },

    // =========================================================================
    // EDITING - Chart editor panel is open
    // =========================================================================
    editing: {
      on: {
        // Sync selection from objectInteractionActor
        SYNC_SELECTION: [
          {
            guard: 'hasNoSyncedSelection',
            target: 'idle',
            actions: ['stopEditing', 'clearSelection'],
          },
          {
            actions: 'syncSelection',
          },
        ],
        STOP_EDIT: {
          target: 'idle',
          actions: 'stopEditing',
        },
        CANCEL: {
          // Escape key closes editor
          target: 'idle',
          actions: 'stopEditing',
        },
        DELETE: {
          // Coordinator handles store.deleteChart(), then sends confirmation
          target: 'idle',
          actions: 'clearDeletedChart',
        },
        SHEET_SWITCHED: {
          target: 'idle',
          actions: 'clearAll',
        },
        REMOTE_CHART_DELETED: [
          {
            guard: 'isEditingChartDeleted',
            target: 'idle',
            actions: 'clearDeletedChart',
          },
          {
            // Other chart deleted, stay editing
          },
        ],
      },
    },

    // =========================================================================
    // CREATING - Chart creation wizard (3-step process)
    // =========================================================================
    creating: {
      initial: 'step0',
      states: {
        // Step 0: Select chart type
        step0: {
          on: {
            SET_TYPE: {
              actions: 'setCreationType',
            },
            NEXT_STEP: {
              target: 'step1',
              actions: 'nextStep',
            },
          },
        },
        // Step 1: Select data range
        step1: {
          on: {
            SET_DATA_RANGE: {
              actions: 'setCreationDataRange',
            },
            NEXT_STEP: {
              target: 'step2',
              actions: 'nextStep',
            },
            PREV_STEP: {
              target: 'step0',
              actions: 'prevStep',
            },
          },
        },
        // Step 2: Configure options
        // CONFIRM is handled by the parent 'creating' state's global CONFIRM handler
        // which transitions to idle and resets creation state.
        // The coordinator subscribes to state changes and handles side effects
        // (store.createChart) before the CONFIRM event is sent.
        step2: {
          on: {
            PREV_STEP: {
              target: 'step1',
              actions: 'prevStep',
            },
          },
        },
      },
      on: {
        // Global events that work from any creation step
        CANCEL: {
          target: 'idle',
          actions: 'resetCreation',
        },
        CONFIRM: {
          // Allow confirm from any step (coordinator reads context for chart config)
          target: 'idle',
          actions: 'resetCreation',
        },
        SHEET_SWITCHED: {
          target: 'idle',
          actions: 'clearAll',
        },
      },
    },
  },
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ChartMachine = typeof chartMachine;
export type ChartActor = ActorRefFrom<ChartMachine>;
export type ChartState = ReturnType<ChartActor['getSnapshot']>;

// =============================================================================
// SNAPSHOT HELPER
// =============================================================================

/**
 * Chart UI state union type.
 * NOTE: 'selected', 'moving', 'resizing' removed - selection/drag/resize handled by objectInteractionActor.
 * Element selection states for chart-specific interactions.
 */
export type ChartUIState =
  | 'idle'
  | 'editing'
  | 'creating'
  | 'elementSelected'
  | 'seriesSelected'
  | 'pointSelected'
  | 'titleEditing';

/**
 * Extract a ChartSnapshot from the machine state.
 * Used by the coordinator and hooks.
 *
 * NOTE: Selection/drag/resize is now handled by objectInteractionActor.
 * This snapshot only contains chart-specific UI state (editing, creating, element selection).
 * selectedChartIds is synced from objectInteractionActor via SYNC_SELECTION event.
 *
 * ARCHITECTURE: Uses selectors from contracts as the single source of truth.
 * Each field calls the corresponding selector - no extraction logic is duplicated here.
 */
export function getChartSnapshot(state: ChartState): {
  state: ChartUIState;
  /** @deprecated Use selectedChartIds instead */
  selectedChartId: string | null;
  /** All selected chart IDs (synced from objectInteractionActor) */
  selectedChartIds: Set<string>;
  /** Count of selected charts */
  selectedCount: number;
  editingChartId: string | null;
  isCreating: boolean;
  creationStep: number;
  creationChartType: ChartType | null;
  creationDataRange: string | null;
  isEditing: boolean;
  /** True if charts are selected (synced from objectInteractionActor) */
  hasSelection: boolean;
  /** True if multiple charts are selected */
  hasMultipleSelected: boolean;
  // Element-Level Selection State
  /** Currently selected element type (null = chart body, not element) */
  selectedElement: ChartElementType | null;
  /** Index of selected series (for series/dataPoint selection) */
  selectedSeriesIndex: number | null;
  /** Index of selected data point within series */
  selectedPointIndex: number | null;
  /** True if an element is selected (axis, legend, series, point, etc.) */
  hasElementSelected: boolean;
  /** True if a series is selected */
  hasSeriesSelected: boolean;
  /** True if a specific data point is selected */
  hasPointSelected: boolean;
  /** True if title is being edited */
  isTitleEditing: boolean;
  /** Original title value (for cancel/revert during title editing) */
  titleEditOriginalValue: string | null;
} {
  // Cast state to compatible type for selectors
  const s = state as Parameters<(typeof chartSelectors)['uiState']>[0];

  return {
    // Derived UI state
    state: chartSelectors.uiState(s),

    // Value selectors
    selectedChartId: chartSelectors.selectedChartId(s),
    selectedChartIds: chartSelectors.selectedChartIds(s),
    selectedCount: chartSelectors.selectedCount(s),
    hasMultipleSelected: chartSelectors.hasMultipleSelected(s),
    editingChartId: chartSelectors.editingChartId(s),
    creationStep: chartSelectors.creationStep(s),
    creationChartType: chartSelectors.creationChartType(s),
    creationDataRange: chartSelectors.creationDataRange(s),
    selectedElement: chartSelectors.selectedElement(s),
    selectedSeriesIndex: chartSelectors.selectedSeriesIndex(s),
    selectedPointIndex: chartSelectors.selectedPointIndex(s),
    titleEditOriginalValue: chartSelectors.titleEditOriginalValue(s),

    // State matching selectors
    isCreating: chartSelectors.isCreating(s),
    isEditing: chartSelectors.isEditing(s),
    hasSelection: chartSelectors.hasSelection(s),
    hasElementSelected: chartSelectors.isInElementSelectionState(s),
    hasSeriesSelected: chartSelectors.isSeriesSelected(s),
    hasPointSelected: chartSelectors.isPointSelected(s),
    isTitleEditing: chartSelectors.isTitleEditing(s),
  };
}
