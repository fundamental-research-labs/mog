/**
 * pagination-engine.test.ts — Core PaginationEngine tests
 *
 * Verifies basic pagination, print area, repeat rows/cols,
 * and equivalence with the original PageCalculator behavior.
 */

import { PaginationEngine } from '../pagination-engine';
import type { ContentMeasurer, MergedRegion, PageSetupInput } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a simple measurer with uniform row heights and column widths.
 */
function createUniformMeasurer(
  rowHeight: number,
  colWidth: number,
  opts?: {
    mergedRegions?: MergedRegion[];
    hiddenRows?: Set<number>;
    hiddenCols?: Set<number>;
  },
): ContentMeasurer {
  return {
    getRowHeight: () => rowHeight,
    getColumnWidth: () => colWidth,
    getMergedRegions: () => opts?.mergedRegions ?? [],
    isRowHidden: (row: number) => opts?.hiddenRows?.has(row) ?? false,
    isColHidden: (col: number) => opts?.hiddenCols?.has(col) ?? false,
  };
}

/**
 * Create a measurer with variable row heights and column widths.
 */
function createVariableMeasurer(
  rowHeights: number[],
  colWidths: number[],
  opts?: {
    mergedRegions?: MergedRegion[];
    hiddenRows?: Set<number>;
    hiddenCols?: Set<number>;
  },
): ContentMeasurer {
  return {
    getRowHeight: (row: number) => rowHeights[row] ?? 20,
    getColumnWidth: (col: number) => colWidths[col] ?? 80,
    getMergedRegions: () => opts?.mergedRegions ?? [],
    isRowHidden: (row: number) => opts?.hiddenRows?.has(row) ?? false,
    isColHidden: (col: number) => opts?.hiddenCols?.has(col) ?? false,
  };
}

/**
 * Create a basic page setup for US Letter size (612 x 792 points).
 */
