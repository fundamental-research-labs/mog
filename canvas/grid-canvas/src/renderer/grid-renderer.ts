/**
 * Grid Renderer — Composition Facade
 *
 * Thin facade that wires together 4 canvas packages:
 * 1. @mog/canvas-engine   — generic multi-canvas render loop, scheduler, input
 * 2. @mog/grid-renderer   — cell/background/selection/header layers
 * 3. @mog/drawing-canvas  — floating object scene graph + renderers
 * 4. @mog/canvas-overlay  — screen-space UX chrome (handles, guides, ink)
 *
 * The facade implements the full GridRenderer contract from spreadsheet-contracts.
 * It converts the legacy RenderContextConfig (80+ fields) into typed data source
 * adapters via a static dispatch table in updateContext() for O(1) per-field cost.
 *
 * @module canvas/renderer/grid-renderer
 */

import { isProd } from '@mog/env';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';
import type { ISceneGraphReader } from '@mog-sdk/contracts/objects/scene-graph-reader';
import { SceneGraphBoundsReader } from './scene-graph-bounds-reader';
import { SceneGraphReader } from './scene-graph-reader';
import type { IDiagramBridge } from '@mog-sdk/contracts/bridges';
import type { CellFormat, CellRange } from '@mog-sdk/contracts/core';
import type { CultureInfo } from '@mog-sdk/contracts/culture';
import type { FilterHeaderInfo } from '@mog-sdk/contracts/filter';
import type {
  FloatingObject,
  DiagramObject,
  TextBoxObject,
} from '@mog-sdk/contracts/floating-objects';
import type {
  GroupDefinition,
  OutlineLevel,
  SheetGroupingConfig,
} from '@mog-sdk/contracts/grouping';
import type { InkAccessorForRendering } from '@mog-sdk/contracts/ink';
import type { ClipboardSnapshot, EditorSnapshot } from '@mog-sdk/contracts/machines';
import type {
  CellDataSource,
  ChromeTheme,
  CollaborationDataSource,
  LayerName as ContractsLayerName,
  DragDropState,
  FloatingObjectDataSource,
  FloatingObjectRenderState,
  GridRegionMeta,
  GridRenderer,
  GroupingDataSource,
  InteractiveElementCollector,
  ITextEffectCanvasBridge,
  ObjectBounds,
  ObjectBoundsUpdate,
  ObjectHitRegion,
  OverlayDataSource,
  PageBreakDataSource,
  PageBreakDragState,
  PageBreaks,
  PastePreviewData,
  PrintArea,
  RemoteCursor,
  RenderLatexFn,
  RenderScheduler,
  SelectionDataSource,
  SelectionRenderState,
  SheetDataSource,
  ShimmerEffectType,
  ShimmerEntry,
  TraceDataSource,
  UnifiedHitResult,
} from '@mog-sdk/contracts/rendering';
import type { FloatingObjectPatch } from '@mog-sdk/contracts/rendering';
import type { ResolvedSheetViewSkin } from '@mog-sdk/contracts/rendering/sheet-view-skin';
import { DEFAULT_SHIMMER_CONFIG, RenderPriority } from '@mog-sdk/contracts/rendering';
import type { SearchHighlight } from '@mog-sdk/contracts/search';
import type { SparklineRenderData } from '@mog-sdk/contracts/sparklines';
import type { TableConfig } from '@mog-sdk/contracts/tables';
import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import type { TraceArrow } from '@mog-sdk/contracts/trace-arrows';
import { DEFAULT_RESOLVED_SHEET_VIEW_SKIN } from '@mog-sdk/contracts/rendering/sheet-view-skin';

// Canvas Engine
import {
  CanvasTextMeasurer,
  createCanvasEngine,
  docToCanvasXY,
  docSpaceRect,
  type CanvasEngineInstance,
  type DirtyHint,
  type DocSpaceRect,
  type Rect as EngineRect,
} from '@mog/canvas-engine';

// Grid Renderer (layers + hit test)
import {
  COL_HEADER_HEIGHT,
  createGridHitTest,
  createGridLayers,
  createInteractiveElementCollector,
  GridCoordinateSystem,
  DEFAULT_CHROME_THEME,
  NULL_SELECTION_DATA_SOURCE,
  NULL_SHEET_DATA_SOURCE,
  ROW_HEADER_WIDTH,
  type GridLayersResult,
  ViewportPositionIndex,
  ViewportMergeIndex,
} from '@mog/grid-renderer';

// Drawing Canvas
import {
  createDrawingLayer,
  HitMap,
  SceneGraph,
  DiagramCanvasBridge,
  type ChartData,
  type ConnectorData,
  type DrawingLayerHandle,
  type EquationData,
  type InkData,
  type ObjectBorderConfig,
  type ObjectFillConfig,
  type OleObjectData,
  type PictureData,
  type SceneObject,
  type ShapeData,
  type TextboxData,
  type TextEffectRef,
} from '@mog/drawing-canvas';

// Canvas Overlay
import { createOverlayLayer, OverlayLayer } from '@mog/canvas-overlay';

// Internal: coordinate system (moved to @mog/grid-renderer)
import type { CellCoord, CoordinateSystem } from '@mog/grid-renderer';
import { CoordinateSystemImpl } from '@mog/grid-renderer';

import type { ViewportLayout } from '@mog/grid-renderer';
import { viewportPoint } from '@mog/spreadsheet-utils/rendering/coordinates';
import { applyChromeTheme } from '../styles/css-variables';
import { GridRenderScheduler } from './grid-render-scheduler';
import type { RenderContextConfig } from './render-context';
import { viewportLayoutToRegionLayout } from './viewport-to-region-layout';

// =============================================================================
// Configuration
// =============================================================================

export interface GridRendererConfig {
  /** Container element — CanvasEngine creates stacked canvases internally */
  container: HTMLElement;

  /** Viewport position index for O(1) row/col position lookups (created internally if not provided) */
  positionIndex?: ViewportPositionIndex;

  /** Viewport merge index for O(1) merged-region lookups (created internally if not provided) */
  mergeIndex?: ViewportMergeIndex;

  /** Initial sheet ID */
  initialSheetId: string;

  /** Total rows */
  totalRows?: number;

  /** Total columns */
  totalCols?: number;

  /** Initial render context config (for state data) */
  contextConfig?: Partial<RenderContextConfig>;

  /**
   * Optional set of layers to register.
   * If not provided, all default layers are registered.
   * Use this to create lightweight renderers that only render specific layers
   * (e.g., readonly dashboards may skip selection/ui/remoteCursors layers).
   */
  layers?: ContractsLayerName[];
}

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

type ViewportLayoutUpdateOptions = {
  readonly invalidation?: 'structural' | 'scroll';
};

// =============================================================================
// Data Source Adapters
// =============================================================================

/**
 * Mutable adapter wrapping RenderContextConfig fields into CellDataSource.
 * Updated in-place by updateContext() dispatch table for zero-allocation hot path.
 */
class CellDataAdapter implements CellDataSource {
  private _getCellValue: (sheetId: string, cell: CellCoord) => unknown = () => '';
  private _getCellFormat: (sheetId: string, cell: CellCoord) => CellFormat | undefined = () =>
    undefined;
  private _getCellBindingStatus: (
    sheetId: string,
    cell: CellCoord,
  ) => { connectionId: string; staleness: 'fresh' | 'stale' | 'error' } | undefined = () =>
    undefined;
  private _getSparklineRenderData: (
    sheetId: string,
    cell: CellCoord,
  ) => SparklineRenderData | undefined = () => undefined;
  private _getTableAtCell: (sheetId: string, cell: CellCoord) => TableConfig | undefined = () =>
    undefined;
  private _hasTableColumnFilter: (
    sheetId: string,
    tableId: string,
    headerRow: number,
    headerCol: number,
  ) => boolean = () => false;
  private _getFilterHeaderInfo: (sheetId: string, cell: CellCoord) => FilterHeaderInfo | undefined =
    () => undefined;
  private _hasValidationErrors: (sheetId: string, cell: CellCoord) => boolean = () => false;
  showZeroValues = true;
  dropdownCells: ReadonlySet<string> = new Set();

  getCellValue(sheetId: string, cell: CellCoord) {
    return this._getCellValue(sheetId, cell);
  }
  getCellFormat(sheetId: string, cell: CellCoord) {
    return this._getCellFormat(sheetId, cell);
  }
  getCellBindingStatus(sheetId: string, cell: CellCoord) {
    return this._getCellBindingStatus(sheetId, cell);
  }
  getSparklineRenderData(sheetId: string, cell: CellCoord) {
    return this._getSparklineRenderData(sheetId, cell);
  }
  getTableAtCell(sheetId: string, cell: CellCoord) {
    return this._getTableAtCell(sheetId, cell);
  }
  hasTableColumnFilter(sheetId: string, tableId: string, headerRow: number, headerCol: number) {
    return this._hasTableColumnFilter(sheetId, tableId, headerRow, headerCol);
  }
  getFilterHeaderInfo(sheetId: string, cell: CellCoord) {
    return this._getFilterHeaderInfo(sheetId, cell);
  }
  hasValidationErrors(sheetId: string, cell: CellCoord) {
    return this._hasValidationErrors(sheetId, cell);
  }

  // --- setters used by dispatch table ---
  setCellValueFn(fn: (sheetId: string, cell: CellCoord) => unknown) {
    this._getCellValue = fn;
  }
  setCellFormatFn(fn: (sheetId: string, cell: CellCoord) => CellFormat | undefined) {
    this._getCellFormat = fn;
  }
  setGetCellBindingStatus(
    fn: (
      sheetId: string,
      cell: CellCoord,
    ) => { connectionId: string; staleness: 'fresh' | 'stale' | 'error' } | undefined,
  ) {
    this._getCellBindingStatus = fn;
  }
  setGetSparklineRenderData(
    fn: (sheetId: string, cell: CellCoord) => SparklineRenderData | undefined,
  ) {
    this._getSparklineRenderData = fn;
  }
  setGetTableAtCell(fn: (sheetId: string, cell: CellCoord) => TableConfig | undefined) {
    this._getTableAtCell = fn;
  }
  setHasTableColumnFilter(
    fn: (sheetId: string, tableId: string, headerRow: number, headerCol: number) => boolean,
  ) {
    this._hasTableColumnFilter = fn;
  }
  setGetFilterHeaderInfo(fn: (sheetId: string, cell: CellCoord) => FilterHeaderInfo | undefined) {
    this._getFilterHeaderInfo = fn;
  }
  setHasValidationErrors(fn: (sheetId: string, cell: CellCoord) => boolean) {
    this._hasValidationErrors = fn;
  }
  setShowZeroValues(v: boolean) {
    this.showZeroValues = v;
  }
  setDropdownCells(v: ReadonlySet<string>) {
    this.dropdownCells = v;
  }

  /** Bulk-apply from initial contextConfig */
  applyConfig(config: Partial<RenderContextConfig>): void {
    if (config.getCellValue) this._getCellValue = config.getCellValue;
    if (config.getCellFormat) this._getCellFormat = config.getCellFormat;
    if (config.getCellBindingStatus) this._getCellBindingStatus = config.getCellBindingStatus;
    if (config.getSparklineRenderData) this._getSparklineRenderData = config.getSparklineRenderData;
    if (config.getTableAtCell) this._getTableAtCell = config.getTableAtCell;
    if (config.hasTableColumnFilter) this._hasTableColumnFilter = config.hasTableColumnFilter;
    if (config.getFilterHeaderInfo) this._getFilterHeaderInfo = config.getFilterHeaderInfo;
    if (config.hasValidationErrors) this._hasValidationErrors = config.hasValidationErrors;
    if (config.showZeroValues !== undefined) this.showZeroValues = config.showZeroValues;
    if (config.dropdownCells) this.dropdownCells = config.dropdownCells;
  }
}

/**
 * Mutable adapter wrapping selection/editor/clipboard state into SelectionDataSource.
 */
class SelectionDataAdapter implements SelectionDataSource {
  private _selection: SelectionRenderState = NULL_SELECTION_DATA_SOURCE.getSelectionState();
  private _editor: EditorSnapshot = NULL_SELECTION_DATA_SOURCE.getEditorState();
  private _clipboard: ClipboardSnapshot = NULL_SELECTION_DATA_SOURCE.getClipboardState();
  private _searchHighlights: ReadonlyArray<SearchHighlight> = [];
  private _pastePreview: PastePreviewData | null = null;
  private _dragDrop: DragDropState | null = null;
  private _tablePreviewRange: CellRange | null = null;

