/**
 * @mog/grid-canvas — Thin Composition Facade
 *
 * Orchestrates grid-renderer layers into a complete spreadsheet canvas.
 * Contains ONLY:
 * - GridRenderer composition facade (renderer/)
 * - computeViewportLayout — full viewport layout with split-view + overlays (viewports/)
 * - Cell style adapters — DOM-dependent (cell-style-bridge.ts)
 *
 * All rendering logic lives in @mog/grid-renderer.
 * All drawing logic lives in @mog/drawing-canvas.
 *
 * @packageDocumentation
 */

// =============================================================================
// CORE RENDERER
// =============================================================================

export {
  createGridRenderer,
  type GridRendererConfig,
  type GridRendererStats,
} from './renderer/grid-renderer';

export { GridRenderScheduler } from './renderer/grid-render-scheduler';

export { SceneGraphBoundsReader } from './renderer/scene-graph-bounds-reader';
export { SceneGraphReader } from './renderer/scene-graph-reader';

export type {
  FloatingObjectRenderState,
  ObjectBounds,
  SelectionErrorType,
  SelectionRenderState,
} from './renderer/render-context';

// =============================================================================
// VIEWPORT LAYOUT
// computeViewportLayout is the single function that produces a ViewportLayout
// from inputs. The Viewport→RenderRegion projection
// for the canvas engine happens in renderer/viewport-to-region-layout.ts.
// =============================================================================

export { computeViewportLayout } from './viewports/compute-layout';
export type { ComputeLayoutInput } from './viewports/types';

export type {
  HeaderRenderInfo,
  Viewport,
  ViewportDivider,
  ViewportHitResult,
  ViewportLayout,
  ViewportRenderConfig,
} from './viewports/types';

// =============================================================================
// CELL STYLE ADAPTERS (DOM-dependent — cannot live in grid-renderer)
// =============================================================================

export {
  getCellCanvasFont,
  getCellDOMStyle,
  getThemedCellStyle,
  type CellTextStyle,
} from './cell-style-bridge';

// =============================================================================
// CSS VARIABLE BRIDGE
// =============================================================================

export { applyChromeTheme } from './styles/css-variables';
