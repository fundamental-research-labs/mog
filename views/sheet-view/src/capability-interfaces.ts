/**
 * Capability Interfaces for @mog-sdk/sheet-view
 *
 * Each interface defines a focused capability handle that SheetView
 * exposes as a public property. Together they replace direct access to
 * engine, gridRenderer, coordinateSystem, positionIndex, mergeIndex,
 * and updateContext().
 *
 * All parameter and return types are owned by this package
 * (from ./public-types.ts). No internal types leak through these
 * interfaces.
 *
 * @module @mog-sdk/sheet-view/capability-interfaces
 */

import type {
  CellAddress,
  CellInvalidationTarget,
  DimensionInfo,
  FrozenPanesConfig,
  HeaderVisibility,
  InteractiveElementSnapshot,
  InvalidationReason,
  MergeRegion,
  ObjectBounds,
  ObjectSceneInfo,
  OutlineGutter,
  PositionDimensions,
  RangeAddress,
  ScrollBounds,
  ScrollPosition,
  SheetAnchor,
  SheetBounds,
  SheetDisposable,
  SheetHitResult,
  SheetPoint,
  SheetRect,
  SheetSize,
  SheetFloatingObjectScenePatch,
  SheetRenderState,
  SheetSceneObjectSnapshot,
  SheetCultureInfo,
  SheetViewCommand,
  SheetViewDataSource,
  SheetViewDataSourceKey,
  SheetViewDataSources,
  SheetViewEvent,
  SheetOverlayViewportConfig,
  SheetViewportConfig,
  SheetViewportLayout,
  SheetViewResolvedSkin,
  SheetViewSkin,
  SheetViewSkinEvent,
  SheetViewportState,
  SheetViewportSnapshot,
  SheetViewVisibleBounds,
  SplitConfig,
} from './public-types';

// =============================================================================
// 1. Geometry
// =============================================================================

/**
 * Geometry capability — coordinate queries, dimension reads, and
 * merge-anchor resolution.
 *
 * Replaces direct access to coordinateSystem, positionIndex, mergeIndex,
 * gridRenderer.getCellPageBounds, and gridRenderer.getRangePageBounds.
 *
 * All rects are correct under scroll, zoom, resize, frozen panes, split
 * panes, hidden rows/cols, row/col resize, merged cells, headers, and
 * device pixel ratio.
 */
export interface ISheetViewGeometry {
  /**
   * Get viewport-space rectangle(s) for a cell.
   * Returns null if the cell is not visible.
   */
  getCellRect(cell: CellAddress): SheetRect | null;

  /**
   * Get viewport-space rectangles for a range.
   * May return multiple rects when the range spans frozen/non-frozen boundaries.
   */
  getRangeRects(range: RangeAddress): SheetRect[];

  /**
   * Get page-space (browser absolute) rectangle for a cell.
   * Suitable for DOM overlays, popovers, and Playwright clicks.
   * Returns null if the cell is not visible or renderer is not ready.
   */
  getCellPageRect(cell: CellAddress): SheetRect | null;

  /**
   * Get page-space rectangles for a range.
   * Returns multiple rects when the range spans the frozen/non-frozen boundary.
   */
  getRangePageRects(range: RangeAddress): SheetRect[];

  /**
   * Get the full rendered (drawn) size of a cell: column width / row height
   * scaled by the active zoom.
   *
   * Independent of scroll position and viewport — a cell scrolled off-screen
   * still reports its full drawn width/height here, unlike `getCellPageRect`.
   * Use this to measure intrinsic rendered dimensions (column width / row
   * height readbacks); use `getCellPageRect` for click/overlay positioning.
   *
   * Returns null only if the renderer is not ready (no usable zoom).
   */
  getCellRenderedSize(cell: CellAddress): SheetSize | null;

  /**
   * Get dimension information for a row or column.
   *
   * For a CellAddress, returns both the row and column dimension.
   * For a RangeAddress, returns dimensions for the anchor row/col.
   */
  getDimensions(anchor: SheetAnchor): DimensionInfo[];

  /**
   * Convert a viewport-space point to a cell address.
   * Returns null if the point is outside the cell grid.
   */
  fromViewportPoint(point: SheetPoint): CellAddress | null;

