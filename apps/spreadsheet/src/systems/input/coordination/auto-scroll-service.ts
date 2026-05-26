/**
 * Auto-Scroll Service
 *
 * Provides auto-scrolling when dragging near the viewport edge during:
 * - Cell selection drag
 * - Fill handle drag
 * - Object move/resize drag
 *
 * ARCHITECTURE:
 * - Pure functions: `isNearViewportEdge()` and `getScrollVelocity()`
 * - No state machine (service pattern, not actor pattern)
 * - Coordinator integration via `setupAutoScroll()` which subscribes to drag states
 *
 *
 * @see docs/renderer/README.md - Coordinator Pattern
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Result of checking if a point is near the viewport edge.
 */
export interface EdgeProximity {
  /** Which edge the point is near, or null if not near any edge */
  edge: 'top' | 'bottom' | 'left' | 'right' | null;
  /** Distance in pixels from the edge (0 = at edge, larger = further) */
  distance: number;
}

/**
 * Scroll velocity to apply based on edge proximity.
 */
export interface ScrollVelocity {
  /** Horizontal scroll velocity (pixels per second, positive = scroll right) */
  dx: number;
  /** Vertical scroll velocity (pixels per second, positive = scroll down) */
  dy: number;
}

/**
 * Viewport bounds for edge detection.
 *
 * A.2: Frozen panes support - These bounds should represent the scrollable region,
 * with left/top already adjusted to exclude frozen panes. The CoordinateSystem's
 * getViewportBounds() method provides this automatically.
 */
export interface ViewportBounds {
  /** Left edge in viewport coordinates (already adjusted for frozen cols if any) */
  left: number;
  /** Top edge in viewport coordinates (already adjusted for frozen rows if any) */
  top: number;
  /** Right edge in viewport coordinates */
  right: number;
  /** Bottom edge in viewport coordinates */
  bottom: number;
}

// =============================================================================
// Pure Functions
// =============================================================================

/**
 * Check if a point is near the viewport edge.
 *
 * A.2: Frozen panes support - The viewport bounds passed in should be the
 * scrollable region (i.e., already excluding frozen panes). The CoordinateSystem's
 * getViewportBounds() method handles this automatically by returning
 * { left: frozenColsWidth + headerWidth, top: frozenRowsHeight + headerHeight, ... }
 *
 * @param x - X coordinate in viewport space
 * @param y - Y coordinate in viewport space
 * @param viewport - Viewport bounds (should be scrollable region from CoordinateSystem)
 * @param threshold - Distance threshold in pixels (default 50)
 * @returns Edge proximity information
 */
export function isNearViewportEdge(
  x: number,
  y: number,
  viewport: ViewportBounds,
  threshold: number = 50,
): EdgeProximity {
  // Check each edge and return the closest one
  // Note: viewport.left/top are already adjusted for frozen panes by CoordinateSystem
  const distanceToTop = y - viewport.top;
  const distanceToBottom = viewport.bottom - y;
  const distanceToLeft = x - viewport.left;
  const distanceToRight = viewport.right - x;

  // Find the minimum distance
  const minDistance = Math.min(distanceToTop, distanceToBottom, distanceToLeft, distanceToRight);

  // If not near any edge, return null
  if (minDistance > threshold) {
    return { edge: null, distance: minDistance };
  }

  // Return the closest edge
  if (distanceToTop <= threshold && distanceToTop === minDistance) {
    return { edge: 'top', distance: distanceToTop };
  }
  if (distanceToBottom <= threshold && distanceToBottom === minDistance) {
    return { edge: 'bottom', distance: distanceToBottom };
  }
  if (distanceToLeft <= threshold && distanceToLeft === minDistance) {
    return { edge: 'left', distance: distanceToLeft };
  }
  if (distanceToRight <= threshold && distanceToRight === minDistance) {
    return { edge: 'right', distance: distanceToRight };
  }

  return { edge: null, distance: minDistance };
}

/**
 * Calculate scroll velocity based on edge proximity.
 *
 * Uses an acceleration curve - velocity increases as distance to edge decreases.
 *
 * @param proximity - Edge proximity from `isNearViewportEdge()`
 * @param threshold - Distance threshold used for edge detection (default 50)
 * @param minSpeed - Minimum scroll speed in pixels/second (default 100)
 * @param maxSpeed - Maximum scroll speed in pixels/second (default 600)
 * @returns Scroll velocity to apply
 */
