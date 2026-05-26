/**
 * Viewport Types - Internal Module
 *
 * Re-exports contract types and defines internal types used by the viewport system.
 *
 * @module canvas/viewports/types
 */

// Import types used by local interfaces below
import type { Point, Rect, ScrollBehavior, Size } from '@mog-sdk/contracts/viewport';

import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import type {
  OverlayViewportConfig,
  PersistedViewportConfig,
} from '@mog-sdk/contracts/viewport-config';

// Re-export contract types
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

// Re-export internal cross-module types
export type { CellCoord } from '@mog-sdk/contracts/rendering';

export { DEFAULT_VIEWPORT_RENDER_CONFIG } from '@mog-sdk/contracts/viewport';

export {
  createFreezeViewportConfig,
  createSingleViewportConfig,
  createSplitViewportConfig,
  isEffectivelySingleViewport,
} from '@mog/spreadsheet-utils/viewport/viewport-config';

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Viewport ID type for per-viewport scroll tracking.
 * Standard viewport IDs:
 * - 'main': Primary scrollable viewport (used in single, freeze, and split configs)
 * - 'frozen-corner', 'frozen-rows', 'frozen-cols': Freeze pane viewports
 * - 'top', 'bottom': Horizontal split viewports
 * - 'left', 'right': Vertical split viewports
 * - 'topLeft', 'topRight', 'bottomLeft', 'bottomRight': Four-way split viewports
 */
export type ViewportId = string;

/**
 * Input parameters for computing viewport layout.
 */
export interface ComputeLayoutInput {
  /** The persisted viewport configuration (freeze, split, etc.) */
  config: PersistedViewportConfig;
  /** Container size in CSS pixels */
  containerSize: Size;
  /** Viewport position index for row/column sizes */
  positionIndex: ViewportPositionIndex;
  /**
   * Current scroll position (CSS pixels).
   * For single/freeze configs, this is used for all viewports.
   * For split configs with per-viewport scroll, use scrollPositions instead.
   */
  scrollPosition: Point;
  /**
   * Per-viewport scroll positions for split view.
   * Keys are viewport IDs ('main', 'top', 'bottom', 'left', 'right', etc.).
   * If not provided, scrollPosition is used for all viewports.
   * This enables independent scrolling in split view.
   */
  scrollPositions?: Map<ViewportId, Point>;
  /** Session-local overlay viewports */
  overlays: OverlayViewportConfig[];
  /** Zoom level (default: 1.0) */
  zoom?: number;
  /** Active sheet ID */
  sheetId?: string;
  /** Gutter dimensions for outline grouping (optional, defaults to 0) */
  gutterDimensions?: { rowGutterWidth: number; colGutterHeight: number };
  /**
   * Header visibility flags (optional, defaults to both visible).
   * Derived from SheetMeta.showRowHeaders/showColumnHeaders.
   */
  headerVisibility?: {
    showRowHeaders: boolean;
    showColumnHeaders: boolean;
  };
}

/**
 * Frozen pane pixel boundaries (computed from freeze config).
 */
export interface FrozenBoundaries {
  /** Total height of frozen rows in pixels */
  frozenRowsHeight: number;
  /** Total width of frozen columns in pixels */
  frozenColsWidth: number;
}

/**
 * Viewport region identifier for freeze pane layouts.
 */
export type FreezeRegion = 'corner' | 'frozenRows' | 'frozenCols' | 'main';

/**
 * Intermediate viewport data before final Viewport construction.
 */
export interface ViewportBuilder {
  id: string;
  region: FreezeRegion | 'overlay';
  bounds: Rect;
  startRow: number;
  startCol: number;
  scrollBehavior: ScrollBehavior;
  sheetId?: string;
}
