/**
 * Tests for BorderRenderer -- maps all 13 Excel border styles to
 * RenderBackend drawing commands.
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
import {
  getBorderDash,
  getBorderWidth,
  renderBorderSide,
  renderCellBorders,
  renderDiagonalBorder,
} from '../border-renderer';
import type { BorderStyle, CellBounds } from '../cell-renderer';

// ============================================================================
// Mock RenderBackend (simplified for border tests)
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

  beginPage(w: number, h: number): void {
    this.record('beginPage', w, h);
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
  rotate(a: number): void {
    this.record('rotate', a);
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
    return { width: 0, height: 0, lines: [] };
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
// Tests
// ============================================================================

describe('BorderRenderer', () => {
  // --------------------------------------------------------------------------
  // Border Width Mapping
  // --------------------------------------------------------------------------

  describe('getBorderWidth', () => {
    it('returns 0.25 for hair', () => {
      expect(getBorderWidth('hair')).toBe(0.25);
    });

    it('returns 0.5 for thin', () => {
      expect(getBorderWidth('thin')).toBe(0.5);
    });

    it('returns 1 for medium', () => {
      expect(getBorderWidth('medium')).toBe(1);
    });

    it('returns 1.5 for thick', () => {
      expect(getBorderWidth('thick')).toBe(1.5);
    });

    it('returns 0.5 for dashed', () => {
      expect(getBorderWidth('dashed')).toBe(0.5);
    });

    it('returns 0.5 for dotted', () => {
      expect(getBorderWidth('dotted')).toBe(0.5);
    });

    it('returns 0.5 for double', () => {
      expect(getBorderWidth('double')).toBe(0.5);
    });

    it('returns 1 for mediumDashed', () => {
      expect(getBorderWidth('mediumDashed')).toBe(1);
    });

    it('returns 1 for mediumDashDot', () => {
      expect(getBorderWidth('mediumDashDot')).toBe(1);
    });

    it('returns 1 for mediumDashDotDot', () => {
      expect(getBorderWidth('mediumDashDotDot')).toBe(1);
    });

    it('returns 0.5 for slantDashDot', () => {
      expect(getBorderWidth('slantDashDot')).toBe(0.5);
    });

    it('returns 0.5 for dashDot', () => {
      expect(getBorderWidth('dashDot')).toBe(0.5);
    });

    it('returns 0.5 for dashDotDot', () => {
      expect(getBorderWidth('dashDotDot')).toBe(0.5);
    });
  });

  // --------------------------------------------------------------------------
  // Border Dash Patterns
  // --------------------------------------------------------------------------

  describe('getBorderDash', () => {
    it('returns null (solid) for thin', () => {
      expect(getBorderDash('thin')).toBeNull();
    });

    it('returns null (solid) for medium', () => {
      expect(getBorderDash('medium')).toBeNull();
    });

    it('returns null (solid) for thick', () => {
      expect(getBorderDash('thick')).toBeNull();
    });

    it('returns null (solid) for hair', () => {
      expect(getBorderDash('hair')).toBeNull();
    });

    it('returns [4,4] for dashed', () => {
      expect(getBorderDash('dashed')).toEqual({ segments: [4, 4], phase: 0 });
    });

    it('returns [1,2] for dotted', () => {
      expect(getBorderDash('dotted')).toEqual({ segments: [1, 2], phase: 0 });
    });

    it('returns [4,2,1,2] for dashDot', () => {
      expect(getBorderDash('dashDot')).toEqual({ segments: [4, 2, 1, 2], phase: 0 });
    });

    it('returns [4,2,1,2,1,2] for dashDotDot', () => {
      expect(getBorderDash('dashDotDot')).toEqual({ segments: [4, 2, 1, 2, 1, 2], phase: 0 });
    });

    it('returns [6,3] for mediumDashed', () => {
      expect(getBorderDash('mediumDashed')).toEqual({ segments: [6, 3], phase: 0 });
    });

    it('returns [6,3,1,3] for mediumDashDot', () => {
      expect(getBorderDash('mediumDashDot')).toEqual({ segments: [6, 3, 1, 3], phase: 0 });
    });

    it('returns [6,3,1,3,1,3] for mediumDashDotDot', () => {
      expect(getBorderDash('mediumDashDotDot')).toEqual({ segments: [6, 3, 1, 3, 1, 3], phase: 0 });
    });

    it('returns [4,2,1,2] for slantDashDot', () => {
      expect(getBorderDash('slantDashDot')).toEqual({ segments: [4, 2, 1, 2], phase: 0 });
    });

    it('returns null for double (solid lines)', () => {
      expect(getBorderDash('double')).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // renderBorderSide
  // --------------------------------------------------------------------------

  describe('renderBorderSide', () => {
    it('renders a thin solid border', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'thin', color: [0, 0, 0] };

      renderBorderSide(backend, border, 10, 20, 110, 20);

      expect(backend.wasCalled('save')).toBe(true);
      expect(backend.wasCalled('restore')).toBe(true);
      expect(backend.wasCalled('stroke')).toBe(true);

      const lineWidthCalls = backend.getCalls('setLineWidth');
      expect(lineWidthCalls[0].args[0]).toBe(0.5);

      const strokeColorCalls = backend.getCalls('setStrokeColor');
      expect(strokeColorCalls[0].args).toEqual([0, 0, 0]);
    });

    it('renders a dashed border with correct dash pattern', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'dashed', color: [1, 0, 0] };

      renderBorderSide(backend, border, 0, 0, 100, 0);

      const dashCalls = backend.getCalls('setLineDash');
      expect(dashCalls.length).toBeGreaterThan(0);
      expect(dashCalls[0].args[0]).toEqual([4, 4]);
    });

    it('renders a double border with two parallel strokes', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'double', color: [0, 0, 1] };

      renderBorderSide(backend, border, 0, 50, 100, 50); // horizontal

      const strokeCalls = backend.getCalls('stroke');
      expect(strokeCalls.length).toBe(2); // Two parallel lines
    });

    it('renders a thick border with 1.5pt width', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'thick', color: [0, 0, 0] };

      renderBorderSide(backend, border, 0, 0, 0, 100);

      const lineWidthCalls = backend.getCalls('setLineWidth');
      expect(lineWidthCalls[0].args[0]).toBe(1.5);
    });

    it('renders a medium border with 1pt width', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'medium', color: [0, 0, 0] };

      renderBorderSide(backend, border, 0, 0, 100, 0);

      const lineWidthCalls = backend.getCalls('setLineWidth');
      expect(lineWidthCalls[0].args[0]).toBe(1);
    });

    it('renders dotted border with [1,2] pattern', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'dotted', color: [0.5, 0.5, 0.5] };

      renderBorderSide(backend, border, 0, 0, 100, 0);

      const dashCalls = backend.getCalls('setLineDash');
      expect(dashCalls[0].args[0]).toEqual([1, 2]);
    });

    it('sets butt line cap and miter line join', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'thin', color: [0, 0, 0] };

      renderBorderSide(backend, border, 0, 0, 100, 0);

      const capCalls = backend.getCalls('setLineCap');
      expect(capCalls[0].args[0]).toBe('butt');

      const joinCalls = backend.getCalls('setLineJoin');
      expect(joinCalls[0].args[0]).toBe('miter');
    });
  });

  // --------------------------------------------------------------------------
  // renderDiagonalBorder
  // --------------------------------------------------------------------------

  describe('renderDiagonalBorder', () => {
    const bounds: CellBounds = { x: 10, y: 20, width: 100, height: 30 };

    it('renders diagonal-down (top-left to bottom-right)', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'thin', color: [0, 0, 0] };

      renderDiagonalBorder(backend, border, bounds, 'down');

      const moveToCalls = backend.getCalls('moveTo');
      const lineToCalls = backend.getCalls('lineTo');

      expect(moveToCalls.length).toBeGreaterThan(0);
      expect(lineToCalls.length).toBeGreaterThan(0);

      // Should go from (10, 20) to (110, 50)
      expect(moveToCalls[0].args).toEqual([10, 20]);
      expect(lineToCalls[0].args).toEqual([110, 50]);
    });

    it('renders diagonal-up (bottom-left to top-right)', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'thin', color: [0, 0, 0] };

      renderDiagonalBorder(backend, border, bounds, 'up');

      const moveToCalls = backend.getCalls('moveTo');
      const lineToCalls = backend.getCalls('lineTo');

      // Should go from (10, 50) to (110, 20)
      expect(moveToCalls[0].args).toEqual([10, 50]);
      expect(lineToCalls[0].args).toEqual([110, 20]);
    });

    it('renders double diagonal border', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'double', color: [0, 0, 0] };

      renderDiagonalBorder(backend, border, bounds, 'down');

      const strokeCalls = backend.getCalls('stroke');
      expect(strokeCalls.length).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // renderCellBorders
  // --------------------------------------------------------------------------

  describe('renderCellBorders', () => {
    const bounds: CellBounds = { x: 10, y: 20, width: 100, height: 30 };

    it('renders all four sides', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'thin', color: [0, 0, 0] };

      renderCellBorders(backend, bounds, {
        borderTop: border,
        borderRight: border,
        borderBottom: border,
        borderLeft: border,
      });

      // Each side is save + setup + stroke + restore, so 4 strokes
      const strokeCalls = backend.getCalls('stroke');
      expect(strokeCalls.length).toBe(4);
    });

    it('renders only specified borders', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'thin', color: [0, 0, 0] };

      renderCellBorders(backend, bounds, {
        borderTop: border,
        borderBottom: border,
      });

      const strokeCalls = backend.getCalls('stroke');
      expect(strokeCalls.length).toBe(2);
    });

    it('renders no borders when none specified', () => {
      const backend = new MockRenderBackend();

      renderCellBorders(backend, bounds, {});

      expect(backend.wasCalled('stroke')).toBe(false);
    });

    it('renders borders with diagonal up and down', () => {
      const backend = new MockRenderBackend();
      const border: BorderStyle = { style: 'thin', color: [0, 0, 0] };

      renderCellBorders(backend, bounds, {
        borderDiagonalUp: border,
        borderDiagonalDown: border,
      });

      const strokeCalls = backend.getCalls('stroke');
      expect(strokeCalls.length).toBe(2);
    });

    it('renders mixed border styles', () => {
      const backend = new MockRenderBackend();

      renderCellBorders(backend, bounds, {
        borderTop: { style: 'thin', color: [0, 0, 0] },
        borderBottom: { style: 'thick', color: [1, 0, 0] },
      });

      const lineWidthCalls = backend.getCalls('setLineWidth');
      expect(lineWidthCalls.length).toBe(2);
      expect(lineWidthCalls[0].args[0]).toBe(0.5); // thin
      expect(lineWidthCalls[1].args[0]).toBe(1.5); // thick
    });
  });
});
