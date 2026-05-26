/**
 * page-order.test.ts — Page order tests
 *
 * Tests "over then down" and "down then over" page orderings.
 */

import { PaginationEngine } from '../pagination-engine';
import type { ContentMeasurer, PageSetupInput } from '../types';

// ============================================================================
// Test Helpers
// ============================================================================

function createMeasurer(rowHeight: number, colWidth: number): ContentMeasurer {
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
    printArea: { startRow: 0, startCol: 0, endRow: 39, endCol: 19 },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Page Order', () => {
  let engine: PaginationEngine;

  beforeEach(() => {
    engine = new PaginationEngine();
  });

  describe('Over then down (default)', () => {
    it('should order pages: all columns for row-section-1, then all columns for row-section-2', () => {
      // Create content that produces 2 row sections x 2 col sections = 4 pages
      const measurer = createMeasurer(30, 40);
      const setup = createSetup({
        pageOrder: 'overThenDown',
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 19 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // With over-then-down, pages should be:
      // Page 1: row-section-1, col-section-1
      // Page 2: row-section-1, col-section-2
      // Page 3: row-section-2, col-section-1
      // Page 4: row-section-2, col-section-2

      if (plan.totalPages >= 4) {
        // Pages 1 and 2 should have the same row range
        expect(plan.pages[0].rowRange).toEqual(plan.pages[1].rowRange);
        // Pages 3 and 4 should have the same row range
        expect(plan.pages[2].rowRange).toEqual(plan.pages[3].rowRange);
        // Pages 1 and 3 should have the same col range
        expect(plan.pages[0].colRange).toEqual(plan.pages[2].colRange);
        // Pages 2 and 4 should have the same col range
        expect(plan.pages[1].colRange).toEqual(plan.pages[3].colRange);
      }
    });

    it('should be the default when pageOrder is not specified', () => {
      const measurer = createMeasurer(30, 40);
      const setup = createSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 19 },
      });

      const planDefault = engine.calculateLayout(measurer, setup);

      const setupExplicit = createSetup({
        pageOrder: 'overThenDown',
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 19 },
      });

      const planExplicit = engine.calculateLayout(measurer, setupExplicit);

      expect(planDefault.totalPages).toBe(planExplicit.totalPages);
      for (let i = 0; i < planDefault.pages.length; i++) {
        expect(planDefault.pages[i].rowRange).toEqual(planExplicit.pages[i].rowRange);
        expect(planDefault.pages[i].colRange).toEqual(planExplicit.pages[i].colRange);
      }
    });
  });

  describe('Down then over', () => {
    it('should order pages: all rows for col-section-1, then all rows for col-section-2', () => {
      const measurer = createMeasurer(30, 40);
      const setup = createSetup({
        pageOrder: 'downThenOver',
        printArea: { startRow: 0, startCol: 0, endRow: 29, endCol: 19 },
      });

      const plan = engine.calculateLayout(measurer, setup);

      // With down-then-over, pages should be:
      // Page 1: row-section-1, col-section-1
      // Page 2: row-section-2, col-section-1
      // Page 3: row-section-1, col-section-2
      // Page 4: row-section-2, col-section-2

      if (plan.totalPages >= 4) {
        // Pages 1 and 2 should have the same col range
        expect(plan.pages[0].colRange).toEqual(plan.pages[1].colRange);
        // Pages 3 and 4 should have the same col range
        expect(plan.pages[2].colRange).toEqual(plan.pages[3].colRange);
        // Pages 1 and 3 should have the same row range
        expect(plan.pages[0].rowRange).toEqual(plan.pages[2].rowRange);
      }
    });

    it('should produce the same total pages as over-then-down', () => {
      const measurer = createMeasurer(30, 40);
      const setupOTD = createSetup({
        pageOrder: 'overThenDown',
        printArea: { startRow: 0, startCol: 0, endRow: 39, endCol: 19 },
      });
      const setupDTO = createSetup({
        pageOrder: 'downThenOver',
        printArea: { startRow: 0, startCol: 0, endRow: 39, endCol: 19 },
      });

      const planOTD = engine.calculateLayout(measurer, setupOTD);
      const planDTO = engine.calculateLayout(measurer, setupDTO);

      expect(planOTD.totalPages).toBe(planDTO.totalPages);
    });
  });

  describe('Both orderings with multi-page grid', () => {
    it('should produce different page sequences for different orderings', () => {
      // Force a 3x2 grid (3 row sections, 2 col sections)
      const measurer = createMeasurer(25, 40);
      const setup = createSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 99, endCol: 24 },
      });

      const planOTD = engine.calculateLayout(measurer, {
        ...setup,
        pageOrder: 'overThenDown',
      });
      const planDTO = engine.calculateLayout(measurer, {
        ...setup,
        pageOrder: 'downThenOver',
      });

      // Same total pages
      expect(planOTD.totalPages).toBe(planDTO.totalPages);

      if (planOTD.totalPages > 1) {
        // But at least some pages should have different row/col ranges at same index
        // (unless it's a 1xN or Nx1 grid, in which case they're identical)
        const uniqueRowRangesOTD = new Set(
          planOTD.pages.map((p) => `${p.rowRange[0]}-${p.rowRange[1]}`),
        );
        const uniqueColRangesOTD = new Set(
          planOTD.pages.map((p) => `${p.colRange[0]}-${p.colRange[1]}`),
        );

        if (uniqueRowRangesOTD.size > 1 && uniqueColRangesOTD.size > 1) {
          // True grid — orderings should differ
          let anyDifferent = false;
          for (let i = 0; i < planOTD.pages.length; i++) {
            if (
              planOTD.pages[i].rowRange[0] !== planDTO.pages[i].rowRange[0] ||
              planOTD.pages[i].colRange[0] !== planDTO.pages[i].colRange[0]
            ) {
              anyDifferent = true;
              break;
            }
          }
          expect(anyDifferent).toBe(true);
        }
      }
    });
  });

  describe('Single dimension pagination', () => {
    it('should produce identical ordering when only rows overflow (1 col section)', () => {
      const measurer = createMeasurer(30, 50);
      const setup = createSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 49, endCol: 4 },
      });

      const planOTD = engine.calculateLayout(measurer, {
        ...setup,
        pageOrder: 'overThenDown',
      });
      const planDTO = engine.calculateLayout(measurer, {
        ...setup,
        pageOrder: 'downThenOver',
      });

      expect(planOTD.totalPages).toBe(planDTO.totalPages);
      for (let i = 0; i < planOTD.pages.length; i++) {
        expect(planOTD.pages[i].rowRange).toEqual(planDTO.pages[i].rowRange);
        expect(planOTD.pages[i].colRange).toEqual(planDTO.pages[i].colRange);
      }
    });

    it('should produce identical ordering when only cols overflow (1 row section)', () => {
      const measurer = createMeasurer(20, 60);
      const setup = createSetup({
        printArea: { startRow: 0, startCol: 0, endRow: 9, endCol: 19 },
      });

      const planOTD = engine.calculateLayout(measurer, {
        ...setup,
        pageOrder: 'overThenDown',
      });
      const planDTO = engine.calculateLayout(measurer, {
        ...setup,
        pageOrder: 'downThenOver',
      });

      expect(planOTD.totalPages).toBe(planDTO.totalPages);
      for (let i = 0; i < planOTD.pages.length; i++) {
        expect(planOTD.pages[i].rowRange).toEqual(planDTO.pages[i].rowRange);
        expect(planOTD.pages[i].colRange).toEqual(planDTO.pages[i].colRange);
      }
    });
  });
});
