import type { StrokeId } from '@mog-sdk/contracts/ink';
import type { Stroke, StrokePoint } from '../src/stroke';
import {
  createStroke,
  simplifyStroke,
  smoothStroke,
  strokeBoundingBox,
  strokeToPath,
  strokeToPolyline,
} from '../src/stroke';

// =============================================================================
// Helpers
// =============================================================================

/** Cast a plain string to StrokeId for testing. */
const testId = (id: string) => id as StrokeId;

function makePoints(coords: [number, number][], pressure = 0.5): StrokePoint[] {
  return coords.map(([x, y], i) => ({
    x,
    y,
    pressure,
    timestamp: i * 10,
  }));
}

function makeLine(
  start: [number, number],
  end: [number, number],
  n: number,
  pressure = 0.5,
): StrokePoint[] {
  const pts: StrokePoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    pts.push({
      x: start[0] + t * (end[0] - start[0]),
      y: start[1] + t * (end[1] - start[1]),
      pressure,
      timestamp: i * 10,
    });
  }
  return pts;
}

// =============================================================================
// strokeBoundingBox
// =============================================================================

describe('strokeBoundingBox', () => {
  test('returns zero-size box for empty points', () => {
    const box = strokeBoundingBox([], 2);
    expect(box).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  test('computes bounds for a single point', () => {
    const pts = makePoints([[10, 20]]);
    const box = strokeBoundingBox(pts, 4);
    expect(box.x).toBe(8); // 10 - 2
    expect(box.y).toBe(18); // 20 - 2
    expect(box.width).toBe(4);
    expect(box.height).toBe(4);
  });

  test('computes bounds for multiple points', () => {
    const pts = makePoints([
      [0, 0],
      [100, 50],
      [50, 80],
    ]);
    const box = strokeBoundingBox(pts, 10);
    expect(box.x).toBe(-5); // 0 - 5
    expect(box.y).toBe(-5); // 0 - 5
    expect(box.width).toBe(110); // 100 + 10
    expect(box.height).toBe(90); // 80 + 10
  });

  test('handles negative coordinates', () => {
    const pts = makePoints([
      [-10, -20],
      [10, 20],
    ]);
    const box = strokeBoundingBox(pts, 0);
    expect(box.x).toBe(-10);
    expect(box.y).toBe(-20);
    expect(box.width).toBe(20);
    expect(box.height).toBe(40);
  });
});

// =============================================================================
// createStroke
// =============================================================================

describe('createStroke', () => {
  test('creates stroke with correct properties', () => {
    const pts = makePoints([
      [0, 0],
      [10, 10],
    ]);
    const stroke = createStroke(pts, { color: '#ff0000', width: 3, id: testId('test-1') });
    expect(stroke.color).toBe('#ff0000');
    expect(stroke.width).toBe(3);
    expect(stroke.opacity).toBe(1);
    expect(stroke.points).toHaveLength(2);
    expect(stroke.id).toBeTruthy();
  });

  test('creates stroke with custom id and opacity', () => {
    const pts = makePoints([[5, 5]]);
    const stroke = createStroke(pts, {
      color: 'blue',
      width: 2,
      opacity: 0.5,
      id: testId('custom-id'),
    });
    expect(stroke.id).toBe('custom-id');
    expect(stroke.opacity).toBe(0.5);
  });

  test('copies points (not reference)', () => {
    const pts: { x: number; y: number; pressure: number; timestamp: number }[] = [
      { x: 1, y: 2, pressure: 0.5, timestamp: 0 },
    ];
    const stroke = createStroke(pts, { color: '#000', width: 1, id: testId('test-copy') });
    pts[0].x = 999;
    expect(stroke.points[0].x).toBe(1);
  });

  test('computes bounds correctly', () => {
    const pts = makePoints([
      [0, 0],
      [100, 100],
    ]);
    const stroke = createStroke(pts, { color: '#000', width: 10, id: testId('test-4') });
    expect(stroke.bounds.x).toBe(-5);
    expect(stroke.bounds.y).toBe(-5);
    expect(stroke.bounds.width).toBe(110);
    expect(stroke.bounds.height).toBe(110);
  });
});

// =============================================================================
// smoothStroke
// =============================================================================

describe('smoothStroke', () => {
  test('returns copy of empty array', () => {
    const result = smoothStroke([]);
    expect(result).toEqual([]);
  });

  test('returns copy of single point', () => {
    const pts = makePoints([[5, 10]]);
    const result = smoothStroke(pts);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(5);
  });

  test('returns copy of two points', () => {
    const pts = makePoints([
      [0, 0],
      [10, 10],
    ]);
    const result = smoothStroke(pts);
    expect(result).toHaveLength(2);
  });

  test('preserves first and last points', () => {
    const pts = makePoints([
      [0, 0],
      [10, 50],
      [20, 0],
      [30, 50],
      [40, 0],
    ]);
    const result = smoothStroke(pts, 1);
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
    expect(result[result.length - 1].x).toBe(40);
    expect(result[result.length - 1].y).toBe(0);
  });

  test('reduces jitter in middle points', () => {
    // Create a jagged line (zigzag around y=50)
    const pts: StrokePoint[] = [];
    for (let i = 0; i < 20; i++) {
      pts.push({
        x: i * 5,
        y: 50 + (i % 2 === 0 ? 10 : -10),
        pressure: 0.5,
        timestamp: i * 10,
      });
    }

    const smoothed = smoothStroke(pts, 3);

    // The smoothed version should have less y-variation in the middle
    const originalVariance = computeVariance(pts.slice(3, -3).map((p) => p.y));
    const smoothedVariance = computeVariance(smoothed.slice(3, -3).map((p) => p.y));

    expect(smoothedVariance).toBeLessThan(originalVariance);
  });

  test('preserves timestamps', () => {
    const pts = makePoints([
      [0, 0],
      [10, 10],
      [20, 20],
      [30, 30],
      [40, 40],
    ]);
    const result = smoothStroke(pts, 1);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].timestamp).toBe(pts[i].timestamp);
    }
  });

  test('same length output as input', () => {
    const pts = makePoints([
      [0, 0],
      [10, 10],
      [20, 20],
      [30, 30],
    ]);
    const result = smoothStroke(pts, 2);
    expect(result).toHaveLength(pts.length);
  });

  test('handles factor < 1 by clamping to 1', () => {
    const pts = makePoints([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
    const result = smoothStroke(pts, -5);
    expect(result).toHaveLength(3);
  });
});

function computeVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

// =============================================================================
// simplifyStroke (Ramer-Douglas-Peucker)
// =============================================================================

describe('simplifyStroke', () => {
  test('returns copy of empty array', () => {
    const result = simplifyStroke([]);
    expect(result).toEqual([]);
  });

  test('returns copy of single point', () => {
    const pts = makePoints([[5, 10]]);
    const result = simplifyStroke(pts);
    expect(result).toHaveLength(1);
  });

  test('returns copy of two points', () => {
    const pts = makePoints([
      [0, 0],
      [10, 10],
    ]);
    const result = simplifyStroke(pts);
    expect(result).toHaveLength(2);
  });

  test('preserves collinear points within tolerance', () => {
    // All points on a line: should simplify to just endpoints
    const pts = makeLine([0, 0], [100, 0], 50);
    const result = simplifyStroke(pts, 0.1);
    expect(result).toHaveLength(2);
    expect(result[0].x).toBe(0);
    expect(result[result.length - 1].x).toBe(100);
  });

  test('keeps points that deviate beyond tolerance', () => {
    // Line with a spike in the middle
    const pts = makePoints([
      [0, 0],
      [25, 0],
      [50, 50],
      [75, 0],
      [100, 0],
    ]);
    const result = simplifyStroke(pts, 1);
    expect(result.length).toBeGreaterThanOrEqual(3); // At least start, spike, end
    expect(result.some((p) => p.y === 50)).toBe(true); // Spike preserved
  });

  test('reduces high-density sampling', () => {
    // 100 points along a straight line with tiny noise
    const pts: StrokePoint[] = [];
    for (let i = 0; i < 100; i++) {
      pts.push({
        x: i,
        y: Math.sin(i * 0.01) * 0.001, // tiny noise
        pressure: 0.5,
        timestamp: i,
      });
    }
    const result = simplifyStroke(pts, 0.01);
    expect(result.length).toBeLessThan(pts.length);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test('tolerance 0 returns all points', () => {
    const pts = makePoints([
      [0, 0],
      [10, 5],
      [20, 0],
    ]);
    const result = simplifyStroke(pts, 0);
    expect(result).toHaveLength(3);
  });

  test('negative tolerance returns all points', () => {
    const pts = makePoints([
      [0, 0],
      [10, 5],
      [20, 0],
    ]);
    const result = simplifyStroke(pts, -1);
    expect(result).toHaveLength(3);
  });

  test('handles L-shaped path', () => {
    const pts = makePoints([
      [0, 0],
      [50, 0],
      [100, 0],
      [100, 50],
      [100, 100],
    ]);
    const result = simplifyStroke(pts, 1);
    // Should keep at least start, corner, and end
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  test('complex curve retains shape', () => {
    // Sine wave
    const pts: StrokePoint[] = [];
    for (let i = 0; i < 200; i++) {
      pts.push({
        x: i,
        y: Math.sin(i * 0.1) * 30,
        pressure: 0.5,
        timestamp: i,
      });
    }
    const result = simplifyStroke(pts, 2);
    expect(result.length).toBeLessThan(pts.length);
    expect(result.length).toBeGreaterThan(10); // Should retain enough to represent the wave
  });
});

// =============================================================================
// strokeToPath
// =============================================================================

describe('strokeToPath', () => {
  test('returns empty path for empty stroke', () => {
    const stroke: Stroke = {
      id: testId('test-5'),
      points: [],
      color: '#000',
      width: 2,
      opacity: 1,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
    const path = strokeToPath(stroke);
    expect(path.segments).toHaveLength(0);
  });

  test('returns circle for single point', () => {
    const stroke = createStroke(makePoints([[50, 50]]), {
      color: '#000',
      width: 10,
      id: testId('sp-1'),
    });
    const path = strokeToPath(stroke);
    expect(path.closed).toBe(true);
    // Should have M, 4 C (Bezier arcs), Z = 6 segments
    expect(path.segments).toHaveLength(6);
  });

  test('returns closed path for multi-point stroke', () => {
    const pts = makePoints([
      [0, 0],
      [50, 0],
      [100, 0],
    ]);
    const stroke = createStroke(pts, { color: '#000', width: 4, id: testId('test-6') });
    const path = strokeToPath(stroke);
    expect(path.closed).toBe(true);
    // M + (n-1 left) + (n right side reversed) + Z segments
    const expectedLength = 1 + (pts.length - 1) + pts.length + 1;
    expect(path.segments).toHaveLength(expectedLength);
  });

  test('uses custom pressure mapper', () => {
    const pts: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0, timestamp: 0 },
      { x: 100, y: 0, pressure: 1, timestamp: 10 },
    ];
    const stroke = createStroke(pts, { color: '#000', width: 10, id: testId('test-7') });
    const customMapper = (p: number) => 2 + p * 8; // 2 to 10
    const path = strokeToPath(stroke, customMapper);
    expect(path.segments.length).toBeGreaterThan(0);
  });

  test('variable width from pressure data', () => {
    const pts: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0.2, timestamp: 0 },
      { x: 50, y: 0, pressure: 0.8, timestamp: 5 },
      { x: 100, y: 0, pressure: 0.2, timestamp: 10 },
    ];
    const stroke = createStroke(pts, { color: '#000', width: 10, id: testId('test-8') });
    const path = strokeToPath(stroke);
    // Path should exist and be closed
    expect(path.closed).toBe(true);
    expect(path.segments.length).toBeGreaterThan(4);
  });
});

// =============================================================================
// strokeToPolyline
// =============================================================================

describe('strokeToPolyline', () => {
  test('returns empty path for empty stroke', () => {
    const stroke: Stroke = {
      id: testId('test-9'),
      points: [],
      color: '#000',
      width: 2,
      opacity: 1,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
    const path = strokeToPolyline(stroke);
    expect(path.segments).toHaveLength(0);
    expect(path.closed).toBe(false);
  });

  test('creates correct polyline for single point', () => {
    const stroke = createStroke(makePoints([[10, 20]]), {
      color: '#000',
      width: 2,
      id: testId('st-fix'),
    });
    const path = strokeToPolyline(stroke);
    expect(path.segments).toHaveLength(1);
    expect(path.segments[0]).toEqual({ type: 'M', x: 10, y: 20 });
  });

  test('creates correct polyline for multiple points', () => {
    const pts = makePoints([
      [0, 0],
      [50, 25],
      [100, 0],
    ]);
    const stroke = createStroke(pts, { color: '#000', width: 2, id: testId('test-10') });
    const path = strokeToPolyline(stroke);
    expect(path.closed).toBe(false);
    expect(path.segments).toHaveLength(3);
    expect(path.segments[0]).toEqual({ type: 'M', x: 0, y: 0 });
    expect(path.segments[1]).toEqual({ type: 'L', x: 50, y: 25 });
    expect(path.segments[2]).toEqual({ type: 'L', x: 100, y: 0 });
  });
});

// =============================================================================
// Stroke validation
// =============================================================================

describe('createStroke - validation', () => {
  test('filters out NaN points', () => {
    const pts: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0.5, timestamp: 0 },
      { x: NaN, y: 10, pressure: 0.5, timestamp: 10 },
      { x: 20, y: 20, pressure: 0.5, timestamp: 20 },
    ];
    const stroke = createStroke(pts, { color: '#000', width: 2, id: testId('nan-filter') });
    expect(stroke.points).toHaveLength(2);
    expect(stroke.points[0].x).toBe(0);
    expect(stroke.points[1].x).toBe(20);
  });

  test('filters out Infinity points', () => {
    const pts: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0.5, timestamp: 0 },
      { x: Infinity, y: 0, pressure: 0.5, timestamp: 10 },
      { x: 10, y: 10, pressure: 0.5, timestamp: 20 },
    ];
    const stroke = createStroke(pts, { color: '#000', width: 2, id: testId('inf-filter') });
    expect(stroke.points).toHaveLength(2);
  });

  test('clamps pressure to [0, 1]', () => {
    const pts: StrokePoint[] = [
      { x: 0, y: 0, pressure: -0.5, timestamp: 0 },
      { x: 10, y: 10, pressure: 1.5, timestamp: 10 },
    ];
    const stroke = createStroke(pts, { color: '#000', width: 2, id: testId('clamp-p') });
    expect(stroke.points[0].pressure).toBe(0);
    expect(stroke.points[1].pressure).toBe(1);
  });

  test('clamps opacity to [0, 1]', () => {
    const pts = makePoints([
      [0, 0],
      [10, 10],
    ]);
    const stroke = createStroke(pts, {
      color: '#000',
      width: 2,
      opacity: 1.5,
      id: testId('clamp-o'),
    });
    expect(stroke.opacity).toBe(1);
    const stroke2 = createStroke(pts, {
      color: '#000',
      width: 2,
      opacity: -0.5,
      id: testId('clamp-o2'),
    });
    expect(stroke2.opacity).toBe(0);
  });

  test('throws on width <= 0', () => {
    const pts = makePoints([[0, 0]]);
    expect(() => createStroke(pts, { color: '#000', width: 0, id: testId('bad-w') })).toThrow();
    expect(() => createStroke(pts, { color: '#000', width: -1, id: testId('bad-w2') })).toThrow();
  });

  test('throws on empty color', () => {
    const pts = makePoints([[0, 0]]);
    expect(() => createStroke(pts, { color: '', width: 2, id: testId('bad-c') })).toThrow();
    expect(() => createStroke(pts, { color: '   ', width: 2, id: testId('bad-c2') })).toThrow();
  });

  test('throws on zero valid points after filtering', () => {
    const pts: StrokePoint[] = [{ x: NaN, y: NaN, pressure: 0.5, timestamp: 0 }];
    expect(() => createStroke(pts, { color: '#000', width: 2, id: testId('all-nan') })).toThrow();
  });
});

