/**
 * Hierarchy Child Algorithm Tests
 *
 * Tests for the hierarchy child positioning algorithm.
 * Organized by parameter group:
 * - Default behavior (no params)
 * - Linear direction (linDir)
 * - Child alignment (chAlign)
 * - Secondary parameters (secLinDir, secChAlign)
 * - Spacing
 * - Edge cases
 */

import {
  executeHierChildAlgorithm,
  executeHierChildSecondaryAlgorithm,
  type ChildInput,
  type LayoutBounds,
} from '../../../src/engine/algorithms/hier-child';

// =============================================================================
// Test Helpers
// =============================================================================

const DEFAULT_BOUNDS: LayoutBounds = { x: 0, y: 0, w: 400, h: 300 };

function makeChildren(count: number, w: number = 80, h: number = 40): ChildInput[] {
  return Array.from({ length: count }, () => ({ w, h }));
}

function makeVariedChildren(sizes: [number, number][]): ChildInput[] {
  return sizes.map(([w, h]) => ({ w, h }));
}

// =============================================================================
// 1. Default Behavior (no params)
// =============================================================================

describe('hierChild algorithm - default behavior', () => {
  test('should return empty positions for zero children', () => {
    const result = executeHierChildAlgorithm([], DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(0);
    expect(result.totalBounds.w).toBe(0);
    expect(result.totalBounds.h).toBe(0);
  });

  test('should position a single child at the start', () => {
    const result = executeHierChildAlgorithm([{ w: 80, h: 40 }], DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[0].y).toBe(0);
    expect(result.positions[0].w).toBe(80);
    expect(result.positions[0].h).toBe(40);
  });

  test('should arrange children left to right by default (fromL)', () => {
    const result = executeHierChildAlgorithm(makeChildren(3, 80, 40), DEFAULT_BOUNDS);
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[1].x).toBe(80);
    expect(result.positions[2].x).toBe(160);
  });

  test('should default to horizontal layout', () => {
    const result = executeHierChildAlgorithm(makeChildren(3, 80, 40), DEFAULT_BOUNDS);
    expect(result.isHorizontal).toBe(true);
  });

  test('should preserve child indices', () => {
    const result = executeHierChildAlgorithm(makeChildren(4, 80, 40), DEFAULT_BOUNDS);
    for (let i = 0; i < 4; i++) {
      expect(result.positions[i].index).toBe(i);
    }
  });

  test('should preserve child dimensions', () => {
    const children = makeVariedChildren([
      [100, 30],
      [50, 60],
      [80, 40],
    ]);
    const result = executeHierChildAlgorithm(children, DEFAULT_BOUNDS);
    expect(result.positions[0].w).toBe(100);
    expect(result.positions[0].h).toBe(30);
    expect(result.positions[1].w).toBe(50);
    expect(result.positions[1].h).toBe(60);
    expect(result.positions[2].w).toBe(80);
    expect(result.positions[2].h).toBe(40);
  });
});

// =============================================================================
// 2. Linear Direction (linDir)
// =============================================================================

