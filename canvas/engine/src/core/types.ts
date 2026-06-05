/**
 * Canvas Engine Core Types
 *
 * Generic canvas infrastructure types with zero domain knowledge.
 * These types are intentionally separate from @mog-sdk/contracts.
 *
 * @module @mog/canvas-engine
 */

// =============================================================================
// Geometric Primitives
// =============================================================================
// NOTE: These are intentionally duplicated from contracts/src/viewport/viewport.ts.
// canvas-engine MUST have zero domain dependencies. The duplication is deliberate
// and documented here so canvas-engine keeps zero domain dependencies.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// =============================================================================
// Branded Coordinate-Space Rects
// =============================================================================

/** Pixel position in document space (cumulative from origin, unzoomed) */
export type DocSpaceRect = Rect & { readonly __brand: 'doc-space' };

/** Pixel position in canvas space (CSS pixels on the visible canvas) */
export type CanvasSpaceRect = Rect & { readonly __brand: 'canvas-space' };

/** Pixel position in region-local space (after translate, before zoom) */
export type RegionLocalRect = Rect & { readonly __brand: 'region-local' };

/** Pixel position in physical device pixels (after DPR scaling) */
export type PhysicalRect = Rect & { readonly __brand: 'physical' };

// Branded rect constructors

export function docSpaceRect(x: number, y: number, width: number, height: number): DocSpaceRect {
  return { x, y, width, height } as DocSpaceRect;
}

export function canvasSpaceRect(
  x: number,
  y: number,
  width: number,
  height: number,
): CanvasSpaceRect {
  return { x, y, width, height } as CanvasSpaceRect;
}

export function regionLocalRect(
  x: number,
  y: number,
  width: number,
  height: number,
): RegionLocalRect {
  return { x, y, width, height } as RegionLocalRect;
}

export function physicalRect(x: number, y: number, width: number, height: number): PhysicalRect {
  return { x, y, width, height } as PhysicalRect;
}

// =============================================================================
// Input Event Types
// =============================================================================

