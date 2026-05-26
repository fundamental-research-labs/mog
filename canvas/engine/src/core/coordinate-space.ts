/**
 * Coordinate-Space Conversion Functions
 *
 * The single canonical implementation of the doc⇄canvas transform.
 *
 *     canvas = bounds + (doc − viewportOrigin − scrollOffset) · zoom
 *     doc    = (canvas − bounds) / zoom + viewportOrigin + scrollOffset
 *
 * All coordinate conversions between doc-space, canvas-space, region-local,
 * and physical pixels MUST go through these functions. No inline transform
 * math (e.g., `region.bounds.x + (r.x - scrollOffset.x) * zoom`) should
 * exist elsewhere in the codebase. Helpers compose these functions; they
 * never re-implement the formula.
 *
 * Two callable shapes, one formula:
 * - `docToCanvas` / `canvasToDoc`     — branded-rect form, used where a
 *                                        rect is already in hand.
 * - `docToCanvasXY` / `canvasToDocXY` — scalar form for hot paths
 *                                        (per-cell loops avoid allocating
 *                                        a branded rect every iteration).
 *
 * @module @mog/canvas-engine
 */

import {
  regionLocalRect,
  type CanvasSpaceRect,
  type DocSpaceRect,
  type PhysicalRect,
  type RegionLocalRect,
} from './types';

/**
 * Region info needed for coordinate conversions.
 * Matches the shape of RenderRegion from types.ts without importing it directly.
 *
 * `viewportOrigin` is required: every region produces it (frozen panes,
 * main, single-pane all set it explicitly), and the canonical formula
 * is undefined without it.
 */
interface RegionTransform {
  readonly bounds: { readonly x: number; readonly y: number };
  readonly viewportOrigin: { readonly x: number; readonly y: number };
  readonly scrollOffset: { readonly x: number; readonly y: number };
  readonly zoom: number;
}

interface RegionTransformWithSize extends RegionTransform {
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/**
 * Convert document-space rect to canvas-space (CSS pixels on visible canvas).
 * Delegates to `docToCanvasXY` so the formula appears exactly once.
 */
export function docToCanvas(rect: DocSpaceRect, region: RegionTransform): CanvasSpaceRect {
  const { x, y } = docToCanvasXY(rect.x, rect.y, region);
  return {
    x,
    y,
    width: rect.width * region.zoom,
    height: rect.height * region.zoom,
  } as CanvasSpaceRect;
}

/**
 * Convert canvas-space rect back to document-space.
 * Delegates to `canvasToDocXY` so the formula appears exactly once.
 */
export function canvasToDoc(rect: CanvasSpaceRect, region: RegionTransform): DocSpaceRect {
  const { x, y } = canvasToDocXY(rect.x, rect.y, region);
  return {
    x,
    y,
    width: rect.width / region.zoom,
    height: rect.height / region.zoom,
  } as DocSpaceRect;
}

/**
 * Scalar form of `docToCanvas`. Use in hot paths (per-cell loops) where
 * allocating a branded rect each iteration is unacceptable. Returns a
 * fresh small object; the rect form composes this internally.
 */
export function docToCanvasXY(
  docX: number,
  docY: number,
  region: RegionTransform,
): { x: number; y: number } {
  return {
    x: region.bounds.x + (docX - region.viewportOrigin.x - region.scrollOffset.x) * region.zoom,
    y: region.bounds.y + (docY - region.viewportOrigin.y - region.scrollOffset.y) * region.zoom,
  };
}

/**
 * Scalar form of `canvasToDoc`. Inverse of `docToCanvasXY`.
 */
export function canvasToDocXY(
  canvasX: number,
  canvasY: number,
  region: RegionTransform,
): { x: number; y: number } {
  return {
    x: (canvasX - region.bounds.x) / region.zoom + region.viewportOrigin.x + region.scrollOffset.x,
    y: (canvasY - region.bounds.y) / region.zoom + region.viewportOrigin.y + region.scrollOffset.y,
  };
}

/** Convert canvas-space rect to region-local space (after translate to region origin) */
export function canvasToLocal(rect: CanvasSpaceRect, region: RegionTransform): RegionLocalRect {
  return {
    x: rect.x - region.bounds.x,
    y: rect.y - region.bounds.y,
    width: rect.width,
    height: rect.height,
  } as RegionLocalRect;
}

/**
 * Return the full visible region in region-local UNZOOMED coordinates.
 *
 * `RenderRegion.bounds` is canvas-space CSS pixels. Per-region layer contexts
 * are translated to `bounds` and then scaled by `region.zoom` before render,
 * so canvas-space extents must be divided by zoom before a layer uses them as
 * local drawing or culling bounds.
 */
export function regionLocalVisibleRect(region: RegionTransformWithSize): RegionLocalRect {
  const zoom = region.zoom || 1;
  return regionLocalRect(0, 0, region.bounds.width / zoom, region.bounds.height / zoom);
}

/** Convert canvas-space CSS pixels to physical device pixels */
export function canvasToPhysical(rect: CanvasSpaceRect, dpr: number): PhysicalRect {
  return {
    x: Math.floor(rect.x * dpr),
    y: Math.floor(rect.y * dpr),
    width: Math.ceil((rect.x + rect.width) * dpr) - Math.floor(rect.x * dpr),
    height: Math.ceil((rect.y + rect.height) * dpr) - Math.floor(rect.y * dpr),
  } as PhysicalRect;
}