  getSelectionState() {
    return this._selection;
  }
  getEditorState() {
    return this._editor;
  }
  getClipboardState() {
    return this._clipboard;
  }
  getSearchHighlights() {
    return this._searchHighlights;
  }
  getPastePreview() {
    return this._pastePreview;
  }
  getDragDropState() {
    return this._dragDrop;
  }
  getTablePreviewRange() {
    return this._tablePreviewRange;
  }
  hasError() {
    return this._selection?.hasError ?? false;
  }

  updateSelection(v: SelectionRenderState) {
    this._selection = v;
  }
  updateEditor(v: EditorSnapshot) {
    this._editor = v;
  }
  updateClipboard(v: ClipboardSnapshot) {
    this._clipboard = v;
  }
  updateSearchHighlights(v: ReadonlyArray<SearchHighlight>) {
    this._searchHighlights = v;
  }

  applyConfig(config: Partial<RenderContextConfig>): void {
    if (config.selection) this._selection = config.selection;
    if (config.editor) this._editor = config.editor;
    if (config.clipboard) this._clipboard = config.clipboard;
    if (config.searchHighlights) this._searchHighlights = config.searchHighlights;
  }
}

/**
 * Mutable adapter wrapping sheet-level settings into SheetDataSource.
 */
class SheetDataAdapter implements SheetDataSource {
  sheetId = '';
  totalRows = 1048576;
  totalCols = 16384;
  showGridlines = true;
  gridlineColor = '#e0e0e0';
  theme: ThemeDefinition = NULL_SHEET_DATA_SOURCE.theme;
  culture: CultureInfo = NULL_SHEET_DATA_SOURCE.culture;
  rightToLeft = false;
  showFormulas = false;
  showRowHeaders = true;
  showColumnHeaders = true;
  showCutCopyIndicator = true;
  allowDragFill = true;
  validationCirclesVisible = false;
  previewFont: string | null = null;
  blockedEditAttempt: { cellId: string; timestamp: number } | null = null;
  chromeTheme: ChromeTheme = DEFAULT_CHROME_THEME;
  sheetViewSkin: ResolvedSheetViewSkin = DEFAULT_RESOLVED_SHEET_VIEW_SKIN;
  shimmerEntries: readonly ShimmerEntry[] = [];
  shimmerEffect: ShimmerEffectType = DEFAULT_SHIMMER_CONFIG.effect;
  shimmerDurationMs = DEFAULT_SHIMMER_CONFIG.durationMs;
  shimmerColor = DEFAULT_SHIMMER_CONFIG.color;
  shimmerMaxOpacity = DEFAULT_SHIMMER_CONFIG.maxOpacity;
  shimmerEnabled = DEFAULT_SHIMMER_CONFIG.enabled;

  setSheetId(v: string) {
    this.sheetId = v;
  }
  setTotalRows(v: number) {
    this.totalRows = v;
  }
  setTotalCols(v: number) {
    this.totalCols = v;
  }
  setShowGridlines(v: boolean) {
    this.showGridlines = v;
  }
  setGridlineColor(v: string) {
    this.gridlineColor = v;
  }
  setTheme(v: ThemeDefinition) {
    this.theme = v;
  }
  setCulture(v: CultureInfo) {
    this.culture = v;
  }
  setRightToLeft(v: boolean) {
    this.rightToLeft = v;
  }
  setShowRowHeaders(v: boolean) {
    this.showRowHeaders = v;
  }
  setShowColumnHeaders(v: boolean) {
    this.showColumnHeaders = v;
  }
  setShowCutCopyIndicator(v: boolean) {
    this.showCutCopyIndicator = v;
  }
  setAllowDragFill(v: boolean) {
    this.allowDragFill = v;
  }
  setValidationCirclesVisible(v: boolean) {
    this.validationCirclesVisible = v;
  }
  setPreviewFont(v: string | null) {
    this.previewFont = v;
  }
  setBlockedEditAttempt(v: { cellId: string; timestamp: number } | null) {
    this.blockedEditAttempt = v;
  }
  setChromeTheme(v: ChromeTheme) {
    this.chromeTheme = v;
  }
  setSheetViewSkin(v: ResolvedSheetViewSkin) {
    this.sheetViewSkin = v;
  }
  setShimmerEntries(v: readonly ShimmerEntry[]) {
    this.shimmerEntries = v;
  }
  setShimmerEffect(v: ShimmerEffectType) {
    this.shimmerEffect = v;
  }
  setShimmerDurationMs(v: number) {
    this.shimmerDurationMs = v;
  }
  setShimmerColor(v: string) {
    this.shimmerColor = v;
  }
  setShimmerMaxOpacity(v: number) {
    this.shimmerMaxOpacity = v;
  }
  setShimmerEnabled(v: boolean) {
    this.shimmerEnabled = v;
  }

  applyConfig(config: Partial<RenderContextConfig>): void {
    if (config.currentSheetId) this.sheetId = config.currentSheetId;
    if (config.totalRows !== undefined) this.totalRows = config.totalRows;
    if (config.totalCols !== undefined) this.totalCols = config.totalCols;
    if (config.showGridlines !== undefined) this.showGridlines = config.showGridlines;
    if (config.gridlineColor !== undefined) this.gridlineColor = config.gridlineColor;
    if (config.theme) this.theme = config.theme;
    if (config.culture) this.culture = config.culture;
    if (config.rightToLeft !== undefined) this.rightToLeft = config.rightToLeft;
    if (config.showRowHeaders !== undefined) this.showRowHeaders = config.showRowHeaders;
    if (config.showColumnHeaders !== undefined) this.showColumnHeaders = config.showColumnHeaders;
    if (config.showCutCopyIndicator !== undefined)
      this.showCutCopyIndicator = config.showCutCopyIndicator;
    if (config.allowDragFill !== undefined) this.allowDragFill = config.allowDragFill;
    if (config.validationCirclesVisible !== undefined)
      this.validationCirclesVisible = config.validationCirclesVisible;
    if (config.previewFont !== undefined) this.previewFont = config.previewFont ?? null;
    if (config.blockedEditAttempt !== undefined)
      this.blockedEditAttempt = config.blockedEditAttempt ?? null;
    if (config.chromeTheme) this.chromeTheme = config.chromeTheme;
    if (config.sheetViewSkin) this.sheetViewSkin = config.sheetViewSkin;
    if (config.shimmerEntries !== undefined) this.shimmerEntries = config.shimmerEntries ?? [];
    if (config.shimmerEffect !== undefined)
      this.shimmerEffect = config.shimmerEffect ?? DEFAULT_SHIMMER_CONFIG.effect;
    if (config.shimmerDurationMs !== undefined)
      this.shimmerDurationMs = config.shimmerDurationMs ?? DEFAULT_SHIMMER_CONFIG.durationMs;
    if (config.shimmerColor !== undefined)
      this.shimmerColor = config.shimmerColor ?? DEFAULT_SHIMMER_CONFIG.color;
    if (config.shimmerMaxOpacity !== undefined)
      this.shimmerMaxOpacity = config.shimmerMaxOpacity ?? DEFAULT_SHIMMER_CONFIG.maxOpacity;
    if (config.shimmerEnabled !== undefined)
      this.shimmerEnabled = config.shimmerEnabled ?? DEFAULT_SHIMMER_CONFIG.enabled;
  }
}

/**
 * Mutable adapter for remote collaborator cursors.
 */
class CollaborationDataAdapter implements CollaborationDataSource {
  private _cursors: ReadonlyArray<RemoteCursor> = [];

  getRemoteCursors() {
    return this._cursors;
  }
  updateCursors(v: ReadonlyArray<RemoteCursor>) {
    this._cursors = v;
  }

  applyConfig(config: Partial<RenderContextConfig>): void {
    if (config.remoteCursors) this._cursors = config.remoteCursors;
  }
}

/**
 * Mutable adapter for formula trace arrows.
 */
class TraceDataAdapter implements TraceDataSource {
  private _arrows: ReadonlyArray<TraceArrow> = [];
  private _getCellPosition: (cellId: string) => { row: number; col: number; sheet: string } | null =
    () => null;

  getTraceArrows() {
    return this._arrows;
  }
  getCellPositionForTrace(cellId: string) {
    return this._getCellPosition(cellId);
  }

  setArrows(v: ReadonlyArray<TraceArrow>) {
    this._arrows = v;
  }
  /** Return the raw callback reference (for identity-guard comparisons). */
  getCellPositionFn() {
    return this._getCellPosition;
  }
  setGetCellPosition(fn: (cellId: string) => { row: number; col: number; sheet: string } | null) {
    this._getCellPosition = fn;
  }

  applyConfig(config: Partial<RenderContextConfig>): void {
    if (config.traceArrows) this._arrows = config.traceArrows;
    if (config.getCellPosition) this._getCellPosition = config.getCellPosition;
  }
}

/**
 * Mutable adapter for floating objects.
 */
class FloatingObjectDataAdapter implements FloatingObjectDataSource {
  private _state: FloatingObjectRenderState = {
    selectedIds: [],
    interactionState: 'idle',
    activeHandle: null,
    shiftKey: false,
    operation: null,
  };
  private _getObjects: () => ReadonlyArray<FloatingObject> = () => [];
  private _getBounds: (objectId: string) => Promise<ObjectBounds | null> | ObjectBounds | null =
    () => null;
  private _getAllBounds:
    | (() => Promise<Map<string, ObjectBounds>> | Map<string, ObjectBounds>)
    | null = null;
  private _getCharts: () => ReadonlyArray<{ id: string; type: string; [key: string]: unknown }> =
    () => [];
  private _getChartPosition: (
    sheetId: string,
    chart: { id: string; [key: string]: unknown },
  ) => { anchorRow: number; anchorCol: number; width: number; height: number } | null = () => null;

  getFloatingObjects() {
    return this._getObjects();
  }
  /**
   * Look up a single floating object by ID. Returns undefined if not found.
   * Used by incremental patch handler for targeted updates.
   */
  getFloatingObject(objectId: string): FloatingObject | undefined {
    return this._getObjects().find((o) => o.id === objectId);
  }
  getFloatingObjectBounds(objectId: string) {
    return this._getBounds(objectId);
  }
  getAllObjectBounds() {
    return this._getAllBounds?.() ?? new Map<string, ObjectBounds>();
  }
  getFloatingObjectState() {
    return this._state;
  }
  getChartsInViewport() {
    return this._getCharts();
  }
  getChartPosition(sheetId: string, chart: { id: string; [key: string]: unknown }) {
    return this._getChartPosition(sheetId, chart);
  }

  /** Update state. Returns true if any field actually changed. */
  setState(v: FloatingObjectRenderState): boolean {
    const prev = this._state;
    // Shallow equality on the fields that drive rendering
    if (
      prev.interactionState === v.interactionState &&
      prev.activeHandle === v.activeHandle &&
      prev.shiftKey === v.shiftKey &&
      prev.operation === v.operation &&
      prev.selectedIds === v.selectedIds
    ) {
      // Check insertion preview by reference (both undefined or same ref)
      if (
        (prev as unknown as Record<string, unknown>).insertionPreview ===
        (v as unknown as Record<string, unknown>).insertionPreview
      ) {
        return false;
      }
    }
    this._state = v;
    return true;
  }
  getObjectsFn() {
    return this._getObjects;
  }
  setObjectsFn(fn: () => ReadonlyArray<FloatingObject>) {
    this._getObjects = fn;
  }
  setBoundsFn(
    fn: (objectId: string) => Promise<ObjectBounds | null> | ObjectBounds | null,
  ): boolean {
    if (fn === this._getBounds) return false;
    this._getBounds = fn;
    return true;
  }
  setAllBoundsFn(
    fn: (() => Promise<Map<string, ObjectBounds>> | Map<string, ObjectBounds>) | null,
  ): boolean {
    if (fn === this._getAllBounds) return false;
    this._getAllBounds = fn;
    return true;
  }
  setChartsFn(
    fn: () => ReadonlyArray<{ id: string; type: string; [key: string]: unknown }>,
  ): boolean {
    if (fn === this._getCharts) return false;
    this._getCharts = fn;
    return true;
  }
  setChartPositionFn(
    fn: (
      sheetId: string,
      chart: { id: string; [key: string]: unknown },
    ) => { anchorRow: number; anchorCol: number; width: number; height: number } | null,
  ): boolean {
    if (fn === this._getChartPosition) return false;
    this._getChartPosition = fn;
    return true;
  }

