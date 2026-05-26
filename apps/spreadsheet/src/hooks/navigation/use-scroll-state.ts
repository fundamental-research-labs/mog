/**
 * Scroll State Hook - Granular Input Subscription
 *
 * This hook provides the actual scroll position (x, y, velocity, etc.).
 * It subscribes to scroll state changes which happen EVERY FRAME during scroll.
 *
 * WARNING: This hook will cause re-renders on EVERY scroll frame (~120/sec).
 * Only use this if you actually need the scroll position for React rendering.
 *
 * Common use cases that DON'T need this hook:
 * - Canvas rendering (canvas reads scroll position directly)
 * - Cursor changes during pan (use useInputState().isPanning instead)
 * - Programmatic scrolling (use useScrollActions().scrollTo instead)
 *
 * Rare use cases that DO need this hook:
 * - React-based scroll position overlays (consider canvas instead)
 * - Scroll position debugging UI
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 14: Render Isolation
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';

import type { ScrollState } from '../../systems/input/machines/input-types';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing scroll state (position, velocity, animation status).
 *
 * CAUTION: This hook triggers React re-renders on EVERY scroll frame.
 * Most components should NOT use this hook. Use useScrollActions() for
 * programmatic scrolling or useInputState() for interaction mode (panning).
 *
 * @example
 * ```tsx
 * // WRONG - Don't use this for canvas rendering
 * function Grid() {
 * const scrollState = useScrollState; // Re-renders 120x/sec!
 * // Canvas should read scroll directly, not via React
 * }
 *
 * // RIGHT - Rare case: debug overlay
 * function ScrollDebugOverlay() {
 * const { x, y } = useScrollState;
 * return <div>Scroll: {x.toFixed(0)}, {y.toFixed(0)}</div>;
 * }
 * ```
 */
export function useScrollState(): ScrollState {
  const coordinator = useCoordinator();
  const inputCoordinator = coordinator.input.inputCoordinator;

  // Use ref to avoid creating new objects on each frame
  const scrollStateRef = useRef<ScrollState>(inputCoordinator.getScrollState());

  return useSyncExternalStore(
    useCallback(
      (callback: () => void) => {
        return inputCoordinator.onScrollChange((state) => {
          scrollStateRef.current = state;
          callback();
        });
      },
      [inputCoordinator],
    ),
    useCallback(() => scrollStateRef.current, []),
    useCallback(() => inputCoordinator.getScrollState(), [inputCoordinator]),
  );
}
