/**
 * RenderSystem - Canvas renderer lifecycle and viewport coordination.
 *
 * of Stream 1: Spreadsheet Subsystem Architecture.
 *
 * This system owns the entire renderer subsystem:
 * - Renderer state machine (rendererMachine) - created and managed internally
 * - Page break state machine (pageBreakMachine) - created and managed internally
 * - Renderer execution (canvas lifecycle, viewport layout)
 * - Render context coordination (actor states -> RenderContextConfig)
 * - Event subscriptions (EventBus -> renderer sync)
 * - Layout coordination (resize, dimensions, outline gutter)
 * - Slicer cache invalidation
 * - Filter integration (Yjs observer -> filter application)
 * - Page break drag interaction
 * - Actor access layer (accessors, commands, selectors)
 *
 * ARCHITECTURE:
 * - Constructor-complete: fully configured at construction time, no setDependencies()
 * - Owns both actors (creates, starts, stops them)
 * - Wraps existing modules - does not reinvent logic
 * - Pure state in machines, side effects in execution layer
 * - DragTerminator for page break pointer-up coordination
 *
 * @module apps/spreadsheet/src/systems/renderer
 */

import { createActor } from 'xstate';

import { rendererSelectors } from '../../selectors';
import type {
  PendingAction,
  RendererAccessor,
  RendererState as RendererSelectorState,
} from '@mog-sdk/contracts/actors';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  CellCoord,
  FrozenPanes,
  GridRenderer,
  RenderContextConfig,
} from '@mog-sdk/contracts/rendering';
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

import type { ISparklineManager as SparklineManager } from '@mog-sdk/contracts/sparklines';
import type { DragTerminator } from '../shared/drag-terminator';
import { createRendererCommands } from './actor-access/renderer-commands';
import {
  setupViewportFollowCoordination,
  type SelectionActor as ViewportFollowSelectionActor,
} from './coordination/viewport-follow-coordination';
import { getSelectionSnapshot } from '../grid-editing/machines/selection/derived-state';
import { calculateZoomToSelection } from '../../infra/utils/zoom-to-selection';
import { lifecycleDebug } from './debug/debug-lifecycle';
import type { PageBreakDragState } from './execution/render-context-coordination';
import {
  setupRenderContextCoordination,
  type RenderContextCoordinationConfig,
} from './execution/render-context-coordination';
import {
  setupRendererExecution,
  type RendererExecutionResult,
} from './execution/renderer-execution';
import {
  PageBreakCoordinator,
  type PageBreakHitResult,
} from './features/page-break/page-break-coordination';
import {
  getRendererSnapshot,
  rendererMachine,
  type RendererActor,
} from './machines/grid-renderer-machine';
import { pageBreakMachine, type PageBreakActor } from './machines/page-break-machine';
import {
  setupEventSubscriptions,
  type EventSubscriptionResult,
} from './subscriptions/event-subscriptions';

import type {
  IRenderSystem,
  RenderActorAccess,
  RenderSystemConfig,
  RendererSnapshot,
  RenderContextConfig as SystemRenderContextConfig,
} from './types';

// =============================================================================
// RENDERER ACCESSOR FACTORY (inline — no separate file needed)
// =============================================================================

/**
 * Create a RendererAccessor from a renderer actor.
 * Wraps actor.getSnapshot() + selectors for point-in-time reads.
 */
