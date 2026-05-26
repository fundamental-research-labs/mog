/**
 * Input State Machine
 *
 * Manages all gesture interactions including scrolling, panning, zooming, and touch gestures.
 * Pure state machine - no side effects. The InputCoordinator subscribes to state changes
 * and executes side effects (physics updates, coordinate system changes).
 *
 * @see ARCHITECTURE.md - State Machine pattern (consistent with selection, editor, etc.)
 */

import { assign, setup, type ActorRefFrom } from 'xstate';

import { inputSelectors } from '../../../selectors';

import type { InputContext, InputEvent, InputMachineState } from './input-types';

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the input machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const InputEvents = {
  wheel: (deltaX: number, deltaY: number): InputEvent => ({
    type: 'WHEEL',
    deltaX,
    deltaY,
  }),

  zoom: (delta: number, centerX: number, centerY: number): InputEvent => ({
    type: 'ZOOM',
    delta,
    centerX,
    centerY,
  }),

  scrollEnd: (): InputEvent => ({
    type: 'SCROLL_END',
  }),

  touchStart: (touches: Array<{ id: number; x: number; y: number }>): InputEvent => ({
    type: 'TOUCH_START',
    touches,
  }),

  touchMove: (touches: Array<{ id: number; x: number; y: number }>): InputEvent => ({
    type: 'TOUCH_MOVE',
    touches,
  }),

  touchEnd: (touchIds: number[]): InputEvent => ({
    type: 'TOUCH_END',
    touchIds,
  }),

  panStart: (x: number, y: number): InputEvent => ({
    type: 'PAN_START',
    x,
    y,
  }),

  panMove: (x: number, y: number): InputEvent => ({
    type: 'PAN_MOVE',
    x,
    y,
  }),

  panEnd: (velocityX: number, velocityY: number): InputEvent => ({
    type: 'PAN_END',
    velocityX,
    velocityY,
  }),

  momentumComplete: (): InputEvent => ({
    type: 'MOMENTUM_COMPLETE',
  }),

  zoomComplete: (): InputEvent => ({
    type: 'ZOOM_COMPLETE',
  }),

  interrupt: (): InputEvent => ({
    type: 'INTERRUPT',
  }),
} as const;

// =============================================================================
// INITIAL CONTEXT
// =============================================================================

