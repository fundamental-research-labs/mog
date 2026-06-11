/**
 * SpreadsheetGrid Component
 *
 * The main grid component for rendering and interacting with the spreadsheet.
 * Uses XState state machines for all interactions and follows the
 * Controller/Hook/Component separation pattern.
 *
 * Architecture:
 * - Uses renderer state machine to control lifecycle
 * - State transitions drive behavior (not arbitrary useEffects)
 * - All business logic in state machine hooks
 * - Pure UI rendering
 * - Event delegation to hooks
 *
 * State Machine Lifecycle:
 * unmounted → MOUNT → waitingForLayout → LAYOUT_READY → initializing → INITIALIZED → ready
 *
 * @see ARCHITECTURE.md - Controller/Hook/Component Separation
 */

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';

import { printHandler, type PrintArea, type PrintOptions } from '@mog/print-export';
import { MAX_COLS, MAX_ROWS, type PaperSize, type SheetId } from '@mog-sdk/contracts/core';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type { PageBreakEntry } from '@mog-sdk/contracts/rendering';
import { getEffectiveHeaderDimensions } from '@mog/spreadsheet-utils/rendering/constants';
import type { TableConfig } from '@mog-sdk/contracts/tables';
import type { SplitViewportConfig } from '@mog-sdk/contracts/viewport-config';
// All reads use Worksheet/Workbook API or ViewportBuffer.
// Grouping outline levels computed locally from ws.outline.getState().
import type { OutlineLevel } from '@mog-sdk/contracts/grouping';
import { DEFAULT_SHEET_GROUPING_CONFIG } from '@mog-sdk/contracts/grouping';
import { useActiveSheetId, useUIStore, useUIStoreApi, useWorkbook } from '../../internal-api';
import {
  useClipboardEvents,
  useCoordinator,
  useEditorState,
  useGridKeyboard,
  useGridMouse,
  useRendererActions,
  useRendererStatus,
} from '../../hooks';
import { useCellMetadataCache } from '../../hooks/data/use-cell-metadata-cache';
import { useCFManager } from '../../hooks/data/use-cf-manager';
import { useFilterHeaderCache } from '../../hooks/data/use-filter-header-cache';
import { useGroupingState } from '../../hooks/data/use-grouping-state';
import { useHyperlinkTooltip } from '../../hooks/data/use-hyperlink-tooltip';
import { useHyperlinks } from '../../hooks/data/use-hyperlinks';
import { useSparklineManager } from '../../hooks/data/use-sparkline-manager';
import { useTableLayoutCache } from '../../hooks/data/use-table-layout-cache';
import { useFloatingObjectsInSheet } from '../../hooks/objects/use-floating-objects-in-sheet';
import { useWorkbookSettings } from '../../hooks/settings/use-workbook-settings';
import { useSheetViewOptions } from '../../hooks/view/use-sheet-view-options';
import { useSpreadsheetDisplayMode } from '../../hooks/view/use-display-mode';
import { CommentEvents } from '../../systems/grid-editing/machines/comment-machine';
// PERFORMANCE: Use granular input hooks instead of useInput()
// useInput() subscribes to scrollState (120 updates/sec during scroll)
// useInputState() subscribes only to machineState (changes on gesture boundaries)
import { ValidationErrorDialog } from '../../dialogs/data/ValidationErrorDialog';
import { ValidationWarningDialog } from '../../dialogs/data/ValidationWarningDialog';
import { FormulaErrorDialog } from '../../dialogs/formulas/FormulaErrorDialog';
import { useInputEventHandlers } from '../../hooks/editing/use-input-event-handlers';
import { useInputState } from '../../hooks/editing/use-input-state';
import { AccessibilityAnnouncer } from './AccessibilityAnnouncer';
import { HyperlinkTooltip } from './HyperlinkTooltip';
// Extracted dialog components
import { InputMessageOverlay } from './dialogs/InputMessageOverlay';
import { ProtectionDialogs } from './dialogs/ProtectionDialogs';
import { useEditorIntegration } from './effects/useEditorIntegration';
import { useGroupingIntegration } from './effects/useGroupingIntegration';
import { useInputListeners } from './effects/useInputListeners';
import { useRenderContextConfig } from './effects/useRenderContextConfig';
import { useRendererDependencies } from './effects/useRendererDependencies';
import { useRendererLifecycle } from './effects/useRendererLifecycle';
import { useRendererSync } from './effects/useRendererSync';
import { useRendererViewRestore } from './effects/useRendererViewRestore';
import { useSparklineCFIntegration } from './effects/useSparklineCFIntegration';
import { useCellDataCallbacks } from './hooks/useCellDataCallbacks';
// NOTE: useInputMessageTooltip is now called internally by InputMessageOverlay
// for render isolation - see docs/ARCHITECTURE-CHECKLIST.md Section 15
import { useScrollDimensions } from './hooks/useScrollDimensions';
import { useSearchHighlights } from './hooks/useSearchHighlights';
import { useTraceArrowsForRender } from './hooks/useTraceArrowsForRender';
// Extracted layout components
import { FontWarningToast } from './layout/FontWarningToast';
import { OverlayLayers } from './layout/OverlayLayers';
import { ScrollContainer } from './layout/ScrollContainer';
import { StatusOverlays } from './layout/StatusOverlays';
// Notifications
import { ToastRenderer } from '../notifications';
// Canvas Interactive Element Overlay - DOM triggers for canvas buttons
import { CanvasInteractiveOverlay, OutlineToggleOverlay } from '../canvas-overlays';
import { ViewportTableDataProvider } from './providers/ViewportTableDataProvider';
// Extracted editor components
import { GridContextMenuContent } from '../context-menu/GridContextMenuContent';
import { ContextMenu, ContextMenuTrigger } from '@mog/shell/components/ui';
import { AUTO_SCROLL_CURSOR } from '../../infra/styles/cursors';
import { DatePickerOverlay } from './editors/DatePickerOverlay';
import { InlineCellEditor } from './editors/InlineCellEditor';
import { InlineRichTextEditor } from './editors/InlineRichTextEditor';
import { InlineSliderEditor } from './editors/InlineSliderEditor';
import { ValidationDropdownOverlay } from './editors/ValidationDropdownOverlay';

