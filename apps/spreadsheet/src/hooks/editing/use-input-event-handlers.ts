/**
 * Input Event Handlers Hook - Granular Input Subscription
 *
 * This hook provides ONLY the stable event handler functions for DOM binding.
 * It does NOT subscribe to any state, so it will NEVER cause re-renders.
 *
 * Problem: useInput() subscribes to scrollState via useSyncExternalStore, causing
 * re-renders on every scroll frame. Components like useInputListeners only need
 * the event handlers for DOM binding, not the state.
 *
 * Solution: Split useInput() into granular hooks. This hook provides only the
 * event handlers for wheel, touch, and keyboard events.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 14: Render Isolation
 */

import { useCallback, useMemo } from 'react';

import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// TYPES
// =============================================================================

export interface UseInputEventHandlersReturn {
  /** Handle wheel events (trackpad scroll, mouse wheel, Ctrl+wheel zoom) */
  onWheel: (event: WheelEvent) => void;

  /** Handle touch start events */
  onTouchStart: (event: TouchEvent) => void;

  /** Handle touch move events */
  onTouchMove: (event: TouchEvent) => void;

  /** Handle touch end events */
  onTouchEnd: (event: TouchEvent) => void;

  /** Handle pointer down events (for middle-click pan, space+drag) */
  onPointerDown: (event: PointerEvent) => void;

  /** Handle pointer move events (for pan gestures) */
  onPointerMove: (event: PointerEvent) => void;

  /** Handle pointer up events */
  onPointerUp: (event: PointerEvent) => void;

  /** Handle key down events (for space key tracking) */
  onKeyDown: (event: KeyboardEvent) => void;

  /** Handle key up events */
  onKeyUp: (event: KeyboardEvent) => void;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing input event handlers for DOM binding.
 *
 * This is a performance-optimized alternative to useInput() for components
 * that only need to bind event handlers to the DOM but don't need any state.
 *
 * Key optimization: Returns only stable memoized functions. No subscriptions,
 * no state, no re-renders.
 *
 * @example
 * ```tsx
 * function GridContainer() {
 * const handlers = useInputEventHandlers;
 *
 * useEffect( => {
 * const el = ref.current;
 * el.addEventListener('wheel', handlers.onWheel, { passive: false });
 * // This component NEVER re-renders due to scroll events
 * return => el.removeEventListener('wheel', handlers.onWheel);
 * }, [handlers]);
 * }
 * ```
 */
export function useInputEventHandlers(): UseInputEventHandlersReturn {
  const coordinator = useCoordinator();
  const inputCoordinator = coordinator.input.inputCoordinator;

  const onWheel = useCallback(
    (event: WheelEvent) => {
      inputCoordinator.handleWheel(event);
    },
    [inputCoordinator],
  );

  const onTouchStart = useCallback(
    (event: TouchEvent) => {
      inputCoordinator.handleTouchStart(event);
    },
    [inputCoordinator],
  );

  const onTouchMove = useCallback(
    (event: TouchEvent) => {
      inputCoordinator.handleTouchMove(event);
    },
    [inputCoordinator],
  );

  const onTouchEnd = useCallback(
    (event: TouchEvent) => {
      inputCoordinator.handleTouchEnd(event);
    },
    [inputCoordinator],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      inputCoordinator.handlePointerDown(event);
    },
    [inputCoordinator],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      inputCoordinator.handlePointerMove(event);
    },
    [inputCoordinator],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      inputCoordinator.handlePointerUp(event);
    },
    [inputCoordinator],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      inputCoordinator.handleKeyDown(event);
    },
    [inputCoordinator],
  );

  const onKeyUp = useCallback(
    (event: KeyboardEvent) => {
      inputCoordinator.handleKeyUp(event);
    },
    [inputCoordinator],
  );

  // Return stable object - all functions are memoized
  return useMemo(
    () => ({
      onWheel,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onKeyDown,
      onKeyUp,
    }),
    [
      onWheel,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onKeyDown,
      onKeyUp,
    ],
  );
}
