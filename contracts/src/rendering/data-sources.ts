// TODO: Migrate sheetId → containerId in FloatingObjectDataSource and related interfaces.

/**
 * Canvas Data Source Interfaces
 *
 * Typed data source interfaces that decompose the monolithic RenderContextConfig
 * into focused data contracts. Each grid-renderer layer declares which data sources
 * it requires via its constructor, replacing the 80+ field god-object.
 *
 * @module @mog-sdk/contracts/rendering/data-sources
 */

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
import type { SearchHighlight } from '../document/search';
import type { ThemeDefinition } from '@mog/types-formatting/formatting/theme';
import type { ClipboardSnapshot, EditorSnapshot } from '@mog/types-machines';
import type { FloatingObject } from '@mog/types-objects/objects/floating-objects';
import type { ChromeTheme } from './data-source-types';
import type { ResolvedSheetViewSkin } from './sheet-view-skin';
import type { ObjectBounds, PreviewCellData, RemoteCursor } from './hit-test';
import type { CellCoord } from '@mog/types-viewport/rendering/primitives';
import type { ShimmerEffectType, ShimmerEntry } from './visual-feedback';
import type {
  FloatingObjectRenderState,
  PageBreakDragState,
  SelectionRenderState,
} from './render-context';

// =============================================================================
// Chrome Theme (re-exported from ./data-source-types to preserve the
// public surface of this module — the shared definition lives in the leaf
// types module so `render-context.ts` can import it without creating a cycle.)
// =============================================================================

export type { ChromeTheme } from './data-source-types';
export { DEFAULT_CHROME_THEME } from './data-source-types';

// =============================================================================
// Cell Data Source
// =============================================================================

/**
 * Binding status for a cell connected to an external data source.
 */
export interface CellBindingStatus {
  readonly connectionId: string;
  readonly staleness: 'fresh' | 'stale' | 'error';
}

/**
 * Data bar rendering data produced by conditional formatting evaluation.
 */
export interface DataBarData {
  fillPercent: number;
  color: string;
  isNegative: boolean;
  gradient: boolean;
  showValue: boolean;
  showAxis: boolean;
  axisPosition: number;
  negativeColor: string;
}

/**
 * Icon set rendering data produced by conditional formatting evaluation.
 */
export interface IconData {
  setName: string;
  iconIndex: number;
  iconOnly: boolean;
}

/**
 * Data source for cell content and metadata.
 *
 * Per-cell rendering data (formatted values, CF overrides, data bars, icons,
 * hyperlinks, formulas, checkboxes, comments, projections) is now read from
 * the binary viewport buffer (BinaryCellReader) — not from this interface.
 *
 * This interface retains only methods that are called per-cell by layers that
 * haven't migrated to the buffer yet, plus sheet-level properties.
 */
export interface CellDataSource {
  getCellValue(sheetId: string, cell: CellCoord): unknown;
  getCellFormat(sheetId: string, cell: CellCoord): CellFormat | undefined;
  getCellBindingStatus(sheetId: string, cell: CellCoord): CellBindingStatus | undefined;
  getSparklineRenderData(sheetId: string, cell: CellCoord): SparklineRenderData | undefined;
  getTableAtCell(sheetId: string, cell: CellCoord): TableConfig | undefined;
  hasTableColumnFilter(
    sheetId: string,
    tableId: string,
    headerRow: number,
    headerCol: number,
  ): boolean;
  getFilterHeaderInfo(sheetId: string, cell: CellCoord): FilterHeaderInfo | undefined;
  hasValidationErrors(sheetId: string, cell: CellCoord): boolean;
  showZeroValues: boolean;
  /** Set of cells with dropdown indicators (key format: "row,col") */
  dropdownCells: ReadonlySet<string>;
}

// =============================================================================
// Selection Data Source
// =============================================================================

/**
 * Paste preview data for rendering semi-transparent preview.
 */
export interface PastePreviewData {
  readonly isActive: boolean;
  readonly targetRange: CellRange;
  readonly cells: ReadonlyArray<PreviewCellData>;
}

/**
 * Drag-drop state for cell range drag operations.
 */
export interface DragDropState {
  readonly isDragging: boolean;
  readonly sourceRange: CellRange | null;
  readonly targetRange: CellRange | null;
}

/**
 * Data source for selection, editing, clipboard, and search state.
 */
export interface SelectionDataSource {
  getSelectionState(): SelectionRenderState;
  getEditorState(): EditorSnapshot;
  getClipboardState(): ClipboardSnapshot;
  getSearchHighlights(): ReadonlyArray<SearchHighlight>;
  getPastePreview(): PastePreviewData | null;
  getDragDropState(): DragDropState | null;
  getTablePreviewRange(): CellRange | null;
  /** Whether the selection has an error (e.g., invalid merge target) */
  hasError(): boolean;
}

