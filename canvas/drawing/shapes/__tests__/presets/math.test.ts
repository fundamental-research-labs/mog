/**
 * Tests for math operator shape presets.
 */
import { PathOps } from '@mog/geometry';
import { generateShapePath, isValidShapeType } from '../../src/shape-to-path';

describe('Math Shape Presets', () => {
  const mathShapes = [
    'mathPlus',
    'mathMinus',
    'mathMultiply',
    'mathDivide',
    'mathEqual',
    'mathNotEqual',
  ];

  it('should register all math shapes', () => {
    for (const shape of mathShapes) {
      expect(isValidShapeType(shape)).toBe(true);
    }
  });

  describe.each(mathShapes)('%s', (shapeType) => {
    it('should generate a non-empty path', () => {
      const path = generateShapePath(shapeType, 100, 100);
      expect(path.segments.length).toBeGreaterThan(0);
    });

    it('should have no NaN coordinates', () => {
      const path = generateShapePath(shapeType, 100, 100);
      for (const seg of path.segments) {
        if (seg.type === 'Z') continue;
        expect(isNaN(seg.x)).toBe(false);
        expect(isNaN(seg.y)).toBe(false);
      }
    });

    it('should generate a closed path', () => {
      const path = generateShapePath(shapeType, 100, 100);
      expect(path.closed).toBe(true);
    });

    it('should respond to adjustment changes', () => {
      const default_ = generateShapePath(shapeType, 100, 100);
      // OOXML spec uses 'adj1' with 100000-based values for math shapes
      const adjusted = generateShapePath(shapeType, 100, 100, [{ name: 'adj1', value: 35000 }]);
      expect(PathOps.pathToSvgString(default_)).not.toBe(PathOps.pathToSvgString(adjusted));
    });
  });

  describe('mathPlus', () => {
    it('should have a 12-point plus shape', () => {
      const path = generateShapePath('mathPlus', 100, 100);
      const lineSegs = path.segments.filter((s) => s.type === 'L');
      expect(lineSegs.length).toBe(11); // 12 points = moveTo + 11 lineTo
    });
  });

  describe('mathMinus', () => {
    it('should be a simple horizontal bar', () => {
      const path = generateShapePath('mathMinus', 100, 100);
      const lineSegs = path.segments.filter((s) => s.type === 'L');
      expect(lineSegs.length).toBe(3); // 4 points rectangle = moveTo + 3 lineTo
    });
  });

  describe('mathDivide', () => {
    it('should have multiple subpaths (bar + two dots)', () => {
      const path = generateShapePath('mathDivide', 100, 100);
      const closePaths = path.segments.filter((s) => s.type === 'Z');
      expect(closePaths.length).toBe(3); // bar + top dot + bottom dot
    });
  });

  describe('mathEqual', () => {
    it('should have two subpaths (two bars)', () => {
      const path = generateShapePath('mathEqual', 100, 100);
      const closePaths = path.segments.filter((s) => s.type === 'Z');
      expect(closePaths.length).toBe(2);
    });
  });

  describe('mathNotEqual', () => {
    it('should have a closed path', () => {
      const path = generateShapePath('mathNotEqual', 100, 100);
      // The OOXML spec defines mathNotEqual as a single closed polygon
      expect(path.closed).toBe(true);
    });
  });
});
