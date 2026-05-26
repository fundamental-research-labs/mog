/**
 * useFocusedViewport Hook
 *
 * Provides stable references for the currently focused viewport in split view.
 * This hook is optimized for render isolation - the setter reference is stable
 * across re-renders (via useCallback) to prevent unnecessary child re-renders.
 *
 */

import { useCallback, useMemo } from 'react';

import { useActiveSheetId, useUIStore } from '../../infra/context';

/**
 * Return type for useFocusedViewport hook.
 *
 * Properties:
 * - focusedViewportId: The ID of the currently focused viewport ('main', 'top', 'bottom', etc.)
 * - setFocusedViewport: Stable callback to change the focused viewport
 * - cycleFocusToNext: Cycle focus to the next viewport (for F6 navigation)
 * - cycleFocusToPrevious: Cycle focus to the previous viewport (for Shift+F6 navigation)
 */
export interface FocusedViewportResult {
  /**
   * The ID of the currently focused viewport.
   * Returns 'main' for single viewport mode.
   */
  focusedViewportId: string;

  /**
   * Set the focused viewport. Stable reference (useCallback).
   */
  setFocusedViewport: (viewportId: string) => void;

  /**
   * Cycle focus to the next viewport (F6 key behavior).
   * Wraps around when reaching the end.
   */
  cycleFocusToNext: () => void;

  /**
   * Cycle focus to the previous viewport (Shift+F6 key behavior).
   * Wraps around when reaching the beginning.
   */
  cycleFocusToPrevious: () => void;
}

/**
 * Standard viewport ID ordering for F6 navigation.
 * Matches Excel's pane cycling order.
 */
const VIEWPORT_ORDER_HORIZONTAL = ['top', 'bottom'];
const VIEWPORT_ORDER_VERTICAL = ['left', 'right'];
const VIEWPORT_ORDER_BOTH = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

/**
 * Get the list of viewport IDs for a given split direction.
 */
function getViewportIdsForDirection(
  direction: 'horizontal' | 'vertical' | 'both' | undefined,
): string[] {
  switch (direction) {
    case 'horizontal':
      return VIEWPORT_ORDER_HORIZONTAL;
    case 'vertical':
      return VIEWPORT_ORDER_VERTICAL;
    case 'both':
      return VIEWPORT_ORDER_BOTH;
    default:
      return ['main'];
  }
}

/**
 * Hook to manage focused viewport state for split view.
 *
 * Features:
 * - Stable setter reference for render isolation
 * - F6/Shift+F6 cycling through viewports
 * - Automatic fallback to 'main' when no split is active
 *
 * @param splitDirection - Optional: The current split direction ('horizontal', 'vertical', 'both')
 * If not provided, uses 'main' as the only viewport
 * @returns FocusedViewportResult with current state and actions
 *
 * @example
 * ```tsx
 * const { focusedViewportId, setFocusedViewport, cycleFocusToNext } = useFocusedViewport('both');
 *
 * // In scroll handler
 * const handleScroll = (viewportId: string) => {
 * setFocusedViewport(viewportId);
 * };
 *
 * // F6 key handler
 * const handleF6 = () => {
 * cycleFocusToNext;
 * };
 * ```
 */
export function useFocusedViewport(
  splitDirection?: 'horizontal' | 'vertical' | 'both',
): FocusedViewportResult {
  const sheetId = useActiveSheetId();

  const getFocusedViewport = useUIStore((state) => state.getFocusedViewport);
  const setFocusedViewportAction = useUIStore((state) => state.setFocusedViewport);

  // Get current focused viewport ID
  const focusedViewportId = useMemo(() => {
    if (!sheetId) return 'main';
    return getFocusedViewport(sheetId);
  }, [sheetId, getFocusedViewport]);

  // Stable setter callback
  const setFocusedViewport = useCallback(
    (viewportId: string) => {
      if (!sheetId) return;
      setFocusedViewportAction(sheetId, viewportId);
    },
    [sheetId, setFocusedViewportAction],
  );

  // Get viewport IDs for current split direction
  const viewportIds = useMemo(() => getViewportIdsForDirection(splitDirection), [splitDirection]);

  // Cycle to next viewport (F6)
  const cycleFocusToNext = useCallback(() => {
    if (!sheetId || viewportIds.length <= 1) return;

    const currentIndex = viewportIds.indexOf(focusedViewportId);
    const nextIndex = (currentIndex + 1) % viewportIds.length;
    setFocusedViewportAction(sheetId, viewportIds[nextIndex]);
  }, [sheetId, viewportIds, focusedViewportId, setFocusedViewportAction]);

  // Cycle to previous viewport (Shift+F6)
  const cycleFocusToPrevious = useCallback(() => {
    if (!sheetId || viewportIds.length <= 1) return;

    const currentIndex = viewportIds.indexOf(focusedViewportId);
    const prevIndex = (currentIndex - 1 + viewportIds.length) % viewportIds.length;
    setFocusedViewportAction(sheetId, viewportIds[prevIndex]);
  }, [sheetId, viewportIds, focusedViewportId, setFocusedViewportAction]);

  // Return stable object reference via useMemo
  return useMemo(
    () => ({
      focusedViewportId,
      setFocusedViewport,
      cycleFocusToNext,
      cycleFocusToPrevious,
    }),
    [focusedViewportId, setFocusedViewport, cycleFocusToNext, cycleFocusToPrevious],
  );
}
