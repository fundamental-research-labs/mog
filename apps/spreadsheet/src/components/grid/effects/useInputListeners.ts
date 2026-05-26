/**
 * useInputListeners Effect Hook
 *
 * Attaches native event listeners for wheel, touch, and keyboard events.
 * Must use native listeners (not React synthetic events) to:
 * 1. Set passive: false for preventDefault() to work
 * 2. Capture all wheel events including trackpad two-finger scrolling
 *
 * Long-press (500ms) on touch devices triggers context menu, following
 * accessibility guidelines for touch-based right-click equivalent.
 *
 * @see 09-SPREADSHEET-GRID-DECOMPOSITION.md
 */

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

// =============================================================================
// LONG-PRESS CONFIGURATION
// =============================================================================

/**
 * Duration in milliseconds for long-press to trigger context menu.
 * 500ms follows platform guidelines (iOS/Android standard).
 */
const LONG_PRESS_DURATION_MS = 500;

/**
 * Movement threshold in pixels to cancel long-press.
 * If finger moves more than this distance, long-press is cancelled.
 * 10px threshold accounts for natural finger tremor.
 */
const LONG_PRESS_MOVEMENT_THRESHOLD_PX = 10;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input handlers from useInput hook.
 */
export interface InputHandlers {
  /** Wheel event handler */
  onWheel: (e: WheelEvent) => void;
  /** Touch start handler */
  onTouchStart: (e: TouchEvent) => void;
  /** Touch move handler */
  onTouchMove: (e: TouchEvent) => void;
  /** Touch end handler */
  onTouchEnd: (e: TouchEvent) => void;
  /** Key down handler (for space+drag pan) */
  onKeyDown: (e: KeyboardEvent) => void;
  /** Key up handler (for space+drag pan) */
  onKeyUp: (e: KeyboardEvent) => void;
}

/**
 * Long-press callback for context menu invocation.
 * Touch accessibility for context menu.
 */
export interface LongPressCallback {
  /** Callback invoked when long-press is detected */
  onLongPress?: (x: number, y: number) => void;
}

/**
 * Options for the useInputListeners hook.
 */
export interface UseInputListenersOptions {
  /** Container ref for attaching event listeners */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Input handlers from useInput hook */
  input: InputHandlers;
  /**
   * Callback for long-press context menu invocation.
   * Called after 500ms press with coordinates for context menu placement.
   */
  onLongPress?: (x: number, y: number) => void;
}

/**
 * Attaches native event listeners for input handling.
 *
 * This hook sets up native event listeners for:
 * - Wheel events (with passive: false for preventDefault)
 * - Touch events (for trackpad/touch gestures)
 * - Keyboard events (for space+drag pan)
 * - Long-press detection (context menu on touch devices)
 *
 * Using native listeners instead of React synthetic events is required
 * because React's synthetic event system doesn't support passive: false,
 * which is needed to call preventDefault() on wheel events.
 *
 * @param options - Configuration options
 */
export function useInputListeners(options: UseInputListenersOptions): void {
  const { containerRef, input, onLongPress } = options;

  // Long-press state tracking
  // Using refs to track mutable state across event handlers
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Capture handlers at effect setup time
    const wheelHandler = input.onWheel;
    const originalTouchStartHandler = input.onTouchStart;
    const originalTouchMoveHandler = input.onTouchMove;
    const originalTouchEndHandler = input.onTouchEnd;
    const keyDownHandler = input.onKeyDown;
    const keyUpHandler = input.onKeyUp;

    /**
     * Clear long-press timer and reset state.
     * Called when touch ends, moves too far, or is cancelled.
     */
    const clearLongPressTimer = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      touchStartPosRef.current = null;
    };

    /**
     * Enhanced touch start handler with long-press detection.
     * Starts a 500ms timer that triggers context menu if not cancelled.
     */
    const touchStartHandler = (e: TouchEvent) => {
      // Clear any existing timer
      clearLongPressTimer();
      longPressTriggeredRef.current = false;

      // Only track single-touch for long-press (multi-touch is for gestures)
      if (e.touches.length === 1 && onLongPress) {
        const touch = e.touches[0];
        touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

        // Start long-press timer
        longPressTimerRef.current = setTimeout(() => {
          if (touchStartPosRef.current) {
            // Mark that long-press was triggered to prevent normal touch end handling
            longPressTriggeredRef.current = true;
            // Invoke context menu at touch position
            onLongPress(touchStartPosRef.current.x, touchStartPosRef.current.y);
            // Clear state after triggering
            clearLongPressTimer();
          }
        }, LONG_PRESS_DURATION_MS);
      }

      // Always forward to original handler for scrolling/gestures
      originalTouchStartHandler(e);
    };

    /**
     * Enhanced touch move handler with movement threshold.
     * Cancels long-press if finger moves beyond threshold (10px).
     */
    const touchMoveHandler = (e: TouchEvent) => {
      // Check if finger has moved beyond threshold
      if (touchStartPosRef.current && e.touches.length === 1) {
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
        const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);

        if (dx > LONG_PRESS_MOVEMENT_THRESHOLD_PX || dy > LONG_PRESS_MOVEMENT_THRESHOLD_PX) {
          // Movement exceeded threshold - cancel long-press
          clearLongPressTimer();
        }
      }

      // Always forward to original handler
      originalTouchMoveHandler(e);
    };

    /**
     * Enhanced touch end handler.
     * Clears long-press timer on touch end.
     */
    const touchEndHandler = (e: TouchEvent) => {
      const wasLongPress = longPressTriggeredRef.current;
      clearLongPressTimer();
      longPressTriggeredRef.current = false;

      // If long-press was triggered, don't forward to original handler
      // to prevent accidental selection or other actions
      if (!wasLongPress) {
        originalTouchEndHandler(e);
      }
    };

    // Attach wheel listener with passive: false to allow preventDefault
    container.addEventListener('wheel', wheelHandler, { passive: false });

    // Attach touch listeners with long-press enhancement
    container.addEventListener('touchstart', touchStartHandler, { passive: false });
    container.addEventListener('touchmove', touchMoveHandler, { passive: false });
    container.addEventListener('touchend', touchEndHandler);

    // Attach keyboard listeners for space+drag pan
    document.addEventListener('keydown', keyDownHandler);
    document.addEventListener('keyup', keyUpHandler);

    return () => {
      // Clean up long-press timer on unmount
      clearLongPressTimer();

      container.removeEventListener('wheel', wheelHandler);
      container.removeEventListener('touchstart', touchStartHandler);
      container.removeEventListener('touchmove', touchMoveHandler);
      container.removeEventListener('touchend', touchEndHandler);
      document.removeEventListener('keydown', keyDownHandler);
      document.removeEventListener('keyup', keyUpHandler);
    };
  }, [containerRef, input, onLongPress]);
}
