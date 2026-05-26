/**
 * Text Overflow
 *
 * Calculates text overflow bounds for cells where text extends into adjacent
 * empty cells. When overflow is blocked, text is clipped with an ellipsis.
 *
 * Excel overflow rules:
 * 1. Only unformatted text overflows (numbers show ### when too wide)
 * 2. wrapText=true disables overflow (text wraps instead)
 * 3. shrinkToFit=true disables overflow (font shrinks instead)
 * 4. Overflow stops at: non-empty adjacent cells, merged cell boundaries,
 *    hidden columns, and sheet edges
 * 5. Center-aligned text overflows symmetrically in both directions
 *
 * @module grid-renderer/cells/text-overflow
 */

import type { ViewportMergeIndex } from '../coordinates/viewport-merge-index';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import type { OverflowResult } from './text';

// =============================================================================
// Types
// =============================================================================

export type { OverflowResult } from './text';

/** Overflow direction based on text alignment */
export type OverflowDirection = 'left' | 'right' | 'both' | 'none';

/** Parameters for text overflow calculation */
export interface CalculateTextOverflowParams {
  /** Row index of the cell */
  row: number;
  /** Column index of the cell */
  col: number;
  /** X position of the cell in pixels */
  cellX: number;
  /** Width of the cell in pixels */
  cellWidth: number;
  /** Measured width of the text in pixels */
  textWidth: number;
  /** Horizontal text alignment */
  alignment: 'left' | 'center' | 'right' | 'justify' | undefined;
  /** Whether text wrapping is enabled */
  wrapText: boolean;
  /** Whether shrink-to-fit is enabled */
  shrinkToFit: boolean;
  /** Position index for column widths and hidden state */
  positionIndex: ViewportPositionIndex;
  /** Merge index for merged region queries */
  mergeIndex: ViewportMergeIndex;
  /** Check if a cell at (row, col) is empty (null/empty value or out of viewport) */
  isCellEmpty: (row: number, col: number) => boolean;
  /** Maximum column to scan for overflow */
  maxCol: number;
}

/** Map tracking which cells are clipped (for tooltip display) */
export type ClippedCellMap = Map<string, string>;

// =============================================================================
// Clipped Cell Tracking
// =============================================================================

/**
 * Create a key for the clipped cells map.
 */
export function clippedCellKey(row: number, col: number): string {
  return `${row},${col}`;
}

/**
 * Track a clipped cell in the map (for tooltip display).
 *
 * @param map - Clipped cells map
 * @param row - Cell row
 * @param col - Cell column
 * @param text - Full (unclipped) text
 */
export function trackClippedCell(
  map: ClippedCellMap,
  row: number,
  col: number,
  text: string,
): void {
  map.set(clippedCellKey(row, col), text);
}

/**
 * Get the full text for a clipped cell (for tooltip display).
 *
 * @param map - Clipped cells map
 * @param row - Cell row
 * @param col - Cell column
 * @returns Full text if cell is clipped, undefined otherwise
 */
export function getClippedCellText(
  map: ClippedCellMap,
  row: number,
  col: number,
): string | undefined {
  return map.get(clippedCellKey(row, col));
}

// =============================================================================
// Overflow Direction
// =============================================================================

/**
 * Get overflow direction from horizontal alignment.
 *
 * - left (default for text): overflow RIGHT
 * - right (default for numbers): overflow LEFT
 * - center: overflow BOTH directions symmetrically
 * - justify: NO overflow when wrapText is true; otherwise treats as left
 */
export function getOverflowDirection(
  alignment: 'left' | 'center' | 'right' | 'justify' | undefined,
  wrapText: boolean = false,
): OverflowDirection {
  if (alignment === 'justify' && !wrapText) {
    return 'right'; // Treat as left-aligned
  }

  switch (alignment ?? 'left') {
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    case 'center':
      return 'both';
    case 'justify':
      return 'none'; // Only reached when wrapText is true
    default:
      return 'right';
  }
}

/**
 * Check if a value is text that can overflow.
 * Only strings overflow. Numbers, dates, booleans show ### when too wide.
 */
export function canValueOverflow(value: unknown): boolean {
  return typeof value === 'string';
}

// =============================================================================
// Overflow Calculation
// =============================================================================

/**
 * Calculate text overflow render bounds for a cell.
 *
 * Pure function called inline during render. No external cache needed:
 * ViewportPositionIndex IS the cache.
 *
 * @param params - Overflow calculation parameters
 * @returns OverflowResult with render bounds
 */
