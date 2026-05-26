import {
  add,
  angle,
  angleBetween,
  clone,
  cross,
  distance,
  distanceSquared,
  dot,
  equals,
  fromAngle,
  length,
  lengthSquared,
  lerp,
  midpoint,
  negate,
  normalize,
  perpendicular,
  project,
  reflect,
  rotate,
  rotateAround,
  scale,
  subtract,
  zero,
} from '../src/point';

const EPSILON = 1e-10;

describe('Point2D / Vector2D operations', () => {
  // ─── Basic Operations ────────────────────────────────────────────────

  test('zero creates origin point', () => {
    const p = zero();
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });

  test('clone creates independent copy', () => {
    const original = { x: 3, y: 7 };
    const copy = clone(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
  });

  test('add adds two points', () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
  });

  test('add with zero is identity', () => {
    const p = { x: 5, y: -3 };
    expect(add(p, zero())).toEqual(p);
  });

  test('subtract produces difference vector', () => {
    expect(subtract({ x: 5, y: 7 }, { x: 2, y: 3 })).toEqual({ x: 3, y: 4 });
  });

  test('add and subtract are inverses', () => {
    const a = { x: 3, y: 4 };
    const b = { x: 1, y: 2 };
    const result = add(subtract(a, b), b);
    expect(equals(result, a)).toBe(true);
  });

  test('scale multiplies by scalar', () => {
    expect(scale({ x: 2, y: 3 }, 4)).toEqual({ x: 8, y: 12 });
  });

  test('scale by zero produces zero vector', () => {
    expect(scale({ x: 5, y: 10 }, 0)).toEqual({ x: 0, y: 0 });
  });

  test('scale by 1 is identity', () => {
    const p = { x: 3, y: 7 };
    expect(scale(p, 1)).toEqual(p);
  });

  test('negate reverses direction', () => {
    expect(negate({ x: 3, y: -4 })).toEqual({ x: -3, y: 4 });
  });

  test('negate twice is identity', () => {
    const v = { x: 5, y: -7 };
    expect(equals(negate(negate(v)), v)).toBe(true);
  });

  // ─── Dot Product ─────────────────────────────────────────────────────

  test('dot product of orthogonal vectors is zero', () => {
    expect(dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0);
  });

  test('dot product of parallel vectors', () => {
    expect(dot({ x: 3, y: 0 }, { x: 5, y: 0 })).toBe(15);
  });

  test('dot product is commutative', () => {
    const a = { x: 2, y: 3 };
    const b = { x: 4, y: -1 };
    expect(dot(a, b)).toBe(dot(b, a));
  });

  test('dot product with self equals length squared', () => {
    const v = { x: 3, y: 4 };
    expect(dot(v, v)).toBeCloseTo(lengthSquared(v), 10);
  });

  // ─── Cross Product ───────────────────────────────────────────────────

  test('cross product of parallel vectors is zero', () => {
    expect(cross({ x: 2, y: 0 }, { x: 5, y: 0 })).toBe(0);
  });

  test('cross product of unit vectors gives signed area', () => {
    expect(cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
    expect(cross({ x: 0, y: 1 }, { x: 1, y: 0 })).toBe(-1);
  });

  test('cross product is anti-commutative', () => {
    const a = { x: 2, y: 3 };
    const b = { x: 4, y: -1 };
    expect(cross(a, b)).toBe(-cross(b, a));
  });

  // ─── Length ──────────────────────────────────────────────────────────

  test('length of 3-4-5 triangle', () => {
    expect(length({ x: 3, y: 4 })).toBe(5);
  });

  test('length of zero vector is zero', () => {
    expect(length(zero())).toBe(0);
  });

  test('length of unit vector along x', () => {
    expect(length({ x: 1, y: 0 })).toBe(1);
  });

  test('lengthSquared avoids sqrt', () => {
    expect(lengthSquared({ x: 3, y: 4 })).toBe(25);
  });

  // ─── Normalize ───────────────────────────────────────────────────────

  test('normalize produces unit vector', () => {
    const n = normalize({ x: 3, y: 4 });
    expect(length(n)).toBeCloseTo(1, 10);
  });

  test('normalize of zero vector returns zero', () => {
    const n = normalize(zero());
    expect(n).toEqual(zero());
  });

  test('normalize preserves direction', () => {
    const v = { x: 3, y: 4 };
    const n = normalize(v);
    expect(n.x / n.y).toBeCloseTo(v.x / v.y, 10);
  });

  test('normalize of unit vector is itself', () => {
    const v = { x: 1, y: 0 };
    const n = normalize(v);
    expect(equals(n, v)).toBe(true);
  });

  // ─── Distance ────────────────────────────────────────────────────────

  test('distance from point to itself is zero', () => {
    const p = { x: 5, y: 3 };
    expect(distance(p, p)).toBe(0);
  });

  test('distance is symmetric', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 4, y: 6 };
    expect(distance(a, b)).toBe(distance(b, a));
  });

  test('distance uses Euclidean formula', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  test('distanceSquared is consistent with distance', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 4, y: 6 };
    expect(distanceSquared(a, b)).toBeCloseTo(distance(a, b) ** 2, 10);
  });

  // ─── Lerp ────────────────────────────────────────────────────────────

  test('lerp at t=0 returns a', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 5, y: 8 };
    expect(lerp(a, b, 0)).toEqual(a);
  });

  test('lerp at t=1 returns b', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 5, y: 8 };
    expect(lerp(a, b, 1)).toEqual(b);
  });

  test('lerp at t=0.5 returns midpoint', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 20 };
    expect(lerp(a, b, 0.5)).toEqual({ x: 5, y: 10 });
  });

  test('lerp extrapolates beyond [0,1]', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(lerp(a, b, 2)).toEqual({ x: 20, y: 0 });
  });

  // ─── Angle ───────────────────────────────────────────────────────────

  test('angle of positive x axis is 0', () => {
    expect(angle({ x: 1, y: 0 })).toBe(0);
  });

  test('angle of positive y axis is PI/2', () => {
    expect(angle({ x: 0, y: 1 })).toBeCloseTo(Math.PI / 2, 10);
  });

  test('angle of negative x axis is PI', () => {
    expect(Math.abs(angle({ x: -1, y: 0 }))).toBeCloseTo(Math.PI, 10);
  });

  test('angleBetween orthogonal vectors is PI/2', () => {
    expect(angleBetween({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2, 10);
  });

  test('angleBetween parallel vectors is 0', () => {
    expect(angleBetween({ x: 1, y: 0 }, { x: 5, y: 0 })).toBeCloseTo(0, 10);
  });

  test('angleBetween anti-parallel vectors is PI', () => {
    expect(angleBetween({ x: 1, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(Math.PI, 10);
  });

  test('angleBetween with zero vector returns 0', () => {
    expect(angleBetween(zero(), { x: 1, y: 0 })).toBe(0);
  });

  // ─── Rotation ────────────────────────────────────────────────────────

  test('rotate by 0 is identity', () => {
    const p = { x: 3, y: 4 };
    expect(equals(rotate(p, 0), p)).toBe(true);
  });

  test('rotate by 360 degrees is identity', () => {
    const p = { x: 3, y: 4 };
    const rotated = rotate(p, 2 * Math.PI);
    expect(equals(rotated, p)).toBe(true);
  });

  test('rotate (1,0) by 90 degrees gives (0,1)', () => {
    const rotated = rotate({ x: 1, y: 0 }, Math.PI / 2);
    expect(rotated.x).toBeCloseTo(0, 10);
    expect(rotated.y).toBeCloseTo(1, 10);
  });

  test('rotate preserves length', () => {
    const v = { x: 3, y: 4 };
    const rotated = rotate(v, 1.23);
    expect(length(rotated)).toBeCloseTo(length(v), 10);
  });

  test('rotateAround rotates around center', () => {
    const p = { x: 2, y: 0 };
    const center = { x: 1, y: 0 };
    const rotated = rotateAround(p, Math.PI / 2, center);
    expect(rotated.x).toBeCloseTo(1, 10);
    expect(rotated.y).toBeCloseTo(1, 10);
  });

  test('rotateAround with center at point is identity', () => {
    const p = { x: 3, y: 4 };
    const rotated = rotateAround(p, Math.PI / 3, p);
    expect(equals(rotated, p)).toBe(true);
  });

  // ─── Equality ────────────────────────────────────────────────────────

  test('equals with same values', () => {
    expect(equals({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
  });

  test('equals within epsilon', () => {
    expect(equals({ x: 1, y: 2 }, { x: 1 + 1e-11, y: 2 - 1e-11 })).toBe(true);
  });

  test('not equal beyond epsilon', () => {
    expect(equals({ x: 1, y: 2 }, { x: 1.001, y: 2 })).toBe(false);
  });

  test('custom epsilon', () => {
    expect(equals({ x: 1, y: 2 }, { x: 1.05, y: 2 }, 0.1)).toBe(true);
    expect(equals({ x: 1, y: 2 }, { x: 1.2, y: 2 }, 0.1)).toBe(false);
  });

  // ─── fromAngle ───────────────────────────────────────────────────────

  test('fromAngle(0) gives (1, 0)', () => {
    const v = fromAngle(0);
    expect(v.x).toBeCloseTo(1, 10);
    expect(v.y).toBeCloseTo(0, 10);
  });

  test('fromAngle(PI/2) gives (0, 1)', () => {
    const v = fromAngle(Math.PI / 2);
    expect(v.x).toBeCloseTo(0, 10);
    expect(v.y).toBeCloseTo(1, 10);
  });

  test('fromAngle produces unit vector', () => {
    const v = fromAngle(1.234);
    expect(length(v)).toBeCloseTo(1, 10);
  });

  // ─── Perpendicular ───────────────────────────────────────────────────

  test('perpendicular is orthogonal', () => {
    const v = { x: 3, y: 4 };
    const perp = perpendicular(v);
    expect(dot(v, perp)).toBeCloseTo(0, 10);
  });

  test('perpendicular preserves length', () => {
    const v = { x: 3, y: 4 };
    const perp = perpendicular(v);
    expect(length(perp)).toBeCloseTo(length(v), 10);
  });

  // ─── Project ─────────────────────────────────────────────────────────

  test('project onto same direction', () => {
    const v = { x: 3, y: 4 };
    const proj = project(v, { x: 6, y: 8 });
    expect(equals(proj, v)).toBe(true);
  });

  test('project onto perpendicular is zero', () => {
    const v = { x: 1, y: 0 };
    const proj = project(v, { x: 0, y: 1 });
    expect(equals(proj, zero())).toBe(true);
  });

  test('project onto zero vector returns zero', () => {
    const proj = project({ x: 3, y: 4 }, zero());
    expect(proj).toEqual(zero());
  });

  // ─── Reflect ─────────────────────────────────────────────────────────

  test('reflect across horizontal normal', () => {
    const v = { x: 1, y: -1 };
    const normal = { x: 0, y: 1 };
    const r = reflect(v, normal);
    expect(r.x).toBeCloseTo(1, 10);
    expect(r.y).toBeCloseTo(1, 10);
  });

  test('reflect preserves length', () => {
    const v = { x: 3, y: 4 };
    const n = normalize({ x: 1, y: 1 });
    const r = reflect(v, n);
    expect(length(r)).toBeCloseTo(length(v), 10);
  });

  // ─── Midpoint ────────────────────────────────────────────────────────

  test('midpoint of two points', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });

  test('midpoint of same point is itself', () => {
    const p = { x: 3, y: 7 };
    expect(midpoint(p, p)).toEqual(p);
  });

  test('midpoint is equidistant from both', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 7, y: 10 };
    const m = midpoint(a, b);
    expect(distance(a, m)).toBeCloseTo(distance(b, m), 10);
  });
});
