/**
 * Render Context Configuration Types
 *
 * Configuration interfaces for creating render contexts.
 * These types are shared between canvas and state subsystems.
 *
 * @module @mog-sdk/contracts/rendering/render-context
 */

import type { FloatingObjectOperation } from '@mog/types-machines/actors/object-interaction';
import type { BinaryCellReader } from '@mog/types-viewport/viewport/reader';
import type { CellFormat, CellRange } from '@mog/types-core';
import type { CultureInfo } from '@mog/types-culture/types';
import type { FilterHeaderInfo } from '@mog/types-data/data/filter';
import type {
  GroupDefinition,
  OutlineLevel,
  SheetGroupingConfig,
} from '@mog/types-data/data/grouping';
import type { SparklineRenderData } from '@mog/types-data/data/sparklines';
import type { TableConfig } from '@mog/types-data/data/tables';
import type { TraceArrow } from '@mog/types-data/data/trace-arrows';
import type { SearchHighlight } from '@mog-sdk/types-document/document/search';
import type { ThemeDefinition } from '@mog/types-formatting/formatting/theme';
import type {
  ClipboardSnapshot,
  EditorSnapshot,
  SelectionSnapshot,
} from '@mog/types-machines/machines/snapshots';
import type {
  FloatingObject,
  ObjectHitRegion,
  ObjectInteractionState,
} from '@mog/types-objects/objects/floating-objects';
import type { CoordinateSystem } from './coordinates';
import type { ChromeTheme } from '@mog/types-viewport/rendering/data-source-types';
import type { ResolvedSheetViewSkin } from './sheet-view-skin';
import type { ObjectBounds, PreviewCellData, RemoteCursor } from './hit-test';
import type { ShimmerEffectType, ShimmerEntry } from './visual-feedback';
import type { InteractiveElementCollector } from './interactive-elements';
import type { CellCoord } from '@mog/types-viewport/rendering/primitives';

// =============================================================================
// Selection Render State
// =============================================================================

/**
 * Selection error type for rendering red border.
 * Selection error display
 */
export type SelectionErrorType =
  | 'merge_conflict'
  | 'protection'
  | 'array_formula'
  | 'invalid_range';

/**
 * Extended selection state for rendering.
 * Includes visual state like formula range highlights and fill previews.
 */
export interface SelectionRenderState extends SelectionSnapshot {
  /** Formula range highlights with colors */
  formulaRanges?: Array<{
    range: CellRange;
    color: string;
    /** Index of this reference in the formula (for identification) */
    index: number;
  }>;

  /**
   * Index of the active formula reference (cursor is in this reference).
   * Used for C.2: Highlighting the range box when cursor is on a reference.
   * -1 means no reference is active (cursor not in any reference).
   */
  activeReferenceIndex?: number;

  /** Fill preview range during fill handle drag */
  fillPreviewRange?: CellRange;

  /**
   * Paste preview data.
   * When active, displays semi-transparent preview of what paste would look like.
   */
  pastePreview?: {
    /** Whether preview is active */
    isActive: boolean;
    /** Target range for the preview */
    targetRange: CellRange;
    /** Preview cells to render */
    cells: PreviewCellData[];
  };

  /**
   * Flash Fill preview data.
   * When active, displays ghosted preview of detected pattern fill values.
   */
  flashFillPreview?: {
    /** Whether preview is active */
    isActive: boolean;
    /** Preview values to render */
    values: Array<{ row: number; col: number; value: unknown }>;
    /** Pattern description (for tooltip) */
    patternDescription: string | null;
  };

  /**
   * Selection error state for rendering red border.
   * Selection error display
   *
   * When set, the selection border is rendered in red to indicate
   * an invalid operation (e.g., trying to paste into merged cells,
   * editing protected cells, etc.).
   */
  hasError?: boolean;

  /**
   * Selection error type (for potential different error styling).
   * Selection error display
   */
  errorType?: SelectionErrorType;

