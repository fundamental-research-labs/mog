/**
 * Render Context Coordination
 *
 * Coordinates state machines → renderer context updates.
 * Subscribes to selection, editor, and clipboard actors and sends
 * context updates to the renderer.
 *
 * This moves the context update logic from the component to the coordinator,
 * following the principle that machines never communicate directly.
 *
 * @see RENDERER-INSTANCE-OWNERSHIP.md - Cross-Coordination for Context Updates
 */

import { clipboardSelectors, selectionSelectors } from '../../../selectors';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { ChartBounds } from '@mog-sdk/contracts/bridges';
import type { CellFormat, CellRange } from '@mog-sdk/contracts/core';
import type { FilterHeaderInfo } from '@mog-sdk/contracts/filter';
import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type {
  GroupDefinition,
  OutlineLevel,
  SheetGroupingConfig,
} from '@mog-sdk/contracts/grouping';
import type {
  CellCoord,
  FloatingObjectRenderState,
  ObjectBounds,
  PageBreakDragState as ContractPageBreakDragState,
  RemoteCursor,
  RenderContextConfig,
} from '@mog-sdk/contracts/rendering';
import type { SearchHighlight } from '@mog-sdk/contracts/search';
import type { SparklineRenderData } from '@mog-sdk/contracts/sparklines';
import type { TableConfig } from '@mog-sdk/contracts/tables';
import type { TraceArrow } from '@mog-sdk/contracts/trace-arrows';
import {
  extractFormulaRanges,
  findActiveReferenceIndex,
} from '../../../domain/editor/formula-range-parser';
import { computeTargetRange } from '../../../domain/fill/types';
import type { ClipboardActor, ClipboardState } from '../../grid-editing/machines/clipboard-machine';
import type { EditorActor, EditorState } from '../../grid-editing/machines/grid-editor-machine';
import type {
  SelectionActor,
  SelectionState,
} from '../../grid-editing/machines/grid-selection-machine';
import { getSelectionSnapshot } from '../../grid-editing/machines/selection/derived-state';
import type {
  ObjectInteractionActor,
  ObjectInteractionStateValue,
} from '../../objects/machines/object-interaction-machine';
import { rangesEqual } from '../../shared/types';
import { lifecycleDebug } from '../debug/debug-lifecycle';
import type { RendererActor, RendererState } from '../machines/grid-renderer-machine';
import type { PageBreakActor, PageBreakState } from '../machines/page-break-machine';

// =============================================================================
// TYPE DEFINITIONS (re-exported from local machines)
// =============================================================================

export type { ClipboardActor, ClipboardState } from '../../grid-editing/machines/clipboard-machine';
export type { EditorActor, EditorState } from '../../grid-editing/machines/grid-editor-machine';
export type {
  SelectionActor,
  SelectionState,
} from '../../grid-editing/machines/grid-selection-machine';
export type { RendererActor, RendererState } from '../machines/grid-renderer-machine';

// =============================================================================
// STATE → RENDERER CONTEXT COORDINATION
// =============================================================================

// PageBreakDragState from contracts for consumers that import from this file.
export type PageBreakDragState = ContractPageBreakDragState;

/**
 * Configuration for render context coordination.
 */
