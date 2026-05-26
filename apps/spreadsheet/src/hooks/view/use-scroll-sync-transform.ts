/**
 * useScrollSyncTransform Hook
 *
 * Imperatively syncs a DOM element's position with grid scroll using
 * GPU-accelerated CSS transforms. No React re-renders on scroll.
 *
 * Architecture:
 * - On each React render, captures the render-time cell position and resets the transform
 * - Between renders, scroll events recalculate cellToViewport() and apply the delta
 * as a CSS translate3d transform — purely imperative, no React state
 * - Handles frozen panes correctly (cellToViewport returns fixed coords for frozen cells)
 * - Hides the element when the cell scrolls completely out of the viewport
 *
 * This hook MUST be called inside the editor component (not a wrapper) so that
 * useLayoutEffect fires on every editor re-render, keeping the delta in sync.
 *
 * @see FormControlLayerContainer - Similar scroll-sync pattern for form controls
 * @see PivotLayerContainer - Similar scroll-sync pattern for pivot tables
 */

import { useEffect, useLayoutEffect, useRef } from 'react';

import type { CellRange } from '@mog-sdk/contracts/core';

import { useCoordinator } from '../shared/use-coordinator';
import { useRendererActions } from './use-renderer-actions';

/**
 * Imperatively apply scroll-sync CSS transforms to a DOM element.
 *
 * @param elementRef - Ref to the DOM element that should track scroll
 * @param sheetId - Active sheet ID for coordinate lookups
 * @param cell - The cell being edited (row, col)
 * @param mergeBounds - Merge region bounds if editing a merged cell, null otherwise
 * @param renderPosition - The cell's viewport position at render time ({ x, y })
 */
export function useScrollSyncTransform(
  elementRef: React.RefObject<HTMLElement | null>,
  sheetId: string | null,
  cell: { row: number; col: number } | null,
  mergeBounds: CellRange | null,
  renderPosition: { x: number; y: number } | null,
): void {
  const renderPositionRef = useRef({ x: 0, y: 0 });
  const coordinator = useCoordinator();
  const rendererActions = useRendererActions();

  // On every React render, capture the render-time position and reset the transform.
  // useLayoutEffect runs synchronously after DOM mutations, before the browser paints,
  // ensuring no visual flash of a stale transform.
  useLayoutEffect(() => {
    if (renderPosition) {
      renderPositionRef.current = { x: renderPosition.x, y: renderPosition.y };
    }
    if (elementRef.current) {
      elementRef.current.style.transform = 'translate3d(0px, 0px, 0)';
      elementRef.current.style.visibility = '';
    }
  });

  // Subscribe to scroll changes and apply the delta as a CSS transform.
  // The transform is GPU-accelerated (translate3d) and avoids layout recalculation.
  useEffect(() => {
    if (!sheetId || !cell) return;

    const geometry = rendererActions.getGeometry();
    if (!geometry) return;

    const syncScroll = () => {
      if (!elementRef.current) return;

      // Recalculate the cell's viewport position at the current scroll offset
      let newRect;
      if (mergeBounds) {
        const rects = geometry.getRangeRects(mergeBounds);
        newRect = rects[0];
      } else {
        newRect = geometry.getCellRect(cell);
      }

      if (!newRect) {
        // Cell scrolled completely out of the viewport — hide the editor
        elementRef.current.style.visibility = 'hidden';
        return;
      }

      elementRef.current.style.visibility = '';
      const dx = newRect.x - renderPositionRef.current.x;
      const dy = newRect.y - renderPositionRef.current.y;
      elementRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    };

    const inputCoordinator = coordinator.input.inputCoordinator;
    return inputCoordinator.onScrollChange(syncScroll);
  }, [sheetId, cell, mergeBounds, coordinator, rendererActions, elementRef]);
}
