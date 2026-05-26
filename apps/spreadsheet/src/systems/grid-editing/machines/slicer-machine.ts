/**
 * Slicer State Machine
 *
 *
 * Handles interaction states for slicer visual filter controls.
 * Slicers are floating objects that provide multi-select filtering for
 * Tables and Pivot Tables.
 *
 * States:
 * - idle: Slicer visible but not being interacted with
 * - hovering: Mouse over slicer (shows hover effects)
 * - multiSelecting: Ctrl+click multi-select mode
 * - delegatingDrag: Moving the slicer (delegated to object-interaction-machine)
 * - delegatingResize: Resizing slicer (delegated to object-interaction-machine)
 *
 * Architecture Notes:
 * - Filter state is the source of truth for selection (not stored in slicer)
 * - Selection changes flow through bridge → filter → row visibility → render
 * - Drag/resize operations are delegated to object-interaction-machine
 * - Machines stay pure (no side effects) - coordinator executes side effects
 *
 */

import { type ActorRefFrom, assign, setup } from 'xstate';

import { slicerSelectors } from '../../../selectors';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * Slicer machine context.
 *
 * NOTE: Selected values are NOT stored here - they are derived from the
 * underlying filter state. This ensures single source of truth.
 */
export interface SlicerContext {
  /** ID of the slicer being interacted with (null if no slicer focused) */
  slicerId: string | null;
  /** Sheet containing the slicer */
  sheetId: SheetId | null;
  /** Last clicked value (for shift+click range selection) */
  lastClickedValue: CellValue | undefined;
  /** Currently hovered item value (for hover effects) */
  hoveredValue: CellValue | undefined;
  /** Whether multi-select mode is active (Ctrl key held) */
  isMultiSelectActive: boolean;
  /** Error message (for disconnected state, etc.) */
  errorMessage: string | null;
  /** Whether slicer is in disconnected state (source column deleted) */
  isDisconnected: boolean;
}

const initialContext: SlicerContext = {
  slicerId: null,
  sheetId: null,
  lastClickedValue: undefined,
  hoveredValue: undefined,
  isMultiSelectActive: false,
  errorMessage: null,
  isDisconnected: false,
};

// =============================================================================
// EVENTS
// =============================================================================

