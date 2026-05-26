import type { Point2D } from '@mog-sdk/contracts/geometry';
import {
  cubicBoundingBox,
  cubicLength,
  evaluateCubic,
  evaluateQuadratic,
  nearestPointOnCubic,
  nearestPointOnQuadratic,
  quadraticBoundingBox,
  quadraticLength,
  quadraticToCubic,
  splitCubicAt,
  splitQuadraticAt,
} from '../src/bezier';

describe('Bezier operations', () => {
  // Some standard test curves
  const p0: Point2D = { x: 0, y: 0 };
  const p1: Point2D = { x: 0, y: 100 };
  const p2: Point2D = { x: 100, y: 100 };
  const p3: Point2D = { x: 100, y: 0 };

  // ─── Cubic Evaluation ────────────────────────────────────────────────

  test('evaluateCubic at t=0 returns p0', () => {
    const result = evaluateCubic(0, p0, p1, p2, p3);
    expect(result.x).toBeCloseTo(0, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  test('evaluateCubic at t=1 returns p3', () => {
    const result = evaluateCubic(1, p0, p1, p2, p3);
    expect(result.x).toBeCloseTo(100, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  test('evaluateCubic at t=0.5 is between endpoints', () => {
    const result = evaluateCubic(0.5, p0, p1, p2, p3);
    expect(result.x).toBeGreaterThan(0);
    expect(result.x).toBeLessThan(100);
  });

  test('evaluateCubic of a straight line', () => {
    // Control points on the line from (0,0) to (10,10)
    const cp0 = { x: 0, y: 0 };
    const cp1 = { x: 3.33, y: 3.33 };
    const cp2 = { x: 6.67, y: 6.67 };
    const cp3 = { x: 10, y: 10 };
    const mid = evaluateCubic(0.5, cp0, cp1, cp2, cp3);
    expect(mid.x).toBeCloseTo(5, 1);
    expect(mid.y).toBeCloseTo(5, 1);
  });

  // ─── Quadratic Evaluation ────────────────────────────────────────────

  test('evaluateQuadratic at t=0 returns p0', () => {
    const result = evaluateQuadratic(0, { x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 });
    expect(result.x).toBeCloseTo(0, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  test('evaluateQuadratic at t=1 returns p2', () => {
    const result = evaluateQuadratic(1, { x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 });
    expect(result.x).toBeCloseTo(100, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  test('evaluateQuadratic at t=0.5', () => {
    const result = evaluateQuadratic(0.5, { x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 });
    expect(result.x).toBeCloseTo(50, 10);
    expect(result.y).toBeCloseTo(50, 10);
  });

  // ─── Cubic Split ─────────────────────────────────────────────────────

  test('splitCubicAt t=0.5 produces two curves that share midpoint', () => {
    const [left, right] = splitCubicAt(0.5, p0, p1, p2, p3);

    // Left curve starts at p0
    expect(left.p0.x).toBeCloseTo(p0.x, 10);
    expect(left.p0.y).toBeCloseTo(p0.y, 10);

    // Right curve ends at p3
    expect(right.p3.x).toBeCloseTo(p3.x, 10);
    expect(right.p3.y).toBeCloseTo(p3.y, 10);

    // They share the midpoint
    expect(left.p3.x).toBeCloseTo(right.p0.x, 10);
    expect(left.p3.y).toBeCloseTo(right.p0.y, 10);
  });

  test('splitCubicAt t=0 left curve is degenerate', () => {
    const [left, right] = splitCubicAt(0, p0, p1, p2, p3);
    expect(left.p0.x).toBeCloseTo(p0.x, 10);
    expect(left.p3.x).toBeCloseTo(p0.x, 10);
  });

  test('splitCubicAt preserves curve shape', () => {
    // Evaluating left half at t=0.5 should equal original at t=0.25
    const [left] = splitCubicAt(0.5, p0, p1, p2, p3);
    const splitPoint = evaluateCubic(0.5, left.p0, left.p1, left.p2, left.p3);
    const origPoint = evaluateCubic(0.25, p0, p1, p2, p3);
    expect(splitPoint.x).toBeCloseTo(origPoint.x, 5);
    expect(splitPoint.y).toBeCloseTo(origPoint.y, 5);
  });

  // ─── Quadratic Split ─────────────────────────────────────────────────

  test('splitQuadraticAt t=0.5 produces two curves sharing midpoint', () => {
    const qp0 = { x: 0, y: 0 };
    const qp1 = { x: 50, y: 100 };
    const qp2 = { x: 100, y: 0 };
    const [left, right] = splitQuadraticAt(0.5, qp0, qp1, qp2);

    expect(left.p0.x).toBeCloseTo(qp0.x, 10);
    expect(right.p2.x).toBeCloseTo(qp2.x, 10);
    expect(left.p2.x).toBeCloseTo(right.p0.x, 10);
  });

  // ─── Cubic Bounding Box ──────────────────────────────────────────────

  test('cubicBoundingBox contains endpoints', () => {
    const box = cubicBoundingBox(p0, p1, p2, p3);
    expect(box.x).toBeLessThanOrEqual(0);
    expect(box.y).toBeLessThanOrEqual(0);
    expect(box.x + box.width).toBeGreaterThanOrEqual(100);
  });

  test('cubicBoundingBox of straight line', () => {
    const box = cubicBoundingBox(
      { x: 0, y: 0 },
      { x: 33, y: 33 },
      { x: 67, y: 67 },
      { x: 100, y: 100 },
    );
    expect(box.x).toBeCloseTo(0, 5);
    expect(box.y).toBeCloseTo(0, 5);
    expect(box.width).toBeCloseTo(100, 5);
    expect(box.height).toBeCloseTo(100, 5);
  });

  test('cubicBoundingBox includes extrema beyond endpoints', () => {
    // S-shaped curve: control points push the curve well beyond endpoints
    // p0=(0,50), p1=(0,200), p2=(100,-100), p3=(100,50)
    // Both endpoints have y=50, but control points push the curve above 50 and below 50
    const box = cubicBoundingBox(
      { x: 0, y: 50 },
      { x: 0, y: 200 },
      { x: 100, y: -100 },
      { x: 100, y: 50 },
    );
    // The curve should extend above y=50 and below y=50
    expect(box.y).toBeLessThan(50);
    expect(box.y + box.height).toBeGreaterThan(50);
  });

  // ─── Quadratic Bounding Box ──────────────────────────────────────────

  test('quadraticBoundingBox of arch', () => {
    const box = quadraticBoundingBox({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 });
    expect(box.x).toBeCloseTo(0, 5);
    expect(box.y).toBeCloseTo(0, 5);
    expect(box.width).toBeCloseTo(100, 5);
    // Peak is at y=50 (quadratic midpoint for symmetric arch)
    expect(box.y + box.height).toBeCloseTo(50, 5);
  });

  test('quadraticBoundingBox contains endpoints', () => {
    const box = quadraticBoundingBox({ x: 10, y: 20 }, { x: 50, y: 80 }, { x: 90, y: 30 });
    expect(box.x).toBeLessThanOrEqual(10);
    expect(box.y).toBeLessThanOrEqual(20);
    expect(box.x + box.width).toBeGreaterThanOrEqual(90);
    expect(box.y + box.height).toBeGreaterThanOrEqual(30);
  });

  // ─── Arc Length ──────────────────────────────────────────────────────

  test('cubicLength of straight line equals Euclidean distance', () => {
    const len = cubicLength(
      { x: 0, y: 0 },
      { x: 33.33, y: 0 },
      { x: 66.67, y: 0 },
      { x: 100, y: 0 },
    );
    expect(len).toBeCloseTo(100, 0);
  });

  test('cubicLength is positive', () => {
    const len = cubicLength(p0, p1, p2, p3);
    expect(len).toBeGreaterThan(0);
  });

  test('cubicLength of degenerate curve (all same point) is ~0', () => {
    const pt = { x: 5, y: 5 };
    const len = cubicLength(pt, pt, pt, pt);
    expect(len).toBeCloseTo(0, 5);
  });

  test('quadraticLength of straight line equals Euclidean distance', () => {
    const len = quadraticLength({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 });
    expect(len).toBeCloseTo(100, 0);
  });

  test('quadraticLength is positive for non-degenerate curve', () => {
    const len = quadraticLength({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 });
    expect(len).toBeGreaterThan(0);
  });

  // ─── Nearest Point ───────────────────────────────────────────────────

  test('nearestPointOnCubic at endpoint', () => {
    const result = nearestPointOnCubic(p0, p0, p1, p2, p3);
    expect(result.distance).toBeCloseTo(0, 5);
    expect(result.t).toBeCloseTo(0, 1);
  });

  test('nearestPointOnCubic at other endpoint', () => {
    const result = nearestPointOnCubic(p3, p0, p1, p2, p3);
    expect(result.distance).toBeCloseTo(0, 5);
    expect(result.t).toBeCloseTo(1, 1);
  });

  test('nearestPointOnCubic distance is always >= 0', () => {
    const result = nearestPointOnCubic({ x: 200, y: 200 }, p0, p1, p2, p3);
    expect(result.distance).toBeGreaterThanOrEqual(0);
  });

  test('nearestPointOnCubic point lies on curve', () => {
    const testPoint = { x: 50, y: 80 };
    const result = nearestPointOnCubic(testPoint, p0, p1, p2, p3);
    // The returned point should be at parameter t on the curve
    const curvePoint = evaluateCubic(result.t, p0, p1, p2, p3);
    expect(result.point.x).toBeCloseTo(curvePoint.x, 3);
    expect(result.point.y).toBeCloseTo(curvePoint.y, 3);
  });

  test('nearestPointOnQuadratic at endpoint', () => {
    const qp0 = { x: 0, y: 0 };
    const qp1 = { x: 50, y: 100 };
    const qp2 = { x: 100, y: 0 };
    const result = nearestPointOnQuadratic(qp0, qp0, qp1, qp2);
    expect(result.distance).toBeCloseTo(0, 5);
  });

  // ─── Quadratic to Cubic Conversion ───────────────────────────────────

  test('quadraticToCubic preserves endpoints', () => {
    const qp0 = { x: 0, y: 0 };
    const qp1 = { x: 50, y: 100 };
    const qp2 = { x: 100, y: 0 };
    const cubic = quadraticToCubic(qp0, qp1, qp2);
    expect(cubic.p0).toEqual(qp0);
    expect(cubic.p3).toEqual(qp2);
  });

  test('quadraticToCubic produces equivalent curve', () => {
    const qp0 = { x: 0, y: 0 };
    const qp1 = { x: 50, y: 100 };
    const qp2 = { x: 100, y: 0 };
    const cubic = quadraticToCubic(qp0, qp1, qp2);

    // Test at several t values
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const qPoint = evaluateQuadratic(t, qp0, qp1, qp2);
      const cPoint = evaluateCubic(t, cubic.p0, cubic.p1, cubic.p2, cubic.p3);
      expect(cPoint.x).toBeCloseTo(qPoint.x, 8);
      expect(cPoint.y).toBeCloseTo(qPoint.y, 8);
    }
  });

  test('quadraticToCubic straight line stays straight', () => {
    const cubic = quadraticToCubic({ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 });
    // All control points should be on the line y=x
    expect(cubic.p1.y).toBeCloseTo(cubic.p1.x, 8);
    expect(cubic.p2.y).toBeCloseTo(cubic.p2.x, 8);
  });

  // ─── Snapshot tests for split operations ─────────────────────────────

  test('splitCubicAt t=0.5 snapshot', () => {
    const [left, right] = splitCubicAt(0.5, p0, p1, p2, p3);
    expect(left).toMatchSnapshot();
    expect(right).toMatchSnapshot();
  });

  test('splitCubicAt t=0.25 snapshot', () => {
    const [left, right] = splitCubicAt(0.25, p0, p1, p2, p3);
    expect(left).toMatchSnapshot();
    expect(right).toMatchSnapshot();
  });

  test('splitQuadraticAt t=0.5 snapshot', () => {
    const qp0 = { x: 0, y: 0 };
    const qp1 = { x: 50, y: 100 };
    const qp2 = { x: 100, y: 0 };
    const [left, right] = splitQuadraticAt(0.5, qp0, qp1, qp2);
    expect(left).toMatchSnapshot();
    expect(right).toMatchSnapshot();
  });
});
