/**
 * Public Types for @mog-sdk/sheet-view
 *
 * All types in this file are OWNED by @mog-sdk/sheet-view. They form the
 * public type surface of the sheet-view capability API. No type here may
 * be imported from @mog/grid-renderer, @mog/canvas-engine,
 * @mog-sdk/contracts, or any other @mog/* internal package.
 *
 * These types are stable public contracts. Internal renderer types are
 * mapped to/from these at the capability implementation boundary inside
 * views/sheet-view/src/ — never by external consumers.
 *
 * @module @mog-sdk/sheet-view/public-types
 */

// =============================================================================
// Geometry Primitives
// =============================================================================

/** A 2D point in any coordinate space. */
export interface SheetPoint {
  readonly x: number;
  readonly y: number;
}

/** A 2D size (width and height). */
export interface SheetSize {
  readonly width: number;
  readonly height: number;
}

/** A rectangle in any coordinate space. */
export interface SheetRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// =============================================================================
// Cell Addressing
// =============================================================================

/** A single cell address (0-indexed). */
export interface CellAddress {
  readonly row: number;
  readonly col: number;
}

/** An inclusive cell range. */
export interface RangeAddress {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
}

/**
 * An anchor that can refer to either a single cell or a range.
 * Used as the input to geometry queries.
 */
export type SheetAnchor = CellAddress | RangeAddress;

// =============================================================================
// Dimension Info
// =============================================================================

/** Row dimension information. */
export interface RowDimensionInfo {
  readonly row: number;
  /** Pixel position of the row's top edge. */
  readonly top: number;
  /** Pixel height of the row. */
  readonly height: number;
  /** Whether this row is hidden. */
  readonly hidden: boolean;
}

/** Column dimension information. */
export interface ColDimensionInfo {
  readonly col: number;
  /** Pixel position of the column's left edge. */
  readonly left: number;
  /** Pixel width of the column. */
  readonly width: number;
  /** Whether this column is hidden. */
  readonly hidden: boolean;
}

/** Union of row and column dimension info. */
export type DimensionInfo = RowDimensionInfo | ColDimensionInfo;

// =============================================================================
// Sheet Bounds
// =============================================================================

/** Total row/column bounds for the current sheet. */
export interface SheetBounds {
  readonly totalRows: number;
  readonly totalCols: number;
}

// =============================================================================
// Merge Region
// =============================================================================

/** A merged cell region. Same shape as RangeAddress. */
export interface MergeRegion {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
}

// =============================================================================
// Frozen Panes
// =============================================================================

/** Frozen pane configuration. */
export interface FrozenPanesConfig {
  /** Number of frozen rows (0 = none). */
  readonly rows: number;
  /** Number of frozen columns (0 = none). */
  readonly cols: number;
}

// =============================================================================
// Hit Testing
// =============================================================================

/** Hit on a regular cell. */
export interface SheetHitCell {
  readonly type: 'cell';
  readonly row: number;
  readonly col: number;
}

/** Hit on a merged cell (resolved to its anchor). */
export interface SheetHitMergedCellAnchor {
  readonly type: 'merged-cell-anchor';
  readonly row: number;
  readonly col: number;
  readonly mergeRegion: MergeRegion;
}

/** Hit on a column header. */
export interface SheetHitColumnHeader {
  readonly type: 'column-header';
  readonly col: number;
}

/** Hit on a row header. */
export interface SheetHitRowHeader {
  readonly type: 'row-header';
  readonly row: number;
}

/** Hit on a column resize handle. */
export interface SheetHitColumnResizeHandle {
  readonly type: 'column-resize-handle';
  readonly col: number;
}

/** Hit on a row resize handle. */
export interface SheetHitRowResizeHandle {
  readonly type: 'row-resize-handle';
  readonly row: number;
}

/** Hit on the boundary of one or more hidden columns. */
export interface SheetHitHiddenColumnBoundary {
  readonly type: 'hidden-column-boundary';
  /** The first hidden column in the run. */
  readonly col: number;
  readonly hiddenStart: number;
  readonly hiddenEnd: number;
}

/** Hit on the boundary of one or more hidden rows. */
export interface SheetHitHiddenRowBoundary {
  readonly type: 'hidden-row-boundary';
  /** The first hidden row in the run. */
  readonly row: number;
  readonly hiddenStart: number;
  readonly hiddenEnd: number;
}

/** Hit on a frozen pane region (corner, top, or left). */
export interface SheetHitFrozenPaneRegion {
  readonly type: 'frozen-pane-region';
  readonly region: 'topLeft' | 'top' | 'left';
}

/** Hit on the select-all button (header intersection). */
export interface SheetHitSelectAll {
  readonly type: 'select-all';
}

/** Hit on the fill handle (small square at selection corner). */
export interface SheetHitFillHandle {
  readonly type: 'fill-handle';
}

/** Edge of a selection border (for drag-drop initiation). */
export interface SheetHitSelectionAffordance {
  readonly type: 'selection-affordance';
  readonly edge: 'top' | 'bottom' | 'left' | 'right';
}

