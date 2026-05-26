/**
 * Hit Testing Tests
 *
 * Tests for viewport hit testing functions.
 */

import type { Viewport, ViewportLayout } from '@mog-sdk/contracts/viewport';
import { DEFAULT_VIEWPORT_RENDER_CONFIG } from '@mog-sdk/contracts/viewport';
import { ViewportMergeIndex } from '../../coordinates/viewport-merge-index';
import { ViewportPositionIndex } from '../../coordinates/viewport-position-index';
import {
  canvasToCell,
  getCellBoundsInViewport,
  getCellCanvasBounds,
  getViewportAtPoint,
  hitTestLayout,
} from '../hit-testing';

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestViewport(overrides: Partial<Viewport> = {}): Viewport {
  return {
    id: 'test-viewport',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    cellRange: { startRow: 0, startCol: 0, endRow: 99, endCol: 25 },
    viewportOrigin: { x: 0, y: 0 },
    scrollOffset: { x: 0, y: 0 },
    scrollBehavior: { type: 'free' },
    zoom: 1.0,
    renderConfig: DEFAULT_VIEWPORT_RENDER_CONFIG,
    ...overrides,
  };
}

function createTestPositionIndex(opts?: {
  defaultRowHeight?: number;
  defaultColWidth?: number;
  totalRows?: number;
  totalCols?: number;
  numRows?: number;
  numCols?: number;
}): ViewportPositionIndex {
  const defaultRowHeight = opts?.defaultRowHeight ?? 25;
  const defaultColWidth = opts?.defaultColWidth ?? 100;
  const totalRows = opts?.totalRows ?? 1000;
  const totalCols = opts?.totalCols ?? 26;
  const numRows = opts?.numRows ?? Math.min(totalRows, 1000);
  const numCols = opts?.numCols ?? Math.min(totalCols, 100);

  const pi = new ViewportPositionIndex(defaultRowHeight, defaultColWidth);

  const rowPositions = new Float64Array(numRows);
  let y = 0;
  for (let i = 0; i < numRows; i++) {
    rowPositions[i] = y;
    y += defaultRowHeight;
  }

  const colPositions = new Float64Array(numCols);
  let x = 0;
  for (let i = 0; i < numCols; i++) {
    colPositions[i] = x;
    x += defaultColWidth;
  }

  pi.setPositions(rowPositions, colPositions, 0, 0);
  pi.setTotalDimensions(totalRows, totalCols);

  return pi;
}

function createTestLayout(viewports: Viewport[]): ViewportLayout {
  return {
    viewports,
    primaryViewportId: viewports[0]?.id ?? 'main',
    dividers: [],
    contentSize: { width: 10000, height: 10000 },
    maxScroll: { x: 9200, y: 9400 },
    headerInfo: {
      frozenRows: 0,
      frozenCols: 0,
      frozenRowsHeight: 0,
      frozenColsWidth: 0,
      scrollPosition: { x: 0, y: 0 },
      zoom: 1.0,
    },
  };
}

// =============================================================================
// getViewportAtPoint Tests
// =============================================================================

