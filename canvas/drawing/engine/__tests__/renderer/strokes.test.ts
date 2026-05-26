/**
 * Tests for renderer/strokes.ts
 *
 * Validates: renderStrokeToCanvas, strokeToSVGAttributes.
 */
import { jest } from '@jest/globals';

import type { DrawingStroke } from '@mog-sdk/contracts/drawing';
import type { Path } from '@mog-sdk/contracts/geometry';
import { renderStrokeToCanvas, strokeToSVGAttributes } from '../../src/renderer/strokes';

// ─── Mock Canvas Context ────────────────────────────────────────────────────

function createMockContext(): CanvasRenderingContext2D {
  return {
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    bezierCurveTo: jest.fn(),
    quadraticCurveTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    fillStyle: '',
    strokeStyle: '' as string | CanvasGradient | CanvasPattern,
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    globalAlpha: 1,
    setLineDash: jest.fn(),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  } as unknown as CanvasRenderingContext2D;
}

// Simple line geometry for testing strokes
const linePath: Path = {
  segments: [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 100, y: 0 },
  ],
  closed: false,
};

// ─── renderStrokeToCanvas ───────────────────────────────────────────────────

describe('renderStrokeToCanvas', () => {
  it('sets strokeStyle, lineWidth, and calls stroke', () => {
    const ctx = createMockContext();
    const stroke: DrawingStroke = { color: '#ff0000', width: 2 };
    renderStrokeToCanvas(stroke, linePath, ctx);

    expect(ctx.strokeStyle).toBe('#ff0000');
    expect(ctx.lineWidth).toBe(2);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it('replays path segments before stroking', () => {
    const ctx = createMockContext();
    const stroke: DrawingStroke = { color: '#000', width: 1 };
    renderStrokeToCanvas(stroke, linePath, ctx);

    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 0);
  });

  describe('opacity', () => {
    it('applies opacity and resets it after', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, opacity: 0.3 };
      renderStrokeToCanvas(stroke, linePath, ctx);
      // After rendering, globalAlpha should be reset to 1
      expect(ctx.globalAlpha).toBe(1);
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('does not change globalAlpha without opacity', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1 };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.globalAlpha).toBe(1);
    });
  });

  describe('line cap', () => {
    it('maps "flat" to "butt"', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, cap: 'flat' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.lineCap).toBe('butt');
    });

    it('passes "round" through directly', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, cap: 'round' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.lineCap).toBe('round');
    });

    it('passes "square" through directly', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, cap: 'square' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.lineCap).toBe('square');
    });
  });

  describe('line join', () => {
    it('sets lineJoin to "round"', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, join: 'round' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.lineJoin).toBe('round');
    });

    it('sets lineJoin to "bevel"', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, join: 'bevel' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.lineJoin).toBe('bevel');
    });
  });

  describe('dash patterns', () => {
    it('sets dash pattern for "dash" style (scaled by width)', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 2, dash: 'dash' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      // dash = [4, 3], scaled by width 2 = [8, 6]
      expect(ctx.setLineDash).toHaveBeenCalledWith([8, 6]);
    });

    it('sets dash pattern for "dot" style', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, dash: 'dot' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.setLineDash).toHaveBeenCalledWith([1, 3]);
    });

    it('sets dash pattern for "dashDot" style', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, dash: 'dashDot' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.setLineDash).toHaveBeenCalledWith([4, 3, 1, 3]);
    });

    it('sets dash pattern for "dashDotDot" style', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, dash: 'dashDotDot' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.setLineDash).toHaveBeenCalledWith([4, 3, 1, 3, 1, 3]);
    });

    it('sets dash pattern for "longDash" style', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, dash: 'longDash' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.setLineDash).toHaveBeenCalledWith([8, 3]);
    });

    it('sets dash pattern for "longDashDot" style', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, dash: 'longDashDot' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.setLineDash).toHaveBeenCalledWith([8, 3, 1, 3]);
    });

    it('sets dash pattern for "longDashDotDot" style', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, dash: 'longDashDotDot' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.setLineDash).toHaveBeenCalledWith([8, 3, 1, 3, 1, 3]);
    });

    it('clears dash for "solid" style', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1, dash: 'solid' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.setLineDash).toHaveBeenCalledWith([]);
    });

    it('clears dash when no dash specified', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 1 };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.setLineDash).toHaveBeenCalledWith([]);
    });

    it('resets dash to empty after rendering', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = { color: '#000', width: 2, dash: 'dot' };
      renderStrokeToCanvas(stroke, linePath, ctx);
      // Last call to setLineDash should be reset to []
      const calls = (ctx.setLineDash as jest.Mock).mock.calls;
      expect(calls[calls.length - 1]).toEqual([[]]);
    });
  });

  describe('compound strokes', () => {
    it('uses reduced lineWidth for "double" compound', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = {
        color: '#000',
        width: 10,
        compound: 'double',
      };
      renderStrokeToCanvas(stroke, linePath, ctx);
      // Double compound: lineWidth should be set to totalWidth * 0.3 = 3
      expect(ctx.lineWidth).toBe(3);
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('uses reduced lineWidth for "triple" compound', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = {
        color: '#000',
        width: 8,
        compound: 'triple',
      };
      renderStrokeToCanvas(stroke, linePath, ctx);
      expect(ctx.lineWidth).toBe(2); // 8 * 0.25
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('uses normal stroke for "single" compound', () => {
      const ctx = createMockContext();
      const stroke: DrawingStroke = {
        color: '#000',
        width: 4,
        compound: 'single',
      };
      renderStrokeToCanvas(stroke, linePath, ctx);
      // single compound uses normal stroke, lineWidth stays at 4
      expect(ctx.lineWidth).toBe(4);
      expect(ctx.stroke).toHaveBeenCalled();
    });
  });
});

