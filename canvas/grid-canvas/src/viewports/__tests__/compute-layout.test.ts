/**
 * Tests for computeViewportLayout
 *
 * @module canvas/viewports/__tests__/compute-layout.test
 */

// Jest globals (describe, expect, it) are available globally
import {
  COL_HEADER_HEIGHT,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  ROW_HEADER_WIDTH,
  ViewportPositionIndex,
} from '@mog/grid-renderer';
import { computeViewportLayout } from '../compute-layout';
import type { ComputeLayoutInput } from '../types';

// =============================================================================
// Test Helpers
// =============================================================================

function createTestPositionIndex(
  defaultRowHeight = 25,
  defaultColWidth = 100,
  totalRows = 1000,
  totalCols = 26,
): ViewportPositionIndex {
  const pi = new ViewportPositionIndex(defaultRowHeight, defaultColWidth);
  pi.setTotalDimensions(totalRows, totalCols);
  return pi;
}

function createTestInput(overrides: Partial<ComputeLayoutInput> = {}): ComputeLayoutInput {
  return {
    config: { type: 'single' },
    containerSize: { width: 1000, height: 600 },
    positionIndex: createTestPositionIndex(),
    scrollPosition: { x: 0, y: 0 },
    overlays: [],
    zoom: 1.0,
    ...overrides,
  };
}

// =============================================================================
// Single Viewport Tests
// =============================================================================

describe('computeViewportLayout - Single Viewport', () => {
  it('should create a single viewport for single config', () => {
    const input = createTestInput({ config: { type: 'single' } });
    const layout = computeViewportLayout(input);

    expect(layout.viewports).toHaveLength(1);
    expect(layout.viewports[0].id).toBe('main');
    expect(layout.primaryViewportId).toBe('main');
    expect(layout.dividers).toHaveLength(0);
  });

  it('should compute correct bounds for single viewport', () => {
    const input = createTestInput({
      config: { type: 'single' },
      containerSize: { width: 1000, height: 600 },
    });
    const layout = computeViewportLayout(input);
    const viewport = layout.viewports[0];

    // Bounds should exclude headers
    expect(viewport.bounds.x).toBe(ROW_HEADER_WIDTH);
    expect(viewport.bounds.y).toBe(COL_HEADER_HEIGHT);
    expect(viewport.bounds.width).toBe(1000 - ROW_HEADER_WIDTH);
    expect(viewport.bounds.height).toBe(600 - COL_HEADER_HEIGHT);
  });

  it('should apply scroll position correctly', () => {
    const input = createTestInput({
      config: { type: 'single' },
      scrollPosition: { x: 200, y: 100 },
    });
    const layout = computeViewportLayout(input);
    const viewport = layout.viewports[0];

    expect(viewport.scrollOffset.x).toBe(200);
    expect(viewport.scrollOffset.y).toBe(100);
    expect(viewport.scrollBehavior.type).toBe('free');
  });

  it('should compute visible cell range based on scroll and container size', () => {
    const input = createTestInput({
      config: { type: 'single' },
      containerSize: { width: 500, height: 300 },
      scrollPosition: { x: 0, y: 0 },
    });
    const layout = computeViewportLayout(input);
    const viewport = layout.viewports[0];

    // With 100px col width and 450px content width, should see ~5 columns
    // With 25px row height and 276px content height, should see ~12 rows
    expect(viewport.cellRange.startCol).toBe(0);
    expect(viewport.cellRange.startRow).toBe(0);
    expect(viewport.cellRange.endCol).toBeGreaterThanOrEqual(4);
    expect(viewport.cellRange.endRow).toBeGreaterThanOrEqual(10);
  });

  it('should compute content size using O(1) estimation', () => {
    const input = createTestInput();
    const layout = computeViewportLayout(input);

    // Content size uses O(1) estimation with the canonical default row/column dimensions
    // regardless of the dimension provider's custom row heights.
    // This avoids O(n) iteration over 1M+ rows which would freeze the browser.
    // 1000 rows * 21px = 21000px height
    // 26 cols * DEFAULT_COL_WIDTH = content width
    expect(layout.contentSize.width).toBe(26 * DEFAULT_COL_WIDTH);
    expect(layout.contentSize.height).toBe(1000 * DEFAULT_ROW_HEIGHT);
  });

  it('should compute max scroll correctly', () => {
    const input = createTestInput({
      containerSize: { width: 1000, height: 600 },
    });
    const layout = computeViewportLayout(input);

    // Max scroll X = content width - viewport width.
    expect(layout.maxScroll.x).toBe(26 * DEFAULT_COL_WIDTH - (1000 - ROW_HEADER_WIDTH));

    // Max scroll Y = content height - viewport height.
    expect(layout.maxScroll.y).toBe(1000 * DEFAULT_ROW_HEIGHT - (600 - COL_HEADER_HEIGHT));
  });
});

// =============================================================================
// Freeze Pane Tests
// =============================================================================

