/**
 * Tests for callout shape presets.
 */
import { generateShapePath, isValidShapeType } from '../../src/shape-to-path';

describe('Callout Shape Presets', () => {
  const wedgeCallouts = ['wedgeRectCallout', 'wedgeRoundRectCallout', 'wedgeEllipseCallout'];
  const borderCallouts = [
    'callout1',
    'callout2',
    'callout3',
    'borderCallout1',
    'borderCallout2',
    'borderCallout3',
  ];
  const accentCallouts = [
    'accentCallout1',
    'accentCallout2',
    'accentCallout3',
    'accentBorderCallout1',
    'accentBorderCallout2',
    'accentBorderCallout3',
  ];
  const cloudCallouts = ['cloud', 'cloudCallout'];

  const allCallouts = [...wedgeCallouts, ...borderCallouts, ...accentCallouts, ...cloudCallouts];

  it('should register all callout shapes', () => {
    for (const shape of allCallouts) {
      expect(isValidShapeType(shape)).toBe(true);
    }
  });

  describe.each(allCallouts)('%s', (shapeType) => {
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
  });

  describe('wedge callouts', () => {
    it('wedgeRectCallout should generate a non-empty path', () => {
      const path = generateShapePath('wedgeRectCallout', 100, 80);
      expect(path.segments.length).toBeGreaterThan(0);
    });

    it('wedgeRoundRectCallout should have curves for rounded corners', () => {
      const path = generateShapePath('wedgeRoundRectCallout', 100, 80);
      const hasCurves = path.segments.some((s) => s.type === 'C');
      expect(hasCurves).toBe(true);
    });

    it('wedgeEllipseCallout should have curves for ellipse body', () => {
      const path = generateShapePath('wedgeEllipseCallout', 100, 80);
      const hasCurves = path.segments.some((s) => s.type === 'C');
      expect(hasCurves).toBe(true);
    });
  });

  describe('cloud callout', () => {
    it('cloud should generate a curved path with at least one closed subpath', () => {
      const path = generateShapePath('cloud', 100, 80);
      const hasCurves = path.segments.some((s) => s.type === 'C');
      expect(hasCurves).toBe(true);
      // The OOXML spec cloud has multiple paths; at least the main body is closed
      const hasClose = path.segments.some((s) => s.type === 'Z');
      expect(hasClose).toBe(true);
    });

    it('cloudCallout should have multiple subpaths (body + thought bubbles)', () => {
      const path = generateShapePath('cloudCallout', 100, 80);
      const closePaths = path.segments.filter((s) => s.type === 'Z');
      expect(closePaths.length).toBeGreaterThan(1);
    });
  });
});
