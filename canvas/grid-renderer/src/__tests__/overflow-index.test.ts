/**
 * OverflowIndex Unit Tests
 *
 * Tests the forward+reverse map tracking of text overflow visual dependencies.
 */

import { OverflowIndex } from '../overflow-index';

describe('OverflowIndex', () => {
  let index: OverflowIndex;

  beforeEach(() => {
    index = new OverflowIndex();
  });

  // -----------------------------------------------------------------------
  // record + forward/reverse lookups
  // -----------------------------------------------------------------------

  describe('record and lookup', () => {
    it('records overflow and returns correct forward extent', () => {
      index.record(0, 1, 1, 4); // row 0, source col 1, extends cols 1-4
      const extent = index.getOverflowExtent(0, 1);
      expect(extent).toEqual({ startCol: 1, endCol: 4 });
    });

    it('records overflow and returns correct reverse sources', () => {
      index.record(0, 1, 1, 4); // source col 1 occupies cols 1-4
      // Reverse: cols 2,3,4 should point back to source col 1
      expect(index.getOverflowSources(0, 2)?.has(1)).toBe(true);
      expect(index.getOverflowSources(0, 3)?.has(1)).toBe(true);
      expect(index.getOverflowSources(0, 4)?.has(1)).toBe(true);
      // Source col itself is NOT in reverse map
      expect(index.getOverflowSources(0, 1)).toBeUndefined();
    });

    it('handles multiple overflows into the same column', () => {
      // Cell A2 (col 0) overflows right into cols 0-2
      index.record(2, 0, 0, 2);
      // Cell E2 (col 4) overflows left into cols 2-4
      index.record(2, 4, 2, 4);

      // Col 2 has two sources: col 0 and col 4
      const sources = index.getOverflowSources(2, 2);
      expect(sources?.size).toBe(2);
      expect(sources?.has(0)).toBe(true);
      expect(sources?.has(4)).toBe(true);
    });

    it('returns undefined for cells not in the index', () => {
      expect(index.getOverflowExtent(0, 5)).toBeUndefined();
      expect(index.getOverflowSources(0, 5)).toBeUndefined();
    });

    it('does not create reverse entry for the source column itself', () => {
      index.record(0, 3, 3, 6);
      // Col 3 is the source — should NOT appear in reverse map
      expect(index.getOverflowSources(0, 3)).toBeUndefined();
      // Cols 4,5,6 should have reverse entries
      expect(index.getOverflowSources(0, 4)?.has(3)).toBe(true);
      expect(index.getOverflowSources(0, 5)?.has(3)).toBe(true);
      expect(index.getOverflowSources(0, 6)?.has(3)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // removeCell
  // -----------------------------------------------------------------------

  describe('removeCell', () => {
    it('removes forward entry and all corresponding reverse entries', () => {
      index.record(0, 1, 1, 4);
      index.removeCell(0, 1);

      expect(index.getOverflowExtent(0, 1)).toBeUndefined();
      expect(index.getOverflowSources(0, 2)).toBeUndefined();
      expect(index.getOverflowSources(0, 3)).toBeUndefined();
      expect(index.getOverflowSources(0, 4)).toBeUndefined();
    });

    it('is a no-op for cells not in the index', () => {
      // Should not throw
      index.removeCell(99, 99);
      expect(index.getOverflowExtent(99, 99)).toBeUndefined();
    });

    it('does not remove other sources from shared reverse entries', () => {
      // Two cells overflow into col 3
      index.record(0, 1, 1, 3); // col 1 overflows into 2,3
      index.record(0, 5, 3, 5); // col 5 overflows into 3,4

      // Remove cell (0,1) — should only remove col 1 as a source from cols 2,3
      index.removeCell(0, 1);

      // Col 3 should still have col 5 as a source
      const sources = index.getOverflowSources(0, 3);
      expect(sources?.has(5)).toBe(true);
      expect(sources?.has(1)).toBeFalsy();
    });

    it('removeCell then record with different range updates correctly', () => {
      // Initial: col 0 overflows into cols 0-3
      index.record(0, 0, 0, 3);

      // Remove and re-record with smaller range
      index.removeCell(0, 0);
      index.record(0, 0, 0, 1);

      // New extent
      expect(index.getOverflowExtent(0, 0)).toEqual({ startCol: 0, endCol: 1 });
      // Col 1 has source
      expect(index.getOverflowSources(0, 1)?.has(0)).toBe(true);
      // Old cols 2,3 should be gone
      expect(index.getOverflowSources(0, 2)).toBeUndefined();
      expect(index.getOverflowSources(0, 3)).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // clear
  // -----------------------------------------------------------------------

  describe('clear', () => {
    it('resets both maps completely', () => {
      index.record(0, 1, 1, 5);
      index.record(1, 2, 2, 7);

      index.clear();

      expect(index.getOverflowExtent(0, 1)).toBeUndefined();
      expect(index.getOverflowExtent(1, 2)).toBeUndefined();
      expect(index.getOverflowSources(0, 3)).toBeUndefined();
      expect(index.getOverflowSources(1, 5)).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Incremental maintenance correctness
  // -----------------------------------------------------------------------

  describe('incremental maintenance', () => {
    it('simulates partial repaint: non-dirty cell entries survive', () => {
      // Frame N: both A1 (col 0) and A5 (col 4) overflow
      index.record(0, 0, 0, 2); // A1 overflows into B1, C1
      index.record(0, 4, 4, 6); // A5 overflows into F1, G1

      // Frame N+1: only col 0 is dirty (partial repaint)
      index.removeCell(0, 0);
      index.record(0, 0, 0, 1); // Now A1 overflows only into B1

      // A5's entries should be untouched
      expect(index.getOverflowExtent(0, 4)).toEqual({ startCol: 4, endCol: 6 });
      expect(index.getOverflowSources(0, 5)?.has(4)).toBe(true);

      // A1's entries should reflect new state
      expect(index.getOverflowExtent(0, 0)).toEqual({ startCol: 0, endCol: 1 });
      expect(index.getOverflowSources(0, 2)).toBeUndefined(); // old extent cleared
    });

    it('simulates cell stops overflowing: removeCell clears entries', () => {
      index.record(0, 0, 0, 3);

      // Cell is re-rendered but no longer overflows
      index.removeCell(0, 0);
      // No record() called — cell text now fits

      expect(index.getOverflowExtent(0, 0)).toBeUndefined();
      expect(index.getOverflowSources(0, 1)).toBeUndefined();
      expect(index.getOverflowSources(0, 2)).toBeUndefined();
      expect(index.getOverflowSources(0, 3)).toBeUndefined();
    });

    it('full repaint after partial repaints rebuilds correctly', () => {
      // Simulate some partial repaints
      index.record(0, 0, 0, 2);
      index.record(0, 5, 3, 5);

      // Full repaint — clear everything
      index.clear();

      // Re-record from scratch (different state)
      index.record(0, 0, 0, 4); // wider overflow

      expect(index.getOverflowExtent(0, 0)).toEqual({ startCol: 0, endCol: 4 });
      // Old entry for col 5 should be gone
      expect(index.getOverflowExtent(0, 5)).toBeUndefined();
      expect(index.getOverflowSources(0, 3)?.has(5)).toBeFalsy();
    });
  });

  // -----------------------------------------------------------------------
  // Overflow chain (edge case)
  // -----------------------------------------------------------------------

  describe('overflow chain', () => {
    it('handles overlapping overflow ranges from different sources', () => {
      // A2 (col 0) overflows right into cols 0-3
      index.record(1, 0, 0, 3);
      // E2 (col 4) overflows left into cols 2-4
      index.record(1, 4, 2, 4);

      // Edit D2 (col 3) — both A2 and E2 should be found via reverse lookup
      // Col 3 reverse: source col 0 (from A2's overflow)
      const sources3 = index.getOverflowSources(1, 3);
      expect(sources3?.has(0)).toBe(true);

      // Col 2 reverse: source col 0 (from A2) and col 4 (from E2)
      const sources2 = index.getOverflowSources(1, 2);
      expect(sources2?.has(0)).toBe(true);
      expect(sources2?.has(4)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Left-aligned overflow (column range includes source)
  // -----------------------------------------------------------------------

  describe('left-aligned overflow', () => {
    it('records source col as startCol for right overflow', () => {
      // Cell at col 2 overflows right into cols 2-5
      index.record(0, 2, 2, 5);
      expect(index.getOverflowExtent(0, 2)).toEqual({ startCol: 2, endCol: 5 });
      // Reverse: cols 3,4,5 point to source 2
      expect(index.getOverflowSources(0, 3)?.has(2)).toBe(true);
      expect(index.getOverflowSources(0, 4)?.has(2)).toBe(true);
      expect(index.getOverflowSources(0, 5)?.has(2)).toBe(true);
    });
  });

  describe('right-aligned overflow', () => {
    it('records source col as endCol for left overflow', () => {
      // Cell at col 5 overflows left into cols 2-5
      index.record(0, 5, 2, 5);
      expect(index.getOverflowExtent(0, 5)).toEqual({ startCol: 2, endCol: 5 });
      // Reverse: cols 2,3,4 point to source 5
      expect(index.getOverflowSources(0, 2)?.has(5)).toBe(true);
      expect(index.getOverflowSources(0, 3)?.has(5)).toBe(true);
      expect(index.getOverflowSources(0, 4)?.has(5)).toBe(true);
    });
  });
});