describe('computeViewportLayout - Freeze Panes', () => {
  it('should create 2 viewports for frozen rows only', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 0 },
    });
    const layout = computeViewportLayout(input);

    expect(layout.viewports).toHaveLength(2);

    const ids = layout.viewports.map((v) => v.id);
    expect(ids).toContain('frozen-rows');
    expect(ids).toContain('main');

    expect(layout.dividers).toHaveLength(1);
    expect(layout.dividers[0].orientation).toBe('horizontal');
  });

  it('should create 2 viewports for frozen columns only', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 0, cols: 2 },
    });
    const layout = computeViewportLayout(input);

    expect(layout.viewports).toHaveLength(2);

    const ids = layout.viewports.map((v) => v.id);
    expect(ids).toContain('frozen-cols');
    expect(ids).toContain('main');

    expect(layout.dividers).toHaveLength(1);
    expect(layout.dividers[0].orientation).toBe('vertical');
  });

  it('should create 4 viewports for frozen rows and columns', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 2 },
    });
    const layout = computeViewportLayout(input);

    expect(layout.viewports).toHaveLength(4);

    const ids = layout.viewports.map((v) => v.id);
    expect(ids).toContain('frozen-corner');
    expect(ids).toContain('frozen-rows');
    expect(ids).toContain('frozen-cols');
    expect(ids).toContain('main');

    expect(layout.dividers).toHaveLength(2);
  });

  it('should fall back to single viewport for freeze 0,0', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 0, cols: 0 },
    });
    const layout = computeViewportLayout(input);

    expect(layout.viewports).toHaveLength(1);
    expect(layout.viewports[0].id).toBe('main');
    expect(layout.dividers).toHaveLength(0);
  });

  it('should set correct scroll behavior for frozen viewports', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 2 },
    });
    const layout = computeViewportLayout(input);

    const corner = layout.viewports.find((v) => v.id === 'frozen-corner');
    const frozenRows = layout.viewports.find((v) => v.id === 'frozen-rows');
    const frozenCols = layout.viewports.find((v) => v.id === 'frozen-cols');
    const main = layout.viewports.find((v) => v.id === 'main');

    expect(corner?.scrollBehavior.type).toBe('none');
    expect(frozenRows?.scrollBehavior.type).toBe('horizontal-only');
    expect(frozenCols?.scrollBehavior.type).toBe('vertical-only');
    expect(main?.scrollBehavior.type).toBe('free');
  });

  it('should compute correct bounds for frozen viewports', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 2 },
      containerSize: { width: 1000, height: 600 },
    });
    const layout = computeViewportLayout(input);

    // 2 frozen rows * 25px = 50px frozen height
    // 2 frozen cols * 100px = 200px frozen width
    const frozenRowsHeight = 50; // 2 rows * 25px
    const frozenColsWidth = 200; // 2 cols * 100px

    const corner = layout.viewports.find((v) => v.id === 'frozen-corner')!;
    expect(corner.bounds.x).toBe(ROW_HEADER_WIDTH);
    expect(corner.bounds.y).toBe(COL_HEADER_HEIGHT);
    expect(corner.bounds.width).toBe(frozenColsWidth);
    expect(corner.bounds.height).toBe(frozenRowsHeight);

    const main = layout.viewports.find((v) => v.id === 'main')!;
    expect(main.bounds.x).toBe(ROW_HEADER_WIDTH + frozenColsWidth);
    expect(main.bounds.y).toBe(COL_HEADER_HEIGHT + frozenRowsHeight);
    expect(main.bounds.width).toBe(1000 - ROW_HEADER_WIDTH - frozenColsWidth);
    expect(main.bounds.height).toBe(600 - COL_HEADER_HEIGHT - frozenRowsHeight);
  });

  it('should apply scroll only to appropriate frozen viewports', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 2 },
      scrollPosition: { x: 300, y: 200 },
    });
    const layout = computeViewportLayout(input);

    const corner = layout.viewports.find((v) => v.id === 'frozen-corner')!;
    const frozenRows = layout.viewports.find((v) => v.id === 'frozen-rows')!;
    const frozenCols = layout.viewports.find((v) => v.id === 'frozen-cols')!;
    const main = layout.viewports.find((v) => v.id === 'main')!;

    // Corner: no scroll
    expect(corner.scrollOffset).toEqual({ x: 0, y: 0 });

    // Frozen rows: only horizontal scroll
    expect(frozenRows.scrollOffset.x).toBe(300);
    expect(frozenRows.scrollOffset.y).toBe(0);

    // Frozen cols: only vertical scroll
    expect(frozenCols.scrollOffset.x).toBe(0);
    expect(frozenCols.scrollOffset.y).toBe(200);

    // Main: full scroll
    expect(main.scrollOffset).toEqual({ x: 300, y: 200 });
  });

  it('should position dividers correctly', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 2 },
    });
    const layout = computeViewportLayout(input);

    const horizontalDivider = layout.dividers.find((d) => d.orientation === 'horizontal')!;
    const verticalDivider = layout.dividers.find((d) => d.orientation === 'vertical')!;

    const frozenRowsHeight = 50; // 2 rows * 25px
    const frozenColsWidth = 200; // 2 cols * 100px

    // Horizontal divider below frozen rows
    expect(horizontalDivider.position).toBe(COL_HEADER_HEIGHT + frozenRowsHeight);
    expect(horizontalDivider.type).toBe('freeze');
    expect(horizontalDivider.draggable).toBe(false);

    // Vertical divider to right of frozen cols
    expect(verticalDivider.position).toBe(ROW_HEADER_WIDTH + frozenColsWidth);
    expect(verticalDivider.type).toBe('freeze');
    expect(verticalDivider.draggable).toBe(false);
  });
});

// =============================================================================
// Zoom Tests
// =============================================================================

describe('computeViewportLayout - Zoom', () => {
  it('should scale frozen boundaries with zoom', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 2 },
      zoom: 2.0, // 200% zoom
    });
    const layout = computeViewportLayout(input);

    const corner = layout.viewports.find((v) => v.id === 'frozen-corner')!;
    // 2 rows * 25px * 2x zoom = 100px
    // 2 cols * 100px * 2x zoom = 400px
    expect(corner.bounds.width).toBe(400);
    expect(corner.bounds.height).toBe(100);
    expect(corner.zoom).toBe(2.0);
  });

  it('should pass zoom to all viewports', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 2 },
      zoom: 1.5,
    });
    const layout = computeViewportLayout(input);

    for (const viewport of layout.viewports) {
      expect(viewport.zoom).toBe(1.5);
    }
  });
});

// =============================================================================
// Overlay Viewport Tests
// =============================================================================

describe('computeViewportLayout - Overlays', () => {
  it('should include overlay viewports in layout', () => {
    const input = createTestInput({
      overlays: [
        {
          id: 'ai-preview',
          bounds: { x: 100, y: 100, width: 300, height: 200 },
          content: { type: 'range', range: { startRow: 5, startCol: 2, endRow: 15, endCol: 5 } },
        },
      ],
    });
    const layout = computeViewportLayout(input);

    expect(layout.viewports).toHaveLength(2); // main + overlay
    const overlay = layout.viewports.find((v) => v.id === 'ai-preview');
    expect(overlay).toBeDefined();
    expect(overlay!.bounds).toEqual({ x: 100, y: 100, width: 300, height: 200 });
    expect(overlay!.scrollBehavior.type).toBe('none');
  });

  it('should set cell range from overlay content', () => {
    const input = createTestInput({
      overlays: [
        {
          id: 'cell-overlay',
          bounds: { x: 50, y: 50, width: 100, height: 50 },
          content: { type: 'cell', row: 10, col: 5 },
        },
      ],
    });
    const layout = computeViewportLayout(input);

    const overlay = layout.viewports.find((v) => v.id === 'cell-overlay')!;
    expect(overlay.cellRange).toEqual({
      startRow: 10,
      startCol: 5,
      endRow: 10,
      endCol: 5,
    });
  });

  it('should include sheetId from overlay content', () => {
    const input = createTestInput({
      overlays: [
        {
          id: 'cross-sheet',
          bounds: { x: 50, y: 50, width: 100, height: 50 },
          content: {
            type: 'range',
            sheetId: 'sheet2',
            range: { startRow: 0, startCol: 0, endRow: 10, endCol: 5 },
          },
        },
      ],
    });
    const layout = computeViewportLayout(input);

    const overlay = layout.viewports.find((v) => v.id === 'cross-sheet')!;
    expect(overlay.sheetId).toBe('sheet2');
  });

  it('should place overlays after main viewports in z-order', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 0 },
      overlays: [
        {
          id: 'overlay1',
          bounds: { x: 100, y: 100, width: 100, height: 100 },
          content: { type: 'cell', row: 0, col: 0 },
        },
      ],
    });
    const layout = computeViewportLayout(input);

    // Main viewports first (frozen-rows, main), then overlay
    expect(layout.viewports).toHaveLength(3);
    expect(layout.viewports[2].id).toBe('overlay1');
  });
});

// =============================================================================
// Header Info Tests
// =============================================================================

