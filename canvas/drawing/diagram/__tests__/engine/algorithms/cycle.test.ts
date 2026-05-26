/**
 * Cycle Algorithm Tests
 *
 * Tests for the circular/radial arrangement algorithm.
 * Organized by parameter group:
 * - Default behavior (no params)
 * - Start angle (stAng)
 * - Span angle (spanAng)
 * - Rotation path (rotPath)
 * - Center shape mapping (ctrShpMap)
 * - Radius computation
 * - Edge cases
 */

import {
  executeCycleAlgorithm,
  type ChildInput,
  type LayoutBounds,
} from '../../../src/engine/algorithms/cycle';

// =============================================================================
// Test Helpers
// =============================================================================

const DEFAULT_BOUNDS: LayoutBounds = { x: 0, y: 0, w: 400, h: 400 };
const TOLERANCE = 0.5; // Floating-point tolerance for position comparisons

function makeChildren(count: number, w: number = 40, h: number = 40): ChildInput[] {
  return Array.from({ length: count }, () => ({ w, h }));
}

/**
 * Compute Euclidean distance between two points.
 */
function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// =============================================================================
// 1. Default Behavior (no params)
// =============================================================================

describe('cycle algorithm - default behavior', () => {
  test('should return empty positions for zero children', () => {
    const result = executeCycleAlgorithm([], DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(0);
    expect(result.centerX).toBe(200);
    expect(result.centerY).toBe(200);
    expect(result.radius).toBe(0);
  });

  test("should position a single child at the top (stAng=0, 12 o'clock)", () => {
    const result = executeCycleAlgorithm(makeChildren(1, 40, 40), DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(1);
    // Single child at 0 degrees (top of circle)
    const pos = result.positions[0];
    expect(pos.cy).toBeLessThan(result.centerY);
    expect(Math.abs(pos.cx - result.centerX)).toBeLessThan(TOLERANCE);
  });

  test('should distribute children evenly in a full circle', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(4);

    // All non-center children should be equidistant from center
    const distances = result.positions.map((p) =>
      distance(p.cx, p.cy, result.centerX, result.centerY),
    );
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeCloseTo(distances[0], 0);
    }
  });

  test('should have consistent radius for all children', () => {
    const result = executeCycleAlgorithm(makeChildren(6, 40, 40), DEFAULT_BOUNDS);
    expect(result.radius).toBeGreaterThan(0);
    // Each child center should be at ~radius from center
    for (const pos of result.positions) {
      const d = distance(pos.cx, pos.cy, result.centerX, result.centerY);
      expect(d).toBeCloseTo(result.radius, 0);
    }
  });

  test('should preserve child indices', () => {
    const result = executeCycleAlgorithm(makeChildren(5, 40, 40), DEFAULT_BOUNDS);
    for (let i = 0; i < 5; i++) {
      expect(result.positions[i].index).toBe(i);
    }
  });

  test('should center the cycle in the bounds', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), DEFAULT_BOUNDS);
    expect(result.centerX).toBe(200);
    expect(result.centerY).toBe(200);
  });
});

// =============================================================================
// 2. Start Angle (stAng)
// =============================================================================

describe('cycle algorithm - stAng', () => {
  test('stAng=0 should place first child at top', () => {
    const result = executeCycleAlgorithm(makeChildren(1, 40, 40), DEFAULT_BOUNDS, { stAng: '0' });
    // Top means y < centerY, x ~ centerX
    expect(result.positions[0].cy).toBeLessThan(result.centerY);
    expect(Math.abs(result.positions[0].cx - result.centerX)).toBeLessThan(TOLERANCE);
  });

  test("stAng=90 should place first child at right (3 o'clock)", () => {
    const result = executeCycleAlgorithm(makeChildren(1, 40, 40), DEFAULT_BOUNDS, { stAng: '90' });
    // Right means x > centerX, y ~ centerY
    expect(result.positions[0].cx).toBeGreaterThan(result.centerX);
    expect(Math.abs(result.positions[0].cy - result.centerY)).toBeLessThan(TOLERANCE);
  });

  test("stAng=180 should place first child at bottom (6 o'clock)", () => {
    const result = executeCycleAlgorithm(makeChildren(1, 40, 40), DEFAULT_BOUNDS, { stAng: '180' });
    // Bottom means y > centerY, x ~ centerX
    expect(result.positions[0].cy).toBeGreaterThan(result.centerY);
    expect(Math.abs(result.positions[0].cx - result.centerX)).toBeLessThan(TOLERANCE);
  });

  test("stAng=270 should place first child at left (9 o'clock)", () => {
    const result = executeCycleAlgorithm(makeChildren(1, 40, 40), DEFAULT_BOUNDS, { stAng: '270' });
    // Left means x < centerX, y ~ centerY
    expect(result.positions[0].cx).toBeLessThan(result.centerX);
    expect(Math.abs(result.positions[0].cy - result.centerY)).toBeLessThan(TOLERANCE);
  });

  test('stAng=45 should place first child at top-right diagonal', () => {
    const result = executeCycleAlgorithm(makeChildren(1, 40, 40), DEFAULT_BOUNDS, { stAng: '45' });
    // Top-right: x > centerX, y < centerY
    expect(result.positions[0].cx).toBeGreaterThan(result.centerX);
    expect(result.positions[0].cy).toBeLessThan(result.centerY);
  });
});