const initialContext: InputContext = {
  // Scroll state
  scrollX: 0,
  scrollY: 0,
  velocityX: 0,
  velocityY: 0,

  // Zoom state
  zoomLevel: 1,
  zoomCenterX: 0,
  zoomCenterY: 0,

  // Touch tracking
  activeTouches: [],
  initialPinchDistance: 0,

  // Pan tracking
  panStartX: 0,
  panStartY: 0,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate the distance between two touch points
 */
function getTouchDistance(
  touch1: { x: number; y: number },
  touch2: { x: number; y: number },
): number {
  const dx = touch2.x - touch1.x;
  const dy = touch2.y - touch1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate the center point between two touches
 */
function getTouchCenter(
  touch1: { x: number; y: number },
  touch2: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (touch1.x + touch2.x) / 2,
    y: (touch1.y + touch2.y) / 2,
  };
}

// =============================================================================
// STATE MACHINE
// =============================================================================

export const inputMachine = setup({
  types: {
    context: {} as InputContext,
    events: {} as InputEvent,
  },

  guards: {
    /**
     * Check if exactly one finger is touching
     */
    isOneFinger: ({ event }) => {
      if (event.type !== 'TOUCH_START' && event.type !== 'TOUCH_MOVE' && event.type !== 'TOUCH_END')
        return false;
      if (event.type === 'TOUCH_END') return false; // Can't determine from TOUCH_END alone
      return event.touches.length === 1;
    },

    /**
     * Check if exactly two fingers are touching
     */
    isTwoFingers: ({ event }) => {
      if (event.type !== 'TOUCH_START' && event.type !== 'TOUCH_MOVE') return false;
      return event.touches.length === 2;
    },

    /**
     * Check if no touches remain after TOUCH_END
     */
    noTouchesLeft: ({ context, event }) => {
      if (event.type !== 'TOUCH_END') return false;
      const remainingTouches = context.activeTouches.filter((t) => !event.touchIds.includes(t.id));
      return remainingTouches.length === 0;
    },

    /**
     * Check if one touch remains after TOUCH_END (for transitioning from pinch to pan)
     */
    oneFingerLeft: ({ context, event }) => {
      if (event.type !== 'TOUCH_END') return false;
      const remainingTouches = context.activeTouches.filter((t) => !event.touchIds.includes(t.id));
      return remainingTouches.length === 1;
    },

    /**
     * Check if velocity is significant enough for momentum
     */
    hasSignificantVelocity: ({ context }) => {
      const velocityMagnitude = Math.sqrt(
        context.velocityX * context.velocityX + context.velocityY * context.velocityY,
      );
      return velocityMagnitude > 50; // px/s threshold
    },
  },

  actions: {
    // ─────────────────────────────────────────────────────────────
    // Wheel Actions
    // ─────────────────────────────────────────────────────────────

    /**
     * Apply wheel delta to scroll position
     */
    applyWheelDelta: assign(({ context, event }) => {
      if (event.type !== 'WHEEL') return {};
      return {
        scrollX: context.scrollX + event.deltaX,
        scrollY: context.scrollY + event.deltaY,
        // Track velocity for momentum
        velocityX: event.deltaX * 10, // Scale up for velocity calculation
        velocityY: event.deltaY * 10,
      };
    }),

    // ─────────────────────────────────────────────────────────────
    // Zoom Actions
    // ─────────────────────────────────────────────────────────────

    /**
     * Apply zoom delta
     */
    applyZoom: assign(({ context, event }) => {
      if (event.type !== 'ZOOM') return {};
      return {
        zoomLevel: context.zoomLevel * (1 + event.delta),
        zoomCenterX: event.centerX,
        zoomCenterY: event.centerY,
      };
    }),

    // ─────────────────────────────────────────────────────────────
    // Pan Actions
    // ─────────────────────────────────────────────────────────────

    /**
     * Initialize panning from pointer event
     */
    initPan: assign(({ event }) => {
      if (event.type !== 'PAN_START') return {};
      return {
        panStartX: event.x,
        panStartY: event.y,
        velocityX: 0,
        velocityY: 0,
      };
    }),

    /**
     * Initialize panning from touch event
     */
    initPanFromTouch: assign(({ event }) => {
      if (event.type !== 'TOUCH_START' && event.type !== 'TOUCH_MOVE') return {};
      if (event.touches.length < 1) return {};
      const touch = event.touches[0];
      return {
        panStartX: touch.x,
        panStartY: touch.y,
        activeTouches: event.touches,
        velocityX: 0,
        velocityY: 0,
      };
    }),

    /**
     * Apply pan delta from pointer movement
     */
    applyPanDelta: assign(({ context, event }) => {
      if (event.type !== 'PAN_MOVE') return {};
      const deltaX = context.panStartX - event.x;
      const deltaY = context.panStartY - event.y;
      return {
        scrollX: context.scrollX + deltaX,
        scrollY: context.scrollY + deltaY,
        panStartX: event.x,
        panStartY: event.y,
        velocityX: deltaX * 60, // Approximate velocity (60fps assumption)
        velocityY: deltaY * 60,
      };
    }),

    /**
     * Apply pan delta from touch movement
     */
    applyPanDeltaFromTouch: assign(({ context, event }) => {
      if (event.type !== 'TOUCH_MOVE') return {};
      if (event.touches.length < 1) return {};
      const touch = event.touches[0];
      const deltaX = context.panStartX - touch.x;
      const deltaY = context.panStartY - touch.y;
      return {
        scrollX: context.scrollX + deltaX,
        scrollY: context.scrollY + deltaY,
        panStartX: touch.x,
        panStartY: touch.y,
        activeTouches: event.touches,
        velocityX: deltaX * 60,
        velocityY: deltaY * 60,
      };
    }),

    // ─────────────────────────────────────────────────────────────
    // Pinch Actions
    // ─────────────────────────────────────────────────────────────

    /**
     * Initialize pinch gesture
     */
    initPinch: assign(({ event }) => {
      if (event.type !== 'TOUCH_START' && event.type !== 'TOUCH_MOVE') return {};
      if (event.touches.length < 2) return {};
      const [touch1, touch2] = event.touches;
      const distance = getTouchDistance(touch1, touch2);
      const center = getTouchCenter(touch1, touch2);
      return {
        activeTouches: event.touches,
        initialPinchDistance: distance,
        zoomCenterX: center.x,
        zoomCenterY: center.y,
      };
    }),

    /**
     * Apply pinch zoom
     */
    applyPinch: assign(({ context, event }) => {
      if (event.type !== 'TOUCH_MOVE') return {};
      if (event.touches.length < 2) return {};
      const [touch1, touch2] = event.touches;
      const newDistance = getTouchDistance(touch1, touch2);
      const center = getTouchCenter(touch1, touch2);

      // Only apply if we have a valid initial distance
      if (context.initialPinchDistance === 0) return {};

      const scale = newDistance / context.initialPinchDistance;
      return {
        zoomLevel: context.zoomLevel * scale,
        zoomCenterX: center.x,
        zoomCenterY: center.y,
        activeTouches: event.touches,
        initialPinchDistance: newDistance, // Update for next delta calculation
      };
    }),

    // ─────────────────────────────────────────────────────────────
    // Momentum Actions
    // ─────────────────────────────────────────────────────────────

    /**
     * Start momentum animation with current velocity
     */
    startMomentum: assign(({ context }) => {
      // Velocity is already tracked in context
      return {
        velocityX: context.velocityX,
        velocityY: context.velocityY,
      };
    }),

    /**
     * Start momentum from pan end with explicit velocity
     */
    startMomentumFromPan: assign(({ event }) => {
      if (event.type !== 'PAN_END') return {};
      return {
        velocityX: event.velocityX,
        velocityY: event.velocityY,
      };
    }),

    // ─────────────────────────────────────────────────────────────
    // Stop/Reset Actions
    // ─────────────────────────────────────────────────────────────

    /**
     * Stop all animations
     */
    stopAnimations: assign(() => ({
      velocityX: 0,
      velocityY: 0,
    })),

    /**
     * Update active touches after TOUCH_END
     */
    updateTouchesAfterEnd: assign(({ context, event }) => {
      if (event.type !== 'TOUCH_END') return {};
      return {
        activeTouches: context.activeTouches.filter((t) => !event.touchIds.includes(t.id)),
      };
    }),

    /**
     * Clear momentum (velocity) when animation completes
     */
    clearMomentum: assign(() => ({
      velocityX: 0,
      velocityY: 0,
    })),

    /**
     * Reset all context to initial state
     */
    reset: assign(() => initialContext),
  },
}).createMachine({
  id: 'input',
  initial: 'idle',
  context: initialContext,

  states: {
    // =========================================================================
    // IDLE - No active gesture, waiting for input
    // =========================================================================
    idle: {
      on: {
        WHEEL: {
          target: 'scrolling',
          actions: 'applyWheelDelta',
        },
        ZOOM: {
          target: 'zooming',
          actions: 'applyZoom',
        },
        TOUCH_START: [
          {
            guard: 'isTwoFingers',
            target: 'pinching',
            actions: 'initPinch',
          },
          {
            guard: 'isOneFinger',
            target: 'panning',
            actions: 'initPanFromTouch',
          },
        ],
        PAN_START: {
          target: 'panning',
          actions: 'initPan',
        },
      },
    },

    // =========================================================================
    // SCROLLING - Active wheel scrolling
    // =========================================================================
    scrolling: {
      on: {
        WHEEL: {
          actions: 'applyWheelDelta',
        },
        SCROLL_END: [
          {
            guard: 'hasSignificantVelocity',
            target: 'momentum',
            actions: 'startMomentum',
          },
          {
            target: 'idle',
            actions: 'clearMomentum',
          },
        ],
        TOUCH_START: [
          {
            guard: 'isTwoFingers',
            target: 'pinching',
            actions: ['stopAnimations', 'initPinch'],
          },
          {
            guard: 'isOneFinger',
            target: 'panning',
            actions: ['stopAnimations', 'initPanFromTouch'],
          },
        ],
        PAN_START: {
          target: 'panning',
          actions: ['stopAnimations', 'initPan'],
        },
        INTERRUPT: {
          target: 'idle',
          actions: 'stopAnimations',
        },
      },
    },

    // =========================================================================
    // MOMENTUM - Inertial scrolling after wheel/pan ends
    // =========================================================================
    momentum: {
      on: {
        WHEEL: {
          target: 'scrolling',
          actions: ['stopAnimations', 'applyWheelDelta'],
        },
        TOUCH_START: [
          {
            guard: 'isTwoFingers',
            target: 'pinching',
            actions: ['stopAnimations', 'initPinch'],
          },
          {
            guard: 'isOneFinger',
            target: 'panning',
            actions: ['stopAnimations', 'initPanFromTouch'],
          },
        ],
        PAN_START: {
          target: 'panning',
          actions: ['stopAnimations', 'initPan'],
        },
        MOMENTUM_COMPLETE: {
          target: 'idle',
          actions: 'clearMomentum',
        },
        INTERRUPT: {
          target: 'idle',
          actions: 'stopAnimations',
        },
      },
    },

    // =========================================================================
    // PANNING - Pointer/touch drag to scroll
    // =========================================================================
    panning: {
      on: {
        PAN_MOVE: {
          actions: 'applyPanDelta',
        },
        TOUCH_MOVE: [
          {
            guard: 'isTwoFingers',
            target: 'pinching',
            actions: 'initPinch',
          },
          {
            guard: 'isOneFinger',
            actions: 'applyPanDeltaFromTouch',
          },
        ],
        PAN_END: [
          {
            guard: 'hasSignificantVelocity',
            target: 'momentum',
            actions: 'startMomentumFromPan',
          },
          {
            target: 'idle',
            actions: 'clearMomentum',
          },
        ],
        TOUCH_END: [
          {
            guard: 'noTouchesLeft',
            target: 'momentum',
            actions: ['updateTouchesAfterEnd', 'startMomentum'],
          },
          {
            guard: 'isTwoFingers',
            target: 'pinching',
            actions: ['updateTouchesAfterEnd', 'initPinch'],
          },
          {
            // One finger left - stay in panning
            actions: 'updateTouchesAfterEnd',
          },
        ],
        WHEEL: {
          target: 'scrolling',
          actions: ['stopAnimations', 'applyWheelDelta'],
        },
        INTERRUPT: {
          target: 'idle',
          actions: 'stopAnimations',
        },
      },
    },

    // =========================================================================
    // PINCHING - Two-finger pinch to zoom
    // =========================================================================
    pinching: {
      on: {
        TOUCH_MOVE: {
          actions: 'applyPinch',
        },
        TOUCH_END: [
          {
            guard: 'noTouchesLeft',
            target: 'idle',
            actions: 'updateTouchesAfterEnd',
          },
          {
            guard: 'oneFingerLeft',
            target: 'panning',
            actions: ['updateTouchesAfterEnd', 'initPanFromTouch'],
          },
          {
            actions: 'updateTouchesAfterEnd',
          },
        ],
        INTERRUPT: {
          target: 'idle',
          actions: 'stopAnimations',
        },
      },
    },

    // =========================================================================
    // ZOOMING - Wheel-based zoom (Ctrl+wheel or trackpad pinch)
    // =========================================================================
    zooming: {
      on: {
        ZOOM: {
          actions: 'applyZoom',
        },
        ZOOM_COMPLETE: {
          target: 'idle',
        },
        WHEEL: {
          target: 'scrolling',
          actions: 'applyWheelDelta',
        },
        TOUCH_START: [
          {
            guard: 'isTwoFingers',
            target: 'pinching',
            actions: 'initPinch',
          },
          {
            guard: 'isOneFinger',
            target: 'panning',
            actions: 'initPanFromTouch',
          },
        ],
        INTERRUPT: {
          target: 'idle',
        },
      },
    },
  },
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type InputMachine = typeof inputMachine;
export type InputActor = ActorRefFrom<InputMachine>;
export type InputState = ReturnType<InputActor['getSnapshot']>;

// =============================================================================
// HELPER TO EXTRACT SNAPSHOT
// =============================================================================

/**
 * Extract a simplified snapshot from the machine state.
 * Used by the coordinator and hooks.
 *
 * ARCHITECTURE: This function composes selectors - the single source of truth.
 * All extraction logic is delegated to inputSelectors.
 * @see contracts/src/actors/input.ts
 */
export function getInputSnapshot(state: InputState): {
  machineState: InputMachineState;
  scrollX: number;
  scrollY: number;
  velocityX: number;
  velocityY: number;
  zoomLevel: number;
  isScrolling: boolean;
  isPanning: boolean;
  isPinching: boolean;
  isZooming: boolean;
  isMomentum: boolean;
  isAnimating: boolean;
} {
  // Cast state to selector-compatible type
  const s = state as Parameters<(typeof inputSelectors)['scrollX']>[0];

  return {
    machineState: inputSelectors.machineState(s) as InputMachineState,

    // Value selectors
    scrollX: inputSelectors.scrollX(s),
    scrollY: inputSelectors.scrollY(s),
    velocityX: inputSelectors.velocityX(s),
    velocityY: inputSelectors.velocityY(s),
    zoomLevel: inputSelectors.zoomLevel(s),

    // State matching selectors
    isScrolling: inputSelectors.isScrolling(s),
    isPanning: inputSelectors.isPanning(s),
    isPinching: inputSelectors.isPinching(s),
    isZooming: inputSelectors.isZooming(s),
    isMomentum: inputSelectors.isMomentum(s),

    // Derived selector
    isAnimating: inputSelectors.isAnimating(s),
  };
}