describe('hierChild algorithm - linDir', () => {
  test('linDir=fromL should arrange left to right', () => {
    const result = executeHierChildAlgorithm(makeChildren(3, 80, 40), DEFAULT_BOUNDS, {
      linDir: 'fromL',
    });
    expect(result.positions[0].x).toBeLessThan(result.positions[1].x);
    expect(result.positions[1].x).toBeLessThan(result.positions[2].x);
    expect(result.isHorizontal).toBe(true);
  });

  test('linDir=fromR should arrange right to left', () => {
    const result = executeHierChildAlgorithm(makeChildren(3, 80, 40), DEFAULT_BOUNDS, {
      linDir: 'fromR',
    });
    expect(result.positions[0].x).toBeGreaterThan(result.positions[1].x);
    expect(result.positions[1].x).toBeGreaterThan(result.positions[2].x);
    expect(result.isHorizontal).toBe(true);
  });

  test('linDir=fromT should arrange top to bottom', () => {
    const result = executeHierChildAlgorithm(makeChildren(3, 80, 40), DEFAULT_BOUNDS, {
      linDir: 'fromT',
    });
    expect(result.positions[0].y).toBeLessThan(result.positions[1].y);
    expect(result.positions[1].y).toBeLessThan(result.positions[2].y);
    expect(result.isHorizontal).toBe(false);
  });

  test('linDir=fromB should arrange bottom to top', () => {
    const result = executeHierChildAlgorithm(makeChildren(3, 80, 40), DEFAULT_BOUNDS, {
      linDir: 'fromB',
    });
    expect(result.positions[0].y).toBeGreaterThan(result.positions[1].y);
    expect(result.positions[1].y).toBeGreaterThan(result.positions[2].y);
    expect(result.isHorizontal).toBe(false);
  });

  test('linDir=fromR should start from right edge of bounds', () => {
    const result = executeHierChildAlgorithm([{ w: 80, h: 40 }], DEFAULT_BOUNDS, {
      linDir: 'fromR',
    });
    // First child should be at the right side
    expect(result.positions[0].x).toBe(DEFAULT_BOUNDS.w - 80);
  });

  test('linDir=fromB should start from bottom edge of bounds', () => {
    const result = executeHierChildAlgorithm([{ w: 80, h: 40 }], DEFAULT_BOUNDS, {
      linDir: 'fromB',
    });
    // First child should be at the bottom
    expect(result.positions[0].y).toBe(DEFAULT_BOUNDS.h - 40);
  });
});

// =============================================================================
// 3. Child Alignment (chAlign)
// =============================================================================

describe('hierChild algorithm - chAlign', () => {
  test('chAlign=t should align children to top (horizontal flow)', () => {
    const children = makeVariedChildren([
      [80, 20],
      [80, 40],
      [80, 60],
    ]);
    const result = executeHierChildAlgorithm(children, DEFAULT_BOUNDS, {
      linDir: 'fromL',
      chAlign: 't',
    });
    // All children should be top-aligned (same y)
    expect(result.positions[0].y).toBe(0);
    expect(result.positions[1].y).toBe(0);
    expect(result.positions[2].y).toBe(0);
  });

  test('chAlign=b should align children to bottom (horizontal flow)', () => {
    const children = makeVariedChildren([
      [80, 20],
      [80, 40],
      [80, 60],
    ]);
    const result = executeHierChildAlgorithm(children, DEFAULT_BOUNDS, {
      linDir: 'fromL',
      chAlign: 'b',
    });
    // All children should be bottom-aligned
    expect(result.positions[0].y).toBe(DEFAULT_BOUNDS.h - 20);
    expect(result.positions[1].y).toBe(DEFAULT_BOUNDS.h - 40);
    expect(result.positions[2].y).toBe(DEFAULT_BOUNDS.h - 60);
  });

  test('chAlign=l should align children to left (vertical flow)', () => {
    const children = makeVariedChildren([
      [20, 40],
      [40, 40],
      [60, 40],
    ]);
    const result = executeHierChildAlgorithm(children, DEFAULT_BOUNDS, {
      linDir: 'fromT',
      chAlign: 'l',
    });
    // All children should be left-aligned
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[1].x).toBe(0);
    expect(result.positions[2].x).toBe(0);
  });

  test('chAlign=r should align children to right (vertical flow)', () => {
    const children = makeVariedChildren([
      [20, 40],
      [40, 40],
      [60, 40],
    ]);
    const result = executeHierChildAlgorithm(children, DEFAULT_BOUNDS, {
      linDir: 'fromT',
      chAlign: 'r',
    });
    // All children should be right-aligned
    expect(result.positions[0].x).toBe(DEFAULT_BOUNDS.w - 20);
    expect(result.positions[1].x).toBe(DEFAULT_BOUNDS.w - 40);
    expect(result.positions[2].x).toBe(DEFAULT_BOUNDS.w - 60);
  });
});

