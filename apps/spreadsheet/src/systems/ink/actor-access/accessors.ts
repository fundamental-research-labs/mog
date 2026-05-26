/**
 * Ink Machine Accessors
 *
 * Read-only state access interface for the ink machine.
 * Part of the Actor Access Layer pattern - queries via selectors.
 *
 * ARCHITECTURE NOTES:
 * - Accessors provide read-only state access
 * - Each accessor wraps a selector for the current state
 * - Used by coordinator and rendering layer
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Actor Access Layer
 */

import type { InkPoint, InkTool, StrokeId } from '@mog-sdk/contracts/ink';
import type { AnyActorRef } from 'xstate';

import { inkSelectors } from '../machines/selectors';
import type { InkSelectionMode } from '../machines/types';

// =============================================================================
// ACCESSOR INTERFACE
// =============================================================================

/**
 * Accessor interface for reading ink state.
 *
 * Used by coordinator and rendering layer to query machine state
 * without directly accessing the context.
 */
export interface InkAccessor {
  // State checks
  /**
   * Check if ink mode is active.
   */
  isActive(): boolean;

  /**
   * Check if currently stroking (drawing a stroke).
   */
  isStroking(): boolean;

  /**
   * Check if currently erasing.
   */
  isErasing(): boolean;

  /**
   * Check if currently selecting with lasso.
   */
  isSelecting(): boolean;

  /**
   * Check if in idle state (not in ink mode).
   */
  isIdle(): boolean;

  /**
   * Check if in drawing mode (ready to draw, not actively stroking).
   */
  isDrawingMode(): boolean;

  /**
   * Check if user is actively interacting (stroking, erasing, or selecting).
   */
  isInteracting(): boolean;

  // Context values
  /**
   * Get the target drawing object ID.
   */
  getTargetDrawingId(): string | null;

  /**
   * Get the current stroke ID.
   */
  getCurrentStrokeId(): StrokeId | null;

  /**
   * Get current stroke points as immutable array.
   *
   * Note: Only call when needed (creates a copy). Use getCurrentStrokeLength
   * for performance when you only need the count.
   */
  getCurrentStroke(): InkPoint[];

  /**
   * Get current stroke length without copying.
   *
   * Use this for performance when you only need the count.
   */
  getCurrentStrokeLength(): number;

  /**
   * Get the active ink tool.
   */
  getActiveTool(): InkTool;

  /**
   * Get the active stroke color.
   */
  getActiveColor(): string;

  /**
   * Get the active stroke width.
   */
  getActiveWidth(): number;

  /**
   * Get the active stroke opacity.
   */
  getActiveOpacity(): number;

  /**
   * Get the current selection mode.
   */
  getSelectionMode(): InkSelectionMode;

  /**
   * Get the lasso selection points.
   */
  getLassoPoints(): InkPoint[];

  /**
   * Get the IDs of selected strokes.
   */
  getSelectedStrokeIds(): StrokeId[];

  /**
   * Check if any strokes are selected.
   */
  hasSelection(): boolean;

  /**
   * Get the last recorded point (for cursor display).
   */
  getLastPoint(): InkPoint | null;

  /**
   * Get tool settings as a bundle.
   */
  getToolSettings(): {
    tool: InkTool;
    color: string;
    width: number;
    opacity: number;
  };
}

// =============================================================================
// ACCESSOR FACTORY
// =============================================================================

/**
 * Create accessor object that reads from ink actor.
 *
 * @param actor - The ink machine actor to read from
 * @returns Object with read-only accessor methods
 *
 * @example
 * const accessor = createInkAccessor(inkActor);
 * if (accessor.isActive()) {
 * console.log('Active tool:', accessor.getActiveTool);
 * console.log('Stroke length:', accessor.getCurrentStrokeLength);
 * }
 */
export function createInkAccessor(actor: AnyActorRef): InkAccessor {
  const getState = () => actor.getSnapshot();

  return {
    // State checks
    isActive: () => inkSelectors.isActive(getState()),
    isStroking: () => inkSelectors.isStroking(getState()),
    isErasing: () => inkSelectors.isErasing(getState()),
    isSelecting: () => inkSelectors.isSelecting(getState()),
    isIdle: () => inkSelectors.isIdle(getState()),
    isDrawingMode: () => inkSelectors.isDrawingMode(getState()),
    isInteracting: () => inkSelectors.isInteracting(getState()),

    // Context values
    getTargetDrawingId: () => inkSelectors.targetDrawingId(getState()),
    getCurrentStrokeId: () => inkSelectors.currentStrokeId(getState()),
    getCurrentStroke: () => inkSelectors.currentStroke(getState()),
    getCurrentStrokeLength: () => inkSelectors.currentStrokeLength(getState()),
    getActiveTool: () => inkSelectors.activeTool(getState()),
    getActiveColor: () => inkSelectors.activeColor(getState()),
    getActiveWidth: () => inkSelectors.activeWidth(getState()),
    getActiveOpacity: () => inkSelectors.activeOpacity(getState()),
    getSelectionMode: () => inkSelectors.selectionMode(getState()),
    getLassoPoints: () => inkSelectors.lassoPoints(getState()),
    getSelectedStrokeIds: () => inkSelectors.selectedStrokeIds(getState()),
    hasSelection: () => inkSelectors.hasSelection(getState()),
    getLastPoint: () => inkSelectors.lastPoint(getState()),
    getToolSettings: () => inkSelectors.toolSettings(getState()),
  };
}