// =============================================================================
// 3. Span Angle (spanAng)
// =============================================================================

describe('cycle algorithm - spanAng', () => {
  test('spanAng=360 should create a full circle', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), DEFAULT_BOUNDS, {
      spanAng: '360',
    });
    // 4 children at 0, 90, 180, 270 degrees
    expect(result.positions).toHaveLength(4);
    // First should be at top
    expect(result.positions[0].cy).toBeLessThan(result.centerY);
    // Third should be at bottom
    expect(result.positions[2].cy).toBeGreaterThan(result.centerY);
  });

  test('spanAng=180 should create a half circle', () => {
    const result = executeCycleAlgorithm(makeChildren(3, 40, 40), DEFAULT_BOUNDS, {
      stAng: '0',
      spanAng: '180',
    });
    // 3 children over 180 degrees (0, 90, 180)
    // First at top, second at right, third at bottom
    expect(result.positions[0].cy).toBeLessThan(result.centerY);
    expect(result.positions[1].cx).toBeGreaterThan(result.centerX);
    expect(result.positions[2].cy).toBeGreaterThan(result.centerY);
  });

  test('spanAng=90 should create a quarter circle', () => {
    const result = executeCycleAlgorithm(makeChildren(2, 40, 40), DEFAULT_BOUNDS, {
      stAng: '0',
      spanAng: '90',
    });
    // First at top (0), second at right (90)
    expect(result.positions[0].cy).toBeLessThan(result.centerY);
    expect(result.positions[1].cx).toBeGreaterThan(result.centerX);
  });

  test('spanAng=0 should place all children at the same point', () => {
    const result = executeCycleAlgorithm(makeChildren(3, 40, 40), DEFAULT_BOUNDS, { spanAng: '0' });
    // All at the same position (stAng=0)
    for (const pos of result.positions) {
      expect(pos.cx).toBeCloseTo(result.positions[0].cx, 0);
      expect(pos.cy).toBeCloseTo(result.positions[0].cy, 0);
    }
  });

  test('negative spanAng should go counter-clockwise', () => {
    const result = executeCycleAlgorithm(makeChildren(3, 40, 40), DEFAULT_BOUNDS, {
      stAng: '0',
      spanAng: '-180',
    });
    // From 0 counter-clockwise to -180 (which is same as 180)
    // Children at 0, -90, -180 = 0, 270, 180
    expect(result.positions[0].cy).toBeLessThan(result.centerY); // top
    expect(result.positions[1].cx).toBeLessThan(result.centerX); // left (270)
    expect(result.positions[2].cy).toBeGreaterThan(result.centerY); // bottom (180)
  });
});

// =============================================================================
// 4. Rotation Path (rotPath)
// =============================================================================

describe('cycle algorithm - rotPath', () => {
  test('rotPath=none should produce zero rotation for all children', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), DEFAULT_BOUNDS, {
      rotPath: 'none',
    });
    for (const pos of result.positions) {
      expect(pos.rotation).toBe(0);
    }
  });

  test('rotPath=alongPath should produce non-zero rotation', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), DEFAULT_BOUNDS, {
      rotPath: 'alongPath',
    });
    // At least some children should have rotation
    const rotations = result.positions.map((p) => p.rotation);
    const hasNonZeroRotation = rotations.some((r) => r !== 0);
    expect(hasNonZeroRotation).toBe(true);
  });

  test('rotPath=alongPath should give different rotations for different positions', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), DEFAULT_BOUNDS, {
      rotPath: 'alongPath',
    });
    // Each child at a different angle should have a different rotation
    const rotations = result.positions.map((p) => p.rotation);
    const uniqueRotations = new Set(rotations);
    expect(uniqueRotations.size).toBe(4);
  });

  test('rotPath=alongPath tangent at 0 degrees should be 90 degrees', () => {
    const result = executeCycleAlgorithm(makeChildren(1, 40, 40), DEFAULT_BOUNDS, {
      stAng: '0',
      rotPath: 'alongPath',
    });
    // At angle 0 (top), tangent is 90 degrees (pointing right)
    expect(result.positions[0].rotation).toBeCloseTo(90, 0);
  });
});