  /**
   * Convert a cell address to its viewport-space origin point.
   * Returns null if the cell is not visible.
   */
  toViewportPoint(cell: CellAddress): SheetPoint | null;

  /**
   * Get the currently visible cell range in the main viewport.
   */
  getVisibleRange(): RangeAddress;

  /**
   * Get total sheet bounds (total rows and columns).
   */
  getSheetBounds(): SheetBounds;

  /**
   * Resolve a cell to its merged-cell anchor.
   *
   * If (row, col) is inside a merged region, returns the merge region.
   * If (row, col) is not merged, returns null.
   *
   * This replaces direct mergeIndex.getMergedRegion() access.
   */
  getMergeAnchor(row: number, col: number): MergeRegion | null;

  /**
   * Get a read-only position dimensions snapshot for scroll snapping.
   *
   * The returned object provides cell boundary data needed by scroll
   * physics to compute snap targets. It exposes the minimum interface
   * that ScrollPhysics.snapToCell() requires.
   */
  getPositionDimensions(): PositionDimensions;

  /**
   * Observe geometry changes for a specific anchor.
   * The listener fires when the anchor's visual position or size changes
   * (due to scroll, zoom, resize, hidden state changes, etc.).
   *
   * Returns a disposable handle to stop observing.
   */
  observe(anchor: SheetAnchor, listener: (rect: SheetRect | null) => void): SheetDisposable;

  /**
   * Whether row and column headers are currently visible.
   */
  getHeaderVisibility(): HeaderVisibility;

  /**
   * Get the browser page-space bounding rect of the SheetView container element.
   * Useful for converting page-space coordinates to local-space.
   */
  getContainerRect(): SheetRect;

  /**
   * Get the pixel dimensions of the outline (grouping) gutter areas.
   */
  getOutlineGutter(): OutlineGutter;

  /**
   * Get the offset from the viewport origin to the start of the cell data area.
   *
   * The cell data area is the region where cells are rendered, excluding
   * row/column headers and outline gutters. Use this to convert viewport-space
   * points to layer-space (cell-area-relative) points:
   *
   * ```ts
   * const offset = geometry.getCellAreaOffset();
   * const layerX = viewportX - offset.x;
   * const layerY = viewportY - offset.y;
   * ```
   */
  getCellAreaOffset(): SheetPoint;

  /**
   * Get the clipped (overflow-ellipsis) text content for a cell.
   *
   * Returns the full text content of the cell if it is visually clipped
   * (i.e., the rendered text was truncated with an ellipsis because it
   * exceeds the cell width). Returns null if the cell is not clipped
   * or the cell is empty.
   *
   * Useful for overflow tooltips that show the full content on hover.
   */
  getClippedCellContent(row: number, col: number): string | null;
}

// =============================================================================
// 2. Hit Testing
// =============================================================================

/**
 * Hit testing capability — point classification against all rendered layers.
 *
 * Replaces gridRenderer.hitTest() and coordinateSystem.classifyPoint().
 */
export interface ISheetViewHitTest {
  /**
   * Hit test at a viewport-space point (canvas-relative CSS pixels).
   * This is the coordinate space of mouse events on the canvas element.
   */
  atViewportPoint(point: SheetPoint): SheetHitResult;

  /**
   * Hit test at a page-space point (browser absolute coordinates).
   * Converts from page coordinates to viewport coordinates internally.
   */
  atPagePoint(point: SheetPoint): SheetHitResult;
}

// =============================================================================
// 3. Render Invalidation
// =============================================================================

/**
 * Render invalidation capability — request repaints and query current sheet.
 *
 * Replaces gridRenderer.invalidateAll(), invalidateCells(), invalidateLayer(),
 * and getCurrentSheetId().
 */
export interface ISheetViewRender {
  /**
   * Request a full invalidation of all rendering layers.
   *
   * @param reason - Optional hint for the invalidation cause.
   */
  invalidate(reason?: InvalidationReason): void;

  /**
   * Invalidate specific cells for targeted repaint.
   */
  invalidateCells(target: CellInvalidationTarget): void;

  /**
   * Invalidate geometry-dependent layers (headers, cell positions).
   *
   * @param reason - Optional hint.
   */
  invalidateGeometry(reason?: InvalidationReason): void;

