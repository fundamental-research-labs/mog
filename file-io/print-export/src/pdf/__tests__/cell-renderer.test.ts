/**
 * Tests for CellRenderer -- the core rendering engine for PDF export.
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
import type { CellBounds, CellFormat, CellRenderData, RichTextSegment } from '../cell-renderer';
import { CellRenderer } from '../cell-renderer';
import { DefaultFontResolver } from '../font-resolver';

// ============================================================================
// Mock RenderBackend
// ============================================================================

interface MockCall {
  method: string;
  args: unknown[];
}

class MockRenderBackend implements RenderBackend {
  calls: MockCall[] = [];
  private measureTextFn: (text: string, font: FontHandle, size: number) => number;

  constructor(options?: {
    measureText?: (text: string, font: FontHandle, size: number) => number;
  }) {
    // Default: approximate char width = fontSize * 0.6 per char
    this.measureTextFn = options?.measureText ?? ((text, _font, size) => text.length * size * 0.6);
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  // Page Lifecycle
  beginPage(width: number, height: number): void {
    this.record('beginPage', width, height);
  }
  async endPage(): Promise<void> {
    this.record('endPage');
  }

  // Graphics State
  save(): void {
    this.record('save');
  }
  restore(): void {
    this.record('restore');
  }

  // Transforms
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

  // Path Construction
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

  // Fill & Stroke
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

  // Text
  drawText(text: string, x: number, y: number, options: TextOptions): void {
    this.record('drawText', text, x, y, options);
  }
  drawTextRuns(runs: TextRun[], x: number, y: number, options: TextBlockOptions): void {
    this.record('drawTextRuns', runs, x, y, options);
  }
  measureText(text: string, font: FontHandle, size: number): number {
    this.record('measureText', text, font, size);
    return this.measureTextFn(text, font, size);
  }
  measureTextRuns(runs: TextRun[], maxWidth: number): TextMeasurement {
    this.record('measureTextRuns', runs, maxWidth);
    // Simple mock: all text on one line
    let totalWidth = 0;
    for (const run of runs) {
      const size = run.size ?? 12;
      totalWidth += run.text.length * size * 0.6;
    }
    return {
      width: totalWidth,
      height: 14.4,
      lines: [{ width: totalWidth, runs }],
    };
  }

  // Images
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

  // Font
  setFont(handle: FontHandle, size: number): void {
    this.record('setFont', handle, size);
  }

  // -- Test helpers --

  /** Get all calls to a specific method. */
  getCalls(method: string): MockCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /** Check if a method was called at least once. */
  wasCalled(method: string): boolean {
    return this.calls.some((c) => c.method === method);
  }

  /** Reset recorded calls. */
  reset(): void {
    this.calls = [];
  }
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createBounds(x = 10, y = 20, width = 100, height = 30): CellBounds {
  return { x, y, width, height };
}

function createRenderer(backend?: MockRenderBackend): {
  renderer: CellRenderer;
  backend: MockRenderBackend;
} {
  const b = backend ?? new MockRenderBackend();
  const fontResolver = new DefaultFontResolver();
  const renderer = new CellRenderer(b, fontResolver);
  return { renderer, backend: b };
}

function createTextCell(
  displayValue: string,
  valueType: CellRenderData['valueType'] = 'string',
): CellRenderData {
  return { displayValue, valueType };
}

// ============================================================================
// Tests
// ============================================================================

