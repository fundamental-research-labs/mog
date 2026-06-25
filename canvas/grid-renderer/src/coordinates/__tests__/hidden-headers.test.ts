/**
 * Tests for CoordinateSystem behavior with hidden headers.
 *
 * Tests the setHeaderVisibility() method and its impact on:
 * - getCellAreaLeft() - returns 0 when row headers are hidden
 * - getCellAreaTop() - returns 0 when column headers are hidden
 * - Coordinate conversions (document <-> viewport, viewport <-> layer)
 * - Hit testing regions (cell area starts at 0 when headers hidden)
 *
 * @module canvas/coordinates/__tests__/hidden-headers.test
 */

import {
  documentRect,
  layerPoint,
  viewportPoint,
} from '@mog/spreadsheet-utils/rendering/coordinates';
import {
  COL_HEADER_HEIGHT,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  ROW_HEADER_WIDTH,
} from '../../shared/constants';
import { CoordinateSystemImpl, createCoordinateSystem } from '../coordinate-system';
import { ViewportPositionIndex } from '../viewport-position-index';

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

/** Test sheet ID for coordinate system tests */
const TEST_SHEET_ID = 'test-sheet-1';

describe('CoordinateSystem with hidden headers', () => {
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

    // Set viewport
    coords.setViewport({ scrollTop: 0, scrollLeft: 0, width: 1000, height: 600 });
  });

  // ===========================================================================
  // Header Visibility State
  // ===========================================================================

  describe('header visibility state', () => {
    it('defaults to both headers visible', () => {
      const visibility = coords.getHeaderVisibility();
      expect(visibility.showRowHeaders).toBe(true);
      expect(visibility.showColumnHeaders).toBe(true);
    });

    it('can hide row headers', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: true });
      const visibility = coords.getHeaderVisibility();
      expect(visibility.showRowHeaders).toBe(false);
      expect(visibility.showColumnHeaders).toBe(true);
    });

    it('can hide column headers', () => {
      coords.setHeaderVisibility({ showRowHeaders: true, showColumnHeaders: false });
      const visibility = coords.getHeaderVisibility();
      expect(visibility.showRowHeaders).toBe(true);
      expect(visibility.showColumnHeaders).toBe(false);
    });

    it('can hide both headers', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: false });
      const visibility = coords.getHeaderVisibility();
      expect(visibility.showRowHeaders).toBe(false);
      expect(visibility.showColumnHeaders).toBe(false);
    });

    it('returns a copy of visibility state (immutable)', () => {
      const visibility1 = coords.getHeaderVisibility();
      const visibility2 = coords.getHeaderVisibility();
      expect(visibility1).not.toBe(visibility2);
      expect(visibility1).toEqual(visibility2);
    });
  });

  // ===========================================================================
  // Cell Area Positioning with Row Headers Hidden
  // ===========================================================================

  describe('with row headers hidden', () => {
    beforeEach(() => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: true });
    });

    it('getCellAreaLeft effectively returns 0 (via documentToViewport offset)', () => {
      // When row headers are hidden, cell area starts at x=0
      // We can verify this by converting a document point to viewport
      const docRect = documentRect(0, 0, 100, 21);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      // With row headers hidden, cell (0,0) should start at x=0 in viewport
      // (Plus COL_HEADER_HEIGHT for y, since column headers are still visible)
      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(0); // NOT ROW_HEADER_WIDTH (50)
      expect(vpRect!.y).toBe(COL_HEADER_HEIGHT); // Column headers still visible
    });

    it('documentToViewport positions cells at x=0 instead of ROW_HEADER_WIDTH', () => {
      const docRect = documentRect(100, 50, 200, 100);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(100); // Just the document x, no header offset
      expect(vpRect!.y).toBe(50 + COL_HEADER_HEIGHT); // Document y + column header
    });

    it('viewportToDocument correctly reverse-converts without row header offset', () => {
      // Click at viewport (50, 50) - this should map to document (50, 26)
      // x: 50 - 0 (no row header) = 50
      // y: 50 - 24 (column header) = 26
      const docPoint = coords.viewportToDocument(TEST_SHEET_ID, viewportPoint(50, 50));

      expect(docPoint.x).toBe(50);
      expect(docPoint.y).toBe(50 - COL_HEADER_HEIGHT); // 26
    });

    it('viewportToCell maps correctly with hidden row headers', () => {
      // With row headers hidden, clicking at (50, 30) should hit a cell
      // x=50, no header offset, col = floor(50/100) = 0
      // y=30 - 24 (column header) = 6, row = floor(6/21) = 0
      const cell = coords.viewportToCell(TEST_SHEET_ID, viewportPoint(50, 30));

      expect(cell).not.toBeNull();
      expect(cell!.col).toBe(0);
      expect(cell!.row).toBe(0);
    });

    it('cellToViewport positions cells starting at x=0', () => {
      const vpRect = coords.cellToViewport(TEST_SHEET_ID, { row: 0, col: 0 });

      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(0); // No row header offset
      expect(vpRect!.y).toBe(COL_HEADER_HEIGHT); // Column header still present
    });
  });

  // ===========================================================================
  // Cell Area Positioning with Column Headers Hidden
  // ===========================================================================

  describe('with column headers hidden', () => {
    beforeEach(() => {
      coords.setHeaderVisibility({ showRowHeaders: true, showColumnHeaders: false });
    });

    it('getCellAreaTop effectively returns 0 (via documentToViewport offset)', () => {
      // When column headers are hidden, cell area starts at y=0
      const docRect = documentRect(0, 0, 100, 21);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(ROW_HEADER_WIDTH); // Row headers still visible
      expect(vpRect!.y).toBe(0); // NOT COL_HEADER_HEIGHT (24)
    });

    it('documentToViewport positions cells at y=0 instead of COL_HEADER_HEIGHT', () => {
      const docRect = documentRect(100, 50, 200, 100);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(100 + ROW_HEADER_WIDTH); // Document x + row header
      expect(vpRect!.y).toBe(50); // Just the document y, no header offset
    });

    it('viewportToDocument correctly reverse-converts without column header offset', () => {
      // Click at viewport (75, 50) - this should map to document (25, 50)
      // x: 75 - 50 (row header) = 25
      // y: 50 - 0 (no column header) = 50
      const docPoint = coords.viewportToDocument(TEST_SHEET_ID, viewportPoint(75, 50));

      expect(docPoint.x).toBe(75 - ROW_HEADER_WIDTH); // 25
      expect(docPoint.y).toBe(50);
    });

    it('viewportToCell maps correctly with hidden column headers', () => {
      // With column headers hidden, clicking at (60, 10) should hit a cell
      // x=60 - 50 (row header) = 10, col = floor(10/100) = 0
      // y=10, no header offset, row = floor(10/21) = 0
      const cell = coords.viewportToCell(TEST_SHEET_ID, viewportPoint(60, 10));

      expect(cell).not.toBeNull();
      expect(cell!.col).toBe(0);
      expect(cell!.row).toBe(0);
    });

    it('cellToViewport positions cells starting at y=0', () => {
      const vpRect = coords.cellToViewport(TEST_SHEET_ID, { row: 0, col: 0 });

      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(ROW_HEADER_WIDTH); // Row header still present
      expect(vpRect!.y).toBe(0); // No column header offset
    });
  });

  // ===========================================================================
  // Both Headers Hidden
  // ===========================================================================

  describe('with both headers hidden', () => {
    beforeEach(() => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: false });
    });

    it('cell area starts at (0, 0)', () => {
      const docRect = documentRect(0, 0, 100, 21);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(0); // No row header
      expect(vpRect!.y).toBe(0); // No column header
    });

    it('documentToViewport positions match document coordinates', () => {
      const docRect = documentRect(150, 100, 200, 150);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      // With no headers, viewport coordinates match document coordinates
      expect(vpRect!.x).toBe(150);
      expect(vpRect!.y).toBe(100);
      expect(vpRect!.width).toBe(200);
      expect(vpRect!.height).toBe(150);
    });

    it('viewportToDocument is identity transformation for cell area', () => {
      const docPoint = coords.viewportToDocument(TEST_SHEET_ID, viewportPoint(100, 50));

      expect(docPoint.x).toBe(100);
      expect(docPoint.y).toBe(50);
    });

    it('viewportToCell maps viewport coordinates directly to cells', () => {
      const point = viewportPoint(DEFAULT_COL_WIDTH * 1.5, DEFAULT_ROW_HEIGHT * 1.5);
      const cell = coords.viewportToCell(TEST_SHEET_ID, point);

      expect(cell).not.toBeNull();
      expect(cell!.col).toBe(1);
      expect(cell!.row).toBe(1);
    });

    it('cellToViewport positions cells at origin', () => {
      const vpRect = coords.cellToViewport(TEST_SHEET_ID, { row: 0, col: 0 });

      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(0);
      expect(vpRect!.y).toBe(0);
    });

    it('cell (1,1) is at correct position', () => {
      const vpRect = coords.cellToViewport(TEST_SHEET_ID, { row: 1, col: 1 });

      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(DEFAULT_COL_WIDTH); // 100
      expect(vpRect!.y).toBe(DEFAULT_ROW_HEIGHT); // 21
    });
  });

  // ===========================================================================
  // Layer Coordinate Conversions with Hidden Headers
  // ===========================================================================

  describe('layer coordinate conversions', () => {
    describe('with row headers hidden', () => {
      beforeEach(() => {
        coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: true });
      });

      it('viewportToLayer subtracts only column header height', () => {
        const lp = coords.viewportToLayer(viewportPoint(100, 50));

        // x: 100 - 0 (no row header) = 100
        // y: 50 - 24 (column header) = 26
        expect(lp.x).toBe(100);
        expect(lp.y).toBe(50 - COL_HEADER_HEIGHT);
      });

      it('layerToViewport adds only column header height', () => {
        const vpPoint = coords.layerToViewport(layerPoint(100, 26));

        expect(vpPoint.x).toBe(100);
        expect(vpPoint.y).toBe(26 + COL_HEADER_HEIGHT);
      });
    });

    describe('with column headers hidden', () => {
      beforeEach(() => {
        coords.setHeaderVisibility({ showRowHeaders: true, showColumnHeaders: false });
      });

      it('viewportToLayer subtracts only row header width', () => {
        const lp = coords.viewportToLayer(viewportPoint(100, 50));

        // x: 100 - 50 (row header) = 50
        // y: 50 - 0 (no column header) = 50
        expect(lp.x).toBe(100 - ROW_HEADER_WIDTH);
        expect(lp.y).toBe(50);
      });

      it('layerToViewport adds only row header width', () => {
        const vpPoint = coords.layerToViewport(layerPoint(50, 50));

        expect(vpPoint.x).toBe(50 + ROW_HEADER_WIDTH);
        expect(vpPoint.y).toBe(50);
      });
    });

    describe('with both headers hidden', () => {
      beforeEach(() => {
        coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: false });
      });

      it('viewportToLayer is identity (no offsets)', () => {
        const lp = coords.viewportToLayer(viewportPoint(100, 50));

        expect(lp.x).toBe(100);
        expect(lp.y).toBe(50);
      });

      it('layerToViewport is identity (no offsets)', () => {
        const vpPoint = coords.layerToViewport(layerPoint(100, 50));

        expect(vpPoint.x).toBe(100);
        expect(vpPoint.y).toBe(50);
      });
    });
  });

  // ===========================================================================
  // documentToLayerViewport with Hidden Headers
  // ===========================================================================

  describe('documentToLayerViewport with hidden headers', () => {
    it('uses reduced cell area when row headers are hidden', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: true });

      const docRect = documentRect(100, 50, 200, 100);
      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      expect(layerRect).not.toBeNull();
      expect(layerRect!.x).toBe(100);
      expect(layerRect!.y).toBe(50);
    });

    it('uses reduced cell area when column headers are hidden', () => {
      coords.setHeaderVisibility({ showRowHeaders: true, showColumnHeaders: false });

      const docRect = documentRect(100, 50, 200, 100);
      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      expect(layerRect).not.toBeNull();
      expect(layerRect!.x).toBe(100);
      expect(layerRect!.y).toBe(50);
    });

    it('uses full viewport dimensions when both headers are hidden', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: false });

      const docRect = documentRect(100, 50, 200, 100);
      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      expect(layerRect).not.toBeNull();
      expect(layerRect!.x).toBe(100);
      expect(layerRect!.y).toBe(50);
    });

    it('visibility bounds check respects hidden headers', () => {
      // With full headers: cellAreaWidth = 1000 - 50 = 950
      // With no row header: cellAreaWidth = 1000 - 0 = 1000
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: true });

      // This rect would be out of bounds with row headers (x=960 > 950)
      // but visible without them (x=960 < 1000)
      const docRect = documentRect(960, 50, 30, 30);
      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      expect(layerRect).not.toBeNull();
      expect(layerRect!.x).toBe(960);
    });
  });

  // ===========================================================================
  // Hit Testing with Hidden Headers
  // ===========================================================================

  describe('hit testing with hidden headers', () => {
    describe('with row headers hidden', () => {
      beforeEach(() => {
        coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: true });
      });

      it('classifies point in former row header area as cell', () => {
        // With row headers hidden, clicking at (20, 30) should hit a cell
        // x=20 < ROW_HEADER_WIDTH, but row headers are hidden
        const hit = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(20, 30));

        // Since row headers are hidden, the entire left side is now cell area
        // x=20, no offset, col = floor(20/100) = 0
        // y=30 - 24 (column header) = 6, row = floor(6/21) = 0
        expect(hit.type).toBe('cell');
        if (hit.type === 'cell') {
          expect(hit.col).toBe(0);
          expect(hit.row).toBe(0);
        }
      });

      it('still classifies column header correctly', () => {
        // Column headers are still visible
        const hit = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(50, 10));

        expect(hit.type).toBe('columnHeader');
      });

      it('corner area becomes column header when row headers hidden', () => {
        // The corner (select all) area becomes part of column header
        const hit = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(10, 10));

        // With no row headers, there's no corner area - it's all column header
        expect(hit.type).toBe('columnHeader');
      });
    });

    describe('with column headers hidden', () => {
      beforeEach(() => {
        coords.setHeaderVisibility({ showRowHeaders: true, showColumnHeaders: false });
      });

      it('classifies point in former column header area as cell', () => {
        // With column headers hidden, clicking at (60, 10) should hit a cell
        const hit = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(60, 10));

        expect(hit.type).toBe('cell');
        if (hit.type === 'cell') {
          expect(hit.col).toBe(0);
          expect(hit.row).toBe(0);
        }
      });

      it('still classifies row header correctly', () => {
        // Row headers are still visible
        const hit = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(20, 50));

        expect(hit.type).toBe('rowHeader');
      });

      it('corner area becomes row header when column headers hidden', () => {
        // The corner area becomes part of row header
        const hit = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(10, 10));

        expect(hit.type).toBe('rowHeader');
      });
    });

    describe('with both headers hidden', () => {
      beforeEach(() => {
        coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: false });
      });

      it('entire viewport is cell area', () => {
        // Top-left corner
        const hit1 = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(5, 5));
        expect(hit1.type).toBe('cell');

        // Where row header would be
        const hit2 = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(20, 100));
        expect(hit2.type).toBe('cell');

        // Where column header would be
        const hit3 = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(100, 10));
        expect(hit3.type).toBe('cell');

        // Normal cell area
        const hit4 = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(200, 100));
        expect(hit4.type).toBe('cell');
      });

      it('maps viewport coordinates directly to cells', () => {
        const point = viewportPoint(DEFAULT_COL_WIDTH * 1.5, DEFAULT_ROW_HEIGHT * 2.1);
        const hit = coords.classifyPoint(TEST_SHEET_ID, point);

        expect(hit.type).toBe('cell');
        if (hit.type === 'cell') {
          expect(hit.col).toBe(1);
          expect(hit.row).toBe(2);
        }
      });
    });
  });

  // ===========================================================================
  // Viewport Bounds with Hidden Headers
  // ===========================================================================

  describe('viewport bounds with hidden headers', () => {
    it('getViewportBounds returns correct bounds when row headers hidden', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: true });

      const bounds = coords.getViewportBounds(TEST_SHEET_ID);

      expect(bounds.left).toBe(0); // No row header offset
      expect(bounds.top).toBe(COL_HEADER_HEIGHT); // Column header still present
      expect(bounds.right).toBe(1000); // Full width
      expect(bounds.bottom).toBe(600); // Full height
    });

    it('getViewportBounds returns correct bounds when column headers hidden', () => {
      coords.setHeaderVisibility({ showRowHeaders: true, showColumnHeaders: false });

      const bounds = coords.getViewportBounds(TEST_SHEET_ID);

      expect(bounds.left).toBe(ROW_HEADER_WIDTH); // Row header still present
      expect(bounds.top).toBe(0); // No column header offset
      expect(bounds.right).toBe(1000);
      expect(bounds.bottom).toBe(600);
    });

    it('getViewportBounds returns full viewport when both headers hidden', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: false });

      const bounds = coords.getViewportBounds(TEST_SHEET_ID);

      expect(bounds.left).toBe(0);
      expect(bounds.top).toBe(0);
      expect(bounds.right).toBe(1000);
      expect(bounds.bottom).toBe(600);
    });
  });

  // ===========================================================================
  // Zoom with Hidden Headers
  // ===========================================================================

  describe('zoom with hidden headers', () => {
    it('zoom affects cell positioning correctly with hidden row headers', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: true });
      coords.setZoom(2.0);

      const docRect = documentRect(100, 50, 100, 50);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      // x: 100 * 2 = 200 (no row header offset)
      // y: 50 * 2 + COL_HEADER_HEIGHT = 100 + 24 = 124
      expect(vpRect!.x).toBe(200);
      expect(vpRect!.y).toBe(124);
      expect(vpRect!.width).toBe(200);
      expect(vpRect!.height).toBe(100);
    });

    it('zoom affects cell positioning correctly with hidden column headers', () => {
      coords.setHeaderVisibility({ showRowHeaders: true, showColumnHeaders: false });
      coords.setZoom(2.0);

      const docRect = documentRect(100, 50, 100, 50);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      // x: 100 * 2 + ROW_HEADER_WIDTH
      // y: 50 * 2 = 100 (no column header offset)
      expect(vpRect!.x).toBe(100 * 2 + ROW_HEADER_WIDTH);
      expect(vpRect!.y).toBe(100);
    });

    it('zoom with both headers hidden', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: false });
      coords.setZoom(2.0);

      const docRect = documentRect(100, 50, 100, 50);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      // Pure zoom, no header offsets
      expect(vpRect!.x).toBe(200);
      expect(vpRect!.y).toBe(100);
      expect(vpRect!.width).toBe(200);
      expect(vpRect!.height).toBe(100);
    });
  });

  // ===========================================================================
  // Scroll with Hidden Headers
  // ===========================================================================

  describe('scroll with hidden headers', () => {
    it('scroll works correctly with hidden row headers', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: true });
      coords.setViewport({ scrollTop: 100, scrollLeft: 200, width: 1000, height: 600 });

      const docRect = documentRect(300, 150, 100, 50);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      // x: (300 - 200 scroll) = 100 (no row header offset)
      // y: (150 - 100 scroll) + COL_HEADER_HEIGHT = 50 + 24 = 74
      expect(vpRect!.x).toBe(100);
      expect(vpRect!.y).toBe(74);
    });

    it('scroll works correctly with hidden column headers', () => {
      coords.setHeaderVisibility({ showRowHeaders: true, showColumnHeaders: false });
      coords.setViewport({ scrollTop: 100, scrollLeft: 200, width: 1000, height: 600 });

      const docRect = documentRect(300, 150, 100, 50);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      // x: (300 - 200 scroll) + ROW_HEADER_WIDTH
      // y: (150 - 100 scroll) = 50 (no column header offset)
      expect(vpRect!.x).toBe(300 - 200 + ROW_HEADER_WIDTH);
      expect(vpRect!.y).toBe(50);
    });

    it('scroll works correctly with both headers hidden', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: false });
      coords.setViewport({ scrollTop: 100, scrollLeft: 200, width: 1000, height: 600 });

      const docRect = documentRect(300, 150, 100, 50);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      // Pure scroll offset, no header offsets
      expect(vpRect!.x).toBe(100);
      expect(vpRect!.y).toBe(50);
    });
  });

  // ===========================================================================
  // Outline Gutter with Hidden Headers
  // ===========================================================================

  describe('outline gutter with hidden headers', () => {
    beforeEach(() => {
      coords.setOutlineGutter(28, 14); // 2 levels of row groups, 1 level of col groups
    });

    it('gutter is still respected when row headers are hidden', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: true });

      // With row headers hidden but gutter present:
      // cellAreaLeft = gutterWidth + 0 = 28
      const docRect = documentRect(0, 0, 100, 21);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(28); // Gutter still present
      expect(vpRect!.y).toBe(COL_HEADER_HEIGHT + 14); // Column header + gutter
    });

    it('gutter is still respected when column headers are hidden', () => {
      coords.setHeaderVisibility({ showRowHeaders: true, showColumnHeaders: false });

      // With column headers hidden but gutter present:
      // cellAreaTop = gutterHeight + 0 = 14
      const docRect = documentRect(0, 0, 100, 21);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(ROW_HEADER_WIDTH + 28); // Row header + gutter
      expect(vpRect!.y).toBe(14); // Gutter only
    });

    it('only gutter offset when both headers are hidden', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: false });

      const docRect = documentRect(0, 0, 100, 21);
      const vpRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(vpRect).not.toBeNull();
      expect(vpRect!.x).toBe(28); // Row gutter
      expect(vpRect!.y).toBe(14); // Column gutter
    });

    it('hit testing accounts for gutter with hidden headers', () => {
      coords.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: false });

      // Click in gutter area
      const gutterHit = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(10, 5));
      expect(gutterHit.type).toBe('outlineGutter');

      // Click past gutter in cell area
      const cellHit = coords.classifyPoint(TEST_SHEET_ID, viewportPoint(30, 20));
      expect(cellHit.type).toBe('cell');
    });
  });
});
