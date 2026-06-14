/**
 * Data-Edge Selection Extension Tests
 *
 * Tests for the bug where pressing Cmd+Shift+Left followed by Cmd+Shift+Up
 * only applies the second command, losing the rectangular selection.
 *
 * ROOT CAUSE:
 * The extendToDataEdge() function in data-edge.ts uses `currentRange.endRow/endCol`
 * (the normalized bottom-right corner) to determine the "extendFrom" cell, instead
 * of using `getMovingEdge()` to find the actual moving edge of the selection.
 *
 * EXAMPLE OF THE BUG:
 * 1. Start at B5 (4,1) with data in A5 and B1:B4
 * 2. Cmd+Shift+Left: anchor=B5, extendFrom=B5, target=A5 → range A5:B5 ✓
 * 3. Cmd+Shift+Up: anchor=B5, extendFrom=B5 (BUG: should be A5!)
 * - findDataEdge(B5, 'up') = B1 (top of data region in column B)
 * - Creates range B1:B5 (loses the left extension!)
 *
 * EXPECTED BEHAVIOR:
 * 3. Cmd+Shift+Up: anchor=B5, extendFrom=A5 (moving edge)
 * - findDataEdge(A5, 'up') = A1 (top of data region in column A)
 * - Creates range A1:B5 (rectangular selection preserved!)
 *
 * THE FIX:
 * The extendToDataEdge() function should use getMovingEdge(currentRange, anchor)
 * to find the moving edge, not currentRange.endRow/endCol.
 *
 * @see ../data-edge.ts - The extendToDataEdge function (line 74-103)
 * @see ../../selection/keyboard-actions.ts - Similar fix already applied for Shift+Arrow
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { jest } from '@jest/globals';
import { findDataEdge } from '../../../../infra/utils';
import type { CellCoord, CellRange } from '../../../../systems/shared/types';
import { getMovingEdge, rangeFromAnchorAndCell } from '../../../../systems/shared/types';
import { EXTEND_TO_EDGE_RIGHT } from '../data-edge';

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Simulates extendToDataEdge behavior - CURRENT (BUGGY) implementation
 * This is a direct port of the logic in data-edge.ts:74-103
 */
function extendToDataEdgeBuggy(
  activeCell: CellCoord,
  ranges: CellRange[],
  anchor: CellCoord | null,
  direction: 'up' | 'down' | 'left' | 'right',
  getCellValue: (row: number, col: number) => CellValue | undefined,
): CellRange {
  // Get the end of the current range (where we're extending from)
  // BUG: This uses the normalized end, not the moving edge
  const currentRange = ranges[ranges.length - 1] as CellRange | undefined;
  const extendFrom: CellCoord =
    currentRange != null ? { row: currentRange.endRow, col: currentRange.endCol } : activeCell;

  // Find target using data-aware edge detection
  const targetCell = findDataEdge(
    extendFrom,
    direction,
    getCellValue,
    1048575, // MAX_ROWS - 1
    16383, // MAX_COLS - 1
  );

  // Create new range from anchor to target
  const anchorCell: CellCoord = anchor ?? activeCell;
  return rangeFromAnchorAndCell(anchorCell, targetCell);
}

/**
 * Simulates extendToDataEdge behavior - FIXED implementation
 * Uses getMovingEdge() to find the correct cell to extend from
 */
function extendToDataEdgeFixed(
  activeCell: CellCoord,
  ranges: CellRange[],
  anchor: CellCoord | null,
  direction: 'up' | 'down' | 'left' | 'right',
  getCellValue: (row: number, col: number) => CellValue | undefined,
): CellRange {
  // Use existing anchor, or establish it from activeCell on first extend
  const anchorCell: CellCoord = anchor ?? activeCell;

  // Get the "moving edge" - the corner opposite the anchor that should move
  // FIX: Use getMovingEdge() instead of normalized end
  const currentRange = ranges[ranges.length - 1] as CellRange | undefined;
  const extendFrom: CellCoord = currentRange ? getMovingEdge(currentRange, anchorCell) : activeCell;

  // Find target using data-aware edge detection
  const targetCell = findDataEdge(
    extendFrom,
    direction,
    getCellValue,
    1048575, // MAX_ROWS - 1
    16383, // MAX_COLS - 1
  );

  // Create new range from anchor to target
  return rangeFromAnchorAndCell(anchorCell, targetCell);
}

