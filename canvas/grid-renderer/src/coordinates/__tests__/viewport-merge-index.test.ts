/**
 * Tests for ViewportMergeIndex
 *
 * Validates O(1) merge point-queries used by the canvas renderer's hot path.
 * Covers index population, lookup correctness, rebuild, clear, and edge cases.
 *
 * @module canvas/coordinates/__tests__/viewport-merge-index.test
 */

import { BinaryMergeInput, MergeRegion, ViewportMergeIndex } from '../viewport-merge-index';

// =============================================================================
// Helpers
// =============================================================================

/** Shorthand to create a BinaryMergeInput in wire format (snake_case). */
function merge(
  start_row: number,
  start_col: number,
  end_row: number,
  end_col: number,
): BinaryMergeInput {
  return { start_row, start_col, end_row, end_col };
}

// =============================================================================
// Tests
// =============================================================================

describe('ViewportMergeIndex', () => {
  let index: ViewportMergeIndex;

  beforeEach(() => {
    index = new ViewportMergeIndex();
  });

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  describe('empty state', () => {
    it('returns null for getMergedRegion on an empty index', () => {
      expect(index.getMergedRegion(0, 0)).toBeNull();
      expect(index.getMergedRegion(5, 10)).toBeNull();
    });

    it('reports hasMerges as false', () => {
      expect(index.hasMerges).toBe(false);
    });

    it('reports mergeCount as 0', () => {
      expect(index.mergeCount).toBe(0);
    });

    it('returns an empty array from getMerges', () => {
      expect(index.getMerges()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Single merge
  // ---------------------------------------------------------------------------

  describe('single merge (rows 2-4, cols 1-3)', () => {
    beforeEach(() => {
      index.setMerges([merge(2, 1, 4, 3)]);
    });

    it('returns the correct MergeRegion for every cell within the merge', () => {
      for (let r = 2; r <= 4; r++) {
        for (let c = 1; c <= 3; c++) {
          const region = index.getMergedRegion(r, c);
          expect(region).not.toBeNull();
          expect(region).toEqual({
            startRow: 2,
            startCol: 1,
            endRow: 4,
            endCol: 3,
          });
        }
      }
    });

    it('returns null for cells outside the merge', () => {
      // Above
      expect(index.getMergedRegion(1, 2)).toBeNull();
      // Below
      expect(index.getMergedRegion(5, 2)).toBeNull();
      // Left
      expect(index.getMergedRegion(3, 0)).toBeNull();
      // Right
      expect(index.getMergedRegion(3, 4)).toBeNull();
      // Diagonal
      expect(index.getMergedRegion(0, 0)).toBeNull();
    });

    it('reports hasMerges as true', () => {
      expect(index.hasMerges).toBe(true);
    });

    it('reports mergeCount as 1', () => {
      expect(index.mergeCount).toBe(1);
    });

    it('returns the same object reference for all cells in the merge', () => {
      const ref = index.getMergedRegion(2, 1);
      for (let r = 2; r <= 4; r++) {
        for (let c = 1; c <= 3; c++) {
          expect(index.getMergedRegion(r, c)).toBe(ref);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple merges
  // ---------------------------------------------------------------------------

  describe('multiple non-overlapping merges', () => {
    let mergeA: MergeRegion | null;
    let mergeB: MergeRegion | null;
    let mergeC: MergeRegion | null;

    beforeEach(() => {
      index.setMerges([
        merge(0, 0, 1, 1), // A: 2x2 top-left
        merge(0, 5, 0, 7), // B: 1x3 top row
        merge(10, 2, 12, 4), // C: 3x3 further down
      ]);
      mergeA = index.getMergedRegion(0, 0);
      mergeB = index.getMergedRegion(0, 5);
      mergeC = index.getMergedRegion(10, 2);
    });

    it('maps cells to the correct merge region', () => {
      // Merge A cells
      expect(index.getMergedRegion(0, 0)).toBe(mergeA);
      expect(index.getMergedRegion(0, 1)).toBe(mergeA);
      expect(index.getMergedRegion(1, 0)).toBe(mergeA);
      expect(index.getMergedRegion(1, 1)).toBe(mergeA);

      // Merge B cells
      expect(index.getMergedRegion(0, 5)).toBe(mergeB);
      expect(index.getMergedRegion(0, 6)).toBe(mergeB);
      expect(index.getMergedRegion(0, 7)).toBe(mergeB);

      // Merge C cells
      expect(index.getMergedRegion(11, 3)).toBe(mergeC);
      expect(index.getMergedRegion(12, 4)).toBe(mergeC);
    });

    it('returns null for cells between merges', () => {
      expect(index.getMergedRegion(0, 3)).toBeNull();
      expect(index.getMergedRegion(5, 5)).toBeNull();
    });

    it('reports mergeCount as 3', () => {
      expect(index.mergeCount).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // getMerges()
  // ---------------------------------------------------------------------------

  describe('getMerges()', () => {
    it('returns all merge regions in insertion order', () => {
      index.setMerges([merge(0, 0, 0, 1), merge(5, 5, 6, 6)]);

      const merges = index.getMerges();
      expect(merges).toHaveLength(2);
      expect(merges[0]).toEqual({ startRow: 0, startCol: 0, endRow: 0, endCol: 1 });
      expect(merges[1]).toEqual({ startRow: 5, startCol: 5, endRow: 6, endCol: 6 });
    });
  });

  // ---------------------------------------------------------------------------
  // Rebuild (setMerges called twice)
  // ---------------------------------------------------------------------------

  describe('rebuild via setMerges', () => {
    it('replaces old entries with new entries', () => {
      // First population
      index.setMerges([merge(0, 0, 2, 2)]);
      expect(index.getMergedRegion(1, 1)).not.toBeNull();
      expect(index.mergeCount).toBe(1);

      // Rebuild with different data
      index.setMerges([merge(10, 10, 11, 11)]);

      // Old merge is gone
      expect(index.getMergedRegion(0, 0)).toBeNull();
      expect(index.getMergedRegion(1, 1)).toBeNull();
      expect(index.getMergedRegion(2, 2)).toBeNull();

      // New merge is present
      expect(index.getMergedRegion(10, 10)).not.toBeNull();
      expect(index.getMergedRegion(11, 11)).not.toBeNull();
      expect(index.mergeCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // clear()
  // ---------------------------------------------------------------------------

  describe('clear()', () => {
    it('removes all merges and resets state', () => {
      index.setMerges([merge(0, 0, 3, 3)]);
      expect(index.hasMerges).toBe(true);

      index.clear();

      expect(index.hasMerges).toBe(false);
      expect(index.mergeCount).toBe(0);
      expect(index.getMergedRegion(0, 0)).toBeNull();
      expect(index.getMergedRegion(2, 2)).toBeNull();
      expect(index.getMerges()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles a single-cell merge (1x1)', () => {
      index.setMerges([merge(5, 5, 5, 5)]);

      const region = index.getMergedRegion(5, 5);
      expect(region).toEqual({
        startRow: 5,
        startCol: 5,
        endRow: 5,
        endCol: 5,
      });
      expect(index.mergeCount).toBe(1);

      // Neighbors are not merged
      expect(index.getMergedRegion(5, 4)).toBeNull();
      expect(index.getMergedRegion(5, 6)).toBeNull();
      expect(index.getMergedRegion(4, 5)).toBeNull();
      expect(index.getMergedRegion(6, 5)).toBeNull();
    });

    it('handles a merge at the origin (row 0, col 0)', () => {
      index.setMerges([merge(0, 0, 0, 0)]);

      expect(index.getMergedRegion(0, 0)).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      });
    });

    it('handles large row indices', () => {
      index.setMerges([merge(100000, 0, 100000, 1)]);

      expect(index.getMergedRegion(100000, 0)).not.toBeNull();
      expect(index.getMergedRegion(100000, 1)).not.toBeNull();
      expect(index.getMergedRegion(100000, 0)).toEqual({
        startRow: 100000,
        startCol: 0,
        endRow: 100000,
        endCol: 1,
      });

      // Adjacent rows are unaffected
      expect(index.getMergedRegion(99999, 0)).toBeNull();
      expect(index.getMergedRegion(100001, 0)).toBeNull();
    });
  });
});
