/**
 * Calendar State Machine
 *
 * Manages calendar view interactions including:
 * - Event selection
 * - Navigation between months/weeks/days
 * - Drag to reschedule events
 * - Click to create new events
 */

import { assign, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';
import type { CalendarViewMode } from '../config';

// =============================================================================
// Types
// =============================================================================

export interface CalendarContext {
  // Selection
  selectedEvents: Set<string>; // Set of rowIds
  focusedEvent: string | null; // rowId

  // Navigation
  currentDate: Date; // The reference date for the current view
  viewMode: CalendarViewMode;

  // Drag state
  draggedEvent: string | null; // rowId
  dragTargetDate: Date | null;

  // Focus
  focusedDate: Date | null;
}

export type CalendarEvent_Machine =
  | { type: 'EVENT_CLICK'; rowId: string; shiftKey: boolean; ctrlKey: boolean }
  | { type: 'EVENT_DOUBLE_CLICK'; rowId: string }
  | { type: 'DATE_CLICK'; date: Date; shiftKey: boolean }
  | { type: 'DATE_DOUBLE_CLICK'; date: Date }
  | { type: 'DRAG_START'; rowId: string }
  | { type: 'DRAG_MOVE'; targetDate: Date }
  | { type: 'DRAG_END' }
  | { type: 'DRAG_CANCEL' }
  | { type: 'NAVIGATE_PREV' }
  | { type: 'NAVIGATE_NEXT' }
  | { type: 'NAVIGATE_TODAY' }
  | { type: 'CHANGE_VIEW_MODE'; mode: CalendarViewMode }
  | { type: 'KEYBOARD'; key: string; shiftKey: boolean; ctrlKey: boolean }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SELECT_ALL'; rowIds: string[] };

// =============================================================================
// Initial Context
// =============================================================================

export const initialCalendarContext: CalendarContext = {
  selectedEvents: new Set(),
  focusedEvent: null,
  currentDate: new Date(),
  viewMode: 'month',
  draggedEvent: null,
  dragTargetDate: null,
  focusedDate: null,
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Handle event selection with modifiers (shift/ctrl).
 */
function handleEventSelection(
  currentSelection: Set<string>,
  rowId: string,
  shiftKey: boolean,
  ctrlKey: boolean,
): Set<string> {
  const newSelection = new Set<string>();

  if (ctrlKey || shiftKey) {
    // Multi-select: toggle the clicked event
    currentSelection.forEach((id) => newSelection.add(id));
    if (newSelection.has(rowId)) {
      newSelection.delete(rowId);
    } else {
      newSelection.add(rowId);
    }
  } else {
    // Single select
    newSelection.add(rowId);
  }

  return newSelection;
}

/**
 * Calculate the new date for navigation.
 */
function calculateNavigatedDate(
  currentDate: Date,
  viewMode: CalendarViewMode,
  direction: 'prev' | 'next',
): Date {
  const newDate = new Date(currentDate);
  const multiplier = direction === 'prev' ? -1 : 1;

  switch (viewMode) {
    case 'month':
      newDate.setMonth(newDate.getMonth() + multiplier);
      break;
    case 'week':
      newDate.setDate(newDate.getDate() + 7 * multiplier);
      break;
    case 'day':
      newDate.setDate(newDate.getDate() + multiplier);
      break;
  }

  return newDate;
}

// =============================================================================
// State Machine
// =============================================================================

export const calendarMachine = setup({
  types: {
    context: {} as CalendarContext,
    events: {} as CalendarEvent_Machine,
  },
  actions: {
    selectEvent: assign(({ context, event }) => {
      if (event.type !== 'EVENT_CLICK') return {};
      return {
        selectedEvents: handleEventSelection(
          context.selectedEvents,
          event.rowId,
          event.shiftKey,
          event.ctrlKey,
        ),
        focusedEvent: event.rowId,
      };
    }),

    clearSelection: assign(() => ({
      selectedEvents: new Set<string>(),
      focusedEvent: null,
    })),

    selectAll: assign(({ event }) => {
      if (event.type !== 'SELECT_ALL') return {};
      return {
        selectedEvents: new Set(event.rowIds),
      };
    }),

    focusDate: assign(({ event }) => {
      if (event.type !== 'DATE_CLICK') return {};
      return {
        focusedDate: event.date,
      };
    }),

    startDrag: assign(({ event }) => {
      if (event.type !== 'DRAG_START') return {};
      return {
        draggedEvent: event.rowId,
        dragTargetDate: null,
      };
    }),

    updateDragTarget: assign(({ event }) => {
      if (event.type !== 'DRAG_MOVE') return {};
      return {
        dragTargetDate: event.targetDate,
      };
    }),

    endDrag: assign(() => ({
      draggedEvent: null,
      dragTargetDate: null,
    })),

    cancelDrag: assign(() => ({
      draggedEvent: null,
      dragTargetDate: null,
    })),

    navigatePrev: assign(({ context }) => ({
      currentDate: calculateNavigatedDate(context.currentDate, context.viewMode, 'prev'),
    })),

    navigateNext: assign(({ context }) => ({
      currentDate: calculateNavigatedDate(context.currentDate, context.viewMode, 'next'),
    })),

    navigateToday: assign(() => ({
      currentDate: new Date(),
    })),

    changeViewMode: assign(({ event }) => {
      if (event.type !== 'CHANGE_VIEW_MODE') return {};
      return {
        viewMode: event.mode,
      };
    }),
  },
  guards: {
    hasSelection: ({ context }) => context.selectedEvents.size > 0,
    hasFocusedEvent: ({ context }) => context.focusedEvent !== null,
    isDragging: ({ context }) => context.draggedEvent !== null,
  },
}).createMachine({
  id: 'calendar',
  initial: 'idle',
  context: initialCalendarContext,

  // Global event handlers (available in any state)
  on: {
    NAVIGATE_PREV: {
      actions: 'navigatePrev',
    },
    NAVIGATE_NEXT: {
      actions: 'navigateNext',
    },
    NAVIGATE_TODAY: {
      actions: 'navigateToday',
    },
    CHANGE_VIEW_MODE: {
      actions: 'changeViewMode',
    },
    CLEAR_SELECTION: {
      target: '.idle',
      actions: 'clearSelection',
    },
    SELECT_ALL: {
      actions: 'selectAll',
    },
  },

  states: {
    // =========================================================================
    // IDLE - Waiting for interaction
    // =========================================================================
    idle: {
      on: {
        EVENT_CLICK: {
          target: 'selecting',
          actions: 'selectEvent',
        },
        EVENT_DOUBLE_CLICK: {
          // Double-click opens record detail (handled by adapter)
          actions: 'selectEvent',
        },
        DATE_CLICK: {
          actions: 'focusDate',
        },
        DATE_DOUBLE_CLICK: {
          // Double-click on date creates new event (handled by adapter)
          actions: 'focusDate',
        },
        DRAG_START: {
          target: 'dragging',
          actions: 'startDrag',
        },
      },
    },

    // =========================================================================
    // SELECTING - Processing selection
    // =========================================================================
    selecting: {
      always: {
        target: 'idle',
      },
    },

    // =========================================================================
    // DRAGGING - Dragging an event to reschedule
    // =========================================================================
    dragging: {
      on: {
        DRAG_MOVE: {
          actions: 'updateDragTarget',
        },
        DRAG_END: {
          target: 'idle',
          actions: 'endDrag',
        },
        DRAG_CANCEL: {
          target: 'idle',
          actions: 'cancelDrag',
        },
        // Cancel drag on escape
        KEYBOARD: {
          guard: ({ event }) => event.key === 'Escape',
          target: 'idle',
          actions: 'cancelDrag',
        },
      },
    },

    // =========================================================================
    // CREATING - Creating a new event
    // =========================================================================
    creating: {
      on: {
        // Event creation is handled by the adapter opening a form
        // This state is for tracking that we're in creation mode
      },
    },
  },
});

// =============================================================================
// Snapshot Helpers
// =============================================================================

export interface CalendarSnapshot {
  /** Current state value */
  state: 'idle' | 'selecting' | 'dragging' | 'creating';
  /** Selected event IDs */
  selectedEvents: string[];
  /** Focused event ID */
  focusedEvent: string | null;
  /** Current date being viewed */
  currentDate: Date;
  /** View mode (month/week/day) */
  viewMode: CalendarViewMode;
  /** Event being dragged */
  draggedEvent: string | null;
  /** Drag target date */
  dragTargetDate: Date | null;
  /** Focused date */
  focusedDate: Date | null;
}

/**
 * Extract a normalized snapshot from machine state.
 */
export function getCalendarSnapshot(state: SnapshotFrom<typeof calendarMachine>): CalendarSnapshot {
  const context = state.context;
  const stateValue = (
    typeof state.value === 'string' ? state.value : Object.keys(state.value)[0]
  ) as CalendarSnapshot['state'];

  return {
    state: stateValue,
    selectedEvents: Array.from(context.selectedEvents),
    focusedEvent: context.focusedEvent,
    currentDate: context.currentDate,
    viewMode: context.viewMode,
    draggedEvent: context.draggedEvent,
    dragTargetDate: context.dragTargetDate,
    focusedDate: context.focusedDate,
  };
}

// =============================================================================
// Event Factory
// =============================================================================

export const CalendarEvents = {
  eventClick: (rowId: string, shiftKey: boolean, ctrlKey: boolean): CalendarEvent_Machine => ({
    type: 'EVENT_CLICK',
    rowId,
    shiftKey,
    ctrlKey,
  }),

  eventDoubleClick: (rowId: string): CalendarEvent_Machine => ({
    type: 'EVENT_DOUBLE_CLICK',
    rowId,
  }),

  dateClick: (date: Date, shiftKey: boolean): CalendarEvent_Machine => ({
    type: 'DATE_CLICK',
    date,
    shiftKey,
  }),

  dateDoubleClick: (date: Date): CalendarEvent_Machine => ({
    type: 'DATE_DOUBLE_CLICK',
    date,
  }),

  dragStart: (rowId: string): CalendarEvent_Machine => ({
    type: 'DRAG_START',
    rowId,
  }),

  dragMove: (targetDate: Date): CalendarEvent_Machine => ({
    type: 'DRAG_MOVE',
    targetDate,
  }),

  dragEnd: (): CalendarEvent_Machine => ({
    type: 'DRAG_END',
  }),

  dragCancel: (): CalendarEvent_Machine => ({
    type: 'DRAG_CANCEL',
  }),

  navigatePrev: (): CalendarEvent_Machine => ({
    type: 'NAVIGATE_PREV',
  }),

  navigateNext: (): CalendarEvent_Machine => ({
    type: 'NAVIGATE_NEXT',
  }),

  navigateToday: (): CalendarEvent_Machine => ({
    type: 'NAVIGATE_TODAY',
  }),

  changeViewMode: (mode: CalendarViewMode): CalendarEvent_Machine => ({
    type: 'CHANGE_VIEW_MODE',
    mode,
  }),

  keyboard: (key: string, shiftKey: boolean, ctrlKey: boolean): CalendarEvent_Machine => ({
    type: 'KEYBOARD',
    key,
    shiftKey,
    ctrlKey,
  }),

  clearSelection: (): CalendarEvent_Machine => ({
    type: 'CLEAR_SELECTION',
  }),

  selectAll: (rowIds: string[]): CalendarEvent_Machine => ({
    type: 'SELECT_ALL',
    rowIds,
  }),
} as const;

// =============================================================================
// Types Export
// =============================================================================

export type CalendarMachine = typeof calendarMachine;
export type CalendarActor = ActorRefFrom<CalendarMachine>;
export type CalendarState = SnapshotFrom<typeof calendarMachine>;
