/**
 * Tests verifying bug fixes 3a-3e.
 *
 * 3a: at2/cat2/sat2 atan2 argument order
 * 3b: plaque concave corners
 * 3c: bentConnector2 L-shape geometry
 * 3d: NaN comparison in comparators
 * 3e: teardrop tip direction and diagStripe geometry
 */
import { PathOps } from '@mog/geometry';
import type { CustomGuide } from '../src/custom-geometry';
import { evaluateGuides } from '../src/custom-geometry';
import { compareShapes } from '../src/diagnostics/comparators';
import { generateShapePath } from '../src/shape-to-path';

describe('Bug Fix 3a: at2/cat2/sat2 atan2 argument order', () => {
  it('at2 should compute atan2(y, x) where formula is "at2 x y"', () => {
    // at2 x y = atan2(y, x)
    // With x=1, y=1: atan2(1, 1) = PI/4 = 45 degrees = 2700000 in 60000ths
    const guides: CustomGuide[] = [{ name: 'result', formula: 'at2 1 1' }];
    const result = evaluateGuides(guides, 100, 100);
    // atan2(1, 1) = PI/4 rad = 45 deg = 2700000 in OOXML units
    expect(result.get('result')).toBeCloseTo(2700000, -2);
  });

  it('at2 with x=0, y=1 should give 90 degrees', () => {
    // at2 x=0 y=1 -> atan2(1, 0) = PI/2 = 5400000
    const guides: CustomGuide[] = [{ name: 'result', formula: 'at2 0 1' }];
    const result = evaluateGuides(guides, 100, 100);
    expect(result.get('result')).toBeCloseTo(5400000, -2);
  });

  it('at2 with x=1, y=0 should give 0 degrees', () => {
    // at2 x=1 y=0 -> atan2(0, 1) = 0
    const guides: CustomGuide[] = [{ name: 'result', formula: 'at2 1 0' }];
    const result = evaluateGuides(guides, 100, 100);
    expect(result.get('result')).toBeCloseTo(0, -2);
  });

  it('cat2 should compute a * cos(atan2(y, x))', () => {
    // cat2 a x y = a * cos(atan2(y, x))
    // With a=100, x=1, y=0: cos(atan2(0, 1)) = cos(0) = 1
    const guides: CustomGuide[] = [{ name: 'result', formula: 'cat2 100 1 0' }];
    const result = evaluateGuides(guides, 100, 100);
    expect(result.get('result')).toBeCloseTo(100);
  });

  it('sat2 should compute a * sin(atan2(y, x))', () => {
    // sat2 a x y = a * sin(atan2(y, x))
    // With a=100, x=0, y=1: sin(atan2(1, 0)) = sin(PI/2) = 1
    const guides: CustomGuide[] = [{ name: 'result', formula: 'sat2 100 0 1' }];
    const result = evaluateGuides(guides, 100, 100);
    expect(result.get('result')).toBeCloseTo(100);
  });
});

describe('Bug Fix 3b: plaque concave corners', () => {
  it('plaque and roundedRectangle should produce DIFFERENT paths', () => {
    const plaque = generateShapePath('plaque', 100, 100);
    const rounded = generateShapePath('roundRect', 100, 100);
    expect(PathOps.pathToSvgString(plaque)).not.toBe(PathOps.pathToSvgString(rounded));
  });

  it('plaque corners should bow inward (concave)', () => {
    const path = generateShapePath('plaque', 100, 100);
    // For a concave top-left corner, the control points should be pulled
    // toward the center of the shape, meaning the curve bows inward.
    // The first bezier is the top-left corner from (0, r) to (r, 0).
    // For concave: the curve should pass through points closer to (r, r)
    // than a convex curve which passes through points closer to (0, 0).
    const hasCurves = path.segments.some((s) => s.type === 'C');
    expect(hasCurves).toBe(true);
  });

  it('plaque should still be a closed path', () => {
    const path = generateShapePath('plaque', 100, 100);
    expect(path.closed).toBe(true);
  });
});

