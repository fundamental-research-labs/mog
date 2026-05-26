import type { Point2D } from '@mog-sdk/contracts/geometry';
import type { StrokeId } from '@mog-sdk/contracts/ink';
import {
  applyPressureProfile,
  curvePressureToWidth,
  defaultPressureToWidth,
  linearPressureToWidth,
} from '../src/pressure';
import type { Stroke, StrokePoint } from '../src/stroke';
import { createStroke } from '../src/stroke';

/** Cast a plain string to StrokeId for testing. */
const testId = (id: string) => id as StrokeId;

// =============================================================================
// Helpers
// =============================================================================

function makePoints(coords: [number, number, number][]): StrokePoint[] {
  return coords.map(([x, y, pressure], i) => ({
    x,
    y,
    pressure,
    timestamp: i * 10,
  }));
}

// =============================================================================
// defaultPressureToWidth
// =============================================================================

describe('defaultPressureToWidth', () => {
  test('full pressure gives full width', () => {
    const w = defaultPressureToWidth(1, 10);
    expect(w).toBe(10);
  });

  test('zero pressure gives minimum width (10% of base)', () => {
    const w = defaultPressureToWidth(0, 10);
    expect(w).toBe(1); // 10 * 0.1
  });

  test('half pressure gives ~70% width (sqrt curve)', () => {
    const w = defaultPressureToWidth(0.5, 10);
    expect(w).toBeCloseTo(10 * Math.sqrt(0.5), 5);
  });

  test('clamps pressure above 1', () => {
    const w = defaultPressureToWidth(2, 10);
    expect(w).toBe(10);
  });

  test('clamps pressure below 0', () => {
    const w = defaultPressureToWidth(-1, 10);
    expect(w).toBe(1); // 10 * 0.1 (min)
  });

  test('monotonically increasing with pressure', () => {
    const widths = [];
    for (let p = 0; p <= 1; p += 0.1) {
      widths.push(defaultPressureToWidth(p, 10));
    }
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
    }
  });

  test('always positive for positive base width', () => {
    for (let p = 0; p <= 1; p += 0.05) {
      expect(defaultPressureToWidth(p, 5)).toBeGreaterThan(0);
    }
  });

  test('scales with base width', () => {
    const w5 = defaultPressureToWidth(0.5, 5);
    const w10 = defaultPressureToWidth(0.5, 10);
    expect(w10 / w5).toBeCloseTo(2, 5);
  });
});

// =============================================================================
// linearPressureToWidth
// =============================================================================

describe('linearPressureToWidth', () => {
  test('pressure 0 gives min width', () => {
    expect(linearPressureToWidth(0, 2, 10)).toBe(2);
  });

  test('pressure 1 gives max width', () => {
    expect(linearPressureToWidth(1, 2, 10)).toBe(10);
  });

  test('pressure 0.5 gives midpoint', () => {
    expect(linearPressureToWidth(0.5, 2, 10)).toBe(6);
  });

  test('clamps pressure above 1', () => {
    expect(linearPressureToWidth(2, 2, 10)).toBe(10);
  });

  test('clamps pressure below 0', () => {
    expect(linearPressureToWidth(-1, 2, 10)).toBe(2);
  });

  test('linear interpolation is correct', () => {
    expect(linearPressureToWidth(0.25, 0, 100)).toBe(25);
    expect(linearPressureToWidth(0.75, 0, 100)).toBe(75);
  });

  test('works when min equals max', () => {
    expect(linearPressureToWidth(0.5, 5, 5)).toBe(5);
  });

  test('monotonically increasing', () => {
    const widths = [];
    for (let p = 0; p <= 1; p += 0.1) {
      widths.push(linearPressureToWidth(p, 1, 10));
    }
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
    }
  });
});

// =============================================================================
// curvePressureToWidth
// =============================================================================

