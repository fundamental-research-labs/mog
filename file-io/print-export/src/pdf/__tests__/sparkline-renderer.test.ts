/**
 * Tests for SparklineRenderer -- sparkline rendering in PDF export.
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
import type { CellBounds } from '../cell-renderer';
import type { SparklineOptions, SparklineRenderData } from '../sparkline-renderer';
import { SparklineRenderer } from '../sparkline-renderer';

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

function createSparklineRenderer(backend?: MockRenderBackend): {
  renderer: SparklineRenderer;
  backend: MockRenderBackend;
} {
  const b = backend ?? new MockRenderBackend();
  const renderer = new SparklineRenderer(b);
  return { renderer, backend: b };
}

function createDefaultOptions(): SparklineOptions {
  return {
    seriesColor: [0, 112, 192], // blue
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SparklineRenderer', () => {
  // --------------------------------------------------------------------------
  // Empty/Edge Cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    test('does nothing for empty values array', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      expect(backend.calls.length).toBe(0);
    });

    test('handles single value in line sparkline', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [42],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      // Should still draw a point (moveTo only, no lineTo for the path)
      expect(backend.wasCalled('save')).toBe(true);
      expect(backend.wasCalled('restore')).toBe(true);
    });

    test('handles all same values', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [5, 5, 5, 5],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      // All points at same Y (range=0 -> normalized=0.5)
      expect(backend.wasCalled('stroke')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Line Sparkline
  // --------------------------------------------------------------------------

  describe('line sparkline', () => {
    test('draws a line path through data points', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [1, 3, 2, 5, 4],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      // Should have moveTo for first point and lineTo for remaining
      const moveToCalls = backend.getCalls('moveTo');
      const lineToCalls = backend.getCalls('lineTo');
      expect(moveToCalls.length).toBeGreaterThanOrEqual(1);
      expect(lineToCalls.length).toBe(4); // 5 points - 1 moveTo = 4 lineTo
    });

    test('sets correct stroke color from options', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [1, 2, 3],
        options: { seriesColor: [255, 0, 0] }, // red
      };

      renderer.renderSparkline(data, createBounds());

      const strokeColorCalls = backend.getCalls('setStrokeColor');
      expect(
        strokeColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 1) < 0.01 &&
            Math.abs((c.args[1] as number) - 0) < 0.01 &&
            Math.abs((c.args[2] as number) - 0) < 0.01,
        ),
      ).toBe(true);
    });

    test('uses custom line weight', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [1, 2, 3],
        options: { ...createDefaultOptions(), lineWeight: 2.5 },
      };

      renderer.renderSparkline(data, createBounds());

      const lineWidthCalls = backend.getCalls('setLineWidth');
      expect(lineWidthCalls.some((c) => c.args[0] === 2.5)).toBe(true);
    });

    test('uses default line weight of 1', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [1, 2, 3],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      const lineWidthCalls = backend.getCalls('setLineWidth');
      expect(lineWidthCalls.some((c) => c.args[0] === 1)).toBe(true);
    });

    test('draws axis when showAxis is true and data spans zero', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [-2, 1, 3, -1, 4],
        options: { ...createDefaultOptions(), showAxis: true },
      };

      renderer.renderSparkline(data, createBounds());

      // Axis is drawn as a gray line
      const strokeColorCalls = backend.getCalls('setStrokeColor');
      expect(strokeColorCalls.some((c) => Math.abs((c.args[0] as number) - 0.5) < 0.01)).toBe(true);
    });

    test('does not draw axis when all values are positive', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [1, 2, 3],
        options: { ...createDefaultOptions(), showAxis: true },
      };

      renderer.renderSparkline(data, createBounds());

      // Axis should NOT be drawn (all positive, minVal >= 0)
      // Only stroke calls should be for the line path
      const strokeColorCalls = backend.getCalls('setStrokeColor');
      // No gray axis color (0.5, 0.5, 0.5) should appear
      const grayStrokes = strokeColorCalls.filter(
        (c) =>
          Math.abs((c.args[0] as number) - 0.5) < 0.01 &&
          Math.abs((c.args[1] as number) - 0.5) < 0.01,
      );
      expect(grayStrokes.length).toBe(0);
    });

    test('draws markers at high point', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [1, 5, 3], // high = index 1
        options: {
          ...createDefaultOptions(),
          markers: { high: [0, 128, 0] }, // green marker at high
        },
      };

      renderer.renderSparkline(data, createBounds());

      // Marker draws a circle using curveTo
      expect(backend.wasCalled('curveTo')).toBe(true);

      // Should have green fill for the marker
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 0) < 0.01 &&
            Math.abs((c.args[1] as number) - 0.502) < 0.01,
        ),
      ).toBe(true);
    });

    test('draws markers at low point', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [3, 1, 5], // low = index 1
        options: {
          ...createDefaultOptions(),
          markers: { low: [255, 0, 0] }, // red marker at low
        },
      };

      renderer.renderSparkline(data, createBounds());

      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 1) < 0.01 &&
            Math.abs((c.args[1] as number) - 0) < 0.01,
        ),
      ).toBe(true);
    });

    test('draws markers at first and last points', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [2, 4, 3],
        options: {
          ...createDefaultOptions(),
          markers: {
            first: [0, 0, 255], // blue
            last: [128, 0, 128], // purple
          },
        },
      };

      renderer.renderSparkline(data, createBounds());

      // Should draw two marker circles
      const fillColorCalls = backend.getCalls('setFillColor');
      // Blue marker
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 0) < 0.01 &&
            Math.abs((c.args[1] as number) - 0) < 0.01 &&
            Math.abs((c.args[2] as number) - 1) < 0.01,
        ),
      ).toBe(true);
      // Purple marker
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 0.502) < 0.01 &&
            Math.abs((c.args[1] as number) - 0) < 0.01 &&
            Math.abs((c.args[2] as number) - 0.502) < 0.01,
        ),
      ).toBe(true);
    });

    test('draws markers at all negative points', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [2, -1, 3, -4, 1],
        options: {
          ...createDefaultOptions(),
          markers: { negative: [255, 0, 0] },
        },
      };

      renderer.renderSparkline(data, createBounds());

      // Should draw markers at indices 1 and 3
      const curveToCalls = backend.getCalls('curveTo');
      // Each marker circle = 4 curveTo calls; 2 markers = 8 curveTo calls
      expect(curveToCalls.length).toBe(8);
    });

    test('draws markers at all points', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [1, 2, 3],
        options: {
          ...createDefaultOptions(),
          markers: { all: [100, 100, 100] },
        },
      };

      renderer.renderSparkline(data, createBounds());

      // 3 markers, 4 curveTo each = 12 curveTo calls
      const curveToCalls = backend.getCalls('curveTo');
      expect(curveToCalls.length).toBe(12);
    });

    test('respects custom min/max scaling', () => {
      const { renderer, backend } = createSparklineRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      // With minValue=0, maxValue=10: value 5 should be at 50% height
      const data: SparklineRenderData = {
        type: 'line',
        values: [5],
        options: {
          ...createDefaultOptions(),
          minValue: 0,
          maxValue: 10,
        },
      };

      renderer.renderSparkline(data, bounds);

      // Plot area: y=23, height=24 (bounds padded by 3 on each side)
      // Normalized = (5 - 0) / 10 = 0.5
      // Y = 23 + 24 - 0.5 * 24 = 35
      const moveToCalls = backend.getCalls('moveTo');
      const firstMove = moveToCalls.find((c) => {
        const y = c.args[1] as number;
        return Math.abs(y - 35) < 0.5;
      });
      expect(firstMove).toBeDefined();
    });

    test('wraps in save/restore', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [1, 2, 3],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      expect(backend.calls[0].method).toBe('save');
      expect(backend.calls[backend.calls.length - 1].method).toBe('restore');
    });

    test('uses round line cap and join for smooth lines', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [1, 2, 3],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      const lineCapCalls = backend.getCalls('setLineCap');
      expect(lineCapCalls.some((c) => c.args[0] === 'round')).toBe(true);

      const lineJoinCalls = backend.getCalls('setLineJoin');
      expect(lineJoinCalls.some((c) => c.args[0] === 'round')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Column Sparkline
  // --------------------------------------------------------------------------

  describe('column sparkline', () => {
    test('draws rectangles for each data point', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'column',
        values: [3, 1, 4, 2],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      // Should draw 4 filled rectangles (one per value)
      const fillCalls = backend.getCalls('fill');
      expect(fillCalls.length).toBe(4);

      const rectCalls = backend.getCalls('rect');
      expect(rectCalls.length).toBe(4);
    });

    test('uses negative color for negative bars', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'column',
        values: [3, -2, 4],
        options: {
          seriesColor: [0, 112, 192], // blue
          negativeColor: [255, 0, 0], // red
        },
      };

      renderer.renderSparkline(data, createBounds());

      // Should have red fill for negative bar
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

    test('positive bars extend upward from axis', () => {
      const { renderer, backend } = createSparklineRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const data: SparklineRenderData = {
        type: 'column',
        values: [0, 5, 10], // all positive
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, bounds);

      // All bars should be above the bottom (axis at bottom since min=0)
      const rectCalls = backend.getCalls('rect');
      expect(rectCalls.length).toBe(3);
    });

    test('draws axis for mixed positive/negative data', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'column',
        values: [-2, 3, -1, 4],
        options: { ...createDefaultOptions(), showAxis: true },
      };

      renderer.renderSparkline(data, createBounds());

      // Axis draws a gray stroke
      const strokeColorCalls = backend.getCalls('setStrokeColor');
      expect(strokeColorCalls.some((c) => Math.abs((c.args[0] as number) - 0.5) < 0.01)).toBe(true);
    });

    test('wraps in save/restore', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'column',
        values: [1, 2, 3],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      expect(backend.calls[0].method).toBe('save');
      expect(backend.calls[backend.calls.length - 1].method).toBe('restore');
    });

    test('uses series color for negative when negativeColor not set', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'column',
        values: [3, -2],
        options: { seriesColor: [0, 112, 192] }, // no negativeColor
      };

      renderer.renderSparkline(data, createBounds());

      // Both bars should use the series color (blue)
      const fillColorCalls = backend.getCalls('setFillColor');
      for (const call of fillColorCalls) {
        expect(
          Math.abs((call.args[0] as number) - 0 / 255) < 0.01 ||
            Math.abs((call.args[0] as number) - 0) < 0.01,
        ).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Win/Loss Sparkline
  // --------------------------------------------------------------------------

  describe('winLoss sparkline', () => {
    test('draws fixed-height bars', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'winLoss',
        values: [1, -1, 1, 0, -1],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      // Should draw 5 bars
      const fillCalls = backend.getCalls('fill');
      expect(fillCalls.length).toBe(5);
    });

    test('win bars are above axis, loss bars below', () => {
      const { renderer, backend } = createSparklineRenderer();
      const bounds = createBounds(0, 0, 100, 40);
      const data: SparklineRenderData = {
        type: 'winLoss',
        values: [1, -1],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, bounds);

      // Plot area: y=3, height=34, axisY = 3 + 34/2 = 20
      // Win bar: y = 20 - 17 = 3 (above axis)
      // Loss bar: y = 20 (below axis)
      const rectCalls = backend.getCalls('rect');
      expect(rectCalls.length).toBe(2);

      // Win bar (first): y should be above axis
      const winBarY = rectCalls[0].args[1] as number;
      const lossBarY = rectCalls[1].args[1] as number;
      expect(winBarY).toBeLessThan(lossBarY);
    });

    test('zero values render as thin line', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'winLoss',
        values: [0],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      // Zero bar should have height of 1
      const rectCalls = backend.getCalls('rect');
      expect(rectCalls.length).toBe(1);
      const height = rectCalls[0].args[3] as number;
      expect(height).toBe(1);
    });

    test('uses negative color for loss bars', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'winLoss',
        values: [1, -1],
        options: {
          seriesColor: [0, 112, 192], // blue
          negativeColor: [255, 0, 0], // red
        },
      };

      renderer.renderSparkline(data, createBounds());

      // Should have red fill for loss bar
      const fillColorCalls = backend.getCalls('setFillColor');
      expect(
        fillColorCalls.some(
          (c) =>
            Math.abs((c.args[0] as number) - 1) < 0.01 &&
            Math.abs((c.args[1] as number) - 0) < 0.01,
        ),
      ).toBe(true);
    });

    test('draws axis when showAxis is true', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'winLoss',
        values: [1, -1],
        options: { ...createDefaultOptions(), showAxis: true },
      };

      renderer.renderSparkline(data, createBounds());

      // Axis draws a gray horizontal line
      const strokeColorCalls = backend.getCalls('setStrokeColor');
      expect(strokeColorCalls.some((c) => Math.abs((c.args[0] as number) - 0.5) < 0.01)).toBe(true);

      expect(backend.wasCalled('stroke')).toBe(true);
    });

    test('does not draw axis when showAxis is false', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'winLoss',
        values: [1, -1],
        options: { ...createDefaultOptions(), showAxis: false },
      };

      renderer.renderSparkline(data, createBounds());

      // No gray stroke color for axis
      const strokeColorCalls = backend.getCalls('setStrokeColor');
      expect(strokeColorCalls.length).toBe(0);
    });

    test('wraps in save/restore', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'winLoss',
        values: [1, -1],
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      expect(backend.calls[0].method).toBe('save');
      expect(backend.calls[backend.calls.length - 1].method).toBe('restore');
    });

    test('all win bars have same height', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'winLoss',
        values: [1, 5, 100], // different magnitudes, same display
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, createBounds());

      const rectCalls = backend.getCalls('rect');
      expect(rectCalls.length).toBe(3);

      // All bars should have the same height (halfHeight)
      const heights = rectCalls.map((c) => c.args[3] as number);
      expect(heights[0]).toBe(heights[1]);
      expect(heights[1]).toBe(heights[2]);
    });
  });

  // --------------------------------------------------------------------------
  // Scaling
  // --------------------------------------------------------------------------

  describe('scaling', () => {
    test('auto-detects min/max from values', () => {
      const { renderer, backend } = createSparklineRenderer();
      const bounds = createBounds(10, 20, 100, 30);
      const data: SparklineRenderData = {
        type: 'line',
        values: [2, 8], // min=2, max=8, range=6
        options: createDefaultOptions(),
      };

      renderer.renderSparkline(data, bounds);

      // First point (value=2) should be at bottom of plot area
      // Last point (value=8) should be at top of plot area
      const moveToCalls = backend.getCalls('moveTo');
      const lineToCalls = backend.getCalls('lineTo');

      // The line path: moveTo for first point, lineTo for second
      // First point (min=2, normalized=0): y = plotArea.y + plotArea.height
      // Second point (max=8, normalized=1): y = plotArea.y
      // Plot area: y=23, height=24
      const firstY = moveToCalls[0].args[1] as number;
      const secondY = lineToCalls[0].args[1] as number;
      expect(firstY).toBeGreaterThan(secondY); // bottom > top in screen coords
    });

    test('uses custom minValue and maxValue', () => {
      const { renderer, backend } = createSparklineRenderer();
      const data: SparklineRenderData = {
        type: 'line',
        values: [5], // single value
        options: {
          ...createDefaultOptions(),
          minValue: 0,
          maxValue: 10,
        },
      };

      renderer.renderSparkline(data, createBounds(10, 20, 100, 30));

      // value=5, min=0, max=10 -> normalized=0.5
      const moveToCalls = backend.getCalls('moveTo');
      // Plot area: y=23, height=24
      // Y = 23 + 24 - 0.5 * 24 = 35
      const y = moveToCalls[0].args[1] as number;
      expect(Math.abs(y - 35)).toBeLessThan(0.5);
    });
  });
});