export function getScrollVelocity(
  proximity: EdgeProximity,
  threshold: number = 50,
  minSpeed: number = 100,
  maxSpeed: number = 600,
): ScrollVelocity {
  if (proximity.edge === null) {
    return { dx: 0, dy: 0 };
  }

  // Calculate speed based on distance (closer = faster)
  // Use quadratic acceleration curve for smoother feel
  const t = 1 - proximity.distance / threshold; // 0 = at threshold, 1 = at edge
  const speedFactor = t * t; // Quadratic curve
  const speed = minSpeed + speedFactor * (maxSpeed - minSpeed);

  // Return velocity in the appropriate direction
  switch (proximity.edge) {
    case 'top':
      return { dx: 0, dy: -speed };
    case 'bottom':
      return { dx: 0, dy: speed };
    case 'left':
      return { dx: -speed, dy: 0 };
    case 'right':
      return { dx: speed, dy: 0 };
  }
}

// =============================================================================
// Coordinator Integration
// =============================================================================

/**
 * Configuration for auto-scroll coordination.
 */
export interface AutoScrollConfig {
  /** Get current mouse position in viewport coordinates */
  getMousePosition: () => { x: number; y: number } | null;
  /** Get viewport bounds for edge detection */
  getViewportBounds: () => ViewportBounds;
  /** Apply scroll delta to the viewport */
  applyScrollDelta: (dx: number, dy: number) => void;
  /** Request render after scroll */
  requestRender?: () => void;
  /** Edge detection threshold in pixels (default 50) */
  threshold?: number;
  /** Minimum scroll speed in pixels/second (default 100) */
  minSpeed?: number;
  /** Maximum scroll speed in pixels/second (default 600) */
  maxSpeed?: number;
}

/**
 * Auto-scroll controller returned by setupAutoScroll.
 */
export interface AutoScrollController {
  /** Start auto-scroll checking */
  start: () => void;
  /** Stop auto-scroll (call this when drag ends) */
  stop: () => void;
  /** Check if auto-scroll is currently active */
  isActive: () => boolean;
  /** Clean up resources */
  cleanup: () => void;
}

/**
 * Set up auto-scroll for drag operations.
 *
 * Returns a controller that the coordinator can use to start/stop auto-scrolling
 * based on state machine transitions.
 *
 * Usage in coordinator:
 * ```typescript
 * const autoScroll = setupAutoScroll({
 * getMousePosition: => coordinator.lastMousePosition,
 * getViewportBounds: => coordinateSystem.getViewportBounds,
 * applyScrollDelta: (dx, dy) => inputCoordinator.scrollBy(dx, dy),
 * requestRender: => renderer.render,
 * });
 *
 * // When entering drag state
 * autoScroll.start();
 *
 * // When exiting drag state
 * autoScroll.stop();
 *
 * // On dispose
 * autoScroll.cleanup();
 * ```
 */
export function setupAutoScroll(config: AutoScrollConfig): AutoScrollController {
  const {
    getMousePosition,
    getViewportBounds,
    applyScrollDelta,
    requestRender,
    threshold = 50,
    minSpeed = 100,
    maxSpeed = 600,
  } = config;

  let animationFrameId: number | null = null;
  let lastFrameTime: number = 0;
  let isRunning = false;

  /**
   * Animation tick function.
   * Called on each animation frame while auto-scroll is active.
   */
  function tick(timestamp: number): void {
    if (!isRunning) return;

    // Calculate delta time
    const deltaTime = lastFrameTime > 0 ? (timestamp - lastFrameTime) / 1000 : 0;
    lastFrameTime = timestamp;

    // Get current mouse position
    const mousePos = getMousePosition();
    if (!mousePos) {
      // No mouse position, continue loop but don't scroll
      animationFrameId = requestAnimationFrame(tick);
      return;
    }

    // Get viewport bounds
    const viewport = getViewportBounds();

    // Check if near edge
    const proximity = isNearViewportEdge(mousePos.x, mousePos.y, viewport, threshold);

    // Calculate and apply scroll velocity
    if (proximity.edge !== null) {
      const velocity = getScrollVelocity(proximity, threshold, minSpeed, maxSpeed);

      // Apply scroll based on elapsed time
      const scrollX = velocity.dx * deltaTime;
      const scrollY = velocity.dy * deltaTime;

      if (scrollX !== 0 || scrollY !== 0) {
        applyScrollDelta(scrollX, scrollY);
        requestRender?.();
      }
    }

    // Continue the loop
    animationFrameId = requestAnimationFrame(tick);
  }

  return {
    start(): void {
      if (isRunning) return;
      isRunning = true;
      lastFrameTime = 0;
      animationFrameId = requestAnimationFrame(tick);
    },

    stop(): void {
      if (!isRunning) return;
      isRunning = false;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      lastFrameTime = 0;
    },

    isActive(): boolean {
      return isRunning;
    },

    cleanup(): void {
      this.stop();
    },
  };
}