export interface RenderContextCoordinationConfig {
  /** Workbook instance for event subscriptions */
  workbook: Workbook;
  selectionActor: SelectionActor;
  editorActor: EditorActor;
  clipboardActor: ClipboardActor;
  rendererActor: RendererActor;
  /**
   * Object interaction actor for drag/resize/rotate state changes.
   * When present, triggers sendContextUpdate() on interaction state changes,
   * enabling smooth 60fps visual feedback during floating object operations.
   */
  objectInteractionActor?: ObjectInteractionActor;
  /**
   * Page break actor for drag state changes.
   * When present, triggers sendContextUpdate() on drag state changes,
   * enabling smooth 60fps visual feedback during page break drag operations.
   */
  pageBreakActor?: PageBreakActor;
  /**
   * Get page break drag state for rendering preview.
   * Returns the current drag state from PageBreakCoordinator.
   */
  getPageBreakDragState?: () => PageBreakDragState | null;
  /** Get remote cursors from collaboration awareness */
  getRemoteCursors: () => RemoteCursor[];
  /**
   * Get cell display value.
   * Receives sheetId at call time from RenderContext.currentSheetId.
   * This eliminates stale closure bugs when sheets switch.
   * @see SHEET-AWARE-CELL-DATA-CALLBACKS.md
   */
  getCellValue: (sheetId: string, cell: CellCoord) => unknown;
  /**
   * Get cell format.
   * Receives sheetId at call time from RenderContext.currentSheetId.
   * This eliminates stale closure bugs when sheets switch.
   * @see SHEET-AWARE-CELL-DATA-CALLBACKS.md
   */
  getCellFormat: (sheetId: string, cell: CellCoord) => CellFormat | undefined;
  /**
   * Get table at cell (optional).
   * Returns the TableConfig if the cell is inside a table, undefined otherwise.
   * Receives sheetId at call time from RenderContext.currentSheetId.
   * This eliminates stale closure bugs when sheets switch.
   * @see SHEET-AWARE-CELL-DATA-CALLBACKS.md
   */
  getTableAtCell?: (
    sheetId: string,
    cell: CellCoord,
  ) => TableConfig | undefined | Promise<TableConfig | undefined>;
  /**
   * Get resolved table range (Cell Identity Model).
   * Returns the current position of the table by resolving CellId-based corners.
   * table.range is deprecated and can become stale after row/column insertions.
   */
  getResolvedTableRange?: (table: TableConfig) => CellRange | null;
  /**
   * Get filter header info for AutoFilter cells (Filter UI).
   * Returns FilterHeaderInfo if the cell is an AutoFilter header, undefined otherwise.
   * Receives sheetId at call time from RenderContext.currentSheetId.
   * NOTE: Table filters use getTableAtCell() instead - this is for standalone AutoFilters.
   */
  getFilterHeaderInfo?: (
    sheetId: string,
    cell: CellCoord,
  ) => FilterHeaderInfo | undefined | Promise<FilterHeaderInfo | undefined>;
  /**
   * Check if a table column has an active filter (Tables - 10.2 Funnel Icon).
   * Used to render funnel icons on table header cells when a filter is applied.
   */
  hasTableColumnFilter?: (
    sheetId: string,
    tableId: string,
    headerRow: number,
    headerCol: number,
  ) => boolean | Promise<boolean>;
  /**
   * Callback to update the renderer context directly.
   * Since the renderer machine is pure (no UPDATE_CONTEXT event),
   * the coordinator must update the renderer directly via this callback.
   */
  onContextUpdate: (config: Partial<RenderContextConfig>) => void;
  // ===========================================================================
  // Page Break Preview
  // ===========================================================================
  /** Get page break preview mode state (optional, defaults to false) */
  getPageBreakPreviewMode?: () => boolean;
  /** Get page breaks for current sheet (optional, defaults to empty) */
  getPageBreaks?: () =>
    | {
        rowBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
        colBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
      }
    | Promise<{
        rowBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
        colBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
      }>;

  // ===========================================================================
  // 15-PRINT-EXPORT: Items 15.4 and 15.5
  // ===========================================================================
  /**
   * Get automatic page breaks for current sheet.
   * Calculated from paper size, margins, and scaling settings.
   * @default { rowBreaks: [], colBreaks: [] }
   */
  getAutoPageBreaks?: () =>
    | {
        rowBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
        colBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
      }
    | Promise<{
        rowBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
        colBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
      }>;
  /**
   * Get print area for current sheet.
   * @default null (no print area = entire sheet)
   */
  getPrintArea?: () =>
    | {
        startRow: number;
        startCol: number;
        endRow: number;
        endCol: number;
      }
    | null
    | Promise<{
        startRow: number;
        startCol: number;
        endRow: number;
        endCol: number;
      } | null>;

  // ===========================================================================
  // Sparklines (Sparklines)
  // ===========================================================================
  /**
   * Get sparkline render data for a cell (optional, defaults to undefined).
   * Receives sheetId at call time from RenderContext.currentSheetId.
   * This eliminates stale closure bugs when sheets switch.
   * @see SHEET-AWARE-CELL-DATA-CALLBACKS.md
   */
  getSparklineRenderData?: (sheetId: string, cell: CellCoord) => SparklineRenderData | undefined;

  // ===========================================================================
  // Validation Error Indicators
  // ===========================================================================
  /**
   * Check if a cell has validation errors.
   * Used to render the red triangle indicator in the cell corner.
   * Receives sheetId at call time from RenderContext.currentSheetId.
   */
  hasValidationErrors?: (sheetId: string, cell: CellCoord) => boolean;

