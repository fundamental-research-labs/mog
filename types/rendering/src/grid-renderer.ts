/**
 * Grid Renderer Interface
 *
 * Stable API for the grid renderer. State subsystem uses this interface
 * to control rendering without depending on canvas internals.
 *
 * ARCHITECTURE:
 * - Interface defined in contracts (this file)
 * - Implementation (GridRendererImpl) in canvas
 * - State creates renderer via factory, uses only this interface
 *
 * The rendering model is NOT `render()` on demand. It's:
 * 1. `updateContext()` called 50-200+ times per second with state updates
 * 2. Scheduler decides if render needed
 * 3. Invalidation is explicit (`invalidateLayer`, `invalidateCells`, `invalidateAll`)
 *
 * Performance critical: `updateContext()` must have minimal overhead.
 *
 * @module @mog-sdk/contracts/rendering/grid-renderer
 */

import type { IDiagramBridge } from '@mog/types-bridges/diagram-bridge';
import type { CellRange } from '@mog/types-core';
import type { InkAccessorForRendering } from '@mog/types-objects/ink';
import type { IObjectBoundsReader } from '@mog/types-objects/objects/object-bounds-reader';
import type { ISceneGraphReader } from '@mog/types-objects/objects/scene-graph-reader';
import type { ViewportLayout } from '@mog/types-viewport';
import type { ITextEffectCanvasBridge, RenderLatexFn } from './canvas-bridge-types';
import type {
  CellCoord,
  CoordinateSystem,
  ViewportMergeIndexLike,
  ViewportPositionIndexLike,
} from './coordinates';
import type { ObjectBounds, UnifiedHitResult } from './hit-test';
import type { InteractiveElementCollector } from './interactive-elements';
import type { RenderContextConfig } from './render-context';

// =============================================================================
// Layer Names
// =============================================================================

import { RenderPriority } from '@mog/types-viewport/rendering/grid-renderer-primitives';
import type { LayerName } from '@mog/types-viewport/rendering/grid-renderer-primitives';
export type { LayerName };
export { RenderPriority };

// =============================================================================
// Grid Renderer Statistics
// =============================================================================

/**
 * Statistics for monitoring renderer performance.
 */
export interface GridRendererStats {
  /** Current FPS */
  fps: number;

  /** Average frame time in ms */
  averageFrameTime: number;

  /** Is render loop running? */
  isRunning: boolean;

  /** Is renderer paused? */
  isPaused: boolean;

  /** Total frames rendered */
  totalFrames: number;

  /** Scheduler queue depth */
  queueDepth: number;
}

// =============================================================================
// Render Scheduler Interface
// =============================================================================

/**
 * Scheduler that bridges buffer writes to canvas layer invalidation.
 *
 * Implements the "Write = Invalidate" contract: when viewport buffers
 * receive patches, they call these methods to mark the appropriate canvas
 * layers dirty and wake the render loop.
 *
 * This is a contracts-level mirror of the canvas-engine RenderScheduler
 * so that contracts does not depend on @mog/canvas-engine at runtime.
 */
export interface RenderScheduler {
  /** Cell value or format changed — mark cells layer dirty. */
  markCellsDirty(cells?: { row: number; col: number }[]): void;
  /** Row/col dimensions changed — mark cells + headers + selection dirty. */
  markGeometryDirty(): void;
  /** Full buffer swap or theme change — mark all layers dirty. */
  markAllDirty(): void;
}

export type LayoutInvalidationMode = 'structural' | 'scroll';

export interface ViewportLayoutUpdateOptions {
  readonly invalidation?: LayoutInvalidationMode;
}

// =============================================================================
// Object Bounds Update
// =============================================================================

/** Bounds update for scene graph writes during drag/resize/rotate. */
export interface ObjectBoundsUpdate {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

// =============================================================================
// Grid Renderer Interface
// =============================================================================

/**
 * Stable interface for the grid renderer.
 *
 * IMPORTANT: This interface includes ALL public methods of GridRendererImpl.
 * Do NOT create a minimal interface - that would require gradual migration
 * which is forbidden by the architecture checklist (Section 13: No Slow Migrations).
 */
export interface GridRenderer {
  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the render loop.
   */
  start(): void;

  /**
   * Stop the render loop.
   */
  stop(): void;

  /**
   * Pause rendering (e.g., when tab is hidden).
   */
  pause(): void;

