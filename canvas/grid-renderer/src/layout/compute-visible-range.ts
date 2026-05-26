/**
 * Compute Visible Range
 *
 * Pure functions to compute which cells are visible in a viewport region.
 * Properly excludes hidden rows/columns to optimize rendering.
 * Ported from grid-canvas/src/viewports/compute-visible-range.ts.
 *
 * @module grid-renderer/layout/compute-visible-range
 */

import type { CellRange } from '@mog-sdk/contracts/core';

import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';

/**
 * Compute the visible cell range for a viewport region.
 *
 * The search is rooted at `docOrigin` — the doc-space anchor at the top-left
 * of this region's visible content. For each pane, the caller passes
 * `viewportOrigin + scrollOffset`. The frozen-pane floor is implicit in
 * `docOrigin` — there is no need for a separate startRow/startCol floor;
 * the search rooted at docOrigin produces it naturally.
 *
 * Hidden rows/columns are skipped in the range calculation to avoid wasting
 * rendering. Uses ViewportPositionIndex for O(1) binary search to find the
 * first/last visible row/col, with linear scan fallback when position data
 * is not available.
 *
 * @param regionSize - The viewport region size in CSS pixels
 * @param docOrigin - Doc-space anchor at the top-left of this region's visible content
 *                    (per pane: viewportOrigin + scrollOffset)
 * @param positionIndex - Viewport position index for O(1) lookups
 * @param zoom - Zoom level (default: 1.0)
 * @returns The range of cells visible in this region
 */
