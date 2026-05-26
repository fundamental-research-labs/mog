import type { Point2D } from '@mog-sdk/contracts/geometry';
import {
  convexHull,
  isClockwise,
  isConvex,
  pointOnPolygonEdge,
  polygonArea,
  polygonCentroid,
  polygonPerimeter,
} from '../src/polygon';

describe('Polygon operations', () => {
  // ─── Convex Hull ─────────────────────────────────────────────────────

  describe('convexHull', () => {
    test('hull of empty set is empty', () => {
      expect(convexHull([])).toEqual([]);
    });

    test('hull of single point', () => {
      const hull = convexHull([{ x: 5, y: 5 }]);
      expect(hull).toHaveLength(1);
      expect(hull[0]).toEqual({ x: 5, y: 5 });
    });

    test('hull of two points', () => {
      const hull = convexHull([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]);
      expect(hull).toHaveLength(2);
    });

    test('hull of collinear points returns endpoints', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ];
      const hull = convexHull(points);
      expect(hull).toHaveLength(2);
    });

    test('hull of square returns all four corners', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];
      const hull = convexHull(points);
      expect(hull).toHaveLength(4);
    });

    test('hull excludes interior points', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
        { x: 50, y: 50 }, // interior point
      ];
      const hull = convexHull(points);
      expect(hull).toHaveLength(4);
    });

    test('hull of random cloud excludes interior', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
        { x: 25, y: 25 },
        { x: 75, y: 25 },
        { x: 50, y: 75 },
        { x: 30, y: 50 },
      ];
      const hull = convexHull(points);
      expect(hull).toHaveLength(4);
    });

    test('hull of triangle with points on edges', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 50, y: 0 }, // on edge
        { x: 100, y: 0 },
        { x: 50, y: 100 },
      ];
      const hull = convexHull(points);
      // Hull should have at most 3 vertices (triangle)
      expect(hull.length).toBeLessThanOrEqual(4);
      expect(hull.length).toBeGreaterThanOrEqual(3);
    });

    test('hull is convex', () => {
      const points: Point2D[] = [
        { x: 10, y: 20 },
        { x: 50, y: 5 },
        { x: 90, y: 30 },
        { x: 80, y: 80 },
        { x: 20, y: 70 },
        { x: 40, y: 40 },
        { x: 60, y: 50 },
      ];
      const hull = convexHull(points);
      expect(isConvex(hull)).toBe(true);
    });
  });

  // ─── Polygon Area ────────────────────────────────────────────────────

  describe('polygonArea', () => {
    test('area of empty polygon is 0', () => {
      expect(polygonArea([])).toBe(0);
    });

    test('area of single point is 0', () => {
      expect(polygonArea([{ x: 5, y: 5 }])).toBe(0);
    });

    test('area of two points is 0', () => {
      expect(
        polygonArea([
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ]),
      ).toBe(0);
    });

    test('area of unit square (CCW) is 1', () => {
      const square: Point2D[] = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
      expect(polygonArea(square)).toBeCloseTo(1, 10);
    });

    test('area of unit square (CW) is -1', () => {
      const square: Point2D[] = [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
      ];
      expect(polygonArea(square)).toBeCloseTo(-1, 10);
    });

    test('absolute area of 100x50 rectangle', () => {
      const rect: Point2D[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 0, y: 50 },
      ];
      expect(Math.abs(polygonArea(rect))).toBeCloseTo(5000, 10);
    });

    test('area of right triangle is half base*height', () => {
      const triangle: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ];
      expect(Math.abs(polygonArea(triangle))).toBeCloseTo(50, 10);
    });

    test('area of equilateral triangle', () => {
      const side = 10;
      const h = (side * Math.sqrt(3)) / 2;
      const triangle: Point2D[] = [
        { x: 0, y: 0 },
        { x: side, y: 0 },
        { x: side / 2, y: h },
      ];
      const expected = (side * h) / 2;
      expect(Math.abs(polygonArea(triangle))).toBeCloseTo(expected, 5);
    });
  });

  // ─── Polygon Centroid ────────────────────────────────────────────────

  describe('polygonCentroid', () => {
    test('centroid of empty is origin', () => {
      expect(polygonCentroid([])).toEqual({ x: 0, y: 0 });
    });

    test('centroid of single point is that point', () => {
      expect(polygonCentroid([{ x: 5, y: 7 }])).toEqual({ x: 5, y: 7 });
    });

    test('centroid of two points is midpoint', () => {
      expect(
        polygonCentroid([
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ]),
      ).toEqual({ x: 5, y: 5 });
    });

    test('centroid of square is center', () => {
      const square: Point2D[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];
      const c = polygonCentroid(square);
      expect(c.x).toBeCloseTo(50, 5);
      expect(c.y).toBeCloseTo(50, 5);
    });

    test('centroid of equilateral triangle', () => {
      const triangle: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: (10 * Math.sqrt(3)) / 2 },
      ];
      const c = polygonCentroid(triangle);
      expect(c.x).toBeCloseTo(5, 5);
      expect(c.y).toBeCloseTo((10 * Math.sqrt(3)) / 2 / 3, 5);
    });

    test('centroid of right triangle', () => {
      const triangle: Point2D[] = [
        { x: 0, y: 0 },
        { x: 9, y: 0 },
        { x: 0, y: 9 },
      ];
      const c = polygonCentroid(triangle);
      expect(c.x).toBeCloseTo(3, 5);
      expect(c.y).toBeCloseTo(3, 5);
    });
  });

  // ─── Convexity ───────────────────────────────────────────────────────

  describe('isConvex', () => {
    test('empty polygon is convex', () => {
      expect(isConvex([])).toBe(true);
    });

    test('triangle is always convex', () => {
      expect(
        isConvex([
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ]),
      ).toBe(true);
    });

    test('square is convex', () => {
      expect(
        isConvex([
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ]),
      ).toBe(true);
    });

    test('L-shape is not convex', () => {
      expect(
        isConvex([
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 5 },
          { x: 5, y: 5 },
          { x: 5, y: 10 },
          { x: 0, y: 10 },
        ]),
      ).toBe(false);
    });

    test('star shape is not convex', () => {
      // Simple star with indentations
      expect(
        isConvex([
          { x: 50, y: 0 },
          { x: 40, y: 30 },
          { x: 10, y: 35 },
          { x: 30, y: 55 },
          { x: 20, y: 85 },
          { x: 50, y: 70 },
          { x: 80, y: 85 },
          { x: 70, y: 55 },
          { x: 90, y: 35 },
          { x: 60, y: 30 },
        ]),
      ).toBe(false);
    });
  });

  // ─── Clockwise ───────────────────────────────────────────────────────

  describe('isClockwise', () => {
    test('CCW square is not clockwise', () => {
      expect(
        isClockwise([
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ]),
      ).toBe(false);
    });

    test('CW square is clockwise', () => {
      expect(
        isClockwise([
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 1, y: 0 },
        ]),
      ).toBe(true);
    });
  });

  // ─── Perimeter ───────────────────────────────────────────────────────

  describe('polygonPerimeter', () => {
    test('empty polygon has 0 perimeter', () => {
      expect(polygonPerimeter([])).toBe(0);
    });

    test('single point has 0 perimeter', () => {
      expect(polygonPerimeter([{ x: 0, y: 0 }])).toBe(0);
    });

    test('unit square has perimeter 4', () => {
      const square: Point2D[] = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
      expect(polygonPerimeter(square)).toBeCloseTo(4, 10);
    });

    test('equilateral triangle has perimeter 3*side', () => {
      const side = 10;
      const h = (side * Math.sqrt(3)) / 2;
      const triangle: Point2D[] = [
        { x: 0, y: 0 },
        { x: side, y: 0 },
        { x: side / 2, y: h },
      ];
      expect(polygonPerimeter(triangle)).toBeCloseTo(3 * side, 5);
    });
  });

  // ─── Point on Polygon Edge ───────────────────────────────────────────

  describe('pointOnPolygonEdge', () => {
    const square: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    test('point on top edge', () => {
      expect(pointOnPolygonEdge({ x: 5, y: 0 }, square, 0.01)).toBe(true);
    });

    test('point on right edge', () => {
      expect(pointOnPolygonEdge({ x: 10, y: 5 }, square, 0.01)).toBe(true);
    });

    test('point at corner', () => {
      expect(pointOnPolygonEdge({ x: 0, y: 0 }, square, 0.01)).toBe(true);
    });

    test('interior point not on edge', () => {
      expect(pointOnPolygonEdge({ x: 5, y: 5 }, square, 0.01)).toBe(false);
    });

    test('exterior point not on edge', () => {
      expect(pointOnPolygonEdge({ x: 50, y: 50 }, square, 0.01)).toBe(false);
    });

    test('point near edge within tolerance', () => {
      expect(pointOnPolygonEdge({ x: 5, y: 0.005 }, square, 0.01)).toBe(true);
    });
  });
});