export interface Modifiers {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

interface CanvasInputEventBase {
  /** Screen-space position (CSS pixels relative to canvas container) */
  readonly position: Point;
  /** Document-space position (after scroll offset and zoom transform) */
  readonly worldPosition: Point;
  readonly modifiers: Modifiers;
  readonly timestamp: number;
}

export interface CanvasPointerEvent extends CanvasInputEventBase {
  readonly kind: 'pointer';
  readonly action: 'down' | 'move' | 'up' | 'enter' | 'leave';
  /** Mouse button (0=left, 1=middle, 2=right) */
  readonly button: number;
  /** True for touch input — use for expanded hit areas (+8px instead of +4px) */
  readonly isTouch: boolean;
}

export interface CanvasWheelEvent extends CanvasInputEventBase {
  readonly kind: 'wheel';
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: 'pixel' | 'line' | 'page';
}

/**
 * Discriminated union of canvas input events.
 * Keyboard events are intentionally excluded — they are handled
 * at the application layer (too domain-specific for a generic engine).
 */
export type CanvasInputEvent = CanvasPointerEvent | CanvasWheelEvent;

// =============================================================================
// Render Scheduler
// =============================================================================

/**
 * Injected into data buffers to atomically schedule renders on data writes.
 *
 * This is the "Write = Invalidate" contract: every buffer mutation calls
 * the appropriate method, ensuring no gap between data write and render.
 */
export interface RenderScheduler {
  /** Cell value or format changed — mark cells layer dirty. */
  markCellsDirty(cells?: { row: number; col: number }[]): void;
  /** Row/col dimensions changed — mark cells + headers + selection dirty. */
  markGeometryDirty(): void;
  /** Full buffer swap or theme change — mark all layers dirty. */
  markAllDirty(): void;
}

// =============================================================================
// Dirty Cell Expansion
// =============================================================================

/**
 * Expands a set of dirty cells to include visually dependent cells.
 *
 * Render-derived: the implementation uses knowledge from previous frames
 * (e.g., text overflow state) to determine which additional cells need
 * repainting when a cell changes.
 */
export interface DirtyCellExpander {
  expandDirtyCells(cells: { row: number; col: number }[]): { row: number; col: number }[];
}

// =============================================================================
// Render Region
// =============================================================================

/**
 * A rectangular region on the canvas with its own scroll offset and zoom.
 *
 * The engine renders layers within regions. For spreadsheets, regions
 * correspond to freeze pane quadrants (frozen-corner, frozen-rows,
 * frozen-cols, main). TMeta carries domain-specific data that the
 * engine ignores but layers can access.
 *
 * **CANONICAL COORDINATE FORMULA:**
 *
 *     canvas = bounds + (doc − viewportOrigin − scrollOffset) · zoom
 *     doc    = (canvas − bounds) / zoom + viewportOrigin + scrollOffset
 *
 * Layers MUST go through `docToCanvas`/`canvasToDoc`/`docToCanvasXY`/
 * `canvasToDocXY` in `canvas-engine/core/coordinate-space.ts`. Inline
 * `doc − scrollOffset` math (or any subset of the formula) is forbidden:
 * dropping `viewportOrigin` silently mis-paints frozen panes.
 */
export interface RenderRegion<TMeta = unknown> {
  readonly id: string;
  /** Position and size on the canvas (CSS pixels) */
  readonly bounds: Rect;
  /**
   * Where this region starts in document coordinate space (unzoomed pixels).
   *
   * Required, no default. Frozen-pane semantics live entirely in this field;
   * once the canonical formula consumes it, layers don't need to know which
   * pane they are rendering.
   */
  readonly viewportOrigin: Point;
  /**
   * User scroll offset within this region's cell space (unzoomed pixels).
   * Combine with `viewportOrigin` via the canonical formula above —
   * never subtract it inline.
   */
  readonly scrollOffset: Point;
  readonly zoom: number;
  /** Domain-specific metadata (engine ignores this) */
  readonly metadata: TMeta;
}

/**
 * How a caller intends a region layout update to invalidate rendering.
 *
 * - `structural`: region identity/topology/bounds/origin/zoom changed. Static
 *   and scroll-dependent layers must repaint.
 * - `scroll`: only region scroll offsets / visible windows changed. Callers
 *   are responsible for dirtying scroll-dependent layers; static layers remain
 *   clean.
 */
export type LayoutInvalidationMode = 'structural' | 'scroll';

export interface LayoutUpdateOptions {
  readonly invalidation?: LayoutInvalidationMode;
}

// =============================================================================
// Frame Context
// =============================================================================

/**
 * Per-frame context passed to every layer's render() method.
 * This is the ONLY animation time source — layers must NOT use
 * performance.now() or Date.now() directly.
 */
export interface FrameContext {
  /** Timestamp from requestAnimationFrame (ms since page load) */
  readonly timestamp: number;
  /** Current canvas size in CSS pixels */
  readonly canvasSize: Size;
  /** Device pixel ratio */
  readonly dpr: number;
  /** Monotonically increasing frame counter */
  readonly frameNumber: number;
  /**
   * Dirty rects for this frame in CSS pixels (empty array if full dirty).
   * Layers can optionally use these to skip rendering work outside dirty regions.
   * When absent or empty, the layer should perform a full render (current behavior).
   */
  readonly dirtyRects?: readonly CanvasSpaceRect[];
}

// =============================================================================
// Dirty Hints
// =============================================================================

/**
 * Generic geometric dirty hints with zero domain knowledge.
 * No cell/row/col concepts — the grid-renderer is responsible for
 * converting cell coordinates to geometric Rect values before
 * passing hints to the engine.
 */
export type DirtyHint =
  | { readonly type: 'full' }
  | { readonly type: 'regions'; readonly regionIds: string[] }
  | { readonly type: 'rect'; readonly bounds: DocSpaceRect }
  | { readonly type: 'rects'; readonly bounds: DocSpaceRect[] };

// =============================================================================
// Canvas Layer
// =============================================================================

/**
 * A renderable layer in the canvas engine.
 *
 * Layers are registered with the engine and rendered in z-index order.
 * Each layer declares which canvas it renders on and its render mode.
 */
export interface CanvasLayer {
  /** Unique identifier for this layer */
  readonly id: string;

