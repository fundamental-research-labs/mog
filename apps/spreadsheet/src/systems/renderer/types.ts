/**
 * Render System Types
 *
 * Type definitions for the RenderSystem - the coordinator subsystem responsible
 * for renderer lifecycle, viewport state, layout coordination, and render context wiring.
 *
 * PHILOSOPHY: Copy existing types - don't reinvent. These types mirror the existing
 * renderer execution patterns from the monolithic coordinator.
 *
 */

import type { rendererSelectors } from '../../selectors';
import type { PendingAction, RendererAccessor, RendererCommands } from '@mog-sdk/contracts/actors';

import type { SheetId } from '@mog-sdk/contracts/core';
import type { FrozenPanes, GridRenderer } from '@mog-sdk/contracts/rendering';
import type { ISparklineManager as ContractSparklineManager } from '@mog-sdk/contracts/sparklines';
import type { Point, ViewportLayout } from '@mog-sdk/contracts/viewport';
import type {
  ISheetViewGeometry,
  ISheetViewHitTest,
  ISheetViewRender,
  ISheetViewViewport,
  ISheetViewObjects,
  ISheetViewInteractiveElements,
  ISheetViewRenderState,
  SheetViewHandle,
} from '@mog-sdk/sheet-view';
import type { ReadableStoreApi } from '../shared/types';

import type { DragTerminator } from '../shared/drag-terminator';
import type { Metric } from '../shared/types';

// =============================================================================
// NARROW UI STORE INTERFACE (DAG: systems/ must not import ui-store/)
// =============================================================================

/**
 * Narrow interface describing ONLY the UIStore properties needed by the Renderer system.
 * Replaces direct import of UIState to satisfy DAG constraints.
 */
export interface RendererUIStore {
  /** Currently active sheet ID */
  activeSheetId: SheetId;
  /** Contextual tabs state */
  contextualTabs: {
    hasSparklineInActiveCell: boolean;
  };
  /** Set whether active cell has a sparkline */
  setHasSparklineInActiveCell: (has: boolean) => void;
  /** Optional zoom writer when renderer-owned commands update zoom directly. */
  setZoomLevel?: (sheetId: SheetId, level: number) => void;
}

// Actor types (for useSelector hook subscriptions)
import type { RendererActor } from './machines/grid-renderer-machine';
import type { PageBreakActor } from './machines/page-break-machine';
import type {
  PageBreakDragState as CoordinationPageBreakDragState,
  RenderContextCoordinationConfig as CoordinationRenderContextCoordinationConfig,
} from './execution/render-context-coordination';

// Aliases for consumers of the renderer system facade.
export type PageBreakDragState = CoordinationPageBreakDragState;
export type RenderContextCoordinationConfig = CoordinationRenderContextCoordinationConfig;

export type { PageBreakHitResult } from './features/page-break/page-break-coordination';

export type { EventSubscriptionResult } from './subscriptions/event-subscriptions';

export type SparklineManager = ContractSparklineManager;

// =============================================================================
// ACTOR ACCESS LAYER
// =============================================================================

/**
 * Actor access layer for the RenderSystem.
 * Provides typed access to renderer actor state and commands.
 *
 * This is the subsystem-specific actor access interface - other systems
 * have their own equivalents (GridActorAccess, ObjectActorAccess, etc.)
 */
export interface RenderActorAccess {
  /** Accessors for reading renderer state (point-in-time reads) */
  accessors: {
    renderer?: RendererAccessor;
  };

  /** Commands for sending events to the renderer machine */
  commands: {
    renderer?: RendererCommands;
  };

  /** Selectors for extracting data from renderer state */
  selectors: {
    renderer: typeof rendererSelectors;
  };

  /**
   * Actor refs for useSelector hook subscriptions.
   * Use accessors/commands for programmatic reads/writes.
   * These are exposed solely for React hooks that need reactive subscriptions.
   */
  actors: {
    renderer: RendererActor;
    pageBreak: PageBreakActor;
  };
}

// =============================================================================
// RENDER CONTEXT CONFIG (PLACEHOLDER)
// =============================================================================

/**
 * Configuration for renderer context updates.
 * TODO: Extract from render-context-coordination.ts.
 *
 * This type will contain the subset of RenderContextConfig fields that can be
 * updated dynamically (gridlines, headers, zoom, etc.) without full re-initialization.
 */
export interface RenderContextConfig {
  // TODO: Extract from contracts/src/rendering/render-context.ts
  // Likely includes: showGridlines, showHeaders, zoom, rtl, etc.
  [key: string]: unknown;
}