/** Hit region types for floating objects. */
export type ObjectHitRegionType =
  | 'body'
  | 'border'
  | 'rotation'
  | 'resize-nw'
  | 'resize-n'
  | 'resize-ne'
  | 'resize-e'
  | 'resize-se'
  | 'resize-s'
  | 'resize-sw'
  | 'resize-w'
  | 'warp-adjust';

/** Hit on a floating object (chart, image, drawing, etc.). */
export interface SheetHitFloatingObject {
  readonly type: 'floating-object';
  readonly objectId: string;
  readonly region: ObjectHitRegionType;
  readonly isGroup: boolean;
}

/** Hit on an outline level button (row/column grouping). */
export interface SheetHitOutlineLevelButton {
  readonly type: 'outline-level-button';
  readonly axis: 'row' | 'column';
  readonly level: number;
}

/** Hit on an outline collapse/expand button. */
export interface SheetHitOutlineCollapseButton {
  readonly type: 'outline-collapse-button';
  readonly axis: 'row' | 'column';
  readonly groupId: string;
  readonly collapsed: boolean;
}

/** Hit on the outline gutter area. */
export interface SheetHitOutlineGutter {
  readonly type: 'outline-gutter';
  readonly orientation: 'row' | 'column';
}

/** Hit on a comment indicator. */
export interface SheetHitCommentIndicator {
  readonly type: 'comment-indicator';
  readonly row: number;
  readonly col: number;
}

/** Hit on a table resize handle. */
export interface SheetHitTableResizeHandle {
  readonly type: 'table-resize-handle';
  readonly tableId: string;
}

/** Hit on a formula range drag handle. */
export interface SheetHitFormulaRangeHandle {
  readonly type: 'formula-range-handle';
  readonly rangeIndex: number;
  readonly handle: 'nw' | 'ne' | 'sw' | 'se';
}

/** Hit on canvas-rendered interactive elements (filter buttons, checkboxes, etc.). */
export interface SheetHitInteractiveElement {
  readonly type: 'interactive-element';
  readonly elementId: string;
  readonly elementType: string;
}

/** Hit on empty/background area. */
export interface SheetHitEmpty {
  readonly type: 'empty';
}

/**
 * Discriminated union covering every production hit-test branch.
 *
 * Consumers switch on `.type` to handle specific hit targets.
 * New variants may be added in future releases (treat the union
 * as open for forward compatibility via a default/else branch).
 */
export type SheetHitResult =
  | SheetHitCell
  | SheetHitMergedCellAnchor
  | SheetHitColumnHeader
  | SheetHitRowHeader
  | SheetHitColumnResizeHandle
  | SheetHitRowResizeHandle
  | SheetHitHiddenColumnBoundary
  | SheetHitHiddenRowBoundary
  | SheetHitFrozenPaneRegion
  | SheetHitSelectAll
  | SheetHitFillHandle
  | SheetHitSelectionAffordance
  | SheetHitFloatingObject
  | SheetHitOutlineLevelButton
  | SheetHitOutlineCollapseButton
  | SheetHitOutlineGutter
  | SheetHitCommentIndicator
  | SheetHitTableResizeHandle
  | SheetHitFormulaRangeHandle
  | SheetHitInteractiveElement
  | SheetHitEmpty;

// =============================================================================
// Render State (View-Only Visual DTO)
// =============================================================================

/**
 * Selection visual geometry for rendering.
 *
 * Contains only the fields the renderer needs to paint selection overlays.
 * Excludes app-level selection policy, XState state, and command semantics.
 */
export interface SelectionVisualState {
  /** Active ranges to highlight. */
  readonly ranges: readonly RangeAddress[];
  /** The active cell (cursor). */
  readonly activeCell?: CellAddress;
  /** Formula range highlights with colors. */
  readonly formulaRanges?: readonly {
    readonly range: RangeAddress;
    readonly color: string;
    readonly index: number;
  }[];
  /** Index of the active formula reference (-1 = none). */
  readonly activeReferenceIndex?: number;
  /** Fill preview range during fill handle drag. */
  readonly fillPreviewRange?: RangeAddress;
  /** Whether the selection has an error (renders red border). */
  readonly hasError?: boolean;
  /** Error type for styling. */
  readonly errorType?: 'merge_conflict' | 'protection' | 'array_formula' | 'invalid_range';
  /** Table preview range (dashed border for create-table dialog). */
  readonly tablePreviewRange?: RangeAddress | null;
  /** Paste preview data. */
  readonly pastePreview?: {
    readonly isActive: boolean;
    readonly targetRange: RangeAddress;
    readonly cells: readonly {
      readonly row: number;
      readonly col: number;
      readonly displayValue: string;
    }[];
  };
}

/**
 * Editor visual bounds for rendering the in-cell editor overlay.
 *
 * Contains only the visual geometry the renderer needs. Excludes
 * editor content, formula parsing state, and app editor policy.
 */
