/**
 * Selection Layer — Frozen Pane Clipping Tests
 *
 * Validates that selection rendering is properly clipped to each region's
 * cellRange when freeze panes are active, preventing duplicate drawing
 * where regions overlap in document-cell space.
 *
 * Bug #4: Duplicate selection in frozen pane.
 *
 * @module grid-renderer/layers/__tests__/selection-frozen-pane
 */

import { jest } from '@jest/globals';

import type { SelectionDataSource, SheetDataSource } from '@mog-sdk/contracts/rendering';
import { DEFAULT_RESOLVED_SHEET_VIEW_SKIN } from '@mog-sdk/contracts/rendering';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { ClipboardSnapshot } from '@mog-sdk/contracts/machines';

import { DEFAULT_CHROME_THEME } from '../../shared/constants';
import { ViewportPositionIndex } from '../../coordinates/viewport-position-index';
import { ViewportMergeIndex } from '../../coordinates/viewport-merge-index';
import { SelectionLayer } from '../selection';

// =============================================================================
// Test Helpers
// =============================================================================

function createTestPositionIndex(): ViewportPositionIndex {
  const defaultRowHeight = 25;
  const defaultColWidth = 100;
  const numRows = 100;
  const numCols = 26;

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
  pi.setTotalDimensions(numRows, numCols);
  return pi;
}

function createMockMergeIndex(): ViewportMergeIndex {
  return new ViewportMergeIndex();
}

function createMockSelectionDataSource(opts: {
  ranges?: CellRange[];
  activeCell?: { row: number; col: number };
  clipboard?: Partial<ClipboardSnapshot>;
  formulaRanges?: Array<{ range: CellRange; color: string; index: number }>;
  isFormulaMode?: boolean;
  searchHighlights?: Array<{ row: number; col: number; isCurrent?: boolean }>;
  hasFullRowSelection?: boolean;
  hasFullColumnSelection?: boolean;
}): SelectionDataSource {
  const ranges = opts.ranges ?? [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 } as CellRange];
  const clipboard: ClipboardSnapshot = {
    hasCopy: false,
    hasCut: false,
    copySource: null,
    cutSource: null,
    isPasting: false,
    sourceSheetId: null,
    ...opts.clipboard,
  };

  return {
    getSelectionState: () =>
      ({
        ranges,
        activeCell: opts.activeCell ?? { row: 0, col: 0 },
        isSelecting: false,
        isFormulaMode: opts.isFormulaMode ?? false,
        isDraggingFillHandle: false,
        isRightDraggingFillHandle: false,
        direction: 'down-right' as const,
        hasFullRowSelection: opts.hasFullRowSelection ?? false,
        hasFullColumnSelection: opts.hasFullColumnSelection ?? false,
        selectedRows: new Set<number>(),
        selectedCols: new Set<number>(),
        fullySelectedRows: new Set<number>(),
        fullySelectedCols: new Set<number>(),
        isDraggingCells: false,
        dragSourceRange: null,
        dragTargetCell: null,
        dragMode: 'move' as const,
        isResizingHeader: false,
        resizeType: null,
        resizeIndex: null,
        resizeCurrentSize: null,
        isResizingTable: false,
        tableResizeId: null,
        tableResizeStartBounds: null,
        tableResizeTargetRow: null,
        tableResizeTargetCol: null,
        formulaRanges: opts.formulaRanges ?? [],
        activeReferenceIndex: -1,
        fillPreviewRange: undefined,
        pastePreview: undefined,
        flashFillPreview: undefined,
        hasError: false,
        errorType: undefined,
        tablePreviewRange: null,
      }) as any,
    getEditorState: () => ({
      isEditing: false,
      isFormulaEditing: false,
      editingCell: null,
      sheetId: null,
      mergeBounds: null,
      value: '',
      hasConflict: false,
      isIMEComposing: false,
    }),
    getClipboardState: () => clipboard,
    getSearchHighlights: () => (opts.searchHighlights ?? []) as any,
    getPastePreview: () => null,
    getDragDropState: () => null,
    getTablePreviewRange: () => null,
    hasError: () => false,
  };
}

