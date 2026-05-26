import {
  distanceToCircle,
  distanceToRect,
  pointInArc,
  pointInCircle,
  pointInDiamond,
  pointInRect,
  rectContains,
  rectIntersects,
} from '../src/primitives';

// =============================================================================
// pointInRect
// =============================================================================

describe('pointInRect', () => {
  const rect = { x: 10, y: 20, width: 100, height: 50 };

  it('returns true for point inside', () => {
    expect(pointInRect({ x: 50, y: 40 }, rect)).toBe(true);
  });

  it('returns false for point outside', () => {
    expect(pointInRect({ x: 5, y: 40 }, rect)).toBe(false);
    expect(pointInRect({ x: 50, y: 80 }, rect)).toBe(false);
  });

  it('returns true for point on left edge', () => {
    expect(pointInRect({ x: 10, y: 40 }, rect)).toBe(true);
  });

  it('returns true for point on right edge', () => {
    expect(pointInRect({ x: 110, y: 40 }, rect)).toBe(true);
  });

  it('returns true for point at top-left corner', () => {
    expect(pointInRect({ x: 10, y: 20 }, rect)).toBe(true);
  });

  it('returns true for point at bottom-right corner', () => {
    expect(pointInRect({ x: 110, y: 70 }, rect)).toBe(true);
  });

  it('handles zero-width rect', () => {
    const zeroW = { x: 5, y: 5, width: 0, height: 10 };
    expect(pointInRect({ x: 5, y: 10 }, zeroW)).toBe(true);
    expect(pointInRect({ x: 6, y: 10 }, zeroW)).toBe(false);
  });

  it('handles zero-height rect', () => {
    const zeroH = { x: 5, y: 5, width: 10, height: 0 };
    expect(pointInRect({ x: 10, y: 5 }, zeroH)).toBe(true);
    expect(pointInRect({ x: 10, y: 6 }, zeroH)).toBe(false);
  });
});

// =============================================================================
// pointInCircle
// =============================================================================

describe('pointInCircle', () => {
  const center = { x: 50, y: 50 };
  const radius = 25;

  it('returns true for point inside', () => {
    expect(pointInCircle({ x: 50, y: 50 }, center, radius)).toBe(true);
  });

  it('returns false for point outside', () => {
    expect(pointInCircle({ x: 100, y: 100 }, center, radius)).toBe(false);
  });

  it('returns true for point exactly on boundary', () => {
    expect(pointInCircle({ x: 75, y: 50 }, center, radius)).toBe(true);
  });

  it('returns true for point just inside boundary', () => {
    expect(pointInCircle({ x: 74, y: 50 }, center, radius)).toBe(true);
  });

  it('returns false for point just outside boundary', () => {
    expect(pointInCircle({ x: 76, y: 50 }, center, radius)).toBe(false);
  });

  it('handles zero radius', () => {
    expect(pointInCircle({ x: 50, y: 50 }, center, 0)).toBe(true); // point == center
    expect(pointInCircle({ x: 51, y: 50 }, center, 0)).toBe(false);
  });

  it('handles point at center', () => {
    expect(pointInCircle(center, center, radius)).toBe(true);
  });
});

// =============================================================================
// pointInArc
// =============================================================================