export interface EditorVisualState {
  /** Whether the editor is active. */
  readonly isEditing: boolean;
  /** The cell being edited. */
  readonly cell?: CellAddress;
  /** Editor display text (for rendering ghost/preview). */
  readonly displayText?: string;
}

/**
 * Clipboard visual state for rendering cut/copy indicators.
 */
export interface ClipboardVisualState {
  /** Whether a cut/copy indicator (marching ants) should render. */
  readonly isActive: boolean;
  /** The range being cut/copied. */
  readonly range?: RangeAddress;
  /** Whether this is a cut (vs copy). */
  readonly isCut?: boolean;
}

/**
 * Remote cursor state for collaborative rendering.
 */
export interface RemoteCursorVisual {
  readonly clientId: number;
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly color: string;
    readonly avatar?: string;
  };
  readonly selection: readonly RangeAddress[];
  readonly activeCell: CellAddress;
  readonly sheetId: string;
  readonly isEditing: boolean;
  readonly editingCell?: CellAddress;
}

/**
 * View options controlling grid visual rendering.
 */
export interface SheetViewOptions {
  readonly showGridlines?: boolean;
  readonly showRowHeaders?: boolean;
  readonly showColumnHeaders?: boolean;
  readonly showZeroValues?: boolean;
  readonly gridlineColor?: string;
  readonly rightToLeft?: boolean;
  readonly showCutCopyIndicator?: boolean;
  readonly allowDragFill?: boolean;
}

/**
 * Data-bearing floating object scene patch.
 *
 * This is an advanced object-scene route, not public visual render state.
 * Apps use it to push committed floating-object mutations into the renderer's
 * scene graph without leaking renderer-internal payloads through SheetRenderState.
 */
export interface SheetFloatingObjectScenePatch {
  readonly objectId: string;
  readonly kind: 'created' | 'updated' | 'remove';
  /** Full floating-object payload. Opaque at the SheetView boundary. */
  readonly data?: unknown;
  /** Pre-computed pixel bounds (when available). */
  readonly bounds?: SheetRect & { readonly rotation: number };
  /** Fields that changed (undefined = full invalidation). */
  readonly changedFields?: readonly string[];
}

export interface SheetSceneObjectBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * SheetView-owned read-only snapshot of an object currently present in the
 * renderer scene graph.
 */