describe('strokeToPath - duplicate and collinear points', () => {
  test('duplicate consecutive points produce valid normals', () => {
    const pts = makePoints([
      [10, 10],
      [10, 10],
      [20, 20],
    ]);
    const stroke = createStroke(pts, { color: '#000', width: 4, id: testId('dup-pts') });
    const path = strokeToPath(stroke);
    expect(path.closed).toBe(true);
    expect(path.segments.length).toBeGreaterThan(0);
    // All coordinates should be finite
    for (const seg of path.segments) {
      if ('x' in seg) expect(Number.isFinite(seg.x)).toBe(true);
      if ('y' in seg) expect(Number.isFinite(seg.y)).toBe(true);
    }
  });

  test('all-duplicate points produce valid path', () => {
    const pts = makePoints([
      [5, 5],
      [5, 5],
      [5, 5],
    ]);
    const stroke = createStroke(pts, { color: '#000', width: 4, id: testId('all-dup') });
    const path = strokeToPath(stroke);
    expect(path.closed).toBe(true);
    for (const seg of path.segments) {
      if ('x' in seg) expect(Number.isFinite(seg.x)).toBe(true);
      if ('y' in seg) expect(Number.isFinite(seg.y)).toBe(true);
    }
  });

  test('collinear points produce valid path', () => {
    const pts = makePoints([
      [0, 0],
      [50, 0],
      [100, 0],
    ]);
    const stroke = createStroke(pts, { color: '#000', width: 4, id: testId('collinear') });
    const path = strokeToPath(stroke);
    expect(path.closed).toBe(true);
    expect(path.segments.length).toBeGreaterThan(0);
  });

  test('single-point circle uses Bezier arcs', () => {
    const pts = makePoints([[50, 50]]);
    const stroke = createStroke(pts, { color: '#000', width: 10, id: testId('circle') });
    const path = strokeToPath(stroke);
    // Should have M + 4 cubic Bezier + Z = 6 segments
    expect(path.segments).toHaveLength(6);
    expect(path.segments[0].type).toBe('M');
    expect(path.segments[1].type).toBe('C');
    expect(path.segments[2].type).toBe('C');
    expect(path.segments[3].type).toBe('C');
    expect(path.segments[4].type).toBe('C');
    expect(path.segments[5].type).toBe('Z');
  });

  test('pressure=0 produces minimum-width stroke', () => {
    const pts: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0, timestamp: 0 },
      { x: 100, y: 0, pressure: 0, timestamp: 10 },
    ];
    const stroke = createStroke(pts, { color: '#000', width: 10, id: testId('zero-p') });
    const path = strokeToPath(stroke);
    expect(path.closed).toBe(true);
    expect(path.segments.length).toBeGreaterThan(0);
  });
});

