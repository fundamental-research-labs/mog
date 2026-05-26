/**
 * bug-fixes.test.ts — Tests for bug fixes in pdf/layout
 *
 * Tests for:
 * - Fix 1: Infinite loop in column group adjustment
 * - Fix 2: Zero-height rows / zero-width columns cause infinite loop
 * - Fix 3: Off-by-one when repeat rows/cols consume entire print area
 * - Fix 4: Centering calculation should not include repeat row/col dimensions
 * - Fix 5: Validate print area bounds
 * - Fix 6: Floating-point accumulation tolerance
 */

import { calculateColBreaks } from '../col-breaks';
import { PaginationEngine } from '../pagination-engine';
import { calculateRowBreaks } from '../row-breaks';
import type { ContentMeasurer, MergedRegion, PageSetupInput } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

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
// Fix 1: Infinite loop in column group adjustment
// ============================================================================

describe('Fix 1: Infinite loop in column group adjustment', () => {
  it('should not infinite loop when group adjustment moves break before previous break', () => {
    const colWidths = Array(15).fill(60);
    const measurer = createVariableMeasurer(Array(10).fill(20), colWidths);

    const result = calculateColBreaks({
      startCol: 0,
      endCol: 14,
      contentWidth: 504,
      measurer,
      manualBreaks: new Set(),
      mergedRegions: [],
      columnGroups: [[0, 9]],
    });

    expect(result.breaks.length).toBeGreaterThan(0);
  });

  it('should handle multiple groups where adjustment repeatedly fails', () => {
    const colWidths = Array(20).fill(30);
    const measurer = createVariableMeasurer(Array(5).fill(20), colWidths);

    const result = calculateColBreaks({
      startCol: 0,
      endCol: 19,
      contentWidth: 200,
      measurer,
      manualBreaks: new Set(),
      mergedRegions: [],
      columnGroups: [
        [0, 8],
        [9, 19],
      ],
    });

    expect(result.breaks.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Fix 2: Zero-height rows / zero-width columns cause infinite loop
// ============================================================================

describe('Fix 2: Zero-height rows and zero-width columns', () => {
  it('should skip zero-height rows without infinite loop', () => {
    const rowHeights = Array(20).fill(30);
    rowHeights[5] = 0;
    const measurer = createVariableMeasurer(rowHeights, Array(5).fill(50));

    const result = calculateRowBreaks({
      startRow: 0,
      endRow: 19,
      contentHeight: 648,
      measurer,
      manualBreaks: new Set(),
      mergedRegions: [],
    });

    expect(result.breaks.length).toBeGreaterThan(0);
  });

  it('should skip all zero-height rows without infinite loop', () => {
    const rowHeights = Array(10).fill(0);
    const measurer = createVariableMeasurer(rowHeights, Array(5).fill(50));

    const result = calculateRowBreaks({
      startRow: 0,
      endRow: 9,
      contentHeight: 648,
      measurer,
      manualBreaks: new Set(),
      mergedRegions: [],
    });

    expect(result.breaks.length).toBe(1);
  });

  it('should skip zero-width columns without infinite loop', () => {
    const colWidths = Array(15).fill(60);
    colWidths[5] = 0;
    const measurer = createVariableMeasurer(Array(10).fill(20), colWidths);

    const result = calculateColBreaks({
      startCol: 0,
      endCol: 14,
      contentWidth: 504,
      measurer,
      manualBreaks: new Set(),
      mergedRegions: [],
    });

    expect(result.breaks.length).toBeGreaterThan(0);
  });

  it('should skip all zero-width columns without infinite loop', () => {
    const colWidths = Array(10).fill(0);
    const measurer = createVariableMeasurer(Array(10).fill(20), colWidths);

    const result = calculateColBreaks({
      startCol: 0,
      endCol: 9,
      contentWidth: 504,
      measurer,
      manualBreaks: new Set(),
      mergedRegions: [],
    });

    expect(result.breaks.length).toBe(1);
  });

  it('should handle negative row heights by skipping them', () => {
    const rowHeights = Array(10).fill(30);
    rowHeights[3] = -5;
    const measurer = createVariableMeasurer(rowHeights, Array(5).fill(50));

    const result = calculateRowBreaks({
      startRow: 0,
      endRow: 9,
      contentHeight: 648,
      measurer,
      manualBreaks: new Set(),
      mergedRegions: [],
    });

    expect(result.breaks.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Fix 3: Repeat rows/cols consume entire print area
// ============================================================================

describe('Fix 3: Repeat rows/cols consume entire print area', () => {
  it('should return single break when repeat rows consume entire print area', () => {
    const measurer = createUniformMeasurer(20, 50);

    const result = calculateRowBreaks({
      startRow: 0,
      endRow: 9,
      contentHeight: 648,
      measurer,
      manualBreaks: new Set(),
      mergedRegions: [],
      repeatRows: [0, 9],
    });

    expect(result.breaks.length).toBe(1);
    expect(result.breaks[0].startRow).toBe(0);
  });

  it('should return single break when repeat cols consume entire print area', () => {
    const measurer = createUniformMeasurer(20, 50);

    const result = calculateColBreaks({
      startCol: 0,
      endCol: 9,
      contentWidth: 504,
      measurer,
      manualBreaks: new Set(),
      mergedRegions: [],
      repeatCols: [0, 9],
    });

    expect(result.breaks.length).toBe(1);
    expect(result.breaks[0].startCol).toBe(0);
  });

  it('should produce valid pages when repeat rows exactly match print area via engine', () => {
    const engine = new PaginationEngine();
    const measurer = createUniformMeasurer(20, 50);
    const setup = createLetterSetup({
      repeatRows: [0, 9],
      printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    expect(plan.totalPages).toBeGreaterThanOrEqual(1);
    expect(plan.pages.length).toBeGreaterThanOrEqual(1);
  });

  it('should produce valid pages when repeat cols exactly match print area via engine', () => {
    const engine = new PaginationEngine();
    const measurer = createUniformMeasurer(20, 50);
    const setup = createLetterSetup({
      repeatCols: [0, 9],
      printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 9 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    expect(plan.totalPages).toBeGreaterThanOrEqual(1);
    expect(plan.pages.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Fix 5: Validate print area bounds
// ============================================================================

describe('Fix 5: Validate print area bounds', () => {
  let engine: PaginationEngine;

  beforeEach(() => {
    engine = new PaginationEngine();
  });

  it('should return empty pages with warning for inverted row bounds', () => {
    const measurer = createUniformMeasurer(20, 50);
    const setup = createLetterSetup({
      printArea: { startRow: 10, startCol: 0, endRow: 5, endCol: 9 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    expect(plan.totalPages).toBe(0);
    expect(plan.pages).toEqual([]);
    expect(plan.warnings.length).toBe(1);
    expect(plan.warnings[0].type).toBe('empty_print_area');
  });

  it('should return empty pages with warning for inverted column bounds', () => {
    const measurer = createUniformMeasurer(20, 50);
    const setup = createLetterSetup({
      printArea: { startRow: 0, startCol: 10, endRow: 9, endCol: 5 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    expect(plan.totalPages).toBe(0);
    expect(plan.pages).toEqual([]);
    expect(plan.warnings[0].type).toBe('empty_print_area');
  });

  it('should return empty pages with warning for both inverted bounds', () => {
    const measurer = createUniformMeasurer(20, 50);
    const setup = createLetterSetup({
      printArea: { startRow: 20, startCol: 10, endRow: 5, endCol: 3 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    expect(plan.totalPages).toBe(0);
    expect(plan.pages).toEqual([]);
  });

  it('should still work with valid equal start/end (single cell)', () => {
    const measurer = createUniformMeasurer(20, 50);
    const setup = createLetterSetup({
      printArea: { startRow: 5, startCol: 3, endRow: 5, endCol: 3 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    expect(plan.totalPages).toBe(1);
    expect(plan.warnings.filter((w) => w.type === 'empty_print_area')).toEqual([]);
  });

  it('should preserve scale in the returned plan for inverted bounds', () => {
    const measurer = createUniformMeasurer(20, 50);
    const setup = createLetterSetup({
      scale: 0.75,
      printArea: { startRow: 10, startCol: 0, endRow: 5, endCol: 9 },
    });

    const plan = engine.calculateLayout(measurer, setup);

    expect(plan.scale).toBe(0.75);
  });
});

// ============================================================================
// Fix 6: Floating-point accumulation tolerance
// ============================================================================

describe('Fix 6: Floating-point accumulation tolerance', () => {
  it('should not bump a row to next page due to floating-point drift', () => {
    const measurer = createUniformMeasurer(18, 50);
    const setup = createLetterSetup({
      printArea: { startRow: 0, startCol: 0, endRow: 35, endCol: 4 },
    });

    const engine = new PaginationEngine();
    const plan = engine.calculateLayout(measurer, setup);

    // All 36 rows * 18 = 648 should fit on 1 page (exactly fills content height)
    expect(plan.totalPages).toBe(1);
  });

  it('should use epsilon tolerance for row height accumulation', () => {
    const rowHeights = Array(10).fill(64.8);
    const measurer = createVariableMeasurer(rowHeights, Array(5).fill(50));

    const result = calculateRowBreaks({
      startRow: 0,
      endRow: 9,
      contentHeight: 648,
      measurer,
      manualBreaks: new Set(),
      mergedRegions: [],
    });

    // Should fit on 1 page with epsilon tolerance
    expect(result.breaks.length).toBe(1);
  });

  it('should still break when content genuinely exceeds page height', () => {
    const rowHeights = Array(11).fill(64.8);
    const measurer = createVariableMeasurer(rowHeights, Array(5).fill(50));

    const result = calculateRowBreaks({
      startRow: 0,
      endRow: 10,
      contentHeight: 648,
      measurer,
      manualBreaks: new Set(),
      mergedRegions: [],
    });

    // Should need 2 pages
    expect(result.breaks.length).toBe(2);
  });
});
