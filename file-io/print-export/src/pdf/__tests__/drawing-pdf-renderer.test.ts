/**
 * Tests for DrawingPdfRenderer — renders drawing objects into the PDF
 * by delegating to pdf/graphics renderDrawingObject().
 *
 * Uses a MockRenderBackend that records all method calls for assertion.
 */

import type { AffineTransform, Path } from '@mog/geometry';
import type {
  DrawingObject,
  FontHandle,
  ImageFormat,
  RenderBackend,
  TextBlockOptions,
  TextMeasurement,
  TextOptions,
  TextRun,
} from '@mog/pdf-graphics';
import type { DrawingInfo } from '../drawing-pdf-renderer';
import { DrawingPdfRenderer } from '../drawing-pdf-renderer';
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
}

// ============================================================================
// Mock PositionResolver
// ============================================================================

class MockPositionResolver implements PositionResolver {
  private results: Map<string, ResolvedPosition | null> = new Map();

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

function makeSimpleShape(overrides?: Partial<DrawingObject>): DrawingObject {
  return {
    type: 'shape',
    bounds: { x: 0, y: 0, width: 100, height: 50 },
    fill: { type: 'solid', color: [0, 0, 1] },
    ...overrides,
  };
}

function makeGroup(children: DrawingObject[]): DrawingObject {
  return {
    type: 'group',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    children,
  };
}

function makeDrawing(overrides?: Partial<DrawingInfo>): DrawingInfo {
  return {
    drawingObject: makeSimpleShape(),
    anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 },
    width: 100,
    height: 50,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('DrawingPdfRenderer', () => {
  let backend: MockRenderBackend;
  let renderer: DrawingPdfRenderer;

  beforeEach(() => {
    backend = new MockRenderBackend();
    renderer = new DrawingPdfRenderer(backend);
  });

  describe('renderDrawing', () => {
    it('wraps rendering in save/translate/restore', () => {
      const drawing = makeDrawing();
      renderer.renderDrawing(drawing, { x: 100, y: 200 });

      // First call should be save
      expect(backend.calls[0].method).toBe('save');
      // Second call should be translate to position
      expect(backend.calls[1]).toEqual({ method: 'translate', args: [100, 200] });
      // Last call should be restore
      expect(backend.calls[backend.calls.length - 1].method).toBe('restore');
    });

    it('delegates to renderDrawingObject for a simple shape', () => {
      const shape = makeSimpleShape({
        fill: { type: 'solid', color: [1, 0, 0] },
      });
      const drawing = makeDrawing({ drawingObject: shape });
      renderer.renderDrawing(drawing, { x: 0, y: 0 });

      // renderDrawingObject should have been called, which triggers:
      // save (from renderDrawingObject) -> rect -> setFillColor -> fill -> restore
      // Plus our outer save/translate/restore
      const saveCalls = backend.getCalls('save');
      expect(saveCalls.length).toBeGreaterThanOrEqual(2); // outer + inner

      const fillColorCalls = backend.getCalls('setFillColor');
      expect(fillColorCalls).toHaveLength(1);
      expect(fillColorCalls[0].args).toEqual([1, 0, 0]);
    });

    it('renders a group with children', () => {
      const child1 = makeSimpleShape({ fill: { type: 'solid', color: [1, 0, 0] } });
      const child2 = makeSimpleShape({ fill: { type: 'solid', color: [0, 1, 0] } });
      const group = makeGroup([child1, child2]);
      const drawing = makeDrawing({ drawingObject: group });

      renderer.renderDrawing(drawing, { x: 50, y: 75 });

      // Should have two setFillColor calls (one per child shape)
      const fillCalls = backend.getCalls('setFillColor');
      expect(fillCalls).toHaveLength(2);
      expect(fillCalls[0].args).toEqual([1, 0, 0]);
      expect(fillCalls[1].args).toEqual([0, 1, 0]);

      // Translate should be to (50, 75) for the outer positioning
      expect(backend.calls[1]).toEqual({ method: 'translate', args: [50, 75] });
    });

    it('renders a shape with stroke', () => {
      const shape = makeSimpleShape({
        stroke: { color: [0, 0, 0], width: 2 },
        fill: undefined,
      });
      const drawing = makeDrawing({ drawingObject: shape });
      renderer.renderDrawing(drawing, { x: 0, y: 0 });

      const strokeColorCalls = backend.getCalls('setStrokeColor');
      expect(strokeColorCalls).toHaveLength(1);
      expect(strokeColorCalls[0].args).toEqual([0, 0, 0]);

      const lineWidthCalls = backend.getCalls('setLineWidth');
      expect(lineWidthCalls).toHaveLength(1);
      expect(lineWidthCalls[0].args).toEqual([2]);
    });

    it('renders a shape with a transform', () => {
      const shape = makeSimpleShape({
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
      });
      const drawing = makeDrawing({ drawingObject: shape });
      renderer.renderDrawing(drawing, { x: 5, y: 5 });

      // Should have a transform call from renderDrawingObject
      const transformCalls = backend.getCalls('transform');
      expect(transformCalls).toHaveLength(1);
      expect(transformCalls[0].args).toEqual([1, 0, 0, 1, 10, 20]);
    });
  });

  describe('renderDrawings', () => {
    it('renders drawings on the target page', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 0, x: 30, y: 40 });

      const drawing = makeDrawing({
        anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 },
      });
      renderer.renderDrawings([drawing], posResolver, 0);

      // Should have save/translate/...drawing.../restore
      expect(backend.getCalls('save').length).toBeGreaterThanOrEqual(1);
      expect(backend.calls[1]).toEqual({ method: 'translate', args: [30, 40] });
    });

    it('skips drawings on a different page', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 1, x: 30, y: 40 });

