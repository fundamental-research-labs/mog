/**
 * Hit Test Tests
 *
 * Tests for buildHitTestPath and isPointInDrawingObject.
 */
import { jest } from '@jest/globals';

import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type { Path } from '@mog-sdk/contracts/geometry';
import { buildHitTestPath, isPointInDrawingObject } from '../../src/renderer/hit-test';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock Path2D (not available in jsdom)
class MockPath2D {
  addPathCalls: Array<{ path: any; matrix?: any }> = [];
  constructor(public svgString?: string) {}
  addPath(path: any, matrix?: any) {
    this.addPathCalls.push({ path, matrix });
  }
}
(globalThis as any).Path2D = MockPath2D;

// Mock DOMMatrix with inverse() and transformPoint()
class MockDOMMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;

  constructor(public values?: number[]) {
    this.a = values?.[0] ?? 1;
    this.b = values?.[1] ?? 0;
    this.c = values?.[2] ?? 0;
    this.d = values?.[3] ?? 1;
    this.e = values?.[4] ?? 0;
    this.f = values?.[5] ?? 0;
  }

  inverse(): MockDOMMatrix {
    // 2D affine inverse: [a b c d e f]
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) return new MockDOMMatrix([1, 0, 0, 1, 0, 0]);
    const invDet = 1 / det;
    return new MockDOMMatrix([
      this.d * invDet,
      -this.b * invDet,
      -this.c * invDet,
      this.a * invDet,
      (this.c * this.f - this.d * this.e) * invDet,
      (this.b * this.e - this.a * this.f) * invDet,
    ]);
  }

  transformPoint(pt: MockDOMPoint): MockDOMPoint {
    return new MockDOMPoint(
      this.a * pt.x + this.c * pt.y + this.e,
      this.b * pt.x + this.d * pt.y + this.f,
    );
  }
}
(globalThis as any).DOMMatrix = MockDOMMatrix;

// Mock DOMPoint
class MockDOMPoint {
  constructor(
    public x: number = 0,
    public y: number = 0,
  ) {}
}
(globalThis as any).DOMPoint = MockDOMPoint;

function createMockContext() {
  const stateStack: Array<{ lineWidth: number }> = [];
  const mockCtx = {
    save: jest.fn(() => {
      stateStack.push({ lineWidth: mockCtx.lineWidth });
    }),
    restore: jest.fn(() => {
      const saved = stateStack.pop();
      if (saved) {
        mockCtx.lineWidth = saved.lineWidth;
      }
    }),
    beginPath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    bezierCurveTo: jest.fn(),
    quadraticCurveTo: jest.fn(),
    clip: jest.fn(),
    transform: jest.fn(),
    rect: jest.fn(),
    isPointInPath: jest.fn(() => false),
    isPointInStroke: jest.fn(() => false),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    setLineDash: jest.fn(),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  };
  return mockCtx as unknown as CanvasRenderingContext2D;
}

function makeSimplePath(): Path {
  return {
    segments: [
      { type: 'M' as const, x: 0, y: 0 },
      { type: 'L' as const, x: 100, y: 0 },
      { type: 'L' as const, x: 100, y: 100 },
      { type: 'L' as const, x: 0, y: 100 },
      { type: 'Z' as const },
    ],
    closed: true,
  };
}

function makeSimpleObject(overrides?: Partial<DrawingObject>): DrawingObject {
  return {
    geometry: makeSimplePath(),
    ...overrides,
  };
}

// =============================================================================
// buildHitTestPath
// =============================================================================

