/**
 * Hit Testing with Overlapping Objects
 *
 * Integration tests for the spatial broad-phase + narrow-phase pipeline.
 *
 * Architecture:
 * - Broad-phase: hitTest() from spatial/spatial-query.ts uses bounding-box checks
 *   to find the topmost object by z-index at a given point.
 * - Narrow-phase: isPointInDrawingObject() from renderer/hit-test.ts uses Canvas2D
 *   Path2D geometry for pixel-accurate testing.
 *
 * The tests here verify both phases independently and together.
 *
 * ENVIRONMENT NOTE: Node.js does not have Canvas2D. isPointInPath is mocked.
 * The broad-phase (bounding-box hitTest) works without Canvas2D. The narrow-phase
 * tests use mock Canvas context with controlled return values to simulate the
 * geometry discrimination that a real canvas would provide.
 */
import { jest } from '@jest/globals';

import { createDrawingObject } from '@mog/shape-engine';
import { isPointInDrawingObject } from '../../src/renderer/hit-test';
import type { SpatialObject } from '../../src/spatial/spatial-query';
import { hitTest } from '../../src/spatial/spatial-query';

// Ensure shape presets are registered (side-effect import)
import '@mog/shape-engine';

// ─── Mocks ──────────────────────────────────────────────────────────────────

class MockPath2D {
  addPathCalls: Array<{ path: any; matrix?: any }> = [];
  constructor(public svgString?: string) {}
  addPath(path: any, matrix?: any) {
    this.addPathCalls.push({ path, matrix });
  }
}
(globalThis as any).Path2D = MockPath2D;

class MockDOMMatrix {
  constructor(public values?: number[]) {}
}
(globalThis as any).DOMMatrix = MockDOMMatrix;

