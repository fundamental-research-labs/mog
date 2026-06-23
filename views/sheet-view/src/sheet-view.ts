/**
 * SheetView — the sheet-rendering substrate for Mog.
 *
 * This is a non-React, imperative class. It owns the canvas + grid layers,
 * accepts a Workbook via attach(), handles viewport-driven rendering, and
 * provides the interaction primitives (hit-test, coordinate conversion, click
 * dispatch, scroll observation) that any interaction policy needs.
 *
 * Simple consumers (embed) use the full surface and the internal scroll
 * handling. Advanced consumers (the spreadsheet app) treat it as a substrate:
 * they disable internal scroll wiring (`scrollable: false`), layer their own
 * policy on top via the exposed internals (engine, gridRenderer,
 * coordinate system, position/merge indices), and push interactive state via
 * updateContext().
 *
 * Extracted from `apps/spreadsheet/src/systems/renderer/execution/renderer-execution.ts`
 * (1240 lines). Every method has a 1:1 source range in that file; semantics
 * are preserved byte-for-byte where practical.
 *
 * @module @mog-sdk/sheet-view
 */

import type { CanvasEngineInstance } from '@mog/canvas-engine';
import { computeViewportLayout, createGridRenderer } from '@mog/grid-canvas';
import { ViewportMergeIndex, ViewportPositionIndex } from '@mog/grid-renderer';
import type {
  ViewportReader,
  ViewportRegion,
  Workbook,
  WorkbookViewport,
} from '@mog-sdk/contracts/api';
import type {
  CoordinateSystem,
  FrozenPanes,
  GridRenderer,
  RenderContextConfig,
} from '@mog-sdk/contracts/rendering';
import type {
  OverlayViewportConfig,
  PersistedViewportConfig,
  Point,
  Size,
  ViewportLayout,
} from '@mog-sdk/contracts/viewport';

import { ViewportWiring } from './viewport-wiring';
import { throwOnFailedViewportRefresh } from './viewport-refresh-receipts';

// Capability interfaces and implementations
import type {
  ISheetViewCanvasLayers,
  ISheetViewCommands,
  ISheetViewDecorations,
  ISheetViewDataSources,
  ISheetViewEvents,
  ISheetViewFocus,
  ISheetViewGeometry,
  ISheetViewHitTest,
  ISheetViewInteractiveElements,
  ISheetViewLocale,
  ISheetViewObjects,
  ISheetViewOverlays,
  ISheetViewRender,
  ISheetViewRenderState,
  ISheetViewSkin,
  ISheetViewViewport,
  OverlayAnchor,
  SheetViewHandle,
} from './capability-interfaces';
import type {
  SheetRect,
  SheetCultureInfo,
  SheetViewDataSource,
  SheetViewDataSources,
  SheetViewWorkbookSource,
  SheetViewEvent,
  SheetViewMountOptions,
  SheetViewViewportInset,
  SheetViewVisibleBounds,
  SheetViewportState,
} from './public-types';
import {
  clampScrollPosition,
  clampZoom,
  SHEET_VIEW_SCROLLBAR_SIZE,
  SheetViewViewportChrome,
  type SheetViewViewportChromeOptions,
} from './viewport-chrome';
import {
  SheetViewCanvasLayers,
  SheetViewCommands,
  SheetViewDecorations,
  SheetViewEvents,
  SheetViewFocus,
  SheetViewGeometry,
  SheetViewHitTest,
  SheetViewInteractiveElements,
  SheetViewObjects,
  SheetViewOverlays,
  SheetViewRender,
  SheetViewRenderState,
  SheetViewSkinCapability,
  SheetViewViewport,
} from './capabilities';

type LayoutRecomputeReason = 'structural' | 'scroll' | 'data';
const INTERNAL_GRID_RENDERER_KEY = '__mogInternalGridRenderer';

// =============================================================================
// PUBLIC CONFIG / CALLBACKS
// =============================================================================

/**
 * Static configuration for a SheetView instance.
 *
 * Mirrors the view-layer concerns (container, header/gridline visibility,
 * scroll ownership). Data binding is separate and happens in attach(workbook).
 */
export interface SheetViewConfig {
  /** The DOM element that SheetView will mount its canvas stack inside. */
  container: HTMLElement;
  /** Show row + column headers. Default: true. */
  showHeaders?: boolean;
  /** Show gridlines. Default: true. */
  showGridlines?: boolean;
  /**
   * If true, SheetView wires its own wheel handler for internal scroll.
   * If false, the consumer (e.g. the app's InputCoordinator + ScrollPhysics)
   * drives scroll via setScrollPosition() directly. Default: true.
   */
  scrollable?: boolean;
  /**
   * Optional built-in viewport chrome. Disabled by default so consumers can
   * compose their own controls against SheetViewHandle.viewport when needed.
   */
  viewportChrome?: SheetViewViewportChromeOptions;
  /** Host-owned chrome inset that should be excluded from the renderer viewport. */
  viewportInset?: SheetViewViewportInset | (() => SheetViewViewportInset);
  /** Initial non-persistent visual skin. */
  skin?: SheetViewMountOptions['skin'];
  /** Override device pixel ratio. Default: window.devicePixelRatio. */
  dpr?: number;
  /**
   * Initial visible range before data arrives. Default: A1:Z50.
   * (Informational for advanced consumers — viewport bounds are driven by layout.)
   */
  initialViewport?: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  };
}

/**
 * Optional callbacks SheetView fires at well-defined events.
 *
 * Simple consumers wire onCellClick for display-only click surfacing. Advanced
 * consumers ignore these and bind their own policy to the exposed internals.
 */
export interface SheetViewCallbacks {
  /** Fires when a cell is clicked (only when SheetView is wiring its own input). */
  onCellClick?: (row: number, col: number) => void;
  /** Fires when the visible cell origin changes due to scroll. */
  onScroll?: (startRow: number, startCol: number) => void;
  /**
   * Fires on SheetView-internal scroll resets (e.g. setZoom, programmatic
   * scrollTo). Does NOT fire for consumer-driven setScrollPosition() or
   * switchSheet() calls — those are assumed to be already-synced by the
   * consumer, so firing here would create a feedback loop.
   */
  onScrollPositionReset?: (position: { x: number; y: number }) => void;
  /** Fires when SheetView is attached, wired, and ready for engine.start(). */
  onReady?: () => void;
}

// =============================================================================
// SheetView
// =============================================================================

/**
 * The sheet-view substrate. See module docstring.
 */
export class SheetView {
  // ---------------------------------------------------------------------------
  // Exposed for advanced consumers (spreadsheet app)
  // ---------------------------------------------------------------------------

  /**
   * The canvas engine. Stable across switchSheet() — cache freely.
   *
   * Owned by the internal GridRenderer facade but surfaced here so policy
   * layers can register additional hit-test providers / layers and drive
   * render-loop lifecycle.
   *
   * @internal
   */
  readonly engine: CanvasEngineInstance;

  /**
   * The coordinate system. Stable across switchSheet() — cache freely.
   * Exposed so InputCoordinator / ScrollPhysics can do snap-to-cell math.
   *
   * @internal
   */
  readonly coordinateSystem: CoordinateSystem;

  /**
   * The underlying GridRenderer facade. Stable across switchSheet() — cache
   * freely; the field is assigned once in the constructor and only disposed
   * on dispose().
   *
   * Exposed for policy layers that need GridRenderer-specific methods not
   * covered by `engine`: `invalidateAll()`, `getCurrentSheetId()`,
   * `getClippedCellContent()`, `getInteractiveElementCollector()`.
   * Per-sheet state behind this handle
   * (e.g. the current sheet ID, layers) is itself recreated on
   * `switchSheet()` — the facade remains the same instance.
   *
   * @internal
   */
  readonly gridRenderer: GridRenderer;

  // ---------------------------------------------------------------------------
  // Public capability APIs (replaces direct access to renderer internals)
  // ---------------------------------------------------------------------------

  /** Geometry queries — cell rects, page rects, dimensions, merge anchors. */
  readonly geometry: ISheetViewGeometry;

