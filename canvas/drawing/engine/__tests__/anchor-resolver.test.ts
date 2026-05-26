/**
 * Anchor Resolver Tests
 */
import {
  boundsToTwoCellAnchor,
  positionToAnchor,
  resolveAnchor,
  resolveAnchorPoint,
} from '../src/anchor/anchor-resolver';
import type {
  AbsoluteAnchor,
  AnchorPoint,
  CellDimensionLookup,
  OneCellAnchor,
  TwoCellAnchor,
} from '../src/anchor/anchor-types';
import {
  recomputeAbsoluteBounds,
  recomputeBoundsOnCellResize,
  recomputeOneCellBounds,
} from '../src/anchor/resize-with-cells';

// =============================================================================
// TEST FIXTURE: Uniform cell dimensions
// =============================================================================

/**
 * Create a uniform dimension lookup where all cells have the same size.
 */
function uniformDims(colWidth: number, rowHeight: number): CellDimensionLookup {
  return {
    getRowHeight: () => rowHeight,
    getColWidth: () => colWidth,
    getRowTop: (row: number) => row * rowHeight,
    getColLeft: (col: number) => col * colWidth,
  };
}

/**
 * Create a variable dimension lookup.
 */
function variableDims(colWidths: number[], rowHeights: number[]): CellDimensionLookup {
  return {
    getRowHeight: (row: number) => rowHeights[row] ?? 20,
    getColWidth: (col: number) => colWidths[col] ?? 64,
    getRowTop: (row: number) => {
      let sum = 0;
      for (let i = 0; i < row; i++) sum += rowHeights[i] ?? 20;
      return sum;
    },
    getColLeft: (col: number) => {
      let sum = 0;
      for (let i = 0; i < col; i++) sum += colWidths[i] ?? 64;
      return sum;
    },
  };
}

// =============================================================================
// resolveAnchorPoint
// =============================================================================

