import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import {
  area,
  center,
  contains,
  containsPoint,
  corners,
  equals,
  expand,
  fromCorners,
  fromPoints,
  inset,
  intersection,
  isEmpty,
  overlaps,
  perimeter,
  scaleFromCenter,
  union,
} from '../src/rect';

describe('Rect (BoundingBox) operations', () => {
  // ─── fromPoints ──────────────────────────────────────────────────────

  test('fromPoints of empty array', () => {
    expect(fromPoints([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  test('fromPoints of single point', () => {
    expect(fromPoints([{ x: 5, y: 10 }])).toEqual({ x: 5, y: 10, width: 0, height: 0 });
  });

  test('fromPoints of multiple points', () => {
    const box = fromPoints([
      { x: 10, y: 20 },
      { x: 30, y: 50 },
      { x: 5, y: 15 },
    ]);
    expect(box.x).toBe(5);
    expect(box.y).toBe(15);
    expect(box.width).toBe(25);
    expect(box.height).toBe(35);
  });

  // ─── fromCorners ─────────────────────────────────────────────────────

  test('fromCorners with normal order', () => {
    const box = fromCorners({ x: 0, y: 0 }, { x: 100, y: 50 });
    expect(box).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  test('fromCorners with reversed order', () => {
    const box = fromCorners({ x: 100, y: 50 }, { x: 0, y: 0 });
    expect(box).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  // ─── Union ───────────────────────────────────────────────────────────

  test('union of overlapping boxes', () => {
    const a: BoundingBox = { x: 0, y: 0, width: 50, height: 50 };
    const b: BoundingBox = { x: 25, y: 25, width: 50, height: 50 };
    const u = union(a, b);
    expect(u).toEqual({ x: 0, y: 0, width: 75, height: 75 });
  });

  test('union of non-overlapping boxes', () => {
    const a: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
    const b: BoundingBox = { x: 100, y: 100, width: 10, height: 10 };
    const u = union(a, b);
    expect(u).toEqual({ x: 0, y: 0, width: 110, height: 110 });
  });

  test('union with itself returns same box', () => {
    const a: BoundingBox = { x: 5, y: 10, width: 20, height: 30 };
    expect(equals(union(a, a), a)).toBe(true);
  });

  // ─── Intersection ────────────────────────────────────────────────────

  test('intersection of overlapping boxes', () => {
    const a: BoundingBox = { x: 0, y: 0, width: 50, height: 50 };
    const b: BoundingBox = { x: 25, y: 25, width: 50, height: 50 };
    const result = intersection(a, b);
    expect(result).toEqual({ x: 25, y: 25, width: 25, height: 25 });
  });

  test('intersection of non-overlapping boxes is null', () => {
    const a: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
    const b: BoundingBox = { x: 100, y: 100, width: 10, height: 10 };
    expect(intersection(a, b)).toBeNull();
  });

  test('intersection of touching edges is null', () => {
    const a: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
    const b: BoundingBox = { x: 10, y: 0, width: 10, height: 10 };
    expect(intersection(a, b)).toBeNull();
  });

  test('intersection of contained box returns inner', () => {
    const outer: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    const inner: BoundingBox = { x: 25, y: 25, width: 50, height: 50 };
    const result = intersection(outer, inner);
    expect(result).toEqual(inner);
  });

  // ─── Contains ────────────────────────────────────────────────────────

  test('outer contains inner', () => {
    const outer: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    const inner: BoundingBox = { x: 10, y: 10, width: 50, height: 50 };
    expect(contains(outer, inner)).toBe(true);
  });

  test('box contains itself', () => {
    const box: BoundingBox = { x: 10, y: 10, width: 50, height: 50 };
    expect(contains(box, box)).toBe(true);
  });

  test('inner does not contain outer', () => {
    const outer: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    const inner: BoundingBox = { x: 10, y: 10, width: 50, height: 50 };
    expect(contains(inner, outer)).toBe(false);
  });

  test('partially overlapping boxes do not contain each other', () => {
    const a: BoundingBox = { x: 0, y: 0, width: 50, height: 50 };
    const b: BoundingBox = { x: 25, y: 25, width: 50, height: 50 };
    expect(contains(a, b)).toBe(false);
    expect(contains(b, a)).toBe(false);
  });

  // ─── ContainsPoint ───────────────────────────────────────────────────

  test('point inside box', () => {
    const box: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    expect(containsPoint(box, { x: 50, y: 50 })).toBe(true);
  });

  test('point outside box', () => {
    const box: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    expect(containsPoint(box, { x: 150, y: 50 })).toBe(false);
  });

  test('point on corner of box', () => {
    const box: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    expect(containsPoint(box, { x: 0, y: 0 })).toBe(true);
  });

  test('point on edge of box', () => {
    const box: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    expect(containsPoint(box, { x: 50, y: 0 })).toBe(true);
  });

  // ─── Expand ──────────────────────────────────────────────────────────

  test('expand by positive padding', () => {
    const box: BoundingBox = { x: 10, y: 10, width: 80, height: 80 };
    const expanded = expand(box, 5);
    expect(expanded).toEqual({ x: 5, y: 5, width: 90, height: 90 });
  });

  test('expand by zero is identity', () => {
    const box: BoundingBox = { x: 10, y: 10, width: 80, height: 80 };
    expect(expand(box, 0)).toEqual(box);
  });

  test('expand by negative (inset)', () => {
    const box: BoundingBox = { x: 10, y: 10, width: 80, height: 80 };
    const shrunk = expand(box, -5);
    expect(shrunk).toEqual({ x: 15, y: 15, width: 70, height: 70 });
  });

  // ─── Center ──────────────────────────────────────────────────────────

  test('center of box', () => {
    const box: BoundingBox = { x: 0, y: 0, width: 100, height: 50 };
    expect(center(box)).toEqual({ x: 50, y: 25 });
  });

  test('center of zero-size box is its position', () => {
    const box: BoundingBox = { x: 5, y: 10, width: 0, height: 0 };
    expect(center(box)).toEqual({ x: 5, y: 10 });
  });

  // ─── Area ────────────────────────────────────────────────────────────

  test('area of box', () => {
    expect(area({ x: 0, y: 0, width: 10, height: 5 })).toBe(50);
  });

  test('area of zero-width box is 0', () => {
    expect(area({ x: 0, y: 0, width: 0, height: 10 })).toBe(0);
  });

  test('area of zero-height box is 0', () => {
    expect(area({ x: 0, y: 0, width: 10, height: 0 })).toBe(0);
  });

  // ─── isEmpty ─────────────────────────────────────────────────────────

  test('zero area box is empty', () => {
    expect(isEmpty({ x: 0, y: 0, width: 0, height: 0 })).toBe(true);
  });

  test('zero width box is empty', () => {
    expect(isEmpty({ x: 0, y: 0, width: 0, height: 10 })).toBe(true);
  });

  test('non-zero area box is not empty', () => {
    expect(isEmpty({ x: 0, y: 0, width: 10, height: 10 })).toBe(false);
  });

  test('negative dimension box is empty', () => {
    expect(isEmpty({ x: 0, y: 0, width: -1, height: 10 })).toBe(true);
  });

  // ─── Equals ──────────────────────────────────────────────────────────

  test('equal boxes', () => {
    const a: BoundingBox = { x: 1, y: 2, width: 3, height: 4 };
    const b: BoundingBox = { x: 1, y: 2, width: 3, height: 4 };
    expect(equals(a, b)).toBe(true);
  });

  test('nearly equal boxes within epsilon', () => {
    const a: BoundingBox = { x: 1, y: 2, width: 3, height: 4 };
    const b: BoundingBox = { x: 1 + 1e-11, y: 2, width: 3, height: 4 };
    expect(equals(a, b)).toBe(true);
  });

  test('not equal boxes', () => {
    const a: BoundingBox = { x: 1, y: 2, width: 3, height: 4 };
    const b: BoundingBox = { x: 1, y: 2, width: 3, height: 5 };
    expect(equals(a, b)).toBe(false);
  });

  // ─── Corners ─────────────────────────────────────────────────────────

  test('corners of box', () => {
    const box: BoundingBox = { x: 10, y: 20, width: 30, height: 40 };
    const [tl, tr, br, bl] = corners(box);
    expect(tl).toEqual({ x: 10, y: 20 });
    expect(tr).toEqual({ x: 40, y: 20 });
    expect(br).toEqual({ x: 40, y: 60 });
    expect(bl).toEqual({ x: 10, y: 60 });
  });

  // ─── Overlaps ────────────────────────────────────────────────────────

  test('overlapping boxes overlap', () => {
    const a: BoundingBox = { x: 0, y: 0, width: 50, height: 50 };
    const b: BoundingBox = { x: 25, y: 25, width: 50, height: 50 };
    expect(overlaps(a, b)).toBe(true);
  });

  test('non-overlapping boxes do not overlap', () => {
    const a: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
    const b: BoundingBox = { x: 100, y: 100, width: 10, height: 10 };
    expect(overlaps(a, b)).toBe(false);
  });

  // ─── Perimeter ───────────────────────────────────────────────────────

  test('perimeter of box', () => {
    expect(perimeter({ x: 0, y: 0, width: 10, height: 5 })).toBe(30);
  });

  test('perimeter of square', () => {
    expect(perimeter({ x: 0, y: 0, width: 10, height: 10 })).toBe(40);
  });

  // ─── Inset ───────────────────────────────────────────────────────────

  test('inset shrinks box', () => {
    const box: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    const result = inset(box, 10);
    expect(result).toEqual({ x: 10, y: 10, width: 80, height: 80 });
  });

  // ─── ScaleFromCenter ─────────────────────────────────────────────────

  test('scaleFromCenter(1, 1) is identity', () => {
    const box: BoundingBox = { x: 10, y: 20, width: 30, height: 40 };
    expect(equals(scaleFromCenter(box, 1, 1), box)).toBe(true);
  });

  test('scaleFromCenter doubles size around center', () => {
    const box: BoundingBox = { x: 10, y: 10, width: 20, height: 20 };
    const scaled = scaleFromCenter(box, 2, 2);
    expect(scaled.width).toBeCloseTo(40, 10);
    expect(scaled.height).toBeCloseTo(40, 10);
    // Center should remain at (20, 20)
    expect(center(scaled).x).toBeCloseTo(20, 10);
    expect(center(scaled).y).toBeCloseTo(20, 10);
  });
});