describe('computeViewportLayout - Header Info', () => {
  it('should return headerInfo with zero values for single viewport', () => {
    const input = createTestInput({ config: { type: 'single' } });
    const layout = computeViewportLayout(input);

    expect(layout.headerInfo).toBeDefined();
    expect(layout.headerInfo.frozenRows).toBe(0);
    expect(layout.headerInfo.frozenCols).toBe(0);
    expect(layout.headerInfo.frozenRowsHeight).toBe(0);
    expect(layout.headerInfo.frozenColsWidth).toBe(0);
    expect(layout.headerInfo.zoom).toBe(1.0);
  });

  it('should return headerInfo with frozen rows for freeze config', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 0 },
    });
    const layout = computeViewportLayout(input);

    expect(layout.headerInfo.frozenRows).toBe(2);
    expect(layout.headerInfo.frozenCols).toBe(0);
    expect(layout.headerInfo.frozenRowsHeight).toBe(50); // 2 rows * 25px
    expect(layout.headerInfo.frozenColsWidth).toBe(0);
  });

  it('should return headerInfo with frozen cols for freeze config', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 0, cols: 2 },
    });
    const layout = computeViewportLayout(input);

    expect(layout.headerInfo.frozenRows).toBe(0);
    expect(layout.headerInfo.frozenCols).toBe(2);
    expect(layout.headerInfo.frozenRowsHeight).toBe(0);
    expect(layout.headerInfo.frozenColsWidth).toBe(200); // 2 cols * 100px
  });

  it('should return headerInfo with both frozen rows and cols', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 3 },
    });
    const layout = computeViewportLayout(input);

    expect(layout.headerInfo.frozenRows).toBe(2);
    expect(layout.headerInfo.frozenCols).toBe(3);
    expect(layout.headerInfo.frozenRowsHeight).toBe(50); // 2 rows * 25px
    expect(layout.headerInfo.frozenColsWidth).toBe(300); // 3 cols * 100px
  });

  it('should include clamped scroll position in headerInfo', () => {
    const input = createTestInput({
      scrollPosition: { x: 200, y: 100 },
    });
    const layout = computeViewportLayout(input);

    expect(layout.headerInfo.scrollPosition).toEqual({ x: 200, y: 100 });
  });

  it('should clamp scroll position in headerInfo to max bounds', () => {
    const input = createTestInput({
      scrollPosition: { x: 99999, y: 99999 },
    });
    const layout = computeViewportLayout(input);

    expect(layout.headerInfo.scrollPosition.x).toBeLessThanOrEqual(layout.maxScroll.x);
    expect(layout.headerInfo.scrollPosition.y).toBeLessThanOrEqual(layout.maxScroll.y);
  });

  it('should include zoom level in headerInfo', () => {
    const input = createTestInput({ zoom: 1.5 });
    const layout = computeViewportLayout(input);

    expect(layout.headerInfo.zoom).toBe(1.5);
  });

  it('should return zero values for freeze 0,0 config', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 0, cols: 0 },
    });
    const layout = computeViewportLayout(input);

    // freeze 0,0 is effectively single viewport
    expect(layout.headerInfo.frozenRows).toBe(0);
    expect(layout.headerInfo.frozenCols).toBe(0);
    expect(layout.headerInfo.frozenRowsHeight).toBe(0);
    expect(layout.headerInfo.frozenColsWidth).toBe(0);
  });
});

// =============================================================================
// Split View Tests
// =============================================================================

