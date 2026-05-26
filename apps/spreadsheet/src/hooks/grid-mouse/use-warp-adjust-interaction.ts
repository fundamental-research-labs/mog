/**
 * Warp Adjust Interaction Hook
 *
 * Handles dragging the yellow diamond warp adjust handle for TextEffect objects.
 * This hook manages mouse down/move/up events to adjust warp intensity in real-time.
 *
 * Warp Adjustment Interaction
 *
 * @module engine/hooks/grid-mouse/use-warp-adjust-interaction
 */

import { useCallback, useRef } from 'react';

import type { TextBoxObject } from '@mog-sdk/contracts/floating-objects';
import type { ObjectBounds } from '@mog-sdk/contracts/rendering';
import type { Point } from '@mog-sdk/contracts/viewport';

// =============================================================================
// Types
// =============================================================================

/**
 * State tracked during a warp adjust drag operation.
 */
export interface WarpAdjustDragState {
  /** ID of the TextEffect object being adjusted */
  objectId: string;
  /** Initial warp adjustment value (0-1) at drag start */
  initialWarpAdjust: number;
  /** Y position at drag start (in viewport coordinates) */
  startY: number;
  /** Object bounds at drag start (for calculating drag range) */
  bounds: ObjectBounds;
}

/**
 * Dependencies for the useWarpAdjustInteraction hook.
 */
export interface UseWarpAdjustInteractionDeps {
  /**
   * Get a floating object by ID.
   * Returns the object if found and is a TextBox with TextEffect, null otherwise.
   */
  getFloatingObject: (objectId: string) => TextBoxObject | null;

  /**
   * Preview warp adjustment value (ephemeral UI state for live feedback).
   * This updates the visual without persisting to Yjs.
   */
  previewWarpAdjust: (objectId: string, warpAdjust: number) => void;

  /**
   * Commit warp adjustment value (persists to Yjs).
   * Called on mouse up to finalize the change.
   */
  commitWarpAdjust: (objectId: string, warpAdjust: number) => void;

  /**
   * Clear warp adjustment preview.
   * Called on cancel or when committing.
   */
  clearWarpAdjustPreview: (objectId: string) => void;

  /** Container element ref for cursor management */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Return value from the useWarpAdjustInteraction hook.
 */
export interface UseWarpAdjustInteractionReturn {
  /** Ref holding current drag state (null when not dragging) */
  warpAdjustDragRef: React.MutableRefObject<WarpAdjustDragState | null>;

  /**
   * Start warp adjust drag operation.
   * Called when mouse down is detected on the warp adjust handle.
   *
   * @param objectId - ID of the TextEffect object
   * @param startY - Y position of mouse down (viewport coordinates)
   * @param bounds - Current bounds of the object (viewport coordinates)
   * @returns true if drag started successfully, false if object not found
   */
  startWarpAdjustDrag: (objectId: string, startY: number, bounds: ObjectBounds) => boolean;

  /**
   * Update warp adjust during drag.
   * Called on mouse move while dragging.
   *
   * @param currentY - Current Y position of mouse (viewport coordinates)
   */
  moveWarpAdjustDrag: (currentY: number) => void;

  /**
   * Complete warp adjust drag.
   * Called on mouse up to commit the change.
   *
   * @param finalY - Final Y position of mouse (viewport coordinates)
   */
  endWarpAdjustDrag: (finalY: number) => void;

  /**
   * Cancel warp adjust drag.
   * Called on escape or click outside to revert changes.
   */
  cancelWarpAdjustDrag: () => void;

