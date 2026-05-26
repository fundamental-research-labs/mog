/**
 * Shimmer Effect Rendering Tests
 *
 * Validates UILayer shimmer fade rendering, animation lifecycle,
 * and configuration handling.
 */

import { jest } from '@jest/globals';

import type { AnimationClock, FrameContext, RenderRegion } from '@mog/canvas-engine';
import type {
  GridRegionMeta,
  SelectionDataSource,
  SheetDataSource,
  ShimmerEntry,
} from '@mog-sdk/contracts/rendering';
import { DEFAULT_RESOLVED_SHEET_VIEW_SKIN } from '@mog-sdk/contracts/rendering';

import { DEFAULT_CHROME_THEME } from '../../shared/constants';
import { ViewportPositionIndex } from '../../coordinates/viewport-position-index';
import { UILayer } from '../ui';

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

function createMockAnimationClock(): AnimationClock {
  return {
    requestContinuousFrames: jest.fn(),
    stopContinuousFrames: jest.fn(),
  };
}

function createMockSelectionDataSource(): SelectionDataSource {
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
      hasCopy: false,
      hasCut: false,
      copySource: null,
      cutSource: null,
      isPasting: false,
      sourceSheetId: null,
    }),
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
    shimmerEntries: [],
    shimmerEffect: 'fade',
    shimmerDurationMs: 800,
    shimmerColor: '#4285F4',
    shimmerMaxOpacity: 0.2,
    shimmerEnabled: true,
    ...overrides,
  };
}

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

function createRegion(sheetId = 'sheet1'): RenderRegion<GridRegionMeta> {
  return {
    id: 'main',
    bounds: { x: 0, y: 0, width: 1000, height: 600 },
    viewportOrigin: { x: 0, y: 0 },
    scrollOffset: { x: 0, y: 0 },
    zoom: 1.0,
    metadata: {
      sheetId,
      cellRange: { startRow: 0, startCol: 0, endRow: 20, endCol: 10 },
      isFrozen: false,
      scrollBehavior: 'free',
    },
  } as any;
}

function createFrame(timestamp: number): FrameContext {
  return {
    timestamp,
    canvasSize: { width: 1000, height: 600 },
    dpr: 1,
    frameNumber: 1,
  };
}

