/**
 * Tests for Pick Utilities
 */

import {
  distanceToMark,
  pickAllMarks,
  pickClosestMark,
  pickMark,
  pickMarksInRadius,
  pointInMark,
  signedDistanceToMark,
} from '../../src/interaction/pick';
import { hitTestArc } from '../../src/primitives/marks/arc';
import type {
  AnyMark,
  ArcMark,
  PathMark,
  RectMark,
  SymbolMark,
  TextMark,
} from '../../src/primitives/types';

describe('pick utilities', () => {
  // ==========================================================================
  // Point-in-Mark Tests
  // ==========================================================================

  describe('pointInMark', () => {
    describe('rect marks', () => {
      const rect: RectMark = {
        type: 'rect',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        style: {},
        datum: { id: 1 },
      };

      it('returns true for point inside rect', () => {
        expect(pointInMark(50, 40, rect)).toBe(true);
      });

      it('returns true for point on edge', () => {
        expect(pointInMark(10, 20, rect)).toBe(true); // top-left
        expect(pointInMark(110, 70, rect)).toBe(true); // bottom-right
      });

      it('returns false for point outside rect', () => {
        expect(pointInMark(5, 40, rect)).toBe(false);
        expect(pointInMark(115, 40, rect)).toBe(false);
        expect(pointInMark(50, 15, rect)).toBe(false);
        expect(pointInMark(50, 75, rect)).toBe(false);
      });
    });

    describe('symbol marks', () => {
      const circle: SymbolMark = {
        type: 'symbol',
        x: 50,
        y: 50,
        size: Math.PI * 100, // radius = 10
        shape: 'circle',
        style: {},
        datum: { id: 1 },
      };

      it('returns true for point inside circle', () => {
        expect(pointInMark(50, 50, circle)).toBe(true); // center
        expect(pointInMark(55, 50, circle)).toBe(true); // right of center
      });

      it('returns false for point outside circle', () => {
        expect(pointInMark(65, 50, circle)).toBe(false); // too far right
        expect(pointInMark(50, 65, circle)).toBe(false); // too far down
      });

      const square: SymbolMark = {
        type: 'symbol',
        x: 50,
        y: 50,
        size: 200,
        shape: 'square',
        style: {},
        datum: { id: 2 },
      };

      it('returns true for point inside square', () => {
        expect(pointInMark(50, 50, square)).toBe(true);
      });

      const diamond: SymbolMark = {
        type: 'symbol',
        x: 50,
        y: 50,
        size: 200,
        shape: 'diamond',
        style: {},
        datum: { id: 3 },
      };

      it('returns true for point inside diamond', () => {
        expect(pointInMark(50, 50, diamond)).toBe(true);
      });

      const cross: SymbolMark = {
        type: 'symbol',
        x: 50,
        y: 50,
        size: 200,
        shape: 'cross',
        style: {},
        datum: { id: 4 },
      };

      it('returns true for point inside cross', () => {
        expect(pointInMark(50, 50, cross)).toBe(true);
      });
    });

    describe('arc marks', () => {
      const pieSlice: ArcMark = {
        type: 'arc',
        x: 100,
        y: 100,
        innerRadius: 0,
        outerRadius: 50,
        startAngle: 0,
        endAngle: Math.PI / 2,
        style: {},
        datum: { id: 1 },
      };

      it('returns true for point inside arc', () => {
        // Point at PI/4 in 0-at-top convention (between top and right), radius 25
        // In 0-at-top: x = cx + sin(angle) * r, y = cy - cos(angle) * r
        const angle = Math.PI / 4;
        const px = 100 + Math.sin(angle) * 25;
        const py = 100 - Math.cos(angle) * 25;
        expect(pointInMark(px, py, pieSlice)).toBe(true);
      });

      it('returns false for point outside outer radius', () => {
        expect(pointInMark(160, 100, pieSlice)).toBe(false);
      });

      it('returns false for point in wrong angle', () => {
        // Point at 180 degrees (outside the arc's angle range)
        const px = 100 + Math.cos(Math.PI) * 25;
        const py = 100 + Math.sin(Math.PI) * 25;
        expect(pointInMark(px, py, pieSlice)).toBe(false);
      });

      const doughnutSlice: ArcMark = {
        type: 'arc',
        x: 100,
        y: 100,
        innerRadius: 20,
        outerRadius: 50,
        startAngle: 0,
        endAngle: Math.PI / 2,
        style: {},
        datum: { id: 2 },
      };

      it('returns false for point inside inner radius of doughnut', () => {
        expect(pointInMark(100, 100, doughnutSlice)).toBe(false);
      });
    });

    describe('text marks', () => {
      const text: TextMark = {
        type: 'text',
        x: 50,
        y: 50,
        text: 'Hello',
        fontSize: 12,
        fontFamily: 'sans-serif',
        textAlign: 'left',
        textBaseline: 'bottom',
        style: {},
        datum: { id: 1 },
      };

      it('returns true for point near text', () => {
        expect(pointInMark(60, 45, text)).toBe(true);
      });

      it('returns false for point far from text', () => {
        expect(pointInMark(200, 200, text)).toBe(false);
      });
    });

    describe('path marks', () => {
      it('returns true for point inside path bounding box', () => {
        const path: PathMark = {
          type: 'path',
          x: 0,
          y: 0,
          path: 'M10,10 L100,10 L100,100 L10,100 Z',
          style: {},
          datum: { id: 1 },
        };
        // Point at center of bounding box (55, 55) is inside [10,100] x [10,100]
        expect(pointInMark(55, 55, path)).toBe(true);
        // Point on edge
        expect(pointInMark(10, 10, path)).toBe(true);
        expect(pointInMark(100, 100, path)).toBe(true);
      });

      it('returns false for point outside path bounding box', () => {
        const path: PathMark = {
          type: 'path',
          x: 0,
          y: 0,
          path: 'M10,10 L100,10 L100,100 L10,100 Z',
          style: {},
          datum: { id: 1 },
        };
        expect(pointInMark(5, 55, path)).toBe(false); // left of bounds
        expect(pointInMark(105, 55, path)).toBe(false); // right of bounds
        expect(pointInMark(55, 5, path)).toBe(false); // above bounds
        expect(pointInMark(55, 105, path)).toBe(false); // below bounds
      });

      it('returns false for path with insufficient coordinates', () => {
        const path: PathMark = {
          type: 'path',
          x: 0,
          y: 0,
          path: 'M10,10', // only one x,y pair (2 numbers, less than 4)
          style: {},
          datum: { id: 1 },
        };
        expect(pointInMark(10, 10, path)).toBe(false);
      });

      it('returns false for empty path string', () => {
        const path: PathMark = {
          type: 'path',
          x: 0,
          y: 0,
          path: '',
          style: {},
          datum: { id: 1 },
        };
        expect(pointInMark(0, 0, path)).toBe(false);
      });

      it('handles paths with curve commands', () => {
        // Cubic bezier: M 0,0 C 50,100 150,100 200,0
        // Bounding box includes control points: x=[0,200], y=[0,100]
        const path: PathMark = {
          type: 'path',
          x: 0,
          y: 0,
          path: 'M0,0 C50,100 150,100 200,0',
          style: {},
          datum: { id: 1 },
        };
        expect(pointInMark(100, 50, path)).toBe(true); // center area
        expect(pointInMark(-5, 50, path)).toBe(false); // outside left
        expect(pointInMark(100, 105, path)).toBe(false); // outside bottom
      });
    });

    describe('non-interactive marks', () => {
      const rect: RectMark = {
        type: 'rect',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        style: {},
        interactive: false,
        datum: { id: 1 },
      };

      it('still performs hit test (interactive flag checked in pick functions)', () => {
        expect(pointInMark(50, 40, rect)).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Distance Tests
  // ==========================================================================

  describe('distanceToMark', () => {
    it('calculates distance to rect center', () => {
      const rect: RectMark = {
        type: 'rect',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        style: {},
      };
      // Center is at (50, 50)
      expect(distanceToMark(50, 50, rect)).toBe(0);
      expect(distanceToMark(50, 100, rect)).toBe(50);
    });

    it('calculates distance to symbol center', () => {
      const symbol: SymbolMark = {
        type: 'symbol',
        x: 100,
        y: 100,
        size: 100,
        shape: 'circle',
        style: {},
      };
      expect(distanceToMark(100, 100, symbol)).toBe(0);
      expect(distanceToMark(103, 104, symbol)).toBe(5);
    });

    it('calculates distance to arc center', () => {
      const arc: ArcMark = {
        type: 'arc',
        x: 50,
        y: 50,
        innerRadius: 20,
        outerRadius: 40,
        startAngle: 0,
        endAngle: Math.PI,
        style: {},
      };
      expect(distanceToMark(50, 50, arc)).toBe(0);
      expect(distanceToMark(80, 50, arc)).toBe(30);
    });
  });

  describe('signedDistanceToMark', () => {
    const rect: RectMark = {
      type: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      style: {},
    };

    it('returns negative distance for point inside mark', () => {
      // When point is at center, distance is 0, so signed distance is -0
      // For a point slightly off-center inside the mark, it should be negative
      expect(signedDistanceToMark(50, 50, rect)).toBeLessThanOrEqual(0);
      expect(signedDistanceToMark(60, 60, rect)).toBeLessThan(0);
    });

    it('returns positive distance for point outside mark', () => {
      expect(signedDistanceToMark(200, 50, rect)).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Pick Function Tests
  // ==========================================================================

  describe('pickMark', () => {
    const marks: AnyMark[] = [
      { type: 'rect', x: 0, y: 0, width: 50, height: 50, style: {}, datum: { id: 1 } },
      { type: 'rect', x: 25, y: 25, width: 50, height: 50, style: {}, datum: { id: 2 } },
      { type: 'rect', x: 100, y: 100, width: 50, height: 50, style: {}, datum: { id: 3 } },
    ];

    it('returns topmost mark at position (reverse order)', () => {
      const result = pickMark(marks, 40, 40);
      expect(result).not.toBeNull();
      expect(result!.index).toBe(1); // Second mark (on top)
      expect((result!.datum as { id: number }).id).toBe(2);
    });

    it('returns null when no mark at position', () => {
      const result = pickMark(marks, 200, 200);
      expect(result).toBeNull();
    });

    it('skips non-interactive marks', () => {
      const marksWithNonInteractive: AnyMark[] = [
        { type: 'rect', x: 0, y: 0, width: 50, height: 50, style: {}, datum: { id: 1 } },
        {
          type: 'rect',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          style: {},
          datum: { id: 2 },
          interactive: false,
        },
      ];
      const result = pickMark(marksWithNonInteractive, 25, 25);
      expect(result).not.toBeNull();
      expect((result!.datum as { id: number }).id).toBe(1);
    });
  });

  describe('pickClosestMark', () => {
    const marks: AnyMark[] = [
      { type: 'symbol', x: 0, y: 0, size: 100, shape: 'circle', style: {}, datum: { id: 1 } },
      { type: 'symbol', x: 50, y: 0, size: 100, shape: 'circle', style: {}, datum: { id: 2 } },
      { type: 'symbol', x: 100, y: 0, size: 100, shape: 'circle', style: {}, datum: { id: 3 } },
    ];

    it('returns closest mark to position', () => {
      const result = pickClosestMark(marks, 45, 0);
      expect(result).not.toBeNull();
      expect((result!.datum as { id: number }).id).toBe(2);
    });

    it('respects maxDistance', () => {
      const result = pickClosestMark(marks, 200, 200, 10);
      expect(result).toBeNull();
    });

    it('returns null for empty marks array', () => {
      const result = pickClosestMark([], 0, 0);
      expect(result).toBeNull();
    });
  });

  describe('pickAllMarks', () => {
    const marks: AnyMark[] = [
      { type: 'rect', x: 0, y: 0, width: 100, height: 100, style: {}, datum: { id: 1 } },
      { type: 'rect', x: 25, y: 25, width: 100, height: 100, style: {}, datum: { id: 2 } },
      { type: 'rect', x: 50, y: 50, width: 100, height: 100, style: {}, datum: { id: 3 } },
    ];

    it('returns all marks containing the point', () => {
      const results = pickAllMarks(marks, 75, 75);
      expect(results.length).toBe(3);
    });

    it('returns marks in reverse order (topmost first)', () => {
      const results = pickAllMarks(marks, 75, 75);
      expect((results[0].datum as { id: number }).id).toBe(3);
      expect((results[1].datum as { id: number }).id).toBe(2);
      expect((results[2].datum as { id: number }).id).toBe(1);
    });

    it('returns empty array when no marks at position', () => {
      const results = pickAllMarks(marks, 200, 200);
      expect(results.length).toBe(0);
    });
  });

  describe('pickMarksInRadius', () => {
    const marks: AnyMark[] = [
      { type: 'symbol', x: 0, y: 0, size: 100, shape: 'circle', style: {}, datum: { id: 1 } },
      { type: 'symbol', x: 30, y: 0, size: 100, shape: 'circle', style: {}, datum: { id: 2 } },
      { type: 'symbol', x: 100, y: 0, size: 100, shape: 'circle', style: {}, datum: { id: 3 } },
    ];

    it('returns marks within radius', () => {
      const results = pickMarksInRadius(marks, 10, 0, 50);
      expect(results.length).toBe(2);
    });

    it('sorts results by distance', () => {
      const results = pickMarksInRadius(marks, 10, 0, 50);
      expect(results[0].distance).toBeLessThanOrEqual(results[1].distance);
    });

    it('returns empty array when no marks within radius', () => {
      const results = pickMarksInRadius(marks, 200, 200, 10);
      expect(results.length).toBe(0);
    });
  });

  // ==========================================================================
  // Arc Angle Coordinate Consistency Tests
  //
  // The charts library uses a "0-at-top" angle convention:
  //   angle 0     = 12 o'clock (top)
  //   angle PI/2  = 3 o'clock  (right)
  //   angle PI    = 6 o'clock  (bottom)
  //   angle 3PI/2 = 9 o'clock  (left)
  //
  // hitTestArc (arc.ts) correctly adds +PI/2 to atan2 to convert to this
  // convention. pointInArc (pick.ts) uses raw atan2 without this offset,
  // which is the bug under test.
  //
  // To place a point at angle `a` (0-at-top) at radius `r` from (cx, cy):
  //   px = cx + sin(a) * r       (sin because 0-at-top)
  //   py = cy - cos(a) * r       (negative cos because y-axis is inverted)
  // ==========================================================================

  describe('arc angle coordinate consistency', () => {
    /**
     * Helper: given an angle in the 0-at-top convention and a radius,
     * compute the (x, y) pixel position relative to center (cx, cy).
     */
    function pointAtAngle(
      cx: number,
      cy: number,
      angle: number,
      radius: number,
    ): { x: number; y: number } {
      return {
        x: cx + Math.sin(angle) * radius,
        y: cy - Math.cos(angle) * radius,
      };
    }

    it('picks arc at 0-at-top convention (first quadrant: 0 to PI/2)', () => {
      // Arc from 0 (top) to PI/2 (right) -- the "first quadrant" in 0-at-top.
      // This covers the upper-right region of the chart.
      const arc: ArcMark = {
        type: 'arc',
        x: 200,
        y: 200,
        innerRadius: 0,
        outerRadius: 80,
        startAngle: 0,
        endAngle: Math.PI / 2,
        style: {},
        datum: { id: 'q1' },
      };

      // Point at angle PI/4 (45 degrees, halfway between top and right), radius 40.
      // This is clearly inside the arc in the 0-at-top convention.
      const p = pointAtAngle(200, 200, Math.PI / 4, 40);

      // hitTestArc should say it's inside (it uses the correct convention)
      expect(hitTestArc(arc, p.x, p.y)).toBe(true);

      // pointInMark should also say it's inside (this is the bug -- it will
      // use the wrong convention and may return false)
      expect(pointInMark(p.x, p.y, arc)).toBe(true);
    });

    it('picks arc at various quadrants in 0-at-top convention', () => {
      const cx = 200;
      const cy = 200;
      const outerRadius = 80;
      const testRadius = 40;

      // Define arcs for each quadrant in 0-at-top convention
      const quadrants = [
        {
          name: 'top (0)',
          arc: {
            type: 'arc' as const,
            x: cx,
            y: cy,
            innerRadius: 0,
            outerRadius,
            startAngle: -Math.PI / 4,
            endAngle: Math.PI / 4,
            style: {},
            datum: { id: 'top' },
          },
          testAngle: 0, // point directly at top
        },
        {
          name: 'right (PI/2)',
          arc: {
            type: 'arc' as const,
            x: cx,
            y: cy,
            innerRadius: 0,
            outerRadius,
            startAngle: Math.PI / 4,
            endAngle: (3 * Math.PI) / 4,
            style: {},
            datum: { id: 'right' },
          },
          testAngle: Math.PI / 2, // point directly to the right
        },
        {
          name: 'bottom (PI)',
          arc: {
            type: 'arc' as const,
            x: cx,
            y: cy,
            innerRadius: 0,
            outerRadius,
            startAngle: (3 * Math.PI) / 4,
            endAngle: (5 * Math.PI) / 4,
            style: {},
            datum: { id: 'bottom' },
          },
          testAngle: Math.PI, // point directly at bottom
        },
        {
          name: 'left (3PI/2)',
          arc: {
            type: 'arc' as const,
            x: cx,
            y: cy,
            innerRadius: 0,
            outerRadius,
            startAngle: (5 * Math.PI) / 4,
            endAngle: (7 * Math.PI) / 4,
            style: {},
            datum: { id: 'left' },
          },
          testAngle: (3 * Math.PI) / 2, // point directly to the left
        },
      ];

      for (const { name, arc, testAngle } of quadrants) {
        const p = pointAtAngle(cx, cy, testAngle, testRadius);
        const hitTestResult = hitTestArc(arc, p.x, p.y);
        const pointInMarkResult = pointInMark(p.x, p.y, arc);

        // Both should agree the point is inside
        expect(hitTestResult).toBe(true);
        expect(pointInMarkResult).toBe(true);
      }
    });

    it("picks a realistic pie chart slice (top-right, starting from 12 o'clock)", () => {
      // A typical pie chart starts slices at -PI/2 in standard math convention,
      // which is angle 0 in the 0-at-top convention. The compiler generates arcs
      // using the 0-at-top convention, so the first slice might be:
      //   startAngle = 0, endAngle = PI/2 (25% slice, top to right)
      const firstSlice: ArcMark = {
        type: 'arc',
        x: 150,
        y: 150,
        innerRadius: 0,
        outerRadius: 100,
        startAngle: 0,
        endAngle: Math.PI / 2,
        style: { fill: '#4e79a7' },
        datum: { label: 'Category A', value: 25 },
      };

      // A point in the upper-right area (angle ~PI/6 in 0-at-top, i.e. 30 degrees
      // clockwise from top), radius 50
      const p = pointAtAngle(150, 150, Math.PI / 6, 50);

      // This point should be inside the first slice
      expect(hitTestArc(firstSlice, p.x, p.y)).toBe(true);
      expect(pointInMark(p.x, p.y, firstSlice)).toBe(true);
    });

    it('pointInMark and hitTestArc agree for multiple angle ranges', () => {
      const cx = 100;
      const cy = 100;
      const outerRadius = 60;
      const testRadius = 30;

      // Test a variety of arc angle ranges with points at their midpoints
      const testCases = [
        { startAngle: 0, endAngle: Math.PI / 3 },
        { startAngle: Math.PI / 3, endAngle: (2 * Math.PI) / 3 },
        { startAngle: (2 * Math.PI) / 3, endAngle: Math.PI },
        { startAngle: Math.PI, endAngle: (4 * Math.PI) / 3 },
        { startAngle: (4 * Math.PI) / 3, endAngle: (5 * Math.PI) / 3 },
        { startAngle: (5 * Math.PI) / 3, endAngle: 2 * Math.PI },
        // Negative start angles (as compiler might emit for first-slice-at-top)
        { startAngle: -Math.PI / 2, endAngle: 0 },
        { startAngle: -Math.PI / 4, endAngle: Math.PI / 4 },
      ];

      for (const { startAngle, endAngle } of testCases) {
        const arc: ArcMark = {
          type: 'arc',
          x: cx,
          y: cy,
          innerRadius: 0,
          outerRadius,
          startAngle,
          endAngle,
          style: {},
          datum: { startAngle, endAngle },
        };

        // Place point at the midpoint angle
        const midAngle = (startAngle + endAngle) / 2;
        const p = pointAtAngle(cx, cy, midAngle, testRadius);

        const hitTestResult = hitTestArc(arc, p.x, p.y);
        const pointInMarkResult = pointInMark(p.x, p.y, arc);

        // Both functions must agree: the point at the midpoint angle IS inside
        expect(hitTestResult).toBe(true);
        expect(pointInMarkResult).toBe(true);
      }
    });
  });
});