  /** Z-index for rendering order (lower = behind) */
  readonly zIndex: number;

  /**
   * Render mode determines how the engine sets up the canvas context:
   *
   * - 'per-region': Rendered once per RenderRegion with clip, translate, and scale.
   *   Use for content that scrolls with the document (cells, selection, objects).
   *
   * - 'once': Rendered once at canvas-absolute coordinates with no clip.
   *   Use for chrome that doesn't scroll (headers, dividers, freeze lines).
   */
  readonly renderMode: 'per-region' | 'once';

  /**
   * Which canvas to render on (0-indexed).
   * - 0: World-space canvas (grid, cells, objects)
   * - 1: Screen-space canvas (handles, guides, rubber band)
   */
  readonly canvas: number;

  /**
   * Expand the per-region clip rect by this many CSS pixels on all sides.
   *
   * Only applies to 'per-region' layers. Use when a layer's strokes extend
   * slightly beyond region bounds (e.g., a 2px selection border where half
   * the stroke width falls outside). Default: 0 (tight clip to region bounds).
   *
   * Any overflow into adjacent areas (headers, other regions) is naturally
   * covered by higher-z-index layers (headers at z=800) or adjacent region
   * content, so small values (1-3px) are safe.
   */
  readonly clipPadding?: number;

  /**
   * Optional hook called once before the layer renders for a dirty frame.
   * Per-region layers may receive several render() calls for the same frame;
   * frame-scoped output should be initialized here instead of in render().
   */
  beginFrame?(frame: FrameContext): void;

  /**
   * Render this layer.
   *
   * **Coordinate contract by renderMode:**
   *
   * For renderMode 'per-region':
   *   - ctx.origin is at region.bounds top-left (translated by engine)
   *   - ctx.scale is region.zoom (scaled by engine)
   *   - ctx.clip is set to region.bounds (clipped by engine)
   *   - Draw in document coordinates minus region.scrollOffset
   *   - Example: to draw at document position (100, 200):
   *     draw at (100 - region.scrollOffset.x, 200 - region.scrollOffset.y)
   *
   * For renderMode 'once':
   *   - ctx.origin is at (0, 0) canvas top-left
   *   - ctx.scale is 1.0 (DPR already applied to canvas transform)
   *   - No clip set by the engine.
   *     **Responsibility:** if you draw per-region content (paint that
   *     depends on `region.cellRange`, per-row, or per-col geometry), you
   *     MUST clip per region. Use
   *     `BaseLayer.withRegionBandClip(ctx, band, dpr, fn)` from
   *     `canvas/grid-renderer/src/layers/base-layer.ts`. Drawing per-region
   *     content with no clip lets a partially-visible top row's label paint
   *     into the adjacent region's gutter band (freeze-divider bleed).
   *   - region is a full-canvas pseudo-region with id='__full_canvas__'
   *   - Draw using canvas-absolute CSS pixel coordinates
   *
   * @param ctx - Canvas 2D rendering context (pre-configured by engine)
   * @param region - The render region (or full-canvas pseudo-region for 'once' mode)
   * @param frame - Per-frame context with timestamp, canvas size, DPR
   */
  render(ctx: CanvasRenderingContext2D, region: RenderRegion, frame: FrameContext): void;

  /** Returns true if this layer needs to be re-rendered */
  isDirty(): boolean;

