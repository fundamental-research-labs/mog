/**
 * Headers Dirty Rect Tests
 *
 * Verifies that computeHeadersDirtyHint() computes partial dirty rects
 * for the headers layer (column/row header highlight strips) when the
 * selection changes, instead of marking the entire headers layer dirty.
 *
 * @module grid-canvas/renderer/__tests__/headers-dirty
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type { SelectionRenderState } from '@mog-sdk/contracts/rendering';
import {
  COL_HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
  ViewportPositionIndex,
  ViewportMergeIndex,
} from '@mog/grid-renderer';
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
 * to exercise computeHeadersDirtyHint().
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
  (fake as any).computeHeadersDirtyHint = proto.computeHeadersDirtyHint.bind(fake);

  return {
    fake,
    positionIndex,
    mergeIndex,
    computeHeadersDirtyHint: (fake as any).computeHeadersDirtyHint as (
      oldSel: SelectionRenderState,
      newSel: SelectionRenderState,
    ) => any,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('computeHeadersDirtyHint', () => {
  describe('single cell navigation (arrow key)', () => {
    it('returns rects for old and new column/row header strips', () => {
      const { computeHeadersDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [{ startRow: 2, startCol: 3, endRow: 2, endCol: 3 }],
        activeCell: { row: 2, col: 3 },
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 3, startCol: 4, endRow: 3, endCol: 4 }],
        activeCell: { row: 3, col: 4 },
      });

      const hint = computeHeadersDirtyHint(oldSel, newSel);

      expect(hint.type).toBe('rects');
      // 4 rects: old col header, old row header, new col header, new row header
      expect(hint.bounds).toHaveLength(4);

      // Old column header strip: col 3, x=240, width=80
      const oldColRect = hint.bounds[0];
      expect(oldColRect.x).toBe(240);
      expect(oldColRect.y).toBe(0);
      expect(oldColRect.width).toBe(80);
      expect(oldColRect.height).toBe(COL_HEADER_HEIGHT);

      // Old row header strip: row 2, y=40, height=20
      const oldRowRect = hint.bounds[1];
      expect(oldRowRect.x).toBe(0);
      expect(oldRowRect.y).toBe(40);
      expect(oldRowRect.width).toBe(ROW_HEADER_WIDTH);
      expect(oldRowRect.height).toBe(20);

      // New column header strip: col 4, x=320, width=80
      const newColRect = hint.bounds[2];
      expect(newColRect.x).toBe(320);
      expect(newColRect.y).toBe(0);
      expect(newColRect.width).toBe(80);
      expect(newColRect.height).toBe(COL_HEADER_HEIGHT);

      // New row header strip: row 3, y=60, height=20
      const newRowRect = hint.bounds[3];
      expect(newRowRect.x).toBe(0);
      expect(newRowRect.y).toBe(60);
      expect(newRowRect.width).toBe(ROW_HEADER_WIDTH);
      expect(newRowRect.height).toBe(20);
    });
  });

  describe('range selection', () => {
    it('returns rects spanning the full column/row range', () => {
      const { computeHeadersDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [{ startRow: 1, startCol: 1, endRow: 3, endCol: 4 }],
        activeCell: { row: 1, col: 1 },
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 5, startCol: 2, endRow: 7, endCol: 6 }],
        activeCell: { row: 5, col: 2 },
      });

      const hint = computeHeadersDirtyHint(oldSel, newSel);

      expect(hint.type).toBe('rects');
      expect(hint.bounds).toHaveLength(4);

      // Old col header: cols 1..4 → x=80 to x=80*4+80=400, width=320
      const oldColRect = hint.bounds[0];
      expect(oldColRect.x).toBe(80);
      expect(oldColRect.width).toBe(320);
      expect(oldColRect.height).toBe(COL_HEADER_HEIGHT);

      // Old row header: rows 1..3 → y=20 to y=20*3+20=80, height=60
      const oldRowRect = hint.bounds[1];
      expect(oldRowRect.y).toBe(20);
      expect(oldRowRect.height).toBe(60);
      expect(oldRowRect.width).toBe(ROW_HEADER_WIDTH);

      // New col header: cols 2..6 → x=160 to x=80*6+80=560, width=400
      const newColRect = hint.bounds[2];
      expect(newColRect.x).toBe(160);
      expect(newColRect.width).toBe(400);

      // New row header: rows 5..7 → y=100 to y=20*7+20=160, height=60
      const newRowRect = hint.bounds[3];
      expect(newRowRect.y).toBe(100);
      expect(newRowRect.height).toBe(60);
    });
  });

  describe('deselection (range to empty)', () => {
    it('returns rects only for old selection headers', () => {
      const { computeHeadersDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [{ startRow: 1, startCol: 2, endRow: 1, endCol: 2 }],
        activeCell: { row: 1, col: 2 },
      });
      const newSel = makeSelection({
        ranges: [],
        activeCell: { row: 0, col: 0 },
      });

      const hint = computeHeadersDirtyHint(oldSel, newSel);

      expect(hint.type).toBe('rects');
      // Only old col header + old row header
      expect(hint.bounds).toHaveLength(2);
    });
  });

  describe('first selection (no previous)', () => {
    it('returns rects only for new selection headers', () => {
      const { computeHeadersDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [],
        activeCell: { row: 0, col: 0 },
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 3, startCol: 5, endRow: 3, endCol: 5 }],
        activeCell: { row: 3, col: 5 },
      });

      const hint = computeHeadersDirtyHint(oldSel, newSel);

      expect(hint.type).toBe('rects');
      // Only new col header + new row header
      expect(hint.bounds).toHaveLength(2);
    });
  });

  describe('full dirty fallbacks', () => {
    it('returns full dirty for full-row selection', () => {
      const { computeHeadersDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
        activeCell: { row: 1, col: 1 },
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 2, startCol: 0, endRow: 2, endCol: 16383, isFullRow: true }],
        activeCell: { row: 2, col: 0 },
        hasFullRowSelection: true,
      });

      const hint = computeHeadersDirtyHint(oldSel, newSel);
      expect(hint.type).toBe('full');
    });

    it('returns full dirty for full-column selection', () => {
      const { computeHeadersDirtyHint } = createFakeRenderer();

      const oldSel = makeSelection({
        ranges: [{ startRow: 0, startCol: 0, endRow: 1048575, endCol: 0, isFullColumn: true }],
        activeCell: { row: 0, col: 0 },
        hasFullColumnSelection: true,
      });
      const newSel = makeSelection({
        ranges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
        activeCell: { row: 1, col: 1 },
      });

      const hint = computeHeadersDirtyHint(oldSel, newSel);
      expect(hint.type).toBe('full');
    });

    it('returns full dirty for multi-range selection', () => {
      const { computeHeadersDirtyHint } = createFakeRenderer();

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

      const hint = computeHeadersDirtyHint(oldSel, newSel);
      expect(hint.type).toBe('full');
    });

    it('returns full dirty for formula mode', () => {
      const { computeHeadersDirtyHint } = createFakeRenderer();

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

      const hint = computeHeadersDirtyHint(oldSel, newSel);
      expect(hint.type).toBe('full');
    });

    it('returns full dirty when position index has no data', () => {
      const { computeHeadersDirtyHint, positionIndex } = createFakeRenderer();

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

      const hint = computeHeadersDirtyHint(oldSel, newSel);
      expect(hint.type).toBe('full');
    });
  });
});
