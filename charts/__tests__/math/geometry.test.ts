/**
 * Unit tests for geometry.ts math utilities
 *
 * Tests cover:
 * - Point operations (distance, midpoint, lerp, rotate, scale, translate)
 * - Bounding box operations
 * - SVG path generation
 * - Bezier curve utilities
 * - Statistical chart geometry (violin, box plot)
 * - Arc and slice paths
 */

import {
  arcPath,
  areaPath,
  boundingBox,
  boxesIntersect,
  boxPlotBoxPath,
  boxPlotMedianPath,
  boxPlotWhiskerPaths,
  cartesianToPolar,
  catmullRomToBezier,
  distance,
  evaluateBezier,
  expandBox,
  heatmapCells,
  histogramBars,
  lerp,
  linePath,
  midpoint,
  pointInBox,
  polarToCartesian,
  polygonPath,
  rotatePoint,
  sampleBezier,
  scalePoint,
  slicePath,
  smoothCurvePath,
  translatePoint,
  violinPath,
  type BoundingBox,
  type BoxPlotGeometry,
  type Point2D,
} from '../../src/math/geometry';

describe('Point Operations', () => {
  describe('distance', () => {
    it('should calculate distance between two points', () => {
      expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
      expect(distance({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1);
      expect(distance({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(1);
    });

    it('should return 0 for same point', () => {
      expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
    });

    it('should handle negative coordinates', () => {
      expect(distance({ x: -3, y: 0 }, { x: 0, y: 4 })).toBe(5);
    });
  });

  describe('midpoint', () => {
    it('should calculate midpoint', () => {
      const mid = midpoint({ x: 0, y: 0 }, { x: 10, y: 10 });
      expect(mid.x).toBe(5);
      expect(mid.y).toBe(5);
    });

    it('should handle negative coordinates', () => {
      const mid = midpoint({ x: -10, y: 0 }, { x: 10, y: 0 });
      expect(mid.x).toBe(0);
      expect(mid.y).toBe(0);
    });
  });

  describe('lerp', () => {
    it('should interpolate at t=0', () => {
      const result = lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('should interpolate at t=1', () => {
      const result = lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 1);
      expect(result.x).toBe(10);
      expect(result.y).toBe(20);
    });

    it('should interpolate at t=0.5', () => {
      const result = lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(10);
    });

    it('should extrapolate for t > 1', () => {
      const result = lerp({ x: 0, y: 0 }, { x: 10, y: 10 }, 2);
      expect(result.x).toBe(20);
      expect(result.y).toBe(20);
    });
  });

  describe('rotatePoint', () => {
    it('should rotate 90 degrees', () => {
      const result = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
      expect(result.x).toBeCloseTo(0, 10);
      expect(result.y).toBeCloseTo(1, 10);
    });

    it('should rotate 180 degrees', () => {
      const result = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI);
      expect(result.x).toBeCloseTo(-1, 10);
      expect(result.y).toBeCloseTo(0, 10);
    });

    it('should rotate around non-origin', () => {
      const result = rotatePoint({ x: 2, y: 1 }, { x: 1, y: 1 }, Math.PI / 2);
      expect(result.x).toBeCloseTo(1, 10);
      expect(result.y).toBeCloseTo(2, 10);
    });
  });

  describe('scalePoint', () => {
    it('should scale uniformly', () => {
      const result = scalePoint({ x: 2, y: 3 }, { x: 0, y: 0 }, 2);
      expect(result.x).toBe(4);
      expect(result.y).toBe(6);
    });

    it('should scale non-uniformly', () => {
      const result = scalePoint({ x: 2, y: 3 }, { x: 0, y: 0 }, 2, 3);
      expect(result.x).toBe(4);
      expect(result.y).toBe(9);
    });

    it('should scale around non-origin', () => {
      const result = scalePoint({ x: 3, y: 3 }, { x: 1, y: 1 }, 2);
      expect(result.x).toBe(5); // 1 + 2*(3-1) = 5
      expect(result.y).toBe(5);
    });
  });

  describe('translatePoint', () => {
    it('should translate point', () => {
      const result = translatePoint({ x: 1, y: 2 }, 5, 10);
      expect(result.x).toBe(6);
      expect(result.y).toBe(12);
    });

    it('should handle negative translation', () => {
      const result = translatePoint({ x: 10, y: 10 }, -5, -5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(5);
    });
  });
});

describe('Bounding Box Operations', () => {
  describe('boundingBox', () => {
    it('should calculate bounding box', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 5, y: 10 },
      ];
      const box = boundingBox(points);
      expect(box.x).toBe(0);
      expect(box.y).toBe(0);
      expect(box.width).toBe(10);
      expect(box.height).toBe(10);
    });

    it('should handle empty points', () => {
      const box = boundingBox([]);
      expect(box.width).toBe(0);
      expect(box.height).toBe(0);
    });

    it('should handle single point', () => {
      const box = boundingBox([{ x: 5, y: 5 }]);
      expect(box.x).toBe(5);
      expect(box.y).toBe(5);
      expect(box.width).toBe(0);
      expect(box.height).toBe(0);
    });
  });

  describe('pointInBox', () => {
    const box: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };

    it('should return true for point inside', () => {
      expect(pointInBox({ x: 5, y: 5 }, box)).toBe(true);
    });

    it('should return true for point on edge', () => {
      expect(pointInBox({ x: 0, y: 0 }, box)).toBe(true);
      expect(pointInBox({ x: 10, y: 10 }, box)).toBe(true);
    });

    it('should return false for point outside', () => {
      expect(pointInBox({ x: -1, y: 5 }, box)).toBe(false);
      expect(pointInBox({ x: 11, y: 5 }, box)).toBe(false);
    });
  });

  describe('boxesIntersect', () => {
    it('should detect overlapping boxes', () => {
      const a: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
      const b: BoundingBox = { x: 5, y: 5, width: 10, height: 10 };
      expect(boxesIntersect(a, b)).toBe(true);
    });

    it('should detect non-overlapping boxes', () => {
      const a: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
      const b: BoundingBox = { x: 20, y: 20, width: 10, height: 10 };
      expect(boxesIntersect(a, b)).toBe(false);
    });

    it('should detect adjacent boxes as non-intersecting', () => {
      const a: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
      const b: BoundingBox = { x: 10, y: 0, width: 10, height: 10 };
      expect(boxesIntersect(a, b)).toBe(false);
    });
  });

  describe('expandBox', () => {
    it('should expand box by padding', () => {
      const box: BoundingBox = { x: 10, y: 10, width: 20, height: 20 };
      const expanded = expandBox(box, 5);
      expect(expanded.x).toBe(5);
      expect(expanded.y).toBe(5);
      expect(expanded.width).toBe(30);
      expect(expanded.height).toBe(30);
    });
  });
});

describe('SVG Path Generation', () => {
  describe('linePath', () => {
    it('should generate line path', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 5 },
      ];
      const path = linePath(points);
      expect(path).toBe('M0,0 L10,10 L20,5');
    });

    it('should handle empty points', () => {
      expect(linePath([])).toBe('');
    });

    it('should handle single point', () => {
      expect(linePath([{ x: 5, y: 5 }])).toBe('M5,5');
    });
  });

  describe('polygonPath', () => {
    it('should generate closed polygon path', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      const path = polygonPath(points);
      expect(path).toContain('M0,0');
      expect(path).toContain('Z');
    });

    it('should handle less than 3 points', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ];
      expect(polygonPath(points)).not.toContain('Z');
    });
  });

  describe('areaPath', () => {
    it('should generate area path with baseline', () => {
      const points: Point2D[] = [
        { x: 0, y: 50 },
        { x: 10, y: 30 },
        { x: 20, y: 40 },
      ];
      const path = areaPath(points, 100);
      expect(path).toContain('M0,100'); // Start at baseline
      expect(path).toContain('Z'); // Closed path
    });

    it('should handle empty points', () => {
      expect(areaPath([], 100)).toBe('');
    });
  });

  describe('smoothCurvePath', () => {
    it('should generate smooth curve', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 5 },
        { x: 30, y: 15 },
      ];
      const path = smoothCurvePath(points);
      expect(path).toContain('M');
      // Should contain curve commands
      expect(path.length).toBeGreaterThan(linePath(points).length);
    });

    it('should fall back to line path for few points', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ];
      const path = smoothCurvePath(points);
      expect(path).toBe(linePath(points));
    });
  });
});