// =============================================================================
// 4. Secondary Parameters
// =============================================================================

describe('hierChild algorithm - secondary parameters', () => {
  test('secondary algorithm should use secLinDir', () => {
    const result = executeHierChildSecondaryAlgorithm(makeChildren(3, 80, 40), DEFAULT_BOUNDS, {
      linDir: 'fromL',
      secLinDir: 'fromT',
    });
    // Should use fromT (secondary)
    expect(result.positions[0].y).toBeLessThan(result.positions[1].y);
    expect(result.isHorizontal).toBe(false);
  });

  test('secondary algorithm should use secChAlign', () => {
    const children = makeVariedChildren([
      [20, 40],
      [40, 40],
      [60, 40],
    ]);
    const result = executeHierChildSecondaryAlgorithm(children, DEFAULT_BOUNDS, {
      linDir: 'fromT',
      chAlign: 'l',
      secLinDir: 'fromT',
      secChAlign: 'r',
    });
    // Should use right alignment (secondary)
    expect(result.positions[0].x).toBe(DEFAULT_BOUNDS.w - 20);
    expect(result.positions[1].x).toBe(DEFAULT_BOUNDS.w - 40);
  });

  test('secondary algorithm should fall back to primary when no secondary specified', () => {
    const result = executeHierChildSecondaryAlgorithm(
      makeChildren(3, 80, 40),
      DEFAULT_BOUNDS,
      { linDir: 'fromR' },
      // secLinDir not specified, should fall back to linDir=fromR
    );
    expect(result.positions[0].x).toBeGreaterThan(result.positions[1].x);
    expect(result.isHorizontal).toBe(true);
  });

  test('secondary algorithm with no params should use defaults', () => {
    const result = executeHierChildSecondaryAlgorithm(makeChildren(3, 80, 40), DEFAULT_BOUNDS);
    // Defaults: fromL, t alignment
    expect(result.positions[0].x).toBeLessThan(result.positions[1].x);
    expect(result.isHorizontal).toBe(true);
  });
});

// =============================================================================
// 5. Spacing
// =============================================================================

describe('hierChild algorithm - spacing', () => {
  test('should add spacing between children (horizontal)', () => {
    const result = executeHierChildAlgorithm(
      makeChildren(3, 80, 40),
      DEFAULT_BOUNDS,
      { linDir: 'fromL' },
      10,
    );
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[1].x).toBe(90); // 80 + 10
    expect(result.positions[2].x).toBe(180); // 80 + 10 + 80 + 10
  });

  test('should add spacing between children (vertical)', () => {
    const result = executeHierChildAlgorithm(
      makeChildren(3, 80, 40),
      DEFAULT_BOUNDS,
      { linDir: 'fromT' },
      10,
    );
    expect(result.positions[0].y).toBe(0);
    expect(result.positions[1].y).toBe(50); // 40 + 10
    expect(result.positions[2].y).toBe(100); // 40 + 10 + 40 + 10
  });

  test('spacing should work with fromR direction', () => {
    const result = executeHierChildAlgorithm(
      makeChildren(3, 80, 40),
      DEFAULT_BOUNDS,
      { linDir: 'fromR' },
      10,
    );
    // Children from right, with spacing
    const firstX = result.positions[0].x;
    const secondX = result.positions[1].x;
    expect(firstX - secondX).toBe(90); // 80 + 10
  });

  test('zero spacing should produce adjacent children', () => {
    const result = executeHierChildAlgorithm(
      makeChildren(3, 80, 40),
      DEFAULT_BOUNDS,
      { linDir: 'fromL' },
      0,
    );
    expect(result.positions[1].x).toBe(80);
  });
});

// =============================================================================
// 6. Total Bounds
// =============================================================================

