/**
 * Chart Rendering Module
 *
 * Exports all renderer components:
 * - CanvasRenderer: Main Canvas2D rendering with retina support
 * - WebGLRenderer: High-performance rendering for 50K+ points
 * - Mark rendering functions: Individual mark type renderers
 * - HitTester: Grid-based spatial indexing for hit testing
 */

// Canvas Renderer
export { CanvasRenderer, createCanvasRenderer, type Renderer } from './canvas-renderer';

// WebGL Renderer
export { WebGLRenderer, createWebGLRenderer, isWebGLSupported, parseColor } from './webgl-renderer';

// Mark Rendering (re-exported from marks module)
export {
  applyStyle,
  renderArc,
  renderMark,
  renderMarks,
  renderPath,
  renderRect,
  renderSymbol,
  renderText,
} from './mark-renderer';

// Hit Testing
export {
  GridHitTester,
  createHitTester,
  getBoundingBox,
  getMarkCenter,
  pointInMark,
  type BoundingBox,
  type HitTestResult,
  type HitTester,
} from './hit-tester';
