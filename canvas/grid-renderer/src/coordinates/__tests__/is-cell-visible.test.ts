/**
 * Unit Tests for CoordinateSystem.isCellVisible — viewport-follow contract.
 *
 * The viewport-follow coordinator depends on a tight contract:
 *
 *   1. `isCellVisible(sheetId, cell)` returns `false` iff
 *      `getScrollToCell(sheetId, cell)` returns non-null.
 *
 *   2. The predicate reads scroll state from the live coordinate-system
 *      viewport field (set via `setViewport(...)`), NOT from cached state
 *      that wheel-scroll could skip updating. Mutating the viewport between
 *      calls flips the answer immediately.
 *
 * Locking these in here means the renderer-side coordinator can rely on the
 * predicate without a defensive re-check, and any future refactor of the
 * coordinate system that broke this contract would fail this test.
 */

import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '../../shared/constants';
import type { CoordinateSystemImpl } from '../coordinate-system';
import { createCoordinateSystem } from '../coordinate-system';
import { ViewportPositionIndex } from '../viewport-position-index';

const TEST_SHEET_ID = 'test-sheet-1';

function createTestPositionIndex(numRows = 1000, numCols = 100): ViewportPositionIndex {
  const pi = new ViewportPositionIndex(DEFAULT_ROW_HEIGHT, DEFAULT_COL_WIDTH);
  const rowPositions = new Float64Array(numRows);
  let y = 0;
  for (let i = 0; i < numRows; i++) {
    rowPositions[i] = y;
    y += DEFAULT_ROW_HEIGHT;
  }
  const colPositions = new Float64Array(numCols);
  let x = 0;
  for (let i = 0; i < numCols; i++) {
    colPositions[i] = x;
    x += DEFAULT_COL_WIDTH;
  }
  pi.setPositions(rowPositions, colPositions, 0, 0);
  pi.setTotalDimensions(numRows, numCols);
  return pi;
}