// =============================================================================
// RENDERER SNAPSHOT (PLACEHOLDER)
// =============================================================================

/**
 * Snapshot of renderer state for external consumers.
 * This is the read-only view of renderer status and configuration.
 *
 * Extracted from machine state via getRendererSnapshot() helper.
 * @see machines/grid-renderer-machine.ts - getRendererSnapshot()
 */
export interface RendererSnapshot {
  /** Current renderer status (maps to machine state) */
  status:
    | 'unmounted'
    | 'waitingForLayout'
    | 'initializing'
    | 'ready'
    | 'switchingSheet'
    | 'suspended'
    | 'error'
    | 'disposing';
  /** Currently active sheet ID */
  currentSheetId: string | null;
  /** Whether renderer is switching sheets */
  isSwitching: boolean;
}

// =============================================================================
// SYSTEM CONFIGURATION
// =============================================================================

/**
 * Configuration for creating a RenderSystem instance.
 * Passed to constructor - contains all dependencies needed for initialization.
 */
export interface RenderSystemConfig {
  /**
   * Workbook instance for event subscriptions, data access, and render context coordination.
   * Used by event subscription modules, dimension provider, and cell data callbacks.
   */
  workbook?: import('@mog-sdk/contracts/api').Workbook;

  /**
   * Dependencies for sheet switch coordination.
   * Includes UI store API for subscribing to activeSheetId changes and
   * accessing per-sheet view state methods.
   */
  sheetSwitchDeps?: {
    uiStoreApi: ReadableStoreApi<RendererUIStore>;
  };

  /**
   * Handle-based viewport management API from the Workbook.
   * Replaces the old onViewportDataNeeded / onPerViewportDataNeeded / viewportLifecycle callbacks.
   * The renderer creates/disposes ViewportRegion handles through this API.
   */
  viewport?: import('@mog-sdk/contracts/api').WorkbookViewport;

  /**
   * Optional callback for metrics/observability.
   * Called when renderer emits performance metrics or lifecycle events.
   */
  onMetric?: (metric: Metric) => void;
}

// =============================================================================
// RENDER SYSTEM INTERFACE
// =============================================================================

/**
 * IRenderSystem - Public interface for the Render subsystem.
 *
 * This system owns:
 * - Renderer lifecycle (mount/unmount/initialization)
 * - Viewport state (scroll position, frozen panes, zoom)
 * - Layout coordination (resize, dimensions)
 * - Render context wiring (cell data callbacks, view options)
 * - Bridge setup (Diagram, TextEffect, Equation)
 * - Page break preview mode
 * - Render-triggering subscriptions (EventBus events → invalidation)
 *
 * Architecture:
 * - Pure state in rendererMachine (XState)
 * - Side effects in RenderSystem (execution layer)
 * - Coordinator calls this interface (no machine knowledge)
 *
 */
export interface IRenderSystem {
  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Mount the renderer with a DOM container.
   * Triggers MOUNT event → waitingForLayout state.
   */
  mount(container: HTMLElement): void;

  /**
   * Unmount the renderer and clean up resources.
   * Triggers UNMOUNT event → disposing state.
   */
  unmount(): void;

  /**
   * Signal that layout is ready with dimensions.
   * Triggers LAYOUT_READY event → initializing state.
   */
  layoutReady(width: number, height: number): void;

  /**
   * Signal that renderer initialization is complete.
   * Called by execution layer after renderer and bridges are created.
   * Triggers INITIALIZED event → ready state.
   */
  rendererInitialized(sheetId: string): void;

  /**
   * Switch to a different sheet.
   * Triggers SWITCH_SHEET event → switchingSheet state.
   */
  switchSheet(sheetId: string): void;

  /**
   * Suspend the renderer (tab hidden).
   * Pauses render loop to save CPU/battery.
   */
  suspend(): void;

  /**
   * Resume the renderer (tab visible).
   * Resumes render loop.
   */
  resume(): void;

  /**
   * Handle container resize.
   * Updates canvas dimensions and invalidates render.
   */
  resize(width: number, height: number): void;

  /**
   * Queue an action to be executed when renderer becomes ready.
   * Used for operations that arrive before renderer initialization completes.
   */
  queueAction(action: PendingAction): void;

  // ===========================================================================
  // Viewport State
  // ===========================================================================

  /**
   * Set the scroll position.
   * Updates renderer viewport and saves per-sheet scroll position.
   */
  setScrollPosition(position: Point): void;