// =============================================================================
// Shimmer Visual Feedback
// =============================================================================

export type { ShimmerDefaults, ShimmerEffectType, ShimmerEntry } from './visual-feedback';
export { DEFAULT_SHIMMER_CONFIG } from './visual-feedback';

// =============================================================================
// Sheet Data Source
// =============================================================================

/**
 * Data source for sheet-level settings and view options.
 */
export interface SheetDataSource {
  readonly sheetId: string;
  readonly totalRows: number;
  readonly totalCols: number;
  readonly showGridlines: boolean;
  readonly gridlineColor: string;
  readonly theme: ThemeDefinition;
  readonly culture: CultureInfo;
  readonly rightToLeft: boolean;
  /** Whether to display formulas instead of values (View > Show Formulas) */
  readonly showFormulas: boolean;
  /** Whether to show row headers (1, 2, 3...) */
  readonly showRowHeaders: boolean;
  /** Whether to show column headers (A, B, C...) */
  readonly showColumnHeaders: boolean;
  /** Whether to show cut/copy indicator (marching ants) */
  readonly showCutCopyIndicator: boolean;
  /** Whether fill handle dragging is enabled */
  readonly allowDragFill: boolean;
  /** Whether validation circles are visible around invalid cells */
  readonly validationCirclesVisible: boolean;
  /** Preview font applied to selected cells during font picker hover */
  readonly previewFont: string | null;
  /** Blocked edit attempt state for red flash visual feedback */
  readonly blockedEditAttempt: { cellId: string; timestamp: number } | null;
  /** Chrome theme controlling canvas background, headers, selection, scrollbars */
  readonly chromeTheme: ChromeTheme;
  /** Resolved non-persistent SheetView skin for renderer chrome. */
  readonly sheetViewSkin: ResolvedSheetViewSkin;
  /** Active shimmer entries for visual feedback on changed cells */
  readonly shimmerEntries: readonly ShimmerEntry[];
  /** Which shimmer effect to render. Default: DEFAULT_SHIMMER_CONFIG.effect */
  readonly shimmerEffect: ShimmerEffectType;
  /** Duration of shimmer effect in ms. Default: DEFAULT_SHIMMER_CONFIG.durationMs */
  readonly shimmerDurationMs: number;
  /** Base color for shimmer. Default: DEFAULT_SHIMMER_CONFIG.color */
  readonly shimmerColor: string;
  /** Max opacity (0-1). Default: DEFAULT_SHIMMER_CONFIG.maxOpacity */
  readonly shimmerMaxOpacity: number;
  /** Whether shimmer is enabled. Default: DEFAULT_SHIMMER_CONFIG.enabled */
  readonly shimmerEnabled: boolean;
}

// =============================================================================
// Collaboration Data Source
// =============================================================================

/**
 * Data source for remote collaborator cursors.
 */
export interface CollaborationDataSource {
  getRemoteCursors(): ReadonlyArray<RemoteCursor>;
}

// =============================================================================
// Trace Data Source
// =============================================================================

/**
 * Data source for formula auditing trace arrows.
 */
export interface TraceDataSource {
  getTraceArrows(): ReadonlyArray<TraceArrow>;
  getCellPositionForTrace(cellId: string): { row: number; col: number; sheet: string } | null;
}

// =============================================================================
// Floating Object Data Source
// =============================================================================

/**
 * Data source for floating objects (unified with charts).
 * Charts are floating objects in the scene graph, enabling correct z-interleaving.
 */
export interface FloatingObjectDataSource {
  getFloatingObjects(): ReadonlyArray<FloatingObject>;
  getFloatingObjectBounds(objectId: string): Promise<ObjectBounds | null> | ObjectBounds | null;
  /** Batch-fetch bounds for all objects on the current sheet (single IPC call). */
  getAllObjectBounds?(): Promise<Map<string, ObjectBounds>> | Map<string, ObjectBounds>;
  getFloatingObjectState(): FloatingObjectRenderState;
  /** Get charts visible in the current viewport (unified with floating objects) */
  getChartsInViewport(): ReadonlyArray<{ id: string; type: string; [key: string]: unknown }>;
  /** Get resolved chart position from CellId-based anchor */
  getChartPosition(
    sheetId: string,
    chart: { id: string; [key: string]: unknown },
  ): { anchorRow: number; anchorCol: number; width: number; height: number } | null;
}

// =============================================================================
// Grouping Data Source
// =============================================================================