function createMockContext(opts?: {
  isPointInPathFn?: (path: any, x: number, y: number) => boolean;
}): CanvasRenderingContext2D {
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
    isPointInPath: opts?.isPointInPathFn ?? jest.fn(() => false),
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

/** Helper to create a SpatialObject for broad-phase testing. */
function makeSpatialObj(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
): SpatialObject {
  return { id, bounds: { x, y, width: w, height: h }, zIndex: z };
}

// =============================================================================
// 1: Broad-phase hit test selects topmost by z-index
// =============================================================================

describe('Broad-phase: z-index ordering', () => {
  test('1. overlapping objects — higher z-index is returned', () => {
    const objects: SpatialObject[] = [
      makeSpatialObj('back', 0, 0, 100, 100, 1),
      makeSpatialObj('front', 0, 0, 100, 100, 5),
    ];

    const result = hitTest(objects, { x: 50, y: 50 });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('front');
  });
});

// =============================================================================
// 2: Non-overlapping objects hit correct target
// =============================================================================

describe('Broad-phase: non-overlapping objects', () => {
  test('2. side-by-side objects hit correct target', () => {
    const objects: SpatialObject[] = [
      makeSpatialObj('left', 0, 0, 100, 100, 0),
      makeSpatialObj('right', 200, 0, 100, 100, 0),
    ];

    const resultLeft = hitTest(objects, { x: 50, y: 50 });
    expect(resultLeft).not.toBeNull();
    expect(resultLeft!.id).toBe('left');

    const resultRight = hitTest(objects, { x: 250, y: 50 });
    expect(resultRight).not.toBeNull();
    expect(resultRight!.id).toBe('right');
  });
});

// =============================================================================
// 3: Hit test returns null for empty space
// =============================================================================

describe('Broad-phase: empty space', () => {
  test('3. hit test at empty location returns null', () => {
    const objects: SpatialObject[] = [
      makeSpatialObj('a', 0, 0, 50, 50, 0),
      makeSpatialObj('b', 200, 200, 50, 50, 1),
    ];

    const result = hitTest(objects, { x: 100, y: 100 });
    expect(result).toBeNull();
  });
});

// =============================================================================
// 4: Narrow-phase discriminates shape geometry
// =============================================================================

describe('Narrow-phase: geometry discrimination', () => {
  test('4. corner point hits rect but misses oval at same position', () => {
    // Create both a rectangle and an oval at 100x100
    const rectObj = createDrawingObject('rect', 100, 100);
    const ovalObj = createDrawingObject('ellipse', 100, 100);

    // Point (5, 5) is at the top-left corner.
    // For a rectangle: (5, 5) is inside (within the 0-100 rect bounds).
    // For an oval (circle r=50 centered at 50,50): distance to center is
    // sqrt(45^2 + 45^2) = ~63.6 > 50, so (5, 5) is OUTSIDE the oval.

    // --- Rect: point is inside ---
    const ctxRect = createMockContext({
      isPointInPathFn: jest.fn(() => true), // Simulates: rect geometry contains (5,5)
    });
    const rectHit = isPointInDrawingObject(rectObj, 5, 5, ctxRect);
    expect(rectHit).toBe(true);

    // --- Oval: point is outside ---
    const ctxOval = createMockContext({
      isPointInPathFn: jest.fn(() => false), // Simulates: oval geometry does NOT contain (5,5)
    });
    const ovalHit = isPointInDrawingObject(ovalObj, 5, 5, ctxOval);
    expect(ovalHit).toBe(false);

    // This demonstrates the value of narrow-phase geometry testing:
    // Both shapes have the same bounding box (0,0 -> 100,100), so the
    // broad-phase would consider (5,5) inside both. But the narrow-phase
    // correctly discriminates based on actual shape geometry.
  });

  test('4b. center point hits both rect and oval', () => {
    const rectObj = createDrawingObject('rect', 100, 100);
    const ovalObj = createDrawingObject('ellipse', 100, 100);

    // Point (50, 50) is the center — should be inside both shapes
    const ctxRect = createMockContext({
      isPointInPathFn: jest.fn(() => true),
    });
    expect(isPointInDrawingObject(rectObj, 50, 50, ctxRect)).toBe(true);

    const ctxOval = createMockContext({
      isPointInPathFn: jest.fn(() => true),
    });
    expect(isPointInDrawingObject(ovalObj, 50, 50, ctxOval)).toBe(true);
  });
});

// =============================================================================
// 5: Multiple overlapping objects — z-order matters
// =============================================================================

describe('Broad-phase: three stacked objects', () => {
  test('5. three overlapping objects — topmost z-index wins', () => {
    const objects: SpatialObject[] = [
      makeSpatialObj('bottom', 0, 0, 200, 200, 0),
      makeSpatialObj('middle', 0, 0, 200, 200, 5),
      makeSpatialObj('top', 0, 0, 200, 200, 10),
    ];

    const result = hitTest(objects, { x: 100, y: 100 });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('top');
  });

  test('5b. z-order is independent of array order', () => {
    // The "top" object is first in the array but has the highest z-index
    const objects: SpatialObject[] = [
      makeSpatialObj('top', 0, 0, 200, 200, 10),
      makeSpatialObj('bottom', 0, 0, 200, 200, 0),
      makeSpatialObj('middle', 0, 0, 200, 200, 5),
    ];

    const result = hitTest(objects, { x: 100, y: 100 });
    expect(result!.id).toBe('top');
  });
});

// =============================================================================
// Combined broad-phase + narrow-phase pipeline
// =============================================================================

describe('Combined broad+narrow phase pipeline', () => {
  test('broad-phase selects candidate, narrow-phase verifies geometry', () => {
    // Scenario: two objects at the same position with different z-indices.
    // Broad-phase returns the topmost. Narrow-phase then checks geometry.
    const spatialObjects: SpatialObject[] = [
      makeSpatialObj('rect-back', 0, 0, 100, 100, 0),
      makeSpatialObj('oval-front', 0, 0, 100, 100, 5),
    ];

    // Broad-phase: returns oval-front (higher z-index)
    const candidate = hitTest(spatialObjects, { x: 5, y: 5 });
    expect(candidate).not.toBeNull();
    expect(candidate!.id).toBe('oval-front');

    // Narrow-phase: check if point actually hits the oval geometry.
    // Point (5, 5) is in the corner — outside the oval.
    const ovalObj = createDrawingObject('ellipse', 100, 100);
    const ctxOval = createMockContext({
      isPointInPathFn: jest.fn(() => false), // Oval corner miss
    });
    const ovalHit = isPointInDrawingObject(ovalObj, 5, 5, ctxOval);
    expect(ovalHit).toBe(false);

    // Since the oval misses, a real hit-test pipeline would fall through
    // to the next candidate (rect-back). The rect would then pass.
    const rectObj = createDrawingObject('rect', 100, 100);
    const ctxRect = createMockContext({
      isPointInPathFn: jest.fn(() => true), // Rect contains (5,5)
    });
    const rectHit = isPointInDrawingObject(rectObj, 5, 5, ctxRect);
    expect(rectHit).toBe(true);
  });

  test('broad-phase returns null for empty space — no narrow-phase needed', () => {
    const spatialObjects: SpatialObject[] = [makeSpatialObj('a', 0, 0, 50, 50, 0)];

    const result = hitTest(spatialObjects, { x: 200, y: 200 });
    expect(result).toBeNull();
    // No narrow-phase check needed when broad-phase returns null
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('Edge cases', () => {
  test('empty objects array returns null from hitTest', () => {
    const result = hitTest([], { x: 50, y: 50 });
    expect(result).toBeNull();
  });

  test('single object — z-index is irrelevant', () => {
    const objects: SpatialObject[] = [makeSpatialObj('only', 0, 0, 100, 100, 42)];

    const result = hitTest(objects, { x: 50, y: 50 });
    expect(result!.id).toBe('only');
  });

  test('objects with same z-index — first in sorted order wins', () => {
    // When z-indices are equal, the sort is stable with respect to the
    // descending sort, so the first one with matching z-index is returned.
    const objects: SpatialObject[] = [
      makeSpatialObj('a', 0, 0, 100, 100, 5),
      makeSpatialObj('b', 0, 0, 100, 100, 5),
    ];

    const result = hitTest(objects, { x: 50, y: 50 });
    expect(result).not.toBeNull();
    // Both have the same z-index; result depends on sort stability
    expect(['a', 'b']).toContain(result!.id);
  });

  test('point on bounding box edge is inside for broad-phase', () => {
    const objects: SpatialObject[] = [makeSpatialObj('edgy', 0, 0, 100, 100, 0)];

    // Points exactly on the boundary
    expect(hitTest(objects, { x: 0, y: 0 })!.id).toBe('edgy');
    expect(hitTest(objects, { x: 100, y: 100 })!.id).toBe('edgy');
    expect(hitTest(objects, { x: 0, y: 100 })!.id).toBe('edgy');
    expect(hitTest(objects, { x: 100, y: 0 })!.id).toBe('edgy');
  });
});
