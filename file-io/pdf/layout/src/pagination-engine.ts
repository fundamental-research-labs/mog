/**
 * pagination-engine.ts — Main PaginationEngine class
 *
 * Format-agnostic pagination engine. Takes content dimensions via
 * ContentMeasurer and produces a PaginationPlan with page slices,
 * scale, and warnings.
 */

import { calculateColBreaks } from './col-breaks';
import { calculateFitToScale, measureContentDimensions } from './fit-to-page';
import { assemblePages } from './page-order';
import { calculateRowBreaks } from './row-breaks';
import type {
  ContentMeasurer,
  LayoutWarning,
  PageDimensions,
  PageSetupInput,
  PaginationPlan,
} from './types';

/**
 * PaginationEngine calculates a complete pagination layout.
 *
 * Usage:
 *   const engine = new PaginationEngine();
 *   const plan = engine.calculateLayout(measurer, setup);
 */
export class PaginationEngine {
  /**
   * Calculate the complete pagination layout.
   *
   * @param measurer - Content dimension provider
   * @param setup - Page setup configuration
   * @returns Complete pagination plan
   */
  calculateLayout(measurer: ContentMeasurer, setup: PageSetupInput): PaginationPlan {
    const warnings: LayoutWarning[] = [];

    // Determine print area bounds
    const { startRow, endRow, startCol, endCol } = this.resolvePrintArea(setup);

    // Fix 5: Validate print area bounds
    if (startRow > endRow || startCol > endCol) {
      return {
        pages: [],
        totalPages: 0,
        scale: setup.scale ?? 1.0,
        warnings: [
          { type: 'empty_print_area', message: 'Print area is empty or has inverted bounds' },
        ],
      };
    }

    // Calculate effective scale (handles fit-to-page)
    let scale = setup.scale;

    if (setup.fitTo) {
      const { totalWidth, totalHeight } = measureContentDimensions(
        measurer,
        startRow,
        endRow,
        startCol,
        endCol,
      );

      const dims = this.calculatePageDimensions(measurer, setup, 1.0);

      const fitCalc = calculateFitToScale({
        totalContentWidth: totalWidth,
        totalContentHeight: totalHeight,
        printableWidth: dims.printableWidth,
        printableHeight: dims.printableHeight,
        repeatColsWidth: dims.repeatColsWidth,
        repeatRowsHeight: dims.repeatRowsHeight,
        fitTo: setup.fitTo,
        orientation: setup.orientation,
        pageWidth: setup.pageWidth,
        pageHeight: setup.pageHeight,
      });

      scale = fitCalc.result.actualScale;
      warnings.push(...fitCalc.warnings);
    }

    // Calculate page dimensions with effective scale
    // SCALE FIX: At scale < 1, content is smaller, so MORE fits per page.
    // effectivePageWidth = printableWidth / scale
    const dimensions = this.calculatePageDimensions(measurer, setup, scale);

    // Get merged regions
    const mergedRegions = measurer.getMergedRegions();

    // Calculate row breaks
    const manualHBreaks = new Set(setup.rowPageBreaks ?? []);
    const rowBreakResult = calculateRowBreaks({
      startRow,
      endRow,
      contentHeight: dimensions.contentHeight,
      measurer,
      manualBreaks: manualHBreaks,
      mergedRegions,
      repeatRows: setup.repeatRows,
    });
    warnings.push(...rowBreakResult.warnings);

    // Calculate column breaks
    const manualVBreaks = new Set(setup.colPageBreaks ?? []);
    const colBreakResult = calculateColBreaks({
      startCol,
      endCol,
      contentWidth: dimensions.contentWidth,
      measurer,
      manualBreaks: manualVBreaks,
      mergedRegions,
      repeatCols: setup.repeatCols,
      columnGroups: setup.columnGroups,
    });
    warnings.push(...colBreakResult.warnings);

    // Assemble pages in the specified order
    const pages = assemblePages({
      rowBreaks: rowBreakResult.breaks,
      colBreaks: colBreakResult.breaks,
      endRow,
      endCol,
      pageOrder: setup.pageOrder ?? 'overThenDown',
      repeatRows: setup.repeatRows,
      repeatCols: setup.repeatCols,
      centerHorizontal: setup.centerHorizontal ?? false,
      centerVertical: setup.centerVertical ?? false,
      printableWidth: dimensions.printableWidth,
      printableHeight: dimensions.printableHeight,
      measurer,
      scale,
    });

    return {
      pages,
      totalPages: pages.length,
      scale,
      warnings,
    };
  }

  /**
   * Resolve the print area boundaries.
   */
  private resolvePrintArea(setup: PageSetupInput): {
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  } {
    if (setup.printArea) {
      return {
        startRow: setup.printArea.startRow,
        endRow: setup.printArea.endRow,
        startCol: setup.printArea.startCol,
        endCol: setup.printArea.endCol,
      };
    }
    // Default: the caller must provide printArea; fallback to empty
    return { startRow: 0, endRow: 0, startCol: 0, endCol: 0 };
  }

  /**
   * Calculate page dimensions.
   *
   * SCALE DIRECTION FIX:
   * The existing PageCalculator multiplied printable area by scale,
   * which is backwards. At 50% scale, content should be smaller so
   * MORE fits per page.
   *
   * Correct: effectivePageWidth = printableWidth / scale
   * This means the "content area" in content-space coordinates is
   * larger when scale is smaller.
   */
  calculatePageDimensions(
    measurer: ContentMeasurer,
    setup: PageSetupInput,
    scale: number,
  ): PageDimensions {
    const { pageWidth, pageHeight, margins } = setup;

    // Printable area after margins
    const printableWidth = pageWidth - margins.left - margins.right;
    const printableHeight =
      pageHeight -
      margins.top -
      margins.bottom -
      (setup.headerHeight ?? 0) -
      (setup.footerHeight ?? 0);

    // SCALE DIRECTION FIX: divide by scale instead of multiply.
    // In content-space coordinates, at 50% scale the effective page
    // is 2x larger (more content fits).
    const effectivePrintableWidth = printableWidth / scale;
    const effectivePrintableHeight = printableHeight / scale;

    // Calculate repeat rows/columns dimensions
    let repeatRowsHeight = 0;
    let repeatColsWidth = 0;

    if (setup.repeatRows) {
      const [startRow, endRow] = setup.repeatRows;
      for (let row = startRow; row <= endRow; row++) {
        if (!measurer.isRowHidden(row)) {
          repeatRowsHeight += measurer.getRowHeight(row);
        }
      }
    }

    if (setup.repeatCols) {
      const [startCol, endCol] = setup.repeatCols;
      for (let col = startCol; col <= endCol; col++) {
        if (!measurer.isColHidden(col)) {
          repeatColsWidth += measurer.getColumnWidth(col);
        }
      }
    }

    // Content area = effective printable minus repeat rows/cols (in content-space)
    const contentWidth = effectivePrintableWidth - repeatColsWidth;
    const contentHeight = effectivePrintableHeight - repeatRowsHeight;

    return {
      pageWidth,
      pageHeight,
      printableWidth,
      printableHeight,
      repeatRowsHeight,
      repeatColsWidth,
      contentWidth: Math.max(0, contentWidth),
      contentHeight: Math.max(0, contentHeight),
    };
  }
}