  /**
   * Resume rendering (e.g., when tab becomes visible).
   */
  resume(): void;

  /**
   * Dispose of all resources.
   */
  dispose(): void;

  // ===========================================================================
  // Viewport
  // ===========================================================================

  /**
   * Resize the canvas.
   */
  resize(width: number, height: number): void;

  /**
   * Set the viewport layout.
   *
   * When set, the renderer iterates through each viewport in the layout,
   * clips to viewport bounds, and renders layers for each viewport's cell range.
   * This enables freeze panes, split views, and overlay viewports.
   *
   * Pass null to fall back to legacy single-viewport mode.
   *
   * @param layout - The computed viewport layout, or null to use legacy mode
   */
  setViewportLayout(layout: ViewportLayout | null, options?: ViewportLayoutUpdateOptions): void;

  /**
   * Get the current viewport layout.
   *
   * @returns Current viewport layout, or null if using legacy mode
   */
  getViewportLayout(): ViewportLayout | null;

  // ===========================================================================
  // Scroll/Zoom
  // ===========================================================================

  /**
   * Update scroll position.
   */
  setScroll(scrollTop: number, scrollLeft: number): void;

  /**
   * Update zoom level.
   */
  setZoom(zoom: number): void;

  // ===========================================================================
  // Sheet Operations
  // ===========================================================================

  /**
   * Switch to a different sheet.
   */
  switchSheet(sheetId: string): void;

  // ===========================================================================
  // Context Updates (CRITICAL - called very frequently)
  // ===========================================================================

  /**
   * Update render context configuration.
   *
   * CRITICAL: This is called 50-200+ times per second during editing
   * (every keystroke, selection change, format change). Must have
   * minimal overhead - no serialization/deserialization.
   *
   * @param config - Partial configuration to merge with current context
   */
  updateContext(config: Partial<RenderContextConfig>): void;

  // ===========================================================================
  // Invalidation API
  // ===========================================================================

  /**
   * Invalidate a specific layer.
   *
   * @param layer - Layer to invalidate
   * @param regions - Optional specific regions to invalidate
   */
  invalidateLayer(layer: LayerName, regions?: CellRange[]): void;

  /**
   * Invalidate specific cells.
   *
   * @param cells - Cells to invalidate
   * @param priority - Optional render priority (default: NORMAL)
   */
  invalidateCells(cells: CellCoord[], priority?: RenderPriority): void;

  /**
   * Invalidate all layers (full redraw).
   */
  invalidateAll(): void;

  // ===========================================================================
  // Coordinate System
  // ===========================================================================

  /**
   * Get the coordinate system.
   *
   * Used by state for hit testing, scroll calculations, and
   * determining visible cell ranges.
   */
  getCoordinateSystem(): CoordinateSystem;

  /**
   * Get the page-space bounding rectangle for a cell.
   *
   * Combines cellToViewport (canvas-relative coordinates accounting for scroll,
   * zoom, frozen panes, headers) with the container's getBoundingClientRect
   * (canvas-to-page) to produce absolute page coordinates.
   *
   * Use cases: Playwright clicks, tooltip positioning, overlay anchoring.
   *
   * @param row - 0-indexed row
   * @param col - 0-indexed column
   * @returns Page-space rect, or null if cell is not visible or renderer not ready
   */
  getCellPageBounds(
    row: number,
    col: number,
  ): { x: number; y: number; width: number; height: number } | null;

  /**
   * Get page-space bounding rectangles for a cell range.
   *
   * Mirror of `getCellPageBounds` for ranges. Returns multiple rects when the
   * range spans the frozen/non-frozen boundary (matching `rangeToViewport`'s
   * shape). DOM overlays anchored to merged cells should use `[0]`.
   *
   * Use this — not `coords.rangeToViewport(...)` plus a manual
   * `containerRect.left + r.x` — at every canvas/DOM boundary.
   *
   * @param range - The cell range
   * @returns Page-space rects (empty array if not visible or renderer not ready)
   */
  getRangePageBounds(range: CellRange): { x: number; y: number; width: number; height: number }[];

