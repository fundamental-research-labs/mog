import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { StrokeId } from '@mog-sdk/contracts/ink';
import {
  pointNearStroke,
  strokeIntersectsRect,
  strokeLineIntersections,
  strokesIntersect,
} from '../src/intersection';
import type { Stroke, StrokePoint } from '../src/stroke';
import { createStroke } from '../src/stroke';

/** Cast a plain string to StrokeId for testing. */
const testId = (id: string) => id as StrokeId;

// =============================================================================
// Helpers
// =============================================================================

function makePoints(coords: [number, number][], pressure = 0.5): StrokePoint[] {
  return coords.map(([x, y], i) => ({
    x,
    y,
    pressure,
    timestamp: i * 10,
  }));
}

function makeStroke(coords: [number, number][], width = 2, id: StrokeId = testId('test')): Stroke {
  return createStroke(makePoints(coords), { color: '#000', width, id });
}

function box(x: number, y: number, w: number, h: number): BoundingBox {
  return { x, y, width: w, height: h };
}

// =============================================================================
// strokesIntersect
// =============================================================================

describe('strokesIntersect', () => {
  test('crossing strokes intersect', () => {
    const a = makeStroke([
      [0, 0],
      [100, 100],
    ]);
    const b = makeStroke([
      [0, 100],
      [100, 0],
    ]);
    expect(strokesIntersect(a, b)).toBe(true);
  });

  test('parallel strokes do not intersect', () => {
    const a = makeStroke([
      [0, 0],
      [100, 0],
    ]);
    const b = makeStroke([
      [0, 50],
      [100, 50],
    ]);
    expect(strokesIntersect(a, b)).toBe(false);
  });

  test('non-overlapping bounding boxes', () => {
    const a = makeStroke([
      [0, 0],
      [10, 10],
    ]);
    const b = makeStroke([
      [200, 200],
      [300, 300],
    ]);
    expect(strokesIntersect(a, b)).toBe(false);
  });

  test('T-intersection', () => {
    const a = makeStroke([
      [0, 50],
      [100, 50],
    ]);
    const b = makeStroke([
      [50, 0],
      [50, 100],
    ]);
    expect(strokesIntersect(a, b)).toBe(true);
  });

  test('sharing an endpoint does not count as intersection for zero-length checks', () => {
    const a = makeStroke([
      [0, 0],
      [50, 50],
    ]);
    const b = makeStroke([
      [50, 50],
      [100, 0],
    ]);
    // The segments actually share endpoint [50,50], which is on both segments
    expect(strokesIntersect(a, b)).toBe(true);
  });

  test('single-point stroke does not intersect', () => {
    const a = createStroke(makePoints([[50, 50]]), { color: '#000', width: 2, id: testId('it-1') });
    const b = makeStroke([
      [0, 0],
      [100, 100],
    ]);
    expect(strokesIntersect(a, b)).toBe(false);
  });

  test('empty stroke does not intersect', () => {
    const a = {
      id: testId('i-1'),
      points: [],
      color: '#000',
      width: 2,
      opacity: 1,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    } as Stroke;
    const b = makeStroke([
      [0, 0],
      [100, 100],
    ]);
    expect(strokesIntersect(a, b)).toBe(false);
  });

  test('multi-segment crossing', () => {
    const a = makeStroke([
      [0, 0],
      [50, 0],
      [100, 0],
    ]);
    const b = makeStroke([
      [50, -50],
      [50, 50],
    ]);
    expect(strokesIntersect(a, b)).toBe(true);
  });

  test('L-shaped strokes can intersect', () => {
    const a = makeStroke([
      [0, 50],
      [100, 50],
    ]);
    const b = makeStroke([
      [50, 0],
      [50, 50],
      [50, 100],
    ]);
    expect(strokesIntersect(a, b)).toBe(true);
  });

  test('near-miss strokes do not intersect', () => {
    const a = makeStroke([
      [0, 0],
      [100, 0],
    ]);
    const b = makeStroke([
      [50, 1],
      [50, 100],
    ]);
    expect(strokesIntersect(a, b)).toBe(false);
  });
});

