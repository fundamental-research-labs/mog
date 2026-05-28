/**
 * useRenderContextConfig Effect Hook
 *
 * Wires up automatic context updates from state machines to the renderer.
 * This replaces manual updateContext() calls in the 'ready' case.
 * The coordinator subscribes to selection/editor/clipboard changes and
 * sends UPDATE_CONTEXT events to the renderer automatically.
 *
 * This is the largest integration effect, containing all the callbacks
 * for cell rendering, floating objects, search highlights, and more.
 *
 * @see RENDERER-INSTANCE-OWNERSHIP.md - Cross-Coordination for Context Updates
 * @see 09-SPREADSHEET-GRID-DECOMPOSITION.md
 */

import { useEffect, useRef } from 'react';

import type { FloatingObjectRenderState, ObjectBounds } from '@mog/grid-canvas';
import type { ChartBounds } from '@mog-sdk/contracts/bridges';
import type { PageBreakEntry } from '@mog-sdk/contracts/rendering';
import type { BinaryCellReader } from '@mog-sdk/contracts/api';
import {
  sheetId as toSheetId,
  type CellFormat,
  type CellRange,
  type SheetId,
} from '@mog-sdk/contracts/core';
import type { FilterHeaderInfo } from '@mog-sdk/contracts/filter';
import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type {
  GroupDefinition,
  OutlineLevel,
  SheetGroupingConfig,
} from '@mog-sdk/contracts/grouping';
import type { CellCoord, RemoteCursor, ShimmerEffectType } from '@mog-sdk/contracts/rendering';
import type { SearchHighlight } from '@mog-sdk/contracts/search';
import type { SparklineRenderData } from '@mog-sdk/contracts/sparklines';
import type { TableConfig } from '@mog-sdk/contracts/tables';
import type { TraceArrow } from '@mog-sdk/contracts/trace-arrows';
import type { SheetCoordinator } from '../../../coordinator/sheet-coordinator';
import { lifecycleDebug } from '../../../systems/renderer/debug/debug-lifecycle';

/**
 * Configuration for paste preview state.
 */
interface PastePreview {
  isActive: boolean;
  targetRange: CellRange;
  cells: Array<{
    row: number;
    col: number;
    displayValue: string;
    format?: Partial<CellFormat>;
    hasFormula?: boolean;
  }>;
}

/**
 * Options for the useRenderContextConfig hook.
 */
export interface UseRenderContextConfigOptions {
  /** The sheet coordinator instance */
  coordinator: SheetCoordinator;

  // ═══════════════════════════════════════════════════════════════════════════
  // COLLABORATION
  // ═══════════════════════════════════════════════════════════════════════════

  /** Remote cursors from collaboration awareness */
  remoteCursors: RemoteCursor[];

  // ═══════════════════════════════════════════════════════════════════════════
  // CELL DATA CALLBACKS (sheet-aware)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get cell display value (sheet-aware) */
  getCellValue: (sheetId: SheetId, cell: CellCoord) => unknown;
  /** Get cell format (sheet-aware) */
  getCellFormat: (sheetId: SheetId, cell: CellCoord) => CellFormat | undefined;

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLES & FILTERS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get table config at cell (Tables) */
  getTableAtCell: (
    sheetId: SheetId,
    cell: CellCoord,
  ) => TableConfig | undefined | Promise<TableConfig | undefined>;
  /** Get resolved table range (handles Cell Identity Model) */
  getResolvedTableRange: (table: TableConfig) => CellRange | null;
  /** Get filter header info (Filter UI) */
  getFilterHeaderInfo: (
    sheetId: SheetId,
    cell: CellCoord,
  ) => FilterHeaderInfo | undefined | Promise<FilterHeaderInfo | undefined>;
  /** Check if table column has filter (Tables - 10.2 Funnel Icon) */
  hasTableColumnFilter: (
    sheetId: SheetId,
    tableId: string,
    headerRow: number,
    headerCol: number,
  ) => boolean | Promise<boolean>;

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE BREAK PREVIEW & PRINT
  // ═══════════════════════════════════════════════════════════════════════════

  /** Page break preview mode state */
  pageBreakPreviewMode: boolean;
  /** Get page breaks for current sheet */
  getPageBreaks: () =>
    | { rowBreaks: PageBreakEntry[]; colBreaks: PageBreakEntry[] }
    | Promise<{ rowBreaks: PageBreakEntry[]; colBreaks: PageBreakEntry[] }>;
  /** Get automatic page breaks (15.4, 15.5) */
  getAutoPageBreaks: () =>
    | { rowBreaks: PageBreakEntry[]; colBreaks: PageBreakEntry[] }
    | Promise<{ rowBreaks: PageBreakEntry[]; colBreaks: PageBreakEntry[] }>;
  /** Get print area for current sheet */
  getPrintArea: () =>
    | { startRow: number; startCol: number; endRow: number; endCol: number }
    | null
    | Promise<{ startRow: number; startCol: number; endRow: number; endCol: number } | null>;

