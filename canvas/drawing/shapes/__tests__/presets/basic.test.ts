/**
 * Tests for basic shape presets.
 */
import { PathOps } from '@mog/geometry';
import { generateShapePath, isValidShapeType } from '../../src/shape-to-path';

describe('Basic Shape Presets', () => {
  const basicShapes = [
    'rect',
    'roundRect',
    'ellipse',
    'triangle',
    'rtTriangle',
    'diamond',
    'pentagon',
    'hexagon',
    'heptagon',
    'octagon',
    'decagon',
    'dodecagon',
    'parallelogram',
    'trapezoid',
    'nonIsoscelesTrapezoid',
    'teardrop',
    'pie',
    'pieWedge',
    'blockArc',
    'donut',
    'noSmoking',
    'plaque',
    'plus',
    'frame',
    'halfFrame',
    'corner',
    'diagStripe',
    'chord',
    'can',
    'cube',
    'bevel',
    'foldedCorner',
    'heart',
    'lightningBolt',
    'sun',
    'moon',
    'smileyFace',
    'funnel',
    'round1Rect',
    'round2SameRect',
    'round2DiagRect',
    'snip1Rect',
    'snip2SameRect',
    'snip2DiagRect',
    'snipRoundRect',
  ];

  it('should register all basic shapes', () => {
    for (const shape of basicShapes) {
      expect(isValidShapeType(shape)).toBe(true);
    }
  });

  describe('rect', () => {
    it('should generate a closed rectangle path', () => {
      const path = generateShapePath('rect', 100, 50);
      expect(path.closed).toBe(true);
      expect(path.segments.length).toBeGreaterThan(0);
    });

    it('should have bounding box matching dimensions', () => {
      const path = generateShapePath('rect', 100, 50);
      const bb = PathOps.pathBoundingBox(path);
      expect(bb.x).toBeCloseTo(0);
      expect(bb.y).toBeCloseTo(0);
      expect(bb.width).toBeCloseTo(100);
      expect(bb.height).toBeCloseTo(50);
    });
  });

  describe('roundRect', () => {
    it('should generate path with curves (cubic bezier segments)', () => {
      const path = generateShapePath('roundRect', 100, 100);
      const hasCurves = path.segments.some((s) => s.type === 'C');
      expect(hasCurves).toBe(true);
    });

    it('should respect adj adjustment', () => {
      const pathSmall = generateShapePath('roundRect', 100, 100, [{ name: 'adj', value: 5000 }]);
      const pathLarge = generateShapePath('roundRect', 100, 100, [{ name: 'adj', value: 40000 }]);
      // Different adjustments should produce different paths
      expect(PathOps.pathToSvgString(pathSmall)).not.toBe(PathOps.pathToSvgString(pathLarge));
    });
  });

  describe('ellipse', () => {
    it('should generate a closed ellipse path', () => {
      const path = generateShapePath('ellipse', 100, 50);
      expect(path.closed).toBe(true);
      const curves = path.segments.filter((s) => s.type === 'C');
      expect(curves.length).toBe(4); // 4 cubic bezier segments for an ellipse
    });
  });

  describe('diamond', () => {
    it('should generate a closed 4-point path', () => {
      const path = generateShapePath('diamond', 100, 100);
      expect(path.closed).toBe(true);
      const lineSegs = path.segments.filter((s) => s.type === 'L');
      expect(lineSegs.length).toBe(3); // moveTo + 3 lineTo + close
    });
  });

  describe('donut', () => {
    it('should generate two subpaths (outer and inner)', () => {
      const path = generateShapePath('donut', 100, 100);
      const closePaths = path.segments.filter((s) => s.type === 'Z');
      expect(closePaths.length).toBe(2);
    });
  });

  describe('plus', () => {
    it('should generate a valid closed path with multiple segments', () => {
      const path = generateShapePath('plus', 100, 100);
      expect(path.closed).toBe(true);
      expect(path.segments.length).toBeGreaterThan(3);
    });
  });
});
