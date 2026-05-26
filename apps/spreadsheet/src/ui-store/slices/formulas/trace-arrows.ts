/**
 * Trace Arrows Slice
 *
 * Manages trace arrows state for formula auditing visualization.
 * Uses CellId (stable identity) not row/col positions for arrow endpoints.
 *
 * This is ephemeral UI state (not persisted to Yjs) - arrows disappear
 * when the user closes the spreadsheet.
 *
 * @see contracts/src/trace-arrows.ts for type definitions
 */

import type { StateCreator } from 'zustand';

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type { TraceArrow, TraceArrowType } from '@mog-sdk/contracts/trace-arrows';

// =============================================================================
// Slice State Interface
// =============================================================================

export interface TraceArrowsSliceState {
  /**
   * Map from sheetId to arrows visible on that sheet.
   * Uses Record for Zustand compatibility (Map doesn't trigger re-renders properly).
   */
  traceArrows: Record<SheetId, TraceArrow[]>;

  /**
   * The cell that was the "root" of the current trace operation.
   */
  tracedCellId: CellId | null;

  /**
   * Sheet containing the traced cell.
   */
  tracedSheetId: SheetId | null;
}

// =============================================================================
// Slice Actions Interface
// =============================================================================

export interface TraceArrowsSliceActions {
  /**
   * Add precedent arrows for a cell.
   * Precedent arrows show cells that the target cell depends on (inputs).
   */
  addPrecedentArrows: (sheetId: SheetId, targetCellId: CellId, arrows: TraceArrow[]) => void;

  /**
   * Add dependent arrows for a cell.
   * Dependent arrows show cells that depend on the source cell (outputs).
   */
  addDependentArrows: (sheetId: SheetId, sourceCellId: CellId, arrows: TraceArrow[]) => void;

  /**
   * Remove all arrows for a specific cell.
   * Called when the traced cell is deleted or user removes individual cell's arrows.
   */
  removeArrowsForCell: (cellId: CellId) => void;

  /**
   * Remove all arrows on a specific sheet (or all sheets if not specified).
   */
  removeAllArrows: (sheetId?: SheetId) => void;

  /**
   * Remove only precedent type arrows.
   */
  removePrecedentArrows: () => void;

  /**
   * Remove only dependent type arrows.
   */
  removeDependentArrows: () => void;

  /**
   * Clear all trace arrows and reset traced cell state.
   */
  clearAllTraceArrows: () => void;

  /**
   * Set the currently traced cell (for UI highlighting).
   */
  setTracedCell: (sheetId: SheetId | null, cellId: CellId | null) => void;
}

// =============================================================================
// Combined Slice Type
// =============================================================================

export type TraceArrowsSlice = TraceArrowsSliceState & TraceArrowsSliceActions;

// =============================================================================
// Slice Creator
// =============================================================================