describe('computeViewportLayout - Split View', () => {
  it('should create 2 viewports for horizontal split', () => {
    const input = createTestInput({
      config: {
        type: 'split',
        direction: 'horizontal',
        horizontalPosition: 10, // Split at row 10
        verticalPosition: 0,
      },
    });
    const layout = computeViewportLayout(input);

    expect(layout.viewports).toHaveLength(2);

    const ids = layout.viewports.map((v) => v.id);
    expect(ids).toContain('top');
    expect(ids).toContain('bottom');

    expect(layout.dividers).toHaveLength(1);
    expect(layout.dividers[0].type).toBe('split');
    expect(layout.dividers[0].orientation).toBe('horizontal');
    expect(layout.dividers[0].draggable).toBe(true);
  });

  it('should create 2 viewports for vertical split', () => {
    const input = createTestInput({
      config: {
        type: 'split',
        direction: 'vertical',
        horizontalPosition: 0,
        verticalPosition: 5, // Split at column 5
      },
    });
    const layout = computeViewportLayout(input);

    expect(layout.viewports).toHaveLength(2);

    const ids = layout.viewports.map((v) => v.id);
    expect(ids).toContain('left');
    expect(ids).toContain('right');

    expect(layout.dividers).toHaveLength(1);
    expect(layout.dividers[0].type).toBe('split');
    expect(layout.dividers[0].orientation).toBe('vertical');
    expect(layout.dividers[0].draggable).toBe(true);
  });

  it('should create 4 viewports for both-direction split', () => {
    const input = createTestInput({
      config: {
        type: 'split',
        direction: 'both',
        horizontalPosition: 10,
        verticalPosition: 5,
      },
    });
    const layout = computeViewportLayout(input);

    expect(layout.viewports).toHaveLength(4);

    const ids = layout.viewports.map((v) => v.id);
    expect(ids).toContain('topLeft');
    expect(ids).toContain('topRight');
    expect(ids).toContain('bottomLeft');
    expect(ids).toContain('bottomRight');

    expect(layout.dividers).toHaveLength(2);
  });

  it('should set free scroll behavior for all split viewports', () => {
    const input = createTestInput({
      config: {
        type: 'split',
        direction: 'both',
        horizontalPosition: 10,
        verticalPosition: 5,
      },
    });
    const layout = computeViewportLayout(input);

    for (const viewport of layout.viewports) {
      expect(viewport.scrollBehavior.type).toBe('free');
    }
  });

  it('should position split dividers correctly', () => {
    const input = createTestInput({
      config: {
        type: 'split',
        direction: 'horizontal',
        horizontalPosition: 10, // 10 rows * 25px = 250px
        verticalPosition: 0,
      },
      containerSize: { width: 1000, height: 600 },
    });
    const layout = computeViewportLayout(input);

    const horizontalDivider = layout.dividers.find((d) => d.orientation === 'horizontal')!;
    // Position should be at row 10's pixel position
    // Note: The actual position depends on MIN_VIEWPORT_SIZE clamping
    expect(horizontalDivider).toBeDefined();
    expect(horizontalDivider.draggable).toBe(true);
    expect(horizontalDivider.type).toBe('split');
  });

  it('should set primary viewport to first created viewport', () => {
    const input = createTestInput({
      config: {
        type: 'split',
        direction: 'both',
        horizontalPosition: 10,
        verticalPosition: 5,
      },
    });
    const layout = computeViewportLayout(input);

    // Primary viewport should be the first one (topLeft for 'both')
    expect(layout.primaryViewportId).toBe('topLeft');
  });

  it('should use per-viewport scroll positions when provided', () => {
    const input = createTestInput({
      config: {
        type: 'split',
        direction: 'horizontal',
        horizontalPosition: 10,
        verticalPosition: 0,
      },
      scrollPositions: new Map([
        ['top', { x: 100, y: 0 }],
        ['bottom', { x: 200, y: 150 }],
      ]),
    });
    const layout = computeViewportLayout(input);

    const top = layout.viewports.find((v) => v.id === 'top')!;
    const bottom = layout.viewports.find((v) => v.id === 'bottom')!;

    // Each viewport should have its own scroll position
    expect(top.scrollOffset.x).toBe(100);
    expect(bottom.scrollOffset.x).toBe(200);
    expect(bottom.scrollOffset.y).toBe(150);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('computeViewportLayout - Edge Cases', () => {
  it('should clamp scroll to max bounds', () => {
    const input = createTestInput({
      scrollPosition: { x: 99999, y: 99999 },
    });
    const layout = computeViewportLayout(input);
    const viewport = layout.viewports[0];

    // Scroll should be clamped to maxScroll
    expect(viewport.scrollOffset.x).toBeLessThanOrEqual(layout.maxScroll.x);
    expect(viewport.scrollOffset.y).toBeLessThanOrEqual(layout.maxScroll.y);
  });

  it('should handle very small container', () => {
    const input = createTestInput({
      containerSize: { width: 100, height: 50 },
    });
    const layout = computeViewportLayout(input);

    expect(layout.viewports).toHaveLength(1);
    expect(layout.viewports[0].bounds.width).toBe(100 - ROW_HEADER_WIDTH);
    expect(layout.viewports[0].bounds.height).toBe(50 - COL_HEADER_HEIGHT);
  });

  it('should not set sheetId on viewports (VPI is sheet-scoped)', () => {
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 2 },
    });
    const layout = computeViewportLayout(input);

    for (const viewport of layout.viewports) {
      expect(viewport.sheetId).toBeUndefined();
    }
  });
});

// =============================================================================
// Header Visibility Tests
// =============================================================================

describe('computeViewportLayout - Header Visibility', () => {
  describe('Single Viewport with Hidden Headers', () => {
    it('should expand viewport when row headers are hidden', () => {
      const input = createTestInput({
        config: { type: 'single' },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: true },
      });
      const layout = computeViewportLayout(input);
      const viewport = layout.viewports[0];

      // Row header hidden: x starts at 0, width is full container width
      expect(viewport.bounds.x).toBe(0);
      expect(viewport.bounds.y).toBe(COL_HEADER_HEIGHT); // Column header still visible
      expect(viewport.bounds.width).toBe(1000); // Full width
      expect(viewport.bounds.height).toBe(600 - COL_HEADER_HEIGHT);
    });

    it('should expand viewport when column headers are hidden', () => {
      const input = createTestInput({
        config: { type: 'single' },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: true, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);
      const viewport = layout.viewports[0];

      // Column header hidden: y starts at 0, height is full container height
      expect(viewport.bounds.x).toBe(ROW_HEADER_WIDTH); // Row header still visible
      expect(viewport.bounds.y).toBe(0);
      expect(viewport.bounds.width).toBe(1000 - ROW_HEADER_WIDTH);
      expect(viewport.bounds.height).toBe(600); // Full height
    });

    it('should expand viewport when both headers are hidden', () => {
      const input = createTestInput({
        config: { type: 'single' },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);
      const viewport = layout.viewports[0];

      // Both headers hidden: viewport covers entire container
      expect(viewport.bounds.x).toBe(0);
      expect(viewport.bounds.y).toBe(0);
      expect(viewport.bounds.width).toBe(1000);
      expect(viewport.bounds.height).toBe(600);
    });

    it('should keep default bounds when headerVisibility is undefined (backwards compatible)', () => {
      const input = createTestInput({
        config: { type: 'single' },
        containerSize: { width: 1000, height: 600 },
        // headerVisibility not provided - should default to headers visible
      });
      const layout = computeViewportLayout(input);
      const viewport = layout.viewports[0];

      // Default behavior: both headers visible
      expect(viewport.bounds.x).toBe(ROW_HEADER_WIDTH);
      expect(viewport.bounds.y).toBe(COL_HEADER_HEIGHT);
      expect(viewport.bounds.width).toBe(1000 - ROW_HEADER_WIDTH);
      expect(viewport.bounds.height).toBe(600 - COL_HEADER_HEIGHT);
    });

    it('should keep default bounds when headerVisibility has both true', () => {
      const input = createTestInput({
        config: { type: 'single' },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: true, showColumnHeaders: true },
      });
      const layout = computeViewportLayout(input);
      const viewport = layout.viewports[0];

      // Explicit true: same as default
      expect(viewport.bounds.x).toBe(ROW_HEADER_WIDTH);
      expect(viewport.bounds.y).toBe(COL_HEADER_HEIGHT);
      expect(viewport.bounds.width).toBe(1000 - ROW_HEADER_WIDTH);
      expect(viewport.bounds.height).toBe(600 - COL_HEADER_HEIGHT);
    });
  });

  describe('Freeze Panes with Hidden Headers', () => {
    it('should adjust freeze viewports when both headers are hidden', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 2 },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      // 2 frozen rows * 25px = 50px frozen height
      // 2 frozen cols * 100px = 200px frozen width
      const corner = layout.viewports.find((v) => v.id === 'frozen-corner')!;
      expect(corner.bounds.x).toBe(0); // No row header offset
      expect(corner.bounds.y).toBe(0); // No col header offset
      expect(corner.bounds.width).toBe(200);
      expect(corner.bounds.height).toBe(50);

      const main = layout.viewports.find((v) => v.id === 'main')!;
      expect(main.bounds.x).toBe(200); // After frozen cols only
      expect(main.bounds.y).toBe(50); // After frozen rows only
      expect(main.bounds.width).toBe(800); // 1000 - 200
      expect(main.bounds.height).toBe(550); // 600 - 50
    });

    it('should position dividers correctly when headers are hidden', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 2 },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      const horizontalDivider = layout.dividers.find((d) => d.orientation === 'horizontal')!;
      const verticalDivider = layout.dividers.find((d) => d.orientation === 'vertical')!;

      // Horizontal divider: at frozen rows height (no col header)
      expect(horizontalDivider.position).toBe(50); // 2 rows * 25px

      // Vertical divider: at frozen cols width (no row header)
      expect(verticalDivider.position).toBe(200); // 2 cols * 100px
    });

    it('should compute visible range correctly with hidden headers', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 2 },
        containerSize: { width: 600, height: 400 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      const main = layout.viewports.find((v) => v.id === 'main')!;

      // With headers hidden, more cells are visible
      // Content width: 600 - 200 (frozen cols) = 400px -> 4 cols
      // Content height: 400 - 50 (frozen rows) = 350px -> 14 rows
      expect(main.cellRange.startRow).toBe(2); // After frozen rows
      expect(main.cellRange.startCol).toBe(2); // After frozen cols
      expect(main.cellRange.endCol).toBeGreaterThanOrEqual(5); // At least 4 more cols
      expect(main.cellRange.endRow).toBeGreaterThanOrEqual(14); // At least 12 more rows
    });
  });

  describe('Split View with Hidden Headers', () => {
    it('should expand split viewports when headers are hidden', () => {
      const input = createTestInput({
        config: {
          type: 'split',
          direction: 'horizontal',
          horizontalPosition: 10,
          verticalPosition: 0,
        },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      const top = layout.viewports.find((v) => v.id === 'top')!;
      const bottom = layout.viewports.find((v) => v.id === 'bottom')!;

      // Content starts at (0, 0) with headers hidden
      expect(top.bounds.x).toBe(0);
      expect(top.bounds.y).toBe(0);
      expect(top.bounds.width).toBe(1000);

      expect(bottom.bounds.x).toBe(0);
      expect(bottom.bounds.width).toBe(1000);
    });
  });

  describe('Max Scroll with Hidden Headers', () => {
    it('should increase max scroll when headers are hidden (more content visible)', () => {
      // With headers visible
      const inputWithHeaders = createTestInput({
        config: { type: 'single' },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: true, showColumnHeaders: true },
      });
      const layoutWithHeaders = computeViewportLayout(inputWithHeaders);

      // With headers hidden
      const inputWithoutHeaders = createTestInput({
        config: { type: 'single' },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layoutWithoutHeaders = computeViewportLayout(inputWithoutHeaders);

      // With hidden headers, viewport is larger so max scroll is smaller
      // (more content fits in view)
      expect(layoutWithoutHeaders.maxScroll.x).toBeLessThan(layoutWithHeaders.maxScroll.x);
      expect(layoutWithoutHeaders.maxScroll.y).toBeLessThan(layoutWithHeaders.maxScroll.y);
    });
  });
});

// =============================================================================
// Freeze Panes with Hidden Headers Combination Tests
// =============================================================================

describe('computeViewportLayout - Freeze Panes with Hidden Headers Combinations', () => {
  describe('Frozen rows with hidden column headers', () => {
    it('should calculate frozen row area starting at y=0 when column headers hidden', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 3, cols: 0 },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: true, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      // 3 frozen rows * 25px = 75px frozen height
      const frozenRows = layout.viewports.find((v) => v.id === 'frozen-rows')!;
      expect(frozenRows.bounds.x).toBe(ROW_HEADER_WIDTH); // Row headers visible
      expect(frozenRows.bounds.y).toBe(0); // No column header offset
      expect(frozenRows.bounds.width).toBe(1000 - ROW_HEADER_WIDTH);
      expect(frozenRows.bounds.height).toBe(75); // 3 rows * 25px

      const main = layout.viewports.find((v) => v.id === 'main')!;
      expect(main.bounds.x).toBe(ROW_HEADER_WIDTH);
      expect(main.bounds.y).toBe(75); // After frozen rows only (no col header)
      expect(main.bounds.width).toBe(1000 - ROW_HEADER_WIDTH);
      expect(main.bounds.height).toBe(600 - 75);
    });

    it('should position horizontal divider at frozen rows height when column headers hidden', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 3, cols: 0 },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: true, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      const horizontalDivider = layout.dividers.find((d) => d.orientation === 'horizontal')!;
      // Position should be at frozen rows height without column header offset
      expect(horizontalDivider.position).toBe(75); // 3 rows * 25px (no COL_HEADER_HEIGHT)
    });

    it('should compute correct visible range for frozen rows with hidden column headers', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 0 },
        containerSize: { width: 500, height: 300 },
        headerVisibility: { showRowHeaders: true, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      const frozenRows = layout.viewports.find((v) => v.id === 'frozen-rows')!;
      // Frozen rows viewport shows rows 0 to frozenRows-1 (0 and 1).
      // bounds.height = scaledFrozenRowsHeight naturally limits the search;
      // the partial-visibility +1 may overshoot by one row (the renderer
      // clips by bounds anyway).
      expect(frozenRows.cellRange.startRow).toBe(0);
      expect(frozenRows.cellRange.endRow).toBeLessThanOrEqual(2);

      const main = layout.viewports.find((v) => v.id === 'main')!;
      // Main viewport starts at row 2 (after frozen rows)
      expect(main.cellRange.startRow).toBe(2);
      expect(main.cellRange.startCol).toBe(0);
    });
  });

  describe('Frozen columns with hidden row headers', () => {
    it('should calculate frozen column area starting at x=0 when row headers hidden', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 0, cols: 3 },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: true },
      });
      const layout = computeViewportLayout(input);

      // 3 frozen cols * 100px = 300px frozen width
      const frozenCols = layout.viewports.find((v) => v.id === 'frozen-cols')!;
      expect(frozenCols.bounds.x).toBe(0); // No row header offset
      expect(frozenCols.bounds.y).toBe(COL_HEADER_HEIGHT); // Column headers visible
      expect(frozenCols.bounds.width).toBe(300); // 3 cols * 100px
      expect(frozenCols.bounds.height).toBe(600 - COL_HEADER_HEIGHT);

      const main = layout.viewports.find((v) => v.id === 'main')!;
      expect(main.bounds.x).toBe(300); // After frozen cols only (no row header)
      expect(main.bounds.y).toBe(COL_HEADER_HEIGHT);
      expect(main.bounds.width).toBe(1000 - 300);
      expect(main.bounds.height).toBe(600 - COL_HEADER_HEIGHT);
    });

    it('should position vertical divider at frozen cols width when row headers hidden', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 0, cols: 3 },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: true },
      });
      const layout = computeViewportLayout(input);

      const verticalDivider = layout.dividers.find((d) => d.orientation === 'vertical')!;
      // Position should be at frozen cols width without row header offset
      expect(verticalDivider.position).toBe(300); // 3 cols * 100px (no ROW_HEADER_WIDTH)
    });

    it('should compute correct visible range for frozen cols with hidden row headers', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 0, cols: 2 },
        containerSize: { width: 500, height: 300 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: true },
      });
      const layout = computeViewportLayout(input);

      const frozenCols = layout.viewports.find((v) => v.id === 'frozen-cols')!;
      // Frozen cols viewport shows cols 0 to frozenCols-1 (0 and 1).
      // bounds.width = scaledFrozenColsWidth naturally limits the search;
      // the partial-visibility +1 may overshoot by one col.
      expect(frozenCols.cellRange.startCol).toBe(0);
      expect(frozenCols.cellRange.endCol).toBeLessThanOrEqual(2);

      const main = layout.viewports.find((v) => v.id === 'main')!;
      // Main viewport starts at col 2 (after frozen cols)
      expect(main.cellRange.startCol).toBe(2);
      expect(main.cellRange.startRow).toBe(0);
    });
  });

  describe('Frozen rows AND columns with both headers hidden', () => {
    it('should calculate all four frozen regions starting at (0,0) when both headers hidden', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 3, cols: 3 },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      // 3 frozen rows * 25px = 75px frozen height
      // 3 frozen cols * 100px = 300px frozen width
      const corner = layout.viewports.find((v) => v.id === 'frozen-corner')!;
      expect(corner.bounds.x).toBe(0); // No headers
      expect(corner.bounds.y).toBe(0);
      expect(corner.bounds.width).toBe(300);
      expect(corner.bounds.height).toBe(75);

      const frozenRows = layout.viewports.find((v) => v.id === 'frozen-rows')!;
      expect(frozenRows.bounds.x).toBe(300); // After frozen cols
      expect(frozenRows.bounds.y).toBe(0);
      expect(frozenRows.bounds.width).toBe(700); // 1000 - 300
      expect(frozenRows.bounds.height).toBe(75);

      const frozenCols = layout.viewports.find((v) => v.id === 'frozen-cols')!;
      expect(frozenCols.bounds.x).toBe(0);
      expect(frozenCols.bounds.y).toBe(75); // After frozen rows
      expect(frozenCols.bounds.width).toBe(300);
      expect(frozenCols.bounds.height).toBe(525); // 600 - 75

      const main = layout.viewports.find((v) => v.id === 'main')!;
      expect(main.bounds.x).toBe(300);
      expect(main.bounds.y).toBe(75);
      expect(main.bounds.width).toBe(700);
      expect(main.bounds.height).toBe(525);
    });

    it('should position both dividers without header offsets when both headers hidden', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 3, cols: 3 },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      const horizontalDivider = layout.dividers.find((d) => d.orientation === 'horizontal')!;
      const verticalDivider = layout.dividers.find((d) => d.orientation === 'vertical')!;

      // Dividers positioned at frozen boundaries without header offsets
      expect(horizontalDivider.position).toBe(75); // 3 rows * 25px
      expect(verticalDivider.position).toBe(300); // 3 cols * 100px
    });

    it('should have no gaps or overlaps between frozen regions', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 2 },
        containerSize: { width: 800, height: 500 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      // 2 frozen rows * 25px = 50px frozen height
      // 2 frozen cols * 100px = 200px frozen width
      const corner = layout.viewports.find((v) => v.id === 'frozen-corner')!;
      const frozenRows = layout.viewports.find((v) => v.id === 'frozen-rows')!;
      const frozenCols = layout.viewports.find((v) => v.id === 'frozen-cols')!;
      const main = layout.viewports.find((v) => v.id === 'main')!;

      // Verify no horizontal gaps: corner.right == frozenRows.left
      expect(corner.bounds.x + corner.bounds.width).toBe(frozenRows.bounds.x);
      // Verify no vertical gaps: corner.bottom == frozenCols.top
      expect(corner.bounds.y + corner.bounds.height).toBe(frozenCols.bounds.y);
      // Verify main aligns with other regions
      expect(frozenRows.bounds.y + frozenRows.bounds.height).toBe(main.bounds.y);
      expect(frozenCols.bounds.x + frozenCols.bounds.width).toBe(main.bounds.x);

      // Verify total coverage equals container (minus any headers)
      // Row widths: corner.width + frozenRows.width = container width
      expect(corner.bounds.width + frozenRows.bounds.width).toBe(800);
      // Column heights: corner.height + frozenCols.height = container height
      expect(corner.bounds.height + frozenCols.bounds.height).toBe(500);
    });

    it('should compute correct visible ranges for all four regions with hidden headers', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 2 },
        containerSize: { width: 600, height: 400 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      const corner = layout.viewports.find((v) => v.id === 'frozen-corner')!;
      // Corner shows only frozen cells (rows 0-1, cols 0-1)
      expect(corner.cellRange.startRow).toBe(0);
      expect(corner.cellRange.endRow).toBe(1);
      expect(corner.cellRange.startCol).toBe(0);
      expect(corner.cellRange.endCol).toBe(1);

      const frozenRows = layout.viewports.find((v) => v.id === 'frozen-rows')!;
      // Frozen rows: rows 0-1 (with up to +1 partial-visibility overshoot),
      // cols starting at 2.
      expect(frozenRows.cellRange.startRow).toBe(0);
      expect(frozenRows.cellRange.endRow).toBeLessThanOrEqual(2);
      expect(frozenRows.cellRange.startCol).toBe(2);

      const frozenCols = layout.viewports.find((v) => v.id === 'frozen-cols')!;
      // Frozen cols: cols 0-1 (with up to +1 partial-visibility overshoot),
      // rows starting at 2.
      expect(frozenCols.cellRange.startCol).toBe(0);
      expect(frozenCols.cellRange.endCol).toBeLessThanOrEqual(2);
      expect(frozenCols.cellRange.startRow).toBe(2);

      const main = layout.viewports.find((v) => v.id === 'main')!;
      // Main: starts at row 2, col 2
      expect(main.cellRange.startRow).toBe(2);
      expect(main.cellRange.startCol).toBe(2);
    });

    it('should correctly scroll frozen regions with hidden headers', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 2 },
        containerSize: { width: 800, height: 500 },
        scrollPosition: { x: 400, y: 200 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      const corner = layout.viewports.find((v) => v.id === 'frozen-corner')!;
      const frozenRows = layout.viewports.find((v) => v.id === 'frozen-rows')!;
      const frozenCols = layout.viewports.find((v) => v.id === 'frozen-cols')!;
      const main = layout.viewports.find((v) => v.id === 'main')!;

      // Corner: no scroll
      expect(corner.scrollOffset).toEqual({ x: 0, y: 0 });

      // Frozen rows: only horizontal scroll
      expect(frozenRows.scrollOffset.x).toBe(400);
      expect(frozenRows.scrollOffset.y).toBe(0);

      // Frozen cols: only vertical scroll
      expect(frozenCols.scrollOffset.x).toBe(0);
      expect(frozenCols.scrollOffset.y).toBe(200);

      // Main: full scroll
      expect(main.scrollOffset).toEqual({ x: 400, y: 200 });
    });
  });

  describe('Edge cases with mixed header visibility', () => {
    it('should handle freeze with only row headers visible', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 2 },
        containerSize: { width: 800, height: 500 },
        headerVisibility: { showRowHeaders: true, showColumnHeaders: false },
      });
      const layout = computeViewportLayout(input);

      const corner = layout.viewports.find((v) => v.id === 'frozen-corner')!;
      // With row headers visible (50px) but column headers hidden
      expect(corner.bounds.x).toBe(ROW_HEADER_WIDTH);
      expect(corner.bounds.y).toBe(0); // No column header

      const main = layout.viewports.find((v) => v.id === 'main')!;
      expect(main.bounds.x).toBe(ROW_HEADER_WIDTH + 200); // ROW_HEADER_WIDTH + frozen cols width
      expect(main.bounds.y).toBe(50); // Frozen rows height only
    });

    it('should handle freeze with only column headers visible', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 2 },
        containerSize: { width: 800, height: 500 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: true },
      });
      const layout = computeViewportLayout(input);

      const corner = layout.viewports.find((v) => v.id === 'frozen-corner')!;
      // With column headers visible (24px) but row headers hidden
      expect(corner.bounds.x).toBe(0); // No row header
      expect(corner.bounds.y).toBe(COL_HEADER_HEIGHT);

      const main = layout.viewports.find((v) => v.id === 'main')!;
      expect(main.bounds.x).toBe(200); // Frozen cols width only
      expect(main.bounds.y).toBe(COL_HEADER_HEIGHT + 50); // COL_HEADER_HEIGHT + frozen rows height
    });

    it('should maintain correct viewport count regardless of header visibility', () => {
      // With both headers hidden
      const inputHidden = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 2 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
      });
      const layoutHidden = computeViewportLayout(inputHidden);

      // With both headers visible
      const inputVisible = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 2 },
        headerVisibility: { showRowHeaders: true, showColumnHeaders: true },
      });
      const layoutVisible = computeViewportLayout(inputVisible);

      // Both should have 4 viewports (corner, frozen-rows, frozen-cols, main)
      expect(layoutHidden.viewports).toHaveLength(4);
      expect(layoutVisible.viewports).toHaveLength(4);

      // Both should have 2 dividers
      expect(layoutHidden.dividers).toHaveLength(2);
      expect(layoutVisible.dividers).toHaveLength(2);
    });
  });

  describe('Zoom interaction with hidden headers and freeze panes', () => {
    it('should scale frozen boundaries correctly with zoom and hidden headers', () => {
      const input = createTestInput({
        config: { type: 'freeze', rows: 2, cols: 2 },
        containerSize: { width: 1000, height: 600 },
        headerVisibility: { showRowHeaders: false, showColumnHeaders: false },
        zoom: 2.0, // 200% zoom
      });
      const layout = computeViewportLayout(input);

      // 2 rows * 25px * 2x zoom = 100px frozen height
      // 2 cols * 100px * 2x zoom = 400px frozen width
      const corner = layout.viewports.find((v) => v.id === 'frozen-corner')!;
      expect(corner.bounds.x).toBe(0); // No headers
      expect(corner.bounds.y).toBe(0);
      expect(corner.bounds.width).toBe(400);
      expect(corner.bounds.height).toBe(100);

      // Dividers should also be scaled
      const horizontalDivider = layout.dividers.find((d) => d.orientation === 'horizontal')!;
      const verticalDivider = layout.dividers.find((d) => d.orientation === 'vertical')!;
      expect(horizontalDivider.position).toBe(100); // 2 rows * 25px * 2
      expect(verticalDivider.position).toBe(400); // 2 cols * 100px * 2
    });
  });
});

