/**
 * Renderer Execution Module — thin delegation to @mog-sdk/sheet-view.
 *
 * SheetView owns the rendering substrate (canvas engine, grid layers, VPI/VMI,
 * viewport region lifecycle, layout, scroll math). This module:
 * 1. Subscribes to the XState rendererMachine and maps transitions to
 * SheetView lifecycle calls (attach / engine.start / suspend / resume /
 * switchSheet / dispose).
 * 2. Adapts the app's RendererDependencies injection to SheetView's config
 * (viewport resolver, sheet-state lookups, culture).
 * 3. Wires app-specific callbacks: onRendererCreated (bridges),
 * onSparklineInvalidate (sheet switch), UIStore scroll persistence.
 * 4. Exposes a thin result object that delegates to SheetView.
 *
 * @see views/sheet-view/src/sheet-view.ts
 */

import { getCulture } from '@mog/culture';
import {
  createSheetView,
  type ISheetViewGeometry,
  type ISheetViewHitTest,
  type ISheetViewRender,
  type ISheetViewViewport,
  type ISheetViewObjects,
  type ISheetViewInteractiveElements,
  type ISheetViewRenderState,
  type SheetViewHandle,
} from '@mog-sdk/sheet-view';
import type { FrozenPanes, GridRenderer, RenderContextConfig } from '@mog-sdk/contracts/rendering';
import type { WorkbookViewport } from '@mog-sdk/contracts/api';
// Use the app-local RendererDependencies — it narrows onRendererCreated to
// SheetView (contracts keeps an opaque SheetViewRef to avoid hardware-package
// dependencies in the type surface).
import type { RendererDependencies } from '../../../coordinator/types';
import type {
  OverlayViewportConfig,
  PersistedViewportConfig,
  Point,
  ViewportLayout,
} from '@mog-sdk/contracts/viewport';

import type { RendererActor } from '../machines/grid-renderer-machine';
import { resolveCellLevelScrollPosition } from './cell-scroll';

const INTERNAL_GRID_RENDERER_KEY = '__mogInternalGridRenderer';

// =============================================================================
// CONFIGURATION INTERFACE
// =============================================================================

/** Configuration for setting up renderer execution. */
export interface RendererExecutionConfig {
  rendererActor: RendererActor;
  /** Called when sparklines should be invalidated (sheet switch). */
  onSparklineInvalidate?: () => void;
  /** Carried for parity with pre-extraction shape; SheetView reads the
   * viewport off `workbook.viewport` inside `attach`. */
  viewport?: WorkbookViewport;
  /** Workbook handle — SheetView needs this for `attach()`. */
  workbook?: import('@mog-sdk/contracts/api').Workbook;
}

// =============================================================================
// RESULT INTERFACE
// =============================================================================

/**
 * Result returned by setupRendererExecution. Delegates almost everything to
 * the SheetView substrate; see views/sheet-view/src/sheet-view.ts for the
 * canonical docs on each method's semantics.
 *
 * New code should prefer capability-based accessors (getGeometry, getHitTest,
 * getRender, getObjects, etc.) rather than getRenderer.
 *
 * `getRenderer()` is retained for downstream callers that still consume the
 * full GridRenderer interface (input coordination, scroll physics). It will be
 * migrated incrementally as the capability API surface covers more use cases.
 */