// ─── strokeToSVGAttributes ──────────────────────────────────────────────────

describe('strokeToSVGAttributes', () => {
  it('returns basic stroke and stroke-width', () => {
    const attrs = strokeToSVGAttributes({ color: '#000', width: 2 });
    expect(attrs).toEqual({
      stroke: '#000',
      'stroke-width': '2',
    });
  });

  it('includes stroke-opacity when specified', () => {
    const attrs = strokeToSVGAttributes({ color: '#000', width: 1, opacity: 0.5 });
    expect(attrs['stroke-opacity']).toBe('0.5');
  });

  it('maps "flat" cap to "butt"', () => {
    const attrs = strokeToSVGAttributes({ color: '#000', width: 1, cap: 'flat' });
    expect(attrs['stroke-linecap']).toBe('butt');
  });

  it('passes "round" cap through', () => {
    const attrs = strokeToSVGAttributes({ color: '#000', width: 1, cap: 'round' });
    expect(attrs['stroke-linecap']).toBe('round');
  });

  it('passes "square" cap through', () => {
    const attrs = strokeToSVGAttributes({ color: '#000', width: 1, cap: 'square' });
    expect(attrs['stroke-linecap']).toBe('square');
  });

  it('includes stroke-linejoin when specified', () => {
    const attrs = strokeToSVGAttributes({ color: '#000', width: 1, join: 'bevel' });
    expect(attrs['stroke-linejoin']).toBe('bevel');
  });

  it('generates dash array for "dash" style (scaled by width)', () => {
    const attrs = strokeToSVGAttributes({ color: '#000', width: 3, dash: 'dash' });
    // dash = [4, 3] * width 3 = [12, 9]
    expect(attrs['stroke-dasharray']).toBe('12 9');
  });

  it('generates dash array for "dot" style', () => {
    const attrs = strokeToSVGAttributes({ color: '#000', width: 2, dash: 'dot' });
    // dot = [1, 3] * 2 = [2, 6]
    expect(attrs['stroke-dasharray']).toBe('2 6');
  });

  it('does not include dasharray for "solid" style', () => {
    const attrs = strokeToSVGAttributes({ color: '#000', width: 1, dash: 'solid' });
    expect(attrs['stroke-dasharray']).toBeUndefined();
  });

  it('does not include dasharray when not specified', () => {
    const attrs = strokeToSVGAttributes({ color: '#000', width: 1 });
    expect(attrs['stroke-dasharray']).toBeUndefined();
  });

  it('includes all attributes together', () => {
    const attrs = strokeToSVGAttributes({
      color: 'blue',
      width: 2,
      opacity: 0.8,
      cap: 'round',
      join: 'round',
      dash: 'dashDot',
    });
    expect(attrs).toEqual({
      stroke: 'blue',
      'stroke-width': '2',
      'stroke-opacity': '0.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-dasharray': '8 6 2 6', // [4,3,1,3] * 2
    });
  });
});