      const drawing = makeDrawing({
        anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 },
      });
      renderer.renderDrawings([drawing], posResolver, 0);

      expect(backend.calls).toHaveLength(0);
    });

    it('skips drawings whose anchor resolves to null', () => {
      const posResolver = new MockPositionResolver();
      // No result set — will return null

      const drawing = makeDrawing({
        anchor: { row: 10, col: 10, xOffset: 0, yOffset: 0 },
      });
      renderer.renderDrawings([drawing], posResolver, 0);

      expect(backend.calls).toHaveLength(0);
    });

    it('preserves z-order (renders in array order)', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 0, x: 10, y: 10 });
      posResolver.setResult(1, 0, { pageIndex: 0, x: 20, y: 20 });

      const drawing1 = makeDrawing({
        drawingObject: makeSimpleShape({ fill: { type: 'solid', color: [1, 0, 0] } }),
        anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 },
      });
      const drawing2 = makeDrawing({
        drawingObject: makeSimpleShape({ fill: { type: 'solid', color: [0, 1, 0] } }),
        anchor: { row: 1, col: 0, xOffset: 0, yOffset: 0 },
      });

      renderer.renderDrawings([drawing1, drawing2], posResolver, 0);

      // First translate should be (10, 10), second should be (20, 20)
      const translateCalls = backend.getCalls('translate');
      expect(translateCalls[0].args).toEqual([10, 10]);
      expect(translateCalls[1].args).toEqual([20, 20]);

      // Fill colors should appear in order: red first, green second
      const fillCalls = backend.getCalls('setFillColor');
      expect(fillCalls[0].args).toEqual([1, 0, 0]);
      expect(fillCalls[1].args).toEqual([0, 1, 0]);
    });

    it('handles empty drawings array', () => {
      const posResolver = new MockPositionResolver();
      renderer.renderDrawings([], posResolver, 0);
      expect(backend.calls).toHaveLength(0);
    });

    it('filters mixed pages correctly', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 0, x: 10, y: 10 });
      posResolver.setResult(1, 0, { pageIndex: 1, x: 20, y: 20 });
      posResolver.setResult(2, 0, { pageIndex: 0, x: 30, y: 30 });

      const drawings = [
        makeDrawing({ anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 } }),
        makeDrawing({ anchor: { row: 1, col: 0, xOffset: 0, yOffset: 0 } }),
        makeDrawing({ anchor: { row: 2, col: 0, xOffset: 0, yOffset: 0 } }),
      ];

      renderer.renderDrawings(drawings, posResolver, 0);

      // Only drawings at row 0 and row 2 should be rendered (page 0)
      const translateCalls = backend.getCalls('translate');
      expect(translateCalls).toHaveLength(2);
      expect(translateCalls[0].args).toEqual([10, 10]);
      expect(translateCalls[1].args).toEqual([30, 30]);
    });
  });
});
