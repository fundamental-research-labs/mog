/**
 * Timeline State Machine
 *
 * Manages interaction state for the Timeline view.
 * Handles selection, dragging, resizing, panning, and zooming.
 *
 * States:
 * - idle: No active interaction
 * - selecting: Selecting bars (click, shift+click, ctrl+click)
 * - dragging: Moving a bar (changing dates)
 * - resizing: Changing bar duration (start or end edge)
 * - panning: Scrolling the viewport horizontally
 *
 */

import type { RowId } from '@mog-sdk/contracts/cell-identity';
import { assign, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';
import { getPixelsPerUnit, type TimelineScale } from '../config';

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * Interaction state for the timeline.
 */
export type TimelineInteraction =
  | { type: 'idle' }
  | { type: 'selecting-range'; startDate: Date; currentDate: Date }
  | { type: 'dragging-bar'; barId: RowId; startX: number; offsetDays: number }
  | {
      type: 'resizing-bar';
      barId: RowId;
      edge: 'start' | 'end';
      startX: number;
      offsetDays: number;
    }
  | { type: 'panning'; startX: number; startScrollLeft: number };

/**
 * Context for the timeline state machine.
 */
export interface TimelineContext {
  /** Currently selected bars (row IDs) */
  selectedBars: Set<RowId>;

  /** Currently focused bar (for keyboard navigation) */
  focusedBar: RowId | null;

  /** Current interaction state */
  interaction: TimelineInteraction;

  /** Viewport start date */
  viewportStart: Date;

  /** Current time scale */
  scale: TimelineScale;

  /** Scroll position (pixels from left) */
  scrollLeft: number;

  /** Scroll position (pixels from top) */
  scrollTop: number;

  /** Collapsed group keys */
  collapsedGroups: Set<string>;

  /** Temporary drag/resize preview (for optimistic UI) */
  preview: {
    barId: RowId;
    startDate: Date;
    endDate: Date;
  } | null;
}

const initialContext: TimelineContext = {
  selectedBars: new Set(),
  focusedBar: null,
  interaction: { type: 'idle' },
  viewportStart: new Date(),
  scale: 'day',
  scrollLeft: 0,
  scrollTop: 0,
  collapsedGroups: new Set(),
  preview: null,
};

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Key modifiers for mouse/keyboard events.
 */
export interface KeyModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Events that the timeline machine handles.
 */
export type TimelineEvent =
  // Bar interactions
  | { type: 'BAR_CLICK'; barId: RowId; modifiers: KeyModifiers }
  | { type: 'BAR_DOUBLE_CLICK'; barId: RowId }
  | { type: 'BAR_DRAG_START'; barId: RowId; x: number }
  | { type: 'BAR_DRAG_MOVE'; x: number }
  | { type: 'BAR_DRAG_END' }
  | { type: 'BAR_RESIZE_START'; barId: RowId; edge: 'start' | 'end'; x: number }
  | { type: 'BAR_RESIZE_MOVE'; x: number }
  | { type: 'BAR_RESIZE_END' }
  // Canvas interactions
  | { type: 'CANVAS_CLICK'; x: number; y: number; modifiers: KeyModifiers }
  | { type: 'PAN_START'; x: number }
  | { type: 'PAN_MOVE'; x: number }
  | { type: 'PAN_END' }
  // Zoom/scale
  | { type: 'ZOOM'; direction: 'in' | 'out' }
  | { type: 'SET_SCALE'; scale: TimelineScale }
  // Viewport
  | { type: 'SCROLL'; scrollLeft: number; scrollTop: number }
  | { type: 'SET_VIEWPORT_START'; date: Date }
  // Selection
  | { type: 'SELECT_ALL' }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SELECT_BARS'; barIds: RowId[]; replace?: boolean }
  // Groups
  | { type: 'TOGGLE_GROUP'; groupKey: string }
  | { type: 'COLLAPSE_ALL_GROUPS' }
  | { type: 'EXPAND_ALL_GROUPS' }
  // Keyboard
  | { type: 'KEYBOARD'; key: string; modifiers: KeyModifiers }
  // External updates
  | { type: 'RECORD_UPDATED'; rowId: RowId }
  | { type: 'RECORD_DELETED'; rowId: RowId }
  // Cancel
  | { type: 'CANCEL' };

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the timeline machine.
 */
export const TimelineEvents = {
  barClick: (barId: RowId, modifiers: KeyModifiers): TimelineEvent => ({
    type: 'BAR_CLICK',
    barId,
    modifiers,
  }),

  barDoubleClick: (barId: RowId): TimelineEvent => ({
    type: 'BAR_DOUBLE_CLICK',
    barId,
  }),

  barDragStart: (barId: RowId, x: number): TimelineEvent => ({
    type: 'BAR_DRAG_START',
    barId,
    x,
  }),

  barDragMove: (x: number): TimelineEvent => ({
    type: 'BAR_DRAG_MOVE',
    x,
  }),

  barDragEnd: (): TimelineEvent => ({
    type: 'BAR_DRAG_END',
  }),

  barResizeStart: (barId: RowId, edge: 'start' | 'end', x: number): TimelineEvent => ({
    type: 'BAR_RESIZE_START',
    barId,
    edge,
    x,
  }),

  barResizeMove: (x: number): TimelineEvent => ({
    type: 'BAR_RESIZE_MOVE',
    x,
  }),

  barResizeEnd: (): TimelineEvent => ({
    type: 'BAR_RESIZE_END',
  }),

  canvasClick: (x: number, y: number, modifiers: KeyModifiers): TimelineEvent => ({
    type: 'CANVAS_CLICK',
    x,
    y,
    modifiers,
  }),

  panStart: (x: number): TimelineEvent => ({
    type: 'PAN_START',
    x,
  }),

  panMove: (x: number): TimelineEvent => ({
    type: 'PAN_MOVE',
    x,
  }),

  panEnd: (): TimelineEvent => ({
    type: 'PAN_END',
  }),

  zoom: (direction: 'in' | 'out'): TimelineEvent => ({
    type: 'ZOOM',
    direction,
  }),

  setScale: (scale: TimelineScale): TimelineEvent => ({
    type: 'SET_SCALE',
    scale,
  }),

  scroll: (scrollLeft: number, scrollTop: number): TimelineEvent => ({
    type: 'SCROLL',
    scrollLeft,
    scrollTop,
  }),

  setViewportStart: (date: Date): TimelineEvent => ({
    type: 'SET_VIEWPORT_START',
    date,
  }),

  selectAll: (): TimelineEvent => ({
    type: 'SELECT_ALL',
  }),

  clearSelection: (): TimelineEvent => ({
    type: 'CLEAR_SELECTION',
  }),

  selectBars: (barIds: RowId[], replace = true): TimelineEvent => ({
    type: 'SELECT_BARS',
    barIds,
    replace,
  }),

  toggleGroup: (groupKey: string): TimelineEvent => ({
    type: 'TOGGLE_GROUP',
    groupKey,
  }),

  collapseAllGroups: (): TimelineEvent => ({
    type: 'COLLAPSE_ALL_GROUPS',
  }),

  expandAllGroups: (): TimelineEvent => ({
    type: 'EXPAND_ALL_GROUPS',
  }),

  keyboard: (key: string, modifiers: KeyModifiers): TimelineEvent => ({
    type: 'KEYBOARD',
    key,
    modifiers,
  }),

  recordUpdated: (rowId: RowId): TimelineEvent => ({
    type: 'RECORD_UPDATED',
    rowId,
  }),

  recordDeleted: (rowId: RowId): TimelineEvent => ({
    type: 'RECORD_DELETED',
    rowId,
  }),

  cancel: (): TimelineEvent => ({
    type: 'CANCEL',
  }),
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const SCALE_ORDER: TimelineScale[] = ['day', 'week', 'month', 'quarter', 'year'];

function zoomScale(current: TimelineScale, direction: 'in' | 'out'): TimelineScale {
  const index = SCALE_ORDER.indexOf(current);
  if (direction === 'in' && index > 0) {
    return SCALE_ORDER[index - 1];
  }
  if (direction === 'out' && index < SCALE_ORDER.length - 1) {
    return SCALE_ORDER[index + 1];
  }
  return current;
}

// =============================================================================
// MACHINE DEFINITION
// =============================================================================

export const timelineMachine = setup({
  types: {
    context: {} as TimelineContext,
    events: {} as TimelineEvent,
  },
  actions: {
    // Selection
    selectBar: assign(({ context, event }) => {
      if (event.type !== 'BAR_CLICK') return {};

      const { barId, modifiers } = event;
      const newSelection = new Set(context.selectedBars);

      if (modifiers.shiftKey && context.focusedBar) {
        // Range selection - not implemented yet, just add the bar
        newSelection.add(barId);
      } else if (modifiers.ctrlKey || modifiers.metaKey) {
        // Toggle selection
        if (newSelection.has(barId)) {
          newSelection.delete(barId);
        } else {
          newSelection.add(barId);
        }
      } else {
        // Single selection
        newSelection.clear();
        newSelection.add(barId);
      }

      return {
        selectedBars: newSelection,
        focusedBar: barId,
      };
    }),

    clearSelection: assign(() => ({
      selectedBars: new Set<RowId>(),
      focusedBar: null,
    })),

    selectBars: assign(({ context, event }) => {
      if (event.type !== 'SELECT_BARS') return {};

      const newSelection = event.replace
        ? new Set(event.barIds)
        : new Set([...context.selectedBars, ...event.barIds]);

      return {
        selectedBars: newSelection,
        focusedBar: event.barIds[0] || context.focusedBar,
      };
    }),

    // Drag operations
    startDrag: assign(({ event }) => {
      if (event.type !== 'BAR_DRAG_START') return {};

      return {
        interaction: {
          type: 'dragging-bar' as const,
          barId: event.barId,
          startX: event.x,
          offsetDays: 0,
        },
      };
    }),

    updateDrag: assign(({ context, event }) => {
      if (event.type !== 'BAR_DRAG_MOVE' || context.interaction.type !== 'dragging-bar') {
        return {};
      }

      const deltaX = event.x - context.interaction.startX;
      // Convert deltaX to days based on current scale
      const pixelsPerUnit = getPixelsPerUnit(context.scale);
      const offsetDays = Math.round(deltaX / pixelsPerUnit);

      return {
        interaction: {
          ...context.interaction,
          offsetDays,
        },
      };
    }),

    endDrag: assign(() => ({
      interaction: { type: 'idle' as const },
      preview: null,
    })),

    // Resize operations
    startResize: assign(({ event }) => {
      if (event.type !== 'BAR_RESIZE_START') return {};

      return {
        interaction: {
          type: 'resizing-bar' as const,
          barId: event.barId,
          edge: event.edge,
          startX: event.x,
          offsetDays: 0,
        },
      };
    }),

    updateResize: assign(({ context, event }) => {
      if (event.type !== 'BAR_RESIZE_MOVE' || context.interaction.type !== 'resizing-bar') {
        return {};
      }

      const deltaX = event.x - context.interaction.startX;
      // Convert deltaX to days based on current scale
      const pixelsPerUnit = getPixelsPerUnit(context.scale);
      const offsetDays = Math.round(deltaX / pixelsPerUnit);

      return {
        interaction: {
          ...context.interaction,
          offsetDays,
        },
      };
    }),

    endResize: assign(() => ({
      interaction: { type: 'idle' as const },
      preview: null,
    })),

    // Pan operations
    startPan: assign(({ context, event }) => {
      if (event.type !== 'PAN_START') return {};

      return {
        interaction: {
          type: 'panning' as const,
          startX: event.x,
          startScrollLeft: context.scrollLeft,
        },
      };
    }),

    updatePan: assign(({ context, event }) => {
      if (event.type !== 'PAN_MOVE' || context.interaction.type !== 'panning') {
        return {};
      }

      const deltaX = event.x - context.interaction.startX;
      const newScrollLeft = Math.max(0, context.interaction.startScrollLeft - deltaX);

      return {
        scrollLeft: newScrollLeft,
      };
    }),

    endPan: assign(() => ({
      interaction: { type: 'idle' as const },
    })),

    // Zoom/scale
    zoom: assign(({ context, event }) => {
      if (event.type !== 'ZOOM') return {};

      return {
        scale: zoomScale(context.scale, event.direction),
      };
    }),

    setScale: assign(({ event }) => {
      if (event.type !== 'SET_SCALE') return {};

      return {
        scale: event.scale,
      };
    }),

    // Scroll
    setScroll: assign(({ event }) => {
      if (event.type !== 'SCROLL') return {};

      return {
        scrollLeft: event.scrollLeft,
        scrollTop: event.scrollTop,
      };
    }),

    setViewportStart: assign(({ event }) => {
      if (event.type !== 'SET_VIEWPORT_START') return {};

      return {
        viewportStart: event.date,
      };
    }),

    // Groups
    toggleGroup: assign(({ context, event }) => {
      if (event.type !== 'TOGGLE_GROUP') return {};

      const newCollapsed = new Set(context.collapsedGroups);
      if (newCollapsed.has(event.groupKey)) {
        newCollapsed.delete(event.groupKey);
      } else {
        newCollapsed.add(event.groupKey);
      }

      return {
        collapsedGroups: newCollapsed,
      };
    }),

    collapseAllGroups: assign(({ context }) => {
      // This would need access to all group keys - placeholder
      return {
        collapsedGroups: context.collapsedGroups,
      };
    }),

    expandAllGroups: assign(() => ({
      collapsedGroups: new Set<string>(),
    })),

    // Cancel interaction
    cancelInteraction: assign(() => ({
      interaction: { type: 'idle' as const },
      preview: null,
    })),

    // Handle deleted record
    handleRecordDeleted: assign(({ context, event }) => {
      if (event.type !== 'RECORD_DELETED') return {};

      const newSelection = new Set(context.selectedBars);
      newSelection.delete(event.rowId);

      return {
        selectedBars: newSelection,
        focusedBar: context.focusedBar === event.rowId ? null : context.focusedBar,
      };
    }),
  },
  guards: {
    isIdle: ({ context }) => context.interaction.type === 'idle',
    isDragging: ({ context }) => context.interaction.type === 'dragging-bar',
    isResizing: ({ context }) => context.interaction.type === 'resizing-bar',
    isPanning: ({ context }) => context.interaction.type === 'panning',
    hasSelection: ({ context }) => context.selectedBars.size > 0,
  },
}).createMachine({
  id: 'timeline',
  initial: 'idle',
  context: initialContext,

  states: {
    // =========================================================================
    // IDLE - No active interaction
    // =========================================================================
    idle: {
      on: {
        BAR_CLICK: {
          actions: 'selectBar',
        },
        BAR_DOUBLE_CLICK: {
          // Could open record detail - handled by adapter
        },
        BAR_DRAG_START: {
          target: 'dragging',
          actions: 'startDrag',
        },
        BAR_RESIZE_START: {
          target: 'resizing',
          actions: 'startResize',
        },
        PAN_START: {
          target: 'panning',
          actions: 'startPan',
        },
        CANVAS_CLICK: {
          actions: 'clearSelection',
        },
        ZOOM: {
          actions: 'zoom',
        },
        SET_SCALE: {
          actions: 'setScale',
        },
        SCROLL: {
          actions: 'setScroll',
        },
        SET_VIEWPORT_START: {
          actions: 'setViewportStart',
        },
        SELECT_ALL: {
          // Would need access to all bar IDs - handled by adapter
        },
        CLEAR_SELECTION: {
          actions: 'clearSelection',
        },
        SELECT_BARS: {
          actions: 'selectBars',
        },
        TOGGLE_GROUP: {
          actions: 'toggleGroup',
        },
        COLLAPSE_ALL_GROUPS: {
          actions: 'collapseAllGroups',
        },
        EXPAND_ALL_GROUPS: {
          actions: 'expandAllGroups',
        },
        RECORD_DELETED: {
          actions: 'handleRecordDeleted',
        },
      },
    },

    // =========================================================================
    // DRAGGING - Moving a bar
    // =========================================================================
    dragging: {
      on: {
        BAR_DRAG_MOVE: {
          actions: 'updateDrag',
        },
        BAR_DRAG_END: {
          target: 'idle',
          actions: 'endDrag',
        },
        CANCEL: {
          target: 'idle',
          actions: 'cancelInteraction',
        },
      },
    },

    // =========================================================================
    // RESIZING - Changing bar duration
    // =========================================================================
    resizing: {
      on: {
        BAR_RESIZE_MOVE: {
          actions: 'updateResize',
        },
        BAR_RESIZE_END: {
          target: 'idle',
          actions: 'endResize',
        },
        CANCEL: {
          target: 'idle',
          actions: 'cancelInteraction',
        },
      },
    },

    // =========================================================================
    // PANNING - Scrolling viewport
    // =========================================================================
    panning: {
      on: {
        PAN_MOVE: {
          actions: 'updatePan',
        },
        PAN_END: {
          target: 'idle',
          actions: 'endPan',
        },
        CANCEL: {
          target: 'idle',
          actions: 'cancelInteraction',
        },
      },
    },
  },
});

// =============================================================================
// SELECTORS
// =============================================================================

/**
 * Selector functions for timeline state.
 */
export const timelineSelectors = {
  selectedBars: (state: TimelineState) => state.context.selectedBars,
  focusedBar: (state: TimelineState) => state.context.focusedBar,
  scale: (state: TimelineState) => state.context.scale,
  scrollLeft: (state: TimelineState) => state.context.scrollLeft,
  scrollTop: (state: TimelineState) => state.context.scrollTop,
  collapsedGroups: (state: TimelineState) => state.context.collapsedGroups,
  isDragging: (state: TimelineState) => state.context.interaction.type === 'dragging-bar',
  isResizing: (state: TimelineState) => state.context.interaction.type === 'resizing-bar',
  isPanning: (state: TimelineState) => state.context.interaction.type === 'panning',
  isInteracting: (state: TimelineState) => state.context.interaction.type !== 'idle',
  dragOffset: (state: TimelineState) => {
    if (state.context.interaction.type === 'dragging-bar') {
      return state.context.interaction.offsetDays;
    }
    return 0;
  },
  resizeOffset: (state: TimelineState) => {
    if (state.context.interaction.type === 'resizing-bar') {
      return {
        edge: state.context.interaction.edge,
        offsetDays: state.context.interaction.offsetDays,
      };
    }
    return null;
  },
};

// =============================================================================
// ACTOR TYPES
// =============================================================================

export type TimelineMachine = typeof timelineMachine;
export type TimelineActor = ActorRefFrom<TimelineMachine>;
export type TimelineState = SnapshotFrom<TimelineMachine>;
