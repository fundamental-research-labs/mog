/**
 * Grid Renderer Integration Tests
 *
 * End-to-end integration tests covering:
 * 1. Frozen panes with region computation
 * 2. Merged cells spanning freeze boundaries
 * 3. Selection layer with range fills, active cell, multi-select
 * 4. Full render cycle via createGridLayers() with mock data sources
 * 5. Layer ordering by z-index
 * 6. Dirty tracking lifecycle (isDirty / markDirty / markClean)
 *
 * @module grid-renderer/__tests__/integration
 */

import { jest } from '@jest/globals';

import type {
  AnimationClock,
  DocSpaceRect,
  FrameContext,
  RenderRegion,
  TextMeasurer,
} from '@mog/canvas-engine';
import type { CellRange } from '@mog-sdk/contracts/core';
import type {
  GridRegionMeta,
  SelectionDataSource,
  SheetDataSource,
} from '@mog-sdk/contracts/rendering';
import {
  COL_HEADER_HEIGHT,
  DEFAULT_RESOLVED_SHEET_VIEW_SKIN,
  ROW_HEADER_WIDTH,
} from '@mog-sdk/contracts/rendering';

import { ViewportMergeIndex } from '../coordinates/viewport-merge-index';
import { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { NULL_SHEET_DATA_SOURCE } from '../data/defaults';
import { createGridLayers } from '../factory';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock CanvasRenderingContext2D with jest.fn() stubs.
 */
function createMockContext(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {};
  const methods = [
    'save',
    'restore',
    'beginPath',
    'closePath',
    'moveTo',
    'lineTo',
    'rect',
    'arc',
    'fill',
    'stroke',
    'clip',
    'clearRect',
    'fillRect',
    'strokeRect',
    'fillText',
    'strokeText',
    'measureText',
    'setLineDash',
    'getLineDash',
    'translate',
    'scale',
    'rotate',
    'transform',
    'setTransform',
    'resetTransform',
    'createLinearGradient',
    'createRadialGradient',
    'createPattern',
    'drawImage',
    'putImageData',
    'getImageData',
    'createImageData',
    'quadraticCurveTo',
    'bezierCurveTo',
    'arcTo',
    'ellipse',
    'isPointInPath',
    'isPointInStroke',
    'drawFocusIfNeeded',
    'roundRect',
  ];
  for (const method of methods) {
    ctx[method] = jest.fn().mockReturnValue(undefined);
  }
  // measureText needs a return value
  (ctx.measureText as jest.Mock).mockReturnValue({
    width: 50,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 3,
    fontBoundingBoxAscent: 12,
    fontBoundingBoxDescent: 4,
  });
  // getLineDash returns array
  (ctx.getLineDash as jest.Mock).mockReturnValue([]);
  // gradient stubs
  const mockGradient = { addColorStop: jest.fn() };
  (ctx.createLinearGradient as jest.Mock).mockReturnValue(mockGradient);
  (ctx.createRadialGradient as jest.Mock).mockReturnValue(mockGradient);

  // Writable properties
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineDashOffset = 0;
  ctx.direction = 'ltr';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.filter = 'none';
  ctx.canvas = { width: 2000, height: 1200 } as HTMLCanvasElement;

  return ctx as unknown as CanvasRenderingContext2D;
}

/**
 * Create a ViewportPositionIndex with configurable defaults.
 */
function createTestPositionIndex(
  opts: {
    defaultRowHeight?: number;
    defaultColWidth?: number;
    totalRows?: number;
    totalCols?: number;
    hiddenRows?: Set<number>;
    hiddenCols?: Set<number>;
    customRowHeights?: Map<number, number>;
    customColWidths?: Map<number, number>;
  } = {},
): ViewportPositionIndex {
  const defaultRowHeight = opts.defaultRowHeight ?? 25;
  const defaultColWidth = opts.defaultColWidth ?? 100;
  const totalRows = opts.totalRows ?? 1000;
  const totalCols = opts.totalCols ?? 26;
  const numRows = Math.min(totalRows, 1000);
  const numCols = Math.min(totalCols, 100);

  const pi = new ViewportPositionIndex(defaultRowHeight, defaultColWidth);

  const rowPositions = new Float64Array(numRows);
  let y = 0;
  for (let i = 0; i < numRows; i++) {
    if (opts.hiddenRows?.has(i)) {
      rowPositions[i] = y;
    } else {
      rowPositions[i] = y;
      y += opts.customRowHeights?.get(i) ?? defaultRowHeight;
    }
  }

  const colPositions = new Float64Array(numCols);
  let x = 0;
  for (let i = 0; i < numCols; i++) {
    if (opts.hiddenCols?.has(i)) {
      colPositions[i] = x;
    } else {
      colPositions[i] = x;
      x += opts.customColWidths?.get(i) ?? defaultColWidth;
    }
  }

  pi.setPositions(rowPositions, colPositions, 0, 0);
  pi.setTotalDimensions(totalRows, totalCols);

  if (opts.hiddenRows || opts.hiddenCols) {
    pi.setHiddenState(opts.hiddenRows ?? new Set(), opts.hiddenCols ?? new Set());
  }

  return pi;
}

/**
 * Create a ViewportMergeIndex with configurable merges.
 */
function createTestMergeIndex(merges?: Map<string, CellRange>): ViewportMergeIndex {
  const mi = new ViewportMergeIndex();
  if (merges && merges.size > 0) {
    const binaryMerges = Array.from(merges.values()).map((m) => ({
      start_row: m.startRow,
      start_col: m.startCol,
      end_row: m.endRow,
      end_col: m.endCol,
    }));
    mi.setMerges(binaryMerges);
  }
  return mi;
}

/**
 * Create a mock AnimationClock.
 */
function createMockAnimationClock(): AnimationClock {
  return {
    requestContinuousFrames: jest.fn(),
    stopContinuousFrames: jest.fn(),
  };
}

/**
 * Create a FrameContext for testing.
 */
function createFrameContext(overrides: Partial<FrameContext> = {}): FrameContext {
  return {
    timestamp: 16.67,
    canvasSize: { width: 1000, height: 600 },
    dpr: 1,
    frameNumber: 1,
    ...overrides,
  };
}

/**
 * Test fixture: build a `RegionLayout`-like list of regions for the given
 * freeze configuration. This is the test-side substitute for the deleted
 * orphan `computeGridLayout` — it produces the same RenderRegion[] shape so
 * existing layer-rendering tests can use it as a fixture without re-creating
 * a parallel layout pipeline. Inline RenderRegion literal construction is
 * allowlisted in test files by the coordinate-boundary lint rule.
 */
interface TestLayoutInput {
  freezeConfig?: { rows: number; cols: number };
  containerSize?: { width: number; height: number };
  positionIndex?: ViewportPositionIndex;
  scrollPosition?: { x: number; y: number };
  zoom?: number;
  sheetId?: string;
}

function buildTestRegionLayout(input: TestLayoutInput = {}): {
  regions: RenderRegion<GridRegionMeta>[];
} {
  const freezeConfig = input.freezeConfig ?? { rows: 0, cols: 0 };
  const containerSize = input.containerSize ?? { width: 1000, height: 600 };
  const pi = input.positionIndex ?? createTestPositionIndex();
  const scrollPosition = input.scrollPosition ?? { x: 0, y: 0 };
  const zoom = input.zoom ?? 1;
  const sheetId = input.sheetId ?? 'sheet1';

  const headerX = ROW_HEADER_WIDTH;
  const headerY = COL_HEADER_HEIGHT;
  const contentWidth = containerSize.width - headerX;
  const contentHeight = containerSize.height - headerY;

  const frozenRowsHeight = freezeConfig.rows > 0 ? pi.getRowTop(freezeConfig.rows) : 0;
  const frozenColsWidth = freezeConfig.cols > 0 ? pi.getColLeft(freezeConfig.cols) : 0;
  const scaledFrozenRowsHeight = frozenRowsHeight * zoom;
  const scaledFrozenColsWidth = frozenColsWidth * zoom;
  const hasFrozenRows = freezeConfig.rows > 0;
  const hasFrozenCols = freezeConfig.cols > 0;

  const regions: RenderRegion<GridRegionMeta>[] = [];

  if (hasFrozenRows && hasFrozenCols) {
    regions.push({
      id: 'frozen-corner',
      bounds: {
        x: headerX,
        y: headerY,
        width: scaledFrozenColsWidth,
        height: scaledFrozenRowsHeight,
      },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom,
      metadata: {
        sheetId,
        cellRange: {
          startRow: 0,
          startCol: 0,
          endRow: freezeConfig.rows - 1,
          endCol: freezeConfig.cols - 1,
        },
        isFrozen: true,
        scrollBehavior: 'none',
        viewportId: 'frozen-corner',
      },
    });
  }

  if (hasFrozenRows) {
    regions.push({
      id: 'frozen-rows',
      bounds: {
        x: hasFrozenCols ? headerX + scaledFrozenColsWidth : headerX,
        y: headerY,
        width: hasFrozenCols ? contentWidth - scaledFrozenColsWidth : contentWidth,
        height: scaledFrozenRowsHeight,
      },
      viewportOrigin: { x: hasFrozenCols ? frozenColsWidth : 0, y: 0 },
      scrollOffset: { x: scrollPosition.x, y: 0 },
      zoom,
      metadata: {
        sheetId,
        cellRange: {
          startRow: 0,
          startCol: hasFrozenCols ? freezeConfig.cols : 0,
          endRow: freezeConfig.rows - 1,
          endCol: pi.totalCols - 1,
        },
        isFrozen: true,
        scrollBehavior: 'row-anchored',
        viewportId: 'frozen-rows',
      },
    });
  }

  if (hasFrozenCols) {
    regions.push({
      id: 'frozen-cols',
      bounds: {
        x: headerX,
        y: hasFrozenRows ? headerY + scaledFrozenRowsHeight : headerY,
        width: scaledFrozenColsWidth,
        height: hasFrozenRows ? contentHeight - scaledFrozenRowsHeight : contentHeight,
      },
      viewportOrigin: { x: 0, y: hasFrozenRows ? frozenRowsHeight : 0 },
      scrollOffset: { x: 0, y: scrollPosition.y },
      zoom,
      metadata: {
        sheetId,
        cellRange: {
          startRow: hasFrozenRows ? freezeConfig.rows : 0,
          startCol: 0,
          endRow: pi.totalRows - 1,
          endCol: freezeConfig.cols - 1,
        },
        isFrozen: true,
        scrollBehavior: 'col-anchored',
        viewportId: 'frozen-cols',
      },
    });
  }

  regions.push({
    id: 'main',
    bounds: {
      x: hasFrozenCols ? headerX + scaledFrozenColsWidth : headerX,
      y: hasFrozenRows ? headerY + scaledFrozenRowsHeight : headerY,
      width: hasFrozenCols ? contentWidth - scaledFrozenColsWidth : contentWidth,
      height: hasFrozenRows ? contentHeight - scaledFrozenRowsHeight : contentHeight,
    },
    viewportOrigin: {
      x: hasFrozenCols ? frozenColsWidth : 0,
      y: hasFrozenRows ? frozenRowsHeight : 0,
    },
    scrollOffset: scrollPosition,
    zoom,
    metadata: {
      sheetId,
      cellRange: {
        startRow: hasFrozenRows ? freezeConfig.rows : 0,
        startCol: hasFrozenCols ? freezeConfig.cols : 0,
        endRow: pi.totalRows - 1,
        endCol: pi.totalCols - 1,
      },
      isFrozen: false,
      scrollBehavior: 'free',
      viewportId: 'main',
    },
  });

  return { regions };
}

/**
 * Create a SelectionDataSource with configurable active cell and ranges.
 */
function createSelectionDataSource(
  opts: {
    activeCell?: { row: number; col: number } | null;
    ranges?: CellRange[];
    isSelecting?: boolean;
    formulaRanges?: Array<{ range: CellRange; color: string }>;
    hasCopiedData?: boolean;
  } = {},
): SelectionDataSource {
  const {
    activeCell = null,
    ranges = [],
    isSelecting = false,
    formulaRanges = [],
    hasCopiedData = false,
  } = opts;

  return {
    getSelectionState: () =>
      ({
        ranges,
        activeCell,
        isSelecting,
        formulaRanges,
        activeReferenceIndex: -1,
        fillPreviewRange: null,
        pastePreview: null,
        flashFillPreview: null,
        hasError: false,
        errorType: null,
        tablePreviewRange: null,
      }) as any,
    getEditorState: () => ({ isEditing: false }) as any,
    getClipboardState: () => ({ hasCopiedData }) as any,
    getSearchHighlights: () => [],
    getPastePreview: () => null,
    getDragDropState: () => null,
    getTablePreviewRange: () => null,
    hasError: () => false,
  };
}

/**
 * Create a mock TextMeasurer.
 */
function createMockTextMeasurer(): TextMeasurer {
  return {
    measureText: (_text: string, _font: string) => ({
      width: 50,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
    }),
    measureWrappedText: (_text: string, _font: string, _maxWidth: number) => ({
      lines: [_text],
      lineHeight: 16,
      totalHeight: 16,
    }),
  };
}

// =============================================================================
// Integration: Frozen Panes
// =============================================================================

describe('Integration: Frozen Panes', () => {
  it('should render all per-region layers across 4 freeze regions', () => {
    const dp = createTestPositionIndex();
    const mi = createTestMergeIndex();
    const layout = buildTestRegionLayout({
      freezeConfig: { rows: 3, cols: 2 },
      positionIndex: dp,
    });

    expect(layout.regions).toHaveLength(4);
    const ids = layout.regions.map((r) => r.id);
    expect(ids).toContain('frozen-corner');
    expect(ids).toContain('frozen-rows');
    expect(ids).toContain('frozen-cols');
    expect(ids).toContain('main');

    const result = createGridLayers({
      positionIndex: dp,
      mergeIndex: mi,
      animationClock: createMockAnimationClock(),
      textMeasurer: createMockTextMeasurer(),
    });

    const ctx = createMockContext();
    const frame = createFrameContext();

    const perRegionLayers = result.layers.filter((l) => l.renderMode === 'per-region');
    for (const layer of perRegionLayers) {
      for (const region of layout.regions) {
        expect(() => layer.render(ctx, region, frame)).not.toThrow();
      }
    }

    result.dispose();
  });

  it('should have no gaps between frozen regions in the test fixture', () => {
    const layout = buildTestRegionLayout({
      freezeConfig: { rows: 2, cols: 2 },
      containerSize: { width: 800, height: 500 },
    });

    const corner = layout.regions.find((r) => r.id === 'frozen-corner')!;
    const frozenRows = layout.regions.find((r) => r.id === 'frozen-rows')!;
    const frozenCols = layout.regions.find((r) => r.id === 'frozen-cols')!;
    const main = layout.regions.find((r) => r.id === 'main')!;

    expect(corner.bounds.x + corner.bounds.width).toBe(frozenRows.bounds.x);
    expect(corner.bounds.y + corner.bounds.height).toBe(frozenCols.bounds.y);
    expect(frozenRows.bounds.y + frozenRows.bounds.height).toBe(main.bounds.y);
    expect(frozenCols.bounds.x + frozenCols.bounds.width).toBe(main.bounds.x);
  });
});

// (Layout-pipeline structural tests — region count, scroll behaviors, viewportOrigin
// threading — are covered by:
//   canvas/grid-canvas/src/renderer/__tests__/viewport-to-region-layout.test.ts
//   canvas/grid-canvas/src/viewports/__tests__/compute-layout.test.ts
// Deleting the parallel grid-renderer compute-layout that those tests
// previously duplicated.)

// =============================================================================
// Integration: Merged Cells
// =============================================================================

describe('Integration: Merged Cells', () => {
  it('should handle merge spanning frozen boundary in layout computation', () => {
    // Merge A1:C3 spans across a freeze at row=2, col=2
    const merges = new Map<string, CellRange>();
    merges.set('A1:C3', {
      startRow: 0,
      startCol: 0,
      endRow: 2,
      endCol: 2,
    });

    const dp = createTestPositionIndex();
    const mi = createTestMergeIndex(merges);
    const layout = buildTestRegionLayout({
      freezeConfig: { rows: 2, cols: 2 },
      positionIndex: dp,
    });

    // The layout still produces 4 regions even with a spanning merge
    expect(layout.regions).toHaveLength(4);

    // The corner region should contain cells 0-1 rows, 0-1 cols
    const corner = layout.regions.find((r) => r.id === 'frozen-corner')!;
    expect(corner.metadata.cellRange.startRow).toBe(0);
    expect(corner.metadata.cellRange.startCol).toBe(0);
    expect(corner.metadata.cellRange.endRow).toBe(1);
    expect(corner.metadata.cellRange.endCol).toBe(1);
    void mi;
  });

  it('should allow rendering layers with merged cells without errors', () => {
    const merges = new Map<string, CellRange>();
    merges.set('B2:D4', {
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 3,
    });

    const dp = createTestPositionIndex();
    const mi = createTestMergeIndex(merges);
    const result = createGridLayers({
      positionIndex: dp,
      mergeIndex: mi,
      animationClock: createMockAnimationClock(),
      textMeasurer: createMockTextMeasurer(),
    });

    const ctx = createMockContext();
    const frame = createFrameContext();
    const region: RenderRegion<GridRegionMeta> = {
      id: 'main',
      bounds: { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, width: 800, height: 500 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1.0,
      metadata: {
        sheetId: 'sheet1',
        cellRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 10 },
        isFrozen: false,
        scrollBehavior: 'free',
      },
    };

    // Render all per-region layers without error
    for (const layer of result.layers) {
      if (layer.renderMode === 'per-region') {
        expect(() => layer.render(ctx, region, frame)).not.toThrow();
      }
    }

    result.dispose();
  });

  it('should expose merge info via ViewportMergeIndex getMergedRegion', () => {
    const merges = new Map<string, CellRange>();
    merges.set('A1:B2', {
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 1,
    });

    const mi = createTestMergeIndex(merges);

    // Cell (0,0) is the merge origin
    const mergeAt00 = mi.getMergedRegion(0, 0);
    expect(mergeAt00).not.toBeNull();
    expect(mergeAt00!.startRow).toBe(0);
    expect(mergeAt00!.endRow).toBe(1);

    // Cell (1,1) is also part of the merge
    const mergeAt11 = mi.getMergedRegion(1, 1);
    expect(mergeAt11).not.toBeNull();
    expect(mergeAt11!.startRow).toBe(0);

    // Cell (2,2) is outside the merge
    const mergeAt22 = mi.getMergedRegion(2, 2);
    expect(mergeAt22).toBeNull();
  });
});

// =============================================================================
// Integration: Selection Layer
// =============================================================================

describe('Integration: Selection Layer', () => {
  it('should render selection layer with active cell and ranges', () => {
    const selectionData = createSelectionDataSource({
      activeCell: { row: 0, col: 0 },
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
    });

    const dp = createTestPositionIndex();
    const mi = createTestMergeIndex();
    const result = createGridLayers({
      positionIndex: dp,
      mergeIndex: mi,
      animationClock: createMockAnimationClock(),
      selectionData,
    });

    expect(result.selection).toBeDefined();
    expect(result.selection.id).toBe('selection');
    expect(result.selection.zIndex).toBe(850);
    expect(result.selection.renderMode).toBe('per-region');

    const ctx = createMockContext();
    const frame = createFrameContext();
    const region: RenderRegion<GridRegionMeta> = {
      id: 'main',
      bounds: { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, width: 800, height: 500 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1.0,
      metadata: {
        sheetId: 'sheet1',
        cellRange: { startRow: 0, startCol: 0, endRow: 20, endCol: 10 },
        isFrozen: false,
        scrollBehavior: 'free',
      },
    };

    expect(() => result.selection.render(ctx, region, frame)).not.toThrow();

    // Should have drawn something (fillRect or strokeRect for selection)
    const fillRectCalls = (ctx.fillRect as jest.Mock).mock.calls.length;
    const strokeRectCalls = (ctx.strokeRect as jest.Mock).mock.calls.length;
    expect(fillRectCalls + strokeRectCalls).toBeGreaterThan(0);

    result.dispose();
  });

  it('should render selection with multiple ranges (multi-select)', () => {
    const selectionData = createSelectionDataSource({
      activeCell: { row: 0, col: 0 },
      ranges: [
        { startRow: 0, startCol: 0, endRow: 2, endCol: 2 },
        { startRow: 5, startCol: 5, endRow: 7, endCol: 7 },
      ],
    });

    const dp = createTestPositionIndex();
    const mi = createTestMergeIndex();
    const result = createGridLayers({
      positionIndex: dp,
      mergeIndex: mi,
      animationClock: createMockAnimationClock(),
      selectionData,
    });

    const ctx = createMockContext();
    const frame = createFrameContext();
    const region: RenderRegion<GridRegionMeta> = {
      id: 'main',
      bounds: { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, width: 900, height: 600 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1.0,
      metadata: {
        sheetId: 'sheet1',
        cellRange: { startRow: 0, startCol: 0, endRow: 20, endCol: 15 },
        isFrozen: false,
        scrollBehavior: 'free',
      },
    };

    expect(() => result.selection.render(ctx, region, frame)).not.toThrow();
    result.dispose();
  });

  it('should render selection in frozen pane regions without error', () => {
    const selectionData = createSelectionDataSource({
      activeCell: { row: 0, col: 0 },
      ranges: [{ startRow: 0, startCol: 0, endRow: 3, endCol: 3 }],
    });

    const dp = createTestPositionIndex();
    const mi = createTestMergeIndex();
    const layout = buildTestRegionLayout({
      freezeConfig: { rows: 2, cols: 2 },
      positionIndex: dp,
    });

    const result = createGridLayers({
      positionIndex: dp,
      mergeIndex: mi,
      animationClock: createMockAnimationClock(),
      selectionData,
    });

    const ctx = createMockContext();
    const frame = createFrameContext();

    // Selection that spans across freeze boundary should render in all regions
    for (const region of layout.regions) {
      expect(() => result.selection.render(ctx, region, frame)).not.toThrow();
    }

    result.dispose();
  });
});

// =============================================================================
// Integration: Full Render Cycle
// =============================================================================

describe('Integration: Full Render Cycle', () => {
  it('should create all layers via createGridLayers with textMeasurer', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
      textMeasurer: createMockTextMeasurer(),
    });

    // With textMeasurer, cells layer is created -> 11 layers total
    expect(result.layers.length).toBe(11);
    expect(result.cells).not.toBeNull();

    // Named references are all defined
    expect(result.background).toBeDefined();
    expect(result.selection).toBeDefined();
    expect(result.ui).toBeDefined();
    expect(result.headers).toBeDefined();
    expect(result.dividers).toBeDefined();
    expect(result.traceArrows).toBeDefined();
    expect(result.remoteCursors).toBeDefined();
    expect(result.validationCircles).toBeDefined();
    expect(result.pageBreaks).toBeDefined();
    expect(result.stickyHeaders).toBeDefined();

    result.dispose();
  });

  it('should create layers without textMeasurer (cells layer is null)', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
      // No textMeasurer
    });

    // Without textMeasurer, cells layer is NOT created -> 10 layers
    expect(result.layers.length).toBe(10);
    expect(result.cells).toBeNull();

    result.dispose();
  });

  it('should render all layers through a complete frame without errors', () => {
    const dp = createTestPositionIndex();
    const mi = createTestMergeIndex();
    const result = createGridLayers({
      positionIndex: dp,
      mergeIndex: mi,
      animationClock: createMockAnimationClock(),
      selectionData: createSelectionDataSource({
        activeCell: { row: 0, col: 0 },
        ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      }),
      textMeasurer: createMockTextMeasurer(),
    });

    const ctx = createMockContext();
    const frame = createFrameContext();

    // Build layout with frozen panes for full coverage
    const layout = buildTestRegionLayout({
      freezeConfig: { rows: 1, cols: 1 },
      positionIndex: dp,
    });

    // Simulate a full render cycle: per-region layers get each region, once layers get full-canvas
    const fullCanvasRegion: RenderRegion<GridRegionMeta> = {
      id: '__full_canvas__',
      bounds: { x: 0, y: 0, width: 1000, height: 600 },
      viewportOrigin: { x: 0, y: 0 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1.0,
      metadata: {
        sheetId: 'sheet1',
        cellRange: { startRow: 0, startCol: 0, endRow: 30, endCol: 20 },
        isFrozen: false,
        scrollBehavior: 'free',
      },
    };

    for (const layer of result.layers) {
      if (layer.renderMode === 'per-region') {
        for (const region of layout.regions) {
          expect(() => layer.render(ctx, region, frame)).not.toThrow();
        }
      } else {
        // 'once' mode layers get the full canvas pseudo-region
        expect(() => layer.render(ctx, fullCanvasRegion, frame)).not.toThrow();
      }
    }

    result.dispose();
  });

  it('should correctly identify per-region vs once render modes', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
      textMeasurer: createMockTextMeasurer(),
    });

    // per-region layers: background, cells, selection, ui, validationCircles,
    //   pageBreaks, traceArrows, remoteCursors, stickyHeaders
    const perRegionLayers = result.layers.filter((l) => l.renderMode === 'per-region');
    const onceLayers = result.layers.filter((l) => l.renderMode === 'once');

    // headers and dividers are 'once' mode
    expect(onceLayers.some((l) => l.id === 'headers')).toBe(true);
    expect(onceLayers.some((l) => l.id === 'dividers')).toBe(true);

    // background, selection, cells are per-region
    expect(perRegionLayers.some((l) => l.id === 'background')).toBe(true);
    expect(perRegionLayers.some((l) => l.id === 'selection')).toBe(true);
    expect(perRegionLayers.some((l) => l.id === 'cells')).toBe(true);

    result.dispose();
  });

  it('should update data sources dynamically via updateDataSources', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
    });

    const newSheetData: SheetDataSource = {
      ...NULL_SHEET_DATA_SOURCE,
      sheetId: 'sheet2',
      showGridlines: false,
    };

    // Should not throw
    expect(() => {
      result.updateDataSources({
        sheetData: newSheetData,
        positionIndex: createTestPositionIndex({ totalRows: 500, totalCols: 10 }),
      });
    }).not.toThrow();

    result.dispose();
  });

  it('should render background layer with grid lines visible', () => {
    const dp = createTestPositionIndex();
    const mi = createTestMergeIndex();
    const result = createGridLayers({
      positionIndex: dp,
      mergeIndex: mi,
      animationClock: createMockAnimationClock(),
      sheetData: { ...NULL_SHEET_DATA_SOURCE, showGridlines: true },
    });

    const ctx = createMockContext();
    const frame = createFrameContext();
    const region: RenderRegion<GridRegionMeta> = {
      id: 'main',
      bounds: { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, width: 800, height: 500 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1.0,
      metadata: {
        sheetId: 'sheet1',
        cellRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 5 },
        isFrozen: false,
        scrollBehavior: 'free',
      },
    };

    result.background.render(ctx, region, frame);

    // Background should have drawn grid lines (moveTo/lineTo or strokeRect)
    const moveToCount = (ctx.moveTo as jest.Mock).mock.calls.length;
    const lineToCount = (ctx.lineTo as jest.Mock).mock.calls.length;
    expect(moveToCount + lineToCount).toBeGreaterThan(0);

    result.dispose();
  });

  it('should render styled SheetView skin gridlines', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
      sheetData: {
        ...NULL_SHEET_DATA_SOURCE,
        sheetViewSkin: {
          ...DEFAULT_RESOLVED_SHEET_VIEW_SKIN,
          skinId: 'styled',
          background: { kind: 'color', color: '#faf0dc', opacity: 0.5 },
          defaultCellBackground: '#faf0dc',
          gridlines: {
            ...DEFAULT_RESOLVED_SHEET_VIEW_SKIN.gridlines,
            color: '#765432',
            width: 2,
            dash: [5, 3],
            lineCap: 'round',
          },
        },
      },
    });
    const ctx = createMockContext();
    const frame = createFrameContext();
    const region: RenderRegion<GridRegionMeta> = {
      id: 'main',
      bounds: { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, width: 800, height: 500 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1.0,
      metadata: {
        sheetId: 'sheet1',
        cellRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 5 },
        isFrozen: false,
        scrollBehavior: 'free',
      },
    };

    result.background.render(ctx, region, frame);

    expect(ctx.fillStyle).toBe('#faf0dc');
    expect(ctx.lineCap).toBe('round');
    expect(ctx.setLineDash).toHaveBeenCalledWith([5, 3]);

    result.dispose();
  });

  it('should handle all layers rendering at non-1.0 zoom', () => {
    const dp = createTestPositionIndex();
    const mi = createTestMergeIndex();
    const result = createGridLayers({
      positionIndex: dp,
      mergeIndex: mi,
      animationClock: createMockAnimationClock(),
      textMeasurer: createMockTextMeasurer(),
    });

    const ctx = createMockContext();
    const frame = createFrameContext({ dpr: 2 });
    const region: RenderRegion<GridRegionMeta> = {
      id: 'main',
      bounds: { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, width: 800, height: 500 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1.5,
      metadata: {
        sheetId: 'sheet1',
        cellRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 5 },
        isFrozen: false,
        scrollBehavior: 'free',
      },
    };

    for (const layer of result.layers) {
      if (layer.renderMode === 'per-region') {
        expect(() => layer.render(ctx, region, frame)).not.toThrow();
      }
    }

    result.dispose();
  });
});