  /**
   * Request a single render frame without marking layers dirty.
   * Useful for animation ticks or transient visual updates.
   *
   * @param reason - Optional hint.
   */
  requestFrame(reason?: InvalidationReason): void;

  /**
   * Get the ID of the currently active sheet being rendered.
   */
  getCurrentSheetId(): string;
}

// =============================================================================
// 4. Floating Object Scene
// =============================================================================

/**
 * Floating object scene capability — synchronous scene graph reads and
 * transient bounds updates for drag/resize/rotate operations.
 *
 * Replaces gridRenderer.boundsReader, gridRenderer.getObjectBoundsSync(),
 * and gridRenderer.updateObjectBounds().
 */
export interface ISheetViewObjects {
  /**
   * Hit test a floating object at a viewport point.
   * Returns scene info if a floating object is at the given point, null otherwise.
   */
  hitTest(point: SheetPoint): ObjectSceneInfo | null;

  /**
   * Get the current bounds of a floating object from the scene graph.
   * Returns null if the object is not in the scene graph.
   */
  getBounds(objectId: string): ObjectBounds | null;

  /**
   * Get every object currently present in the renderer scene graph, sorted by
   * z-order. This reports rendered scene state, not workbook persistence state.
   */
  getSceneObjectsByZOrder(): readonly SheetSceneObjectSnapshot[];

  /**
   * Get a rendered scene object by id, or null if the object is not currently
   * present in the scene graph.
   */
  getSceneObject(objectId: string): SheetSceneObjectSnapshot | null;

  /**
   * Apply committed floating-object scene graph patches. This is the
   * data-bearing object-scene route for coordinator/cache updates.
   */
  applyPatches(patches: readonly SheetFloatingObjectScenePatch[]): void;

  /**
   * Update transient bounds during drag/resize/rotate.
   * These bounds are visual-only and not persisted.
   * The scene graph is updated synchronously.
   */
  updateTransientBounds(objectId: string, bounds: ObjectBounds): void;

  /**
   * Clear transient bounds, reverting to the committed scene graph state.
   *
   * @param objectId - Specific object to clear. If omitted, clears all.
   */
  clearTransientBounds(objectId?: string): void;

  /** Force a scene graph resync without exposing the raw renderer. */
  resyncScene(options?: { force?: boolean; sheetId?: string }): void;

  /**
   * Invalidate the rendering of a specific floating object or all objects.
   *
   * @param objectId - Specific object. If omitted, invalidates all.
   */
  invalidate(objectId?: string): void;
}

// =============================================================================
// 5. Interactive Elements
// =============================================================================

/**
 * Interactive element capability — observation of canvas-rendered interactive
 * elements (filter buttons, checkboxes, etc.) that need DOM overlays.
 *
 * Replaces gridRenderer.getInteractiveElementCollector().
 */
export interface ISheetViewInteractiveElements {
  /**
   * Get a snapshot of all currently visible interactive elements.
   */
  getSnapshot(): InteractiveElementSnapshot;

  /**
   * Observe interactive element changes. The listener fires after each
   * render frame with the updated set of visible elements.
   *
   * Returns a disposable handle to stop observing.
   */
  observe(listener: (snapshot: InteractiveElementSnapshot) => void): SheetDisposable;
}

// =============================================================================
// 6. Viewport
// =============================================================================

/**
 * Viewport capability — scroll, frozen panes, split views, and layout.
 *
 * Replaces setScrollPosition, getScrollPosition, setFrozenPanes,
 * getFrozenPanes, setViewportConfig, getViewportConfig, getViewportLayout,
 * addOverlayViewport, removeOverlayViewport, and invalidateLayout.
 */
export interface ISheetViewViewport {
  /**
   * Set scroll position for a specific viewport.
   *
   * @param position - Scroll offset in pixels.
   * @param viewportId - Viewport ID (default: 'main').
   */
  setScrollPosition(position: ScrollPosition, viewportId?: string): void;

  /**
   * Get the current scroll position for a viewport.
   *
   * @param viewportId - Viewport ID (default: 'main').
   */
  getScrollPosition(viewportId?: string): ScrollPosition;

  /**
   * Get all viewport scroll positions (useful for serializing split view state).
   */
  getAllScrollPositions(): ReadonlyMap<string, ScrollPosition>;