export type SlicerEvent =
  // Focus events
  | { type: 'FOCUS_SLICER'; slicerId: string; sheetId: SheetId }
  | { type: 'BLUR_SLICER' }
  // Mouse events
  | { type: 'MOUSE_ENTER'; slicerId: string }
  | { type: 'MOUSE_LEAVE' }
  | {
      type: 'ITEM_CLICK';
      value: CellValue;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    }
  | { type: 'ITEM_HOVER'; value: CellValue }
  | { type: 'ITEM_HOVER_END' }
  | { type: 'CLEAR_ALL_CLICK' }
  // Keyboard events
  | { type: 'KEY_DOWN'; key: string; ctrlKey: boolean; metaKey: boolean }
  | { type: 'KEY_UP'; key: string }
  // Delegation events (to/from object-interaction-machine)
  | { type: 'DRAG_START' }
  | { type: 'DRAG_END'; newPosition?: { x: number; y: number } }
  | { type: 'RESIZE_START' }
  | { type: 'RESIZE_END'; newSize?: { width: number; height: number } }
  // External update events
  | {
      type: 'FILTER_CHANGED';
      slicerId: string;
      selectedValues: CellValue[];
    }
  | { type: 'CACHE_REFRESHED'; slicerId: string }
  | { type: 'REMOTE_UPDATE'; slicerId: string }
  | {
      type: 'DISCONNECTED';
      slicerId: string;
      reason: 'columnDeleted' | 'tableDeleted' | 'pivotDeleted';
    }
  | { type: 'RECONNECTED'; slicerId: string }
  // Selection committed (for bridge to apply filter)
  | { type: 'SELECTION_COMMITTED'; selectedValues: CellValue[] };

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the slicer machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const SlicerEvents = {
  focusSlicer: (slicerId: string, sheetId: SheetId): SlicerEvent => ({
    type: 'FOCUS_SLICER',
    slicerId,
    sheetId,
  }),

  blurSlicer: (): SlicerEvent => ({
    type: 'BLUR_SLICER',
  }),

  mouseEnter: (slicerId: string): SlicerEvent => ({
    type: 'MOUSE_ENTER',
    slicerId,
  }),

  mouseLeave: (): SlicerEvent => ({
    type: 'MOUSE_LEAVE',
  }),

  itemClick: (
    value: CellValue,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  ): SlicerEvent => ({
    type: 'ITEM_CLICK',
    value,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
  }),

  itemHover: (value: CellValue): SlicerEvent => ({
    type: 'ITEM_HOVER',
    value,
  }),

  itemHoverEnd: (): SlicerEvent => ({
    type: 'ITEM_HOVER_END',
  }),

  clearAllClick: (): SlicerEvent => ({
    type: 'CLEAR_ALL_CLICK',
  }),

  keyDown: (
    key: string,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
  ): SlicerEvent => ({
    type: 'KEY_DOWN',
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
  }),

  keyUp: (key: string): SlicerEvent => ({
    type: 'KEY_UP',
    key,
  }),

  dragStart: (): SlicerEvent => ({
    type: 'DRAG_START',
  }),

  dragEnd: (newPosition?: { x: number; y: number }): SlicerEvent => ({
    type: 'DRAG_END',
    newPosition,
  }),

  resizeStart: (): SlicerEvent => ({
    type: 'RESIZE_START',
  }),

  resizeEnd: (newSize?: { width: number; height: number }): SlicerEvent => ({
    type: 'RESIZE_END',
    newSize,
  }),

  filterChanged: (slicerId: string, selectedValues: CellValue[]): SlicerEvent => ({
    type: 'FILTER_CHANGED',
    slicerId,
    selectedValues,
  }),

  cacheRefreshed: (slicerId: string): SlicerEvent => ({
    type: 'CACHE_REFRESHED',
    slicerId,
  }),

  remoteUpdate: (slicerId: string): SlicerEvent => ({
    type: 'REMOTE_UPDATE',
    slicerId,
  }),

  disconnected: (
    slicerId: string,
    reason: 'columnDeleted' | 'tableDeleted' | 'pivotDeleted',
  ): SlicerEvent => ({
    type: 'DISCONNECTED',
    slicerId,
    reason,
  }),

  reconnected: (slicerId: string): SlicerEvent => ({
    type: 'RECONNECTED',
    slicerId,
  }),

  selectionCommitted: (selectedValues: CellValue[]): SlicerEvent => ({
    type: 'SELECTION_COMMITTED',
    selectedValues,
  }),
} as const;

// =============================================================================
// MACHINE DEFINITION
// =============================================================================

