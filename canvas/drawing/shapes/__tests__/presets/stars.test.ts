/**
 * Tests for star, banner, seal, and scroll shape presets.
 */
import { PathOps } from '@mog/geometry';
import { generateShapePath, isValidShapeType } from '../../src/shape-to-path';

describe('Star Shape Presets', () => {
  const starShapes = [
    'star4',
    'star5',
    'star6',
    'star7',
    'star8',
    'star10',
    'star12',
    'star16',
    'star24',
    'star32',
  ];

  const bannerShapes = [
    'ribbon',
    'ribbon2',
    'ellipseRibbon',
    'ellipseRibbon2',
    'leftRightRibbon',
    'banner',
  ];

  const sealShapes = ['irregularSeal1', 'irregularSeal2'];

  const waveShapes = ['wave', 'doubleWave'];
  const scrollShapes = ['verticalScroll', 'horizontalScroll'];

  it('should register all star shapes', () => {
    for (const shape of starShapes) {
      expect(isValidShapeType(shape)).toBe(true);
    }
  });

  it('should register all banner shapes', () => {
    for (const shape of bannerShapes) {
      expect(isValidShapeType(shape)).toBe(true);
    }
  });

  it('should register all seal shapes', () => {
    for (const shape of sealShapes) {
      expect(isValidShapeType(shape)).toBe(true);
    }
  });

  describe.each(starShapes)('%s', (shapeType) => {
    it('should generate a closed path', () => {
      const path = generateShapePath(shapeType, 100, 100);
      expect(path.closed).toBe(true);
    });

    it('should respect inner radius adjustment', () => {
      // OOXML spec uses 'adj' with 100000-based values for star inner radius
      const small = generateShapePath(shapeType, 100, 100, [{ name: 'adj', value: 10000 }]);
      const large = generateShapePath(shapeType, 100, 100, [{ name: 'adj', value: 40000 }]);
      expect(PathOps.pathToSvgString(small)).not.toBe(PathOps.pathToSvgString(large));
    });

    it('should generate snapshot-stable path', () => {
      const path = generateShapePath(shapeType, 100, 100);
      expect(path.segments).toMatchSnapshot();
    });
  });

  describe('star5', () => {
    it('should generate 10 points (5 outer + 5 inner)', () => {
      const path = generateShapePath('star5', 100, 100);
      const lineSegs = path.segments.filter((s) => s.type === 'L');
      expect(lineSegs.length).toBe(9); // moveTo + 9 lineTo
    });
  });

  describe.each(waveShapes)('%s', (shapeType) => {
    it('should generate a closed path', () => {
      const path = generateShapePath(shapeType, 100, 100);
      expect(path.closed).toBe(true);
    });

    it('should contain curves', () => {
      const path = generateShapePath(shapeType, 100, 100);
      const hasCurves = path.segments.some((s) => s.type === 'C');
      expect(hasCurves).toBe(true);
    });
  });

  describe.each(scrollShapes)('%s', (shapeType) => {
    it('should generate a path with curves', () => {
      const path = generateShapePath(shapeType, 100, 100);
      const hasCurves = path.segments.some((s) => s.type === 'C');
      expect(hasCurves).toBe(true);
    });
  });
});