import { useRemoteCursors } from '../../hooks/collab/useRemoteCursors';

function getOutlineSummaryIndex(start: number, end: number, summaryAfter: boolean): number {
  return summaryAfter ? end + 1 : start - 1;
}

// =============================================================================
// Types
// =============================================================================

export interface SpreadsheetGridProps {
  className?: string;
  /** Show FPS counter for debugging */
  showFps?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export const SpreadsheetGrid = memo(function SpreadsheetGrid({
  className,
  showFps = false,
}: SpreadsheetGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Get coordinator for setting renderer dependencies
  const coordinator = useCoordinator();

  // Cache invalidation callbacks — trigger canvas repaint instead of React re-render
  const onCellMetadataCacheUpdate = useCallback(() => {
    coordinator.renderer.invalidate('cell-metadata-cache');
  }, [coordinator]);

  const onFilterHeaderCacheUpdate = useCallback(() => {
    coordinator.renderer.invalidate('filter-header-cache');
  }, [coordinator]);

  const onTableLayoutCacheUpdate = useCallback(() => {
    coordinator.renderer.invalidate('table-layout-cache');
  }, [coordinator]);

  // PERFORMANCE: Use granular hooks instead of identity-selector hooks
  // useEditor()/useRenderer() have been completely eliminated from SpreadsheetGrid.
  // All child components now use granular hooks internally.
  const { isEditing } = useEditorState(); // Only re-renders when editing state changes
  const {
    status,
    isReady,
    currentSheetId: rendererSheetId,
    dimensions,
    error: rendererError,
  } = useRendererStatus(); // Only re-renders when tracked fields change
  const rendererActions = useRendererActions(); // Stable functions, no subscription

  // PERFORMANCE: Use granular input hooks instead of useInput()
  // useInput() subscribes to scrollState causing 842 re-renders/sec during scroll
  const { isPanning } = useInputState(); // Only re-renders on gesture boundary changes
  const inputEventHandlers = useInputEventHandlers(); // Stable event handlers for DOM binding

  // Get data from Workbook/Worksheet API
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);

  // PERFORMANCE: Subscribe only to active sheet's zoom level to prevent re-renders
  // when other sheets' zoom levels change
  const currentZoom = useUIStore((s) => s.zoomLevels[activeSheetId] ?? 1.0);
  const openEditSparklineDialog = useUIStore((s) => s.openEditSparklineDialog);

  // Get UI Store API for per-sheet scroll position restoration
  const uiStoreApi = useUIStoreApi();

  // Get hyperlink handling for click activation
  const hyperlinks = useHyperlinks();

  // Get sparkline manager (Sparklines)
  const { sparklineManager } = useSparklineManager();

  // Get CF manager (CF Rendering Integration)
  const { cfManager } = useCFManager();

  // Get cell metadata cache
  // Provides sync callbacks for projection + validation data in the render loop.
  // Viewport bounds use generous defaults; the cache internally reads
  // ViewportBuffer.getBounds() for the actual visible range.
  // MutationResultHandler registration moved into useCellMetadataCache hook.
  const { hasValidationErrors } = useCellMetadataCache({
    sheetId: activeSheetId,
    startRow: 0,
    startCol: 0,
    endRow: 200,
    endCol: 50,
    onCacheUpdate: onCellMetadataCacheUpdate,
  });

  // Get grouping state (Row/Column Grouping)
  // PERFORMANCE: useGroupingState does NOT subscribe to selection - prevents re-renders on cell click
  // @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
  const groupingState = useGroupingState();

  // Grouping callbacks for render context
  // These wrap groupingState and Grouping module functions for the renderer
  const getGroupingConfig = useCallback(
    () => groupingState.groupingConfig ?? null,
    [groupingState.groupingConfig],
  );
  const getRowGroups = useCallback(() => groupingState.rowGroups, [groupingState.rowGroups]);
  const getColumnGroups = useCallback(
    () => groupingState.columnGroups,
    [groupingState.columnGroups],
  );
  const getRowOutlineLevels = useCallback(
    (startRow: number, endRow: number): OutlineLevel[] => {
      const groups = groupingState.rowGroups;
      const summaryRowsBelow =
        groupingState.groupingConfig?.summaryRowsBelow ??
        DEFAULT_SHEET_GROUPING_CONFIG.summaryRowsBelow;
      const resolvedGroups = groups
        .map((g) => ({ group: g, range: { start: g.start, end: g.end } }))
        .filter((g) => g.range !== null);
      const result: OutlineLevel[] = [];
      for (let row = startRow; row <= endRow; row++) {
        const containing = resolvedGroups.filter(
          ({ range }) => row >= range.start && row <= range.end,
        );
        const summaryGroups = resolvedGroups.filter(
          ({ range }) => row === getOutlineSummaryIndex(range.start, range.end, summaryRowsBelow),
        );
        const level =
          containing.length > 0 ? Math.max(...containing.map(({ group }) => group.level)) : 0;
        const visible = !containing.some(({ group }) => group.collapsed);
        const isSummary = summaryGroups.length > 0;
        const groupIds = [...containing, ...summaryGroups]
          .sort((a, b) => b.group.level - a.group.level)
          .map(({ group }) => group.id);
        result.push({ index: row, level, visible, isSummary, groupIds });
      }
      return result;
    },
    [groupingState.rowGroups, groupingState.groupingConfig],
  );
  const getColumnOutlineLevels = useCallback(
    (startCol: number, endCol: number): OutlineLevel[] => {
      const groups = groupingState.columnGroups;
      const summaryColumnsRight =
        groupingState.groupingConfig?.summaryColumnsRight ??
        DEFAULT_SHEET_GROUPING_CONFIG.summaryColumnsRight;
      const resolvedGroups = groups
        .map((g) => ({ group: g, range: { start: g.start, end: g.end } }))
        .filter((g) => g.range !== null);
      const result: OutlineLevel[] = [];
      for (let col = startCol; col <= endCol; col++) {
        const containing = resolvedGroups.filter(
          ({ range }) => col >= range.start && col <= range.end,
        );
        const summaryGroups = resolvedGroups.filter(
          ({ range }) =>
            col === getOutlineSummaryIndex(range.start, range.end, summaryColumnsRight),
        );
        const level =
          containing.length > 0 ? Math.max(...containing.map(({ group }) => group.level)) : 0;
        const visible = !containing.some(({ group }) => group.collapsed);
        const isSummary = summaryGroups.length > 0;
        const groupIds = [...containing, ...summaryGroups]
          .sort((a, b) => b.group.level - a.group.level)
          .map(({ group }) => group.id);
        result.push({ index: col, level, visible, isSummary, groupIds });
      }
      return result;
    },
    [groupingState.columnGroups, groupingState.groupingConfig],
  );

  // Context menu state — openContextMenu stores hit-test target info,
  // Radix ContextMenu owns open/close state and positioning.
  const openContextMenu = useUIStore((s) => s.openContextMenu);
  const closeContextMenu = useUIStore((s) => s.closeContextMenu);
  const closeObjectContextMenu = useUIStore((s) => s.closeObjectContextMenu);

  // Get workbook settings for scrollbar visibility (Issue 7: View Options)
  const { settings: workbookSettings } = useWorkbookSettings();

  // Get sheet view options for header visibility (Canvas Interactive Element Layer)
  // Used to compute header offset for CanvasInteractiveOverlay positioning
  const { viewOptions } = useSheetViewOptions(activeSheetId);
  const { rendererSkin } = useSpreadsheetDisplayMode();

  // Compute header offset for CanvasInteractiveOverlay
  // The overlay needs to be positioned after row/column headers
  const headerOffset = useMemo(() => {
    const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions({
      showRowHeaders: viewOptions.showRowHeaders,
      showColumnHeaders: viewOptions.showColumnHeaders,
    });
    return { x: rowHeaderWidth, y: colHeaderHeight };
  }, [viewOptions.showRowHeaders, viewOptions.showColumnHeaders]);

  // Protection alert dialog state
  // @see STREAM-H-EDITOR-PROTECTION.md
  const protectionAlertOpen = useUIStore((s) => s.protectionAlertOpen);
  const protectionAlertMessage = useUIStore((s) => s.protectionAlertMessage);
  const dismissProtectionAlert = useUIStore((s) => s.dismissProtectionAlert);

  // ==========================================================================
  // FEATURE HOOKS
  // High-level hooks that compose state hooks for keyboard/mouse handling.
  // @see HOOKS-ARCHITECTURE-CONSOLIDATION.md
  // ==========================================================================

  // Keyboard handling hook
  // All shortcuts are handled by KeyboardCoordinator via the registry
  const keyboard = useGridKeyboard({ activeSheetId });

  // ==========================================================================
  // HYPERLINK TOOLTIP STATE
  // Manages hyperlink tooltip visibility and content based on cell hover.
  // ==========================================================================
  const hyperlinkTooltip = useHyperlinkTooltip();

  // ==========================================================================
  // COMMENT INDICATOR CLICK HANDLER
  // Opens comment popover when clicking on the red comment indicator triangle.
  // ==========================================================================
  const handleCommentIndicatorClick = useCallback(
    async (cell: { row: number; col: number }, _screenPosition: { x: number; y: number }) => {
      const commentActor = coordinator.grid.access.actors.comment;
      if (!commentActor) return;

      // Get CellId for the clicked cell via Worksheet API
      const ws = wb.getSheetById(activeSheetId);
      const cellId = await ws._internal.getCellIdAt(cell.row, cell.col);
      if (!cellId) return;

      // Send CLICK_CELL event to open the comment popover
      commentActor.send(
        CommentEvents.clickCell({
          cellId: toCellId(cellId),
          sheetId: activeSheetId,
          row: cell.row,
          col: cell.col,
        }),
      );
    },
    [coordinator, wb, activeSheetId],
  );

  // Mouse handling hook
  // NOTE: Filter button clicks are now handled by DOM overlays (FilterButtonOverlay)
  // via CanvasInteractiveOverlay, not canvas click detection.
  const mouse = useGridMouse({
    activeSheetId,
    containerRef,
    coordinator,
    onHyperlinkClick: hyperlinks.handleClick,
    onContextMenu: openContextMenu,
    groupingActions: {
      maxRowLevel: groupingState.maxRowLevel,
      maxColLevel: groupingState.maxColLevel,
      setLevelCollapsed: groupingState.setLevelCollapsed,
      toggleGroupCollapsed: groupingState.toggleGroupCollapsed,
    },
    sparklineManager,
    onEditSparkline: openEditSparklineDialog,
    // Hyperlink tooltip on cell hover
    onCellHover: hyperlinkTooltip.handleCellHover,
    // Comment indicator click to open comment popover
    onCommentIndicatorClick: handleCommentIndicatorClick,
  });

  // Clipboard events hook - handles native copy/cut/paste events
  // This is the SINGLE entry point for clipboard operations.
  // Keyboard shortcuts (Cmd+C/X/V) trigger native clipboard events which are handled here.
  useClipboardEvents({
    enabled: true,
    containerRef,
  });

  // Remote cursors from collab sidecar presence
  const remoteCursors = useRemoteCursors();

  // ViewportPositionIndex + ViewportMergeIndex created by renderer execution.
  // We pass the viewport directly to useRendererDependencies.
  const activeViewport = useMemo(() => {
    return wb.getSheetById(activeSheetId).viewport;
  }, [wb, activeSheetId]);

  // NOTE: useInputMessageTooltip is now called internally by InputMessageOverlay
  // for render isolation - see docs/ARCHITECTURE-CHECKLIST.md Section 15

  // ==========================================================================
  // SHEET-AWARE CELL DATA CALLBACKS
  // These callbacks receive sheetId at call time from RenderContext.currentSheetId.
  // This eliminates stale closure bugs when sheets switch - the renderer machine's
  // currentSheetId is the authoritative source, not React's activeSheetId.
  // @see SHEET-AWARE-CELL-DATA-CALLBACKS.md
  // Use domain modules (Cells, Properties)
  // ==========================================================================
  const { getCellValue, getCellFormat, getSparklineRenderData } = useCellDataCallbacks({
    viewport: ws.viewport,
    sparklineManager,
  });

  // ==========================================================================
  // SET RENDERER DEPENDENCIES EFFECT
  // Provides viewport + data callbacks to the state machine so SheetView
  // (created in the 'initializing' state) can resolve the current sheet's
  // ViewportReader and pull cell data on demand.
  // Must run before MOUNT so dependencies are available when machine needs them.
  // ==========================================================================
  // Sync SheetStateProvider backed by the kernel state mirror.
  // The mirror is populated by `MutationResultHandler.applyAndNotify` BEFORE
  // any event emission, so reads are correct on first paint and on every
  // subsequent re-read. Hydration's first MutationResult populates the mirror
  // before `documentReady` resolves, so initial render also has fresh values.
  const sheetStateProvider = useMemo(
    () => ({
      getFrozenPanes: (sheetId: string) => wb.mirror.getFrozenPanes(sheetId as SheetId),
      getSheetViewOptions: (sheetId: string) => wb.mirror.getViewOptions(sheetId as SheetId),
      getCulture: () => wb.mirror.getCulture(),
      getSplitConfig: (sheetId: string) => {
        // Mirror returns the structured `MirrorSplitConfig | null`. The renderer
        // expects the public `SplitViewportConfig | null`. They share the same
        // direction/horizontalPosition/verticalPosition fields, so the cast is
        // structural.
        const cfg = wb.mirror.getSplitConfig(sheetId as SheetId);
        return cfg as unknown as SplitViewportConfig | null;
      },
      getScrollPosition: (sheetId: string) => wb.mirror.getScrollPosition(sheetId as SheetId),
    }),
    [wb],
  );

  useRendererViewRestore({
    wb,
    activeSheetId,
    coordinator,
    isReady,
    rendererSheetId,
    uiStoreApi,
    rendererSkin,
  });

  // Use extracted hook for renderer dependencies
  useRendererDependencies({
    coordinator,
    viewport: activeViewport,
    getCellValue,
    getCellFormat,
    activeSheetId,
    workbookSettings,
    sheetStateProvider,
    rendererSkin,
    uiStoreApi,
  });

  // ==========================================================================
  // SET RENDER CONTEXT COORDINATION EFFECT
  // Wires up automatic context updates from state machines to the renderer.
  // This replaces manual updateContext() calls in the 'ready' case.
  // The coordinator subscribes to selection/editor/clipboard changes and
  // sends UPDATE_CONTEXT events to the renderer automatically.
  // ==========================================================================
  // Get page break preview mode from UI store
  const pageBreakPreviewMode = useUIStore((s) => s.pageBreakPreviewMode);

  // Callback to check if a cell is a checkbox cell
  // Use ViewportReader schema_type for sync checkbox detection.
  // hasValidationErrors is now provided by useCellMetadataCache

  // Callback to get resolved table range (Cell Identity Model)
  // Inlined - resolveTableRange just returns table.range ?? null
  const getResolvedTableRangeCallback = useCallback((table: TableConfig) => {
    return table.range ?? null;
  }, []);

  // Floating object callbacks for render context
  const getFloatingObjectState = useCallback(() => {
    const snapshot = coordinator.objects.getObjectInteractionSnapshot();
    // Compute insertion preview bounds from start/current positions
    let insertionPreview: { x: number; y: number; width: number; height: number } | null = null;
    if (snapshot.insertStartPosition && snapshot.insertCurrentPosition) {
      const x = Math.min(snapshot.insertStartPosition.x, snapshot.insertCurrentPosition.x);
      const y = Math.min(snapshot.insertStartPosition.y, snapshot.insertCurrentPosition.y);
      const width = Math.abs(snapshot.insertCurrentPosition.x - snapshot.insertStartPosition.x);
      const height = Math.abs(snapshot.insertCurrentPosition.y - snapshot.insertStartPosition.y);
      insertionPreview = { x, y, width, height };
    }
    // Map ObjectInteractionSnapshot -> FloatingObjectRenderState
    return {
      selectedIds: snapshot.selectedIds,
      interactionState:
        snapshot.state as import('@mog-sdk/contracts/floating-objects').ObjectInteractionState,
      activeHandle: snapshot.activeHandle,
      shiftKey: snapshot.shiftKey,
      operation: null, // Operation details resolved by effective state service during rendering
      insertionPreview,
    };
  }, [coordinator]);

  const floatingObjects = useFloatingObjectsInSheet(activeSheetId);

  const getFloatingObjects = useCallback(() => floatingObjects, [floatingObjects]);

  const getFloatingObjectBounds = useCallback(
    async (objectId: string) => {
      return await ws.objects.computeObjectBounds(objectId);
    },
    [ws],
  );

  const getAllObjectBounds = useCallback(async () => {
    return await ws.objects.computeAllObjectBounds();
  }, [ws]);

  // ==========================================================================
  // FIND & REPLACE SEARCH HIGHLIGHTS
  // Resolves CellId-based search results to row/col positions for canvas rendering.
  //
  // ARCHITECTURE (Cell Identity):
  // - Find-replace machine stores results with CellIds (stable identity)
  // - This callback resolves CellId → position at render time via GridIndex
  // - Canvas layer receives row/col (doesn't know about CellId)
  //
  // ==========================================================================
  const getSearchHighlights = useSearchHighlights({
    coordinator,
    activeSheetId,
  });

  // ==========================================================================
  // FORMULA AUDITING
  // Provides trace arrows and CellId position lookup for canvas rendering.
  //
  // ARCHITECTURE (Cell Identity):
  // - UIStore stores arrows with CellIds (stable identity)
  // - getCellPositionForTrace resolves CellId → position at render time via GridIndex
  // - Canvas layer receives row/col via getCellPosition (doesn't know about CellId)
  //
  // ==========================================================================
  const { getTraceArrows, getCellPosition: getCellPositionForTrace } = useTraceArrowsForRender({
    activeSheetId,
  });

  // ==========================================================================
  // FILTER HEADER INFO (Filter UI)
  // Pre-fetches filter data from Rust, resolves CellId-based ranges to positions,
  // and serves sync lookups for the canvas render loop.
  // On filter events, the cache refreshes automatically.
  // ==========================================================================
  const { getFilterHeaderInfo, hasTableColumnFilter } = useFilterHeaderCache({
    activeSheetId,
    onCacheUpdate: onFilterHeaderCacheUpdate,
  });

  const { getTableAtCell: getTableAtCellCached } = useTableLayoutCache({
    activeSheetId,
    onCacheUpdate: onTableLayoutCacheUpdate,
  });

  // ==========================================================================
  // CHART CALLBACKS
  //
  // ARCHITECTURE: Charts now flow through the floating object pipeline.
  // getChartsInViewport and getChartPosition are no longer needed — the
  // scene graph handles chart positioning via floating object bounds.
  // Only renderChart remains, wired to setChartBridge() in the canvas.
  //
  // ==========================================================================

  // Render a chart via ChartBridge.
  //
  // Sync from cache only — see IChartBridge.renderCached. Any async work
  // (compile, data fetch) happens out of band and signals back via
  // onCacheUpdate to dirty the drawing layer for the next frame.
  const renderChart = useCallback(
    (
      chartId: string,
      canvasCtx: CanvasRenderingContext2D,
      bounds: { x: number; y: number; width: number; height: number },
    ) => {
      wb.charts.renderCached(chartId, canvasCtx, bounds, activeSheetId);
    },
    [wb, activeSheetId],
  );

  // Wire chart-cache updates to a renderer invalidate so the next frame
  // paints real marks instead of the placeholder. Mirrors ImageCache.onLoad
  // for pictures. The chartId is unused — coordinator.renderer.invalidate
  // already redraws the whole drawing layer on this signal.
  useEffect(() => {
    return wb.charts.onCacheUpdate(() => {
      coordinator.renderer.invalidate('charts-cache-update');
    });
  }, [wb, coordinator]);

  // Page break callbacks for render context
  const getPageBreaks = useCallback(() => {
    const ws = wb.getSheetById(activeSheetId);
    return ws.print.getPageBreaks();
  }, [wb, activeSheetId]);

  const getPrintArea = useCallback(() => {
    const ws = wb.getSheetById(activeSheetId);
    return ws.print.getArea() as Promise<{
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
    } | null>;
  }, [wb, activeSheetId]);

  // 15-PRINT-EXPORT: Items 15.4 and 15.5 - Auto Page Break Visualization
  const getAutoPageBreaks = useCallback(async () => {
    // Only calculate automatic page breaks if page break preview mode is enabled
    if (!pageBreakPreviewMode) {
      return { rowBreaks: [], colBreaks: [] };
    }

    // Get print settings for the active sheet via Worksheet API
    const ws = wb.getSheetById(activeSheetId);
    const [printSettings, printAreaValue, manualBreaks] = await Promise.all([
      ws.print.getSettings(),
      ws.print.getArea(),
      ws.print.getPageBreaks(),
    ]);

    // Convert PrintSettings to PrintOptions format
    // Map OOXML paper size code to string
    const paperSizeMap: Record<number, PaperSize> = { 1: 'letter', 5: 'legal', 9: 'a4', 8: 'a3' };
    const paperSizeStr: PaperSize = paperSizeMap[printSettings.paperSize ?? 1] ?? 'letter';
    const m = printSettings.margins;
    const printOptions: PrintOptions = {
      paperSize: paperSizeStr,
      orientation: printSettings.orientation === 'landscape' ? 'landscape' : 'portrait',
      margins: m
        ? { top: m.top, right: m.right, bottom: m.bottom, left: m.left }
        : { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7 },
      scale: (printSettings.scale ?? 100) / 100, // Convert percentage to decimal
      showGridlines: printSettings.gridlines,
      showHeaders: printSettings.headings,
      center: {
        horizontal: printSettings.hCentered,
        vertical: printSettings.vCentered,
      },
      fitTo:
        printSettings.fitToWidth != null || printSettings.fitToHeight != null
          ? {
              width: printSettings.fitToWidth ?? undefined,
              height: printSettings.fitToHeight ?? undefined,
            }
          : undefined,
    };

    // Convert headerFooter to PageSetup format
    const hf = printSettings.headerFooter;
    const pageSetup = {
      header: hf?.oddHeader ? { center: hf.oddHeader } : undefined,
      footer: hf?.oddFooter ? { center: hf.oddFooter } : undefined,
    };

    // Create viewport data provider adapter for print pagination
    const dataProvider = new ViewportTableDataProvider(ws.viewport, activeSheetId);

    // Get print area - use explicit print area if set, otherwise use full used range
    const area = {
      sheetId: activeSheetId,
      range: printAreaValue ?? undefined,
      rowPageBreaks: manualBreaks.rowBreaks.map((e) => e.id),
      colPageBreaks: manualBreaks.colBreaks.map((e) => e.id),
    } as PrintArea;

    try {
      // Calculate page layout using PaginationEngine
      const layout = await printHandler.calculateLayoutWithEngine(
        dataProvider,
        printOptions,
        pageSetup,
        area,
      );

      // Extract automatic page breaks from the layout
      // Automatic breaks are those not in the manual break list
      const manualHSet = new Set(manualBreaks.rowBreaks.map((e) => e.id));
      const manualVSet = new Set(manualBreaks.colBreaks.map((e) => e.id));

      const autoHorizontal: number[] = [];
      const autoVertical: number[] = [];

      // Iterate through pages to find break positions
      for (const page of layout.pages) {
        const rowBreak = page.rowRange[0];
        const colBreak = page.colRange[0];

        // Add row break if it's not manual and not the first page
        if (
          page.pageNumber > 1 &&
          !manualHSet.has(rowBreak) &&
          !autoHorizontal.includes(rowBreak)
        ) {
          autoHorizontal.push(rowBreak);
        }

        // Add column break if it's not manual and not the first page
        if (page.pageNumber > 1 && !manualVSet.has(colBreak) && !autoVertical.includes(colBreak)) {
          autoVertical.push(colBreak);
        }
      }

      return {
        rowBreaks: autoHorizontal
          .sort((a, b) => a - b)
          .map((id): PageBreakEntry => ({ id, min: 0, max: 16383, manual: false, pt: false })),
        colBreaks: autoVertical
          .sort((a, b) => a - b)
          .map((id): PageBreakEntry => ({ id, min: 0, max: 16383, manual: false, pt: false })),
      };
    } catch (error) {
      // If page break calculation fails, return empty breaks
      console.warn('Failed to calculate automatic page breaks:', error);
      return { rowBreaks: [], colBreaks: [] };
    }
  }, [pageBreakPreviewMode, wb, ws, activeSheetId]);

  // Use extracted hook for render context config
  useRenderContextConfig({
    coordinator,
    remoteCursors,
    getCellValue,
    getCellFormat,
    getTableAtCell: getTableAtCellCached,
    getResolvedTableRange: getResolvedTableRangeCallback,
    getFilterHeaderInfo,
    hasTableColumnFilter,
    pageBreakPreviewMode,
    getPageBreaks,
    getAutoPageBreaks,
    getPrintArea,
    getSparklineRenderData,
    hasValidationErrors,
    getFloatingObjectState,
    getFloatingObjects,
    getFloatingObjectBounds,
    getAllObjectBounds,
    getSearchHighlights,
    // Charts
    renderChart,
    // Grouping/Outline
    getGroupingConfig,
    getRowGroups,
    getColumnGroups,
    getRowOutlineLevels,
    getColumnOutlineLevels,
    maxRowOutlineLevel: groupingState.maxRowLevel,
    maxColOutlineLevel: groupingState.maxColLevel,
    getTraceArrows,
    getCellPositionForTrace,
    uiStoreApi,

    binaryCellReader: ws.viewport.binaryCellReader,
    binaryCellReaderForViewport: ws.viewport.binaryCellReaderForViewport,
  });

  // Use extracted hook for editor integration (checkbox toggle)
  // Note: Editor-Yjs and Editor-Schema integrations are handled at
  // SheetCoordinator construction time via config.editorDependencies
  // useEditorIntegration now uses useWorkbook/useActiveSheetId internally
  useEditorIntegration({
    coordinator,
  });

  // Use extracted hook for sparkline and CF integration (combines 2 effects)
  useSparklineCFIntegration({
    coordinator,
    sparklineManager,
    cfManager,
    activeSheetId,
  });

  // Use extracted hook for grouping integration
  // PERFORMANCE: groupingState does NOT include selection - prevents cascade re-renders
  useGroupingIntegration({
    coordinator,
    groupingState,
  });

  // Use extracted hook for renderer lifecycle
  // PERFORMANCE: Uses granular hooks instead of full useRenderer()
  useRendererLifecycle({
    status,
    dimensions,
    error: rendererError,
    activeSheetId,
    containerRef,
    mount: rendererActions.mount,
    layoutReady: rendererActions.layoutReady,
  });

  // Use extracted hook for renderer sync (combines multiple effects)
  // PERFORMANCE: Uses granular hooks instead of full useRenderer()
  useRendererSync({
    containerRef,
    isReady,
    currentSheetId: rendererSheetId,
    activeSheetId,
    currentZoom,
    workbookSettings,
    coordinator,
    resize: rendererActions.resize,
    suspend: rendererActions.suspend,
    resume: rendererActions.resume,
    switchSheet: rendererActions.switchSheet,
    setZoom: rendererActions.setZoom,
    unmount: rendererActions.unmount,
  });

  // Register grid container for focus restoration
  // The coordinator owns FocusCoordination and orchestrates focus based on state transitions.
  // When editing ends (Enter/Tab/click), focus must return to the grid container so
  // keyboard events are properly routed for type-to-edit and navigation.
  // @see FOCUS-BASED-KEYBOARD-HANDLING.md - Architecture documentation
  useEffect(() => {
    coordinator.input.setGridContainer(containerRef.current);
    return () => {
      coordinator.input.setGridContainer(null);
    };
  }, [coordinator, containerRef]);

  // Long-press handler for touch-based context menu
  // This callback is invoked after 500ms touch and triggers context menu
  const handleLongPress = useCallback(
    (x: number, y: number) => {
      // Open context menu at touch position
      // Use 'cell' as target - the context menu will detect actual target from selection
      openContextMenu({
        x,
        y,
        target: 'cell',
      });
    },
    [openContextMenu],
  );

  // Use extracted hook for input event listeners
  // Added onLongPress for touch-based context menu invocation
  useInputListeners({
    containerRef,
    input: inputEventHandlers,
    onLongPress: handleLongPress,
  });

  // Note: Scroll events are no longer handled via DOM onScroll. ScrollContainer
  // now reads position from InputCoordinator and feeds drag input back via scrollTo.
  // Wheel scrolling (including Ctrl/Cmd+Wheel zoom) is handled by InputCoordinator
  // via native event listener. UIStore zoom sync happens via useRendererSync.

  // ==========================================================================
  // Render
  // ==========================================================================

  // 6.1: Scroll area based on used range (not MAX_ROWS/MAX_COLS)
  // This makes scroll bar thumb size usable for normal sheets
  const scrollDimensions = useScrollDimensions({ viewport: ws.viewport, activeSheetId });

  const scrollWidth = scrollDimensions.width;
  const scrollHeight = scrollDimensions.height;

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) {
          closeContextMenu();
          closeObjectContextMenu();
        }
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          className={`relative w-full flex-1 overflow-hidden outline-none ${className ?? ''}`}
          // touch-action: none is required for pointer capture on touch devices
          // cursor comes from mouse hook for drag feedback
          // Show auto-scroll cursor when panning (middle-click pan)
          style={{ cursor: isPanning ? AUTO_SCROLL_CURSOR : mouse.cursor, touchAction: 'none' }}
          tabIndex={0}
          role="grid"
          aria-label="Spreadsheet grid"
          aria-rowcount={MAX_ROWS}
          aria-colcount={MAX_COLS}
          aria-multiselectable="true"
          // Marker for keyboard capture - identifies this as a spreadsheet container
          // so document-level keyboard capture can distinguish our editors from dialog inputs
          data-spreadsheet-container
          data-testid="spreadsheet"
          data-page-break-preview-mode={pageBreakPreviewMode ? 'true' : 'false'}
          // Mouse events are now handled via native pointer listeners in use-grid-mouse.ts
          // This enables setPointerCapture() for tracking cursor outside the window during drags
          // Only double-click, keyboard, and context menu remain as React handlers
          onDoubleClick={mouse.handleDoubleClick}
          onKeyDown={keyboard.handleKeyDown}
          onContextMenu={mouse.handleContextMenu}
        >
          {/* FPS counter (debug mode only) - uses granular isReady/status */}
          {showFps && isReady && (
            <div className="absolute top-1 right-1 z-ss-modal bg-ss-overlay-heavy text-ss-success px-1.5 py-0.5 rounded text-caption font-ss-mono">
              {status}
            </div>
          )}

