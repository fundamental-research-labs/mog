/// <reference lib="esnext.disposable" />

/**
 * @mog-sdk/sheet-view — Views-layer barrel.
 *
 * Entry point for the sheet-view substrate. Exports the factory plus the
 * minimal type surface consumers need to interact with the substrate without
 * taking direct @mog/canvas-engine or @mog/grid-renderer dependencies for types.
 */

export { createSheetView, createSheetViewDataSourceFromWorkbook } from './sheet-view';
export {
  createResolvedSheetViewSkinForScheme,
  DARK_SHEET_CHROME_THEME,
  mapSheetChromeThemeToRenderer,
  resolveSheetViewSkin,
} from './capabilities/skin';
export type { SheetViewCallbacks } from './sheet-view';

// =============================================================================
// Public types (owned by @mog-sdk/sheet-view)
// =============================================================================

export type {
  // Geometry primitives
  SheetPoint,
  SheetSize,
  SheetRect,
  // Cell addressing
  CellAddress,
  RangeAddress,
  SheetAnchor,
  // Dimension info
  RowDimensionInfo,
  ColDimensionInfo,
  DimensionInfo,
  // Sheet bounds
  SheetBounds,
  // Merge region
  MergeRegion,
  // Frozen panes
  FrozenPanesConfig,
  // Hit testing
  SheetHitCell,
  SheetHitMergedCellAnchor,
  SheetHitColumnHeader,
  SheetHitRowHeader,
  SheetHitColumnResizeHandle,
  SheetHitRowResizeHandle,
  SheetHitHiddenColumnBoundary,
  SheetHitHiddenRowBoundary,
  SheetHitFrozenPaneRegion,
  SheetHitSelectAll,
  SheetHitFillHandle,
  SheetHitSelectionAffordance,
  SheetHitFloatingObject,
  SheetHitOutlineLevelButton,
  SheetHitOutlineCollapseButton,
  SheetHitOutlineGutter,
  SheetHitCommentIndicator,
  SheetHitTableResizeHandle,
  SheetHitFormulaRangeHandle,
  SheetHitInteractiveElement,
  SheetHitEmpty,
  SheetHitResult,
  ObjectHitRegionType,
  // Render state
  SelectionVisualState,
  EditorVisualState,
  ClipboardVisualState,
  RemoteCursorVisual,
  SheetViewOptions,
  SheetFloatingObjectScenePatch,
  SheetSceneObjectBounds,
  SheetSceneObjectSnapshot,
  ShimmerConfig,
  SheetChromeTheme,
  PageBreakVisualState,
  SheetRenderState,
  // SheetView skin
  SheetViewSkinColor,
  SheetViewTextureAsset,
  SheetViewSkinRowGeometry,
  SheetViewSkinColumnGeometry,
  SheetViewSkinGeometry,
  SheetViewCustomRenderFrame,
  SheetViewCustomRenderer,
  SheetViewBackgroundSkin,
  SheetViewGridlineJitter,
  SheetViewGridlineSkin,
  SheetViewHeaderSkin,
  SheetViewSelectionGlowSkin,
  SheetViewSelectionHandleSkin,
  SheetViewSelectionSkin,
  SheetViewScrollbarSkin,
  SheetViewSkinAssets,
  SheetViewSkinValidationError,
  SheetViewSkin,
  SheetViewResolvedSkin,
  SheetViewSkinEvent,
  // Viewport
  ScrollPosition,
  ScrollBounds,
  SheetViewportSize,
  HeaderVisibility,
  OutlineGutter,
  PositionDimensions,
  SplitConfig,
  SheetViewportSnapshot,
  SheetViewportState,
  // Object scene
  ObjectBounds,
  ObjectSceneInfo,
  // Interactive elements
  InteractiveElementType,
  InteractiveElementBounds,
  FilterButtonElementMetadata,
  CheckboxElementMetadata,
  CommentIndicatorElementMetadata,
  ValidationDropdownElementMetadata,
  InteractiveElementInfo,
  InteractiveElementSnapshot,
  // Events
  SheetEventCellPointerIntent,
  SheetEventVisibleRangeChange,
  SheetEventGeometryChange,
  SheetEventScrollChange,
  SheetEventScrollPositionReset,
  SheetEventZoomChange,
  SheetEventFocusEnter,
  SheetEventFocusLeave,
  SheetEventEditStartRequest,
  SheetEventEditCommitRequest,
  SheetEventEditCancelRequest,
  SheetEventSelectionVisualChange,
  SheetViewEvent,
  // Commands
  SheetCommandScrollToCell,
  SheetCommandSetZoom,
  SheetCommandSetFrozenPanes,
  SheetCommandSwitchSheet,
  SheetCommandInvalidateAll,
  SheetViewCommand,
  // Invalidation
  InvalidationReason,
  CellInvalidationTarget,
  RangeInvalidationTarget,
  InvalidationTarget,
  // Disposable
  SheetDisposable,
  // Attachment/data sources/locale
  SheetViewDataSource,
  SheetViewWorkbookSource,
  SheetViewDataSources,
  SheetViewDataSourceKey,
  SheetCultureInfo,
  SheetViewportConfig,
  SheetOverlayViewportConfig,
  SheetViewportLayout,
  // Mount options
  SheetViewMountOptions,
  SheetViewViewportInset,
  // Visible bounds
  SheetViewVisibleBounds,
} from './public-types';

// =============================================================================
// Capability interfaces
// =============================================================================

export type {
  ISheetViewGeometry,
  ISheetViewHitTest,
  ISheetViewRender,
  ISheetViewObjects,
  ISheetViewInteractiveElements,
  ISheetViewViewport,
  ISheetViewRenderState,
  ISheetViewDataSources,
  ISheetViewLocale,
  ISheetViewEvents,
  ISheetViewFocus,
  ISheetViewCommands,
  ISheetViewSkin,
  // Extension capabilities
  ISheetViewOverlays,
  ISheetViewDecorations,
  ISheetViewCanvasLayers,
  // SheetViewHandle
  SheetViewHandle,
  // Overlay types
  OverlayAnchor,
  OverlayPlacement,
  SheetOverlayOptions,
  SheetOverlayHandle,
  // Decoration types
  DecorationKind,
  DecorationAnimationPreset,
  DecorationStyle,
  DecorationAnimation,
  SheetDecorationSpec,
  SheetDecorationHandle,
  // Canvas layer types
  CanvasLayerZOrder,
  SheetCanvasFrame,
  SheetCanvasLayerOptions,
  SheetCanvasLayerHandle,
} from './capability-interfaces';

// NOTE: ViewportReader re-export removed — consumers that need the type
// should import directly from @mog-sdk/contracts/api.