describe('Bezier Utilities', () => {
  describe('catmullRomToBezier', () => {
    it('should convert Catmull-Rom to Bezier', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 5 },
        { x: 30, y: 15 },
      ];
      const beziers = catmullRomToBezier(points);
      expect(beziers.length).toBeGreaterThan(0);
      beziers.forEach((b) => {
        expect(b.p0).toBeDefined();
        expect(b.p1).toBeDefined();
        expect(b.p2).toBeDefined();
        expect(b.p3).toBeDefined();
      });
    });

    it('should return empty for less than 4 points', () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 5 },
      ];
      expect(catmullRomToBezier(points)).toHaveLength(0);
    });
  });

  describe('evaluateBezier', () => {
    it('should evaluate at t=0 and t=1', () => {
      const bezier = {
        p0: { x: 0, y: 0 },
        p1: { x: 0, y: 10 },
        p2: { x: 10, y: 10 },
        p3: { x: 10, y: 0 },
      };

      const start = evaluateBezier(bezier, 0);
      expect(start.x).toBeCloseTo(0, 10);
      expect(start.y).toBeCloseTo(0, 10);

      const end = evaluateBezier(bezier, 1);
      expect(end.x).toBeCloseTo(10, 10);
      expect(end.y).toBeCloseTo(0, 10);
    });

    it('should interpolate smoothly', () => {
      const bezier = {
        p0: { x: 0, y: 0 },
        p1: { x: 5, y: 0 },
        p2: { x: 5, y: 10 },
        p3: { x: 10, y: 10 },
      };

      const mid = evaluateBezier(bezier, 0.5);
      expect(mid.x).toBeGreaterThan(0);
      expect(mid.x).toBeLessThan(10);
    });
  });

  describe('sampleBezier', () => {
    it('should sample specified number of points', () => {
      const bezier = {
        p0: { x: 0, y: 0 },
        p1: { x: 5, y: 0 },
        p2: { x: 5, y: 10 },
        p3: { x: 10, y: 10 },
      };

      const samples = sampleBezier(bezier, 10);
      expect(samples).toHaveLength(11); // numPoints + 1
    });
  });
});