describe('buildHitTestPath', () => {
  test('returns a Path2D for a simple object', () => {
    const obj = makeSimpleObject();
    const result = buildHitTestPath(obj);
    expect(result).toBeInstanceOf(MockPath2D);
  });

  test('without transform, returns the geometry Path2D directly', () => {
    const obj = makeSimpleObject();
    const result = buildHitTestPath(obj) as unknown as MockPath2D;
    // No addPath calls since no transform was applied
    expect(result.addPathCalls).toHaveLength(0);
    // Should have an svgString from PathOps.pathToSvgString
    expect(result.svgString).toBeDefined();
  });

  test('with transform, applies DOMMatrix via addPath', () => {
    const obj = makeSimpleObject({
      transform: { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 20 },
    });
    const result = buildHitTestPath(obj) as unknown as MockPath2D;

    // The transformed path uses addPath with a matrix
    expect(result.addPathCalls.length).toBe(1);
    const call = result.addPathCalls[0];
    expect(call.matrix).toBeInstanceOf(MockDOMMatrix);
    expect((call.matrix as MockDOMMatrix).values).toEqual([2, 0, 0, 2, 10, 20]);
  });

  test('DOMMatrix receives correct transform values', () => {
    const obj = makeSimpleObject({
      transform: { a: 1.5, b: 0.1, c: -0.1, d: 1.5, tx: 50, ty: 100 },
    });
    const result = buildHitTestPath(obj) as unknown as MockPath2D;

    const matrix = result.addPathCalls[0].matrix as MockDOMMatrix;
    expect(matrix.values).toEqual([1.5, 0.1, -0.1, 1.5, 50, 100]);
  });
});

// =============================================================================
// isPointInDrawingObject
// =============================================================================

