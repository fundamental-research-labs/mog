/**
 * Grid Region Types
 *
 * Spreadsheet-specific metadata for canvas-engine's generic RenderRegion<TMeta>.
 * These types are the TMeta that grid-renderer uses when creating render regions
 * from freeze pane configuration.
 *
 * @module @mog-sdk/contracts/rendering/grid-region
 */

import type { CellRange } from '@mog/types-core';

/**
 * Metadata for a grid render region.
 * This is the TMeta used by grid-renderer with RenderRegion<GridRegionMeta>.
 */
export interface GridRegionMeta {
  /** Sheet ID this region renders */
  readonly sheetId: string;
  /** Cell range visible in this region */
  readonly cellRange: CellRange;
  /** Whether this region contains frozen cells */
  readonly isFrozen: boolean;
  /** How this region scrolls */
  readonly scrollBehavior: 'free' | 'row-anchored' | 'col-anchored' | 'none';
  /**
   * Viewport ID for per-viewport buffer resolution.
   * Maps to a viewport region: 'main', 'frozen-corner', 'frozen-rows', 'frozen-cols'.
   * When set, the cells layer reads from the viewport-specific binary buffer
   * instead of the shared global buffer.
   */
  readonly viewportId?: string;
}