describe('Box Plot Geometry', () => {
  const geom: BoxPlotGeometry = {
    centerX: 100,
    boxWidth: 40,
    q1Y: 80,
    medianY: 60,
    q3Y: 40,
    lowerWhiskerY: 100,
    upperWhiskerY: 20,
    outlierYs: [120, 10],
  };

  describe('boxPlotBoxPath', () => {
    it('should generate box path', () => {
      const path = boxPlotBoxPath(geom);
      expect(path).toContain('M');
      expect(path).toContain('Z');
      // Should be a closed rectangle
    });
  });

  describe('boxPlotMedianPath', () => {
    it('should generate median line path', () => {
      const path = boxPlotMedianPath(geom);
      expect(path).toContain('M');
      expect(path).toContain('L');
      // Should be a horizontal line
    });
  });

  describe('boxPlotWhiskerPaths', () => {
    it('should generate whisker paths', () => {
      const [lower, upper] = boxPlotWhiskerPaths(geom);
      expect(lower).toContain('M');
      expect(upper).toContain('M');
    });
  });
});

describe('Arc and Slice Utilities', () => {
  describe('polarToCartesian', () => {
    it('should convert polar to Cartesian', () => {
      const result = polarToCartesian(0, 0, 10, 0);
      expect(result.x).toBeCloseTo(10, 10);
      expect(result.y).toBeCloseTo(0, 10);
    });

    it('should handle 90 degree angle', () => {
      const result = polarToCartesian(0, 0, 10, Math.PI / 2);
      expect(result.x).toBeCloseTo(0, 10);
      expect(result.y).toBeCloseTo(10, 10);
    });
  });

  describe('cartesianToPolar', () => {
    it('should convert Cartesian to polar', () => {
      const result = cartesianToPolar(0, 0, 10, 0);
      expect(result.radius).toBeCloseTo(10, 10);
      expect(result.angle).toBeCloseTo(0, 10);
    });

    it('should handle point at 45 degrees', () => {
      const result = cartesianToPolar(0, 0, 10, 10);
      expect(result.radius).toBeCloseTo(Math.sqrt(200), 10);
      expect(result.angle).toBeCloseTo(Math.PI / 4, 10);
    });
  });

  describe('arcPath', () => {
    it('should generate arc path', () => {
      const path = arcPath(100, 100, 50, 0, Math.PI / 2);
      expect(path).toContain('M');
      expect(path).toContain('A');
    });
  });

  describe('slicePath', () => {
    it('should generate pie slice (innerRadius=0)', () => {
      const path = slicePath(100, 100, 0, 50, 0, Math.PI / 2);
      expect(path).toContain('M100,100'); // Center point
      expect(path).toContain('Z');
    });

    it('should generate doughnut slice (innerRadius>0)', () => {
      const path = slicePath(100, 100, 25, 50, 0, Math.PI / 2);
      expect(path).not.toContain('M100,100'); // No center point
      expect(path).toContain('Z');
    });
  });
});

