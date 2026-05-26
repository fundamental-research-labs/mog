/**
 * manual-breaks.test.ts — Manual page break tests
 *
 * Tests manual horizontal/vertical page breaks, interaction with
 * merged cells and repeat rows.
 */

import { PaginationEngine } from '../pagination-engine';
import type { ContentMeasurer, MergedRegion, PageSetupInput } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function createMeasurer(
  rowHeight: number,
  colWidth: number,
  mergedRegions: MergedRegion[] = [],
): ContentMeasurer {
  return {
    getRowHeight: () => rowHeight,
    getColumnWidth: () => colWidth,
    getMergedRegions: () => mergedRegions,
    isRowHidden: () => false,
    isColHidden: () => false,
  };
}

function createSetup(overrides?: Partial<PageSetupInput>): PageSetupInput {
  return {
    pageWidth: 612,
    pageHeight: 792,
    margins: { top: 72, bottom: 72, left: 54, right: 54, header: 0, footer: 0 },
    orientation: 'portrait',
    scale: 1.0,
    printArea: { startRow: 0, startCol: 0, endRow: 49, endCol: 9 },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Manual Page Breaks', () => {
  let engine: PaginationEngine;

  beforeEach(() => {
    engine = new PaginationEngine();
  });

  describe('Horizontal page breaks', () => {
    it('should force a break at specified row', () => {
      const measurer = createMeasurer(20, 50);
      const setup = createSetup({
        rowPageBreaks: [10],
        printArea: { startRow: 0, startCol: 0, endRow: 19, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Should have at least 2 pages
      expect(plan.totalPages).toBeGreaterThanOrEqual(2);

      // First page should end before row 10
      expect(plan.pages[0].rowRange[1]).toBeLessThan(10);
      // Second page should start at row 10
      expect(plan.pages[1].rowRange[0]).toBe(10);
    });

    it('should force breaks at multiple rows', () => {
      const measurer = createMeasurer(20, 50);
      const setup = createSetup({
        rowPageBreaks: [10, 20, 30],
        printArea: { startRow: 0, startCol: 0, endRow: 39, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBeGreaterThanOrEqual(4);
    });

    it('should mark manual-break-triggered pages', () => {
      const measurer = createMeasurer(20, 50);
      const setup = createSetup({
        rowPageBreaks: [10],
        printArea: { startRow: 0, startCol: 0, endRow: 19, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // The second page should be marked as manual break
      const manualPages = plan.pages.filter((p) => p.isManualBreak);
      expect(manualPages.length).toBeGreaterThanOrEqual(1);
    });

    it('should still auto-break when content exceeds page after manual break', () => {
      // Manual break at row 5, then content continues for many rows
      const measurer = createMeasurer(40, 50);
      const setup = createSetup({
        rowPageBreaks: [5],
        printArea: { startRow: 0, startCol: 0, endRow: 49, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Should have manual break + auto breaks
      expect(plan.totalPages).toBeGreaterThan(2);
    });
  });

  describe('Vertical page breaks', () => {
    it('should force a break at specified column', () => {
      const measurer = createMeasurer(20, 60);
      const setup = createSetup({
        colPageBreaks: [5],
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 14 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Should have at least 2 column sections
      const uniqueColStarts = new Set(plan.pages.map((p) => p.colRange[0]));
      expect(uniqueColStarts.size).toBeGreaterThanOrEqual(2);
    });

    it('should mark vertical manual break pages', () => {
      const measurer = createMeasurer(20, 50);
      const setup = createSetup({
        colPageBreaks: [5],
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 9 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      const manualPages = plan.pages.filter((p) => p.isManualBreak);
      expect(manualPages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Manual breaks + merged cells', () => {
    it('should move manual break to before merge when break falls inside merge', () => {
      // Merge spans rows 8-12
      // Manual break at row 10 (inside the merge)
      // Should move break to row 8
      const merge: MergedRegion = { startRow: 8, startCol: 0, endRow: 12, endCol: 2 };
      const measurer = createMeasurer(20, 50, [merge]);

      const setup = createSetup({
        rowPageBreaks: [10],
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Should emit a warning about moved break
      const moveWarnings = plan.warnings.filter((w) => w.type === 'manual_break_in_merge');
      expect(moveWarnings.length).toBeGreaterThanOrEqual(1);

      // Verify no page splits the merge
      for (const page of plan.pages) {
        const [rs, re] = page.rowRange;
        if (rs <= merge.endRow && re >= merge.startRow) {
          const containsMerge = rs <= merge.startRow && re >= merge.endRow;
          const startsAtMerge = rs === merge.startRow;
          expect(containsMerge || startsAtMerge).toBe(true);
        }
      }
    });

    it('should move vertical manual break to before merge', () => {
      // Merge spans cols 4-7
      // Manual break at col 6 (inside merge)
      // Should move to col 4
      const merge: MergedRegion = { startRow: 0, startCol: 4, endRow: 2, endCol: 7 };
      const measurer = createMeasurer(20, 50, [merge]);

      const setup = createSetup({
        colPageBreaks: [6],
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 14 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      const moveWarnings = plan.warnings.filter((w) => w.type === 'manual_break_in_merge');
      expect(moveWarnings.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Manual breaks + repeat rows', () => {
    it('should include repeat rows on every page after manual break', () => {
      const measurer = createMeasurer(20, 50);
      const setup = createSetup({
        repeatRows: [0, 1],
        rowPageBreaks: [15],
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Every page should have repeat rows
      for (const page of plan.pages) {
        expect(page.repeatRows).toEqual([0, 1]);
      }
    });

    it('should include repeat cols on every page after manual column break', () => {
      const measurer = createMeasurer(20, 50);
      const setup = createSetup({
        repeatCols: [0, 1],
        colPageBreaks: [7],
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 14 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      for (const page of plan.pages) {
        expect(page.repeatCols).toEqual([0, 1]);
      }
    });
  });

  describe('Both H and V manual breaks', () => {
    it('should handle simultaneous horizontal and vertical manual breaks', () => {
      const measurer = createMeasurer(20, 50);
      const setup = createSetup({
        rowPageBreaks: [10],
        colPageBreaks: [5],
        printArea: { startRow: 0, startCol: 0, endRow: 19, endCol: 9 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Should create a grid of pages: 2 row sections x 2 col sections = 4
      expect(plan.totalPages).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Edge cases', () => {
    it('should handle manual break at the first row (no-op)', () => {
      const measurer = createMeasurer(20, 50);
      const setup = createSetup({
        rowPageBreaks: [0],
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Break at row 0 is the start, should not create extra page
      expect(plan.totalPages).toBe(1);
    });

    it('should handle manual break at the last row', () => {
      const measurer = createMeasurer(20, 50);
      const setup = createSetup({
        rowPageBreaks: [9],
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(2);
      expect(plan.pages[1].rowRange[0]).toBe(9);
    });

    it('should handle manual break beyond the print area (ignored)', () => {
      const measurer = createMeasurer(20, 50);
      const setup = createSetup({
        rowPageBreaks: [100],
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(1);
    });
  });
});