describe('curvePressureToWidth', () => {
  // Identity curve: control points form a straight line from (0,0) to (1,1)
  const identityCurve: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 0, y: 0 },
    { x: 0.33, y: 0.33 },
    { x: 0.67, y: 0.67 },
    { x: 1, y: 1 },
  ];

  test('identity curve acts like linear mapping', () => {
    const w0 = curvePressureToWidth(0, identityCurve, 0, 10);
    const w1 = curvePressureToWidth(1, identityCurve, 0, 10);
    const w05 = curvePressureToWidth(0.5, identityCurve, 0, 10);

    expect(w0).toBeCloseTo(0, 1);
    expect(w1).toBeCloseTo(10, 1);
    expect(w05).toBeCloseTo(5, 0);
  });

  test('ease-in curve: slow start, fast end', () => {
    const easeInCurve: [Point2D, Point2D, Point2D, Point2D] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0.5 },
      { x: 1, y: 1 },
    ];

    const wMid = curvePressureToWidth(0.5, easeInCurve, 0, 10);
    // For an ease-in curve, at x=0.5 the y-value should be less than 0.5
    expect(wMid).toBeLessThan(5);
  });

  test('ease-out curve: fast start, slow end', () => {
    const easeOutCurve: [Point2D, Point2D, Point2D, Point2D] = [
      { x: 0, y: 0 },
      { x: 0, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 1, y: 1 },
    ];

    const wMid = curvePressureToWidth(0.5, easeOutCurve, 0, 10);
    // For an ease-out curve, at x=0.5 the y-value should be more than 0.5
    expect(wMid).toBeGreaterThan(5);
  });

  test('clamps pressure to [0, 1]', () => {
    const wNeg = curvePressureToWidth(-0.5, identityCurve, 2, 10);
    const wOver = curvePressureToWidth(1.5, identityCurve, 2, 10);
    expect(wNeg).toBeCloseTo(2, 0);
    expect(wOver).toBeCloseTo(10, 0);
  });

  test('endpoints are correct', () => {
    const curve: [Point2D, Point2D, Point2D, Point2D] = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.1 },
      { x: 0.75, y: 0.9 },
      { x: 1, y: 1 },
    ];
    const w0 = curvePressureToWidth(0, curve, 3, 15);
    const w1 = curvePressureToWidth(1, curve, 3, 15);
    expect(w0).toBeCloseTo(3, 0);
    expect(w1).toBeCloseTo(15, 0);
  });

  test('results are within [minWidth, maxWidth]', () => {
    const curve: [Point2D, Point2D, Point2D, Point2D] = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0.4 },
      { x: 0.8, y: 0.6 },
      { x: 1, y: 1 },
    ];
    for (let p = 0; p <= 1; p += 0.05) {
      const w = curvePressureToWidth(p, curve, 2, 8);
      expect(w).toBeGreaterThanOrEqual(2 - 0.1); // slight tolerance
      expect(w).toBeLessThanOrEqual(8 + 0.1);
    }
  });
});

// =============================================================================
// applyPressureProfile
// =============================================================================

