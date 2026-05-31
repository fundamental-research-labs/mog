/**
 * Selection Layer — Clipboard Suppression Tests
 *
 * Validates that selection fill/border is suppressed for ranges matching
 * the clipboard copy/cut source, so only the UI layer's marching ants
 * are visible (matching Excel/Google Sheets behavior).
 *
 * Bug #19: Cmd+C fills selected cell with opaque blue instead of marching ants.
 *
 * @module grid-renderer/layers/__tests__/selection-clipboard
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
        isFormulaMode: false,
        isDraggingFillHandle: false,
        isRightDraggingFillHandle: false,
        direction: 'down-right' as const,
        hasFullRowSelection: false,
        hasFullColumnSelection: false,
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
        formulaRanges: [],
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
    getSearchHighlights: () => [],
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

function createRegion() {
  return {
    id: 'main',
    bounds: { x: 0, y: 0, width: 1000, height: 600 },
    viewportOrigin: { x: 0, y: 0 },
    scrollOffset: { x: 0, y: 0 },
    zoom: 1.0,
    metadata: {
      sheetId: 'sheet1',
      cellRange: { startRow: 0, startCol: 0, endRow: 20, endCol: 10 },
      isFrozen: false,
      scrollBehavior: 'free',
    },
  } as any;
}

function createFrame() {
  return {
    timestamp: 16.67,
    canvasSize: { width: 1000, height: 600 },
    dpr: 1,
    frameNumber: 1,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('SelectionLayer clipboard suppression', () => {
  it('should NOT render selection fill when selection matches clipboard copy source', () => {
    const copyRange = { startRow: 0, startCol: 0, endRow: 2, endCol: 2 } as CellRange;
    const selectionData = createMockSelectionDataSource({
      ranges: [copyRange],
      activeCell: { row: 0, col: 0 },
      clipboard: {
        hasCopy: true,
        copySource: [copyRange],
      },
    });

    const positionIndex = createTestPositionIndex();
    const mergeIndex = createMockMergeIndex();
    const sheetData = createMockSheetDataSource({ showCutCopyIndicator: true });
    const ctx = createMockContext();

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    layer.render(ctx, createRegion(), createFrame());

    // fillRect should NOT be called for the selection range fill
    // (it may be called for active cell border via strokeRect, but not fillRect for selection fill)
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('should render normal selection fill when no clipboard data', () => {
    const range = { startRow: 0, startCol: 0, endRow: 2, endCol: 2 } as CellRange;
    const selectionData = createMockSelectionDataSource({
      ranges: [range],
      activeCell: { row: 0, col: 0 },
      clipboard: {
        hasCopy: false,
        copySource: null,
      },
    });

    const positionIndex = createTestPositionIndex();
    const mergeIndex = createMockMergeIndex();
    const sheetData = createMockSheetDataSource();
    const ctx = createMockContext();

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    layer.render(ctx, createRegion(), createFrame());

    // fillRect should be called for the selection range fill
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('should draw active single-cell selections without filling over the active cell', () => {
    const range = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 } as CellRange;
    const selectionData = createMockSelectionDataSource({
      ranges: [range],
      activeCell: { row: 0, col: 0 },
    });

    const positionIndex = createTestPositionIndex();
    const mergeIndex = createMockMergeIndex();
    const sheetData = createMockSheetDataSource();
    const ctx = createMockContext();

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    layer.render(ctx, createRegion(), createFrame());

    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalled();
  });

  it('should still fill non-active single-cell ranges in a multi-selection', () => {
    const activeRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 } as CellRange;
    const otherRange = { startRow: 2, startCol: 2, endRow: 2, endCol: 2 } as CellRange;
    const selectionData = createMockSelectionDataSource({
      ranges: [activeRange, otherRange],
      activeCell: { row: 0, col: 0 },
    });

    const positionIndex = createTestPositionIndex();
    const mergeIndex = createMockMergeIndex();
    const sheetData = createMockSheetDataSource();
    const ctx = createMockContext();

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    layer.render(ctx, createRegion(), createFrame());

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
  });

  it('should only suppress fill for clipboard-matching ranges, not all ranges', () => {
    const copyRange = { startRow: 0, startCol: 0, endRow: 2, endCol: 2 } as CellRange;
    const otherRange = { startRow: 5, startCol: 5, endRow: 7, endCol: 7 } as CellRange;

    const selectionData = createMockSelectionDataSource({
      ranges: [copyRange, otherRange],
      activeCell: { row: 0, col: 0 },
      clipboard: {
        hasCopy: true,
        copySource: [copyRange],
      },
    });

    const positionIndex = createTestPositionIndex();
    const mergeIndex = createMockMergeIndex();
    const sheetData = createMockSheetDataSource({ showCutCopyIndicator: true });
    const ctx = createMockContext();

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    layer.render(ctx, createRegion(), createFrame());

    // fillRect should be called for the non-clipboard range but not the clipboard one.
    // The non-clipboard range calls fillRect (via fillRectWithHole which uses fillRect).
    expect(ctx.fillRect).toHaveBeenCalled();

    // strokeRect should be called — once for the non-clipboard selection border,
    // plus once for the active cell border
    expect(ctx.strokeRect).toHaveBeenCalled();
  });

  it('should NOT suppress fill when showCutCopyIndicator is false', () => {
    const copyRange = { startRow: 0, startCol: 0, endRow: 2, endCol: 2 } as CellRange;
    const selectionData = createMockSelectionDataSource({
      ranges: [copyRange],
      activeCell: { row: 0, col: 0 },
      clipboard: {
        hasCopy: true,
        copySource: [copyRange],
      },
    });

    const positionIndex = createTestPositionIndex();
    const mergeIndex = createMockMergeIndex();
    const sheetData = createMockSheetDataSource({ showCutCopyIndicator: false });
    const ctx = createMockContext();

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    layer.render(ctx, createRegion(), createFrame());

    // Fill should still render because showCutCopyIndicator is false
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('should suppress fill for cut source ranges too', () => {
    const cutRange = { startRow: 1, startCol: 1, endRow: 3, endCol: 3 } as CellRange;
    const selectionData = createMockSelectionDataSource({
      ranges: [cutRange],
      activeCell: { row: 1, col: 1 },
      clipboard: {
        hasCut: true,
        cutSource: [cutRange],
      },
    });

    const positionIndex = createTestPositionIndex();
    const mergeIndex = createMockMergeIndex();
    const sheetData = createMockSheetDataSource({ showCutCopyIndicator: true });
    const ctx = createMockContext();

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    layer.render(ctx, createRegion(), createFrame());

    // fillRect should NOT be called for the selection range (suppressed by cut)
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('should still render active cell border when copy is active', () => {
    // Single-cell selection matching the copy source
    const copyRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 } as CellRange;
    const selectionData = createMockSelectionDataSource({
      ranges: [copyRange],
      activeCell: { row: 0, col: 0 },
      clipboard: {
        hasCopy: true,
        copySource: [copyRange],
      },
    });

    const positionIndex = createTestPositionIndex();
    const mergeIndex = createMockMergeIndex();
    const sheetData = createMockSheetDataSource({ showCutCopyIndicator: true });
    const ctx = createMockContext();

    const layer = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);
    layer.render(ctx, createRegion(), createFrame());

    // Selection fill should be suppressed
    expect(ctx.fillRect).not.toHaveBeenCalled();

    // But active cell border (step 4 in render) should still render via strokeRect
    expect(ctx.strokeRect).toHaveBeenCalled();
  });
});
