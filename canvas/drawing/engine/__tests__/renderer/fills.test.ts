/**
 * Tests for renderer/fills.ts
 *
 * Validates: renderFillToCanvas, fillToSVGAttributes, applyStopOpacity.
 */
import { jest } from '@jest/globals';

import type { DrawingFill, GradientStop } from '@mog-sdk/contracts/drawing';
import type { Path } from '@mog-sdk/contracts/geometry';
import {
  applyStopOpacity,
  fillToSVGAttributes,
  renderFillToCanvas,
} from '../../src/renderer/fills';

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
    translate: jest.fn(),
    scale: jest.fn(),
    fillStyle: '' as string | CanvasGradient | CanvasPattern,
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    globalAlpha: 1,
    setLineDash: jest.fn(),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  } as unknown as CanvasRenderingContext2D;
}

// Simple rectangle geometry for testing fills
const rectPath: Path = {
  segments: [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 100, y: 0 },
    { type: 'L', x: 100, y: 50 },
    { type: 'L', x: 0, y: 50 },
    { type: 'Z' },
  ],
  closed: true,
};

// ─── applyStopOpacity ─────────────────────────────────────────────────────

describe('applyStopOpacity', () => {
  it('returns color unchanged when opacity is undefined', () => {
    const stop: GradientStop = { offset: 0, color: '#ff0000' };
    expect(applyStopOpacity(stop)).toBe('#ff0000');
  });

  it('returns color unchanged when opacity is 1', () => {
    const stop: GradientStop = { offset: 0, color: '#ff0000', opacity: 1 };
    expect(applyStopOpacity(stop)).toBe('#ff0000');
  });

  it('returns rgba string for 6-digit hex color with opacity < 1', () => {
    const stop: GradientStop = { offset: 0, color: '#ff0000', opacity: 0.5 };
    expect(applyStopOpacity(stop)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('returns rgba string for 3-digit hex color with opacity < 1', () => {
    const stop: GradientStop = { offset: 0, color: '#f00', opacity: 0.3 };
    expect(applyStopOpacity(stop)).toBe('rgba(255, 0, 0, 0.3)');
  });

  it('handles 8-digit hex color (ignores existing alpha, applies stop opacity)', () => {
    const stop: GradientStop = { offset: 0, color: '#ff000080', opacity: 0.7 };
    expect(applyStopOpacity(stop)).toBe('rgba(255, 0, 0, 0.7)');
  });

  it('returns color as-is for non-hex formats with opacity', () => {
    // Named colors and other formats are returned unchanged for now
    const stop: GradientStop = { offset: 0, color: 'red', opacity: 0.5 };
    expect(applyStopOpacity(stop)).toBe('red');
  });

  it('handles zero opacity', () => {
    const stop: GradientStop = { offset: 0, color: '#00ff00', opacity: 0 };
    expect(applyStopOpacity(stop)).toBe('rgba(0, 255, 0, 0)');
  });
});

// ─── renderFillToCanvas ─────────────────────────────────────────────────────

describe('renderFillToCanvas', () => {
  it('does nothing for fill type "none"', () => {
    const ctx = createMockContext();
    const fill: DrawingFill = { type: 'none' };
    renderFillToCanvas(fill, rectPath, ctx);
    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  describe('solid fill', () => {
    it('sets fillStyle and calls fill', () => {
      const ctx = createMockContext();
      const fill: DrawingFill = { type: 'solid', color: '#ff0000' };
      renderFillToCanvas(fill, rectPath, ctx);
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.fillStyle).toBe('#ff0000');
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('applies opacity and resets it', () => {
      const ctx = createMockContext();
      const fill: DrawingFill = { type: 'solid', color: '#00ff00', opacity: 0.5 };
      renderFillToCanvas(fill, rectPath, ctx);
      // After rendering, globalAlpha should be reset to 1
      expect(ctx.globalAlpha).toBe(1);
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('does not change globalAlpha when no opacity specified', () => {
      const ctx = createMockContext();
      const fill: DrawingFill = { type: 'solid', color: '#0000ff' };
      renderFillToCanvas(fill, rectPath, ctx);
      expect(ctx.globalAlpha).toBe(1);
    });
  });

  describe('linear-gradient fill', () => {
    it('creates a linear gradient and fills', () => {
      const ctx = createMockContext();
      const mockGrad = { addColorStop: jest.fn() };
      (ctx.createLinearGradient as jest.Mock).mockReturnValue(mockGrad);

      const fill: DrawingFill = {
        type: 'linear-gradient',
        angle: 0,
        stops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#ffffff' },
        ],
      };
      renderFillToCanvas(fill, rectPath, ctx);

      expect(ctx.createLinearGradient).toHaveBeenCalled();
      expect(mockGrad.addColorStop).toHaveBeenCalledTimes(2);
      expect(mockGrad.addColorStop).toHaveBeenCalledWith(0, '#000000');
      expect(mockGrad.addColorStop).toHaveBeenCalledWith(1, '#ffffff');
      expect(ctx.fillStyle).toBe(mockGrad);
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('computes gradient endpoints based on angle', () => {
      const ctx = createMockContext();
      const mockGrad = { addColorStop: jest.fn() };
      (ctx.createLinearGradient as jest.Mock).mockReturnValue(mockGrad);

      const fill: DrawingFill = {
        type: 'linear-gradient',
        angle: 90, // top-to-bottom
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1, color: '#fff' },
        ],
      };
      renderFillToCanvas(fill, rectPath, ctx);

      // Verify gradient was created (exact coordinates depend on path bounds)
      const args = (ctx.createLinearGradient as jest.Mock).mock.calls[0];
      expect(args).toHaveLength(4);
      // x0, y0, x1, y1 should all be numbers
      for (const arg of args) {
        expect(typeof arg).toBe('number');
        expect(isNaN(arg)).toBe(false);
      }
    });

    it('applies stop opacity as rgba when stop has opacity < 1', () => {
      const ctx = createMockContext();
      const mockGrad = { addColorStop: jest.fn() };
      (ctx.createLinearGradient as jest.Mock).mockReturnValue(mockGrad);

      const fill: DrawingFill = {
        type: 'linear-gradient',
        angle: 0,
        stops: [
          { offset: 0, color: '#ff0000', opacity: 0.5 },
          { offset: 1, color: '#0000ff' },
        ],
      };
      renderFillToCanvas(fill, rectPath, ctx);

      expect(mockGrad.addColorStop).toHaveBeenCalledWith(0, 'rgba(255, 0, 0, 0.5)');
      expect(mockGrad.addColorStop).toHaveBeenCalledWith(1, '#0000ff');
    });
  });

  describe('radial-gradient fill', () => {
    it('creates a radial gradient with elliptical transform and fills', () => {
      const ctx = createMockContext();
      const mockGrad = { addColorStop: jest.fn() };
      (ctx.createRadialGradient as jest.Mock).mockReturnValue(mockGrad);

      const fill: DrawingFill = {
        type: 'radial-gradient',
        centerX: 50,
        centerY: 25,
        radiusX: 50,
        radiusY: 25,
        stops: [
          { offset: 0, color: 'red' },
          { offset: 1, color: 'blue' },
        ],
      };
      renderFillToCanvas(fill, rectPath, ctx);

      // Should use save/restore for the elliptical transform
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
      // Should use radiusY (25) as the circular radius, not Math.max(50, 25)
      expect(ctx.createRadialGradient).toHaveBeenCalledWith(50, 25, 0, 50, 25, 25);
      // Should scale x-axis by radiusX/radiusY = 2
      expect(ctx.scale).toHaveBeenCalledWith(2, 1);
      expect(mockGrad.addColorStop).toHaveBeenCalledTimes(2);
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('applies translate + scale + translate for elliptical shape', () => {
      const ctx = createMockContext();
      const mockGrad = { addColorStop: jest.fn() };
      (ctx.createRadialGradient as jest.Mock).mockReturnValue(mockGrad);

      const fill: DrawingFill = {
        type: 'radial-gradient',
        centerX: 100,
        centerY: 50,
        radiusX: 80,
        radiusY: 40,
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1, color: '#fff' },
        ],
      };
      renderFillToCanvas(fill, rectPath, ctx);

      // translate(centerX, 0), scale(rx/ry, 1), translate(-centerX, 0)
      expect(ctx.translate).toHaveBeenCalledWith(100, 0);
      expect(ctx.scale).toHaveBeenCalledWith(2, 1);
      expect(ctx.translate).toHaveBeenCalledWith(-100, 0);
      // Circular gradient with radiusY
      expect(ctx.createRadialGradient).toHaveBeenCalledWith(100, 50, 0, 100, 50, 40);
    });
  });

  describe('pattern fill', () => {
    it('falls back to foreground color', () => {
      const ctx = createMockContext();
      const fill: DrawingFill = {
        type: 'pattern',
        pattern: 'cross' as any,
        foreground: '#333333',
        background: '#ffffff',
      };
      renderFillToCanvas(fill, rectPath, ctx);
      expect(ctx.fillStyle).toBe('#333333');
      expect(ctx.fill).toHaveBeenCalled();
    });
  });

  describe('image fill', () => {
    it('does not call fill (deferred to caller)', () => {
      const ctx = createMockContext();
      const fill: DrawingFill = { type: 'image', src: 'image.png' };
      renderFillToCanvas(fill, rectPath, ctx);
      expect(ctx.fill).not.toHaveBeenCalled();
    });
  });
});

// ─── fillToSVGAttributes ────────────────────────────────────────────────────

describe('fillToSVGAttributes', () => {
  it('returns fill="none" for type "none"', () => {
    const result = fillToSVGAttributes({ type: 'none' }, 'g1');
    expect(result.attrs).toEqual({ fill: 'none' });
    expect(result.defs).toBeUndefined();
  });

  it('returns color for solid fill', () => {
    const result = fillToSVGAttributes({ type: 'solid', color: '#ff0000' }, 'g1');
    expect(result.attrs).toEqual({ fill: '#ff0000' });
    expect(result.defs).toBeUndefined();
  });

  it('includes fill-opacity for solid fill with opacity', () => {
    const result = fillToSVGAttributes({ type: 'solid', color: '#ff0000', opacity: 0.5 }, 'g1');
    expect(result.attrs).toEqual({ fill: '#ff0000', 'fill-opacity': '0.5' });
  });

  describe('linearGradient SVG', () => {
    it('generates linearGradient defs with x1/y1/x2/y2 endpoints', () => {
      const fill: DrawingFill = {
        type: 'linear-gradient',
        angle: 45,
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1, color: '#fff' },
        ],
      };
      const result = fillToSVGAttributes(fill, 'grad1');
      expect(result.attrs).toEqual({ fill: 'url(#grad1)' });
      expect(result.defs).toContain('<linearGradient');
      expect(result.defs).toContain('id="grad1"');
      expect(result.defs).toContain('x1=');
      expect(result.defs).toContain('y1=');
      expect(result.defs).toContain('x2=');
      expect(result.defs).toContain('y2=');
      expect(result.defs).toContain('stop-color="#000"');
      expect(result.defs).toContain('stop-color="#fff"');
      // Should NOT use rotate() transform anymore
      expect(result.defs).not.toContain('rotate(');
    });

    it('computes correct endpoints for angle=0 (left-to-right)', () => {
      const fill: DrawingFill = {
        type: 'linear-gradient',
        angle: 0,
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1, color: '#fff' },
        ],
      };
      const result = fillToSVGAttributes(fill, 'lg0');
      // angle=0 -> cos=1, sin=0 -> x1=0, y1=0.5, x2=1, y2=0.5
      expect(result.defs).toContain('x1="0.0000"');
      expect(result.defs).toContain('y1="0.5000"');
      expect(result.defs).toContain('x2="1.0000"');
      expect(result.defs).toContain('y2="0.5000"');
    });

    it('computes correct endpoints for angle=90 (top-to-bottom)', () => {
      const fill: DrawingFill = {
        type: 'linear-gradient',
        angle: 90,
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1, color: '#fff' },
        ],
      };
      const result = fillToSVGAttributes(fill, 'lg90');
      // angle=90 -> cos=0, sin=1 -> x1=0.5, y1=0, x2=0.5, y2=1
      expect(result.defs).toContain('x1="0.5000"');
      expect(result.defs).toContain('y1="0.0000"');
      expect(result.defs).toContain('x2="0.5000"');
      expect(result.defs).toContain('y2="1.0000"');
    });

    it('includes stop-opacity in linearGradient defs', () => {
      const fill: DrawingFill = {
        type: 'linear-gradient',
        angle: 0,
        stops: [{ offset: 0, color: '#000', opacity: 0.5 }],
      };
      const result = fillToSVGAttributes(fill, 'g1');
      expect(result.defs).toContain('stop-opacity="0.5"');
    });
  });

  describe('radialGradient SVG', () => {
    it('generates radialGradient defs with r attribute (not rx/ry)', () => {
      const fill: DrawingFill = {
        type: 'radial-gradient',
        centerX: 50,
        centerY: 50,
        radiusX: 40,
        radiusY: 30,
        stops: [
          { offset: 0, color: 'red' },
          { offset: 1, color: 'blue' },
        ],
      };
      const result = fillToSVGAttributes(fill, 'rg1');
      expect(result.attrs).toEqual({ fill: 'url(#rg1)' });
      expect(result.defs).toContain('<radialGradient');
      expect(result.defs).toContain('id="rg1"');
      expect(result.defs).toContain('cx="50"');
      expect(result.defs).toContain('cy="50"');
      // Must use r= (valid SVG), not rx=/ry= (invalid for radialGradient)
      expect(result.defs).toContain('r="30"');
      expect(result.defs).not.toContain('rx=');
      expect(result.defs).not.toContain('ry=');
    });

    it('uses gradientTransform for elliptical shape', () => {
      const fill: DrawingFill = {
        type: 'radial-gradient',
        centerX: 50,
        centerY: 50,
        radiusX: 40,
        radiusY: 30,
        stops: [
          { offset: 0, color: 'red' },
          { offset: 1, color: 'blue' },
        ],
      };
      const result = fillToSVGAttributes(fill, 'rg1');
      // Should use gradientTransform to scale x-axis for elliptical shape
      expect(result.defs).toContain('gradientTransform=');
      // scaleX = radiusX / radiusY = 40/30 = 1.333...
      expect(result.defs).toContain('scale(');
    });

    it('uses radiusY as the r value', () => {
      const fill: DrawingFill = {
        type: 'radial-gradient',
        centerX: 100,
        centerY: 75,
        radiusX: 60,
        radiusY: 45,
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1, color: '#fff' },
        ],
      };
      const result = fillToSVGAttributes(fill, 'rg2');
      expect(result.defs).toContain('r="45"');
      expect(result.defs).toContain('cx="100"');
      expect(result.defs).toContain('cy="75"');
    });
  });

  it('returns foreground for pattern fill (simplified)', () => {
    const fill: DrawingFill = {
      type: 'pattern',
      pattern: 'cross' as any,
      foreground: '#333',
      background: '#fff',
    };
    const result = fillToSVGAttributes(fill, 'p1');
    expect(result.attrs).toEqual({ fill: '#333' });
  });

  it('returns fill="none" for image fill', () => {
    const fill: DrawingFill = { type: 'image', src: 'img.png' };
    const result = fillToSVGAttributes(fill, 'i1');
    expect(result.attrs).toEqual({ fill: 'none' });
  });
});