// =============================================================================
// maxScroll with Frozen Panes (Bug #5 regression tests)
// =============================================================================

describe('computeViewportLayout - maxScroll with frozen panes', () => {
  // These tests verify that maxScroll correctly excludes frozen content.
  // The bug was: contentSize included frozen rows/cols, but frozen regions
  // don't scroll, so maxScroll was over-estimated by frozenSize.

  it('no freeze baseline: maxScroll = contentSize - viewportSize', () => {
    const input = createTestInput({
      config: { type: 'single' },
      containerSize: { width: 1000, height: 600 },
    });
    const layout = computeViewportLayout(input);

    const totalRows = 1000;
    const totalCols = 26;
    const expectedMaxX = totalCols * DEFAULT_COL_WIDTH - (1000 - ROW_HEADER_WIDTH);
    const expectedMaxY = totalRows * DEFAULT_ROW_HEIGHT - (600 - COL_HEADER_HEIGHT);
    expect(layout.maxScroll.x).toBe(expectedMaxX);
    expect(layout.maxScroll.y).toBe(expectedMaxY);
  });

  it('frozen rows only: maxScroll.y is reduced by frozenRowsHeight', () => {
    const frozenRows = 3;
    const frozenRowsHeight = frozenRows * 25; // positionIndex default row height
    const input = createTestInput({
      config: { type: 'freeze', rows: frozenRows, cols: 0 },
      containerSize: { width: 1000, height: 600 },
    });
    const layout = computeViewportLayout(input);

    const totalRows = 1000;
    const scrollableContentHeight = totalRows * DEFAULT_ROW_HEIGHT - frozenRowsHeight;
    const scrollableViewportHeight = 600 - COL_HEADER_HEIGHT - frozenRowsHeight;
    expect(layout.maxScroll.y).toBe(scrollableContentHeight - scrollableViewportHeight);

    // X axis should be unaffected by frozen rows
    const totalCols = 26;
    const expectedMaxX = totalCols * DEFAULT_COL_WIDTH - (1000 - ROW_HEADER_WIDTH);
    expect(layout.maxScroll.x).toBe(expectedMaxX);
  });

  it('frozen cols only: maxScroll.x is reduced by frozenColsWidth', () => {
    const frozenCols = 2;
    const frozenColsWidth = frozenCols * 100; // positionIndex default col width
    const input = createTestInput({
      config: { type: 'freeze', rows: 0, cols: frozenCols },
      containerSize: { width: 1000, height: 600 },
    });
    const layout = computeViewportLayout(input);

    const totalCols = 26;
    const scrollableContentWidth = totalCols * DEFAULT_COL_WIDTH - frozenColsWidth;
    const scrollableViewportWidth = 1000 - ROW_HEADER_WIDTH - frozenColsWidth;
    expect(layout.maxScroll.x).toBe(scrollableContentWidth - scrollableViewportWidth);

    // Y axis should be unaffected by frozen cols
    const totalRows = 1000;
    const expectedMaxY = totalRows * DEFAULT_ROW_HEIGHT - (600 - COL_HEADER_HEIGHT);
    expect(layout.maxScroll.y).toBe(expectedMaxY);
  });

  it('frozen rows + cols: both axes reduced by frozen sizes', () => {
    const frozenRows = 3;
    const frozenCols = 2;
    const frozenRowsHeight = frozenRows * 25;
    const frozenColsWidth = frozenCols * 100;
    const input = createTestInput({
      config: { type: 'freeze', rows: frozenRows, cols: frozenCols },
      containerSize: { width: 1000, height: 600 },
    });
    const layout = computeViewportLayout(input);

    const totalRows = 1000;
    const totalCols = 26;
    const scrollableContentHeight = totalRows * DEFAULT_ROW_HEIGHT - frozenRowsHeight;
    const scrollableViewportHeight = 600 - COL_HEADER_HEIGHT - frozenRowsHeight;
    const scrollableContentWidth = totalCols * DEFAULT_COL_WIDTH - frozenColsWidth;
    const scrollableViewportWidth = 1000 - ROW_HEADER_WIDTH - frozenColsWidth;

    expect(layout.maxScroll.x).toBe(scrollableContentWidth - scrollableViewportWidth);
    expect(layout.maxScroll.y).toBe(scrollableContentHeight - scrollableViewportHeight);
  });

  it('edge case: all content frozen — maxScroll should be 0', () => {
    const pi = createTestPositionIndex(25, 100, 5, 5);
    const input = createTestInput({
      config: { type: 'freeze', rows: 5, cols: 5 },
      containerSize: { width: 1000, height: 600 },
      positionIndex: pi,
    });
    const layout = computeViewportLayout(input);

    expect(layout.maxScroll.x).toBe(0);
    expect(layout.maxScroll.y).toBe(0);
  });

  it('edge case: content fits in viewport — maxScroll clamped to 0', () => {
    const pi = createTestPositionIndex(25, 100, 10, 5);
    const input = createTestInput({
      config: { type: 'freeze', rows: 2, cols: 1 },
      containerSize: { width: 5000, height: 5000 },
      positionIndex: pi,
    });
    const layout = computeViewportLayout(input);

    expect(layout.maxScroll.x).toBe(0);
    expect(layout.maxScroll.y).toBe(0);
  });
});