describe('resolveAnchorPoint', () => {
  it('should resolve anchor at (0,0) with no offset', () => {
    const dims = uniformDims(64, 20);
    const anchor: AnchorPoint = { row: 0, col: 0, xOffset: 0, yOffset: 0 };
    const result = resolveAnchorPoint(anchor, dims);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('should resolve anchor with offsets', () => {
    const dims = uniformDims(64, 20);
    const anchor: AnchorPoint = { row: 2, col: 3, xOffset: 10, yOffset: 5 };
    const result = resolveAnchorPoint(anchor, dims);
    expect(result.x).toBe(3 * 64 + 10); // 202
    expect(result.y).toBe(2 * 20 + 5); // 45
  });

  it('should handle variable dimensions', () => {
    const dims = variableDims([100, 200, 50], [30, 40, 50]);
    const anchor: AnchorPoint = { row: 2, col: 1, xOffset: 10, yOffset: 5 };
    const result = resolveAnchorPoint(anchor, dims);
    expect(result.x).toBe(100 + 10); // colLeft(1) = 100, + offset
    expect(result.y).toBe(30 + 40 + 5); // rowTop(2) = 70, + offset
  });
});

// =============================================================================
// resolveAnchor (twoCell)
// =============================================================================

describe('resolveAnchor - twoCell', () => {
  it('should resolve twoCell anchor to bounding box', () => {
    const dims = uniformDims(64, 20);
    const anchor: TwoCellAnchor = {
      type: 'twoCell',
      from: { row: 1, col: 1, xOffset: 0, yOffset: 0 },
      to: { row: 3, col: 4, xOffset: 0, yOffset: 0 },
    };
    const result = resolveAnchor(anchor, dims);
    expect(result.x).toBe(64);
    expect(result.y).toBe(20);
    expect(result.width).toBe(3 * 64); // (4-1) * 64 = 192
    expect(result.height).toBe(2 * 20); // (3-1) * 20 = 40
  });

  it('should handle offsets in twoCell anchor', () => {
    const dims = uniformDims(64, 20);
    const anchor: TwoCellAnchor = {
      type: 'twoCell',
      from: { row: 0, col: 0, xOffset: 10, yOffset: 5 },
      to: { row: 2, col: 2, xOffset: 30, yOffset: 15 },
    };
    const result = resolveAnchor(anchor, dims);
    expect(result.x).toBe(10);
    expect(result.y).toBe(5);
    expect(result.width).toBe(2 * 64 + 30 - 10); // 148
    expect(result.height).toBe(2 * 20 + 15 - 5); // 50
  });
});

// =============================================================================
// resolveAnchor (oneCell)
// =============================================================================

describe('resolveAnchor - oneCell', () => {
  it('should resolve oneCell anchor', () => {
    const dims = uniformDims(64, 20);
    const anchor: OneCellAnchor = {
      type: 'oneCell',
      from: { row: 1, col: 2, xOffset: 5, yOffset: 3 },
      width: 150,
      height: 80,
    };
    const result = resolveAnchor(anchor, dims);
    expect(result.x).toBe(2 * 64 + 5); // 133
    expect(result.y).toBe(1 * 20 + 3); // 23
    expect(result.width).toBe(150);
    expect(result.height).toBe(80);
  });
});

// =============================================================================
// resolveAnchor (absolute)
// =============================================================================

describe('resolveAnchor - absolute', () => {
  it('should resolve absolute anchor directly', () => {
    const dims = uniformDims(64, 20);
    const anchor: AbsoluteAnchor = {
      type: 'absolute',
      x: 100,
      y: 200,
      width: 300,
      height: 150,
    };
    const result = resolveAnchor(anchor, dims);
    expect(result).toEqual({ x: 100, y: 200, width: 300, height: 150 });
  });
});

// =============================================================================
// positionToAnchor
// =============================================================================

describe('positionToAnchor', () => {
  it('should convert pixel position to anchor', () => {
    const dims = uniformDims(64, 20);
    const anchor = positionToAnchor({ x: 100, y: 35 }, dims);
    expect(anchor.col).toBe(1); // 64 < 100 < 128
    expect(anchor.xOffset).toBeCloseTo(36); // 100 - 64
    expect(anchor.row).toBe(1); // 20 < 35 < 40
    expect(anchor.yOffset).toBeCloseTo(15); // 35 - 20
  });

  it('should handle position at cell boundary', () => {
    const dims = uniformDims(64, 20);
    const anchor = positionToAnchor({ x: 128, y: 40 }, dims);
    expect(anchor.col).toBe(2);
    expect(anchor.xOffset).toBeCloseTo(0);
    expect(anchor.row).toBe(2);
    expect(anchor.yOffset).toBeCloseTo(0);
  });

  it('should handle position at origin', () => {
    const dims = uniformDims(64, 20);
    const anchor = positionToAnchor({ x: 0, y: 0 }, dims);
    expect(anchor.col).toBe(0);
    expect(anchor.xOffset).toBe(0);
    expect(anchor.row).toBe(0);
    expect(anchor.yOffset).toBe(0);
  });

  it('should handle variable cell sizes', () => {
    const dims = variableDims([100, 200, 50], [30, 40, 50]);
    const anchor = positionToAnchor({ x: 150, y: 50 }, dims);
    // x=150: col0=100, so col=1, xOffset=50
    expect(anchor.col).toBe(1);
    expect(anchor.xOffset).toBeCloseTo(50);
    // y=50: row0=30, so row=1, yOffset=20
    expect(anchor.row).toBe(1);
    expect(anchor.yOffset).toBeCloseTo(20);
  });
});

// =============================================================================
// boundsToTwoCellAnchor
// =============================================================================

describe('boundsToTwoCellAnchor', () => {
  it('should create twoCell anchor from bounds', () => {
    const dims = uniformDims(64, 20);
    const anchor = boundsToTwoCellAnchor({ x: 10, y: 5, width: 200, height: 50 }, dims);
    expect(anchor.type).toBe('twoCell');
    expect(anchor.from.col).toBe(0);
    expect(anchor.from.xOffset).toBeCloseTo(10);
    expect(anchor.from.row).toBe(0);
    expect(anchor.from.yOffset).toBeCloseTo(5);
    // to = (210, 55)
    expect(anchor.to.col).toBe(3); // 192 < 210 < 256
    expect(anchor.to.row).toBe(2); // 40 < 55 < 60
  });

  it('should round-trip with resolveAnchor', () => {
    const dims = uniformDims(64, 20);
    const originalBounds = { x: 64, y: 20, width: 128, height: 40 };
    const anchor = boundsToTwoCellAnchor(originalBounds, dims);
    const resolved = resolveAnchor(anchor, dims);
    expect(resolved.x).toBeCloseTo(originalBounds.x);
    expect(resolved.y).toBeCloseTo(originalBounds.y);
    expect(resolved.width).toBeCloseTo(originalBounds.width);
    expect(resolved.height).toBeCloseTo(originalBounds.height);
  });
});

// =============================================================================
// recomputeBoundsOnCellResize (twoCell)
// =============================================================================

describe('recomputeBoundsOnCellResize', () => {
  it('should recompute bounds when cells resize', () => {
    const oldDims = uniformDims(64, 20);
    const newDims = uniformDims(128, 40); // doubled

    const anchor: TwoCellAnchor = {
      type: 'twoCell',
      from: { row: 1, col: 1, xOffset: 0, yOffset: 0 },
      to: { row: 3, col: 3, xOffset: 0, yOffset: 0 },
    };

    const oldBounds = resolveAnchor(anchor, oldDims);
    const newBounds = recomputeBoundsOnCellResize(anchor, oldDims, newDims);

    // Should have doubled in size
    expect(newBounds.width).toBe(oldBounds.width * 2);
    expect(newBounds.height).toBe(oldBounds.height * 2);
    expect(newBounds.x).toBe(oldBounds.x * 2);
    expect(newBounds.y).toBe(oldBounds.y * 2);
  });

  it('should handle offsets correctly', () => {
    const newDims = uniformDims(100, 30);
    const anchor: TwoCellAnchor = {
      type: 'twoCell',
      from: { row: 0, col: 0, xOffset: 10, yOffset: 5 },
      to: { row: 2, col: 2, xOffset: 20, yOffset: 10 },
    };
    const result = recomputeBoundsOnCellResize(anchor, newDims, newDims);
    expect(result.x).toBe(10);
    expect(result.y).toBe(5);
    expect(result.width).toBe(200 + 20 - 10); // 210
    expect(result.height).toBe(60 + 10 - 5); // 65
  });
});

// =============================================================================
// recomputeAbsoluteBounds
// =============================================================================

describe('recomputeAbsoluteBounds', () => {
  it('should return same bounds regardless of cell changes', () => {
    const anchor: AbsoluteAnchor = { type: 'absolute', x: 100, y: 200, width: 300, height: 150 };
    const result = recomputeAbsoluteBounds(anchor);
    expect(result).toEqual({ x: 100, y: 200, width: 300, height: 150 });
  });
});

// =============================================================================
// recomputeOneCellBounds
// =============================================================================

describe('recomputeOneCellBounds', () => {
  it('should recompute position but keep size', () => {
    const dims = uniformDims(64, 20);
    const anchor: OneCellAnchor = {
      type: 'oneCell',
      from: { row: 1, col: 1, xOffset: 10, yOffset: 5 },
      width: 200,
      height: 100,
    };
    const result = recomputeOneCellBounds(anchor, dims);
    expect(result.x).toBe(64 + 10);
    expect(result.y).toBe(20 + 5);
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });

  it('should update position when cell dimensions change', () => {
    const smallDims = uniformDims(64, 20);
    const bigDims = uniformDims(128, 40);

    const anchor: OneCellAnchor = {
      type: 'oneCell',
      from: { row: 1, col: 1, xOffset: 10, yOffset: 5 },
      width: 200,
      height: 100,
    };

    const smallResult = recomputeOneCellBounds(anchor, smallDims);
    const bigResult = recomputeOneCellBounds(anchor, bigDims);

    // Position should change, size stays the same
    expect(bigResult.x).toBe(128 + 10);
    expect(smallResult.x).toBe(64 + 10);
    expect(bigResult.width).toBe(smallResult.width); // same
    expect(bigResult.height).toBe(smallResult.height); // same
  });
});