  /**
   * Table preview range for Create Table dialog.
   * Range preview in Create Table dialog
   *
   * When set, renders a dashed border preview showing where the
   * table will be created while the dialog is open.
   */
  tablePreviewRange?: CellRange | null;
}

// =============================================================================
// Floating Object Render State
// =============================================================================

/**
 * Floating object interaction state for rendering.
 * Tracks selected objects, operation state, and active handles.
 */
export interface FloatingObjectRenderState {
  /** Currently selected object IDs */
  selectedIds: string[];
  /** Current interaction state (idle, selected, operating, editingText) */
  interactionState: ObjectInteractionState;
  /** Active resize/rotation handle (if any) */
  activeHandle: ObjectHitRegion | null;
  /** Whether shift key is held (for constrained resize) */
  shiftKey: boolean;
  /** Current unified operation (null when not operating) */
  operation: FloatingObjectOperation | null;
  /** Insertion preview bounds during drag-to-insert (null when not inserting) */
  insertionPreview?: { x: number; y: number; width: number; height: number } | null;
}

// =============================================================================
// Page Break Types (15-PRINT-EXPORT: Page Break Drag Preview)
// =============================================================================
// SINGLE SOURCE OF TRUTH: These types are imported by:
// - state-machines/src/page-break-machine.ts
// - canvas-renderer/src/layers/page-break-layer.ts
// - engine/src/state/coordinator/features/page-break/
// =============================================================================

/**
 * Page break primitives — canonical home promoted to
 * @mog/types-viewport/rendering/bounds during extraction so both machines
 * (Tier 2) and rendering (Tier 2) can consume them without forming a
 * cycle. Re-exported here for back-compat.
 */
export type {
  PageBreakInfo,
  PageBreakOrientation,
  PageBreakType,
} from '@mog/types-viewport/rendering/bounds';
import type { PageBreakInfo } from '@mog/types-viewport/rendering/bounds';

/**
 * Page break drag state for rendering drag preview.
 * Follows the same pattern as FloatingObjectRenderState.
 *
 * @see FloatingObjectRenderState for the reference pattern
 */
export interface PageBreakDragState {
  /** Whether a page break is currently being dragged */
  isDragging: boolean;
  /** Information about the page break being dragged (null when idle) */
  pageBreak: PageBreakInfo | null;
  /** Target position where the break would move to (row/col index) */
  targetPosition: number | null;
}

// =============================================================================
// Floating Object Patch (Incremental Scene Graph)
// =============================================================================

/**
 * Targeted floating object change for incremental scene graph maintenance.
 * 'created' = new object; 'updated' = existing object changed; 'remove' = deleted.
 */
export interface FloatingObjectPatch {
  objectId: string;
  kind: 'created' | 'updated' | 'remove';
  /** For created/updated, the full object data. Enables push-based rendering without
   *  reading from a potentially stale store closure. */
  data?: FloatingObject;
  /** Pre-computed pixel bounds from Rust (position + size + rotation).
   *  When present, the renderer can skip expensive position resolution. */
  bounds?: { x: number; y: number; width: number; height: number; rotation: number };
  /** Fields that changed on this object. When present, the renderer can skip
   *  geometry rebuild for visual-only changes. Undefined means "full invalidation". */
  changedFields?: string[];
}

// =============================================================================
// Render Context Config
// =============================================================================

/**
 * Configuration for creating a render context.
 * This is the input to the render context builder.
 */
export interface RenderContextConfig {
  coords: CoordinateSystem;
  currentSheetId: string;
  totalRows: number;
  totalCols: number;
  selection: SelectionRenderState;
  editor: EditorSnapshot;
  clipboard: ClipboardSnapshot;
  remoteCursors: RemoteCursor[];

  // ===========================================================================
  // Font preview
  // ===========================================================================

  /**
   * Preview font that is temporarily applied to selected cells on hover.
   * When set, cells in the selection should render with this font instead of their actual font.
   * When null, cells render with their actual font.
   *
   */
  previewFont?: string | null;