  /**
   * Set all viewport scroll positions at once (useful for restoring split view state).
   */
  setAllScrollPositions(positions: ReadonlyMap<string, ScrollPosition>): void;

  setConfig(config: SheetViewportConfig): void;
  getConfig(): SheetViewportConfig;
  addOverlay(config: SheetOverlayViewportConfig): void;
  removeOverlay(id: string): void;
  getLayout(): SheetViewportLayout | null;

  /**
   * Observe visible range changes.
   * The listener fires when the visible cell range changes (scroll, resize, zoom).
   *
   * Returns a disposable handle to stop observing.
   */
  observeVisibleRange(listener: (range: RangeAddress) => void): SheetDisposable;

  /**
   * Set frozen panes.
   */
  setFrozenPanes(panes: FrozenPanesConfig): void;

  /**
   * Get the current frozen pane configuration.
   */
  getFrozenPanes(): FrozenPanesConfig;

  /**
   * Set a split view configuration.
   */
  setSplit(config: SplitConfig): void;

  /**
   * Clear the split view, returning to single-viewport mode.
   */
  clearSplit(): void;

  /**
   * Get the maximum scroll extents for the current sheet.
   *
   * Returns the pixel bounds beyond which scrolling is clamped.
   * Used by scroll physics for momentum decay and elastic clamping.
   */
  getScrollBounds(): ScrollBounds;

  /**
   * Compute the scroll position needed to bring a cell into view.
   * Returns null if the cell is already visible.
   */
  getScrollToCell(cell: CellAddress): ScrollPosition | null;

  /**
   * Get the pixel bounds of the viewport area (the rendering viewport).
   */
  getViewportBounds(): SheetRect;

  /**
   * Get a snapshot of the current viewport state.
   */
  getSnapshot(): SheetViewportSnapshot;

  /**
   * Get the chrome-ready viewport state for built-in or host-owned controls.
   */
  getViewportState(): SheetViewportState;

  /**
   * Clamp a requested pixel scroll position to the current viewport bounds.
   */
  clampScrollPosition(position: ScrollPosition, viewportId?: string): ScrollPosition;

  /**
   * Trigger explicit layout recomputation.
   */
  invalidateLayout(): void;
}

// =============================================================================
// 7. Render State
// =============================================================================

/**
 * Render state capability — push visual state to the renderer.
 *
 * Replaces updateContext(Partial<RenderContextConfig>).
 */
export interface ISheetViewRenderState {
  /**
   * Update the view's render state. Accepts a partial update that
   * is merged with the current state.
   *
   * Only view-rendering concerns are accepted. App machine state,
   * XState snapshots, and command semantics are not part of this
   * interface.
   */
  update(state: Partial<SheetRenderState>): void;
}

// =============================================================================
// 7b. Data Sources
// =============================================================================

/**
 * Non-viewport renderer data-source registration.
 *
 * Binary viewport readers belong to attach(source). This capability is for
 * app-owned lookup callbacks such as tables, filters, sparklines, validation,
 * floating objects, charts, grouping, and trace-arrow position resolution.
 */
export interface ISheetViewDataSources {
  replace(sources: SheetViewDataSources): void;
  update(sources: Partial<SheetViewDataSources>): void;
  clear(keys?: readonly SheetViewDataSourceKey[]): void;
}

// =============================================================================
// 7c. Locale
// =============================================================================

/** Locale/culture configuration without exposing @mog/culture types. */
export interface ISheetViewLocale {
  setCultureTag(tag: string): void;
  setCulture(culture: SheetCultureInfo): void;
  getCultureTag(): string;
}

// =============================================================================
// 8. Events
// =============================================================================

/**
 * Event subscription capability — observe view-level facts and intents.
 *
 * Events cover cell pointer intents, visible range changes, geometry
 * changes, scroll/zoom changes, focus enter/leave, and edit intents.
 * They do NOT expose app state, clipboard implementation, or XState actors.
 */
export interface ISheetViewEvents {
  /**
   * Subscribe to all view events.
   *
   * The listener receives every event emitted by the view. Consumers
   * filter by event.type to handle specific events.
   *
   * Returns a disposable handle to unsubscribe.
   */
  subscribe(listener: (event: SheetViewEvent) => void): SheetDisposable;
}

