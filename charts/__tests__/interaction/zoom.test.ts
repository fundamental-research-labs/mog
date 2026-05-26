/**
 * Tests for Zoom and Pan Transform Utilities
 */

import {
  centerOn,
  composeTransforms,
  constrainPan,
  constrainScale,
  constrainTransform,
  defaultZoomLimits,
  identityTransform,
  interpolateTransform,
  invertPoint,
  invertRect,
  invertTransform,
  isIdentity,
  pan,
  panTo,
  pinchScaleToScaleFactor,
  resetZoom,
  transformPoint,
  transformRect,
  wheelDeltaToScaleFactor,
  zoomAt,
  zoomBy,
  zoomTo,
  zoomToFit,
  type Point,
  type ZoomTransform,
} from '../../src/interaction/zoom';

describe('zoom utilities', () => {
  // ==========================================================================
  // Constants Tests
  // ==========================================================================

  describe('constants', () => {
    it('identityTransform has correct values', () => {
      expect(identityTransform.x).toBe(0);
      expect(identityTransform.y).toBe(0);
      expect(identityTransform.k).toBe(1);
    });

    it('defaultZoomLimits has sensible defaults', () => {
      expect(defaultZoomLimits.minK).toBe(0.1);
      expect(defaultZoomLimits.maxK).toBe(10);
    });
  });

  // ==========================================================================
  // Transform Application Tests
  // ==========================================================================

  describe('transformPoint', () => {
    it('applies identity transform correctly', () => {
      const point: Point = { x: 50, y: 100 };
      const result = transformPoint(point, identityTransform);
      expect(result.x).toBe(50);
      expect(result.y).toBe(100);
    });

    it('applies scale correctly', () => {
      const point: Point = { x: 50, y: 100 };
      const transform: ZoomTransform = { x: 0, y: 0, k: 2 };
      const result = transformPoint(point, transform);
      expect(result.x).toBe(100);
      expect(result.y).toBe(200);
    });

    it('applies translation correctly', () => {
      const point: Point = { x: 50, y: 100 };
      const transform: ZoomTransform = { x: 10, y: 20, k: 1 };
      const result = transformPoint(point, transform);
      expect(result.x).toBe(60);
      expect(result.y).toBe(120);
    });

    it('applies scale and translation correctly', () => {
      const point: Point = { x: 50, y: 100 };
      const transform: ZoomTransform = { x: 10, y: 20, k: 2 };
      const result = transformPoint(point, transform);
      expect(result.x).toBe(110); // 50 * 2 + 10
      expect(result.y).toBe(220); // 100 * 2 + 20
    });
  });

  describe('invertPoint', () => {
    it('inverts identity transform correctly', () => {
      const point: Point = { x: 50, y: 100 };
      const result = invertPoint(point, identityTransform);
      expect(result.x).toBe(50);
      expect(result.y).toBe(100);
    });

    it('inverts scale correctly', () => {
      const point: Point = { x: 100, y: 200 };
      const transform: ZoomTransform = { x: 0, y: 0, k: 2 };
      const result = invertPoint(point, transform);
      expect(result.x).toBe(50);
      expect(result.y).toBe(100);
    });

    it('inverts translation correctly', () => {
      const point: Point = { x: 60, y: 120 };
      const transform: ZoomTransform = { x: 10, y: 20, k: 1 };
      const result = invertPoint(point, transform);
      expect(result.x).toBe(50);
      expect(result.y).toBe(100);
    });

    it('roundtrips with transformPoint', () => {
      const original: Point = { x: 123, y: 456 };
      const transform: ZoomTransform = { x: 50, y: -30, k: 2.5 };
      const transformed = transformPoint(original, transform);
      const inverted = invertPoint(transformed, transform);
      expect(inverted.x).toBeCloseTo(original.x, 10);
      expect(inverted.y).toBeCloseTo(original.y, 10);
    });
  });

  describe('transformRect', () => {
    it('transforms rectangle correctly', () => {
      const rect = { x: 10, y: 20, width: 100, height: 50 };
      const transform: ZoomTransform = { x: 5, y: 10, k: 2 };
      const result = transformRect(rect, transform);
      expect(result.x).toBe(25); // 10 * 2 + 5
      expect(result.y).toBe(50); // 20 * 2 + 10
      expect(result.width).toBe(200); // 100 * 2
      expect(result.height).toBe(100); // 50 * 2
    });
  });

  describe('invertRect', () => {
    it('inverts rectangle correctly', () => {
      const rect = { x: 25, y: 50, width: 200, height: 100 };
      const transform: ZoomTransform = { x: 5, y: 10, k: 2 };
      const result = invertRect(rect, transform);
      expect(result.x).toBe(10);
      expect(result.y).toBe(20);
      expect(result.width).toBe(100);
      expect(result.height).toBe(50);
    });
  });

  // ==========================================================================
  // Zoom Operations Tests
  // ==========================================================================

  describe('zoomAt', () => {
    it('zooms in at center point', () => {
      const current: ZoomTransform = { x: 0, y: 0, k: 1 };
      const center: Point = { x: 100, y: 100 };
      const result = zoomAt(current, center, 2);

      expect(result.k).toBe(2);
      // Point should stay at same screen position
      // After zoom, the point at (100, 100) in data coords should be at (100, 100) screen coords
      // Before: screen = data * 1 + 0 = data
      // After: screen = data * 2 + x, where screen(100) = 100 = 100*2 + x => x = -100
      expect(result.x).toBe(-100);
      expect(result.y).toBe(-100);
    });

    it('zooms out at center point', () => {
      const current: ZoomTransform = { x: 0, y: 0, k: 2 };
      const center: Point = { x: 100, y: 100 };
      const result = zoomAt(current, center, 0.5);

      expect(result.k).toBe(1);
    });

    it('respects zoom limits', () => {
      const current: ZoomTransform = { x: 0, y: 0, k: 1 };
      const center: Point = { x: 100, y: 100 };

      // Try to zoom beyond max
      const result1 = zoomAt(current, center, 100, { minK: 0.1, maxK: 5 });
      expect(result1.k).toBe(5);

      // Try to zoom below min
      const result2 = zoomAt(current, center, 0.01, { minK: 0.1, maxK: 5 });
      expect(result2.k).toBe(0.1);
    });

    it('returns same transform when at limit', () => {
      const current: ZoomTransform = { x: 0, y: 0, k: 5 };
      const center: Point = { x: 100, y: 100 };
      const result = zoomAt(current, center, 2, { minK: 0.1, maxK: 5 });

      expect(result).toEqual(current);
    });
  });

  describe('zoomBy', () => {
    it('zooms centered on viewport', () => {
      const current: ZoomTransform = { x: 0, y: 0, k: 1 };
      const viewport = { width: 800, height: 600 };
      const result = zoomBy(current, 2, viewport);

      expect(result.k).toBe(2);
      // Center of viewport is (400, 300)
      expect(result.x).toBe(-400);
      expect(result.y).toBe(-300);
    });
  });

  describe('zoomTo', () => {
    it('zooms to specific scale', () => {
      const current: ZoomTransform = { x: 0, y: 0, k: 1 };
      const center: Point = { x: 100, y: 100 };
      const result = zoomTo(current, 3, center);

      expect(result.k).toBe(3);
    });
  });

  describe('zoomToFit', () => {
    it('calculates transform to fit rectangle in viewport', () => {
      const rect = { x: 0, y: 0, width: 200, height: 100 };
      const viewport = { width: 400, height: 400 };
      const result = zoomToFit(rect, viewport, 0);

      // Scale should be 2 (400/200 or 400/100, taking min = 2)
      expect(result.k).toBe(2);
    });

    it('includes padding in calculation', () => {
      const rect = { x: 0, y: 0, width: 200, height: 100 };
      const viewport = { width: 400, height: 400 };
      const result = zoomToFit(rect, viewport, 20);

      // Available space is 360x360 with 20px padding
      // Scale should be 360/200 = 1.8 or 360/100 = 3.6, min = 1.8
      expect(result.k).toBe(1.8);
    });
  });

  // ==========================================================================
  // Pan Operations Tests
  // ==========================================================================

  describe('pan', () => {
    it('applies delta to translation', () => {
      const current: ZoomTransform = { x: 0, y: 0, k: 1 };
      const result = pan(current, 50, -30);

      expect(result.x).toBe(50);
      expect(result.y).toBe(-30);
      expect(result.k).toBe(1);
    });

    it('respects pan bounds', () => {
      const current: ZoomTransform = { x: 0, y: 0, k: 1 };
      const bounds = { x: [-100, 100] as [number, number], y: [-50, 50] as [number, number] };

      const result = pan(current, 200, 200, bounds);
      expect(result.x).toBe(100);
      expect(result.y).toBe(50);
    });
  });

  describe('panTo', () => {
    it('sets translation directly', () => {
      const current: ZoomTransform = { x: 50, y: 50, k: 2 };
      const result = panTo(current, 100, 200);

      expect(result.x).toBe(100);
      expect(result.y).toBe(200);
      expect(result.k).toBe(2);
    });
  });

  describe('centerOn', () => {
    it('centers point in viewport', () => {
      const current: ZoomTransform = { x: 0, y: 0, k: 1 };
      const point: Point = { x: 100, y: 100 };
      const viewport = { width: 800, height: 600 };
      const result = centerOn(current, point, viewport);

      // Point (100, 100) should be at center of viewport (400, 300)
      // screen = data * k + x => 400 = 100 * 1 + x => x = 300
      expect(result.x).toBe(300);
      expect(result.y).toBe(200);
    });
  });

  // ==========================================================================
  // Utility Operations Tests
  // ==========================================================================

  describe('resetZoom', () => {
    it('returns identity transform', () => {
      const result = resetZoom();
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
      expect(result.k).toBe(1);
    });

    it('returns new object each time', () => {
      const result1 = resetZoom();
      const result2 = resetZoom();
      expect(result1).not.toBe(result2);
    });
  });

  describe('isIdentity', () => {
    it('returns true for identity transform', () => {
      expect(isIdentity(identityTransform)).toBe(true);
      expect(isIdentity({ x: 0, y: 0, k: 1 })).toBe(true);
    });

    it('returns false for non-identity transforms', () => {
      expect(isIdentity({ x: 1, y: 0, k: 1 })).toBe(false);
      expect(isIdentity({ x: 0, y: 1, k: 1 })).toBe(false);
      expect(isIdentity({ x: 0, y: 0, k: 2 })).toBe(false);
    });
  });

  describe('interpolateTransform', () => {
    const from: ZoomTransform = { x: 0, y: 0, k: 1 };
    const to: ZoomTransform = { x: 100, y: 200, k: 2 };

    it('returns from at t=0', () => {
      const result = interpolateTransform(from, to, 0);
      expect(result).toEqual(from);
    });

    it('returns to at t=1', () => {
      const result = interpolateTransform(from, to, 1);
      expect(result).toEqual(to);
    });

    it('returns midpoint at t=0.5', () => {
      const result = interpolateTransform(from, to, 0.5);
      expect(result.x).toBe(50);
      expect(result.y).toBe(100);
      expect(result.k).toBe(1.5);
    });
  });

  describe('composeTransforms', () => {
    it('composes identity transforms', () => {
      const result = composeTransforms(identityTransform, identityTransform);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
      expect(result.k).toBe(1);
    });

    it('composes scale transforms', () => {
      const a: ZoomTransform = { x: 0, y: 0, k: 2 };
      const b: ZoomTransform = { x: 0, y: 0, k: 3 };
      const result = composeTransforms(a, b);
      expect(result.k).toBe(6);
    });

    it('composes translation and scale', () => {
      const a: ZoomTransform = { x: 10, y: 20, k: 2 };
      const b: ZoomTransform = { x: 5, y: 10, k: 1 };
      const result = composeTransforms(a, b);
      // composed.k = a.k * b.k = 2
      // composed.x = a.x + a.k * b.x = 10 + 2 * 5 = 20
      // composed.y = a.y + a.k * b.y = 20 + 2 * 10 = 40
      expect(result.k).toBe(2);
      expect(result.x).toBe(20);
      expect(result.y).toBe(40);
    });
  });

  describe('invertTransform', () => {
    it('inverts identity to identity', () => {
      const result = invertTransform(identityTransform);
      // Using toBeCloseTo to handle -0 vs 0
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
      expect(result.k).toBe(1);
    });

    it('inverts and roundtrips', () => {
      const transform: ZoomTransform = { x: 50, y: -30, k: 2 };
      const inverted = invertTransform(transform);
      const composed = composeTransforms(transform, inverted);

      expect(composed.x).toBeCloseTo(0, 10);
      expect(composed.y).toBeCloseTo(0, 10);
      expect(composed.k).toBeCloseTo(1, 10);
    });
  });

  // ==========================================================================
  // Wheel Zoom Tests
  // ==========================================================================

  describe('wheelDeltaToScaleFactor', () => {
    it('returns > 1 for negative delta (scroll up = zoom in)', () => {
      const factor = wheelDeltaToScaleFactor(-100);
      expect(factor).toBeGreaterThan(1);
    });

    it('returns < 1 for positive delta (scroll down = zoom out)', () => {
      const factor = wheelDeltaToScaleFactor(100);
      expect(factor).toBeLessThan(1);
    });

    it('returns 1 for zero delta', () => {
      const factor = wheelDeltaToScaleFactor(0);
      expect(factor).toBe(1);
    });

    it('respects sensitivity', () => {
      const lowSensitivity = wheelDeltaToScaleFactor(-100, 0.001);
      const highSensitivity = wheelDeltaToScaleFactor(-100, 0.01);
      expect(highSensitivity).toBeGreaterThan(lowSensitivity);
    });
  });

  describe('pinchScaleToScaleFactor', () => {
    it('returns the pinch scale directly', () => {
      expect(pinchScaleToScaleFactor(1.5)).toBe(1.5);
      expect(pinchScaleToScaleFactor(0.75)).toBe(0.75);
    });
  });

  // ==========================================================================
  // Constraint Tests
  // ==========================================================================

  describe('constrainScale', () => {
    it('clamps scale to limits', () => {
      const limits = { minK: 0.5, maxK: 3 };

      const tooSmall: ZoomTransform = { x: 0, y: 0, k: 0.1 };
      expect(constrainScale(tooSmall, limits).k).toBe(0.5);

      const tooBig: ZoomTransform = { x: 0, y: 0, k: 10 };
      expect(constrainScale(tooBig, limits).k).toBe(3);

      const valid: ZoomTransform = { x: 0, y: 0, k: 2 };
      expect(constrainScale(valid, limits).k).toBe(2);
    });

    it('returns same object if unchanged', () => {
      const limits = { minK: 0.5, maxK: 3 };
      const valid: ZoomTransform = { x: 0, y: 0, k: 2 };
      expect(constrainScale(valid, limits)).toBe(valid);
    });
  });

  describe('constrainPan', () => {
    it('clamps translation to bounds', () => {
      const bounds = { x: [-100, 100] as [number, number], y: [-50, 50] as [number, number] };

      const outOfBounds: ZoomTransform = { x: 200, y: -100, k: 1 };
      const result = constrainPan(outOfBounds, bounds);
      expect(result.x).toBe(100);
      expect(result.y).toBe(-50);
    });

    it('returns same object if unchanged', () => {
      const bounds = { x: [-100, 100] as [number, number], y: [-50, 50] as [number, number] };
      const valid: ZoomTransform = { x: 0, y: 0, k: 1 };
      expect(constrainPan(valid, bounds)).toBe(valid);
    });
  });

  describe('constrainTransform', () => {
    it('applies both scale and pan constraints', () => {
      const limits = { minK: 0.5, maxK: 3 };
      const bounds = { x: [-100, 100] as [number, number], y: [-50, 50] as [number, number] };

      const outOfBounds: ZoomTransform = { x: 200, y: -100, k: 10 };
      const result = constrainTransform(outOfBounds, limits, bounds);

      expect(result.k).toBe(3);
      expect(result.x).toBe(100);
      expect(result.y).toBe(-50);
    });

    it('works with only limits', () => {
      const limits = { minK: 0.5, maxK: 3 };
      const transform: ZoomTransform = { x: 200, y: -100, k: 10 };
      const result = constrainTransform(transform, limits);

      expect(result.k).toBe(3);
      expect(result.x).toBe(200); // Not constrained
    });

    it('works with only bounds', () => {
      const bounds = { x: [-100, 100] as [number, number], y: [-50, 50] as [number, number] };
      const transform: ZoomTransform = { x: 200, y: -100, k: 10 };
      const result = constrainTransform(transform, undefined, bounds);

      expect(result.k).toBe(10); // Not constrained
      expect(result.x).toBe(100);
    });
  });
});