// =============================================================================
// Integration: Layer Ordering
// =============================================================================

describe('Integration: Layer Ordering', () => {
  it('should return layers sorted by z-index (ascending)', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
      textMeasurer: createMockTextMeasurer(),
    });

    const zIndices = result.layers.map((l) => l.zIndex);
    for (let i = 1; i < zIndices.length; i++) {
      expect(zIndices[i]).toBeGreaterThanOrEqual(zIndices[i - 1]);
    }

    result.dispose();
  });

  it('should assign correct z-index to each named layer', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
      textMeasurer: createMockTextMeasurer(),
    });

    expect(result.background.zIndex).toBe(0);
    expect(result.cells!.zIndex).toBe(100);
    expect(result.validationCircles.zIndex).toBe(125);
    expect(result.pageBreaks.zIndex).toBe(150);
    expect(result.traceArrows.zIndex).toBe(250);
    expect(result.remoteCursors.zIndex).toBe(300);
    expect(result.ui.zIndex).toBe(400);
    expect(result.stickyHeaders.zIndex).toBe(700);
    expect(result.headers.zIndex).toBe(800);
    expect(result.selection.zIndex).toBe(850);
    expect(result.dividers.zIndex).toBe(900);

    result.dispose();
  });

  it('should have background as first layer and dividers as last', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
      textMeasurer: createMockTextMeasurer(),
    });

    expect(result.layers[0].id).toBe('background');
    expect(result.layers[result.layers.length - 1].id).toBe('dividers');

    result.dispose();
  });

  it('should ensure selection renders above cells and headers but below dividers', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
      textMeasurer: createMockTextMeasurer(),
    });

    expect(result.selection.zIndex).toBeGreaterThan(result.cells!.zIndex);
    expect(result.selection.zIndex).toBeGreaterThan(result.headers.zIndex);
    expect(result.selection.zIndex).toBeLessThan(result.dividers.zIndex);

    result.dispose();
  });
});