/**
 * Data source for row/column grouping (outline) information.
 */
export interface GroupingDataSource {
  getGroupingConfig(): SheetGroupingConfig | null;
  getRowGroups(): ReadonlyArray<GroupDefinition>;
  getColumnGroups(): ReadonlyArray<GroupDefinition>;
  getRowOutlineLevels(startRow: number, endRow: number): ReadonlyArray<OutlineLevel>;
  getColumnOutlineLevels(startCol: number, endCol: number): ReadonlyArray<OutlineLevel>;
  readonly maxRowOutlineLevel: number;
  readonly maxColOutlineLevel: number;
}

// =============================================================================
// Page Break Data Source
// =============================================================================

/**
 * A single page break entry with full metadata.
 */
export interface PageBreakEntry {
  readonly id: number;
  readonly min: number;
  readonly max: number;
  readonly manual: boolean;
  readonly pt: boolean;
}

/**
 * Page break information for manual and automatic breaks.
 */
export interface PageBreaks {
  readonly rowBreaks: ReadonlyArray<PageBreakEntry>;
  readonly colBreaks: ReadonlyArray<PageBreakEntry>;
}

/**
 * Print area bounds.
 */
export interface PrintArea {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
}

/**
 * Data source for page break preview rendering.
 */
export interface PageBreakDataSource {
  readonly pageBreakPreviewMode: boolean;
  getPageBreaks(): PageBreaks;
  getAutoPageBreaks(): PageBreaks;
  getPrintArea(): PrintArea | null;
  getPageBreakDragState(): PageBreakDragState | null;
}

// =============================================================================
// Chart Render Bridge
// =============================================================================

/**
 * Bridge for rendering charts to canvas.
 *
 * NOTE: This is a rendering bridge (side-effecting), NOT a data source.
 * Named explicitly to distinguish from read-only data sources.
 * The bridge draws the chart content into the provided canvas context.
 */
export interface ChartRenderBridge {
  renderChart(
    chartId: string,
    ctx: CanvasRenderingContext2D,
    bounds: { x: number; y: number; width: number; height: number },
  ): void;
}

// =============================================================================
// Overlay Data Source
// =============================================================================

/**
 * Data source for the screen-space overlay (canvas 1).
 *
 * Returns screen-space bounds (after camera/zoom transform) so that
 * handles render at consistent CSS-pixel sizes regardless of zoom level.
 */
export interface OverlayDataSource {
  /** Get the bounding box of all selected objects (screen-space) */
  getSelectedObjectBounds(): { x: number; y: number; width: number; height: number } | null;
  /** Get IDs of all currently selected objects */
  getSelectedObjectIds(): ReadonlyArray<string>;
  /** Get bounds of a specific object (screen-space) */
  getObjectBounds(id: string): { x: number; y: number; width: number; height: number } | null;
  /** Check if an object is locked (locked objects don't show resize/rotation handles) */
  isObjectLocked(id: string): boolean;
  /** Get rotation angle of an object in degrees */
  getObjectRotation(id: string): number;
  /** Get the currently active handle (if any) */
  getActiveHandle(): string | null;
  /** Get smart guide lines for alignment during drag/resize */
  getGuides(): ReadonlyArray<{
    readonly axis: 'horizontal' | 'vertical';
    readonly position: number;
    readonly start: number;
    readonly end: number;
  }>;
  /** Get rubber band selection rectangle (null if not active) */
  getRubberBand(): { x: number; y: number; width: number; height: number } | null;
  /** Get drag preview state */
  getDragPreview(): {
    readonly objectIds: ReadonlyArray<string>;
    readonly deltaX: number;
    readonly deltaY: number;
  } | null;
  /** Get ink preview state (active strokes during drawing) */
  getInkPreview(): {
    readonly strokes: ReadonlyArray<{
      readonly points: ReadonlyArray<{ x: number; y: number; pressure?: number }>;
      readonly color: string;
      readonly width: number;
    }>;
    readonly eraserPosition: { x: number; y: number; radius: number } | null;
    readonly lassoPath: ReadonlyArray<{ x: number; y: number }> | null;
  } | null;
  /** Get insertion preview rectangle during drag-to-insert shape mode (null if not active) */
  getInsertionPreview(): {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
  /**
   * Get connection point indicators for the shape nearest to the cursor
   * during connector-dragging mode.
   *
   * Returns all connection points for the target shape (as screen-space
   * positions) plus the snap target (the nearest point within snap radius),
   * or null if not in connector-dragging mode or no shape is nearby.
   */
  getConnectionPointIndicators(): {
    readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
    readonly snapTarget: { readonly x: number; readonly y: number } | null;
  } | null;
}
