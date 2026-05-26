/**
 * page-order.ts — Page ordering strategies
 *
 * Supports two page orderings:
 * - "Over then down" (default): all column sections for a row range, then next row range
 * - "Down then over": all row sections for a column range, then next column range
 */

import type { ColBreakInfo, ContentMeasurer, PageSlice, RowBreakInfo } from './types';

/**
 * Parameters for page assembly.
 */
export interface PageAssemblyParams {
  rowBreaks: RowBreakInfo[];
  colBreaks: ColBreakInfo[];
  endRow: number;
  endCol: number;
  pageOrder: 'overThenDown' | 'downThenOver';
  repeatRows?: [number, number];
  repeatCols?: [number, number];
  centerHorizontal: boolean;
  centerVertical: boolean;
  printableWidth: number;
  printableHeight: number;
  measurer: ContentMeasurer;
  scale: number;
}

/**
 * Assemble pages from row/column breaks using the specified page order.
 */
export function assemblePages(params: PageAssemblyParams): PageSlice[] {
  const {
    rowBreaks,
    colBreaks,
    endRow,
    endCol,
    pageOrder,
    repeatRows,
    repeatCols,
    centerHorizontal,
    centerVertical,
    printableWidth,
    printableHeight,
    measurer,
    scale,
  } = params;

  const pages: PageSlice[] = [];
  let pageNumber = 1;

  if (pageOrder === 'overThenDown') {
    // For each row section, iterate through all column sections
    for (let ri = 0; ri < rowBreaks.length; ri++) {
      const rowStart = rowBreaks[ri].startRow;
      const rowEnd = ri < rowBreaks.length - 1 ? rowBreaks[ri + 1].startRow - 1 : endRow;

      for (let ci = 0; ci < colBreaks.length; ci++) {
        const colStart = colBreaks[ci].startCol;
        const colEnd = ci < colBreaks.length - 1 ? colBreaks[ci + 1].startCol - 1 : endCol;

        const isManualBreak =
          (ri > 0 && rowBreaks[ri].isManualBreak) || (ci > 0 && colBreaks[ci].isManualBreak);

        const offset = calculateContentOffset(
          rowStart,
          rowEnd,
          colStart,
          colEnd,
          repeatRows,
          repeatCols,
          centerHorizontal,
          centerVertical,
          printableWidth,
          printableHeight,
          measurer,
          scale,
        );

        pages.push({
          pageNumber: pageNumber++,
          rowRange: [rowStart, rowEnd],
          colRange: [colStart, colEnd],
          repeatRows: repeatRows ? [repeatRows[0], repeatRows[1]] : undefined,
          repeatCols: repeatCols ? [repeatCols[0], repeatCols[1]] : undefined,
          contentOffset: offset,
          isManualBreak,
        });
      }
    }
  } else {
    // "Down then over": for each column section, iterate through all row sections
    for (let ci = 0; ci < colBreaks.length; ci++) {
      const colStart = colBreaks[ci].startCol;
      const colEnd = ci < colBreaks.length - 1 ? colBreaks[ci + 1].startCol - 1 : endCol;

      for (let ri = 0; ri < rowBreaks.length; ri++) {
        const rowStart = rowBreaks[ri].startRow;
        const rowEnd = ri < rowBreaks.length - 1 ? rowBreaks[ri + 1].startRow - 1 : endRow;

        const isManualBreak =
          (ri > 0 && rowBreaks[ri].isManualBreak) || (ci > 0 && colBreaks[ci].isManualBreak);

        const offset = calculateContentOffset(
          rowStart,
          rowEnd,
          colStart,
          colEnd,
          repeatRows,
          repeatCols,
          centerHorizontal,
          centerVertical,
          printableWidth,
          printableHeight,
          measurer,
          scale,
        );

        pages.push({
          pageNumber: pageNumber++,
          rowRange: [rowStart, rowEnd],
          colRange: [colStart, colEnd],
          repeatRows: repeatRows ? [repeatRows[0], repeatRows[1]] : undefined,
          repeatCols: repeatCols ? [repeatCols[0], repeatCols[1]] : undefined,
          contentOffset: offset,
          isManualBreak,
        });
      }
    }
  }

  return pages;
}

/**
 * Calculate the content offset for centering on a page.
 *
 * When content is smaller than the printable area, we center it.
 * The offset is how much to shift content from the top-left corner.
 */
function calculateContentOffset(
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
  _repeatRows: [number, number] | undefined,
  _repeatCols: [number, number] | undefined,
  centerHorizontal: boolean,
  centerVertical: boolean,
  printableWidth: number,
  printableHeight: number,
  measurer: ContentMeasurer,
  scale: number,
): { x: number; y: number } {
  let x = 0;
  let y = 0;

  if (centerHorizontal) {
    let contentWidth = 0;
    for (let c = colStart; c <= colEnd; c++) {
      if (!measurer.isColHidden(c)) {
        contentWidth += measurer.getColumnWidth(c);
      }
    }
    // Fix 4: DON'T add repeat cols width — they render at the left edge independently
    // Scale the content
    const scaledWidth = contentWidth * scale;
    if (scaledWidth < printableWidth) {
      x = (printableWidth - scaledWidth) / 2;
    }
  }

  if (centerVertical) {
    let contentHeight = 0;
    for (let r = rowStart; r <= rowEnd; r++) {
      if (!measurer.isRowHidden(r)) {
        contentHeight += measurer.getRowHeight(r);
      }
    }
    // Fix 4: DON'T add repeat rows height — they render at the top edge independently
    // Scale the content
    const scaledHeight = contentHeight * scale;
    if (scaledHeight < printableHeight) {
      y = (printableHeight - scaledHeight) / 2;
    }
  }

  return { x, y };
}
