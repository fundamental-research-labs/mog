/**
 * Scroll Handling
 *
 * Pure functions for computing scroll offsets based on ScrollBehavior.
 *
 * SCROLL POSITION ARCHITECTURE:
 *
 * For single/freeze configs:
 * - There is ONE canonical scroll position (the 'main' viewport's)
 * - Other viewports (frozen panes) derive their scroll offset based on ScrollBehavior
 *
 * For split configs:
 * - Each viewport can have an INDEPENDENT scroll position
 * - The renderer-execution module maintains a Map<ViewportId, Point> for per-viewport scroll
 * - ScrollBehavior still applies to determine how viewports respond to scroll input
 *
 * Viewport ID Conventions:
 * - 'main': Primary scrollable viewport (always present)
 * - 'frozen-corner', 'frozen-rows', 'frozen-cols': Freeze pane viewports
 * - 'top', 'bottom': Horizontal split viewports
 * - 'left', 'right': Vertical split viewports
 * - 'topLeft', 'topRight', 'bottomLeft', 'bottomRight': Four-way split viewports
 *
 * @module canvas/viewports/scroll
 */

import type { Point, ScrollBehavior, Viewport } from './types';

/**
 * Apply scroll behavior to compute the actual scroll offset for a viewport.
 *
 * For single/freeze configs, the scrollPosition parameter is the canonical scroll position.
 * For split configs, use per-viewport scroll positions from the coordinator.
 *
 * ScrollBehavior types:
 * - `free`: uses scroll position directly (main viewport behavior)
 * - `horizontal-only`: uses scroll.x, y = 0 (frozen rows behavior)
 * - `vertical-only`: uses scroll.y, x = 0 (frozen cols behavior)
 * - `none`: always (0, 0) (frozen corner behavior)
 * - `linked`: follows another viewport's computed offset
 *
 * @param scrollPosition - The scroll position for this viewport
 * @param behavior - How this viewport responds to scroll
 * @param viewportLookup - Function to look up another viewport by ID (for linked behavior)
 * @returns The computed scroll offset for this viewport
 */
export function applyScrollBehavior(
  scrollPosition: Point,
  behavior: ScrollBehavior,
  viewportLookup?: (id: string) => Viewport | undefined,
): Point {
  switch (behavior.type) {
    case 'free':
      return { x: scrollPosition.x, y: scrollPosition.y };

    case 'horizontal-only':
      return { x: scrollPosition.x, y: 0 };

    case 'vertical-only':
      return { x: 0, y: scrollPosition.y };

    case 'none':
      return { x: 0, y: 0 };

    case 'linked': {
      if (!viewportLookup) {
        console.warn(`applyScrollBehavior: linked viewport lookup not provided`);
        return { x: 0, y: 0 };
      }
      const linkedViewport = viewportLookup(behavior.viewportId);
      if (!linkedViewport) {
        console.warn(`applyScrollBehavior: linked viewport "${behavior.viewportId}" not found`);
        return { x: 0, y: 0 };
      }
      // Follow the linked viewport's offset on the specified axis
      if (behavior.axis === 'x') {
        return { x: linkedViewport.scrollOffset.x, y: 0 };
      } else {
        return { x: 0, y: linkedViewport.scrollOffset.y };
      }
    }
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Clamp scroll position to valid bounds.
 *
 * @param scrollPosition - The requested scroll position
 * @param maxScroll - The maximum allowed scroll position
 * @returns The clamped scroll position
 */
export function clampScroll(scrollPosition: Point, maxScroll: Point): Point {
  return {
    x: Math.max(0, Math.min(scrollPosition.x, maxScroll.x)),
    y: Math.max(0, Math.min(scrollPosition.y, maxScroll.y)),
  };
}

/**
 * Compute the maximum scroll position based on content size and viewport size.
 *
 * @param contentSize - Total content size in pixels
 * @param viewportSize - Visible viewport size in pixels
 * @param frozenSize - Size of frozen area (not scrollable)
 * @returns Maximum scroll position
 */
export function computeMaxScroll(
  contentSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
  frozenSize: { width: number; height: number } = { width: 0, height: 0 },
): Point {
  const scrollableWidth = viewportSize.width - frozenSize.width;
  const scrollableHeight = viewportSize.height - frozenSize.height;

  return {
    x: Math.max(0, contentSize.width - scrollableWidth),
    y: Math.max(0, contentSize.height - scrollableHeight),
  };
}

/**
 * Compute scroll position to bring a cell into view.
 *
 * @param cellRect - The cell's position in document coordinates
 * @param currentScroll - Current scroll position
 * @param viewportSize - Visible viewport size
 * @param frozenSize - Size of frozen area
 * @param padding - Padding from viewport edge (default: 20)
 * @returns New scroll position, or null if cell is already visible
 */
export function scrollToCell(
  cellRect: { x: number; y: number; width: number; height: number },
  currentScroll: Point,
  viewportSize: { width: number; height: number },
  frozenSize: { width: number; height: number } = { width: 0, height: 0 },
  padding: number = 20,
): Point | null {
  // Calculate visible area (excluding frozen region)
  const visibleLeft = currentScroll.x;
  const visibleTop = currentScroll.y;
  const visibleRight = currentScroll.x + viewportSize.width - frozenSize.width;
  const visibleBottom = currentScroll.y + viewportSize.height - frozenSize.height;

  // Cell bounds in scrollable space (after frozen area)
  const cellLeft = cellRect.x - frozenSize.width;
  const cellTop = cellRect.y - frozenSize.height;
  const cellRight = cellLeft + cellRect.width;
  const cellBottom = cellTop + cellRect.height;

  let newScrollX = currentScroll.x;
  let newScrollY = currentScroll.y;
  let needsScroll = false;

  // Check horizontal
  if (cellLeft < visibleLeft) {
    newScrollX = Math.max(0, cellLeft - padding);
    needsScroll = true;
  } else if (cellRight > visibleRight) {
    newScrollX = cellRight - (viewportSize.width - frozenSize.width) + padding;
    needsScroll = true;
  }

  // Check vertical
  if (cellTop < visibleTop) {
    newScrollY = Math.max(0, cellTop - padding);
    needsScroll = true;
  } else if (cellBottom > visibleBottom) {
    newScrollY = cellBottom - (viewportSize.height - frozenSize.height) + padding;
    needsScroll = true;
  }

  return needsScroll ? { x: newScrollX, y: newScrollY } : null;
}

/**
 * Apply scroll offsets to all viewports in a layout.
 * This is called after viewports are built to populate their scrollOffset field.
 *
 * @param viewports - Array of viewports with scrollBehavior set
 * @param scrollPosition - The canonical scroll position
 * @returns Viewports with scrollOffset populated
 */
export function applyScrollToViewports(
  viewports: readonly Viewport[],
  scrollPosition: Point,
): Viewport[] {
  // Build lookup for linked viewports
  const viewportMap = new Map<string, Viewport>();
  for (const viewport of viewports) {
    viewportMap.set(viewport.id, viewport);
  }

  const lookup = (id: string) => viewportMap.get(id);

  // Apply scroll behavior to each viewport
  return viewports.map((viewport) => ({
    ...viewport,
    scrollOffset: applyScrollBehavior(scrollPosition, viewport.scrollBehavior, lookup),
  }));
}