describe('CellRenderer', () => {
  // --------------------------------------------------------------------------
  // Background Fill
  // --------------------------------------------------------------------------

  describe('background fill', () => {
    it('renders solid background color', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { backgroundColor: [0.5, 0.5, 0.5] };
      const data = createTextCell('', 'empty');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      const fillColorCalls = backend.getCalls('setFillColor');
      expect(fillColorCalls.length).toBeGreaterThan(0);
      expect(fillColorCalls[0].args).toEqual([0.5, 0.5, 0.5]);

      expect(backend.wasCalled('rect')).toBe(true);
      expect(backend.wasCalled('fill')).toBe(true);
    });

    it('does not render background when no color specified', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {};
      const data = createTextCell('', 'empty');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      // Should not have any fill calls for background
      const fillCalls = backend.getCalls('fill');
      expect(fillCalls.length).toBe(0);
    });

    it('renders gradient fill with linear type', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {
        gradientFill: {
          type: 'linear',
          angle: 0,
          stops: [
            { position: 0, color: [1, 0, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
      };
      const data = createTextCell('', 'empty');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      // Gradient should create multiple rect+fill operations (stripes)
      const fillCalls = backend.getCalls('fill');
      expect(fillCalls.length).toBeGreaterThan(1);
    });

    it('renders radial gradient fill', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {
        gradientFill: {
          type: 'radial',
          stops: [
            { position: 0, color: [1, 1, 0] },
            { position: 1, color: [0, 1, 0] },
          ],
        },
      };
      const data = createTextCell('', 'empty');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      const fillCalls = backend.getCalls('fill');
      expect(fillCalls.length).toBeGreaterThan(1);
    });

    it('prioritizes gradient over solid color', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {
        backgroundColor: [1, 0, 0],
        gradientFill: {
          type: 'linear',
          stops: [
            { position: 0, color: [0, 1, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
      };
      const data = createTextCell('', 'empty');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      // First setFillColor should be from gradient (green), not solid (red)
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(fillColorCalls.length).toBeGreaterThan(0);
      // The gradient interpolates from green to blue, first stripe is near green
      expect(fillColorCalls[0].args[0]).toBeCloseTo(0, 0); // r near 0
    });

    it('renders pattern fill with Bayer-dithered marks', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {
        patternType: 'gray125',
        patternForeColor: [0, 0, 0],
        patternBackColor: [1, 1, 1],
      };
      const data = createTextCell('', 'empty');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      // New implementation uses proper pattern rendering:
      // 1. Background fill with bgColor
      // 2. Foreground pattern marks (Bayer-dithered rects) with fgColor
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(fillColorCalls.length).toBeGreaterThanOrEqual(2);
      // First fill: background white
      expect(fillColorCalls[0].args).toEqual([1, 1, 1]);
      // Second fill: foreground black (pattern marks)
      expect(fillColorCalls[1].args).toEqual([0, 0, 0]);

      // Should have multiple rect calls for Bayer-dithered pixels
      const rectCalls = backend.getCalls('rect');
      expect(rectCalls.length).toBeGreaterThan(2);

      // Should NOT use opacity approximation
      expect(backend.wasCalled('setFillAlpha')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Text Rendering - Horizontal Alignment
  // --------------------------------------------------------------------------

  describe('horizontal alignment', () => {
    it('left-aligns text by default for strings', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {};
      const data = createTextCell('Hello');
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);
      // Text should start near the left padding
      const textX = drawTextCalls[0].args[1] as number;
      expect(textX).toBeCloseTo(12, 0); // bounds.x + CELL_PADDING
    });

    it('right-aligns numbers under general alignment', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { horizontalAlignment: 'general' };
      const data = createTextCell('42.5', 'number');
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);
      // Text should be right-aligned (x > left padding)
      const textX = drawTextCalls[0].args[1] as number;
      expect(textX).toBeGreaterThan(12);
    });

    it('centers booleans under general alignment', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { horizontalAlignment: 'general' };
      const data = createTextCell('TRUE', 'boolean');
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);
      const textX = drawTextCalls[0].args[1] as number;
      // Should be roughly centered
      expect(textX).toBeGreaterThan(20);
      expect(textX).toBeLessThan(80);
    });

    it('renders center alignment', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { horizontalAlignment: 'center' };
      const data = createTextCell('Hi');
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);
      const textX = drawTextCalls[0].args[1] as number;
      // Centered in a 100px wide cell
      expect(textX).toBeGreaterThan(30);
      expect(textX).toBeLessThan(70);
    });

    it('renders right alignment', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { horizontalAlignment: 'right' };
      const data = createTextCell('Hi');
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);
      const textX = drawTextCalls[0].args[1] as number;
      expect(textX).toBeGreaterThan(50);
    });

    it('renders fill alignment (repeating text)', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { horizontalAlignment: 'fill' };
      const data = createTextCell('AB');
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      // 'AB' at fontSize 11 ~ 13.2pt wide, should repeat multiple times in 96pt content width
      expect(drawTextCalls.length).toBeGreaterThan(3);
    });

    it('renders distributed alignment (equal spacing)', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { horizontalAlignment: 'distributed' };
      const data = createTextCell('ABC');
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      // Each character should be a separate drawText call
      expect(drawTextCalls.length).toBe(3);
      expect(drawTextCalls[0].args[0]).toBe('A');
      expect(drawTextCalls[1].args[0]).toBe('B');
      expect(drawTextCalls[2].args[0]).toBe('C');

      // Characters should be spread across the width
      const x0 = drawTextCalls[0].args[1] as number;
      const x2 = drawTextCalls[2].args[1] as number;
      expect(x2 - x0).toBeGreaterThan(20);
    });

    it('treats centerContinuous as center', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { horizontalAlignment: 'centerContinuous' };
      const data = createTextCell('Hi');
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);
      const textX = drawTextCalls[0].args[1] as number;
      expect(textX).toBeGreaterThan(30);
      expect(textX).toBeLessThan(70);
    });

    it('left-aligns errors under general alignment', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { horizontalAlignment: 'general' };
      const data = createTextCell('#VALUE!', 'error');
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);
      const textX = drawTextCalls[0].args[1] as number;
      expect(textX).toBeCloseTo(12, 0);
    });
  });

  // --------------------------------------------------------------------------
  // Text Rendering - Vertical Alignment
  // --------------------------------------------------------------------------

  describe('vertical alignment', () => {
    it('top-aligns text', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { verticalAlignment: 'top' };
      const data = createTextCell('Hello');
      const bounds = createBounds(10, 20, 100, 60);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);
      const textY = drawTextCalls[0].args[2] as number;
      // Should be near the top
      expect(textY).toBeLessThan(40);
    });

    it('middle-aligns text', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { verticalAlignment: 'middle' };
      const data = createTextCell('Hello');
      const bounds = createBounds(10, 20, 100, 60);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);
      const textY = drawTextCalls[0].args[2] as number;
      // Should be roughly in the middle
      expect(textY).toBeGreaterThan(35);
      expect(textY).toBeLessThan(60);
    });

    it('bottom-aligns text (default)', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {};
      const data = createTextCell('Hello');
      const bounds = createBounds(10, 20, 100, 60);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);
      const textY = drawTextCalls[0].args[2] as number;
      // Should be near the bottom
      expect(textY).toBeGreaterThan(50);
    });
  });

  // --------------------------------------------------------------------------
  // Text Wrapping
  // --------------------------------------------------------------------------

  describe('text wrapping', () => {
    it('wraps text when wrapText is true', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { wrapText: true };
      // Long text that exceeds 96pt content width
      const data = createTextCell('This is a long text that should wrap to multiple lines');
      const bounds = createBounds(10, 20, 100, 80);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(1);
    });

    it('does not wrap text when wrapText is false', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { wrapText: false };
      const data = createTextCell('This is a long text that should not wrap');
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Shrink to Fit
  // --------------------------------------------------------------------------

  describe('shrink to fit', () => {
    it('reduces font size when text exceeds cell width', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { shrinkToFit: true, fontSize: 20 };
      const data = createTextCell('Very Long Text Here');
      const bounds = createBounds(10, 20, 50, 30);

      renderer.renderCell(data, format, bounds);

      // measureText should have been called with a smaller font size
      const measureCalls = backend.getCalls('measureText');
      expect(measureCalls.length).toBeGreaterThan(0);
    });

    it('does not shrink when text fits', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { shrinkToFit: true, fontSize: 11 };
      const data = createTextCell('Hi');
      const bounds = createBounds(10, 20, 200, 30);

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Text Rotation
  // --------------------------------------------------------------------------

  describe('text rotation', () => {
    it('applies rotation transform for non-zero rotation', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { textRotation: 45 };
      const data = createTextCell('Rotated');
      const bounds = createBounds(10, 20, 100, 60);

      renderer.renderCell(data, format, bounds);

      expect(backend.wasCalled('translate')).toBe(true);
      expect(backend.wasCalled('rotate')).toBe(true);
    });

    it('renders vertical text for rotation=255', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { textRotation: 255 };
      const data = createTextCell('ABC');
      const bounds = createBounds(10, 20, 40, 100);

      renderer.renderCell(data, format, bounds);

      // Should render each character separately
      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBe(3);
      expect(drawTextCalls[0].args[0]).toBe('A');
      expect(drawTextCalls[1].args[0]).toBe('B');
      expect(drawTextCalls[2].args[0]).toBe('C');
    });

    it('uses counter-clockwise for 0-90 degrees', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { textRotation: 90 };
      const data = createTextCell('Up');
      const bounds = createBounds(10, 20, 100, 60);

      renderer.renderCell(data, format, bounds);

      const rotateCalls = backend.getCalls('rotate');
      expect(rotateCalls.length).toBeGreaterThan(0);
      const angle = rotateCalls[0].args[0] as number;
      expect(angle).toBeCloseTo(Math.PI / 2, 2);
    });
  });

  // --------------------------------------------------------------------------
  // Indent
  // --------------------------------------------------------------------------

  describe('indent', () => {
    it('shifts text right by indent level', () => {
      const { renderer, backend } = createRenderer();
      const formatNoIndent: CellFormat = {};
      const formatIndent: CellFormat = { indent: 2 };
      const data = createTextCell('Indented');
      const bounds = createBounds(10, 20, 200, 30);

      // Render without indent
      renderer.renderCell(data, formatNoIndent, bounds);
      const noIndentCalls = backend.getCalls('drawText');
      const noIndentX = noIndentCalls[0].args[1] as number;

      backend.reset();

      // Render with indent
      renderer.renderCell(data, formatIndent, bounds);
      const indentCalls = backend.getCalls('drawText');
      const indentX = indentCalls[0].args[1] as number;

      // Indented text should be further right
      expect(indentX).toBeGreaterThan(noIndentX);
      expect(indentX - noIndentX).toBeCloseTo(16, 0); // 2 * 8px indent
    });
  });

  // --------------------------------------------------------------------------
  // Hyperlink Styling
  // --------------------------------------------------------------------------

  describe('hyperlink styling', () => {
    it('renders hyperlinks in blue with underline', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { isHyperlink: true };
      const data = createTextCell('Click here');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);

      const options = drawTextCalls[0].args[3] as TextOptions;
      // Color should be blue-ish
      expect(options.color![0]).toBeCloseTo(5 / 255, 2);
      expect(options.color![1]).toBeCloseTo(99 / 255, 2);
      expect(options.color![2]).toBeCloseTo(193 / 255, 2);
      expect(options.underline).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Comment Indicator
  // --------------------------------------------------------------------------

  describe('comment indicator', () => {
    it('renders red triangle in top-right corner', () => {
      const { renderer, backend } = createRenderer();
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCommentIndicator(bounds);

      // Should draw a filled red triangle
      expect(backend.wasCalled('setFillColor')).toBe(true);
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(fillColorCalls[0].args).toEqual([1, 0, 0]);

      expect(backend.wasCalled('moveTo')).toBe(true);
      expect(backend.wasCalled('lineTo')).toBe(true);
      expect(backend.wasCalled('closePath')).toBe(true);
      expect(backend.wasCalled('fill')).toBe(true);

      // Triangle should be in the top-right corner
      const moveToCalls = backend.getCalls('moveTo');
      const moveX = moveToCalls[0].args[0] as number;
      expect(moveX).toBeCloseTo(104, 0); // x + width - 6
    });
  });

  // --------------------------------------------------------------------------
  // Checkbox Rendering
  // --------------------------------------------------------------------------

  describe('checkbox', () => {
    it('renders unchecked checkbox', () => {
      const { renderer, backend } = createRenderer();
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCheckbox(false, bounds);

      // Should draw a rectangle (checkbox border) but no checkmark
      expect(backend.wasCalled('rect')).toBe(true);
      expect(backend.wasCalled('stroke')).toBe(true);

      // Should NOT have the checkmark path (no lineTo after the rect+stroke sequence)
      const calls = backend.calls;
      const strokeIndex = calls.findIndex((c) => c.method === 'stroke');
      // After the first stroke (checkbox border), no more strokes for unchecked
      const remainingStrokes = calls.slice(strokeIndex + 1).filter((c) => c.method === 'stroke');
      expect(remainingStrokes.length).toBe(0);
    });

    it('renders checked checkbox with checkmark', () => {
      const { renderer, backend } = createRenderer();
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCheckbox(true, bounds);

      // Should have two stroke operations: border + checkmark
      const strokeCalls = backend.getCalls('stroke');
      expect(strokeCalls.length).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Rich Text
  // --------------------------------------------------------------------------

  describe('rich text', () => {
    it('renders rich text with multiple segments', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {};
      const segments: RichTextSegment[] = [
        { text: 'Bold', bold: true },
        { text: ' Normal' },
        { text: ' Italic', italic: true },
      ];
      const data: CellRenderData = {
        displayValue: 'Bold Normal Italic',
        valueType: 'string',
        richText: segments,
      };
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      expect(backend.wasCalled('drawTextRuns')).toBe(true);
      const drawTextRunsCalls = backend.getCalls('drawTextRuns');
      expect(drawTextRunsCalls.length).toBe(1);

      const runs = drawTextRunsCalls[0].args[0] as TextRun[];
      expect(runs.length).toBe(3);
      expect(runs[0].bold).toBe(true);
      expect(runs[1].bold).toBe(false);
      expect(runs[2].italic).toBe(true);
    });

    it('passes superscript/subscript to text runs', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {};
      const segments: RichTextSegment[] = [{ text: 'x', superscript: true }, { text: '2' }];
      const data: CellRenderData = {
        displayValue: 'x2',
        valueType: 'string',
        richText: segments,
      };
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      const drawTextRunsCalls = backend.getCalls('drawTextRuns');
      const runs = drawTextRunsCalls[0].args[0] as TextRun[];
      expect(runs[0].superscript).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Empty Cell
  // --------------------------------------------------------------------------

  describe('empty cell', () => {
    it('does not render content for empty cells', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {};
      const data = createTextCell('', 'empty');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      expect(backend.wasCalled('drawText')).toBe(false);
      expect(backend.wasCalled('drawTextRuns')).toBe(false);
    });

    it('still renders background for empty cells', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { backgroundColor: [1, 0, 0] };
      const data = createTextCell('', 'empty');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      expect(backend.wasCalled('fill')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Underline Types
  // --------------------------------------------------------------------------

  describe('underline types', () => {
    it('renders single underline', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { underline: 'single' };
      const data = createTextCell('Underlined');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      expect(drawTextCalls.length).toBeGreaterThan(0);
      const options = drawTextCalls[0].args[3] as TextOptions;
      expect(options.underline).toBe(true);
    });

    it('renders accounting underline extending to cell width', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { underline: 'singleAccounting' };
      const data = createTextCell('Amount');
      const bounds = createBounds(10, 20, 100, 30);

      renderer.renderCell(data, format, bounds);

      // Should have underline strokes extending beyond text width
      const lineToCalls = backend.getCalls('lineTo');
      const lineToXValues = lineToCalls.map((c) => c.args[0] as number);
      // At least one lineTo should reach near the cell content width
      const maxLineToX = Math.max(...lineToXValues);
      expect(maxLineToX).toBeGreaterThan(50);
    });
  });

  // --------------------------------------------------------------------------
  // Rendering Order
  // --------------------------------------------------------------------------

  describe('rendering order', () => {
    it('renders in order: background, content, borders', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {
        backgroundColor: [0.9, 0.9, 0.9],
        borderBottom: { style: 'thin', color: [0, 0, 0] },
      };
      const data = createTextCell('Cell');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      // Find first fill (background), first drawText (content), and border stroke
      const firstFill = backend.calls.findIndex((c) => c.method === 'fill');
      const firstDrawText = backend.calls.findIndex((c) => c.method === 'drawText');

      expect(firstFill).toBeLessThan(firstDrawText);
    });
  });

  // --------------------------------------------------------------------------
  // Clipping
  // --------------------------------------------------------------------------

  describe('clipping', () => {
    it('clips content to cell bounds', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {};
      const data = createTextCell('Some text');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      // Should set up clipping before drawing text
      expect(backend.wasCalled('clip')).toBe(true);

      const clipIndex = backend.calls.findIndex((c) => c.method === 'clip');
      const drawTextIndex = backend.calls.findIndex((c) => c.method === 'drawText');
      expect(clipIndex).toBeLessThan(drawTextIndex);
    });
  });

  // --------------------------------------------------------------------------
  // Font Color
  // --------------------------------------------------------------------------

  describe('font color', () => {
    it('uses specified font color', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { fontColor: [1, 0, 0] };
      const data = createTextCell('Red text');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      const options = drawTextCalls[0].args[3] as TextOptions;
      expect(options.color).toEqual([1, 0, 0]);
    });

    it('uses black font color by default', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {};
      const data = createTextCell('Default color');
      const bounds = createBounds();

      renderer.renderCell(data, format, bounds);

      const drawTextCalls = backend.getCalls('drawText');
      const options = drawTextCalls[0].args[3] as TextOptions;
      expect(options.color).toEqual([0, 0, 0]);
    });
  });
});
