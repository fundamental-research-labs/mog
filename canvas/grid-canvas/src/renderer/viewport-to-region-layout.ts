/**
 * Viewport → Region Layout Mapper
 *
 * The single boundary between two type families:
 * - `Viewport` / `ViewportLayout`         (spreadsheet domain types — drive
 *                                          hit-testing, scroll, app-eval)
 * - `RenderRegion` / `RegionLayout`       (canvas-engine generic types —
 *                                          drive the render loop)
 *
 * **CANONICAL LAYOUT PIPELINE:**
 *
 *     inputs → computeViewportLayout → ViewportLayout
 *                                          │
 *                                          └→ viewportLayoutToRegionLayout (this module)
 *                                                  │
 *                                                  └→ RegionLayout<GridRegionMeta> → engine.setLayout
 *
 * `Viewport` strictly subsumes `RenderRegion`: every `RenderRegion` field is
 * a structural projection of `Viewport` fields, no independent information
 * exists. Therefore this mapper is mechanical — destructure, populate,
 * no math, no domain logic. The previous architecture had three parallel
 * implementations of "build freeze layout"; this mapper plus
 * `computeViewportLayout` replaces all three.
 *
 * Inline `RenderRegion[]` literal construction outside this module, the
 * engine's `createFullCanvasRegion` synthetic, and test fixtures is a
 * lint error.
 *
 * @module canvas/grid-canvas/renderer/viewport-to-region-layout
 */

import type { RegionLayout, RenderRegion } from '@mog/canvas-engine';
import type { GridRegionMeta } from '@mog-sdk/contracts/rendering';

import type { ViewportLayout } from '../viewports/types';

/**
 * Project a `ViewportLayout` into a `RegionLayout<GridRegionMeta>`.
 *
 * This is the only function in the codebase that constructs production
 * `RenderRegion<GridRegionMeta>` values. It threads `viewportOrigin`
 * verbatim from each `Viewport` into the corresponding `RenderRegion`,
 * making "forgot to thread `viewportOrigin`" a compile error.
 *
 * @param layout - The viewport layout produced by `computeViewportLayout`
 * @param fallbackSheetId - Sheet id used when a viewport doesn't carry one
 *                          (overlay viewports always carry their own)
 */
export function viewportLayoutToRegionLayout(
  layout: ViewportLayout,
  fallbackSheetId: string,
): RegionLayout<GridRegionMeta> {
  const regions: RenderRegion<GridRegionMeta>[] = layout.viewports.map((vp) => ({
    id: vp.id,
    bounds: vp.bounds,
    viewportOrigin: vp.viewportOrigin,
    scrollOffset: vp.scrollOffset,
    zoom: vp.zoom,
    metadata: {
      sheetId: vp.sheetId ?? fallbackSheetId,
      cellRange: vp.cellRange,
      isFrozen: vp.scrollBehavior.type !== 'free',
      scrollBehavior:
        vp.scrollBehavior.type === 'free'
          ? 'free'
          : vp.scrollBehavior.type === 'horizontal-only'
            ? 'row-anchored'
            : vp.scrollBehavior.type === 'vertical-only'
              ? 'col-anchored'
              : 'none',
      viewportId: vp.id,
    },
  }));

  return {
    regions,
    contentSize: layout.contentSize,
    maxScroll: layout.maxScroll,
  };
}