// =============================================================================
// 9. Focus
// =============================================================================

/**
 * Focus capability — keyboard/focus boundary management.
 */
export interface ISheetViewFocus {
  /**
   * Programmatically focus the view's focusable element.
   */
  focus(): void;

  /**
   * Programmatically blur the view's focusable element.
   */
  blur(): void;

  /**
   * Check whether the view currently contains the active element.
   */
  containsActiveElement(): boolean;
}

// =============================================================================
// 10. Commands
// =============================================================================

/**
 * Command dispatch capability — send view-level commands.
 *
 * Commands are requests from the host to the view. They express
 * view-level intent (scroll, zoom, invalidation), not app policy
 * or data mutations.
 */
export interface ISheetViewCommands {
  /**
   * Dispatch a view command.
   */
  dispatch(command: SheetViewCommand): void;
}

// =============================================================================
// 11. Skin
// =============================================================================

/**
 * Skin lifecycle capability — apply and observe non-persistent SheetView skins.
 *
 * A skin controls view chrome and renderer policy only. It must not mutate
 * workbook theme, cell formats, collaboration state, or persisted document data.
 */
export interface ISheetViewSkin {
  /**
   * Set or clear the current skin.
   *
   * This update is synchronous for serializable fields. Asset-backed and custom
   * renderer plumbing may emit later lifecycle events as renderer integration
   * grows.
   */
  set(skin: SheetViewSkin | null): void;

  /** Get the last skin supplied by the host, or null when no skin is active. */
  get(): SheetViewSkin | null;

  /** Get the resolved read model for debugging and tests. */
  getResolved(): SheetViewResolvedSkin;

  /** Subscribe to skin lifecycle events. */
  on(listener: (event: SheetViewSkinEvent) => void): SheetDisposable;
}

// =============================================================================
// Extension capabilities (extension capability)
// =============================================================================

/**
 * Overlay anchor types — identify what a visual element attaches to.
 */
export type OverlayAnchor =
  | { type: 'cell'; row: number; col: number }
  | { type: 'range'; startRow: number; startCol: number; endRow: number; endCol: number }
  | { type: 'viewport-point'; x: number; y: number };

/**
 * Overlay placement relative to anchor.
 */
export type OverlayPlacement =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end';

/**
 * Options for mounting a DOM overlay.
 */
export interface SheetOverlayOptions {
  anchor: OverlayAnchor;
  placement: OverlayPlacement;
  collision?: 'none' | 'flip' | 'shift' | 'hide';
  dismissOnScroll?: boolean;
  dismissOnSheetChange?: boolean;
}

/**
 * Handle for a mounted DOM overlay.
 */
export interface SheetOverlayHandle {
  /** Update the overlay anchor or placement. */
  update(options: Partial<SheetOverlayOptions>): void;
  /** Remove the overlay and clean up. */
  dispose(): void;
}

/**
 * DOM overlay API — mount host-owned elements anchored to spreadsheet geometry.
 */
export interface ISheetViewOverlays {
  /**
   * Mount a host-owned DOM element as an overlay positioned relative to
   * spreadsheet geometry. Mog owns anchoring, position updates, and disposal.
   * The host owns DOM content and CSS.
   */
  mount(element: HTMLElement, options: SheetOverlayOptions): SheetOverlayHandle;
}

// ---------------------------------------------------------------------------
// Decorations
// ---------------------------------------------------------------------------

/**
 * Built-in decoration visual kinds.
 */
export type DecorationKind = 'fill' | 'border' | 'badge' | 'underline' | 'stripe' | 'glow';

/**
 * Built-in animation presets for decorations.
 */
export type DecorationAnimationPreset =
  | 'none'
  | 'fade-in'
  | 'fade-out'
  | 'pulse'
  | 'shimmer'
  | 'flash';

/**
 * Decoration style options (kind-dependent).
 */