describe('pointInArc', () => {
  const center = { x: 0, y: 0 };
  const PI = Math.PI;

  it('returns true for point in simple arc (top-right quadrant)', () => {
    // Arc from 0 (top) to PI/2 (right), outer radius 100
    // Point at (50, -50) is in the top-right area
    // In our convention: 0 = top, PI/2 = right
    // atan2(-50, 50) = -PI/4, + PI/2 = PI/4 which is between 0 and PI/2
    expect(pointInArc({ x: 50, y: -50 }, center, 0, 100, 0, PI / 2)).toBe(true);
  });

  it('returns false for point outside radial bounds', () => {
    // Point too far away
    expect(pointInArc({ x: 200, y: 0 }, center, 0, 100, 0, PI * 2)).toBe(false);
  });

  it('returns false for point inside inner radius (donut hole)', () => {
    expect(pointInArc({ x: 5, y: 0 }, center, 20, 100, 0, PI * 2)).toBe(false);
  });

  it('returns true for pie slice (zero inner radius)', () => {
    // Full circle arc with zero inner radius
    expect(pointInArc({ x: 10, y: 0 }, center, 0, 100, 0, PI * 2)).toBe(true);
  });

  it('handles arc wrapping around 0', () => {
    // Arc from 3PI/2 (left) to PI/2 (right), going through 0 (top)
    // Point directly above center
    const point = { x: 0, y: -50 }; // angle = 0 (top)
    expect(pointInArc(point, center, 0, 100, (3 * PI) / 2, PI / 2)).toBe(true);
  });

  it('returns false for point in wrong angular sector', () => {
    // Arc covers top-right quadrant (0 to PI/2)
    // Point in bottom-left: (−50, 50) → angle = PI + something
    expect(pointInArc({ x: -50, y: 50 }, center, 0, 100, 0, PI / 2)).toBe(false);
  });

  it('handles full circle', () => {
    expect(pointInArc({ x: 50, y: 50 }, center, 0, 100, 0, PI * 2)).toBe(true);
    expect(pointInArc({ x: -50, y: -50 }, center, 0, 100, 0, PI * 2)).toBe(true);
  });

  it('returns true at exact outer radius', () => {
    // Point exactly at outer radius, angle 0 (top)
    expect(pointInArc({ x: 0, y: -100 }, center, 0, 100, 0, PI / 4)).toBe(true);
  });

  it('returns true at exact inner radius', () => {
    expect(pointInArc({ x: 0, y: -20 }, center, 20, 100, 0, PI / 4)).toBe(true);
  });
});

// =============================================================================
// pointInDiamond
// =============================================================================

describe('pointInDiamond', () => {
  const center = { x: 50, y: 50 };
  const size = 40; // halfSize = 20

  it('returns true for point at center', () => {
    expect(pointInDiamond({ x: 50, y: 50 }, center, size)).toBe(true);
  });

  it('returns false for point outside', () => {
    expect(pointInDiamond({ x: 100, y: 100 }, center, size)).toBe(false);
  });

  it('returns true for point at top vertex', () => {
    expect(pointInDiamond({ x: 50, y: 30 }, center, size)).toBe(true);
  });

  it('returns true for point at right vertex', () => {
    expect(pointInDiamond({ x: 70, y: 50 }, center, size)).toBe(true);
  });

  it('returns false for point at corner of bounding box', () => {
    // Corner of bounding box: (70, 30) → dx=20, dy=20, sum/halfSize = 2 > 1
    expect(pointInDiamond({ x: 70, y: 30 }, center, size)).toBe(false);
  });

  it('returns true for point on edge (midpoint of edge)', () => {
    // Midpoint of top-right edge: (60, 40) → dx=10, dy=10 → 10/20 + 10/20 = 1
    expect(pointInDiamond({ x: 60, y: 40 }, center, size)).toBe(true);
  });

  it('returns false for zero size', () => {
    expect(pointInDiamond({ x: 50, y: 50 }, center, 0)).toBe(false);
  });

  it('returns false for negative size', () => {
    expect(pointInDiamond({ x: 50, y: 50 }, center, -10)).toBe(false);
  });
});

// =============================================================================
// rectContains
// =============================================================================