describe('hierChild algorithm - total bounds', () => {
  test('totalBounds should encompass all children (horizontal)', () => {
    const result = executeHierChildAlgorithm(makeChildren(3, 80, 40), DEFAULT_BOUNDS, {
      linDir: 'fromL',
    });
    expect(result.totalBounds.x).toBe(0);
    expect(result.totalBounds.y).toBe(0);
    expect(result.totalBounds.w).toBe(240); // 3 * 80
    expect(result.totalBounds.h).toBe(40);
  });

  test('totalBounds should encompass all children (vertical)', () => {
    const result = executeHierChildAlgorithm(makeChildren(3, 80, 40), DEFAULT_BOUNDS, {
      linDir: 'fromT',
    });
    expect(result.totalBounds.w).toBe(80);
    expect(result.totalBounds.h).toBe(120); // 3 * 40
  });

  test('totalBounds should account for spacing', () => {
    const result = executeHierChildAlgorithm(
      makeChildren(3, 80, 40),
      DEFAULT_BOUNDS,
      { linDir: 'fromL' },
      10,
    );
    expect(result.totalBounds.w).toBe(260); // 3*80 + 2*10
  });

  test('totalBounds with fromR should have correct origin', () => {
    const result = executeHierChildAlgorithm(makeChildren(3, 80, 40), DEFAULT_BOUNDS, {
      linDir: 'fromR',
    });
    // Children start from right edge going left
    expect(result.totalBounds.x).toBe(DEFAULT_BOUNDS.w - 240);
    expect(result.totalBounds.w).toBe(240);
  });
});

// =============================================================================
// 7. Edge Cases
// =============================================================================

describe('hierChild algorithm - edge cases', () => {
  test('should handle single child', () => {
    const result = executeHierChildAlgorithm([{ w: 80, h: 40 }], DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(1);
    expect(result.totalBounds.w).toBe(80);
    expect(result.totalBounds.h).toBe(40);
  });

  test('should handle children wider than bounds', () => {
    const result = executeHierChildAlgorithm(makeChildren(2, 300, 40), DEFAULT_BOUNDS, {
      linDir: 'fromL',
    });
    // Children extend beyond bounds, that's fine
    expect(result.positions).toHaveLength(2);
    expect(result.positions[1].x).toBe(300);
  });

  test('should handle zero-size children', () => {
    const result = executeHierChildAlgorithm(makeChildren(3, 0, 0), DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(3);
  });

  test('should handle bounds with non-zero origin', () => {
    const offsetBounds: LayoutBounds = { x: 50, y: 100, w: 400, h: 300 };
    const result = executeHierChildAlgorithm(makeChildren(3, 80, 40), offsetBounds, {
      linDir: 'fromL',
      chAlign: 't',
    });
    expect(result.positions[0].x).toBe(50);
    expect(result.positions[0].y).toBe(100);
  });

  test('should handle many children', () => {
    const result = executeHierChildAlgorithm(makeChildren(50, 10, 10), DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(50);
  });

  test('should handle varied child sizes', () => {
    const children = makeVariedChildren([
      [100, 30],
      [50, 60],
      [80, 40],
      [120, 20],
    ]);
    const result = executeHierChildAlgorithm(children, DEFAULT_BOUNDS, {
      linDir: 'fromL',
    });
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[1].x).toBe(100);
    expect(result.positions[2].x).toBe(150);
    expect(result.positions[3].x).toBe(230);
  });

  test('fromB with spacing should properly reverse direction', () => {
    const result = executeHierChildAlgorithm(
      makeChildren(3, 80, 40),
      DEFAULT_BOUNDS,
      { linDir: 'fromB' },
      10,
    );
    // Bottom to top with spacing
    expect(result.positions[0].y).toBeGreaterThan(result.positions[1].y);
    expect(result.positions[1].y).toBeGreaterThan(result.positions[2].y);
    const gap = result.positions[1].y - result.positions[2].y;
    expect(gap).toBe(50); // 40 + 10
  });
});
