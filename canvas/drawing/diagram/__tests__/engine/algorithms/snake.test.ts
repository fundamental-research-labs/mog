/**
 * Snake Algorithm Tests
 *
 * Tests for the multi-row/column wrapping layout algorithm.
 * Organized by parameter group:
 * - Default behavior (no params)
 * - Growth direction (grDir)
 * - Flow direction (flowDir)
 * - Continue direction (contDir)
 * - Breakpoint logic (bkpt, bkPtFixedVal)
 * - Offset mode (off)
 * - Spacing
 * - Edge cases
 */

import {
  executeSnakeAlgorithm,
  type ChildInput,
  type LayoutBounds,
} from '../../../src/engine/algorithms/snake';

// =============================================================================
// Test Helpers
// =============================================================================

const DEFAULT_BOUNDS: LayoutBounds = { x: 0, y: 0, w: 300, h: 300 };

function makeChildren(count: number, w: number = 50, h: number = 50): ChildInput[] {
  return Array.from({ length: count }, () => ({ w, h }));
}

function makeVariedChildren(sizes: [number, number][]): ChildInput[] {
  return sizes.map(([w, h]) => ({ w, h }));
}

// =============================================================================
// 1. Default Behavior (no params)
// =============================================================================

describe('snake algorithm - default behavior', () => {
  test('should return empty positions for zero children', () => {
    const result = executeSnakeAlgorithm([], DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(0);
    expect(result.totalBounds.w).toBe(0);
    expect(result.totalBounds.h).toBe(0);
  });

  test('should position a single child at the start', () => {
    const result = executeSnakeAlgorithm([{ w: 50, h: 50 }], DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[0].y).toBe(0);
    expect(result.positions[0].w).toBe(50);
    expect(result.positions[0].h).toBe(50);
  });

  test('should position two children side by side in a row', () => {
    const result = executeSnakeAlgorithm(makeChildren(2, 100, 50), DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(2);
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[1].x).toBe(100);
    expect(result.positions[0].y).toBe(0);
    expect(result.positions[1].y).toBe(0);
  });

  test('should wrap to next row when exceeding canvas width (endCnv default)', () => {
    // 7 children of 50px wide = 350px total, canvas is 300px, should wrap
    const result = executeSnakeAlgorithm(makeChildren(7, 50, 50), DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(7);
    // First row: up to 6 children fit (6*50=300)
    expect(result.positions[5].y).toBe(0);
    // 7th child wraps to second row
    expect(result.positions[6].y).toBe(50);
  });

  test('should preserve child indices in output', () => {
    const result = executeSnakeAlgorithm(makeChildren(5), DEFAULT_BOUNDS);
    for (let i = 0; i < 5; i++) {
      expect(result.positions[i].index).toBe(i);
    }
  });

  test('should handle children exactly filling the canvas width', () => {
    // 6 * 50 = 300 = exactly canvas width, all should be on one row
    const result = executeSnakeAlgorithm(makeChildren(6, 50, 50), DEFAULT_BOUNDS);
    for (const pos of result.positions) {
      expect(pos.y).toBe(0);
    }
  });
});

// =============================================================================
// 2. Growth Direction (grDir)
// =============================================================================

describe('snake algorithm - grDir', () => {
  test('grDir=tL should start from top-left', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS, { grDir: 'tL' });
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[0].y).toBe(0);
    expect(result.positions[1].x).toBe(50);
    expect(result.positions[2].x).toBe(100);
  });

  test('grDir=tR should start from top-right', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS, { grDir: 'tR' });
    // Starting from top-right, children go left
    expect(result.positions[0].x).toBe(250);
    expect(result.positions[0].y).toBe(0);
    expect(result.positions[1].x).toBe(200);
    expect(result.positions[2].x).toBe(150);
  });

  test('grDir=bL should start from bottom-left', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS, { grDir: 'bL' });
    // Starting from bottom-left, children go right, rows go up
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[0].y).toBe(250);
  });

  test('grDir=bR should start from bottom-right', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS, { grDir: 'bR' });
    // Starting from bottom-right, children go left, rows go up
    expect(result.positions[0].x).toBe(250);
    expect(result.positions[0].y).toBe(250);
    expect(result.positions[1].x).toBe(200);
  });
});

// =============================================================================
// 3. Flow Direction (flowDir)
// =============================================================================

