/**
 * Tests for CoordinateSystem.documentToLayerViewport()
 *
 * This method converts document coordinates to layer-relative viewport coordinates,
 * WITHOUT including header offsets. This is critical for render layers where the
 * canvas translation already accounts for headers.
 *
 * The distinction between documentToViewport() and documentToLayerViewport():
 * - documentToViewport(): Returns canvas-absolute coords (for input handling)
 * - documentToLayerViewport(): Returns layer-relative coords (for rendering)
 * @module canvas/coordinates/__tests__/document-to-layer-viewport.test
 */

import { documentRect } from '@mog/spreadsheet-utils/rendering/coordinates';
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

describe('CoordinateSystem.documentToLayerViewport', () => {
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
  // Basic Conversion (No Scroll, No Zoom)
  // ===========================================================================

  describe('basic conversion (no scroll, no zoom)', () => {
    it('converts document rect to layer-relative coords WITHOUT header offset', () => {
      // Document rect at (100, 50) with size 200x100
      const docRect = documentRect(100, 50, 200, 100);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // documentToLayerViewport should NOT add header offsets
      expect(layerRect).toEqual({
        x: 100, // NO ROW_HEADER_WIDTH added
        y: 50, // NO COL_HEADER_HEIGHT added
        width: 200,
        height: 100,
      });
    });

    it('differs from documentToViewport by header offsets', () => {
      const docRect = documentRect(100, 50, 200, 100);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);
      const viewportRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      // documentToViewport adds header offsets
      expect(viewportRect).toEqual({
        x: 100 + ROW_HEADER_WIDTH, // 100 + 50 = 150
        y: 50 + COL_HEADER_HEIGHT, // 50 + 24 = 74
        width: 200,
        height: 100,
      });

      // documentToLayerViewport does NOT add header offsets
      expect(layerRect).toEqual({
        x: 100,
        y: 50,
        width: 200,
        height: 100,
      });

      // The difference is exactly the header dimensions
      expect(viewportRect!.x - layerRect!.x).toBe(ROW_HEADER_WIDTH);
      expect(viewportRect!.y - layerRect!.y).toBe(COL_HEADER_HEIGHT);
    });

    it('handles rect at origin (0, 0)', () => {
      const docRect = documentRect(0, 0, 100, 50);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      expect(layerRect).toEqual({
        x: 0,
        y: 0,
        width: 100,
        height: 50,
      });
    });
  });

  // ===========================================================================
  // Scroll Offset Handling
  // ===========================================================================

  describe('with scroll offset', () => {
    it('subtracts scroll offset from position', () => {
      // Scroll down 100px and right 200px
      coords.setViewport({ scrollTop: 100, scrollLeft: 200, width: 1000, height: 600 });

      // Document rect at (300, 150)
      const docRect = documentRect(300, 150, 100, 50);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // Position should be offset by scroll
      expect(layerRect).toEqual({
        x: 300 - 200, // 100
        y: 150 - 100, // 50
        width: 100,
        height: 50,
      });
    });

    it('returns null for rect scrolled completely out of view (left)', () => {
      coords.setViewport({ scrollTop: 0, scrollLeft: 500, width: 1000, height: 600 });

      // Rect at (100, 50) with width 200 - scrolled out of view
      const docRect = documentRect(100, 50, 200, 100);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // Rect ends at x=300, but scroll is at 500, so it's before visible area
      // x=100-500=-400, width=200, right edge = -200 < 0
      expect(layerRect).toBeNull();
    });

    it('returns null for rect scrolled completely out of view (top)', () => {
      coords.setViewport({ scrollTop: 300, scrollLeft: 0, width: 1000, height: 600 });

      // Rect at (100, 50) with height 100 - scrolled out of view
      const docRect = documentRect(100, 50, 200, 100);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // Rect ends at y=150, but scroll is at 300, so it's above visible area
      // y=50-300=-250, height=100, bottom edge = -150 < 0
      expect(layerRect).toBeNull();
    });

    it('returns rect when partially visible after scroll', () => {
      coords.setViewport({ scrollTop: 100, scrollLeft: 200, width: 1000, height: 600 });

      // Rect that is partially visible (starts before scroll, extends into view)
      const docRect = documentRect(150, 50, 200, 150);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // Rect starts at x=150-200=-50, ends at x=150
      // Rect starts at y=50-100=-50, ends at y=100
      // Partially visible, should not be null
      expect(layerRect).not.toBeNull();
      expect(layerRect).toEqual({
        x: -50,
        y: -50,
        width: 200,
        height: 150,
      });
    });
  });

  // ===========================================================================
  // Zoom Handling
  // ===========================================================================

  describe('with zoom', () => {
    it('applies zoom to position and size', () => {
      coords.setZoom(2.0); // 200% zoom

      const docRect = documentRect(100, 50, 200, 100);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      expect(layerRect).toEqual({
        x: 200, // 100 * 2
        y: 100, // 50 * 2
        width: 400, // 200 * 2
        height: 200, // 100 * 2
      });
    });

    it('applies zoom when zoomed out', () => {
      coords.setZoom(0.5); // 50% zoom

      const docRect = documentRect(100, 50, 200, 100);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      expect(layerRect).toEqual({
        x: 50, // 100 * 0.5
        y: 25, // 50 * 0.5
        width: 100, // 200 * 0.5
        height: 50, // 100 * 0.5
      });
    });

    it('applies zoom and scroll together', () => {
      coords.setZoom(2.0);
      coords.setViewport({ scrollTop: 50, scrollLeft: 100, width: 1000, height: 600 });

      const docRect = documentRect(200, 100, 100, 50);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // First subtract scroll, then apply zoom
      expect(layerRect).toEqual({
        x: (200 - 100) * 2, // 200
        y: (100 - 50) * 2, // 100
        width: 100 * 2, // 200
        height: 50 * 2, // 100
      });
    });
  });

  // ===========================================================================
  // Visibility Bounds Check
  // ===========================================================================

  describe('visibility bounds check', () => {
    it('returns null for rect completely right of viewport', () => {
      coords.setViewport({ scrollTop: 0, scrollLeft: 0, width: 1000, height: 600 });

      // Cell area width = 1000 - ROW_HEADER_WIDTH = 950
      const docRect = documentRect(1000, 50, 100, 50);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // x=1000 > cellAreaWidth (950), completely outside
      expect(layerRect).toBeNull();
    });

    it('returns null for rect completely below viewport', () => {
      coords.setViewport({ scrollTop: 0, scrollLeft: 0, width: 1000, height: 600 });

      // Cell area height = 600 - COL_HEADER_HEIGHT = 576
      const docRect = documentRect(50, 600, 100, 50);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // y=600 > cellAreaHeight (576), completely outside
      expect(layerRect).toBeNull();
    });

    it('returns rect when partially visible at right edge', () => {
      coords.setViewport({ scrollTop: 0, scrollLeft: 0, width: 1000, height: 600 });

      // Rect that extends past right edge but is partially visible
      const docRect = documentRect(900, 50, 200, 50);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // x=900, ends at 1100, but cellAreaWidth is 950
      // Still partially visible (900 < 950)
      expect(layerRect).not.toBeNull();
      expect(layerRect).toEqual({
        x: 900,
        y: 50,
        width: 200,
        height: 50,
      });
    });
  });

  // ===========================================================================
  // Frozen Panes
  // ===========================================================================

  describe('with frozen panes', () => {
    beforeEach(() => {
      // Freeze first 2 rows and 3 columns
      coords.setFrozenPanes({ rows: 2, cols: 3 });
    });

    it('does not apply scroll to objects in frozen column region', () => {
      coords.setViewport({ scrollTop: 0, scrollLeft: 200, width: 1000, height: 600 });

      // Object in frozen column area (x < frozen cols width = 3 * 100 = 300)
      // But actually frozenColsWidth is calculated from dimension provider
      // With 3 frozen cols at 100px each, frozenColsWidth = 300
      const docRect = documentRect(50, 100, 100, 50);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // Should NOT subtract scroll for frozen column
      expect(layerRect).toEqual({
        x: 50, // NOT 50 - 200 = -150
        y: 100,
        width: 100,
        height: 50,
      });
    });

    it('does not apply scroll to objects in frozen row region', () => {
      coords.setViewport({ scrollTop: 100, scrollLeft: 0, width: 1000, height: 600 });

      // Object in frozen row area (y < frozen rows height = 2 * 21 = 42)
      const docRect = documentRect(100, 20, 100, 20);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // Should NOT subtract scroll for frozen row
      expect(layerRect).toEqual({
        x: 100,
        y: 20, // NOT 20 - 100 = -80
        width: 100,
        height: 20,
      });
    });

    it('applies scroll to objects in non-frozen region', () => {
      const frozenRowsHeight = 2 * DEFAULT_ROW_HEIGHT;
      const frozenColsWidth = 3 * DEFAULT_COL_WIDTH;
      coords.setViewport({ scrollTop: 100, scrollLeft: 0, width: 1000, height: 600 });

      // Object past frozen region, then scrolled partly behind frozen rows.
      const docRect = documentRect(frozenColsWidth + 40, 100, 100, 50);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      // Scrollable content hidden behind frozen rows is clipped.
      expect(layerRect).toEqual({
        x: frozenColsWidth + 40,
        y: frozenRowsHeight,
        width: 100,
        height: 50 - frozenRowsHeight,
      });
    });

    it('clips scrollable objects against frozen row and column boundaries', () => {
      const frozenRowsHeight = 2 * DEFAULT_ROW_HEIGHT;
      const frozenColsWidth = 3 * DEFAULT_COL_WIDTH;
      coords.setViewport({
        scrollTop: 100,
        scrollLeft: frozenColsWidth + 8,
        width: 1000,
        height: 600,
      });

      // Object is non-frozen but partly covered by both frozen panes after scroll.
      const docRect = documentRect(frozenColsWidth + 8, 100, frozenColsWidth + 16, 50);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);

      expect(layerRect).toEqual({
        x: frozenColsWidth,
        y: frozenRowsHeight,
        width: 16,
        height: 50 - frozenRowsHeight,
      });
    });

    it('clips documentToViewport page-geometry coords at the frozen row boundary', () => {
      coords.setViewport({ scrollTop: 100, scrollLeft: 0, width: 1000, height: 600 });
      const frozenRowsHeight = 2 * DEFAULT_ROW_HEIGHT;

      const docRect = documentRect(100, 100, 100, 50);

      const viewportRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(viewportRect).toEqual({
        x: 100 + ROW_HEADER_WIDTH,
        y: frozenRowsHeight + COL_HEADER_HEIGHT,
        width: 100,
        height: 50 - frozenRowsHeight,
      });
    });
  });

  // ===========================================================================
  // Symmetry with documentToViewport
  // ===========================================================================

  describe('symmetry with documentToViewport', () => {
    it('layer coords + header offset = viewport coords', () => {
      coords.setViewport({ scrollTop: 50, scrollLeft: 100, width: 1000, height: 600 });
      coords.setZoom(1.5);

      const docRect = documentRect(200, 100, 150, 75);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);
      const viewportRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      expect(layerRect).not.toBeNull();
      expect(viewportRect).not.toBeNull();

      // Viewport rect = layer rect + header offsets
      expect(viewportRect!.x).toBe(layerRect!.x + ROW_HEADER_WIDTH);
      expect(viewportRect!.y).toBe(layerRect!.y + COL_HEADER_HEIGHT);
      expect(viewportRect!.width).toBe(layerRect!.width);
      expect(viewportRect!.height).toBe(layerRect!.height);
    });

    it('both return null for same out-of-bounds rect', () => {
      coords.setViewport({ scrollTop: 500, scrollLeft: 500, width: 1000, height: 600 });

      const docRect = documentRect(100, 100, 50, 50);

      const layerRect = coords.documentToLayerViewport(TEST_SHEET_ID, docRect);
      const viewportRect = coords.documentToViewport(TEST_SHEET_ID, docRect);

      // Both should be null for rect scrolled out of view
      expect(layerRect).toBeNull();
      expect(viewportRect).toBeNull();
    });
  });
});
