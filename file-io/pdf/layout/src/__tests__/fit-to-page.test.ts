/**
 * fit-to-page.test.ts — Fit-to-page tests
 *
 * Tests fit-to-page scaling with readability constraints,
 * landscape suggestion, and paper size suggestion.
 */

import { calculateFitToScale, measureContentDimensions } from '../fit-to-page';
import { PaginationEngine } from '../pagination-engine';
import type { ContentMeasurer, PageSetupInput } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function createUniformMeasurer(rowHeight: number, colWidth: number): ContentMeasurer {
  return {
    getRowHeight: () => rowHeight,
    getColumnWidth: () => colWidth,
    getMergedRegions: () => [],
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
    printArea: { startRow: 0, startCol: 0, endRow: 49, endCol: 19 },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Fit-to-Page', () => {
  let engine: PaginationEngine;

  beforeEach(() => {
    engine = new PaginationEngine();
  });

  describe('Basic fit-to-page', () => {
    it('should fit content to 1 page wide when scale stays readable', () => {
      // 8 cols * 80 = 640 pts total width
      // Printable: 504
      // Needs scale: 504 / 640 = 0.7875 (above 0.545 readable threshold)
      const measurer = createUniformMeasurer(20, 80);
      const setup = createSetup({
        fitTo: { width: 1 },
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 7 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Should be only 1 column section
      const uniqueColRanges = new Set(plan.pages.map((p) => `${p.colRange[0]}-${p.colRange[1]}`));
      expect(uniqueColRanges.size).toBe(1);
      expect(plan.scale).toBeCloseTo(0.7875, 2);
    });

    it('should fit content to 1 page tall when scale stays readable', () => {
      // 20 rows * 50 = 1000 pts total height
      // Printable: 648
      // Needs scale: 648 / 1000 = 0.648 (above 0.545 readable threshold)
      const measurer = createUniformMeasurer(50, 50);
      const setup = createSetup({
        fitTo: { height: 1 },
        printArea: { startRow: 0, startCol: 0, endRow: 19, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Should be only 1 row section
      const uniqueRowRanges = new Set(plan.pages.map((p) => `${p.rowRange[0]}-${p.rowRange[1]}`));
      expect(uniqueRowRanges.size).toBe(1);
    });

    it('should fit content to 1 page wide and 1 page tall', () => {
      // Width: 8 * 80 = 640, scale = 504/640 = 0.7875
      // Height: 15 * 50 = 750, scale = 648/750 = 0.864
      // Combined: min(0.7875, 0.864) = 0.7875 (readable)
      const measurer = createUniformMeasurer(50, 80);
      const setup = createSetup({
        fitTo: { width: 1, height: 1 },
        printArea: { startRow: 0, startCol: 0, endRow: 14, endCol: 7 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.totalPages).toBe(1);
    });

    it('should fit to 2 pages wide', () => {
      // 20 cols * 50 = 1000 pts total width
      // Printable: 504
      // Target: 504 * 2 = 1008 -> scale = 1008/1000 = 1.008 (no scaling needed)
      const measurer = createUniformMeasurer(20, 50);
      const setup = createSetup({
        fitTo: { width: 2 },
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 19 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // Should be at most 2 column sections
      const uniqueColRanges = new Set(plan.pages.map((p) => `${p.colRange[0]}-${p.colRange[1]}`));
      expect(uniqueColRanges.size).toBeLessThanOrEqual(2);
    });

    it('should not scale up when content already fits', () => {
      // 5 cols * 50 = 250 < 504 -> already fits, no scaling
      const measurer = createUniformMeasurer(20, 50);
      const setup = createSetup({
        fitTo: { width: 1 },
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      expect(plan.scale).toBe(1.0);
      expect(plan.totalPages).toBe(1);
    });
  });

  describe('Readability constraints', () => {
    it('should emit fit_unreadable warning when scale is too small', () => {
      // Create very wide content that would need extreme scaling
      // 100 cols * 100 = 10000 pts, printable = 504
      // Scale = 504 / 10000 = 0.0504 -> way below 6/11 = 0.545 min readable
      const measurer = createUniformMeasurer(20, 100);
      const setup = createSetup({
        fitTo: { width: 1 },
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 99 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      const unreadableWarnings = plan.warnings.filter((w) => w.type === 'fit_unreadable');
      expect(unreadableWarnings.length).toBe(1);

      // Scale should be clamped to minimum readable (6/11 ~ 0.545)
      expect(plan.scale).toBeCloseTo(6 / 11, 1);
    });

    it('should not emit warning when scale is above readable threshold', () => {
      // Moderate scaling that keeps text readable
      // 10 cols * 60 = 600, printable = 504
      // Scale = 504 / 600 = 0.84 > 0.545 -> readable
      const measurer = createUniformMeasurer(20, 60);
      const setup = createSetup({
        fitTo: { width: 1 },
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 9 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      const unreadableWarnings = plan.warnings.filter((w) => w.type === 'fit_unreadable');
      expect(unreadableWarnings.length).toBe(0);
    });
  });

  describe('calculateFitToScale (direct)', () => {
    it('should calculate correct scale for width-only fit (readable scale)', () => {
      // 800 content in 500 printable = 0.625 scale (above 0.545 threshold)
      const { result, warnings } = calculateFitToScale({
        totalContentWidth: 800,
        totalContentHeight: 500,
        printableWidth: 500,
        printableHeight: 700,
        repeatColsWidth: 0,
        repeatRowsHeight: 0,
        fitTo: { width: 1 },
        orientation: 'portrait',
        pageWidth: 612,
        pageHeight: 792,
      });

      expect(result.actualScale).toBeCloseTo(0.625, 2);
      expect(warnings).toEqual([]);
    });

    it('should calculate correct scale for height-only fit (readable scale)', () => {
      // 1000 content in 700 printable = 0.7 scale (above threshold)
      const { result, warnings } = calculateFitToScale({
        totalContentWidth: 400,
        totalContentHeight: 1000,
        printableWidth: 500,
        printableHeight: 700,
        repeatColsWidth: 0,
        repeatRowsHeight: 0,
        fitTo: { height: 1 },
        orientation: 'portrait',
        pageWidth: 612,
        pageHeight: 792,
      });

      expect(result.actualScale).toBeCloseTo(0.7, 2);
      expect(warnings).toEqual([]);
    });

    it('should use the smaller scale when both width and height are constrained', () => {
      // Width: 500/750 = 0.667, Height: 700/1000 = 0.7
      // Min: 0.667 (both above threshold)
      const { result, warnings } = calculateFitToScale({
        totalContentWidth: 750,
        totalContentHeight: 1000,
        printableWidth: 500,
        printableHeight: 700,
        repeatColsWidth: 0,
        repeatRowsHeight: 0,
        fitTo: { width: 1, height: 1 },
        orientation: 'portrait',
        pageWidth: 612,
        pageHeight: 792,
      });

      expect(result.actualScale).toBeCloseTo(0.667, 2);
      expect(warnings).toEqual([]);
    });

    it('should clamp to readable minimum when scale would be too small', () => {
      // 2000 content in 500 printable = 0.25 scale (below 0.545 threshold)
      const { result, warnings } = calculateFitToScale({
        totalContentWidth: 2000,
        totalContentHeight: 300,
        printableWidth: 500,
        printableHeight: 700,
        repeatColsWidth: 0,
        repeatRowsHeight: 0,
        fitTo: { width: 1 },
        orientation: 'portrait',
        pageWidth: 612,
        pageHeight: 792,
      });

      expect(result.actualScale).toBeCloseTo(6 / 11, 2);
      expect(result.readableAtScale).toBe(true); // clamped to readable
      expect(warnings.some((w) => w.type === 'fit_unreadable')).toBe(true);
    });

    it('should suggest landscape when portrait is unreadable but landscape is readable', () => {
      // Portrait: printable width = 504, content width = 800
      // Scale = 504/800 = 0.63 -> readable? 0.63 > 0.545 yes!
      // We need content that is unreadable in portrait but readable in landscape.
      // Portrait printable = 504, landscape printable = 684 (swap page dims)
      // Content width = 900: portrait scale = 504/900 = 0.56 > 0.545 (still ok)
      // Content width = 1000: portrait scale = 504/1000 = 0.504 < 0.545 (unreadable!)
      // Landscape scale = 684/1000 = 0.684 > 0.545 (readable!)
      const { result, warnings } = calculateFitToScale({
        totalContentWidth: 1000,
        totalContentHeight: 300,
        printableWidth: 504,
        printableHeight: 648,
        repeatColsWidth: 0,
        repeatRowsHeight: 0,
        fitTo: { width: 1 },
        orientation: 'portrait',
        pageWidth: 612,
        pageHeight: 792,
      });

      // Scale would be 504/1000 = 0.504, unreadable
      expect(warnings.some((w) => w.type === 'fit_unreadable')).toBe(true);
      // Should suggest landscape (wider page gives 684/1000 = 0.684 which is readable)
      expect(result.suggestedOrientation).toBe('landscape');
    });

    it('should not suggest landscape when already in landscape', () => {
      const { result, warnings } = calculateFitToScale({
        totalContentWidth: 2000,
        totalContentHeight: 300,
        printableWidth: 684,
        printableHeight: 468,
        repeatColsWidth: 0,
        repeatRowsHeight: 0,
        fitTo: { width: 1 },
        orientation: 'landscape',
        pageWidth: 792,
        pageHeight: 612,
      });

      expect(warnings.some((w) => w.type === 'fit_unreadable')).toBe(true);
      // Should NOT suggest landscape since we're already in landscape
      expect(result.suggestedOrientation).toBeUndefined();
    });

    it('should suggest larger paper when landscape also insufficient', () => {
      // Very wide content: neither portrait nor landscape works
      const { result, warnings } = calculateFitToScale({
        totalContentWidth: 5000,
        totalContentHeight: 300,
        printableWidth: 504,
        printableHeight: 648,
        repeatColsWidth: 0,
        repeatRowsHeight: 0,
        fitTo: { width: 1 },
        orientation: 'portrait',
        pageWidth: 612,
        pageHeight: 792,
      });

      expect(warnings.some((w) => w.type === 'fit_unreadable')).toBe(true);
      // Landscape: 684/5000 = 0.137, still unreadable -> suggest paper size
      expect(result.suggestedPaperSize).toBeDefined();
      expect(result.suggestedPaperSize!.width).toBeGreaterThan(612);
    });
  });

  describe('measureContentDimensions', () => {
    it('should sum visible row heights and column widths', () => {
      const measurer = createUniformMeasurer(20, 50);
      const { totalWidth, totalHeight } = measureContentDimensions(measurer, 0, 9, 0, 4);

      expect(totalWidth).toBe(250); // 5 * 50
      expect(totalHeight).toBe(200); // 10 * 20
    });

    it('should exclude hidden rows and columns', () => {
      const measurer: ContentMeasurer = {
        getRowHeight: () => 20,
        getColumnWidth: () => 50,
        getMergedRegions: () => [],
        isRowHidden: (row: number) => row === 3 || row === 7,
        isColHidden: (col: number) => col === 2,
      };

      const { totalWidth, totalHeight } = measureContentDimensions(measurer, 0, 9, 0, 4);

      expect(totalWidth).toBe(200); // 4 visible cols * 50
      expect(totalHeight).toBe(160); // 8 visible rows * 20
    });
  });
});