function createMockSheetDataSource(overrides: Partial<SheetDataSource> = {}): SheetDataSource {
  return {
    sheetId: 'sheet1',
    totalRows: 1000,
    totalCols: 26,
    showGridlines: true,
    gridlineColor: '#e0e0e0',
    theme: {} as any,
    culture: {} as any,
    rightToLeft: false,
    showFormulas: false,
    showRowHeaders: true,
    showColumnHeaders: true,
    showCutCopyIndicator: true,
    allowDragFill: true,
    validationCirclesVisible: false,
    previewFont: null,
    blockedEditAttempt: null,
    chromeTheme: DEFAULT_CHROME_THEME,
    sheetViewSkin: DEFAULT_RESOLVED_SHEET_VIEW_SKIN,
    ...overrides,
  };
}

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
    'drawImage',
    'roundRect',
  ];
  for (const method of methods) {
    ctx[method] = jest.fn().mockReturnValue(undefined);
  }
  (ctx.measureText as jest.Mock).mockReturnValue({
    width: 50,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 3,
    fontBoundingBoxAscent: 12,
    fontBoundingBoxDescent: 4,
  });
  (ctx.getLineDash as jest.Mock).mockReturnValue([]);

  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineDashOffset = 0;
  ctx.canvas = { width: 2000, height: 1200 } as HTMLCanvasElement;

  return ctx as unknown as CanvasRenderingContext2D;
}

/**
 * Creates the 4 regions for a freeze pane at row=freezeRow, col=freezeCol.
 *
 * Layout:
 *   corner (0,0 -> freezeRow-1, freezeCol-1)   | frozenCols (0 -> freezeRow-1, freezeCol -> maxCol)
 *   frozenRows (freezeRow -> maxRow, 0 -> freezeCol-1) | main (freezeRow -> maxRow, freezeCol -> maxCol)
 *
 * The naming follows the convention: "frozenRows" is the region where rows are frozen
 * (left strip below the corner), "frozenCols" is the region where columns are frozen
 * (top strip right of corner).
 */
function createFrozenRegions(freezeRow: number, freezeCol: number, maxRow = 20, maxCol = 10) {
  const rowHeight = 25;
  const colWidth = 100;

  const frozenWidth = freezeCol * colWidth;
  const frozenHeight = freezeRow * rowHeight;
  const mainWidth = (maxCol - freezeCol + 1) * colWidth;
  const mainHeight = (maxRow - freezeRow + 1) * rowHeight;

  const corner = {
    id: 'corner',
    bounds: { x: 0, y: 0, width: frozenWidth, height: frozenHeight },
    viewportOrigin: { x: 0, y: 0 },
    scrollOffset: { x: 0, y: 0 },
    zoom: 1.0,
    metadata: {
      sheetId: 'sheet1',
      cellRange: { startRow: 0, startCol: 0, endRow: freezeRow - 1, endCol: freezeCol - 1 },
      isFrozen: true,
      scrollBehavior: 'fixed',
    },
  } as any;

  const frozenCols = {
    id: 'frozenCols',
    bounds: { x: frozenWidth, y: 0, width: mainWidth, height: frozenHeight },
    viewportOrigin: { x: frozenWidth, y: 0 },
    scrollOffset: { x: 0, y: 0 },
    zoom: 1.0,
    metadata: {
      sheetId: 'sheet1',
      cellRange: { startRow: 0, startCol: freezeCol, endRow: freezeRow - 1, endCol: maxCol },
      isFrozen: true,
      scrollBehavior: 'horizontal',
    },
  } as any;

  const frozenRows = {
    id: 'frozenRows',
    bounds: { x: 0, y: frozenHeight, width: frozenWidth, height: mainHeight },
    viewportOrigin: { x: 0, y: frozenHeight },
    scrollOffset: { x: 0, y: 0 },
    zoom: 1.0,
    metadata: {
      sheetId: 'sheet1',
      cellRange: { startRow: freezeRow, startCol: 0, endRow: maxRow, endCol: freezeCol - 1 },
      isFrozen: true,
      scrollBehavior: 'vertical',
    },
  } as any;

  const main = {
    id: 'main',
    bounds: { x: frozenWidth, y: frozenHeight, width: mainWidth, height: mainHeight },
    viewportOrigin: { x: frozenWidth, y: frozenHeight },
    scrollOffset: { x: 0, y: 0 },
    zoom: 1.0,
    metadata: {
      sheetId: 'sheet1',
      cellRange: { startRow: freezeRow, startCol: freezeCol, endRow: maxRow, endCol: maxCol },
      isFrozen: false,
      scrollBehavior: 'free',
    },
  } as any;

  return { corner, frozenCols, frozenRows, main };
}

function createFrame() {
  return {
    timestamp: 16.67,
    canvasSize: { width: 2000, height: 1200 },
    dpr: 1,
    frameNumber: 1,
  };
}