// =============================================================================
// strokeIntersectsRect
// =============================================================================

describe('strokeIntersectsRect', () => {
  test('stroke inside rect', () => {
    const stroke = makeStroke([
      [10, 10],
      [20, 20],
    ]);
    expect(strokeIntersectsRect(stroke, box(0, 0, 100, 100))).toBe(true);
  });

  test('stroke crossing rect boundary', () => {
    const stroke = makeStroke([
      [-10, 50],
      [110, 50],
    ]);
    expect(strokeIntersectsRect(stroke, box(0, 0, 100, 100))).toBe(true);
  });

  test('stroke outside rect', () => {
    const stroke = makeStroke([
      [200, 200],
      [300, 300],
    ]);
    expect(strokeIntersectsRect(stroke, box(0, 0, 100, 100))).toBe(false);
  });

  test('stroke touching rect edge', () => {
    const stroke = makeStroke([
      [100, 50],
      [150, 50],
    ]);
    expect(strokeIntersectsRect(stroke, box(0, 0, 100, 100))).toBe(true);
  });

  test('empty stroke does not intersect', () => {
    const stroke = {
      id: testId('i-2'),
      points: [],
      color: '#000',
      width: 2,
      opacity: 1,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    } as Stroke;
    expect(strokeIntersectsRect(stroke, box(0, 0, 100, 100))).toBe(false);
  });

  test('stroke with single point inside rect', () => {
    const stroke = createStroke(makePoints([[50, 50]]), {
      color: '#000',
      width: 2,
      id: testId('it-2'),
    });
    expect(strokeIntersectsRect(stroke, box(0, 0, 100, 100))).toBe(true);
  });

  test('stroke with single point outside rect', () => {
    const stroke = createStroke(makePoints([[150, 150]]), {
      color: '#000',
      width: 2,
      id: testId('it-3'),
    });
    expect(strokeIntersectsRect(stroke, box(0, 0, 100, 100))).toBe(false);
  });

  test('stroke wrapping around rect without crossing', () => {
    // Points are outside the rect, segments don't cross it
    const stroke = makeStroke([
      [-10, -10],
      [-10, 110],
      [110, 110],
      [110, -10],
    ]);
    // The segments go along the outside of box(0,0,100,100)
    // None of the points are inside, and segments don't cross
    expect(strokeIntersectsRect(stroke, box(20, 20, 60, 60))).toBe(false);
  });

  test('diagonal stroke through rect corner', () => {
    const stroke = makeStroke([
      [-10, 0],
      [10, 0],
    ]);
    expect(strokeIntersectsRect(stroke, box(0, -5, 20, 10))).toBe(true);
  });

  test('non-overlapping bounding boxes short-circuit', () => {
    const stroke = makeStroke([
      [0, 0],
      [10, 10],
    ]);
    expect(strokeIntersectsRect(stroke, box(500, 500, 10, 10))).toBe(false);
  });
});

// =============================================================================
// strokeLineIntersections
// =============================================================================