  /** Hit testing — classify viewport/page points against all rendered layers. */
  readonly hitTest: ISheetViewHitTest;

  /** Render invalidation and current sheet identity. */
  readonly render: ISheetViewRender;

  /** Floating object scene — synchronous bounds reads and transient updates. */
  readonly objects: ISheetViewObjects;

  /** Interactive element observation (filter buttons, checkboxes, etc.). */
  readonly interactiveElements: ISheetViewInteractiveElements;

  /** Viewport — scroll, frozen panes, split views, layout. */
  readonly viewport: ISheetViewViewport;

  /** Render state — push visual state (selection, editor, etc.) to the renderer. */
  readonly renderState: ISheetViewRenderState;

  /** Data-source callbacks for renderer lookups. */
  readonly dataSources: ISheetViewDataSources;

  /** Locale/culture configuration. */
  readonly locale: ISheetViewLocale;

  /** View-level events — pointer intents, scroll/zoom changes, focus. */
  readonly events: ISheetViewEvents;

  /** Focus management — programmatic focus/blur on the view container. */
  readonly focus: ISheetViewFocus;

  /** Command dispatch — scroll-to-cell, set-zoom, set-frozen-panes, etc. */
  readonly commands: ISheetViewCommands;

  /** Skin lifecycle — apply and observe non-persistent SheetView skins. */
  readonly skin: ISheetViewSkin;

  /** DOM overlay API — anchor host-owned elements to spreadsheet geometry. */
  readonly overlays: ISheetViewOverlays;

  /** Non-destructive decorations — visual annotations on cells/ranges. */
  readonly decorations: ISheetViewDecorations;

  /** Canvas extension layers — custom rendering in the grid pipeline. */
  readonly layers: ISheetViewCanvasLayers;

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  private readonly _config: Required<
    Omit<SheetViewConfig, 'initialViewport' | 'dpr' | 'viewportChrome' | 'skin' | 'viewportInset'>
  > & {
    initialViewport?: SheetViewConfig['initialViewport'];
    viewportChrome: Required<SheetViewViewportChromeOptions>;
    viewportInset?: SheetViewConfig['viewportInset'];
    dpr?: number;
  };
  private readonly _callbacks: SheetViewCallbacks;

  /**
   * The underlying GridRenderer facade. Stable across switchSheet() — recreated
   * only on dispose(). Publicly surfaced as {@link gridRenderer} (narrowed to
   * the `GridRenderer` contract).
   *
   * We keep this internal reference typed as the concrete return type of
   * `createGridRenderer` (the impl) rather than the narrower `GridRenderer`
   * contract so we can reach the facade's view-layer extensions (getEngine,
   * getGridLayers, getCellExpander) from inside SheetView.
   */
  private _renderer: ReturnType<typeof createGridRenderer>;

  /**
   * Viewport position and merge indices. Per-sheet — recreated on switchSheet()
   * so consumers MUST read via the `positionIndex`/`mergeIndex` getters.
   */
  private _positionIndex: ViewportPositionIndex;
  private _mergeIndex: ViewportMergeIndex;

  /** Internal DOM container owned by this view (created in constructor). */
  private readonly _rendererContainer: HTMLElement;

  /** Workbook reference. Set by attach(). Private — MUST NOT leak into public API. */
  private _workbook: Workbook | null = null;
  /** Viewport API handle on the workbook — cached from attach(). */
  private _workbookViewport: WorkbookViewport | null = null;

  /** Viewport-wiring subscription (events → VPI/VMI rebuild + scheduler marks). */
  private _wiring: ViewportWiring | null = null;

  /** Current container size (updated via ResizeObserver + resize()). */
  private _containerSize: Size = { width: 0, height: 0 };

  /** Current persisted viewport configuration (single/freeze/split). */
  private _viewportConfig: PersistedViewportConfig = { type: 'single' };

  /** Session-local overlay viewports (AI previews, etc.). */
  private _overlayConfigs: OverlayViewportConfig[] = [];

  /** Current computed viewport layout. */
  private _viewportLayout: ViewportLayout | null = null;

  /** Last structural layout signature pushed to the renderer/coordinator. */
  private _structuralLayoutSignature: string | null = null;
  /** Last visible/data window signature used for registrations and fetches. */
  private _visibleDataSignature: string | null = null;
  /** Last scroll-offset signature used for scroll-only render updates. */
  private _scrollLayoutSignature: string | null = null;

  /** Current zoom level (1.0 = 100%). */
  private _currentZoom = 1.0;

  /**
   * Per-viewport scroll positions for split view support. Keys are viewport IDs
   * ('main', 'top', 'bottom', ...). For single/freeze configs, only 'main' is
   * used. For split configs, each viewport has independent scroll.
   */
  private _scrollPositions: Map<string, Point> = new Map([['main', { x: 0, y: 0 }]]);

  /** Map of viewport ID → ViewportRegion handle (lifetime tracking). */
  private readonly _regions: Map<string, ViewportRegion> = new Map();

  /**
   * Debounced viewport refresh timer. Movement fetch staleness is resolved in
   * the kernel fetch manager.
   */
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private _viewportRefreshGeneration = 0;

  /** ResizeObserver on the container element. Installed in constructor. */
  private _resizeObserver: ResizeObserver | null = null;

  /** Wheel event listener cleanup (only installed when `scrollable`). */
  private _wheelDispose: (() => void) | null = null;
  /** Click event listener cleanup (only installed when `scrollable`). */
  private _clickDispose: (() => void) | null = null;
  /** Focus event listener cleanup. */
  private _focusDispose: (() => void) | null = null;

  /** Disposed flag — guards against post-dispose method calls. */
  private _disposed = false;
  private _cultureTag = 'en-US';
  private _dataSourceKeys: Set<string> = new Set();

  /** Last known editor isEditing state, for detecting edit lifecycle transitions. */
  private _lastEditorIsEditing = false;

  /** Concrete events implementation for internal emit() calls. */
  private _eventsImpl: SheetViewEvents;
  /** Concrete geometry implementation for internal notifyGeometryChanged() calls. */
  private _geometryImpl: SheetViewGeometry;
  /** Concrete viewport implementation for internal notifyVisibleRangeIfChanged() calls. */
  private _viewportImpl: SheetViewViewport;

  /** Concrete overlays implementation for disposal. */
  private _overlaysImpl: SheetViewOverlays;
  /** Concrete decorations implementation for disposal. */
  private _decorationsImpl: SheetViewDecorations;
  /** Concrete canvas layers implementation for disposal. */
  private _canvasLayersImpl: SheetViewCanvasLayers;
  /** Concrete skin implementation for lifecycle and disposal. */
  private _skinImpl: SheetViewSkinCapability;

  /** Optional built-in viewport chrome owned by SheetView. */
  private _viewportChrome: SheetViewViewportChrome | null = null;

  // ===========================================================================
  // Constructor — container + renderer + indices + ResizeObserver.
  //
  // Source: renderer-execution.ts L424-454 (container creation + renderer create)
  //         + L255-260 (VPI/VMI instantiation).
  // ===========================================================================