  /**
   * Get the current scroll position (pixel-level).
   * Returns {x: 0, y: 0} if renderer not yet initialized.
   */
  getScrollPosition(): Point;

  /**
   * Get the top-left visible cell (row, col) from the current viewport.
   * Uses viewport.getVisibleRange() to convert pixel scroll position to cell coordinates.
   * Returns null if coordinate system is not available.
   */
  getTopLeftVisibleCell(sheetId: string): { row: number; col: number } | null;

  /**
   * Get the sheet dimension bounds (total rows and columns).
   * Returns null if coordinate system is not available.
   */
  getSheetBounds(): { totalRows: number; totalCols: number } | null;

  /**
   * Set frozen panes configuration.
   * Updates renderer and saves per-sheet frozen panes state.
   */
  setFrozenPanes(panes: FrozenPanes): void;

  /**
   * Get current frozen panes configuration.
   */
  getFrozenPanes(): FrozenPanes;

  /**
   * Apply a cell-level scroll position by converting to pixels via VPI.
   * Used when Rust ground truth is loaded after initial render.
   * Also syncs InputCoordinator via onScrollPositionReset.
   * No-op if VPI is not available or position is (0,0).
   */
  applyCellLevelScroll(topRow: number, leftCol: number): void;

  /**
   * Zoom and scroll to fit the current selection in view.
   * Called from View ribbon "Zoom to Selection" button.
   */
  zoomToSelection(): void;

  // ===========================================================================
  // Context Configuration
  // ===========================================================================

  /**
   * Set the full render context coordination configuration.
   * Wires up actors and callbacks for context updates.
   * Called once during initialization.
   */
  setContextConfig(
    config: import('./execution/render-context-coordination').RenderContextCoordinationConfig,
  ): void;

  /**
   * Update renderer context with partial configuration changes.
   * Used for dynamic updates (view options, zoom, RTL, etc.)
   */
  updateContext(config: Partial<RenderContextConfig>): void;

  // ===========================================================================
  // Zoom Control
  // ===========================================================================

  /**
   * Set zoom level (0.1 to 4.0, i.e., 10% to 400%).
   */
  setZoom(zoom: number): void;

  /**
   * Get current zoom level (1.0 = 100%).
   */
  getZoom(): number;

  // ===========================================================================
  // Renderer Access
  // ===========================================================================

  /**
   * Get the current renderer instance.
   * @deprecated Use capability-based accessors (getGeometry, getHitTest,
   * getRenderCapability, getObjects, getInteractiveElements, getRenderState).
   * Will be removed once all callers in sheet-coordinator, use-grid-mouse,
   * use-renderer-actions, and event-subscriptions are migrated.
   * Returns null if renderer not yet initialized.
   */
  getRenderer(): GridRenderer | null;

  // ===========================================================================
  // Capability Accessors (public API — prefer over getRenderer)
  // ===========================================================================

  /** Geometry queries — cell rects, page rects, dimensions, merge anchors. */
  getGeometry(): ISheetViewGeometry | null;

  /** Hit testing — classify viewport/page points against all rendered layers. */
  getHitTest(): ISheetViewHitTest | null;

  /** Render invalidation and current sheet identity. */
  getRenderCapability(): ISheetViewRender | null;

  /** Viewport — scroll, frozen panes, split views, layout. */
  getViewport(): ISheetViewViewport | null;

  /** Floating object scene — synchronous bounds reads and transient updates. */
  getObjects(): ISheetViewObjects | null;

  /** Interactive element observation. */
  getInteractiveElements(): ISheetViewInteractiveElements | null;

  /** Render state — push visual state to the renderer. */
  getRenderState(): ISheetViewRenderState | null;

  /** Get the underlying SheetView instance. */
  getSheetView(): SheetViewHandle | null;

  /**
   * Get the renderer container element.
   * Returns null if renderer not yet initialized.
   */
  getContainer(): HTMLElement | null;

  /**
   * Get the most-recently-computed viewport layout (per-pane bounds, cell ranges,
   * scroll offsets, dividers). Returns null until the first layout pass completes.
   *
   * Tests use this to assert that the main pane's `cellRange.startRow` is at or
   * past `frozenRows` — catching freeze-pane bugs where the renderer is asked to
   * paint frozen cells in the scrollable area on top of duplicating them in the
   * frozen pane.
   */
  getViewportLayout(): ViewportLayout | null;

  /**
   * Get the document-space y-coordinate of the top edge of `row` from the
   * active SheetView's position index. Returns null if not yet ready.
   *
   * Combined with getViewportLayout(), tests can compute the actual canvas y
   * the renderer paints each row's top edge at, and assert the first row of
   * each pane lands flush with the pane's bounds.y (no phantom gap).
   */
  getRowTop(row: number): number | null;

