/**
 * Canvas Renderer Module
 *
 * Exports the GridRenderer V2 and contract type re-exports.
 *
 * @module canvas/renderer
 */

// Render Context — re-exports from contracts
export type {
  FloatingObjectRenderState,
  ObjectBounds,
  RenderContextConfig,
  SelectionRenderState,
} from './render-context';

// Grid Renderer
export { GridRendererImpl, createGridRenderer } from './grid-renderer';
export type { GridRendererConfig, GridRendererStats } from './grid-renderer';

// Bounds Reader
export { SceneGraphBoundsReader } from './scene-graph-bounds-reader';

// Scene Graph Reader
export { SceneGraphReader } from './scene-graph-reader';