export interface DecorationStyle {
  color?: string;
  opacity?: number;
  borderColor?: string;
  borderWidth?: number;
  badgeText?: string;
  badgePosition?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

/**
 * Animation options for a decoration.
 */
export interface DecorationAnimation {
  preset: DecorationAnimationPreset;
  durationMs?: number;
  iterations?: number;
}

/**
 * Specification for creating a decoration.
 */
export interface SheetDecorationSpec {
  anchor: OverlayAnchor;
  kind: DecorationKind;
  style?: DecorationStyle;
  animation?: DecorationAnimation;
  group?: string;
}

/**
 * Handle for a created decoration.
 */
export interface SheetDecorationHandle {
  readonly id: string;
  /** Update decoration properties. */
  update(spec: Partial<Omit<SheetDecorationSpec, 'anchor'>>): void;
  /** Remove this decoration. */
  dispose(): void;
}

/**
 * Non-destructive decoration API — visual annotations on cells/ranges
 * that do NOT mutate workbook formatting.
 */
export interface ISheetViewDecorations {
  /** Add a decoration. */
  add(spec: SheetDecorationSpec): SheetDecorationHandle;
  /** Remove a decoration by ID. */
  remove(id: string): void;
  /** Remove all decorations matching a group. */
  removeGroup(group: string): void;
  /** Remove all decorations. */
  clear(): void;
}

// ---------------------------------------------------------------------------
// Canvas extension layers
// ---------------------------------------------------------------------------

/**
 * Z-order for custom canvas layers relative to built-in rendering.
 */
export type CanvasLayerZOrder =
  | 'below-cells'
  | 'below-content'
  | 'above-content'
  | 'above-selection'
  | 'overlay';

/**
 * Frame context passed to custom canvas layer render callbacks.
 */
export interface SheetCanvasFrame {
  /** The 2D rendering context for the layer's canvas. */
  ctx: CanvasRenderingContext2D;
  /** Device pixel ratio. */
  dpr: number;
  /** Currently visible cell range. */
  visibleRange: { startRow: number; startCol: number; endRow: number; endCol: number };
  /** Request a re-render of this layer on the next frame. */
  invalidate(): void;
  /** Current timestamp (performance.now()). */
  now: number;
}

/**
 * Options for creating a canvas extension layer.
 */
export interface SheetCanvasLayerOptions {
  id?: string;
  zOrder: CanvasLayerZOrder;
  /** Render callback invoked each frame the layer is visible. */
  render(frame: SheetCanvasFrame): void;
}

/**
 * Handle for a created canvas extension layer.
 */
export interface SheetCanvasLayerHandle {
  /** Request re-render of this layer. */
  invalidate(): void;
  /** Remove this layer. */
  dispose(): void;
}

/**
 * Canvas extension layer API — custom rendering in the grid pipeline.
 */
export interface ISheetViewCanvasLayers {
  /** Create a custom canvas layer at the specified z-order. */
  createLayer(options: SheetCanvasLayerOptions): SheetCanvasLayerHandle;
}

// =============================================================================
// SheetViewHandle — public capability facade
// =============================================================================

/**
 * Public capability handle for a SheetView instance.
 *
 * This is the primary public API for external consumers. It exposes
 * only capability-based APIs — no renderer internals, no raw engine,
 * no grid layers, no position/merge indices.
 */
export interface SheetViewHandle {
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

  /**
   * Bind a Workbook to this view. Wires viewport events, populates
   * viewport indices, restores scroll, and computes initial layout.
   */
  attach(source: SheetViewDataSource): void;

  /**
   * Start the render loop. Call after attach() and any additional policy wiring.
   */
  start(): void;

  /** Switch the active sheet. */
  switchSheet(sheetId: string): void;

  /**
   * Rebind to the attached workbook's current viewport coordinator.
   * Use after the workbook swaps its backing context while retaining identity.
   */
  rebindWorkbookViewport(): void;

  /** Pause the render loop. */
  suspend(): void;
  /** Resume the render loop. */
  resume(): void;

  /** Scroll a cell into view. */
  scrollTo(row: number, col: number): void;
  /** Get currently visible cell range. */
  getVisibleBounds(): SheetViewVisibleBounds;

  /** True after dispose() has released view-owned resources. */
  isDisposed(): boolean;

  /** Set zoom level (1.0 = 100%). */
  setZoom(zoom: number): void;
  /** Get current zoom level. */
  getZoom(): number;

  /** Resize the view to new dimensions. */
  resize(width: number, height: number): void;

  /** Release all view-owned resources. Does NOT dispose the attached workbook. */
  dispose(): void;
}