  applyConfig(config: Partial<RenderContextConfig>): void {
    if (config.floatingObjectState) this._state = config.floatingObjectState;
    if (config.getFloatingObjects) this._getObjects = config.getFloatingObjects;
    if (config.getFloatingObjectBounds) this._getBounds = config.getFloatingObjectBounds;
    if (config.getAllObjectBounds !== undefined)
      this._getAllBounds = config.getAllObjectBounds ?? null;
    if (config.getChartsInViewport) this._getCharts = config.getChartsInViewport;
    if (config.getChartPosition) this._getChartPosition = config.getChartPosition;
  }
}

/**
 * Mutable adapter for row/column grouping.
 */
class GroupingDataAdapter implements GroupingDataSource {
  private _config: () => SheetGroupingConfig | null = () => null;
  private _rowGroups: () => ReadonlyArray<GroupDefinition> = () => [];
  private _colGroups: () => ReadonlyArray<GroupDefinition> = () => [];
  private _rowLevels: (startRow: number, endRow: number) => ReadonlyArray<OutlineLevel> = () => [];
  private _colLevels: (startCol: number, endCol: number) => ReadonlyArray<OutlineLevel> = () => [];
  maxRowOutlineLevel = 0;
  maxColOutlineLevel = 0;

  getGroupingConfig() {
    return this._config();
  }
  getRowGroups() {
    return this._rowGroups();
  }
  getColumnGroups() {
    return this._colGroups();
  }
  getRowOutlineLevels(startRow: number, endRow: number) {
    return this._rowLevels(startRow, endRow);
  }
  getColumnOutlineLevels(startCol: number, endCol: number) {
    return this._colLevels(startCol, endCol);
  }

  /** Return raw callback references (for identity-guard comparisons). */
  getConfigFn() {
    return this._config;
  }
  getRowGroupsFn() {
    return this._rowGroups;
  }
  getColumnGroupsFn() {
    return this._colGroups;
  }
  getRowOutlineLevelsFn() {
    return this._rowLevels;
  }
  getColumnOutlineLevelsFn() {
    return this._colLevels;
  }

  applyConfig(config: Partial<RenderContextConfig>): void {
    if (config.getGroupingConfig) this._config = config.getGroupingConfig;
    if (config.getRowGroups) this._rowGroups = config.getRowGroups;
    if (config.getColumnGroups) this._colGroups = config.getColumnGroups;
    if (config.getRowOutlineLevels) this._rowLevels = config.getRowOutlineLevels;
    if (config.getColumnOutlineLevels) this._colLevels = config.getColumnOutlineLevels;
    if (config.maxRowOutlineLevel !== undefined)
      this.maxRowOutlineLevel = config.maxRowOutlineLevel;
    if (config.maxColOutlineLevel !== undefined)
      this.maxColOutlineLevel = config.maxColOutlineLevel;
  }
}

/**
 * Mutable adapter for page break preview.
 */
class PageBreakDataAdapter implements PageBreakDataSource {
  pageBreakPreviewMode = false;
  private _breaks: PageBreaks = { rowBreaks: [], colBreaks: [] };
  private _autoBreaks: PageBreaks = { rowBreaks: [], colBreaks: [] };
  private _printArea: PrintArea | null = null;
  private _dragState: PageBreakDragState | null = null;

  getPageBreaks() {
    return this._breaks;
  }
  getAutoPageBreaks() {
    return this._autoBreaks;
  }
  getPrintArea() {
    return this._printArea;
  }
  getPageBreakDragState() {
    return this._dragState;
  }

  setMode(v: boolean) {
    this.pageBreakPreviewMode = v;
  }
  setBreaks(v: PageBreaks) {
    this._breaks = v;
  }
  setAutoBreaks(v: PageBreaks) {
    this._autoBreaks = v;
  }
  setPrintArea(v: PrintArea | null) {
    this._printArea = v;
  }
  setDragState(v: PageBreakDragState | null) {
    this._dragState = v;
  }

  applyConfig(config: Partial<RenderContextConfig>): void {
    if (config.pageBreakPreviewMode !== undefined)
      this.pageBreakPreviewMode = config.pageBreakPreviewMode;
    if (config.pageBreaks) this._breaks = config.pageBreaks;
    if (config.autoPageBreaks) this._autoBreaks = config.autoPageBreaks;
    if (config.printArea !== undefined) this._printArea = config.printArea;
    if (config.pageBreakDragState !== undefined)
      this._dragState = config.pageBreakDragState ?? null;
  }
}

/**
 * Mutable adapter for overlay data source.
 *
 * Reads bounds synchronously from the SceneGraph (document-space) and converts
 * to screen-space using the viewport transform from HitMap. This avoids the
 * async IPC path that FloatingObjectDataAdapter uses for bounds computation.
 */
class OverlayDataAdapter implements OverlayDataSource {
  private _floatingObjectAdapter: FloatingObjectDataAdapter;
  private _sceneGraph: SceneGraph | null = null;
  private _hitMap: HitMap | null = null;

  constructor(floatingObjectAdapter: FloatingObjectDataAdapter) {
    this._floatingObjectAdapter = floatingObjectAdapter;
  }

  /** Wire scene graph and hit map after drawing layer creation. */
  setSceneGraphAndHitMap(sceneGraph: SceneGraph, hitMap: HitMap): void {
    this._sceneGraph = sceneGraph;
    this._hitMap = hitMap;
  }

  /** Convert document-space bounds to screen-space using the current viewport transform. */
  private docToScreen(doc: { x: number; y: number; width: number; height: number }): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const hitMap = this._hitMap!;
    const scroll = hitMap.getScrollOffset();
    const zoom = hitMap.getZoom();
    const origin = hitMap.getRegionOrigin();
    return {
      x: (doc.x - scroll.x) * zoom + origin.x,
      y: (doc.y - scroll.y) * zoom + origin.y,
      width: doc.width * zoom,
      height: doc.height * zoom,
    };
  }

  getSelectedObjectBounds() {
    const state = this._floatingObjectAdapter.getFloatingObjectState();
    if (!state.selectedIds || state.selectedIds.length === 0) return null;
    if (!this._sceneGraph || !this._hitMap) return null;

    // Compute union of all selected object bounds in screen space
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const id of state.selectedIds) {
      const obj = this._sceneGraph.getById(id);
      if (!obj) continue;
      const screen = this.docToScreen(obj.bounds);
      minX = Math.min(minX, screen.x);
      minY = Math.min(minY, screen.y);
      maxX = Math.max(maxX, screen.x + screen.width);
      maxY = Math.max(maxY, screen.y + screen.height);
    }
    if (minX === Infinity) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  getSelectedObjectIds() {
    const state = this._floatingObjectAdapter.getFloatingObjectState();
    // Suppress selection chrome during any operation (drag, resize, rotate)
    if (state.interactionState === 'operating') return [];
    return state.selectedIds ?? [];
  }

  getObjectBounds(id: string) {
    if (!this._sceneGraph || !this._hitMap) return null;
    const obj = this._sceneGraph.getById(id);
    if (!obj) return null;
    return this.docToScreen(obj.bounds);
  }

  isObjectLocked(id: string) {
    if (!this._sceneGraph) return false;
    const obj = this._sceneGraph.getById(id);
    return obj?.locked ?? false;
  }
  getObjectRotation(id: string) {
    if (!this._sceneGraph) return 0;
    const obj = this._sceneGraph.getById(id);
    return obj?.rotation ?? 0;
  }
  getActiveHandle() {
    const state = this._floatingObjectAdapter.getFloatingObjectState();
    return state.activeHandle as string | null;
  }
  getGuides() {
    return [];
  }
  getRubberBand() {
    return null;
  }
  getDragPreview() {
    return null;
  }
  getInkPreview() {
    return null;
  }
  getInsertionPreview() {
    const state = this._floatingObjectAdapter.getFloatingObjectState();
    return state.insertionPreview ?? null;
  }
  getConnectionPointIndicators() {
    return null;
  }
}

// =============================================================================
// Grid Renderer Implementation
// =============================================================================

/**
 * Grid Renderer — Composition Facade
 *
 * Implements the GridRenderer interface from contracts by composing the 4
 * canvas packages. The facade owns all lifecycle and wires data sources.
 */
export class GridRendererImpl implements GridRenderer {
  // Engine
  private engine: CanvasEngineInstance;

  // Grid layers
  private gridLayers: GridLayersResult;
  private gridCoords: GridCoordinateSystem;

  // Drawing layer
  private drawing: DrawingLayerHandle;

  // Diagram canvas bridge adapter (wraps kernel bridge for rendering)
  private diagramCanvasBridge: DiagramCanvasBridge | null = null;

  // Overlay layer
  private overlay: OverlayLayer;

  // DOM container element (for page-space coordinate queries)
  private container: HTMLElement;

  // Legacy coordinate system (kept for backward compat of getCoordinateSystem())
  private coords: CoordinateSystem;

  // Position and merge indices for dirty rect computation
  private positionIndex: ViewportPositionIndex;
  private mergeIndex: ViewportMergeIndex;

  // Data source adapters
  private cellAdapter: CellDataAdapter;
  private selectionAdapter: SelectionDataAdapter;
  private sheetAdapter: SheetDataAdapter;
  private collaborationAdapter: CollaborationDataAdapter;
  private traceAdapter: TraceDataAdapter;
  private floatingObjectAdapter: FloatingObjectDataAdapter;
  private groupingAdapter: GroupingDataAdapter;
  private pageBreakAdapter: PageBreakDataAdapter;
  private overlayAdapter: OverlayDataAdapter;

  // Bounds reader (lazy-initialized, backed by scene graph)
  private _boundsReader: IObjectBoundsReader | null = null;

  // Scene graph reader (lazy-initialized, backed by scene graph)
  private _sceneGraphReader: ISceneGraphReader | null = null;

  // Render scheduler (Write = Invalidate bridge)
  private renderScheduler: GridRenderScheduler;

  // State
  private currentSheetId: string;
  private viewportLayout: ViewportLayout | null = null;
  private isRunning = false;
  private isPaused = false;
  private totalFrames = 0;
  private interactiveElementCollector: InteractiveElementCollector;

  // Hot-path dispatch table
  private readonly fieldHandlers: Record<string, (value: any) => void>;

