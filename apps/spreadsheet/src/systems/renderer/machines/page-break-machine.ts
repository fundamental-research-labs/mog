/**
 * Page Break Drag State Machine
 *
 * Manages the state for dragging page break lines in Page Break Preview mode.
 * Page breaks can be horizontal (between rows) or vertical (between columns),
 * and users can drag them to reposition where page boundaries occur during printing.
 *
 * Key design principles:
 * 1. Machine is PURE - no side effects (coordinator handles all DOM/store operations)
 * 2. Tracks drag state: origin position, current position, break type/orientation
 * 3. Supports both manual page breaks and automatic page breaks
 *
 */

import type { ActorRefFrom, SnapshotFrom } from 'xstate';
import { assign, setup } from 'xstate';

import { pageBreakSelectors } from '../../../selectors';
import type {
  PageBreakInfo,
  PageBreakOrientation,
  PageBreakType,
} from '@mog-sdk/contracts/rendering';

// Re-export types from contracts for consumers that import from this file
export type { PageBreakInfo, PageBreakOrientation, PageBreakType };

/**
 * Context for the page break drag machine.
 */
export interface PageBreakDragContext {
  /** Information about the page break being dragged (null when idle) */
  pageBreak: PageBreakInfo | null;
  /** Starting mouse position in pixels */
  startPosition: { x: number; y: number };
  /** Current mouse position in pixels during drag */
  currentPosition: { x: number; y: number };
  /** Current target position (row/col index the break would move to) */
  targetPosition: number | null;
}

/**
 * Machine state values.
 */
export type PageBreakMachineState = 'idle' | 'dragging';

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Events for the page break drag machine.
 */
export type PageBreakEvent =
  | {
      type: 'START_DRAG';
      pageBreak: PageBreakInfo;
      startX: number;
      startY: number;
    }
  | {
      type: 'DRAG';
      x: number;
      y: number;
      targetPosition: number;
    }
  | {
      type: 'END_DRAG';
    }
  | {
      type: 'CANCEL';
    };

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the page break machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const PageBreakEvents = {
  startDrag: (pageBreak: PageBreakInfo, startX: number, startY: number): PageBreakEvent => ({
    type: 'START_DRAG',
    pageBreak,
    startX,
    startY,
  }),

  drag: (x: number, y: number, targetPosition: number): PageBreakEvent => ({
    type: 'DRAG',
    x,
    y,
    targetPosition,
  }),

  endDrag: (): PageBreakEvent => ({
    type: 'END_DRAG',
  }),

  cancel: (): PageBreakEvent => ({
    type: 'CANCEL',
  }),
} as const;

// =============================================================================
// INITIAL CONTEXT
// =============================================================================

const initialContext: PageBreakDragContext = {
  pageBreak: null,
  startPosition: { x: 0, y: 0 },
  currentPosition: { x: 0, y: 0 },
  targetPosition: null,
};

// =============================================================================
// STATE MACHINE
// =============================================================================

export const pageBreakMachine = setup({
  types: {
    context: {} as PageBreakDragContext,
    events: {} as PageBreakEvent,
  },

  guards: {
    /**
     * Check if a valid page break is being dragged.
     */
    hasPageBreak: ({ context }) => context.pageBreak !== null,

    /**
     * Check if the target position is different from the original.
     */
    hasMovedFromOriginal: ({ context }) =>
      context.pageBreak !== null &&
      context.targetPosition !== null &&
      context.targetPosition !== context.pageBreak.originalPosition,
  },

  actions: {
    /**
     * Initialize drag state with the page break info and start position.
     */
    initDrag: assign(({ event }) => {
      if (event.type !== 'START_DRAG') return {};
      return {
        pageBreak: event.pageBreak,
        startPosition: { x: event.startX, y: event.startY },
        currentPosition: { x: event.startX, y: event.startY },
        targetPosition: event.pageBreak.originalPosition,
      };
    }),

    /**
     * Update current position and target during drag.
     */
    updateDrag: assign(({ event }) => {
      if (event.type !== 'DRAG') return {};
      return {
        currentPosition: { x: event.x, y: event.y },
        targetPosition: event.targetPosition,
      };
    }),

    /**
     * Reset context to initial state.
     */
    reset: assign(() => initialContext),
  },
}).createMachine({
  id: 'pageBreakDrag',
  initial: 'idle',
  context: initialContext,

  states: {
    // =========================================================================
    // IDLE - No drag in progress, waiting for user interaction
    // =========================================================================
    idle: {
      on: {
        START_DRAG: {
          target: 'dragging',
          actions: 'initDrag',
        },
      },
    },

    // =========================================================================
    // DRAGGING - User is actively dragging a page break line
    // =========================================================================
    dragging: {
      on: {
        DRAG: {
          actions: 'updateDrag',
        },
        END_DRAG: {
          target: 'idle',
          actions: 'reset',
        },
        CANCEL: {
          target: 'idle',
          actions: 'reset',
        },
      },
    },
  },
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type PageBreakMachine = typeof pageBreakMachine;
export type PageBreakActor = ActorRefFrom<PageBreakMachine>;
export type PageBreakState = SnapshotFrom<PageBreakMachine>;

// =============================================================================
// HELPER TO EXTRACT SNAPSHOT
// =============================================================================

/**
 * Extract a simplified snapshot from the machine state.
 * Used by the coordinator and hooks.
 *
 * ARCHITECTURE: This function composes selectors - the single source of truth.
 * All extraction logic is delegated to pageBreakSelectors.
 * @see contracts/src/actors/page-break.ts
 */
export function getPageBreakSnapshot(state: PageBreakState): {
  machineState: PageBreakMachineState;
  isDragging: boolean;
  pageBreak: PageBreakInfo | null;
  startPosition: { x: number; y: number };
  currentPosition: { x: number; y: number };
  targetPosition: number | null;
  hasMoved: boolean;
} {
  // Cast state to selector-compatible type
  const s = state as Parameters<(typeof pageBreakSelectors)['pageBreak']>[0];

  return {
    machineState: pageBreakSelectors.machineState(s) as PageBreakMachineState,

    // State matching selector
    isDragging: pageBreakSelectors.isDragging(s),

    // Value selectors
    pageBreak: pageBreakSelectors.pageBreak(s),
    startPosition: pageBreakSelectors.startPosition(s),
    currentPosition: pageBreakSelectors.currentPosition(s),
    targetPosition: pageBreakSelectors.targetPosition(s),

    // Derived selector
    hasMoved: pageBreakSelectors.hasMoved(s),
  };
}