describe('getViewportAtPoint', () => {
  it('returns null for empty layout', () => {
    const layout = createTestLayout([]);
    const result = getViewportAtPoint(layout, { x: 100, y: 100 });
    expect(result).toBeNull();
  });

  it('returns viewport when point is inside bounds', () => {
    const viewport = createTestViewport({ id: 'main' });
    const layout = createTestLayout([viewport]);

    const result = getViewportAtPoint(layout, { x: 400, y: 300 });
    expect(result).toBe(viewport);
  });

  it('returns null when point is outside all viewports', () => {
    const viewport = createTestViewport({
      bounds: { x: 0, y: 0, width: 400, height: 300 },
    });
    const layout = createTestLayout([viewport]);

    const result = getViewportAtPoint(layout, { x: 500, y: 400 });
    expect(result).toBeNull();
  });

  it('returns topmost viewport when viewports overlap (reverse z-order)', () => {
    const bottom = createTestViewport({
      id: 'bottom',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    const top = createTestViewport({
      id: 'top',
      bounds: { x: 100, y: 100, width: 200, height: 200 },
    });
    const layout = createTestLayout([bottom, top]); // top is last = on top

    // Point in overlap region should return top viewport
    const result = getViewportAtPoint(layout, { x: 150, y: 150 });
    expect(result?.id).toBe('top');
  });

  it('returns bottom viewport for point outside overlay', () => {
    const bottom = createTestViewport({
      id: 'bottom',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    const top = createTestViewport({
      id: 'top',
      bounds: { x: 100, y: 100, width: 200, height: 200 },
    });
    const layout = createTestLayout([bottom, top]);

    // Point outside overlay but inside bottom viewport
    const result = getViewportAtPoint(layout, { x: 50, y: 50 });
    expect(result?.id).toBe('bottom');
  });

  it('handles point exactly on viewport boundary', () => {
    const viewport = createTestViewport({
      bounds: { x: 100, y: 100, width: 400, height: 300 },
    });
    const layout = createTestLayout([viewport]);

    // On left edge (inclusive)
    expect(getViewportAtPoint(layout, { x: 100, y: 200 })).toBe(viewport);
    // On top edge (inclusive)
    expect(getViewportAtPoint(layout, { x: 200, y: 100 })).toBe(viewport);
    // On right edge (exclusive)
    expect(getViewportAtPoint(layout, { x: 500, y: 200 })).toBeNull();
    // On bottom edge (exclusive)
    expect(getViewportAtPoint(layout, { x: 200, y: 400 })).toBeNull();
  });
});

// =============================================================================
// canvasToCell Tests
// =============================================================================

describe('canvasToCell', () => {
  const pi = createTestPositionIndex({
    defaultRowHeight: 25,
    defaultColWidth: 100,
    totalRows: 1000,
    totalCols: 26,
  });
  const mi = new ViewportMergeIndex();

  it('converts point at origin to cell (0, 0)', () => {
    const viewport = createTestViewport();
    const result = canvasToCell(viewport, { x: 10, y: 10 }, pi, mi);
    expect(result).toEqual({ row: 0, col: 0 });
  });

  it('converts point to correct cell based on dimensions', () => {
    const viewport = createTestViewport();
    // At x=150, should be in column 1 (100-200)
    // At y=30, should be in row 1 (25-50)
    const result = canvasToCell(viewport, { x: 150, y: 30 }, pi, mi);
    expect(result).toEqual({ row: 1, col: 1 });
  });

  it('accounts for scroll offset', () => {
    const viewport = createTestViewport({
      scrollOffset: { x: 200, y: 50 }, // Scrolled 2 columns and 2 rows
    });
    // Point at (10, 10) in viewport, plus scroll offset (200, 50)
    // Should be at document position (210, 60)
    // Column: 210 / 100 = column 2
    // Row: 60 / 25 = row 2
    const result = canvasToCell(viewport, { x: 10, y: 10 }, pi, mi);
    expect(result).toEqual({ row: 2, col: 2 });
  });

  it('accounts for zoom', () => {
    const viewport = createTestViewport({ zoom: 2.0 });
    // At 2x zoom, viewport pixels are half the document distance
    // Point at (200, 50) viewport = (100, 25) document
    // Should be row 1 (25-50), col 1 (100-200)
    const result = canvasToCell(viewport, { x: 200, y: 50 }, pi, mi);
    expect(result).toEqual({ row: 1, col: 1 });
  });

  it('accounts for viewport position offset', () => {
    const viewport = createTestViewport({
      bounds: { x: 100, y: 50, width: 700, height: 550 },
    });
    // Point at canvas (150, 75) is viewport-local (50, 25)
    // Which maps to cell (1, 0) with default dimensions
    const result = canvasToCell(viewport, { x: 150, y: 75 }, pi, mi);
    expect(result).toEqual({ row: 1, col: 0 });
  });

  it('handles viewport with non-zero cell range start', () => {
    const viewport = createTestViewport({
      cellRange: { startRow: 5, startCol: 3, endRow: 99, endCol: 25 },
      scrollOffset: { x: 0, y: 0 },
    });
    // Even with startRow=5, if scrollOffset is 0 and we click at document position (10, 10),
    // that's still cell (0, 0) in document space
    // But the viewport might be positioned to show row 5+
    // Actually for hit testing, we search within the cell range bounds
    const result = canvasToCell(viewport, { x: 10, y: 10 }, pi, mi);
    // This should return null since row 0, col 0 is outside the viewport's cell range
    // Actually looking at the implementation, it does binary search within the range
    // Point (10, 10) at doc position (10, 10) is row 0, col 0
    // But startRow=5, so binary search starts at row 5 and won't find row 0
    expect(result).toBeNull();
  });

  it('returns null for negative document positions', () => {
    const viewport = createTestViewport({
      bounds: { x: 100, y: 100, width: 600, height: 400 },
      scrollOffset: { x: 0, y: 0 },
    });
    // Point at (50, 50) in canvas is (-50, -50) in viewport-local
    // Which results in negative document coordinates
    const result = canvasToCell(viewport, { x: 50, y: 50 }, pi, mi);
    expect(result).toBeNull();
  });
});

// =============================================================================
// hitTestLayout Tests
// =============================================================================

describe('hitTestLayout', () => {
  const pi = createTestPositionIndex({
    defaultRowHeight: 25,
    defaultColWidth: 100,
  });
  const mi = new ViewportMergeIndex();

  it('returns empty when no viewport contains point', () => {
    const layout = createTestLayout([]);
    const result = hitTestLayout(layout, { x: 100, y: 100 }, pi, mi);
    expect(result).toEqual({ type: 'empty' });
  });

  it('returns viewport hit result with cell', () => {
    const viewport = createTestViewport();
    const layout = createTestLayout([viewport]);

    const result = hitTestLayout(layout, { x: 150, y: 30 }, pi, mi);
    expect(result.type).toBe('viewport');
    if (result.type === 'viewport') {
      expect(result.cell).toEqual({ row: 1, col: 1 });
      expect(result.viewport).toBe(viewport);
    }
  });

  it('detects horizontal divider', () => {
    const layout: ViewportLayout = {
      viewports: [createTestViewport()],
      primaryViewportId: 'test-viewport',
      dividers: [{ type: 'freeze', orientation: 'horizontal', position: 100, draggable: false }],
      contentSize: { width: 10000, height: 10000 },
      maxScroll: { x: 9200, y: 9400 },
      headerInfo: {
        frozenRows: 0,
        frozenCols: 0,
        frozenRowsHeight: 0,
        frozenColsWidth: 0,
        scrollPosition: { x: 0, y: 0 },
        zoom: 1.0,
      },
    };

    // Hit within tolerance of divider position
    const result = hitTestLayout(layout, { x: 200, y: 102 }, pi, mi);
    expect(result.type).toBe('divider');
    if (result.type === 'divider') {
      expect(result.divider.orientation).toBe('horizontal');
      expect(result.index).toBe(0);
    }
  });

  it('detects vertical divider', () => {
    const layout: ViewportLayout = {
      viewports: [createTestViewport()],
      primaryViewportId: 'test-viewport',
      dividers: [{ type: 'freeze', orientation: 'vertical', position: 150, draggable: true }],
      contentSize: { width: 10000, height: 10000 },
      maxScroll: { x: 9200, y: 9400 },
      headerInfo: {
        frozenRows: 0,
        frozenCols: 0,
        frozenRowsHeight: 0,
        frozenColsWidth: 0,
        scrollPosition: { x: 0, y: 0 },
        zoom: 1.0,
      },
    };

    const result = hitTestLayout(layout, { x: 152, y: 200 }, pi, mi);
    expect(result.type).toBe('divider');
    if (result.type === 'divider') {
      expect(result.divider.orientation).toBe('vertical');
      expect(result.divider.draggable).toBe(true);
    }
  });

  it('dividers take priority over viewports', () => {
    const layout: ViewportLayout = {
      viewports: [createTestViewport()],
      primaryViewportId: 'test-viewport',
      dividers: [{ type: 'freeze', orientation: 'vertical', position: 100, draggable: false }],
      contentSize: { width: 10000, height: 10000 },
      maxScroll: { x: 9200, y: 9400 },
      headerInfo: {
        frozenRows: 0,
        frozenCols: 0,
        frozenRowsHeight: 0,
        frozenColsWidth: 0,
        scrollPosition: { x: 0, y: 0 },
        zoom: 1.0,
      },
    };

    // Point is on divider AND inside viewport - divider wins
    const result = hitTestLayout(layout, { x: 100, y: 200 }, pi, mi);
    expect(result.type).toBe('divider');
  });
});

// =============================================================================
// getCellBoundsInViewport Tests
// =============================================================================

describe('getCellBoundsInViewport', () => {
  const piLocal = createTestPositionIndex({
    defaultRowHeight: 25,
    defaultColWidth: 100,
  });

  it('returns correct bounds for cell at origin', () => {
    const viewport = createTestViewport();
    const bounds = getCellBoundsInViewport(viewport, 0, 0, piLocal);

    expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 25 });
  });

  it('returns correct bounds for offset cell', () => {
    const viewport = createTestViewport();
    const bounds = getCellBoundsInViewport(viewport, 2, 3, piLocal);

    // Row 2: top = 50 (2 * 25)
    // Col 3: left = 300 (3 * 100)
    expect(bounds).toEqual({ x: 300, y: 50, width: 100, height: 25 });
  });

  it('accounts for scroll offset', () => {
    const viewport = createTestViewport({
      scrollOffset: { x: 100, y: 25 },
    });
    const bounds = getCellBoundsInViewport(viewport, 0, 0, piLocal);

    // Cell (0,0) is at doc position (0, 0)
    // Minus scroll offset (100, 25) = viewport position (-100, -25)
    expect(bounds).toEqual({ x: -100, y: -25, width: 100, height: 25 });
  });

  it('accounts for zoom', () => {
    const viewport = createTestViewport({ zoom: 2.0 });
    const bounds = getCellBoundsInViewport(viewport, 0, 0, piLocal);

    // At 2x zoom, cell appears twice as large in viewport
    expect(bounds).toEqual({ x: 0, y: 0, width: 200, height: 50 });
  });

  it('returns null for cell outside viewport cell range', () => {
    const viewport = createTestViewport({
      cellRange: { startRow: 5, startCol: 5, endRow: 20, endCol: 15 },
    });

    expect(getCellBoundsInViewport(viewport, 0, 0, piLocal)).toBeNull();
    expect(getCellBoundsInViewport(viewport, 4, 5, piLocal)).toBeNull();
    expect(getCellBoundsInViewport(viewport, 5, 4, piLocal)).toBeNull();
    expect(getCellBoundsInViewport(viewport, 21, 10, piLocal)).toBeNull();
  });

  it('returns null for cell scrolled completely out of view', () => {
    const viewport = createTestViewport({
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      scrollOffset: { x: 1000, y: 500 }, // Scrolled way past cell (0,0)
    });
    const bounds = getCellBoundsInViewport(viewport, 0, 0, piLocal);

    // Cell would be at negative position, outside viewport bounds
    expect(bounds).toBeNull();
  });
});

// =============================================================================
// getCellCanvasBounds Tests
// =============================================================================

describe('getCellCanvasBounds', () => {
  const piCB = createTestPositionIndex({
    defaultRowHeight: 25,
    defaultColWidth: 100,
  });

  it('adds viewport position to get canvas coordinates', () => {
    const viewport = createTestViewport({
      bounds: { x: 50, y: 30, width: 700, height: 550 },
    });
    const bounds = getCellCanvasBounds(viewport, 0, 0, piCB);

    // Viewport position (50, 30) + cell position (0, 0)
    expect(bounds).toEqual({ x: 50, y: 30, width: 100, height: 25 });
  });

  it('returns null when cell is outside viewport', () => {
    const viewport = createTestViewport({
      cellRange: { startRow: 10, startCol: 10, endRow: 20, endCol: 20 },
    });
    const bounds = getCellCanvasBounds(viewport, 0, 0, piCB);
    expect(bounds).toBeNull();
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('hit testing integration', () => {
  it('handles freeze panes layout (4 viewports)', () => {
    // Simulating freeze at row 2, col 1
    // Creates 4 viewports: corner, top, left, main
    const frozenRowHeight = 50; // 2 rows * 25
    const frozenColWidth = 100; // 1 col * 100

    const corner = createTestViewport({
      id: 'frozen-corner',
      bounds: { x: 0, y: 0, width: frozenColWidth, height: frozenRowHeight },
      cellRange: { startRow: 0, startCol: 0, endRow: 1, endCol: 0 },
      scrollBehavior: { type: 'none' },
    });

    const frozenRows = createTestViewport({
      id: 'frozen-rows',
      bounds: { x: frozenColWidth, y: 0, width: 700, height: frozenRowHeight },
      cellRange: { startRow: 0, startCol: 1, endRow: 1, endCol: 25 },
      scrollBehavior: { type: 'horizontal-only' },
    });

    const frozenCols = createTestViewport({
      id: 'frozen-cols',
      bounds: { x: 0, y: frozenRowHeight, width: frozenColWidth, height: 550 },
      cellRange: { startRow: 2, startCol: 0, endRow: 99, endCol: 0 },
      scrollBehavior: { type: 'vertical-only' },
    });

    const main = createTestViewport({
      id: 'main',
      bounds: { x: frozenColWidth, y: frozenRowHeight, width: 700, height: 550 },
      cellRange: { startRow: 2, startCol: 1, endRow: 99, endCol: 25 },
      scrollBehavior: { type: 'free' },
    });

    const layout = createTestLayout([corner, frozenRows, frozenCols, main]);

    // Test clicking in frozen corner
    const cornerHit = getViewportAtPoint(layout, { x: 50, y: 25 });
    expect(cornerHit?.id).toBe('frozen-corner');

    // Test clicking in frozen rows
    const rowsHit = getViewportAtPoint(layout, { x: 200, y: 25 });
    expect(rowsHit?.id).toBe('frozen-rows');

    // Test clicking in frozen cols
    const colsHit = getViewportAtPoint(layout, { x: 50, y: 100 });
    expect(colsHit?.id).toBe('frozen-cols');

    // Test clicking in main area
    const mainHit = getViewportAtPoint(layout, { x: 200, y: 100 });
    expect(mainHit?.id).toBe('main');
  });

  it('handles overlay viewport on top of main', () => {
    const main = createTestViewport({
      id: 'main',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });

    const aiPreview = createTestViewport({
      id: 'ai-preview',
      bounds: { x: 50, y: 50, width: 300, height: 200 },
      cellRange: { startRow: 10, startCol: 5, endRow: 20, endCol: 10 },
      renderConfig: {
        ...DEFAULT_VIEWPORT_RENDER_CONFIG,
        opacity: 0.9,
        border: { color: '#3b82f6', width: 2 },
      },
    });

    // AI preview is on top (added last)
    const layout = createTestLayout([main, aiPreview]);

    // Click inside overlay
    const overlayHit = getViewportAtPoint(layout, { x: 100, y: 100 });
    expect(overlayHit?.id).toBe('ai-preview');

    // Click outside overlay but inside main
    const mainHit = getViewportAtPoint(layout, { x: 400, y: 400 });
    expect(mainHit?.id).toBe('main');
  });
});
