/**
 * Visible Cell Iterator
 *
 * Shared iterator that walks visible cells within a region's cell range,
 * handling hidden rows/columns and merged cell deduplication.
 *
 * @module grid-renderer/layout/for-each-visible-cell
 */

import type { DocSpaceRect } from '@mog/canvas-engine';
import type { CellRange } from '@mog-sdk/contracts/core';

import type { ViewportMergeIndex } from '../coordinates/viewport-merge-index';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import type { VisibleCellCallback, VisibleCellInfo } from './types';

/**
 * AABB intersection test between two rectangles specified as (x, y, width, height).
 */
function rectsIntersect(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Check if a rectangle (x, y, w, h) intersects ANY of the provided dirty rects.
 */
function intersectsAnyDirtyRect(
  x: number,
  y: number,
  w: number,
  h: number,
  dirtyRects: readonly DocSpaceRect[],
): boolean {
  for (let i = 0; i < dirtyRects.length; i++) {
    const dr = dirtyRects[i];
    if (rectsIntersect(x, y, w, h, dr.x, dr.y, dr.width, dr.height)) {
      return true;
    }
  }
  return false;
}

/**
 * Iterate over all visible cells within a cell range, calling the callback
 * for each one with position and dimension information.
 *
 * Handles:
 * - Skipping hidden rows (height === 0)
 * - Skipping hidden columns (width === 0)
 * - Merged cell deduplication: only calls the callback once per merged region,
 *   using the merge origin cell. Subsequent cells in the same merge are skipped.
 * - Computes cell positions in document space (unzoomed CSS pixels).
 *
 * Uses ViewportPositionIndex for O(1) position/dimension lookups and
 * ViewportMergeIndex for O(1) merge lookups. No DimensionProvider fallback.
 *
 * @param cellRange - The range of cells to iterate
 * @param positionIndex - Viewport position index for O(1) lookups
 * @param mergeIndex - Viewport merge index for O(1) merge lookups
 * @param callback - Called for each visible (non-hidden, non-duplicate-merge) cell
 * @param dirtyRects - Optional dirty rects in **document space**. When provided, cells
 *   whose pixel bounds do not intersect any dirty rect are skipped (callback not called).
 *   WARNING: These rects MUST be in document space (matching ViewportPositionIndex coords).
 *   Do NOT pass canvas-space rects (e.g. frame.dirtyRects from collectDirtyUnion) — the
 *   coordinate mismatch will cause all cells to be incorrectly culled.
 *   Merged cells outside dirty bounds are still tracked in the visitedMerges set to
 *   prevent duplicate emission from later cells within the same merge.
 */
export function forEachVisibleCell(
  cellRange: CellRange,
  positionIndex: ViewportPositionIndex,
  mergeIndex: ViewportMergeIndex,
  callback: VisibleCellCallback,
  dirtyRects?: readonly DocSpaceRect[],
): void {
  const { startRow, startCol, endRow, endCol } = cellRange;
  const pi = positionIndex;
  const mi = mergeIndex;

  // Track visited merge IDs to avoid emitting the same merge multiple times.
  // Key format: "originRow,originCol"
  const visitedMerges = new Set<string>();

  // Pre-check: if dirtyRects is provided but empty, nothing is dirty — skip all.
  if (dirtyRects !== undefined && dirtyRects.length === 0) {
    return;
  }

  const hasDirtyFilter = dirtyRects !== undefined && dirtyRects.length > 0;

  for (let row = startRow; row <= endRow; row++) {
    // Skip hidden rows
    if (pi.isRowHidden(row)) {
      continue;
    }

    const rowHeight = pi.getRowHeight(row);
    if (rowHeight === 0) {
      continue;
    }

    const rowTop = pi.getRowTop(row);

    for (let col = startCol; col <= endCol; col++) {
      // Skip hidden columns
      if (pi.isColHidden(col)) {
        continue;
      }

      const colWidth = pi.getColWidth(col);
      if (colWidth === 0) {
        continue;
      }

      const colLeft = pi.getColLeft(col);

      // Check for merged cells
      const mergeRegion = mi.getMergedRegion(row, col);

      if (mergeRegion) {
        const mergeKey = `${mergeRegion.startRow},${mergeRegion.startCol}`;

        // Already emitted this merge — skip
        if (visitedMerges.has(mergeKey)) {
          continue;
        }
        visitedMerges.add(mergeKey);

        // Compute the full merge bounds in document space
        const mergeX = pi.getColLeft(mergeRegion.startCol);
        const mergeY = pi.getRowTop(mergeRegion.startRow);

        let mergeWidth = 0;
        for (let c = mergeRegion.startCol; c <= mergeRegion.endCol; c++) {
          if (!pi.isColHidden(c)) {
            mergeWidth += pi.getColWidth(c);
          }
        }

        let mergeHeight = 0;
        for (let r = mergeRegion.startRow; r <= mergeRegion.endRow; r++) {
          if (!pi.isRowHidden(r)) {
            mergeHeight += pi.getRowHeight(r);
          }
        }

        // Dirty rect filter: use full merge bounds for intersection check.
        // Skip callback if merge is entirely outside all dirty rects.
        if (
          hasDirtyFilter &&
          !intersectsAnyDirtyRect(mergeX, mergeY, mergeWidth, mergeHeight, dirtyRects!)
        ) {
          continue;
        }

        const cellInfo: VisibleCellInfo = {
          row,
          col,
          x: colLeft,
          y: rowTop,
          width: colWidth,
          height: rowHeight,
          merge: {
            originRow: mergeRegion.startRow,
            originCol: mergeRegion.startCol,
            mergeWidth,
            mergeHeight,
            mergeX,
            mergeY,
          },
        };

        callback(cellInfo);
      } else {
        // Dirty rect filter: use individual cell bounds for intersection check.
        if (
          hasDirtyFilter &&
          !intersectsAnyDirtyRect(colLeft, rowTop, colWidth, rowHeight, dirtyRects!)
        ) {
          continue;
        }

        // Regular (non-merged) cell
        const cellInfo: VisibleCellInfo = {
          row,
          col,
          x: colLeft,
          y: rowTop,
          width: colWidth,
          height: rowHeight,
        };

        callback(cellInfo);
      }
    }
  }
}