describe('isPointInDrawingObject', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockContext();
  });

  test('delegates to isPointInPath for fill area', () => {
    (ctx.isPointInPath as jest.Mock).mockReturnValue(true);
    const obj = makeSimpleObject();

    const result = isPointInDrawingObject(obj, 50, 50, ctx);

    expect(result).toBe(true);
    expect(ctx.isPointInPath).toHaveBeenCalledWith(expect.any(MockPath2D), 50, 50);
  });

  test('returns false when point is outside fill and no stroke', () => {
    (ctx.isPointInPath as jest.Mock).mockReturnValue(false);
    const obj = makeSimpleObject();

    const result = isPointInDrawingObject(obj, 50, 50, ctx);

    expect(result).toBe(false);
  });

  test('checks isPointInStroke when object has stroke', () => {
    (ctx.isPointInPath as jest.Mock).mockReturnValue(false);
    (ctx.isPointInStroke as jest.Mock).mockReturnValue(true);
    const obj = makeSimpleObject({
      stroke: { color: '#000000', width: 2 },
    });

    const result = isPointInDrawingObject(obj, 50, 50, ctx);

    expect(result).toBe(true);
    expect(ctx.isPointInStroke).toHaveBeenCalledWith(expect.any(MockPath2D), 50, 50);
  });

  test('stroke hit area has minimum 4px width', () => {
    (ctx.isPointInPath as jest.Mock).mockReturnValue(false);
    let lineWidthDuringStrokeCheck: number | undefined;
    (ctx.isPointInStroke as jest.Mock).mockImplementation(() => {
      lineWidthDuringStrokeCheck = ctx.lineWidth;
      return false;
    });
    const obj = makeSimpleObject({
      stroke: { color: '#000000', width: 1 }, // Thin stroke
    });

    isPointInDrawingObject(obj, 50, 50, ctx);

    // lineWidth should be set to at least 4 during the stroke check
    expect(lineWidthDuringStrokeCheck).toBe(4);
    // lineWidth should be restored after the call (no state leak)
    expect(ctx.lineWidth).toBe(1);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  test('stroke hit area uses actual width when > 4px', () => {
    (ctx.isPointInPath as jest.Mock).mockReturnValue(false);
    let lineWidthDuringStrokeCheck: number | undefined;
    (ctx.isPointInStroke as jest.Mock).mockImplementation(() => {
      lineWidthDuringStrokeCheck = ctx.lineWidth;
      return false;
    });
    const obj = makeSimpleObject({
      stroke: { color: '#000000', width: 8 },
    });

    isPointInDrawingObject(obj, 50, 50, ctx);

    // lineWidth should use the actual stroke width during the check
    expect(lineWidthDuringStrokeCheck).toBe(8);
    // lineWidth should be restored after the call (no state leak)
    expect(ctx.lineWidth).toBe(1);
  });

  test('recurses into children', () => {
    // Parent miss, child hit
    let callCount = 0;
    (ctx.isPointInPath as jest.Mock).mockImplementation(() => {
      callCount++;
      return callCount > 1; // Miss on parent, hit on child
    });

    const child = makeSimpleObject();
    const obj = makeSimpleObject({ children: [child] });

    const result = isPointInDrawingObject(obj, 50, 50, ctx);

    expect(result).toBe(true);
    // isPointInPath called at least twice (parent + child)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test('returns false when all children miss', () => {
    (ctx.isPointInPath as jest.Mock).mockReturnValue(false);
    const child = makeSimpleObject();
    const obj = makeSimpleObject({ children: [child] });

    const result = isPointInDrawingObject(obj, 50, 50, ctx);

    expect(result).toBe(false);
  });

  test('transformed parent inverse-transforms point for child hit testing', () => {
    // Parent has a 2x scale transform. A point at (100, 100) in world space
    // corresponds to (50, 50) in the parent's local space.
    // The child should be tested with the inverse-transformed point.
    const capturedPoints: Array<{ x: number; y: number }> = [];

    (ctx.isPointInPath as jest.Mock).mockImplementation((_path: any, x: number, y: number) => {
      capturedPoints.push({ x, y });
      // Parent miss, child hit only if we get the correct local coords
      if (capturedPoints.length === 1) return false; // parent
      // Child should receive inverse-transformed coords (50, 50)
      return Math.abs(x - 50) < 0.001 && Math.abs(y - 50) < 0.001;
    });

    const child = makeSimpleObject();
    const obj = makeSimpleObject({
      children: [child],
      transform: { a: 2, b: 0, c: 0, d: 2, tx: 0, ty: 0 },
    });

    const result = isPointInDrawingObject(obj, 100, 100, ctx);

    expect(result).toBe(true);
    // The child was tested with inverse-transformed coordinates
    expect(capturedPoints.length).toBe(2);
    expect(capturedPoints[1].x).toBeCloseTo(50);
    expect(capturedPoints[1].y).toBeCloseTo(50);
  });

  test('transformed parent with translation inverse-transforms correctly', () => {
    // Parent translates by (10, 20). A point at (60, 70) in world space
    // should become (50, 50) in local space.
    const capturedPoints: Array<{ x: number; y: number }> = [];

    (ctx.isPointInPath as jest.Mock).mockImplementation((_path: any, x: number, y: number) => {
      capturedPoints.push({ x, y });
      if (capturedPoints.length === 1) return false; // parent miss
      return Math.abs(x - 50) < 0.001 && Math.abs(y - 50) < 0.001;
    });

    const child = makeSimpleObject();
    const obj = makeSimpleObject({
      children: [child],
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
    });

    const result = isPointInDrawingObject(obj, 60, 70, ctx);

    expect(result).toBe(true);
    expect(capturedPoints[1].x).toBeCloseTo(50);
    expect(capturedPoints[1].y).toBeCloseTo(50);
  });

  test('untransformed parent passes original point to children', () => {
    // Without a transform, children should get the original (x, y)
    const capturedPoints: Array<{ x: number; y: number }> = [];

    (ctx.isPointInPath as jest.Mock).mockImplementation((_path: any, x: number, y: number) => {
      capturedPoints.push({ x, y });
      if (capturedPoints.length === 1) return false; // parent miss
      return true; // child hit
    });

    const child = makeSimpleObject();
    const obj = makeSimpleObject({ children: [child] });

    const result = isPointInDrawingObject(obj, 75, 85, ctx);

    expect(result).toBe(true);
    // Child receives the same coordinates as parent (no transform)
    expect(capturedPoints[1].x).toBe(75);
    expect(capturedPoints[1].y).toBe(85);
  });

  test('stops early on first child hit', () => {
    // Parent misses, first child hits
    let callCount = 0;
    (ctx.isPointInPath as jest.Mock).mockImplementation(() => {
      callCount++;
      return callCount === 2; // Second call (first child) hits
    });

    const child1 = makeSimpleObject();
    const child2 = makeSimpleObject();
    const obj = makeSimpleObject({ children: [child1, child2] });

    const result = isPointInDrawingObject(obj, 50, 50, ctx);

    expect(result).toBe(true);
    // Should not check child2 since child1 already hit
    // parent(1) + child1(2) = 2 calls, child2 should not be checked
    expect(callCount).toBe(2);
  });
});