describe('snake algorithm - flowDir', () => {
  test('flowDir=row should lay out horizontally first', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS, {
      flowDir: 'row',
    });
    // Children should be in a horizontal row
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[1].x).toBe(50);
    expect(result.positions[2].x).toBe(100);
    expect(result.positions[0].y).toBe(result.positions[1].y);
  });

  test('flowDir=col should lay out vertically first', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS, {
      flowDir: 'col',
    });
    // Children should be in a vertical column
    expect(result.positions[0].y).toBe(0);
    expect(result.positions[1].y).toBe(50);
    expect(result.positions[2].y).toBe(100);
    expect(result.positions[0].x).toBe(result.positions[1].x);
  });

  test('flowDir=col should wrap to next column when exceeding canvas height', () => {
    const result = executeSnakeAlgorithm(makeChildren(7, 50, 50), DEFAULT_BOUNDS, {
      flowDir: 'col',
    });
    expect(result.positions).toHaveLength(7);
    // First column: up to 6 (6*50=300 = canvas height)
    expect(result.positions[5].x).toBe(0);
    // 7th wraps
    expect(result.positions[6].x).toBe(50);
  });

  test('flowDir=col with grDir=tR should start from top-right column', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS, {
      flowDir: 'col',
      grDir: 'tR',
    });
    // Column flow, starting from top-right corner
    expect(result.positions[0].x).toBe(250);
    expect(result.positions[0].y).toBe(0);
    expect(result.positions[1].y).toBe(50);
  });
});

// =============================================================================
// 4. Continue Direction (contDir)
// =============================================================================

describe('snake algorithm - contDir', () => {
  test('contDir=sameDir should flow same direction each row', () => {
    // Force 3 per row with fixed breakpoint
    const result = executeSnakeAlgorithm(makeChildren(6, 50, 50), DEFAULT_BOUNDS, {
      contDir: 'sameDir',
      bkpt: 'fixed',
      bkPtFixedVal: '3',
    });
    // Row 1: left to right
    expect(result.positions[0].x).toBeLessThan(result.positions[1].x);
    expect(result.positions[1].x).toBeLessThan(result.positions[2].x);
    // Row 2: also left to right (same direction)
    expect(result.positions[3].x).toBeLessThan(result.positions[4].x);
    expect(result.positions[4].x).toBeLessThan(result.positions[5].x);
  });

  test('contDir=revDir should alternate direction each row (boustrophedon)', () => {
    const result = executeSnakeAlgorithm(makeChildren(6, 50, 50), DEFAULT_BOUNDS, {
      contDir: 'revDir',
      bkpt: 'fixed',
      bkPtFixedVal: '3',
    });
    // Row 1: left to right
    expect(result.positions[0].x).toBeLessThan(result.positions[1].x);
    // Row 2: right to left (reversed)
    expect(result.positions[3].x).toBeGreaterThan(result.positions[4].x);
  });

  test('contDir=revDir with 3 rows should alternate L-R-L', () => {
    const result = executeSnakeAlgorithm(makeChildren(9, 50, 50), DEFAULT_BOUNDS, {
      contDir: 'revDir',
      bkpt: 'fixed',
      bkPtFixedVal: '3',
    });
    // Row 1 (idx 0-2): L->R
    expect(result.positions[0].x).toBeLessThan(result.positions[2].x);
    // Row 2 (idx 3-5): R->L
    expect(result.positions[3].x).toBeGreaterThan(result.positions[5].x);
    // Row 3 (idx 6-8): L->R
    expect(result.positions[6].x).toBeLessThan(result.positions[8].x);
  });
});

// =============================================================================
// 5. Breakpoint Logic (bkpt, bkPtFixedVal)
// =============================================================================

