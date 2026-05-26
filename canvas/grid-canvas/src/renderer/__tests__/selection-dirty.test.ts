/**
 * Selection Dirty Rect Tests
 *
 * Verifies that the selection handler in buildFieldHandlers() computes
 * partial dirty rects (old + new selection bounds) instead of full dirty
 * for the selection layer.
 *
 * Tests the computeSelectionDirtyHint() method via a minimal mock that
 * mirrors the relevant internal structure of GridRendererImpl.
 *
 * @module grid-canvas/renderer/__tests__/selection-dirty
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type { SelectionRenderState } from '@mog-sdk/contracts/rendering';
import { ViewportPositionIndex, ViewportMergeIndex } from '@mog/grid-renderer';
import { GridRendererImpl } from '../grid-renderer';

// =============================================================================
// Helpers
// =============================================================================

/** Build a minimal SelectionRenderState for testing */
function makeSelection(
  overrides: Partial<SelectionRenderState> & {
    ranges: CellRange[];
    activeCell: { row: number; col: number };
  },
): SelectionRenderState {
  return {
    isSelecting: false,
    isFormulaMode: false,
    isDraggingFillHandle: false,
    isRightDraggingFillHandle: false,
    direction: 'down',
    hasFullRowSelection: false,
    hasFullColumnSelection: false,
    selectedRows: new Set<number>(),
    selectedCols: new Set<number>(),
    hasError: false,
    ...overrides,
  } as SelectionRenderState;
}

/**
 * Build a fake GridRendererImpl-shaped object with just enough structure
 * to exercise computeSelectionDirtyHint().
 */
