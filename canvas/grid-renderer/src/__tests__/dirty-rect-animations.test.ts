/**
 * Dirty Rect Animation Tests
 *
 * Validates that animated elements (marching ants, remote cursors) emit
 * targeted dirty rect hints instead of full-layer repaints.
 *
 * Dirty tracking optimization.
 *
 * @module grid-renderer/__tests__/dirty-rect-animations
 */

import { jest } from '@jest/globals';

import type { AnimationClock, DirtyHint } from '@mog/canvas-engine';
import type {
  CollaborationDataSource,
  RemoteCursor,
  SelectionDataSource,
  SheetDataSource,
} from '@mog-sdk/contracts/rendering';
import { DEFAULT_RESOLVED_SHEET_VIEW_SKIN } from '@mog-sdk/contracts/rendering';

import { DEFAULT_CHROME_THEME } from '../shared/constants';
import { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { UILayer } from '../layers/ui';
import { RemoteCursorsLayer } from '../layers/remote-cursors';

// =============================================================================
// Test Helpers
// =============================================================================

function createTestPositionIndex(
  opts: { defaultRowHeight?: number; defaultColWidth?: number } = {},
): ViewportPositionIndex {
  const defaultRowHeight = opts.defaultRowHeight ?? 25;
  const defaultColWidth = opts.defaultColWidth ?? 100;
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

function createMockAnimationClock(): AnimationClock {
  return {
    requestContinuousFrames: jest.fn(),
    stopContinuousFrames: jest.fn(),
  };
}

function createMockSelectionDataSource(
  opts: {
    hasCopy?: boolean;
    hasCut?: boolean;
    copySource?: Array<{
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
    }>;
    cutSource?: Array<{
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
    }>;
    sourceSheetId?: string | null;
  } = {},
): SelectionDataSource {
  return {
    getSelectionState: () =>
      ({
        ranges: [],
        activeCell: { row: 0, col: 0 },
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
    getClipboardState: () => ({
      hasCopy: opts.hasCopy ?? false,
      hasCut: opts.hasCut ?? false,
      copySource: opts.copySource ?? null,
      cutSource: opts.cutSource ?? null,
      isPasting: false,
      sourceSheetId: opts.sourceSheetId ?? null,
    }),
    getSearchHighlights: () => [],
    getPastePreview: () => null,
    getDragDropState: () => null,
    getTablePreviewRange: () => null,
    hasError: () => false,
  };
}

function createMockSheetDataSource(): SheetDataSource {
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
  };
}

function createMockCollaborationDataSource(cursors: RemoteCursor[] = []): CollaborationDataSource {
  return {
    getRemoteCursors: () => cursors,
  };
}

function createRemoteCursor(overrides: Partial<RemoteCursor> = {}): RemoteCursor {
  return {
    clientId: 1,
    user: { id: 'user1', name: 'Alice', color: '#ff0000' },
    selection: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
    activeCell: { row: 0, col: 0 },
    sheetId: 'sheet1',
    isEditing: false,
    ...overrides,
  };
}

// =============================================================================
// Tests: Marching Ants Dirty Rect
// =============================================================================

describe('Marching Ants Dirty Rect', () => {
  it('should return targeted rect hint when marching ants are active with copy source', () => {
    const positionIndex = createTestPositionIndex();
    const selectionData = createMockSelectionDataSource({
      hasCopy: true,
      copySource: [{ startRow: 2, startCol: 1, endRow: 5, endCol: 3 }],
      sourceSheetId: 'sheet1',
    });
    const sheetData = createMockSheetDataSource();
    const animationClock = createMockAnimationClock();

    const uiLayer = new UILayer(selectionData, sheetData, positionIndex, animationClock);

    // Simulate marching ants becoming active
    // The ants become active in render() when showCutCopyIndicator and clipboard state match.
    // For getContinuousFrameDirtyHint, we need the marchingAnts.isActive flag.
    // Force it active by accessing the private state through the render path.
    // Instead, let's trigger render to activate the ants, then test the hint.

    const ctx = createMinimalMockContext();
    const region = {
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

    const frame = {
      timestamp: 16.67,
      canvasSize: { width: 1000, height: 600 },
      dpr: 1,
      frameNumber: 1,
    };

    // First render activates marching ants
    uiLayer.render(ctx, region, frame);

    const hint = uiLayer.getContinuousFrameDirtyHint();

    expect(hint.type).toBe('rects');
    if (hint.type === 'rects') {
      expect(hint.bounds.length).toBe(1);

      const rect = hint.bounds[0];
      // The copy range is rows 2-5, cols 1-3.
      // With defaultRowHeight=25, defaultColWidth=100:
      // top = row 2 * 25 = 50, bottom = (row 5 + 1) * 25 = 150
      // left = col 1 * 100 = 100, right = (col 3 + 1) * 100 = 400
      // Padding = marchingAntsLineWidth(1) + 3 = 4
      expect(rect.x).toBe(100 - 4);
      expect(rect.y).toBe(50 - 4);
      expect(rect.width).toBe(300 + 8);
      expect(rect.height).toBe(100 + 8);
    }

    uiLayer.dispose();
  });

  it('should return targeted rect hint for cut source', () => {
    const positionIndex = createTestPositionIndex();
    const selectionData = createMockSelectionDataSource({
      hasCut: true,
      cutSource: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      sourceSheetId: 'sheet1',
    });
    const sheetData = createMockSheetDataSource();
    const animationClock = createMockAnimationClock();

    const uiLayer = new UILayer(selectionData, sheetData, positionIndex, animationClock);

    // Activate ants via render
    const ctx = createMinimalMockContext();
    const region = {
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

    uiLayer.render(ctx, region, {
      timestamp: 16.67,
      canvasSize: { width: 1000, height: 600 },
      dpr: 1,
      frameNumber: 1,
    });

    const hint = uiLayer.getContinuousFrameDirtyHint();

    expect(hint.type).toBe('rects');
    if (hint.type === 'rects') {
      expect(hint.bounds.length).toBe(1);
      const rect = hint.bounds[0];
      // Single cell at (0,0): top=0, left=0, width=100, height=25
      expect(rect.x).toBe(0 - 4);
      expect(rect.y).toBe(0 - 4);
      expect(rect.width).toBe(100 + 8);
      expect(rect.height).toBe(25 + 8);
    }

    uiLayer.dispose();
  });

  it('should return full hint when marching ants are not active', () => {
    const positionIndex = createTestPositionIndex();
    const selectionData = createMockSelectionDataSource(); // no clipboard
    const sheetData = createMockSheetDataSource();
    const animationClock = createMockAnimationClock();

    const uiLayer = new UILayer(selectionData, sheetData, positionIndex, animationClock);

    const hint = uiLayer.getContinuousFrameDirtyHint();
    expect(hint.type).toBe('full');

    uiLayer.dispose();
  });

  it('should return multiple rects for multiple clipboard ranges', () => {
    const positionIndex = createTestPositionIndex();
    const selectionData = createMockSelectionDataSource({
      hasCopy: true,
      copySource: [
        { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
        { startRow: 5, startCol: 5, endRow: 6, endCol: 6 },
      ],
      sourceSheetId: 'sheet1',
    });
    const sheetData = createMockSheetDataSource();
    const animationClock = createMockAnimationClock();

    const uiLayer = new UILayer(selectionData, sheetData, positionIndex, animationClock);

    // Activate ants
    const ctx = createMinimalMockContext();
    const region = {
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

    uiLayer.render(ctx, region, {
      timestamp: 16.67,
      canvasSize: { width: 1000, height: 600 },
      dpr: 1,
      frameNumber: 1,
    });

    const hint = uiLayer.getContinuousFrameDirtyHint();

    expect(hint.type).toBe('rects');
    if (hint.type === 'rects') {
      expect(hint.bounds.length).toBe(2);
    }

    uiLayer.dispose();
  });
});

// =============================================================================
// Tests: Remote Cursor Dirty Rect
// =============================================================================

describe('Remote Cursor Dirty Rect', () => {
  it('should emit targeted rect hint when cursors change', () => {
    const positionIndex = createTestPositionIndex();
    const initialCursors: RemoteCursor[] = [];
    const collaboration = createMockCollaborationDataSource(initialCursors);

    const layer = new RemoteCursorsLayer(collaboration, positionIndex);
    layer.markClean();

    // Move cursor in: new cursor at row 3, col 2
    const newCursor = createRemoteCursor({
      activeCell: { row: 3, col: 2 },
      selection: [{ startRow: 3, startCol: 2, endRow: 3, endCol: 2 }],
    });
    const newCollaboration = createMockCollaborationDataSource([newCursor]);
    layer.setCollaboration(newCollaboration);

    expect(layer.isDirty()).toBe(true);

    // The dirty hint should be 'rects' (targeted), not 'full'
    const dirtyRects = layer.getDirtyRects();
    // Since we went from 0 cursors to 1 cursor, we should have rect(s)
    // for the new cursor position (selection rect + active cell with label)
    expect(dirtyRects.length).toBeGreaterThan(0);
    expect(layer.isFullDirty()).toBe(false);
  });

  it('should include old and new cursor positions on cursor move', () => {
    const positionIndex = createTestPositionIndex();
    const cursor1 = createRemoteCursor({
      activeCell: { row: 0, col: 0 },
      selection: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
    });
    const collaboration1 = createMockCollaborationDataSource([cursor1]);

    const layer = new RemoteCursorsLayer(collaboration1, positionIndex);
    layer.markClean();

    // Move cursor to row 5, col 3
    const cursor2 = createRemoteCursor({
      activeCell: { row: 5, col: 3 },
      selection: [{ startRow: 5, startCol: 3, endRow: 5, endCol: 3 }],
    });
    const collaboration2 = createMockCollaborationDataSource([cursor2]);
    layer.setCollaboration(collaboration2);

    expect(layer.isDirty()).toBe(true);
    expect(layer.isFullDirty()).toBe(false);

    const rects = layer.getDirtyRects();
    // Should have rects for old position (erase) and new position (paint)
    // Each cursor contributes: selection rects + active cell w/ label
    // Old: 1 selection rect + 1 active cell rect = 2
    // New: 1 selection rect + 1 active cell rect = 2
    expect(rects.length).toBe(4);
  });

  it('should fall back to full dirty when dimensions change', () => {
    const positionIndex = createTestPositionIndex();
    const collaboration = createMockCollaborationDataSource([]);

    const layer = new RemoteCursorsLayer(collaboration, positionIndex);
    layer.markClean();

    // Changing dimensions triggers full dirty (can't compute rect without old dims)
    const newPositionIndex = createTestPositionIndex({ defaultColWidth: 120 });
    layer.setDimensions(newPositionIndex);

    expect(layer.isDirty()).toBe(true);
    expect(layer.isFullDirty()).toBe(true);
  });

  it('should handle multiple cursors disappearing', () => {
    const positionIndex = createTestPositionIndex();
    const cursor1 = createRemoteCursor({
      clientId: 1,
      activeCell: { row: 0, col: 0 },
      selection: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
    });
    const cursor2 = createRemoteCursor({
      clientId: 2,
      user: { id: 'user2', name: 'Bob', color: '#00ff00' },
      activeCell: { row: 10, col: 5 },
      selection: [{ startRow: 10, startCol: 5, endRow: 10, endCol: 5 }],
    });
    const collaboration1 = createMockCollaborationDataSource([cursor1, cursor2]);

    const layer = new RemoteCursorsLayer(collaboration1, positionIndex);
    layer.markClean();

    // All cursors leave
    const collaboration2 = createMockCollaborationDataSource([]);
    layer.setCollaboration(collaboration2);

    expect(layer.isDirty()).toBe(true);
    expect(layer.isFullDirty()).toBe(false);

    const rects = layer.getDirtyRects();
    // Should have rects for old cursor positions only (erasing them)
    // cursor1: 1 sel + 1 active = 2, cursor2: 1 sel + 1 active = 2
    expect(rects.length).toBe(4);
  });
});

// =============================================================================
// Tests: Render Loop Integration
// =============================================================================

describe('Continuous Frame Dirty Hint Integration', () => {
  it('getContinuousFrameDirtyHint should be callable on UILayer', () => {
    const positionIndex = createTestPositionIndex();
    const selectionData = createMockSelectionDataSource();
    const sheetData = createMockSheetDataSource();
    const animationClock = createMockAnimationClock();

    const uiLayer = new UILayer(selectionData, sheetData, positionIndex, animationClock);

    // The method exists and returns a valid DirtyHint
    const hint = uiLayer.getContinuousFrameDirtyHint();
    expect(hint).toBeDefined();
    expect(['full', 'rects', 'rect', 'regions']).toContain(hint.type);

    uiLayer.dispose();
  });
});

// =============================================================================
// Minimal Mock Context
// =============================================================================

function createMinimalMockContext(): CanvasRenderingContext2D {
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