// =============================================================================
// Integration: Dirty Tracking
// =============================================================================

describe('Integration: Dirty Tracking', () => {
  it('should start all layers as dirty', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
      textMeasurer: createMockTextMeasurer(),
    });

    for (const layer of result.layers) {
      expect(layer.isDirty()).toBe(true);
    }

    result.dispose();
  });

  it('should mark layers as clean after markClean()', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
    });

    for (const layer of result.layers) {
      layer.markClean();
      expect(layer.isDirty()).toBe(false);
    }

    result.dispose();
  });

  it('should transition clean -> dirty via markDirty()', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
    });

    const bg = result.background;
    bg.markClean();
    expect(bg.isDirty()).toBe(false);

    bg.markDirty();
    expect(bg.isDirty()).toBe(true);
  });

  it('should accept DirtyHint with markDirty', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
    });

    const selection = result.selection;
    selection.markClean();
    expect(selection.isDirty()).toBe(false);

    // markDirty with a rect hint
    selection.markDirty({
      type: 'rect',
      bounds: { x: 0, y: 0, width: 100, height: 50 } as DocSpaceRect,
    });
    expect(selection.isDirty()).toBe(true);

    // markDirty with a full hint
    selection.markClean();
    selection.markDirty({ type: 'full' });
    expect(selection.isDirty()).toBe(true);
  });

  it('should report not dirty after dispose', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
    });

    const bg = result.background;
    expect(bg.isDirty()).toBe(true);

    result.dispose();

    // After dispose, isDirty returns false (layer is dead)
    expect(bg.isDirty()).toBe(false);
  });

  it('should simulate full dirty tracking lifecycle', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
      textMeasurer: createMockTextMeasurer(),
    });

    // 1. All layers start dirty
    for (const layer of result.layers) {
      expect(layer.isDirty()).toBe(true);
    }

    // 2. Simulate engine: render frame, mark all clean
    const ctx = createMockContext();
    const frame = createFrameContext();
    const region: RenderRegion<GridRegionMeta> = {
      id: 'main',
      bounds: { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, width: 800, height: 500 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1.0,
      metadata: {
        sheetId: 'sheet1',
        cellRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 5 },
        isFrozen: false,
        scrollBehavior: 'free',
      },
    };

    for (const layer of result.layers) {
      if (layer.renderMode === 'per-region') {
        layer.render(ctx, region, frame);
      }
      layer.markClean();
    }

    // 3. All clean now
    for (const layer of result.layers) {
      expect(layer.isDirty()).toBe(false);
    }

    // 4. External event: mark selection dirty
    result.selection.markDirty();
    expect(result.selection.isDirty()).toBe(true);

    // Other layers still clean
    expect(result.background.isDirty()).toBe(false);
    expect(result.ui.isDirty()).toBe(false);

    // 5. Re-render dirty layer and mark clean
    result.selection.render(ctx, region, frame);
    result.selection.markClean();
    expect(result.selection.isDirty()).toBe(false);

    // 6. Dispose
    result.dispose();
    for (const layer of result.layers) {
      expect(layer.isDirty()).toBe(false);
    }
  });
});

