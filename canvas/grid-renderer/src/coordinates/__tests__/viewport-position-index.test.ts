/**
 * Tests for ViewportPositionIndex hidden state and total dimensions.
 *
 * Covers the NEW functionality added to ViewportPositionIndex:
 * - setHiddenState() / isRowHidden() / isColHidden()
 * - setTotalDimensions() / totalRows / totalCols
 *
 * Position/binary-search functionality is tested elsewhere.
 *
 * @module canvas/coordinates/__tests__/viewport-position-index.test
 */

import { ViewportPositionIndex } from '../viewport-position-index';

describe('ViewportPositionIndex', () => {
  let index: ViewportPositionIndex;

  beforeEach(() => {
    index = new ViewportPositionIndex();
  });

  // ===========================================================================
  // Continuous Position Extrapolation
  // ===========================================================================

  describe('continuous position extrapolation', () => {
    it('extrapolates row tops from the nearest hydrated position', () => {
      index = new ViewportPositionIndex(20, 100);
      index.setTotalDimensions(1_000, 100);
      index.setPositions(
        new Float64Array([200, 217, 233.5, 250]),
        new Float64Array([0, 100]),
        10,
        0,
      );

      expect(index.getRowTop(9)).toBe(180);
      expect(index.getRowTop(10)).toBe(200);
      expect(index.getRowTop(13)).toBe(250);
      expect(index.getRowTop(14)).toBe(270);
      expect(index.getRowTop(15)).toBe(290);
    });

    it('extrapolates column lefts from the nearest hydrated position', () => {
      index = new ViewportPositionIndex(20, 100);
      index.setTotalDimensions(100, 1_000);
      index.setPositions(new Float64Array([0, 20]), new Float64Array([300, 375, 455]), 0, 4);

      expect(index.getColLeft(3)).toBe(200);
      expect(index.getColLeft(4)).toBe(300);
      expect(index.getColLeft(6)).toBe(455);
      expect(index.getColLeft(7)).toBe(555);
      expect(index.getColLeft(8)).toBe(655);
    });

    it('findRowAtY returns extrapolated rows consistent with getRowTop', () => {
      index = new ViewportPositionIndex(20, 100);
      index.setTotalDimensions(1_000, 100);
      index.setPositions(
        new Float64Array([200, 217, 233.5, 250]),
        new Float64Array([0, 100]),
        10,
        0,
      );

      expect(index.findRowAtY(180)).toBe(9);
      expect(index.findRowAtY(199.9)).toBe(9);
      expect(index.findRowAtY(200)).toBe(10);
      expect(index.findRowAtY(269.9)).toBe(13);
      expect(index.findRowAtY(270)).toBe(14);

      const row = index.findRowAtY(277);
      expect(row).toBe(14);
      expect(index.getRowTop(row!)).toBeLessThanOrEqual(277);
      expect(277).toBeLessThan(index.getRowTop(row!) + index.getRowHeight(row!));
    });

    it('findColAtX returns extrapolated columns consistent with getColLeft', () => {
      index = new ViewportPositionIndex(20, 100);
      index.setTotalDimensions(100, 1_000);
      index.setPositions(new Float64Array([0, 20]), new Float64Array([300, 375, 455]), 0, 4);

      expect(index.findColAtX(200)).toBe(3);
      expect(index.findColAtX(299.9)).toBe(3);
      expect(index.findColAtX(300)).toBe(4);
      expect(index.findColAtX(554.9)).toBe(6);
      expect(index.findColAtX(555)).toBe(7);

      const col = index.findColAtX(580);
      expect(col).toBe(7);
      expect(index.getColLeft(col!)).toBeLessThanOrEqual(580);
      expect(580).toBeLessThan(index.getColLeft(col!) + index.getColWidth(col!));
    });

    it('keeps real-workbook row tops continuous beyond a partial hydrated window', () => {
      index = new ViewportPositionIndex(20, 100);
      index.setTotalDimensions(1_048_576, 16_384);

      const importedRowHeight = 50 / 3;
      const rowPositions = new Float64Array(93);
      for (let row = 0; row < rowPositions.length; row++) {
        rowPositions[row] = row * importedRowHeight;
      }
      index.setPositions(rowPositions, new Float64Array([0, 100]), 0, 0);

      const targetRow = 266;
      const targetTop =
        rowPositions[rowPositions.length - 1] + (targetRow - (rowPositions.length - 1)) * 20;
      const y = targetTop + 3;

      expect(index.getRowTop(targetRow)).toBeCloseTo(targetTop);
      expect(index.findRowAtY(y)).toBe(targetRow);
      expect(index.getRowTop(targetRow)).toBeLessThanOrEqual(y);
      expect(y).toBeLessThan(index.getRowTop(targetRow) + index.getRowHeight(targetRow));
    });
  });

  // ===========================================================================
  // Wire Position Sentinel
  // ===========================================================================

  describe('wire position sentinel', () => {
    it('derives the last real column width from the trailing sentinel', () => {
      index = new ViewportPositionIndex(20, 72);
      index.setPositions(
        new Float64Array([0, 20]),
        new Float64Array([0, 64, 128]),
        0,
        0,
        1,
        2,
        20,
        64,
      );

      expect(index.colCount).toBe(2);
      expect(index.endCol).toBe(2);
      expect(index.isColInRange(1)).toBe(true);
      expect(index.isColInRange(2)).toBe(false);
      expect(index.getColWidth(0)).toBe(64);
      expect(index.getColWidth(1)).toBe(64);
    });

    it('uses the Rust-derived default for columns beyond the hydrated sentinel', () => {
      index = new ViewportPositionIndex(20, 72);
      index.setPositions(
        new Float64Array([0, 20]),
        new Float64Array([0, 64, 128]),
        0,
        0,
        1,
        2,
        20,
        64,
      );

      expect(index.getColLeft(2)).toBe(128);
      expect(index.getColWidth(2)).toBe(64);
      expect(index.getColLeft(5)).toBe(320);
      expect(index.findColAtX(319.9)).toBe(4);
      expect(index.findColAtX(320)).toBe(5);
    });
  });

  // ===========================================================================
  // Hidden State
  // ===========================================================================

  describe('hidden state', () => {
    it('defaults to no rows hidden', () => {
      expect(index.isRowHidden(0)).toBe(false);
      expect(index.isRowHidden(5)).toBe(false);
      expect(index.isRowHidden(999)).toBe(false);
    });

    it('defaults to no cols hidden', () => {
      expect(index.isColHidden(0)).toBe(false);
      expect(index.isColHidden(5)).toBe(false);
      expect(index.isColHidden(999)).toBe(false);
    });

    it('marks rows as hidden after setHiddenState', () => {
      index.setHiddenState(new Set([2, 5, 10]), new Set());

      expect(index.isRowHidden(2)).toBe(true);
      expect(index.isRowHidden(5)).toBe(true);
      expect(index.isRowHidden(10)).toBe(true);
    });

    it('marks cols as hidden after setHiddenState', () => {
      index.setHiddenState(new Set(), new Set([0, 3, 7]));

      expect(index.isColHidden(0)).toBe(true);
      expect(index.isColHidden(3)).toBe(true);
      expect(index.isColHidden(7)).toBe(true);
    });

    it('returns false for non-hidden rows and cols', () => {
      index.setHiddenState(new Set([2, 5]), new Set([3, 7]));

      expect(index.isRowHidden(0)).toBe(false);
      expect(index.isRowHidden(1)).toBe(false);
      expect(index.isRowHidden(3)).toBe(false);
      expect(index.isColHidden(0)).toBe(false);
      expect(index.isColHidden(1)).toBe(false);
      expect(index.isColHidden(5)).toBe(false);
    });

    it('replaces previous hidden state when called again', () => {
      index.setHiddenState(new Set([1, 2, 3]), new Set([10, 20]));

      // First state is active
      expect(index.isRowHidden(1)).toBe(true);
      expect(index.isColHidden(10)).toBe(true);

      // Replace with new state
      index.setHiddenState(new Set([4, 5]), new Set([30]));

      // Old hidden indices are no longer hidden
      expect(index.isRowHidden(1)).toBe(false);
      expect(index.isRowHidden(2)).toBe(false);
      expect(index.isRowHidden(3)).toBe(false);
      expect(index.isColHidden(10)).toBe(false);
      expect(index.isColHidden(20)).toBe(false);

      // New hidden indices are active
      expect(index.isRowHidden(4)).toBe(true);
      expect(index.isRowHidden(5)).toBe(true);
      expect(index.isColHidden(30)).toBe(true);
    });
  });

  // ===========================================================================
  // Total Dimensions
  // ===========================================================================

  describe('total dimensions', () => {
    it('defaults totalRows to Excel maximum (1,048,576)', () => {
      expect(index.totalRows).toBe(1_048_576);
    });

    it('defaults totalCols to Excel maximum (16,384)', () => {
      expect(index.totalCols).toBe(16_384);
    });

    it('returns updated values after setTotalDimensions', () => {
      index.setTotalDimensions(100, 26);

      expect(index.totalRows).toBe(100);
      expect(index.totalCols).toBe(26);
    });

    it('allows setting to custom values', () => {
      index.setTotalDimensions(500_000, 1_000);

      expect(index.totalRows).toBe(500_000);
      expect(index.totalCols).toBe(1_000);
    });
  });
});
