import {
  determinant,
  equals,
  fromValues,
  identity,
  invert,
  isIdentity,
  multiply,
  transformPoint,
  transformPoints,
} from '../src/matrix';

describe('Matrix operations', () => {
  // ─── Identity ────────────────────────────────────────────────────────

  test('identity has correct values', () => {
    const id = identity();
    expect(id).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
  });

  test('isIdentity returns true for identity', () => {
    expect(isIdentity(identity())).toBe(true);
  });

  test('isIdentity returns false for non-identity', () => {
    expect(isIdentity(fromValues(2, 0, 0, 1, 0, 0))).toBe(false);
  });

  // ─── fromValues ──────────────────────────────────────────────────────

  test('fromValues creates transform with given values', () => {
    const m = fromValues(2, 3, 4, 5, 6, 7);
    expect(m).toEqual({ a: 2, b: 3, c: 4, d: 5, tx: 6, ty: 7 });
  });

  // ─── Multiply ────────────────────────────────────────────────────────

  test('multiply by identity is identity operation', () => {
    const m = fromValues(2, 3, 4, 5, 6, 7);
    expect(equals(multiply(identity(), m), m)).toBe(true);
    expect(equals(multiply(m, identity()), m)).toBe(true);
  });

  test('multiply two translations', () => {
    const t1 = fromValues(1, 0, 0, 1, 5, 3);
    const t2 = fromValues(1, 0, 0, 1, 2, 7);
    const result = multiply(t1, t2);
    expect(result.tx).toBeCloseTo(7, 10);
    expect(result.ty).toBeCloseTo(10, 10);
  });

  test('multiply two scales', () => {
    const s1 = fromValues(2, 0, 0, 3, 0, 0);
    const s2 = fromValues(4, 0, 0, 5, 0, 0);
    const result = multiply(s1, s2);
    expect(result.a).toBeCloseTo(8, 10);
    expect(result.d).toBeCloseTo(15, 10);
  });

  test('multiply is associative', () => {
    const a = fromValues(1, 2, 3, 4, 5, 6);
    const b = fromValues(7, 8, 9, 10, 11, 12);
    const c = fromValues(13, 14, 15, 16, 17, 18);

    const ab_c = multiply(multiply(a, b), c);
    const a_bc = multiply(a, multiply(b, c));

    expect(equals(ab_c, a_bc)).toBe(true);
  });

  test('multiply is NOT commutative (in general)', () => {
    const a = fromValues(1, 2, 3, 4, 0, 0);
    const b = fromValues(5, 6, 7, 8, 0, 0);

    const ab = multiply(a, b);
    const ba = multiply(b, a);

    expect(equals(ab, ba)).toBe(false);
  });

  // ─── Determinant ─────────────────────────────────────────────────────

  test('determinant of identity is 1', () => {
    expect(determinant(identity())).toBe(1);
  });

  test('determinant of scale(2,3) is 6', () => {
    expect(determinant(fromValues(2, 0, 0, 3, 0, 0))).toBe(6);
  });

  test('determinant of singular matrix is 0', () => {
    // Rows are linearly dependent
    expect(determinant(fromValues(1, 2, 2, 4, 0, 0))).toBe(0);
  });

  test('determinant of product is product of determinants', () => {
    const a = fromValues(2, 1, 3, 4, 5, 6);
    const b = fromValues(7, 8, 9, 10, 11, 12);
    expect(determinant(multiply(a, b))).toBeCloseTo(determinant(a) * determinant(b), 8);
  });

  // ─── Invert ──────────────────────────────────────────────────────────

  test('invert of identity is identity', () => {
    const inv = invert(identity());
    expect(inv).not.toBeNull();
    expect(isIdentity(inv!)).toBe(true);
  });

  test('invert of singular matrix returns null', () => {
    expect(invert(fromValues(1, 2, 2, 4, 0, 0))).toBeNull();
  });

  test('M * invert(M) = identity', () => {
    const m = fromValues(2, 1, 3, 4, 5, 6);
    const inv = invert(m);
    expect(inv).not.toBeNull();
    const product = multiply(m, inv!);
    expect(isIdentity(product)).toBe(true);
  });

  test('invert(M) * M = identity', () => {
    const m = fromValues(2, 1, 3, 4, 5, 6);
    const inv = invert(m);
    expect(inv).not.toBeNull();
    const product = multiply(inv!, m);
    expect(isIdentity(product)).toBe(true);
  });

  test('invert(invert(M)) = M', () => {
    const m = fromValues(2, 1, 3, 4, 5, 6);
    const inv = invert(m);
    const inv2 = invert(inv!);
    expect(equals(inv2!, m)).toBe(true);
  });

  test('invert of translation', () => {
    const t = fromValues(1, 0, 0, 1, 10, 20);
    const inv = invert(t)!;
    expect(inv.tx).toBeCloseTo(-10, 10);
    expect(inv.ty).toBeCloseTo(-20, 10);
  });

  test('invert of scale', () => {
    const s = fromValues(2, 0, 0, 4, 0, 0);
    const inv = invert(s)!;
    expect(inv.a).toBeCloseTo(0.5, 10);
    expect(inv.d).toBeCloseTo(0.25, 10);
  });

  // ─── Transform Point ─────────────────────────────────────────────────

  test('identity transform leaves point unchanged', () => {
    const p = { x: 5, y: 7 };
    expect(transformPoint(identity(), p)).toEqual(p);
  });

  test('translation transform shifts point', () => {
    const t = fromValues(1, 0, 0, 1, 10, 20);
    expect(transformPoint(t, { x: 3, y: 4 })).toEqual({ x: 13, y: 24 });
  });

  test('scale transform scales point', () => {
    const s = fromValues(2, 0, 0, 3, 0, 0);
    expect(transformPoint(s, { x: 5, y: 7 })).toEqual({ x: 10, y: 21 });
  });

  test('rotation transform rotates point', () => {
    const cos90 = Math.cos(Math.PI / 2);
    const sin90 = Math.sin(Math.PI / 2);
    const r = fromValues(cos90, sin90, -sin90, cos90, 0, 0);
    const result = transformPoint(r, { x: 1, y: 0 });
    expect(result.x).toBeCloseTo(0, 10);
    expect(result.y).toBeCloseTo(1, 10);
  });

  test('transformPoint then invert returns original', () => {
    const m = fromValues(2, 1, -1, 3, 5, 7);
    const p = { x: 3, y: 4 };
    const transformed = transformPoint(m, p);
    const inv = invert(m)!;
    const restored = transformPoint(inv, transformed);
    expect(restored.x).toBeCloseTo(p.x, 10);
    expect(restored.y).toBeCloseTo(p.y, 10);
  });

  // ─── Transform Points ────────────────────────────────────────────────

  test('transformPoints transforms all points', () => {
    const t = fromValues(1, 0, 0, 1, 10, 20);
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 3 },
    ];
    const result = transformPoints(t, points);
    expect(result).toEqual([
      { x: 10, y: 20 },
      { x: 11, y: 21 },
      { x: 12, y: 23 },
    ]);
  });

  test('transformPoints with empty array', () => {
    expect(transformPoints(identity(), [])).toEqual([]);
  });

  // ─── Equality ────────────────────────────────────────────────────────

  test('equals with identical matrices', () => {
    const m = fromValues(1, 2, 3, 4, 5, 6);
    expect(equals(m, m)).toBe(true);
  });

  test('equals within epsilon', () => {
    const m1 = fromValues(1, 2, 3, 4, 5, 6);
    const m2 = fromValues(1 + 1e-11, 2, 3, 4, 5, 6);
    expect(equals(m1, m2)).toBe(true);
  });

  test('not equal beyond epsilon', () => {
    const m1 = fromValues(1, 2, 3, 4, 5, 6);
    const m2 = fromValues(1.001, 2, 3, 4, 5, 6);
    expect(equals(m1, m2)).toBe(false);
  });
});
