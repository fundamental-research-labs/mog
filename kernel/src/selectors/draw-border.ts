/**
 * Draw Border Actor Selectors
 *
 * Pure functions that extract data from draw border state.
 * Moved from contracts to kernel (contracts holds types only).
 *
 * @module @mog-sdk/kernel/selectors
 */

import type {
  DrawBorderMode,
  DrawBorderState,
  DrawBorderStyle,
} from '@mog-sdk/contracts/actors/draw-border';

export {
  type DrawBorderMode,
  type DrawBorderState,
  type DrawBorderStyle,
} from '@mog-sdk/contracts/actors/draw-border';

export const drawBorderSelectors = {
  // ===========================================================================
  // Value Selectors (context fields)
  // ===========================================================================

  /** Get the current border style */
  borderStyle: (state: DrawBorderState): DrawBorderStyle | null => state.context.borderStyle,

  /** Get the border color (convenience accessor) */
  borderColor: (state: DrawBorderState): string | null => state.context.borderStyle?.color ?? null,

  /** Get the border line style (convenience accessor) */
  lineStyle: (state: DrawBorderState): DrawBorderStyle['style'] | null =>
    state.context.borderStyle?.style ?? null,

  /** Get the starting cell of the current drag operation */
  startCell: (state: DrawBorderState) => state.context.startCell,

  /** Get the current cell during drag */
  currentCell: (state: DrawBorderState) => state.context.currentCell,

  /** Get cells drawn during the current drag operation */
  drawnCells: (state: DrawBorderState) => state.context.drawnCells,

  /** Get the sheet ID where drawing is occurring */
  sheetId: (state: DrawBorderState) => state.context.sheetId,

  // ===========================================================================
  // State Matching Selectors (state.matches())
  // ===========================================================================

  /** Check if inactive (no drawing mode active) */
  isInactive: (state: DrawBorderState): boolean => state.matches('inactive'),

  /** Check if in draw border mode */
  isDrawingBorder: (state: DrawBorderState): boolean => state.matches('drawingBorder'),

  /** Check if in draw border grid mode */
  isDrawingBorderGrid: (state: DrawBorderState): boolean => state.matches('drawingBorderGrid'),

  /** Check if in erase border mode */
  isErasingBorder: (state: DrawBorderState): boolean => state.matches('erasingBorder'),

  /** Check if currently drawing (mouse down in any active mode) */
  isDrawing: (state: DrawBorderState): boolean =>
    state.matches({ drawingBorder: 'active' }) ||
    state.matches({ drawingBorderGrid: 'active' }) ||
    state.matches({ erasingBorder: 'active' }),

  /** Check if in idle sub-state (waiting for mouse down) */
  isIdle: (state: DrawBorderState): boolean =>
    state.matches({ drawingBorder: 'idle' }) ||
    state.matches({ drawingBorderGrid: 'idle' }) ||
    state.matches({ erasingBorder: 'idle' }),

  // ===========================================================================
  // Derived Selectors (computed from multiple values)
  // ===========================================================================

  /** Check if any drawing mode is active (not inactive) */
  isActive: (state: DrawBorderState): boolean => !state.matches('inactive'),

  /** Check if erasing (in erase mode and drawing) */
  isErasing: (state: DrawBorderState): boolean => state.matches({ erasingBorder: 'active' }),

  /**
   * Get the current drawing mode.
   * @returns 'draw' | 'drawGrid' | 'erase' | null
   */
  mode: (state: DrawBorderState): DrawBorderMode => {
    if (state.matches('drawingBorder')) return 'draw';
    if (state.matches('drawingBorderGrid')) return 'drawGrid';
    if (state.matches('erasingBorder')) return 'erase';
    return null;
  },
};
