/**
 * Tests for shared geometry primitives.
 */
import { PathOps } from '@mog/geometry';
import { ellipsePath, ellipsePoint, regularPolygon, starPath } from '../../src/presets/primitives';

describe('Geometry Primitives', () => {
  describe('ellipsePoint', () => {
    it('should return rightmost point at angle 0', () => {
      const pt = ellipsePoint(50, 50, 40, 30, 0);
      expect(pt.x).toBeCloseTo(90);
      expect(pt.y).toBeCloseTo(50);
    });

    it('should return topmost point at angle -PI/2', () => {
      const pt = ellipsePoint(50, 50, 40, 30, -Math.PI / 2);
      expect(pt.x).toBeCloseTo(50);
      expect(pt.y).toBeCloseTo(20);
    });

    it('should return bottommost point at angle PI/2', () => {
      const pt = ellipsePoint(50, 50, 40, 30, Math.PI / 2);
      expect(pt.x).toBeCloseTo(50);
      expect(pt.y).toBeCloseTo(80);
    });

    it('should return leftmost point at angle PI', () => {
      const pt = ellipsePoint(50, 50, 40, 30, Math.PI);
      expect(pt.x).toBeCloseTo(10);
      expect(pt.y).toBeCloseTo(50);
    });
  });

  describe('ellipsePath', () => {
    it('should create a closed path', () => {
      const path = ellipsePath(50, 50, 40, 30);
      expect(path.closed).toBe(true);
    });

    it('should use 4 cubic bezier segments', () => {
      const path = ellipsePath(50, 50, 40, 30);
      const curves = path.segments.filter((s) => s.type === 'C');
      expect(curves.length).toBe(4);
    });

    it('should have a bounding box matching the radii', () => {
      const path = ellipsePath(50, 50, 40, 30);
      const bb = PathOps.pathBoundingBox(path);
      expect(bb.x).toBeCloseTo(10);
      expect(bb.y).toBeCloseTo(20);
      expect(bb.width).toBeCloseTo(80);
      expect(bb.height).toBeCloseTo(60);
    });

    it('should handle a circle (equal radii)', () => {
      const path = ellipsePath(50, 50, 50, 50);
      const bb = PathOps.pathBoundingBox(path);
      expect(bb.width).toBeCloseTo(100);
      expect(bb.height).toBeCloseTo(100);
    });
  });

  describe('regularPolygon', () => {
    it('should create a triangle (3 sides)', () => {
      const path = regularPolygon(50, 50, 40, 40, 3);
      expect(path.closed).toBe(true);
      const lines = path.segments.filter((s) => s.type === 'L');
      expect(lines.length).toBe(2); // moveTo + 2 lineTo + close
    });

    it('should create a square (4 sides)', () => {
      const path = regularPolygon(50, 50, 40, 40, 4);
      const lines = path.segments.filter((s) => s.type === 'L');
      expect(lines.length).toBe(3); // moveTo + 3 lineTo + close
    });

    it('should create a hexagon (6 sides)', () => {
      const path = regularPolygon(50, 50, 40, 40, 6);
      const lines = path.segments.filter((s) => s.type === 'L');
      expect(lines.length).toBe(5);
    });

    it('should use custom start angle', () => {
      const pathDefault = regularPolygon(50, 50, 40, 40, 4);
      const pathRotated = regularPolygon(50, 50, 40, 40, 4, 0);
      expect(PathOps.pathToSvgString(pathDefault)).not.toBe(PathOps.pathToSvgString(pathRotated));
    });
  });

  describe('starPath', () => {
    it('should create a 5-pointed star', () => {
      const path = starPath(50, 50, 50, 50, 25, 25, 5);
      expect(path.closed).toBe(true);
      // 5*2 = 10 points: moveTo + 9 lineTo
      const lines = path.segments.filter((s) => s.type === 'L');
      expect(lines.length).toBe(9);
    });

    it('should create a 4-pointed star', () => {
      const path = starPath(50, 50, 50, 50, 20, 20, 4);
      expect(path.closed).toBe(true);
      const lines = path.segments.filter((s) => s.type === 'L');
      expect(lines.length).toBe(7); // 8 points: moveTo + 7 lineTo
    });

    it('should support different inner/outer radii', () => {
      const sharp = starPath(50, 50, 50, 50, 10, 10, 5);
      const wide = starPath(50, 50, 50, 50, 40, 40, 5);
      expect(PathOps.pathToSvgString(sharp)).not.toBe(PathOps.pathToSvgString(wide));
    });

    it('should support elliptical outer/inner radii', () => {
      const path = starPath(50, 50, 50, 30, 25, 15, 5);
      expect(path.closed).toBe(true);
      const bb = PathOps.pathBoundingBox(path);
      // Wider than tall
      expect(bb.width).toBeGreaterThan(bb.height);
    });
  });
});