function createRendererAccessor(actor: { getSnapshot(): unknown }): RendererAccessor {
  const snap = () => actor.getSnapshot() as RendererSelectorState;

  return {
    // Value Accessors
    getContainer: () => rendererSelectors.container(snap()),
    getWidth: () => rendererSelectors.width(snap()),
    getHeight: () => rendererSelectors.height(snap()),
    getCurrentSheetId: () => rendererSelectors.currentSheetId(snap()),
    getTargetSheetId: () => rendererSelectors.targetSheetId(snap()),
    getPendingActions: () => rendererSelectors.pendingActions(snap()),
    getError: () => rendererSelectors.error(snap()),
    getRetryCount: () => rendererSelectors.retryCount(snap()),
    getMaxRetries: () => rendererSelectors.maxRetries(snap()),

    // State Matching Accessors
    isUnmounted: () => rendererSelectors.isUnmounted(snap()),
    isWaitingForLayout: () => rendererSelectors.isWaitingForLayout(snap()),
    isInitializing: () => rendererSelectors.isInitializing(snap()),
    isReady: () => rendererSelectors.isReady(snap()),
    isSwitchingSheet: () => rendererSelectors.isSwitchingSheet(snap()),
    isSuspended: () => rendererSelectors.isSuspended(snap()),
    isError: () => rendererSelectors.isError(snap()),
    isDisposing: () => rendererSelectors.isDisposing(snap()),

    // Derived Accessors
    getStatus: () => rendererSelectors.status(snap()),
    isSwitching: () => rendererSelectors.isSwitching(snap()),
    canAcceptOperations: () => rendererSelectors.canAcceptOperations(snap()),
    hasValidDimensions: () => rendererSelectors.hasValidDimensions(snap()),
    hasPendingActions: () => rendererSelectors.hasPendingActions(snap()),
    canRetry: () => rendererSelectors.canRetry(snap()),
  };
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * RenderSystem implementation.
 *
 * Creates and owns renderer and page break state machine actors. Provides
 * the actor access layer, renderer execution, render context coordination,
 * event subscriptions, layout coordination, and page break drag interaction.
 *
 * @example
 * const renderSystem = new RenderSystem(config);
 * renderSystem.start();
 *
 * // Mount renderer to DOM
 * renderSystem.mount(container);
 * renderSystem.layoutReady(width, height);
 *
 * // After initialization
 * renderSystem.setScrollPosition({ x: 0, y: 100 });
 * renderSystem.invalidate('data changed');
 *
 * // Cleanup
 * renderSystem.dispose();
 */
export class RenderSystem implements IRenderSystem {
  // ===========================================================================
  // Private State
  // ===========================================================================

  /** The owned renderer state machine actor */
  private readonly rendererActor: RendererActor;

  /** The owned page break state machine actor */
  private readonly pageBreakActor: PageBreakActor;

  /** Configuration provided at construction time */
  private readonly config: RenderSystemConfig;

  /** Renderer execution module result */
  private rendererExecution: RendererExecutionResult | null = null;

  /** Render context coordination cleanup */
  private renderContextCleanup: (() => void) | null = null;

  /** Render context coordination config (stored for lazy setup) */
  private contextConfig: RenderContextCoordinationConfig | null = null;

  /** Event subscriptions result */
  private eventSubscriptions: EventSubscriptionResult | null = null;

  /** Page break coordinator */
  private readonly pageBreakCoordinator: PageBreakCoordinator;

  /** Whether the system has been started */
  private started = false;

  /** Whether the system has been disposed */
  private disposed = false;

  /** Ready callbacks (invoked when renderer transitions to ready) */
  private readonly readyCallbacks = new Set<() => void>();

  /** Renderer state subscription cleanup */
  private stateSubscription: { unsubscribe(): void } | null = null;

  /**
   * Subscription cleanup for the machine's `scrollToActiveCellRequested`
   * emitted event. The renderer machine emits this from its SCROLL_TO_ACTIVE_CELL
   * event handler; RenderSystem owns the side effect (coords + scroll).
   */
  private scrollToActiveCellSubscription: { unsubscribe(): void } | null = null;

  /**
   * Cleanup for the viewport-follow coordinator (selection actor →
   * SCROLL_TO_ACTIVE_CELL). Wired by setSelectionActorForViewportFollow when
   * the selection actor becomes available; disposed in dispose().
   */
  private viewportFollowCleanup: (() => void) | null = null;

  /** Selection actor retained for renderer-owned commands such as Zoom to Selection. */
  private selectionActor: ViewportFollowSelectionActor | null = null;

  /** Previous renderer state for transition detection */
  private previousRendererState: string | null = null;

  // ===========================================================================
  // Actor Access Layer (built once at construction)
  // ===========================================================================

  /**
   * Complete actor access layer for the render system.
   * Built at construction time from the internal actors.
   */
  readonly access: RenderActorAccess;

  // ===========================================================================
  // DragTerminator for Page Break
  // ===========================================================================

  /**
   * DragTerminator for page break drag operations.
   * Called by coordinator on pointer-up to complete page break drags.
   */
  readonly pageBreakDragTerminator: DragTerminator = {
    endDrag: () => {
      this.pageBreakCoordinator.endDrag();
    },
    cancelDrag: () => {
      this.pageBreakCoordinator.cancelDrag();
    },
  };

  // ===========================================================================
  // Constructor
  // ===========================================================================

  constructor(config: RenderSystemConfig) {
    this.config = config;

    // Create the renderer actor (not started yet - start() does that)
    this.rendererActor = createActor(rendererMachine);

    // Create the page break actor (not started yet - start() does that)
    this.pageBreakActor = createActor(pageBreakMachine);

    // Create page break coordinator
    this.pageBreakCoordinator = new PageBreakCoordinator();

    // Build the actor access layer from internal actors
    const accessor = createRendererAccessor(this.rendererActor);
    const commands = createRendererCommands(this.rendererActor);

    this.access = {
      accessors: { renderer: accessor },
      commands: { renderer: commands },
      selectors: { renderer: rendererSelectors },
      actors: {
        renderer: this.rendererActor,
        pageBreak: this.pageBreakActor,
      },
    };
  }

  // ===========================================================================
  // Lifecycle (IRenderSystem)
  // ===========================================================================

  mount(container: HTMLElement): void {
    if (this.disposed || !this.started) return;
    lifecycleDebug.stateEvent('RenderSystem.mount() called');
    this.rendererActor.send({ type: 'MOUNT', container });
  }

  unmount(): void {
    if (this.disposed) return;
    lifecycleDebug.stateEvent('RenderSystem.unmount() called');
    this.rendererActor.send({ type: 'UNMOUNT' });
  }

  layoutReady(width: number, height: number): void {
    if (this.disposed || !this.started) return;
    lifecycleDebug.stateEvent('RenderSystem.layoutReady() called', { width, height });
    this.rendererActor.send({ type: 'LAYOUT_READY', width, height });
  }

  rendererInitialized(sheetId: string): void {
    if (this.disposed || !this.started) return;
    lifecycleDebug.stateEvent('RenderSystem.rendererInitialized() called', { sheetId });
    this.rendererActor.send({ type: 'INITIALIZED', sheetId });
  }

  switchSheet(sheetId: string): void {
    if (this.disposed || !this.started) return;
    lifecycleDebug.stateEvent('RenderSystem.switchSheet() called', { sheetId });
    this.rendererActor.send({ type: 'SWITCH_SHEET', sheetId });
  }

  suspend(): void {
    if (this.disposed || !this.started) return;
    lifecycleDebug.stateEvent('RenderSystem.suspend() called');
    this.rendererActor.send({ type: 'SUSPEND' });
  }

  resume(): void {
    if (this.disposed || !this.started) return;
    lifecycleDebug.stateEvent('RenderSystem.resume() called');
    this.rendererActor.send({ type: 'RESUME' });
  }

  resize(width: number, height: number): void {
    if (this.disposed || !this.started) return;
    // Delegate to renderer execution (handles both machine event and side effect)
    this.rendererExecution?.resize(width, height);
  }

  queueAction(action: PendingAction): void {
    if (this.disposed || !this.started) return;
    this.rendererActor.send({ type: 'QUEUE_ACTION', action });
  }

  // ===========================================================================
  // Viewport State (IRenderSystem)
  // ===========================================================================

  setScrollPosition(position: Point): void {
    if (this.disposed || !this.started) return;
    this.rendererExecution?.setScrollPosition(position);
  }

  getScrollPosition(): Point {
    return this.rendererExecution?.getScrollPosition() ?? { x: 0, y: 0 };
  }

  getTopLeftVisibleCell(sheetId: string): { row: number; col: number } | null {
    void sheetId; // Capability API operates on the current sheet automatically.
    const geometry = this.getGeometry();
    if (!geometry) return null;
    const visibleRange = geometry.getVisibleRange();
    return { row: visibleRange.startRow, col: visibleRange.startCol };
  }

  getSheetBounds(): { totalRows: number; totalCols: number } | null {
    const geometry = this.getGeometry();
    if (!geometry) return null;
    const bounds = geometry.getSheetBounds();
    return { totalRows: bounds.totalRows, totalCols: bounds.totalCols };
  }

  setFrozenPanes(panes: FrozenPanes): void {
    if (this.disposed || !this.started) return;
    this.rendererExecution?.setFrozenPanes(panes);
  }

  getFrozenPanes(): FrozenPanes {
    return this.rendererExecution?.getFrozenPanes() ?? { rows: 0, cols: 0 };
  }

  setZoom(zoom: number): void {
    if (this.disposed || !this.started) return;
    this.rendererExecution?.setZoom(zoom);
  }

  getZoom(): number {
    return this.rendererExecution?.getZoom() ?? 1.0;
  }

  zoomToSelection(): void {
    if (this.disposed || !this.started) return;

    const geometry = this.getGeometry();
    const viewport = this.getViewport();
    if (!geometry || !viewport || !this.selectionActor) return;

    const selection = getSelectionSnapshot(this.selectionActor.getSnapshot());
    const selectionRange = selection.ranges[0] ?? {
      startRow: selection.activeCell.row,
      startCol: selection.activeCell.col,
      endRow: selection.activeCell.row,
      endCol: selection.activeCell.col,
    };
    const range = {
      startRow: Math.min(selectionRange.startRow, selectionRange.endRow),
      startCol: Math.min(selectionRange.startCol, selectionRange.endCol),
      endRow: Math.max(selectionRange.startRow, selectionRange.endRow),
      endCol: Math.max(selectionRange.startCol, selectionRange.endCol),
    };

    let rects = geometry.getRangeRects(range);
    if (rects.length === 0) {
      const scrollTarget = viewport.getScrollToCell(selection.activeCell);
      if (scrollTarget) {
        this.rendererExecution?.setScrollPosition(scrollTarget);
        this.rendererExecution?.getDependencies()?.onScrollPositionReset?.(scrollTarget);
        rects = geometry.getRangeRects(range);
      }
    }
    if (rects.length === 0) return;

    const viewportBounds = viewport.getViewportBounds();
    const target = calculateZoomToSelection({
      selection: range,
      viewportWidth: viewportBounds.width,
      viewportHeight: viewportBounds.height,
      positionDimensions: geometry.getPositionDimensions(),
      padding: 32,
      headerVisibility: geometry.getHeaderVisibility(),
    });

    this.setZoom(target.zoom);
    const sheetId = this.getRenderCapability()?.getCurrentSheetId();
    if (sheetId) {
      this.config.sheetSwitchDeps?.uiStoreApi
        .getState()
        .setZoomLevel?.(toSheetId(sheetId), target.zoom);
    }
    const targetScroll = viewport.clampScrollPosition({ x: target.scrollX, y: target.scrollY });
    this.rendererExecution?.setScrollPosition(targetScroll);
    this.rendererExecution?.getDependencies()?.onScrollPositionReset?.(targetScroll);
  }

  applyCellLevelScroll(topRow: number, leftCol: number): void {
    if (this.disposed || !this.started) return;
    if (topRow === 0 && leftCol === 0) return;

    // Use geometry capability to convert cell-level scroll to pixels.
    const geometry = this.getGeometry();
    if (!geometry) return;

    const rowDims = geometry.getDimensions({ row: topRow, col: 0 });
    const colDims = geometry.getDimensions({ row: 0, col: leftCol });
    const rowDim = rowDims.find((d: any) => 'top' in d);
    const colDim = colDims.find((d: any) => 'left' in d);
    if (!rowDim || !('top' in rowDim) || !colDim || !('left' in colDim)) return;

    const pixelPos: Point = { x: colDim.left, y: rowDim.top };

    this.rendererExecution?.setScrollPosition(pixelPos);

    // Sync InputCoordinator's physics engine to the restored scroll position.
    // setScrollPosition does NOT call onScrollPositionReset, so we must do it explicitly.
    const deps = this.rendererExecution?.getDependencies();
    deps?.onScrollPositionReset?.(pixelPos);
  }

  // ===========================================================================
  // Context Configuration (IRenderSystem)
  // ===========================================================================

  setContextConfig(config: RenderContextCoordinationConfig): void {
    if (this.disposed) return;
    lifecycleDebug.setRenderContextConfig();
    this.contextConfig = config;

    // If renderer is already started and ready, set up coordination immediately
    if (this.started) {
      this.setupRenderContextCoordination();
    }
  }

  updateContext(config: Partial<SystemRenderContextConfig>): void {
    if (this.disposed || !this.started) return;
    this.rendererExecution?.updateContext(config as Partial<RenderContextConfig>);
  }

  // ===========================================================================
  // Renderer Access (IRenderSystem)
  // ===========================================================================

  /**
   * @deprecated Use capability-based accessors (getGeometry, getHitTest,
   * getRenderCapability, getObjects, getInteractiveElements, getRenderState).
   * Will be removed once all callers in sheet-coordinator, use-grid-mouse,
   * use-renderer-actions, and event-subscriptions are migrated.
   */
  getRenderer(): GridRenderer | null {
    return this.rendererExecution?.getRenderer() ?? null;
  }

  getContainer(): HTMLElement | null {
    return this.rendererExecution?.getContainer() ?? null;
  }

  getViewportLayout(): ViewportLayout | null {
    return (
      (this.rendererExecution?.getSheetView()?.viewport.getLayout() as
        | ViewportLayout
        | null
        | undefined) ?? null
    );
  }

  // ===========================================================================
  // Capability Accessors (public API — prefer these over getRenderer)
  // ===========================================================================

  /** Geometry queries — cell rects, page rects, dimensions, merge anchors. */
  getGeometry(): ISheetViewGeometry | null {
    return this.rendererExecution?.getGeometry() ?? null;
  }

  /** Hit testing — classify viewport/page points against all rendered layers. */
  getHitTest(): ISheetViewHitTest | null {
    return this.rendererExecution?.getHitTest() ?? null;
  }

  /** Render invalidation and current sheet identity. */
  getRenderCapability(): ISheetViewRender | null {
    return this.rendererExecution?.getRender() ?? null;
  }

  /** Viewport — scroll, frozen panes, split views, layout. */
  getViewport(): ISheetViewViewport | null {
    return this.rendererExecution?.getViewport() ?? null;
  }

  /** Floating object scene — synchronous bounds reads and transient updates. */
  getObjects(): ISheetViewObjects | null {
    return this.rendererExecution?.getObjects() ?? null;
  }

  /** Interactive element observation. */
  getInteractiveElements(): ISheetViewInteractiveElements | null {
    return this.rendererExecution?.getInteractiveElements() ?? null;
  }

  /** Render state — push visual state to the renderer. */
  getRenderState(): ISheetViewRenderState | null {
    return this.rendererExecution?.getRenderState() ?? null;
  }

  /** Get the underlying SheetView instance. */
  getSheetView(): SheetViewHandle | null {
    return this.rendererExecution?.getSheetView() ?? null;
  }

  /**
   * Returns the document-space y-coordinate of the top edge of the given row.
   * Uses the geometry capability when available; falls back to position index.
   * Returns null if not yet ready.
   */
  getRowTop(row: number): number | null {
    // Prefer geometry capability
    const geometry = this.getGeometry();
    if (geometry) {
      const dims = geometry.getDimensions({ row, col: 0 });
      const rowDim = dims.find((d: any) => 'top' in d);
      if (rowDim && 'top' in rowDim) return rowDim.top;
    }
    return null;
  }

  getRendererSnapshot(): RendererSnapshot {
    const state = this.rendererActor.getSnapshot();
    return getRendererSnapshot(state);
  }

  // ===========================================================================
  // Page Break Preview Mode (IRenderSystem)
  // ===========================================================================

  async hitTestPageBreak(x: number, y: number): Promise<PageBreakHitResult | null> {
    const result = await this.pageBreakCoordinator.hitTest(x, y);
    return result.hit ? result : null;
  }

  getPageBreakDragState(): PageBreakDragState | null {
    const dragState = this.pageBreakCoordinator.getDragState();
    if (!dragState.isDragging) return null;
    return {
      isDragging: dragState.isDragging,
      pageBreak: dragState.pageBreak,
      targetPosition: dragState.targetPosition,
    };
  }

  startPageBreakDrag(hitResult: PageBreakHitResult, x: number, y: number): void {
    this.pageBreakCoordinator.startDrag(hitResult, x, y);
  }

  updatePageBreakDrag(x: number, y: number): void {
    this.pageBreakCoordinator.updateDrag(x, y);
  }

  isPageBreakDragging(): boolean {
    return this.pageBreakCoordinator.isDragging();
  }

  // ===========================================================================
  // Renderer Dependencies (IRenderSystem)
  // ===========================================================================

  setRendererDependencies(
    dependencies: import('../../coordinator/types').RendererDependencies,
  ): void {
    if (this.disposed) return;
    this.rendererExecution?.setDependencies(dependencies);
  }

  // ===========================================================================
  // Feature Integration (IRenderSystem)
  // ===========================================================================

  setSparklineManager(manager: SparklineManager): void {
    if (this.disposed) return;
    // Wire sparkline events through event subscriptions
    if (this.eventSubscriptions) {
      const currentSheetId = () => this.rendererActor.getSnapshot().context.currentSheetId ?? '';
      this.eventSubscriptions.setSparklineConfig({
        sparklineManager: manager,
        getCurrentSheetId: currentSheetId,
      });
    }
  }

  /**
   * Wire the viewport-follow coordinator: when the selection actor emits
   * `userSelectionChanged`, scroll the active cell into view if needed.
   *
   * Called by the composition root after both RenderSystem and the selection
   * actor have been created. Replaces any prior subscription (so re-binding
   * during late dep arrival is safe).
   *
   * @see ./coordination/viewport-follow-coordination.ts
   */
  setSelectionActorForViewportFollow(selectionActor: ViewportFollowSelectionActor): void {
    if (this.disposed) return;
    this.selectionActor = selectionActor;
    if (this.viewportFollowCleanup) {
      this.viewportFollowCleanup();
      this.viewportFollowCleanup = null;
    }
    const result = setupViewportFollowCoordination({
      selectionActor,
      rendererActor: this.rendererActor,
      getViewport: () => this.rendererExecution?.getViewport() ?? null,
    });
    this.viewportFollowCleanup = result.cleanup;
  }

  getEventSubscriptions(): EventSubscriptionResult | null {
    return this.eventSubscriptions;
  }

  // ===========================================================================
  // Cross-System Coordination (IRenderSystem)
  // ===========================================================================

  invalidate(reason?: string): void {
    if (this.disposed || !this.started) return;
    if (reason) {
      lifecycleDebug.stateEvent(`RenderSystem.invalidate(): ${reason}`);
    }
    // Use the render capability API instead of direct GridRenderer access.
    const renderCap = this.getRenderCapability();
    if (renderCap) {
      renderCap.invalidate();
    }
  }

  onReady(callback: () => void): () => void {
    // If already ready, invoke immediately
    const snapshot = this.rendererActor.getSnapshot();
    if (snapshot.value === 'ready') {
      callback();
    }

    // Also register for future ready transitions
    this.readyCallbacks.add(callback);
    return () => {
      this.readyCallbacks.delete(callback);
    };
  }

  syncOutlineGutter(): void {
    if (this.disposed || !this.started) return;
    // Trigger viewport layout recomputation which picks up gutter changes
    this.rendererExecution?.recomputeLayout();
  }

  // ===========================================================================
  // System Lifecycle (IRenderSystem)
  // ===========================================================================

  start(): void {
    if (this.started || this.disposed) return;

    // Start actors
    this.rendererActor.start();
    this.pageBreakActor.start();

    // Set up renderer execution module
    this.rendererExecution = setupRendererExecution({
      rendererActor: this.rendererActor,
      viewport: this.config.viewport,
      workbook: this.config.workbook,
      onSparklineInvalidate: () => {
        // Sparkline invalidation on sheet switch is handled via the manager
        // which gets wired through setSparklineManager()
      },
    });

    // Set up event subscriptions — pass capability-based callbacks for
    // invalidation and getCurrentSheetId so subscriptions don't need
    // direct GridRenderer access.
    if (this.config.workbook) {
      this.eventSubscriptions = setupEventSubscriptions({
        workbook: this.config.workbook,
        getRenderer: () => this.rendererExecution?.getRenderer() ?? null,
        invalidateAll: () => {
          const renderCap = this.getRenderCapability();
          if (renderCap) {
            renderCap.invalidate();
          }
        },
        getCurrentSheetId: () => {
          const renderCap = this.getRenderCapability();
          return renderCap?.getCurrentSheetId() ?? null;
        },
        updateRendererContext: (config) => {
          this.rendererExecution?.updateContext(config);
        },
        setFrozenPanes: (panes) => {
          this.rendererExecution?.setFrozenPanes(panes);
        },
        setViewportConfig: (config) => {
          this.rendererExecution?.setViewportConfig(config);
        },
      });
    }

    // Subscribe to the machine's scrollToActiveCellRequested emitted event.
    // The machine stays pure: SCROLL_TO_ACTIVE_CELL → emit → this handler
    // applies the side effect using the coordinate system + scroll engine.
    this.scrollToActiveCellSubscription = this.rendererActor.on(
      'scrollToActiveCellRequested',
      (event) => {
        this.applyScrollToActiveCell(event.cell);
      },
    );

    // Subscribe to renderer state transitions for ready callbacks
    this.stateSubscription = this.rendererActor.subscribe((state) => {
      const currentState = state.value as string;

      // Detect transition to 'ready' state
      if (currentState === 'ready' && this.previousRendererState !== 'ready') {
        lifecycleDebug.stateEvent('RenderSystem: renderer became ready');
        // Fire ready callbacks
        for (const callback of this.readyCallbacks) {
          try {
            callback();
          } catch (err) {
            lifecycleDebug.error('Ready callback error', err);
          }
        }
      }

      this.previousRendererState = currentState;
    });

    // Set up render context coordination if config was set before start()
    if (this.contextConfig) {
      this.setupRenderContextCoordination();
    }

    this.started = true;
  }

  dispose(): void {
    if (this.disposed) return;

    lifecycleDebug.stateEvent('RenderSystem.dispose() called');

    // Clean up render context coordination
    if (this.renderContextCleanup) {
      this.renderContextCleanup();
      this.renderContextCleanup = null;
    }

    // Clean up event subscriptions
    if (this.eventSubscriptions) {
      this.eventSubscriptions.cleanup();
      this.eventSubscriptions = null;
    }

    // Clean up renderer execution
    if (this.rendererExecution) {
      this.rendererExecution.cleanup();
      this.rendererExecution = null;
    }

    // Clean up page break coordinator
    this.pageBreakCoordinator.dispose();

    // Unsubscribe from emitted events
    if (this.scrollToActiveCellSubscription) {
      this.scrollToActiveCellSubscription.unsubscribe();
      this.scrollToActiveCellSubscription = null;
    }

    // Tear down viewport-follow coordinator subscription on selection actor
    if (this.viewportFollowCleanup) {
      this.viewportFollowCleanup();
      this.viewportFollowCleanup = null;
    }

    // Unsubscribe from state changes
    if (this.stateSubscription) {
      this.stateSubscription.unsubscribe();
      this.stateSubscription = null;
    }

    // Stop actors
    if (this.started) {
      this.rendererActor.stop();
      this.pageBreakActor.stop();
    }

    // Clear callbacks
    this.readyCallbacks.clear();

    this.contextConfig = null;
    this.disposed = true;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Set up render context coordination.
   * Called when both start() has been called and contextConfig is available.
   */
  private setupRenderContextCoordination(): void {
    if (!this.contextConfig || this.renderContextCleanup) return;

    this.renderContextCleanup = setupRenderContextCoordination(this.contextConfig);
  }

  /**
   * Apply the scroll-to-active-cell side effect.
   *
   * The renderer machine emits `scrollToActiveCellRequested` from its
   * SCROLL_TO_ACTIVE_CELL event handler; the machine itself is pure and does
   * not access the coordinate system. RenderSystem owns the viewport
   * + scroll-engine seam, so the side effect lives here.
   *
   * No-op when disposed/unstarted or when the viewport has not yet hydrated.
   */
  private applyScrollToActiveCell(cell: CellCoord): void {
    if (this.disposed || !this.started) return;

    const viewport = this.rendererExecution?.getViewport() ?? null;
    if (!viewport) return;

    const scrollPos = viewport.getScrollToCell({ row: cell.row, col: cell.col });
    if (scrollPos) {
      const position = { x: scrollPos.x, y: scrollPos.y };
      this.rendererExecution?.setScrollPosition(position);
      // Sync InputCoordinator's physics engine to the new scroll position.
      // Without this, the InputCoordinator resets the renderer scroll back to
      // its own (stale) position on the next animation frame.
      const deps = this.rendererExecution?.getDependencies();
      deps?.onScrollPositionReset?.(position);
    }
  }
}
