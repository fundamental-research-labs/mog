/**
 * Compute Visible Range Tests
 *
 * Validates the docOrigin-rooted cellRange search. The single docOrigin
 * parameter ensures every pane — including the main pane during a mid-scroll
 * over the frozen-rows area — never bleeds rows/cols above its viewportOrigin
 * into its cellRange.
 *
 * @module grid-renderer/layout/__tests__/compute-visible-range
 */

import { ViewportPositionIndex } from '../../coordinates/viewport-position-index';
import { computeFrozenRange, computeVisibleRange } from '../compute-visible-range';

// =============================================================================
// Test Helpers
// =============================================================================

const ROW_HEIGHT = 21;
const COL_WIDTH = 100;

function createPositionIndex(rows = 100, cols = 26): ViewportPositionIndex {
  const pi = new ViewportPositionIndex(ROW_HEIGHT, COL_WIDTH);

  const rowPositions = new Float64Array(rows);
  let y = 0;
  for (let i = 0; i < rows; i++) {
    rowPositions[i] = y;
    y += ROW_HEIGHT;
  }

  const colPositions = new Float64Array(cols);
  let x = 0;
  for (let i = 0; i < cols; i++) {
    colPositions[i] = x;
    x += COL_WIDTH;
  }

  pi.setPositions(rowPositions, colPositions, 0, 0);
  pi.setTotalDimensions(rows, cols);
  return pi;
}

// =============================================================================
// Tests
// =============================================================================

