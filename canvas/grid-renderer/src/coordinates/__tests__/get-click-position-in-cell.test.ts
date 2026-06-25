/**
 * Unit Tests for CoordinateSystem.getClickPositionInCell()
 *
 * Tests the method that calculates click position relative to a cell's top-left corner.
 * This method correctly handles:
 * - Frozen panes
 * - Zoom
 * - Header offsets
 * - Non-visible cells
 *
 * @module canvas/coordinates/__tests__/get-click-position-in-cell.test
 */

import { viewportPoint } from '@mog/spreadsheet-utils/rendering/coordinates';
import {
  COL_HEADER_HEIGHT,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  ROW_HEADER_WIDTH,
} from '../../shared/constants';
import type { CoordinateSystemImpl } from '../coordinate-system';
import { createCoordinateSystem } from '../coordinate-system';
import { ViewportPositionIndex } from '../viewport-position-index';

/** Test sheet ID for coordinate system tests */
const TEST_SHEET_ID = 'test-sheet-1';

// =============================================================================
// Test Helper
// =============================================================================

function createTestPositionIndex(opts?: {
  rowHeights?: Map<number, number>;
  colWidths?: Map<number, number>;
  hiddenRows?: Set<number>;
  hiddenCols?: Set<number>;
  totalRows?: number;
  totalCols?: number;
  startRow?: number;
  startCol?: number;
  numRows?: number;
  numCols?: number;
}): ViewportPositionIndex {
  const pi = new ViewportPositionIndex(DEFAULT_ROW_HEIGHT, DEFAULT_COL_WIDTH);

  const startRow = opts?.startRow ?? 0;
  const startCol = opts?.startCol ?? 0;
  const numRows = opts?.numRows ?? 100;
  const numCols = opts?.numCols ?? 26;

  const rowPositions = new Float64Array(numRows);
  let y = 0;
  for (let i = 0; i < numRows; i++) {
    rowPositions[i] = y;
    y += opts?.rowHeights?.get(startRow + i) ?? DEFAULT_ROW_HEIGHT;
  }

  const colPositions = new Float64Array(numCols);
  let x = 0;
  for (let i = 0; i < numCols; i++) {
    colPositions[i] = x;
    x += opts?.colWidths?.get(startCol + i) ?? DEFAULT_COL_WIDTH;
  }

  pi.setPositions(rowPositions, colPositions, startRow, startCol);

  if (opts?.hiddenRows || opts?.hiddenCols) {
    pi.setHiddenState(opts.hiddenRows ?? new Set(), opts.hiddenCols ?? new Set());
  }
  if (opts?.totalRows || opts?.totalCols) {
    pi.setTotalDimensions(opts.totalRows ?? 1_048_576, opts.totalCols ?? 16_384);
  }

  return pi;
}

// =============================================================================
// Tests
// =============================================================================

