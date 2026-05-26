/**
 * Viewport Module
 *
 * Re-exports viewport utilities from @mog/grid-renderer (where the
 * canonical implementations now live) and exports the local compute-layout
 * module which remains in this package.
 *
 * @module canvas/viewports
 */

// =============================================================================
// Types (re-exported from local shim which sources from contracts)
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
  isEffectivelySingleViewport,
} from './types';

// =============================================================================
// Local: Layout Computation (stays in grid-canvas)
// =============================================================================

export { computeViewportLayout } from './compute-layout';

// =============================================================================
// Re-exported from @mog/grid-renderer
// =============================================================================

// Visible range computation
export { computeFrozenRange, computeVisibleRange } from '@mog/grid-renderer';

// Scroll handling (canonical source: @mog/grid-renderer)
export {
  applyScrollBehavior,
  applyScrollToViewports,
  clampScroll,
  computeMaxScroll,
  scrollToCell,
} from './scroll';

// Viewport calculations for virtual scrolling
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
} from '@mog/grid-renderer';

// Hit testing
export {
  canvasToCell,
  getCellBoundsInViewport,
  getCellCanvasBounds,
  getViewportAtPoint,
  hitTestLayout,
  type DividerHitResult,
  type EmptyHitResult,
  type LayoutHitResult,
} from '@mog/grid-renderer';
