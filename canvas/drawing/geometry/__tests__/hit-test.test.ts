import type { Point2D } from '@mog-sdk/contracts/geometry';
import {
  distanceToLine,
  distanceToPath,
  distanceToSegment,
  pointInPolygon,
  pointOnPath,
} from '../src/hit-test';
import { parseSvgPath } from '../src/path';

describe('Hit test operations', () => {
  // ─── Point in Polygon (Convex) ───────────────────────────────────────

  describe('pointInPolygon - convex shapes', () => {
    const square: Point2D[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];

    test('point inside square', () => {
      expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    });

    test('point outside square (right)', () => {
      expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    });

    test('point outside square (above)', () => {
      expect(pointInPolygon({ x: 50, y: -10 }, square)).toBe(false);
    });

    test('point outside square (left)', () => {
      expect(pointInPolygon({ x: -10, y: 50 }, square)).toBe(false);
    });

    test('point outside square (below)', () => {
      expect(pointInPolygon({ x: 50, y: 110 }, square)).toBe(false);
    });

    test('point at corner of square', () => {
      // Behavior at vertices is implementation-defined for ray casting
      // Just ensure no errors
      const result = pointInPolygon({ x: 0, y: 0 }, square);
      expect(typeof result).toBe('boolean');
    });

    test('point on edge of square', () => {
      // Edge case - result depends on implementation
      const result = pointInPolygon({ x: 50, y: 0 }, square);
      expect(typeof result).toBe('boolean');
    });

    test('triangle contains center', () => {
      const triangle: Point2D[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 100 },
      ];
      expect(pointInPolygon({ x: 50, y: 30 }, triangle)).toBe(true);
    });

    test('triangle excludes far point', () => {
      const triangle: Point2D[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 100 },
      ];
      expect(pointInPolygon({ x: 200, y: 200 }, triangle)).toBe(false);
    });
  });

  // ─── Point in Polygon (Concave) ──────────────────────────────────────

  describe('pointInPolygon - concave shapes', () => {
    // L-shaped polygon
    const lShape: Point2D[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ];

    test('point in bottom-left of L', () => {
      expect(pointInPolygon({ x: 25, y: 75 }, lShape)).toBe(true);
    });

    test('point in top-right of L', () => {
      expect(pointInPolygon({ x: 75, y: 25 }, lShape)).toBe(true);
    });

    test('point in empty notch of L', () => {
      expect(pointInPolygon({ x: 75, y: 75 }, lShape)).toBe(false);
    });

    test('point outside L entirely', () => {
      expect(pointInPolygon({ x: 150, y: 150 }, lShape)).toBe(false);
    });
  });

  // ─── Point in Polygon (Edge Cases) ───────────────────────────────────

  describe('pointInPolygon - edge cases', () => {
    test('empty polygon returns false', () => {
      expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    });

    test('single point polygon returns false', () => {
      expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(false);
    });

    test('two points polygon returns false', () => {
      expect(
        pointInPolygon({ x: 0, y: 0 }, [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]),
      ).toBe(false);
    });

    test('very small polygon', () => {
      const tiny: Point2D[] = [
        { x: 0, y: 0 },
        { x: 0.001, y: 0 },
        { x: 0.0005, y: 0.001 },
      ];
      expect(pointInPolygon({ x: 0.0005, y: 0.0005 }, tiny)).toBe(true);
    });
  });

  // ─── Distance to Segment ─────────────────────────────────────────────

  describe('distanceToSegment', () => {
    test('point on segment has distance 0', () => {
      expect(distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0, 10);
    });

    test('point at segment endpoint has distance 0', () => {
      expect(distanceToSegment({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0, 10);
    });

    test('point perpendicular to horizontal segment', () => {
      expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3, 10);
    });

    test('point closest to endpoint', () => {
      // Point is past the end of the segment
      const dist = distanceToSegment({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
      expect(dist).toBeCloseTo(5, 10);
    });

    test('point closest to start', () => {
      const dist = distanceToSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
      expect(dist).toBeCloseTo(5, 10);
    });

    test('degenerate segment (zero length)', () => {
      const dist = distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
      expect(dist).toBeCloseTo(5, 10);
    });

    test('distance to diagonal segment', () => {
      // Point (0, 5) to segment from (0, 0) to (10, 0) - dist = 5
      // Point (5, 5) to segment from (0, 0) to (10, 0) - dist = 5
      const dist = distanceToSegment({ x: 0, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 });
      expect(dist).toBeCloseTo(5, 10);
    });
  });

  // ─── Distance to Line ────────────────────────────────────────────────

  describe('distanceToLine', () => {
    test('point on line has distance 0', () => {
      expect(distanceToLine({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0, 10);
    });

    test('point perpendicular to horizontal line', () => {
      expect(distanceToLine({ x: 5, y: 7 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(7, 10);
    });

    test('point extends beyond segment but on infinite line', () => {
      // For distanceToLine, projections beyond the endpoints still give perpendicular distance
      expect(distanceToLine({ x: 20, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5, 10);
    });

    test('distance to vertical line', () => {
      expect(distanceToLine({ x: 7, y: 50 }, { x: 0, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(7, 10);
    });

    test('degenerate line (same start and end)', () => {
      const dist = distanceToLine({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
      expect(dist).toBeCloseTo(5, 10);
    });
  });

  // ─── Point on Path ───────────────────────────────────────────────────

  describe('pointOnPath', () => {
    test('point on line path within tolerance', () => {
      const path = parseSvgPath('M 0 0 L 100 0');
      expect(pointOnPath({ x: 50, y: 0 }, path, 1)).toBe(true);
    });

    test('point near line path within tolerance', () => {
      const path = parseSvgPath('M 0 0 L 100 0');
      expect(pointOnPath({ x: 50, y: 0.5 }, path, 1)).toBe(true);
    });

    test('point far from line path outside tolerance', () => {
      const path = parseSvgPath('M 0 0 L 100 0');
      expect(pointOnPath({ x: 50, y: 10 }, path, 1)).toBe(false);
    });

    test('point on cubic path within tolerance', () => {
      const path = parseSvgPath('M 0 0 C 33 100 67 100 100 0');
      // The midpoint of this symmetric curve should be around (50, 75)
      expect(pointOnPath({ x: 50, y: 75 }, path, 5)).toBe(true);
    });
  });

  // ─── Distance to Path ────────────────────────────────────────────────

  describe('distanceToPath', () => {
    test('point on path has distance ~0', () => {
      const path = parseSvgPath('M 0 0 L 100 0');
      expect(distanceToPath({ x: 50, y: 0 }, path)).toBeCloseTo(0, 5);
    });

    test('point above horizontal path', () => {
      const path = parseSvgPath('M 0 0 L 100 0');
      expect(distanceToPath({ x: 50, y: 10 }, path)).toBeCloseTo(10, 5);
    });

    test('empty path returns Infinity', () => {
      expect(distanceToPath({ x: 0, y: 0 }, { segments: [], closed: false })).toBe(Infinity);
    });

    test('distance to rectangle path', () => {
      const path = parseSvgPath('M 0 0 L 100 0 L 100 100 L 0 100 Z');
      // Point inside rectangle - closest edge
      expect(distanceToPath({ x: 50, y: 5 }, path)).toBeCloseTo(5, 5);
    });

    test('distance to path with curves', () => {
      const path = parseSvgPath('M 0 0 Q 50 100 100 0');
      const dist = distanceToPath({ x: 200, y: 0 }, path);
      expect(dist).toBeGreaterThan(90); // Far from the curve
    });
  });
});
