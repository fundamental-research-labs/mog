/**
 * Scroll Actions Hook - Granular Input Subscription
 *
 * This hook provides ONLY stable action functions for programmatic scrolling/zooming.
 * It does NOT subscribe to any state, so it will NEVER cause re-renders.
 *
 * Problem: useInput() subscribes to scrollState via useSyncExternalStore, causing
 * 842 React re-renders per second during scroll. SpreadsheetGrid only uses
 * scrollTo() (a stable function) but is forced to re-render on every scroll frame.
 *
 * Solution: Split useInput() into granular hooks following the established pattern
 * used for selection (useActiveCell, useSelectionRanges, etc.).
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 14: Render Isolation
 */

import { useCallback, useMemo } from 'react';

import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// TYPES
// =============================================================================

export interface UseScrollActionsReturn {
  /** Scroll to a specific position */
  scrollTo: (x: number, y: number) => void;

  /** Scroll by a delta amount */
  scrollBy: (deltaX: number, deltaY: number) => void;

  /** Animate to a target zoom level */
  zoomTo: (level: number, centerX?: number, centerY?: number) => void;

  /** Set zoom level immediately (no animation) */
  setZoom: (level: number) => void;

  /** Interrupt any active gesture or animation */
  interrupt: () => void;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for programmatic scroll and zoom actions.
 *
 * This is a performance-optimized alternative to useInput() for components
 * that only need to trigger scroll/zoom actions but don't need to read state.
 *
 * Key optimization: Returns only stable memoized functions. No subscriptions,
 * no state, no re-renders.
 *
 * @example
 * ```tsx
 * function ScrollButton() {
 * const { scrollTo } = useScrollActions;
 *
 * // This component NEVER re-renders due to scroll events
 * return <button onClick={ => scrollTo(0, 0)}>Go to top</button>;
 * }
 * ```
 */
export function useScrollActions(): UseScrollActionsReturn {
  const coordinator = useCoordinator();
  const inputCoordinator = coordinator.input.inputCoordinator;

  const scrollTo = useCallback(
    (x: number, y: number) => {
      inputCoordinator.scrollTo(x, y);
    },
    [inputCoordinator],
  );

  const scrollBy = useCallback(
    (deltaX: number, deltaY: number) => {
      inputCoordinator.scrollBy(deltaX, deltaY);
    },
    [inputCoordinator],
  );

  const zoomTo = useCallback(
    (level: number, centerX?: number, centerY?: number) => {
      inputCoordinator.zoomTo(level, centerX, centerY);
    },
    [inputCoordinator],
  );

  const setZoom = useCallback(
    (level: number) => {
      inputCoordinator.setZoom(level);
    },
    [inputCoordinator],
  );

  const interrupt = useCallback(() => {
    inputCoordinator.interrupt();
  }, [inputCoordinator]);

  // Return stable object - all functions are memoized
  return useMemo(
    () => ({
      scrollTo,
      scrollBy,
      zoomTo,
      setZoom,
      interrupt,
    }),
    [scrollTo, scrollBy, zoomTo, setZoom, interrupt],
  );
}
