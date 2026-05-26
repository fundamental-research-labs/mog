/**
 * Tests for renderer/path.ts
 *
 * Validates: replayPathToCanvas, pathToPath2D, computePathBounds.
 */
import { jest } from '@jest/globals';

import type { Path } from '@mog-sdk/contracts/geometry';
import { computePathBounds, pathToPath2D, replayPathToCanvas } from '../../src/renderer/path';

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

// ─── replayPathToCanvas ─────────────────────────────────────────────────────

describe('replayPathToCanvas', () => {
  it('replays MoveTo segments', () => {
    const ctx = createMockContext();
    const path: Path = {
      segments: [{ type: 'M', x: 10, y: 20 }],
      closed: false,
    };
    replayPathToCanvas(path, ctx);
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20);
  });

  it('replays LineTo segments', () => {
    const ctx = createMockContext();
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 100, y: 50 },
      ],
      closed: false,
    };
    replayPathToCanvas(path, ctx);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 50);
  });

  it('replays CurveTo segments', () => {
    const ctx = createMockContext();
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'C', x1: 10, y1: 20, x2: 30, y2: 40, x: 50, y: 60 },
      ],
      closed: false,
    };
    replayPathToCanvas(path, ctx);
    expect(ctx.bezierCurveTo).toHaveBeenCalledWith(10, 20, 30, 40, 50, 60);
  });

  it('replays QuadraticTo segments', () => {
    const ctx = createMockContext();
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'Q', x1: 25, y1: 50, x: 50, y: 0 },
      ],
      closed: false,
    };
    replayPathToCanvas(path, ctx);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledWith(25, 50, 50, 0);
  });

  it('replays ClosePath segments', () => {
    const ctx = createMockContext();
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 100, y: 0 },
        { type: 'L', x: 100, y: 100 },
        { type: 'Z' },
      ],
      closed: true,
    };
    replayPathToCanvas(path, ctx);
    expect(ctx.closePath).toHaveBeenCalledTimes(1);
  });

  it('replays a complex path with all segment types', () => {
    const ctx = createMockContext();
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 100, y: 0 },
        { type: 'C', x1: 110, y1: 10, x2: 110, y2: 90, x: 100, y: 100 },
        { type: 'Q', x1: 50, y1: 120, x: 0, y: 100 },
        { type: 'Z' },
      ],
      closed: true,
    };
    replayPathToCanvas(path, ctx);
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(1);
    expect(ctx.bezierCurveTo).toHaveBeenCalledTimes(1);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(1);
    expect(ctx.closePath).toHaveBeenCalledTimes(1);
  });

  it('replays subPaths when present', () => {
    const ctx = createMockContext();
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 10, y: 10 },
      ],
      closed: false,
      subPaths: [
        {
          segments: [
            { type: 'M', x: 20, y: 20 },
            { type: 'L', x: 30, y: 30 },
          ],
          closed: false,
        },
      ],
    };
    replayPathToCanvas(path, ctx);
    expect(ctx.moveTo).toHaveBeenCalledTimes(2);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.moveTo).toHaveBeenCalledWith(20, 20);
    expect(ctx.lineTo).toHaveBeenCalledTimes(2);
  });

  it('handles an empty path', () => {
    const ctx = createMockContext();
    const path: Path = { segments: [], closed: false };
    replayPathToCanvas(path, ctx);
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });
});

// ─── pathToPath2D ───────────────────────────────────────────────────────────

describe('pathToPath2D', () => {
  // Path2D is not available in Node.js so we mock it
  const originalPath2D = globalThis.Path2D;

  beforeAll(() => {
    (globalThis as any).Path2D = class MockPath2D {
      svgData: string;
      constructor(svgString?: string) {
        this.svgData = svgString || '';
      }
    };
  });

  afterAll(() => {
    if (originalPath2D) {
      globalThis.Path2D = originalPath2D;
    } else {
      delete (globalThis as any).Path2D;
    }
  });

  it('constructs a Path2D from an SVG path string', () => {
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 100, y: 100 },
      ],
      closed: false,
    };
    const result = pathToPath2D(path);
    expect(result).toBeInstanceOf(Path2D);
    // Check that the SVG string was passed to the constructor
    expect((result as any).svgData).toBe('M 0 0 L 100 100');
  });

  it('handles closed paths', () => {
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 100, y: 0 },
        { type: 'L', x: 100, y: 100 },
        { type: 'Z' },
      ],
      closed: true,
    };
    const result = pathToPath2D(path);
    expect((result as any).svgData).toContain('Z');
  });
});

// ─── computePathBounds ──────────────────────────────────────────────────────

describe('computePathBounds', () => {
  it('returns zero-size box for empty path', () => {
    const path: Path = { segments: [], closed: false };
    expect(computePathBounds(path)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('computes bounds for a single point (MoveTo)', () => {
    const path: Path = {
      segments: [{ type: 'M', x: 10, y: 20 }],
      closed: false,
    };
    expect(computePathBounds(path)).toEqual({ x: 10, y: 20, width: 0, height: 0 });
  });

  it('computes bounds for a line', () => {
    const path: Path = {
      segments: [
        { type: 'M', x: 10, y: 20 },
        { type: 'L', x: 50, y: 80 },
      ],
      closed: false,
    };
    expect(computePathBounds(path)).toEqual({ x: 10, y: 20, width: 40, height: 60 });
  });

  it('computes bounds for a rectangle', () => {
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 100, y: 0 },
        { type: 'L', x: 100, y: 50 },
        { type: 'L', x: 0, y: 50 },
        { type: 'Z' },
      ],
      closed: true,
    };
    expect(computePathBounds(path)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('includes cubic control points in bounds (conservative)', () => {
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'C', x1: 50, y1: -30, x2: 80, y2: 130, x: 100, y: 100 },
      ],
      closed: false,
    };
    const bounds = computePathBounds(path);
    // Control point y1=-30 extends above, y2=130 extends below endpoint
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(-30);
    expect(bounds.width).toBe(100);
    expect(bounds.height).toBe(160); // from -30 to 130
  });

  it('includes quadratic control points in bounds', () => {
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'Q', x1: 50, y1: -40, x: 100, y: 0 },
      ],
      closed: false,
    };
    const bounds = computePathBounds(path);
    expect(bounds.y).toBe(-40);
    expect(bounds.width).toBe(100);
    expect(bounds.height).toBe(40);
  });

  it('includes subPath segments in bounds', () => {
    const path: Path = {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 10, y: 10 },
      ],
      closed: false,
      subPaths: [
        {
          segments: [
            { type: 'M', x: 50, y: 50 },
            { type: 'L', x: 200, y: 200 },
          ],
          closed: false,
        },
      ],
    };
    const bounds = computePathBounds(path);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.width).toBe(200);
    expect(bounds.height).toBe(200);
  });

  it('handles negative coordinates', () => {
    const path: Path = {
      segments: [
        { type: 'M', x: -50, y: -50 },
        { type: 'L', x: 50, y: 50 },
      ],
      closed: false,
    };
    const bounds = computePathBounds(path);
    expect(bounds.x).toBe(-50);
    expect(bounds.y).toBe(-50);
    expect(bounds.width).toBe(100);
    expect(bounds.height).toBe(100);
  });
});