  /**
   * Check if a warp adjust drag is in progress.
   */
  isWarpAdjustDragging: () => boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Cursor to show during warp adjust drag */
const WARP_ADJUST_CURSOR = 'ns-resize';

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for handling warp adjust handle drag operations.
 *
 * When a TextEffect object is selected, a yellow diamond handle appears that
 * allows adjusting the warp intensity. Dragging this handle vertically
 * adjusts the warp value between 0 and 1.
 *
 * @example
 * ```tsx
 * const {
 * warpAdjustDragRef,
 * startWarpAdjustDrag,
 * moveWarpAdjustDrag,
 * endWarpAdjustDrag,
 * cancelWarpAdjustDrag,
 * isWarpAdjustDragging
 * } = useWarpAdjustInteraction({
 * getFloatingObject,
 * previewWarpAdjust,
 * commitWarpAdjust,
 * clearWarpAdjustPreview,
 * containerRef
 * });
 *
 * // In mouse down handler for warp-adjust region:
 * if (hitResult.region === 'warp-adjust') {
 * startWarpAdjustDrag(hitResult.objectId, e.clientY, objectBounds);
 * }
 *
 * // In mouse move handler:
 * if (isWarpAdjustDragging()) {
 * moveWarpAdjustDrag(e.clientY);
 * }
 *
 * // In mouse up handler:
 * if (isWarpAdjustDragging()) {
 * endWarpAdjustDrag(e.clientY);
 * }
 * ```
 */
export function useWarpAdjustInteraction(
  deps: UseWarpAdjustInteractionDeps,
): UseWarpAdjustInteractionReturn {
  const {
    getFloatingObject,
    previewWarpAdjust,
    commitWarpAdjust,
    clearWarpAdjustPreview,
    containerRef,
  } = deps;

  // Drag state ref - using ref instead of state to avoid re-renders during drag
  const warpAdjustDragRef = useRef<WarpAdjustDragState | null>(null);

  /**
   * Check if a warp adjust drag is in progress.
   */
  const isWarpAdjustDragging = useCallback((): boolean => {
    return warpAdjustDragRef.current !== null;
  }, []);

  /**
   * Calculate the new warp adjust value based on drag delta.
   *
   * The warp adjust handle moves vertically within the object bounds.
   * Dragging down increases the warp value, up decreases it.
   *
   * @param state - Current drag state
   * @param currentY - Current Y position
   * @returns New warp adjust value clamped to [0, 1]
   */
  const calculateWarpAdjust = useCallback(
    (state: WarpAdjustDragState, currentY: number): number => {
      // Calculate delta from start position
      const deltaY = currentY - state.startY;

      // The usable drag range is 60% of the object height
      // This matches the visual range of the handle position
      const maxDelta = state.bounds.height * 0.6;

      // Convert pixel delta to adjustment delta
      const adjustDelta = deltaY / maxDelta;

      // Calculate new value clamped to [0, 1]
      const newWarpAdjust = Math.max(0, Math.min(1, state.initialWarpAdjust + adjustDelta));

      return newWarpAdjust;
    },
    [],
  );

  /**
   * Start warp adjust drag operation.
   */
  const startWarpAdjustDrag = useCallback(
    (objectId: string, startY: number, bounds: ObjectBounds): boolean => {
      const object = getFloatingObject(objectId);
      if (!object || !object.textEffects) {
        return false;
      }

      // Get the current warp adjustment value
      // Default to 0.5 if not set (middle of range)
      const initialWarpAdjust = object.textEffects.warpAdjustments?.adj1
        ? object.textEffects.warpAdjustments.adj1 / 100
        : 0.5;

      // Store drag state
      warpAdjustDragRef.current = {
        objectId,
        initialWarpAdjust,
        startY,
        bounds,
      };

      // Update cursor
      if (containerRef.current) {
        containerRef.current.style.cursor = WARP_ADJUST_CURSOR;
      }

      return true;
    },
    [getFloatingObject, containerRef],
  );

  /**
   * Update warp adjust during drag.
   */
  const moveWarpAdjustDrag = useCallback(
    (currentY: number): void => {
      const state = warpAdjustDragRef.current;
      if (!state) return;

      // Calculate new warp adjust value
      const newWarpAdjust = calculateWarpAdjust(state, currentY);

      // Preview the change (ephemeral UI state)
      previewWarpAdjust(state.objectId, newWarpAdjust);

      // Keep cursor consistent during drag
      if (containerRef.current) {
        containerRef.current.style.cursor = WARP_ADJUST_CURSOR;
      }
    },
    [calculateWarpAdjust, previewWarpAdjust, containerRef],
  );

  /**
   * Complete warp adjust drag.
   */
  const endWarpAdjustDrag = useCallback(
    (finalY: number): void => {
      const state = warpAdjustDragRef.current;
      if (!state) return;

      // Calculate final warp adjust value
      const newWarpAdjust = calculateWarpAdjust(state, finalY);

      // Only commit if value actually changed
      if (newWarpAdjust !== state.initialWarpAdjust) {
        commitWarpAdjust(state.objectId, newWarpAdjust);
      }

      // Clear preview
      clearWarpAdjustPreview(state.objectId);

      // Reset drag state
      warpAdjustDragRef.current = null;

      // Reset cursor
      if (containerRef.current) {
        containerRef.current.style.cursor = '';
      }
    },
    [calculateWarpAdjust, commitWarpAdjust, clearWarpAdjustPreview, containerRef],
  );

  /**
   * Cancel warp adjust drag.
   */
  const cancelWarpAdjustDrag = useCallback((): void => {
    const state = warpAdjustDragRef.current;
    if (!state) return;

    // Clear preview (reverts to original value)
    clearWarpAdjustPreview(state.objectId);

    // Reset drag state
    warpAdjustDragRef.current = null;

    // Reset cursor
    if (containerRef.current) {
      containerRef.current.style.cursor = '';
    }
  }, [clearWarpAdjustPreview, containerRef]);

  return {
    warpAdjustDragRef,
    startWarpAdjustDrag,
    moveWarpAdjustDrag,
    endWarpAdjustDrag,
    cancelWarpAdjustDrag,
    isWarpAdjustDragging,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get the cursor style for the warp adjust handle.
 *
 * This is a pure helper function for use in cursor management hooks.
 * Returns 'ns-resize' to indicate vertical dragging.
 *
 * Cursor Feedback for Warp Handle
 */
export function getWarpAdjustCursor(): string {
  return WARP_ADJUST_CURSOR;
}

/**
 * Check if a hit region is the warp adjust handle.
 */
export function isWarpAdjustHandle(region: string): boolean {
  return region === 'warp-adjust';
}

/**
 * Calculate the warp adjust handle position.
 *
 * The handle is positioned:
 * - Horizontally: centered on the object
 * - Vertically: at 20% + (warpAdjust * 60%) of the object height
 *
 * This creates a range where:
 * - warpAdjust = 0 -> handle at 20% from top
 * - warpAdjust = 0.5 -> handle at 50% from top
 * - warpAdjust = 1 -> handle at 80% from top
 *
 * @param bounds - Object bounds
 * @param warpAdjust - Current warp adjustment value (0-1)
 * @returns Point with x, y coordinates for the handle center
 */
export function calculateWarpAdjustHandlePosition(bounds: ObjectBounds, warpAdjust: number): Point {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height * (0.2 + warpAdjust * 0.6),
  };
}