  /**
   * Get the rendered (drawn) size of a cell: its column width / row height
   * scaled by the active zoom.
   *
   * This is independent of scroll position, of which viewport (main / frozen /
   * split) the cell falls in, and of whether the cell is currently visible —
   * only positioning and clipping depend on those (see `getCellPageBounds`).
   * A cell scrolled fully or partially off-screen still reports its full drawn
   * size here, whereas `getCellPageBounds` would clip to (or null out) the
   * visible portion.
   *
   * Use this to measure intrinsic rendered dimensions (e.g. column width /
   * row height readbacks). Use `getCellPageBounds` for click/overlay
   * positioning where the clipped, visible rect is what you want.
   *
   * @param row - 0-indexed row
   * @param col - 0-indexed column
   * @returns Zoom-scaled drawn size, or null if the renderer is not ready
   *          (no usable zoom)
   */
  getCellRenderedSize(row: number, col: number): { width: number; height: number } | null;

  // ===========================================================================
  // Hit Testing
  // ===========================================================================

  /**
   * Unified hit test — queries all layers (overlay, drawing, grid) via the
   * engine's hit test pipeline. Returns the topmost hit as a typed UnifiedHitResult.
   *
   * Replaces the old pattern of coords.hitTestPoint() which used a dead HitMap.
   * This method delegates to the engine pipeline where the drawing-canvas HitMap
   * (spatial index + Path2D) is actually populated during render.
   *
   * @param x - X coordinate in viewport space (CSS pixels, canvas-relative)
   * @param y - Y coordinate in viewport space (CSS pixels, canvas-relative)
   * @returns UnifiedHitResult — floatingObject, cell, header, resize handle, etc.
   */
  hitTest(x: number, y: number): UnifiedHitResult;

  // ===========================================================================
  // Floating Object Bounds (Synchronous)
  // ===========================================================================

  /**
   * Get floating object bounds synchronously from the scene graph.
   *
   * Returns document-space bounds (absolute pixel coordinates) read directly
   * from the drawing layer's scene graph. This is the sync alternative to
   * FloatingObjectManager.computeObjectBounds() which requires async IPC.
   *
   * Used by the coordination layer to initialize drag/resize/rotate operations
   * without blocking on async IPC — the scene graph already has the bounds
   * from the last render pass.
   *
   * @param objectId - The floating object ID
   * @returns ObjectBounds (doc-space) or null if object not in scene graph
   */
  getObjectBoundsSync(objectId: string): ObjectBounds | null;

  /**
   * Contract-backed bounds reader for floating objects.
   *
   * Provides synchronous, O(1) reads of object pixel bounds from the scene graph.
   * Prefer this over getObjectBoundsSync() — it exposes the full IObjectBoundsReader
   * interface (getBounds, getGroupBounds, getBoundsMany) rather than a single method.
   *
   * Consumers should migrate to `gridRenderer.boundsReader.getBounds(id)` instead
   * of `gridRenderer.getObjectBoundsSync(id)`.
   */
  readonly boundsReader: IObjectBoundsReader;

  /**
   * Update floating object bounds in the scene graph.
   *
   * Synchronously updates the scene graph entry for the given object with new
   * bounds and rotation. This is the write counterpart to `boundsReader` (read path).
   *
   * Used during drag/resize/rotate operations to update the scene graph on every
   * pointer event, making the scene graph the single authority for object position
   * throughout the entire operation lifecycle.
   *
   * Marks both drawing layer (via scene graph onDirty) and overlay layer dirty
   * so selection/resize/rotation handles follow the shape.
   *
   * No-op if objectId does not exist in the scene graph.
   *
   * @param objectId - The floating object ID
   * @param bounds - New bounds and rotation
   */
  updateObjectBounds(objectId: string, bounds: ObjectBoundsUpdate): void;

  /**
   * Read-only accessor over the rendering scene graph.
   *
   * The scene graph is the renderer's authoritative source for what's
   * currently drawn on the floating-object layer — population happens
   * during the render pass driven by the kernel's drawing-list bridge.
   * Devtools / app-eval rendered-state readbacks (`__dt.getRenderedDrawings`)
   * read this to validate that drawings made it from the kernel into
   * the canvas, and to catch parser-side drops that wouldn't surface
   * via a kernel-side query.
   *
   * Stable across `switchSheet()`: the underlying scene graph instance
   * is shared across all sheets in a workbook (same renderer); calling
   * `switchSheet()` rebuilds the contents but keeps this reader live.
   *
   * Do NOT use for persistence — the scene graph is render-only and
   * does not capture XLSX-side anchor metadata.
   */
  readonly sceneGraphReader: ISceneGraphReader;

  // ===========================================================================
  // Inspection/Debugging
  // ===========================================================================

