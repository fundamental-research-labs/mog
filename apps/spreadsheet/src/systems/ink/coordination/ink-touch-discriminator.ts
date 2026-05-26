/**
 * Ink Touch Discriminator
 *
 * Provides palm rejection for ink input by discriminating between
 * pen, mouse, and touch input. When a pen is detected, touch input
 * is rejected for a time window to prevent accidental palm touches.
 *
 * ARCHITECTURE NOTES:
 * - Pure logic module (no side effects)
 * - Time-window based rejection (500ms after pen)
 * - Supports "always prefer pen" mode for tablets
 *
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Time window in milliseconds during which touch events are rejected
 * after pen input is detected. This prevents palm touches while drawing.
 *
 * 500ms is a good balance between:
 * - Long enough to reject palm touches during drawing
 * - Short enough to not block intentional touch after lifting pen
 */
const TOUCH_REJECTION_WINDOW_MS = 500;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Pointer types that can be processed.
 */
export type PointerInputType = 'pen' | 'mouse' | 'touch';

/**
 * Configuration for the touch discriminator.
 */
export interface TouchDiscriminatorConfig {
  /**
   * If true, always prefer pen over touch regardless of timing.
   * Useful for tablets where pen is the primary input.
   */
  alwaysPreferPen?: boolean;

  /**
   * Time window in ms during which touch is rejected after pen.
   * Defaults to 500ms.
   */
  rejectionWindowMs?: number;
}

/**
 * Touch discriminator interface for ink input.
 *
 * Provides palm rejection by tracking pen events and rejecting
 * touch events that occur within a time window.
 */
export interface TouchDiscriminator {
  /**
   * Check if a pointer event should be processed.
   *
   * @param pointerType - The type of pointer input
   * @returns true if the event should be processed, false to reject
   */
  shouldProcess(pointerType: PointerInputType): boolean;

  /**
   * Record that a pen event occurred.
   * Call this when processing pen input.
   */
  recordPenEvent(): void;

  /**
   * Reset the discriminator state.
   * Call this when ink mode is deactivated.
   */
  reset(): void;

  /**
   * Check if touch events are currently being rejected.
   */
  isTouchRejected(): boolean;

  /**
   * Get the time since last pen event in milliseconds.
   * Returns null if no pen event has been recorded.
   */
  getTimeSinceLastPen(): number | null;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Create a new touch discriminator.
 *
 * @param config - Optional configuration
 * @returns TouchDiscriminator instance
 *
 * @example
 * const discriminator = createTouchDiscriminator();
 *
 * // In pointer event handler:
 * if (!discriminator.shouldProcess(event.pointerType)) {
 * return; // Reject touch during pen use
 * }
 *
 * if (event.pointerType === 'pen') {
 * discriminator.recordPenEvent;
 * }
 */
export function createTouchDiscriminator(
  config: TouchDiscriminatorConfig = {},
): TouchDiscriminator {
  const { alwaysPreferPen = false, rejectionWindowMs = TOUCH_REJECTION_WINDOW_MS } = config;

  /**
   * Timestamp of the last pen event.
   * null if no pen event has been recorded.
   */
  let lastPenEventTime: number | null = null;

  /**
   * Flag indicating if pen has been detected in this session.
   * Used for alwaysPreferPen mode.
   */
  let penDetected = false;

  /**
   * Check if touch should currently be rejected based on timing.
   */
  function shouldRejectTouch(): boolean {
    // In alwaysPreferPen mode, reject touch once pen is detected
    if (alwaysPreferPen && penDetected) {
      return true;
    }

    // Otherwise, use time-window based rejection
    if (lastPenEventTime === null) {
      return false;
    }

    const timeSincePen = Date.now() - lastPenEventTime;
    return timeSincePen < rejectionWindowMs;
  }

  return {
    shouldProcess(pointerType: PointerInputType): boolean {
      // Pen events are always processed
      if (pointerType === 'pen') {
        return true;
      }

      // Mouse events are always processed (for hybrid devices)
      if (pointerType === 'mouse') {
        return true;
      }

      // Touch events are rejected if within the pen time window
      if (pointerType === 'touch') {
        return !shouldRejectTouch();
      }

      // Unknown pointer types are processed by default
      return true;
    },

    recordPenEvent(): void {
      lastPenEventTime = Date.now();
      penDetected = true;
    },

    reset(): void {
      lastPenEventTime = null;
      penDetected = false;
    },

    isTouchRejected(): boolean {
      return shouldRejectTouch();
    },

    getTimeSinceLastPen(): number | null {
      if (lastPenEventTime === null) {
        return null;
      }
      return Date.now() - lastPenEventTime;
    },
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert a PointerEvent.pointerType string to our typed enum.
 *
 * @param pointerType - The pointerType string from a PointerEvent
 * @returns Typed PointerInputType or null if unknown
 */
export function toPointerInputType(pointerType: string): PointerInputType | null {
  switch (pointerType) {
    case 'pen':
      return 'pen';
    case 'mouse':
      return 'mouse';
    case 'touch':
      return 'touch';
    default:
      return null;
  }
}