  constructor(config: GridRendererConfig) {
    this.currentSheetId = config.initialSheetId;
    this.container = config.container;

    // 1. Create data source adapters
    this.cellAdapter = new CellDataAdapter();
    this.selectionAdapter = new SelectionDataAdapter();
    this.sheetAdapter = new SheetDataAdapter();
    this.collaborationAdapter = new CollaborationDataAdapter();
    this.traceAdapter = new TraceDataAdapter();
    this.floatingObjectAdapter = new FloatingObjectDataAdapter();
    this.groupingAdapter = new GroupingDataAdapter();
    this.pageBreakAdapter = new PageBreakDataAdapter();
    this.overlayAdapter = new OverlayDataAdapter(this.floatingObjectAdapter);

    // Set initial sheet state
    this.sheetAdapter.setSheetId(config.initialSheetId);
    if (config.totalRows !== undefined) this.sheetAdapter.setTotalRows(config.totalRows);
    if (config.totalCols !== undefined) this.sheetAdapter.setTotalCols(config.totalCols);

    // Apply initial context config
    if (config.contextConfig) {
      this.cellAdapter.applyConfig(config.contextConfig);
      this.selectionAdapter.applyConfig(config.contextConfig);
      this.sheetAdapter.applyConfig(config.contextConfig);
      this.collaborationAdapter.applyConfig(config.contextConfig);
      this.traceAdapter.applyConfig(config.contextConfig);
      this.floatingObjectAdapter.applyConfig(config.contextConfig);
      this.groupingAdapter.applyConfig(config.contextConfig);
      this.pageBreakAdapter.applyConfig(config.contextConfig);
    }

    // Apply initial chrome theme as CSS variables on the container
    applyChromeTheme(this.sheetAdapter.chromeTheme, this.container);

    // 2. Create canvas engine
    this.engine = createCanvasEngine({
      container: config.container,
      canvasCount: 2,
    });

    // 2b. Create render scheduler (bridges buffer writes → canvas invalidation)
    this.renderScheduler = new GridRenderScheduler(this.engine);

    // 3. Create grid layers
    this.gridCoords = new GridCoordinateSystem();
    this.interactiveElementCollector = createInteractiveElementCollector();

    const positionIndex = config.positionIndex ?? new ViewportPositionIndex();
    const mergeIndex = config.mergeIndex ?? new ViewportMergeIndex();
    this.positionIndex = positionIndex;
    this.mergeIndex = mergeIndex;

    this.gridLayers = createGridLayers({
      positionIndex,
      mergeIndex,
      animationClock: this.engine.animationClock,
      cellData: this.cellAdapter,
      selectionData: this.selectionAdapter,
      sheetData: this.sheetAdapter,
      collaborationData: this.collaborationAdapter,
      traceData: this.traceAdapter,
      groupingData: this.groupingAdapter,
      pageBreakData: this.pageBreakAdapter,
      interactiveElements: this.interactiveElementCollector,
      textMeasurer: new CanvasTextMeasurer(),
    });

    // Register all grid layers with the engine
    for (const layer of this.gridLayers.layers) {
      this.engine.registerLayer(layer);
    }

    // 4. Create drawing layer
    this.drawing = createDrawingLayer({
      bridges: {
        chartBridge: null,
        diagramBridge: null,
        textEffectBridge: null,
        astToLatexFn: null,
        inkAccessor: null,
      },
      requestFrame: () => this.engine.requestFrame(),
    });
    this.engine.registerLayer(this.drawing.layer);

    // 4b. Wire scene graph + hit map into overlay adapter for sync bounds
    this.overlayAdapter.setSceneGraphAndHitMap(this.drawing.sceneGraph, this.drawing.hitMap);

    // 5. Create overlay layer
    this.overlay = createOverlayLayer({
      dataSource: this.overlayAdapter,
    });
    this.engine.registerLayer(this.overlay);

    // 6. Register hit test providers in priority order
    this.engine.registerHitTestProvider(this.overlay, 1000); // handles, highest priority
    this.engine.registerHitTestProvider(this.drawing.hitMap, 500); // floating objects

    const gridHitTest = createGridHitTest({
      sheetData: this.sheetAdapter,
      cellData: this.cellAdapter,
      selectionData: this.selectionAdapter,
      positionIndex,
      mergeIndex,
      groupingData: this.groupingAdapter,
      coordSystem: this.gridCoords,
      rowHeaderWidth: ROW_HEADER_WIDTH,
      colHeaderHeight: COL_HEADER_HEIGHT,
    });
    this.engine.registerHitTestProvider(gridHitTest, 0); // cells, headers

    // 7. Initialize legacy coordinate system for backward compat
    this.coords = new CoordinateSystemImpl();
    this.coords.setViewportPositionIndex(positionIndex);
    this.coords.setViewportMergeIndex(mergeIndex);

    // 8. Build the field handler dispatch table (hot path)
    this.fieldHandlers = this.buildFieldHandlers();
  }

  // ===========================================================================
  // Dispatch Table Builder
  // ===========================================================================

  private buildFieldHandlers(): Record<string, (value: any) => void> {
    return {
      // --- Selection / Editor / Clipboard ---
      selection: (v) => {
        const oldSelection = this.selectionAdapter.getSelectionState();
        this.selectionAdapter.updateSelection(v);
        const newSelection = v as SelectionRenderState;

        // Compute dirty rects for the selection layer instead of full dirty.
        // This is the hot path (fires on every arrow key, click, drag).
        const selectionHint = this.computeSelectionDirtyHint(oldSelection, newSelection);
        this.engine.markDirty('selection', selectionHint);

        // Compute dirty rects for the headers layer (column/row highlight strips).
        const headersHint = this.computeHeadersDirtyHint(oldSelection, newSelection);
        this.engine.markDirty('headers', headersHint);

        // ui stays full dirty for now
        this.engine.markDirty('ui');
      },
      editor: (v) => {
        this.selectionAdapter.updateEditor(v);
        this.engine.markDirty('cells');
        this.engine.markDirty('selection');
      },
      clipboard: (v) => {
        this.selectionAdapter.updateClipboard(v);
        this.engine.markDirty('ui');
      },
      searchHighlights: (v) => {
        const prev = this.selectionAdapter.getSearchHighlights();
        this.selectionAdapter.updateSearchHighlights(v);
        if (v !== prev) {
          this.engine.markDirty('cells');
        }
      },

      // --- Remote cursors ---
      remoteCursors: (v) => {
        this.collaborationAdapter.updateCursors(v);
        this.engine.markDirty('remote-cursors');
      },

      // --- Cell data callbacks (Category A) ---
      // These are function references for cell data lookups. The actual dirty
      // signal for cell data comes from BinaryViewportBuffer.applyBinaryMutation()
      // → markCellsDirty() with precise cell coordinates. These callbacks fire on
      // every React/Zustand re-render with new closure references, so we store the
      // new reference but do NOT mark cells dirty here.
      getCellValue: (v) => {
        this.cellAdapter.setCellValueFn(v);
      },
      getCellFormat: (v) => {
        this.cellAdapter.setCellFormatFn(v);
      },
      getCellBindingStatus: (v) => {
        this.cellAdapter.setGetCellBindingStatus(v);
      },
      getSparklineRenderData: (v) => {
        this.cellAdapter.setGetSparklineRenderData(v);
      },
      getTableAtCell: (v) => {
        this.cellAdapter.setGetTableAtCell(v);
      },
      getResolvedTableRange: (_v) => {
        // Table range resolution: actual dirty signal comes from buffer mutations.
        // No value to store; no dirty to mark.
      },
      getTablesInSheet: (_v) => {
        // Table list changes need to update the UI layer (filter buttons, table
        // overlays) — this is the only signal for table-related UI elements.
        // Cell layer dirty is NOT needed; buffer mutations handle cell repaints.
        this.engine.markDirty('ui');
      },
      hasTableColumnFilter: (v) => {
        this.cellAdapter.setHasTableColumnFilter(v);
      },
      getFilterHeaderInfo: (v) => {
        this.cellAdapter.setGetFilterHeaderInfo(v);
      },
      hasValidationErrors: (v) => {
        this.cellAdapter.setHasValidationErrors(v);
        // Keep validationCircles dirty — this is the only data-change signal for
        // that layer. Cell layer dirty is NOT needed; buffer mutations handle it.
        this.engine.markDirty('validationCircles');
      },
      dropdownCells: (v) => {
        this.cellAdapter.setDropdownCells(v);
      },

      // --- Binary viewport buffer ---
      // Same as cell data callbacks: the actual dirty signal comes from
      // applyBinaryMutation() → markCellsDirty(). Storing the new reader
      // reference is sufficient.
      binaryCellReader: (v) => {
        this.gridLayers.updateDataSources({ binaryCellReader: v ?? undefined });
      },
      binaryCellReaderForViewport: (v) => {
        this.gridLayers.updateDataSources({
          binaryCellReaderForViewport: v ?? undefined,
        });
      },

      // --- Sheet settings ---
      theme: (v) => {
        const prev = this.sheetAdapter.theme;
        this.sheetAdapter.setTheme(v);
        if (v !== prev) {
          this.engine.markDirty('cells');
          this.engine.markDirty('selection');
          this.engine.markDirty('headers');
          this.engine.markDirty('background');
        }
      },
      culture: (v) => {
        const prev = this.sheetAdapter.culture;
        this.sheetAdapter.setCulture(v);
        if (v !== prev) {
          this.engine.markDirty('cells');
        }
      },
      showGridlines: (v) => {
        const prev = this.sheetAdapter.showGridlines;
        this.sheetAdapter.setShowGridlines(v);
        if (v !== prev) {
          this.engine.markDirty('background');
        }
      },
      gridlineColor: (v) => {
        const prev = this.sheetAdapter.gridlineColor;
        this.sheetAdapter.setGridlineColor(v);
        if (v !== prev) {
          this.engine.markDirty('background');
        }
      },
      showZeroValues: (v) => {
        const prev = this.cellAdapter.showZeroValues;
        this.cellAdapter.setShowZeroValues(v);
        if (v !== prev) {
          this.engine.markDirty('cells');
        }
      },
      rightToLeft: (v) => {
        const prev = this.sheetAdapter.rightToLeft;
        this.sheetAdapter.setRightToLeft(v);
        if (v !== prev) {
          this.markAllDirty();
        }
      },
      showRowHeaders: (v) => {
        const prev = this.sheetAdapter.showRowHeaders;
        this.sheetAdapter.setShowRowHeaders(v);
        if (v !== prev) {
          this.engine.markDirty('headers');
        }
      },
      showColumnHeaders: (v) => {
        const prev = this.sheetAdapter.showColumnHeaders;
        this.sheetAdapter.setShowColumnHeaders(v);
        if (v !== prev) {
          this.engine.markDirty('headers');
        }
      },
      showCutCopyIndicator: (v) => {
        const prev = this.sheetAdapter.showCutCopyIndicator;
        this.sheetAdapter.setShowCutCopyIndicator(v);
        if (v !== prev) {
          this.engine.markDirty('ui');
        }
      },
      allowDragFill: (v) => {
        const prev = this.sheetAdapter.allowDragFill;
        this.sheetAdapter.setAllowDragFill(v);
        if (v !== prev) {
          this.engine.markDirty('ui');
        }
      },
      validationCirclesVisible: (v) => {
        const prev = this.sheetAdapter.validationCirclesVisible;
        this.sheetAdapter.setValidationCirclesVisible(v);
        if (v !== prev) {
          this.engine.markDirty('validationCircles');
        }
      },
      previewFont: (v) => {
        const prev = this.sheetAdapter.previewFont;
        this.sheetAdapter.setPreviewFont(v);
        if (v !== prev) {
          this.engine.markDirty('cells');
        }
      },
      blockedEditAttempt: (v) => {
        const prev = this.sheetAdapter.blockedEditAttempt;
        this.sheetAdapter.setBlockedEditAttempt(v);
        if (v !== prev) {
          this.engine.markDirty('cells');
        }
      },
      shimmerEntries: (v) => {
        const prev = this.sheetAdapter.shimmerEntries;
        this.sheetAdapter.setShimmerEntries(v);
        if (v !== prev) {
          this.engine.markDirty('ui');
        }
      },
      shimmerEffect: (v) => {
        this.sheetAdapter.setShimmerEffect(v);
      },
      shimmerDurationMs: (v) => {
        this.sheetAdapter.setShimmerDurationMs(v);
      },
      shimmerColor: (v) => {
        this.sheetAdapter.setShimmerColor(v);
      },
      shimmerMaxOpacity: (v) => {
        this.sheetAdapter.setShimmerMaxOpacity(v);
      },
      shimmerEnabled: (v) => {
        this.sheetAdapter.setShimmerEnabled(v);
      },
      chromeTheme: (v: ChromeTheme) => {
        const prev = this.sheetAdapter.chromeTheme;
        this.sheetAdapter.setChromeTheme(v);
        if (v !== prev) {
          applyChromeTheme(v, this.container);
          this.gridLayers.updateDataSources({ sheetData: this.sheetAdapter });
          this.markAllDirty();
        }
      },
      sheetViewSkin: (v: ResolvedSheetViewSkin) => {
        const prev = this.sheetAdapter.sheetViewSkin;
        this.sheetAdapter.setSheetViewSkin(v);
        if (v !== prev) {
          this.sheetAdapter.setChromeTheme(v.chromeTheme);
          applyChromeTheme(v.chromeTheme, this.container);
          this.gridLayers.updateDataSources({ sheetData: this.sheetAdapter });
          this.markAllDirty();
        }
      },

      // --- Trace arrows ---
      traceArrows: (v) => {
        const prev = this.traceAdapter.getTraceArrows();
        this.traceAdapter.setArrows(v);
        if (v !== prev) {
          this.engine.markDirty('traceArrows');
        }
      },
      getCellPosition: (v) => {
        const prev = this.traceAdapter.getCellPositionFn();
        this.traceAdapter.setGetCellPosition(v);
        if (v !== prev) {
          this.engine.markDirty('traceArrows');
        }
      },

      // --- Floating objects ---
      floatingObjectState: (v) => {
        if (this.floatingObjectAdapter.setState(v)) {
          // TODO: Compute per-object dirty rects for drawing layer when
          // selected object IDs change. Currently full dirty because the state change
          // doesn't carry per-object bounds. The effective state manager handles the
          // drag/resize/rotate preview path separately.
          this.engine.markDirty('drawing');
          // TODO: Overlay partial repaint — selection handles and chrome
          // only need to repaint old + new handle positions.
          this.engine.markDirty('overlay');
        }
      },
      getFloatingObjects: (v) => {
        const prev = this.floatingObjectAdapter.getObjectsFn();
        this.floatingObjectAdapter.setObjectsFn(v);
        if (v !== prev) {
          // Callback identity changed — new data source (init or sheet switch).
          void this.syncSceneGraph();
          this.engine.markDirty('drawing');
        }
      },
      floatingObjectPatches: (patches: FloatingObjectPatch[]) => {
        // All bounds are now expected to be pre-computed from Rust.
        // Patches without bounds will be skipped with a warning.
        const drawingHint = this.applySceneGraphPatches(patches);
        // The SceneGraph onDirty callback already marks the drawing layer with
        // per-object rect hints. We also pass the aggregated hint through the
        // engine path to ensure requestFrame() is called.
        this.engine.markDirty('drawing', drawingHint);
        // TODO: Overlay partial repaint. Overlay changes (selection handles,
        // guides, rubber band) are infrequent and the overlay is rendered in 'once'
        // mode on a separate canvas, so the cost of full repaint is low. Revisit if
        // profiling shows overlay repaint as a bottleneck.
        this.engine.markDirty('overlay');
      },
      //  The render pipeline no longer uses per-object
      // getFloatingObjectBounds for bounds computation. Bounds arrive pre-computed
      // from Rust via FloatingObjectPatch.bounds (mutations) or getAllObjectBounds
      // (sheet switch). The underlying getColPosition/getRowPosition bridge calls
      // are still used by scrolling and hit testing, but not by the renderer.
      // This setter is retained for overlay/selection layers that may still need it.
      getFloatingObjectBounds: (v) => {
        if (this.floatingObjectAdapter.setBoundsFn(v)) {
          this.engine.markDirty('drawing');
          this.engine.markDirty('overlay');
        }
      },
      getAllObjectBounds: (v) => {
        if (this.floatingObjectAdapter.setAllBoundsFn(v ?? null)) {
          void this.syncSceneGraph();
          this.engine.markDirty('drawing');
        }
      },
      getChartsInViewport: (v) => {
        if (this.floatingObjectAdapter.setChartsFn(v)) {
          this.engine.markDirty('drawing');
        }
      },
      getChartPosition: (v) => {
        if (this.floatingObjectAdapter.setChartPositionFn(v)) {
          this.engine.markDirty('drawing');
        }
      },
      renderChart: (v) => {
        if (v) {
          this.drawing.bridges.setChartBridge({
            renderChart: (chartId, ctx, bounds) => v(chartId, ctx, bounds),
          });
        }
        this.engine.markDirty('drawing');
      },

      // --- Page breaks ---
      pageBreakPreviewMode: (v) => {
        const prev = this.pageBreakAdapter.pageBreakPreviewMode;
        this.pageBreakAdapter.setMode(v);
        if (v !== prev) {
          this.engine.markDirty('pageBreaks');
        }
      },
      pageBreaks: (v) => {
        const prev = this.pageBreakAdapter.getPageBreaks();
        this.pageBreakAdapter.setBreaks(v);
        if (v !== prev) {
          this.engine.markDirty('pageBreaks');
        }
      },
      autoPageBreaks: (v) => {
        const prev = this.pageBreakAdapter.getAutoPageBreaks();
        this.pageBreakAdapter.setAutoBreaks(v);
        if (v !== prev) {
          this.engine.markDirty('pageBreaks');
        }
      },
      printArea: (v) => {
        const prev = this.pageBreakAdapter.getPrintArea();
        this.pageBreakAdapter.setPrintArea(v);
        if (v !== prev) {
          this.engine.markDirty('pageBreaks');
        }
      },
      pageBreakDragState: (v) => {
        const prev = this.pageBreakAdapter.getPageBreakDragState();
        this.pageBreakAdapter.setDragState(v);
        if (v !== prev) {
          this.engine.markDirty('pageBreaks');
        }
      },

      // --- Grouping ---
      getGroupingConfig: (v) => {
        const prev = this.groupingAdapter.getConfigFn();
        this.groupingAdapter.applyConfig({ getGroupingConfig: v });
        if (v !== prev) {
          this.engine.markDirty('headers');
        }
      },
      getRowGroups: (v) => {
        const prev = this.groupingAdapter.getRowGroupsFn();
        this.groupingAdapter.applyConfig({ getRowGroups: v });
        if (v !== prev) {
          this.engine.markDirty('headers');
        }
      },
      getColumnGroups: (v) => {
        const prev = this.groupingAdapter.getColumnGroupsFn();
        this.groupingAdapter.applyConfig({ getColumnGroups: v });
        if (v !== prev) {
          this.engine.markDirty('headers');
        }
      },
      getRowOutlineLevels: (v) => {
        const prev = this.groupingAdapter.getRowOutlineLevelsFn();
        this.groupingAdapter.applyConfig({ getRowOutlineLevels: v });
        if (v !== prev) {
          this.engine.markDirty('headers');
        }
      },
      getColumnOutlineLevels: (v) => {
        const prev = this.groupingAdapter.getColumnOutlineLevelsFn();
        this.groupingAdapter.applyConfig({ getColumnOutlineLevels: v });
        if (v !== prev) {
          this.engine.markDirty('headers');
        }
      },
      maxRowOutlineLevel: (v) => {
        const prev = this.groupingAdapter.maxRowOutlineLevel;
        this.groupingAdapter.maxRowOutlineLevel = v;
        if (v !== prev) {
          this.engine.markDirty('headers');
        }
      },
      maxColOutlineLevel: (v) => {
        const prev = this.groupingAdapter.maxColOutlineLevel;
        this.groupingAdapter.maxColOutlineLevel = v;
        if (v !== prev) {
          this.engine.markDirty('headers');
        }
      },

      // --- Interactive elements ---
      interactiveElements: (_v) => {
        // Interactive element collector is injected at construction, typically not changed
      },

      // --- Misc ---
      coords: (_v) => {
        // Coordinate system updates are handled via setScroll/setZoom
      },
      currentSheetId: (v) => {
        this.switchSheet(v);
      },
      totalRows: (v) => {
        this.sheetAdapter.setTotalRows(v);
        this.markAllDirty();
      },
      totalCols: (v) => {
        this.sheetAdapter.setTotalCols(v);
        this.markAllDirty();
      },
      getPastePreview: (_v) => {
        this.engine.markDirty('cells');
        this.engine.markDirty('selection');
      },
    };
  }