/**
 * Create a mock getCellValue function from a sparse data map.
 * @param data - Map of "row,col" -> value
 */
function createMockGetCellValue(
  data: Map<string, unknown>,
): (row: number, col: number) => CellValue | undefined {
  return (row: number, col: number) => data.get(`${row},${col}`) as CellValue | undefined;
}

// =============================================================================
// BUG REPRODUCTION TESTS
// =============================================================================

describe('extendToDataEdge - Cmd+Shift+Arrow bug reproduction', () => {
  /**
   * This test reproduces the exact bug scenario:
   * 1. Start at B5 with data in A5 and B1:B4
   * 2. Cmd+Shift+Left extends to A5:B5 (correct)
   * 3. Cmd+Shift+Up should create A1:B5 (rectangular)
   * BUG: Actually creates B1:B5 (loses left extension)
   */
  describe('Horizontal then vertical extension (Cmd+Shift+Left then Cmd+Shift+Up)', () => {
    // Test data setup:
    // - B5 (4,1) is the starting cell
    // - A5 (4,0) has data
    // - B1:B4 (0,1 to 3,1) has data
    // - A1:A4 (0,0 to 3,0) has data
    const testData = new Map<string, unknown>([
      // Column A data
      ['0,0', 'A1 data'],
      ['1,0', 'A2 data'],
      ['2,0', 'A3 data'],
      ['3,0', 'A4 data'],
      ['4,0', 'A5 data'],
      // Column B data
      ['0,1', 'B1 data'],
      ['1,1', 'B2 data'],
      ['2,1', 'B3 data'],
      ['3,1', 'B4 data'],
      ['4,1', 'B5 data'], // Starting cell
    ]);

    const getCellValue = createMockGetCellValue(testData);

    it('Step 1: Cmd+Shift+Left from B5 extends to A5:B5', () => {
      const activeCell: CellCoord = { row: 4, col: 1 }; // B5
      const ranges: CellRange[] = [{ startRow: 4, startCol: 1, endRow: 4, endCol: 1 }];
      const anchor: CellCoord | null = null; // No anchor yet

      const result = extendToDataEdgeBuggy(activeCell, ranges, anchor, 'left', getCellValue);

      // Should extend to A5:B5
      expect(result).toEqual({
        startRow: 4,
        startCol: 0,
        endRow: 4,
        endCol: 1,
      });
    });

    it('Step 2: BUG - Cmd+Shift+Up from A5:B5 creates B1:B5 (loses left extension)', () => {
      const activeCell: CellCoord = { row: 4, col: 1 }; // B5
      // After Step 1, we have A5:B5 selected with anchor at B5
      const ranges: CellRange[] = [{ startRow: 4, startCol: 0, endRow: 4, endCol: 1 }]; // A5:B5
      const anchor: CellCoord = { row: 4, col: 1 }; // B5

      const result = extendToDataEdgeBuggy(activeCell, ranges, anchor, 'up', getCellValue);

      // BUG: Creates B1:B5 because extendFrom uses currentRange.endRow/endCol = B5
      // This is WRONG - should preserve the left extension (A column)
      expect(result).toEqual({
        startRow: 0, // B1
        startCol: 1, // Column B (loses column A!)
        endRow: 4, // B5
        endCol: 1, // Column B
      });
    });

    it('Step 2: FIXED - Cmd+Shift+Up from A5:B5 creates A1:B5 (rectangular)', () => {
      const activeCell: CellCoord = { row: 4, col: 1 }; // B5
      // After Step 1, we have A5:B5 selected with anchor at B5
      const ranges: CellRange[] = [{ startRow: 4, startCol: 0, endRow: 4, endCol: 1 }]; // A5:B5
      const anchor: CellCoord = { row: 4, col: 1 }; // B5

      const result = extendToDataEdgeFixed(activeCell, ranges, anchor, 'up', getCellValue);

      // FIXED: Creates A1:B5 because extendFrom uses getMovingEdge() = A5
      // findDataEdge(A5, 'up') finds A1, then rangeFromAnchorAndCell(B5, A1) = A1:B5
      expect(result).toEqual({
        startRow: 0, // A1
        startCol: 0, // Column A (preserved!)
        endRow: 4, // B5
        endCol: 1, // Column B
      });
    });
  });

  /**
   * Reverse scenario: Vertical then horizontal extension
   * Cmd+Shift+Up then Cmd+Shift+Left
   */
  describe('Vertical then horizontal extension (Cmd+Shift+Up then Cmd+Shift+Left)', () => {
    const testData = new Map<string, unknown>([
      // Column A data
      ['0,0', 'A1 data'],
      ['1,0', 'A2 data'],
      ['2,0', 'A3 data'],
      ['3,0', 'A4 data'],
      ['4,0', 'A5 data'],
      // Column B data
      ['0,1', 'B1 data'],
      ['1,1', 'B2 data'],
      ['2,1', 'B3 data'],
      ['3,1', 'B4 data'],
      ['4,1', 'B5 data'], // Starting cell
    ]);

    const getCellValue = createMockGetCellValue(testData);

    it('Step 1: Cmd+Shift+Up from B5 extends to B1:B5', () => {
      const activeCell: CellCoord = { row: 4, col: 1 }; // B5
      const ranges: CellRange[] = [{ startRow: 4, startCol: 1, endRow: 4, endCol: 1 }];
      const anchor: CellCoord | null = null;

      const result = extendToDataEdgeBuggy(activeCell, ranges, anchor, 'up', getCellValue);

      expect(result).toEqual({
        startRow: 0,
        startCol: 1,
        endRow: 4,
        endCol: 1,
      });
    });

    it('Step 2: BUG - Cmd+Shift+Left from B1:B5 creates A5:B5 (loses up extension)', () => {
      const activeCell: CellCoord = { row: 4, col: 1 }; // B5
      // After Step 1, we have B1:B5 selected with anchor at B5
      const ranges: CellRange[] = [{ startRow: 0, startCol: 1, endRow: 4, endCol: 1 }]; // B1:B5
      const anchor: CellCoord = { row: 4, col: 1 }; // B5

      const result = extendToDataEdgeBuggy(activeCell, ranges, anchor, 'left', getCellValue);

      // BUG: Creates A5:B5 because extendFrom uses currentRange.endRow/endCol = B5 (row 4)
      // This is WRONG - should preserve the up extension (rows 0-4)
      expect(result).toEqual({
        startRow: 4, // Row 5 (loses rows 1-4!)
        startCol: 0, // A
        endRow: 4, // Row 5
        endCol: 1, // B
      });
    });

    it('Step 2: FIXED - Cmd+Shift+Left from B1:B5 creates A1:B5 (rectangular)', () => {
      const activeCell: CellCoord = { row: 4, col: 1 }; // B5
      // After Step 1, we have B1:B5 selected with anchor at B5
      const ranges: CellRange[] = [{ startRow: 0, startCol: 1, endRow: 4, endCol: 1 }]; // B1:B5
      const anchor: CellCoord = { row: 4, col: 1 }; // B5

      const result = extendToDataEdgeFixed(activeCell, ranges, anchor, 'left', getCellValue);

      // FIXED: Creates A1:B5 because extendFrom uses getMovingEdge() = B1
      // findDataEdge(B1, 'left') finds A1, then rangeFromAnchorAndCell(B5, A1) = A1:B5
      expect(result).toEqual({
        startRow: 0, // Row 1 (preserved!)
        startCol: 0, // A
        endRow: 4, // Row 5
        endCol: 1, // B
      });
    });
  });

  /**
   * Edge case: Extending in the same direction twice should continue extending
   */
  describe('Repeated same-direction extension (Cmd+Shift+Up twice)', () => {
    const testData = new Map<string, unknown>([
      // Sparse data with gaps to test findDataEdge behavior
      ['4,1', 'B5 data'], // Starting cell
      ['3,1', 'B4 data'],
      // Gap at row 2
      ['1,1', 'B2 data'],
      ['0,1', 'B1 data'],
    ]);

    const getCellValue = createMockGetCellValue(testData);

    it('First Cmd+Shift+Up stops at edge of first data region', () => {
      const activeCell: CellCoord = { row: 4, col: 1 }; // B5
      const ranges: CellRange[] = [{ startRow: 4, startCol: 1, endRow: 4, endCol: 1 }];
      const anchor: CellCoord | null = null;

      const result = extendToDataEdgeBuggy(activeCell, ranges, anchor, 'up', getCellValue);

      // Should extend to the edge of the contiguous data region (B4 since there's a gap at B3)
      // Actually findDataEdge finds the boundary, which would be B4 (row 3)
      expect(result).toEqual({
        startRow: 3,
        startCol: 1,
        endRow: 4,
        endCol: 1,
      });
    });

    it('Second Cmd+Shift+Up - BUG: stays at same position (no progress)', () => {
      const activeCell: CellCoord = { row: 4, col: 1 }; // B5
      // After first extension: B4:B5
      const ranges: CellRange[] = [{ startRow: 3, startCol: 1, endRow: 4, endCol: 1 }];
      const anchor: CellCoord = { row: 4, col: 1 }; // B5

      const result = extendToDataEdgeBuggy(activeCell, ranges, anchor, 'up', getCellValue);

      // BUG: extendFrom = B5 (endRow=4), findDataEdge(B5, 'up') = B4 again
      // Range stays B4:B5, no progress!
      expect(result).toEqual({
        startRow: 3,
        startCol: 1,
        endRow: 4,
        endCol: 1,
      });
    });

    it('Second Cmd+Shift+Up - FIXED: continues to next data edge', () => {
      const activeCell: CellCoord = { row: 4, col: 1 }; // B5
      // After first extension: B4:B5
      const ranges: CellRange[] = [{ startRow: 3, startCol: 1, endRow: 4, endCol: 1 }];
      const anchor: CellCoord = { row: 4, col: 1 }; // B5

      const result = extendToDataEdgeFixed(activeCell, ranges, anchor, 'up', getCellValue);

      // FIXED: extendFrom = B4 (moving edge), findDataEdge(B4, 'up') = B2 or B1
      // (depends on findDataEdge implementation - should jump across gap to next data)
      // Range extends to include more rows above
      expect(result.startRow).toBeLessThan(3); // Should have extended further up
    });
  });
});