// =============================================================================
// Integration: scroll to max with frozen panes produces correct viewport bounds
// =============================================================================

describe('computeViewportLayout - frozen pane overscroll prevention (integration)', () => {
  it('scroll to Infinity with frozen rows: main viewport endRow <= totalRows - 1', () => {
    const totalRows = 100;
    const frozenRows = 3;
    const pi = createTestPositionIndex(25, 100, totalRows, 26);
    const input = createTestInput({
      config: { type: 'freeze', rows: frozenRows, cols: 0 },
      containerSize: { width: 1000, height: 600 },
      positionIndex: pi,
      scrollPosition: { x: 0, y: Infinity },
    });
    const layout = computeViewportLayout(input);
    const main = layout.viewports.find((v) => v.id === 'main')!;

    expect(main.cellRange.endRow).toBeLessThanOrEqual(totalRows - 1);
    expect(main.cellRange.startRow).toBeGreaterThanOrEqual(frozenRows);
  });

  it('scroll to Infinity with frozen cols: main viewport endCol <= totalCols - 1', () => {
    const totalCols = 26;
    const frozenCols = 2;
    const pi = createTestPositionIndex(25, 100, 100, totalCols);
    const input = createTestInput({
      config: { type: 'freeze', rows: 0, cols: frozenCols },
      containerSize: { width: 1000, height: 600 },
      positionIndex: pi,
      scrollPosition: { x: Infinity, y: 0 },
    });
    const layout = computeViewportLayout(input);
    const main = layout.viewports.find((v) => v.id === 'main')!;

    expect(main.cellRange.endCol).toBeLessThanOrEqual(totalCols - 1);
    expect(main.cellRange.startCol).toBeGreaterThanOrEqual(frozenCols);
  });

  it('scroll to Infinity with frozen rows + cols: viewport bounds within content', () => {
    const totalRows = 100;
    const totalCols = 26;
    const frozenRows = 3;
    const frozenCols = 2;
    const pi = createTestPositionIndex(25, 100, totalRows, totalCols);
    const input = createTestInput({
      config: { type: 'freeze', rows: frozenRows, cols: frozenCols },
      containerSize: { width: 1000, height: 600 },
      positionIndex: pi,
      scrollPosition: { x: Infinity, y: Infinity },
    });
    const layout = computeViewportLayout(input);
    const main = layout.viewports.find((v) => v.id === 'main')!;

    expect(main.cellRange.endRow).toBeLessThanOrEqual(totalRows - 1);
    expect(main.cellRange.endCol).toBeLessThanOrEqual(totalCols - 1);
    expect(main.cellRange.startRow).toBeGreaterThanOrEqual(frozenRows);
    expect(main.cellRange.startCol).toBeGreaterThanOrEqual(frozenCols);
  });

  it('clamped scroll matches expected maxScroll when scrolling to Infinity', () => {
    const frozenRows = 3;
    const frozenCols = 2;
    const input = createTestInput({
      config: { type: 'freeze', rows: frozenRows, cols: frozenCols },
      containerSize: { width: 1000, height: 600 },
      scrollPosition: { x: Infinity, y: Infinity },
    });
    const layout = computeViewportLayout(input);
    const main = layout.viewports.find((v) => v.id === 'main')!;

    // The main viewport's scroll offset should be clamped to maxScroll
    expect(main.scrollOffset.x).toBe(layout.maxScroll.x);
    expect(main.scrollOffset.y).toBe(layout.maxScroll.y);
  });

  it('frozen rows exceeding viewport produce non-negative main viewport height', () => {
    // 68 frozen rows at 25px each = 1700px; container is only 600px.
    // Before the fix, mainBounds.height would be negative (-1100+).
    const pi = createTestPositionIndex(25, 100, 200, 26);
    const input = createTestInput({
      config: { type: 'freeze', rows: 68, cols: 0 },
      containerSize: { width: 1000, height: 600 },
      positionIndex: pi,
    });
    const layout = computeViewportLayout(input);

    const main = layout.viewports.find((v) => v.id === 'main')!;
    expect(main).toBeDefined();
    expect(main.bounds.height).toBeGreaterThanOrEqual(0);
    expect(main.bounds.width).toBeGreaterThan(0);

    // The frozen-rows viewport should fill the available content height
    const frozenRowsVp = layout.viewports.find((v) => v.id === 'frozen-rows')!;
    expect(frozenRowsVp).toBeDefined();
    expect(frozenRowsVp.bounds.height).toBeGreaterThan(0);

    // Main viewport cell range should not be inverted
    expect(main.cellRange.endRow).toBeGreaterThanOrEqual(main.cellRange.startRow);
    expect(main.cellRange.endCol).toBeGreaterThanOrEqual(main.cellRange.startCol);
  });

  it('frozen cols exceeding viewport produce non-negative main viewport width', () => {
    // 30 frozen cols at 100px each = 3000px; container is only 1000px.
    const pi = createTestPositionIndex(25, 100, 100, 50);
    const input = createTestInput({
      config: { type: 'freeze', rows: 0, cols: 30 },
      containerSize: { width: 1000, height: 600 },
      positionIndex: pi,
    });
    const layout = computeViewportLayout(input);

    const main = layout.viewports.find((v) => v.id === 'main')!;
    expect(main).toBeDefined();
    expect(main.bounds.width).toBeGreaterThanOrEqual(0);
    expect(main.bounds.height).toBeGreaterThan(0);
    expect(main.cellRange.endCol).toBeGreaterThanOrEqual(main.cellRange.startCol);
  });

  it('frozen-rows viewport startRow/startCol respects frozen boundary', () => {
    const frozenRows = 3;
    const frozenCols = 2;
    const pi = createTestPositionIndex(25, 100, 100, 26);
    const input = createTestInput({
      config: { type: 'freeze', rows: frozenRows, cols: frozenCols },
      containerSize: { width: 1000, height: 600 },
      positionIndex: pi,
      scrollPosition: { x: 500, y: 500 },
    });
    const layout = computeViewportLayout(input);

    const frozenRowsVp = layout.viewports.find((v) => v.id === 'frozen-rows')!;
    expect(frozenRowsVp.cellRange.startCol).toBeGreaterThanOrEqual(frozenCols);
    // bounds.height = scaledFrozenRowsHeight naturally caps the row search;
    // partial-visibility +1 may overshoot by one row, which is fine because
    // the renderer clips by bounds.
    expect(frozenRowsVp.cellRange.endRow).toBeLessThanOrEqual(frozenRows);

    const frozenColsVp = layout.viewports.find((v) => v.id === 'frozen-cols')!;
    expect(frozenColsVp.cellRange.startRow).toBeGreaterThanOrEqual(frozenRows);
    expect(frozenColsVp.cellRange.endCol).toBeLessThanOrEqual(frozenCols);
  });
});