  // ===========================================================================
  // Selection Dirty Rect Computation
  // ===========================================================================

  /**
   * Compute a DirtyHint for the selection layer based on old and new selection.
   * O(1) — uses position index lookups, no iteration.
   *
   * Falls back to full dirty when:
   * - No previous selection (first selection after mount)
   * - Full-row or full-column selections (span entire viewport)
   * - Position data not available in the position index
   */
  private computeSelectionDirtyHint(
    oldSelection: SelectionRenderState,
    newSelection: SelectionRenderState,
  ): DirtyHint {
    // If position index has no data, fall back to full dirty
    if (!this.positionIndex.hasData) {
      return { type: 'full' };
    }

    // Full-row or full-column selections span the entire viewport — full dirty
    if (
      oldSelection.hasFullRowSelection ||
      oldSelection.hasFullColumnSelection ||
      newSelection.hasFullRowSelection ||
      newSelection.hasFullColumnSelection
    ) {
      return { type: 'full' };
    }

    // Formula mode changes affect formula range highlights — full dirty
    if (oldSelection.isFormulaMode !== newSelection.isFormulaMode) {
      return { type: 'full' };
    }
    if (oldSelection.isFormulaMode || newSelection.isFormulaMode) {
      // Formula ranges can have many colored highlights; full dirty is safer
      return { type: 'full' };
    }

    // Multi-range selections (e.g., Ctrl+click) — full dirty for simplicity
    if (oldSelection.ranges.length > 1 || newSelection.ranges.length > 1) {
      return { type: 'full' };
    }

    const dirtyRects: DocSpaceRect[] = [];

    // Collect pixel rects for old selection (doc-space from ViewportPositionIndex)
    if (oldSelection.ranges.length === 1) {
      const oldRect = this.selectionRangeToPixelRect(oldSelection.ranges[0]);
      if (!oldRect) return { type: 'full' };
      dirtyRects.push(oldRect);
    }

    // Collect pixel rects for old active cell (may differ from range for merged cells)
    if (oldSelection.activeCell) {
      const oldActiveRect = this.cellToPixelRect(oldSelection.activeCell);
      if (oldActiveRect) dirtyRects.push(oldActiveRect);
    }

    // Collect pixel rects for new selection
    if (newSelection.ranges.length === 1) {
      const newRect = this.selectionRangeToPixelRect(newSelection.ranges[0]);
      if (!newRect) return { type: 'full' };
      dirtyRects.push(newRect);
    }

    // Collect pixel rects for new active cell
    if (newSelection.activeCell) {
      const newActiveRect = this.cellToPixelRect(newSelection.activeCell);
      if (newActiveRect) dirtyRects.push(newActiveRect);
    }

    // No rects computed — fall back to full dirty
    if (dirtyRects.length === 0) {
      return { type: 'full' };
    }

    return { type: 'rects', bounds: dirtyRects };
  }

  /**
   * Convert a CellRange to a pixel rect in document coordinates.
   * Returns null if the range falls outside the position index's covered area
   * (which means we can't compute accurate bounds — caller should fall back to full dirty).
   *
   * Adds a small padding (border width) to account for selection stroke rendering.
   */
  private selectionRangeToPixelRect(range: CellRange): DocSpaceRect | null {
    // Expand range for merged cells at corners
    const expandedRange = this.expandRangeForMerges(range);

    const x = this.positionIndex.getColLeft(expandedRange.startCol);
    const y = this.positionIndex.getRowTop(expandedRange.startRow);
    const x2 =
      this.positionIndex.getColLeft(expandedRange.endCol) +
      this.positionIndex.getColWidth(expandedRange.endCol);
    const y2 =
      this.positionIndex.getRowTop(expandedRange.endRow) +
      this.positionIndex.getRowHeight(expandedRange.endRow);

    // Add padding for selection border stroke (2px on each side)
    const pad = 3;
    return docSpaceRect(x - pad, y - pad, x2 - x + pad * 2, y2 - y + pad * 2);
  }

  /**
   * Convert a cell coordinate to a pixel rect, accounting for merged cells.
   * Returns null only if position data is unavailable.
   */
  private cellToPixelRect(cell: { row: number; col: number }): DocSpaceRect | null {
    const mergedRegion = this.mergeIndex.getMergedRegion(cell.row, cell.col);
    if (mergedRegion) {
      return this.selectionRangeToPixelRect(mergedRegion);
    }

    const x = this.positionIndex.getColLeft(cell.col);
    const y = this.positionIndex.getRowTop(cell.row);
    const w = this.positionIndex.getColWidth(cell.col);
    const h = this.positionIndex.getRowHeight(cell.row);

    const pad = 3;
    return docSpaceRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
  }

  /**
   * Expand a CellRange to include any merged cells that overlap its corners.
   * This ensures the dirty rect covers the full visual extent of merged cells
   * at the selection boundary.
   */
  private expandRangeForMerges(range: CellRange): CellRange {
    let { startRow, startCol, endRow, endCol } = range;

    // Check top-left corner
    const topLeft = this.mergeIndex.getMergedRegion(startRow, startCol);
    if (topLeft) {
      startRow = Math.min(startRow, topLeft.startRow);
      startCol = Math.min(startCol, topLeft.startCol);
    }

    // Check bottom-right corner
    const bottomRight = this.mergeIndex.getMergedRegion(endRow, endCol);
    if (bottomRight) {
      endRow = Math.max(endRow, bottomRight.endRow);
      endCol = Math.max(endCol, bottomRight.endCol);
    }

    if (
      startRow === range.startRow &&
      startCol === range.startCol &&
      endRow === range.endRow &&
      endCol === range.endCol
    ) {
      return range; // no expansion needed, return original for identity check
    }

    return { startRow, startCol, endRow, endCol };
  }

