/**
 * CellsLayer integration tests.
 *
 * Tests the full rendering pipeline: layout → region metadata → reader
 * resolution → cell rendering. The critical invariant is that every
 * RenderRegion produced by the layout pipeline (computeViewportLayout
 * → viewportLayoutToRegionLayout) carries a `viewportId` in its metadata,
 * which the cells layer uses to resolve a BinaryCellReader via the
 * per-viewport resolver. Without viewportId, the resolver can't find a
 * reader and the binary-buffer guard silently skips all cell rendering.
 *
 * This test suite would have caught the regression where `layout` was
 * passed to `setViewportLayout()` instead of `composedLayout` — the
 * regions lost their viewportId, breaking the entire rendering chain.
 */

import { jest } from '@jest/globals';

import type { FrameContext, RenderRegion, TextMeasurer } from '@mog/canvas-engine';
import type { CellFormat, FormattedText } from '@mog-sdk/contracts/core';
import { asFormattedText, toCellId } from '@mog-sdk/contracts/core';
import type {
  CellDataSource,
  GridRegionMeta,
  InteractiveElement,
  InteractiveElementCollector,
  SelectionDataSource,
} from '@mog-sdk/contracts/rendering';

import { ViewportMergeIndex } from '../../coordinates/viewport-merge-index';
import { ViewportPositionIndex } from '../../coordinates/viewport-position-index';
import { NULL_CELL_DATA_SOURCE, NULL_SHEET_DATA_SOURCE } from '../../data/defaults';
import type { BinaryCellReader, CellsLayerConfig } from '../cells';
import { createCellsLayer } from '../cells';

/**
 * Test fixture: build a single 'main' RenderRegion with a viewportId. This
 * replaces the orphan `computeGridLayout` for cells-layer tests that only
 * need a region with proper viewportId metadata. Inline RenderRegion literals
 * are allowlisted in test files by the coordinate-boundary lint rule.
 */
function makeMainRegion(opts: {
  sheetId: string;
  viewportId?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  viewportOrigin?: { x: number; y: number };
  scrollOffset?: { x: number; y: number };
  zoom?: number;
  cellRange?: GridRegionMeta['cellRange'];
}): RenderRegion<GridRegionMeta> {
  return {
    id: opts.viewportId ?? 'main',
    bounds: opts.bounds ?? { x: 50, y: 21, width: 950, height: 579 },
    viewportOrigin: opts.viewportOrigin ?? { x: 0, y: 0 },
    scrollOffset: opts.scrollOffset ?? { x: 0, y: 0 },
    zoom: opts.zoom ?? 1.0,
    metadata: {
      sheetId: opts.sheetId,
      cellRange: opts.cellRange ?? { startRow: 0, startCol: 0, endRow: 30, endCol: 20 },
      isFrozen: false,
      scrollBehavior: 'free',
      viewportId: opts.viewportId ?? 'main',
    },
  };
}

// =============================================================================
// Mock Helpers
// =============================================================================

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
  (ctx.measureText as jest.Mock).mockReturnValue({
    width: 50,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 3,
    fontBoundingBoxAscent: 12,
    fontBoundingBoxDescent: 4,
  });
  (ctx.getLineDash as jest.Mock).mockReturnValue([]);
  const mockGradient = { addColorStop: jest.fn() };
  (ctx.createLinearGradient as jest.Mock).mockReturnValue(mockGradient);
  (ctx.createRadialGradient as jest.Mock).mockReturnValue(mockGradient);

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

const DEFAULT_FORMAT: CellFormat = {};

interface MockCellData {
  valueType?: number;
  numberValue?: number;
  displayText?: string;
  errorText?: string;
  format?: CellFormat;
  hasHyperlink?: boolean;
  isCheckbox?: boolean;
  hasComment?: boolean;
  hasSparkline?: boolean;
  hasFormula?: boolean;
  isProjectedPosition?: boolean;
  hasValidationError?: boolean;
}