  // ═══════════════════════════════════════════════════════════════════════════
  // SPARKLINES
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get sparkline render data (Sparklines) */
  getSparklineRenderData: (sheetId: SheetId, cell: CellCoord) => SparklineRenderData | undefined;

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /** Check if cell has validation errors */
  hasValidationErrors: (sheetId: SheetId, cell: CellCoord) => boolean;

  // ═══════════════════════════════════════════════════════════════════════════
  // FLOATING OBJECTS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get floating object interaction state */
  getFloatingObjectState: () => FloatingObjectRenderState;
  /** Get floating objects in current sheet */
  getFloatingObjects: () => FloatingObject[];
  /** Get computed bounds for a floating object */
  getFloatingObjectBounds: (objectId: string) => Promise<ObjectBounds | null> | ObjectBounds | null;
  /** Batch-fetch bounds for all objects on the current sheet (single IPC call) */
  getAllObjectBounds: () => Promise<Map<string, ObjectBounds>> | Map<string, ObjectBounds>;
  // ═══════════════════════════════════════════════════════════════════════════
  // FIND & REPLACE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get search highlights for current sheet */
  getSearchHighlights: () => SearchHighlight[] | Promise<SearchHighlight[]>;

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUPING/OUTLINE (Row/Column Grouping)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get grouping configuration for the current sheet */
  getGroupingConfig: () => SheetGroupingConfig | null;
  /** Get row groups for the current sheet */
  getRowGroups: () => GroupDefinition[];
  /** Get column groups for the current sheet */
  getColumnGroups: () => GroupDefinition[];
  /** Get row outline levels for rendering */
  getRowOutlineLevels: (
    startRow: number,
    endRow: number,
  ) => OutlineLevel[] | Promise<OutlineLevel[]>;
  /** Get column outline levels for rendering */
  getColumnOutlineLevels: (
    startCol: number,
    endCol: number,
  ) => OutlineLevel[] | Promise<OutlineLevel[]>;
  /** Maximum row outline level (0 if no row groups) */
  maxRowOutlineLevel: number;
  /** Maximum column outline level (0 if no column groups) */
  maxColOutlineLevel: number;

  // ═══════════════════════════════════════════════════════════════════════════
  // FORMULA AUDITING
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get trace arrows for current sheet */
  getTraceArrows: () => TraceArrow[];
  /** Resolve CellId to position for rendering trace arrows */
  getCellPositionForTrace: (cellId: string) => { row: number; col: number; sheet: string } | null;

  // ═══════════════════════════════════════════════════════════════════════════
  // CHARTS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Render a chart to canvas via ChartBridge */
  renderChart: (chartId: string, ctx: CanvasRenderingContext2D, bounds: ChartBounds) => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // BINARY VIEWPORT
  // ═══════════════════════════════════════════════════════════════════════════

  /** Optional binary cell reader for the cells layer hot path.
   * When set, flag-based booleans and display text are read from the binary
   * viewport buffer instead of individual CellDataSource calls. */
  binaryCellReader?: BinaryCellReader | null;

  /** Per-viewport binary cell reader resolver. */
  binaryCellReaderForViewport?: ((viewportId: string) => BinaryCellReader | undefined) | null;

  // ═══════════════════════════════════════════════════════════════════════════
  // PASTE PREVIEW
  // ═══════════════════════════════════════════════════════════════════════════

  /** UI store API for paste preview, Flash Fill preview, table preview, font preview, and shimmer state */
  uiStoreApi: {
    getState: () => {
      pastePreview: {
        isActive: boolean;
        targetRange: CellRange | null;
        previewCells: PastePreview['cells'];
      };
      flashFillPreview: {
        isShowingPreview: boolean;
        previewValues: Array<{ row: number; col: number; value: unknown }>;
        patternDescription: string | null;
      };
      // Table preview range for Create Table dialog
      tablePreviewRange: CellRange | null;
      // Font Preview
      previewFont: string | null;
      // Shimmer visual feedback on agent-changed cells
      shimmerEntries: readonly { range: CellRange; startTime: number; sheetId: string }[];
      shimmerEnabled: boolean;
      shimmerEffect: ShimmerEffectType;
      shimmerDurationMs: number;
    };
    subscribe: (listener: () => void) => () => void;
  };
}