  // ===========================================================================
  // Floating Objects
  // ===========================================================================
  /**
   * Get the current floating object interaction state.
   * This includes selected objects, interaction mode, etc.
   */
  getFloatingObjectState?: () => FloatingObjectRenderState;
  /**
   * Get floating objects visible in the current sheet.
   * Returns objects sorted by z-index for proper layering.
   */
  getFloatingObjects?: () => FloatingObject[];
  /**
   * Get computed pixel bounds for a floating object.
   * Returns null if object not found.
   */
  getFloatingObjectBounds?: (
    objectId: string,
  ) => Promise<ObjectBounds | null> | ObjectBounds | null;
  /**
   * Batch-fetch bounds for all objects on the current sheet (single IPC call).
   */
  getAllObjectBounds?: () => Promise<Map<string, ObjectBounds>> | Map<string, ObjectBounds>;
  // ===========================================================================
  // Find & Replace
  // ===========================================================================
  /**
   * Get search highlights for the current sheet.
   *
   * ARCHITECTURE (Cell Identity):
   * - CellId → position resolution happens in the callback implementation
   * - Canvas layer receives row/col (doesn't know about CellId)
   * - This keeps canvas layer pure and testable
   *
   */
  getSearchHighlights?: () => SearchHighlight[] | Promise<SearchHighlight[]>;

  // ===========================================================================
  // Grouping/Outline (Row/Column Grouping)
  // ===========================================================================
  /**
   * Get grouping configuration for the current sheet.
   * Returns settings like summaryRowsBelow, showOutlineSymbols, etc.
   */
  getGroupingConfig?: () => SheetGroupingConfig | null;
  /**
   * Get row groups for the current sheet.
   * Returns group definitions with start/end positions and collapsed state.
   */
  getRowGroups?: () => GroupDefinition[];
  /**
   * Get column groups for the current sheet.
   * Returns group definitions with start/end positions and collapsed state.
   */
  getColumnGroups?: () => GroupDefinition[];
  /**
   * Get row outline levels for rendering outline symbols.
   * Returns computed outline levels for each row in the range.
   */
  getRowOutlineLevels?: (
    startRow: number,
    endRow: number,
  ) => OutlineLevel[] | Promise<OutlineLevel[]>;
  /**
   * Get column outline levels for rendering outline symbols.
   * Returns computed outline levels for each column in the range.
   */
  getColumnOutlineLevels?: (
    startCol: number,
    endCol: number,
  ) => OutlineLevel[] | Promise<OutlineLevel[]>;
  /**
   * Maximum row outline level (0 if no row groups).
   * Used to calculate gutter width for outline symbols.
   */
  maxRowOutlineLevel?: number;
  /**
   * Maximum column outline level (0 if no column groups).
   * Used to calculate gutter height for outline symbols.
   */
  maxColOutlineLevel?: number;

  // ===========================================================================
  // Formula Auditing
  // ===========================================================================
  /**
   * Get trace arrows for the current sheet.
   *
   * ARCHITECTURE (Cell Identity):
   * - Arrows store CellIds for stable identity
   * - getCellPositionForTrace resolves CellId → position at render time
   * - Canvas layer receives row/col via getCellPosition (doesn't know about CellId)
   *
   */
  getTraceArrows?: () => TraceArrow[];
  /**
   * Resolve CellId to position for rendering trace arrows.
   * Used by TraceArrowsLayer to convert CellId-based arrow endpoints to row/col.
   */
  getCellPositionForTrace?: (cellId: string) => { row: number; col: number; sheet: string } | null;

  // ===========================================================================
  // Paste Preview
  // ===========================================================================
  /**
   * Get paste preview state from UI store.
   * Returns preview data when hovering over paste dropdown options.
   *
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
  // Flash Fill Preview
  // ===========================================================================
  /**
   * Get Flash Fill preview state from UI store.
   * Returns preview data when a Flash Fill pattern is detected.
   *
   */
  getFlashFillPreview?: () => {
    isActive: boolean;
    values: Array<{ row: number; col: number; value: unknown }>;
    patternDescription: string | null;
  } | null;

  // ===========================================================================
  // Table Preview (Range Preview in Create Table Dialog)
  // ===========================================================================
  /**
   * Get table preview range from UI store.
   * Returns the preview range while the Create Table dialog is open.
   *
   */
  getTablePreviewRange?: () => CellRange | null;

