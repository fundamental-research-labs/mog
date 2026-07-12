/**
 * @mog/canvas-engine
 *
 * Generic canvas infrastructure with zero domain knowledge.
 * Provides multi-canvas rendering, layer management, priority scheduling,
 * input capture, and hit testing.
 */

// =============================================================================
// Types (from core/types.ts)
// =============================================================================

export type {
  // Animation
  AnimationClock,
  CanvasEngine,
  CanvasInputEvent,
  // Canvas layer
  CanvasLayer,
  CanvasPointerEvent,
  // Branded coordinate-space rects
  CanvasSpaceRect,
  // Dirty cell expansion
  DirtyCellExpander,
  // Dirty hints
  DirtyHint,
  DocSpaceRect,
  // Effective state
  EffectiveStateManager,
  // Frame context
  FrameContext,
  // Hit testing
  HitResult,
  HitTestProvider,
  LayoutInvalidationMode,
  LayoutUpdateOptions,
  PhysicalRect,
  // Geometric primitives
  Point,
  Rect,
  RegionLayout,
  RegionLocalRect,
  // Render region & layout
  RenderRegion,
  // Render scheduler
  RenderScheduler,
  Size,
  TextMeasurer,
} from './core/types';

export { canvasSpaceRect, docSpaceRect, physicalRect, regionLocalRect } from './core/types';

// =============================================================================
// Implementations
// =============================================================================

// Utils
export { colorWithOpacity, hexToRgba, parseHex } from './utils/color-utils';
export { snapToPixelGrid } from './utils/snap';
export { CanvasTextMeasurer } from './utils/text-measurer';

// Geometry / transform math
export { computeLinearGradientEndpoints } from './geometry/gradient-math';
export type { GradientEndpoints } from './geometry/gradient-math';
export { calculateResizeBounds, calculateRotationDelta } from './geometry/transform-math';
export type { ResizeConstraints, ResizeHandle } from './geometry/transform-math';

// Coordinate-space conversions
export {
  canvasToDoc,
  canvasToDocXY,
  canvasToRegionLocal,
  canvasToPhysical,
  docToCanvas,
  docToCanvasXY,
  regionLocalToCanvas,
  regionLocalVisibleRect,
} from './core/coordinate-space';

// Dirty rect accumulator
export { DirtyRectAccumulator } from './core/dirty-rect-accumulator';

// Logging

// Engine factory
export { createCanvasEngine } from './engine';
export type { CanvasEngineInstance } from './engine';
