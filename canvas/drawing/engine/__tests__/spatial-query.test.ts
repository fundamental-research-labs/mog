/**
 * Spatial Query Tests
 */
import { jest } from '@jest/globals';

import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type { HitTestNarrowPhaseOptions, SpatialObject } from '../src/spatial/spatial-query';
import { findNearby, findOverlapping, hitTest, selectInRect } from '../src/spatial/spatial-query';

// =============================================================================
// MOCKS (for narrow-phase tests)
// =============================================================================

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

/**
 * Create a minimal DrawingObject stub for narrow-phase testing.
 * Only `geometry` is required by `isPointInDrawingObject` (via buildHitTestPath).
 */
function makeDrawingObj(id: string): DrawingObject {
  return {
    geometry: {
      segments: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 100, y: 0 },
        { type: 'L', x: 100, y: 100 },
        { type: 'L', x: 0, y: 100 },
        { type: 'Z' },
      ],
    },
  } as unknown as DrawingObject;
}

/**
 * Create a mock CanvasRenderingContext2D with controllable isPointInPath.
 *
 * @param hitIds - Set of spatial object IDs for which isPointInPath returns true.
 *                 When used with the narrow-phase pipeline, the mock uses a call
 *                 counter to correlate calls with objects in z-order.
 */
function createMockContext(opts?: {
  isPointInPathFn?: (path: any, x: number, y: number) => boolean;
}): CanvasRenderingContext2D {
  return {
    save: jest.fn(),
    restore: jest.fn(),
    isPointInPath: opts?.isPointInPathFn ?? jest.fn(() => false),
    isPointInStroke: jest.fn(() => false),
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

// =============================================================================
// HELPERS
// =============================================================================

function makeObj(id: string, x: number, y: number, w: number, h: number, z: number): SpatialObject {
  return { id, bounds: { x, y, width: w, height: h }, zIndex: z };
}

// =============================================================================
// hitTest
// =============================================================================

describe('hitTest', () => {
  it('should return topmost object at a point', () => {
    const objects = [makeObj('back', 0, 0, 100, 100, 0), makeObj('front', 50, 50, 100, 100, 1)];
    const result = hitTest(objects, { x: 75, y: 75 });
    expect(result?.id).toBe('front');
  });

  it('should return lower object if point only hits it', () => {
    const objects = [makeObj('back', 0, 0, 100, 100, 0), makeObj('front', 200, 200, 50, 50, 1)];
    const result = hitTest(objects, { x: 50, y: 50 });
    expect(result?.id).toBe('back');
  });

  it('should return null if no object at point', () => {
    const objects = [makeObj('a', 0, 0, 50, 50, 0)];
    const result = hitTest(objects, { x: 100, y: 100 });
    expect(result).toBeNull();
  });

  it('should handle empty objects', () => {
    expect(hitTest([], { x: 0, y: 0 })).toBeNull();
  });

  it('should include points on edges', () => {
    const objects = [makeObj('a', 0, 0, 100, 100, 0)];
    expect(hitTest(objects, { x: 0, y: 0 })?.id).toBe('a');
    expect(hitTest(objects, { x: 100, y: 100 })?.id).toBe('a');
  });

  it('should respect z-order regardless of array order', () => {
    const objects = [makeObj('front', 0, 0, 100, 100, 10), makeObj('back', 0, 0, 100, 100, 1)];
    const result = hitTest(objects, { x: 50, y: 50 });
    expect(result?.id).toBe('front');
  });

  it('should handle three overlapping objects', () => {
    const objects = [
      makeObj('bottom', 0, 0, 200, 200, 0),
      makeObj('middle', 0, 0, 200, 200, 5),
      makeObj('top', 0, 0, 200, 200, 10),
    ];
    const result = hitTest(objects, { x: 100, y: 100 });
    expect(result?.id).toBe('top');
  });
});

// =============================================================================
// hitTest with narrow-phase
// =============================================================================

describe('hitTest with narrowPhase', () => {
  it('should return object when both broad-phase and narrow-phase pass', () => {
    const objects = [makeObj('a', 0, 0, 100, 100, 0)];
    const drawingObjects = new Map<string, DrawingObject>([['a', makeDrawingObj('a')]]);
    const ctx = createMockContext({ isPointInPathFn: jest.fn(() => true) });
    const narrowPhase: HitTestNarrowPhaseOptions = { ctx, drawingObjects };

    const result = hitTest(objects, { x: 50, y: 50 }, narrowPhase);
    expect(result?.id).toBe('a');
  });

  it('should return null when broad-phase passes but narrow-phase fails', () => {
    const objects = [makeObj('a', 0, 0, 100, 100, 0)];
    const drawingObjects = new Map<string, DrawingObject>([['a', makeDrawingObj('a')]]);
    const ctx = createMockContext({ isPointInPathFn: jest.fn(() => false) });
    const narrowPhase: HitTestNarrowPhaseOptions = { ctx, drawingObjects };

    const result = hitTest(objects, { x: 50, y: 50 }, narrowPhase);
    expect(result).toBeNull();
  });

  it('should fall through to lower z-index object when top object fails narrow-phase', () => {
    // Two overlapping objects: oval-front (z=5) and rect-back (z=0)
    const objects = [
      makeObj('rect-back', 0, 0, 100, 100, 0),
      makeObj('oval-front', 0, 0, 100, 100, 5),
    ];
    const drawingObjects = new Map<string, DrawingObject>([
      ['oval-front', makeDrawingObj('oval-front')],
      ['rect-back', makeDrawingObj('rect-back')],
    ]);

    // Narrow-phase: oval misses (corner point), rect hits
    let callCount = 0;
    const ctx = createMockContext({
      isPointInPathFn: jest.fn(() => {
        callCount++;
        // First call is for oval-front (topmost), second is for rect-back
        return callCount > 1;
      }),
    });
    const narrowPhase: HitTestNarrowPhaseOptions = { ctx, drawingObjects };

    const result = hitTest(objects, { x: 5, y: 5 }, narrowPhase);
    expect(result?.id).toBe('rect-back');
  });

  it('should return null when no objects pass narrow-phase', () => {
    const objects = [makeObj('a', 0, 0, 100, 100, 0), makeObj('b', 0, 0, 100, 100, 5)];
    const drawingObjects = new Map<string, DrawingObject>([
      ['a', makeDrawingObj('a')],
      ['b', makeDrawingObj('b')],
    ]);
    const ctx = createMockContext({ isPointInPathFn: jest.fn(() => false) });
    const narrowPhase: HitTestNarrowPhaseOptions = { ctx, drawingObjects };

    const result = hitTest(objects, { x: 50, y: 50 }, narrowPhase);
    expect(result).toBeNull();
  });

  it('should skip narrow-phase for objects not in the drawingObjects map', () => {
    // Object 'a' has a DrawingObject (narrow-phase fails), object 'b' does not
    // (no DrawingObject in map, so narrow-phase is skipped — treated as miss)
    const objects = [makeObj('b', 0, 0, 100, 100, 0), makeObj('a', 0, 0, 100, 100, 5)];
    const drawingObjects = new Map<string, DrawingObject>([
      ['a', makeDrawingObj('a')],
      // 'b' deliberately omitted — no DrawingObject available
    ]);
    const ctx = createMockContext({ isPointInPathFn: jest.fn(() => false) });
    const narrowPhase: HitTestNarrowPhaseOptions = { ctx, drawingObjects };

    // 'a' (z=5) fails narrow-phase, 'b' (z=0) has no DrawingObject so also skipped
    const result = hitTest(objects, { x: 50, y: 50 }, narrowPhase);
    expect(result).toBeNull();
  });

  it('should still return null for points outside all bounding boxes', () => {
    const objects = [makeObj('a', 0, 0, 50, 50, 0)];
    const drawingObjects = new Map<string, DrawingObject>([['a', makeDrawingObj('a')]]);
    const ctx = createMockContext({ isPointInPathFn: jest.fn(() => true) });
    const narrowPhase: HitTestNarrowPhaseOptions = { ctx, drawingObjects };

    const result = hitTest(objects, { x: 200, y: 200 }, narrowPhase);
    expect(result).toBeNull();
    // isPointInPath should NOT have been called — broad-phase already rejected
    expect(ctx.isPointInPath).not.toHaveBeenCalled();
  });

  it('should handle empty objects array with narrowPhase', () => {
    const drawingObjects = new Map<string, DrawingObject>();
    const ctx = createMockContext();
    const narrowPhase: HitTestNarrowPhaseOptions = { ctx, drawingObjects };

    const result = hitTest([], { x: 50, y: 50 }, narrowPhase);
    expect(result).toBeNull();
  });

  it('should preserve existing behavior when narrowPhase is undefined', () => {
    // This confirms backward compatibility — same as the original hitTest tests
    const objects = [makeObj('a', 0, 0, 100, 100, 0)];
    const result = hitTest(objects, { x: 50, y: 50 }, undefined);
    expect(result?.id).toBe('a');
  });
});

// =============================================================================
// selectInRect - intersects
// =============================================================================

describe('selectInRect (intersects)', () => {
  it('should select objects that overlap the rect', () => {
    const objects = [
      makeObj('a', 0, 0, 50, 50, 0),
      makeObj('b', 40, 40, 50, 50, 1),
      makeObj('c', 200, 200, 50, 50, 2),
    ];
    const result = selectInRect(objects, { x: 10, y: 10, width: 60, height: 60 }, 'intersects');
    expect(result.map((o) => o.id).sort()).toEqual(['a', 'b']);
  });

  it('should include partially overlapping objects', () => {
    const objects = [makeObj('a', 0, 0, 100, 100, 0)];
    const result = selectInRect(objects, { x: 90, y: 90, width: 50, height: 50 }, 'intersects');
    expect(result).toHaveLength(1);
  });

  it('should return empty for no overlap', () => {
    const objects = [makeObj('a', 0, 0, 50, 50, 0)];
    const result = selectInRect(objects, { x: 100, y: 100, width: 50, height: 50 }, 'intersects');
    expect(result).toHaveLength(0);
  });

  it('should handle empty objects', () => {
    expect(selectInRect([], { x: 0, y: 0, width: 100, height: 100 }, 'intersects')).toEqual([]);
  });
});

// =============================================================================
// selectInRect - contains
// =============================================================================

describe('selectInRect (contains)', () => {
  it('should only select objects fully inside the rect', () => {
    const objects = [
      makeObj('inside', 10, 10, 30, 30, 0),
      makeObj('partial', 80, 80, 50, 50, 1),
      makeObj('outside', 200, 200, 50, 50, 2),
    ];
    const result = selectInRect(objects, { x: 0, y: 0, width: 100, height: 100 }, 'contains');
    expect(result.map((o) => o.id)).toEqual(['inside']);
  });

  it('should not include partially overlapping objects', () => {
    const objects = [makeObj('a', 90, 90, 50, 50, 0)];
    const result = selectInRect(objects, { x: 0, y: 0, width: 100, height: 100 }, 'contains');
    expect(result).toHaveLength(0);
  });

  it('should include object exactly matching the rect', () => {
    const objects = [makeObj('exact', 10, 10, 80, 80, 0)];
    const result = selectInRect(objects, { x: 10, y: 10, width: 80, height: 80 }, 'contains');
    expect(result).toHaveLength(1);
  });
});

// =============================================================================
// findNearby
// =============================================================================

describe('findNearby', () => {
  it('should find objects within radius', () => {
    const objects = [makeObj('close', 10, 10, 20, 20, 0), makeObj('far', 500, 500, 20, 20, 1)];
    const result = findNearby(objects, { x: 0, y: 0 }, 50);
    expect(result.map((o) => o.id)).toEqual(['close']);
  });

  it('should include objects that contain the point', () => {
    const objects = [makeObj('a', 0, 0, 100, 100, 0)];
    const result = findNearby(objects, { x: 50, y: 50 }, 10);
    // Point is inside the box, distance = 0
    expect(result).toHaveLength(1);
  });

  it('should sort by distance (nearest first)', () => {
    const objects = [makeObj('far', 100, 0, 10, 10, 0), makeObj('near', 20, 0, 10, 10, 1)];
    const result = findNearby(objects, { x: 0, y: 5 }, 200);
    expect(result[0].id).toBe('near');
    expect(result[1].id).toBe('far');
  });

  it('should return empty when nothing is near', () => {
    const objects = [makeObj('a', 1000, 1000, 10, 10, 0)];
    const result = findNearby(objects, { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('should handle empty objects', () => {
    expect(findNearby([], { x: 0, y: 0 }, 100)).toEqual([]);
  });
});

// =============================================================================
// findOverlapping
// =============================================================================

describe('findOverlapping', () => {
  it('should find objects overlapping the target', () => {
    const objects = [
      makeObj('target', 0, 0, 100, 100, 0),
      makeObj('overlapping', 50, 50, 100, 100, 1),
      makeObj('separate', 200, 200, 50, 50, 2),
    ];
    const result = findOverlapping(objects, 'target');
    expect(result.map((o) => o.id)).toEqual(['overlapping']);
  });

  it('should exclude the target itself', () => {
    const objects = [makeObj('target', 0, 0, 100, 100, 0)];
    const result = findOverlapping(objects, 'target');
    expect(result).toHaveLength(0);
  });

  it('should handle non-existent target', () => {
    const objects = [makeObj('a', 0, 0, 100, 100, 0)];
    const result = findOverlapping(objects, 'nonexistent');
    expect(result).toEqual([]);
  });

  it('should find multiple overlapping objects', () => {
    const objects = [
      makeObj('target', 50, 50, 100, 100, 0),
      makeObj('a', 0, 0, 80, 80, 1),
      makeObj('b', 100, 100, 80, 80, 2),
      makeObj('c', 300, 300, 10, 10, 3),
    ];
    const result = findOverlapping(objects, 'target');
    expect(result.map((o) => o.id).sort()).toEqual(['a', 'b']);
  });

  it('should not count touching edges as overlapping', () => {
    const objects = [
      makeObj('target', 0, 0, 100, 100, 0),
      makeObj('adjacent', 100, 0, 100, 100, 1),
    ];
    const result = findOverlapping(objects, 'target');
    expect(result).toHaveLength(0);
  });
});
