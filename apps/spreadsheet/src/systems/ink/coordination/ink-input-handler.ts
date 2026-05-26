/**
 * Ink Input Handler
 *
 * Handles pointer events for ink drawing, including:
 * - Pointer coalescing for smooth 120Hz+ stylus input
 * - Stylus hover timeout tracking
 * - Point extraction with pressure and tilt
 * - Event lifecycle (attach/detach)
 *
 * ARCHITECTURE NOTES:
 * - No side effects to state machine (only reads)
 * - Callback-based for event routing
 * - Uses getCoalescedEvents() for high-frequency stylus
 * - Resource ownership by coordinator
 *
 */

import type { InkPoint } from '@mog-sdk/contracts/ink';

import {
  createTouchDiscriminator,
  toPointerInputType,
  type PointerInputType,
  type TouchDiscriminator,
  type TouchDiscriminatorConfig,
} from './ink-touch-discriminator';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Delay in milliseconds before accepting strokes after stylus hover.
 * This prevents accidental strokes when hovering the stylus.
 */
const STYLUS_HOVER_TIMEOUT_MS = 150;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Callbacks for ink input events.
 */
export interface InkInputCallbacks {
  /**
   * Called when a stroke starts (pointer down).
   * @param point - The starting point
   * @param pointerType - Type of pointer (pen/mouse/touch)
   */
  onStrokeStart(point: InkPoint, pointerType: PointerInputType): void;

  /**
   * Called when a stroke continues (pointer move).
   * @param points - Array of points (may contain multiple from coalescing)
   * @param pointerType - Type of pointer
   */
  onStrokeMove(points: InkPoint[], pointerType: PointerInputType): void;

  /**
   * Called when a stroke ends (pointer up).
   * @param point - The ending point (if available)
   * @param pointerType - Type of pointer
   */
  onStrokeEnd(point: InkPoint | null, pointerType: PointerInputType): void;

  /**
   * Called when a stroke is cancelled (pointer cancel/leave).
   */
  onStrokeCancel(): void;

  /**
   * Called when erasing starts.
   * @param point - The starting point
   */
  onEraseStart?(point: InkPoint): void;

  /**
   * Called when erasing continues.
   * @param points - Array of points
   */
  onEraseMove?(points: InkPoint[]): void;

  /**
   * Called when erasing ends.
   */
  onEraseEnd?(): void;
}

/**
 * Configuration for the ink input handler.
 */
export interface InkInputHandlerConfig {
  /**
   * The target element to attach listeners to.
   */
  target: HTMLElement;

  /**
   * Callbacks for input events.
   */
  callbacks: InkInputCallbacks;

  /**
   * Touch discriminator configuration.
   */
  touchDiscriminator?: TouchDiscriminatorConfig;

  /**
   * Whether eraser tool is active.
   * If a function, called to check current state.
   */
  isEraserActive?: boolean | (() => boolean);

  /**
   * Offset from client coordinates to local drawing coordinates.
   * Used when the drawing is not at (0,0) in the viewport.
   */
  getDrawingOffset?: () => { x: number; y: number };
}

/**
 * Ink input handler interface.
 */
export interface InkInputHandler {
  /**
   * Attach event listeners to the target element.
   */
  attach(): void;

  /**
   * Detach event listeners from the target element.
   */
  detach(): void;

  /**
   * Destroy the handler and release all resources.
   */
  destroy(): void;

  /**
   * Check if the handler is currently attached.
   */
  isAttached(): boolean;

  /**
   * Get the touch discriminator for external state queries.
   */
  getTouchDiscriminator(): TouchDiscriminator;

  /**
   * Check if currently in a stroke (between down and up).
   */
  isInStroke(): boolean;

  /**
   * Force cancel any active stroke.
   */
  cancelStroke(): void;
}

// =============================================================================
// POINT EXTRACTION
// =============================================================================

/**
 * Extract an InkPoint from a PointerEvent.
 *
 * @param event - The pointer event
 * @param offset - Offset to apply to coordinates
 * @param strokeStartTime - Timestamp when stroke started (for relative timing)
 * @returns InkPoint with coordinates, pressure, tilt, and timestamp
 */
export function extractPointFromEvent(
  event: PointerEvent,
  offset: { x: number; y: number } = { x: 0, y: 0 },
  strokeStartTime?: number,
): InkPoint {
  // Convert tilt from degrees (-90 to 90) to radians (0 to PI/2)
  const tiltXRad = event.tiltX ? (Math.abs(event.tiltX) * Math.PI) / 180 : undefined;
  const tiltYRad = event.tiltY ? (Math.abs(event.tiltY) * Math.PI) / 180 : undefined;
  const tilt =
    tiltXRad !== undefined && tiltYRad !== undefined
      ? Math.sqrt(tiltXRad * tiltXRad + tiltYRad * tiltYRad)
      : undefined;

  // Calculate relative timestamp if stroke start time provided
  const timestamp = strokeStartTime !== undefined ? event.timeStamp - strokeStartTime : undefined;

  return {
    x: event.clientX - offset.x,
    y: event.clientY - offset.y,
    // Pressure is already normalized to [0, 1] by the browser
    pressure: event.pressure > 0 ? event.pressure : undefined,
    tilt,
    timestamp,
  };
}

