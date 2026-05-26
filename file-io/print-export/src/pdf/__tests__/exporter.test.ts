/**
 * Tests for SpreadsheetPdfExporter -- the top-level PDF export orchestrator.
 *
 * Uses a MockRenderBackend to record all rendering operations and a
 * MockPdfDataProvider to supply test data.
 */

import type { AffineTransform, Path } from '@mog/geometry';
import type {
  FontHandle,
  ImageFormat,
  RenderBackend,
  TextBlockOptions,
  TextMeasurement,
  TextOptions,
  TextRun,
} from '@mog/pdf-graphics';
import type { MergedRegion, PageSetupInput } from '@mog/pdf-layout';
import type { CFResult } from '../cf-renderer';
import type { ChartInfo } from '../chart-renderer';
import type { DrawingInfo } from '../drawing-pdf-renderer';
import {
  SpreadsheetPdfExporter,
  type CellDataInput,
  type PdfDataProvider,
  type UsedRange,
} from '../exporter';
import type { ImageInfo } from '../image-renderer';
import type { SparklineRenderData } from '../sparkline-renderer';

// ============================================================================
// Mock RenderBackend
// ============================================================================

interface MockCall {
  method: string;
  args: unknown[];
}

class MockRenderBackend implements RenderBackend {
  calls: MockCall[] = [];

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  beginPage(width: number, height: number): void {
    this.record('beginPage', width, height);
  }
  async endPage(): Promise<void> {
    this.record('endPage');
  }
  save(): void {
    this.record('save');
  }
  restore(): void {
    this.record('restore');
  }
  translate(tx: number, ty: number): void {
    this.record('translate', tx, ty);
  }
  rotate(angleRad: number): void {
    this.record('rotate', angleRad);
  }
  scale(sx: number, sy: number): void {
    this.record('scale', sx, sy);
  }
  transform(a: number, b: number, c: number, d: number, tx: number, ty: number): void {
    this.record('transform', a, b, c, d, tx, ty);
  }
  setTransform(xform: AffineTransform): void {
    this.record('setTransform', xform);
  }
  beginPath(): void {
    this.record('beginPath');
  }
  moveTo(x: number, y: number): void {
    this.record('moveTo', x, y);
  }
  lineTo(x: number, y: number): void {
    this.record('lineTo', x, y);
  }
  curveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this.record('curveTo', cp1x, cp1y, cp2x, cp2y, x, y);
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.record('quadraticCurveTo', cpx, cpy, x, y);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.record('rect', x, y, w, h);
  }
  closePath(): void {
    this.record('closePath');
  }
  clip(): void {
    this.record('clip');
  }
  replayPath(path: Path): void {
    this.record('replayPath', path);
  }
  setFillColor(r: number, g: number, b: number): void {
    this.record('setFillColor', r, g, b);
  }
  setStrokeColor(r: number, g: number, b: number): void {
    this.record('setStrokeColor', r, g, b);
  }
  setFillAlpha(alpha: number): void {
    this.record('setFillAlpha', alpha);
  }
  setStrokeAlpha(alpha: number): void {
    this.record('setStrokeAlpha', alpha);
  }
  setLineWidth(width: number): void {
    this.record('setLineWidth', width);
  }
  setLineDash(segments: number[], phase: number): void {
    this.record('setLineDash', segments, phase);
  }
  setLineCap(cap: 'butt' | 'round' | 'square'): void {
    this.record('setLineCap', cap);
  }
  setLineJoin(join: 'miter' | 'round' | 'bevel'): void {
    this.record('setLineJoin', join);
  }
  fill(): void {
    this.record('fill');
  }
  stroke(): void {
    this.record('stroke');
  }
  fillAndStroke(): void {
    this.record('fillAndStroke');
  }
  drawText(text: string, x: number, y: number, options: TextOptions): void {
    this.record('drawText', text, x, y, options);
  }
  drawTextRuns(runs: TextRun[], x: number, y: number, options: TextBlockOptions): void {
    this.record('drawTextRuns', runs, x, y, options);
  }
  measureText(text: string, _font: FontHandle, size: number): number {
    return text.length * size * 0.6;
  }
  measureTextRuns(runs: TextRun[], _maxWidth: number): TextMeasurement {
    let totalWidth = 0;
    for (const run of runs) {
      const size = run.size ?? 12;
      totalWidth += run.text.length * size * 0.6;
    }
    return { width: totalWidth, height: 14.4, lines: [{ width: totalWidth, runs }] };
  }
  drawImage(
    data: Uint8Array,
    format: ImageFormat,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    this.record('drawImage', data, format, x, y, w, h);
  }
  setFont(handle: FontHandle, size: number): void {
    this.record('setFont', handle, size);
  }

  getCalls(method: string): MockCall[] {
    return this.calls.filter((c) => c.method === method);
  }
  wasCalled(method: string): boolean {
    return this.calls.some((c) => c.method === method);
  }
  reset(): void {
    this.calls = [];
  }
}

