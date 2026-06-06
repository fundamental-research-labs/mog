/**
 * Renderer Lifecycle State Machine (PURE)
 *
 * Manages the lifecycle STATE of the canvas renderer. The coordinator executes
 * side effects based on state changes (Option A from DEPENDENCY-TIMING-ISSUE.md).
 *
 * States:
 * - unmounted: Initial state, no resources allocated
 * - waitingForLayout: Container mounted, waiting for dimensions
 * - initializing: Creating renderer and bridges (coordinator executes creation)
 * - ready: Fully operational, accepting actions
 * - switchingSheet: Transitioning between sheets
 * - suspended: Tab backgrounded, render loop paused
 * - error: Initialization or operation failed
 * - disposing: Cleaning up resources (coordinator executes cleanup)
 *
 * Key behaviors:
 * - Machine owns STATE only, coordinator owns EXECUTION
 * - No DOM manipulation in machine actions
 * - Pure state transitions, fully testable without mocking
 * - Coordinator subscribes to state and executes side effects
 *
 * @see ARCHITECTURE.md for design decisions
 * @see DEPENDENCY-TIMING-ISSUE.md for why this is pure
 */

import { assign, emit, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';

import { rendererSelectors } from '../../../selectors';
import type { RendererState as RendererSelectorState } from '@mog-sdk/contracts/actors/renderer';
import type { RenderPriority } from '@mog-sdk/contracts/rendering';
import type { CellCoord, CellRange, PendingAction, RendererSnapshot } from '../../shared/types';

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * Pure state context for the renderer machine.
 * Note: canvas and renderer instances are owned by the coordinator, not the machine.
 * The coordinator subscribes to state changes and executes side effects.
 */
export interface RendererContext {
  /** The container element for the canvas */
  container: HTMLElement | null;
  /** Current canvas width */
  width: number;
  /** Current canvas height */
  height: number;
  /** Currently active sheet ID */
  currentSheetId: string | null;
  /** Sheet ID being switched to */
  targetSheetId: string | null;
  /** Actions queued before renderer was ready */
  pendingActions: PendingAction[];
  /** Last error that occurred */
  error: Error | null;
  /** Number of retry attempts */
  retryCount: number;
  /** Maximum retry attempts before giving up */
  maxRetries: number;
}

const initialContext: RendererContext = {
  container: null,
  width: 0,
  height: 0,
  currentSheetId: null,
  targetSheetId: null,
  pendingActions: [],
  error: null,
  retryCount: 0,
  maxRetries: 3,
};

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Events for the renderer state machine.
 * Note: Side effects are executed by the coordinator based on state changes,
 * not by the machine directly.
 */
export type RendererEvent =
  | { type: 'MOUNT'; container: HTMLElement }
  | { type: 'LAYOUT_READY'; width: number; height: number }
  | { type: 'INITIALIZED'; sheetId: string }
  | { type: 'SWITCH_SHEET'; sheetId: string }
  | { type: 'SHEET_SWITCHED' }
  | { type: 'SUSPEND' }
  | { type: 'RESUME' }
  | { type: 'ERROR'; error: Error }
  | { type: 'RETRY' }
  | { type: 'UNMOUNT' }
  | { type: 'RESIZE'; width: number; height: number }
  | { type: 'QUEUE_ACTION'; action: PendingAction }
  | { type: 'INVALIDATE'; priority: RenderPriority; regions?: CellRange[] }
  | { type: 'SCROLL_TO_ACTIVE_CELL'; cell: CellCoord }
  | {
      type: 'SCROLL_PAGE';
      axis: 'horizontal' | 'vertical';
      direction: 'previous' | 'next';
      cell: CellCoord;
    };

/**
 * Emitted events broadcast by the machine to subscribers via `actor.on()`.
 *
 * The machine emits these for cross-system side effects that need access to
 * runtime resources (coordinate system, DOM, scroll engine) which the pure
 * machine intentionally does not hold. Subscribers in RenderSystem react.
 */
export type RendererEmitted =
  | {
      type: 'scrollToActiveCellRequested';
      cell: CellCoord;
    }
  | {
      type: 'pageScrollRequested';
      axis: 'horizontal' | 'vertical';
      direction: 'previous' | 'next';
      cell: CellCoord;
    };

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the renderer machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const RendererEvents = {
  mount: (container: HTMLElement): RendererEvent => ({
    type: 'MOUNT',
    container,
  }),

  layoutReady: (width: number, height: number): RendererEvent => ({
    type: 'LAYOUT_READY',
    width,
    height,
  }),

  initialized: (sheetId: string): RendererEvent => ({
    type: 'INITIALIZED',
    sheetId,
  }),

  switchSheet: (sheetId: string): RendererEvent => ({
    type: 'SWITCH_SHEET',
    sheetId,
  }),

  sheetSwitched: (): RendererEvent => ({
    type: 'SHEET_SWITCHED',
  }),

  suspend: (): RendererEvent => ({
    type: 'SUSPEND',
  }),

  resume: (): RendererEvent => ({
    type: 'RESUME',
  }),

  error: (error: Error): RendererEvent => ({
    type: 'ERROR',
    error,
  }),

  retry: (): RendererEvent => ({
    type: 'RETRY',
  }),

  unmount: (): RendererEvent => ({
    type: 'UNMOUNT',
  }),

  resize: (width: number, height: number): RendererEvent => ({
    type: 'RESIZE',
    width,
    height,
  }),

  queueAction: (action: PendingAction): RendererEvent => ({
    type: 'QUEUE_ACTION',
    action,
  }),

  invalidate: (priority: RenderPriority, regions?: CellRange[]): RendererEvent => ({
    type: 'INVALIDATE',
    priority,
    regions,
  }),

  scrollToActiveCell: (cell: CellCoord): RendererEvent => ({
    type: 'SCROLL_TO_ACTIVE_CELL',
    cell,
  }),

  scrollPage: (
    axis: 'horizontal' | 'vertical',
    direction: 'previous' | 'next',
    cell: CellCoord,
  ): RendererEvent => ({
    type: 'SCROLL_PAGE',
    axis,
    direction,
    cell,
  }),
} as const;

// =============================================================================
// MACHINE DEFINITION
// =============================================================================

export const rendererMachine = setup({
  types: {
    context: {} as RendererContext,
    events: {} as RendererEvent,
    emitted: {} as RendererEmitted,
  },
  actions: {
    // =========================================================================
    // PURE STATE ACTIONS - No side effects, only context updates
    // =========================================================================

    // Store container reference
    setContainer: assign(({ event }) => {
      if (event.type !== 'MOUNT') return {};
      return { container: event.container };
    }),

    // Store layout dimensions
    setDimensions: assign(({ event }) => {
      if (event.type !== 'LAYOUT_READY' && event.type !== 'RESIZE') return {};
      return {
        width: event.width,
        height: event.height,
      };
    }),

    // Set current sheet ID after initialization
    setCurrentSheet: assign(({ event }) => {
      if (event.type !== 'INITIALIZED') return {};
      return { currentSheetId: event.sheetId };
    }),

    // Store target sheet for switching
    setTargetSheet: assign(({ event }) => {
      if (event.type !== 'SWITCH_SHEET') return {};
      return { targetSheetId: event.sheetId };
    }),

    // Complete sheet switch
    completeSheetSwitch: assign(({ context }) => ({
      currentSheetId: context.targetSheetId,
      targetSheetId: null,
    })),

    // Queue a pending action (before ready)
    queueAction: assign(({ context, event }) => {
      if (event.type !== 'QUEUE_ACTION') return {};
      return {
        pendingActions: [...context.pendingActions, event.action],
      };
    }),

    // Clear pending actions (after applying)
    clearPendingActions: assign(() => ({
      pendingActions: [],
    })),

    // Store error
    setError: assign(({ event }) => {
      if (event.type !== 'ERROR') return {};
      return { error: event.error };
    }),

    // Increment retry count
    incrementRetry: assign(({ context }) => ({
      retryCount: context.retryCount + 1,
    })),

    // Reset retry count (on success)
    resetRetryCount: assign(() => ({
      retryCount: 0,
      error: null,
    })),

    // Clear all resources on dispose
    clearResources: assign(() => ({
      container: null,
      width: 0,
      height: 0,
      currentSheetId: null,
      targetSheetId: null,
      pendingActions: [],
      error: null,
    })),

    // Emit a scroll-to-active-cell request to subscribers (RenderSystem
    // listens via actor.on() and applies via coordinate system + scroll).
    // Keeps the machine pure: no DOM/coord access here.
    emitScrollToActiveCellRequested: emit(({ event }) => {
      if (event.type !== 'SCROLL_TO_ACTIVE_CELL') {
        // Defensive: action should only run on this event type. Emit a
        // sentinel that is ignored downstream.
        return { type: 'scrollToActiveCellRequested', cell: { row: 0, col: 0 } };
      }
      return { type: 'scrollToActiveCellRequested', cell: event.cell };
    }),

    // Emit a page-scroll request to subscribers. Page navigation differs from
    // viewport-follow: it scrolls one rendered page even when the destination
    // active cell would be visible after a minimal nudge.
    emitPageScrollRequested: emit(({ event }) => {
      if (event.type !== 'SCROLL_PAGE') {
        return {
          type: 'pageScrollRequested',
          axis: 'horizontal',
          direction: 'next',
          cell: { row: 0, col: 0 },
        };
      }
      return {
        type: 'pageScrollRequested',
        axis: event.axis,
        direction: event.direction,
        cell: event.cell,
      };
    }),
  },
  guards: {
    // Check if we can retry
    canRetry: ({ context }) => context.retryCount < context.maxRetries,
    // Check if there's a sheet switch pending
    hasPendingSheetSwitch: ({ context }) => context.targetSheetId !== null,
    // Check if dimensions are valid
    hasValidDimensions: ({ context }) => context.width > 0 && context.height > 0,
    // Check if same sheet (no-op switch)
    isSameSheet: ({ context, event }) => {
      if (event.type !== 'SWITCH_SHEET') return false;
      return context.currentSheetId === event.sheetId;
    },
  },
}).createMachine({
  id: 'renderer',
  initial: 'unmounted',
  context: initialContext,

  states: {
    // =========================================================================
    // UNMOUNTED - Initial state, no resources allocated
    // =========================================================================
    unmounted: {
      on: {
        MOUNT: {
          target: 'waitingForLayout',
          actions: 'setContainer',
        },
      },
    },

    // =========================================================================
    // WAITING_FOR_LAYOUT - Container mounted, waiting for dimensions
    // Coordinator creates canvas when machine enters this state
    // =========================================================================
    waitingForLayout: {
      on: {
        LAYOUT_READY: {
          target: 'initializing',
          actions: 'setDimensions',
        },
        // Handle RESIZE the same as LAYOUT_READY - this fixes a timing issue where
        // the container may not have dimensions when the lifecycle effect first runs,
        // but the ResizeObserver fires later with valid dimensions.
        RESIZE: {
          target: 'initializing',
          actions: 'setDimensions',
        },
        // Can queue actions while waiting
        QUEUE_ACTION: {
          actions: 'queueAction',
        },
        UNMOUNT: {
          target: 'disposing',
        },
      },
    },

    // =========================================================================
    // INITIALIZING - Creating renderer and bridges
    // Coordinator creates renderer when machine enters this state
    // =========================================================================
    initializing: {
      on: {
        INITIALIZED: {
          target: 'ready',
          actions: ['setCurrentSheet', 'resetRetryCount', 'clearPendingActions'],
        },
        ERROR: {
          target: 'error',
          actions: 'setError',
        },
        // Can queue actions while initializing
        QUEUE_ACTION: {
          actions: 'queueAction',
        },
        UNMOUNT: {
          target: 'disposing',
        },
      },
    },

    // =========================================================================
    // READY - Fully operational, accepting actions
    // Coordinator starts render loop when machine enters this state
    // =========================================================================
    ready: {
      on: {
        SWITCH_SHEET: [
          {
            // No-op if switching to same sheet
            guard: 'isSameSheet',
          },
          {
            target: 'switchingSheet',
            actions: 'setTargetSheet',
          },
        ],
        SUSPEND: {
          target: 'suspended',
        },
        ERROR: {
          target: 'error',
          actions: 'setError',
        },
        RESIZE: {
          // Update dimensions in context (coordinator resizes renderer)
          actions: 'setDimensions',
        },
        INVALIDATE: {
          // Stay in ready, coordinator handles invalidation
        },
        SCROLL_TO_ACTIVE_CELL: {
          // Stay in ready; emit a request so RenderSystem applies the scroll.
          // The machine remains pure — coordinate-system + scroll application
          // live in RenderSystem (actor.on subscriber).
          actions: 'emitScrollToActiveCellRequested',
        },
        SCROLL_PAGE: {
          // Stay in ready; emit a request so RenderSystem applies a page-sized
          // scroll based on the live rendered viewport.
          actions: 'emitPageScrollRequested',
        },
        UNMOUNT: {
          target: 'disposing',
        },
      },
    },

    // =========================================================================
    // SWITCHING_SHEET - Transitioning between sheets
    // Coordinator switches renderer sheet when machine enters this state
    // =========================================================================
    switchingSheet: {
      on: {
        SHEET_SWITCHED: {
          target: 'ready',
          actions: 'completeSheetSwitch',
        },
        // Handle rapid sheet switching - update target
        SWITCH_SHEET: {
          actions: 'setTargetSheet',
        },
        ERROR: {
          target: 'error',
          actions: 'setError',
        },
        SUSPEND: {
          target: 'suspended',
        },
        UNMOUNT: {
          target: 'disposing',
        },
      },
    },

    // =========================================================================
    // SUSPENDED - Tab backgrounded, render loop paused
    // Coordinator pauses render loop when machine enters this state
    // =========================================================================
    suspended: {
      on: {
        RESUME: [
          {
            // If there was a pending sheet switch, continue it
            target: 'switchingSheet',
            guard: 'hasPendingSheetSwitch',
          },
          {
            target: 'ready',
          },
        ],
        // Can still switch sheets while suspended (will resume to switchingSheet)
        SWITCH_SHEET: {
          actions: 'setTargetSheet',
        },
        UNMOUNT: {
          target: 'disposing',
        },
      },
    },

    // =========================================================================
    // ERROR - Initialization or operation failed
    // =========================================================================
    error: {
      on: {
        RETRY: [
          {
            target: 'initializing',
            guard: 'canRetry',
            actions: 'incrementRetry',
          },
          {
            // Max retries exceeded - stay in error
          },
        ],
        UNMOUNT: {
          target: 'disposing',
        },
      },
    },

    // =========================================================================
    // DISPOSING - Cleaning up resources
    // Coordinator disposes renderer and canvas when machine enters this state
    // =========================================================================
    disposing: {
      entry: 'clearResources',
      always: {
        target: 'unmounted',
      },
    },
  },
});

// =============================================================================
// SNAPSHOT HELPER
// =============================================================================

/**
 * Extract RendererSnapshot from machine state for external consumers.
 *
 * ARCHITECTURE: This function composes selectors (the single primitive).
 * All extraction logic is defined once in rendererSelectors.
 */
export function getRendererSnapshot(
  state: ReturnType<typeof rendererMachine.getInitialSnapshot>,
): RendererSnapshot {
  // Cast state to compatible type for selectors
  const s = state as RendererSelectorState;

  return {
    status: rendererSelectors.status(s),
    currentSheetId: rendererSelectors.currentSheetId(s),
    isSwitching: rendererSelectors.isSwitching(s),
  };
}

// =============================================================================
// PENDING ACTION HELPERS
// =============================================================================

/**
 * Create a pending selection action.
 */
export function createPendingSelection(ranges: CellRange[], activeCell: CellCoord): PendingAction {
  return { type: 'setSelection', ranges, activeCell };
}

/**
 * Create a pending scroll action.
 */
export function createPendingScroll(top: number, left: number): PendingAction {
  return { type: 'scrollTo', top, left };
}

/**
 * Create a pending invalidation action.
 */
export function createPendingInvalidate(
  priority: RenderPriority,
  regions?: CellRange[],
): PendingAction {
  return { type: 'invalidate', priority, regions };
}

// =============================================================================
// ACTOR TYPES
// =============================================================================

export type RendererMachine = typeof rendererMachine;
export type RendererActor = ActorRefFrom<RendererMachine>;
export type RendererState = SnapshotFrom<RendererMachine>;
