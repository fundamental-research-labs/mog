/**
 * Region placement boundary for canvas-backed DOM interactions.
 *
 * Cell discovery emits unzoomed region-local elements, matching the coordinate
 * system used by per-region canvas layers. This module is the only bridge from
 * that internal representation to the public renderer-container coordinates
 * consumed by DOM overlays.
 */

import {
  canvasSpaceRect,
  regionLocalToCanvas,
  type CanvasSpaceRect,
  type Rect,
  type RenderRegion,
} from '@mog/canvas-engine';
import type { InteractiveElement, InteractiveElementCollector } from '@mog-sdk/contracts/rendering';

import type {
  RegionLocalInteractiveElement,
  RegionLocalInteractiveElementCollector,
} from './interactive-elements';

function intersectCanvasBounds(a: CanvasSpaceRect, b: Rect): CanvasSpaceRect | null {
  if (
    a.x >= b.x &&
    a.y >= b.y &&
    a.x + a.width <= b.x + b.width &&
    a.y + a.height <= b.y + b.height
  ) {
    return a;
  }

  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  if (right <= left || bottom <= top) return null;
  return canvasSpaceRect(left, top, right - left, bottom - top);
}

/**
 * Place and clip one region-local element in renderer-container coordinates.
 *
 * The region suffix makes each visible pane occurrence a distinct DOM element;
 * split panes may legitimately show the same logical cell more than once.
 */
export function placeInteractiveElementInRegion(
  element: RegionLocalInteractiveElement,
  region: RenderRegion,
): InteractiveElement | null {
  const containerBounds = regionLocalToCanvas(element.localBounds, region);
  const clippedBounds = intersectCanvasBounds(containerBounds, region.bounds);
  if (!clippedBounds) return null;

  return {
    id: `${element.id}@${region.id}`,
    type: element.type,
    bounds: clippedBounds,
    metadata: element.metadata,
  };
}

/**
 * Adapt the frame-scoped public collector to one render region.
 *
 * Construct once per region render and pass it to every cell-discovery path.
 * Public collectors therefore never observe region-local coordinates.
 */
export function createRegionInteractiveElementCollector(
  target: InteractiveElementCollector,
  region: RenderRegion,
): RegionLocalInteractiveElementCollector {
  return {
    addRegionLocal(element) {
      const placed = placeInteractiveElementInRegion(element, region);
      if (placed) target.add(placed);
    },
  };
}