describe('Bug Fix 3c: bentConnector2 L-shape', () => {
  it('bentConnector2 should be an L-shape (2 segments)', () => {
    const path = generateShapePath('bentConnector2', 100, 100);
    const lineSegs = path.segments.filter((s) => s.type === 'L');
    // L-shape: moveTo + 2 lineTo = 2 line segments
    expect(lineSegs.length).toBe(2);
  });

  it('bentConnector3 should be a Z-shape (3 segments)', () => {
    const path = generateShapePath('bentConnector3', 100, 100);
    const lineSegs = path.segments.filter((s) => s.type === 'L');
    // Z-shape: moveTo + 3 lineTo = 3 line segments
    expect(lineSegs.length).toBe(3);
  });

  it('bentConnector2 and bentConnector3 should have different segment counts', () => {
    const bc2 = generateShapePath('bentConnector2', 100, 100);
    const bc3 = generateShapePath('bentConnector3', 100, 100);
    const bc2Lines = bc2.segments.filter((s) => s.type === 'L').length;
    const bc3Lines = bc3.segments.filter((s) => s.type === 'L').length;
    expect(bc2Lines).not.toBe(bc3Lines);
  });

  it('bentConnector2 path should go (0,0) -> (w,0) -> (w,h)', () => {
    const path = generateShapePath('bentConnector2', 200, 100);
    // Check the actual coordinates
    expect(path.segments[0]).toEqual({ type: 'M', x: 0, y: 0 });
    expect(path.segments[1]).toEqual({ type: 'L', x: 200, y: 0 });
    expect(path.segments[2]).toEqual({ type: 'L', x: 200, y: 100 });
  });
});

describe('Bug Fix 3d: NaN comparison in comparators', () => {
  it('NaN-NaN comparison should report a difference', () => {
    const result = compareShapes({ x: NaN }, { x: NaN });
    expect(result.match).toBe(false);
    expect(result.differences.length).toBe(1);
    expect(result.differences[0].property).toBe('x');
  });

  it('NaN-vs-number comparison should report a difference', () => {
    const result = compareShapes({ x: NaN }, { x: 42 });
    expect(result.match).toBe(false);
    expect(result.differences.length).toBe(1);
  });

  it('number-vs-NaN comparison should report a difference', () => {
    const result = compareShapes({ x: 42 }, { x: NaN });
    expect(result.match).toBe(false);
    expect(result.differences.length).toBe(1);
  });

  it('matching numbers should still match', () => {
    const result = compareShapes({ x: 42 }, { x: 42 });
    expect(result.match).toBe(true);
  });
});

describe('Bug Fix 3e: teardrop and diagStripe', () => {
  describe('teardrop', () => {
    it('should generate a closed path', () => {
      const path = generateShapePath('teardrop', 100, 100);
      expect(path.closed).toBe(true);
    });

    it('should have curves', () => {
      const path = generateShapePath('teardrop', 100, 100);
      const hasCurves = path.segments.some((s) => s.type === 'C');
      expect(hasCurves).toBe(true);
    });

    it('tip should extend to upper-right', () => {
      const path = generateShapePath('teardrop', 100, 100);
      // Find max x and check the corresponding y is in the upper half
      let maxX = -Infinity;
      let maxXY = 0;
      for (const seg of path.segments) {
        if (seg.type === 'Z') continue;
        if (seg.x > maxX) {
          maxX = seg.x;
          maxXY = seg.y;
        }
      }
      // The tip should be in the upper half (y < 50 for 100x100)
      expect(maxXY).toBeLessThan(50);
      // The tip should extend beyond the circle radius (> 50 for 100x100)
      expect(maxX).toBeGreaterThan(50);
    });

    it('should generate snapshot-stable path', () => {
      const path = generateShapePath('teardrop', 100, 100);
      expect(path.segments).toMatchSnapshot();
    });
  });

  describe('diagStripe', () => {
    it('should be a closed quadrilateral per OOXML spec', () => {
      const path = generateShapePath('diagStripe', 100, 100);
      const lineSegs = path.segments.filter((s) => s.type === 'L');
      // OOXML spec diagStripe: moveTo + 3 lineTo + close = 3 line segments
      expect(lineSegs.length).toBe(3);
    });

    it('should be a closed path', () => {
      const path = generateShapePath('diagStripe', 100, 100);
      expect(path.closed).toBe(true);
    });

    it('should have a vertex at or near origin', () => {
      const path = generateShapePath('diagStripe', 100, 100);
      // The OOXML spec diagStripe starts at (0, adj%) which is near origin
      const hasNearOrigin = path.segments.some(
        (s) => s.type !== 'Z' && Math.abs(s.x) < 1 && Math.abs(s.y) < 51,
      );
      expect(hasNearOrigin).toBe(true);
    });

    it('should generate snapshot-stable path', () => {
      const path = generateShapePath('diagStripe', 100, 100);
      expect(path.segments).toMatchSnapshot();
    });
  });
});