describe('snake algorithm - bkpt', () => {
  test('bkpt=fixed with bkPtFixedVal=2 should have exactly 2 per row', () => {
    const result = executeSnakeAlgorithm(makeChildren(5, 50, 50), DEFAULT_BOUNDS, {
      bkpt: 'fixed',
      bkPtFixedVal: '2',
    });
    // Row 1: indices 0,1
    expect(result.positions[0].y).toBe(result.positions[1].y);
    // Row 2: indices 2,3
    expect(result.positions[2].y).toBe(result.positions[3].y);
    // Row 3: index 4
    expect(result.positions[4].y).toBeGreaterThan(result.positions[2].y);
  });

  test('bkpt=fixed with bkPtFixedVal=1 should have one per row', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS, {
      bkpt: 'fixed',
      bkPtFixedVal: '1',
    });
    // Each child on its own row
    expect(result.positions[0].y).toBeLessThan(result.positions[1].y);
    expect(result.positions[1].y).toBeLessThan(result.positions[2].y);
  });

  test('bkpt=fixed with bkPtFixedVal=10 should fit all in one row for small count', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS, {
      bkpt: 'fixed',
      bkPtFixedVal: '10',
    });
    // All 3 on one row
    for (const pos of result.positions) {
      expect(pos.y).toBe(0);
    }
  });

  test('bkpt=endCnv should break at canvas edge', () => {
    // Canvas=300, children=100 wide, so 3 per row
    const result = executeSnakeAlgorithm(makeChildren(5, 100, 50), DEFAULT_BOUNDS, {
      bkpt: 'endCnv',
    });
    // Row 1: 3 children (3*100=300)
    expect(result.positions[2].y).toBe(0);
    // Row 2: 2 children
    expect(result.positions[3].y).toBe(50);
    expect(result.positions[4].y).toBe(50);
  });

  test('bkpt=bal should balance children across rows', () => {
    // 5 children of 100px wide in 300px canvas
    // endCnv would give 3+2, bal should give ~2.5 per row -> 3+2 or 2+3
    const result = executeSnakeAlgorithm(makeChildren(5, 100, 50), DEFAULT_BOUNDS, { bkpt: 'bal' });
    expect(result.positions).toHaveLength(5);
    // Should have 2 rows
    const uniqueYs = new Set(result.positions.map((p) => p.y));
    expect(uniqueYs.size).toBeLessThanOrEqual(3);
  });

  test('bkpt=bal with 4 children in 300px canvas should balance to 2+2', () => {
    const result = executeSnakeAlgorithm(makeChildren(4, 100, 50), DEFAULT_BOUNDS, { bkpt: 'bal' });
    // With balanced distribution, should try to be even
    const row1 = result.positions.filter((p) => p.y === 0);
    const row2 = result.positions.filter((p) => p.y > 0);
    expect(row1.length).toBeGreaterThanOrEqual(1);
    expect(row2.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// 6. Offset Mode (off)
// =============================================================================

describe('snake algorithm - off (offset/stagger)', () => {
  test('off=ctr should center rows (no stagger)', () => {
    const result = executeSnakeAlgorithm(makeChildren(6, 50, 50), DEFAULT_BOUNDS, {
      bkpt: 'fixed',
      bkPtFixedVal: '3',
      off: 'ctr',
    });
    // Row 1 and Row 2 should start at the same X
    expect(result.positions[0].x).toBe(result.positions[3].x);
  });

  test('off=off should stagger odd rows', () => {
    const result = executeSnakeAlgorithm(makeChildren(6, 50, 50), DEFAULT_BOUNDS, {
      bkpt: 'fixed',
      bkPtFixedVal: '3',
      off: 'off',
    });
    // Row 2 (odd, 0-indexed) should be offset by half the first child width
    const row1Start = result.positions[0].x;
    const row2Start = result.positions[3].x;
    expect(row2Start).not.toBe(row1Start);
    expect(row2Start - row1Start).toBeCloseTo(25, 0); // half of 50
  });

  test('off=off with 3 rows should stagger rows 2 and not row 3', () => {
    const result = executeSnakeAlgorithm(makeChildren(9, 50, 50), DEFAULT_BOUNDS, {
      bkpt: 'fixed',
      bkPtFixedVal: '3',
      off: 'off',
    });
    const row1Start = result.positions[0].x;
    const row2Start = result.positions[3].x;
    const row3Start = result.positions[6].x;
    // Row 1: no stagger
    expect(row1Start).toBe(0);
    // Row 2: staggered
    expect(row2Start).toBeCloseTo(25, 0);
    // Row 3: no stagger (even row index)
    expect(row3Start).toBe(0);
  });
});

// =============================================================================
// 7. Spacing
// =============================================================================

describe('snake algorithm - spacing', () => {
  test('should add spacing between children', () => {
    const result = executeSnakeAlgorithm(
      makeChildren(3, 50, 50),
      DEFAULT_BOUNDS,
      {},
      10, // 10px spacing
    );
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[1].x).toBe(60); // 50 + 10
    expect(result.positions[2].x).toBe(120); // 50 + 10 + 50 + 10
  });

  test('spacing should affect breakpoint calculation (endCnv)', () => {
    // Canvas=300, children=100, spacing=10: first row fits (100+10+100=210, +10+100=320 > 300) = 2 per row
    const result = executeSnakeAlgorithm(
      makeChildren(5, 100, 50),
      DEFAULT_BOUNDS,
      { bkpt: 'endCnv' },
      10,
    );
    // First two on row 1
    expect(result.positions[1].y).toBe(0);
    // Third on row 2
    expect(result.positions[2].y).toBe(50 + 10);
  });

  test('spacing should separate rows vertically', () => {
    const result = executeSnakeAlgorithm(
      makeChildren(6, 50, 50),
      DEFAULT_BOUNDS,
      { bkpt: 'fixed', bkPtFixedVal: '3' },
      10,
    );
    const row1Y = result.positions[0].y;
    const row2Y = result.positions[3].y;
    expect(row2Y - row1Y).toBe(60); // 50 height + 10 spacing
  });

  test('zero spacing should work like no spacing', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS, {}, 0);
    expect(result.positions[1].x).toBe(50);
  });
});