  constructor(config: SheetViewConfig, callbacks: SheetViewCallbacks = {}) {
    // Resolve defaults (one-shot).
    this._config = {
      container: config.container,
      showHeaders: config.showHeaders ?? true,
      showGridlines: config.showGridlines ?? true,
      scrollable: config.scrollable ?? true,
      viewportChrome: {
        scrollbars: config.viewportChrome?.scrollbars ?? false,
        zoomControls: config.viewportChrome?.zoomControls ?? false,
      },
      viewportInset: config.viewportInset,
      dpr: config.dpr,
      initialViewport: config.initialViewport,
    };
    this._callbacks = callbacks;

    const containerStyle = window.getComputedStyle(config.container);
    if (containerStyle.position === 'static') {
      config.container.style.position = 'relative';
    }

    // Create the inner renderer container (see L424-438).
    const rc = document.createElement('div');
    rc.style.position = 'absolute';
    rc.style.top = '0';
    rc.style.left = '0';
    rc.style.pointerEvents = 'none';
    this._rendererContainer = rc;
    this._syncRendererContainerInset();
    config.container.insertBefore(rc, config.container.firstChild);

    // Create indices (L255-260).
    this._positionIndex = new ViewportPositionIndex();
    this._mergeIndex = new ViewportMergeIndex();

    // Track initial container size from the host element.
    const rect = config.container.getBoundingClientRect();
    this._containerSize = this._rendererSizeForHost(rect.width, rect.height);

    // Create the renderer directly — Option B, no factory indirection (L445-454).
    // NOTE: attach() has not yet run, so `initialSheetId` is a sentinel. switchSheet()
    // on attach sets the real one.
    this._renderer = createGridRenderer({
      container: rc,
      initialSheetId: '',
      positionIndex: this._positionIndex,
      mergeIndex: this._mergeIndex,
      contextConfig: {
        showGridlines: this._config.showGridlines,
        showRowHeaders: this._config.showHeaders,
        showColumnHeaders: this._config.showHeaders,
      },
    });

    // Size the renderer immediately if we already have dimensions (L456-460).
    if (this._containerSize.width > 0 && this._containerSize.height > 0) {
      this._renderer.resize(this._containerSize.width, this._containerSize.height);
    }

    // Cache the stable internals.
    this.engine = this._renderer.getEngine();
    this.coordinateSystem = this._renderer.getCoordinateSystem();
    this.gridRenderer = this._renderer;

    // Initialize capability APIs. These wrap the internal objects and expose
    // a stable public contract. Internal accessors (engine, gridRenderer, etc.)
    // are kept for now — they will be removed after consumer migration.
    const renderer = this._renderer;
    const self = this;

    const geometryImpl = new SheetViewGeometry({
      getRenderer: () => renderer,
      getCoordinateSystem: () => renderer.getCoordinateSystem(),
      getPositionIndex: () => self._positionIndex,
      getMergeIndex: () => self._mergeIndex,
      getCurrentSheetId: () => renderer.getCurrentSheetId(),
      getContainer: () => self._rendererContainer,
      getHeaderVisibility: () => {
        const vis = self.coordinateSystem.getHeaderVisibility?.() ?? {};
        return {
          showRowHeaders: (vis as Record<string, boolean>).showRowHeaders,
          showColumnHeaders: (vis as Record<string, boolean>).showColumnHeaders,
        };
      },
      getOutlineGutter: () => {
        const g = self.coordinateSystem.getOutlineGutter?.();
        return { rowGutterWidth: g?.rowGutterWidth ?? 0, colGutterHeight: g?.colGutterHeight ?? 0 };
      },
    });
    this.geometry = geometryImpl;
    this._geometryImpl = geometryImpl;

    this.hitTest = new SheetViewHitTest({
      getRenderer: () => renderer,
      getContainer: () => self._rendererContainer,
    });

    this.render = new SheetViewRender({
      getRenderer: () => renderer,
      getEngine: () => self.engine,
    });

    this.objects = new SheetViewObjects({
      getRenderer: () => renderer,
    });

    this.interactiveElements = new SheetViewInteractiveElements({
      getRenderer: () => renderer,
    });

    const viewportImpl = new SheetViewViewport({
      setScrollPosition: (pos, vpId) => self.setScrollPosition(pos, vpId),
      getScrollPosition: (vpId) => self.getScrollPosition(vpId),
      getAllScrollPositions: () => self.getAllScrollPositions(),
      setAllScrollPositions: (pos) => self.setAllScrollPositions(pos),
      setFrozenPanes: (rows, cols) => self.setFrozenPanes(rows, cols),
      getFrozenPanes: () => self.getFrozenPanes(),
      setViewportConfig: (config) => self.setViewportConfig(config as PersistedViewportConfig),
      getViewportConfig: () => self.getViewportConfig() as { type: string; [key: string]: unknown },
      addOverlayViewport: (config) =>
        self.addOverlayViewport(config as unknown as OverlayViewportConfig),
      removeOverlayViewport: (id) => self.removeOverlayViewport(id),
      getViewportLayout: () => self.getViewportLayout(),
      invalidateLayout: () => self.invalidateLayout(),
      getVisibleBounds: () => self.getVisibleBounds(),
      getCurrentSheetId: () => renderer.getCurrentSheetId(),
      getZoom: () => self.getZoom(),
      getViewportState: () => self.getViewportState(),
      clampScrollPosition: (position) => self.clampScrollPosition(position),
      getScrollBounds: (sheetId: string) => self.coordinateSystem.getScrollBounds(sheetId),
      getCoordinateScrollToCell: (sheetId: string, cell: { row: number; col: number }) =>
        self.coordinateSystem.getScrollToCell?.(sheetId, cell) ?? null,
      getPositionIndex: () => self._positionIndex,
      getCellPageBounds: (row: number, col: number) => self._renderer.getCellPageBounds(row, col),
      getViewportBounds: (sheetId: string) => {
        const b = self.coordinateSystem.getViewportBounds?.(sheetId);
        if (!b) return { x: 0, y: 0, width: 0, height: 0 };
        const bounds = b as Record<string, number>;
        if ('width' in bounds)
          return {
            x: bounds.x ?? 0,
            y: bounds.y ?? 0,
            width: bounds.width ?? 0,
            height: bounds.height ?? 0,
          };
        return {
          x: bounds.left ?? 0,
          y: bounds.top ?? 0,
          width: (bounds.right ?? 0) - (bounds.left ?? 0),
          height: (bounds.bottom ?? 0) - (bounds.top ?? 0),
        };
      },
    });
    this.viewport = viewportImpl;
    this._viewportImpl = viewportImpl;

    this.renderState = new SheetViewRenderState({
      updateContext: (config) => self.updateContext(config),
      onSelectionChange: () => self._emit({ type: 'selection-visual-change' }),
      onEditorChange: (editorState) => {
        // Detect edit lifecycle transitions and emit intent events.
        // The app pushes editor state via renderState.update({ editor: ... }).
        // We track transitions to emit edit-start-request / edit-commit-request /
        // edit-cancel-request as appropriate.
        self._handleEditorStateChange(editorState);
      },
    });

    this.dataSources = {
      replace: (sources: SheetViewDataSources) => {
        const cleared = Object.fromEntries(
          [...self._dataSourceKeys].map((key) => [key, undefined]),
        );
        self._dataSourceKeys = new Set(Object.keys(sources));
        self.updateContext({ ...cleared, ...sources } as Partial<RenderContextConfig>);
      },
      update: (sources: Partial<SheetViewDataSources>) => {
        for (const key of Object.keys(sources)) self._dataSourceKeys.add(key);
        self.updateContext(sources as Partial<RenderContextConfig>);
      },
      clear: (keys?: readonly string[]) => {
        const keysToClear = keys ?? [...self._dataSourceKeys];
        for (const key of keysToClear) self._dataSourceKeys.delete(key);
        self.updateContext(
          Object.fromEntries(
            keysToClear.map((key) => [key, undefined]),
          ) as Partial<RenderContextConfig>,
        );
      },
    };

    this.locale = {
      setCultureTag: (tag: string) => {
        self._cultureTag = tag;
      },
      setCulture: (culture: SheetCultureInfo) => {
        self._cultureTag = culture.tag ?? culture.name ?? self._cultureTag;
        self.updateContext({ culture } as unknown as Partial<RenderContextConfig>);
      },
      getCultureTag: () => self._cultureTag,
    };

    const eventsImpl = new SheetViewEvents();
    this.events = eventsImpl;
    this._eventsImpl = eventsImpl;

    this.focus = new SheetViewFocus({
      getContainer: () => config.container,
    });

    this.commands = new SheetViewCommands({
      scrollTo: (row, col) => self.scrollTo(row, col),
      setZoom: (zoom) => self.setZoom(zoom),
      setFrozenPanes: (rows, cols) => self.setFrozenPanes(rows, cols),
      switchSheet: (sheetId) => self.switchSheet(sheetId),
      invalidateAll: () => renderer.invalidateAll(),
    });

    this._skinImpl = new SheetViewSkinCapability({
      invalidate: () => renderer.invalidateAll(),
      updateResolvedSkin: (skin) => self.updateContext({ sheetViewSkin: skin }),
    });
    this.skin = this._skinImpl;
    if (config.skin !== undefined) {
      this._skinImpl.set(config.skin);
    }

    // Extension capabilities (extension capability).
    this._overlaysImpl = new SheetViewOverlays({
      getContainer: () => self._rendererContainer,
      resolveAnchorRects: (anchor) => self._resolveAnchorRects(anchor),
    });
    this.overlays = this._overlaysImpl;

    this._decorationsImpl = new SheetViewDecorations({
      getContainer: () => self._rendererContainer,
      resolveAnchorRects: (anchor) => self._resolveAnchorRects(anchor),
    });
    this.decorations = this._decorationsImpl;

    this._canvasLayersImpl = new SheetViewCanvasLayers({
      getContainer: () => self._rendererContainer,
      getDpr: () => self._config.dpr ?? window.devicePixelRatio ?? 1,
      getVisibleRange: () => self.geometry.getVisibleRange(),
    });
    this.layers = this._canvasLayersImpl;

    if (this._config.viewportChrome.scrollbars || this._config.viewportChrome.zoomControls) {
      this._viewportChrome = new SheetViewViewportChrome(
        config.container,
        this._config.viewportChrome,
        {
          onScroll: (position) => this.setScrollPosition(position, 'main'),
          onZoom: (zoom) => this.setZoom(zoom),
        },
      );
    }

    // Install the resize observer. Keep this quietly in the constructor —
    // the React layer (for the app) and embed both depend on it.
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.resize(width, height);
      }
    });
    this._resizeObserver.observe(config.container);

    // Wire optional wheel / click handlers if the consumer wants SheetView to
    // own input directly (embed case). Advanced consumers pass scrollable: false.
    if (this._config.scrollable) {
      this._installInternalScrollAndClick();
    }

    // Wire focus enter/leave events on the container. These fire regardless
    // of scrollable mode — all consumers observe focus transitions.
    this._installFocusListeners(config.container);
  }

  // ===========================================================================
  // attach(workbook)
  //
  // Sets up data sources, viewport subscription, initial layout, and
  // coordinator handshakes — but deliberately does NOT start the engine.
  // The caller calls engine.start() after wiring policy.
  //
  // Source: renderer-execution.ts L441-639 (initializing branch).
  // ===========================================================================

  /**
   * Bind a Workbook to this SheetView. Wires viewport events, populates VPI/VMI,
   * restores scroll, and computes initial layout. Does NOT start the engine —
   * the caller does that explicitly via `engine.start()` once policy is wired.
   */
  attach(source: SheetViewDataSource | Workbook): void {
    this._ensureNotDisposed();
    if (this._workbook) {
      throw new Error('SheetView.attach: already attached');
    }
    const workbook = 'workbook' in source ? (source.workbook as Workbook) : source;
    this._workbook = workbook;
    this._workbookViewport = workbook.viewport;

    // Switch the renderer to the workbook's active sheet (was '' at construct).
    const initialSheetId = workbook.activeSheet.sheetId;
    this._renderer.switchSheet(initialSheetId);
    this._syncWorkbookDataSources();

    // --- 1. Set up viewport wiring (MUST happen before immediateViewportRefresh). --
    // This registers the render scheduler on the workbook viewport and subscribes
    // to fetch-committed / dimensions-patched / cells-patched events, which drive
    // VPI/VMI rebuilds + scheduler marks.
    //
    // Ordering rationale (design doc): if we refresh before subscribing, the
    // first fetch-committed event fires before we're listening, and the initial
    // data never populates VPI.
    this._wiring = this._createViewportWiring(this._workbookViewport);
    this._wiring.connect();

    // --- 2. Compute initial viewport layout. --------------------------------
    // This populates position indices (via the fetch-committed event, once
    // data arrives) and syncs viewport region handles. Ordering note: the
    // layout depends on _viewportConfig, so setFrozenPanes() should have
    // already been called if the consumer wants freeze panes on first paint.
    this._recomputeLayout();

    // --- 3. Trigger an immediate viewport data refresh. ---------------------
    // NOTE: This must happen AFTER wiring.connect() so the fetch-committed
    // event (back from Rust) routes through our subscriber and rebuilds VPI.
    void this._immediateViewportRefresh();

    this._callbacks.onReady?.();
  }

  /**
   * Rebind viewport wiring after the attached workbook swaps its backing context.
   * Version-control checkout preserves the Workbook object but replaces the
   * underlying compute bridge, so cached viewport coordinators must be refreshed.
   */
  rebindWorkbookViewport(): void {
    this._ensureNotDisposed();
    if (!this._workbook) {
      throw new Error('SheetView.rebindWorkbookViewport: not attached');
    }

    this._viewportRefreshGeneration++;
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }

    this._wiring?.disconnect();
    this._wiring = null;
    this._workbookViewport?.setRenderScheduler(null);

    for (const [, region] of this._regions) {
      region.dispose();
    }
    this._regions.clear();

    this._workbookViewport = this._workbook.viewport;
    this._wiring = this._createViewportWiring(this._workbookViewport);
    this._wiring.connect();
    this._syncWorkbookDataSources();

    this._recomputeLayout();
    void this._immediateViewportRefresh();
  }

  // ===========================================================================
  // start() — public lifecycle method
  //
  // Replaces direct `sheetView.engine.start()` calls.
  // ===========================================================================

  /**
   * Start the render loop. Call after attach() and after any policy wiring
   * is complete. This is the public replacement for `engine.start()`.
   */
  start(): void {
    this._ensureNotDisposed();
    this.engine.start();
  }

  // ===========================================================================
  // switchSheet(sheetId)
  //
  // Source: renderer-execution.ts L666-750 (switchingSheet branch).
  // ===========================================================================

  /**
   * Switch the active sheet. Disposes old region handles, recreates per-sheet
   * state (VPI/VMI are reset via the fetch-committed event on the new sheet),
   * and recomputes layout.
   */
  switchSheet(sheetId: string): void {
    this._ensureNotDisposed();
    if (!this._workbook || !this._workbookViewport) {
      throw new Error('SheetView.switchSheet: not attached');
    }
    const oldSheetId = this._renderer.getCurrentSheetId();

    this._renderer.switchSheet(sheetId);
    this._syncWorkbookDataSources();
    this._overlaysImpl.handleSheetChange();

    // Reset viewport region handles for sheet switch (L715-725).
    if (oldSheetId && oldSheetId !== sheetId) {
      this._workbookViewport.resetSheetRegions(oldSheetId);
    }
    this._viewportRefreshGeneration++;
    for (const [, region] of this._regions) {
      region.dispose();
    }
    this._regions.clear();

    // Per-sheet indices are reset; a fresh fetch-committed event will repopulate.
    // Reset scroll for the new sheet to a clean origin; consumers (the app) will
    // call setScrollPosition() right after switchSheet() to restore the saved
    // position. Embed does not persist scroll per-sheet so origin is fine.
    this._scrollPositions = new Map([['main', { x: 0, y: 0 }]]);

    // Recompute layout and fetch new data.
    this._recomputeLayout({ reason: 'scroll' });
    void this._immediateViewportRefresh();
  }

  // ===========================================================================
  // suspend() / resume()
  //
  // Source: renderer-execution.ts L652-663 (suspended) + L642-649 (ready).
  // ===========================================================================

  /** Stop the render loop (for backgrounded tabs). */
  suspend(): void {
    this._ensureNotDisposed();
    this._renderer.pause();
  }

  /** Restart the render loop. */
  resume(): void {
    this._ensureNotDisposed();
    this._renderer.resume();
  }

  // ===========================================================================
  // dispose()
  //
  // Source: renderer-execution.ts L752-763 (disposing) + L1207-1236 (cleanup).
  // ===========================================================================

  /** Tear down all resources. Safe to call multiple times. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // Cancel any pending refresh.
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }

    // Dispose region handles.
    for (const [, region] of this._regions) {
      region.dispose();
    }
    this._regions.clear();

    // Disconnect viewport wiring.
    this._wiring?.disconnect();
    this._wiring = null;

    // Drop the render scheduler from the workbook viewport.
    this._workbookViewport?.setRenderScheduler(null);

    // Remove observers and listeners.
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._wheelDispose?.();
    this._wheelDispose = null;
    this._clickDispose?.();
    this._clickDispose = null;
    this._focusDispose?.();
    this._focusDispose = null;
    this._viewportChrome?.dispose();
    this._viewportChrome = null;

    // Clear event subscribers and capability observers.
    this._eventsImpl.clear();
    this._geometryImpl.clearObservers();
    this._viewportImpl.clearObservers();

    // Dispose extension capabilities.
    this._overlaysImpl.disposeAll();
    this._canvasLayersImpl.disposeAll();
    this._decorationsImpl.disposeAll();
    this._skinImpl.dispose();

    // Dispose the renderer (and with it, the engine + layers).
    this._renderer.dispose();

    // Remove our container from the DOM.
    if (this._rendererContainer.parentNode) {
      this._rendererContainer.parentNode.removeChild(this._rendererContainer);
    }

    this._workbook = null;
    this._workbookViewport = null;
  }

  // ===========================================================================
  // Per-sheet getters (stability contract: RECREATED across switchSheet).
  // ===========================================================================

  /**
   * The viewport position index. Per-sheet. Access via getter; do NOT cache.
   *
   * @internal
   */
  get positionIndex(): ViewportPositionIndex {
    return this._positionIndex;
  }

  /**
   * The viewport merge index. Per-sheet. Access via getter; do NOT cache.
   *
   * @internal
   */
  get mergeIndex(): ViewportMergeIndex {
    return this._mergeIndex;
  }

  // ===========================================================================
  // Context / freeze / zoom / scroll / resize — public API surface.
  //
  // Source: renderer-execution.ts L1004-1237.
  // ===========================================================================

  /**
   * Push interactive state (selection, editor, clipboard, floating objects, ...)
   * into the renderer. Passthrough to the underlying renderer's updateContext.
   *
   * @internal
   */
  updateContext(config: Partial<RenderContextConfig>): void {
    if (this._disposed) return;
    this._renderer.updateContext(config);
  }

  /**
   * Set frozen panes. Triggers multi-region layout recomputation.
   *
   * Source: renderer-execution.ts L1074-1085 (setFrozenPanes).
   */
  setFrozenPanes(rows: number, cols: number): void {
    this._ensureNotDisposed();
    if (rows > 0 || cols > 0) {
      this._viewportConfig = { type: 'freeze', rows, cols };
    } else {
      const wasFrozen = this._viewportConfig.type === 'freeze';
      this._viewportConfig = { type: 'single' };
      if (wasFrozen) {
        // Reset scroll to origin — the frozen sub-pane's scroll offset is
        // meaningless in the single-viewport layout and would strand the
        // user at an empty region far from their data.
        this._scrollPositions.set('main', { x: 0, y: 0 });
        this._renderer.setScroll(0, 0);
      }
    }
    this._recomputeLayout();
  }

  /**
   * Get the current frozen panes (derived from viewport config).
   *
   * Source: renderer-execution.ts L1087-1093 (getFrozenPanes).
   */
  getFrozenPanes(): FrozenPanes {
    if (this._viewportConfig.type === 'freeze') {
      return { rows: this._viewportConfig.rows, cols: this._viewportConfig.cols };
    }
    return { rows: 0, cols: 0 };
  }

  /**
   * Set the zoom level. Recomputes layout.
   *
   * Source: renderer-execution.ts L1095-1102 (setZoom).
   */
  setZoom(zoom: number): void {
    this._ensureNotDisposed();
    const clampedZoom = clampZoom(zoom);
    this._currentZoom = clampedZoom;
    this._renderer.setZoom(clampedZoom);
    this._recomputeLayout();

    // Emit zoom-change event.
    this._emit({ type: 'zoom-change', zoom: clampedZoom });
  }

  /** Get the zoom level. Source: renderer-execution.ts L1104-1106. */
  getZoom(): number {
    return this._currentZoom;
  }

  /** True after dispose() has released view-owned resources. */
  isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Set scroll position for a specific viewport. Recomputes layout.
   *
   * Source: renderer-execution.ts L1118-1137 (setScrollPosition).
   */
  setScrollPosition(position: Point, viewportId: string = 'main'): void {
    this._ensureNotDisposed();
    const nextPosition = this.clampScrollPosition(position, viewportId);
    this._scrollPositions.set(viewportId, { ...nextPosition });
    this._overlaysImpl.handleScroll();

    // For main viewport, also update the renderer's coordinate system.
    if (viewportId === 'main') {
      this._renderer.setScroll(nextPosition.y, nextPosition.x);
    }

    this._recomputeLayout({ reason: 'scroll' });

    // Emit scroll-change event.
    this._emit({
      type: 'scroll-change',
      position: { x: nextPosition.x, y: nextPosition.y },
      viewportId,
    });
  }

  /**
   * Get scroll position for a specific viewport.
   *
   * Source: renderer-execution.ts L1145-1148 (getScrollPosition).
   */
  getScrollPosition(viewportId: string = 'main'): Point {
    const pos = this._scrollPositions.get(viewportId);
    return pos ? { ...pos } : { x: 0, y: 0 };
  }

  /**
   * Get all viewport scroll positions (useful for serializing split view).
   *
   * Source: renderer-execution.ts L1154-1156.
   */
  getAllScrollPositions(): Map<string, Point> {
    return new Map(this._scrollPositions);
  }

  clampScrollPosition(position: Point, viewportId: string = 'main'): Point {
    if (viewportId !== 'main') {
      return { x: Math.max(0, position.x), y: Math.max(0, position.y) };
    }
    const state = this.getViewportState();
    return clampScrollPosition(position, state.maxScroll);
  }

  getViewportState(): SheetViewportState {
    const sheetId = this._renderer.getCurrentSheetId() ?? '';
    const scrollPosition = this.getScrollPosition('main');
    const visibleBounds = this.getVisibleBounds();
    const scrollBounds = sheetId
      ? this.coordinateSystem.getScrollBounds(sheetId)
      : { maxScrollLeft: 0, maxScrollTop: 0 };
    const maxScroll = {
      x: Math.max(0, scrollBounds.maxScrollLeft ?? 0),
      y: Math.max(0, scrollBounds.maxScrollTop ?? 0),
    };
    const viewportBounds = sheetId
      ? this._viewportBoundsForState(sheetId)
      : { width: this._containerSize.width, height: this._containerSize.height };
    const frozenPanes = this.getFrozenPanes();
    const vpConfig = this.getViewportConfig();
    const splitConfig =
      vpConfig.type === 'split'
        ? {
            direction: (vpConfig.direction as 'horizontal' | 'vertical' | 'both') ?? 'both',
            horizontalPosition: (vpConfig.horizontalPosition as number) ?? 0,
            verticalPosition: (vpConfig.verticalPosition as number) ?? 0,
          }
        : null;

    return {
      sheetId,
      scrollPosition,
      maxScroll,
      viewportSize: {
        width: Math.max(0, viewportBounds.width),
        height: Math.max(0, viewportBounds.height),
      },
      contentSize: {
        width: Math.max(0, viewportBounds.width + maxScroll.x),
        height: Math.max(0, viewportBounds.height + maxScroll.y),
      },
      visibleRange: {
        startRow: visibleBounds.startRow,
        startCol: visibleBounds.startCol,
        endRow: visibleBounds.endRow,
        endCol: visibleBounds.endCol,
      },
      zoom: this.getZoom(),
      frozenPanes: { rows: frozenPanes.rows, cols: frozenPanes.cols },
      splitConfig,
    };
  }

  /**
   * Set all viewport scroll positions at once (useful for restoring split view).
   *
   * Source: renderer-execution.ts L1162-1171.
   */
  setAllScrollPositions(positions: Map<string, Point>): void {
    this._ensureNotDisposed();
    this._scrollPositions = new Map(
      [...positions].map(([viewportId, position]) => [
        viewportId,
        this.clampScrollPosition(position, viewportId),
      ]),
    );
    const mainPos = this._scrollPositions.get('main');
    if (mainPos) {
      this._renderer.setScroll(mainPos.y, mainPos.x);
    }
    this._recomputeLayout();
  }

  /**
   * Set the viewport configuration (freeze, split, etc.). Recomputes layout.
   *
   * Source: renderer-execution.ts L1173-1177.
   */
  setViewportConfig(config: PersistedViewportConfig): void {
    this._ensureNotDisposed();
    this._viewportConfig = config;
    this._recomputeLayout();
  }

  /** Get the current viewport configuration. Source: L1179-1181. */
  getViewportConfig(): PersistedViewportConfig {
    return this._viewportConfig;
  }

  /**
   * Add an overlay viewport (AI preview, etc.). Recomputes layout.
   *
   * Source: renderer-execution.ts L1183-1187.
   */
  addOverlayViewport(config: OverlayViewportConfig): void {
    this._ensureNotDisposed();
    this._overlayConfigs = [...this._overlayConfigs, config];
    this._recomputeLayout();
  }

  /**
   * Remove an overlay viewport by ID.
   *
   * Source: renderer-execution.ts L1189-1193.
   */
  removeOverlayViewport(id: string): void {
    this._ensureNotDisposed();
    this._overlayConfigs = this._overlayConfigs.filter((c) => c.id !== id);
    this._recomputeLayout();
  }

  /** Get the current viewport layout (computed). */
  getViewportLayout(): ViewportLayout | null {
    return this._viewportLayout;
  }

  /**
   * Trigger layout recomputation explicitly (e.g., outline gutter size changed
   * outside SheetView's knowledge).
   *
   * Source: renderer-execution.ts L1199-1201 (recomputeLayout).
   */
  invalidateLayout(): void {
    this._recomputeLayout();
  }

  /**
   * Resize the view. Source: renderer-execution.ts L1052-1066.
   */
  resize(width: number, height: number): void {
    if (this._disposed) return;
    this._syncRendererContainerInset();
    this._containerSize = this._rendererSizeForHost(width, height);
    if (width > 0 && height > 0) {
      this._renderer.resize(this._containerSize.width, this._containerSize.height);
    }
    this._recomputeLayout();
  }

  // ===========================================================================
  // Navigation API.
  // ===========================================================================

  /**
   * Scroll so the given cell becomes visible. Converts cell coords to pixels
   * via the position index and routes through setScrollPosition.
   */
  scrollTo(row: number, col: number): void {
    this._ensureNotDisposed();
    if (!this._positionIndex.hasData) return;
    const x = this._positionIndex.getColLeft(col);
    const y = this._positionIndex.getRowTop(row);
    const next = this.clampScrollPosition({ x, y }, 'main');
    this.setScrollPosition(next, 'main');
    this._callbacks.onScrollPositionReset?.(next);
    this._emit({ type: 'scroll-position-reset', position: next });
  }

  /**
   * Return the currently-visible cell range. Uses the 'main' viewport from
   * the last computed layout.
   */
  getVisibleBounds(): SheetViewVisibleBounds {
    const layout = this._viewportLayout;
    const main = layout?.viewports.find(
      (v) => v.id === 'main' || (typeof v.id === 'string' && v.id.startsWith('main:')),
    );
    if (!main) {
      return { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    }
    const r = main.cellRange;
    return {
      startRow: r.startRow,
      startCol: r.startCol,
      endRow: r.endRow,
      endCol: r.endCol,
    };
  }

  // ===========================================================================
  // INTERNAL — viewport layout recomputation.
  //
  // Source: renderer-execution.ts L946-998 (recomputeViewportLayout).
  // ===========================================================================

  private _recomputeLayout(
    options: {
      reason?: LayoutRecomputeReason;
      scheduleRefresh?: boolean | 'if-changed';
    } = {},
  ): void {
    // Can't compute without valid container size (L950-951).
    if (this._containerSize.width <= 0 || this._containerSize.height <= 0) return;

    const mainScrollPosition = this._scrollPositions.get('main') ?? { x: 0, y: 0 };

    // Assemble ComputeLayoutInput from internal state only — no external state
    // leaks into the layout call.
    const layout = computeViewportLayout({
      config: this._viewportConfig,
      containerSize: this._containerSize,
      positionIndex: this._positionIndex,
      scrollPosition: mainScrollPosition,
      scrollPositions: this._viewportConfig.type === 'split' ? this._scrollPositions : undefined,
      overlays: this._overlayConfigs,
      zoom: this._currentZoom,
      gutterDimensions: this.coordinateSystem.getOutlineGutter?.(),
      headerVisibility: {
        showRowHeaders: this._config.showHeaders,
        showColumnHeaders: this._config.showHeaders,
      },
    });

    // Compose sheet-scoped viewport IDs onto the layout (L969-982). The canvas
    // layer produces role-based IDs ("main", "freeze-corner", etc.); we stamp
    // each with the current sheet so downstream consumers (renderer, kernel
    // buffers, Rust registrations) operate on a single ID space.
    const sheetId = this._renderer.getCurrentSheetId();
    const composedLayout = sheetId
      ? {
          ...layout,
          viewports: layout.viewports.map((vp) => ({ ...vp, id: `${vp.id}:${sheetId}` })),
        }
      : layout;

    const reason = options.reason ?? 'structural';
    const nextStructuralSignature = this._structuralLayoutSignatureFor(composedLayout);
    const previousStructuralSignature = this._structuralLayoutSignature;
    const nextVisibleDataSignature = this._visibleDataSignatureFor(composedLayout);
    const previousVisibleDataSignature = this._visibleDataSignature;
    const nextScrollSignature = this._scrollSignatureFor(composedLayout);
    const previousScrollSignature = this._scrollLayoutSignature;
    this._viewportLayout = composedLayout;
    this._structuralLayoutSignature = nextStructuralSignature;
    this._visibleDataSignature = nextVisibleDataSignature;
    this._scrollLayoutSignature = nextScrollSignature;

    // Sync viewport region handles with Rust (L987).
    this._syncViewportRegistrations();

    // Push layout to the renderer (L992-994).
    const structuralChanged = nextStructuralSignature !== previousStructuralSignature;
    const visibleDataChanged = nextVisibleDataSignature !== previousVisibleDataSignature;
    const scrollChanged = nextScrollSignature !== previousScrollSignature;
    const layoutChanged = structuralChanged || visibleDataChanged || scrollChanged;
    const renderInvalidation = reason === 'scroll' ? 'scroll' : 'structural';
    this._renderer.setViewportLayout(composedLayout, { invalidation: renderInvalidation });

    // Trigger data fetch (debounced). Data-arrival recomputes use if-changed so
    // frozen pane boundaries can settle after real dimensions hydrate without
    // creating a fetch/recompute loop when geometry is unchanged.
    const scheduleRefresh = options.scheduleRefresh ?? true;
    if (
      scheduleRefresh === true ||
      (scheduleRefresh === 'if-changed' && (structuralChanged || visibleDataChanged))
    ) {
      this._scheduleViewportRefresh();
    }

    // Notify capability observers after layout is fully settled.
    if (layoutChanged) {
      this._viewportImpl.notifyVisibleRangeIfChanged();
      this._geometryImpl.notifyGeometryChanged();
      this._overlaysImpl.refreshPositions();
      this._decorationsImpl.refresh();
    }
    if (renderInvalidation === 'structural') {
      this._canvasLayersImpl.invalidateAll();
    }
    this._viewportChrome?.update(this.getViewportState());

    // Emit visible-range-change event when layout changed.
    if (visibleDataChanged) {
      const bounds = this.getVisibleBounds();
      this._emit({
        type: 'visible-range-change',
        visibleRange: {
          startRow: bounds.startRow,
          startCol: bounds.startCol,
          endRow: bounds.endRow,
          endCol: bounds.endCol,
        },
      });
    }
  }

  private _structuralLayoutSignatureFor(layout: ViewportLayout): string {
    return JSON.stringify(
      layout.viewports.map((vp) => ({
        id: vp.id,
        bounds: vp.bounds,
        viewportOrigin: vp.viewportOrigin,
        scrollBehavior: vp.scrollBehavior,
        zoom: vp.zoom,
      })),
    );
  }

  private _visibleDataSignatureFor(layout: ViewportLayout): string {
    return JSON.stringify(
      layout.viewports.map((vp) => ({
        id: vp.id,
        cellRange: vp.cellRange,
      })),
    );
  }

  private _scrollSignatureFor(layout: ViewportLayout): string {
    return JSON.stringify(
      layout.viewports.map((vp) => ({
        id: vp.id,
        scrollOffset: vp.scrollOffset,
      })),
    );
  }

  // ===========================================================================
  // INTERNAL — viewport region handle lifecycle.
  //
  // Source: renderer-execution.ts L907-936 (syncViewportRegistrations).
  // ===========================================================================

  private _syncViewportRegistrations(): void {
    if (!this._workbookViewport || !this._viewportLayout) return;

    const currentIds = new Set<string>();
    for (const vp of this._viewportLayout.viewports) {
      currentIds.add(vp.id);

      const existing = this._regions.get(vp.id);
      if (existing) {
        existing.updateBounds(vp.cellRange);
      } else {
        // Extract sheetId from composed ID ("main:sheet-abc" → "sheet-abc")
        const colonIdx = vp.id.indexOf(':');
        const extractedSheetId = colonIdx >= 0 ? vp.id.slice(colonIdx + 1) : '';
        const region = this._workbookViewport.createRegion(extractedSheetId, vp.cellRange, vp.id);
        this._regions.set(vp.id, region);
      }
    }

    // Dispose removed viewport region handles.
    for (const [oldId, region] of this._regions) {
      if (!currentIds.has(oldId)) {
        region.dispose();
        this._regions.delete(oldId);
      }
    }
  }

  private _createViewportWiring(workbookViewport: WorkbookViewport): ViewportWiring {
    return new ViewportWiring({
      workbookViewport,
      getViewportReader: () => this._getActiveViewportReader(),
      positionIndex: this._positionIndex,
      mergeIndex: this._mergeIndex,
      scheduler: this._renderer.getRenderScheduler(),
      expandableScheduler: this._renderer.getRenderScheduler() as unknown as {
        setPositionIndex?: (index: ViewportPositionIndex) => void;
        setMergeIndex?: (index: ViewportMergeIndex) => void;
        setCellExpander?: (expander: import('@mog/canvas-engine').DirtyCellExpander) => void;
      },
      cellExpander: this._renderer.getCellExpander(),
      onViewportGeometryChanged: () => {
        this._recomputeLayout({ scheduleRefresh: 'if-changed' });
        this._emit({ type: 'geometry-change' });
      },
      onViewportBufferChanged: () => this._syncWorkbookDataSources(),
    });
  }

  // ===========================================================================
  // INTERNAL — viewport data refresh (debounced + in-flight guards).
  //
  // Source: renderer-execution.ts L799-892.
  // ===========================================================================

  private _mapScrollBehavior(
    scrollBehaviorType: string,
  ): 'none' | 'horizontal-only' | 'vertical-only' | 'free' {
    switch (scrollBehaviorType) {
      case 'none':
        return 'none';
      case 'horizontal-only':
        return 'horizontal-only';
      case 'vertical-only':
        return 'vertical-only';
      default:
        return 'free';
    }
  }

  private _scheduleViewportRefresh(): void {
    if (!this._viewportLayout) return;
    if (!this._workbookViewport) return;

    if (this._refreshTimer) return;
    const generation = this._viewportRefreshGeneration;
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      void this._executeViewportRefresh(generation);
    }, 16);
  }

  private _isStaleViewportRefresh(generation: number): boolean {
    return this._disposed || generation !== this._viewportRefreshGeneration;
  }

  private _isDisposedRegionError(error: unknown): boolean {
    return error instanceof Error && error.message === 'Handle is disposed';
  }

  private async _executeViewportRefresh(
    generation = this._viewportRefreshGeneration,
  ): Promise<void> {
    if (this._disposed) return;
    if (this._isStaleViewportRefresh(generation)) return;
    try {
      const refreshes: Array<ReturnType<ViewportRegion['refresh']>> = [];
      for (const [, region] of this._regions) {
        const layoutVp = this._viewportLayout?.viewports.find((vp) => vp.id === region.id);
        const scrollBehavior = layoutVp
          ? this._mapScrollBehavior(layoutVp.scrollBehavior.type)
          : 'free';
        refreshes.push(region.refresh(scrollBehavior));
      }
      throwOnFailedViewportRefresh(await Promise.all(refreshes));
      if (this._isStaleViewportRefresh(generation)) return;
      this._renderer.invalidateAll();
    } catch (error) {
      if (this._isStaleViewportRefresh(generation) && this._isDisposedRegionError(error)) {
        return;
      }
      throw error;
    }
  }

  private async _immediateViewportRefresh(): Promise<void> {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (!this._viewportLayout) return;
    if (!this._workbookViewport) return;
    await this._executeViewportRefresh();
  }

  // ===========================================================================
  // INTERNAL — helpers.
  // ===========================================================================

  private _rendererSizeForHost(width: number, height: number): Size {
    const inset = this._rendererInset();
    return {
      width: Math.max(0, width - inset.right),
      height: Math.max(0, height - inset.bottom),
    };
  }

  private _rendererInset(): Required<SheetViewViewportInset> {
    const viewportInset =
      typeof this._config.viewportInset === 'function'
        ? this._config.viewportInset()
        : this._config.viewportInset;

    return {
      right: this._chromeRightInset() + Math.max(0, viewportInset?.right ?? 0),
      bottom: this._chromeBottomInset() + Math.max(0, viewportInset?.bottom ?? 0),
    };
  }

  private _chromeRightInset(): number {
    return this._config.viewportChrome.scrollbars ? SHEET_VIEW_SCROLLBAR_SIZE : 0;
  }

  private _chromeBottomInset(): number {
    return this._config.viewportChrome.scrollbars || this._config.viewportChrome.zoomControls
      ? SHEET_VIEW_SCROLLBAR_SIZE
      : 0;
  }

  private _syncRendererContainerInset(): void {
    const inset = this._rendererInset();
    this._rendererContainer.style.right = `${inset.right}px`;
    this._rendererContainer.style.bottom = `${inset.bottom}px`;
  }

  private _viewportBoundsForState(sheetId: string): { width: number; height: number } {
    const bounds = this.coordinateSystem.getViewportBounds?.(sheetId);
    if (!bounds) return { width: this._containerSize.width, height: this._containerSize.height };
    const record = bounds as Record<string, number>;
    if ('width' in record) {
      return {
        width: record.width ?? this._containerSize.width,
        height: record.height ?? this._containerSize.height,
      };
    }
    return {
      width: (record.right ?? this._containerSize.width) - (record.left ?? 0),
      height: (record.bottom ?? this._containerSize.height) - (record.top ?? 0),
    };
  }

  /**
   * Return the ViewportReader for the current sheet, or null.
   *
   * Resolves from the attached workbook. Returning null is valid — the wiring
   * then skips VPI/VMI rebuilds on `fetch-committed` / `dimensions-patched`;
   * scheduler marks (including `cells-patched`) still fire.
   *
   * The resolution uses the renderer's current sheet ID, so `switchSheet()` is
   * automatically handled — the next event after a switch sees the new sheet ID
   * and the workbook returns the new reader.
   */
  private _getActiveViewportReader(): ViewportReader | null {
    const sheetId = this._renderer.getCurrentSheetId();
    if (!sheetId || !this._workbook) return null;

    try {
      return this._workbook.getSheetById(sheetId as never).viewport;
    } catch {
      return null;
    }
  }

  /**
   * Bind the renderer's cell-data hot path to the workbook viewport buffer.
   *
   * The full spreadsheet app does this through useRenderContextConfig:
   * SpreadsheetGrid passes ws.viewport.binaryCellReader and
   * ws.viewport.binaryCellReaderForViewport into the renderer context. Standalone
   * SheetView owns the same workbook-to-renderer binding, so it must push those
   * readers when a workbook attaches, sheets switch, or viewport buffers refresh.
   */
  private _syncWorkbookDataSources(): void {
    const reader = this._getActiveViewportReader();
    this.updateContext({
      binaryCellReader: reader?.binaryCellReader ?? null,
      binaryCellReaderForViewport: reader?.binaryCellReaderForViewport ?? null,
    });
  }

  private _resolveAnchorRects(anchor: OverlayAnchor): SheetRect[] {
    if (anchor.type === 'viewport-point') {
      return [{ x: anchor.x, y: anchor.y, width: 0, height: 0 }];
    }
    if (anchor.type === 'cell') {
      const rect = this.geometry.getCellRect({ row: anchor.row, col: anchor.col });
      return rect ? [rect] : [];
    }
    return this.geometry.getRangeRects({
      startRow: anchor.startRow,
      startCol: anchor.startCol,
      endRow: anchor.endRow,
      endCol: anchor.endCol,
    });
  }

  private _handleEditorStateChange(editor: {
    isEditing: boolean;
    cell?: { row: number; col: number };
  }): void {
    const wasEditing = this._lastEditorIsEditing;
    this._lastEditorIsEditing = editor.isEditing;
    if (!wasEditing && editor.isEditing && editor.cell) {
      this._emit({
        type: 'edit-start-request',
        cell: { row: editor.cell.row, col: editor.cell.col },
        trigger: 'api',
      });
    }
    // edit-commit-request / edit-cancel-request: SheetView cannot distinguish
    // commit vs cancel — the app's editor state machine owns that knowledge.
    // These events remain unwired from SheetView.
  }

  private _ensureNotDisposed(): void {
    if (this._disposed) {
      throw new Error('SheetView: method called after dispose()');
    }
  }

  /**
   * Emit a view-level event to all subscribers.
   * Short-hand for `this._eventsImpl.emit()` with a disposed guard.
   */
  private _emit(event: SheetViewEvent): void {
    if (this._disposed) return;
    this._eventsImpl.emit(event);
  }

  private _installInternalScrollAndClick(): void {
    // Minimal, self-contained input wiring for display-only consumers (embed).
    // Advanced consumers (the app) pass `scrollable: false` and manage their
    // own InputCoordinator/ScrollPhysics — see design doc.
    const el = this._rendererContainer;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cur = this._scrollPositions.get('main') ?? { x: 0, y: 0 };
      const next = { x: Math.max(0, cur.x + e.deltaX), y: Math.max(0, cur.y + e.deltaY) };
      this.setScrollPosition(next, 'main');
      // Emit cell-origin on scroll for simple consumers.
      const bounds = this.getVisibleBounds();
      this._callbacks.onScroll?.(bounds.startRow, bounds.startCol);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    this._wheelDispose = () => el.removeEventListener('wheel', onWheel);

    // --- Cell pointer events (click, dblclick, contextmenu, hover) ---
    // These emit cell-pointer-intent events alongside the legacy onCellClick callback.

    const hitTestCell = (
      e: MouseEvent,
    ): { row: number; col: number; x: number; y: number } | null => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = this._renderer.hitTest(x, y);
      if (hit && (hit as { type?: string }).type === 'cell') {
        const cell = hit as unknown as { row: number; col: number };
        return { row: cell.row, col: cell.col, x, y };
      }
      return null;
    };

    const onClick = (e: MouseEvent) => {
      const result = hitTestCell(e);
      if (result) {
        this._callbacks.onCellClick?.(result.row, result.col);
        this._emit({
          type: 'cell-pointer-intent',
          cell: { row: result.row, col: result.col },
          pointerType: 'click',
          viewportPoint: { x: result.x, y: result.y },
        });
      }
    };
    el.addEventListener('click', onClick);
    this._clickDispose = () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('dblclick', onDblClick);
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('mousemove', onMouseMove);
    };

    const onDblClick = (e: MouseEvent) => {
      const result = hitTestCell(e);
      if (result) {
        this._emit({
          type: 'cell-pointer-intent',
          cell: { row: result.row, col: result.col },
          pointerType: 'dblclick',
          viewportPoint: { x: result.x, y: result.y },
        });
      }
    };
    el.addEventListener('dblclick', onDblClick);

    const onContextMenu = (e: MouseEvent) => {
      const result = hitTestCell(e);
      if (result) {
        this._emit({
          type: 'cell-pointer-intent',
          cell: { row: result.row, col: result.col },
          pointerType: 'contextmenu',
          viewportPoint: { x: result.x, y: result.y },
        });
      }
    };
    el.addEventListener('contextmenu', onContextMenu);

    const onMouseMove = (e: MouseEvent) => {
      const result = hitTestCell(e);
      if (result) {
        this._emit({
          type: 'cell-pointer-intent',
          cell: { row: result.row, col: result.col },
          pointerType: 'hover',
          viewportPoint: { x: result.x, y: result.y },
        });
      }
    };
    el.addEventListener('mousemove', onMouseMove);
  }

  private _installFocusListeners(container: HTMLElement): void {
    const onFocusIn = (e: FocusEvent) => {
      // Only emit when focus moves INTO the container from outside.
      // relatedTarget is the element that lost focus; if it's inside the
      // container, this is an internal focus move, not an enter.
      if (e.relatedTarget instanceof Node && container.contains(e.relatedTarget)) return;
      this._emit({ type: 'focus-enter' });
    };

    const onFocusOut = (e: FocusEvent) => {
      // Only emit when focus moves OUT of the container entirely.
      // relatedTarget is the element gaining focus; if it's inside the
      // container, this is an internal focus move, not a leave.
      if (e.relatedTarget instanceof Node && container.contains(e.relatedTarget)) return;
      this._emit({ type: 'focus-leave' });
    };

    container.addEventListener('focusin', onFocusIn);
    container.addEventListener('focusout', onFocusOut);
    this._focusDispose = () => {
      container.removeEventListener('focusin', onFocusIn);
      container.removeEventListener('focusout', onFocusOut);
    };
  }
}