export function calculateTextOverflow(params: CalculateTextOverflowParams): OverflowResult {
  const {
    row,
    col,
    cellX,
    cellWidth,
    textWidth,
    alignment,
    wrapText,
    shrinkToFit,
    positionIndex,
    mergeIndex,
    isCellEmpty,
    maxCol,
  } = params;

  const defaultResult: OverflowResult = {
    renderX: cellX,
    renderWidth: cellWidth,
    isClipped: textWidth > cellWidth,
  };

  // No overflow needed if text fits
  if (textWidth <= cellWidth) {
    return { ...defaultResult, isClipped: false };
  }

  // No overflow if wrapText or shrinkToFit enabled
  if (wrapText || shrinkToFit) {
    return defaultResult;
  }

  // No overflow for merged cells
  const mergedRegion = mergeIndex.getMergedRegion(row, col);
  if (mergedRegion) {
    return defaultResult;
  }

  // Determine overflow direction
  const direction = getOverflowDirection(alignment, wrapText);
  if (direction === 'none') {
    return defaultResult;
  }

  let renderX = cellX;
  let renderWidth = cellWidth;

  // Center-aligned overflow extends symmetrically
  if (direction === 'both') {
    return calculateCenterOverflow(params);
  }

  let overflowStartCol: number | undefined;
  let overflowEndCol: number | undefined;

  // Scan right for left-aligned text
  if (direction === 'right') {
    let lastCol = col;
    for (let c = col + 1; c <= maxCol && renderWidth < textWidth; c++) {
      if (positionIndex.isColHidden(c)) continue;
      const colWidth = positionIndex.getColWidth(c);

      if (!isCellEmpty(row, c)) {
        break;
      }
      if (mergeIndex.getMergedRegion(row, c)) {
        break;
      }
      renderWidth += colWidth;
      lastCol = c;
    }
    if (lastCol !== col) {
      overflowStartCol = col;
      overflowEndCol = lastCol;
    }
  }

  // Scan left for right-aligned text
  if (direction === 'left') {
    let firstCol = col;
    for (let c = col - 1; c >= 0 && renderWidth < textWidth; c--) {
      if (positionIndex.isColHidden(c)) continue;
      const colWidth = positionIndex.getColWidth(c);

      if (!isCellEmpty(row, c)) {
        break;
      }
      if (mergeIndex.getMergedRegion(row, c)) {
        break;
      }
      renderX -= colWidth;
      renderWidth += colWidth;
      firstCol = c;
    }
    if (firstCol !== col) {
      overflowStartCol = firstCol;
      overflowEndCol = col;
    }
  }

  return {
    renderX,
    renderWidth,
    isClipped: renderWidth < textWidth,
    ...(overflowStartCol !== undefined && { overflowStartCol, overflowEndCol }),
  };
}

/**
 * Calculate center-aligned overflow that extends symmetrically in both directions.
 */
function calculateCenterOverflow(params: CalculateTextOverflowParams): OverflowResult {
  const { row, col, cellX, cellWidth, textWidth, positionIndex, mergeIndex, isCellEmpty, maxCol } =
    params;

  let renderX = cellX;
  let renderWidth = cellWidth;
  let rightExtension = 0;
  let leftExtension = 0;
  let rightCol = col + 1;
  let leftCol = col - 1;
  let canExtendRight = true;
  let canExtendLeft = true;

  while (renderWidth < textWidth && (canExtendRight || canExtendLeft)) {
    // Extend right (or if left has extended further)
    if (canExtendRight && (rightExtension <= leftExtension || !canExtendLeft)) {
      if (rightCol > maxCol) {
        canExtendRight = false;
      } else {
        if (positionIndex.isColHidden(rightCol)) {
          rightCol++;
          continue;
        }
        const hasContent = !isCellEmpty(row, rightCol);
        const hasMerge = mergeIndex.getMergedRegion(row, rightCol) !== null;

        if (hasContent || hasMerge) {
          canExtendRight = false;
        } else {
          const colWidth = positionIndex.getColWidth(rightCol);
          renderWidth += colWidth;
          rightExtension += colWidth;
          rightCol++;
        }
      }
    }
    // Extend left
    else if (canExtendLeft) {
      if (leftCol < 0) {
        canExtendLeft = false;
      } else {
        if (positionIndex.isColHidden(leftCol)) {
          leftCol--;
          continue;
        }
        const hasContent = !isCellEmpty(row, leftCol);
        const hasMerge = mergeIndex.getMergedRegion(row, leftCol) !== null;

        if (hasContent || hasMerge) {
          canExtendLeft = false;
        } else {
          const colWidth = positionIndex.getColWidth(leftCol);
          renderX -= colWidth;
          renderWidth += colWidth;
          leftExtension += colWidth;
          leftCol--;
        }
      }
    } else {
      break;
    }
  }

  // rightCol and leftCol have been incremented/decremented one past the last scanned column,
  // so the actual last columns reached are rightCol-1 and leftCol+1.
  const actualRightCol = rightCol - 1;
  const actualLeftCol = leftCol + 1;
  const extended = actualLeftCol < col || actualRightCol > col;

  return {
    renderX,
    renderWidth,
    isClipped: renderWidth < textWidth,
    ...(extended && { overflowStartCol: actualLeftCol, overflowEndCol: actualRightCol }),
  };
}
