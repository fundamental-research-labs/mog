/**
 * Tests for ChartPdfRenderer — renders pre-rasterized charts into the PDF.
 *
 * Uses a MockRenderBackend that records all method calls for assertion.
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
import type { ChartInfo } from '../chart-renderer';
import { ChartPdfRenderer } from '../chart-renderer';
import type { PositionResolver, ResolvedPosition } from '../position-resolver';

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
  measureText(text: string, font: FontHandle, size: number): number {
    this.record('measureText', text, font, size);
    return text.length * size * 0.6;
  }
  measureTextRuns(runs: TextRun[], maxWidth: number): TextMeasurement {
    this.record('measureTextRuns', runs, maxWidth);
    return { width: 0, height: 14.4, lines: [{ width: 0, runs }] };
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

  getLastCall(method: string): MockCall | undefined {
    const calls = this.getCalls(method);
    return calls[calls.length - 1];
  }
}

// ============================================================================
// Mock PositionResolver
// ============================================================================

class MockPositionResolver implements PositionResolver {
  private results: Map<string, ResolvedPosition | null> = new Map();

  /** Set a result for a specific anchor key. */
  setResult(row: number, col: number, result: ResolvedPosition | null): void {
    this.results.set(`${row},${col}`, result);
  }

  resolvePosition(
    row: number,
    col: number,
    _xOffset: number,
    _yOffset: number,
  ): ResolvedPosition | null {
    return this.results.get(`${row},${col}`) ?? null;
  }
}

// ============================================================================
// Test Data
// ============================================================================

const testImageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeChart(overrides?: Partial<ChartInfo>): ChartInfo {
  return {
    id: 'chart-1',
    anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 },
    width: 400,
    height: 300,
    imageData: testImageData,
    imageFormat: 'png',
    title: 'Test Chart',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ChartPdfRenderer', () => {
  let backend: MockRenderBackend;
  let renderer: ChartPdfRenderer;

  beforeEach(() => {
    backend = new MockRenderBackend();
    renderer = new ChartPdfRenderer(backend);
  });

  describe('renderChart', () => {
    it('draws the chart image at the correct position and size', () => {
      const chart = makeChart();
      renderer.renderChart(chart, { x: 100, y: 200 });

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(1);
      expect(drawCalls[0].args).toEqual([testImageData, 'png', 100, 200, 400, 300]);
    });

    it('uses jpeg format when specified', () => {
      const jpegData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      const chart = makeChart({ imageData: jpegData, imageFormat: 'jpeg' });
      renderer.renderChart(chart, { x: 50, y: 75 });

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(1);
      expect(drawCalls[0].args[1]).toBe('jpeg');
    });

    it('defaults to png format when imageFormat is not specified', () => {
      const chart = makeChart({ imageFormat: undefined });
      renderer.renderChart(chart, { x: 0, y: 0 });

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(1);
      expect(drawCalls[0].args[1]).toBe('png');
    });

    it('skips rendering and warns when imageData is missing', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const chart = makeChart({ imageData: undefined, id: 'missing-chart' });
      renderer.renderChart(chart, { x: 0, y: 0 });

      expect(backend.getCalls('drawImage')).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('missing-chart');
      expect(warnSpy.mock.calls[0][0]).toContain('no imageData');
      warnSpy.mockRestore();
    });

    it('includes chart title in warning when available', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const chart = makeChart({ imageData: undefined, title: 'Sales Report' });
      renderer.renderChart(chart, { x: 0, y: 0 });

      expect(warnSpy.mock.calls[0][0]).toContain('Sales Report');
      warnSpy.mockRestore();
    });

    it('does not include title in warning when title is absent', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const chart = makeChart({ imageData: undefined, title: undefined });
      renderer.renderChart(chart, { x: 0, y: 0 });

      expect(warnSpy.mock.calls[0][0]).not.toContain('Title:');
      warnSpy.mockRestore();
    });

    it('handles zero-size charts', () => {
      const chart = makeChart({ width: 0, height: 0 });
      renderer.renderChart(chart, { x: 10, y: 20 });

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(1);
      expect(drawCalls[0].args).toEqual([testImageData, 'png', 10, 20, 0, 0]);
    });
  });

  describe('renderCharts', () => {
    it('renders charts that are on the target page', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 0, x: 50, y: 60 });

      const chart = makeChart({ anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 } });
      renderer.renderCharts([chart], posResolver, 0);

      expect(backend.getCalls('drawImage')).toHaveLength(1);
    });

    it('skips charts that are on a different page', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 1, x: 50, y: 60 });

      const chart = makeChart({ anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 } });
      renderer.renderCharts([chart], posResolver, 0);

      expect(backend.getCalls('drawImage')).toHaveLength(0);
    });

    it('skips charts whose anchor resolves to null (off-page)', () => {
      const posResolver = new MockPositionResolver();
      // No result set for (5, 5) — will return null

      const chart = makeChart({ anchor: { row: 5, col: 5, xOffset: 0, yOffset: 0 } });
      renderer.renderCharts([chart], posResolver, 0);

      expect(backend.getCalls('drawImage')).toHaveLength(0);
    });

    it('renders multiple charts on the same page', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 0, x: 10, y: 20 });
      posResolver.setResult(3, 2, { pageIndex: 0, x: 200, y: 300 });

      const charts = [
        makeChart({ id: 'chart-1', anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 } }),
        makeChart({
          id: 'chart-2',
          anchor: { row: 3, col: 2, xOffset: 0, yOffset: 0 },
          width: 200,
          height: 150,
        }),
      ];
      renderer.renderCharts(charts, posResolver, 0);

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(2);
      // First chart at (10, 20) with size 400x300
      expect(drawCalls[0].args.slice(2)).toEqual([10, 20, 400, 300]);
      // Second chart at (200, 300) with size 200x150
      expect(drawCalls[1].args.slice(2)).toEqual([200, 300, 200, 150]);
    });

    it('handles empty charts array', () => {
      const posResolver = new MockPositionResolver();
      renderer.renderCharts([], posResolver, 0);
      expect(backend.calls).toHaveLength(0);
    });

    it('filters mixed pages correctly', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 0, x: 10, y: 10 });
      posResolver.setResult(1, 0, { pageIndex: 1, x: 10, y: 10 });
      posResolver.setResult(2, 0, { pageIndex: 0, x: 100, y: 100 });

      const charts = [
        makeChart({ id: 'c1', anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 } }),
        makeChart({ id: 'c2', anchor: { row: 1, col: 0, xOffset: 0, yOffset: 0 } }),
        makeChart({ id: 'c3', anchor: { row: 2, col: 0, xOffset: 0, yOffset: 0 } }),
      ];

      // Page 0 should get c1 and c3
      renderer.renderCharts(charts, posResolver, 0);
      expect(backend.getCalls('drawImage')).toHaveLength(2);
    });
  });
});