  /**
   * Get a snapshot of renderer state.
   * Used for debugging and external state queries.
   */
  getRendererSnapshot(): RendererSnapshot;

  // ===========================================================================
  // Page Break Preview Mode
  // ===========================================================================

  /**
   * DragTerminator for page break drag operations.
   * Called by coordinator on pointer-up to complete page break drags.
   */
  readonly pageBreakDragTerminator: DragTerminator;

  /**
   * Hit test for page break lines at the given pixel coordinates.
   * Returns hit result if a page break line is under the cursor.
   */
  hitTestPageBreak(
    x: number,
    y: number,
  ): Promise<import('./features/page-break/page-break-coordination').PageBreakHitResult | null>;

  /**
   * Get the current page break drag state for rendering.
   * Returns null if not dragging a page break.
   */
  getPageBreakDragState():
    | import('./execution/render-context-coordination').PageBreakDragState
    | null;

  /**
   * Start a page break drag operation.
   * @param hitResult - The hit test result from hitTestPageBreak
   * @param x - Mouse X position
   * @param y - Mouse Y position
   */
  startPageBreakDrag(
    hitResult: import('./features/page-break/page-break-coordination').PageBreakHitResult,
    x: number,
    y: number,
  ): void;

  /**
   * Update a page break drag operation.
   * @param x - Mouse X position
   * @param y - Mouse Y position
   */
  updatePageBreakDrag(x: number, y: number): void;

  /**
   * Check if a page break is currently being dragged.
   */
  isPageBreakDragging(): boolean;

  // ===========================================================================
  // Renderer Dependencies (React component wiring)
  // ===========================================================================

  /**
   * Set renderer dependencies from the React component layer.
   * Delegates to the internal renderer execution module.
   * Called by useRendererDependencies hook after mount.
   */
  setRendererDependencies(
    dependencies: import('../../coordinator/types').RendererDependencies,
  ): void;

  // ===========================================================================
  // Feature Integration
  // ===========================================================================

  /**
   * Set the sparkline manager for rendering sparklines.
   * Called when SparklineManager becomes available.
   */
  setSparklineManager(manager: import('@mog-sdk/contracts/sparklines').ISparklineManager): void;

  /**
   * Wire the viewport-follow coordinator (selection actor →
   * SCROLL_TO_ACTIVE_CELL). Called by the composition root after both this
   * system and the selection actor have been created. The cleanup is owned
   * by RenderSystem and runs in dispose().
   *
   * @see ./coordination/viewport-follow-coordination.ts
   */
  setSelectionActorForViewportFollow(
    selectionActor: import('./coordination/viewport-follow-coordination').SelectionActor,
  ): void;

  /**
   * Get event subscription wiring result.
   * Provides handles for dynamic feature wiring (sparklines, CF, tables).
   * Returns null if subscriptions not yet set up.
   */
  getEventSubscriptions():
    | import('./subscriptions/event-subscriptions').EventSubscriptionResult
    | null;

  // ===========================================================================
  // Actor Access Layer (Complete, Opaque)
  // ===========================================================================

  /**
   * Actor access layer for this system.
   * Provides typed access to renderer actor state and commands.
   *
   * This is the ONLY way to access actor state from outside the system.
   * No direct actor references are exposed.
   */
  readonly access: RenderActorAccess;

  // ===========================================================================
  // Cross-System Coordination
  // ===========================================================================

  /**
   * Invalidate the renderer and trigger a re-render.
   * Used by other systems to request render updates.
   */
  invalidate(reason?: string): void;

  /**
   * Register a callback to be invoked when the renderer is ready.
   * Returns an unsubscribe function.
   *
   * Used by systems that need to perform one-time initialization
   * after the renderer is available (e.g., bridge wiring).
   */
  onReady(callback: () => void): () => void;

  /**
   * Synchronize outline/grouping gutter visibility.
   * Updates renderer context when row/column grouping changes.
   * Called by layout coordination when grouping state changes.
   */
  syncOutlineGutter(): void;

  // ===========================================================================
  // System Lifecycle
  // ===========================================================================

  /**
   * Start the system.
   * Called after construction to begin operation.
   * Sets up subscriptions and initializes internal state.
   */
  start(): void;

  /**
   * Dispose the system and clean up all resources.
   * Stops subscriptions, disposes renderer, and releases memory.
   */
  dispose(): void;
}