export const slicerMachine = setup({
  types: {
    context: {} as SlicerContext,
    events: {} as SlicerEvent,
  },
  guards: {
    /** Check if multi-select modifier key is held (Ctrl or Cmd on Mac) */
    isMultiSelectKey: ({ event }) =>
      event.type === 'ITEM_CLICK' && (event.ctrlKey || event.metaKey),

    /** Check if shift key is held (for range selection) */
    isShiftSelect: ({ event }) => event.type === 'ITEM_CLICK' && event.shiftKey,

    /** Check if multi-select key was released */
    wasMultiSelectKey: ({ event }) =>
      event.type === 'KEY_UP' && (event.key === 'Control' || event.key === 'Meta'),

    /** Check if slicer is focused */
    hasFocusedSlicer: ({ context }) => context.slicerId !== null,

    /** Check if slicer is disconnected */
    isDisconnected: ({ context }) => context.isDisconnected,
  },
  actions: {
    /** Set the focused slicer */
    setFocusedSlicer: assign(({ event }) => {
      if (event.type !== 'FOCUS_SLICER') return {};
      return {
        slicerId: event.slicerId,
        sheetId: event.sheetId,
        isDisconnected: false,
        errorMessage: null,
      };
    }),

    /** Clear the focused slicer */
    clearFocusedSlicer: assign(() => ({
      slicerId: null,
      sheetId: null,
      lastClickedValue: undefined,
      hoveredValue: undefined,
      isMultiSelectActive: false,
    })),

    /** Set hovered item */
    setHoveredItem: assign(({ event }) => {
      if (event.type !== 'ITEM_HOVER') return {};
      return { hoveredValue: event.value };
    }),

    /** Clear hovered item */
    clearHoveredItem: assign(() => ({
      hoveredValue: undefined,
    })),

    /** Record last clicked value (for shift+click range selection) */
    recordLastClick: assign(({ event }) => {
      if (event.type !== 'ITEM_CLICK') return {};
      return { lastClickedValue: event.value };
    }),

    /** Enable multi-select mode */
    enableMultiSelect: assign(() => ({
      isMultiSelectActive: true,
    })),

    /** Disable multi-select mode */
    disableMultiSelect: assign(() => ({
      isMultiSelectActive: false,
    })),

    /** Mark slicer as disconnected */
    markDisconnected: assign(({ event }) => {
      if (event.type !== 'DISCONNECTED') return {};
      const reasonMessages: Record<string, string> = {
        columnDeleted: 'Source column was deleted',
        tableDeleted: 'Source table was deleted',
        pivotDeleted: 'Source pivot table was deleted',
      };
      return {
        isDisconnected: true,
        errorMessage: reasonMessages[event.reason] ?? 'Slicer disconnected',
      };
    }),

    /** Mark slicer as reconnected */
    markReconnected: assign(() => ({
      isDisconnected: false,
      errorMessage: null,
    })),

    /** Clear last clicked on clear all */
    clearLastClicked: assign(() => ({
      lastClickedValue: undefined,
    })),
  },
}).createMachine({
  id: 'slicer',
  initial: 'idle',
  context: initialContext,

  states: {
    // =========================================================================
    // IDLE - Slicer visible but not being interacted with
    // =========================================================================
    idle: {
      on: {
        FOCUS_SLICER: {
          actions: 'setFocusedSlicer',
        },
        MOUSE_ENTER: {
          target: 'hovering',
          actions: 'setFocusedSlicer',
        },
        // Handle clicks even when not hovering (e.g., touch devices)
        ITEM_CLICK: [
          {
            guard: 'isMultiSelectKey',
            target: 'multiSelecting',
            actions: 'recordLastClick',
          },
          {
            actions: 'recordLastClick',
          },
        ],
        CLEAR_ALL_CLICK: {
          actions: 'clearLastClicked',
        },
        // Delegation events - slicer header drag
        DRAG_START: 'delegatingDrag',
        RESIZE_START: 'delegatingResize',
        // External updates
        FILTER_CHANGED: {
          // Machine doesn't store selection - this is for coordinator coordination
        },
        CACHE_REFRESHED: {
          // Signals UI to re-render with fresh cache
        },
        REMOTE_UPDATE: {
          // Remote changes synced via Yjs
        },
        DISCONNECTED: {
          target: 'disconnected',
          actions: 'markDisconnected',
        },
      },
    },

    // =========================================================================
    // HOVERING - Mouse over slicer (shows hover effects)
    // =========================================================================
    hovering: {
      on: {
        MOUSE_LEAVE: {
          target: 'idle',
          actions: 'clearHoveredItem',
        },
        BLUR_SLICER: {
          target: 'idle',
          actions: ['clearFocusedSlicer', 'clearHoveredItem'],
        },
        ITEM_HOVER: {
          actions: 'setHoveredItem',
        },
        ITEM_HOVER_END: {
          actions: 'clearHoveredItem',
        },
        ITEM_CLICK: [
          {
            guard: 'isMultiSelectKey',
            target: 'multiSelecting',
            actions: ['recordLastClick', 'enableMultiSelect'],
          },
          {
            target: 'idle',
            actions: 'recordLastClick',
          },
        ],
        CLEAR_ALL_CLICK: {
          target: 'idle',
          actions: 'clearLastClicked',
        },
        // Delegation events
        DRAG_START: {
          target: 'delegatingDrag',
          actions: 'clearHoveredItem',
        },
        RESIZE_START: {
          target: 'delegatingResize',
          actions: 'clearHoveredItem',
        },
        // External updates
        FILTER_CHANGED: {},
        CACHE_REFRESHED: {},
        REMOTE_UPDATE: {},
        DISCONNECTED: {
          target: 'disconnected',
          actions: 'markDisconnected',
        },
      },
    },

    // =========================================================================
    // MULTI-SELECTING - Ctrl+click multi-select mode
    // =========================================================================
    multiSelecting: {
      on: {
        ITEM_CLICK: [
          {
            guard: 'isMultiSelectKey',
            // Stay in multi-selecting, record click
            actions: 'recordLastClick',
          },
          {
            // Multi-select key released, do single select
            target: 'idle',
            actions: ['recordLastClick', 'disableMultiSelect'],
          },
        ],
        MOUSE_LEAVE: {
          target: 'idle',
          actions: ['clearHoveredItem', 'disableMultiSelect'],
        },
        BLUR_SLICER: {
          target: 'idle',
          actions: ['clearFocusedSlicer', 'clearHoveredItem', 'disableMultiSelect'],
        },
        KEY_UP: {
          guard: 'wasMultiSelectKey',
          target: 'hovering',
          actions: 'disableMultiSelect',
        },
        ITEM_HOVER: {
          actions: 'setHoveredItem',
        },
        ITEM_HOVER_END: {
          actions: 'clearHoveredItem',
        },
        CLEAR_ALL_CLICK: {
          target: 'idle',
          actions: ['clearLastClicked', 'disableMultiSelect'],
        },
        // External updates
        FILTER_CHANGED: {},
        CACHE_REFRESHED: {},
        REMOTE_UPDATE: {},
        DISCONNECTED: {
          target: 'disconnected',
          actions: ['markDisconnected', 'disableMultiSelect'],
        },
      },
    },

    // =========================================================================
    // DELEGATING_DRAG - Moving the slicer (delegated to object-interaction-machine)
    // =========================================================================
    delegatingDrag: {
      on: {
        DRAG_END: {
          target: 'idle',
        },
        // Can receive disconnected while dragging
        DISCONNECTED: {
          target: 'disconnected',
          actions: 'markDisconnected',
        },
      },
    },

    // =========================================================================
    // DELEGATING_RESIZE - Resizing slicer (delegated to object-interaction-machine)
    // =========================================================================
    delegatingResize: {
      on: {
        RESIZE_END: {
          target: 'idle',
        },
        // Can receive disconnected while resizing
        DISCONNECTED: {
          target: 'disconnected',
          actions: 'markDisconnected',
        },
      },
    },

    // =========================================================================
    // DISCONNECTED - Source column/table/pivot was deleted
    // =========================================================================
    disconnected: {
      on: {
        RECONNECTED: {
          target: 'idle',
          actions: 'markReconnected',
        },
        // Can still move/resize disconnected slicers
        DRAG_START: 'delegatingDrag',
        RESIZE_START: 'delegatingResize',
        // Can blur/unfocus
        BLUR_SLICER: {
          target: 'idle',
          actions: 'clearFocusedSlicer',
        },
        MOUSE_LEAVE: {
          target: 'idle',
        },
      },
    },
  },
});