describe('Histogram and Heatmap Utilities', () => {
  describe('histogramBars', () => {
    it('should generate histogram bars', () => {
      const bins = [
        { x0: 0, x1: 10, count: 5 },
        { x0: 10, x1: 20, count: 10 },
        { x0: 20, x1: 30, count: 3 },
      ];
      const scaleX = (v: number) => v * 2;
      const scaleY = (v: number) => 100 - v * 5;
      const baseline = 100;

      const bars = histogramBars(bins, scaleX, scaleY, baseline);

      expect(bars).toHaveLength(3);
      bars.forEach((bar) => {
        expect(bar.x).toBeGreaterThanOrEqual(0);
        expect(bar.width).toBeGreaterThan(0);
        expect(bar.height).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('heatmapCells', () => {
    it('should generate heatmap cells from matrix', () => {
      const matrix = [
        [1, 2, 3],
        [4, 5, 6],
      ];

      const cells = heatmapCells(matrix, 50, 30, 10, 10);

      expect(cells).toHaveLength(6);
      expect(cells[0]).toEqual({
        x: 10,
        y: 10,
        width: 50,
        height: 30,
        value: 1,
        row: 0,
        col: 0,
      });
      expect(cells[5]).toEqual({
        x: 110, // 10 + 2*50
        y: 40, // 10 + 1*30
        width: 50,
        height: 30,
        value: 6,
        row: 1,
        col: 2,
      });
    });

    it('should handle empty matrix', () => {
      const cells = heatmapCells([], 50, 30);
      expect(cells).toHaveLength(0);
    });
  });
});

describe('Violin Path', () => {
  it('should generate violin path from KDE', () => {
    const kdeX = [0, 1, 2, 3, 4, 5];
    const kdeY = [0.1, 0.3, 0.5, 0.5, 0.3, 0.1];
    const scaleY = (v: number) => 100 - v * 10;

    const path = violinPath(kdeX, kdeY, 100, scaleY, 40);

    expect(path).toContain('M');
    expect(path).toContain('Z'); // Closed path
  });

  it('should return empty for empty KDE', () => {
    const path = violinPath([], [], 100, (v) => v, 40);
    expect(path).toBe('');
  });
});
