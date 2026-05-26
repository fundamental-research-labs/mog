/**
 * Rendering Types and Constants
 *
 * Shared types for canvas rendering used by both canvas and state subsystems.
 * This module provides the contracts that enable decoupling of the rendering layer.
 *
 * @module @mog-sdk/contracts/rendering
 */

// Coordinate types
export type {
  CellCoord,
  CoordinateSystem,
  DocumentPoint,
  DocumentRect,
  FrozenPanes,
  LayerPoint,
  LayerRect,
  MergeRegionLike,
  ScrollViewport,
  ViewportMergeIndexLike,
  ViewportPoint,
  ViewportPositionIndexLike,
  ViewportRect,
  VisibleRegions,
} from './coordinates';

// Hit test and physics types
export type {
  CellHitResult,
  ColumnHeaderHitResult,
  ColumnResizeHitResult,
  CommentIndicatorHitResult,
  EffectiveObjectState,
  EmptyHitResult,
  FillHandleHitResult,
  FloatingObjectHitResult,
  FrozenHitResult,
  HiddenColumnBoundaryHitResult,
  HiddenRowBoundaryHitResult,
  HitTestResult,
  ObjectBounds,
  ObjectHitRegion,
  OutlineCollapseButtonHitResult,
  OutlineLevelButtonHitResult,
  PreviewCellData,
  RemoteCursor,
  RowHeaderHitResult,
  RowResizeHitResult,
  ScrollPhysicsConfig,
  ScrollState,
  SelectAllHitResult,
  UnifiedHitResult,
  ZoomPhysicsConfig,
  ZoomState,
} from './hit-test';

// Hit test service interface
export type { HitTestService, OutlineHitTestResult } from './hit-test-service';

// Text measurement service interface
export type {
  SheetBounds,
  TextMeasurementContext,
  TextMeasurementService,
  TextPosition,
  TextPositionInput,
} from './text-measurement-service';

// Grid renderer types
export type {
  GridRenderer,
  GridRendererConfig,
  GridRendererStats,
  LayoutInvalidationMode,
  LayerName,
  ObjectBoundsUpdate,
  RenderScheduler,
  RendererFactory,
  ViewportLayoutUpdateOptions,
} from './grid-renderer';

// Grid renderer enum (needs value export, not just type)
export { RenderPriority } from './grid-renderer';

// Render context config types
export type {
  FloatingObjectPatch,
  FloatingObjectRenderState,
  PageBreakDragState,
  PageBreakInfo,
  PageBreakOrientation,
  PageBreakType,
  RenderContextConfig,
  SelectionErrorType,
  SelectionRenderState,
} from './render-context';

// Grouping data types (Task 9: Move Canvas Types to Contracts)
export type { GroupingData } from './grouping';

// Constants
export {
  BUFFER_COLS,
  BUFFER_ROWS,
  COL_HEADER_HEIGHT,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_ZOOM,
  MAX_OUTLINE_LEVELS,
  MAX_ZOOM,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  MIN_ZOOM,
  MOUSE_HIT_AREA_SIZE,
  OUTLINE_BUTTON_SIZE,
  OUTLINE_LEVEL_HEIGHT,
  OUTLINE_LEVEL_WIDTH,
  ROW_HEADER_WIDTH,
  SCROLL_BAR_WIDTH,
  TOUCH_HIT_AREA_SIZE,
  ZOOM_PRESETS,
  ZOOM_STEP,
} from '@mog/types-viewport/rendering/constants';

// Types
export type { HeaderVisibility } from '@mog/types-viewport/rendering/constants';

// Interactive element types (Canvas Interactive Element Layer)
export type {
  CheckboxMetadata,
  CommentIndicatorMetadata,
  FilterButtonMetadata,
  InteractiveElement,
  InteractiveElementBounds,
  InteractiveElementCollector,
  InteractiveElementMetadata,
  InteractiveElementType,
  ValidationDropdownMetadata,
} from './interactive-elements';

// Coordinator interfaces (shared across zones)
export type {
  FloatingObjectCoordinator,
  PointerCaptureManager,
  RendererDependencies,
  SheetStateProvider,
} from './coordinator-interfaces';

// Data source interfaces (canvas rewrite)
export type {
  CellBindingStatus,
  CellDataSource,
  ChartRenderBridge,
  ChromeTheme,
  CollaborationDataSource,
  DataBarData,
  DragDropState,
  FloatingObjectDataSource,
  GroupingDataSource,
  IconData,
  OverlayDataSource,
  PageBreakDataSource,
  PageBreakEntry,
  PageBreaks,
  PastePreviewData,
  PrintArea,
  SelectionDataSource,
  SheetDataSource,
  ShimmerDefaults,
  ShimmerEffectType,
  ShimmerEntry,
  TraceDataSource,
} from './data-sources';

// Default rendering constants (value exports)
export { DEFAULT_CHROME_THEME, DEFAULT_SHIMMER_CONFIG } from './data-sources';

// Renderer-facing SheetView skin DTOs
export type {
  ResolvedSheetChromeTheme,
  ResolvedSheetViewBackgroundSkin,
  ResolvedSheetViewColor,
  ResolvedSheetViewGridlineJitter,
  ResolvedSheetViewGridlineSkin,
  ResolvedSheetViewHeaderSkin,
  ResolvedSheetViewOptions,
  ResolvedSheetViewScrollbarSkin,
  ResolvedSheetViewSelectionGlowSkin,
  ResolvedSheetViewSelectionHandleSkin,
  ResolvedSheetViewSelectionSkin,
  ResolvedSheetViewSkin,
  SheetChromeThemePatch,
  SheetViewSkinColorScheme,
  SheetViewSkinDensity,
  SheetViewSkinMotion,
  SheetViewSkinPatch,
} from './sheet-view-skin';

export {
  DEFAULT_RESOLVED_SHEET_VIEW_OPTIONS,
  DEFAULT_RESOLVED_SHEET_VIEW_SKIN,
} from './sheet-view-skin';

// Grid region types (canvas rewrite)
export type { GridRegionMeta } from '@mog/types-viewport/rendering/grid-region';

// Canvas bridge types (rendering-specific bridge interfaces for GridRenderer)
export type { ITextEffectCanvasBridge, RenderBounds, RenderLatexFn } from './canvas-bridge-types';