/**
 * Sets up render context configuration for the coordinator.
 *
 * This effect wires up all the callbacks needed for cell rendering,
 * floating objects, search highlights, and more. The coordinator
 * uses these callbacks to build the render context when state changes.
 *
 * @param options - Configuration options
 */
export function useRenderContextConfig(options: UseRenderContextConfigOptions): void {
  // Store all options in a ref so callbacks always read the latest values.
  // This eliminates the 35-dep useEffect — the effect runs once per coordinator,
  // and all callbacks read from optionsRef.current at call time.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const { coordinator } = options;

  useEffect(() => {
    lifecycleDebug.setRenderContextConfig();

    // All callbacks are stable wrappers that delegate to optionsRef.current.
    // setupRenderContextCoordination destructures these at setup time and closes
    // over them in sendContextUpdate — since they're stable wrappers that read
    // from the ref, they always return current values when called.
    // workspace-internal: migration pending — setContextConfig pushes
    // 30+ data-source callbacks (getCellValue, getCellFormat, getFloatingObjects,
    // etc.) into the renderer's internal RenderContextConfig. These are data
    // plumbing, not visual state, so they don't map to renderState.update().
    // Migration needs a dedicated data-source capability on SheetView that
    // accepts callback registration for cell data, floating objects, tables,
    // sparklines, charts, grouping, search highlights, trace arrows, etc.
    coordinator.renderer.setContextConfig({
      workbook: coordinator.workbook!,
      // Actor refs (stable — owned by coordinator)
      selectionActor: coordinator.grid.access.actors.selection,
      editorActor: coordinator.grid.access.actors.editor,
      clipboardActor: coordinator.grid.access.actors.clipboard,
      rendererActor: coordinator.renderer.access.actors.renderer,
      objectInteractionActor: coordinator.objects.access.actors.object,
      pageBreakActor: coordinator.renderer.access.actors.pageBreak,
      // Context update callback (delegates to renderer execution layer)
      onContextUpdate: (config) => coordinator.renderer.updateContext(config),
      // Page break drag state
      getPageBreakDragState: () => coordinator.renderer.getPageBreakDragState(),
      // Ref-reading wrappers for all callback-based configuration
      getRemoteCursors: () => optionsRef.current.remoteCursors,
      getCellValue: (sheetId, cell) => optionsRef.current.getCellValue(toSheetId(sheetId), cell),
      getCellFormat: (sheetId, cell) => optionsRef.current.getCellFormat(toSheetId(sheetId), cell),
      // Tables - for table header/banded row styling
      getTableAtCell: (sheetId, cell) =>
        optionsRef.current.getTableAtCell(toSheetId(sheetId), cell),
      // Resolved table range for Cell Identity Model
      getResolvedTableRange: (table) => optionsRef.current.getResolvedTableRange(table),
      // Filters
      getFilterHeaderInfo: (sheetId, cell) =>
        optionsRef.current.getFilterHeaderInfo(toSheetId(sheetId), cell),
      // Tables - 10.2 Funnel Icon for Active Filters
      hasTableColumnFilter: (sheetId, tableId, headerRow, headerCol) =>
        optionsRef.current.hasTableColumnFilter(toSheetId(sheetId), tableId, headerRow, headerCol),
      // Page Break Preview
      getPageBreakPreviewMode: () => optionsRef.current.pageBreakPreviewMode,
      getPageBreaks: () => optionsRef.current.getPageBreaks(),
      // 15-PRINT-EXPORT: Items 15.4 and 15.5 - Auto Page Break Visualization
      getAutoPageBreaks: () => optionsRef.current.getAutoPageBreaks(),
      getPrintArea: () => optionsRef.current.getPrintArea(),
      // Sparklines
      getSparklineRenderData: (sheetId, cell) =>
        optionsRef.current.getSparklineRenderData(toSheetId(sheetId), cell),
      // Validation Error Indicators
      hasValidationErrors: (sheetId, cell) =>
        optionsRef.current.hasValidationErrors(toSheetId(sheetId), cell),
      // Floating Objects
      getFloatingObjectState: () => optionsRef.current.getFloatingObjectState(),
      getFloatingObjects: () => optionsRef.current.getFloatingObjects(),
      getFloatingObjectBounds: (objectId) => optionsRef.current.getFloatingObjectBounds(objectId),
      getAllObjectBounds: () => optionsRef.current.getAllObjectBounds(),
      // Find & Replace
      getSearchHighlights: () => optionsRef.current.getSearchHighlights(),
      // Grouping/Outline
      getGroupingConfig: () => optionsRef.current.getGroupingConfig(),
      getRowGroups: () => optionsRef.current.getRowGroups(),
      getColumnGroups: () => optionsRef.current.getColumnGroups(),
      getRowOutlineLevels: (startRow, endRow) =>
        optionsRef.current.getRowOutlineLevels(startRow, endRow),
      getColumnOutlineLevels: (startCol, endCol) =>
        optionsRef.current.getColumnOutlineLevels(startCol, endCol),
      // Primitives read from ref via getter — coordination reads these from config directly
      maxRowOutlineLevel: optionsRef.current.maxRowOutlineLevel,
      maxColOutlineLevel: optionsRef.current.maxColOutlineLevel,
      // Formula Auditing
      getTraceArrows: () => optionsRef.current.getTraceArrows(),
      getCellPositionForTrace: (cellId) => optionsRef.current.getCellPositionForTrace(cellId),
      // Paste Preview on Hover
      getPastePreview: () => {
        const preview = optionsRef.current.uiStoreApi.getState().pastePreview;
        if (!preview.isActive || !preview.targetRange) {
          return null;
        }
        return {
          isActive: preview.isActive,
          targetRange: preview.targetRange,
          cells: preview.previewCells,
        };
      },
      // Flash Fill Preview
      getFlashFillPreview: () => {
        const preview = optionsRef.current.uiStoreApi.getState().flashFillPreview;
        if (!preview.isShowingPreview || preview.previewValues.length === 0) {
          return null;
        }
        return {
          isActive: preview.isShowingPreview,
          values: preview.previewValues,
          patternDescription: preview.patternDescription,
        };
      },
      // Table Preview Range for Create Table Dialog
      getTablePreviewRange: () => optionsRef.current.uiStoreApi.getState().tablePreviewRange,
      // Font Preview
      getPreviewFont: () => optionsRef.current.uiStoreApi.getState().previewFont,
      // Charts
      renderChart: (chartId, ctx, bounds) => optionsRef.current.renderChart(chartId, ctx, bounds),
      // Binary Viewport — read from config directly in coordination
      binaryCellReader: optionsRef.current.binaryCellReader ?? undefined,
      binaryCellReaderForViewport: optionsRef.current.binaryCellReaderForViewport,
    });

    // Subscribe to shimmer state changes in the UI store and push them
    // to the renderer. Shimmer entries change asynchronously (agent code
    // execution, auto-prune timers) so they need a push subscription
    // rather than being polled inside sendContextUpdate getters.
    let prevShimmerEntries = optionsRef.current.uiStoreApi.getState().shimmerEntries;
    const unsubscribeShimmer = optionsRef.current.uiStoreApi.subscribe(() => {
      const state = optionsRef.current.uiStoreApi.getState();
      const entries = state.shimmerEntries;
      if (entries !== prevShimmerEntries) {
        prevShimmerEntries = entries;
        coordinator.renderer.getRenderState()?.update({
          shimmer: {
            entries,
            enabled: state.shimmerEnabled,
            effect: state.shimmerEffect,
            durationMs: state.shimmerDurationMs,
          },
        });
      }
    });

    return () => {
      unsubscribeShimmer();
    };
  }, [coordinator]);

  // workspace-internal: migration pending — this updateContext call
  // pushes floating-object data callbacks when they change. Needs the same
  // data-source capability as setContextConfig above.
  useEffect(() => {
    coordinator.renderer.updateContext({
      getFloatingObjects: () => optionsRef.current.getFloatingObjects(),
      getFloatingObjectBounds: (objectId: string) =>
        optionsRef.current.getFloatingObjectBounds(objectId),
      getAllObjectBounds: () => optionsRef.current.getAllObjectBounds(),
    });
  }, [
    coordinator,
    options.getFloatingObjects,
    options.getFloatingObjectBounds,
    options.getAllObjectBounds,
  ]);

  // Push formula-auditing data directly to the renderer. Trace arrows are
  // ephemeral UI-store state and do not necessarily coincide with actor state
  // changes that drive the main render-context coordination path.
  useEffect(() => {
    coordinator.renderer.updateContext({
      traceArrows: options.getTraceArrows(),
      getCellPosition: (cellId: string) => optionsRef.current.getCellPositionForTrace(cellId),
    });
  }, [coordinator, options.getTraceArrows, options.getCellPositionForTrace]);

  // Push remote cursor updates directly to the renderer.
  // The main sendContextUpdate() only fires on actor state changes
  // (selection/editor/clipboard), so remote cursor changes from the
  // collab sidecar would never reach the canvas without this.
  useEffect(() => {
    if (options.remoteCursors.length > 0 || optionsRef.current.remoteCursors.length > 0) {
      coordinator.renderer.updateContext({
        remoteCursors: options.remoteCursors,
      });
    }
  }, [coordinator, options.remoteCursors]);
}