/**
 * Extract all coalesced points from a pointer move event.
 * Falls back to single point if coalescing is not supported.
 *
 * @param event - The pointer event
 * @param offset - Offset to apply to coordinates
 * @param strokeStartTime - Timestamp when stroke started
 * @returns Array of InkPoints
 */
export function extractCoalescedPoints(
  event: PointerEvent,
  offset: { x: number; y: number } = { x: 0, y: 0 },
  strokeStartTime?: number,
): InkPoint[] {
  // Try to get coalesced events for smooth high-frequency input
  const coalescedEvents = event.getCoalescedEvents?.() ?? [];

  if (coalescedEvents.length > 0) {
    return coalescedEvents.map((e) => extractPointFromEvent(e, offset, strokeStartTime));
  }

  // Fallback to single point
  return [extractPointFromEvent(event, offset, strokeStartTime)];
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Create an ink input handler.
 *
 * @param config - Handler configuration
 * @returns InkInputHandler instance
 *
 * @example
 * const handler = createInkInputHandler({
 * target: canvasElement,
 * callbacks: {
 * onStrokeStart: (point) => machine.send({ type: 'PEN_DOWN', point, strokeId }),
 * onStrokeMove: (points) => points.forEach(p => machine.send({ type: 'PEN_MOVE', point: p })),
 * onStrokeEnd: => machine.send({ type: 'PEN_UP' }),
 * onStrokeCancel: => machine.send({ type: 'DEACTIVATE' })
 * }
 * });
 *
 * handler.attach();
 *
 * // Later:
 * handler.destroy();
 */
export function createInkInputHandler(config: InkInputHandlerConfig): InkInputHandler {
  const { target, callbacks, touchDiscriminator: touchConfig, getDrawingOffset } = config;

  // Create touch discriminator for palm rejection
  const touchDiscriminator = createTouchDiscriminator(touchConfig);

  // State
  let isAttached = false;
  let isDestroyed = false;
  let activePointerId: number | null = null;
  let strokeStartTime: number | null = null;

  // Hover timeout state
  let hoverTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let isHoverDelayActive = false;
  let lastHoverTime: number | null = null;

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  function getOffset(): { x: number; y: number } {
    return getDrawingOffset?.() ?? { x: 0, y: 0 };
  }

  function isEraser(): boolean {
    const { isEraserActive } = config;
    if (typeof isEraserActive === 'function') {
      return isEraserActive();
    }
    return isEraserActive ?? false;
  }

  function clearHoverTimeout(): void {
    if (hoverTimeoutId !== null) {
      clearTimeout(hoverTimeoutId);
      hoverTimeoutId = null;
    }
    isHoverDelayActive = false;
  }

  function startHoverDelay(): void {
    clearHoverTimeout();
    isHoverDelayActive = true;
    lastHoverTime = Date.now();

    hoverTimeoutId = setTimeout(() => {
      isHoverDelayActive = false;
      hoverTimeoutId = null;
    }, STYLUS_HOVER_TIMEOUT_MS);
  }

  function shouldDelayStroke(pointerType: string): boolean {
    // Only apply hover delay for pen/stylus
    if (pointerType !== 'pen') {
      return false;
    }

    // If hover delay is active, check if enough time has passed
    if (isHoverDelayActive && lastHoverTime !== null) {
      const elapsed = Date.now() - lastHoverTime;
      return elapsed < STYLUS_HOVER_TIMEOUT_MS;
    }

    return false;
  }

  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================

  function handlePointerDown(event: PointerEvent): void {
    if (isDestroyed) return;

    // Only handle primary button (left click / pen tip)
    if (event.button !== 0) return;

    // Check pointer type
    const pointerType = toPointerInputType(event.pointerType);
    if (!pointerType) return;

    // Palm rejection
    if (!touchDiscriminator.shouldProcess(pointerType)) {
      return;
    }

    // Track pen events for palm rejection
    if (pointerType === 'pen') {
      touchDiscriminator.recordPenEvent();
    }

    // Check hover delay for stylus
    if (shouldDelayStroke(event.pointerType)) {
      return;
    }

    // Clear hover delay since we're starting a stroke
    clearHoverTimeout();

    // Only one active stroke at a time
    if (activePointerId !== null) {
      return;
    }

    // Capture pointer for reliable tracking
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture errors (e.g., if element not in DOM)
    }

    activePointerId = event.pointerId;
    strokeStartTime = event.timeStamp;

    const offset = getOffset();
    const point = extractPointFromEvent(event, offset, strokeStartTime);

    // Route to eraser or pen
    if (isEraser()) {
      callbacks.onEraseStart?.(point);
    } else {
      callbacks.onStrokeStart(point, pointerType);
    }

    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent): void {
    if (isDestroyed) return;

    // Handle hover (pen near but not touching)
    if (event.pointerType === 'pen' && activePointerId === null) {
      // Track hover for delay
      if (!isHoverDelayActive) {
        startHoverDelay();
      }
      return;
    }

    // Only process if this is our active pointer
    if (event.pointerId !== activePointerId) return;

    const pointerType = toPointerInputType(event.pointerType);
    if (!pointerType) return;

    // Track pen events for palm rejection
    if (pointerType === 'pen') {
      touchDiscriminator.recordPenEvent();
    }

    const offset = getOffset();

    // Use coalesced events for smooth input
    const points = extractCoalescedPoints(event, offset, strokeStartTime ?? undefined);

    // Route to eraser or pen
    if (isEraser()) {
      callbacks.onEraseMove?.(points);
    } else {
      callbacks.onStrokeMove(points, pointerType);
    }

    event.preventDefault();
  }

  function handlePointerUp(event: PointerEvent): void {
    if (isDestroyed) return;

    // Only process if this is our active pointer
    if (event.pointerId !== activePointerId) return;

    const pointerType = toPointerInputType(event.pointerType);
    if (!pointerType) return;

    // Release pointer capture
    try {
      target.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore release errors
    }

    const offset = getOffset();
    const point = extractPointFromEvent(event, offset, strokeStartTime ?? undefined);

    // Route to eraser or pen
    if (isEraser()) {
      callbacks.onEraseEnd?.();
    } else {
      callbacks.onStrokeEnd(point, pointerType);
    }

    activePointerId = null;
    strokeStartTime = null;

    event.preventDefault();
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (isDestroyed) return;

    // Only process if this is our active pointer
    if (event.pointerId !== activePointerId) return;

    // Release pointer capture
    try {
      target.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore release errors
    }

    // Route to cancel
    if (isEraser()) {
      callbacks.onEraseEnd?.();
    } else {
      callbacks.onStrokeCancel();
    }

    activePointerId = null;
    strokeStartTime = null;
  }

  function handlePointerLeave(event: PointerEvent): void {
    if (isDestroyed) return;

    // Only cancel if this is our active pointer and we don't have capture
    if (event.pointerId !== activePointerId) return;

    // Check if we still have capture
    try {
      if (target.hasPointerCapture(event.pointerId)) {
        return; // We have capture, don't cancel
      }
    } catch {
      // Ignore errors
    }

    // Cancel the stroke
    if (isEraser()) {
      callbacks.onEraseEnd?.();
    } else {
      callbacks.onStrokeCancel();
    }

    activePointerId = null;
    strokeStartTime = null;
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  return {
    attach(): void {
      if (isAttached || isDestroyed) return;

      target.addEventListener('pointerdown', handlePointerDown);
      target.addEventListener('pointermove', handlePointerMove);
      target.addEventListener('pointerup', handlePointerUp);
      target.addEventListener('pointercancel', handlePointerCancel);
      target.addEventListener('pointerleave', handlePointerLeave);

      // Disable default touch actions for smoother drawing
      target.style.touchAction = 'none';

      isAttached = true;
    },

    detach(): void {
      if (!isAttached || isDestroyed) return;

      target.removeEventListener('pointerdown', handlePointerDown);
      target.removeEventListener('pointermove', handlePointerMove);
      target.removeEventListener('pointerup', handlePointerUp);
      target.removeEventListener('pointercancel', handlePointerCancel);
      target.removeEventListener('pointerleave', handlePointerLeave);

      // Restore touch action
      target.style.touchAction = '';

      // Clear any active state
      clearHoverTimeout();
      activePointerId = null;
      strokeStartTime = null;

      isAttached = false;
    },

    destroy(): void {
      if (isDestroyed) return;

      this.detach();
      touchDiscriminator.reset();
      isDestroyed = true;
    },

    isAttached(): boolean {
      return isAttached;
    },

    getTouchDiscriminator(): TouchDiscriminator {
      return touchDiscriminator;
    },

    isInStroke(): boolean {
      return activePointerId !== null;
    },

    cancelStroke(): void {
      if (activePointerId === null) return;

      // Release pointer capture
      try {
        target.releasePointerCapture(activePointerId);
      } catch {
        // Ignore release errors
      }

      // Cancel the stroke
      if (isEraser()) {
        callbacks.onEraseEnd?.();
      } else {
        callbacks.onStrokeCancel();
      }

      activePointerId = null;
      strokeStartTime = null;
    },
  };
}
