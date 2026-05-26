/**
 * Ink State Selectors
 *
 * Pure functions for extracting derived state from ink machine snapshots.
 * Used by the accessor layer for read-only state access.
 *
 * ARCHITECTURE NOTES:
 * - All selectors are pure functions (no side effects)
 * - Each selector takes state and returns a derived value
 * - Performance-conscious: currentStrokeLength avoids copying
 *
 */

import type { InkPoint, InkTool, StrokeId } from '@mog-sdk/contracts/ink';

import type { InkState } from './machine';
import type { InkSelectionMode } from './types';
import { getCurrentStrokeCopy } from './types';

// =============================================================================
// SELECTOR IMPLEMENTATION
// =============================================================================

/**
 * Ink state selectors - used by accessor layer.
 *
 * All selectors are pure functions that take state and return derived values.
 */
export const inkSelectors = {
  // ===========================================================================
  // STATE CHECKS
  // ===========================================================================

  /**
   * Check if ink mode is active (not idle).
   */
  isActive: (state: InkState): boolean => {
    return !state.matches('idle');
  },

  /**
   * Check if currently stroking (drawing a stroke).
   */
  isStroking: (state: InkState): boolean => {
    return state.matches('stroking');
  },

  /**
   * Check if currently erasing.
   */
  isErasing: (state: InkState): boolean => {
    return state.matches('erasingActive');
  },

  /**
   * Check if currently selecting with lasso.
   */
  isSelecting: (state: InkState): boolean => {
    return state.matches('selecting');
  },

  /**
   * Check if in idle state (not in ink mode).
   */
  isIdle: (state: InkState): boolean => {
    return state.matches('idle');
  },

  /**
   * Check if in drawing mode (ready to draw, not actively stroking).
   */
  isDrawingMode: (state: InkState): boolean => {
    return state.matches('drawing');
  },

  // ===========================================================================
  // CONTEXT VALUES
  // ===========================================================================

  /**
   * Get the target drawing object ID.
   */
  targetDrawingId: (state: InkState): string | null => {
    return state.context.targetDrawingId;
  },

  /**
   * Get the current stroke ID.
   */
  currentStrokeId: (state: InkState): StrokeId | null => {
    return state.context.currentStrokeId;
  },

  /**
   * Get current stroke points as immutable array.
   *
   * Note: Only call this when needed (e.g., on stroke complete).
   * For count, use currentStrokeLength instead.
   */
  currentStroke: (state: InkState): InkPoint[] => {
    return getCurrentStrokeCopy(state.context);
  },

  /**
   * Get current stroke length without copying.
   *
   * Use this for performance when you only need the count.
   */
  currentStrokeLength: (state: InkState): number => {
    return state.context.currentStrokeBufferLength;
  },

  /**
   * Get the active ink tool.
   */
  activeTool: (state: InkState): InkTool => {
    return state.context.activeTool;
  },

  /**
   * Get the active stroke color.
   */
  activeColor: (state: InkState): string => {
    return state.context.activeColor;
  },

  /**
   * Get the active stroke width.
   */
  activeWidth: (state: InkState): number => {
    return state.context.activeWidth;
  },

  /**
   * Get the active stroke opacity.
   */
  activeOpacity: (state: InkState): number => {
    return state.context.activeOpacity;
  },

  /**
   * Get the current selection mode.
   */
  selectionMode: (state: InkState): InkSelectionMode => {
    return state.context.selectionMode;
  },

  /**
   * Get the lasso selection points.
   */
  lassoPoints: (state: InkState): InkPoint[] => {
    return state.context.lassoPoints;
  },

  /**
   * Get the IDs of selected strokes.
   */
  selectedStrokeIds: (state: InkState): StrokeId[] => {
    return state.context.selectedStrokeIds;
  },

  /**
   * Check if any strokes are selected.
   */
  hasSelection: (state: InkState): boolean => {
    return state.context.selectedStrokeIds.length > 0;
  },

  /**
   * Get the last recorded point (for cursor display).
   */
  lastPoint: (state: InkState): InkPoint | null => {
    return state.context.lastPoint;
  },

  // ===========================================================================
  // COMPOSITE SELECTORS
  // ===========================================================================

  /**
   * Check if user is actively interacting (stroking, erasing, or selecting).
   */
  isInteracting: (state: InkState): boolean => {
    return (
      state.matches('stroking') || state.matches('erasingActive') || state.matches('selecting')
    );
  },

  /**
   * Get tool settings as a bundle.
   */
  toolSettings: (
    state: InkState,
  ): {
    tool: InkTool;
    color: string;
    width: number;
    opacity: number;
  } => {
    return {
      tool: state.context.activeTool,
      color: state.context.activeColor,
      width: state.context.activeWidth,
      opacity: state.context.activeOpacity,
    };
  },
};
