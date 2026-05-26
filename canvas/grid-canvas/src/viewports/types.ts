/**
 * Viewport Types - Re-export shim
 *
 * This file re-exports viewport types from @mog/grid-renderer
 * where the canonical definitions now live. It exists to support
 * compute-layout.ts which remains in this package.
 *
 * @module canvas/viewports/types
 */

// Re-export everything from the contracts (same sources as before the move)
export type { CellRange } from '@mog-sdk/contracts/core';
export type {
  HeaderRenderInfo,
  Point,
  Rect,
  ScrollBehavior,
  Size,
  Viewport,
  ViewportDivider,
  ViewportHitResult,
  ViewportLayout,
  ViewportRenderConfig,
} from '@mog-sdk/contracts/viewport';
export type {
  FreezeViewportConfig,
  OverlayContent,
  OverlayViewportConfig,
  PersistedViewportConfig,
  SingleViewportConfig,
  SplitViewportConfig,
} from '@mog-sdk/contracts/viewport-config';

export type { CellCoord } from '@mog-sdk/contracts/rendering';

export { DEFAULT_VIEWPORT_RENDER_CONFIG } from '@mog-sdk/contracts/viewport';

export {
  createFreezeViewportConfig,
  createSingleViewportConfig,
  createSplitViewportConfig,
  isEffectivelySingleViewport,
} from '@mog/spreadsheet-utils/viewport/viewport-config';

// Local type definitions (kept here for compute-layout.ts)
import type { ViewportPositionIndex } from '@mog/grid-renderer';
import type { Point, ScrollBehavior, Size } from '@mog-sdk/contracts/viewport';
import type {
  OverlayViewportConfig,
  PersistedViewportConfig,
} from '@mog-sdk/contracts/viewport-config';

export type ViewportId = string;

export interface ComputeLayoutInput {
  config: PersistedViewportConfig;
  containerSize: Size;
  positionIndex: ViewportPositionIndex;
  scrollPosition: Point;
  scrollPositions?: Map<ViewportId, Point>;
  overlays: OverlayViewportConfig[];
  zoom?: number;
  gutterDimensions?: { rowGutterWidth: number; colGutterHeight: number };
  headerVisibility?: {
    showRowHeaders: boolean;
    showColumnHeaders: boolean;
  };
}

export interface FrozenBoundaries {
  frozenRowsHeight: number;
  frozenColsWidth: number;
}

export type FreezeRegion = 'corner' | 'frozenRows' | 'frozenCols' | 'main';

export interface ViewportBuilder {
  id: string;
  region: FreezeRegion | 'overlay';
  bounds: { x: number; y: number; width: number; height: number };
  startRow: number;
  startCol: number;
  scrollBehavior: ScrollBehavior;
  sheetId?: string;
}