  // ===========================================================================
  // Headers Dirty Hint
  // ===========================================================================

  /**
   * Compute partial dirty rects for the headers layer when selection changes.
   *
   * Headers highlight the row/column strips corresponding to the selected range.
   * On selection change we need to repaint:
   * - Column header strip for old selected columns + new selected columns
   * - Row header strip for old selected rows + new selected rows
   *
   * Falls back to full dirty for the same cases as the selection layer
   * (no position data, full-row/column, formula mode, multi-range).
   *
   * The rects are in document-space (from ViewportPositionIndex positions).
   * collectDirtyUnion converts them to canvas-space via docToCanvas().
   */
  private computeHeadersDirtyHint(
    oldSelection: SelectionRenderState,
    newSelection: SelectionRenderState,
  ): DirtyHint {
    // Same fallback conditions as computeSelectionDirtyHint
    if (!this.positionIndex.hasData) {
      return { type: 'full' };
    }

    if (
      oldSelection.hasFullRowSelection ||
      oldSelection.hasFullColumnSelection ||
      newSelection.hasFullRowSelection ||
      newSelection.hasFullColumnSelection
    ) {
      return { type: 'full' };
    }

    if (oldSelection.isFormulaMode !== newSelection.isFormulaMode) {
      return { type: 'full' };
    }
    if (oldSelection.isFormulaMode || newSelection.isFormulaMode) {
      return { type: 'full' };
    }

    if (oldSelection.ranges.length > 1 || newSelection.ranges.length > 1) {
      return { type: 'full' };
    }

    const dirtyRects: DocSpaceRect[] = [];

    // Helper: compute a column header strip rect for a range's columns
    // Note: these use doc-space positions from ViewportPositionIndex
    const colHeaderRect = (range: CellRange): DocSpaceRect | null => {
      const x1 = this.positionIndex.getColLeft(range.startCol);
      const x2 =
        this.positionIndex.getColLeft(range.endCol) + this.positionIndex.getColWidth(range.endCol);
      if (x2 <= x1) return null;
      return docSpaceRect(x1, 0, x2 - x1, COL_HEADER_HEIGHT);
    };

    // Helper: compute a row header strip rect for a range's rows
    const rowHeaderRect = (range: CellRange): DocSpaceRect | null => {
      const y1 = this.positionIndex.getRowTop(range.startRow);
      const y2 =
        this.positionIndex.getRowTop(range.endRow) + this.positionIndex.getRowHeight(range.endRow);
      if (y2 <= y1) return null;
      return docSpaceRect(0, y1, ROW_HEADER_WIDTH, y2 - y1);
    };

    // Collect header rects for old selection range
    if (oldSelection.ranges.length === 1) {
      const colRect = colHeaderRect(oldSelection.ranges[0]);
      if (colRect) dirtyRects.push(colRect);
      const rowRect = rowHeaderRect(oldSelection.ranges[0]);
      if (rowRect) dirtyRects.push(rowRect);
    }

    // Collect header rects for new selection range
    if (newSelection.ranges.length === 1) {
      const colRect = colHeaderRect(newSelection.ranges[0]);
      if (colRect) dirtyRects.push(colRect);
      const rowRect = rowHeaderRect(newSelection.ranges[0]);
      if (rowRect) dirtyRects.push(rowRect);
    }

    if (dirtyRects.length === 0) {
      return { type: 'full' };
    }

    return { type: 'rects', bounds: dirtyRects };
  }

  // ===========================================================================
  // Scene Graph Sync
  // ===========================================================================

  /**
   * Apply targeted scene graph patches. O(1) per patch — no clear/rebuild.
   *
   * Returns a DirtyHint describing which regions need repaint. For object
   * add/remove/update, computes AABB dirty rects from old + new bounds.
   * Falls back to full dirty when bounds are unavailable.
   *
   * Optimization: when `changedFields` is present and contains only non-geometry
   * fields, we update the existing scene object in-place instead of doing a full
   * rebuild via buildSceneObject(). This avoids re-creating type-specific data
   * (shape paths, text layout, etc.) for visual-only changes like fill/outline.
   */
  private applySceneGraphPatches(patches: FloatingObjectPatch[]): DirtyHint {
    const _dtHook = (window as any).__OS_DEVTOOLS__;
    const _dtPatches: Array<{
      objectId: string;
      kind: string;
      data?: any;
      bounds?: any;
      skipped?: boolean;
      skipReason?: string;
    }> | null = _dtHook ? [] : null;

    // Accumulate dirty rects from all patches. If any patch lacks bounds
    // information, fall back to full dirty for correctness.
    const dirtyRects: DocSpaceRect[] = [];
    let needsFullDirty = false;

    for (const patch of patches) {
      if (patch.kind === 'remove') {
        // Capture old bounds before removal for dirty tracking
        const existing = this.drawing.sceneGraph.getById(patch.objectId);
        if (existing) {
          const b = existing.bounds;
          dirtyRects.push(docSpaceRect(b.x, b.y, b.width, b.height));
        } else {
          // Object not in scene graph — nothing to dirty
        }
        this.drawing.sceneGraph.remove(patch.objectId);
        _dtPatches?.push({ objectId: patch.objectId, kind: 'remove' });
        continue;
      }

      // Created/Updated: use inline data from the patch (pushed from store subscription),
      // falling back to adapter lookup for legacy callers without inline data.
      const obj = patch.data ?? this.floatingObjectAdapter.getFloatingObject(patch.objectId);
      if (!obj) {
        _dtPatches?.push({
          objectId: patch.objectId,
          kind: patch.kind,
          skipped: true,
          skipReason: 'no-data',
        });
        continue;
      }

      // Use pre-computed pixel bounds from Rust.
      // Bounds are expected to always be present — Rust supplies them via
      // FloatingObjectChange for mutations, and computeAllObjectBounds for sheet switch.
      let bounds = patch.bounds ?? null;
      if (!bounds && patch.kind === 'updated') {
        const existing = this.drawing.sceneGraph.getById(patch.objectId);
        if (existing) {
          bounds = { ...existing.bounds, rotation: existing.rotation ?? 0 };
        }
      }
      if (!bounds) {
        if (!isProd()) {
          console.warn(
            `[GridRenderer] applySceneGraphPatches: missing bounds for object ${patch.objectId}, skipping. ` +
              'Bounds should be supplied via FloatingObjectPatch.bounds from Rust.',
          );
        }
        _dtPatches?.push({
          objectId: patch.objectId,
          kind: patch.kind,
          skipped: true,
          skipReason: 'no-bounds',
        });
        continue;
      }

      // Compute dirty rects: old bounds (if updating) + new bounds
      const newRect = docSpaceRect(bounds.x, bounds.y, bounds.width, bounds.height);

      if (patch.kind === 'created') {
        // New object — dirty its bounds
        dirtyRects.push(newRect);
      } else {
        // Updated object — dirty old bounds + new bounds
        const existing = this.drawing.sceneGraph.getById(patch.objectId);
        if (existing) {
          const eb = existing.bounds;
          dirtyRects.push(docSpaceRect(eb.x, eb.y, eb.width, eb.height));
        }
        dirtyRects.push(newRect);
      }

      // Optimization: for updates with changedFields, try to skip full rebuild.
      // New objects (kind === 'created') always need a full build.
      if (patch.kind === 'updated' && patch.changedFields && patch.changedFields.length > 0) {
        const existing = this.drawing.sceneGraph.getById(patch.objectId);
        if (existing) {
          const hasGeometryChange = patch.changedFields.some((f) => GEOMETRY_FIELDS.has(f));

          if (!hasGeometryChange) {
            const hasPositionChange = patch.changedFields.some((f) => POSITION_FIELDS.has(f));

            if (hasPositionChange) {
              // Position-only or position+visual change: update bounds without geometry rebuild
              this.drawing.sceneGraph.update(patch.objectId, {
                bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
                rotation: bounds.rotation ?? 0,
                zIndex: obj.zIndex ?? 0,
                flipH: obj.position.flipH ?? false,
                flipV: obj.position.flipV ?? false,
              });
              _dtPatches?.push({ objectId: patch.objectId, kind: patch.kind, data: obj, bounds });
            } else {
              // Visual-only change (fill, outline, etc.): rebuild data but keep bounds
              // We still do buildSceneObject here because the type-specific data (fill, border,
              // text content, etc.) is constructed inside buildSceneObject's switch branches.
              // However, we could optimize further in the future by having per-type data updaters.
              const sceneObject = this.buildSceneObject(obj, bounds);
              if (sceneObject) {
                this.drawing.sceneGraph.add(sceneObject);
                _dtPatches?.push({ objectId: patch.objectId, kind: patch.kind, data: obj, bounds });
              }
            }
            continue;
          }
          // Falls through to full rebuild for geometry changes
        }
        // Falls through to full rebuild if existing object not found
      }

      // Full rebuild: new objects, geometry changes, or missing changedFields
      let sceneObject: ReturnType<typeof this.buildSceneObject>;
      try {
        sceneObject = this.buildSceneObject(obj, bounds);
      } catch (err) {
        console.error('[GridRenderer] buildSceneObject threw for object', obj.id, err);
        continue;
      }
      if (sceneObject) {
        this.drawing.sceneGraph.add(sceneObject);
        _dtPatches?.push({ objectId: patch.objectId, kind: patch.kind, data: obj, bounds });
      }
    }
    if (_dtPatches) {
      _dtHook?.reportSceneGraphPatch?.(_dtPatches);
    }

    // Return aggregated dirty hint for the caller to pass to the engine
    if (needsFullDirty || dirtyRects.length === 0) {
      return { type: 'full' };
    }
    return { type: 'rects', bounds: dirtyRects };
  }

  private async syncSceneGraph(): Promise<void> {
    const objects = this.floatingObjectAdapter.getFloatingObjects();
    this.drawing.sceneGraph.clear();

    // Batch path: single IPC call for all bounds via computeAllObjectBounds.
    // This is the only bounds source for full rebuilds (init, sheet switch).
    const allBoundsResult = this.floatingObjectAdapter.getAllObjectBounds();
    const allBounds = allBoundsResult instanceof Promise ? await allBoundsResult : allBoundsResult;

    if (allBounds && allBounds.size > 0) {
      for (const obj of objects) {
        const bounds = allBounds.get(obj.id);
        if (bounds) {
          const sceneObject = this.buildSceneObject(obj, bounds);
          if (sceneObject) {
            this.drawing.sceneGraph.add(sceneObject);
          }
        }
      }
    } else if (objects.length > 0) {
      // getAllObjectBounds returned empty/null but objects exist — log a warning.
      // The per-object async getFloatingObjectBounds fallback has been removed.
      // Bounds should be supplied via the batch getAllObjectBounds API.
      if (!isProd()) {
        console.warn(
          `[GridRenderer] syncSceneGraph: getAllObjectBounds returned empty but ${objects.length} objects exist. ` +
            'Objects will not render until bounds are available. Ensure getAllObjectBounds is wired up.',
        );
      }
    }
  }