  // ===========================================================================
  // Font Preview
  // ===========================================================================
  /**
   * Get preview font from UI store.
   * When hovering over a font in the font picker, this returns the font family
   * to preview on selected cells. Returns null when not previewing.
   *
   */
  getPreviewFont?: () => string | null;

  // ===========================================================================
  // Charts
  // ===========================================================================

  /**
   * Render a chart to canvas via ChartBridge.
   * Called by ChartLayer for each chart during rendering.
   *
   * @param chartId - Chart ID
   * @param ctx - Canvas 2D rendering context
   * @param bounds - Bounding box for the chart
   */
  renderChart?: (chartId: string, ctx: CanvasRenderingContext2D, bounds: ChartBounds) => void;

  // ===========================================================================
  // Binary Viewport
  // ===========================================================================
  /** Resolve the current binary cell reader for the canvas cells layer hot path. */
  getBinaryCellReader?: () => RenderContextConfig['binaryCellReader'];

  /** Resolve a binary cell reader for the current materialization and viewport. */
  getBinaryCellReaderForViewport?: RenderContextConfig['binaryCellReaderForViewport'];
}

/**
 * Set up state → renderer context coordination.
 *
 * Subscribes to selection, editor, and clipboard actors and sends
 * UPDATE_CONTEXT events to the renderer actor when state changes.
 *
 * This moves the context update logic from the component to the coordinator,
 * following the principle that machines never communicate directly.
 *
 * @see RENDERER-INSTANCE-OWNERSHIP.md - Cross-Coordination for Context Updates
 */
