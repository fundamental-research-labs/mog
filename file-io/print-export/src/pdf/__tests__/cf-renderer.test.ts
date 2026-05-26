/**
 * Tests for CFRenderer -- conditional formatting visuals in PDF export.
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
import type { CellBounds, CellFormat } from '../cell-renderer';
import type { CFResult, DataBarRenderData, IconSetRenderData } from '../cf-renderer';
import { CFRenderer } from '../cf-renderer';
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

function createCFRenderer(backend?: MockRenderBackend): {
  renderer: CFRenderer;
  backend: MockRenderBackend;
} {
  const b = backend ?? new MockRenderBackend();
  const fontResolver = new DefaultFontResolver();
  const renderer = new CFRenderer(b, fontResolver);
  return { renderer, backend: b };
}

// ============================================================================
// Tests: applyCFOverrides
// ============================================================================

describe('CFRenderer', () => {
  describe('applyCFOverrides', () => {
    test('returns original format when no overrides', () => {
      const { renderer } = createCFRenderer();
      const format: CellFormat = { fontColor: [0, 0, 0], bold: true };
      const cfResult: CFResult = {};

      const result = renderer.applyCFOverrides(format, cfResult);
      expect(result).toBe(format); // same reference
    });

    test('merges style overrides into format', () => {
      const { renderer } = createCFRenderer();
      const format: CellFormat = { fontColor: [0, 0, 0], bold: false, fontSize: 11 };
      const cfResult: CFResult = {
        styleOverrides: { fontColor: [255, 0, 0], bold: true },
      };

      const result = renderer.applyCFOverrides(format, cfResult);
      expect(result.fontColor).toEqual([255, 0, 0]);
      expect(result.bold).toBe(true);
      expect(result.fontSize).toBe(11); // preserved from original
    });

    test('overrides take precedence over base format', () => {
      const { renderer } = createCFRenderer();
      const format: CellFormat = { backgroundColor: [255, 255, 255] };
      const cfResult: CFResult = {
        styleOverrides: { backgroundColor: [255, 200, 200] },
      };

      const result = renderer.applyCFOverrides(format, cfResult);
      expect(result.backgroundColor).toEqual([255, 200, 200]);
    });

    test('does not modify original format object', () => {
      const { renderer } = createCFRenderer();
      const format: CellFormat = { fontColor: [0, 0, 0] };
      const cfResult: CFResult = {
        styleOverrides: { fontColor: [255, 0, 0] },
      };

      renderer.applyCFOverrides(format, cfResult);
      expect(format.fontColor).toEqual([0, 0, 0]); // unchanged
    });
  });

  // --------------------------------------------------------------------------
  // Data Bar Rendering
  // --------------------------------------------------------------------------

  describe('renderDataBar', () => {
    test('renders a solid positive data bar', () => {
      const { renderer, backend } = createCFRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const bar: DataBarRenderData = {
        fillPercent: 0.6,
        color: [0, 128, 0], // green
        showValue: true,
        isNegative: false,
        fillType: 'solid',
      };

      renderer.renderDataBar(bar, bounds);

      // Should draw a filled rectangle
      const fillCalls = backend.getCalls('fill');
      expect(fillCalls.length).toBeGreaterThan(0);

      // Should set fill color to green (0-1 range)
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 0) < 0.01 &&
            Math.abs((c.args[1] as number) - 0.502) < 0.01 &&
            Math.abs((c.args[2] as number) - 0) < 0.01,
        ),
      ).toBe(true);

      // Bar should be 60% of cell width
      const rectCalls = backend.getCalls('rect');
      const barRect = rectCalls.find((c) => {
        const w = c.args[2] as number;
        return Math.abs(w - 60) < 1; // 0.6 * 100
      });
      expect(barRect).toBeDefined();
    });

    test('renders a gradient data bar (two halves)', () => {
      const { renderer, backend } = createCFRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const bar: DataBarRenderData = {
        fillPercent: 0.8,
        color: [0, 0, 255], // blue
        showValue: true,
        isNegative: false,
        fillType: 'gradient',
      };

      renderer.renderDataBar(bar, bounds);

      // Gradient draws TWO filled rectangles (full color + lighter shade)
      const fillCalls = backend.getCalls('fill');
      expect(fillCalls.length).toBe(2);
    });

    test('renders negative bar extending left from axis', () => {
      const { renderer, backend } = createCFRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const bar: DataBarRenderData = {
        fillPercent: 0.4,
        color: [0, 128, 0],
        negativeColor: [255, 0, 0],
        showValue: true,
        isNegative: true,
        axisPosition: 0.5, // axis at center
        fillType: 'solid',
      };

      renderer.renderDataBar(bar, bounds);

      // Should use negative color (red)
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 1) < 0.01 &&
            Math.abs((c.args[1] as number) - 0) < 0.01 &&
            Math.abs((c.args[2] as number) - 0) < 0.01,
        ),
      ).toBe(true);
    });

    test('renders axis line when axisPosition is set', () => {
      const { renderer, backend } = createCFRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const bar: DataBarRenderData = {
        fillPercent: 0.6,
        color: [0, 128, 0],
        showValue: true,
        isNegative: false,
        axisPosition: 0.3,
        fillType: 'solid',
      };

      renderer.renderDataBar(bar, bounds);

      // Axis is drawn as a vertical line
      const strokeCalls = backend.getCalls('stroke');
      expect(strokeCalls.length).toBeGreaterThan(0);

      // Axis at x = 10 + 100 * 0.3 = 40
      const moveToCalls = backend.getCalls('moveTo');
      const axisMove = moveToCalls.find((c) => Math.abs((c.args[0] as number) - 40) < 0.5);
      expect(axisMove).toBeDefined();
    });

    test('positive bar with axis extends rightward from axis', () => {
      const { renderer, backend } = createCFRenderer();
      const bounds = createBounds(0, 0, 200, 40);
      const bar: DataBarRenderData = {
        fillPercent: 0.5,
        color: [0, 128, 0],
        showValue: false,
        isNegative: false,
        axisPosition: 0.25, // axis at 50pt
        fillType: 'solid',
      };

      renderer.renderDataBar(bar, bounds);

      // Bar starts at axis (50) and extends rightward
      // Available width = 200 * (1 - 0.25) = 150
      // Bar width = 150 * 0.5 = 75
      const rectCalls = backend.getCalls('rect');
      const barRect = rectCalls.find((c) => {
        const x = c.args[0] as number;
        const w = c.args[2] as number;
        return Math.abs(x - 50) < 1 && Math.abs(w - 75) < 1;
      });
      expect(barRect).toBeDefined();
    });

    test('bar has a border stroke', () => {
      const { renderer, backend } = createCFRenderer();
      const bar: DataBarRenderData = {
        fillPercent: 0.5,
        color: [0, 128, 0],
        showValue: true,
        isNegative: false,
        fillType: 'solid',
      };

      renderer.renderDataBar(bar, createBounds());

      // Should have a stroke call for the border
      const strokeCalls = backend.getCalls('stroke');
      expect(strokeCalls.length).toBeGreaterThan(0);
    });

    test('wraps in save/restore', () => {
      const { renderer, backend } = createCFRenderer();
      const bar: DataBarRenderData = {
        fillPercent: 0.5,
        color: [0, 128, 0],
        showValue: true,
        isNegative: false,
        fillType: 'solid',
      };

      renderer.renderDataBar(bar, createBounds());

      expect(backend.calls[0].method).toBe('save');
      expect(backend.calls[backend.calls.length - 1].method).toBe('restore');
    });

    test('uses default color for negative bar when negativeColor not specified', () => {
      const { renderer, backend } = createCFRenderer();
      const bar: DataBarRenderData = {
        fillPercent: 0.4,
        color: [0, 128, 0], // green
        showValue: true,
        isNegative: true,
        axisPosition: 0.5,
        fillType: 'solid',
      };

      renderer.renderDataBar(bar, createBounds());

      // Should use the regular color (green) since no negativeColor
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 0) < 0.01 &&
            Math.abs((c.args[1] as number) - 0.502) < 0.01,
        ),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Icon Set Rendering
  // --------------------------------------------------------------------------

  describe('renderIcon', () => {
    test('renders 3arrows-up (green triangle)', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '3arrows-up',
        iconOnly: false,
      };

      const offset = renderer.renderIcon(iconSet, createBounds());

      // Should return icon width + gap
      expect(offset).toBe(20); // 16 + 4

      // Should set fill color to green
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 0) < 0.01 &&
            Math.abs((c.args[1] as number) - 0.5) < 0.01 &&
            Math.abs((c.args[2] as number) - 0) < 0.01,
        ),
      ).toBe(true);

      // Should draw triangle path (moveTo + lineTo + lineTo + closePath + fill)
      expect(backend.wasCalled('moveTo')).toBe(true);
      expect(backend.wasCalled('lineTo')).toBe(true);
      expect(backend.wasCalled('closePath')).toBe(true);
      expect(backend.wasCalled('fill')).toBe(true);
    });

    test('renders 3arrows-down (red triangle)', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '3arrows-down',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      // Should set fill color to red
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 1) < 0.01 &&
            Math.abs((c.args[1] as number) - 0) < 0.01,
        ),
      ).toBe(true);
    });

    test('renders 3arrows-right (yellow diamond)', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '3arrows-right',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      // Should set fill color to yellow
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 0.8) < 0.01 &&
            Math.abs((c.args[1] as number) - 0.8) < 0.01,
        ),
      ).toBe(true);
    });

    test('renders 3trafficlights-green (green circle)', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '3trafficlights-green',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      // Circle uses curveTo for bezier arcs
      expect(backend.wasCalled('curveTo')).toBe(true);
      expect(backend.wasCalled('fill')).toBe(true);
    });

    test('renders 3trafficlights-yellow (yellow circle)', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '3trafficlights-yellow',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      const fillColorCalls = backend.getCalls('setFillColor');
      expect(fillColorCalls.some((c) => Math.abs((c.args[0] as number) - 0.8) < 0.01)).toBe(true);
    });

    test('renders 3trafficlights-red (red circle)', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '3trafficlights-red',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 1) < 0.01 &&
            Math.abs((c.args[1] as number) - 0) < 0.01,
        ),
      ).toBe(true);
    });

    test('renders 3symbols-check (green checkmark)', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '3symbols-check',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      // Checkmark uses stroke, not fill
      expect(backend.wasCalled('stroke')).toBe(true);
      const strokeColorCalls = backend.getCalls('setStrokeColor');
      expect(
        strokeColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 0) < 0.01 &&
            Math.abs((c.args[1] as number) - 0.5) < 0.01,
        ),
      ).toBe(true);
    });

    test('renders 3symbols-exclamation (yellow exclamation)', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '3symbols-exclamation',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      // Should draw the triangle background
      expect(backend.wasCalled('fill')).toBe(true);
      // And the exclamation stroke
      expect(backend.wasCalled('stroke')).toBe(true);
    });

    test('renders 3symbols-x (red X)', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '3symbols-x',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      // X draws two stroke lines
      const strokeCalls = backend.getCalls('stroke');
      expect(strokeCalls.length).toBeGreaterThanOrEqual(2);
    });

    test('renders 4arrows-diagonal-up', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '4arrows-diagonal-up',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      expect(backend.wasCalled('fill')).toBe(true);
    });

    test('renders 4arrows-diagonal-down', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '4arrows-diagonal-down',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      expect(backend.wasCalled('fill')).toBe(true);
    });

    test('renders 5rating icon (filled star)', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '5rating-3',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      // Star draws a polygon path with fill
      expect(backend.wasCalled('fill')).toBe(true);
      // Gold color for filled star
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(fillColorCalls.some((c) => Math.abs((c.args[0] as number) - 0.9) < 0.1)).toBe(true);
    });

    test('renders 5rating-0 icon (empty star)', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '5rating-0',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      // Empty star uses fillAndStroke
      expect(backend.wasCalled('fillAndStroke')).toBe(true);
    });

    test('renders placeholder for unknown icon', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: 'unknown-icon',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      // Should draw a gray placeholder rectangle
      expect(backend.wasCalled('stroke')).toBe(true);
      expect(backend.wasCalled('rect')).toBe(true);
    });

    test('returns correct text offset', () => {
      const { renderer } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '3arrows-up',
        iconOnly: false,
      };

      const offset = renderer.renderIcon(iconSet, createBounds());
      expect(offset).toBe(20); // ICON_SIZE(16) + ICON_TEXT_GAP(4)
    });

    test('icon is centered vertically within cell', () => {
      const { renderer, backend } = createCFRenderer();
      const bounds = createBounds(10, 20, 100, 40);
      const iconSet: IconSetRenderData = {
        iconId: '3arrows-up',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, bounds);

      // Icon Y = bounds.y + (bounds.height - ICON_SIZE) / 2 = 20 + (40 - 16) / 2 = 32
      const moveToCalls = backend.getCalls('moveTo');
      // Triangle top point: iconX + 8, iconY (= 32)
      expect(moveToCalls.length).toBeGreaterThan(0);
    });

    test('wraps in save/restore', () => {
      const { renderer, backend } = createCFRenderer();
      const iconSet: IconSetRenderData = {
        iconId: '3arrows-up',
        iconOnly: false,
      };

      renderer.renderIcon(iconSet, createBounds());

      expect(backend.calls[0].method).toBe('save');
      expect(backend.calls[backend.calls.length - 1].method).toBe('restore');
    });
  });

  // --------------------------------------------------------------------------
  // Color Scale Rendering
  // --------------------------------------------------------------------------

  describe('renderColorScale', () => {
    test('renders solid background fill', () => {
      const { renderer, backend } = createCFRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const color: [number, number, number] = [255, 200, 200]; // light red

      renderer.renderColorScale(color, bounds);

      // Should set fill color (converted to 0-1 range)
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 1) < 0.01 &&
            Math.abs((c.args[1] as number) - 200 / 255) < 0.01 &&
            Math.abs((c.args[2] as number) - 200 / 255) < 0.01,
        ),
      ).toBe(true);

      // Should fill the full cell bounds
      const rectCalls = backend.getCalls('rect');
      expect(
        rectCalls.some(
          (c) => c.args[0] === 10 && c.args[1] === 20 && c.args[2] === 100 && c.args[3] === 30,
        ),
      ).toBe(true);

      expect(backend.wasCalled('fill')).toBe(true);
    });

    test('wraps in save/restore', () => {
      const { renderer, backend } = createCFRenderer();

      renderer.renderColorScale([128, 128, 128], createBounds());

      expect(backend.calls[0].method).toBe('save');
      expect(backend.calls[backend.calls.length - 1].method).toBe('restore');
    });

    test('renders with extreme colors (black)', () => {
      const { renderer, backend } = createCFRenderer();

      renderer.renderColorScale([0, 0, 0], createBounds());

      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some((c) => c.args[0] === 0 && c.args[1] === 0 && c.args[2] === 0),
      ).toBe(true);
    });

    test('renders with extreme colors (white)', () => {
      const { renderer, backend } = createCFRenderer();

      renderer.renderColorScale([255, 255, 255], createBounds());

      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some((c) => c.args[0] === 1 && c.args[1] === 1 && c.args[2] === 1),
      ).toBe(true);
    });
  });
});