  // ===========================================================================
  // Formula Auditing (Stream B2)
  // ===========================================================================

  /** Trace arrows for the current sheet (optional, defaults to []) */
  traceArrows?: TraceArrow[];

  /** Lookup CellId to position (optional, defaults to () => null) */
  getCellPosition?: (cellId: string) => { row: number; col: number; sheet: string } | null;

  // ===========================================================================
  // Find & Replace
  // ===========================================================================

  /**
   * Search highlights for the current sheet.
   * CellId → position resolution done in SpreadsheetGrid.tsx.
   * Optional, defaults to empty array.
   */
  searchHighlights?: SearchHighlight[];

  // ===========================================================================
  // Workbook Theme (Issue 4: Page Layout - Themes)
  // ===========================================================================

  /**
   * Active theme for resolving theme color references.
   * Defaults to Office theme if not provided.
   */
  theme?: ThemeDefinition;

  /**
   * Active culture for locale-aware formatting.
   * Defaults to en-US if not provided.
   * Stream G: Culture & Localization
   */
  culture?: CultureInfo;

  /**
   * Get cell value - receives sheetId at call time from RenderContext.currentSheetId.
   * This eliminates stale closure bugs when sheets switch.
   */
  getCellValue: (sheetId: string, cell: CellCoord) => unknown;
  /**
   * Get cell format - receives sheetId at call time from RenderContext.currentSheetId.
   * This eliminates stale closure bugs when sheets switch.
   */
  getCellFormat: (sheetId: string, cell: CellCoord) => CellFormat | undefined;
  /**
   * Set of cells with dropdown indicators (optional, defaults to empty).
   * Engine defines DropdownCellSet = Set<string> in validation-renderer.ts.
   */
  dropdownCells?: Set<string>;
  /** Get cell binding status (optional, defaults to undefined) */
  getCellBindingStatus?: (
    sheetId: string,
    cell: CellCoord,
  ) => { connectionId: string; staleness: 'fresh' | 'stale' | 'error' } | undefined;
  /** Check if cell has validation errors (optional, defaults to false) */
  hasValidationErrors?: (sheetId: string, cell: CellCoord) => boolean;
  /** Get table at cell (optional, defaults to undefined) */
  getTableAtCell?: (sheetId: string, cell: CellCoord) => TableConfig | undefined;
  /**
   * Get resolved table range (handles Cell Identity Model).
   * table.range is deprecated; use this to get current positions.
   */
  getResolvedTableRange?: (table: TableConfig) => CellRange | null;
  /** Get all tables in the current sheet (optional, defaults to empty array) - Track 10.4 */
  getTablesInSheet?: () => TableConfig[];
  /** Get filter header info for AutoFilter cells (optional, defaults to undefined) */
  getFilterHeaderInfo?: (sheetId: string, cell: CellCoord) => FilterHeaderInfo | undefined;
  /** Check if a table column has an active filter (optional, defaults to false) */
  hasTableColumnFilter?: (
    sheetId: string,
    tableId: string,
    headerRow: number,
    headerCol: number,
  ) => boolean;
  /** Get sparkline render data at cell (optional, defaults to undefined) */
  getSparklineRenderData?: (sheetId: string, cell: CellCoord) => SparklineRenderData | undefined;

  // ===========================================================================
  // Binary Viewport Buffer (Viewport Binary Transfer Protocol)
  // ===========================================================================

  /**
   * Optional binary cell reader for the canvas cells layer hot path.
   * When set, flag-based booleans and display text are read from the binary
   * viewport buffer via a flyweight accessor instead of individual CellDataSource
   * calls. Set to null/undefined to disable and fall back to CellDataSource.
   *
   * Duck-typed to avoid a hard dependency from contracts → kernel.
   */
  binaryCellReader?: BinaryCellReader | null;

  /**
   * Per-viewport binary cell reader resolver.
   * When set, resolves a binary cell reader for each viewport region.
   * Takes precedence over the single `binaryCellReader` when the render region
   * has a `viewportId` in its metadata.
   */
  binaryCellReaderForViewport?: ((viewportId: string) => BinaryCellReader | undefined) | null;