// =============================================================================
// TYPES
// =============================================================================

export type SlicerMachine = typeof slicerMachine;
export type SlicerActor = ActorRefFrom<SlicerMachine>;
export type SlicerState = ReturnType<SlicerMachine['transition']>['value'];

// =============================================================================
// SNAPSHOT HELPER
// =============================================================================

/**
 * What the slicer machine exposes to consumers.
 */
export interface SlicerSnapshot {
  /** Current state */
  state: SlicerState;
  /** ID of focused slicer (null if none) */
  slicerId: string | null;
  /** Sheet containing focused slicer */
  sheetId: SheetId | null;
  /** Whether hovering over slicer */
  isHovering: boolean;
  /** Whether in multi-select mode */
  isMultiSelecting: boolean;
  /** Whether dragging the slicer */
  isDragging: boolean;
  /** Whether resizing the slicer */
  isResizing: boolean;
  /** Whether slicer is disconnected from data source */
  isDisconnected: boolean;
  /** Currently hovered item value */
  hoveredValue: CellValue | undefined;
  /** Error message (for disconnected state) */
  errorMessage: string | null;
}

/**
 * Extract SlicerSnapshot from machine state for external consumers.
 *
 * ARCHITECTURE: This function composes selectors - the single source of truth.
 * All extraction logic is delegated to slicerSelectors.
 * @see contracts/src/actors/slicer.ts
 */
export function getSlicerSnapshot(
  state: ReturnType<typeof slicerMachine.getInitialSnapshot>,
): SlicerSnapshot {
  // Cast state to selector-compatible type
  const s = state as Parameters<(typeof slicerSelectors)['slicerId']>[0];

  return {
    state: slicerSelectors.machineState(s) as SlicerState,

    // Value selectors
    slicerId: slicerSelectors.slicerId(s),
    sheetId: slicerSelectors.sheetId(s),
    hoveredValue: slicerSelectors.hoveredValue(s),
    errorMessage: slicerSelectors.errorMessage(s),

    // State matching selectors
    isHovering: slicerSelectors.isHovering(s),
    isMultiSelecting: slicerSelectors.isMultiSelecting(s),
    isDragging: slicerSelectors.isDragging(s),
    isResizing: slicerSelectors.isResizing(s),

    // Derived selector
    isDisconnected: slicerSelectors.isDisconnected(s),
  };
}
