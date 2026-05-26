/**
 * Draw Border Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * ARCHITECTURE: Selectors are the single primitive for extraction logic.
 * - Snapshots compose selectors (no duplication)
 * - Accessors wrap selectors + getSnapshot() (no duplication)
 * - Hooks use selectors directly with useSelector (no duplication)
 *
 * @module @mog-sdk/contracts/actors/draw-border
 */

import type { CellCoord } from '../machines/types';

// =============================================================================
// STATE TYPE (minimal version for selectors)
// =============================================================================

/**
 * Border style configuration for drawing.
 */
export interface DrawBorderStyle {
  /** Border color (hex, rgb, or theme color) */
  color: string;
  /** Border line style */
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair';
}

/**
 * Draw border mode types.
 */
export type DrawBorderMode = 'draw' | 'drawGrid' | 'erase' | null;

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 * This is the input type for all selector functions.
 */
export interface DrawBorderState {
  context: {
    /** Current border style to apply (null when erasing) */
    borderStyle: DrawBorderStyle | null;
    /** Starting cell of the current drag operation */
    startCell: CellCoord | null;
    /** Current cell during drag (end of range) */
    currentCell: CellCoord | null;
    /** Cells that have been drawn on during the current drag operation */
    drawnCells: CellCoord[];
    /** Sheet ID where drawing is occurring */
    sheetId: string | null;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

/**
 * DrawBorderAccessor interface for handlers.
 * Mirrors selectors 1:1 with method names (get* prefix for values).
 *
 * This is the contract that handlers use to read draw border state.
 * Implementation lives in engine/src/state/coordinator/actor-access/draw-border.ts
 */
export interface DrawBorderAccessor {
  // ===========================================================================
  // Value Accessors (match value selectors)
  // ===========================================================================

  /** Get the current border style */
  getBorderStyle(): DrawBorderStyle | null;

  /** Get the border color (convenience accessor) */
  getBorderColor(): string | null;

  /** Get the border line style (convenience accessor) */
  getLineStyle(): DrawBorderStyle['style'] | null;

  /** Get the starting cell of the current drag operation */
  getStartCell(): CellCoord | null;

  /** Get the current cell during drag */
  getCurrentCell(): CellCoord | null;

  /** Get cells drawn during the current drag operation */
  getDrawnCells(): CellCoord[];

  /** Get the sheet ID where drawing is occurring */
  getSheetId(): string | null;

  // ===========================================================================
  // State Matching Accessors (match state selectors)
  // ===========================================================================

  /** Check if inactive (no drawing mode active) */
  isInactive(): boolean;

  /** Check if in draw border mode */
  isDrawingBorder(): boolean;

  /** Check if in draw border grid mode */
  isDrawingBorderGrid(): boolean;

  /** Check if in erase border mode */
  isErasingBorder(): boolean;

  /** Check if currently drawing (mouse down in any active mode) */
  isDrawing(): boolean;

  /** Check if in idle sub-state (waiting for mouse down) */
  isIdle(): boolean;

  // ===========================================================================
  // Derived Accessors
  // ===========================================================================

  /** Check if any drawing mode is active (not inactive) */
  isActive(): boolean;

  /** Check if erasing (in erase mode and drawing) */
  isErasing(): boolean;

  /** Get the current drawing mode ('draw' | 'drawGrid' | 'erase' | null) */
  getMode(): DrawBorderMode;
}
