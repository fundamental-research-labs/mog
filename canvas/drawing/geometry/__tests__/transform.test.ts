import { identity, isIdentity, equals as matEquals, transformPoint } from '../src/matrix';
import {
  compose,
  decompose,
  flipX,
  flipY,
  rotate,
  rotateAround,
  scale,
  scaleAround,
  skewX,
  skewY,
  translate,
} from '../src/transform';

describe('Transform builders', () => {
  // ─── Translate ───────────────────────────────────────────────────────

  test('translate(0,0) is identity', () => {
    expect(isIdentity(translate(0, 0))).toBe(true);
  });

  test('translate moves point', () => {
    const t = translate(10, 20);
    expect(transformPoint(t, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
  });

  test('composing translations adds offsets', () => {
    const t = compose(translate(10, 20), translate(5, 3));
    const p = transformPoint(t, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(15, 10);
    expect(p.y).toBeCloseTo(23, 10);
  });

  // ─── Rotate ──────────────────────────────────────────────────────────

  test('rotate(0) is identity', () => {
    expect(isIdentity(rotate(0))).toBe(true);
  });

  test('rotate(2*PI) is identity', () => {
    const r = rotate(2 * Math.PI);
    expect(isIdentity(r)).toBe(true);
  });

  test('rotate 90 degrees moves (1,0) to (0,1)', () => {
    const r = rotate(Math.PI / 2);
    const p = transformPoint(r, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.y).toBeCloseTo(1, 10);
  });

  test('compose four 90 degree rotations = identity', () => {
    const r90 = rotate(Math.PI / 2);
    const r360 = compose(r90, r90, r90, r90);
    expect(isIdentity(r360)).toBe(true);
  });

  // ─── RotateAround ────────────────────────────────────────────────────

  test('rotateAround center', () => {
    const r = rotateAround(Math.PI / 2, { x: 5, y: 5 });
    const p = transformPoint(r, { x: 10, y: 5 });
    expect(p.x).toBeCloseTo(5, 10);
    expect(p.y).toBeCloseTo(10, 10);
  });

  test('rotateAround with angle 0 is identity', () => {
    const r = rotateAround(0, { x: 5, y: 5 });
    expect(isIdentity(r)).toBe(true);
  });

  // ─── Scale ───────────────────────────────────────────────────────────

  test('scale(1,1) is identity', () => {
    expect(isIdentity(scale(1, 1))).toBe(true);
  });

  test('scale doubles coordinates', () => {
    const s = scale(2, 3);
    expect(transformPoint(s, { x: 5, y: 7 })).toEqual({ x: 10, y: 21 });
  });

  test('scale(0,0) collapses to origin', () => {
    const s = scale(0, 0);
    expect(transformPoint(s, { x: 5, y: 7 })).toEqual({ x: 0, y: 0 });
  });

  // ─── ScaleAround ────────────────────────────────────────────────────

  test('scaleAround center keeps center fixed', () => {
    const center = { x: 10, y: 10 };
    const s = scaleAround(2, 2, center);
    const result = transformPoint(s, center);
    expect(result.x).toBeCloseTo(10, 10);
    expect(result.y).toBeCloseTo(10, 10);
  });

  test('scaleAround doubles distance from center', () => {
    const center = { x: 10, y: 10 };
    const s = scaleAround(2, 2, center);
    const result = transformPoint(s, { x: 15, y: 10 });
    expect(result.x).toBeCloseTo(20, 10);
    expect(result.y).toBeCloseTo(10, 10);
  });

  // ─── Skew ────────────────────────────────────────────────────────────

  test('skewX(0) is identity', () => {
    expect(isIdentity(skewX(0))).toBe(true);
  });

  test('skewY(0) is identity', () => {
    expect(isIdentity(skewY(0))).toBe(true);
  });

  test('skewX shifts x by tan(angle)*y', () => {
    const angle = Math.PI / 4; // 45 degrees, tan = 1
    const s = skewX(angle);
    const p = transformPoint(s, { x: 0, y: 10 });
    expect(p.x).toBeCloseTo(10, 10); // x = 0 + tan(45)*10 = 10
    expect(p.y).toBeCloseTo(10, 10);
  });

  test('skewY shifts y by tan(angle)*x', () => {
    const angle = Math.PI / 4;
    const s = skewY(angle);
    const p = transformPoint(s, { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(10, 10);
    expect(p.y).toBeCloseTo(10, 10); // y = 0 + tan(45)*10 = 10
  });

  // ─── Compose ─────────────────────────────────────────────────────────

  test('compose with no arguments returns identity', () => {
    expect(isIdentity(compose())).toBe(true);
  });

  test('compose with one argument returns that transform', () => {
    const t = translate(5, 10);
    expect(matEquals(compose(t), t)).toBe(true);
  });

  test('compose applies right-to-left', () => {
    // First scale by 2, then translate by 10
    const result = compose(translate(10, 0), scale(2, 1));
    const p = transformPoint(result, { x: 5, y: 0 });
    // scale: 5 -> 10, translate: 10 -> 20
    expect(p.x).toBeCloseTo(20, 10);
  });

  test('compose translate then scale (different order)', () => {
    // First translate by 10, then scale by 2
    const result = compose(scale(2, 1), translate(10, 0));
    const p = transformPoint(result, { x: 5, y: 0 });
    // translate: 5 -> 15, scale: 15 -> 30
    expect(p.x).toBeCloseTo(30, 10);
  });

  // ─── Decompose ───────────────────────────────────────────────────────

  test('decompose identity', () => {
    const d = decompose(identity());
    expect(d.translation.tx).toBeCloseTo(0, 10);
    expect(d.translation.ty).toBeCloseTo(0, 10);
    expect(d.rotation).toBeCloseTo(0, 10);
    expect(d.scale.sx).toBeCloseTo(1, 10);
    expect(d.scale.sy).toBeCloseTo(1, 10);
  });

  test('decompose pure translation', () => {
    const d = decompose(translate(10, 20));
    expect(d.translation.tx).toBeCloseTo(10, 10);
    expect(d.translation.ty).toBeCloseTo(20, 10);
    expect(d.rotation).toBeCloseTo(0, 10);
    expect(d.scale.sx).toBeCloseTo(1, 10);
    expect(d.scale.sy).toBeCloseTo(1, 10);
  });

  test('decompose pure rotation', () => {
    const angle = Math.PI / 4;
    const d = decompose(rotate(angle));
    expect(d.translation.tx).toBeCloseTo(0, 10);
    expect(d.translation.ty).toBeCloseTo(0, 10);
    expect(d.rotation).toBeCloseTo(angle, 10);
    expect(d.scale.sx).toBeCloseTo(1, 5);
    expect(d.scale.sy).toBeCloseTo(1, 5);
  });

  test('decompose pure scale', () => {
    const d = decompose(scale(3, 5));
    expect(d.translation.tx).toBeCloseTo(0, 10);
    expect(d.translation.ty).toBeCloseTo(0, 10);
    expect(d.scale.sx).toBeCloseTo(3, 5);
    expect(d.scale.sy).toBeCloseTo(5, 5);
  });

  // ─── Flip ────────────────────────────────────────────────────────────

  test('flipX negates x coordinate', () => {
    const f = flipX();
    const p = transformPoint(f, { x: 5, y: 7 });
    expect(p.x).toBeCloseTo(-5, 10);
    expect(p.y).toBeCloseTo(7, 10);
  });

  test('flipY negates y coordinate', () => {
    const f = flipY();
    const p = transformPoint(f, { x: 5, y: 7 });
    expect(p.x).toBeCloseTo(5, 10);
    expect(p.y).toBeCloseTo(-7, 10);
  });

  test('flipX twice is identity', () => {
    const f = compose(flipX(), flipX());
    expect(isIdentity(f)).toBe(true);
  });

  test('flipY twice is identity', () => {
    const f = compose(flipY(), flipY());
    expect(isIdentity(f)).toBe(true);
  });
});
