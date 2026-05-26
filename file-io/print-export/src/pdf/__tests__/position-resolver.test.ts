/**
 * Tests for DefaultPositionResolver — converts sheet anchors to page positions.
 */

import type { PageSlice } from '../position-resolver';
import { DefaultPositionResolver } from '../position-resolver';

// ============================================================================
// Helpers
// ============================================================================

/** Create a simple single-page slice covering the given row/col range. */
function singlePageSlice(endRow: number, endCol: number, opts?: Partial<PageSlice>): PageSlice {
  return {
    startRow: 0,
    endRow,
    startCol: 0,
    endCol,
    offsetX: 0,
    offsetY: 0,
    pageIndex: 0,
    ...opts,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('DefaultPositionResolver', () => {
  describe('single page', () => {
    it('resolves anchor at origin (row 0, col 0) with no offset', () => {
      const resolver = new DefaultPositionResolver(
        [20, 20, 20], // row heights
        [64, 64, 64], // col widths
        [singlePageSlice(3, 3)],
      );

      const pos = resolver.resolvePosition(0, 0, 0, 0);
      expect(pos).toEqual({ pageIndex: 0, x: 0, y: 0 });
    });

    it('resolves anchor at row 2, col 1 by summing heights and widths', () => {
      const resolver = new DefaultPositionResolver(
        [20, 30, 25], // row heights
        [50, 80, 60], // col widths
        [singlePageSlice(3, 3)],
      );

      // x = offsetX(0) + xOffset(0) + colWidths[0](50) = 50
      // y = offsetY(0) + yOffset(0) + rowHeights[0](20) + rowHeights[1](30) = 50
      const pos = resolver.resolvePosition(2, 1, 0, 0);
      expect(pos).toEqual({ pageIndex: 0, x: 50, y: 50 });
    });

    it('includes sub-cell offsets in the result', () => {
      const resolver = new DefaultPositionResolver([20, 20], [64, 64], [singlePageSlice(2, 2)]);

      // x = 0 + 5 + 64 = 69 (col 1 + xOffset 5)
      // y = 0 + 3 + 20 = 23 (row 1 + yOffset 3)
      const pos = resolver.resolvePosition(1, 1, 5, 3);
      expect(pos).toEqual({ pageIndex: 0, x: 69, y: 23 });
    });

    it('uses page slice offsets', () => {
      const resolver = new DefaultPositionResolver(
        [20],
        [64],
        [singlePageSlice(1, 1, { offsetX: 72, offsetY: 54 })],
      );

      // x = 72 + 10 = 82
      // y = 54 + 5 = 59
      const pos = resolver.resolvePosition(0, 0, 10, 5);
      expect(pos).toEqual({ pageIndex: 0, x: 82, y: 59 });
    });

    it('uses default dimensions for missing row heights and col widths', () => {
      // Sparse arrays: only row 0 and col 0 have explicit sizes
      const resolver = new DefaultPositionResolver(
        [25], // row 0 = 25, row 1+ = default (20)
        [100], // col 0 = 100, col 1+ = default (64)
        [singlePageSlice(5, 5)],
      );

      // x = 0 + 0 + colWidths[0](100) + default(64) = 164
      // y = 0 + 0 + rowHeights[0](25) + default(20) = 45
      const pos = resolver.resolvePosition(2, 2, 0, 0);
      expect(pos).toEqual({ pageIndex: 0, x: 164, y: 45 });
    });
  });

  describe('multi-page', () => {
    const pageSlices: PageSlice[] = [
      // Page 0: rows 0-4, cols 0-2
      { startRow: 0, endRow: 5, startCol: 0, endCol: 3, offsetX: 36, offsetY: 36, pageIndex: 0 },
      // Page 1: rows 5-9, cols 0-2
      { startRow: 5, endRow: 10, startCol: 0, endCol: 3, offsetX: 36, offsetY: 36, pageIndex: 1 },
      // Page 2: rows 0-4, cols 3-5 (horizontal split)
      { startRow: 0, endRow: 5, startCol: 3, endCol: 6, offsetX: 36, offsetY: 36, pageIndex: 2 },
    ];

    const rowHeights = Array.from({ length: 10 }, () => 20);
    const colWidths = Array.from({ length: 6 }, () => 64);

    it('resolves anchor on page 0', () => {
      const resolver = new DefaultPositionResolver(rowHeights, colWidths, pageSlices);
      const pos = resolver.resolvePosition(2, 1, 0, 0);
      // x = 36 + 0 + colWidths[0](64) = 100
      // y = 36 + 0 + rowHeights[0](20) + rowHeights[1](20) = 76
      expect(pos).toEqual({ pageIndex: 0, x: 100, y: 76 });
    });

    it('resolves anchor on page 1 (vertical split)', () => {
      const resolver = new DefaultPositionResolver(rowHeights, colWidths, pageSlices);
      const pos = resolver.resolvePosition(7, 0, 0, 0);
      // x = 36 + 0 = 36 (col 0, startCol is 0)
      // y = 36 + 0 + rowHeights[5](20) + rowHeights[6](20) = 76
      expect(pos).toEqual({ pageIndex: 1, x: 36, y: 76 });
    });

    it('resolves anchor on page 2 (horizontal split)', () => {
      const resolver = new DefaultPositionResolver(rowHeights, colWidths, pageSlices);
      const pos = resolver.resolvePosition(1, 4, 0, 0);
      // x = 36 + 0 + colWidths[3](64) = 100 (col 4, startCol is 3)
      // y = 36 + 0 + rowHeights[0](20) = 56 (row 1, startRow is 0)
      expect(pos).toEqual({ pageIndex: 2, x: 100, y: 56 });
    });

    it('returns null for anchor outside all page slices', () => {
      const resolver = new DefaultPositionResolver(rowHeights, colWidths, pageSlices);
      // Row 12 is beyond all slices
      const pos = resolver.resolvePosition(12, 0, 0, 0);
      expect(pos).toBeNull();
    });

    it('returns null for anchor in a col gap between slices', () => {
      // Col 6+ is not in any slice (slices cover 0-2 and 3-5)
      const resolver = new DefaultPositionResolver(rowHeights, colWidths, pageSlices);
      const pos = resolver.resolvePosition(0, 7, 0, 0);
      expect(pos).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles empty page slices array', () => {
      const resolver = new DefaultPositionResolver([20], [64], []);
      const pos = resolver.resolvePosition(0, 0, 0, 0);
      expect(pos).toBeNull();
    });

    it('handles anchor at exact boundary (endRow exclusive)', () => {
      const resolver = new DefaultPositionResolver([20, 20], [64, 64], [singlePageSlice(2, 2)]);
      // Row 2 is at the exclusive boundary — should NOT match
      const pos = resolver.resolvePosition(2, 0, 0, 0);
      expect(pos).toBeNull();
    });

    it('handles anchor at exact boundary (endCol exclusive)', () => {
      const resolver = new DefaultPositionResolver([20], [64, 64], [singlePageSlice(1, 2)]);
      // Col 2 is at the exclusive boundary — should NOT match
      const pos = resolver.resolvePosition(0, 2, 0, 0);
      expect(pos).toBeNull();
    });

    it('handles large sub-cell offsets', () => {
      const resolver = new DefaultPositionResolver([20], [64], [singlePageSlice(1, 1)]);
      const pos = resolver.resolvePosition(0, 0, 100, 200);
      expect(pos).toEqual({ pageIndex: 0, x: 100, y: 200 });
    });

    it('selects the first matching slice when slices overlap', () => {
      // Two slices that overlap at (0,0)
      const slices: PageSlice[] = [
        { startRow: 0, endRow: 5, startCol: 0, endCol: 5, offsetX: 10, offsetY: 10, pageIndex: 0 },
        { startRow: 0, endRow: 5, startCol: 0, endCol: 5, offsetX: 20, offsetY: 20, pageIndex: 1 },
      ];
      const resolver = new DefaultPositionResolver([20], [64], slices);
      const pos = resolver.resolvePosition(0, 0, 0, 0);
      // Should use first slice (pageIndex 0)
      expect(pos).toEqual({ pageIndex: 0, x: 10, y: 10 });
    });
  });
});