describe('applyPressureProfile', () => {
  test('returns array of same length as points', () => {
    const pts = makePoints([
      [0, 0, 0.2],
      [10, 0, 0.5],
      [20, 0, 0.8],
    ]);
    const stroke = createStroke(
      pts.map((p) => ({ ...p })),
      { color: '#000', width: 10, id: testId('p-test') },
    );
    const widths = applyPressureProfile(stroke, (p) => p * 10);
    expect(widths).toHaveLength(3);
  });

  test('maps pressure correctly', () => {
    const pts = makePoints([
      [0, 0, 0],
      [10, 0, 0.5],
      [20, 0, 1],
    ]);
    const stroke = createStroke(
      pts.map((p) => ({ ...p })),
      { color: '#000', width: 10, id: testId('p-test') },
    );
    const widths = applyPressureProfile(stroke, (p) => p * 20);
    expect(widths[0]).toBe(0);
    expect(widths[1]).toBe(10);
    expect(widths[2]).toBe(20);
  });

  test('works with default pressure mapper', () => {
    const pts = makePoints([
      [0, 0, 0.5],
      [10, 0, 0.5],
    ]);
    const stroke = createStroke(
      pts.map((p) => ({ ...p })),
      { color: '#000', width: 10, id: testId('p-test') },
    );
    const widths = applyPressureProfile(stroke, (p) => defaultPressureToWidth(p, 10));
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBeCloseTo(widths[1], 5);
  });

  test('empty stroke returns empty array', () => {
    const stroke: Stroke = {
      id: testId('p-empty'),
      points: [],
      color: '#000',
      width: 10,
      opacity: 1,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
    const widths = applyPressureProfile(stroke, (p) => p * 10);
    expect(widths).toHaveLength(0);
  });

  test('custom mapper applied to each point', () => {
    const pts = makePoints([
      [0, 0, 0.1],
      [10, 0, 0.3],
      [20, 0, 0.7],
      [30, 0, 0.9],
    ]);
    const stroke = createStroke(
      pts.map((p) => ({ ...p })),
      { color: '#000', width: 5, id: testId('p-test2') },
    );
    const mapper = (p: number) => 2 + p * 8;
    const widths = applyPressureProfile(stroke, mapper);

    expect(widths[0]).toBeCloseTo(2.8, 5);
    expect(widths[1]).toBeCloseTo(4.4, 5);
    expect(widths[2]).toBeCloseTo(7.6, 5);
    expect(widths[3]).toBeCloseTo(9.2, 5);
  });
});

// =============================================================================
// Additional pressure.test.ts tests (5ab)
// =============================================================================

describe('curvePressureToWidth - edge cases', () => {
  test('NaN pressure produces NaN result (not silently wrong)', () => {
    const curve: [Point2D, Point2D, Point2D, Point2D] = [
      { x: 0, y: 0 },
      { x: 0.33, y: 0.33 },
      { x: 0.67, y: 0.67 },
      { x: 1, y: 1 },
    ];
    const w = curvePressureToWidth(NaN, curve, 0, 10);
    // NaN propagates through Math.max/Math.min, giving a NaN result
    // This is acceptable: callers should validate pressure before mapping
    expect(Number.isNaN(w)).toBe(true);
  });

  test('non-monotonic curve uses bisection fallback', () => {
    // Curve where x goes backward: not monotonic in x
    const nonMonotonicCurve: [Point2D, Point2D, Point2D, Point2D] = [
      { x: 0, y: 0 },
      { x: 0.9, y: 0.1 },
      { x: 0.1, y: 0.9 },
      { x: 1, y: 1 },
    ];
    // Should still produce reasonable results via bisection
    const w0 = curvePressureToWidth(0, nonMonotonicCurve, 0, 10);
    const w1 = curvePressureToWidth(1, nonMonotonicCurve, 0, 10);
    expect(w0).toBeCloseTo(0, 0);
    expect(w1).toBeCloseTo(10, 0);
  });

  test('degenerate curve (all control points at same x)', () => {
    const degenerateCurve: [Point2D, Point2D, Point2D, Point2D] = [
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.33 },
      { x: 0.5, y: 0.67 },
      { x: 0.5, y: 1 },
    ];
    // Should not crash
    const w = curvePressureToWidth(0.5, degenerateCurve, 0, 10);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThanOrEqual(10);
  });

  test('results strictly within [minWidth, maxWidth] for identity curve', () => {
    const identityCurve: [Point2D, Point2D, Point2D, Point2D] = [
      { x: 0, y: 0 },
      { x: 0.33, y: 0.33 },
      { x: 0.67, y: 0.67 },
      { x: 1, y: 1 },
    ];
    for (let p = 0; p <= 1; p += 0.01) {
      const w = curvePressureToWidth(p, identityCurve, 2, 8);
      expect(w).toBeGreaterThanOrEqual(2 - 0.01);
      expect(w).toBeLessThanOrEqual(8 + 0.01);
    }
  });
});

describe('defaultPressureToWidth - edge cases', () => {
  test('NaN pressure produces NaN result', () => {
    const w = defaultPressureToWidth(NaN, 10);
    // NaN propagates through Math.max/Math.min
    expect(Number.isNaN(w)).toBe(true);
  });
});