describe('EXTEND_TO_EDGE handler contract', () => {
  it('keeps activeCell at the anchor while extending to the data edge', async () => {
    const activeCell: CellCoord = { row: 0, col: 0 };
    const targetCell: CellCoord = { row: 0, col: 2 };
    const setSelection = jest.fn();

    const deps = {
      accessors: {
        selection: {
          getActiveCell: () => activeCell,
          getRanges: () => [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
          getAnchor: () => null,
        },
      },
      workbook: {
        activeSheet: {
          findDataEdge: jest.fn().mockResolvedValue(targetCell as never),
        },
      },
      commands: {
        selection: {
          setSelection,
        },
      },
    } as unknown as ActionDependencies;

    const result = await EXTEND_TO_EDGE_RIGHT(deps);

    expect(result.handled).toBe(true);
    expect(setSelection).toHaveBeenCalledWith(
      [{ startRow: 0, startCol: 0, endRow: 0, endCol: 2 }],
      activeCell,
      activeCell,
    );
  });
});

// =============================================================================
// getMovingEdge UNIT TESTS
// =============================================================================

describe('getMovingEdge - Core utility function', () => {
  it('returns activeCell for single-cell selection', () => {
    const range: CellRange = { startRow: 4, startCol: 1, endRow: 4, endCol: 1 };
    const anchor: CellCoord = { row: 4, col: 1 };

    const result = getMovingEdge(range, anchor);

    // For single cell, the moving edge is the cell itself
    expect(result).toEqual({ row: 4, col: 1 });
  });

  it('returns top-left corner when anchor is at bottom-right', () => {
    // Range A1:B5 (rows 0-4, cols 0-1) with anchor at B5 (4,1)
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 4, endCol: 1 };
    const anchor: CellCoord = { row: 4, col: 1 }; // B5

    const result = getMovingEdge(range, anchor);

    // Moving edge should be A1 (opposite of B5)
    expect(result).toEqual({ row: 0, col: 0 });
  });

  it('returns bottom-right corner when anchor is at top-left', () => {
    // Range A1:B5 (rows 0-4, cols 0-1) with anchor at A1 (0,0)
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 4, endCol: 1 };
    const anchor: CellCoord = { row: 0, col: 0 }; // A1

    const result = getMovingEdge(range, anchor);

    // Moving edge should be B5 (opposite of A1)
    expect(result).toEqual({ row: 4, col: 1 });
  });

  it('handles horizontal-only selection (same row)', () => {
    // Range A5:B5 (row 4, cols 0-1) with anchor at B5 (4,1)
    const range: CellRange = { startRow: 4, startCol: 0, endRow: 4, endCol: 1 };
    const anchor: CellCoord = { row: 4, col: 1 }; // B5

    const result = getMovingEdge(range, anchor);

    // Moving edge should be A5 (opposite column, same row)
    expect(result).toEqual({ row: 4, col: 0 });
  });

  it('handles vertical-only selection (same column)', () => {
    // Range B1:B5 (rows 0-4, col 1) with anchor at B5 (4,1)
    const range: CellRange = { startRow: 0, startCol: 1, endRow: 4, endCol: 1 };
    const anchor: CellCoord = { row: 4, col: 1 }; // B5

    const result = getMovingEdge(range, anchor);

    // Moving edge should be B1 (opposite row, same column)
    expect(result).toEqual({ row: 0, col: 1 });
  });

  it('handles anchor in middle of range (picks furthest edges)', () => {
    // Range A1:D10 (rows 0-9, cols 0-3) with anchor at B5 (4,1)
    // This is an unusual case but getMovingEdge should handle it
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 9, endCol: 3 };
    const anchor: CellCoord = { row: 4, col: 1 }; // B5 (middle-ish)

    const result = getMovingEdge(range, anchor);

    // Should pick the corners furthest from anchor in each dimension
    // Row: |0-4|=4 vs |9-4|=5, so pick endRow=9
    // Col: |0-1|=1 vs |3-1|=2, so pick endCol=3
    expect(result).toEqual({ row: 9, col: 3 });
  });
});

