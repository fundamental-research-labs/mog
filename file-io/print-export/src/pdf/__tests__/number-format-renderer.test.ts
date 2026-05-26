/**
 * Tests for NumberFormatRenderer -- format-specific cell rendering in PDF export.
 *
 * Uses the same MockRenderBackend pattern as cell-renderer.test.ts.
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
import type { CellBounds, CellFormat, CellRenderData } from '../cell-renderer';
import { DefaultFontResolver } from '../font-resolver';
import type { NumberFormatResult } from '../number-format-renderer';
import { FORMAT_COLORS, NumberFormatRenderer, resolveFormatColor } from '../number-format-renderer';

// ============================================================================
// Mock RenderBackend (same pattern as cell-renderer.test.ts)
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
    this.measureTextFn = options?.measureText ?? ((text, _font, size) => text.length * size * 0.6);
  }

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
    return this.measureTextFn(text, font, size);
  }
  measureTextRuns(runs: TextRun[], maxWidth: number): TextMeasurement {
    this.record('measureTextRuns', runs, maxWidth);
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
// Test Fixtures
// ============================================================================

function createBounds(x = 10, y = 20, width = 100, height = 30): CellBounds {
  return { x, y, width, height };
}

function createRenderer(backend?: MockRenderBackend): {
  renderer: NumberFormatRenderer;
  backend: MockRenderBackend;
} {
  const b = backend ?? new MockRenderBackend();
  const fontResolver = new DefaultFontResolver();
  const renderer = new NumberFormatRenderer(b, fontResolver);
  return { renderer, backend: b };
}

function createNumberCell(): CellRenderData {
  return { displayValue: '1234.56', valueType: 'number' };
}

function createDefaultFormat(): CellFormat {
  return {};
}

// ============================================================================
// Tests: resolveFormatColor
// ============================================================================

describe('resolveFormatColor', () => {
  test('resolves standard color names (case-insensitive)', () => {
    expect(resolveFormatColor('Red')).toEqual([255, 0, 0]);
    expect(resolveFormatColor('red')).toEqual([255, 0, 0]);
    expect(resolveFormatColor('RED')).toEqual([255, 0, 0]);
    expect(resolveFormatColor('Blue')).toEqual([0, 0, 255]);
    expect(resolveFormatColor('Green')).toEqual([0, 128, 0]);
    expect(resolveFormatColor('Yellow')).toEqual([255, 255, 0]);
    expect(resolveFormatColor('Cyan')).toEqual([0, 255, 255]);
    expect(resolveFormatColor('Magenta')).toEqual([255, 0, 255]);
    expect(resolveFormatColor('White')).toEqual([255, 255, 255]);
    expect(resolveFormatColor('Black')).toEqual([0, 0, 0]);
  });

  test('returns undefined for unknown colors', () => {
    expect(resolveFormatColor('Purple')).toBeUndefined();
    expect(resolveFormatColor('Orange')).toBeUndefined();
    expect(resolveFormatColor('')).toBeUndefined();
  });
});

describe('FORMAT_COLORS', () => {
  test('has exactly 8 standard format colors', () => {
    expect(Object.keys(FORMAT_COLORS)).toHaveLength(8);
  });

  test('all values are RGB tuples in 0-255 range', () => {
    for (const [, rgb] of Object.entries(FORMAT_COLORS)) {
      expect(rgb).toHaveLength(3);
      for (const component of rgb) {
        expect(component).toBeGreaterThanOrEqual(0);
        expect(component).toBeLessThanOrEqual(255);
      }
    }
  });
});

// ============================================================================
// Tests: NumberFormatRenderer
// ============================================================================

describe('NumberFormatRenderer', () => {
  // --------------------------------------------------------------------------
  // Standard Format Rendering
  // --------------------------------------------------------------------------

  describe('standard format rendering', () => {
    test('renders a basic formatted number right-aligned by default', () => {
      const { renderer, backend } = createRenderer();
      const data = createNumberCell();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '1,234.56',
      };

      renderer.renderFormattedCell(data, format, numberFormat, createBounds());

      // Should call drawText with the formatted value
      const drawCalls = backend.getCalls('drawText');
      expect(drawCalls.length).toBe(1);
      expect(drawCalls[0].args[0]).toBe('1,234.56');

      // Should use right alignment (default for numbers)
      const opts = drawCalls[0].args[3] as TextOptions;
      expect(opts.halign).toBe('right');
    });

    test('applies format color override', () => {
      const { renderer, backend } = createRenderer();
      const data = createNumberCell();
      const format: CellFormat = { fontColor: [0, 0, 0] };
      const numberFormat: NumberFormatResult = {
        displayValue: '-42.00',
        colorOverride: [255, 0, 0], // [Red] format code
      };

      renderer.renderFormattedCell(data, format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      expect(drawCalls.length).toBe(1);
      // Color should be the override (red), not the format color (black)
      // Converted to 0-1 range: 255/255 = 1, 0/255 = 0
      const opts = drawCalls[0].args[3] as TextOptions;
      expect(opts.color).toEqual([1, 0, 0]);
    });

    test('uses cell font color when no format color override', () => {
      const { renderer, backend } = createRenderer();
      const data = createNumberCell();
      const format: CellFormat = { fontColor: [0, 0, 255] }; // blue
      const numberFormat: NumberFormatResult = {
        displayValue: '42',
      };

      renderer.renderFormattedCell(data, format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      const opts = drawCalls[0].args[3] as TextOptions;
      expect(opts.color).toEqual([0, 0, 1]); // blue in 0-1 range
    });

    test('uses black as default when no color specified', () => {
      const { renderer, backend } = createRenderer();
      const data = createNumberCell();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '42',
      };

      renderer.renderFormattedCell(data, format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      const opts = drawCalls[0].args[3] as TextOptions;
      expect(opts.color).toEqual([0, 0, 0]); // black
    });

    test('respects explicit left alignment', () => {
      const { renderer, backend } = createRenderer();
      const data = createNumberCell();
      const format: CellFormat = { horizontalAlignment: 'left' };
      const numberFormat: NumberFormatResult = {
        displayValue: '42',
      };

      renderer.renderFormattedCell(data, format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      const opts = drawCalls[0].args[3] as TextOptions;
      expect(opts.halign).toBe('left');
    });

    test('respects center alignment', () => {
      const { renderer, backend } = createRenderer();
      const data = createNumberCell();
      const format: CellFormat = { horizontalAlignment: 'center' };
      const numberFormat: NumberFormatResult = {
        displayValue: '42',
      };

      renderer.renderFormattedCell(data, format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      const opts = drawCalls[0].args[3] as TextOptions;
      expect(opts.halign).toBe('center');
    });
  });

  // --------------------------------------------------------------------------
  // Accounting Format
  // --------------------------------------------------------------------------

  describe('accounting format', () => {
    test('renders currency symbol left-aligned and number right-aligned', () => {
      const { renderer, backend } = createRenderer();
      const data = createNumberCell();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '$1,234.56',
        isAccounting: true,
        currencySymbol: '$',
      };

      renderer.renderFormattedCell(data, format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      expect(drawCalls.length).toBe(2);

      // First call: currency symbol, left-aligned
      expect(drawCalls[0].args[0]).toBe('$');
      const symbolOpts = drawCalls[0].args[3] as TextOptions;
      expect(symbolOpts.halign).toBe('left');

      // Second call: number part, right-aligned
      expect(drawCalls[1].args[0]).toBe('1,234.56');
      const numberOpts = drawCalls[1].args[3] as TextOptions;
      expect(numberOpts.halign).toBe('right');
    });

    test('currency symbol X is at left edge plus padding', () => {
      const { renderer, backend } = createRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '$42.00',
        isAccounting: true,
        currencySymbol: '$',
      };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, bounds);

      const drawCalls = backend.getCalls('drawText');
      // Left X = bounds.x + padding(2) = 12
      expect(drawCalls[0].args[1]).toBe(12);
    });

    test('number X is at right edge minus padding', () => {
      const { renderer, backend } = createRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '$42.00',
        isAccounting: true,
        currencySymbol: '$',
      };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, bounds);

      const drawCalls = backend.getCalls('drawText');
      // Right X = bounds.x + bounds.width - padding(2) = 108
      expect(drawCalls[1].args[1]).toBe(108);
    });

    test('respects indent in accounting format', () => {
      const { renderer, backend } = createRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const format: CellFormat = { indent: 2 }; // 2 * 8pt = 16pt indent
      const numberFormat: NumberFormatResult = {
        displayValue: '$42.00',
        isAccounting: true,
        currencySymbol: '$',
      };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, bounds);

      const drawCalls = backend.getCalls('drawText');
      // Left X = bounds.x + padding(2) + indent(16) = 28
      expect(drawCalls[0].args[1]).toBe(28);
    });

    test('handles suffix currency symbol (EUR)', () => {
      const { renderer, backend } = createRenderer();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '1,234.56EUR',
        isAccounting: true,
        currencySymbol: 'EUR',
      };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      expect(drawCalls[0].args[0]).toBe('EUR');
      expect(drawCalls[1].args[0]).toBe('1,234.56');
    });

    test('applies color override in accounting format', () => {
      const { renderer, backend } = createRenderer();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '$-42.00',
        isAccounting: true,
        currencySymbol: '$',
        colorOverride: [255, 0, 0],
      };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      // Both parts should have the red color override
      const symbolOpts = drawCalls[0].args[3] as TextOptions;
      const numberOpts = drawCalls[1].args[3] as TextOptions;
      expect(symbolOpts.color).toEqual([1, 0, 0]);
      expect(numberOpts.color).toEqual([1, 0, 0]);
    });
  });

  // --------------------------------------------------------------------------
  // Fraction Format
  // --------------------------------------------------------------------------

  describe('fraction format', () => {
    test('renders fraction with proper display value', () => {
      const { renderer, backend } = createRenderer();
      const data = createNumberCell();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '1 3/4',
        isFraction: true,
      };

      renderer.renderFormattedCell(data, format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      expect(drawCalls.length).toBe(1);
      expect(drawCalls[0].args[0]).toBe('1 3/4');
    });

    test('renders pure fraction (no integer part)', () => {
      const { renderer, backend } = createRenderer();
      const data = createNumberCell();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '7/8',
        isFraction: true,
      };

      renderer.renderFormattedCell(data, format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      expect(drawCalls[0].args[0]).toBe('7/8');
    });

    test('fraction defaults to right alignment', () => {
      const { renderer, backend } = createRenderer();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '1 3/4',
        isFraction: true,
      };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      const opts = drawCalls[0].args[3] as TextOptions;
      expect(opts.halign).toBe('right');
    });
  });

  // --------------------------------------------------------------------------
  // Scientific Notation
  // --------------------------------------------------------------------------

  describe('scientific notation', () => {
    test('renders scientific notation display value', () => {
      const { renderer, backend } = createRenderer();
      const data = createNumberCell();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '1.23E+04',
        isScientific: true,
      };

      renderer.renderFormattedCell(data, format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      expect(drawCalls.length).toBe(1);
      expect(drawCalls[0].args[0]).toBe('1.23E+04');
    });

    test('scientific notation defaults to right alignment', () => {
      const { renderer, backend } = createRenderer();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '1.23E+04',
        isScientific: true,
      };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      const opts = drawCalls[0].args[3] as TextOptions;
      expect(opts.halign).toBe('right');
    });

    test('applies color override to scientific notation', () => {
      const { renderer, backend } = createRenderer();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '1.23E+04',
        isScientific: true,
        colorOverride: [0, 0, 255], // blue
      };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, createBounds());

      const drawCalls = backend.getCalls('drawText');
      const opts = drawCalls[0].args[3] as TextOptions;
      expect(opts.color).toEqual([0, 0, 1]); // blue in 0-1 range
    });
  });

  // --------------------------------------------------------------------------
  // Background Rendering
  // --------------------------------------------------------------------------

  describe('background rendering', () => {
    test('renders background color when specified', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = { backgroundColor: [255, 255, 0] }; // yellow
      const numberFormat: NumberFormatResult = {
        displayValue: '42',
      };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, createBounds());

      const fillColorCalls = backend.getCalls('setFillColor');
      // First fill color should be the background (yellow in 0-1 range)
      expect(fillColorCalls[0].args).toEqual([1, 1, 0]);
    });

    test('does not render background when not specified', () => {
      const { renderer, backend } = createRenderer();
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = {
        displayValue: '42',
      };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, createBounds());

      // Should not call fill for background (only rect for clip)
      const fillCalls = backend.getCalls('fill');
      expect(fillCalls.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Graphics State Management
  // --------------------------------------------------------------------------

  describe('graphics state', () => {
    test('wraps rendering in save/restore', () => {
      const { renderer, backend } = createRenderer();
      const numberFormat: NumberFormatResult = { displayValue: '42' };

      renderer.renderFormattedCell(
        createNumberCell(),
        createDefaultFormat(),
        numberFormat,
        createBounds(),
      );

      expect(backend.calls[0].method).toBe('save');
      expect(backend.calls[backend.calls.length - 1].method).toBe('restore');
    });

    test('clips to cell bounds', () => {
      const { renderer, backend } = createRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const numberFormat: NumberFormatResult = { displayValue: '42' };

      renderer.renderFormattedCell(createNumberCell(), createDefaultFormat(), numberFormat, bounds);

      // After save: beginPath, rect(bounds), clip
      expect(backend.calls[1].method).toBe('beginPath');
      expect(backend.calls[2]).toEqual({ method: 'rect', args: [10, 20, 100, 30] });
      expect(backend.calls[3].method).toBe('clip');
    });
  });

  // --------------------------------------------------------------------------
  // Vertical Alignment
  // --------------------------------------------------------------------------

  describe('vertical alignment', () => {
    test('top alignment positions text near top', () => {
      const { renderer, backend } = createRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const format: CellFormat = { verticalAlignment: 'top' };
      const numberFormat: NumberFormatResult = { displayValue: '42' };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, bounds);

      const drawCalls = backend.getCalls('drawText');
      // Y = bounds.y + padding(2) + fontSize(11) = 33
      expect(drawCalls[0].args[2]).toBe(33);
    });

    test('middle alignment centers text vertically', () => {
      const { renderer, backend } = createRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const format: CellFormat = { verticalAlignment: 'middle' };
      const numberFormat: NumberFormatResult = { displayValue: '42' };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, bounds);

      const drawCalls = backend.getCalls('drawText');
      // Y = bounds.y + bounds.height/2 = 35
      expect(drawCalls[0].args[2]).toBe(35);
    });

    test('bottom alignment (default) positions text near bottom', () => {
      const { renderer, backend } = createRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const format = createDefaultFormat();
      const numberFormat: NumberFormatResult = { displayValue: '42' };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, bounds);

      const drawCalls = backend.getCalls('drawText');
      // Y = bounds.y + bounds.height - padding(2) = 48
      expect(drawCalls[0].args[2]).toBe(48);
    });
  });

  // --------------------------------------------------------------------------
  // Font Resolution
  // --------------------------------------------------------------------------

  describe('font resolution', () => {
    test('resolves font from format properties', () => {
      const { renderer, backend } = createRenderer();
      const format: CellFormat = {
        fontFamily: 'Arial',
        bold: true,
        italic: true,
        fontSize: 14,
      };
      const numberFormat: NumberFormatResult = { displayValue: '42' };

      renderer.renderFormattedCell(createNumberCell(), format, numberFormat, createBounds());

      const setFontCalls = backend.getCalls('setFont');
      expect(setFontCalls.length).toBe(1);
      const font = setFontCalls[0].args[0] as FontHandle;
      expect(font.weight).toBe('bold');
      expect(font.style).toBe('italic');
      expect(setFontCalls[0].args[1]).toBe(14); // fontSize
    });

    test('defaults to Calibri 11pt when no format specified', () => {
      const { renderer, backend } = createRenderer();
      const numberFormat: NumberFormatResult = { displayValue: '42' };

      renderer.renderFormattedCell(
        createNumberCell(),
        createDefaultFormat(),
        numberFormat,
        createBounds(),
      );

      const setFontCalls = backend.getCalls('setFont');
      expect(setFontCalls.length).toBe(1);
      expect(setFontCalls[0].args[1]).toBe(11); // default fontSize
    });
  });
});