// ============================================================================
// Mock Data Provider
// ============================================================================

function createMockProvider(config: {
  sheets: Array<{
    id: string;
    name: string;
    rows: number;
    cols: number;
    rowHeight?: number;
    colWidth?: number;
    cells?: Record<string, CellDataInput>;
    mergedRegions?: MergedRegion[];
    hiddenRows?: Set<number>;
    hiddenCols?: Set<number>;
    charts?: ChartInfo[];
    drawings?: DrawingInfo[];
    images?: ImageInfo[];
    cfResults?: Record<string, CFResult>;
    sparklines?: Record<string, SparklineRenderData>;
    pageSetup?: PageSetupInput;
  }>;
}): PdfDataProvider {
  const sheetMap = new Map(config.sheets.map((s) => [s.id, s]));

  return {
    getSheetIds(): string[] {
      return config.sheets.map((s) => s.id);
    },
    getSheetName(sheetId: string): string {
      return sheetMap.get(sheetId)?.name ?? 'Unknown';
    },
    getCellData(sheetId: string, row: number, col: number): CellDataInput | undefined {
      const sheet = sheetMap.get(sheetId);
      if (!sheet) return undefined;
      const key = `${row},${col}`;
      return sheet.cells?.[key];
    },
    getRowHeight(sheetId: string, _row: number): number {
      return sheetMap.get(sheetId)?.rowHeight ?? 20;
    },
    getColumnWidth(sheetId: string, _col: number): number {
      return sheetMap.get(sheetId)?.colWidth ?? 64;
    },
    getUsedRange(sheetId: string): UsedRange | undefined {
      const sheet = sheetMap.get(sheetId);
      if (!sheet || (sheet.rows === 0 && sheet.cols === 0)) return undefined;
      return { startRow: 0, startCol: 0, endRow: sheet.rows - 1, endCol: sheet.cols - 1 };
    },
    getMergedRegions(sheetId: string): MergedRegion[] {
      return sheetMap.get(sheetId)?.mergedRegions ?? [];
    },
    isRowHidden(sheetId: string, row: number): boolean {
      return sheetMap.get(sheetId)?.hiddenRows?.has(row) ?? false;
    },
    isColHidden(sheetId: string, col: number): boolean {
      return sheetMap.get(sheetId)?.hiddenCols?.has(col) ?? false;
    },
    getCharts(sheetId: string): ChartInfo[] {
      return sheetMap.get(sheetId)?.charts ?? [];
    },
    getDrawings(sheetId: string): DrawingInfo[] {
      return sheetMap.get(sheetId)?.drawings ?? [];
    },
    getImages(sheetId: string): ImageInfo[] {
      return sheetMap.get(sheetId)?.images ?? [];
    },
    getCFResult(sheetId: string, row: number, col: number): CFResult | undefined {
      return sheetMap.get(sheetId)?.cfResults?.[`${row},${col}`];
    },
    getSparklineData(sheetId: string, row: number, col: number): SparklineRenderData | undefined {
      return sheetMap.get(sheetId)?.sparklines?.[`${row},${col}`];
    },
    getPageSetup(sheetId: string): PageSetupInput | undefined {
      return sheetMap.get(sheetId)?.pageSetup;
    },
  };
}

function textCell(value: string): CellDataInput {
  return { displayValue: value, valueType: 'string', format: {} };
}

function cellGrid(values: (string | undefined)[][]): Record<string, CellDataInput> {
  const cells: Record<string, CellDataInput> = {};
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const v = values[r][c];
      if (v !== undefined) {
        cells[`${r},${c}`] = textCell(v);
      }
    }
  }
  return cells;
}