export interface RendererExecutionResult {
  // ---- Instance Accessors -------------------------------------------------
  getContainer(): HTMLElement | null;
  /**
   * @deprecated Use capability-based accessors (getGeometry, getHitTest, getRender,
   * getObjects, getInteractiveElements, getRenderState). Will be removed once all
   * callers in sheet-coordinator, use-grid-mouse, use-renderer-actions, and
   * event-subscriptions are migrated.
   */
  getRenderer(): GridRenderer | null;
  getSheetView(): SheetViewHandle | null;
  // ---- Capability Accessors -----------------------------------------------
  /** Geometry queries — cell rects, page rects, dimensions, merge anchors. */
  getGeometry(): ISheetViewGeometry | null;
  /** Hit testing — classify viewport/page points against all rendered layers. */
  getHitTest(): ISheetViewHitTest | null;
  /** Render invalidation and current sheet identity. */
  getRender(): ISheetViewRender | null;
  /** Viewport — scroll, frozen panes, split views, layout. */
  getViewport(): ISheetViewViewport | null;
  /** Floating object scene — synchronous bounds reads and transient updates. */
  getObjects(): ISheetViewObjects | null;
  /** Interactive element observation. */
  getInteractiveElements(): ISheetViewInteractiveElements | null;
  /** Render state — push visual state to the renderer. */
  getRenderState(): ISheetViewRenderState | null;

  // ---- Dependency Management ----------------------------------------------
  /** Returns true if this call set up the execution subscription (first-call only). */
  setDependencies(dependencies: RendererDependencies): boolean;
  getDependencies(): RendererDependencies | null;

  // ---- Renderer Operations ------------------------------------------------
  resize(width: number, height: number): void;
  updateContext(config: Partial<RenderContextConfig>): void;
  /** @deprecated Use setViewportConfig() with FreezeViewportConfig instead. */
  setFrozenPanes(panes: FrozenPanes): void;
  /** @deprecated Use viewport layout instead. */
  getFrozenPanes(): FrozenPanes;
  setZoom(zoom: number): void;
  getZoom(): number;

  // ---- Viewport Architecture ---------------------------------------------
  setScrollPosition(position: Point, viewportId?: string): void;
  getScrollPosition(viewportId?: string): Point;
  getAllScrollPositions(): Map<string, Point>;
  setAllScrollPositions(positions: Map<string, Point>): void;
  setViewportConfig(config: PersistedViewportConfig): void;
  getViewportConfig(): PersistedViewportConfig;
  addOverlayViewport(config: OverlayViewportConfig): void;
  removeOverlayViewport(id: string): void;
  getViewportLayout(): ViewportLayout | null;
  recomputeLayout(): void;

  // ---- Lifecycle ----------------------------------------------------------
  cleanup(): void;
}

type SheetViewHandleWithInternalRenderer = SheetViewHandle & {
  readonly [INTERNAL_GRID_RENDERER_KEY]?: GridRenderer;
};

// =============================================================================
// SETUP FUNCTION
// =============================================================================