  /**
   * Build a fully-typed SceneObject from a FloatingObject + bounds.
   *
   * Each switch branch constructs an object literal with a concrete `type`
   * literal and matching `data` shape so TypeScript can verify the
   * discriminated union without any `as` casts.
   */
  private buildSceneObject(obj: FloatingObject, bounds: ObjectBounds): SceneObject | null {
    if (obj.type === 'shape' && (obj.shapeType as string) === 'group') {
      return null;
    }
    if (obj.type === 'formControl') {
      return null;
    }

    const visibleValue = (obj as unknown as { visible?: unknown }).visible;
    const base = {
      id: obj.id,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      zIndex: obj.zIndex ?? 0,
      groupId: null as string | null,
      rotation: bounds.rotation ?? 0,
      flipH: obj.position?.flipH ?? false,
      flipV: obj.position?.flipV ?? false,
      opacity: 1,
      visible: typeof visibleValue === 'boolean' ? visibleValue : true,
      locked: obj.locked ?? false,
    };

    switch (obj.type) {
      case 'diagram':
        return {
          ...base,
          type: 'diagram' as const,
          data: this.buildDiagramData(obj),
        };
      case 'picture':
        return {
          ...base,
          type: 'picture' as const,
          data: {
            src: obj.src,
            naturalWidth: obj.originalWidth,
            naturalHeight: obj.originalHeight,
            cropTop: obj.crop?.top,
            cropBottom: obj.crop?.bottom,
            cropLeft: obj.crop?.left,
            cropRight: obj.crop?.right,
            opacity:
              obj.adjustments?.transparency != null
                ? 1 - obj.adjustments.transparency / 100
                : undefined,
            brightness: obj.adjustments?.brightness,
            contrast: obj.adjustments?.contrast,
            border: obj.border,
          } satisfies PictureData,
        };
      case 'textbox':
        return {
          ...base,
          type: 'textbox' as const,
          data: {
            text: obj.text?.content ?? '',
            fill: obj.fill
              ? {
                  type: obj.fill.type as 'solid' | 'gradient' | 'none',
                  color: obj.fill.color,
                  gradient: obj.fill.gradient,
                }
              : undefined,
            border: obj.border
              ? {
                  style: obj.border.style,
                  color: obj.border.color,
                  width: obj.border.width,
                }
              : undefined,
            padding: obj.text?.margins,
            verticalAlign: obj.text?.verticalAlign as 'top' | 'middle' | 'bottom' | undefined,
            textEffect: obj.textEffects ? this.buildTextEffectRef(obj.textEffects) : undefined,
          } satisfies TextboxData,
        };
      case 'shape':
        return {
          ...base,
          type: 'shape' as const,
          data: {
            shapeType: obj.shapeType,
            fill: obj.fill
              ? {
                  type: obj.fill.type as 'solid' | 'gradient' | 'none',
                  color: obj.fill.color,
                  gradient: obj.fill.gradient,
                }
              : undefined,
            border: obj.outline
              ? {
                  style: obj.outline.style,
                  color: obj.outline.color,
                  width: obj.outline.width,
                }
              : undefined,
            adjustments: obj.adjustments
              ? Object.entries(obj.adjustments).map(([name, value]) => ({ name, value }))
              : undefined,
            text: obj.text?.content,
          } satisfies ShapeData,
        };
      case 'connector':
        return {
          ...base,
          type: 'connector' as const,
          data: {
            shapeType: obj.shapeType,
            startConnection: obj.startConnection,
            endConnection: obj.endConnection,
            headEnd: obj.outline?.headEnd,
            tailEnd: obj.outline?.tailEnd,
            outline: obj.outline
              ? {
                  style: obj.outline.style,
                  color: obj.outline.color,
                  width: obj.outline.width,
                }
              : undefined,
            fill: obj.fill
              ? {
                  type: obj.fill.type as 'solid' | 'gradient' | 'none',
                  color: obj.fill.color,
                  gradient: obj.fill.gradient,
                }
              : undefined,
          } satisfies ConnectorData,
        };
      case 'chart':
        return {
          ...base,
          type: 'chart' as const,
          data: {
            chartId: obj.id,
            chartType: obj.chartType,
          } satisfies ChartData,
        };
      case 'equation':
        return {
          ...base,
          type: 'equation' as const,
          data: {
            latex: obj.equation.latex ?? '',
            style: {
              fontSize: obj.equation.style.fontSize,
              color: obj.equation.style.color,
            },
          } satisfies EquationData,
        };
      case 'drawing':
        // Ink/drawing objects — map to ink scene type
        return {
          ...base,
          type: 'ink' as const,
          data: {
            strokes: [],
          } satisfies InkData,
        };
      case 'oleObject':
        return {
          ...base,
          type: 'oleObject' as const,
          data: {
            progId: obj.progId,
            dvAspect: obj.dvAspect,
            previewImageUrl: obj.previewImageSrc,
            iconLabel: deriveIconLabel(obj.progId),
          } satisfies OleObjectData,
        };
      default: {
        const _exhaustive: never = obj;
        void _exhaustive;
        return null;
      }
    }
  }

  private buildDiagramData(obj: DiagramObject): {
    objectId: string;
    diagramType: string;
    nodes: Array<{ id: string; text: string; level: number }>;
    quickStyleId?: string;
    colorThemeId?: string;
  } {
    const diagram = obj.diagram;
    const nodes: Array<{ id: string; text: string; level: number }> = [];

    // Extract nodes from the diagram's node map
    if (diagram.nodes instanceof Map) {
      for (const [id, node] of diagram.nodes) {
        nodes.push({ id, text: node.text, level: node.level });
      }
    } else if (diagram.nodes && typeof diagram.nodes === 'object') {
      // Handle case where nodes might be deserialized as a plain object
      for (const [id, node] of Object.entries(diagram.nodes)) {
        const n = node as { text: string; level: number };
        nodes.push({ id, text: n.text, level: n.level });
      }
    }

    // Sort by level then by siblingOrder for consistent rendering
    nodes.sort((a, b) => a.level - b.level);

    return {
      objectId: obj.id,
      diagramType: diagram.layoutId,
      nodes,
      quickStyleId: diagram.quickStyleId,
      colorThemeId: diagram.colorThemeId,
    };
  }