describe('CoordinateSystem.isCellVisible — viewport-follow contract', () => {
  let coords: CoordinateSystemImpl;

  beforeEach(() => {
    coords = createCoordinateSystem();
    coords.setViewportPositionIndex(createTestPositionIndex());
    coords.setFrozenPanes({ rows: 0, cols: 0 });
    coords.setZoom(1.0);
    coords.setViewport({ scrollTop: 0, scrollLeft: 0, width: 800, height: 600 });
  });

  describe('visibility matches scroll-to-cell reachability', () => {
    it('cells inside the viewport are visible AND getScrollToCell returns null', () => {
      const cell = { row: 0, col: 0 };
      expect(coords.isCellVisible(TEST_SHEET_ID, cell)).toBe(true);
      expect(coords.getScrollToCell(TEST_SHEET_ID, cell)).toBeNull();
    });

    it('cells far below are not visible AND getScrollToCell returns non-null', () => {
      const cell = { row: 500, col: 0 };
      expect(coords.isCellVisible(TEST_SHEET_ID, cell)).toBe(false);
      expect(coords.getScrollToCell(TEST_SHEET_ID, cell)).not.toBeNull();
    });

    it('cells far right are not visible AND getScrollToCell returns non-null', () => {
      const cell = { row: 0, col: 50 };
      expect(coords.isCellVisible(TEST_SHEET_ID, cell)).toBe(false);
      expect(coords.getScrollToCell(TEST_SHEET_ID, cell)).not.toBeNull();
    });

    it('cells just outside the bottom edge fail both predicates consistently', () => {
      // row 30 ≈ y=600 — below the 600px viewport bottom
      const cell = { row: 30, col: 0 };
      const visible = coords.isCellVisible(TEST_SHEET_ID, cell);
      const scrollTo = coords.getScrollToCell(TEST_SHEET_ID, cell);
      expect(visible).toBe(scrollTo === null);
      expect(visible).toBe(false);
    });

    it('frozen-row cells can still request horizontal scrolling', () => {
      coords.setFrozenPanes({ rows: 3, cols: 1 });
      coords.setViewport({
        scrollTop: 250,
        scrollLeft: 50 * DEFAULT_COL_WIDTH,
        width: 800,
        height: 600,
      });

      const cell = { row: 2, col: 10 };
      const scrollTo = coords.getScrollToCell(TEST_SHEET_ID, cell);

      expect(coords.isCellVisible(TEST_SHEET_ID, cell)).toBe(false);
      expect(scrollTo).not.toBeNull();
      expect(scrollTo?.top).toBe(250);
      expect(scrollTo?.left).toBeLessThan(50 * DEFAULT_COL_WIDTH);
    });

    it('frozen-column cells can still request vertical scrolling', () => {
      coords.setFrozenPanes({ rows: 3, cols: 1 });
      coords.setViewport({
        scrollTop: 50 * DEFAULT_ROW_HEIGHT,
        scrollLeft: 250,
        width: 800,
        height: 600,
      });

      const cell = { row: 10, col: 0 };
      const scrollTo = coords.getScrollToCell(TEST_SHEET_ID, cell);

      expect(coords.isCellVisible(TEST_SHEET_ID, cell)).toBe(false);
      expect(scrollTo).not.toBeNull();
      expect(scrollTo?.top).toBeLessThan(50 * DEFAULT_ROW_HEIGHT);
      expect(scrollTo?.left).toBe(250);
    });

    it('cells in both frozen axes need no scroll target', () => {
      coords.setFrozenPanes({ rows: 3, cols: 1 });
      coords.setViewport({
        scrollTop: 50 * DEFAULT_ROW_HEIGHT,
        scrollLeft: 50 * DEFAULT_COL_WIDTH,
        width: 800,
        height: 600,
      });

      const cell = { row: 2, col: 0 };

      expect(coords.isCellVisible(TEST_SHEET_ID, cell)).toBe(true);
      expect(coords.getScrollToCell(TEST_SHEET_ID, cell)).toBeNull();
    });
  });

  describe('visibility reads live scroll state', () => {
    it('flipping viewport.scrollTop flips visibility immediately', () => {
      const farCell = { row: 100, col: 0 };

      // At scrollTop=0, the far cell is not visible.
      coords.setViewport({ scrollTop: 0, scrollLeft: 0, width: 800, height: 600 });
      expect(coords.isCellVisible(TEST_SHEET_ID, farCell)).toBe(false);

      // Scroll down so row 100 is in view (row 100 starts at y = 100 * DEFAULT_ROW_HEIGHT).
      const newScrollTop = 100 * DEFAULT_ROW_HEIGHT;
      coords.setViewport({
        scrollTop: newScrollTop,
        scrollLeft: 0,
        width: 800,
        height: 600,
      });

      // Predicate must reflect the new scroll state on the very next call.
      expect(coords.isCellVisible(TEST_SHEET_ID, farCell)).toBe(true);

      // Symmetric: cells that were visible become invisible.
      expect(coords.isCellVisible(TEST_SHEET_ID, { row: 0, col: 0 })).toBe(false);
    });

    it('flipping viewport.scrollLeft flips visibility immediately', () => {
      const farCell = { row: 0, col: 50 };

      coords.setViewport({ scrollTop: 0, scrollLeft: 0, width: 800, height: 600 });
      expect(coords.isCellVisible(TEST_SHEET_ID, farCell)).toBe(false);

      const newScrollLeft = 50 * DEFAULT_COL_WIDTH;
      coords.setViewport({
        scrollTop: 0,
        scrollLeft: newScrollLeft,
        width: 800,
        height: 600,
      });

      expect(coords.isCellVisible(TEST_SHEET_ID, farCell)).toBe(true);
      expect(coords.isCellVisible(TEST_SHEET_ID, { row: 0, col: 0 })).toBe(false);
    });
  });
});