describe('strokeLineIntersections', () => {
  test('single crossing returns one point', () => {
    const stroke = makeStroke([
      [0, 0],
      [100, 100],
    ]);
    const pts = strokeLineIntersections(stroke, { x: 0, y: 100 }, { x: 100, y: 0 });
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBeCloseTo(50, 1);
    expect(pts[0].y).toBeCloseTo(50, 1);
  });

  test('no intersection returns empty', () => {
    const stroke = makeStroke([
      [0, 0],
      [100, 0],
    ]);
    const pts = strokeLineIntersections(stroke, { x: 0, y: 50 }, { x: 100, y: 50 });
    expect(pts).toHaveLength(0);
  });

  test('multiple crossings returns multiple points', () => {
    // Zigzag stroke crossing a horizontal line
    const stroke = makeStroke([
      [0, 0],
      [25, 100],
      [50, 0],
      [75, 100],
      [100, 0],
    ]);
    const pts = strokeLineIntersections(stroke, { x: -10, y: 50 }, { x: 110, y: 50 });
    expect(pts.length).toBeGreaterThanOrEqual(4);
  });

  test('empty stroke returns empty', () => {
    const stroke = {
      id: testId('i-3'),
      points: [],
      color: '#000',
      width: 2,
      opacity: 1,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    } as Stroke;
    const pts = strokeLineIntersections(stroke, { x: 0, y: 0 }, { x: 100, y: 100 });
    expect(pts).toHaveLength(0);
  });

  test('single-point stroke returns empty', () => {
    const stroke = createStroke(makePoints([[50, 50]]), {
      color: '#000',
      width: 2,
      id: testId('it-4'),
    });
    const pts = strokeLineIntersections(stroke, { x: 0, y: 0 }, { x: 100, y: 100 });
    expect(pts).toHaveLength(0);
  });

  test('collinear overlapping stroke and line return intersection at overlap boundary', () => {
    const stroke = makeStroke([
      [0, 0],
      [100, 0],
    ]);
    const pts = strokeLineIntersections(stroke, { x: 0, y: 0 }, { x: 100, y: 0 });
    // Collinear overlapping segments now return intersection at overlap boundary
    expect(pts.length).toBeGreaterThanOrEqual(1);
    expect(pts[0].y).toBeCloseTo(0);
  });
});

// =============================================================================
// pointNearStroke
// =============================================================================

describe('pointNearStroke', () => {
  test('point on stroke is near', () => {
    const stroke = makeStroke([
      [0, 0],
      [100, 0],
    ]);
    expect(pointNearStroke({ x: 50, y: 0 }, stroke, 1)).toBe(true);
  });

  test('point far from stroke is not near', () => {
    const stroke = makeStroke([
      [0, 0],
      [100, 0],
    ]);
    expect(pointNearStroke({ x: 50, y: 100 }, stroke, 5)).toBe(false);
  });

  test('point within tolerance is near', () => {
    const stroke = makeStroke([
      [0, 0],
      [100, 0],
    ]);
    expect(pointNearStroke({ x: 50, y: 3 }, stroke, 5)).toBe(true);
  });

  test('point at exactly tolerance distance is near', () => {
    const stroke = makeStroke([
      [0, 0],
      [100, 0],
    ]);
    expect(pointNearStroke({ x: 50, y: 5 }, stroke, 5)).toBe(true);
  });

  test('point just beyond tolerance is not near', () => {
    const stroke = makeStroke([
      [0, 0],
      [100, 0],
    ]);
    expect(pointNearStroke({ x: 50, y: 5.01 }, stroke, 5)).toBe(false);
  });

  test('empty stroke: point is never near', () => {
    const stroke = {
      id: testId('i-4'),
      points: [],
      color: '#000',
      width: 2,
      opacity: 1,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    } as Stroke;
    expect(pointNearStroke({ x: 0, y: 0 }, stroke, 100)).toBe(false);
  });

  test('single point stroke: distance check', () => {
    const stroke = createStroke(makePoints([[50, 50]]), {
      color: '#000',
      width: 2,
      id: testId('it-5'),
    });
    expect(pointNearStroke({ x: 50, y: 50 }, stroke, 1)).toBe(true);
    expect(pointNearStroke({ x: 50, y: 52 }, stroke, 1)).toBe(false);
  });

  test('point near a vertex', () => {
    const stroke = makeStroke([
      [0, 0],
      [50, 50],
      [100, 0],
    ]);
    expect(pointNearStroke({ x: 50, y: 49 }, stroke, 2)).toBe(true);
  });

  test('point near the start of stroke', () => {
    const stroke = makeStroke([
      [10, 10],
      [100, 10],
    ]);
    expect(pointNearStroke({ x: 10, y: 11 }, stroke, 2)).toBe(true);
  });

  test('point near the end of stroke', () => {
    const stroke = makeStroke([
      [10, 10],
      [100, 10],
    ]);
    expect(pointNearStroke({ x: 100, y: 11 }, stroke, 2)).toBe(true);
  });

  test('point near middle of diagonal segment', () => {
    const stroke = makeStroke([
      [0, 0],
      [100, 100],
    ]);
    // Point perpendicular to diagonal at (50, 50)
    // Perpendicular distance from (50+d/sqrt(2), 50-d/sqrt(2)) to the line y=x
    // is d. Let d=3.
    const d = 3;
    const offset = d / Math.sqrt(2);
    expect(pointNearStroke({ x: 50 + offset, y: 50 - offset }, stroke, 3.01)).toBe(true);
    expect(pointNearStroke({ x: 50 + offset, y: 50 - offset }, stroke, 2.99)).toBe(false);
  });
});

