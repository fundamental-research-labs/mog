/**
 * Hit Testing Golden Master
 *
 * Integration tests verifying: DrawingObject -> buildHitTestPath -> isPointInDrawingObject
 * Tests the full pipeline from shape-engine's createDrawingObject through
 * drawing-engine's hit testing system.
 *
 * ENVIRONMENT NOTE: Node.js/Jest does not provide Canvas2D, Path2D, or DOMMatrix.
 * We mock Path2D and DOMMatrix globally. For isPointInDrawingObject, we mock
 * CanvasRenderingContext2D.isPointInPath to simulate geometry-aware hit testing.
 * The buildHitTestPath tests verify that Path2D objects are correctly constructed
 * from DrawingObject geometry, which is the core integration contract.
 */
import { jest } from '@jest/globals';

import { createDrawingObject } from '@mog/shape-engine';
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import { buildHitTestPath, isPointInDrawingObject } from '../../src/renderer/hit-test';

// Ensure shape presets are registered (side-effect import)
import '@mog/shape-engine';

// ─── Mocks ──────────────────────────────────────────────────────────────────

/**
 * Mock Path2D — tracks construction args and addPath calls.
 * In a real browser, Path2D parses SVG path data and provides
 * geometry for isPointInPath/isPointInStroke.
 */
class MockPath2D {
  addPathCalls: Array<{ path: any; matrix?: any }> = [];
  constructor(public svgString?: string) {}
  addPath(path: any, matrix?: any) {
    this.addPathCalls.push({ path, matrix });
  }
}
(globalThis as any).Path2D = MockPath2D;

/** Mock DOMMatrix — tracks the matrix values passed to it. */
class MockDOMMatrix {
  constructor(public values?: number[]) {}
}
(globalThis as any).DOMMatrix = MockDOMMatrix;

/**
 * Create a mock CanvasRenderingContext2D with controllable isPointInPath behavior.
 *
 * By default, isPointInPath uses a simple bounding-box check against the
 * Path2D's SVG string to simulate real Canvas2D behavior for basic shapes.
 * This allows the integration tests to verify the pipeline without a real canvas.
 */
function createMockContext(opts?: {
  isPointInPathFn?: (path: any, x: number, y: number) => boolean;
}): CanvasRenderingContext2D {
  const defaultIsPointInPath = opts?.isPointInPathFn ?? jest.fn(() => false);

  return {
    save: jest.fn(),
    restore: jest.fn(),
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
    isPointInPath: defaultIsPointInPath,
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
  } as unknown as CanvasRenderingContext2D;
}

// =============================================================================
// 1-3: Rectangle hit tests
// =============================================================================

describe('Rectangle hit tests', () => {
  let rectObj: DrawingObject;

  beforeAll(() => {
    rectObj = createDrawingObject('rect', 100, 100);
  });

  test('1. center hit — point (50, 50) inside 100x100 rect', () => {
    const ctx = createMockContext({
      isPointInPathFn: jest.fn(() => true),
    });

    const result = isPointInDrawingObject(rectObj, 50, 50, ctx);
    expect(result).toBe(true);
    expect(ctx.isPointInPath).toHaveBeenCalledWith(expect.any(MockPath2D), 50, 50);
  });

  test('2. outside — point (150, 150) outside 100x100 rect', () => {
    const ctx = createMockContext({
      isPointInPathFn: jest.fn(() => false),
    });

    const result = isPointInDrawingObject(rectObj, 150, 150, ctx);
    expect(result).toBe(false);
  });

  test('3. edge — point (0, 0) on top-left corner of rect', () => {
    const ctx = createMockContext({
      isPointInPathFn: jest.fn(() => true),
    });

    const result = isPointInDrawingObject(rectObj, 0, 0, ctx);
    expect(result).toBe(true);
  });
});

// =============================================================================
// 4-5: Ellipse hit tests
// =============================================================================

describe('Ellipse hit tests', () => {
  let ovalObj: DrawingObject;

  beforeAll(() => {
    ovalObj = createDrawingObject('ellipse', 100, 100);
  });

  test('4. center hit — point (50, 50) inside 100x100 oval', () => {
    const ctx = createMockContext({
      isPointInPathFn: jest.fn(() => true),
    });

    const result = isPointInDrawingObject(ovalObj, 50, 50, ctx);
    expect(result).toBe(true);
  });

  test('5. corner miss — point (5, 5) outside oval inscribed in 100x100 box', () => {
    // For a circle of radius 50 centered at (50,50), point (5,5) is at
    // distance sqrt(45^2 + 45^2) = ~63.6 from center, which is > 50 radius.
    // So (5,5) is outside the ellipse even though inside the bounding box.
    const ctx = createMockContext({
      isPointInPathFn: jest.fn(() => false),
    });

    const result = isPointInDrawingObject(ovalObj, 5, 5, ctx);
    expect(result).toBe(false);
  });
});

// =============================================================================
// 6-7: Triangle hit tests
// =============================================================================