export function setupRenderContextCoordination(
  config: RenderContextCoordinationConfig,
): () => void {
  const {
    workbook,
    selectionActor,
    editorActor,
    clipboardActor,
    rendererActor,
    objectInteractionActor,
    pageBreakActor,
    getPageBreakDragState,
    getRemoteCursors,
    getCellValue,
    getCellFormat,
    // Tables
    getTableAtCell,
    // Resolved table range for Cell Identity Model
    getResolvedTableRange,
    // Filters
    getFilterHeaderInfo,
    // Tables - 10.2 Funnel Icon for Active Filters
    hasTableColumnFilter,
    onContextUpdate,
    // Page Break Preview
    getPageBreakPreviewMode,
    getPageBreaks,
    // 15-PRINT-EXPORT: Items 15.4 and 15.5
    getAutoPageBreaks,
    getPrintArea,
    // Sparklines
    getSparklineRenderData,
    // Validation Error Indicators
    hasValidationErrors,
    // Floating Objects
    getFloatingObjectState,
    getFloatingObjects,
    getFloatingObjectBounds,
    getAllObjectBounds,
    // Find & Replace
    getSearchHighlights,
    // Grouping/Outline
    getGroupingConfig,
    getRowGroups,
    getColumnGroups,
    getRowOutlineLevels,
    getColumnOutlineLevels,
    // maxRowOutlineLevel and maxColOutlineLevel read from config directly in sendContextUpdate
    // Formula Auditing
    getTraceArrows,
    getCellPositionForTrace,
    // Paste Preview
    getPastePreview,
    // Flash Fill Preview
    getFlashFillPreview,
    // Table Preview Range for Create Table Dialog
    getTablePreviewRange,
    // Font Preview
    getPreviewFont,
    // Charts
    renderChart,
    getBinaryCellReader,
    getBinaryCellReaderForViewport,
  } = config;

  const cleanupFns: (() => void)[] = [];
  let contextUpdateGeneration = 0;
  let disposed = false;
  const followerRefreshTimers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Build and send context update to the renderer.
   * Only sends when renderer is in 'ready' state.
   *
   * Note: Since the renderer machine is pure (Option A from DEPENDENCY-TIMING-ISSUE.md),
   * we call onContextUpdate callback directly instead of sending events to the machine.
   */
  const sendContextUpdate = () => {
    if (disposed) return;

    const generation = ++contextUpdateGeneration;
    const rendererState = rendererActor.getSnapshot();
    const rendererStatus = rendererState.value as string;

    // Log whether we'll send the update or not
    lifecycleDebug.sendContextUpdate(rendererStatus, rendererStatus === 'ready');

    // Only update context when renderer is ready
    if (rendererState.value !== 'ready') return;

    const selectionState = selectionActor.getSnapshot();
    const editorState = editorActor.getSnapshot();
    const clipboardState = clipboardActor.getSnapshot();

    // Use getSelectionSnapshot to get pre-computed derived state
    // This avoids O(16384) iteration when full rows/columns are selected
    const selectionSnapshot = getSelectionSnapshot(selectionState);

    // Get paste preview state and merge with selection snapshot
    const pastePreviewData = getPastePreview?.() ?? null;

    // Get Flash Fill preview state
    const flashFillPreviewData = getFlashFillPreview?.() ?? null;

    // Get table preview range for Create Table dialog
    const tablePreviewRange = getTablePreviewRange?.() ?? null;

    // Extract formula ranges for highlighting in grid
    // Parse the formula value when in formula editing mode
    const isFormulaEditing = editorState.matches('formulaEditing');
    const editorValue = editorState.context.value;
    const cursorPosition = editorState.context.cursorPosition;

    let formulaRanges:
      | Array<{
          range: CellRange;
          color: string;
          index: number;
        }>
      | undefined;
    let activeReferenceIndex: number | undefined;

    if (isFormulaEditing && editorValue.startsWith('=')) {
      const parsedRanges = extractFormulaRanges(editorValue);
      if (parsedRanges.length > 0) {
        formulaRanges = parsedRanges.map((ref) => ({
          range: ref.range,
          color: ref.color,
          index: ref.index,
        }));
        // C.2: Find which reference the cursor is in
        activeReferenceIndex = findActiveReferenceIndex(parsedRanges, cursorPosition);
      }
    }

    // Compute fill preview range when dragging the fill handle
    // This shows the visual preview of the range that will be filled
    let fillPreviewRange: CellRange | undefined;
    const { fillSourceRange, fillHandleEnd } = selectionState.context;
    if (selectionSnapshot.isDraggingFillHandle && fillSourceRange && fillHandleEnd) {
      // Check if the fill handle has actually moved from the source range corner
      const sourceEndRow = fillSourceRange.endRow;
      const sourceEndCol = fillSourceRange.endCol;
      if (fillHandleEnd.row !== sourceEndRow || fillHandleEnd.col !== sourceEndCol) {
        fillPreviewRange = computeTargetRange(fillSourceRange, fillHandleEnd);
      }
    }

    const selectionWithExtras = {
      ...selectionSnapshot,
      ...(pastePreviewData ? { pastePreview: pastePreviewData } : {}),
      ...(flashFillPreviewData ? { flashFillPreview: flashFillPreviewData } : {}),
      ...(formulaRanges ? { formulaRanges, activeReferenceIndex } : {}),
      // Table preview range for Create Table dialog
      ...(tablePreviewRange ? { tablePreviewRange } : {}),
      // Fill handle drag preview range
      ...(fillPreviewRange ? { fillPreviewRange } : {}),
    };

    // Use editingCell from editor context (stable during formula point mode).
    // Falls back to selection.activeCell for backward compatibility.
    const isEditing = !editorState.matches('inactive');
    const editingCell = isEditing
      ? (editorState.context.editingCell ?? selectionSnapshot.activeCell)
      : null;

    const contextConfig: Partial<RenderContextConfig> = {
      selection: selectionWithExtras,
      editor: {
        isEditing,
        isFormulaEditing: editorState.matches('formulaEditing'),
        editingCell,
        sheetId: editorState.context.sheetId,
        mergeBounds: editorState.context.mergeBounds,
        value: editorState.context.value,
        hasConflict: editorState.context.hasConflict,
        isIMEComposing: editorState.matches('imeComposing'),
      },
      clipboard: {
        // ARCHITECTURE: Use selectors as single source of truth for clipboard state
        // Cast state to compatible type for selectors (same pattern as clipboard-machine.ts:741)
        hasCopy: clipboardSelectors.hasCopy(
          clipboardState as Parameters<(typeof clipboardSelectors)['hasCopy']>[0],
        ),
        hasCut: clipboardSelectors.hasCut(
          clipboardState as Parameters<(typeof clipboardSelectors)['hasCut']>[0],
        ),
        cutSource: clipboardSelectors.cutSource(
          clipboardState as Parameters<(typeof clipboardSelectors)['cutSource']>[0],
        ),
        copySource: clipboardSelectors.copySource(
          clipboardState as Parameters<(typeof clipboardSelectors)['copySource']>[0],
        ),
        isPasting: clipboardSelectors.isPasting(
          clipboardState as Parameters<(typeof clipboardSelectors)['isPasting']>[0],
        ),
        sourceSheetId: clipboardSelectors.sourceSheetId(
          clipboardState as Parameters<(typeof clipboardSelectors)['sourceSheetId']>[0],
        ),
      },
      remoteCursors: getRemoteCursors(),
      getCellValue,
      getCellFormat,
      // Tables
      // Per-cell callbacks may have Promise union types in coordination config,
      // but actual implementations are sync (ViewportBuffer). Cast to sync for RenderContextConfig.
      getTableAtCell: getTableAtCell as RenderContextConfig['getTableAtCell'],
      // Resolved table range for Cell Identity Model
      getResolvedTableRange,
      // Filters
      getFilterHeaderInfo: getFilterHeaderInfo as RenderContextConfig['getFilterHeaderInfo'],
      // Tables - 10.2 Funnel Icon for Active Filters
      hasTableColumnFilter: hasTableColumnFilter as RenderContextConfig['hasTableColumnFilter'],
      // Page-break preview mode and drag state are interaction-lane fields.
      // Persisted page/print/search data is published by the follower lane
      // below so editor overlay updates never await those reads.
      pageBreakPreviewMode: getPageBreakPreviewMode?.() ?? false,
      // Page Break Drag Preview (15-PRINT-EXPORT)
      pageBreakDragState: getPageBreakDragState?.() ?? undefined,
      // Sparklines
      getSparklineRenderData,
      // Validation Error Indicators
      // Async-to-Sync fix — callbacks are now sync, no cast needed
      hasValidationErrors,
      // Floating Objects
      floatingObjectState: getFloatingObjectState?.(),
      getFloatingObjects,
      getFloatingObjectBounds,
      getAllObjectBounds,
      // Grouping/Outline
      getGroupingConfig,
      getRowGroups,
      getColumnGroups,
      getRowOutlineLevels: getRowOutlineLevels as RenderContextConfig['getRowOutlineLevels'],
      getColumnOutlineLevels:
        getColumnOutlineLevels as RenderContextConfig['getColumnOutlineLevels'],
      maxRowOutlineLevel: config.maxRowOutlineLevel ?? 0,
      maxColOutlineLevel: config.maxColOutlineLevel ?? 0,
      // Formula Auditing
      traceArrows: getTraceArrows?.() ?? [],
      getCellPosition: getCellPositionForTrace,
      // Font Preview
      previewFont: getPreviewFont?.() ?? null,
      // Charts
      renderChart,
      // Binary Viewport — resolve lazily so checkout materialization swaps cannot
      // leave the cells layer pinned to a pre-checkout compute bridge.
      binaryCellReader: getBinaryCellReader?.() ?? undefined,
      binaryCellReaderForViewport: getBinaryCellReaderForViewport,
    };

    // Call the coordinator's update method directly (not via machine event)
    onContextUpdate(contextConfig);

    const timer = setTimeout(() => {
      followerRefreshTimers.delete(timer);
      if (disposed || generation !== contextUpdateGeneration) return;

      const readFollower = <T>(
        read: (() => T | Promise<T> | undefined) | undefined,
        fallback: T,
      ): Promise<T> => {
        try {
          return Promise.resolve(read?.()).then((value) => value ?? fallback);
        } catch (err) {
          return Promise.reject(err);
        }
      };

      void Promise.all([
        readFollower(getPageBreaks, { rowBreaks: [], colBreaks: [] }),
        readFollower(getAutoPageBreaks, { rowBreaks: [], colBreaks: [] }),
        readFollower(getPrintArea, null),
        readFollower(getSearchHighlights, []),
      ])
        .then(([pageBreaks, autoPageBreaks, printArea, searchHighlights]) => {
          if (disposed || generation !== contextUpdateGeneration) return;
          onContextUpdate({
            pageBreaks,
            autoPageBreaks,
            printArea,
            searchHighlights,
          });
        })
        .catch((err) => {
          if (disposed) return;
          console.warn('[RenderContextCoordination] follower context refresh failed', err);
        });
    }, 120);
    followerRefreshTimers.add(timer);
  };

  // Subscribe to selection changes
  // Use transition detection pattern to avoid firing on every emission
  let previousSelectionState: SelectionState | null = null;
  const selectionSub = selectionActor.subscribe((state) => {
    // On first emission, always send update
    if (!previousSelectionState) {
      sendContextUpdate();
      previousSelectionState = state;
      return;
    }

    // Check if anything meaningful changed that would affect rendering
    const prev = previousSelectionState.context;
    const curr = state.context;

    // Compare ranges (most common change)
    const prevRanges = selectionSelectors.ranges(previousSelectionState);
    const currRanges = selectionSelectors.ranges(state);
    const rangesChanged =
      prevRanges.length !== currRanges.length ||
      prevRanges.some((r, i) => {
        const currRange = currRanges[i];
        return !currRange || !rangesEqual(r, currRange);
      });

    // Compare active cell
    const activeCellChanged =
      prev.activeCell.row !== curr.activeCell.row || prev.activeCell.col !== curr.activeCell.col;

    // Compare machine state (selecting, dragging, etc.)
    const stateChanged = previousSelectionState.value !== state.value;

    // Compare fill handle state
    const fillHandleChanged =
      prev.fillHandleStart?.row !== curr.fillHandleStart?.row ||
      prev.fillHandleStart?.col !== curr.fillHandleStart?.col ||
      prev.fillHandleEnd?.row !== curr.fillHandleEnd?.row ||
      prev.fillHandleEnd?.col !== curr.fillHandleEnd?.col;

    // Compare drag-drop state
    const dragChanged =
      prev.dragTargetCell?.row !== curr.dragTargetCell?.row ||
      prev.dragTargetCell?.col !== curr.dragTargetCell?.col ||
      prev.dragMode !== curr.dragMode;

    // Compare resize state
    const resizeChanged =
      prev.resizeCurrentSize !== curr.resizeCurrentSize ||
      prev.resizeType !== curr.resizeType ||
      prev.resizeIndex !== curr.resizeIndex;

    // Compare table resize state
    const tableResizeChanged =
      prev.tableResizeId !== curr.tableResizeId ||
      prev.tableResizeTargetRow !== curr.tableResizeTargetRow ||
      prev.tableResizeTargetCol !== curr.tableResizeTargetCol;

    // Only send update if something actually changed
    if (
      rangesChanged ||
      activeCellChanged ||
      stateChanged ||
      fillHandleChanged ||
      dragChanged ||
      resizeChanged ||
      tableResizeChanged
    ) {
      sendContextUpdate();
    }

    previousSelectionState = state;
  });
  cleanupFns.push(() => selectionSub.unsubscribe());

  // Subscribe to editor changes
  // PERFORMANCE FIX: Use transition detection pattern to avoid firing on every XState emission.
  // Only send updates when state that affects rendering actually changes.
  let previousEditorState: EditorState | null = null;
  const editorSub = editorActor.subscribe((state) => {
    // On first emission, always send update
    if (!previousEditorState) {
      sendContextUpdate();
      previousEditorState = state;
      return;
    }

    // Check if anything meaningful for rendering changed
    const prev = previousEditorState.context;
    const curr = state.context;

    // Compare fields that affect canvas rendering
    const valueChanged = prev.value !== curr.value;
    const stateChanged = previousEditorState.value !== state.value;
    const cursorChanged = prev.cursorPosition !== curr.cursorPosition;
    const pickerChanged = prev.isPickerOpen !== curr.isPickerOpen;
    const sheetChanged = prev.sheetId !== curr.sheetId;

    if (valueChanged || stateChanged || cursorChanged || pickerChanged || sheetChanged) {
      sendContextUpdate();
    }
    previousEditorState = state;
  });
  cleanupFns.push(() => editorSub.unsubscribe());

  // Subscribe to clipboard changes
  // PERFORMANCE FIX: Use transition detection pattern to avoid firing on every XState emission.
  // Only send updates when state that affects rendering actually changes.
  let previousClipboardState: ClipboardState | null = null;
  const clipboardSub = clipboardActor.subscribe((state) => {
    // On first emission, always send update
    if (!previousClipboardState) {
      sendContextUpdate();
      previousClipboardState = state;
      return;
    }

    // Check if anything meaningful for rendering changed
    const prev = previousClipboardState.context;
    const curr = state.context;

    // Compare fields that affect canvas rendering (marching ants, cut/copy highlight)
    const stateChanged = previousClipboardState.value !== state.value;
    const phaseChanged = prev.marchingAntsPhase !== curr.marchingAntsPhase;
    const rangesChanged =
      prev.sourceRanges?.length !== curr.sourceRanges?.length ||
      (prev.sourceRanges &&
        curr.sourceRanges &&
        prev.sourceRanges.some((r, i) => {
          const currRange = curr.sourceRanges![i];
          return !currRange || !rangesEqual(r, currRange);
        }));

    if (stateChanged || phaseChanged || rangesChanged) {
      sendContextUpdate();
    }
    previousClipboardState = state;
  });
  cleanupFns.push(() => clipboardSub.unsubscribe());

  // Subscribe to object interaction changes (drag, resize, rotate)
  // This triggers re-renders when floating object interaction state changes,
  // enabling smooth 60fps visual feedback during drag operations.
  // Without this subscription, the overlay layer never receives updated
  // dragStart/dragCurrent values and cannot render drag previews.
  // PERFORMANCE FIX: Use transition detection pattern to avoid firing on every XState emission.
  if (objectInteractionActor) {
    let previousObjectState: ObjectInteractionStateValue | null = null;
    const objectInteractionSub = objectInteractionActor.subscribe((state) => {
      // On first emission, always send update
      if (!previousObjectState) {
        sendContextUpdate();
        previousObjectState = state;
        return;
      }

      // Check if anything meaningful for rendering changed
      const prev = previousObjectState.context;
      const curr = state.context;

      // Compare fields that affect canvas rendering
      const stateChanged = previousObjectState.value !== state.value;
      const selectionChanged =
        prev.selectedIds.length !== curr.selectedIds.length ||
        prev.selectedIds.some((id, i) => curr.selectedIds[i] !== id);
      const handleChanged = prev.activeHandle !== curr.activeHandle;
      const operationChanged = prev.operation !== curr.operation;
      const editingChanged = prev.editingObjectId !== curr.editingObjectId;

      if (stateChanged || selectionChanged || handleChanged || operationChanged || editingChanged) {
        sendContextUpdate();
      }
      previousObjectState = state;
    });
    cleanupFns.push(() => objectInteractionSub.unsubscribe());
  }

  // Subscribe to page break drag state changes
  // This triggers re-renders when page break drag state changes,
  // enabling smooth 60fps visual feedback during drag operations.
  // Without this subscription, the page break layer never receives
  // updated targetPosition values and cannot render drag previews.
  // PERFORMANCE FIX: Use transition detection pattern to avoid firing on every XState emission.
  if (pageBreakActor) {
    let previousPageBreakState: PageBreakState | null = null;
    const pageBreakSub = pageBreakActor.subscribe((state) => {
      // On first emission, always send update
      if (!previousPageBreakState) {
        sendContextUpdate();
        previousPageBreakState = state;
        return;
      }

      // Check if anything meaningful for rendering changed
      const prev = previousPageBreakState.context;
      const curr = state.context;

      // Compare fields that affect canvas rendering
      const stateChanged = previousPageBreakState.value !== state.value;
      const targetChanged = prev.targetPosition !== curr.targetPosition;
      const pageBreakChanged =
        prev.pageBreak?.originalPosition !== curr.pageBreak?.originalPosition;

      if (stateChanged || targetChanged || pageBreakChanged) {
        sendContextUpdate();
      }
      previousPageBreakState = state;
    });
    cleanupFns.push(() => pageBreakSub.unsubscribe());
  }

  // Subscribe to renderer becoming ready (to send initial context)
  const rendererSub = rendererActor.subscribe((state: RendererState) => {
    // When renderer just became ready, send initial context
    if (state.value === 'ready') {
      lifecycleDebug.stateEvent('Renderer became ready (subscription fired)', {
        sheetId: state.context.currentSheetId,
      });
      sendContextUpdate();
    }
  });
  cleanupFns.push(() => rendererSub.unsubscribe());

  // Log what state the renderer is in when coordination is set up
  const currentRendererState = rendererActor.getSnapshot();
  lifecycleDebug.renderContextCoordinationSetup(currentRendererState.value as string);

  // CRITICAL: Send initial context immediately if renderer is already ready.
  // XState subscriptions only trigger on state CHANGES. If this coordination
  // is set up AFTER the renderer has already transitioned to 'ready' state
  // (due to React effect timing), the subscription callback never fires and
  // the grid renders blank. sendContextUpdate() safely no-ops if renderer
  // isn't ready yet.
  // @see ISSUE-15-RENDER-CONTEXT-TIMING-RACE.md
  lifecycleDebug.stateEvent('About to call initial sendContextUpdate()');
  sendContextUpdate();

  return () => {
    disposed = true;
    contextUpdateGeneration++;
    for (const timer of followerRefreshTimers) {
      clearTimeout(timer);
    }
    followerRefreshTimers.clear();
    cleanupFns.forEach((fn) => fn());
  };
}