/** Wire the renderer actor to SheetView's lifecycle and expose a thin result. */
export function setupRendererExecution(config: RendererExecutionConfig): RendererExecutionResult {
  const { rendererActor, onSparklineInvalidate, viewport: viewportAPI } = config;

  // ===========================================================================
  // MODULE STATE
  // ===========================================================================

  /** Outer container from MOUNT — SheetView creates its own inner container inside it. */
  let rendererContainer: HTMLElement | null = null;

  /** The SheetView substrate. Created on LAYOUT_READY, disposed on UNMOUNT/DISPOSING. */
  let sheetView: SheetViewHandle | null = null;

  /**
   * Cached reference to SheetView's GridRenderer facade.
   * @deprecated Retained for callers not yet migrated to capability APIs.
   * New code should use sheetView.render / sheetView.geometry / etc. instead.
   */
  let underlyingRenderer: GridRenderer | null = null;

  /** Dependencies set by the React layer after mount. */
  let rendererDependencies: RendererDependencies | null = null;

  /** State-machine subscription cleanup. */
  let executionSubscription: { unsubscribe: () => void } | null = null;

  function resolveSavedScrollPosition(deps: RendererDependencies, sheetId: string): Point {
    let scroll = deps.getInitialScrollPosition?.(sheetId) ?? { x: 0, y: 0 };
    if (scroll.x !== 0 || scroll.y !== 0 || !sheetView) {
      return scroll;
    }

    const cellScroll = deps.sheetStateProvider.getScrollPosition(sheetId);
    const topRow = cellScroll.topRow ?? 0;
    const leftCol = cellScroll.leftCol ?? 0;
    if (topRow <= 0 && leftCol <= 0) {
      return scroll;
    }

    // Fall back to the workbook-persisted cell top-left for first visits after
    // load, matching the initial sheet path. Frozen panes pin rows/columns in
    // place, so scrollable pixels start after the frozen boundary.
    return (
      resolveCellLevelScrollPosition({
        geometry: sheetView.geometry,
        viewport: sheetView.viewport,
        topRow,
        leftCol,
      }) ?? scroll
    );
  }

  // ===========================================================================
  // STATE MACHINE SIDE-EFFECTS
  // ===========================================================================

  async function executeStateTransition(
    prevState: string | null,
    currentState: string,
    context: {
      container: HTMLElement | null;
      width: number;
      height: number;
      targetSheetId: string | null;
    },
  ): Promise<void> {
    switch (currentState) {
      case 'unmounted': {
        // Dispose SheetView — it owns the canvas engine, grid layers, resize
        // observer, etc. See ISSUE-16-REACT-STRICT-MODE-AND-DIMENSIONS.md for
        // why we handle this at 'unmounted' (Strict-mode skips 'disposing').
        if (sheetView) {
          sheetView.dispose();
          sheetView = null;
          underlyingRenderer = null;
        }
        rendererContainer = null;
        break;
      }

      case 'waitingForLayout': {
        // Grab the parent container. SheetView creates its own absolutely
        // positioned inner container inside this one.
        if (context.container) {
          rendererContainer = context.container;
        }
        break;
      }

      case 'initializing': {
        if (!rendererContainer || !rendererDependencies || sheetView) break;
        const deps = rendererDependencies;

        // -------------------------------------------------------------------
        // 1. Load the persisted viewport config for the initial sheet.
        // This must run BEFORE attach so SheetView computes the initial
        // layout against the right single/freeze/split topology.
        // -------------------------------------------------------------------
        const splitConfig = deps.sheetStateProvider.getSplitConfig(deps.initialSheetId);
        const frozenPanes = splitConfig
          ? null
          : deps.sheetStateProvider.getFrozenPanes(deps.initialSheetId);

        // -------------------------------------------------------------------
        // 2. Create SheetView. The app drives its own scroll physics, so we
        // disable SheetView's internal wheel handler.
        // -------------------------------------------------------------------
        const viewOptions = deps.sheetStateProvider.getSheetViewOptions(deps.initialSheetId);
        sheetView = createSheetView({
          container: rendererContainer,
          showHeaders: viewOptions.showRowHeaders || viewOptions.showColumnHeaders,
          showGridlines: viewOptions.showGridlines,
          scrollable: false,
          // Viewport reader resolution is handled internally by SheetView
          // after attach(workbook) — resolves from the attached workbook's
          // per-sheet viewport automatically on each event.
        });
        underlyingRenderer =
          (sheetView as SheetViewHandleWithInternalRenderer)[INTERNAL_GRID_RENDERER_KEY] ?? null;

        if (deps.sheetViewSkin) {
          sheetView.dataSources.update({
            sheetViewSkin: deps.sheetViewSkin,
            chromeTheme: deps.sheetViewSkin.chromeTheme,
          });
        }

        // -------------------------------------------------------------------
        // 3. Configure freeze/split BEFORE attach() so the first computed
        // layout is multi-region when appropriate.
        // -------------------------------------------------------------------
        if (splitConfig) {
          sheetView.viewport.setConfig({
            type: 'split',
            direction: splitConfig.direction,
            horizontalPosition: splitConfig.horizontalPosition,
            verticalPosition: splitConfig.verticalPosition,
          });
        } else if (frozenPanes && (frozenPanes.rows > 0 || frozenPanes.cols > 0)) {
          sheetView.viewport.setFrozenPanes(frozenPanes);
        }

        // -------------------------------------------------------------------
        // 4. Attach the workbook. SheetView wires viewport events, populates
        // VPI/VMI via fetch-committed, and computes the initial layout.
        // It does NOT call engine.start — we do that ourselves below,
        // after wiring policy, to avoid a first-frame race where the
        // engine renders before updateContext has been pushed.
        // -------------------------------------------------------------------
        // The workbook reference lives on the RenderSystem config (viewportAPI
        // is the workbook.viewport handle, but attach() needs the Workbook
        // itself). We source it through the execution config.
        if (!config.workbook) {
          throw new Error(
            'RendererExecution: workbook not provided in config — required for SheetView.attach()',
          );
        }
        sheetView.attach({
          initialSheetId: deps.initialSheetId,
          workbook: config.workbook,
        });

        // Resize to the current container dimensions (ResizeObserver inside
        // SheetView handles future changes, but the initial size may have been
        // captured before attach() wired layout).
        if (context.width > 0 && context.height > 0) {
          sheetView.resize(context.width, context.height);
        }

        // -------------------------------------------------------------------
        // 5. Restore scroll position. Primary: UIStore (pixel-level, session);
        // fallback: Rust ground truth (cell-level, persisted via XLSX) —
        // converted to pixels via VPI on first load. VPI is now populated
        // because attach above triggered the immediate viewport refresh.
        // -------------------------------------------------------------------
        const initialScroll = resolveSavedScrollPosition(deps, deps.initialSheetId);
        if (initialScroll.x !== 0 || initialScroll.y !== 0) {
          sheetView.viewport.setScrollPosition(initialScroll);
          // Sync InputCoordinator's physics engine to the restored position —
          // same pattern as sheet-switch, prevents jump on first gesture.
          deps.onScrollPositionReset?.(initialScroll);
        }

        // -------------------------------------------------------------------
        // 6. Apply initial culture + view options via public capability API.
        // (showGridlines/showHeaders were also passed in SheetViewConfig
        // — this additionally pushes the full visual state surface.)
        // -------------------------------------------------------------------
        sheetView.renderState.update({
          viewOptions: {
            showGridlines: viewOptions.showGridlines,
            showRowHeaders: viewOptions.showRowHeaders,
            showColumnHeaders: viewOptions.showColumnHeaders,
          },
        });
        // Culture is pushed via internal updateContext() since it is not
        // part of the public SheetRenderState DTO (it's a renderer-internal
        // configuration concern, not a visual state projection).
        const cultureName = deps.sheetStateProvider.getCulture();
        sheetView.locale.setCulture(getCulture(cultureName) as never);

        // -------------------------------------------------------------------
        // 7. Notify the coordinator — bridges (Diagram, TextEffect, Equation)
        // wire themselves against SheetView's engine here.
        // Parameter type is now SheetView (was GridRenderer pre-extraction).
        // -------------------------------------------------------------------
        deps.onRendererCreated?.(sheetView);

        // Signal initialization complete to the machine.
        rendererActor.send({
          type: 'INITIALIZED',
          sheetId: deps.initialSheetId,
        });
        break;
      }

      case 'ready': {
        // Start or resume the render loop depending on where we came from.
        // SheetView's `resume()` calls engine.resume(); `start()` is the
        // public lifecycle method that replaces direct `engine.start()`.
        if (sheetView) {
          if (prevState === 'suspended') {
            sheetView.resume();
          } else {
            // First ready: kick off the render loop via public lifecycle API.
            sheetView.start();
          }
        }
        break;
      }

      case 'suspended': {
        sheetView?.suspend();
        break;
      }

      case 'switchingSheet': {
        if (!sheetView || !context.targetSheetId || !rendererDependencies) break;
        const deps = rendererDependencies;

        // Load viewport config for the new sheet (split > freeze).
        const splitCfg = deps.sheetStateProvider.getSplitConfig(context.targetSheetId);
        if (splitCfg) {
          sheetView.viewport.setConfig({
            type: 'split',
            direction: splitCfg.direction,
            horizontalPosition: splitCfg.horizontalPosition,
            verticalPosition: splitCfg.verticalPosition,
          });
        } else {
          const frozen = deps.sheetStateProvider.getFrozenPanes(context.targetSheetId);
          sheetView.viewport.setFrozenPanes(frozen);
        }

        // Switch SheetView. This disposes old regions, resets scroll to
        // origin, recomputes layout, triggers immediate viewport refresh.
        sheetView.switchSheet(context.targetSheetId);

        // Restore scroll for the new sheet. SheetView resets to origin on
        // switchSheet(), so the restore is a second call from outside.
        const restoredScroll = resolveSavedScrollPosition(deps, context.targetSheetId);
        if (restoredScroll.x !== 0 || restoredScroll.y !== 0) {
          sheetView.viewport.setScrollPosition(restoredScroll);
        }
        // Sync InputCoordinator either way — the physics engine needs to know
        // where we actually landed (origin or restored).
        deps.onScrollPositionReset?.(restoredScroll);

        // Apply view options for the new sheet via public capability API.
        const viewOptions = deps.sheetStateProvider.getSheetViewOptions(context.targetSheetId);
        sheetView.renderState.update({
          viewOptions: {
            showGridlines: viewOptions.showGridlines,
            showRowHeaders: viewOptions.showRowHeaders,
            showColumnHeaders: viewOptions.showColumnHeaders,
          },
        });

        // Invalidate sparklines (callback to coordinator).
        onSparklineInvalidate?.();

        // Signal switch complete.
        rendererActor.send({ type: 'SHEET_SWITCHED' });
        break;
      }

      case 'disposing': {
        if (sheetView) {
          sheetView.dispose();
          sheetView = null;
          underlyingRenderer = null;
        }
        rendererContainer = null;
        break;
      }
    }
  }

  /** Subscribe to the renderer actor and dispatch side effects on state changes. */
  function setupExecution(): void {
    let previousState: string | null = null;

    executionSubscription = rendererActor.subscribe((state) => {
      const currentState = state.value as string;
      const context = state.context;
      if (currentState === previousState) return;

      const prevState = previousState;
      previousState = currentState;

      try {
        void executeStateTransition(prevState, currentState, context);
      } catch (error) {
        console.error('[RendererExecution] State transition error:', error);
        rendererActor.send({ type: 'ERROR', error: error as Error });
      }
    });
  }

  // ===========================================================================
  // RESULT OBJECT — thin delegation to SheetView
  // ===========================================================================

  const result: RendererExecutionResult = {
    // ---- Instance Accessors ------------------------------------------------

    getContainer: () => rendererContainer,
    getRenderer: () => underlyingRenderer,
    getSheetView: () => sheetView,

    // ---- Capability Accessors ---------------------------------------------

    getGeometry: () => sheetView?.geometry ?? null,
    getHitTest: () => sheetView?.hitTest ?? null,
    getRender: () => sheetView?.render ?? null,
    getViewport: () => sheetView?.viewport ?? null,
    getObjects: () => sheetView?.objects ?? null,
    getInteractiveElements: () => sheetView?.interactiveElements ?? null,
    getRenderState: () => sheetView?.renderState ?? null,

    // ---- Dependency Management ---------------------------------------------

    setDependencies(dependencies: RendererDependencies): boolean {
      rendererDependencies = dependencies;
      if (!executionSubscription) {
        setupExecution();
        return true;
      }
      return false;
    },

    getDependencies: () => rendererDependencies,

    // ---- Renderer Operations -----------------------------------------------

    resize(width: number, height: number): void {
      // Sync machine context for any consumers selecting from it.
      rendererActor.send({ type: 'RESIZE', width, height });
      sheetView?.resize(width, height);
    },

    updateContext(contextConfig: Partial<RenderContextConfig>): void {
      sheetView?.dataSources.update(contextConfig as Record<string, unknown>);
    },

    setFrozenPanes(panes: FrozenPanes): void {
      const wasFrozen = sheetView?.viewport.getFrozenPanes();
      sheetView?.viewport.setFrozenPanes(panes);
      // When unfreezing, sync the InputCoordinator's physics engine to the
      // reset scroll position. SheetView resets its internal scroll to (0,0)
      // but the physics engine still holds the stale frozen sub-pane offset
      // and will push it back on the next animation frame without this sync.
      if (
        wasFrozen &&
        (wasFrozen.rows > 0 || wasFrozen.cols > 0) &&
        panes.rows === 0 &&
        panes.cols === 0
      ) {
        rendererDependencies?.onScrollPositionReset?.({ x: 0, y: 0 });
      }
    },

    getFrozenPanes(): FrozenPanes {
      return sheetView?.viewport.getFrozenPanes() ?? { rows: 0, cols: 0 };
    },

    setZoom(zoom: number): void {
      sheetView?.setZoom(zoom);
    },

    getZoom(): number {
      return sheetView?.getZoom() ?? 1.0;
    },

    // ---- Viewport Architecture --------------------------------------------

    setScrollPosition(position: Point, viewportId: string = 'main'): void {
      sheetView?.viewport.setScrollPosition(position, viewportId);

      // persist main-viewport scroll per sheet.
      if (viewportId === 'main') {
        const sheetId = sheetView?.render.getCurrentSheetId();
        if (sheetId && rendererDependencies?.onScrollPositionChanged) {
          rendererDependencies.onScrollPositionChanged(sheetId, position);
        }
      }
    },

    getScrollPosition(viewportId: string = 'main'): Point {
      return sheetView?.viewport.getScrollPosition(viewportId) ?? { x: 0, y: 0 };
    },

    getAllScrollPositions(): Map<string, Point> {
      return new Map(sheetView?.viewport.getAllScrollPositions() ?? [['main', { x: 0, y: 0 }]]);
    },

    setAllScrollPositions(positions: Map<string, Point>): void {
      sheetView?.viewport.setAllScrollPositions(positions);
    },

    setViewportConfig(viewportConfig: PersistedViewportConfig): void {
      sheetView?.viewport.setConfig(
        viewportConfig as unknown as { type: string; [key: string]: unknown },
      );
    },

    getViewportConfig(): PersistedViewportConfig {
      return (
        (sheetView?.viewport.getConfig() as PersistedViewportConfig | undefined) ?? {
          type: 'single',
        }
      );
    },

    addOverlayViewport(overlayConfig: OverlayViewportConfig): void {
      sheetView?.viewport.addOverlay(
        overlayConfig as unknown as { id: string; [key: string]: unknown },
      );
    },

    removeOverlayViewport(id: string): void {
      sheetView?.viewport.removeOverlay(id);
    },

    getViewportLayout(): ViewportLayout | null {
      return (sheetView?.viewport.getLayout() as ViewportLayout | null | undefined) ?? null;
    },

    recomputeLayout(): void {
      sheetView?.viewport.invalidateLayout();
    },

    // ---- Lifecycle ---------------------------------------------------------

    cleanup(): void {
      executionSubscription?.unsubscribe();
      executionSubscription = null;

      if (sheetView) {
        sheetView.dispose();
        sheetView = null;
        underlyingRenderer = null;
      }
      rendererContainer = null;
      rendererDependencies = null;
    },
  };

  // Reference viewportAPI to avoid unused-warning — the handle is carried for
  // parity with the pre-extraction config shape; SheetView reads from the
  // workbook directly in attach().
  void viewportAPI;

  return result;
}