// =============================================================================
// 5. Center Shape Mapping (ctrShpMap)
// =============================================================================

describe('cycle algorithm - ctrShpMap', () => {
  test('ctrShpMap=none should place all children on the circle', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), DEFAULT_BOUNDS, {
      ctrShpMap: 'none',
    });
    // All children should be on the circle
    for (const pos of result.positions) {
      expect(pos.isCenter).toBe(false);
    }
  });

  test('ctrShpMap=fNode should place first child at center', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), DEFAULT_BOUNDS, {
      ctrShpMap: 'fNode',
    });
    // First child is at center
    expect(result.positions[0].isCenter).toBe(true);
    expect(result.positions[0].cx).toBeCloseTo(result.centerX, 0);
    expect(result.positions[0].cy).toBeCloseTo(result.centerY, 0);
    // Remaining children are on the circle
    for (let i = 1; i < result.positions.length; i++) {
      expect(result.positions[i].isCenter).toBe(false);
    }
  });

  test('ctrShpMap=fNode with single child should only have center node', () => {
    const result = executeCycleAlgorithm(makeChildren(1, 40, 40), DEFAULT_BOUNDS, {
      ctrShpMap: 'fNode',
    });
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].isCenter).toBe(true);
    expect(result.positions[0].cx).toBeCloseTo(result.centerX, 0);
    expect(result.positions[0].cy).toBeCloseTo(result.centerY, 0);
  });

  test('ctrShpMap=fNode with 5 children should have 1 center + 4 on circle', () => {
    const result = executeCycleAlgorithm(makeChildren(5, 40, 40), DEFAULT_BOUNDS, {
      ctrShpMap: 'fNode',
    });
    expect(result.positions).toHaveLength(5);
    const centerNodes = result.positions.filter((p) => p.isCenter);
    const circleNodes = result.positions.filter((p) => !p.isCenter);
    expect(centerNodes).toHaveLength(1);
    expect(circleNodes).toHaveLength(4);
  });

  test('ctrShpMap=fNode circle children should be equidistant from center', () => {
    const result = executeCycleAlgorithm(makeChildren(5, 40, 40), DEFAULT_BOUNDS, {
      ctrShpMap: 'fNode',
    });
    const circleNodes = result.positions.filter((p) => !p.isCenter);
    const distances = circleNodes.map((p) => distance(p.cx, p.cy, result.centerX, result.centerY));
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeCloseTo(distances[0], 0);
    }
  });
});

// =============================================================================
// 6. Radius Computation
// =============================================================================

describe('cycle algorithm - radius', () => {
  test('radius should fit within bounds accounting for child size', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), DEFAULT_BOUNDS);
    // Radius + half child size should not exceed half the bounds
    expect(result.radius + 20).toBeLessThanOrEqual(200 + TOLERANCE);
  });

  test('larger children should result in smaller radius', () => {
    const result1 = executeCycleAlgorithm(makeChildren(4, 20, 20), DEFAULT_BOUNDS);
    const result2 = executeCycleAlgorithm(makeChildren(4, 80, 80), DEFAULT_BOUNDS);
    expect(result1.radius).toBeGreaterThan(result2.radius);
  });

  test('radius should be zero when children fill the entire bounds', () => {
    // Children as large as bounds
    const result = executeCycleAlgorithm(makeChildren(4, 400, 400), DEFAULT_BOUNDS);
    expect(result.radius).toBe(0);
  });

  test('square bounds should use half the side minus padding', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), { x: 0, y: 0, w: 200, h: 200 });
    // radius = min(200,200)/2 - 40/2 = 100 - 20 = 80
    expect(result.radius).toBe(80);
  });

  test('rectangular bounds should use the smaller dimension', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), { x: 0, y: 0, w: 400, h: 200 });
    // radius = min(400,200)/2 - 40/2 = 100 - 20 = 80
    expect(result.radius).toBe(80);
  });
});

// =============================================================================
// 7. Edge Cases
// =============================================================================

