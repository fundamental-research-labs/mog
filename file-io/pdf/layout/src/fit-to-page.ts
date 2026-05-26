/**
 * fit-to-page.ts — Fit-to-page scale calculation with readability constraints
 *
 * Calculates the optimal scale factor to fit content within a specified
 * number of pages, while ensuring text remains readable.
 */

import type { ContentMeasurer, FitToPageResult, LayoutWarning } from './types';

/**
 * Default minimum readable font size in points.
 * Text below this size after scaling is considered unreadable.
 */
const DEFAULT_MIN_READABLE_PT = 6;

/**
 * Default base font size in points (typical spreadsheet cell font).
 */
const DEFAULT_BASE_FONT_PT = 11;

/**
 * Parameters for fit-to-page calculation.
 */
export interface FitToPageParams {
  /** Total content width (sum of all visible column widths). */
  totalContentWidth: number;

  /** Total content height (sum of all visible row heights). */
  totalContentHeight: number;

  /** Printable width per page (after margins) in points. */
  printableWidth: number;

  /** Printable height per page (after margins) in points. */
  printableHeight: number;

  /** Width consumed by repeat columns per page. */
  repeatColsWidth: number;

  /** Height consumed by repeat rows per page. */
  repeatRowsHeight: number;

  /** Fit-to constraints. */
  fitTo: { width?: number; height?: number };

  /** Minimum readable point size (default: 6). */
  minReadablePt?: number;

  /** Base font size of the content (default: 11). */
  baseFontPt?: number;

  /** Current orientation. */
  orientation: 'portrait' | 'landscape';

  /** Current page dimensions for orientation suggestion. */
  pageWidth: number;
  pageHeight: number;
}

/**
 * Calculate the fit-to-page scale factor.
 *
 * At scale S, content is drawn at S * original size, so:
 * - effectivePageWidth = printableWidth / S (how much content fits per page)
 * - We want totalContentWidth <= effectivePageWidth * fitTo.width
 *
 * Correct formula:
 *   S = (printableWidth * fitTo.width) / totalContentWidth
 */
export function calculateFitToScale(params: FitToPageParams): {
  result: FitToPageResult;
  warnings: LayoutWarning[];
} {
  const {
    totalContentWidth,
    totalContentHeight,
    printableWidth,
    printableHeight,
    repeatColsWidth,
    repeatRowsWidth: _,
    fitTo,
    minReadablePt = DEFAULT_MIN_READABLE_PT,
    baseFontPt = DEFAULT_BASE_FONT_PT,
    orientation,
    pageWidth,
    pageHeight,
  } = { ...params, repeatRowsWidth: params.repeatRowsHeight };

  const warnings: LayoutWarning[] = [];

  // Available content area per page (excluding repeat rows/cols)
  const availWidth = printableWidth - repeatColsWidth;
  const availHeight = printableHeight - params.repeatRowsHeight;

  let scaleX = 1.0;
  let scaleY = 1.0;

  // Calculate X scale: content must fit in fitTo.width pages
  if (fitTo.width !== undefined && fitTo.width > 0 && totalContentWidth > 0) {
    const targetWidth = availWidth * fitTo.width;
    if (totalContentWidth > targetWidth) {
      scaleX = targetWidth / totalContentWidth;
    }
  }

  // Calculate Y scale: content must fit in fitTo.height pages
  if (fitTo.height !== undefined && fitTo.height > 0 && totalContentHeight > 0) {
    const targetHeight = availHeight * fitTo.height;
    if (totalContentHeight > targetHeight) {
      scaleY = targetHeight / totalContentHeight;
    }
  }

  // Use the smaller scale to satisfy both constraints
  let actualScale = Math.min(scaleX, scaleY);

  // Clamp to reasonable range
  actualScale = Math.max(0.1, Math.min(actualScale, 4.0));

  // Check readability
  const minScale = minReadablePt / baseFontPt;
  const readableAtScale = actualScale >= minScale;

  let suggestedOrientation: 'portrait' | 'landscape' | undefined;
  let suggestedPaperSize: { width: number; height: number } | undefined;

  if (!readableAtScale) {
    // Try landscape if currently portrait
    if (orientation === 'portrait') {
      const landscapeResult = tryLandscape(params);
      if (landscapeResult && landscapeResult >= minScale) {
        suggestedOrientation = 'landscape';
      }
    }

    // If still unreadable, suggest larger paper
    if (!suggestedOrientation) {
      const needed = totalContentWidth / (fitTo.width ?? 1);
      const neededHeight = totalContentHeight / (fitTo.height ?? 1);
      if (needed > printableWidth || neededHeight > printableHeight) {
        suggestedPaperSize = {
          width: Math.max(pageWidth, needed + (pageWidth - printableWidth)),
          height: Math.max(pageHeight, neededHeight + (pageHeight - printableHeight)),
        };
      }
    }

    // Override to minimum readable scale
    warnings.push({
      type: 'fit_unreadable',
      message: `Fit-to-page would scale to ${(actualScale * 100).toFixed(1)}% which is below readable threshold. Using ${(minScale * 100).toFixed(1)}% instead.`,
    });
    actualScale = minScale;
  }

  return {
    result: {
      actualScale,
      readableAtScale: readableAtScale || actualScale >= minScale,
      suggestedOrientation,
      suggestedPaperSize,
    },
    warnings,
  };
}

/**
 * Try landscape orientation and return the resulting scale.
 */
function tryLandscape(params: FitToPageParams): number | null {
  const { totalContentWidth, totalContentHeight, pageWidth, pageHeight, fitTo } = params;

  // Swap page dimensions for landscape
  const landscapePageW = Math.max(pageWidth, pageHeight);
  const landscapePageH = Math.min(pageWidth, pageHeight);

  // Recalculate printable area (approximate — same margin ratios)
  const marginW = pageWidth - params.printableWidth;
  const marginH = pageHeight - params.printableHeight;

  const printableW = landscapePageW - marginW;
  const printableH = landscapePageH - marginH;

  const availW = printableW - params.repeatColsWidth;
  const availH = printableH - params.repeatRowsHeight;

  let scaleX = 1.0;
  let scaleY = 1.0;

  if (fitTo.width !== undefined && fitTo.width > 0 && totalContentWidth > 0) {
    const targetWidth = availW * fitTo.width;
    if (totalContentWidth > targetWidth) {
      scaleX = targetWidth / totalContentWidth;
    }
  }

  if (fitTo.height !== undefined && fitTo.height > 0 && totalContentHeight > 0) {
    const targetHeight = availH * fitTo.height;
    if (totalContentHeight > targetHeight) {
      scaleY = targetHeight / totalContentHeight;
    }
  }

  return Math.min(scaleX, scaleY);
}

/**
 * Calculate total visible content dimensions.
 */
export function measureContentDimensions(
  measurer: ContentMeasurer,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): { totalWidth: number; totalHeight: number } {
  let totalWidth = 0;
  let totalHeight = 0;

  for (let col = startCol; col <= endCol; col++) {
    if (!measurer.isColHidden(col)) {
      totalWidth += measurer.getColumnWidth(col);
    }
  }

  for (let row = startRow; row <= endRow; row++) {
    if (!measurer.isRowHidden(row)) {
      totalHeight += measurer.getRowHeight(row);
    }
  }

  return { totalWidth, totalHeight };
}
