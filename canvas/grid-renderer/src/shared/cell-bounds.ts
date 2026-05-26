/**
 * Shared cell bounds helpers.
 *
 * The single sanctioned site (alongside the canvas-engine canonical
 * functions and the viewport-to-region-layout mapper) where renderer-side
 * code reads `region.viewportOrigin`/`region.scrollOffset`. Every other
 * renderer file goes through these helpers, which compose
 * `docToCanvas` / `docToCanvasXY`. This is enforced by the coordinate-boundary
 * ESLint rule.
 *
 * Per-region layers draw in **region-local UNZOOMED coordinates** because
 * the engine pre-applies `ctx.translate(bounds)` and `ctx.scale(zoom)`
 * before the layer's `render()` runs. The helpers below produce that
 * coordinate system; they compose `docToCanvasXY` for the canonical
 * formula and then unfold the engine's translate+scale.
 *
 * @module grid-renderer/shared/cell-bounds
 */

import { docToCanvasXY, snapToPixelGrid, type RenderRegion } from '@mog/canvas-engine';
import type { ViewportPositionIndexLike } from '@mog-sdk/contracts/rendering';

import type { CellRenderInfo } from '../cells/types';

/**
 * Returns the effective bounding rect for a cell, accounting for merged
 * cells. Operates on a precomputed `CellRenderInfo` (already in
 * region-local coords); kept for backward-compatibility with the cells
 * Pass-1 pipeline.
 */
export function getCellBounds(cellInfo: CellRenderInfo): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (cellInfo.merge) {
    return {
      x: cellInfo.merge.mergeX,
      y: cellInfo.merge.mergeY,
      width: cellInfo.merge.mergeWidth,
      height: cellInfo.merge.mergeHeight,
    };
  }
  return {
    x: cellInfo.x,
    y: cellInfo.y,
    width: cellInfo.width,
    height: cellInfo.height,
  };
}

/**
 * A bounding rect in region-local UNZOOMED coordinates (the system per-region
 * layers paint in).
 */
export interface RegionLocalCellRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Convert a doc-space (x, y) to region-local UNZOOMED coordinates by
 * composing `docToCanvasXY` and unfolding the engine's pre-applied
 * `translate(bounds) + scale(zoom)`. Use this in any per-region layer.
 *
 * Mathematically equivalent to `docX - viewportOrigin.x - scrollOffset.x`,
 * but composes the canonical helper so the formula lives in exactly one
 * place (canvas-engine/coordinate-space.ts).
 */
export function docToRegionXY(
  docX: number,
  docY: number,
  region: RenderRegion,
): { x: number; y: number } {
  const { x: cx, y: cy } = docToCanvasXY(docX, docY, region);
  const zoom = region.zoom || 1;
  return {
    x: (cx - region.bounds.x) / zoom,
    y: (cy - region.bounds.y) / zoom,
  };
}

/**
 * Bounding rect of a single cell in region-local UNZOOMED coordinates.
 *
 * Use in per-region layers (e.g., headers, page-breaks, validation-circles,
 * remote-cursors, trace-arrows). For per-cell hot paths in cells.ts, prefer
 * `docToRegionXY` directly to avoid allocating a rect object per cell.
 */
export function cellRectInRegion(
  region: RenderRegion,
  row: number,
  col: number,
  positionIndex: ViewportPositionIndexLike,
): RegionLocalCellRect {
  const docX = positionIndex.getColLeft(col);
  const docY = positionIndex.getRowTop(row);
  const { x, y } = docToRegionXY(docX, docY, region);
  return {
    x,
    y,
    width: positionIndex.getColWidth(col),
    height: positionIndex.getRowHeight(row),
  };
}

/**
 * Bounding rect spanning a range of cells in region-local UNZOOMED coordinates.
 * `endRow`/`endCol` are inclusive.
 */
export function rangeRectInRegion(
  region: RenderRegion,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  positionIndex: ViewportPositionIndexLike,
): RegionLocalCellRect {
  const top = cellRectInRegion(region, startRow, startCol, positionIndex);
  const docXEnd = positionIndex.getColLeft(endCol) + positionIndex.getColWidth(endCol);
  const docYEnd = positionIndex.getRowTop(endRow) + positionIndex.getRowHeight(endRow);
  const { x: xEnd, y: yEnd } = docToRegionXY(docXEnd, docYEnd, region);
  return {
    x: top.x,
    y: top.y,
    width: xEnd - top.x,
    height: yEnd - top.y,
  };
}

/**
 * Pixel-snap a doc-space X coordinate within a region. Composes `docToRegionXY`
 * (which composes `docToCanvasXY`) to obtain region-local unzoomed X, then
 * snaps to the device-pixel grid using the canvas-engine's `snapToPixelGrid`.
 */
export function snapDocXToPixelGrid(region: RenderRegion, docX: number, dpr: number): number {
  return snapToPixelGrid(docToRegionXY(docX, 0, region).x, dpr);
}

/**
 * Pixel-snap a doc-space Y coordinate within a region. Composes `docToRegionXY`
 * (which composes `docToCanvasXY`) to obtain region-local unzoomed Y, then
 * snaps to the device-pixel grid using the canvas-engine's `snapToPixelGrid`.
 */
export function snapDocYToPixelGrid(region: RenderRegion, docY: number, dpr: number): number {
  return snapToPixelGrid(docToRegionXY(0, docY, region).y, dpr);
}