describe('cycle algorithm - edge cases', () => {
  test('should handle bounds with non-zero origin', () => {
    const bounds: LayoutBounds = { x: 100, y: 50, w: 400, h: 400 };
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), bounds);
    expect(result.centerX).toBe(300);
    expect(result.centerY).toBe(250);
  });

  test('should handle two children in a full circle', () => {
    const result = executeCycleAlgorithm(makeChildren(2, 40, 40), DEFAULT_BOUNDS, {
      stAng: '0',
      spanAng: '360',
    });
    // Two children at 0 and 180 degrees (top and bottom)
    expect(result.positions[0].cy).toBeLessThan(result.centerY);
    expect(result.positions[1].cy).toBeGreaterThan(result.centerY);
  });

  test('should handle children with different sizes', () => {
    const children: ChildInput[] = [
      { w: 20, h: 20 },
      { w: 40, h: 40 },
      { w: 60, h: 60 },
    ];
    const result = executeCycleAlgorithm(children, DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(3);
    expect(result.positions[0].w).toBe(20);
    expect(result.positions[1].w).toBe(40);
    expect(result.positions[2].w).toBe(60);
  });

  test('should handle zero-size children', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 0, 0), DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(4);
    expect(result.radius).toBe(200); // min(400,400)/2 - 0/2
  });

  test('totalBounds should contain all children', () => {
    const result = executeCycleAlgorithm(makeChildren(8, 40, 40), DEFAULT_BOUNDS);
    for (const pos of result.positions) {
      expect(pos.x).toBeGreaterThanOrEqual(result.totalBounds.x - TOLERANCE);
      expect(pos.y).toBeGreaterThanOrEqual(result.totalBounds.y - TOLERANCE);
      expect(pos.x + pos.w).toBeLessThanOrEqual(
        result.totalBounds.x + result.totalBounds.w + TOLERANCE,
      );
      expect(pos.y + pos.h).toBeLessThanOrEqual(
        result.totalBounds.y + result.totalBounds.h + TOLERANCE,
      );
    }
  });

  test('should handle many children on a circle', () => {
    const result = executeCycleAlgorithm(makeChildren(36, 10, 10), DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(36);
    // All should be equidistant from center
    const distances = result.positions.map((p) =>
      distance(p.cx, p.cy, result.centerX, result.centerY),
    );
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeCloseTo(distances[0], 0);
    }
  });

  test('angle property should be stored on each position', () => {
    const result = executeCycleAlgorithm(makeChildren(4, 40, 40), DEFAULT_BOUNDS, {
      stAng: '0',
      spanAng: '360',
    });
    expect(result.positions[0].angle).toBe(0);
    expect(result.positions[1].angle).toBeCloseTo(90, 0);
    expect(result.positions[2].angle).toBeCloseTo(180, 0);
    expect(result.positions[3].angle).toBeCloseTo(270, 0);
  });

  test('x/y should be top-left corner of child, not center', () => {
    const result = executeCycleAlgorithm(makeChildren(1, 40, 40), DEFAULT_BOUNDS, { stAng: '0' });
    const pos = result.positions[0];
    expect(pos.x).toBe(pos.cx - 20);
    expect(pos.y).toBe(pos.cy - 20);
  });
});

// =============================================================================
// 8. Combined Parameters
// =============================================================================

describe('cycle algorithm - combined parameters', () => {
  test('stAng=90 + spanAng=180 should create right-side semicircle', () => {
    const result = executeCycleAlgorithm(makeChildren(3, 40, 40), DEFAULT_BOUNDS, {
      stAng: '90',
      spanAng: '180',
    });
    // Children at 90, 180, 270 degrees
    expect(result.positions[0].cx).toBeGreaterThan(result.centerX); // right
    expect(result.positions[2].cx).toBeLessThan(result.centerX); // left
  });

  test('ctrShpMap=fNode + rotPath=alongPath should rotate circle children but not center', () => {
    const result = executeCycleAlgorithm(makeChildren(5, 40, 40), DEFAULT_BOUNDS, {
      ctrShpMap: 'fNode',
      rotPath: 'alongPath',
    });
    // Center node has no rotation
    expect(result.positions[0].rotation).toBe(0);
    // Circle nodes have rotation
    for (let i = 1; i < result.positions.length; i++) {
      expect(typeof result.positions[i].rotation).toBe('number');
    }
  });

  test('stAng=0 + spanAng=360 + ctrShpMap=fNode should produce hub-and-spoke layout', () => {
    const result = executeCycleAlgorithm(makeChildren(7, 40, 40), DEFAULT_BOUNDS, {
      stAng: '0',
      spanAng: '360',
      ctrShpMap: 'fNode',
    });
    expect(result.positions[0].isCenter).toBe(true);
    // 6 spokes on the circle
    const spokes = result.positions.filter((p) => !p.isCenter);
    expect(spokes).toHaveLength(6);
    // Spokes should be evenly distributed (60 degrees apart)
    const angles = spokes.map((p) => p.angle);
    for (let i = 1; i < angles.length; i++) {
      const diff = angles[i] - angles[i - 1];
      expect(diff).toBeCloseTo(60, 0);
    }
  });
});