export interface SheetSceneObjectSnapshot {
  readonly id: string;
  readonly type: string;
  readonly bounds: SheetSceneObjectBounds;
  readonly zIndex: number;
  readonly visible: boolean;
  readonly groupId: string | null;
  readonly rotation?: number;
  readonly locked?: boolean;
  readonly opacity?: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * Shimmer effect configuration for visual feedback on changed cells.
 */
export interface ShimmerConfig {
  readonly entries?: readonly {
    readonly range: RangeAddress;
    readonly startTime: number;
    readonly sheetId: string;
  }[];
  readonly effect?: 'fade' | 'pulse' | 'border-glow' | 'sweep';
  readonly durationMs?: number;
  readonly color?: string;
  readonly maxOpacity?: number;
  readonly enabled?: boolean;
}

/**
 * Chrome theme controlling canvas background, headers, selection, scrollbars.
 */
export interface SheetChromeTheme {
  readonly background?: string;
  readonly headerBackground?: string;
  readonly headerText?: string;
  readonly headerBorder?: string;
  readonly selectionBackground?: string;
  readonly selectionBorder?: string;
  readonly scrollbarThumb?: string;
  readonly scrollbarTrack?: string;
  readonly gridlineColor?: string;
}

/**
 * Page break visual state for page break preview mode.
 */
export interface PageBreakVisualState {
  readonly previewMode?: boolean;
  readonly pageBreaks?: {
    readonly rowBreaks: readonly {
      readonly id: number;
      readonly min: number;
      readonly max: number;
      readonly manual: boolean;
    }[];
    readonly colBreaks: readonly {
      readonly id: number;
      readonly min: number;
      readonly max: number;
      readonly manual: boolean;
    }[];
  };
  readonly autoPageBreaks?: {
    readonly rowBreaks: readonly {
      readonly id: number;
      readonly min: number;
      readonly max: number;
      readonly manual: boolean;
    }[];
    readonly colBreaks: readonly {
      readonly id: number;
      readonly min: number;
      readonly max: number;
      readonly manual: boolean;
    }[];
  };
  readonly printArea?: RangeAddress | null;
}

/**
 * The public render state DTO.
 *
 * This is a view-only visual projection. It contains ONLY fields the
 * renderer needs to paint the current frame. It must NOT contain:
 * - App machine state or XState snapshots
 * - Action-handler payloads or command semantics
 * - UI store state (toolbar, formula bar, panels)
 * - App editor policy or security decisions
 * - RenderContextConfig (the internal type it replaces)
 *
 * The capability implementation maps this to the internal
 * RenderContextConfig at the boundary.
 */
export interface SheetRenderState {
  /** Selection visual geometry. */
  readonly selection?: SelectionVisualState;
  /** Editor visual state. */
  readonly editor?: EditorVisualState;
  /** Clipboard visual state. */
  readonly clipboard?: ClipboardVisualState;
  /** Remote cursor visuals for collaboration. */
  readonly remoteCursors?: readonly RemoteCursorVisual[];
  /** View options (gridlines, headers, zero values, etc.). */
  readonly viewOptions?: SheetViewOptions;
  /** Chrome theme for canvas rendering. */
  readonly chromeTheme?: SheetChromeTheme;
  /** Shimmer visual feedback config. */
  readonly shimmer?: ShimmerConfig;
  /** Page break visual state. */
  readonly pageBreaks?: PageBreakVisualState;
  /** Preview font for selected cells. */
  readonly previewFont?: string | null;
  /** Search highlights. */
  readonly searchHighlights?: readonly {
    readonly row: number;
    readonly col: number;
    readonly isActive: boolean;
  }[];
  /** Blocked edit attempt for red flash feedback. */
  readonly blockedEditAttempt?: {
    readonly cellId: string;
    readonly timestamp: number;
  } | null;
  /** Validation circles visible. */
  readonly validationCirclesVisible?: boolean;
}

// =============================================================================
// SheetView Skin
// =============================================================================

/** Color input accepted by SheetView skin properties. */
export type SheetViewSkinColor =
  | string
  | {
      readonly kind: 'theme-token';
      readonly token: string;
      readonly fallback?: string;
    };

/** Reference to an image/texture used by a skin. */
export type SheetViewTextureAsset =
  | {
      readonly kind: 'url';
      readonly src: string;
      readonly crossOrigin?: 'anonymous' | 'use-credentials';
    }
  | {
      readonly kind: 'image-bitmap';
      readonly bitmap: ImageBitmap;
    }
  | {
      readonly kind: 'html-image';
      readonly image: HTMLImageElement;
    };

/** Public row geometry exposed to trusted skin render callbacks. */
export interface SheetViewSkinRowGeometry {
  readonly index: number;
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
}

/** Public column geometry exposed to trusted skin render callbacks. */
export interface SheetViewSkinColumnGeometry {
  readonly index: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

/** Public geometry helpers exposed to trusted skin render callbacks. */
export interface SheetViewSkinGeometry {
  visibleRows(): Iterable<SheetViewSkinRowGeometry>;
  visibleColumns(): Iterable<SheetViewSkinColumnGeometry>;
  getCellRect(row: number, col: number): SheetRect | null;
  getRangeRects(range: RangeAddress): readonly SheetRect[];
}

/** Frame passed to trusted imperative skin renderers. */
export interface SheetViewCustomRenderFrame {
  readonly ctx: CanvasRenderingContext2D;
  readonly dpr: number;
  readonly now: number;
  readonly viewport: SheetRect;
  readonly visibleRange: RangeAddress;
  readonly zoom: number;
  readonly geometry: SheetViewSkinGeometry;
  invalidate(): void;
}

/** Trusted imperative renderer for a skin segment. */
export type SheetViewCustomRenderer = (frame: SheetViewCustomRenderFrame) => void;

/** Background treatment for the sheet viewport. */
export type SheetViewBackgroundSkin =
  | { readonly kind: 'default' }
  | { readonly kind: 'transparent' }
  | { readonly kind: 'color'; readonly color: SheetViewSkinColor; readonly opacity?: number }
  | {
      readonly kind: 'image-pattern';
      readonly asset: SheetViewTextureAsset;
      readonly opacity?: number;
      readonly scale?: number;
      readonly repeat?: 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat';
    }
  | { readonly kind: 'custom'; readonly render: SheetViewCustomRenderer };

/** Deterministic decorative jitter for styled gridlines. */
export interface SheetViewGridlineJitter {
  readonly amplitudePx: number;
  readonly seed?: string;
}

/** Gridline treatment for the sheet viewport. */
export type SheetViewGridlineSkin =
  | { readonly kind: 'default' }
  | { readonly kind: 'hidden' }
  | {
      readonly kind: 'styled';
      readonly color?: SheetViewSkinColor;
      readonly width?: number;
      readonly opacity?: number;
      readonly dash?: readonly number[];
      readonly lineCap?: CanvasLineCap;
      readonly style?: 'solid' | 'dashed' | 'dotted' | 'double';
      readonly majorEveryRows?: number;
      readonly majorEveryCols?: number;
      readonly majorColor?: SheetViewSkinColor;
      readonly majorWidth?: number;
      readonly jitter?: SheetViewGridlineJitter;
    }
  | { readonly kind: 'custom'; readonly render: SheetViewCustomRenderer };

/** Header treatment for row/column headers. */
export interface SheetViewHeaderSkin {
  readonly background?: SheetViewSkinColor;
  readonly textColor?: SheetViewSkinColor;
  readonly borderColor?: SheetViewSkinColor;
  readonly selectedBackground?: SheetViewSkinColor;
  readonly selectedTextColor?: SheetViewSkinColor;
  readonly fontFamily?: string;
  readonly fontSizePx?: number;
  readonly fontWeight?: string | number;
  readonly render?: SheetViewCustomRenderer;
}

/** Selection glow treatment. */
export interface SheetViewSelectionGlowSkin {
  readonly color: SheetViewSkinColor;
  readonly blurPx: number;
  readonly opacity?: number;
}

/** Fill handle treatment. */
export interface SheetViewSelectionHandleSkin {
  readonly color?: SheetViewSkinColor;
  readonly borderColor?: SheetViewSkinColor;
  readonly shape?: 'square' | 'circle' | 'diamond';
  readonly sizePx?: number;
}

/** Selection and active-cell treatment. */
export interface SheetViewSelectionSkin {
  readonly fill?: SheetViewSkinColor;
  readonly border?: SheetViewSkinColor;
  readonly activeBorder?: SheetViewSkinColor;
  readonly borderWidth?: number;
  readonly glow?: SheetViewSelectionGlowSkin;
  readonly handle?: SheetViewSelectionHandleSkin;
}

/** Built-in viewport scrollbar treatment. */
export interface SheetViewScrollbarSkin {
  readonly thumb?: SheetViewSkinColor;
  readonly track?: SheetViewSkinColor;
  readonly hoverThumb?: SheetViewSkinColor;
  readonly activeThumb?: SheetViewSkinColor;
  readonly widthPx?: number;
}

export interface SheetViewFormulaReferenceSkin {
  readonly stroke?: SheetViewSkinColor;
  readonly fill?: SheetViewSkinColor;
}

export interface SheetViewControlIndicatorSkin {
  readonly commentIndicator?: SheetViewSkinColor;
  readonly validationDropdown?: SheetViewSkinColor;
  readonly validationError?: SheetViewSkinColor;
  readonly filterIcon?: SheetViewSkinColor;
  readonly filterActiveIcon?: SheetViewSkinColor;
  readonly checkboxBorder?: SheetViewSkinColor;
  readonly checkboxCheck?: SheetViewSkinColor;
  readonly checkboxBackground?: SheetViewSkinColor;
  readonly autofillHandle?: SheetViewSkinColor;
  readonly frozenPaneDivider?: SheetViewSkinColor;
  readonly hiddenIndicator?: SheetViewSkinColor;
}

export interface SheetViewOverlaySkin {
  readonly pastePreviewFill?: SheetViewSkinColor;
  readonly pastePreviewBorder?: SheetViewSkinColor;
  readonly searchHighlightFill?: SheetViewSkinColor;
  readonly searchHighlightBorder?: SheetViewSkinColor;
  readonly dragGhostFill?: SheetViewSkinColor;
  readonly dragGhostBorder?: SheetViewSkinColor;
  readonly errorFill?: SheetViewSkinColor;
  readonly errorBorder?: SheetViewSkinColor;
}

/** Additional named assets a host can associate with a skin. */
export interface SheetViewSkinAssets {
  readonly textures?: Readonly<Record<string, SheetViewTextureAsset>>;
}

/** Validation issue for public skin objects. */
export interface SheetViewSkinValidationError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/**
 * Non-persistent visual skin for SheetView.
 *
 * SheetView skins affect view chrome and renderer policy only. They do not
 * mutate workbook theme, cell formats, import/export output, collaboration
 * state, or authorization behavior.
 */
export interface SheetViewSkin {
  readonly id?: string;
  readonly colorScheme?: 'light' | 'dark';
  readonly background?: SheetViewBackgroundSkin;
  readonly defaultCellBackground?: SheetViewSkinColor;
  readonly defaultCellText?: SheetViewSkinColor;
  readonly mutedCellText?: SheetViewSkinColor;
  readonly gridlines?: SheetViewGridlineSkin;
  readonly headers?: SheetViewHeaderSkin;
  readonly selection?: SheetViewSelectionSkin;
  readonly scrollbars?: SheetViewScrollbarSkin;
  readonly formulaRefColors?: readonly SheetViewFormulaReferenceSkin[];
  readonly controls?: SheetViewControlIndicatorSkin;
  readonly overlays?: SheetViewOverlaySkin;
  readonly assets?: SheetViewSkinAssets;
}

/** Read model returned by the skin capability. */
export interface SheetViewResolvedSkin {
  readonly skin: SheetViewSkin | null;
  readonly status: 'idle' | 'ready' | 'loading' | 'error';
  readonly validationErrors: readonly SheetViewSkinValidationError[];
}

/** Skin lifecycle event emitted by the skin capability. */
export type SheetViewSkinEvent =
  | { readonly type: 'change'; readonly skin: SheetViewSkin | null }
  | { readonly type: 'asset-load'; readonly assetId: string }
  | { readonly type: 'asset-error'; readonly assetId: string; readonly error: unknown }
  | { readonly type: 'error'; readonly error: SheetViewSkinValidationError };

// =============================================================================
// Viewport
// =============================================================================

/** Scroll position for a viewport. */
export interface ScrollPosition {
  readonly x: number;
  readonly y: number;
}

/** Maximum scroll extents for the current sheet. */
export interface ScrollBounds {
  readonly maxScrollX: number;
  readonly maxScrollY: number;
}

/** Pixel dimensions for viewport chrome read models. */
export interface SheetViewportSize {
  readonly width: number;
  readonly height: number;
}

/** Whether row and column headers are currently visible. */
export interface HeaderVisibility {
  readonly rowHeaders: boolean;
  readonly colHeaders: boolean;
}

/** Pixel dimensions of the outline (grouping) gutter areas. */
export interface OutlineGutter {
  readonly rowGutterWidth: number;
  readonly colGutterHeight: number;
}

/**
 * Read-only position dimensions for scroll snapping.
 *
 * Provides the minimum interface needed by scroll physics
 * to find the nearest cell-aligned scroll position. The host's
 * InputCoordinator passes this to ScrollPhysics.snapToCell().
 */
export interface PositionDimensions {
  readonly totalRows: number;
  readonly totalCols: number;
  getRowTop(row: number): number;
  getRowHeight(row: number): number;
  getColLeft(col: number): number;
  getColWidth(col: number): number;
}

/**
 * Split view configuration.
 */
export interface SplitConfig {
  readonly direction: 'horizontal' | 'vertical' | 'both';
  /** Row index for horizontal split line. */
  readonly horizontalPosition: number;
  /** Column index for vertical split line. */
  readonly verticalPosition: number;
}

/**
 * A snapshot of the current viewport state.
 *
 * This is an owned public type — it does NOT expose ViewportLayout,
 * PersistedViewportConfig, or OverlayViewportConfig from contracts.
 */
export interface SheetViewportSnapshot {
  /** Per-viewport scroll positions (keyed by viewport ID). */
  readonly scrollPositions: ReadonlyMap<string, ScrollPosition>;
  /** The visible cell range in the main viewport. */
  readonly visibleRange: RangeAddress;
  /** Current frozen pane configuration. */
  readonly frozenPanes: FrozenPanesConfig;
  /** Current split configuration (null if not split). */
  readonly splitConfig: SplitConfig | null;
  /** The active sheet ID. */
  readonly sheetId: string;
  /** Current zoom level (1.0 = 100%). */
  readonly zoom: number;
}

/**
 * Chrome-ready viewport state for built-in or host-owned viewport controls.
 *
 * This read model is owned by SheetView and intentionally avoids exposing the
 * renderer's internal ViewportLayout shape.
 */
export interface SheetViewportState {
  /** Active sheet ID. */
  readonly sheetId: string;
  /** Main viewport scroll position in pixels. */
  readonly scrollPosition: ScrollPosition;
  /** Maximum main viewport scroll position in pixels. */
  readonly maxScroll: ScrollPosition;
  /** Render viewport pixel size after built-in chrome insets. */
  readonly viewportSize: SheetViewportSize;
  /** Scrollable content pixel size, derived from max scroll + viewport size. */
  readonly contentSize: SheetViewportSize;
  /** Visible cell range in the main viewport. */
  readonly visibleRange: RangeAddress;
  /** Current zoom level (1.0 = 100%). */
  readonly zoom: number;
  /** Current frozen pane configuration. */
  readonly frozenPanes: FrozenPanesConfig;
  /** Current split configuration (null if not split). */
  readonly splitConfig: SplitConfig | null;
}

// =============================================================================
// Object Scene
// =============================================================================

/** Pixel bounds for a floating object (document-space). */
export interface ObjectBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

/** Floating object scene information. */
export interface ObjectSceneInfo {
  readonly objectId: string;
  readonly bounds: ObjectBounds;
  readonly isGroup: boolean;
}

// =============================================================================
// Interactive Elements
// =============================================================================

/** Type of canvas-rendered interactive element. */
export type InteractiveElementType =
  | 'filter-button'
  | 'checkbox'
  | 'comment-indicator'
  | 'validation-dropdown'
  | 'sparkline-edit'
  | 'hyperlink';

/** Bounds of an interactive element in viewport coordinates. */
export interface InteractiveElementBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Metadata for filter button elements. */
export interface FilterButtonElementMetadata {
  readonly type: 'filter-button';
  readonly filterId: string;
  readonly headerCellId: string;
  readonly hasActiveFilter: boolean;
  readonly col: number;
}

/** Metadata for checkbox elements. */
export interface CheckboxElementMetadata {
  readonly type: 'checkbox';
  readonly cellId: string;
  readonly sheetId: string;
  readonly checked: boolean;
  readonly row: number;
  readonly col: number;
}

/** Metadata for comment indicator elements. */
export interface CommentIndicatorElementMetadata {
  readonly type: 'comment-indicator';
  readonly cellId: string;
  readonly sheetId: string;
  readonly row: number;
  readonly col: number;
}

/** Metadata for validation dropdown elements. */
export interface ValidationDropdownElementMetadata {
  readonly type: 'validation-dropdown';
  readonly cellId: string;
  readonly sheetId: string;
  readonly row: number;
  readonly col: number;
  readonly options: readonly string[];
}

/**
 * A snapshot of a single interactive element.
 *
 * Discriminated union on `type` — TypeScript narrows `metadata` when
 * you switch on `element.type`.
 */
export type InteractiveElementInfo =
  | {
      readonly id: string;
      readonly type: 'filter-button';
      readonly bounds: InteractiveElementBounds;
      readonly metadata: FilterButtonElementMetadata;
    }
  | {
      readonly id: string;
      readonly type: 'checkbox';
      readonly bounds: InteractiveElementBounds;
      readonly metadata: CheckboxElementMetadata;
    }
  | {
      readonly id: string;
      readonly type: 'comment-indicator';
      readonly bounds: InteractiveElementBounds;
      readonly metadata: CommentIndicatorElementMetadata;
    }
  | {
      readonly id: string;
      readonly type: 'validation-dropdown';
      readonly bounds: InteractiveElementBounds;
      readonly metadata: ValidationDropdownElementMetadata;
    }
  | {
      readonly id: string;
      readonly type: Exclude<
        InteractiveElementType,
        'filter-button' | 'checkbox' | 'comment-indicator' | 'validation-dropdown'
      >;
      readonly bounds: InteractiveElementBounds;
      readonly metadata: Record<string, unknown>;
    };

/** Snapshot of all interactive elements visible in the current frame. */
export interface InteractiveElementSnapshot {
  readonly elements: readonly InteractiveElementInfo[];
}

// =============================================================================
// Events
// =============================================================================

/** Cell pointer intent emitted from real browser input. */
export interface SheetEventCellPointerIntent {
  readonly type: 'cell-pointer-intent';
  readonly cell: CellAddress;
  readonly pointerType: 'click' | 'dblclick' | 'contextmenu' | 'hover';
  /** Viewport-space coordinates of the pointer. */
  readonly viewportPoint: SheetPoint;
}

/** Visible range changed (due to scroll, resize, or zoom). */
export interface SheetEventVisibleRangeChange {
  readonly type: 'visible-range-change';
  readonly visibleRange: RangeAddress;
}

/** Geometry changed (row/col resize, hidden state change). */
export interface SheetEventGeometryChange {
  readonly type: 'geometry-change';
}

/** Scroll position changed. */
export interface SheetEventScrollChange {
  readonly type: 'scroll-change';
  readonly position: ScrollPosition;
  readonly viewportId: string;
}

/** Scroll position was reset by a SheetView-owned command such as scrollTo. */
export interface SheetEventScrollPositionReset {
  readonly type: 'scroll-position-reset';
  readonly position: ScrollPosition;
}

/** Zoom level changed. */
export interface SheetEventZoomChange {
  readonly type: 'zoom-change';
  readonly zoom: number;
}

/** View received focus. */
export interface SheetEventFocusEnter {
  readonly type: 'focus-enter';
}

/** View lost focus. */
export interface SheetEventFocusLeave {
  readonly type: 'focus-leave';
}

/** Host-directed edit start request (intent, not app state). */
export interface SheetEventEditStartRequest {
  readonly type: 'edit-start-request';
  readonly cell: CellAddress;
  readonly trigger: 'dblclick' | 'key' | 'api';
}

/** Host-directed edit commit request. */
export interface SheetEventEditCommitRequest {
  readonly type: 'edit-commit-request';
}

/** Host-directed edit cancel request. */
export interface SheetEventEditCancelRequest {
  readonly type: 'edit-cancel-request';
}

/** Selection visual changed (overlay repaint). */
export interface SheetEventSelectionVisualChange {
  readonly type: 'selection-visual-change';
}

/**
 * Discriminated union of all view-owned events.
 *
 * These are facts and intents emitted by the view substrate. They do
 * not carry app policy, XState state, or command semantics.
 */
export type SheetViewEvent =
  | SheetEventCellPointerIntent
  | SheetEventVisibleRangeChange
  | SheetEventGeometryChange
  | SheetEventScrollChange
  | SheetEventScrollPositionReset
  | SheetEventZoomChange
  | SheetEventFocusEnter
  | SheetEventFocusLeave
  | SheetEventEditStartRequest
  | SheetEventEditCommitRequest
  | SheetEventEditCancelRequest
  | SheetEventSelectionVisualChange;

// =============================================================================
// Commands
// =============================================================================

/** Scroll to a specific cell. */
export interface SheetCommandScrollToCell {
  readonly type: 'scroll-to-cell';
  readonly cell: CellAddress;
}

/** Set zoom level. */
export interface SheetCommandSetZoom {
  readonly type: 'set-zoom';
  readonly zoom: number;
}

/** Set frozen panes. */
export interface SheetCommandSetFrozenPanes {
  readonly type: 'set-frozen-panes';
  readonly rows: number;
  readonly cols: number;
}

/** Switch active sheet. */
export interface SheetCommandSwitchSheet {
  readonly type: 'switch-sheet';
  readonly sheetId: string;
}

/** Invalidate all rendering. */
export interface SheetCommandInvalidateAll {
  readonly type: 'invalidate-all';
}

/**
 * Discriminated union for view-level commands.
 *
 * Commands are requests from the host to the view. They express
 * view-level intent, not app policy or data mutations.
 */
export type SheetViewCommand =
  | SheetCommandScrollToCell
  | SheetCommandSetZoom
  | SheetCommandSetFrozenPanes
  | SheetCommandSwitchSheet
  | SheetCommandInvalidateAll;

// =============================================================================
// Invalidation
// =============================================================================

/** Reason for a render invalidation request. */
export type InvalidationReason =
  | 'data-change'
  | 'geometry-change'
  | 'selection-change'
  | 'theme-change'
  | 'full'
  | 'object-change'
  | 'scroll'
  | 'resize';

/** Target cells for invalidation. */
export interface CellInvalidationTarget {
  readonly cells: readonly CellAddress[];
}

/** Target range for invalidation. */
export interface RangeInvalidationTarget {
  readonly range: RangeAddress;
}

/** Invalidation target — either specific cells or a range. */
export type InvalidationTarget = CellInvalidationTarget | RangeInvalidationTarget;

// =============================================================================
// Disposable (owned convenience type)
// =============================================================================

/**
 * A subscription handle that can be disposed to unsubscribe.
 *
 * This is intentionally a minimal owned type so public consumers
 * do not need to import from @mog/types-core or contracts.
 * The implementation may return handles that also implement
 * Symbol.dispose for TC39 Explicit Resource Management.
 */
export interface SheetDisposable {
  dispose(): void;
}

// =============================================================================
// Attachment and renderer data-source boundary
// =============================================================================

/**
 * SheetView-owned attachment boundary.
 *
 * The public package intentionally does not expose the canonical Workbook type
 * because that type currently belongs to a workspace-internal contract package.
 * App/embed adapters wrap their workbook in this narrow source object; SheetView
 * unwraps the private implementation value internally.
 */
export interface SheetViewDataSource {
  readonly initialSheetId: string;
  readonly workbook: unknown;
}

/**
 * Minimal workbook-shaped host object needed to bind SheetView.
 *
 * The canonical Workbook type is owned by @mog-sdk/kernel. SheetView deliberately
 * does not re-export it, but it does own this adapter boundary so consumers do
 * not hand-roll data-source objects or casts.
 */
export interface SheetViewWorkbookSource {
  readonly activeSheet?: {
    readonly sheetId?: unknown;
  };
}

/**
 * Public callback bag for non-viewport renderer data sources.
 *
 * Individual callback DTOs will be tightened as each renderer data path moves
 * to a named sheet-view-owned contract. The important boundary is that callers
 * no longer push this through a raw RenderContextConfig pipe.
 */
export type SheetViewDataSources = Record<string, unknown>;

export type SheetViewDataSourceKey = string;

export type SheetViewportConfig = { readonly type: string; readonly [key: string]: unknown };
export type SheetOverlayViewportConfig = { readonly id: string; readonly [key: string]: unknown };
export type SheetViewportLayout = unknown;

/**
 * SheetView-owned culture DTO. It is deliberately open because custom cultures
 * are renderer data, not a public dependency on @mog/culture types.
 */
export interface SheetCultureInfo {
  readonly name?: string;
  readonly tag?: string;
  readonly [key: string]: unknown;
}

// =============================================================================
// SheetViewMountOptions — public capability facade
// =============================================================================

/**
 * Mount options for createSheetView.
 */
export interface SheetViewMountOptions {
  /** The DOM element that SheetView will mount its canvas stack inside. */
  container: HTMLElement;
  /** Show row + column headers. Default: true. */
  showHeaders?: boolean;
  /** Show gridlines. Default: true. */
  showGridlines?: boolean;
  /**
   * If true, SheetView manages its own scroll via wheel handler.
   * If false, the host drives scroll via viewport.setScrollPosition().
   * Default: true.
   */
  scrollable?: boolean;
  /**
   * Optional built-in viewport chrome. Disabled by default.
   */
  viewportChrome?: {
    readonly scrollbars?: boolean;
    readonly zoomControls?: boolean;
  };
  /** Host-owned chrome inset that should be excluded from the renderer viewport. */
  viewportInset?: SheetViewViewportInset | (() => SheetViewViewportInset);
  /** Initial non-persistent visual skin. */
  skin?: SheetViewSkin | null;
  /** Override device pixel ratio. Default: window.devicePixelRatio. */
  dpr?: number;
}

export interface SheetViewViewportInset {
  readonly right?: number;
  readonly bottom?: number;
}

/**
 * Inclusive visible cell range, used by SheetViewHandle.getVisibleBounds().
 */
export interface SheetViewVisibleBounds {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}
