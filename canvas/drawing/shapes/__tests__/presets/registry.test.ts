/**
 * Tests for the shape preset registry.
 * Verifies ALL registered presets produce valid, non-degenerate paths.
 */
import type { Path } from '@mog-sdk/contracts/geometry';
import {
  generateShapePath,
  getRegisteredShapeTypes,
  isValidShapeType,
} from '../../src/shape-to-path';

function isPathNonDegenerate(path: Path): boolean {
  // Must have at least one non-close segment
  const nonClose = path.segments.filter((s) => s.type !== 'Z');
  return nonClose.length > 0;
}

function pathHasNoNaN(path: Path): boolean {
  for (const seg of path.segments) {
    if (seg.type === 'Z') continue;
    if (isNaN(seg.x) || isNaN(seg.y)) return false;
    if (seg.type === 'C' && (isNaN(seg.x1) || isNaN(seg.y1) || isNaN(seg.x2) || isNaN(seg.y2)))
      return false;
    if (seg.type === 'Q' && (isNaN(seg.x1) || isNaN(seg.y1))) return false;
  }
  return true;
}

describe('Shape Preset Registry', () => {
  const allTypes = getRegisteredShapeTypes();

  it('should have at least 150 presets registered', () => {
    expect(allTypes.length).toBeGreaterThanOrEqual(150);
  });

  describe.each(allTypes)('preset "%s"', (shapeType) => {
    it('should be recognized as a valid shape type', () => {
      expect(isValidShapeType(shapeType)).toBe(true);
    });

    it('should generate a non-degenerate path at 100x100', () => {
      const path = generateShapePath(shapeType, 100, 100);
      expect(isPathNonDegenerate(path)).toBe(true);
    });

    it('should generate a path with no NaN coordinates at 100x100', () => {
      const path = generateShapePath(shapeType, 100, 100);
      expect(pathHasNoNaN(path)).toBe(true);
    });

    it('should generate a valid path at 200x50 (non-square)', () => {
      const path = generateShapePath(shapeType, 200, 50);
      expect(isPathNonDegenerate(path)).toBe(true);
      expect(pathHasNoNaN(path)).toBe(true);
    });

    it('should produce a snapshot-stable path at 100x100', () => {
      const path = generateShapePath(shapeType, 100, 100);
      expect(path.segments).toMatchSnapshot();
    });
  });
});

describe('Registry lookup', () => {
  it('should return false for unknown shape types', () => {
    expect(isValidShapeType('nonExistentShape')).toBe(false);
    expect(isValidShapeType('')).toBe(false);
  });

  it('should throw when generating unknown shape type', () => {
    expect(() => generateShapePath('nonExistentShape', 100, 100)).toThrow();
  });
});