// =============================================================================
// Intersection geometry edge cases
// =============================================================================

import { boxesOverlap, pointToSegmentDistSq, segmentsIntersect } from '../src/intersection';

describe('segmentsIntersect', () => {
  test('collinear overlapping segments return intersection', () => {
    const result = segmentsIntersect(0, 0, 10, 0, 5, 0, 15, 0);
    expect(result).not.toBeNull();
    expect(result!.y).toBeCloseTo(0);
  });

  test('collinear non-overlapping segments return null', () => {
    const result = segmentsIntersect(0, 0, 5, 0, 10, 0, 15, 0);
    expect(result).toBeNull();
  });

  test('parallel non-collinear segments return null', () => {
    const result = segmentsIntersect(0, 0, 10, 0, 0, 5, 10, 5);
    expect(result).toBeNull();
  });

  test('crossing segments return intersection point', () => {
    const result = segmentsIntersect(0, 0, 10, 10, 0, 10, 10, 0);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(5);
    expect(result!.y).toBeCloseTo(5);
  });
});

describe('pointToSegmentDistSq', () => {
  test('point on segment has zero distance', () => {
    expect(pointToSegmentDistSq(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  test('point perpendicular to segment', () => {
    // Point at (5, 3) is 3 units from segment (0,0)-(10,0)
    expect(pointToSegmentDistSq(5, 3, 0, 0, 10, 0)).toBeCloseTo(9);
  });

  test('point nearest to endpoint', () => {
    // Point at (-5, 0) is 5 units from segment (0,0)-(10,0) (nearest to start)
    expect(pointToSegmentDistSq(-5, 0, 0, 0, 10, 0)).toBeCloseTo(25);
  });

  test('degenerate segment (zero length)', () => {
    expect(pointToSegmentDistSq(3, 4, 0, 0, 0, 0)).toBeCloseTo(25);
  });
});

describe('boxesOverlap', () => {
  test('overlapping boxes', () => {
    expect(
      boxesOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }),
    ).toBe(true);
  });

  test('non-overlapping boxes', () => {
    expect(
      boxesOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 }),
    ).toBe(false);
  });

  test('touching edges overlap', () => {
    expect(
      boxesOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }),
    ).toBe(true);
  });

  test('zero-size box at corner', () => {
    expect(
      boxesOverlap({ x: 10, y: 10, width: 0, height: 0 }, { x: 0, y: 0, width: 10, height: 10 }),
    ).toBe(true);
  });
});

describe('intersection with large coordinates', () => {
  test('strokes with large coordinates intersect correctly', () => {
    const a = makeStroke(
      [
        [1e6, 1e6],
        [1e6 + 100, 1e6 + 100],
      ],
      2,
      testId('lg-a'),
    );
    const b = makeStroke(
      [
        [1e6, 1e6 + 100],
        [1e6 + 100, 1e6],
      ],
      2,
      testId('lg-b'),
    );
    expect(strokesIntersect(a, b)).toBe(true);
  });

  test('point near stroke with large coordinates', () => {
    const stroke = makeStroke(
      [
        [1e6, 1e6],
        [1e6 + 100, 1e6],
      ],
      2,
      testId('lg-c'),
    );
    expect(pointNearStroke({ x: 1e6 + 50, y: 1e6 }, stroke, 1)).toBe(true);
    expect(pointNearStroke({ x: 1e6 + 50, y: 1e6 + 100 }, stroke, 1)).toBe(false);
  });
});