describe('rectContains', () => {
  const outer = { x: 0, y: 0, width: 100, height: 100 };

  it('returns true when outer fully contains inner', () => {
    const inner = { x: 10, y: 10, width: 30, height: 30 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('returns false when inner extends beyond outer', () => {
    const inner = { x: 80, y: 80, width: 30, height: 30 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it('returns true for identical rects', () => {
    expect(rectContains(outer, { ...outer })).toBe(true);
  });

  it('returns false for partial overlap', () => {
    const inner = { x: -10, y: 10, width: 50, height: 50 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it('returns true when inner touches edges', () => {
    const inner = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('returns false when inner is completely outside', () => {
    const inner = { x: 200, y: 200, width: 10, height: 10 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it('handles zero-size inner rect', () => {
    const inner = { x: 50, y: 50, width: 0, height: 0 };
    expect(rectContains(outer, inner)).toBe(true);
  });
});

// =============================================================================
// rectIntersects
// =============================================================================

describe('rectIntersects', () => {
  const a = { x: 0, y: 0, width: 50, height: 50 };

  it('returns true for overlapping rects', () => {
    const b = { x: 25, y: 25, width: 50, height: 50 };
    expect(rectIntersects(a, b)).toBe(true);
  });

  it('returns false for separated rects', () => {
    const b = { x: 100, y: 100, width: 50, height: 50 };
    expect(rectIntersects(a, b)).toBe(false);
  });

  it('returns true for edge-touching rects', () => {
    const b = { x: 50, y: 0, width: 50, height: 50 };
    expect(rectIntersects(a, b)).toBe(true);
  });

  it('returns true for corner-touching rects', () => {
    const b = { x: 50, y: 50, width: 50, height: 50 };
    expect(rectIntersects(a, b)).toBe(true);
  });

  it('returns true when one contains the other', () => {
    const b = { x: 10, y: 10, width: 10, height: 10 };
    expect(rectIntersects(a, b)).toBe(true);
    expect(rectIntersects(b, a)).toBe(true);
  });

  it('returns true for identical rects', () => {
    expect(rectIntersects(a, { ...a })).toBe(true);
  });

  it('returns false for horizontally separated', () => {
    const b = { x: 60, y: 0, width: 50, height: 50 };
    expect(rectIntersects(a, b)).toBe(false);
  });

  it('returns false for vertically separated', () => {
    const b = { x: 0, y: 60, width: 50, height: 50 };
    expect(rectIntersects(a, b)).toBe(false);
  });
});

// =============================================================================
// distanceToRect
// =============================================================================

describe('distanceToRect', () => {
  const rect = { x: 10, y: 10, width: 80, height: 60 };

  it('returns 0 for point inside', () => {
    expect(distanceToRect({ x: 50, y: 40 }, rect)).toBe(0);
  });

  it('returns 0 for point on edge', () => {
    expect(distanceToRect({ x: 10, y: 40 }, rect)).toBe(0);
  });

  it('returns correct distance for point to the right', () => {
    // Point at (100, 40), right edge at x=90 → distance = 10
    expect(distanceToRect({ x: 100, y: 40 }, rect)).toBe(10);
  });

  it('returns correct distance for point above', () => {
    // Point at (50, 0), top edge at y=10 → distance = 10
    expect(distanceToRect({ x: 50, y: 0 }, rect)).toBe(10);
  });

  it('returns correct distance for point at corner', () => {
    // Point at (0, 0), nearest corner at (10, 10) → distance = sqrt(200)
    expect(distanceToRect({ x: 0, y: 0 }, rect)).toBeCloseTo(Math.sqrt(200));
  });

  it('returns correct distance for point diagonally offset', () => {
    // Point at (93, 73), nearest corner at (90, 70) → distance = sqrt(9+9) = sqrt(18)
    expect(distanceToRect({ x: 93, y: 73 }, rect)).toBeCloseTo(Math.sqrt(18));
  });
});

// =============================================================================
// distanceToCircle
// =============================================================================

describe('distanceToCircle', () => {
  const center = { x: 50, y: 50 };
  const radius = 30;

  it('returns 0 for point on boundary', () => {
    expect(distanceToCircle({ x: 80, y: 50 }, center, radius)).toBeCloseTo(0);
  });

  it('returns negative for point inside', () => {
    // Point at center → distance = -30
    expect(distanceToCircle({ x: 50, y: 50 }, center, radius)).toBe(-30);
  });

  it('returns positive for point outside', () => {
    // Point at (90, 50) → dist from center = 40, minus radius 30 = 10
    expect(distanceToCircle({ x: 90, y: 50 }, center, radius)).toBeCloseTo(10);
  });

  it('returns -radius for point at center', () => {
    expect(distanceToCircle(center, center, radius)).toBe(-radius);
  });

  it('handles zero radius', () => {
    expect(distanceToCircle({ x: 53, y: 54 }, center, 0)).toBeCloseTo(5);
    expect(distanceToCircle(center, center, 0)).toBe(0);
  });

  it('returns correct distance diagonally', () => {
    // Point at (80, 80), distance from center = sqrt(900+900) = 30*sqrt(2) ≈ 42.43
    // minus radius 30 ≈ 12.43
    const expected = Math.sqrt(900 + 900) - 30;
    expect(distanceToCircle({ x: 80, y: 80 }, center, radius)).toBeCloseTo(expected);
  });
});
