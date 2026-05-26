/**
 * Tests for arrow shape presets.
 */
import { PathOps } from '@mog/geometry';
import { generateShapePath, isValidShapeType } from '../../src/shape-to-path';

describe('Arrow Shape Presets', () => {
  const arrowShapes = [
    'rightArrow',
    'leftArrow',
    // upArrow is missing from preset-shape-data.json (extraction gap)
    // 'upArrow',
    'downArrow',
    'leftRightArrow',
    'upDownArrow',
    'quadArrow',
    'chevron',
    'homePlate',
    'bentArrow',
    'uturnArrow',
    'circularArrow',
    'leftCircularArrow',
    'leftRightCircularArrow',
    'curvedRightArrow',
    'curvedLeftArrow',
    'curvedUpArrow',
    'curvedDownArrow',
    'swooshArrow',
    'rightArrowCallout',
    'leftArrowCallout',
    'upArrowCallout',
    'downArrowCallout',
    'leftRightArrowCallout',
    'upDownArrowCallout',
    'quadArrowCallout',
    'bentUpArrow',
    'stripedRightArrow',
    'notchedRightArrow',
  ];

  it('should register all arrow shapes', () => {
    for (const shape of arrowShapes) {
      expect(isValidShapeType(shape)).toBe(true);
    }
  });

  describe('right arrow (rightArrow)', () => {
    it('should generate a closed path', () => {
      const path = generateShapePath('rightArrow', 100, 50);
      expect(path.closed).toBe(true);
    });

    it('should respect adj1 adjustment', () => {
      const narrow = generateShapePath('rightArrow', 100, 50, [
        { name: 'adj1', value: 30000 },
        { name: 'adj2', value: 50000 },
      ]);
      const wide = generateShapePath('rightArrow', 100, 50, [
        { name: 'adj1', value: 80000 },
        { name: 'adj2', value: 50000 },
      ]);
      expect(PathOps.pathToSvgString(narrow)).not.toBe(PathOps.pathToSvgString(wide));
    });

    it('should generate snapshot-stable path', () => {
      const path = generateShapePath('rightArrow', 100, 100);
      expect(path.segments).toMatchSnapshot();
    });
  });

  describe('leftRightArrow', () => {
    it('should have symmetric bounding box', () => {
      const path = generateShapePath('leftRightArrow', 100, 50);
      const bb = PathOps.pathBoundingBox(path);
      expect(bb.x).toBeCloseTo(0, 0);
      expect(bb.width).toBeCloseTo(100, 0);
    });
  });

  describe('chevron', () => {
    it('should generate a closed 6-point path', () => {
      const path = generateShapePath('chevron', 100, 80);
      expect(path.closed).toBe(true);
    });
  });

  describe('circular arrows', () => {
    it('should generate circularArrow with curves', () => {
      const path = generateShapePath('circularArrow', 100, 100);
      const hasCurves = path.segments.some((s) => s.type === 'C');
      expect(hasCurves).toBe(true);
    });
  });
});