export function computeVisibleRange(
  regionSize: { width: number; height: number },
  docOrigin: { x: number; y: number },
  positionIndex: ViewportPositionIndex,
  zoom: number = 1.0,
): CellRange {
  const pi = positionIndex;
  const totalRows = pi.totalRows;
  const totalCols = pi.totalCols;

  const isRowHidden = (row: number) => pi.isRowHidden(row);
  const isColHidden = (col: number) => pi.isColHidden(col);

  const getRowHeight = (row: number): number => pi.getRowHeight(row);
  const getColWidth = (col: number): number => pi.getColWidth(col);

  // Unzoom the region bounds to get cell-space dimensions
  const cellSpaceWidth = regionSize.width / zoom;
  const cellSpaceHeight = regionSize.height / zoom;

  if (cellSpaceWidth <= 0 || cellSpaceHeight <= 0) {
    return { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
  }

  // --- Rows ---
  let firstRow = 0;
  let lastRow: number;

  // Try using position index binary search for fast first-row lookup
  if (pi.hasData && docOrigin.y > 0) {
    const foundRow = pi.findRowAtY(docOrigin.y);
    if (foundRow !== null) {
      firstRow = foundRow;
    } else {
      // Fall back to linear scan
      firstRow = scanFirstRow(totalRows, docOrigin.y, isRowHidden, getRowHeight);
    }
  } else if (docOrigin.y > 0) {
    firstRow = scanFirstRow(totalRows, docOrigin.y, isRowHidden, getRowHeight);
  }

  // Advance past hidden rows at the start (covers all paths above —
  // binary-search hit, scan fallback, and the docOrigin.y === 0 case).
  while (firstRow < totalRows && isRowHidden(firstRow)) {
    firstRow++;
  }

  // Find last visible row using position index binary search if available.
  //
  // The visible y-window is the half-open interval [docOrigin.y, endY) where
  //     endY = docOrigin.y + cellSpaceHeight.
  // (Anchoring endY at docOrigin.y — not at firstRow.top — matters: when
  // firstRow straddles docOrigin, firstRow.top is below docOrigin.y, so
  // firstRow.top + cellSpaceHeight underestimates the bottom edge by the
  // mid-row scroll amount. Previously the `+1 for partial visibility`
  // hack compensated for that under-shoot — but it over-included by one row
  // in the boundary case.)
  //
  // findRowAtY uses [top, nextTop) half-open intervals, so findRowAtY(endY)
  // returns the row containing endY. Two cases:
  //   - row.top < endY: partially visible at the bottom edge → include.
  //   - row.top >= endY: row starts at the exclusive bound → exclude.
  if (pi.hasData) {
    const endY = docOrigin.y + cellSpaceHeight;
    const foundLast = pi.findRowAtY(endY);
    if (foundLast !== null) {
      const foundLastTop = pi.getRowTop(foundLast);
      lastRow =
        foundLastTop >= endY
          ? Math.max(firstRow, foundLast - 1)
          : Math.min(foundLast, totalRows - 1);
    } else {
      // Out of range, scan from firstRow
      lastRow = scanLastRow(firstRow, totalRows, cellSpaceHeight, isRowHidden, getRowHeight);
    }
  } else {
    lastRow = scanLastRow(firstRow, totalRows, cellSpaceHeight, isRowHidden, getRowHeight);
  }

  // --- Columns ---
  let firstCol = 0;
  let lastCol: number;

  // Try using position index binary search for fast first-col lookup
  if (pi.hasData && docOrigin.x > 0) {
    const foundCol = pi.findColAtX(docOrigin.x);
    if (foundCol !== null) {
      firstCol = foundCol;
    } else {
      firstCol = scanFirstCol(totalCols, docOrigin.x, isColHidden, getColWidth);
    }
  } else if (docOrigin.x > 0) {
    firstCol = scanFirstCol(totalCols, docOrigin.x, isColHidden, getColWidth);
  }

  // Advance past hidden columns at the start (covers all paths above).
  while (firstCol < totalCols && isColHidden(firstCol)) {
    firstCol++;
  }

  // Find last visible column. See the row branch above for the full rationale —
  // anchor endX at docOrigin.x and decrement when a column starts exactly at
  // the exclusive upper bound.
  if (pi.hasData) {
    const endX = docOrigin.x + cellSpaceWidth;
    const foundLast = pi.findColAtX(endX);
    if (foundLast !== null) {
      const foundLastLeft = pi.getColLeft(foundLast);
      lastCol =
        foundLastLeft >= endX
          ? Math.max(firstCol, foundLast - 1)
          : Math.min(foundLast, totalCols - 1);
    } else {
      lastCol = scanLastCol(firstCol, totalCols, cellSpaceWidth, isColHidden, getColWidth);
    }
  } else {
    lastCol = scanLastCol(firstCol, totalCols, cellSpaceWidth, isColHidden, getColWidth);
  }

  return {
    startRow: firstRow,
    startCol: firstCol,
    endRow: lastRow,
    endCol: lastCol,
  };
}

// ─────────────────────────────────────────────────────────────
// Linear scan helpers (fallback when position index has no data)
// ─────────────────────────────────────────────────────────────

function scanFirstRow(
  totalRows: number,
  targetY: number,
  isRowHidden: (row: number) => boolean,
  getRowHeight: (row: number) => number,
): number {
  let firstRow = 0;
  let skipHeight = 0;
  while (firstRow < totalRows && skipHeight < targetY) {
    if (isRowHidden(firstRow)) {
      firstRow++;
      continue;
    }
    const rowHeight = getRowHeight(firstRow);
    if (skipHeight + rowHeight > targetY) {
      break;
    }
    skipHeight += rowHeight;
    firstRow++;
  }
  return firstRow;
}

function scanLastRow(
  firstRow: number,
  totalRows: number,
  cellSpaceHeight: number,
  isRowHidden: (row: number) => boolean,
  getRowHeight: (row: number) => number,
): number {
  let lastRow = firstRow;
  let accumulatedHeight = 0;
  while (lastRow < totalRows && accumulatedHeight < cellSpaceHeight) {
    if (isRowHidden(lastRow)) {
      lastRow++;
      continue;
    }
    accumulatedHeight += getRowHeight(lastRow);
    lastRow++;
  }
  // Include one more visible row for partial visibility at the edge
  while (lastRow < totalRows) {
    if (!isRowHidden(lastRow)) {
      lastRow++;
      break;
    }
    lastRow++;
  }
  return Math.min(Math.max(lastRow - 1, firstRow), totalRows - 1);
}

function scanFirstCol(
  totalCols: number,
  targetX: number,
  isColHidden: (col: number) => boolean,
  getColWidth: (col: number) => number,
): number {
  let firstCol = 0;
  let skipWidth = 0;
  while (firstCol < totalCols && skipWidth < targetX) {
    if (isColHidden(firstCol)) {
      firstCol++;
      continue;
    }
    const colWidth = getColWidth(firstCol);
    if (skipWidth + colWidth > targetX) {
      break;
    }
    skipWidth += colWidth;
    firstCol++;
  }
  return firstCol;
}

function scanLastCol(
  firstCol: number,
  totalCols: number,
  cellSpaceWidth: number,
  isColHidden: (col: number) => boolean,
  getColWidth: (col: number) => number,
): number {
  let lastCol = firstCol;
  let accumulatedWidth = 0;
  while (lastCol < totalCols && accumulatedWidth < cellSpaceWidth) {
    if (isColHidden(lastCol)) {
      lastCol++;
      continue;
    }
    accumulatedWidth += getColWidth(lastCol);
    lastCol++;
  }
  // Include one more visible column for partial visibility at the edge
  while (lastCol < totalCols) {
    if (!isColHidden(lastCol)) {
      lastCol++;
      break;
    }
    lastCol++;
  }
  return Math.min(Math.max(lastCol - 1, firstCol), totalCols - 1);
}

/**
 * Compute the visible cell range for a frozen region (no scroll offset).
 *
 * @param endRow - Last row index in the frozen region
 * @param endCol - Last column index in the frozen region
 * @param startRow - First row index (default: 0)
 * @param startCol - First column index (default: 0)
 * @returns The range of cells in this frozen region
 */
export function computeFrozenRange(
  endRow: number,
  endCol: number,
  startRow: number = 0,
  startCol: number = 0,
): CellRange {
  return {
    startRow,
    startCol,
    endRow: Math.max(startRow, endRow),
    endCol: Math.max(startCol, endCol),
  };
}
