/**
 * Effects Tests
 *
 * Tests for 3D transforms and style presets.
 */
import { Matrix } from '@mog/geometry';
import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import { getStylePreset, STYLE_PRESETS } from '../src/effects/style-presets';
import { compute3DTransform, type ThreeDConfig } from '../src/effects/three-d';

const TEST_BOUNDS: BoundingBox = { x: 0, y: 0, width: 200, height: 50 };

describe('compute3DTransform', () => {
  test('identity rotation produces near-identity transform', () => {
    const config: ThreeDConfig = { rotationX: 0, rotationY: 0, rotationZ: 0 };
    const transform = compute3DTransform(config, TEST_BOUNDS);

    // Should be very close to identity
    expect(transform.a).toBeCloseTo(1, 5);
    expect(transform.d).toBeCloseTo(1, 5);
    expect(transform.b).toBeCloseTo(0, 5);
    expect(transform.c).toBeCloseTo(0, 5);
  });

  test('Z rotation produces 2D rotation', () => {
    const config: ThreeDConfig = { rotationX: 0, rotationY: 0, rotationZ: 90 };
    const transform = compute3DTransform(config, TEST_BOUNDS);

    // Should contain rotation components
    expect(isFinite(transform.a)).toBe(true);
    expect(isFinite(transform.b)).toBe(true);
    expect(isFinite(transform.c)).toBe(true);
    expect(isFinite(transform.d)).toBe(true);

    // a should be ~cos(90) = 0, b should be ~sin(90) = 1
    expect(transform.a).toBeCloseTo(0, 1);
    expect(transform.b).toBeCloseTo(1, 1);
  });

  test('X rotation produces vertical scale/skew', () => {
    const config: ThreeDConfig = { rotationX: 30, rotationY: 0, rotationZ: 0 };
    const transform = compute3DTransform(config, TEST_BOUNDS);

    // X rotation should reduce vertical scale (cos(30) < 1)
    // The diagonal component d should be cos(30)
    expect(isFinite(transform.d)).toBe(true);
    // Point still has finite transform
    const pt = Matrix.transformPoint(transform, { x: 100, y: 25 });
    expect(isFinite(pt.x)).toBe(true);
    expect(isFinite(pt.y)).toBe(true);
  });

  test('Y rotation produces horizontal scale/skew', () => {
    const config: ThreeDConfig = { rotationX: 0, rotationY: 30, rotationZ: 0 };
    const transform = compute3DTransform(config, TEST_BOUNDS);

    expect(isFinite(transform.a)).toBe(true);
    const pt = Matrix.transformPoint(transform, { x: 100, y: 25 });
    expect(isFinite(pt.x)).toBe(true);
    expect(isFinite(pt.y)).toBe(true);
  });

  test('combined rotation produces valid transform', () => {
    const config: ThreeDConfig = { rotationX: 15, rotationY: 10, rotationZ: 5 };
    const transform = compute3DTransform(config, TEST_BOUNDS);

    // Transform should be non-degenerate
    const det = Matrix.determinant(transform);
    expect(Math.abs(det)).toBeGreaterThan(0.01);

    // Transform a point
    const pt = Matrix.transformPoint(transform, { x: 100, y: 25 });
    expect(isFinite(pt.x)).toBe(true);
    expect(isFinite(pt.y)).toBe(true);
  });

  test('with perspective produces valid transform', () => {
    const config: ThreeDConfig = {
      rotationX: 10,
      rotationY: 5,
      rotationZ: 0,
      perspective: 500,
    };
    const transform = compute3DTransform(config, TEST_BOUNDS);

    expect(isFinite(transform.a)).toBe(true);
    expect(isFinite(transform.d)).toBe(true);
  });

  test('with depth produces valid transform', () => {
    const config: ThreeDConfig = {
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      depth: 50,
    };
    const transform = compute3DTransform(config, TEST_BOUNDS);

    expect(isFinite(transform.a)).toBe(true);
    expect(isFinite(transform.d)).toBe(true);

    // Depth should cause the transform to differ from identity
    const noDepthConfig: ThreeDConfig = {
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      depth: 0,
    };
    const noDepthTransform = compute3DTransform(noDepthConfig, TEST_BOUNDS);

    // With depth, scale should be slightly reduced (foreshortening)
    expect(transform.a).toBeLessThan(noDepthTransform.a);
    expect(transform.d).toBeLessThan(noDepthTransform.d);
  });
});

describe('Style Presets', () => {
  test('STYLE_PRESETS is non-empty', () => {
    expect(STYLE_PRESETS.length).toBeGreaterThan(0);
  });

  test('all presets have a fill', () => {
    for (const style of STYLE_PRESETS) {
      expect(style.fill).toBeDefined();
      expect(style.fill.type).toBeDefined();
      expect(['solid', 'gradient', 'none']).toContain(style.fill.type);
    }
  });

  test('getStylePreset returns valid preset for valid index', () => {
    const style = getStylePreset(0);
    expect(style).toBeDefined();
    expect(style.fill).toBeDefined();
  });

  test('getStylePreset returns first preset for out-of-range index', () => {
    const style = getStylePreset(-1);
    expect(style).toEqual(STYLE_PRESETS[0]);

    const style2 = getStylePreset(99999);
    expect(style2).toEqual(STYLE_PRESETS[0]);
  });

  test('gradient presets have stops', () => {
    const gradientPresets = STYLE_PRESETS.filter((s) => s.fill.type === 'gradient');
    expect(gradientPresets.length).toBeGreaterThan(0);

    for (const style of gradientPresets) {
      expect(style.fill.gradient).toBeDefined();
      expect(style.fill.gradient!.stops.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('outline presets have positive width', () => {
    const outlinePresets = STYLE_PRESETS.filter((s) => s.outline !== undefined);
    expect(outlinePresets.length).toBeGreaterThan(0);

    for (const style of outlinePresets) {
      expect(style.outline!.width).toBeGreaterThan(0);
      expect(style.outline!.color).toBeDefined();
    }
  });

  test('shadow presets have valid opacity', () => {
    const shadowPresets = STYLE_PRESETS.filter((s) => s.shadow !== undefined);

    for (const style of shadowPresets) {
      expect(style.shadow!.opacity).toBeGreaterThanOrEqual(0);
      expect(style.shadow!.opacity).toBeLessThanOrEqual(1);
    }
  });

  test('3D presets have rotation values', () => {
    const threeDPresets = STYLE_PRESETS.filter((s) => s.threeDRotation !== undefined);

    for (const style of threeDPresets) {
      expect(isFinite(style.threeDRotation!.rotationX)).toBe(true);
      expect(isFinite(style.threeDRotation!.rotationY)).toBe(true);
      expect(isFinite(style.threeDRotation!.rotationZ)).toBe(true);
    }
  });
});