  /** Mark this layer as needing re-render, with optional geometric hint */
  markDirty(hint?: DirtyHint): void;

  /** Mark this layer as clean (called by engine after rendering) */
  markClean(): void;

  /** Get accumulated dirty rects for this frame (empty if full dirty or clean).
   *  Rects are in document-space — collectDirtyUnion converts to canvas-space. */
  getDirtyRects?(): readonly DocSpaceRect[];

  /** Returns true if the entire layer needs re-render (no partial optimization possible) */
  isFullDirty?(): boolean;

  /**
   * Optional: return a targeted DirtyHint for continuous-frame animation ticks.
   *
   * When present, the render loop uses this hint instead of a blanket full-dirty
   * mark for layers registered via requestContinuousFrames(). This allows animated
   * layers (marching ants, blinking cursors) to dirty only their specific pixel
   * regions each frame instead of triggering full-layer repaints.
   */
  getContinuousFrameDirtyHint?(): DirtyHint;

  /** Release all resources held by this layer */
  dispose(): void;
}

// =============================================================================
// Canvas Host Config
// =============================================================================

/**
 * Configuration for CanvasHost — creates and manages stacked canvas elements.
 */
export interface CanvasHostConfig {
  /** Container element to append canvases to */
  readonly container: HTMLElement;
  /** Number of stacked canvases (default: 2 — world + screen-space) */
  readonly canvasCount?: number;
  /** DPR mode: 'auto' uses window.devicePixelRatio, number forces a specific value */
  readonly dprMode?: 'auto' | number;
  /** Pre-fill color for opaque bottom canvas to prevent black flash (default: '#ffffff') */
  readonly backgroundColor?: string;
}

// =============================================================================
// Region Layout
// =============================================================================

/**
 * A layout of render regions.
 *
 * This is the generic version of what grid-renderer produces from freeze pane
 * configuration. The engine consumes this to know where to clip and translate
 * for each region.
 *
 * NOTE: This is deliberately named differently from ViewportLayout in
 * contracts/src/viewport/viewport.ts. ViewportLayout is spreadsheet-specific
 * (has viewports, dividers, headerInfo). RegionLayout is a generic concept.
 */
export interface RegionLayout<TMeta = unknown> {
  readonly regions: ReadonlyArray<RenderRegion<TMeta>>;
  readonly contentSize: Size;
  readonly maxScroll: Point;
}

// =============================================================================
// Hit Testing
// =============================================================================

/**
 * Result of a hit test query.
 */
export interface HitResult {
  /** ID of the layer that reported the hit */
  readonly layerId: string;
  /** Layer-specific target data (e.g., cell coord, object ID, handle type) */
  readonly target: unknown;
  /** Position of the hit in screen-space */
  readonly position: Point;
}

/**
 * A provider of hit test results.
 * Layers and subsystems that support hit testing implement this interface.
 * The engine dispatches hit tests top-down by zIndex, returning the first non-null hit.
 */
export interface HitTestProvider {
  hitTest(screenPoint: Point): HitResult | null;
}

// =============================================================================
// Render Priority
// =============================================================================

/**
 * Priority levels for the render scheduler.
 *
 * The scheduler processes tasks by priority within a frame budget.
 * CRITICAL always runs. Lower priorities are time-sliced.
 *
 * Frame budgets (caps, not allocations):
 *   CRITICAL: no limit
 *   USER_BLOCKING: 8ms
 *   NORMAL: 4ms
 *   LOW: 2ms
 *   IDLE: 1ms
 *   Total frame budget: 12ms
 */
export enum RenderPriority {
  CRITICAL = 0,
  USER_BLOCKING = 1,
  NORMAL = 2,
  LOW = 3,
  IDLE = 4,
}

// =============================================================================
// Animation Clock
// =============================================================================

/**
 * Controls continuous rendering for animated layers.
 *
 * When no layers are dirty AND no continuous frames are requested,
 * the render loop stops (saves battery/CPU). Animated layers (e.g.,
 * marching ants) must call requestContinuousFrames() to keep the
 * loop alive, and stopContinuousFrames() when animation ends.
 */
export interface AnimationClock {
  /** Request that the render loop continues running for this layer's animation */
  requestContinuousFrames(layerId: string): void;
  /** Stop continuous rendering for this layer's animation */
  stopContinuousFrames(layerId: string): void;
}

// =============================================================================
// Text Measurer
// =============================================================================

/**
 * Result of measuring a single line of text.
 */
export interface CanvasTextMetrics {
  readonly width: number;
  readonly actualBoundingBoxAscent: number;
  readonly actualBoundingBoxDescent: number;
}

/**
 * Result of measuring text with word wrapping.
 */
export interface WrappedTextMetrics {
  readonly lines: ReadonlyArray<string>;
  readonly lineHeight: number;
  readonly totalHeight: number;
}

/**
 * Generic text measurement interface (zero domain knowledge).
 *
 * Lives in canvas-engine as a generic canvas concern.
 * Grid-renderer's TextMeasurementService extends this with
 * domain-specific methods (cell width, rotated cell, etc.).
 */
export interface TextMeasurer {
  measureText(text: string, font: string): CanvasTextMetrics;
  measureWrappedText(text: string, font: string, maxWidth: number): WrappedTextMetrics;
}

// =============================================================================
// Effective State Manager
// =============================================================================

/**
 * Generic optimistic-state manager for drag/resize/rotate preview.
 *
 * During interactive operations, the effective state provides 60fps
 * visual rendering without waiting for Yjs round-trip latency.
 * When an operation completes, the effective state is cleared and
 * the committed state (from Yjs) is used for rendering.
 *
 * Zero domain knowledge — works with any state type T.
 */
export interface EffectiveStateManager<T> {
  /** Set the effective (in-progress) state for an object */
  setEffective(id: string, state: T): void;
  /** Get the effective state, or null if no operation in progress */
  getEffective(id: string): T | null;
  /** Clear the effective state for an object (operation complete) */
  clearEffective(id: string): void;
  /** Clear all effective states */
  clearAll(): void;
}

// =============================================================================
// Engine Stats
// =============================================================================

/**
 * Runtime statistics from the canvas engine.
 */
export interface EngineStats {
  readonly fps: number;
  readonly averageFrameTime: number;
  readonly maxFrameTime: number;
  readonly layerCount: number;
  readonly dirtyLayerCount: number;
}

// =============================================================================
// Canvas Engine
// =============================================================================

/**
 * The main canvas engine interface.
 *
 * Created via `createCanvasEngine(config)`. Manages the render loop,
 * layer registry, scheduler, and input capture.
 */
export interface CanvasEngine {
  /** Start the render loop */
  start(): void;
  /** Stop the render loop */
  stop(): void;
  /** Pause rendering (layers stay registered) */
  pause(): void;
  /** Resume rendering after pause */
  resume(): void;
  /** Dispose all resources */
  dispose(): void;

  /** Register a layer for rendering */
  registerLayer(layer: CanvasLayer): void;
  /** Unregister a layer by ID */
  unregisterLayer(id: string): void;

  /**
   * Set the region layout.
   * The engine uses this to clip and translate for per-region layers.
   */
  setLayout<TMeta>(layout: RegionLayout<TMeta>, options?: LayoutUpdateOptions): void;

  /** Mark a layer as dirty, triggering re-render on next frame */
  markDirty(layerId: string, hint?: DirtyHint): void;

  /** Request a render frame (wakes the loop if idle) */
  requestFrame(): void;

  /** Get runtime statistics */
  getStats(): EngineStats;

  /** Canvas mode: 'multi' for 2+ canvases, 'single' for GPU memory fallback */
  readonly canvasMode: 'multi' | 'single';
}