          {/* ScrollContainer - scrollbars and split boxes */}
          <ScrollContainer
            workbookSettings={workbookSettings}
            scrollWidth={scrollWidth}
            scrollHeight={scrollHeight}
          />

          {/* Canvas Interactive Element Overlay - DOM triggers for canvas buttons
 Renders invisible DOM elements over canvas-rendered interactive elements
 (filter buttons, checkboxes, etc.) to enable Radix popovers and accessibility.
 */}
          <CanvasInteractiveOverlay
            interactiveElements={rendererActions.getInteractiveElements()}
            headerOffset={headerOffset}
          />

          {/* Outline Gutter DOM Input Overlay - outline affordance
 Invisible DOM <button>s positioned over canvas-drawn outline level
 buttons (1, 2, 3, ...) and per-group +/- toggles, so Playwright
 tests can drive grouping operations through the real input path.
 */}
          <OutlineToggleOverlay />

          {/* OverlayLayers - Chart, Pivot, and Paste Options */}
          <OverlayLayers />

          {/* Inline Cell Editors - all use granular hooks internally
 @see engine/src/components/grid/editors/ for implementation details

 Render order matters for layering:
 1. InlineSliderEditor - for bounded number cells (slider replaces text input)
 2. InlineRichTextEditor - for cells with rich text content
 3. InlineCellEditor - default text/textarea input (renders if above don't match)
 4. ValidationDropdownOverlay - dropdown picker for enum cells (overlay)
 5. DatePickerOverlay - date picker for date cells (overlay)

 PERFORMANCE: All editor components use granular hooks (useEditorState, useEditorActions,
 useRendererActions) internally. No editor/renderer props are passed from SpreadsheetGrid.
 */}
          <InlineSliderEditor />
          <InlineRichTextEditor />
          <InlineCellEditor workbookSettings={workbookSettings} rendererSkin={rendererSkin} />
          <ValidationDropdownOverlay />
          <DatePickerOverlay />