describe('smoothStroke - copy semantics', () => {
  test('returns new point objects (not references)', () => {
    const pts = makePoints([
      [0, 0],
      [10, 10],
      [20, 0],
      [30, 10],
    ]);
    const result = smoothStroke(pts, 1);
    // Modify original - should not affect result
    expect(result[0]).not.toBe(pts[0]);
    expect(result[0].x).toBe(pts[0].x);
  });

  test('rounds factor to integer', () => {
    const pts = makePoints([
      [0, 0],
      [10, 10],
      [20, 0],
      [30, 10],
      [40, 0],
    ]);
    const result1 = smoothStroke(pts, 1.4);
    const result2 = smoothStroke(pts, 1);
    // Factor 1.4 rounds to 1, so results should match
    for (let i = 0; i < result1.length; i++) {
      expect(result1[i].x).toBeCloseTo(result2[i].x, 10);
      expect(result1[i].y).toBeCloseTo(result2[i].y, 10);
    }
  });
});

describe('simplifyStroke - copy semantics', () => {
  test('returns new point objects (not references)', () => {
    const pts = makePoints([
      [0, 0],
      [50, 50],
      [100, 0],
    ]);
    const result = simplifyStroke(pts, 1);
    expect(result[0]).not.toBe(pts[0]);
    expect(result[0].x).toBe(pts[0].x);
  });
});
