/**
 * Input Actor Selectors
 *
 * Pure functions that extract data from input state.
 * Moved from contracts to kernel (contracts holds types only).
 *
 * @module @mog-sdk/kernel/selectors
 */

import type { InputState } from '@mog-sdk/contracts/actors/input';

export { type InputState } from '@mog-sdk/contracts/actors/input';

export const inputSelectors = {
  // ---------------------------------------------------------------------------
  // Value selectors
  // ---------------------------------------------------------------------------
  scrollX: (state: InputState): number => state.context.scrollX,
  scrollY: (state: InputState): number => state.context.scrollY,
  velocityX: (state: InputState): number => state.context.velocityX,
  velocityY: (state: InputState): number => state.context.velocityY,
  zoomLevel: (state: InputState): number => state.context.zoomLevel,
  zoomCenterX: (state: InputState): number => state.context.zoomCenterX,
  zoomCenterY: (state: InputState): number => state.context.zoomCenterY,
  activeTouches: (state: InputState): Array<{ id: number; x: number; y: number }> =>
    state.context.activeTouches,
  panStartX: (state: InputState): number => state.context.panStartX,
  panStartY: (state: InputState): number => state.context.panStartY,

  // ---------------------------------------------------------------------------
  // State matching selectors
  // ---------------------------------------------------------------------------
  isIdle: (state: InputState): boolean => state.matches('idle'),
  isScrolling: (state: InputState): boolean => state.matches('scrolling'),
  isPanning: (state: InputState): boolean => state.matches('panning'),
  isPinching: (state: InputState): boolean => state.matches('pinching'),
  isZooming: (state: InputState): boolean => state.matches('zooming'),
  isMomentum: (state: InputState): boolean => state.matches('momentum'),

  // ---------------------------------------------------------------------------
  // Derived selectors
  // ---------------------------------------------------------------------------
  /** Check if any scroll animation is active (scrolling, momentum, or zooming) */
  isAnimating: (state: InputState): boolean =>
    state.matches('scrolling') || state.matches('momentum') || state.matches('zooming'),

  /** Get the current machine state value */
  machineState: (state: InputState): string => state.value,
};