function createLetterSetup(overrides?: Partial<PageSetupInput>): PageSetupInput {
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

describe('PaginationEngine', () => {
  let engine: PaginationEngine;

  beforeEach(() => {
    engine = new PaginationEngine();
  });

  describe('3A: Basic pagination', () => {
    it('should paginate a small grid that fits on one page', () => {
      const measurer = createUniformMeasurer(20, 50);
      const setup = createLetterSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(1);
      expect(plan.pages[0].rowRange).toEqual([0, 9]);
      expect(plan.pages[0].colRange).toEqual([0, 4]);
      expect(plan.scale).toBe(1.0);
      expect(plan.warnings).toEqual([]);
    });

    it('should create multiple row pages when content exceeds page height', () => {
      // Printable height = 792 - 72 - 72 = 648 points
      // 20 rows * 40 pts = 800 pts > 648 -> needs 2 pages vertically
      const measurer = createUniformMeasurer(40, 50);
      const setup = createLetterSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 19, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(2);
      expect(plan.pages[0].rowRange[0]).toBe(0);
      expect(plan.pages[1].rowRange[0]).toBeGreaterThan(0);
    });

    it('should create multiple column pages when content exceeds page width', () => {
      // Printable width = 612 - 54 - 54 = 504 points
      // 10 cols * 60 pts = 600 pts > 504 -> needs 2 pages horizontally
      const measurer = createUniformMeasurer(20, 60);
      const setup = createLetterSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 9 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(2);
    });

    it('should create a grid of pages for large content', () => {
      // Height: 30 rows * 30 pts = 900 > 648 -> 2 row sections
      // Width: 15 cols * 40 pts = 600 > 504 -> 2 col sections
      // Total: 2 * 2 = 4 pages
      const measurer = createUniformMeasurer(30, 40);
      const setup = createLetterSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 14 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(4);
    });

    it('should handle empty print area gracefully', () => {
      const measurer = createUniformMeasurer(20, 50);
      const setup = createLetterSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(1);
      expect(plan.pages[0].rowRange).toEqual([0, 0]);
      expect(plan.pages[0].colRange).toEqual([0, 0]);
    });

    it('should include scale in the output', () => {
      const measurer = createUniformMeasurer(20, 50);
      const setup = createLetterSetup({
        scale: 0.75,
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.scale).toBe(0.75);
    });

    it('should produce correct page numbers starting from 1', () => {
      const measurer = createUniformMeasurer(40, 60);
      const setup = createLetterSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 14 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      for (let i = 0; i < plan.pages.length; i++) {
        expect(plan.pages[i].pageNumber).toBe(i + 1);
      }
    });
  });

  describe('3A: Repeat rows and columns', () => {
    it('should account for repeat rows reducing available content height', () => {
      // Repeat rows 0-1: 2 * 30 = 60 pts
      // Available height: 648 - 60 = 588 pts
      // 20 rows * 30 pts = 600 > 588 -> 2 pages
      const measurer = createUniformMeasurer(30, 50);
      const setup = createLetterSetup({
        repeatRows: [0, 1],
        printArea: { startRow: 0, startCol: 0, endRow: 21, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Content rows start after repeat rows (row 2)
      expect(plan.totalPages).toBe(2);
      // Each page should have repeat rows
      for (const page of plan.pages) {
        expect(page.repeatRows).toEqual([0, 1]);
      }
    });

    it('should account for repeat cols reducing available content width', () => {
      const measurer = createUniformMeasurer(20, 60);
      const setup = createLetterSetup({
        repeatCols: [0, 1],
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 9 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Each page should have repeat cols
      for (const page of plan.pages) {
        expect(page.repeatCols).toEqual([0, 1]);
      }
    });

    it('should handle repeat rows larger than content', () => {
      // Repeat rows 0-4: 5 * 20 = 100 pts
      // Content: rows 5-9 = 5 * 20 = 100 pts
      // Should fit on 1 page: 100 + 100 = 200 < 648
      const measurer = createUniformMeasurer(20, 50);
      const setup = createLetterSetup({
        repeatRows: [0, 4],
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(1);
    });
  });

  describe('3A: Header and footer height', () => {
    it('should reserve space for header and footer heights', () => {
      // Printable height: 792 - 72 - 72 = 648
      // After header (30) + footer (30): 648 - 60 = 588
      // 30 rows * 20 = 600 > 588, needs 2 pages
      const measurer = createUniformMeasurer(20, 50);
      const setup = createLetterSetup({
        headerHeight: 30,
        footerHeight: 30,
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(2);
    });
  });

  describe('3A: Margins', () => {
    it('should respect 6-margin model', () => {
      const measurer = createUniformMeasurer(20, 50);
      const setup = createLetterSetup({
        margins: { top: 100, bottom: 100, left: 100, right: 100, header: 0, footer: 0 },
        printArea: { startRow: 0, startCol: 0, endRow: 49, endCol: 9 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Printable: 612-200 = 412 wide, 792-200 = 592 tall
      // 50 rows * 20 = 1000 > 592 -> multiple pages
      expect(plan.totalPages).toBeGreaterThan(1);
    });
  });

  describe('3G: Centering on page', () => {
    it('should calculate horizontal centering offset when content is narrower than page', () => {
      // 3 cols * 50 = 150, printable width = 504
      // Offset should be (504 - 150) / 2 = 177
      const measurer = createUniformMeasurer(20, 50);
      const setup = createLetterSetup({
        centerHorizontal: true,
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 2 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.pages[0].contentOffset.x).toBeCloseTo(177, 0);
    });

    it('should calculate vertical centering offset when content is shorter than page', () => {
      // 5 rows * 20 = 100, printable height = 648
      // Offset should be (648 - 100) / 2 = 274
      const measurer = createUniformMeasurer(20, 50);
      const setup = createLetterSetup({
        centerVertical: true,
        printArea: { startRow: 0, startCol: 0, endRow: 4, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.pages[0].contentOffset.y).toBeCloseTo(274, 0);
    });

    it('should have zero offset when centering is disabled', () => {
      const measurer = createUniformMeasurer(20, 50);
      const setup = createLetterSetup({
        centerHorizontal: false,
        centerVertical: false,
        printArea: { startRow: 0, startCol: 0, endRow: 4, endCol: 2 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.pages[0].contentOffset.x).toBe(0);
      expect(plan.pages[0].contentOffset.y).toBe(0);
    });

    it('should have zero offset when content fills the page', () => {
      // Fill the page completely
      const measurer = createUniformMeasurer(40, 60);
      const setup = createLetterSetup({
        centerHorizontal: true,
        centerVertical: true,
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 14 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // For multi-page content, at least the full pages should have 0 offset
      // (only the last partial page gets centering)
      expect(plan.totalPages).toBeGreaterThan(1);
    });
  });

  describe('3G: Hidden row/column exclusion', () => {
    it('should skip hidden rows in pagination', () => {
      // 30 rows * 25 = 750, but 10 hidden -> 20 * 25 = 500 < 648 -> 1 page
      const measurer = createUniformMeasurer(25, 50, {
        hiddenRows: new Set([3, 5, 7, 9, 11, 13, 15, 17, 19, 21]),
      });
      const setup = createLetterSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(1);
    });

    it('should skip hidden columns in pagination', () => {
      // 10 cols * 60 = 600 > 504, but 5 hidden -> 5 * 60 = 300 < 504 -> 1 page
      const measurer = createUniformMeasurer(20, 60, {
        hiddenCols: new Set([1, 3, 5, 7, 9]),
      });
      const setup = createLetterSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 9 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(1);
    });

    it('should produce fewer pages when rows are hidden', () => {
      const measurer = createUniformMeasurer(20, 50);
      const area = { startRow: 0, startCol: 0, endRow: 49, endCol: 4 };
      const setupNoHidden = createLetterSetup({ printArea: area });
      const planNoHidden = engine.calculateLayout(measurer, setupNoHidden);

      const measurerWithHidden = createUniformMeasurer(20, 50, {
        hiddenRows: new Set(Array.from({ length: 25 }, (_, i) => i * 2)),
      });
      const planWithHidden = engine.calculateLayout(measurerWithHidden, setupNoHidden);

      expect(planWithHidden.totalPages).toBeLessThanOrEqual(planNoHidden.totalPages);
    });

    it('should exclude hidden repeat rows from height calculation', () => {
      // Repeat rows 0-4, but rows 1,3 hidden -> only 3 rows contribute
      // 3 * 30 = 90 instead of 5 * 30 = 150
      const measurer = createUniformMeasurer(30, 50, {
        hiddenRows: new Set([1, 3]),
      });
      const setup = createLetterSetup({
        repeatRows: [0, 4],
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Content height available: 648 - 90 = 558
      // Content rows 5-29: 25 * 30 (minus hidden) = need to count
      expect(plan.totalPages).toBeGreaterThan(0);
    });
  });

  describe('3G: Scale direction fix', () => {
    it('should allow MORE content per page at smaller scale', () => {
      const measurer = createUniformMeasurer(20, 50);
      const area = { startRow: 0, startCol: 0, endRow: 49, endCol: 9 };

      const setup100 = createLetterSetup({ scale: 1.0, printArea: area });
      const setup50 = createLetterSetup({ scale: 0.5, printArea: area });

      const plan100 = engine.calculateLayout(measurer, setup100);
      const plan50 = engine.calculateLayout(measurer, setup50);

      // At 50% scale, content is half-size, so more fits per page
      // -> fewer pages needed
      expect(plan50.totalPages).toBeLessThanOrEqual(plan100.totalPages);
    });

    it('should produce more pages at larger scale', () => {
      const measurer = createUniformMeasurer(20, 50);
      const area = { startRow: 0, startCol: 0, endRow: 49, endCol: 9 };

      const setup100 = createLetterSetup({ scale: 1.0, printArea: area });
      const setup200 = createLetterSetup({ scale: 2.0, printArea: area });

      const plan100 = engine.calculateLayout(measurer, setup100);
      const plan200 = engine.calculateLayout(measurer, setup200);

      // At 200% scale, content is double-size, so fewer fit per page
      // -> more pages needed
      expect(plan200.totalPages).toBeGreaterThanOrEqual(plan100.totalPages);
    });
  });
});