          {/* StatusOverlays - error and loading states */}
          <StatusOverlays />

          {/* FontWarningToast - shows when selecting unavailable font */}
          <FontWarningToast />

          {/* Kernel NotificationsService toasts - cross-app notifications */}
          <ToastRenderer />

          {/* Validation dialogs - propless connectors backed by the UI store
 so the coordinator (above the component tree) can show them.
 - ValidationErrorDialog: errorStyle='stop' (strict enforcement)
 - ValidationWarningDialog: errorStyle='warning' or 'information'
 */}
          <ValidationErrorDialog />
          <ValidationWarningDialog />

          <FormulaErrorDialog />

          {/* ProtectionDialogs - protection alert dialog */}
          <ProtectionDialogs
            protectionAlertOpen={protectionAlertOpen}
            protectionAlertMessage={protectionAlertMessage}
            onDismiss={dismissProtectionAlert}
          />

          {/* InputMessageOverlay - data validation input message tooltip
 RENDER ISOLATION: This component subscribes to activeCell internally,
 preventing SpreadsheetGrid re-renders on cell selection.
 @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
 */}
          <InputMessageOverlay activeSheetId={activeSheetId} isEditing={isEditing} />

          {/* HyperlinkTooltip - shows URL when hovering over hyperlink cells */}
          <HyperlinkTooltip {...hyperlinkTooltip.tooltip} />

          {/* Accessibility Announcer - ARIA live region for screen readers */}
          <AccessibilityAnnouncer enabled={true} gridContainerRef={containerRef} />
        </div>
      </ContextMenuTrigger>

      <GridContextMenuContent />
    </ContextMenu>
  );
});