function createShimmerEntry(overrides: Partial<ShimmerEntry> = {}): ShimmerEntry {
  return {
    range: { startRow: 1, startCol: 1, endRow: 3, endCol: 2 },
    startTime: 1000,
    sheetId: 'sheet1',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('UILayer Shimmer Rendering', () => {
  it('renders fade at progress=0 with correct color and opacity', () => {
    const now = 1000;
    const entry = createShimmerEntry({ startTime: now });
    const sheetData = createMockSheetDataSource({ shimmerEntries: [entry] });
    const animationClock = createMockAnimationClock();
    const uiLayer = new UILayer(
      createMockSelectionDataSource(),
      sheetData,
      createTestPositionIndex(),
      animationClock,
    );

    const ctx = createMinimalMockContext();
    uiLayer.render(ctx, createRegion(), createFrame(now));

    // fillRect should have been called for the shimmer (among other potential calls)
    const fillRectCalls = (ctx.fillRect as jest.Mock).mock.calls;
    expect(fillRectCalls.length).toBeGreaterThan(0);

    // Check that fillStyle was set to the shimmer color with ~maxOpacity alpha
    // At progress=0, alpha = maxOpacity * (1 - 0) = 0.2
    // Color #4285F4 = rgb(66, 133, 244)
    expect(ctx.fillStyle).toMatch(/rgba\(66, 133, 244, 0\.200\)/);

    uiLayer.dispose();
  });

  it('renders fade at progress=0.5 with eased opacity', () => {
    const startTime = 1000;
    const entry = createShimmerEntry({ startTime });
    const sheetData = createMockSheetDataSource({
      shimmerEntries: [entry],
      shimmerDurationMs: 800,
    });
    const animationClock = createMockAnimationClock();
    const uiLayer = new UILayer(
      createMockSelectionDataSource(),
      sheetData,
      createTestPositionIndex(),
      animationClock,
    );

    const ctx = createMinimalMockContext();
    // At 400ms into 800ms duration = progress 0.5
    uiLayer.render(ctx, createRegion(), createFrame(startTime + 400));

    // alpha = 0.2 * (1 - 0.5^2) = 0.15
    expect(ctx.fillStyle).toMatch(/rgba\(66, 133, 244, 0\.150\)/);

    uiLayer.dispose();
  });

  it('does NOT render expired entries', () => {
    const startTime = 1000;
    const entry = createShimmerEntry({ startTime });
    const sheetData = createMockSheetDataSource({
      shimmerEntries: [entry],
      shimmerDurationMs: 800,
    });
    const animationClock = createMockAnimationClock();
    const uiLayer = new UILayer(
      createMockSelectionDataSource(),
      sheetData,
      createTestPositionIndex(),
      animationClock,
    );

    const ctx = createMinimalMockContext();
    // Render at 900ms — past the 800ms duration
    uiLayer.render(ctx, createRegion(), createFrame(startTime + 900));

    // fillRect should NOT be called for shimmer (no active entries)
    // fillStyle should not contain shimmer color
    const fillStyleStr = String(ctx.fillStyle);
    expect(fillStyleStr).not.toMatch(/rgba\(66, 133, 244/);

    uiLayer.dispose();
  });

  it('skips entries for wrong sheetId', () => {
    const now = 1000;
    const entry = createShimmerEntry({ startTime: now, sheetId: 'other-sheet' });
    const sheetData = createMockSheetDataSource({ shimmerEntries: [entry] });
    const animationClock = createMockAnimationClock();
    const uiLayer = new UILayer(
      createMockSelectionDataSource(),
      sheetData,
      createTestPositionIndex(),
      animationClock,
    );

    const ctx = createMinimalMockContext();
    uiLayer.render(ctx, createRegion('sheet1'), createFrame(now));

    const fillStyleStr = String(ctx.fillStyle);
    expect(fillStyleStr).not.toMatch(/rgba\(66, 133, 244/);

    uiLayer.dispose();
  });

  it('requests continuous frames when active entries exist', () => {
    const now = 1000;
    const entry = createShimmerEntry({ startTime: now });
    const sheetData = createMockSheetDataSource({ shimmerEntries: [entry] });
    const animationClock = createMockAnimationClock();
    const uiLayer = new UILayer(
      createMockSelectionDataSource(),
      sheetData,
      createTestPositionIndex(),
      animationClock,
    );

    const ctx = createMinimalMockContext();
    uiLayer.render(ctx, createRegion(), createFrame(now));

    expect(animationClock.requestContinuousFrames).toHaveBeenCalledWith('ui');

    uiLayer.dispose();
  });

  it('does NOT request continuous frames when all entries expired', () => {
    const startTime = 1000;
    const entry = createShimmerEntry({ startTime });
    const sheetData = createMockSheetDataSource({
      shimmerEntries: [entry],
      shimmerDurationMs: 800,
    });
    const animationClock = createMockAnimationClock();
    const uiLayer = new UILayer(
      createMockSelectionDataSource(),
      sheetData,
      createTestPositionIndex(),
      animationClock,
    );

    const ctx = createMinimalMockContext();
    uiLayer.render(ctx, createRegion(), createFrame(startTime + 900));

    // requestContinuousFrames should not be called for shimmer
    // (it may be called for marching ants, but not with 'ui' for shimmer)
    // Since there are no active entries, the shimmer block doesn't call it.
    // However, marching ants may call stopContinuousFrames. Just verify
    // requestContinuousFrames was not called.
    expect(animationClock.requestContinuousFrames).not.toHaveBeenCalled();

    uiLayer.dispose();
  });

  it('shimmerEnabled=false suppresses all rendering', () => {
    const now = 1000;
    const entry = createShimmerEntry({ startTime: now });
    const sheetData = createMockSheetDataSource({
      shimmerEntries: [entry],
      shimmerEnabled: false,
    });
    const animationClock = createMockAnimationClock();
    const uiLayer = new UILayer(
      createMockSelectionDataSource(),
      sheetData,
      createTestPositionIndex(),
      animationClock,
    );

    const ctx = createMinimalMockContext();
    uiLayer.render(ctx, createRegion(), createFrame(now));

    const fillStyleStr = String(ctx.fillStyle);
    expect(fillStyleStr).not.toMatch(/rgba\(66, 133, 244/);

    uiLayer.dispose();
  });

  it('renders multiple entries independently', () => {
    const now = 1000;
    const entry1 = createShimmerEntry({
      startTime: now,
      range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
    });
    const entry2 = createShimmerEntry({
      startTime: now,
      range: { startRow: 5, startCol: 5, endRow: 5, endCol: 5 },
    });
    const sheetData = createMockSheetDataSource({
      shimmerEntries: [entry1, entry2],
    });
    const animationClock = createMockAnimationClock();
    const uiLayer = new UILayer(
      createMockSelectionDataSource(),
      sheetData,
      createTestPositionIndex(),
      animationClock,
    );

    const ctx = createMinimalMockContext();
    uiLayer.render(ctx, createRegion(), createFrame(now));

    // fillRect called at least twice (once per shimmer entry)
    const fillRectCalls = (ctx.fillRect as jest.Mock).mock.calls;
    expect(fillRectCalls.length).toBeGreaterThanOrEqual(2);

    uiLayer.dispose();
  });

  it('uses custom shimmerColor', () => {
    const now = 1000;
    const entry = createShimmerEntry({ startTime: now });
    const sheetData = createMockSheetDataSource({
      shimmerEntries: [entry],
      shimmerColor: '#FF0000',
    });
    const animationClock = createMockAnimationClock();
    const uiLayer = new UILayer(
      createMockSelectionDataSource(),
      sheetData,
      createTestPositionIndex(),
      animationClock,
    );

    const ctx = createMinimalMockContext();
    uiLayer.render(ctx, createRegion(), createFrame(now));

    expect(ctx.fillStyle).toMatch(/rgba\(255, 0, 0, 0\.200\)/);

    uiLayer.dispose();
  });

  it('respects custom shimmerMaxOpacity', () => {
    const now = 1000;
    const entry = createShimmerEntry({ startTime: now });
    const sheetData = createMockSheetDataSource({
      shimmerEntries: [entry],
      shimmerMaxOpacity: 0.5,
    });
    const animationClock = createMockAnimationClock();
    const uiLayer = new UILayer(
      createMockSelectionDataSource(),
      sheetData,
      createTestPositionIndex(),
      animationClock,
    );

    const ctx = createMinimalMockContext();
    uiLayer.render(ctx, createRegion(), createFrame(now));

    // At progress=0, alpha = 0.5 * (1 - 0) = 0.5
    expect(ctx.fillStyle).toMatch(/rgba\(66, 133, 244, 0\.500\)/);

    uiLayer.dispose();
  });
});
