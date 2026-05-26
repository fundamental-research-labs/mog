/**
 * column-grouping.test.ts — Column grouping tests
 *
 * Tests column "keep together" hints, orphan prevention,
 * and column fill optimization.
 */

import { PaginationEngine } from '../pagination-engine';
import type { ContentMeasurer, MergedRegion, PageSetupInput } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function createMeasurer(
  rowHeight: number,
  colWidths: number[],
  opts?: {
    mergedRegions?: MergedRegion[];
    hiddenCols?: Set<number>;
  },
): ContentMeasurer {
  return {
    getRowHeight: () => rowHeight,
    getColumnWidth: (col: number) => colWidths[col] ?? 60,
    getMergedRegions: () => opts?.mergedRegions ?? [],
    isRowHidden: () => false,
    isColHidden: (col: number) => opts?.hiddenCols?.has(col) ?? false,
  };
}

function createSetup(overrides?: Partial<PageSetupInput>): PageSetupInput {
  return {
    pageWidth: 612,
    pageHeight: 792,
    margins: { top: 72, bottom: 72, left: 54, right: 54, header: 0, footer: 0 },
    orientation: 'portrait',
    scale: 1.0,
    printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 14 },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Column Grouping', () => {
  let engine: PaginationEngine;

  beforeEach(() => {
    engine = new PaginationEngine();
  });

  describe('Keep together hints', () => {
    it('should keep grouped columns on the same page', () => {
      // Printable width: 504
      // 8 cols * 60 = 480 (fits), col 8 = 60 -> 540 > 504 -> break at col 8
      // Group cols 6-9 together -> should move break to before group (col 6)
      const colWidths = Array(15).fill(60);
      const measurer = createMeasurer(20, colWidths);

      const setup = createSetup({
        columnGroups: [[6, 9]],
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 14 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Verify the column group is not split
      for (const page of plan.pages) {
        const [colStart, colEnd] = page.colRange;
        // If page overlaps with group [6,9], it should contain the whole group
        const overlaps = colStart <= 9 && colEnd >= 6;
        if (overlaps) {
          // Either the page contains the entire group or starts at/before the group start
          const contains = colStart <= 6 && colEnd >= 9;
          const startsAtGroup = colStart === 6;
          expect(contains || startsAtGroup).toBe(true);
        }
      }
    });

    it('should handle multiple column groups', () => {
      const colWidths = Array(20).fill(50);
      const measurer = createMeasurer(20, colWidths);

      const setup = createSetup({
        columnGroups: [
          [0, 3],
          [8, 11],
        ],
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 19 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBeGreaterThan(0);
      // Verify all pages have valid ranges
      for (const page of plan.pages) {
        expect(page.colRange[1]).toBeGreaterThanOrEqual(page.colRange[0]);
      }
    });
  });

  describe('Orphan prevention', () => {
    it('should merge a single orphan column with previous section when it fits', () => {
      // Printable width: 504
      // Cols 0-7: 8 * 60 = 480 (fits on page 1)
      // Col 8: 20 pts (orphan that would be alone on page 2)
      // Since 480 + 20 = 500 < 504, the orphan should merge with page 1
      const colWidths = [...Array(8).fill(60), 20];
      const measurer = createMeasurer(20, colWidths);

      const setup = createSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 8 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(1);
      expect(plan.pages[0].colRange).toEqual([0, 8]);
    });

    it('should not merge orphan if it would exceed page width', () => {
      // Printable width: 504
      // Cols 0-7: 8 * 60 = 480
      // Col 8: 50 pts -> 480 + 50 = 530 > 504 -> can't merge
      const colWidths = [...Array(8).fill(60), 50];
      const measurer = createMeasurer(20, colWidths);

      const setup = createSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 8 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(2);
    });
  });

  describe('Column fill optimization', () => {
    it('should redistribute when last section uses less than 25% width', () => {
      // Printable width: 504
      // Cols 0-7: 8 * 60 = 480 (fills page 1)
      // Col 8: 100 pts (only ~20% of 504, < 25%)
      // But 480 + 100 = 580 > 504, can't merge
      // So we need at least 2 pages
      const colWidths = [...Array(8).fill(60), 100];
      const measurer = createMeasurer(20, colWidths);

      const setup = createSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 8 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Should be 2 pages since they can't merge
      expect(plan.totalPages).toBe(2);
    });

    it('should merge when last section is small enough to fit with previous', () => {
      // Printable width: 504
      // Cols 0-6: 7 * 60 = 420
      // Cols 7-8: 2 * 40 = 80 (15.8% of 504, < 25%)
      // Total: 420 + 80 = 500 < 504 -> can merge
      const colWidths = [...Array(7).fill(60), 40, 40];
      const measurer = createMeasurer(20, colWidths);

      const setup = createSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 8 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(1);
    });
  });

  describe('Various column width distributions', () => {
    it('should handle all columns the same width', () => {
      const colWidths = Array(20).fill(50);
      const measurer = createMeasurer(20, colWidths);

      const setup = createSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 19 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // 20 cols * 50 = 1000, printable = 504 -> ~2 col sections
      expect(plan.totalPages).toBe(2);
    });

    it('should handle one very wide column', () => {
      const colWidths = [400, ...Array(9).fill(20)];
      const measurer = createMeasurer(20, colWidths);

      const setup = createSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 9 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // 400 + 9*20 = 580 > 504 -> 2 pages
      expect(plan.totalPages).toBe(2);
    });

    it('should handle alternating wide and narrow columns', () => {
      const colWidths: number[] = [];
      for (let i = 0; i < 12; i++) {
        colWidths.push(i % 2 === 0 ? 100 : 20);
      }
      const measurer = createMeasurer(20, colWidths);

      const setup = createSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 11 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBeGreaterThan(0);
      // All pages should cover the full range of rows
      for (const page of plan.pages) {
        expect(page.rowRange).toEqual([0, 9]);
      }
    });
  });
});