  /**
   * Convert a contracts TextEffectConfig into the scene-graph TextEffectRef shape.
   * Maps the discriminated TextEffectFill union to the simpler ObjectFillConfig,
   * and TextEffectOutline to ObjectBorderConfig.
   */
  private buildTextEffectRef(config: NonNullable<TextBoxObject['textEffects']>): TextEffectRef {
    let textFill: ObjectFillConfig | undefined;
    const fill = config.fill;
    switch (fill.type) {
      case 'solid':
        textFill = { type: 'solid', color: fill.color };
        break;
      case 'gradient':
        textFill = {
          type: 'gradient',
          gradient: {
            type: fill.gradientType === 'radial' ? 'radial' : 'linear',
            angle: fill.angle,
            stops: fill.stops.map((s) => ({ offset: s.position / 100, color: s.color })),
          },
        };
        break;
      default:
        textFill = { type: 'none' };
        break;
    }

    let textOutline: ObjectBorderConfig | undefined;
    if (config.outline) {
      textOutline = {
        style: config.outline.dash ?? 'solid',
        color: config.outline.color,
        width: config.outline.width,
      };
    }

    return {
      warpPreset: config.warpPreset ?? 'textNoShape',
      warpAdjustments: config.warpAdjustments,
      textFill,
      textOutline,
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;
    // Populate scene graph from current floating object state
    void this.syncSceneGraph();
    this.engine.start();
  }

  stop(): void {
    this.isRunning = false;
    this.engine.stop();
  }

  pause(): void {
    this.isPaused = true;
    this.engine.pause();
  }

  resume(): void {
    // Note: no `if (!this.isRunning) return` gate. Production wires the
    // engine via `sheetView.engine.start()` directly (see sheet-view.ts
    // L364, L372 — the contract is that the caller owns engine.start()
    // for policy reasons), so `this.isRunning` stays false in normal
    // operation and a guard here would silently swallow every resume —
    // including the one that fires on visibilitychange→visible. The
    // engine itself gates resume on its own running flag, which is the
    // correct check.
    this.isPaused = false;
    this.engine.resume();
    this.markAllDirty();
  }

  dispose(): void {
    this.stop();
    this.gridLayers.dispose();
    this.drawing.dispose();
    this.overlay.dispose();
    this.engine.dispose();
  }

  // ===========================================================================
  // Viewport
  // ===========================================================================

  resize(width: number, height: number): void {
    // The engine handles resize via ResizeObserver on the container.
    // Update the legacy coordinate system for backward compat.
    const viewport = this.coords.getViewport();
    this.coords.setViewport({
      ...viewport,
      width,
      height,
    });
    this.markAllDirty();
  }

  setViewportLayout(
    layout: ViewportLayout | null,
    options: ViewportLayoutUpdateOptions = {},
  ): void {
    this.viewportLayout = layout;
    const invalidation = options.invalidation ?? 'structural';

    if (layout) {
      this.coords.setFrozenPanes({
        rows: layout.headerInfo.frozenRows,
        cols: layout.headerInfo.frozenCols,
      });

      const regionLayout = viewportLayoutToRegionLayout(layout, this.currentSheetId);

      // Push region layout to the engine so per-region layers actually render.
      // Without this, the render loop skips all per-region layers (cells,
      // background, selection, headers) because it has no regions to iterate.
      (
        this.engine.setLayout as (
          layout: typeof regionLayout,
          options?: { invalidation?: 'structural' | 'scroll' },
        ) => void
      )(regionLayout, { invalidation });

      // Push regions to "once"-mode layers that need region metadata to draw
      // labels/dividers at correct positions (they don't receive regions from
      // the engine's per-region render loop).
      this.gridLayers.headers.setRegions(regionLayout.regions);
      this.gridLayers.dividers.setRegions(regionLayout.regions);
    } else {
      this.coords.setFrozenPanes({ rows: 0, cols: 0 });
      this.gridLayers.headers.setRegions([]);
      this.gridLayers.dividers.setRegions([]);
    }

    if (invalidation === 'scroll' && layout) {
      this.markScrollDirty();
    } else {
      this.markAllDirty();
    }
  }

  getViewportLayout(): ViewportLayout | null {
    return this.viewportLayout;
  }

  // ===========================================================================
  // Scroll/Zoom
  // ===========================================================================

  setScroll(scrollTop: number, scrollLeft: number): void {
    const viewport = this.coords.getViewport();
    this.coords.setViewport({
      ...viewport,
      scrollTop,
      scrollLeft,
    });
    this.markScrollDirty();
  }

  setZoom(zoom: number): void {
    this.coords.setZoom(zoom);
    this.markAllDirty();
  }

  // ===========================================================================
  // Sheet Operations
  // ===========================================================================

  switchSheet(sheetId: string): void {
    this.currentSheetId = sheetId;
    this.sheetAdapter.setSheetId(sheetId);
    this.drawing.sceneGraph.clear();
    void this.syncSceneGraph(); // Full rebuild for new sheet's objects
    this.markAllDirty();
  }

  // ===========================================================================
  // Context Updates (CRITICAL HOT PATH — 50-200+ calls/sec)
  // ===========================================================================

  updateContext(config: Partial<RenderContextConfig>): void {
    for (const key in config) {
      const handler = this.fieldHandlers[key];
      if (handler) {
        handler((config as Record<string, unknown>)[key]);
      }
    }
  }

  // ===========================================================================
  // Invalidation API
  // ===========================================================================

  invalidateLayer(layer: ContractsLayerName, _regions?: CellRange[]): void {
    this.engine.markDirty(layer);
  }

  invalidateCells(cells: CellCoord[], _priority: RenderPriority = RenderPriority.NORMAL): void {
    if (cells.length === 0) return;
    this.engine.markDirty('cells');
  }

  invalidateAll(): void {
    this.markAllDirty();
  }

  // ===========================================================================
  // Queries
  // ===========================================================================

  getCoordinateSystem(): CoordinateSystem {
    return this.coords;
  }

  getCellPageBounds(
    row: number,
    col: number,
  ): { x: number; y: number; width: number; height: number } | null {
    const sheetId = this.currentSheetId;
    if (!sheetId) return null;

    const layoutViewport = this.viewportLayout?.viewports.find((viewport) => {
      const viewportSheetId = viewport.sheetId ?? sheetId;
      const range = viewport.cellRange;
      return (
        viewportSheetId === sheetId &&
        row >= range.startRow &&
        row <= range.endRow &&
        col >= range.startCol &&
        col <= range.endCol
      );
    });

    if (layoutViewport) {
      const docX = this.positionIndex.getColLeft(col);
      const docY = this.positionIndex.getRowTop(row);
      const origin = docToCanvasXY(docX, docY, layoutViewport);
      const width = this.positionIndex.getColWidth(col) * layoutViewport.zoom;
      const height = this.positionIndex.getRowHeight(row) * layoutViewport.zoom;
      const clippedX = Math.max(origin.x, layoutViewport.bounds.x);
      const clippedY = Math.max(origin.y, layoutViewport.bounds.y);
      const clippedRight = Math.min(
        origin.x + width,
        layoutViewport.bounds.x + layoutViewport.bounds.width,
      );
      const clippedBottom = Math.min(
        origin.y + height,
        layoutViewport.bounds.y + layoutViewport.bounds.height,
      );
      if (clippedRight < clippedX || clippedBottom < clippedY) return null;

      const containerRect = this.container.getBoundingClientRect();
      return {
        x: containerRect.x + clippedX,
        y: containerRect.y + clippedY,
        width: clippedRight - clippedX,
        height: clippedBottom - clippedY,
      };
    }

    return null;
  }

  getCellRenderedSize(row: number, col: number): { width: number; height: number } | null {
    // The drawn size of a cell is just its column width / row height scaled by
    // the active zoom. It is independent of sheetId, of which viewport (main /
    // frozen / split) contains the cell, and of whether the cell is currently
    // scrolled into view — those only matter for *positioning* and clipping
    // (see getCellPageBounds), not for size. Deliberately no viewport search:
    // adding scroll-dependence here is exactly the clipping bug this method
    // exists to avoid.
    const zoom = this.coords.getZoom();
    if (!Number.isFinite(zoom) || zoom <= 0) return null;
    return {
      width: this.positionIndex.getColWidth(col) * zoom,
      height: this.positionIndex.getRowHeight(row) * zoom,
    };
  }

  getRangePageBounds(range: CellRange): { x: number; y: number; width: number; height: number }[] {
    const sheetId = this.currentSheetId;
    if (!sheetId) return [];

    const viewportRects = this.coords.rangeToViewport(sheetId, range);
    if (viewportRects.length === 0) return [];

    const containerRect = this.container.getBoundingClientRect();
    return viewportRects.map((r) => ({
      x: containerRect.x + r.x,
      y: containerRect.y + r.y,
      width: r.width,
      height: r.height,
    }));
  }

  hitTest(x: number, y: number): UnifiedHitResult {
    const engineHit = this.engine.hitTest({ x, y });

    // Overlay hits (selection handles, rotation handle) → FloatingObjectHitResult
    // OverlayHitResult.region (HandleRegion) is a subset of ObjectHitRegion
    //
    // Cross-sheet guard: the React-side `floatingObjects`
    // adapter is updated synchronously when switchSheet flips the active
    // sheet, but the renderer's scene graph is rebuilt asynchronously
    // (`syncSceneGraph` awaits `getAllObjectBounds`). During the rebuild
    // window, the scene graph still contains the previous sheet's objects.
    // Without this guard, a click at the same canvas coordinates as a
    // previous-sheet chart would route to that chart, dropping the cell
    // click on the new sheet — the chart-overlay leak the audit describes.
    if (engineHit?.layerId === 'overlay') {
      const t = engineHit.target as { region: string; objectId: string | null };
      if (t.objectId && this.isObjectOnActiveSheet(t.objectId)) {
        return {
          type: 'floatingObject',
          objectId: t.objectId,
          region: t.region as ObjectHitRegion,
          isGroup: false,
        };
      }
    }

    // Drawing layer hits → FloatingObjectHitResult
    if (engineHit?.layerId === 'drawing') {
      const t = engineHit.target as {
        objectId: string;
        groupId: string | null;
        region: string;
      };
      if (this.isObjectOnActiveSheet(t.objectId)) {
        return {
          type: 'floatingObject',
          objectId: t.objectId,
          region: t.region as ObjectHitRegion,
          isGroup: !!t.groupId,
        };
      }
      // Cross-sheet leak — pass through to the cell beneath.
    }

    // Fall back to cell/header classification via coordinate system
    return this.coords.classifyPoint(this.currentSheetId, viewportPoint(x, y));
  }

  /**
   * Returns true when the floating object id is in the active sheet's
   * floatingObjects set (per-sheet filtered by the React layer).
   *
   * Cross-sheet guard: the scene graph rebuild lags the React
   * activeSheet flip; during that window the engine may report drawing-
   * layer hits on previous-sheet objects. This guard short-circuits that
   * leak by checking the canonical React-side adapter.
   *
   * Returns true when adapter has not been wired yet (initial bootstrap),
   * to avoid blocking legitimate hits in tests that haven't fully
   * initialized the floatingObjects callback.
   */
  private isObjectOnActiveSheet(objectId: string): boolean {
    const objects = this.floatingObjectAdapter.getFloatingObjects();
    if (objects.length === 0) {
      // No floating objects on the active sheet — but the scene graph
      // reported a hit. This means the scene graph is stale (cross-sheet
      // leftover) and we should not route to it.
      return false;
    }
    for (const obj of objects) {
      if (obj.id === objectId) return true;
    }
    return false;
  }

  getObjectBoundsSync(objectId: string): ObjectBounds | null {
    const obj = this.drawing.sceneGraph.getById(objectId);
    if (!obj) return null;
    return {
      x: obj.bounds.x,
      y: obj.bounds.y,
      width: obj.bounds.width,
      height: obj.bounds.height,
      rotation: obj.rotation ?? 0,
    };
  }

  /**
   * Returns an IObjectBoundsReader backed by the scene graph.
   *
   * Lazy-initialized singleton — the SceneGraphBoundsReader holds a reference
   * to the same SceneGraph instance used for rendering, so bounds are always
   * consistent with the last render pass.
   */
  get boundsReader(): IObjectBoundsReader {
    if (!this._boundsReader) {
      this._boundsReader = new SceneGraphBoundsReader(this.drawing.sceneGraph);
    }
    return this._boundsReader;
  }

  /**
   * Read-only accessor over the rendering scene graph. Lazy-initialized
   * singleton — the SceneGraphReader holds a reference to the same
   * SceneGraph instance used for rendering, so reads are always
   * consistent with the last render pass.
   *
   * Stable across `switchSheet()`: the underlying SceneGraph instance is
   * shared across sheets (one per renderer), so this getter returns the
   * same reader for the renderer's lifetime.
   */
  get sceneGraphReader(): ISceneGraphReader {
    if (!this._sceneGraphReader) {
      this._sceneGraphReader = new SceneGraphReader(this.drawing.sceneGraph);
    }
    return this._sceneGraphReader;
  }

  updateObjectBounds(objectId: string, bounds: ObjectBoundsUpdate): void {
    const updated = this.drawing.sceneGraph.update(objectId, {
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      rotation: bounds.rotation,
    });
    // Scene graph's onDirty already marks drawing layer dirty + requestFrame.
    // We also need to mark overlay dirty so handles follow the shape.
    if (updated) {
      this.engine.markDirty('overlay');
    }
  }

  getStats(): GridRendererStats {
    const engineStats = this.engine.getStats();
    return {
      fps: engineStats.fps,
      averageFrameTime: engineStats.averageFrameTime,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      totalFrames: this.totalFrames,
      queueDepth: 0,
    };
  }

  getCurrentSheetId(): string {
    return this.currentSheetId;
  }

  getClippedCellContent(_row: number, _col: number): string | null {
    // The grid-renderer CellsLayer tracks clipped cells internally.
    // TODO: Expose clipped content from CellsLayer when needed for tooltips.
    return null;
  }

  // ===========================================================================
  // Interactive Elements
  // ===========================================================================

  getInteractiveElementCollector(): InteractiveElementCollector {
    return this.interactiveElementCollector;
  }

  // ===========================================================================
  // Render Scheduler (Write = Invalidate)
  // ===========================================================================

  getRenderScheduler(): RenderScheduler {
    return this.renderScheduler;
  }

  getCellExpander(): import('@mog/canvas-engine').DirtyCellExpander | null {
    return this.gridLayers.cells;
  }

  /**
   * Get the underlying CanvasEngineInstance.
   *
   * Exposed for SheetView (views layer) so the engine lifecycle (start/stop) can
   * be managed by the consuming view, and so advanced consumers can register
   * additional hit-test providers / layers alongside the grid layers.
   */
  getEngine(): CanvasEngineInstance {
    return this.engine;
  }

  /**
   * Get the composed GridLayers result.
   *
   * Exposed for SheetView so policy layers (selection/editor/clipboard) can
   * push state via updateDataSources().
   */
  getGridLayers(): GridLayersResult {
    return this.gridLayers;
  }

  // ===========================================================================
  // Bridge Integration (forwarded to drawing layer's BridgeRegistry)
  // ===========================================================================

  setInkAccessor(accessor: InkAccessorForRendering | null): void {
    if (accessor) {
      this.drawing.bridges.setInkAccessor(accessor);
    }
    this.engine.markDirty('drawing');
  }

  setDiagramBridge(bridge: IDiagramBridge | null): void {
    if (bridge) {
      // Wrap the kernel bridge in a canvas adapter for rendering
      this.diagramCanvasBridge = new DiagramCanvasBridge(bridge);
      this.drawing.bridges.setDiagramBridge(this.diagramCanvasBridge);
    } else {
      this.diagramCanvasBridge = null;
      // BridgeRegistry setter doesn't accept null; a null bridge means the
      // drawing layer will render a gray placeholder via its existing fallback.
    }
    this.engine.markDirty('drawing');
  }

  setAstToLatex(fn: RenderLatexFn): void {
    this.drawing.bridges.setAstToLatexFn(fn);
    this.engine.markDirty('drawing');
  }

  setTextEffectBridge(bridge: ITextEffectCanvasBridge | null): void {
    if (bridge) {
      this.drawing.bridges.setTextEffectBridge(bridge);
      this.engine.markDirty('drawing');
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private markAllDirty(): void {
    // Mark all engine layers dirty
    for (const layer of this.gridLayers.layers) {
      this.engine.markDirty(layer.id);
    }
    this.engine.markDirty(this.drawing.layer.id);
    this.engine.markDirty(this.overlay.id);
  }

  /**
   * Mark only scroll-dependent layers dirty. Called by setScroll() instead of
   * markAllDirty() so that static chrome layers (dividers, overlay) keep their
   * caches across scroll frames.
   *
   * Layers skipped:
   * - dividers  — freeze-pane lines at fixed canvas-absolute positions
   * - overlay   — screen-space UX chrome (handles, guides, ink)
   */
  private markScrollDirty(): void {
    // All grid layers except dividers are scroll-dependent
    for (const layer of this.gridLayers.layers) {
      if (layer.id === 'dividers') continue;
      this.engine.markDirty(layer.id);
    }
    // Drawing layer is per-region and scroll-dependent
    this.engine.markDirty(this.drawing.layer.id);
    // Overlay is screen-space (renderMode: 'once') — not scroll-dependent
  }
}

// =============================================================================
// Scene Graph Patch Optimization — Field Classification
// =============================================================================

/**
 * Fields that affect object geometry (shape outline, mesh). Changes to these
 * require a full scene object rebuild via buildSceneObject().
 */
const GEOMETRY_FIELDS = new Set(['shapeType', 'width', 'height', 'adjustments']);

/**
 * Fields that only affect object position/bounds. When only these change,
 * we can update bounds on the existing scene object without rebuilding geometry.
 */
const POSITION_FIELDS = new Set(['anchorRow', 'anchorCol', 'xOffset', 'yOffset', 'x', 'y']);

// =============================================================================
// OLE Object Helpers
// =============================================================================

/** Well-known OLE ProgID prefixes → human-readable labels. */
const OLE_PROG_ID_LABELS: ReadonlyArray<readonly [prefix: string, label: string]> = [
  ['Word.Document', 'Word Document'],
  ['Excel.Sheet', 'Excel Spreadsheet'],
  ['PowerPoint.Show', 'PowerPoint Presentation'],
  ['PowerPoint.Slide', 'PowerPoint Slide'],
  ['Visio.Drawing', 'Visio Drawing'],
  ['AcroExch.Document', 'PDF Document'],
  ['Acrobat.Document', 'PDF Document'],
  ['Package', 'Embedded File'],
];

/**
 * Derive a human-readable icon label from an OLE ProgID string.
 *
 * Examples:
 * - "Word.Document.12"  → "Word Document"
 * - "AcroExch.Document" → "PDF Document"
 * - "SomeUnknown.Thing" → "SomeUnknown.Thing" (passthrough)
 */
function deriveIconLabel(progId: string): string {
  for (const [prefix, label] of OLE_PROG_ID_LABELS) {
    if (progId.startsWith(prefix)) return label;
  }
  return progId;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new grid renderer.
 *
 * Returns the concrete `GridRendererImpl` type (not the narrower `GridRenderer`
 * contract) so callers can reach the facade's view-layer extensions —
 * `getEngine()`, `getGridLayers()`, `getCellExpander()` — which the `GridRenderer`
 * interface does not publish. `GridRendererImpl implements GridRenderer`, so
 * callers that only need the contract API still see it through the subtype.
 */
export function createGridRenderer(config: GridRendererConfig): GridRendererImpl {
  return new GridRendererImpl(config);
}

// Re-export types
export type { FrozenPanes } from '@mog/grid-renderer';
