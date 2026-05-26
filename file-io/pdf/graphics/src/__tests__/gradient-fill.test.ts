import type { ContentOp } from '../content-ops';
import type { GradientStop } from '../gradient-fill';
import {
  generateLinearGradientOps,
  generateRadialGradientOps,
  interpolateStops,
  linearAngleToCoords,
  ShadingCache,
} from '../gradient-fill';

describe('Gradient Fill', () => {
  // ── linearAngleToCoords ─────────────────────────────────────────

  describe('linearAngleToCoords', () => {
    const x = 0,
      y = 0,
      w = 100,
      h = 100;

    it('0 degrees: left to right', () => {
      const [x0, y0, x1, y1] = linearAngleToCoords(0, x, y, w, h);
      expect(x0).toBeCloseTo(0, 1);
      expect(x1).toBeCloseTo(100, 1);
      // Y should be at center
      expect(y0).toBeCloseTo(50, 1);
      expect(y1).toBeCloseTo(50, 1);
    });

    it('90 degrees: bottom to top', () => {
      const [x0, y0, x1, y1] = linearAngleToCoords(90, x, y, w, h);
      // X should be at center
      expect(x0).toBeCloseTo(50, 1);
      expect(x1).toBeCloseTo(50, 1);
      // Y should go from bottom to top
      expect(y0).toBeGreaterThan(y1);
    });

    it('180 degrees: right to left', () => {
      const [x0, y0, x1, y1] = linearAngleToCoords(180, x, y, w, h);
      expect(x0).toBeCloseTo(100, 1);
      expect(x1).toBeCloseTo(0, 1);
      expect(y0).toBeCloseTo(50, 1);
      expect(y1).toBeCloseTo(50, 1);
    });

    it('270 degrees: top to bottom', () => {
      const [x0, y0, x1, y1] = linearAngleToCoords(270, x, y, w, h);
      expect(x0).toBeCloseTo(50, 1);
      expect(x1).toBeCloseTo(50, 1);
      expect(y0).toBeLessThan(y1);
    });

    it('45 degrees: diagonal', () => {
      const [x0, y0, x1, y1] = linearAngleToCoords(45, x, y, w, h);
      // Should go from bottom-left toward top-right
      expect(x0).toBeLessThan(x1);
      expect(y0).toBeGreaterThan(y1);
    });

    it('handles non-square bounding box', () => {
      const [x0, y0, x1, y1] = linearAngleToCoords(0, 10, 20, 200, 50);
      // Left to right: x0 near left edge, x1 near right edge
      expect(x0).toBeCloseTo(10, 1);
      expect(x1).toBeCloseTo(210, 1);
      // Y at center
      expect(y0).toBeCloseTo(45, 1);
      expect(y1).toBeCloseTo(45, 1);
    });

    it('handles negative angles by normalizing', () => {
      const [x0a, y0a, x1a, y1a] = linearAngleToCoords(-90, x, y, w, h);
      const [x0b, y0b, x1b, y1b] = linearAngleToCoords(270, x, y, w, h);
      expect(x0a).toBeCloseTo(x0b, 5);
      expect(y0a).toBeCloseTo(y0b, 5);
      expect(x1a).toBeCloseTo(x1b, 5);
      expect(y1a).toBeCloseTo(y1b, 5);
    });
  });

  // ── interpolateStops ────────────────────────────────────────────

  describe('interpolateStops', () => {
    const twoStops: GradientStop[] = [
      { position: 0, color: [0, 0, 0] },
      { position: 1, color: [1, 1, 1] },
    ];

    it('returns first color at t=0', () => {
      const c = interpolateStops(twoStops, 0);
      expect(c).toEqual([0, 0, 0]);
    });

    it('returns last color at t=1', () => {
      const c = interpolateStops(twoStops, 1);
      expect(c).toEqual([1, 1, 1]);
    });

    it('returns midpoint at t=0.5', () => {
      const c = interpolateStops(twoStops, 0.5);
      expect(c[0]).toBeCloseTo(0.5, 5);
      expect(c[1]).toBeCloseTo(0.5, 5);
      expect(c[2]).toBeCloseTo(0.5, 5);
    });

    it('clamps below first stop', () => {
      const c = interpolateStops(twoStops, -0.5);
      expect(c).toEqual([0, 0, 0]);
    });

    it('clamps above last stop', () => {
      const c = interpolateStops(twoStops, 1.5);
      expect(c).toEqual([1, 1, 1]);
    });

    it('handles multi-stop gradients', () => {
      const stops: GradientStop[] = [
        { position: 0, color: [1, 0, 0] }, // red
        { position: 0.5, color: [0, 1, 0] }, // green
        { position: 1, color: [0, 0, 1] }, // blue
      ];

      const atQuarter = interpolateStops(stops, 0.25);
      expect(atQuarter[0]).toBeCloseTo(0.5, 5);
      expect(atQuarter[1]).toBeCloseTo(0.5, 5);
      expect(atQuarter[2]).toBeCloseTo(0, 5);

      const atHalf = interpolateStops(stops, 0.5);
      expect(atHalf).toEqual([0, 1, 0]);

      const at75 = interpolateStops(stops, 0.75);
      expect(at75[0]).toBeCloseTo(0, 5);
      expect(at75[1]).toBeCloseTo(0.5, 5);
      expect(at75[2]).toBeCloseTo(0.5, 5);
    });

    it('handles single stop', () => {
      const c = interpolateStops([{ position: 0.5, color: [1, 0, 0] }], 0.8);
      expect(c).toEqual([1, 0, 0]);
    });

    it('handles empty stops', () => {
      const c = interpolateStops([], 0.5);
      expect(c).toEqual([0, 0, 0]);
    });
  });

  // ── generateLinearGradientOps ───────────────────────────────────

  describe('generateLinearGradientOps', () => {
    it('returns empty for fewer than 2 stops', () => {
      const ops = generateLinearGradientOps(
        { angle: 0, stops: [{ position: 0, color: [1, 0, 0] }] },
        0,
        0,
        100,
        100,
      );
      expect(ops).toEqual([]);
    });

    it('generates SaveState/RestoreState wrapper', () => {
      const ops = generateLinearGradientOps(
        {
          angle: 0,
          stops: [
            { position: 0, color: [1, 0, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
        0,
        0,
        100,
        100,
      );
      expect(ops[0]).toEqual({ op: 'SaveState' });
      expect(ops[ops.length - 1]).toEqual({ op: 'RestoreState' });
    });

    it('clips to bounding box', () => {
      const ops = generateLinearGradientOps(
        {
          angle: 0,
          stops: [
            { position: 0, color: [1, 0, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
        10,
        20,
        100,
        50,
      );
      expect(ops).toContainEqual({ op: 'Rectangle', x: 10, y: 20, w: 100, h: 50 });
      expect(ops).toContainEqual({ op: 'ClipNonZero' });
    });

    it('generates multiple color bands', () => {
      const ops = generateLinearGradientOps(
        {
          angle: 0,
          stops: [
            { position: 0, color: [1, 0, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
        0,
        0,
        100,
        100,
      );
      const fillOps = ops.filter((o) => o.op === 'Fill');
      expect(fillOps.length).toBeGreaterThan(10); // 64 bands
    });

    it('generates gradient from red to blue', () => {
      const ops = generateLinearGradientOps(
        {
          angle: 0,
          stops: [
            { position: 0, color: [1, 0, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
        0,
        0,
        100,
        100,
      );
      const colorOps = ops.filter(
        (o): o is Extract<ContentOp, { op: 'SetFillColorRGB' }> => o.op === 'SetFillColorRGB',
      );
      // First band should be mostly red
      expect(colorOps[0].r).toBeGreaterThan(0.9);
      expect(colorOps[0].b).toBeLessThan(0.1);
      // Last band should be mostly blue
      const last = colorOps[colorOps.length - 1];
      expect(last.r).toBeLessThan(0.1);
      expect(last.b).toBeGreaterThan(0.9);
    });

    it('works at 90 degree angle', () => {
      const ops = generateLinearGradientOps(
        {
          angle: 90,
          stops: [
            { position: 0, color: [1, 1, 1] },
            { position: 1, color: [0, 0, 0] },
          ],
        },
        0,
        0,
        100,
        100,
      );
      expect(ops.length).toBeGreaterThan(0);
      const fillOps = ops.filter((o) => o.op === 'Fill');
      expect(fillOps.length).toBeGreaterThan(10);
    });

    it('handles multi-stop gradient', () => {
      const ops = generateLinearGradientOps(
        {
          angle: 0,
          stops: [
            { position: 0, color: [1, 0, 0] },
            { position: 0.5, color: [0, 1, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
        0,
        0,
        100,
        100,
      );
      // Middle bands should have green
      const colorOps = ops.filter(
        (o): o is Extract<ContentOp, { op: 'SetFillColorRGB' }> => o.op === 'SetFillColorRGB',
      );
      const midIdx = Math.floor(colorOps.length / 2);
      expect(colorOps[midIdx].g).toBeGreaterThan(0.4);
    });
  });

  // -- Zero-length gradient axis (division by zero guard) ----------------

  describe('zero-length gradient axis', () => {
    it('returns solid fill ops when bounding box has zero width and height', () => {
      const ops = generateLinearGradientOps(
        {
          angle: 0,
          stops: [
            { position: 0, color: [1, 0, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
        10,
        20,
        0,
        0,
      );
      expect(ops.length).toBeGreaterThan(0);
      expect(ops[0]).toEqual({ op: 'SaveState' });
      expect(ops[ops.length - 1]).toEqual({ op: 'RestoreState' });
      const colorOp = ops.find(
        (o): o is Extract<ContentOp, { op: 'SetFillColorRGB' }> => o.op === 'SetFillColorRGB',
      );
      expect(colorOp).toBeDefined();
      if (colorOp) {
        expect(colorOp.r).toBe(1);
        expect(colorOp.g).toBe(0);
        expect(colorOp.b).toBe(0);
      }
      const fillOps = ops.filter((o) => o.op === 'Fill');
      expect(fillOps.length).toBe(1);
    });

    it('does not crash with a single-pixel bounding box', () => {
      const ops = generateLinearGradientOps(
        {
          angle: 45,
          stops: [
            { position: 0, color: [0.5, 0.5, 0.5] },
            { position: 1, color: [1, 1, 1] },
          ],
        },
        5,
        5,
        1,
        1,
      );
      expect(ops.length).toBeGreaterThan(0);
      const hasNaN = ops.some((o) => {
        return Object.values(o).some((v) => typeof v === 'number' && Number.isNaN(v));
      });
      expect(hasNaN).toBe(false);
    });
  });

  // ── generateRadialGradientOps ───────────────────────────────────

  describe('generateRadialGradientOps', () => {
    it('returns empty for fewer than 2 stops', () => {
      const ops = generateRadialGradientOps(
        { centerX: 0.5, centerY: 0.5, stops: [{ position: 0, color: [1, 0, 0] }] },
        0,
        0,
        100,
        100,
      );
      expect(ops).toEqual([]);
    });

    it('generates SaveState/RestoreState wrapper', () => {
      const ops = generateRadialGradientOps(
        {
          centerX: 0.5,
          centerY: 0.5,
          stops: [
            { position: 0, color: [1, 0, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
        0,
        0,
        100,
        100,
      );
      expect(ops[0]).toEqual({ op: 'SaveState' });
      expect(ops[ops.length - 1]).toEqual({ op: 'RestoreState' });
    });

    it('clips to bounding box', () => {
      const ops = generateRadialGradientOps(
        {
          centerX: 0.5,
          centerY: 0.5,
          stops: [
            { position: 0, color: [1, 0, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
        10,
        20,
        100,
        50,
      );
      expect(ops).toContainEqual({ op: 'Rectangle', x: 10, y: 20, w: 100, h: 50 });
      expect(ops).toContainEqual({ op: 'ClipNonZero' });
    });

    it('generates concentric rings', () => {
      const ops = generateRadialGradientOps(
        {
          centerX: 0.5,
          centerY: 0.5,
          stops: [
            { position: 0, color: [1, 1, 1] },
            { position: 1, color: [0, 0, 0] },
          ],
        },
        0,
        0,
        100,
        100,
      );
      const fillOps = ops.filter((o) => o.op === 'Fill');
      expect(fillOps.length).toBeGreaterThan(10);
    });

    it('uses CurveTo ops for circle approximation', () => {
      const ops = generateRadialGradientOps(
        {
          centerX: 0.5,
          centerY: 0.5,
          stops: [
            { position: 0, color: [1, 0, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
        0,
        0,
        100,
        100,
      );
      const curveOps = ops.filter((o) => o.op === 'CurveTo');
      // Each ring uses 4 CurveTo ops, with 64 rings = 256 CurveTo ops
      expect(curveOps.length).toBeGreaterThanOrEqual(4);
    });

    it('handles off-center gradient', () => {
      const ops = generateRadialGradientOps(
        {
          centerX: 0.2,
          centerY: 0.8,
          stops: [
            { position: 0, color: [1, 0, 0] },
            { position: 1, color: [0, 0, 1] },
          ],
        },
        0,
        0,
        100,
        100,
      );
      expect(ops.length).toBeGreaterThan(0);
    });
  });

  // ── ShadingCache ────────────────────────────────────────────────

  describe('ShadingCache', () => {
    it('deduplicates identical shadings', () => {
      const cache = new ShadingCache();
      const def = {
        type: 2 as const,
        coords: [0, 50, 100, 50],
        stops: [
          { position: 0, color: [1, 0, 0] as [number, number, number] },
          { position: 1, color: [0, 0, 1] as [number, number, number] },
        ],
      };
      const s1 = cache.getOrCreate(def);
      const s2 = cache.getOrCreate(def);
      expect(s1.name).toBe(s2.name);
      expect(cache.getAll().length).toBe(1);
    });

    it('creates different entries for different shadings', () => {
      const cache = new ShadingCache();
      const s1 = cache.getOrCreate({
        type: 2,
        coords: [0, 50, 100, 50],
        stops: [
          { position: 0, color: [1, 0, 0] },
          { position: 1, color: [0, 0, 1] },
        ],
      });
      const s2 = cache.getOrCreate({
        type: 3,
        coords: [50, 50, 0, 50, 50, 70],
        stops: [
          { position: 0, color: [1, 0, 0] },
          { position: 1, color: [0, 0, 1] },
        ],
      });
      expect(s1.name).not.toBe(s2.name);
      expect(cache.getAll().length).toBe(2);
    });

    it('assigns sequential names', () => {
      const cache = new ShadingCache();
      const s1 = cache.getOrCreate({
        type: 2,
        coords: [0, 0, 100, 0],
        stops: [
          { position: 0, color: [1, 0, 0] },
          { position: 1, color: [0, 0, 1] },
        ],
      });
      const s2 = cache.getOrCreate({
        type: 2,
        coords: [0, 0, 0, 100],
        stops: [
          { position: 0, color: [1, 0, 0] },
          { position: 1, color: [0, 1, 0] },
        ],
      });
      expect(s1.name).toBe('Sh0');
      expect(s2.name).toBe('Sh1');
    });

    it('clear resets the cache', () => {
      const cache = new ShadingCache();
      cache.getOrCreate({
        type: 2,
        coords: [0, 0, 100, 0],
        stops: [
          { position: 0, color: [1, 0, 0] },
          { position: 1, color: [0, 0, 1] },
        ],
      });
      cache.clear();
      expect(cache.getAll().length).toBe(0);
    });
  });
});