// =============================================================================
// DOCUMENTATION
// =============================================================================

/**
 * BUG SUMMARY:
 *
 * File: apps/spreadsheet/src/actions/handlers/selection/data-edge.ts
 * Function: extendToDataEdge (lines 74-103)
 *
 * Current (buggy) code at lines 82-84:
 * ```typescript
 * const currentRange = ranges[ranges.length - 1] as CellRange | undefined;
 * const extendFrom: CellCoord =
 * currentRange != null ? { row: currentRange.endRow, col: currentRange.endCol } : activeCell;
 * ```
 *
 * The bug is using `currentRange.endRow` and `currentRange.endCol` which always
 * returns the normalized bottom-right corner of the range, regardless of where
 * the anchor is.
 *
 * RECOMMENDED FIX (add import at top):
 * ```typescript
 * import { getMovingEdge } from '../../../machines/types';
 * ```
 *
 * Replace lines 82-84 with:
 * ```typescript
 * const anchorCell: CellCoord = anchor ?? activeCell;
 * const currentRange = ranges[ranges.length - 1] as CellRange | undefined;
 * const extendFrom: CellCoord = currentRange
 * ? getMovingEdge(currentRange, anchorCell)
 * : activeCell;
 * ```
 *
 * This mirrors the fix that was already applied to the Shift+Arrow handling
 * in keyboard-actions.ts (see line 129).
 */