function createMockReader(cells: Map<string, MockCellData>): BinaryCellReader {
  let currentCell: MockCellData = {};

  return {
    moveTo(row: number, col: number): boolean {
      const key = `${row},${col}`;
      const cell = cells.get(key);
      if (!cell) return false;
      currentCell = cell;
      return true;
    },
    get valueType() {
      return currentCell.valueType ?? 0;
    },
    get numberValue() {
      return currentCell.numberValue ?? 0;
    },
    get displayText(): FormattedText | null {
      return currentCell.displayText != null ? asFormattedText(currentCell.displayText) : null;
    },
    get errorText() {
      return currentCell.errorText ?? null;
    },
    get format() {
      return currentCell.format ?? DEFAULT_FORMAT;
    },
    get hasFormula() {
      return currentCell.hasFormula ?? false;
    },
    get hasComment() {
      return currentCell.hasComment ?? false;
    },
    get hasSparkline() {
      return currentCell.hasSparkline ?? false;
    },
    get hasHyperlink() {
      return currentCell.hasHyperlink ?? false;
    },
    get isCheckbox() {
      return currentCell.isCheckbox ?? false;
    },
    get isProjectedPosition() {
      return currentCell.isProjectedPosition ?? false;
    },
    get hasValidationError() {
      return currentCell.hasValidationError ?? false;
    },
    getBgColorOverride() {
      return null;
    },
    getFontColorOverride() {
      return null;
    },
    getDataBar() {
      return null;
    },
    getIcon() {
      return null;
    },
    isCellEmpty(row: number, col: number) {
      const key = `${row},${col}`;
      const cell = cells.get(key);
      if (!cell) return true;
      return cell.valueType === 0 || cell.valueType === undefined;
    },
    peekFormat(row: number, col: number) {
      const key = `${row},${col}`;
      const cell = cells.get(key);
      return cell?.format;
    },
  };
}

function createPositionIndex(rows = 100, cols = 26, rowHeight = 25): ViewportPositionIndex {
  const pi = new ViewportPositionIndex(rowHeight, 100);
  const rowPositions = new Float64Array(rows);
  for (let i = 0; i < rows; i++) rowPositions[i] = i * rowHeight;
  const colPositions = new Float64Array(cols);
  for (let i = 0; i < cols; i++) colPositions[i] = i * 100;
  pi.setPositions(rowPositions, colPositions, 0, 0);
  pi.setTotalDimensions(rows, cols);
  return pi;
}

