/**
 * Grid Layout Types
 *
 * Types for viewport layout computation and grid coordinate system.
 */

import type { RenderRegion } from '@mog/canvas-engine';
import type { GridRegionMeta } from '@mog-sdk/contracts/rendering';

/** A render region with grid-specific metadata */
export type GridRenderRegion = RenderRegion<GridRegionMeta>;

/** Callback for the visible cell iterator */
export interface VisibleCellInfo {
  readonly row: number;
  readonly col: number;
  /** Cell position in document space (CSS pixels, unzoomed) */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** If this cell is part of a merge, contains the merge origin and full bounds */
  readonly merge?: {
    readonly originRow: number;
    readonly originCol: number;
    readonly mergeWidth: number;
    readonly mergeHeight: number;
    readonly mergeX: number;
    readonly mergeY: number;
  };
}

export type VisibleCellCallback = (cell: VisibleCellInfo) => void;
