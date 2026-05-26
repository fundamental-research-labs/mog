/**
 * merged-cells.test.ts — Merge awareness tests
 *
 * Tests that merged cells are never split across page boundaries,
 * and edge cases like merges taller/wider than a page.
 */

import { PaginationEngine } from '../pagination-engine';
import type { ContentMeasurer, MergedRegion, PageSetupInput } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function createMeasurer(
  rowHeight: number,
  colWidth: number,
  mergedRegions: MergedRegion[],
  opts?: { hiddenRows?: Set<number>; hiddenCols?: Set<number> },
): ContentMeasurer {
  return {
    getRowHeight: () => rowHeight,
    getColumnWidth: () => colWidth,
    getMergedRegions: () => mergedRegions,
    isRowHidden: (row: number) => opts?.hiddenRows?.has(row) ?? false,
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
    printArea: { startRow: 0, startCol: 0, endRow: 49, endCol: 9 },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Merged Cell Awareness', () => {
  let engine: PaginationEngine;

  beforeEach(() => {
    engine = new PaginationEngine();
  });

  it('should not split a merged cell across a row page boundary', () => {
    // Printable height: 792 - 144 = 648
    // Rows 0-15: 16 * 40 = 640 (almost fills page)
    // Row 16 starts a merge spanning rows 15-17
    // The break should move to before the merge (row 15)
    const merge: MergedRegion = { startRow: 15, startCol: 0, endRow: 17, endCol: 2 };
    const measurer = createMeasurer(40, 50, [merge]);

    const setup = createSetup({
      printArea: { startRow: 0, startCol: 0, endRow: 30, endCol: 4 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    // Verify no page splits the merge
    for (const page of plan.pages) {
      const [pageRowStart, pageRowEnd] = page.rowRange;
      // If the page contains any part of the merge, it must contain all of it
      const overlapsStart = pageRowStart <= merge.endRow && pageRowEnd >= merge.startRow;
      if (overlapsStart) {
        // Either the entire merge is in this page, or the merge starts at page boundary
        const containsMerge = pageRowStart <= merge.startRow && pageRowEnd >= merge.endRow;
        const mergeStartsAtPageStart = pageRowStart === merge.startRow;
        expect(containsMerge || mergeStartsAtPageStart).toBe(true);
      }
    }
  });

  it('should not split a merged cell across a column page boundary', () => {
    // Printable width: 612 - 108 = 504
    // Merge spanning cols 7-9 (near page break area)
    const merge: MergedRegion = { startRow: 0, startCol: 7, endRow: 2, endCol: 9 };
    const measurer = createMeasurer(20, 60, [merge]);

    const setup = createSetup({
      printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 14 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    // Verify no page splits the merge horizontally
    for (const page of plan.pages) {
      const [pageColStart, pageColEnd] = page.colRange;
      const overlaps = pageColStart <= merge.endCol && pageColEnd >= merge.startCol;
      if (overlaps) {
        const containsMerge = pageColStart <= merge.startCol && pageColEnd >= merge.endCol;
        const mergeStartsAtPageStart = pageColStart === merge.startCol;
        expect(containsMerge || mergeStartsAtPageStart).toBe(true);
      }
    }
  });

  it('should handle a merge taller than one full page', () => {
    // Printable height: 648
    // Merge spanning 20 rows * 40 = 800 pts > 648
    const merge: MergedRegion = { startRow: 5, startCol: 0, endRow: 24, endCol: 2 };
    const measurer = createMeasurer(40, 50, [merge]);

    const setup = createSetup({
      printArea: { startRow: 0, startCol: 0, endRow: 39, endCol: 4 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    // Should emit a merge_overflow_row warning
    const overflowWarnings = plan.warnings.filter((w) => w.type === 'merge_overflow_row');
    expect(overflowWarnings.length).toBeGreaterThanOrEqual(1);

    // Should still produce pages
    expect(plan.totalPages).toBeGreaterThan(0);
  });

  it('should handle a merge wider than one full page', () => {
    // Printable width: 504
    // Merge spanning 10 cols * 60 = 600 pts > 504
    const merge: MergedRegion = { startRow: 0, startCol: 2, endRow: 2, endCol: 11 };
    const measurer = createMeasurer(20, 60, [merge]);

    const setup = createSetup({
      printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 14 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    // Should emit a merge_overflow_col warning
    const overflowWarnings = plan.warnings.filter((w) => w.type === 'merge_overflow_col');
    expect(overflowWarnings.length).toBeGreaterThanOrEqual(1);

    expect(plan.totalPages).toBeGreaterThan(0);
  });

  it('should handle multiple merged cells near page boundaries', () => {
    const merges: MergedRegion[] = [
      { startRow: 14, startCol: 0, endRow: 16, endCol: 0 },
      { startRow: 14, startCol: 3, endRow: 16, endCol: 5 },
    ];
    const measurer = createMeasurer(40, 50, merges);

    const setup = createSetup({
      printArea: { startRow: 0, startCol: 0, endRow: 30, endCol: 9 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    expect(plan.totalPages).toBeGreaterThan(0);
    // All pages should have valid ranges
    for (const page of plan.pages) {
      expect(page.rowRange[1]).toBeGreaterThanOrEqual(page.rowRange[0]);
      expect(page.colRange[1]).toBeGreaterThanOrEqual(page.colRange[0]);
    }
  });

  it('should handle merges that span hidden rows/cols', () => {
    const merge: MergedRegion = { startRow: 10, startCol: 0, endRow: 14, endCol: 2 };
    const measurer = createMeasurer(40, 50, [merge], {
      hiddenRows: new Set([11, 12]),
    });

    const setup = createSetup({
      printArea: { startRow: 0, startCol: 0, endRow: 30, endCol: 4 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    expect(plan.totalPages).toBeGreaterThan(0);
  });

  it('should correctly handle a merge at the very start of the print area', () => {
    const merge: MergedRegion = { startRow: 0, startCol: 0, endRow: 2, endCol: 2 };
    const measurer = createMeasurer(20, 50, [merge]);

    const setup = createSetup({
      printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    expect(plan.totalPages).toBe(1);
    expect(plan.pages[0].rowRange).toEqual([0, 9]);
  });
});