function createSelectionData(overrides?: {
  isEditing?: boolean;
  editingRow?: number;
  editingCol?: number;
}): SelectionDataSource {
  return {
    getSelectionState: () => ({
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
    }),
    getEditorState: () => ({
      isEditing: overrides?.isEditing ?? false,
      isFormulaEditing: false,
      editingCell: overrides?.isEditing
        ? { row: overrides.editingRow ?? 0, col: overrides.editingCol ?? 0 }
        : null,
      sheetId: null,
      mergeBounds: null,
      value: '',
      hasConflict: false,
      isIMEComposing: false,
    }),
    getClipboardState: () => ({
      hasCopy: false,
      hasCut: false,
      cutSource: null,
      copySource: null,
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

function createTextMeasurer(): TextMeasurer {
  return {
    measureText: () =>
      ({
        width: 50,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 3,
        fontBoundingBoxAscent: 12,
        fontBoundingBoxDescent: 4,
      }) as TextMetrics,
    measureWrappedText: () => ({
      lines: ['test'],
      totalHeight: 14,
      lineHeight: 14,
    }),
  };
}

function createFrame(): FrameContext {
  return {
    timestamp: 16.67,
    canvasSize: { width: 1000, height: 600 },
    dpr: 1,
    frameNumber: 1,
  };
}

function createLayerConfig(overrides: Partial<CellsLayerConfig> = {}): CellsLayerConfig {
  return {
    cellData: NULL_CELL_DATA_SOURCE,
    sheetData: NULL_SHEET_DATA_SOURCE,
    selectionData: createSelectionData(),
    positionIndex: createPositionIndex(),
    mergeIndex: new ViewportMergeIndex(),
    textMeasurer: createTextMeasurer(),
    ...overrides,
  };
}

function createInteractiveElementCollector(): InteractiveElementCollector {
  const elements = new Map<string, InteractiveElement>();
  return {
    clear: jest.fn(() => {
      elements.clear();
    }),
    add: jest.fn((element: InteractiveElement) => {
      elements.set(element.id, element);
    }),
    getAll: () => Array.from(elements.values()),
    subscribe: () => () => undefined,
  };
}

/** Extract all text strings passed to ctx.fillText() */
function getRenderedTexts(ctx: CanvasRenderingContext2D): string[] {
  return (ctx.fillText as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string);
}

// =============================================================================
// Tests
// =============================================================================

describe('CellsLayer', () => {
  // ===========================================================================
  // INTEGRATION: Layout → Reader Resolution → Cell Rendering
  //
  // These tests exercise the critical path that broke: every RenderRegion
  // produced by the layout pipeline must carry a viewportId in metadata,
  // which the cells layer uses to resolve a BinaryCellReader via
  // binaryCellReaderForViewport. If viewportId is missing from the region
  // (e.g., wrong layout variable passed), the resolver returns undefined,
  // the binary-buffer guard triggers, and ALL cell rendering is silently skipped.
  // ===========================================================================

  describe('layout → viewport reader resolution', () => {
    const SHEET_ID = 'sheet-abc';
    const VIEWPORT_ID = `main:${SHEET_ID}`; // composed ID used in production

    const cellData = new Map<string, MockCellData>([
      ['0,0', { valueType: 1, numberValue: 42, displayText: '42' }],
      ['1,0', { valueType: 2, displayText: 'Hello' }],
      ['2,0', { valueType: 1, numberValue: 3.14, displayText: '3.14' }],
    ]);

    function createReaderForViewport(
      registeredViewportId: string,
      reader: BinaryCellReader,
    ): (viewportId: string) => BinaryCellReader | undefined {
      return (vpId: string) => (vpId === registeredViewportId ? reader : undefined);
    }

    it('renders cells when region carries the composed viewportId (production path)', () => {
      const positionIndex = createPositionIndex();
      const reader = createMockReader(cellData);

      // Region with the composed viewportId (`main:sheet-abc`) — the form
      // the production renderer-execution path stamps onto regions.
      const composedRegion = makeMainRegion({ sheetId: SHEET_ID, viewportId: VIEWPORT_ID });

      // Wire reader through per-viewport resolver ONLY (no binaryCellReader fallback)
      // This matches production: binaryCellReader is often null on first render
      const layer = createCellsLayer(
        createLayerConfig({
          binaryCellReader: undefined,
          binaryCellReaderForViewport: createReaderForViewport(VIEWPORT_ID, reader),
          positionIndex,
        }),
      );

      const ctx = createMockContext();
      layer.render(ctx, composedRegion, createFrame());

      const texts = getRenderedTexts(ctx);
      expect(texts).toContain('42');
      expect(texts).toContain('Hello');
      expect(texts).toContain('3.14');
    });

    it('FAILS to render when region is missing viewportId (the exact regression)', () => {
      const positionIndex = createPositionIndex();
      const reader = createMockReader(cellData);

      const baseRegion = makeMainRegion({ sheetId: SHEET_ID, viewportId: 'main' });

      // Simulate the bug: strip viewportId from region metadata
      // (this is what happened when `layout` was passed instead of `composedLayout`)
      const brokenRegion: RenderRegion<GridRegionMeta> = {
        ...baseRegion,
        metadata: {
          ...baseRegion.metadata,
          viewportId: undefined,
        },
      };

      // Wire reader through per-viewport resolver ONLY (no binaryCellReader fallback)
      const layer = createCellsLayer(
        createLayerConfig({
          binaryCellReader: undefined,
          binaryCellReaderForViewport: createReaderForViewport(VIEWPORT_ID, reader),
          positionIndex,
        }),
      );

      const ctx = createMockContext();
      layer.render(ctx, brokenRegion, createFrame());

      // Without viewportId, the resolver is bypassed, binaryCellReader is undefined,
      // binary-buffer guard fires → NO cells render. This is the regression.
      const texts = getRenderedTexts(ctx);
      expect(texts).not.toContain('42');
      expect(texts).not.toContain('Hello');
      expect(texts).not.toContain('3.14');
    });

    it('FAILS to render when viewportId does not match any registered reader', () => {
      const positionIndex = createPositionIndex();
      const reader = createMockReader(cellData);

      // Region has viewportId 'main' but reader is registered under 'main:sheet-abc'
      // This mismatch happens when composedLayout isn't used
      const bareRegion = makeMainRegion({ sheetId: SHEET_ID, viewportId: 'main' });

      const layer = createCellsLayer(
        createLayerConfig({
          binaryCellReader: undefined,
          binaryCellReaderForViewport: createReaderForViewport(VIEWPORT_ID, reader),
          positionIndex,
        }),
      );

      const ctx = createMockContext();
      layer.render(ctx, bareRegion, createFrame());

      // viewportId is 'main' but reader is registered at 'main:sheet-abc' → no match
      // resolver returns undefined, so the binary-buffer guard → nothing renders
      const texts = getRenderedTexts(ctx);
      expect(texts).not.toContain('42');
      expect(texts).not.toContain('Hello');
    });

    // (Layout-pipeline invariant — every region carries a viewportId — is now
    // covered by canvas/grid-canvas/src/renderer/__tests__/viewport-to-region-layout.test.ts.)
  });

  describe('interactive element collection', () => {
    it('accumulates interactive elements across multiple regions in one frame', () => {
      const sheetId = 'sheet-interactions';
      const cells = new Map<string, MockCellData>([
        ['0,2', { valueType: 2, displayText: 'Vendor' }],
        [
          '1,0',
          {
            valueType: 3,
            numberValue: 1,
            displayText: 'TRUE',
            isCheckbox: true,
            hasComment: true,
          },
        ],
      ]);
      const reader = createMockReader(cells);
      const collector = createInteractiveElementCollector();
      const cellData: CellDataSource = {
        ...NULL_CELL_DATA_SOURCE,
        getFilterHeaderInfo: (_sheetId, cell) =>
          cell.row === 0 && cell.col === 2
            ? {
                filterId: 'auto-filter-1',
                headerCellId: toCellId('header-c'),
                hasActiveFilter: true,
              }
            : undefined,
      };
      const layer = createCellsLayer(
        createLayerConfig({
          binaryCellReader: reader,
          cellData,
          interactiveElements: collector,
          positionIndex: createPositionIndex(),
        }),
      );
      const ctx = createMockContext();
      const frame = createFrame();
      const frozenHeaderRegion = makeMainRegion({
        sheetId,
        viewportId: 'frozen-row',
        cellRange: { startRow: 0, startCol: 2, endRow: 0, endCol: 2 },
      });
      const mainRegion = makeMainRegion({
        sheetId,
        viewportId: 'main',
        cellRange: { startRow: 1, startCol: 0, endRow: 1, endCol: 0 },
      });

      layer.beginFrame(frame);
      layer.render(ctx, frozenHeaderRegion, frame);
      expect(collector.getAll().map((element) => element.id)).toContain(
        `filter-button:${sheetId}:0,2`,
      );

      layer.render(ctx, mainRegion, frame);

      expect(
        collector
          .getAll()
          .map((element) => element.id)
          .sort(),
      ).toEqual([
        `checkbox:${sheetId}:1,0`,
        `comment-indicator:${sheetId}:1,0`,
        `filter-button:${sheetId}:0,2`,
      ]);
      expect(collector.clear).toHaveBeenCalledTimes(1);
    });

    it('emits filter button bounds in viewport coordinates for horizontally scrolled frozen rows', () => {
      const sheetId = 'sheet-filter-button-frozen-row';
      const collector = createInteractiveElementCollector();
      const cellData: CellDataSource = {
        ...NULL_CELL_DATA_SOURCE,
        getFilterHeaderInfo: (_sheetId, cell) =>
          cell.row === 3 && cell.col === 10
            ? {
                filterId: 'auto-filter-1',
                headerCellId: toCellId('header-k'),
                hasActiveFilter: false,
              }
            : undefined,
      };
      const layer = createCellsLayer(
        createLayerConfig({
          binaryCellReader: undefined,
          cellData,
          interactiveElements: collector,
          positionIndex: createPositionIndex(100, 20, 25),
        }),
      );
      const ctx = createMockContext();
      const frozenRowsRegion = makeMainRegion({
        sheetId,
        viewportId: 'frozen-rows',
        viewportOrigin: { x: 800, y: 0 },
        scrollOffset: { x: 200, y: 0 },
        cellRange: { startRow: 3, startCol: 10, endRow: 3, endCol: 10 },
      });

      layer.render(ctx, frozenRowsRegion, createFrame());

      const filterButton = collector
        .getAll()
        .find((element) => element.id === `filter-button:${sheetId}:3,10`);

      expect(filterButton?.bounds).toEqual({
        x: 884,
        y: 79.5,
        width: 16,
        height: 16,
      });
    });

    it('emits zoom-scaled filter button bounds from unscaled cell geometry', () => {
      const sheetId = 'sheet-filter-button-zoomed-frozen-row';
      const collector = createInteractiveElementCollector();
      const cellData: CellDataSource = {
        ...NULL_CELL_DATA_SOURCE,
        getFilterHeaderInfo: (_sheetId, cell) =>
          cell.row === 3 && cell.col === 10
            ? {
                filterId: 'auto-filter-1',
                headerCellId: toCellId('header-k'),
                hasActiveFilter: false,
              }
            : undefined,
      };
      const layer = createCellsLayer(
        createLayerConfig({
          binaryCellReader: undefined,
          cellData,
          interactiveElements: collector,
          positionIndex: createPositionIndex(100, 20, 25),
        }),
      );
      const ctx = createMockContext();
      const frozenRowsRegion = makeMainRegion({
        sheetId,
        viewportId: 'frozen-rows',
        viewportOrigin: { x: 800, y: 0 },
        scrollOffset: { x: 200, y: 0 },
        zoom: 0.9,
        cellRange: { startRow: 3, startCol: 10, endRow: 3, endCol: 10 },
      });

      layer.render(ctx, frozenRowsRegion, createFrame());

      const filterButton = collector
        .getAll()
        .find((element) => element.id === `filter-button:${sheetId}:3,10`);

      expect(filterButton?.bounds).toEqual({
        x: 795.6,
        y: 71.55,
        width: 14.4,
        height: 14.4,
      });
    });

    it('keeps filter button overlays outside dirty cells in partial frames', () => {
      const sheetId = 'sheet-filter-buttons';
      const collector = createInteractiveElementCollector();
      const cellData: CellDataSource = {
        ...NULL_CELL_DATA_SOURCE,
        getFilterHeaderInfo: (_sheetId, cell) =>
          cell.row === 0 && [0, 1, 3, 4].includes(cell.col)
            ? {
                filterId: `table-filter-${cell.col < 2 ? 'left' : 'right'}`,
                headerCellId: toCellId(`header-${cell.col}`),
                hasActiveFilter: false,
              }
            : undefined,
      };
      const layer = createCellsLayer(
        createLayerConfig({
          binaryCellReader: undefined,
          cellData,
          interactiveElements: collector,
          positionIndex: createPositionIndex(),
        }),
      );
      const ctx = createMockContext();
      const region = makeMainRegion({
        sheetId,
        cellRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 4 },
      });

      layer.render(ctx, region, createFrame());
      expect(
        collector
          .getAll()
          .filter((element) => element.type === 'filter-button')
          .map((element) => element.id)
          .sort(),
      ).toEqual([
        `filter-button:${sheetId}:0,0`,
        `filter-button:${sheetId}:0,1`,
        `filter-button:${sheetId}:0,3`,
        `filter-button:${sheetId}:0,4`,
      ]);

      layer.render(ctx, region, {
        ...createFrame(),
        frameNumber: 2,
        dirtyRects: [{ x: 350, y: 21, width: 200, height: 25 } as any],
      });

      expect(
        collector
          .getAll()
          .filter((element) => element.type === 'filter-button')
          .map((element) => element.id)
          .sort(),
      ).toEqual([
        `filter-button:${sheetId}:0,0`,
        `filter-button:${sheetId}:0,1`,
        `filter-button:${sheetId}:0,3`,
        `filter-button:${sheetId}:0,4`,
      ]);
    });
  });

  // ===========================================================================
  // UNIT: Binary reader data extraction
  // ===========================================================================

  describe('binary reader data extraction', () => {
    // Helper: create a region WITH viewportId so the reader resolves
    function createRegionWithViewport(
      cellRange = {
        startRow: 0,
        startCol: 0,
        endRow: 2,
        endCol: 2,
      },
    ): RenderRegion<GridRegionMeta> {
      return {
        id: 'test-vp',
        bounds: { x: 0, y: 0, width: 1000, height: 600 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 0, y: 0 },
        zoom: 1.0,
        metadata: {
          sheetId: 'sheet-1',
          cellRange,
          isFrozen: false,
          scrollBehavior: 'free',
          viewportId: 'test-vp',
        },
      };
    }

    function createLayerWithReader(
      reader: BinaryCellReader,
      overrides?: Partial<CellsLayerConfig>,
    ) {
      return createCellsLayer(
        createLayerConfig({
          binaryCellReader: undefined,
          binaryCellReaderForViewport: (vpId) => (vpId === 'test-vp' ? reader : undefined),
          ...overrides,
        }),
      );
    }

    it('renders display text for number cells', () => {
      const reader = createMockReader(
        new Map([['0,0', { valueType: 1, numberValue: 123.45, displayText: '123.45' }]]),
      );
      const layer = createLayerWithReader(reader);
      const ctx = createMockContext();
      layer.render(ctx, createRegionWithViewport(), createFrame());
      expect(getRenderedTexts(ctx)).toContain('123.45');
    });

    it('renders display text for text cells', () => {
      const reader = createMockReader(
        new Map([['0,0', { valueType: 2, displayText: 'Hello World' }]]),
      );
      const layer = createLayerWithReader(reader);
      const ctx = createMockContext();
      layer.render(ctx, createRegionWithViewport(), createFrame());
      expect(getRenderedTexts(ctx)).toContain('Hello World');
    });

    it('renders explicit line breaks as separate lines without wrapText format', () => {
      const reader = createMockReader(
        new Map([['0,0', { valueType: 2, displayText: 'Line 1\nLine 2\nLine 3' }]]),
      );
      const layer = createLayerWithReader(reader, {
        positionIndex: createPositionIndex(100, 26, 60),
      });
      const ctx = createMockContext();

      layer.render(ctx, createRegionWithViewport(), createFrame());

      const texts = getRenderedTexts(ctx);
      expect(texts).toEqual(expect.arrayContaining(['Line 1', 'Line 2', 'Line 3']));
      expect(texts).not.toContain('Line 1\nLine 2\nLine 3');
    });

    it('renders multiple cells', () => {
      const reader = createMockReader(
        new Map([
          ['0,0', { valueType: 1, numberValue: 1, displayText: 'A' }],
          ['0,1', { valueType: 1, numberValue: 2, displayText: 'B' }],
          ['1,0', { valueType: 1, numberValue: 3, displayText: 'C' }],
          ['1,1', { valueType: 1, numberValue: 4, displayText: 'D' }],
        ]),
      );
      const layer = createLayerWithReader(reader);
      const ctx = createMockContext();
      layer.render(
        ctx,
        createRegionWithViewport({
          startRow: 0,
          startCol: 0,
          endRow: 1,
          endCol: 1,
        }),
        createFrame(),
      );

      const texts = getRenderedTexts(ctx);
      expect(texts).toContain('A');
      expect(texts).toContain('B');
      expect(texts).toContain('C');
      expect(texts).toContain('D');
    });

    it('skips cells where moveTo returns false (rapid scroll)', () => {
      // Reader only knows about (0,0), not (0,1) or (1,0)
      const reader = createMockReader(
        new Map([['0,0', { valueType: 1, numberValue: 42, displayText: '42' }]]),
      );
      const layer = createLayerWithReader(reader);
      const ctx = createMockContext();
      layer.render(ctx, createRegionWithViewport(), createFrame());

      const texts = getRenderedTexts(ctx);
      expect(texts).toContain('42');
      // Other cells silently skipped — no crash
    });

    it('does not render null-value cells', () => {
      const reader = createMockReader(
        new Map([
          ['0,0', { valueType: 0 }], // Null
          ['0,1', { valueType: 1, numberValue: 7, displayText: '7' }],
        ]),
      );
      const layer = createLayerWithReader(reader);
      const ctx = createMockContext();
      layer.render(
        ctx,
        createRegionWithViewport({
          startRow: 0,
          startCol: 0,
          endRow: 0,
          endCol: 1,
        }),
        createFrame(),
      );

      expect(getRenderedTexts(ctx)).toContain('7');
    });

    it('skips editing cell', () => {
      const reader = createMockReader(
        new Map([
          ['0,0', { valueType: 1, numberValue: 42, displayText: '42' }],
          ['0,1', { valueType: 1, numberValue: 99, displayText: '99' }],
        ]),
      );
      const layer = createLayerWithReader(reader, {
        selectionData: createSelectionData({
          isEditing: true,
          editingRow: 0,
          editingCol: 0,
        }),
      });
      const ctx = createMockContext();
      layer.render(
        ctx,
        createRegionWithViewport({
          startRow: 0,
          startCol: 0,
          endRow: 0,
          endCol: 1,
        }),
        createFrame(),
      );

      const texts = getRenderedTexts(ctx);
      expect(texts).not.toContain('42');
      expect(texts).toContain('99');
    });

    it('suppresses zero display when showZeroValues is false', () => {
      const reader = createMockReader(
        new Map([
          ['0,0', { valueType: 1, numberValue: 0, displayText: '0' }],
          ['0,1', { valueType: 1, numberValue: 5, displayText: '5' }],
        ]),
      );
      const layer = createLayerWithReader(reader, {
        cellData: { ...NULL_CELL_DATA_SOURCE, showZeroValues: false },
      });
      const ctx = createMockContext();
      layer.render(
        ctx,
        createRegionWithViewport({
          startRow: 0,
          startCol: 0,
          endRow: 0,
          endCol: 1,
        }),
        createFrame(),
      );

      const texts = getRenderedTexts(ctx);
      expect(texts).not.toContain('0');
      expect(texts).toContain('5');
    });

    it('renders accounting formats as split currency and numeric tokens', () => {
      const accountingFormat = '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)';
      const reader = createMockReader(
        new Map([
          [
            '0,0',
            {
              valueType: 1,
              numberValue: 1234.5,
              displayText: ' $1,234.50 ',
              format: { numberFormat: accountingFormat },
            },
          ],
          [
            '1,0',
            {
              valueType: 1,
              numberValue: -987.65,
              displayText: ' $(987.65)',
              format: { numberFormat: accountingFormat },
            },
          ],
          [
            '2,0',
            {
              valueType: 1,
              numberValue: 0,
              displayText: ' $-   ',
              format: { numberFormat: accountingFormat },
            },
          ],
        ]),
      );
      const layer = createLayerWithReader(reader);
      const ctx = createMockContext();

      layer.render(
        ctx,
        createRegionWithViewport({
          startRow: 0,
          startCol: 0,
          endRow: 2,
          endCol: 0,
        }),
        createFrame(),
      );

      const calls = (ctx.fillText as jest.Mock).mock.calls.map((call: unknown[]) => ({
        text: call[0] as string,
        x: call[1] as number,
      }));
      const texts = calls.map((call) => call.text);

      expect(texts).toEqual(expect.arrayContaining(['$', '1,234.50', '(987.65)', '-']));
      expect(texts).not.toContain(' $1,234.50 ');
      expect(texts).not.toContain(' $(987.65)');
      expect(texts).not.toContain(' $-   ');
      expect(texts.filter((text) => text === '$')).toHaveLength(3);

      const currencyCall = calls.find((call) => call.text === '$');
      const positiveAmountCall = calls.find((call) => call.text === '1,234.50');
      expect(currencyCall?.x).toBeLessThan(positiveAmountCall?.x ?? 0);
    });
  });
});