function largePageSetup(): PageSetupInput {
  return {
    pageWidth: 2000,
    pageHeight: 2000,
    margins: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 },
    orientation: 'portrait',
    scale: 1.0,
  };
}

function smallPageSetup(contentHeight: number = 50): PageSetupInput {
  return {
    pageWidth: 2000,
    pageHeight: contentHeight,
    margins: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 },
    orientation: 'portrait',
    scale: 1.0,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SpreadsheetPdfExporter', () => {
  let backend: MockRenderBackend;

  beforeEach(() => {
    backend = new MockRenderBackend();
  });

  // --------------------------------------------------------------------------
  // Basic Export
  // --------------------------------------------------------------------------

  describe('basic export', () => {
    it('exports a simple 5x5 grid on a single page', async () => {
      const values: string[][] = [];
      for (let r = 0; r < 5; r++) {
        values.push([]);
        for (let c = 0; c < 5; c++) {
          values[r].push(`R${r}C${c}`);
        }
      }

      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Sheet 1',
            rows: 5,
            cols: 5,
            rowHeight: 20,
            colWidth: 64,
            cells: cellGrid(values),
            pageSetup: largePageSetup(),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();

      expect(result.pageCount).toBe(1);
      expect(result.warnings).toHaveLength(0);
      expect(backend.getCalls('beginPage')).toHaveLength(1);
      expect(backend.getCalls('endPage')).toHaveLength(1);
      expect(backend.getCalls('save').length).toBeGreaterThanOrEqual(1);
      expect(backend.getCalls('restore').length).toBeGreaterThanOrEqual(1);

      // 25 cells with content should produce at least 25 drawText calls
      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThanOrEqual(25);
    });

    it('returns empty result for empty sheets', async () => {
      const provider = createMockProvider({
        sheets: [{ id: 'empty', name: 'Empty Sheet', rows: 0, cols: 0 }],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();

      expect(result.pageCount).toBe(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe('empty_sheet');
      expect(backend.getCalls('beginPage')).toHaveLength(0);
    });

    it('exports with default page setup when provider returns undefined', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Sheet 1',
            rows: 3,
            cols: 3,
            rowHeight: 20,
            colWidth: 64,
            cells: cellGrid([
              ['A', 'B', 'C'],
              ['D', 'E', 'F'],
              ['G', 'H', 'I'],
            ]),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();

      expect(result.pageCount).toBe(1);
      const beginCalls = backend.getCalls('beginPage');
      expect(beginCalls).toHaveLength(1);
      // Default: Letter (612 x 792)
      expect(beginCalls[0].args).toEqual([612, 792]);
    });
  });

  // --------------------------------------------------------------------------
  // Merged Cells
  // --------------------------------------------------------------------------

  describe('merged cells', () => {
    it('renders merged cells as a single larger cell', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Merged',
            rows: 3,
            cols: 3,
            rowHeight: 20,
            colWidth: 64,
            cells: {
              '0,0': textCell('Merged Cell'),
              '1,0': textCell('Normal'),
              '2,0': textCell('Normal'),
            },
            mergedRegions: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 2 }],
            pageSetup: largePageSetup(),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();
      expect(result.pageCount).toBe(1);

      const drawTextCalls = backend.getCalls('drawText');
      const mergedCellTexts = drawTextCalls.filter((c) => c.args[0] === 'Merged Cell');
      expect(mergedCellTexts).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // Pagination
  // --------------------------------------------------------------------------

  describe('pagination', () => {
    it('creates multiple pages when content exceeds page height', async () => {
      const values: string[][] = [];
      for (let r = 0; r < 10; r++) {
        values.push([`Row ${r}`]);
      }

      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Tall Sheet',
            rows: 10,
            cols: 1,
            rowHeight: 20,
            colWidth: 64,
            cells: cellGrid(values),
            pageSetup: smallPageSetup(50),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();

      // 200pt / 50pt = 4 pages
      expect(result.pageCount).toBeGreaterThanOrEqual(4);
      expect(backend.getCalls('beginPage').length).toBe(result.pageCount);
      expect(backend.getCalls('endPage').length).toBe(result.pageCount);
    });

    it('each page gets save/restore for state isolation', async () => {
      const values: string[][] = [];
      for (let r = 0; r < 6; r++) {
        values.push([`Row ${r}`]);
      }

      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Multi',
            rows: 6,
            cols: 1,
            rowHeight: 20,
            colWidth: 64,
            cells: cellGrid(values),
            pageSetup: smallPageSetup(50),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();

      const saveCalls = backend.getCalls('save');
      const restoreCalls = backend.getCalls('restore');
      expect(saveCalls.length).toBeGreaterThanOrEqual(result.pageCount);
      expect(restoreCalls.length).toBeGreaterThanOrEqual(result.pageCount);
    });
  });

  // --------------------------------------------------------------------------
  // Multi-Sheet Export
  // --------------------------------------------------------------------------

  describe('multi-sheet export', () => {
    it('exports multiple sheets across multiple pages', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Sheet 1',
            rows: 3,
            cols: 2,
            rowHeight: 20,
            colWidth: 64,
            cells: cellGrid([
              ['A1', 'B1'],
              ['A2', 'B2'],
              ['A3', 'B3'],
            ]),
            pageSetup: largePageSetup(),
          },
          {
            id: 'sheet2',
            name: 'Sheet 2',
            rows: 2,
            cols: 2,
            rowHeight: 20,
            colWidth: 64,
            cells: cellGrid([
              ['X1', 'Y1'],
              ['X2', 'Y2'],
            ]),
            pageSetup: largePageSetup(),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();

      expect(result.pageCount).toBe(2);
      expect(backend.getCalls('beginPage')).toHaveLength(2);
    });

    it('allows exporting a subset of sheets via sheetIds option', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'S1',
            rows: 2,
            cols: 2,
            cells: cellGrid([
              ['A', 'B'],
              ['C', 'D'],
            ]),
            pageSetup: largePageSetup(),
          },
          {
            id: 'sheet2',
            name: 'S2',
            rows: 2,
            cols: 2,
            cells: cellGrid([
              ['E', 'F'],
              ['G', 'H'],
            ]),
            pageSetup: largePageSetup(),
          },
          {
            id: 'sheet3',
            name: 'S3',
            rows: 2,
            cols: 2,
            cells: cellGrid([
              ['I', 'J'],
              ['K', 'L'],
            ]),
            pageSetup: largePageSetup(),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export({ sheetIds: ['sheet1', 'sheet3'] });

      expect(result.pageCount).toBe(2);
    });

    it('handles mix of empty and non-empty sheets', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Sheet 1',
            rows: 2,
            cols: 2,
            cells: cellGrid([
              ['A', 'B'],
              ['C', 'D'],
            ]),
            pageSetup: largePageSetup(),
          },
          { id: 'empty', name: 'Empty Sheet', rows: 0, cols: 0 },
          {
            id: 'sheet3',
            name: 'Sheet 3',
            rows: 1,
            cols: 1,
            cells: cellGrid([['X']]),
            pageSetup: largePageSetup(),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();

      expect(result.pageCount).toBe(2);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual({
        type: 'empty_sheet',
        sheetId: 'empty',
        sheetName: 'Empty Sheet',
      });
    });
  });

  // --------------------------------------------------------------------------
  // Progress Callback
  // --------------------------------------------------------------------------

  describe('progress callback', () => {
    it('calls onProgress for each page rendered', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'S1',
            rows: 2,
            cols: 1,
            cells: cellGrid([['A'], ['B']]),
            pageSetup: largePageSetup(),
          },
          {
            id: 'sheet2',
            name: 'S2',
            rows: 2,
            cols: 1,
            cells: cellGrid([['C'], ['D']]),
            pageSetup: largePageSetup(),
          },
        ],
      });

      const progressCalls: Array<[number, number]> = [];
      const exporter = new SpreadsheetPdfExporter(provider, backend);
      await exporter.export({
        onProgress: (current, total) => {
          progressCalls.push([current, total]);
        },
      });

      expect(progressCalls).toEqual([
        [1, 2],
        [2, 2],
      ]);
    });

    it('reports progress correctly with pagination', async () => {
      const values: string[][] = [];
      for (let r = 0; r < 6; r++) {
        values.push([`Row ${r}`]);
      }

      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Tall',
            rows: 6,
            cols: 1,
            rowHeight: 20,
            colWidth: 64,
            cells: cellGrid(values),
            pageSetup: smallPageSetup(50),
          },
        ],
      });

      const progressCalls: Array<[number, number]> = [];
      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export({
        onProgress: (current, total) => {
          progressCalls.push([current, total]);
        },
      });

      expect(progressCalls.length).toBe(result.pageCount);
      for (let i = 0; i < progressCalls.length; i++) {
        expect(progressCalls[i][0]).toBe(i + 1);
        expect(progressCalls[i][1]).toBe(result.pageCount);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Cancellation
  // --------------------------------------------------------------------------

  describe('cancellation', () => {
    it('stops export when signal is aborted before start', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Sheet 1',
            rows: 10,
            cols: 1,
            rowHeight: 20,
            colWidth: 64,
            cells: cellGrid(Array.from({ length: 10 }, (_, r) => [`R${r}`])),
            pageSetup: smallPageSetup(50),
          },
        ],
      });

      const controller = new AbortController();
      controller.abort();

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export({ signal: controller.signal });

      expect(result.pageCount).toBe(0);
      expect(backend.getCalls('beginPage')).toHaveLength(0);
    });

    it('stops export mid-way when signal is aborted during rendering', async () => {
      const values: string[][] = [];
      for (let r = 0; r < 20; r++) {
        values.push([`Row ${r}`]);
      }

      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Many Pages',
            rows: 20,
            cols: 1,
            rowHeight: 20,
            colWidth: 64,
            cells: cellGrid(values),
            pageSetup: smallPageSetup(50),
          },
        ],
      });

      const controller = new AbortController();
      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export({
        signal: controller.signal,
        onProgress: (current, _total) => {
          if (current >= 2) {
            controller.abort();
          }
        },
      });

      expect(result.pageCount).toBeGreaterThanOrEqual(2);
      expect(result.pageCount).toBeLessThan(8);
    });
  });

  // --------------------------------------------------------------------------
  // Hidden Rows/Columns
  // --------------------------------------------------------------------------

  describe('hidden rows and columns', () => {
    it('skips hidden rows during rendering', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Hidden Rows',
            rows: 4,
            cols: 1,
            rowHeight: 20,
            colWidth: 64,
            cells: cellGrid([['Visible 0'], ['HIDDEN'], ['Visible 2'], ['Visible 3']]),
            hiddenRows: new Set([1]),
            pageSetup: largePageSetup(),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      await exporter.export();

      const drawTextCalls = backend.getCalls('drawText');
      const hiddenTexts = drawTextCalls.filter((c) => c.args[0] === 'HIDDEN');
      expect(hiddenTexts).toHaveLength(0);

      const visibleTexts = drawTextCalls.filter(
        (c) => typeof c.args[0] === 'string' && (c.args[0] as string).startsWith('Visible'),
      );
      expect(visibleTexts).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------------
  // Conditional Formatting
  // --------------------------------------------------------------------------

  describe('conditional formatting', () => {
    it('renders data bar CF results', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'CF',
            rows: 1,
            cols: 1,
            rowHeight: 20,
            colWidth: 100,
            cells: cellGrid([['75%']]),
            cfResults: {
              '0,0': {
                dataBar: {
                  fillPercent: 0.75,
                  color: [0, 128, 0],
                  showValue: true,
                  isNegative: false,
                  fillType: 'solid',
                },
              },
            },
            pageSetup: largePageSetup(),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();

      expect(result.pageCount).toBe(1);
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(fillColorCalls.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Sparklines
  // --------------------------------------------------------------------------

  describe('sparklines', () => {
    it('renders sparkline data on cells', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Sparklines',
            rows: 1,
            cols: 1,
            rowHeight: 20,
            colWidth: 100,
            cells: cellGrid([['']]),
            sparklines: {
              '0,0': {
                type: 'line',
                values: [1, 3, 2, 5, 4],
                options: { seriesColor: [0, 0, 255] },
              },
            },
            pageSetup: largePageSetup(),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();

      expect(result.pageCount).toBe(1);
      expect(backend.getCalls('lineTo').length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Page Setup
  // --------------------------------------------------------------------------

  describe('page setup', () => {
    it('uses per-sheet page setup from provider', async () => {
      const customSetup: PageSetupInput = {
        pageWidth: 841.89,
        pageHeight: 595.28,
        margins: { top: 36, bottom: 36, left: 36, right: 36, header: 18, footer: 18 },
        orientation: 'landscape',
        scale: 1.0,
      };

      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Custom',
            rows: 2,
            cols: 2,
            cells: cellGrid([
              ['A', 'B'],
              ['C', 'D'],
            ]),
            pageSetup: customSetup,
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      await exporter.export();

      const beginCalls = backend.getCalls('beginPage');
      expect(beginCalls[0].args).toEqual([841.89, 595.28]);
    });

    it('uses caller-provided default page setup', async () => {
      const callerDefault: PageSetupInput = {
        pageWidth: 500,
        pageHeight: 500,
        margins: { top: 10, bottom: 10, left: 10, right: 10, header: 5, footer: 5 },
        orientation: 'portrait',
        scale: 1.0,
      };

      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Sheet',
            rows: 2,
            cols: 2,
            cells: cellGrid([
              ['A', 'B'],
              ['C', 'D'],
            ]),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      await exporter.export({ defaultPageSetup: callerDefault });

      const beginCalls = backend.getCalls('beginPage');
      expect(beginCalls[0].args).toEqual([500, 500]);
    });

    it('applies margin offset via translate', async () => {
      const setup: PageSetupInput = {
        pageWidth: 612,
        pageHeight: 792,
        margins: { top: 72, bottom: 72, left: 54, right: 54, header: 18, footer: 18 },
        orientation: 'portrait',
        scale: 1.0,
      };

      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Margins',
            rows: 1,
            cols: 1,
            cells: cellGrid([['Hello']]),
            pageSetup: setup,
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      await exporter.export();

      const translateCalls = backend.getCalls('translate');
      expect(translateCalls.length).toBeGreaterThanOrEqual(1);
      expect(translateCalls[0].args).toEqual([54, 72]);
    });
  });

  // --------------------------------------------------------------------------
  // Cell Format
  // --------------------------------------------------------------------------

  describe('cell format', () => {
    it('passes cell format through to CellRenderer', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Formatted',
            rows: 1,
            cols: 1,
            rowHeight: 20,
            colWidth: 100,
            cells: {
              '0,0': {
                displayValue: 'Bold Red',
                valueType: 'string',
                format: { bold: true, fontColor: [1, 0, 0], fontSize: 14 },
              },
            },
            pageSetup: largePageSetup(),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();
      expect(result.pageCount).toBe(1);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.filter((c) => c.args[0] === 'Bold Red').length).toBeGreaterThanOrEqual(
        1,
      );
    });

    it('marks hyperlinks in cell format', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Links',
            rows: 1,
            cols: 1,
            rowHeight: 20,
            colWidth: 100,
            cells: {
              '0,0': {
                displayValue: 'Click here',
                valueType: 'string',
                format: {},
                hyperlink: true,
              },
            },
            pageSetup: largePageSetup(),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      const result = await exporter.export();
      expect(result.pageCount).toBe(1);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.some((c) => c.args[0] === 'Click here')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Rendering Order
  // --------------------------------------------------------------------------

  describe('rendering order', () => {
    it('renders in correct order: beginPage, save, translate, cells, restore, endPage', async () => {
      const provider = createMockProvider({
        sheets: [
          {
            id: 'sheet1',
            name: 'Order',
            rows: 1,
            cols: 1,
            cells: cellGrid([['test']]),
            pageSetup: largePageSetup(),
          },
        ],
      });

      const exporter = new SpreadsheetPdfExporter(provider, backend);
      await exporter.export();

      const beginIdx = backend.calls.findIndex((c) => c.method === 'beginPage');
      const saveIdx = backend.calls.findIndex((c) => c.method === 'save');
      const lastRestoreIdx = findLastIndex(backend.calls, (c) => c.method === 'restore');
      const endIdx = backend.calls.findIndex((c) => c.method === 'endPage');

      expect(beginIdx).toBeLessThan(saveIdx);
      expect(saveIdx).toBeLessThan(lastRestoreIdx);
      expect(lastRestoreIdx).toBeLessThan(endIdx);
    });
  });
});

// Polyfill for findLastIndex if needed
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}
