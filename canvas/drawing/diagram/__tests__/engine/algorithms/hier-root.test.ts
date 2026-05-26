/**
 * Hierarchy Root Algorithm Tests
 *
 * Tests for the hierarchy root positioning algorithm.
 * Organized by parameter group:
 * - Default behavior (no params)
 * - hierAlign (16 alignment values)
 * - nodeHorzAlign / nodeVertAlign
 * - rtShortDist
 * - Root side determination
 * - Child region computation
 * - Edge cases
 */

import {
  executeHierRootAlgorithm,
  type LayoutBounds,
  type RootInput,
  type SubtreeInput,
} from '../../../src/engine/algorithms/hier-root';

// =============================================================================
// Test Helpers
// =============================================================================

const DEFAULT_BOUNDS: LayoutBounds = { x: 0, y: 0, w: 400, h: 400 };
const DEFAULT_ROOT: RootInput = { w: 100, h: 40 };
const DEFAULT_SUBTREE: SubtreeInput = { w: 200, h: 100 };

// =============================================================================
// 1. Default Behavior (no params)
// =============================================================================

describe('hierRoot algorithm - default behavior', () => {
  test('should position root at top with default params (tCtrCh)', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS);
    expect(result.rootSide).toBe('top');
    expect(result.rootAlignment).toBe('centerChildren');
    expect(result.rootPosition.w).toBe(100);
    expect(result.rootPosition.h).toBe(40);
  });

  test('should have root above child region', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS);
    // Root Y should be above child region Y
    expect(result.rootPosition.y).toBeLessThan(result.childRegion.y);
  });

  test('should preserve root dimensions in output', () => {
    const result = executeHierRootAlgorithm({ w: 120, h: 60 }, DEFAULT_SUBTREE, DEFAULT_BOUNDS);
    expect(result.rootPosition.w).toBe(120);
    expect(result.rootPosition.h).toBe(60);
  });
});

// =============================================================================
// 2. hierAlign — Top Side
// =============================================================================

describe('hierRoot algorithm - hierAlign top variants', () => {
  test('hierAlign=tL should place root at top-left of subtree', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'tL',
      nodeHorzAlign: 'l',
    });
    expect(result.rootSide).toBe('top');
    expect(result.rootAlignment).toBe('start');
    // Root Y at top of bounds
    expect(result.rootPosition.y).toBe(0);
  });

  test('hierAlign=tR should place root at top-right of subtree', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'tR',
      nodeHorzAlign: 'r',
    });
    expect(result.rootSide).toBe('top');
    expect(result.rootAlignment).toBe('end');
    expect(result.rootPosition.y).toBe(0);
  });

  test('hierAlign=tCtrCh should center root over children', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'tCtrCh',
    });
    expect(result.rootSide).toBe('top');
    expect(result.rootAlignment).toBe('centerChildren');
  });

  test('hierAlign=tCtrDes should center root over descendants', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'tCtrDes',
    });
    expect(result.rootSide).toBe('top');
    expect(result.rootAlignment).toBe('centerDescendants');
  });
});

// =============================================================================
// 3. hierAlign — Bottom Side
// =============================================================================

describe('hierRoot algorithm - hierAlign bottom variants', () => {
  test('hierAlign=bL should place root at bottom-left', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'bL',
      nodeHorzAlign: 'l',
    });
    expect(result.rootSide).toBe('bottom');
    expect(result.rootAlignment).toBe('start');
    // Root at bottom of bounds
    expect(result.rootPosition.y).toBe(DEFAULT_BOUNDS.h - DEFAULT_ROOT.h);
  });

  test('hierAlign=bCtrCh should place root at bottom-center', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'bCtrCh',
    });
    expect(result.rootSide).toBe('bottom');
    expect(result.rootAlignment).toBe('centerChildren');
    expect(result.rootPosition.y).toBe(DEFAULT_BOUNDS.h - DEFAULT_ROOT.h);
  });

  test('bottom root should have children above', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'bCtrCh',
    });
    // Child region should be above root
    expect(result.childRegion.y).toBeLessThan(result.rootPosition.y);
  });
});

// =============================================================================
// 4. hierAlign — Left Side
// =============================================================================

describe('hierRoot algorithm - hierAlign left variants', () => {
  test('hierAlign=lT should place root at left-top', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'lT',
      nodeVertAlign: 't',
    });
    expect(result.rootSide).toBe('left');
    expect(result.rootAlignment).toBe('start');
    expect(result.rootPosition.x).toBe(0);
  });

  test('hierAlign=lCtrCh should place root at left-center', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'lCtrCh',
    });
    expect(result.rootSide).toBe('left');
    expect(result.rootAlignment).toBe('centerChildren');
    expect(result.rootPosition.x).toBe(0);
  });

  test('left root should have children to the right', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'lCtrCh',
    });
    // Child region x should be after root
    expect(result.childRegion.x).toBeGreaterThan(result.rootPosition.x);
  });
});

// =============================================================================
// 5. hierAlign — Right Side
// =============================================================================

describe('hierRoot algorithm - hierAlign right variants', () => {
  test('hierAlign=rT should place root at right-top', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'rT',
      nodeVertAlign: 't',
    });
    expect(result.rootSide).toBe('right');
    expect(result.rootAlignment).toBe('start');
    expect(result.rootPosition.x).toBe(DEFAULT_BOUNDS.w - DEFAULT_ROOT.w);
  });

  test('hierAlign=rCtrCh should place root at right-center', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'rCtrCh',
    });
    expect(result.rootSide).toBe('right');
    expect(result.rootAlignment).toBe('centerChildren');
    expect(result.rootPosition.x).toBe(DEFAULT_BOUNDS.w - DEFAULT_ROOT.w);
  });

  test('right root should have children to the left', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'rCtrCh',
    });
    // Child region should be to the left of root
    expect(result.childRegion.x + result.childRegion.w).toBeLessThanOrEqual(
      result.rootPosition.x + 1, // tolerance
    );
  });
});