// =============================================================================
// Integration: Edge Cases
// =============================================================================

describe('Integration: Edge Cases', () => {
  it('should handle empty data sources gracefully', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
      // All data sources default to null implementations
    });

    const ctx = createMockContext();
    const frame = createFrameContext();
    const region: RenderRegion<GridRegionMeta> = {
      id: 'main',
      bounds: { x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT, width: 800, height: 500 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1.0,
      metadata: {
        sheetId: 'sheet1',
        cellRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 5 },
        isFrozen: false,
        scrollBehavior: 'free',
      },
    };

    // Should render without errors even with null/default data sources
    for (const layer of result.layers) {
      if (layer.renderMode === 'per-region') {
        expect(() => layer.render(ctx, region, frame)).not.toThrow();
      }
    }

    result.dispose();
  });

  it('should handle zero-size container in layout', () => {
    // Should not throw even with zero size
    expect(() => buildTestRegionLayout({ containerSize: { width: 0, height: 0 } })).not.toThrow();
  });

  it('should handle hidden rows in position index', () => {
    const pi = createTestPositionIndex({
      hiddenRows: new Set([0, 1, 2]),
    });

    // Hidden rows have 0 height in the position array
    expect(pi.getRowHeight(0)).toBe(0);
    expect(pi.getRowHeight(1)).toBe(0);
    expect(pi.getRowHeight(3)).toBe(25);
    expect(pi.isRowHidden(0)).toBe(true);
    expect(pi.isRowHidden(3)).toBe(false);
  });

  it('should handle custom column widths in position index', () => {
    const pi = createTestPositionIndex({
      customColWidths: new Map([
        [0, 200],
        [3, 50],
      ]),
    });

    expect(pi.getColWidth(0)).toBe(200);
    expect(pi.getColWidth(1)).toBe(100); // default
    expect(pi.getColWidth(3)).toBe(50);
    expect(pi.getColLeft(1)).toBe(200);
    expect(pi.getColLeft(2)).toBe(300);
  });

  it('should render once-mode layers with full canvas pseudo-region', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
    });

    const ctx = createMockContext();
    const frame = createFrameContext();
    const fullCanvasRegion: RenderRegion<GridRegionMeta> = {
      id: '__full_canvas__',
      bounds: { x: 0, y: 0, width: 1000, height: 600 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1.0,
      metadata: {
        sheetId: 'sheet1',
        cellRange: { startRow: 0, startCol: 0, endRow: 30, endCol: 20 },
        isFrozen: false,
        scrollBehavior: 'free',
      },
    };

    const onceLayers = result.layers.filter((l) => l.renderMode === 'once');
    for (const layer of onceLayers) {
      expect(() => layer.render(ctx, fullCanvasRegion, frame)).not.toThrow();
    }

    result.dispose();
  });

  it('should double-dispose layers without error', () => {
    const result = createGridLayers({
      positionIndex: createTestPositionIndex(),
      mergeIndex: createTestMergeIndex(),
      animationClock: createMockAnimationClock(),
    });

    result.dispose();
    // Second dispose should not throw
    expect(() => result.dispose()).not.toThrow();
  });
});
