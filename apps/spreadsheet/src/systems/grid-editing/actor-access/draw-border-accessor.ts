/**
 * Draw Border Accessor Implementation
 *
 * Implements DrawBorderAccessor using selectors.
 * THIS IS THE ONLY PLACE that calls actor.getSnapshot() for draw border handlers.
 *
 * Extracted from coordinator/actor-access/draw-border.ts
 *
 * @module systems/grid-editing/actor-access/draw-border-accessor
 */

import { drawBorderSelectors } from '../../../selectors';
import type { DrawBorderAccessor, DrawBorderState } from '@mog-sdk/contracts/actors';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Minimal actor interface for draw border accessor.
 * Uses getSnapshot() to capture point-in-time state.
 */
type DrawBorderActor = { getSnapshot(): DrawBorderState };

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Creates a DrawBorderAccessor for point-in-time reads in handlers.
 *
 * Each method delegates to the corresponding selector with a fresh snapshot.
 * This ensures handlers always get current state at the moment of call.
 *
 * @param actor - The XState draw border actor
 * @returns DrawBorderAccessor interface for handlers
 */
export function createDrawBorderAccessor(actor: DrawBorderActor): DrawBorderAccessor {
  const snap = () => actor.getSnapshot();

  return {
    // ===========================================================================
    // Value Accessors (match value selectors)
    // ===========================================================================

    getBorderStyle: () => drawBorderSelectors.borderStyle(snap()),
    getBorderColor: () => drawBorderSelectors.borderColor(snap()),
    getLineStyle: () => drawBorderSelectors.lineStyle(snap()),
    getStartCell: () => drawBorderSelectors.startCell(snap()),
    getCurrentCell: () => drawBorderSelectors.currentCell(snap()),
    getDrawnCells: () => drawBorderSelectors.drawnCells(snap()),
    getSheetId: () => drawBorderSelectors.sheetId(snap()),

    // ===========================================================================
    // State Matching Accessors (match state selectors)
    // ===========================================================================

    isInactive: () => drawBorderSelectors.isInactive(snap()),
    isDrawingBorder: () => drawBorderSelectors.isDrawingBorder(snap()),
    isDrawingBorderGrid: () => drawBorderSelectors.isDrawingBorderGrid(snap()),
    isErasingBorder: () => drawBorderSelectors.isErasingBorder(snap()),
    isDrawing: () => drawBorderSelectors.isDrawing(snap()),
    isIdle: () => drawBorderSelectors.isIdle(snap()),

    // ===========================================================================
    // Derived Accessors
    // ===========================================================================

    isActive: () => drawBorderSelectors.isActive(snap()),
    isErasing: () => drawBorderSelectors.isErasing(snap()),
    getMode: () => drawBorderSelectors.mode(snap()),
  };
}