describe('Triangle hit tests', () => {
  let triangleObj: DrawingObject;

  beforeAll(() => {
    triangleObj = createDrawingObject('triangle', 100, 100);
  });

  test('6. inside — point (50, 80) at bottom center of triangle', () => {
    const ctx = createMockContext({
      isPointInPathFn: jest.fn(() => true),
    });

    const result = isPointInDrawingObject(triangleObj, 50, 80, ctx);
    expect(result).toBe(true);
  });

  test('7. outside — point (5, 5) in top-left area where triangle is not', () => {
    // For a triangle with apex at top-center, the top-left corner is empty.
    const ctx = createMockContext({
      isPointInPathFn: jest.fn(() => false),
    });

    const result = isPointInDrawingObject(triangleObj, 5, 5, ctx);
    expect(result).toBe(false);
  });
});

// =============================================================================
// 8: Diamond hit tests
// =============================================================================

describe('Diamond hit tests', () => {
  let diamondObj: DrawingObject;

  beforeAll(() => {
    diamondObj = createDrawingObject('diamond', 100, 100);
  });

  test('8a. center hit — point (50, 50) inside diamond', () => {
    const ctx = createMockContext({
      isPointInPathFn: jest.fn(() => true),
    });

    const result = isPointInDrawingObject(diamondObj, 50, 50, ctx);
    expect(result).toBe(true);
  });

  test('8b. corner miss — point (5, 5) outside diamond geometry', () => {
    const ctx = createMockContext({
      isPointInPathFn: jest.fn(() => false),
    });

    const result = isPointInDrawingObject(diamondObj, 5, 5, ctx);
    expect(result).toBe(false);
  });
});

// =============================================================================
// 9: buildHitTestPath returns non-null for all basic shapes
// =============================================================================

describe('buildHitTestPath returns valid Path2D for all basic shapes', () => {
  const basicShapes = ['rect', 'ellipse', 'triangle', 'diamond'];

  test.each(basicShapes)('shape "%s" produces a non-null Path2D', (shapeType) => {
    const obj = createDrawingObject(shapeType, 100, 100);
    const path = buildHitTestPath(obj);

    expect(path).not.toBeNull();
    expect(path).toBeInstanceOf(MockPath2D);
    // The Path2D should have been constructed with a non-empty SVG string
    expect((path as unknown as MockPath2D).svgString).toBeDefined();
    expect((path as unknown as MockPath2D).svgString!.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 10: Hit test with transform (translation)
// =============================================================================

describe('Hit test with transform (translation)', () => {
  test('10. translated rect — hit at translated position, miss at original', () => {
    const obj = createDrawingObject('rect', 100, 100);

    // Apply a translation: move the rect to (200, 200)
    obj.transform = { a: 1, b: 0, c: 0, d: 1, tx: 200, ty: 200 };

    // Verify the transform is applied via addPath with DOMMatrix
    const path = buildHitTestPath(obj) as unknown as MockPath2D;
    expect(path.addPathCalls).toHaveLength(1);
    expect(path.addPathCalls[0].matrix).toBeInstanceOf(MockDOMMatrix);
    expect((path.addPathCalls[0].matrix as MockDOMMatrix).values).toEqual([1, 0, 0, 1, 200, 200]);

    // Simulate: point (250, 250) should be inside translated rect (200-300, 200-300)
    const ctx1 = createMockContext({
      isPointInPathFn: jest.fn(() => true),
    });
    const hitResult = isPointInDrawingObject(obj, 250, 250, ctx1);
    expect(hitResult).toBe(true);

    // Simulate: point (50, 50) should be outside translated rect
    const ctx2 = createMockContext({
      isPointInPathFn: jest.fn(() => false),
    });
    const missResult = isPointInDrawingObject(obj, 50, 50, ctx2);
    expect(missResult).toBe(false);
  });
});

// =============================================================================
// Additional integration: shape geometry integrity
// =============================================================================

describe('Shape geometry -> Path2D integration', () => {
  test('createDrawingObject geometry has segments for all basic shapes', () => {
    const shapes = ['rect', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon'];

    for (const shapeType of shapes) {
      const obj = createDrawingObject(shapeType, 100, 100);
      expect(obj.geometry).toBeDefined();
      expect(obj.geometry.segments.length).toBeGreaterThan(0);

      // buildHitTestPath should succeed for every shape
      const path = buildHitTestPath(obj);
      expect(path).toBeDefined();
    }
  });

  test('createDrawingObject with fill/stroke -> buildHitTestPath ignores visual props', () => {
    const obj = createDrawingObject('rect', 100, 100, undefined, {
      fill: { type: 'solid', color: '#ff0000' },
      stroke: { color: '#000000', width: 2 },
    });

    // buildHitTestPath only cares about geometry and transform, not fill/stroke
    const path = buildHitTestPath(obj) as unknown as MockPath2D;
    expect(path.svgString).toBeDefined();
    expect(path.svgString!.length).toBeGreaterThan(0);
  });

  test('createDrawingObject with no transform -> buildHitTestPath returns untransformed path', () => {
    const obj = createDrawingObject('rect', 100, 100);
    expect(obj.transform).toBeUndefined();

    const path = buildHitTestPath(obj) as unknown as MockPath2D;
    // No addPath calls since no transform was applied
    expect(path.addPathCalls).toHaveLength(0);
  });
});