/**
 * Renders the selection layer in a region and returns whether any fill or stroke
 * draw calls were made (indicating the selection was rendered in that region).
 */
function renderAndCapture(
  layer: SelectionLayer,
  region: any,
  frame: ReturnType<typeof createFrame>,
) {
  const ctx = createMockContext();
  layer.render(ctx, region, frame);
  return {
    ctx,
    hadFillRect: (ctx.fillRect as jest.Mock).mock.calls.length > 0,
    hadStrokeRect: (ctx.strokeRect as jest.Mock).mock.calls.length > 0,
    hadFill: (ctx.fill as jest.Mock).mock.calls.length > 0,
    hadStroke: (ctx.stroke as jest.Mock).mock.calls.length > 0,
    hadAnyDrawCall:
      (ctx.fillRect as jest.Mock).mock.calls.length > 0 ||
      (ctx.strokeRect as jest.Mock).mock.calls.length > 0 ||
      (ctx.fill as jest.Mock).mock.calls.length > 0 ||
      (ctx.stroke as jest.Mock).mock.calls.length > 0,
    fillRectCalls: (ctx.fillRect as jest.Mock).mock.calls,
    strokeRectCalls: (ctx.strokeRect as jest.Mock).mock.calls,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('SelectionLayer frozen pane clipping', () => {
  let positionIndex: ViewportPositionIndex;
  let mergeIndex: ViewportMergeIndex;
  let sheetData: SheetDataSource;

  beforeEach(() => {
    positionIndex = createTestPositionIndex();
    mergeIndex = createMockMergeIndex();
    sheetData = createMockSheetDataSource();
  });

  // -------------------------------------------------------------------------
  // Test 1: Selection entirely within frozen region renders only in that region
  // -------------------------------------------------------------------------
  it('should render selection only in the corner region when selection is entirely within frozen area', () => {
    // Freeze at row 2, col 2. Selection A1:B2 (rows 0-1, cols 0-1) — entirely in corner.
    const selectionData = createMockSelectionDataSource({
      ranges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 } as CellRange],
      activeCell: { row: 0, col: 0 },
    });

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    const frame = createFrame();
    const regions = createFrozenRegions(2, 2);

    const cornerResult = renderAndCapture(layer, regions.corner, frame);
    const frozenColsResult = renderAndCapture(layer, regions.frozenCols, frame);
    const frozenRowsResult = renderAndCapture(layer, regions.frozenRows, frame);
    const mainResult = renderAndCapture(layer, regions.main, frame);

    // Corner should have draw calls (selection + active cell)
    expect(cornerResult.hadAnyDrawCall).toBe(true);

    // No other region should have selection fill
    expect(frozenColsResult.hadFillRect).toBe(false);
    expect(frozenRowsResult.hadFillRect).toBe(false);
    expect(mainResult.hadFillRect).toBe(false);

    // No other region should have active cell stroke
    expect(frozenColsResult.hadStrokeRect).toBe(false);
    expect(frozenRowsResult.hadStrokeRect).toBe(false);
    expect(mainResult.hadStrokeRect).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 2: Selection spanning freeze boundary is split correctly
  // -------------------------------------------------------------------------
  it('should split selection across all 4 regions when it spans the freeze boundary', () => {
    // Freeze at row 2, col 2. Selection A1:C3 (rows 0-2, cols 0-2) — spans all 4 regions.
    const selectionData = createMockSelectionDataSource({
      ranges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 } as CellRange],
      activeCell: { row: 0, col: 0 },
    });

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    const frame = createFrame();
    const regions = createFrozenRegions(2, 2);

    const cornerResult = renderAndCapture(layer, regions.corner, frame);
    const frozenColsResult = renderAndCapture(layer, regions.frozenCols, frame);
    const frozenRowsResult = renderAndCapture(layer, regions.frozenRows, frame);
    const mainResult = renderAndCapture(layer, regions.main, frame);

    // All 4 regions should have some draw calls since the selection spans all of them
    expect(cornerResult.hadAnyDrawCall).toBe(true);
    expect(frozenColsResult.hadAnyDrawCall).toBe(true);
    expect(frozenRowsResult.hadAnyDrawCall).toBe(true);
    expect(mainResult.hadAnyDrawCall).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: Selection entirely in scrollable area renders only in main region
  // -------------------------------------------------------------------------
  it('should render selection only in main region when selection is entirely in scrollable area', () => {
    // Freeze at row 2, col 2. Selection D5:F8 (rows 4-7, cols 3-5) — entirely in main.
    const selectionData = createMockSelectionDataSource({
      ranges: [{ startRow: 4, startCol: 3, endRow: 7, endCol: 5 } as CellRange],
      activeCell: { row: 4, col: 3 },
    });

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    const frame = createFrame();
    const regions = createFrozenRegions(2, 2);

    const cornerResult = renderAndCapture(layer, regions.corner, frame);
    const frozenColsResult = renderAndCapture(layer, regions.frozenCols, frame);
    const frozenRowsResult = renderAndCapture(layer, regions.frozenRows, frame);
    const mainResult = renderAndCapture(layer, regions.main, frame);

    // Only main region should render the selection
    expect(mainResult.hadAnyDrawCall).toBe(true);

    // Frozen regions should have no draw calls
    expect(cornerResult.hadFillRect).toBe(false);
    expect(cornerResult.hadStrokeRect).toBe(false);
    expect(frozenColsResult.hadFillRect).toBe(false);
    expect(frozenColsResult.hadStrokeRect).toBe(false);
    expect(frozenRowsResult.hadFillRect).toBe(false);
    expect(frozenRowsResult.hadStrokeRect).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 4: Active cell hole only appears in the region containing the active cell
  // -------------------------------------------------------------------------
  it('should render active cell hole only in the region containing the active cell', () => {
    // Freeze at row 2, col 2. Selection A1:A5 (rows 0-4, col 0) spans corner + frozenRows.
    // Active cell A1 (row 0, col 0) is in the corner region.
    const selectionData = createMockSelectionDataSource({
      ranges: [{ startRow: 0, startCol: 0, endRow: 4, endCol: 0 } as CellRange],
      activeCell: { row: 0, col: 0 },
    });

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    const frame = createFrame();
    const regions = createFrozenRegions(2, 2);

    // The corner region contains the active cell — fillRectWithHole uses
    // ctx.clip('evenodd') to cut the active cell hole out of the fill.
    const cornerCtx = createMockContext();
    layer.render(cornerCtx, regions.corner, frame);

    // The frozenRows region does NOT contain the active cell (row 0 < freezeRow 2).
    // fillRectWithHole receives null hole, so it calls ctx.fillRect directly
    // without ctx.clip('evenodd').
    const frozenRowsCtx = createMockContext();
    layer.render(frozenRowsCtx, regions.frozenRows, frame);

    // Corner: clip('evenodd') should be called because the active cell hole is cut
    expect(cornerCtx.clip).toHaveBeenCalledWith('evenodd');

    // frozenRows: clip('evenodd') should NOT be called — solid fill, no hole
    const frozenRowsClipCalls = (frozenRowsCtx.clip as jest.Mock).mock.calls;
    const hasEvenOddClip = frozenRowsClipCalls.some((args: unknown[]) => args[0] === 'evenodd');
    expect(hasEvenOddClip).toBe(false);

    // frozenRows should still render selection fill for rows 2-4
    expect(frozenRowsCtx.fillRect).toHaveBeenCalled();

    // The frozenCols and main regions should NOT render anything
    // (selection col 0 is outside their cellRange cols 2+)
    const frozenColsResult = renderAndCapture(layer, regions.frozenCols, frame);
    const mainResult = renderAndCapture(layer, regions.main, frame);
    expect(frozenColsResult.hadFillRect).toBe(false);
    expect(mainResult.hadFillRect).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 5: Full-row selection clipped per region
  // -------------------------------------------------------------------------
  it('should clip full-row selection to each region column range', () => {
    // Freeze at col 2. Full-row selection (row 3, all columns).
    // Row 3 is in the frozenRows and main regions (below freeze row).
    // With freeze at row=2, col=2: row 3 is >= freezeRow, so it's in frozenRows (cols 0-1) and main (cols 2+).
    const fullRowRange = {
      startRow: 3,
      startCol: 0,
      endRow: 3,
      endCol: 25,
      isFullRow: true,
    } as CellRange;

    const selectionData = createMockSelectionDataSource({
      ranges: [fullRowRange],
      activeCell: { row: 3, col: 0 },
      hasFullRowSelection: true,
    });

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    const frame = createFrame();
    const regions = createFrozenRegions(2, 2);

    const cornerResult = renderAndCapture(layer, regions.corner, frame);
    const frozenColsResult = renderAndCapture(layer, regions.frozenCols, frame);
    const frozenRowsResult = renderAndCapture(layer, regions.frozenRows, frame);
    const mainResult = renderAndCapture(layer, regions.main, frame);

    // Row 3 is below freeze row (2), so corner (rows 0-1) and frozenCols (rows 0-1) should not render
    expect(cornerResult.hadFillRect).toBe(false);
    expect(frozenColsResult.hadFillRect).toBe(false);

    // frozenRows (rows 2-20, cols 0-1) and main (rows 2-20, cols 2-10) should render
    // because the full-row selection at row 3 intersects both
    expect(frozenRowsResult.hadAnyDrawCall).toBe(true);
    expect(mainResult.hadAnyDrawCall).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: Formula range highlights clipped per region
  // -------------------------------------------------------------------------
  it('should clip formula range highlights to each region', () => {
    // Freeze at row 2, col 2. Formula range reference A1:C3 spans all 4 regions.
    const formulaRange = { startRow: 0, startCol: 0, endRow: 2, endCol: 2 } as CellRange;

    const selectionData = createMockSelectionDataSource({
      ranges: [{ startRow: 5, startCol: 5, endRow: 5, endCol: 5 } as CellRange],
      activeCell: { row: 5, col: 5 },
      isFormulaMode: true,
      formulaRanges: [{ range: formulaRange, color: '#4285F4', index: 0 }],
    });

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    const frame = createFrame();
    const regions = createFrozenRegions(2, 2);

    // All 4 regions should render the formula highlight since A1:C3 spans all of them
    const cornerResult = renderAndCapture(layer, regions.corner, frame);
    const frozenColsResult = renderAndCapture(layer, regions.frozenCols, frame);
    const frozenRowsResult = renderAndCapture(layer, regions.frozenRows, frame);
    const mainResult = renderAndCapture(layer, regions.main, frame);

    expect(cornerResult.hadAnyDrawCall).toBe(true);
    expect(frozenColsResult.hadAnyDrawCall).toBe(true);
    expect(frozenRowsResult.hadAnyDrawCall).toBe(true);
    expect(mainResult.hadAnyDrawCall).toBe(true);

    // Now test a formula range entirely in main (D5:E6) — only main should render it
    const selectionData2 = createMockSelectionDataSource({
      ranges: [{ startRow: 5, startCol: 5, endRow: 5, endCol: 5 } as CellRange],
      activeCell: { row: 5, col: 5 },
      isFormulaMode: true,
      formulaRanges: [
        {
          range: { startRow: 4, startCol: 3, endRow: 5, endCol: 4 } as CellRange,
          color: '#4285F4',
          index: 0,
        },
      ],
    });

    const layer2 = new SelectionLayer(selectionData2, positionIndex, mergeIndex, sheetData);

    const cornerResult2 = renderAndCapture(layer2, regions.corner, frame);
    const frozenColsResult2 = renderAndCapture(layer2, regions.frozenCols, frame);
    const frozenRowsResult2 = renderAndCapture(layer2, regions.frozenRows, frame);
    const mainResult2 = renderAndCapture(layer2, regions.main, frame);

    // Only main should render the formula highlight (D5:E6 is entirely in main)
    expect(mainResult2.hadAnyDrawCall).toBe(true);
    // The active cell (row 5, col 5) is in main, so corner/frozen regions should NOT render
    expect(cornerResult2.hadFillRect).toBe(false);
    expect(cornerResult2.hadStrokeRect).toBe(false);
    expect(frozenColsResult2.hadFillRect).toBe(false);
    expect(frozenColsResult2.hadStrokeRect).toBe(false);
    expect(frozenRowsResult2.hadFillRect).toBe(false);
    expect(frozenRowsResult2.hadStrokeRect).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 7: No visual regression without freeze panes
  // -------------------------------------------------------------------------
  it('should render identically with a single viewport (no freeze panes)', () => {
    // Single viewport — all cells in one region, no freeze panes.
    const range = { startRow: 1, startCol: 1, endRow: 3, endCol: 3 } as CellRange;
    const selectionData = createMockSelectionDataSource({
      ranges: [range],
      activeCell: { row: 1, col: 1 },
    });

    const singleRegion = {
      id: 'main',
      bounds: { x: 0, y: 0, width: 2000, height: 1200 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1.0,
      metadata: {
        sheetId: 'sheet1',
        cellRange: { startRow: 0, startCol: 0, endRow: 50, endCol: 25 },
        isFrozen: false,
        scrollBehavior: 'free',
      },
    } as any;

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    const frame = createFrame();
    const result = renderAndCapture(layer, singleRegion, frame);

    // Selection should render normally — fill for the range and stroke for active cell
    expect(result.hadFillRect).toBe(true);
    expect(result.hadStrokeRect).toBe(true);
  });
});