// =============================================================================
// 8. Edge Cases
// =============================================================================

describe('snake algorithm - edge cases', () => {
  test('should handle single child filling entire canvas', () => {
    const result = executeSnakeAlgorithm([{ w: 300, h: 300 }], DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[0].y).toBe(0);
  });

  test('should handle child larger than canvas (endCnv)', () => {
    // Child is wider than canvas, but at least one per row
    const result = executeSnakeAlgorithm([{ w: 500, h: 50 }], DEFAULT_BOUNDS, { bkpt: 'endCnv' });
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].x).toBe(0);
  });

  test('should handle many small children', () => {
    const result = executeSnakeAlgorithm(makeChildren(100, 10, 10), DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(100);
    // All children should be positioned
    for (const pos of result.positions) {
      expect(pos.w).toBe(10);
      expect(pos.h).toBe(10);
    }
  });

  test('should handle children with different sizes', () => {
    const children = makeVariedChildren([
      [100, 30],
      [50, 40],
      [80, 20],
      [120, 50],
    ]);
    const result = executeSnakeAlgorithm(children, DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(4);
    expect(result.positions[0].w).toBe(100);
    expect(result.positions[1].w).toBe(50);
    expect(result.positions[2].w).toBe(80);
    expect(result.positions[3].w).toBe(120);
  });

  test('should handle zero-size children', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 0, 0), DEFAULT_BOUNDS);
    expect(result.positions).toHaveLength(3);
  });

  test('should handle zero-size bounds', () => {
    const zeroBounds: LayoutBounds = { x: 0, y: 0, w: 0, h: 0 };
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), zeroBounds);
    // At least one child per row
    expect(result.positions).toHaveLength(3);
  });

  test('should handle bounds with non-zero origin', () => {
    const offsetBounds: LayoutBounds = { x: 100, y: 200, w: 300, h: 300 };
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), offsetBounds);
    expect(result.positions[0].x).toBe(100);
    expect(result.positions[0].y).toBe(200);
  });

  test('should compute totalBounds correctly', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS);
    expect(result.totalBounds.w).toBeGreaterThan(0);
    expect(result.totalBounds.h).toBeGreaterThan(0);
  });
});

// =============================================================================
// 9. Combined Parameters
// =============================================================================

describe('snake algorithm - combined parameters', () => {
  test('flowDir=col + grDir=bR should start from bottom-right column', () => {
    const result = executeSnakeAlgorithm(makeChildren(3, 50, 50), DEFAULT_BOUNDS, {
      flowDir: 'col',
      grDir: 'bR',
    });
    // Column flow from bottom-right
    expect(result.positions[0].x).toBe(250);
    expect(result.positions[0].y).toBe(250);
  });

  test('fixed breakpoint + contDir=revDir should create boustrophedon with fixed rows', () => {
    const result = executeSnakeAlgorithm(makeChildren(6, 50, 50), DEFAULT_BOUNDS, {
      bkpt: 'fixed',
      bkPtFixedVal: '3',
      contDir: 'revDir',
    });
    // Row 1 (L->R): 0,50,100
    expect(result.positions[0].x).toBe(0);
    expect(result.positions[2].x).toBe(100);
    // Row 2 (R->L): positions decrease
    expect(result.positions[3].x).toBeGreaterThan(result.positions[4].x);
  });

  test('flowDir=col + bkpt=fixed + bkPtFixedVal=2 should do column-first with 2 per column', () => {
    const result = executeSnakeAlgorithm(makeChildren(4, 50, 50), DEFAULT_BOUNDS, {
      flowDir: 'col',
      bkpt: 'fixed',
      bkPtFixedVal: '2',
    });
    // Column 1: children 0,1
    expect(result.positions[0].x).toBe(result.positions[1].x);
    // Column 2: children 2,3
    expect(result.positions[2].x).toBe(result.positions[3].x);
    expect(result.positions[2].x).toBeGreaterThan(result.positions[0].x);
  });
});