  // ===========================================================================
  // Grouping/Outline (Stream O: Row/Column Grouping)
  // ===========================================================================

  /** Get grouping configuration for the current sheet (optional, defaults to null) */
  getGroupingConfig?: () => SheetGroupingConfig | null;
  /** Get row groups for the current sheet (optional, defaults to empty array) */
  getRowGroups?: () => GroupDefinition[];
  /** Get column groups for the current sheet (optional, defaults to empty array) */
  getColumnGroups?: () => GroupDefinition[];
  /** Get row outline levels for rendering (optional, defaults to empty array) */
  getRowOutlineLevels?: (startRow: number, endRow: number) => OutlineLevel[];
  /** Get column outline levels for rendering (optional, defaults to empty array) */
  getColumnOutlineLevels?: (startCol: number, endCol: number) => OutlineLevel[];
  /** Maximum row outline level (optional, defaults to 0) */
  maxRowOutlineLevel?: number;
  /** Maximum column outline level (optional, defaults to 0) */
  maxColOutlineLevel?: number;

  // ===========================================================================
  // Floating Objects
  // ===========================================================================

  /** Floating object interaction state (optional, defaults to idle) */
  floatingObjectState?: FloatingObjectRenderState;
  /** Get floating objects visible in viewport (optional, defaults to empty array) */
  getFloatingObjects?: () => FloatingObject[];
  /**
   * Get computed bounds for a floating object (optional, defaults to null).
   *
   * @deprecated Legacy fallback — the render pipeline now receives pre-computed bounds
   * from Rust via FloatingObjectPatch.bounds (for mutations) and getAllObjectBounds()
   * (for sheet switch / full rebuild). This callback is retained only as a last-resort
   * fallback for edge cases where bounds are not yet available in the patch or batch API.
   * Prefer supplying bounds through FloatingObjectPatch.bounds or getAllObjectBounds().
   */
  getFloatingObjectBounds?: (
    objectId: string,
  ) => Promise<ObjectBounds | null> | ObjectBounds | null;
  /** Batch-fetch bounds for all objects on the current sheet (single IPC call). */
  getAllObjectBounds?: () => Promise<Map<string, ObjectBounds>> | Map<string, ObjectBounds>;
  /**
   * Incremental floating object changes. When present, the renderer applies
   * targeted add/update/remove operations to the scene graph instead of
   * rebuilding from scratch.
   */
  floatingObjectPatches?: FloatingObjectPatch[];

  // ===========================================================================
  // Charts
  // ===========================================================================

  /** Get charts visible in the current viewport (optional, defaults to empty array) */
  getChartsInViewport?: () => Array<{
    id: string;
    type: string;
    [key: string]: unknown;
  }>;

  /** Get resolved chart position from CellId-based anchor (optional, defaults to null) */
  getChartPosition?: (
    sheetId: string,
    chart: { id: string; [key: string]: unknown },
  ) => { anchorRow: number; anchorCol: number; width: number; height: number } | null;

  /** Render a chart to canvas via ChartBridge (optional) */
  renderChart?: (
    chartId: string,
    ctx: CanvasRenderingContext2D,
    bounds: { x: number; y: number; width: number; height: number },
  ) => void;

  // ===========================================================================
  // View Options (optional, all default to true)
  // ===========================================================================

  /** Whether to show grid lines (default: true) */
  showGridlines?: boolean;

  /** Whether to show row headers (1, 2, 3...) (default: true) */
  showRowHeaders?: boolean;

  /** Whether to show column headers (A, B, C...) (default: true) */
  showColumnHeaders?: boolean;

  // ===========================================================================
  // Sheet Settings
  // ===========================================================================

  /** Gridline color (default: '#e2e2e2') */
  gridlineColor?: string;

  /** Whether to show zero values or display blank (default: true) */
  showZeroValues?: boolean;