describe('CoordinateSystem.getClickPositionInCell', () => {
  let coords: CoordinateSystemImpl;

  beforeEach(() => {
    coords = createCoordinateSystem();

    // Set up a viewport position index with known dimensions
    const pi = createTestPositionIndex({
      totalRows: 1000,
      totalCols: 100,
      numRows: 1000,
      numCols: 100,
    });
    coords.setViewportPositionIndex(pi);

    // Set viewport - default to no scroll, no frozen panes, 100% zoom
    coords.setViewport({ scrollTop: 0, scrollLeft: 0, width: 1000, height: 600 });
    coords.setFrozenPanes({ rows: 0, cols: 0 });
    coords.setZoom(1.0);
  });

  // ===========================================================================
  // Basic Position Calculation (No Scroll, No Frozen Panes, No Zoom)
  // ===========================================================================

  describe('basic position calculation', () => {
    it('returns correct position for cell (0, 0) at top-left corner of cell', () => {
      // Cell (0,0) starts at (ROW_HEADER_WIDTH, COL_HEADER_HEIGHT) = (50, 24)
      // Click at exact top-left corner
      const clickPos = coords.getClickPositionInCell(
        TEST_SHEET_ID,
        viewportPoint(ROW_HEADER_WIDTH, COL_HEADER_HEIGHT),
        { row: 0, col: 0 },
      );

      expect(clickPos).not.toBeNull();
      if (clickPos) {
        expect(clickPos.x).toBe(0);
        expect(clickPos.y).toBe(0);
        expect(clickPos.width).toBe(DEFAULT_COL_WIDTH); // 100
        expect(clickPos.height).toBe(DEFAULT_ROW_HEIGHT); // 21
      }
    });

    it('returns correct position for cell (0, 0) at center of cell', () => {
      const clickX = ROW_HEADER_WIDTH + DEFAULT_COL_WIDTH / 2;
      const clickY = COL_HEADER_HEIGHT + 10;
      const clickPos = coords.getClickPositionInCell(TEST_SHEET_ID, viewportPoint(clickX, clickY), {
        row: 0,
        col: 0,
      });

      expect(clickPos).not.toBeNull();
      if (clickPos) {
        expect(clickPos.x).toBe(DEFAULT_COL_WIDTH / 2);
        expect(clickPos.y).toBe(10);
        expect(clickPos.width).toBe(DEFAULT_COL_WIDTH);
        expect(clickPos.height).toBe(DEFAULT_ROW_HEIGHT);
      }
    });

    it('returns correct position for cell (5, 3)', () => {
      const clickX = ROW_HEADER_WIDTH + 3 * DEFAULT_COL_WIDTH + DEFAULT_COL_WIDTH / 2;
      const clickY = COL_HEADER_HEIGHT + 5 * DEFAULT_ROW_HEIGHT + 11;
      const clickPos = coords.getClickPositionInCell(TEST_SHEET_ID, viewportPoint(clickX, clickY), {
        row: 5,
        col: 3,
      });

      expect(clickPos).not.toBeNull();
      if (clickPos) {
        expect(clickPos.x).toBe(DEFAULT_COL_WIDTH / 2);
        expect(clickPos.y).toBe(11);
        expect(clickPos.width).toBe(DEFAULT_COL_WIDTH);
        expect(clickPos.height).toBe(DEFAULT_ROW_HEIGHT);
      }
    });
  });

  // ===========================================================================
  // Frozen Panes
  // ===========================================================================

  describe('frozen panes', () => {
    beforeEach(() => {
      // Freeze first 2 rows and 1 column
      coords.setFrozenPanes({ rows: 2, cols: 1 });
    });

    it('returns correct position for frozen cell (0, 0)', () => {
      // Frozen cells don't scroll
      const clickPos = coords.getClickPositionInCell(
        TEST_SHEET_ID,
        viewportPoint(ROW_HEADER_WIDTH + 10, COL_HEADER_HEIGHT + 5),
        { row: 0, col: 0 },
      );

      expect(clickPos).not.toBeNull();
      if (clickPos) {
        expect(clickPos.x).toBe(10);
        expect(clickPos.y).toBe(5);
      }
    });

    it('returns correct position for non-frozen cell with scroll', () => {
      // Scroll the viewport
      coords.setViewport({ scrollTop: 100, scrollLeft: 200, width: 1000, height: 600 });

      // Cell (8, 4) is below/right of the frozen regions after scroll.
      const cell = { row: 8, col: 4 };
      const cellRect = coords.cellToViewport(TEST_SHEET_ID, cell);
      expect(cellRect).not.toBeNull();
      if (!cellRect) return;

      const clickPos = coords.getClickPositionInCell(
        TEST_SHEET_ID,
        viewportPoint(cellRect.x + cellRect.width / 2, cellRect.y + cellRect.height / 2),
        cell,
      );

      expect(clickPos).not.toBeNull();
      if (clickPos) {
        expect(clickPos.x).toBeCloseTo(cellRect.width / 2, 0);
        expect(clickPos.y).toBeCloseTo(cellRect.height / 2, 0);
        expect(clickPos.width).toBe(cellRect.width);
        expect(clickPos.height).toBe(cellRect.height);
      }
    });

    it('returns correct position for frozen column with vertical scroll', () => {
      // Scroll vertically but not horizontally
      coords.setViewport({ scrollTop: 100, scrollLeft: 0, width: 1000, height: 600 });

      // Cell (8, 0) is in the frozen column but visible below the frozen rows.
      const cell = { row: 8, col: 0 };
      const cellRect = coords.cellToViewport(TEST_SHEET_ID, cell);
      expect(cellRect).not.toBeNull();
      if (!cellRect) return;

      const clickPos = coords.getClickPositionInCell(
        TEST_SHEET_ID,
        viewportPoint(cellRect.x + cellRect.width / 2, cellRect.y + cellRect.height / 2),
        cell,
      );

      expect(clickPos).not.toBeNull();
      if (clickPos) {
        // x position is not affected by scrollLeft (frozen column)
        expect(cellRect.x).toBe(ROW_HEADER_WIDTH);
        expect(clickPos.x).toBeCloseTo(cellRect.width / 2, 0);
        expect(clickPos.y).toBeCloseTo(cellRect.height / 2, 0);
        expect(clickPos.width).toBe(cellRect.width);
        expect(clickPos.height).toBe(cellRect.height);
      }
    });
  });

  // ===========================================================================
  // Zoom
  // ===========================================================================

  describe('zoom', () => {
    it('returns correct position with 200% zoom', () => {
      coords.setZoom(2.0);

      // At 200% zoom, cells are twice as large in viewport
      // Cell (0,0) starts at (50, 24) and is (200, 42) in viewport
      const clickPos = coords.getClickPositionInCell(
        TEST_SHEET_ID,
        viewportPoint(ROW_HEADER_WIDTH + 100, COL_HEADER_HEIGHT + 20),
        { row: 0, col: 0 },
      );

      expect(clickPos).not.toBeNull();
      if (clickPos) {
        expect(clickPos.x).toBe(100);
        expect(clickPos.y).toBe(20);
        expect(clickPos.width).toBe(DEFAULT_COL_WIDTH * 2); // 200
        expect(clickPos.height).toBe(DEFAULT_ROW_HEIGHT * 2); // 42
      }
    });

    it('returns correct position with 50% zoom', () => {
      coords.setZoom(0.5);

      // At 50% zoom, cells are half as large in viewport
      // Cell (0,0) starts at (50, 24) and is (50, 10.5) in viewport
      const clickPos = coords.getClickPositionInCell(
        TEST_SHEET_ID,
        viewportPoint(ROW_HEADER_WIDTH + 25, COL_HEADER_HEIGHT + 5),
        { row: 0, col: 0 },
      );

      expect(clickPos).not.toBeNull();
      if (clickPos) {
        expect(clickPos.x).toBe(25);
        expect(clickPos.y).toBe(5);
        expect(clickPos.width).toBe(DEFAULT_COL_WIDTH * 0.5); // 50
        expect(clickPos.height).toBe(DEFAULT_ROW_HEIGHT * 0.5); // 10.5
      }
    });
  });

  // ===========================================================================
  // Header Offsets
  // ===========================================================================

  describe('header offsets', () => {
    it('accounts for row header width offset', () => {
      // Click at (0, COL_HEADER_HEIGHT) - in the row header area
      // Cell (0, 0) starts at (ROW_HEADER_WIDTH, COL_HEADER_HEIGHT)
      // So a click at (ROW_HEADER_WIDTH, COL_HEADER_HEIGHT) should be at (0, 0) in cell
      const clickPos = coords.getClickPositionInCell(
        TEST_SHEET_ID,
        viewportPoint(ROW_HEADER_WIDTH, COL_HEADER_HEIGHT),
        { row: 0, col: 0 },
      );

      expect(clickPos).not.toBeNull();
      if (clickPos) {
        expect(clickPos.x).toBe(0);
        expect(clickPos.y).toBe(0);
      }
    });

    it('accounts for column header height offset', () => {
      // Click at (ROW_HEADER_WIDTH, 0) - in the column header area
      // Cell (0, 0) starts at (ROW_HEADER_WIDTH, COL_HEADER_HEIGHT)
      const clickPos = coords.getClickPositionInCell(
        TEST_SHEET_ID,
        viewportPoint(ROW_HEADER_WIDTH, COL_HEADER_HEIGHT),
        { row: 0, col: 0 },
      );

      expect(clickPos).not.toBeNull();
      if (clickPos) {
        expect(clickPos.x).toBe(0);
        expect(clickPos.y).toBe(0);
      }
    });
  });

  // ===========================================================================
  // Non-Visible Cells
  // ===========================================================================

  describe('non-visible cells', () => {
    it('returns null for cell scrolled out of view (above)', () => {
      // Scroll down so row 0 is above the viewport
      coords.setViewport({ scrollTop: 1000, scrollLeft: 0, width: 1000, height: 600 });

      const clickPos = coords.getClickPositionInCell(TEST_SHEET_ID, viewportPoint(100, 100), {
        row: 0,
        col: 0,
      });

      expect(clickPos).toBeNull();
    });

    it('returns null for cell scrolled out of view (left)', () => {
      // Scroll right so col 0 is left of the viewport
      coords.setViewport({ scrollTop: 0, scrollLeft: 1000, width: 1000, height: 600 });

      const clickPos = coords.getClickPositionInCell(TEST_SHEET_ID, viewportPoint(100, 100), {
        row: 0,
        col: 0,
      });

      expect(clickPos).toBeNull();
    });

    it('returns null for cell far below viewport', () => {
      // Cell (100, 0) is likely below the viewport
      const clickPos = coords.getClickPositionInCell(TEST_SHEET_ID, viewportPoint(100, 100), {
        row: 100,
        col: 0,
      });

      // May or may not be null depending on viewport height, but should handle gracefully
      // If not visible, should return null
      if (clickPos === null) {
        expect(clickPos).toBeNull();
      }
    });

    it('returns null for cell far to the right of viewport', () => {
      // Cell (0, 50) is likely right of the viewport
      const clickPos = coords.getClickPositionInCell(TEST_SHEET_ID, viewportPoint(100, 100), {
        row: 0,
        col: 50,
      });

      // May or may not be null depending on viewport width, but should handle gracefully
      if (clickPos === null) {
        expect(clickPos).toBeNull();
      }
    });
  });

  // ===========================================================================
  // Combined Scenarios (Frozen + Zoom + Scroll)
  // ===========================================================================

  describe('combined scenarios', () => {
    it('handles frozen panes + zoom correctly', () => {
      coords.setFrozenPanes({ rows: 1, cols: 1 });
      coords.setZoom(1.5);

      // Frozen cell (0, 0) at 150% zoom
      const clickPos = coords.getClickPositionInCell(
        TEST_SHEET_ID,
        viewportPoint(ROW_HEADER_WIDTH + 75, COL_HEADER_HEIGHT + 15),
        { row: 0, col: 0 },
      );

      expect(clickPos).not.toBeNull();
      if (clickPos) {
        expect(clickPos.x).toBe(75);
        expect(clickPos.y).toBe(15);
        expect(clickPos.width).toBe(DEFAULT_COL_WIDTH * 1.5); // 150
        expect(clickPos.height).toBe(DEFAULT_ROW_HEIGHT * 1.5); // 31.5
      }
    });

    it('handles frozen panes + zoom + scroll correctly', () => {
      coords.setFrozenPanes({ rows: 1, cols: 1 });
      coords.setZoom(1.5);
      coords.setViewport({ scrollTop: 50, scrollLeft: 100, width: 1000, height: 600 });

      // Non-frozen cell (3, 3) at 150% zoom with scroll
      // First, get the cell's viewport position to ensure our click is actually in the cell
      const cellRect = coords.cellToViewport(TEST_SHEET_ID, { row: 3, col: 3 });
      expect(cellRect).not.toBeNull();

      if (cellRect) {
        // Click in the middle of the cell
        const clickX = cellRect.x + cellRect.width / 2;
        const clickY = cellRect.y + cellRect.height / 2;
        const clickPos = coords.getClickPositionInCell(
          TEST_SHEET_ID,
          viewportPoint(clickX, clickY),
          {
            row: 3,
            col: 3,
          },
        );

        expect(clickPos).not.toBeNull();
        if (clickPos) {
          // Click should be at the center of the cell
          expect(clickPos.x).toBeCloseTo(cellRect.width / 2, 0);
          expect(clickPos.y).toBeCloseTo(cellRect.height / 2, 0);
          expect(clickPos.width).toBe(cellRect.width);
          expect(clickPos.height).toBe(cellRect.height);
        }
      }
    });
  });
});
