/**
 * Viewport Module
 *
 * First-class viewport architecture for the spreadsheet renderer.
 * Viewports are the fundamental rendering primitive - everything that shows
 * sheet data is a viewport.
 *
 * @module viewports
 */

// =============================================================================
// Types
// =============================================================================

export type {
  CellCoord,
  CellRange,
  ComputeLayoutInput,
  FreezeRegion,
  FreezeViewportConfig,
  FrozenBoundaries,
  OverlayContent,
  OverlayViewportConfig,
  PersistedViewportConfig,
  Point,
  Rect,
  ScrollBehavior,
  SingleViewportConfig,
  Size,
  SplitViewportConfig,
  Viewport,
  ViewportBuilder,
  ViewportDivider,
  ViewportHitResult,
  ViewportLayout,
  ViewportRenderConfig,
} from './types';

export {
  DEFAULT_VIEWPORT_RENDER_CONFIG,
  createFreezeViewportConfig,
  createSingleViewportConfig,
  createSplitViewportConfig,
  isEffectivelySingleViewport,
} from './types';

export type { ViewportId } from './types';

// =============================================================================
// Scroll Handling
// =============================================================================

export {
  applyScrollBehavior,
  applyScrollToViewports,
  clampScroll,
  computeMaxScroll,
  scrollToCell,
} from './scroll';

// =============================================================================
// Viewport Calculations
// =============================================================================

export {
  calculateViewport,
  getColFromHeaderX,
  getColLeft,
  getResizeHandle,
  getRowFromHeaderY,
  getRowTop,
  isColHeader,
  isRowHeader,
  pixelToCell,
  type DimensionGetter,
  type ResizeHandle,
  type ViewportInfo,
  type VisibleRange,
} from './viewport';

// =============================================================================
// Hit Testing
// =============================================================================

export {
  canvasToCell,
  getCellBoundsInViewport,
  getCellCanvasBounds,
  getViewportAtPoint,
  hitTestLayout,
  type DividerHitResult,
  type EmptyHitResult,
  type LayoutHitResult,
} from './hit-testing';