export const createTraceArrowsSlice: StateCreator<TraceArrowsSlice, [], [], TraceArrowsSlice> = (
  set,
) => ({
  // Initial state
  traceArrows: {},
  tracedCellId: null,
  tracedSheetId: null,

  // Add precedent arrows
  addPrecedentArrows: (sheetId: SheetId, targetCellId: CellId, arrows: TraceArrow[]) => {
    set((state) => {
      const existing = state.traceArrows[sheetId] ?? [];
      // Filter to only include arrows of type 'precedent'
      const precedentArrows = arrows.filter((a) => a.type === 'precedent');

      // Add arrows to each relevant sheet (handle cross-sheet arrows)
      const newArrowsBySheet = { ...state.traceArrows };

      // Add to target sheet
      newArrowsBySheet[sheetId] = [...existing, ...precedentArrows.filter((a) => !a.crossSheet)];

      // Add cross-sheet arrows to both sheets
      for (const arrow of precedentArrows) {
        if (arrow.crossSheet) {
          // Add to source sheet
          const sourceSheetArrows = newArrowsBySheet[arrow.fromSheetId] ?? [];
          if (!sourceSheetArrows.some((a) => a.id === arrow.id)) {
            newArrowsBySheet[arrow.fromSheetId] = [...sourceSheetArrows, arrow];
          }
          // Add to target sheet
          const targetSheetArrows = newArrowsBySheet[arrow.toSheetId] ?? [];
          if (!targetSheetArrows.some((a) => a.id === arrow.id)) {
            newArrowsBySheet[arrow.toSheetId] = [...targetSheetArrows, arrow];
          }
        }
      }

      return {
        traceArrows: newArrowsBySheet,
        tracedCellId: targetCellId,
        tracedSheetId: sheetId,
      };
    });
  },

  // Add dependent arrows
  addDependentArrows: (sheetId: SheetId, sourceCellId: CellId, arrows: TraceArrow[]) => {
    set((state) => {
      const existing = state.traceArrows[sheetId] ?? [];
      // Filter to only include arrows of type 'dependent'
      const dependentArrows = arrows.filter((a) => a.type === 'dependent');

      // Add arrows to each relevant sheet (handle cross-sheet arrows)
      const newArrowsBySheet = { ...state.traceArrows };

      // Add to source sheet
      newArrowsBySheet[sheetId] = [...existing, ...dependentArrows.filter((a) => !a.crossSheet)];

      // Add cross-sheet arrows to both sheets
      for (const arrow of dependentArrows) {
        if (arrow.crossSheet) {
          // Add to source sheet
          const sourceSheetArrows = newArrowsBySheet[arrow.fromSheetId] ?? [];
          if (!sourceSheetArrows.some((a) => a.id === arrow.id)) {
            newArrowsBySheet[arrow.fromSheetId] = [...sourceSheetArrows, arrow];
          }
          // Add to target sheet
          const targetSheetArrows = newArrowsBySheet[arrow.toSheetId] ?? [];
          if (!targetSheetArrows.some((a) => a.id === arrow.id)) {
            newArrowsBySheet[arrow.toSheetId] = [...targetSheetArrows, arrow];
          }
        }
      }

      return {
        traceArrows: newArrowsBySheet,
        tracedCellId: sourceCellId,
        tracedSheetId: sheetId,
      };
    });
  },

  // Remove arrows for a specific cell
  removeArrowsForCell: (cellId: CellId) => {
    set((state) => {
      const newArrowsBySheet: Record<SheetId, TraceArrow[]> = {};

      for (const [sheetIdStr, arrows] of Object.entries(state.traceArrows)) {
        const filtered = arrows.filter(
          (arrow) => arrow.fromCellId !== cellId && arrow.toCellId !== cellId,
        );
        if (filtered.length > 0) {
          newArrowsBySheet[toSheetId(sheetIdStr)] = filtered;
        }
      }

      // Clear traced cell if it was removed
      const clearTracedCell = state.tracedCellId === cellId;

      return {
        traceArrows: newArrowsBySheet,
        tracedCellId: clearTracedCell ? null : state.tracedCellId,
        tracedSheetId: clearTracedCell ? null : state.tracedSheetId,
      };
    });
  },

  // Remove all arrows on a sheet (or all sheets)
  removeAllArrows: (sheetId?: SheetId) => {
    set((state) => {
      if (sheetId) {
        // Remove arrows only for the specified sheet
        const newArrowsBySheet = { ...state.traceArrows };
        delete newArrowsBySheet[sheetId];

        // Clear traced cell if it was on this sheet
        const clearTracedCell = state.tracedSheetId === sheetId;

        return {
          traceArrows: newArrowsBySheet,
          tracedCellId: clearTracedCell ? null : state.tracedCellId,
          tracedSheetId: clearTracedCell ? null : state.tracedSheetId,
        };
      } else {
        // Remove all arrows
        return {
          traceArrows: {},
          tracedCellId: null,
          tracedSheetId: null,
        };
      }
    });
  },

  // Remove only precedent arrows
  removePrecedentArrows: () => {
    set((state) => {
      const newArrowsBySheet: Record<SheetId, TraceArrow[]> = {};

      for (const [sheetIdStr, arrows] of Object.entries(state.traceArrows)) {
        const filtered = arrows.filter((arrow) => arrow.type !== 'precedent');
        if (filtered.length > 0) {
          newArrowsBySheet[toSheetId(sheetIdStr)] = filtered;
        }
      }

      return { traceArrows: newArrowsBySheet };
    });
  },

  // Remove only dependent arrows
  removeDependentArrows: () => {
    set((state) => {
      const newArrowsBySheet: Record<SheetId, TraceArrow[]> = {};

      for (const [sheetIdStr, arrows] of Object.entries(state.traceArrows)) {
        const filtered = arrows.filter((arrow) => arrow.type !== 'dependent');
        if (filtered.length > 0) {
          newArrowsBySheet[toSheetId(sheetIdStr)] = filtered;
        }
      }

      return { traceArrows: newArrowsBySheet };
    });
  },

  // Clear all trace arrows
  clearAllTraceArrows: () => {
    set({
      traceArrows: {},
      tracedCellId: null,
      tracedSheetId: null,
    });
  },

  // Set traced cell
  setTracedCell: (sheetId: SheetId | null, cellId: CellId | null) => {
    set({
      tracedCellId: cellId,
      tracedSheetId: sheetId,
    });
  },
});

// =============================================================================
// Selectors (for use in hooks)
// =============================================================================

/**
 * Get trace arrows for a specific sheet.
 */
export function selectTraceArrowsForSheet(
  state: TraceArrowsSliceState,
  sheetId: SheetId,
): TraceArrow[] {
  return state.traceArrows[sheetId] ?? [];
}

/**
 * Get all trace arrows (across all sheets).
 */
export function selectAllTraceArrows(state: TraceArrowsSliceState): TraceArrow[] {
  return Object.values(state.traceArrows).flat();
}

/**
 * Check if there are any trace arrows visible.
 */
export function selectHasTraceArrows(state: TraceArrowsSliceState): boolean {
  return Object.values(state.traceArrows).some((arrows) => arrows.length > 0);
}

/**
 * Get arrows by type.
 */
export function selectTraceArrowsByType(
  state: TraceArrowsSliceState,
  type: TraceArrowType,
): TraceArrow[] {
  return Object.values(state.traceArrows)
    .flat()
    .filter((arrow) => arrow.type === type);
}