// =============================================================================
// 6. rtShortDist
// =============================================================================

describe('hierRoot algorithm - rtShortDist', () => {
  test('rtShortDist=0 should leave no gap between root and children', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'tCtrCh',
      rtShortDist: '0',
    });
    // Child region should start immediately after root
    expect(result.childRegion.y).toBe(DEFAULT_ROOT.h);
  });

  test('rtShortDist=20 should add 20px gap between root and children', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'tCtrCh',
      rtShortDist: '20',
    });
    expect(result.childRegion.y).toBe(DEFAULT_ROOT.h + 20);
  });

  test('rtShortDist should reduce available child height', () => {
    const result20 = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'tCtrCh',
      rtShortDist: '20',
    });
    const result0 = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'tCtrCh',
      rtShortDist: '0',
    });
    expect(result20.childRegion.h).toBe(result0.childRegion.h - 20);
  });

  test('rtShortDist with left root should add horizontal gap', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'lCtrCh',
      rtShortDist: '30',
    });
    expect(result.childRegion.x).toBe(DEFAULT_ROOT.w + 30);
  });
});

// =============================================================================
// 7. Child Region Computation
// =============================================================================

describe('hierRoot algorithm - child region', () => {
  test('child region should occupy remaining space after root (top)', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'tCtrCh',
    });
    expect(result.childRegion.h).toBe(DEFAULT_BOUNDS.h - DEFAULT_ROOT.h);
  });

  test('child region should occupy remaining space after root (left)', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'lCtrCh',
    });
    expect(result.childRegion.w).toBe(DEFAULT_BOUNDS.w - DEFAULT_ROOT.w);
  });

  test('child region width should match subtree width for top root', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'tCtrCh',
    });
    expect(result.childRegion.w).toBe(DEFAULT_SUBTREE.w);
  });

  test('child region height should match subtree height for left root', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'lCtrCh',
    });
    expect(result.childRegion.h).toBe(DEFAULT_SUBTREE.h);
  });
});

// =============================================================================
// 8. Edge Cases
// =============================================================================

describe('hierRoot algorithm - edge cases', () => {
  test('should handle root larger than subtree', () => {
    const largeRoot: RootInput = { w: 300, h: 80 };
    const smallSubtree: SubtreeInput = { w: 100, h: 50 };
    const result = executeHierRootAlgorithm(largeRoot, smallSubtree, DEFAULT_BOUNDS, {
      hierAlign: 'tCtrCh',
    });
    expect(result.rootPosition.w).toBe(300);
    expect(result.childRegion.w).toBe(100);
  });

  test('should handle root same size as subtree', () => {
    const root: RootInput = { w: 200, h: 50 };
    const subtree: SubtreeInput = { w: 200, h: 100 };
    const result = executeHierRootAlgorithm(root, subtree, DEFAULT_BOUNDS, { hierAlign: 'tCtrCh' });
    expect(result.rootPosition.w).toBe(200);
    expect(result.childRegion.w).toBe(200);
  });

  test('should handle zero-size subtree', () => {
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, { w: 0, h: 0 }, DEFAULT_BOUNDS, {
      hierAlign: 'tCtrCh',
    });
    expect(result.rootPosition.w).toBe(DEFAULT_ROOT.w);
    expect(result.childRegion.w).toBe(0);
  });

  test('should handle bounds with non-zero origin', () => {
    const offsetBounds: LayoutBounds = { x: 50, y: 100, w: 400, h: 400 };
    const result = executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, offsetBounds, {
      hierAlign: 'tCtrCh',
    });
    expect(result.rootPosition.y).toBe(100);
    expect(result.childRegion.y).toBe(100 + DEFAULT_ROOT.h);
  });

  test('should handle all 16 hierAlign values without error', () => {
    const alignments: Array<
      | 'tL'
      | 'tR'
      | 'tCtrCh'
      | 'tCtrDes'
      | 'bL'
      | 'bR'
      | 'bCtrCh'
      | 'bCtrDes'
      | 'lT'
      | 'lB'
      | 'lCtrCh'
      | 'lCtrDes'
      | 'rT'
      | 'rB'
      | 'rCtrCh'
      | 'rCtrDes'
    > = [
      'tL',
      'tR',
      'tCtrCh',
      'tCtrDes',
      'bL',
      'bR',
      'bCtrCh',
      'bCtrDes',
      'lT',
      'lB',
      'lCtrCh',
      'lCtrDes',
      'rT',
      'rB',
      'rCtrCh',
      'rCtrDes',
    ];

    for (const hierAlign of alignments) {
      expect(() =>
        executeHierRootAlgorithm(DEFAULT_ROOT, DEFAULT_SUBTREE, DEFAULT_BOUNDS, { hierAlign }),
      ).not.toThrow();
    }
  });

  test('child region height should never be negative', () => {
    // Root taller than bounds
    const tallRoot: RootInput = { w: 100, h: 500 };
    const result = executeHierRootAlgorithm(tallRoot, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'tCtrCh',
    });
    expect(result.childRegion.h).toBeGreaterThanOrEqual(0);
  });

  test('child region width should never be negative', () => {
    // Root wider than bounds
    const wideRoot: RootInput = { w: 500, h: 40 };
    const result = executeHierRootAlgorithm(wideRoot, DEFAULT_SUBTREE, DEFAULT_BOUNDS, {
      hierAlign: 'lCtrCh',
    });
    expect(result.childRegion.w).toBeGreaterThanOrEqual(0);
  });
});
