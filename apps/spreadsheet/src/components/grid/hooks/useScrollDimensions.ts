/**
 * Scroll Dimensions Hook
 *
 * Computes the BASE scroll area dimensions based on the used range of the sheet.
 * This makes the scrollbar thumb size usable for normal sheets instead of
 * scaling to MAX_ROWS/MAX_COLS.
 *
 * Dynamic expansion (growing the range as user scrolls near the edge) is
 * handled by ScrollContainer, which already re-renders on every scroll frame.
 *
 * Issue 6.1: Scroll area based on used range
 */

import type { ViewportReader } from '@mog-sdk/contracts/api';
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '@mog-sdk/contracts/rendering';
import { useMemo } from 'react';

interface UseScrollDimensionsOptions {
  viewport: ViewportReader;
  activeSheetId: string;
}

export interface ScrollDimensions {
  width: number;
  height: number;
}

/** Buffer beyond used range for comfort scrolling */
export const SCROLL_BUFFER_ROWS = 100;
export const SCROLL_BUFFER_COLS = 50;

/** Minimum visible area (for empty sheets) */
const MIN_ROWS = 50;
const MIN_COLS = 26;

/**
 * Hook to compute BASE scroll area dimensions based on sheet's used range.
 *
 * Returns width and height that represent the used content + buffer.
 * ScrollContainer may expand these dynamically based on scroll position.
 */
export function useScrollDimensions(options: UseScrollDimensionsOptions): ScrollDimensions {
  const { viewport, activeSheetId } = options;

  return useMemo(() => {
    // Use ViewportReader bounds as sync approximation of used range
    const usedRange = viewport.getBounds();

    const effectiveRows = usedRange
      ? Math.max(usedRange.endRow + SCROLL_BUFFER_ROWS, MIN_ROWS)
      : MIN_ROWS;
    const effectiveCols = usedRange
      ? Math.max(usedRange.endCol + SCROLL_BUFFER_COLS, MIN_COLS)
      : MIN_COLS;

    return {
      width: effectiveCols * DEFAULT_COL_WIDTH,
      height: effectiveRows * DEFAULT_ROW_HEIGHT,
    };
  }, [viewport, activeSheetId]);
}