  /**
   * Get renderer statistics.
   *
   * Used for performance monitoring and debugging.
   */
  getStats(): GridRendererStats;

  /**
   * Get current sheet ID.
   */
  getCurrentSheetId(): string;

  // ===========================================================================
  // Cell Content Queries
  // ===========================================================================

  /**
   * Get clipped content for a cell.
   *
   * When cell content overflows and is clipped, this returns the full
   * content string for tooltip display. Returns null if:
   * - Cell is not currently rendered
   * - Cell content is not clipped
   * - Cell is empty
   *
   * @param row - Row index
   * @param col - Column index
   */
  getClippedCellContent(row: number, col: number): string | null;

  // ===========================================================================
  // Ink Integration
  // ===========================================================================

  /**
   * Set ink accessor for overlay layer preview rendering.
   *
   * This enables live stroke preview during ink/drawing mode.
   * Call with accessor to enable, null to disable.
   *
   * @param accessor - Ink accessor or null to clear
   */
  setInkAccessor(accessor: InkAccessorForRendering | null): void;

  // ===========================================================================
  // Diagram Integration
  // ===========================================================================

  /**
   * Set Diagram bridge for overlay layer diagram rendering.
   *
   * This MUST be called during coordinator initialization to enable
   * Diagram rendering. Without the bridge, Diagram objects render
   * as placeholders instead of actual diagrams.
   *
   *
   * @param bridge - Diagram bridge or null to disable
   */
  setDiagramBridge(bridge: IDiagramBridge | null): void;

  // ===========================================================================
  // Equation Integration
  // ===========================================================================

  /**
   * Set the astToLatex function for equation rendering.
   *
   * This MUST be called during coordinator initialization to enable
   * equation rendering. Without this function, equations render as
   * placeholders with "Loading..." text instead of actual math.
   *
   *
   * @param fn - The LaTeX rendering function (renders LaTeX string to canvas)
   */
  setAstToLatex(fn: RenderLatexFn): void;

  // ===========================================================================
  // TextEffect Integration
  // ===========================================================================

  /**
   * Set TextEffect rendering bridge for overlay layer text effects rendering.
   *
   * This MUST be called during coordinator initialization to enable
   * TextEffect rendering. Without the bridge, TextEffect objects render
   * as plain text boxes instead of styled, warped text.
   *
   *
   * @param bridge - TextEffect canvas rendering bridge or null to disable
   */
  setTextEffectBridge(bridge: ITextEffectCanvasBridge | null): void;

  // ===========================================================================
  // Interactive Element Collection
  // ===========================================================================

  /**
   * Get the interactive element collector.
   *
   * This collector gathers interactive element positions (filter buttons, checkboxes, etc.)
   * during each render pass. React components can subscribe to the collector to render
   * invisible DOM overlays at the correct positions for accessibility and popover triggers.
   *
   *
   * @returns The interactive element collector instance
   */
  getInteractiveElementCollector(): InteractiveElementCollector;

  // ===========================================================================
  // Render Scheduler (Write = Invalidate)
  // ===========================================================================

  /**
   * Get the render scheduler for "Write = Invalidate" buffer integration.
   *
   * The scheduler bridges viewport buffer mutations to canvas layer invalidation.
   * When the kernel writes cell data into buffers, the buffer calls scheduler
   * methods to mark affected layers dirty and wake the render loop.
   */
  getRenderScheduler(): RenderScheduler;
}

// =============================================================================
// Grid Renderer Config
// =============================================================================

/**
 * Configuration for creating a GridRenderer instance.
 */
export interface GridRendererConfig {
  /** Container element — CanvasHost creates stacked canvases internally */
  container: HTMLElement;

  /** Initial sheet ID */
  initialSheetId: string;

  /** Total rows */
  totalRows?: number;

  /** Total columns */
  totalCols?: number;

  /** Initial render context config (for state data) */
  contextConfig?: Partial<RenderContextConfig>;

  /** Viewport position index for O(1) row/col position lookups */
  positionIndex?: ViewportPositionIndexLike;

  /** Viewport merge index for O(1) merged-region lookups */
  mergeIndex?: ViewportMergeIndexLike;
}

// =============================================================================
// Factory Type
// =============================================================================

/**
 * Factory function to create a GridRenderer instance.
 */
export type RendererFactory = (config: GridRendererConfig) => GridRenderer;
