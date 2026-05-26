/**
 * Tests for ImagePdfRenderer — renders embedded images (floating and inline)
 * into the PDF.
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
import type { CellImageBounds, ImageInfo } from '../image-renderer';
import { ImagePdfRenderer } from '../image-renderer';
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

const testPngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const testJpegData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function makeImage(overrides?: Partial<ImageInfo>): ImageInfo {
  return {
    id: 'img-1',
    data: testPngData,
    format: 'png',
    anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 },
    width: 200,
    height: 150,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ImagePdfRenderer', () => {
  let backend: MockRenderBackend;
  let renderer: ImagePdfRenderer;

  beforeEach(() => {
    backend = new MockRenderBackend();
    renderer = new ImagePdfRenderer(backend);
  });

  describe('constructor', () => {
    it('uses default quality options', () => {
      const r = new ImagePdfRenderer(backend);
      expect(r.getQualityOptions()).toEqual({ dpi: 150, jpegQuality: 85 });
    });

    it('accepts custom quality options', () => {
      const r = new ImagePdfRenderer(backend, { dpi: 300, jpegQuality: 95 });
      expect(r.getQualityOptions()).toEqual({ dpi: 300, jpegQuality: 95 });
    });

    it('fills in defaults for partial quality options', () => {
      const r = new ImagePdfRenderer(backend, { dpi: 300 });
      expect(r.getQualityOptions()).toEqual({ dpi: 300, jpegQuality: 85 });
    });
  });

  describe('renderFloatingImage', () => {
    it('draws the image at the correct position and size', () => {
      const image = makeImage();
      renderer.renderFloatingImage(image, { x: 100, y: 200 });

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(1);
      expect(drawCalls[0].args).toEqual([testPngData, 'png', 100, 200, 200, 150]);
    });

    it('handles JPEG format', () => {
      const image = makeImage({ data: testJpegData, format: 'jpeg' });
      renderer.renderFloatingImage(image, { x: 50, y: 75 });

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(1);
      expect(drawCalls[0].args[0]).toBe(testJpegData);
      expect(drawCalls[0].args[1]).toBe('jpeg');
    });

    it('passes through exact dimensions', () => {
      const image = makeImage({ width: 612, height: 792 });
      renderer.renderFloatingImage(image, { x: 0, y: 0 });

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls[0].args.slice(4)).toEqual([612, 792]);
    });
  });

  describe('renderInlineImage', () => {
    it('scales a wide image to fit cell width, centered vertically', () => {
      // Image: 200x100 (aspect 2:1), Cell: 100x100 (aspect 1:1)
      // Image is wider -> fit to width
      // renderWidth = 100, renderHeight = 100/2 = 50
      // x = 10 + (100 - 100) / 2 = 10
      // y = 20 + (100 - 50) / 2 = 45
      const image = makeImage({ width: 200, height: 100 });
      const bounds: CellImageBounds = { x: 10, y: 20, width: 100, height: 100 };
      renderer.renderInlineImage(image, bounds);

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(1);
      expect(drawCalls[0].args).toEqual([testPngData, 'png', 10, 45, 100, 50]);
    });

    it('scales a tall image to fit cell height, centered horizontally', () => {
      // Image: 100x200 (aspect 0.5:1), Cell: 100x100 (aspect 1:1)
      // Image is taller -> fit to height
      // renderHeight = 100, renderWidth = 100 * 0.5 = 50
      // x = 10 + (100 - 50) / 2 = 35
      // y = 20 + (100 - 100) / 2 = 20
      const image = makeImage({ width: 100, height: 200 });
      const bounds: CellImageBounds = { x: 10, y: 20, width: 100, height: 100 };
      renderer.renderInlineImage(image, bounds);

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(1);
      expect(drawCalls[0].args).toEqual([testPngData, 'png', 35, 20, 50, 100]);
    });

    it('handles exact aspect ratio match (no letterboxing)', () => {
      // Image: 200x100, Cell: 200x100 — same aspect
      const image = makeImage({ width: 200, height: 100 });
      const bounds: CellImageBounds = { x: 0, y: 0, width: 200, height: 100 };
      renderer.renderInlineImage(image, bounds);

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(1);
      // Should fill exactly: x=0, y=0, w=200, h=100
      expect(drawCalls[0].args).toEqual([testPngData, 'png', 0, 0, 200, 100]);
    });

    it('handles square image in rectangular cell (landscape)', () => {
      // Image: 100x100 (aspect 1:1), Cell: 200x100 (aspect 2:1)
      // imageAspect (1) < cellAspect (2) -> fit to height
      // renderHeight = 100, renderWidth = 100 * 1 = 100
      // x = 0 + (200 - 100) / 2 = 50
      // y = 0 + (100 - 100) / 2 = 0
      const image = makeImage({ width: 100, height: 100 });
      const bounds: CellImageBounds = { x: 0, y: 0, width: 200, height: 100 };
      renderer.renderInlineImage(image, bounds);

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls[0].args).toEqual([testPngData, 'png', 50, 0, 100, 100]);
    });

    it('handles square image in rectangular cell (portrait)', () => {
      // Image: 100x100, Cell: 100x200
      // imageAspect (1) > cellAspect (0.5) -> fit to width
      // renderWidth = 100, renderHeight = 100 / 1 = 100
      // x = 0, y = (200 - 100) / 2 = 50
      const image = makeImage({ width: 100, height: 100 });
      const bounds: CellImageBounds = { x: 0, y: 0, width: 100, height: 200 };
      renderer.renderInlineImage(image, bounds);

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls[0].args).toEqual([testPngData, 'png', 0, 50, 100, 100]);
    });

    it('handles zero-height image (division by zero guard)', () => {
      const image = makeImage({ width: 100, height: 0 });
      const bounds: CellImageBounds = { x: 0, y: 0, width: 100, height: 100 };
      renderer.renderInlineImage(image, bounds);

      // Should not crash, should not draw
      expect(backend.getCalls('drawImage')).toHaveLength(0);
    });

    it('handles zero-size cell bounds', () => {
      const image = makeImage({ width: 100, height: 100 });
      const bounds: CellImageBounds = { x: 0, y: 0, width: 0, height: 0 };
      renderer.renderInlineImage(image, bounds);

      expect(backend.getCalls('drawImage')).toHaveLength(0);
    });
  });

  describe('renderImages', () => {
    it('renders floating images on the target page', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 0, x: 50, y: 60 });

      const image = makeImage({ isInline: false });
      renderer.renderImages([image], posResolver, 0);

      expect(backend.getCalls('drawImage')).toHaveLength(1);
    });

    it('skips inline images (they are handled by cell renderer)', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 0, x: 50, y: 60 });

      const image = makeImage({ isInline: true });
      renderer.renderImages([image], posResolver, 0);

      expect(backend.getCalls('drawImage')).toHaveLength(0);
    });

    it('skips images on a different page', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 1, x: 50, y: 60 });

      const image = makeImage();
      renderer.renderImages([image], posResolver, 0);

      expect(backend.getCalls('drawImage')).toHaveLength(0);
    });

    it('skips images whose anchor resolves to null', () => {
      const posResolver = new MockPositionResolver();
      // No result set

      const image = makeImage({ anchor: { row: 99, col: 99, xOffset: 0, yOffset: 0 } });
      renderer.renderImages([image], posResolver, 0);

      expect(backend.getCalls('drawImage')).toHaveLength(0);
    });

    it('renders multiple floating images on the same page', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 0, x: 10, y: 20 });
      posResolver.setResult(2, 1, { pageIndex: 0, x: 200, y: 300 });

      const images = [
        makeImage({ id: 'img-1', anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 } }),
        makeImage({
          id: 'img-2',
          anchor: { row: 2, col: 1, xOffset: 0, yOffset: 0 },
          data: testJpegData,
          format: 'jpeg',
          width: 300,
          height: 200,
        }),
      ];
      renderer.renderImages(images, posResolver, 0);

      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(2);
      expect(drawCalls[0].args).toEqual([testPngData, 'png', 10, 20, 200, 150]);
      expect(drawCalls[1].args).toEqual([testJpegData, 'jpeg', 200, 300, 300, 200]);
    });

    it('handles empty images array', () => {
      const posResolver = new MockPositionResolver();
      renderer.renderImages([], posResolver, 0);
      expect(backend.calls).toHaveLength(0);
    });

    it('filters mixed inline and floating images', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 0, x: 10, y: 10 });
      posResolver.setResult(1, 0, { pageIndex: 0, x: 20, y: 20 });
      posResolver.setResult(2, 0, { pageIndex: 0, x: 30, y: 30 });

      const images = [
        makeImage({
          id: 'floating-1',
          anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 },
          isInline: false,
        }),
        makeImage({
          id: 'inline-1',
          anchor: { row: 1, col: 0, xOffset: 0, yOffset: 0 },
          isInline: true,
        }),
        makeImage({
          id: 'floating-2',
          anchor: { row: 2, col: 0, xOffset: 0, yOffset: 0 },
          isInline: false,
        }),
      ];

      renderer.renderImages(images, posResolver, 0);

      // Only the two floating images should be rendered
      const drawCalls = backend.getCalls('drawImage');
      expect(drawCalls).toHaveLength(2);
    });

    it('filters mixed pages correctly', () => {
      const posResolver = new MockPositionResolver();
      posResolver.setResult(0, 0, { pageIndex: 0, x: 10, y: 10 });
      posResolver.setResult(1, 0, { pageIndex: 1, x: 20, y: 20 });
      posResolver.setResult(2, 0, { pageIndex: 0, x: 30, y: 30 });

      const images = [
        makeImage({ id: 'i1', anchor: { row: 0, col: 0, xOffset: 0, yOffset: 0 } }),
        makeImage({ id: 'i2', anchor: { row: 1, col: 0, xOffset: 0, yOffset: 0 } }),
        makeImage({ id: 'i3', anchor: { row: 2, col: 0, xOffset: 0, yOffset: 0 } }),
      ];

      renderer.renderImages(images, posResolver, 0);
      expect(backend.getCalls('drawImage')).toHaveLength(2);
    });
  });
});