describe('computeVisibleRange', () => {
  describe('docOrigin = (0, 0) — top-left of doc', () => {
    it('returns row 0 / col 0 as the starting cell', () => {
      const pi = createPositionIndex();
      const range = computeVisibleRange({ width: 800, height: 200 }, { x: 0, y: 0 }, pi);
      expect(range.startRow).toBe(0);
      expect(range.startCol).toBe(0);
      expect(range.endRow).toBeGreaterThan(0);
      expect(range.endCol).toBeGreaterThan(0);
    });

    it('extends endRow only as far as the region height supports', () => {
      const pi = createPositionIndex();
      const regionHeight = 100; // ~4-5 rows at 21px each
      const range = computeVisibleRange({ width: 800, height: regionHeight }, { x: 0, y: 0 }, pi);
      // ceil(100 / 21) = 5 rows; +1 partial = startRow..endRow inclusive ≤ 5
      expect(range.startRow).toBe(0);
      expect(range.endRow).toBeLessThanOrEqual(5);
    });
  });

  describe('docOrigin > 0 — main pane never includes rows/cols above its viewportOrigin', () => {
    it('docOrigin = (0, 21), scroll-y = 0: returned startRow >= 1 (row 0 is NOT in the cellRange)', () => {
      // Simulates main pane with frozenRows=1, scrollPosition=(0,0):
      //   viewportOrigin = (0, 21), scrollOffset = (0, 0)
      //   docOrigin = viewportOrigin + scrollOffset = (0, 21)
      const pi = createPositionIndex();
      const range = computeVisibleRange({ width: 800, height: 200 }, { x: 0, y: 21 }, pi);
      expect(range.startRow).toBeGreaterThanOrEqual(1);
    });

    it('docOrigin = (0, 36), scroll-y = 15 (mid-scroll over frozen rows): startRow >= 1', () => {
      // Simulates main pane with frozenRows=1 (frozenRowsHeight=21),
      // user scrolled 15px. viewportOrigin = (0, 21), scrollOffset = (0, 15).
      // docOrigin = (0, 36). Row 1 starts at y=21 in doc-space, and 36 falls
      // into row 1 — main pane never includes row 0.
      const pi = createPositionIndex();
      const range = computeVisibleRange({ width: 800, height: 200 }, { x: 0, y: 36 }, pi);
      expect(range.startRow).toBeGreaterThanOrEqual(1);
    });

    it('docOrigin > 0 in x: returned startCol >= 1', () => {
      // Simulates main pane with frozenCols=1: viewportOrigin = (100, 0).
      const pi = createPositionIndex();
      const range = computeVisibleRange({ width: 800, height: 200 }, { x: 100, y: 0 }, pi);
      expect(range.startCol).toBeGreaterThanOrEqual(1);
    });

    it('frozen-rows pane: docOrigin = (frozenColsWidth, 0) on a sheet with frozen cols', () => {
      // Simulates frozen-rows pane with frozenCols=1, scrollPosition.x=0.
      // viewportOrigin = (100, 0), scrollOffset = (0, 0). docOrigin = (100, 0).
      // height = scaledFrozenRowsHeight = 21px (1 frozen row).
      const pi = createPositionIndex();
      const range = computeVisibleRange(
        { width: 700, height: 21 }, // height bounds the search to 1 frozen row
        { x: 100, y: 0 },
        pi,
      );
      // Boundary case: row 1 starts exactly at endY=21, so it's at the
      // exclusive upper bound and excluded. endRow MUST be 0 (not 1) — this
      // pins down the `findRowAtY(endY)` boundary-decrement fix; this used to
      // require a `cellRange.endRow = Math.min(..., frozenRows - 1)` override.
      expect(range.startRow).toBe(0);
      expect(range.endRow).toBe(0);
      // First col is past the frozen col — the docOrigin.x = 100 floor.
      expect(range.startCol).toBeGreaterThanOrEqual(1);
    });

    it('frozen-cols pane: docOrigin = (0, frozenRowsHeight) on a sheet with frozen rows', () => {
      // Simulates frozen-cols pane with frozenRows=1, scrollPosition.y=0.
      // viewportOrigin = (0, 21), scrollOffset = (0, 0). docOrigin = (0, 21).
      // width = scaledFrozenColsWidth = 100px (1 frozen col).
      const pi = createPositionIndex();
      const range = computeVisibleRange(
        { width: 100, height: 600 }, // width bounds the search to 1 frozen col
        { x: 0, y: 21 },
        pi,
      );
      // Boundary case on the X axis (mirror of the row-axis test above):
      // col 1 starts exactly at endX=100, excluded. endCol MUST be 0.
      expect(range.startCol).toBe(0);
      expect(range.endCol).toBe(0);
      // First row is past the frozen row — the docOrigin.y = 21 floor.
      expect(range.startRow).toBeGreaterThanOrEqual(1);
    });

    it('mid-row scroll: endRow correctly anchors at docOrigin.y + cellSpaceHeight (NOT firstRow.top)', () => {
      // Simulates main pane with frozenRows=1 (frozenRowsHeight=21), user
      // scrolled 15px. viewportOrigin = (0, 21), scrollOffset = (0, 15) →
      // docOrigin.y = 36. With ROW_HEIGHT=21 and cellSpaceHeight=200:
      //   visible y-window = [36, 236)
      //   row 1 (top=21) is partially visible at the top (top < docOrigin.y),
      //     but findRowAtY(36) = row 1 → firstRow = 1.
      //   row 11 (top=231) is partially visible at the bottom (top < endY=236),
      //     so endRow = 11.
      //
      // Pre-fix the function anchored endY at firstRow.top (=21), so
      // endY = 21 + 200 = 221, missing row 11 (which starts at 231 — outside
      // [21, 221)). The +1 partial-visibility hack compensated by including
      // one more row but in the wrong place. With endY anchored at
      // docOrigin.y + cellSpaceHeight, endRow lands at 11 exactly.
      const pi = createPositionIndex();
      const range = computeVisibleRange({ width: 800, height: 200 }, { x: 0, y: 36 }, pi);
      expect(range.startRow).toBe(1);
      expect(range.endRow).toBe(11);
    });
  });

  describe('zoom', () => {
    it('treats regionSize as CSS pixels and divides by zoom for cell-space height', () => {
      const pi = createPositionIndex();
      const baseline = computeVisibleRange({ width: 800, height: 200 }, { x: 0, y: 0 }, pi, 1.0);
      // At 2x zoom, the same CSS region covers half the cell-space, i.e. fewer rows.
      const zoomed = computeVisibleRange({ width: 800, height: 200 }, { x: 0, y: 0 }, pi, 2.0);
      expect(zoomed.endRow).toBeLessThan(baseline.endRow);
      expect(zoomed.endCol).toBeLessThan(baseline.endCol);
    });
  });

  describe('hidden rows/cols', () => {
    it('skips hidden rows at the start when docOrigin = (0, 0)', () => {
      const pi = createPositionIndex();
      pi.setHiddenState(new Set([0, 1]), new Set());
      const range = computeVisibleRange({ width: 800, height: 200 }, { x: 0, y: 0 }, pi);
      expect(range.startRow).toBeGreaterThanOrEqual(2);
    });

    it('skips hidden cols at the start when docOrigin = (0, 0)', () => {
      const pi = createPositionIndex();
      pi.setHiddenState(new Set(), new Set([0, 1]));
      const range = computeVisibleRange({ width: 800, height: 200 }, { x: 0, y: 0 }, pi);
      expect(range.startCol).toBeGreaterThanOrEqual(2);
    });
  });

  describe('partial hydrated windows', () => {
    it('keeps the returned start row aligned with extrapolated row tops', () => {
      const pi = new ViewportPositionIndex(20, COL_WIDTH);
      pi.setTotalDimensions(1_048_576, 16_384);

      const importedRowHeight = 50 / 3;
      const rowPositions = new Float64Array(93);
      for (let row = 0; row < rowPositions.length; row++) {
        rowPositions[row] = row * importedRowHeight;
      }

      const colPositions = new Float64Array(10);
      for (let col = 0; col < colPositions.length; col++) {
        colPositions[col] = col * COL_WIDTH;
      }

      pi.setPositions(rowPositions, colPositions, 0, 0);

      const targetRow = 266;
      const docY = pi.getRowTop(targetRow) + 3;
      const range = computeVisibleRange({ width: 800, height: 200 }, { x: 0, y: docY }, pi);

      expect(range.startRow).toBe(targetRow);
      expect(pi.getRowTop(range.startRow)).toBeLessThanOrEqual(docY);
      expect(docY).toBeLessThan(pi.getRowTop(range.startRow) + pi.getRowHeight(range.startRow));
    });
  });

  describe('without position-index data (linear scan fallback)', () => {
    it('respects docOrigin in the row scan path', () => {
      const pi = new ViewportPositionIndex(ROW_HEIGHT, COL_WIDTH);
      pi.setTotalDimensions(100, 26);
      // No setPositions() — pi.hasData === false; hits scanFirstRow/scanFirstCol.
      const range = computeVisibleRange({ width: 800, height: 200 }, { x: 0, y: 21 }, pi);
      expect(range.startRow).toBeGreaterThanOrEqual(1);
    });

    it('respects docOrigin in the col scan path', () => {
      const pi = new ViewportPositionIndex(ROW_HEIGHT, COL_WIDTH);
      pi.setTotalDimensions(100, 26);
      const range = computeVisibleRange({ width: 800, height: 200 }, { x: 100, y: 0 }, pi);
      expect(range.startCol).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('computeFrozenRange', () => {
  it('produces an inclusive range with given start/end', () => {
    expect(computeFrozenRange(2, 3)).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 2,
      endCol: 3,
    });
  });

  it('clamps endRow/endCol to be >= the start values', () => {
    expect(computeFrozenRange(-1, -1, 0, 0)).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 0,
      endCol: 0,
    });
  });

  it('honours custom startRow/startCol', () => {
    expect(computeFrozenRange(5, 4, 2, 1)).toEqual({
      startRow: 2,
      startCol: 1,
      endRow: 5,
      endCol: 4,
    });
  });
});