// =============================================================================
// createSheetView — public factory
// =============================================================================

/**
 * Create a SheetView and return a capability-only handle.
 * This is the recommended public entry point for external consumers.
 */
export function createSheetView(
  options: SheetViewMountOptions,
  callbacks?: SheetViewCallbacks,
): SheetViewHandle {
  const impl = new SheetView(
    {
      container: options.container,
      showHeaders: options.showHeaders,
      showGridlines: options.showGridlines,
      scrollable: options.scrollable,
      viewportChrome: options.viewportChrome,
      viewportInset: options.viewportInset,
      skin: options.skin,
      dpr: options.dpr,
    },
    callbacks,
  );
  const handle = {
    geometry: impl.geometry,
    hitTest: impl.hitTest,
    render: impl.render,
    objects: impl.objects,
    interactiveElements: impl.interactiveElements,
    viewport: impl.viewport,
    renderState: impl.renderState,
    dataSources: impl.dataSources,
    locale: impl.locale,
    events: impl.events,
    focus: impl.focus,
    commands: impl.commands,
    skin: impl.skin,
    overlays: impl.overlays,
    decorations: impl.decorations,
    layers: impl.layers,
    attach: (source) => impl.attach(source),
    start: () => impl.start(),
    switchSheet: (sheetId) => impl.switchSheet(sheetId),
    rebindWorkbookViewport: () => impl.rebindWorkbookViewport(),
    suspend: () => impl.suspend(),
    resume: () => impl.resume(),
    scrollTo: (row, col) => impl.scrollTo(row, col),
    getVisibleBounds: () => impl.getVisibleBounds(),
    isDisposed: () => impl.isDisposed(),
    setZoom: (zoom) => impl.setZoom(zoom),
    getZoom: () => impl.getZoom(),
    resize: (width, height) => impl.resize(width, height),
    dispose: () => impl.dispose(),
  } satisfies SheetViewHandle;
  Object.defineProperty(handle, INTERNAL_GRID_RENDERER_KEY, {
    value: impl.gridRenderer,
  });
  return handle;
}

export function createSheetViewDataSourceFromWorkbook(
  workbook: SheetViewWorkbookSource,
): SheetViewDataSource {
  return {
    initialSheetId: String(workbook.activeSheet?.sheetId ?? ''),
    workbook,
  };
}