  /** Right-to-left layout (default: false) */
  rightToLeft?: boolean;

  // ===========================================================================
  // Workbook Settings - Editing Behavior (Issue 8: Settings Panel)
  // ===========================================================================

  /** Whether to show cut/copy indicator (marching ants). Default: true */
  showCutCopyIndicator?: boolean;

  /** Whether fill handle dragging is enabled. Default: true */
  allowDragFill?: boolean;

  // ===========================================================================
  // Transient visual feedback
  // ===========================================================================

  /** Blocked edit attempt state for red flash visual feedback (optional, defaults to null) */
  blockedEditAttempt?: { cellId: string; timestamp: number } | null;

  /** Shimmer entries for visual feedback on changed cells */
  shimmerEntries?: readonly ShimmerEntry[];
  /** Which shimmer effect to render */
  shimmerEffect?: ShimmerEffectType;
  /** Duration of shimmer effect in ms */
  shimmerDurationMs?: number;
  /** Base color for shimmer */
  shimmerColor?: string;
  /** Max opacity (0-1) */
  shimmerMaxOpacity?: number;
  /** Whether shimmer is enabled */
  shimmerEnabled?: boolean;

  // ===========================================================================
  // Page Break Preview
  // ===========================================================================

  /** Whether page break preview mode is enabled (default: false) */
  pageBreakPreviewMode?: boolean;

  /** Manual page breaks for the current sheet (default: empty) */
  pageBreaks?: {
    rowBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
    colBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
  };

  /**
   * Automatic page breaks from page size/scaling (default: empty).
   * 15-PRINT-EXPORT: Item 15.5
   */
  autoPageBreaks?: {
    rowBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
    colBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
  };

  /**
   * Print area for the current sheet (default: null).
   * 15-PRINT-EXPORT: Item 15.4
   */
  printArea?: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  } | null;

  // ===========================================================================
  // Page Break Drag Preview (15-PRINT-EXPORT: Page Break Preview Dragging)
  // ===========================================================================
  /**
   * Page break drag state for rendering drag preview line.
   * When present and isDragging is true, PageBreakLayer renders a preview
   * line at the targetPosition showing where the break will move.
   */
  pageBreakDragState?: PageBreakDragState;

  // ===========================================================================
  // Paste preview
  // ===========================================================================

  /**
   * Get paste preview state for rendering preview overlay.
   * Returns null when no preview is active.
   * Optional, defaults to null.
   */
  getPastePreview?: () => {
    isActive: boolean;
    targetRange: CellRange;
    cells: Array<{
      row: number;
      col: number;
      displayValue: string;
      format?: Partial<CellFormat>;
      hasFormula?: boolean;
    }>;
  } | null;

  // ===========================================================================
  // Validation Circles (F1: Circle Invalid Data)
  // ===========================================================================

  /** Whether validation circles are visible around invalid cells (default: false) */
  validationCirclesVisible?: boolean;

  // ===========================================================================
  // Chrome theme
  // ===========================================================================

  /**
   * Chrome theme controlling canvas background, headers, selection, scrollbars.
   * When provided, also applied as CSS variables on the container element
   * via applyChromeTheme() so shell UI picks up theme colors.
   */
  chromeTheme?: ChromeTheme;

  /**
   * Resolved non-persistent SheetView skin for renderer chrome.
   * Public SheetView skin DTOs are adapted before they reach this boundary.
   */
  sheetViewSkin?: ResolvedSheetViewSkin;

  // ===========================================================================
  // Interactive Element Collection (Canvas Interactive Element Layer)
  // ===========================================================================

  /**
   * Collector for canvas interactive elements (filter buttons, checkboxes, etc.)
   * that need DOM overlays. Elements are collected during render and used by
   * CanvasInteractiveOverlay to render invisible DOM triggers.
   *
   * When provided, render layers should call `interactiveElements.add()` after
   * painting interactive elements to register their positions for DOM overlay
   * coordination.
   *
   */
  interactiveElements?: InteractiveElementCollector;
}