function createFakeRenderer() {
  const positionIndex = new ViewportPositionIndex(20, 80);
  const mergeIndex = new ViewportMergeIndex();

  // Set up position data for rows 0..19 and cols 0..9
  // Row heights: 20px each, Col widths: 80px each
  const rowPositions = new Float64Array(20);
  for (let i = 0; i < 20; i++) rowPositions[i] = i * 20;
  const colPositions = new Float64Array(10);
  for (let i = 0; i < 10; i++) colPositions[i] = i * 80;
  positionIndex.setPositions(rowPositions, colPositions, 0, 0);

  const fake = {
    positionIndex,
    mergeIndex,
  };

  // Attach the private method from prototype
  const proto = GridRendererImpl.prototype as any;
  (fake as any).computeSelectionDirtyHint = proto.computeSelectionDirtyHint.bind(fake);
  (fake as any).selectionRangeToPixelRect = proto.selectionRangeToPixelRect.bind(fake);
  (fake as any).cellToPixelRect = proto.cellToPixelRect.bind(fake);
  (fake as any).expandRangeForMerges = proto.expandRangeForMerges.bind(fake);

  return {
    fake,
    positionIndex,
    mergeIndex,
    computeSelectionDirtyHint: (fake as any).computeSelectionDirtyHint as (
      oldSel: SelectionRenderState,
      newSel: SelectionRenderState,
    ) => any,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('computeSelectionDirtyHint', () => {
  describe('arrow key navigation (single cell to single cell)', () => {
    it('returns rects dirty hint with old and new cell bounds', () => {
      const { computeSelectionDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [{ startRow: 2, startCol: 3, endRow: 2, endCol: 3 }],
        activeCell: { row: 2, col: 3 },
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 3, startCol: 3, endRow: 3, endCol: 3 }],
        activeCell: { row: 3, col: 3 },
      });

      const hint = computeSelectionDirtyHint(oldSel, newSel);

      expect(hint.type).toBe('rects');
      expect(hint.bounds).toBeDefined();
      // Should have rects for: old range, old active cell, new range, new active cell
      // (old range == old active cell, new range == new active cell in single-cell case,
      //  but they're computed separately)
      expect(hint.bounds.length).toBe(4);

      // Verify old cell rect (row=2, col=3): y=40, x=240, h=20, w=80 (+3px padding)
      const oldRect = hint.bounds[0];
      expect(oldRect.x).toBe(240 - 3);
      expect(oldRect.y).toBe(40 - 3);
      expect(oldRect.width).toBe(80 + 6);
      expect(oldRect.height).toBe(20 + 6);

      // Verify new cell rect (row=3, col=3): y=60, x=240, h=20, w=80 (+3px padding)
      const newRect = hint.bounds[2];
      expect(newRect.x).toBe(240 - 3);
      expect(newRect.y).toBe(60 - 3);
      expect(newRect.width).toBe(80 + 6);
      expect(newRect.height).toBe(20 + 6);
    });
  });

  describe('deselection (range to empty)', () => {
    it('returns rects with only old bounds when new selection has no ranges', () => {
      const { computeSelectionDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
        activeCell: { row: 1, col: 1 },
      });
      const newSel = makeSelection({
        ranges: [],
        activeCell: { row: 0, col: 0 },
      });

      const hint = computeSelectionDirtyHint(oldSel, newSel);

      expect(hint.type).toBe('rects');
      // Old range + old active cell + new active cell (no new range since empty)
      expect(hint.bounds.length).toBe(3);
    });
  });

  describe('first selection (no previous)', () => {
    it('returns rects when old selection has empty ranges', () => {
      const { computeSelectionDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [],
        activeCell: { row: 0, col: 0 },
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 5, startCol: 2, endRow: 5, endCol: 2 }],
        activeCell: { row: 5, col: 2 },
      });

      const hint = computeSelectionDirtyHint(oldSel, newSel);

      expect(hint.type).toBe('rects');
      // Old active cell + new range + new active cell
      expect(hint.bounds.length).toBe(3);
    });
  });

  describe('full dirty fallbacks', () => {
    it('returns full dirty for full-row selection', () => {
      const { computeSelectionDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
        activeCell: { row: 1, col: 1 },
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 2, startCol: 0, endRow: 2, endCol: 16383, isFullRow: true }],
        activeCell: { row: 2, col: 0 },
        hasFullRowSelection: true,
      });

      const hint = computeSelectionDirtyHint(oldSel, newSel);
      expect(hint.type).toBe('full');
    });

    it('returns full dirty for full-column selection', () => {
      const { computeSelectionDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [{ startRow: 0, startCol: 0, endRow: 1048575, endCol: 0, isFullColumn: true }],
        activeCell: { row: 0, col: 0 },
        hasFullColumnSelection: true,
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
        activeCell: { row: 1, col: 1 },
      });

      const hint = computeSelectionDirtyHint(oldSel, newSel);
      expect(hint.type).toBe('full');
    });

    it('returns full dirty for multi-range selection', () => {
      const { computeSelectionDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [
          { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
          { startRow: 3, startCol: 3, endRow: 3, endCol: 3 },
        ],
        activeCell: { row: 1, col: 1 },
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 5, startCol: 5, endRow: 5, endCol: 5 }],
        activeCell: { row: 5, col: 5 },
      });

      const hint = computeSelectionDirtyHint(oldSel, newSel);
      expect(hint.type).toBe('full');
    });

    it('returns full dirty for formula mode', () => {
      const { computeSelectionDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
        activeCell: { row: 1, col: 1 },
        isFormulaMode: true,
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 2, startCol: 2, endRow: 2, endCol: 2 }],
        activeCell: { row: 2, col: 2 },
        isFormulaMode: true,
      });

      const hint = computeSelectionDirtyHint(oldSel, newSel);
      expect(hint.type).toBe('full');
    });

    it('returns full dirty when position index has no data', () => {
      const { computeSelectionDirtyHint, positionIndex } = createFakeRenderer();

      // Clear position data
      positionIndex.setPositions(null, null, 0, 0);

      const oldSel = makeSelection({
        ranges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
        activeCell: { row: 1, col: 1 },
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 2, startCol: 2, endRow: 2, endCol: 2 }],
        activeCell: { row: 2, col: 2 },
      });

      const hint = computeSelectionDirtyHint(oldSel, newSel);
      expect(hint.type).toBe('full');
    });
  });

  describe('range selection (non-single-cell)', () => {
    it('returns rects for range expansion (shift+arrow)', () => {
      const { computeSelectionDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [{ startRow: 2, startCol: 2, endRow: 4, endCol: 4 }],
        activeCell: { row: 4, col: 4 },
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 2, startCol: 2, endRow: 5, endCol: 4 }],
        activeCell: { row: 5, col: 4 },
      });

      const hint = computeSelectionDirtyHint(oldSel, newSel);

      expect(hint.type).toBe('rects');
      expect(hint.bounds.length).toBe(4);

      // Old range: rows 2..4, cols 2..4
      // x = 2*80 = 160, y = 2*20 = 40
      // x2 = 4*80 + 80 = 400, y2 = 4*20 + 20 = 100
      const oldRangeRect = hint.bounds[0];
      expect(oldRangeRect.x).toBe(160 - 3);
      expect(oldRangeRect.y).toBe(40 - 3);
      expect(oldRangeRect.width).toBe(240 + 6);
      expect(oldRangeRect.height).toBe(60 + 6);
    });
  });

  describe('merged cells', () => {
    it('expands dirty rect to cover merged cell bounds', () => {
      const { computeSelectionDirtyHint, mergeIndex } = createFakeRenderer();

      // Add a merge at rows 2-3, cols 2-3
      mergeIndex.setMerges([{ start_row: 2, start_col: 2, end_row: 3, end_col: 3 }]);

      const oldSel = makeSelection({
        ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
        activeCell: { row: 0, col: 0 },
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 2, startCol: 2, endRow: 2, endCol: 2 }],
        activeCell: { row: 2, col: 2 },
      });

      const hint = computeSelectionDirtyHint(oldSel, newSel);

      expect(hint.type).toBe('rects');

      // The new range rect should be expanded to cover the merged region (2,2)-(3,3)
      // x = 2*80 = 160, y = 2*20 = 40
      // x2 = 3*80 + 80 = 320, y2 = 3*20 + 20 = 80
      const newRangeRect = hint.bounds[2];
      expect(newRangeRect.x).toBe(160 - 3);
      expect(newRangeRect.y).toBe(40 - 3);
      expect(newRangeRect.width).toBe(160 + 6); // 320 - 160 + 6
      expect(newRangeRect.height).toBe(40 + 6); // 80 - 40 + 6
    });
  });
});
