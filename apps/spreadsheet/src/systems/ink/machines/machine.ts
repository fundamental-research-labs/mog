/**
 * Ink State Machine
 *
 * Manages drawing state transitions for the ink engine.
 * This machine is PURE - no side effects, only state transitions.
 * All persistence (Yjs writes) happens in the coordinator via transition detection.
 *
 * ARCHITECTURE NOTES:
 * - XState Machines Pure: No DOM access, no async operations, no side effects
 * - Actor Access Layer: Commands via send(), queries via selectors
 * - Transition Detection Pattern: Coordinator subscribes and reacts to transitions
 * - Performance-First Design: Mutable buffer for active stroke
 *
 * States:
 * - idle: Not in ink mode
 * - drawing: In ink mode, ready to draw
 * - stroking: Actively drawing a stroke
 * - erasingActive: Actively erasing strokes
 * - selecting: Performing lasso selection
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 4: State Machine / Coordinator Pattern
 */

import type { ActorRefFrom, SnapshotFrom } from 'xstate';
import { assign, setup } from 'xstate';

import type { InkContext, InkEvent, InkSelectionMode } from './types';
import { addPointToBuffer, createInitialInkContext, resetStrokeBuffer } from './types';

// =============================================================================
// MACHINE DEFINITION
// =============================================================================

/**
 * Ink state machine - manages drawing state transitions.
 *
 * IMPORTANT: This machine is PURE - no side effects!
 * All persistence (Yjs writes) happens in the coordinator via transition detection.
 */
export const inkMachine = setup({
  types: {} as {
    context: InkContext;
    events: InkEvent;
  },
}).createMachine({
  id: 'ink',
  initial: 'idle',
  context: createInitialInkContext,
  states: {
    // =========================================================================
    // IDLE STATE - Not in ink mode
    // =========================================================================
    idle: {
      on: {
        ACTIVATE: {
          target: 'drawing',
          actions: assign({
            targetDrawingId: ({ event }) => event.drawingId,
          }),
        },
      },
    },

    // =========================================================================
    // DRAWING STATE - In ink mode, ready to draw
    // =========================================================================
    drawing: {
      on: {
        DEACTIVATE: {
          target: 'idle',
          actions: assign({
            targetDrawingId: () => null,
            selectedStrokeIds: () => [],
            selectionMode: (): InkSelectionMode => 'none',
          }),
        },

        PEN_DOWN: {
          target: 'stroking',
          actions: assign({
            currentStrokeId: ({ event }) => event.strokeId,
            // Reset buffer and add first point (mutates context)
            currentStrokeBufferLength: ({ context, event }) => {
              resetStrokeBuffer(context);
              addPointToBuffer(context, event.point);
              return context.currentStrokeBufferLength;
            },
            lastPoint: ({ event }) => event.point,
          }),
        },

        ERASER_DOWN: {
          target: 'erasingActive',
          actions: assign({
            lastPoint: ({ event }) => event.point,
          }),
        },

        LASSO_START: {
          target: 'selecting',
          actions: assign({
            lassoPoints: ({ event }) => [event.point],
            selectionMode: (): InkSelectionMode => 'lasso',
          }),
        },

        SET_TOOL: {
          actions: assign({
            activeTool: ({ event }) => event.tool,
          }),
        },

        SET_COLOR: {
          actions: assign({
            activeColor: ({ event }) => event.color,
          }),
        },

        SET_WIDTH: {
          actions: assign({
            activeWidth: ({ event }) => event.width,
          }),
        },

        SET_OPACITY: {
          actions: assign({
            activeOpacity: ({ event }) => event.opacity,
          }),
        },

        SET_SELECTION_MODE: {
          actions: assign({
            selectionMode: ({ event }) => event.mode,
          }),
        },

        SET_SELECTED_STROKES: {
          actions: assign({
            selectedStrokeIds: ({ event }) => event.strokeIds,
          }),
        },

        CLEAR_SELECTION: {
          actions: assign({
            selectedStrokeIds: () => [],
            selectionMode: (): InkSelectionMode => 'none',
          }),
        },
      },
    },

    // =========================================================================
    // STROKING STATE - Actively drawing a stroke
    // =========================================================================
    stroking: {
      on: {
        PEN_MOVE: {
          actions: assign({
            // Mutate buffer in place - don't spread
            currentStrokeBufferLength: ({ context, event }) => {
              addPointToBuffer(context, event.point);
              return context.currentStrokeBufferLength;
            },
            lastPoint: ({ event }) => event.point,
          }),
        },

        PEN_UP: {
          target: 'drawing',
          // Don't clear stroke data here - coordinator needs it for persistence
          // Coordinator will call resetStrokeBuffer after committing to Yjs
          actions: assign({
            lastPoint: () => null,
          }),
        },

        // Allow deactivation even during stroking (cancel stroke)
        DEACTIVATE: {
          target: 'idle',
          actions: assign({
            targetDrawingId: () => null,
            currentStrokeId: () => null,
            currentStrokeBufferLength: ({ context }) => {
              resetStrokeBuffer(context);
              return 0;
            },
            selectedStrokeIds: () => [],
            selectionMode: (): InkSelectionMode => 'none',
            lastPoint: () => null,
          }),
        },
      },
    },

    // =========================================================================
    // ERASING ACTIVE STATE - Actively erasing strokes
    // =========================================================================
    erasingActive: {
      on: {
        ERASER_MOVE: {
          actions: assign({
            lastPoint: ({ event }) => event.point,
          }),
        },

        ERASER_UP: {
          target: 'drawing',
          actions: assign({
            lastPoint: () => null,
          }),
        },

        DEACTIVATE: {
          target: 'idle',
          actions: assign({
            targetDrawingId: () => null,
            lastPoint: () => null,
          }),
        },
      },
    },

    // =========================================================================
    // SELECTING STATE - Performing lasso selection
    // =========================================================================
    selecting: {
      on: {
        LASSO_MOVE: {
          actions: assign({
            lassoPoints: ({ context, event }) => [...context.lassoPoints, event.point],
          }),
        },

        LASSO_END: {
          target: 'drawing',
          // Keep lasso points - coordinator will compute selected strokes
        },

        DEACTIVATE: {
          target: 'idle',
          actions: assign({
            targetDrawingId: () => null,
            lassoPoints: () => [],
            selectionMode: (): InkSelectionMode => 'none',
          }),
        },
      },
    },
  },
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

/** Type of the ink machine definition */
export type InkMachine = typeof inkMachine;

/** Type for an actor reference to the ink machine */
export type InkActor = ActorRefFrom<InkMachine>;

/** Type for a snapshot of the ink machine state */
export type InkState = SnapshotFrom<InkMachine>;
