/**
 * Grid Mouse Hook
 *
 * Composes state hooks (useSelection, useEditor, useRenderer, etc.) to provide
 * unified mouse handling for the grid.
 *
 * This is a HIGH-LEVEL feature hook that:
 * 1. Hit tests clicks against cells, headers, floating objects
 * 2. Routes mouse events based on what was clicked
 * 3. Handles selection, drag, resize, fill handle
 * 4. Handles context menu
 *
 * Architecture:
 * - Composes extracted sub-hooks from ./grid-mouse/
 * - Uses coordinator.grid.handleDragCellsMove() instead of direct actor access
 * - Reads: ViewportBuffer for cell data (hyperlinks), Worksheet API for tables
 * - Writes: None directly (delegates to selection/editor state hooks)
 *
 * @see docs/renderer/README.md - Architecture
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isOnFillHandle, isOnSelectionBorder, isOnTableResizeHandle } from '@mog/grid-renderer';
import { editorSelectors } from '../../selectors';
import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';
import { SCROLL_BAR_WIDTH } from '@mog-sdk/contracts/rendering';
import { parseA1Range } from '@mog/spreadsheet-utils/a1';

import { useUIStore, useUIStoreApi, useWorkbook } from '../../infra/context';
import { formatRangeSelectionRange } from '../../systems/grid-editing/coordination/range-selection-format';
import { isValidDropTarget } from '../../systems/grid-editing/features/drag-drop';
import {
  getAutofitColumnsForResize,
  getAutofitRowsForResize,
} from '../../systems/grid-editing/features/autofit/selection-targets';
import {
  createFillHandleDragAnchor,
  getRangeBottomRightCell,
  resolveFillHandleDragCell,
  type FillHandleDragAnchor,
} from './fill-handle-drag-cell';
import {
  getCachedTableHitRegion,
  resolvePendingTableClickSelection,
  getTableCornerDoubleClickRange,
  getTableHitRegion,
  type CachedTableHitInfo,
  type PendingTableClickSelection,
} from '../grid-mouse/helpers/table-click-selection';
import {
  resolveSelectionBorderDoubleClickTarget,
  type SelectionBorderEdge,
} from '../grid-mouse/helpers/selection-border-double-click';
import { useEditorActions } from '../editing/use-editor-actions';
import { useObjectInteraction } from '../objects/use-object-interaction';
import { useSelection } from '../selection/use-selection';
import { useDispatch } from '../toolbar/use-action-dependencies';
import { useRenderer } from '../view/use-renderer';

// Import from extracted grid-mouse module
import {
  type CellClickPosition,
  getCursorForDrag,
  getCursorForHitType,
  type GridMouseEvent,
  isClickOnValidationDropdown,
  useCellInteraction,
  useContextMenuHandler,
  useCursorManager,
  useFormulaRangeDrag,
  type UseGridMouseOptions,
  type UseGridMouseReturn,
} from '../grid-mouse';

// Re-export types for external consumers
export type {
  ContextMenuOptions,
  GridMouseEvent,
  UseGridMouseOptions,
  UseGridMouseReturn,
} from '../grid-mouse';

// =============================================================================
// Helpers
// =============================================================================

type RangeSelectionDragMode = 'cell' | 'row' | 'column';

interface NativeHandledCellDoubleClick {
  row: number;
  col: number;
  sheetId: string;
  clientX: number;
  clientY: number;
  time: number;
}

interface NativeHandledSelectionBorderDoubleClick {
  sheetId: string;
  clientX: number;
  clientY: number;
  time: number;
}

/**
 * Get mouse position relative to container.
 */
function getRelativePosition(
  e: GridMouseEvent,
  container: HTMLDivElement,
): { x: number; y: number } {
  const rect = container.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function getSelectionBorderEdge(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
): SelectionBorderEdge {
  const dR = Math.abs(point.x - (rect.x + rect.width));
  const dL = Math.abs(point.x - rect.x);
  const dB = Math.abs(point.y - (rect.y + rect.height));
  const dT = Math.abs(point.y - rect.y);
  const min = Math.min(dR, dL, dB, dT);
  if (min === dR) return 'right';
  if (min === dL) return 'left';
  if (min === dT) return 'up';
  return 'down';
}

function singleCellRange(cell: { row: number; col: number }): CellRange {
  return {
    startRow: cell.row,
    startCol: cell.col,
    endRow: cell.row,
    endCol: cell.col,
  };
}

function isObjectDragOperationLive(coordinator: UseGridMouseOptions['coordinator']): boolean {
  const operationType = coordinator.objects.access.accessors.object.getOperationType();
  return operationType === 'drag' || operationType === 'resize' || operationType === 'rotate';
}

function isObjectInteractionOwningPointer(
  coordinator: UseGridMouseOptions['coordinator'],
): boolean {
  const objectAccess = coordinator.objects.access.accessors.object;
  return objectAccess.isInserting() || isObjectDragOperationLive(coordinator);
}

function makeRangeSelectionRange(
  mode: RangeSelectionDragMode,
  startCell: { row: number; col: number },
  currentCell: { row: number; col: number },
): CellRange {
  const startRow = Math.min(startCell.row, currentCell.row);
  const endRow = Math.max(startCell.row, currentCell.row);
  const startCol = Math.min(startCell.col, currentCell.col);
  const endCol = Math.max(startCell.col, currentCell.col);

  if (mode === 'row') {
    return {
      startRow,
      endRow,
      startCol: 0,
      endCol: MAX_COLS - 1,
      isFullRow: true,
    };
  }

  if (mode === 'column') {
    return {
      startRow: 0,
      endRow: MAX_ROWS - 1,
      startCol,
      endCol,
      isFullColumn: true,
    };
  }

  return { startRow, endRow, startCol, endCol };
}

function updateRangeSelectionFromDrag(
  uiStoreApi: ReturnType<typeof useUIStoreApi>,
  mode: RangeSelectionDragMode,
  startCell: { row: number; col: number },
  currentCell: { row: number; col: number },
): void {
  uiStoreApi
    .getState()
    .updateRangeSelection(
      formatRangeSelectionRange(makeRangeSelectionRange(mode, startCell, currentCell)),
    );
}

function applyRangePickerSelection(
  uiStoreApi: ReturnType<typeof useUIStoreApi>,
  selection: Pick<ReturnType<typeof useSelection>, 'setSelection'>,
  mode: RangeSelectionDragMode,
  startCell: { row: number; col: number },
  currentCell: { row: number; col: number },
): void {
  const range = makeRangeSelectionRange(mode, startCell, currentCell);
  updateRangeSelectionFromDrag(uiStoreApi, mode, startCell, currentCell);
  selection.setSelection([range], { row: startCell.row, col: startCell.col });
}

function isMatchingNativeCellDoubleClick(
  handled: NativeHandledCellDoubleClick | null,
  cell: { row: number; col: number },
  sheetId: string,
  event: GridMouseEvent,
): boolean {
  if (!handled) return false;
  const maxAgeMs = 1000;
  const coordinateTolerancePx = 2;

  return (
    Date.now() - handled.time <= maxAgeMs &&
    handled.sheetId === sheetId &&
    handled.row === cell.row &&
    handled.col === cell.col &&
    Math.abs(handled.clientX - event.clientX) <= coordinateTolerancePx &&
    Math.abs(handled.clientY - event.clientY) <= coordinateTolerancePx
  );
}

function isMatchingNativeSelectionBorderDoubleClick(
  handled: NativeHandledSelectionBorderDoubleClick | null,
  sheetId: string,
  event: GridMouseEvent,
): boolean {
  if (!handled) return false;
  const maxAgeMs = 1000;
  const coordinateTolerancePx = 2;

  return (
    Date.now() - handled.time <= maxAgeMs &&
    handled.sheetId === sheetId &&
    Math.abs(handled.clientX - event.clientX) <= coordinateTolerancePx &&
    Math.abs(handled.clientY - event.clientY) <= coordinateTolerancePx
  );
}

function getRangeSelectionAnchor(currentRange: string): { row: number; col: number } | null {
  const normalized = currentRange.trim().replace(/^=/, '');
  if (
    !normalized ||
    normalized.includes(',') ||
    normalized.includes('!') ||
    normalized.split(':').length > 2
  ) {
    return null;
  }

  try {
    const parsed = parseA1Range(normalized);
    return { row: parsed.startRow, col: parsed.startCol };
  } catch {
    return null;
  }
}

// =============================================================================
// Table Hit Testing (inlined from domain module)
// =============================================================================

const COLUMN_RESIZE_EDGE_WIDTH = 4;

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for grid mouse handling.
 *
 * Composes state hooks and provides unified mouse handlers that correctly
 * route events based on hit testing results.
 *
 * @example
 * ```tsx
 * function Grid() {
 * const containerRef = useRef<HTMLDivElement>(null);
 * const activeSheetId = useActiveSheetId;
 * const coordinator = useCoordinator;
 *
 * const mouse = useGridMouse({
 * activeSheetId,
 * containerRef,
 * coordinator,
 * });
 *
 * return (
 * <div
 * ref={containerRef}
 * style={{ cursor: mouse.cursor }}
 * onMouseDown={mouse.handleMouseDown}
 * onMouseMove={mouse.handleMouseMove}
 * onMouseUp={mouse.handleMouseUp}
 * onDoubleClick={mouse.handleDoubleClick}
 * onContextMenu={mouse.handleContextMenu}
 * />
 * );
 * }
 * ```
 */
export function useGridMouse(options: UseGridMouseOptions): UseGridMouseReturn {
  const {
    activeSheetId,
    containerRef,
    coordinator,
    onHyperlinkClick,
    onContextMenu,
    groupingActions,
    sparklineManager,
    onEditSparkline,
    onCellHover,
    onCommentIndicatorClick,
  } = options;

  const wb = useWorkbook();
  const ws = wb.getSheetById(activeSheetId);
  const dispatch = useDispatch();

  // UI state
  const uiStoreApi = useUIStoreApi();
  // extendSelectionMode / addToSelectionMode reads
  // removed. The machine's MOUSE_DOWN guard composes raw modifiers with
  // ctx.modes.{extend, additive} (see selection/guards.ts:effectiveShiftClick
  // / effectiveCtrlClick). The hook now passes raw shift/ctrl untouched.
  const formatPainter = useUIStore((s) => s.formatPainter);
  const pageBreakPreviewMode = useUIStore((s) => s.pageBreakPreviewMode);
  const inkModeActive = useUIStore((s) => s.inkModeActive);
  const inkTool = useUIStore((s) => s.activeTool);
  const openObjectContextMenu = useUIStore((s) => s.openObjectContextMenu);

  // Compose state hooks
  const selection = useSelection();
  const renderer = useRenderer();
  const objectInteraction = useObjectInteraction();

  // Performance optimization: Use useEditorActions for stable action references
  // instead of useEditor which subscribes to state and causes re-renders.
  // For state reads, use coordinator.grid.getEditorSnapshot() on-demand in callbacks.
  const editorActions = useEditorActions();

  // Click tracking for triple-click detection
  const clickCountRef = useRef(0);
  const lastClickTimeRef = useRef(0);
  const lastClickCellRef = useRef<{ row: number; col: number; sheetId: string } | null>(null);
  const lastSelectionBorderClickRef = useRef<{
    row: number;
    col: number;
    sheetId: string;
    edge: SelectionBorderEdge;
    time: number;
  } | null>(null);
  const nativeHandledCellDoubleClickRef = useRef<NativeHandledCellDoubleClick | null>(null);
  const nativeHandledSelectionBorderDoubleClickRef =
    useRef<NativeHandledSelectionBorderDoubleClick | null>(null);
  const pendingFormatPainterTargetRef = useRef(false);
  const pendingTableClickSelectionRef = useRef<PendingTableClickSelection | null>(null);
  const pendingTableClickStartRef = useRef<{ x: number; y: number } | null>(null);
  const pendingTableClickMovedRef = useRef(false);
  const fillHandleDragAnchorRef = useRef<FillHandleDragAnchor | null>(null);

  // Page break dragging state
  const isPageBreakDraggingRef = useRef(false);

  // Pre-cache tables via Worksheet API for sync mouse handlers.
  // Tables are pre-fetched and their A1 ranges parsed to numeric CellRange for cursor feedback.
  const [cachedTables, setCachedTables] = useState<CachedTableHitInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refreshTables = () => {
      void (async () => {
        try {
          const ws = wb.getSheetById(activeSheetId);
          const tables = await ws.tables.list();
          if (!cancelled) {
            setCachedTables(
              (tables ?? []).map((t: any) => ({
                id: t.name,
                range: parseA1Range(t.range),
                hasHeaderRow: t.hasHeaderRow ?? true,
                hasTotalsRow: t.hasTotalsRow ?? false,
                columns: t.columns ?? [],
              })),
            );
          }
        } catch {
          if (!cancelled) setCachedTables([]);
        }
      })();
    };

    refreshTables();

    const unsubscribeTableCreated = wb.on('table:created', refreshTables);
    const unsubscribeTableUpdated = wb.on('table:updated', refreshTables);
    const unsubscribeTableDeleted = wb.on('table:deleted', refreshTables);

    return () => {
      cancelled = true;
      unsubscribeTableCreated?.();
      unsubscribeTableUpdated?.();
      unsubscribeTableDeleted?.();
    };
  }, [wb, activeSheetId]);

  // Range selection mode drag state
  const rangeSelectionDragRef = useRef<{
    isDragging: boolean;
    mode: RangeSelectionDragMode;
    startCell: { row: number; col: number } | null;
  }>({ isDragging: false, mode: 'cell', startCell: null });

  const getGeometry = useCallback(() => {
    return renderer.getGeometry();
  }, [renderer]);

  const getHitTest = useCallback(() => {
    return renderer.getHitTest();
  }, [renderer]);

  // ==========================================================================
  // Compose Sub-Hooks
  // ==========================================================================

  // Cursor manager hook
  const cursorManager = useCursorManager({
    containerRef,
    formatPainter,
    ink: { isActive: inkModeActive, tool: inkTool },
    objectInteraction,
  });

  // Context menu handler hook
  const contextMenuHandler = useContextMenuHandler({
    activeSheetId,
    containerRef,
    getHitTest,
    selection,
    onContextMenu,
    onObjectContextMenu: openObjectContextMenu,
  });

  // Formula range drag hook
  // Performance: Pass getter function for editor state instead of subscribing to editor state
  const getViewport = useCallback(() => {
    return renderer.getViewport();
  }, [renderer]);

  const formulaRangeDrag = useFormulaRangeDrag({
    activeSheetId,
    getEditorState: () => {
      const state = coordinator.grid.access.actors.editor.getSnapshot();
      return {
        isFormulaEditing: editorSelectors.isFormulaEditing(state),
        value: editorSelectors.value(state),
        sheetId: state.context.sheetId,
      };
    },
    getActiveSheetName: () => wb.getSheetById(activeSheetId).name,
    onUpdateFormulaRange: (rangeIndex, startCellId, endCellId) => {
      dispatch('UPDATE_FORMULA_RANGE', { rangeIndex, startCellId, endCellId });
    },
    getGeometry,
    getViewport,
    getCellIdAtPosition: (row, col) =>
      wb.getSheetById(activeSheetId)._internal.getCellIdAt(row, col),
    containerRef,
  });

  // Cell interaction hook
  // NOTE: Filter button clicks are now handled by DOM overlays (FilterButtonOverlay)
  // which render invisible buttons over canvas filter buttons.
  // @see components/canvas-overlays/FilterButtonOverlay.tsx
  const cellInteraction = useCellInteraction({
    activeSheetId,
    coordinator,
    getGeometry,
    containerRef,
    sparklineManager,
    onEditSparkline,
    onCommentIndicatorClick,
  });

  const handleCellDoubleClickAtViewportPoint = useCallback(
    (
      cell: { row: number; col: number },
      point: { x: number; y: number },
      geometry: {
        getCellRect(cell: {
          row: number;
          col: number;
        }): { x: number; y: number; width: number; height: number } | null;
      },
    ): boolean => {
      const dblCellRect = geometry.getCellRect(cell);
      if (!dblCellRect) return false;

      const clickPos = {
        x: point.x - dblCellRect.x,
        y: point.y - dblCellRect.y,
        width: dblCellRect.width,
        height: dblCellRect.height,
      };

      if (clickPos.x >= clickPos.width - COLUMN_RESIZE_EDGE_WIDTH) {
        void (async () => {
          const ws = wb.getSheetById(activeSheetId);
          const tableHitResult = await getTableHitRegion(ws, cell.row, cell.col, {
            clickXInCell: clickPos.x,
            clickYInCell: clickPos.y,
            cellWidth: clickPos.width,
            cellHeight: clickPos.height,
          });

          if (tableHitResult.region === 'column-resize-edge') {
            const [{ autoFitColumns }, { getTextMeasurementService }] = await Promise.all([
              import('../../systems/grid-editing/features/autofit'),
              import('@mog/grid-renderer'),
            ]);
            const textMeasurement = getTextMeasurementService();
            await autoFitColumns(
              activeSheetId,
              [cell.col],
              textMeasurement,
              (entries) => ws.formatValues(entries),
              wb ?? undefined,
            );
          }
        })();
      }

      const clickPosition: CellClickPosition = {
        clickInCellX: clickPos.x,
        clickInCellY: clickPos.y,
        cellWidth: clickPos.width,
        cellHeight: clickPos.height,
      };
      void cellInteraction.handleCellDoubleClick(cell, clickPosition);
      return true;
    },
    [activeSheetId, wb, cellInteraction],
  );

  const handleSelectionBorderDoubleClick = useCallback(
    async (edge: SelectionBorderEdge): Promise<void> => {
      const activeCell = selection.snapshot.activeCell;
      const ws = wb.getSheetById(activeSheetId);
      const targetCell = await resolveSelectionBorderDoubleClickTarget(ws, activeCell, edge);
      if (!targetCell) return;

      selection.setSelection([singleCellRange(targetCell)], targetCell);
    },
    [activeSheetId, selection, wb],
  );

  const applyPendingFormatPainterTarget = useCallback(() => {
    if (!pendingFormatPainterTargetRef.current) {
      return;
    }
    pendingFormatPainterTargetRef.current = false;

    const currentFormatPainter = uiStoreApi.getState().formatPainter;
    if (!currentFormatPainter.isActive || !currentFormatPainter.sourceFormat) {
      return;
    }

    const targetRange = coordinator.grid.access.accessors.selection.getActiveRange();
    void dispatch('APPLY_FORMAT_PAINTER', { targetRange });
  }, [coordinator, dispatch, uiStoreApi]);

  // ==========================================================================
  // Mouse Down Handler
  // ==========================================================================

  const handleMouseDown = useCallback(
    (e: GridMouseEvent): void => {
      void (async () => {
        const container = containerRef.current;
        if (!container) return;

        const { x, y } = getRelativePosition(e, container);
        const geometry = getGeometry();
        if (!geometry) return;

        // Insert mode: route pointerdown to object coordination for drag-to-insert
        if (coordinator.objects.access.accessors.object.isInserting()) {
          const position = { x, y };
          coordinator.objects.handleObjectMouseDown('', 'body', position, false, false);
          return;
        }

        // Use the SheetView hit-test capability. Direct GridRenderer access is
        // intentionally deprecated and can be unavailable in shell-hosted views.
        const hitTest = getHitTest();
        if (!hitTest) return;
        const hit = hitTest.atViewportPoint({ x, y });

        // 1. Check floating objects FIRST (they render on top)
        if (hit.type === 'floating-object') {
          // Check if this is a Diagram object and emit diagram:click event
          const clickedHandle = await ws.objects.get(hit.objectId);
          if (clickedHandle && clickedHandle.type === 'diagram') {
            // Get the object's position to calculate click position relative to the Diagram
            const clickedInfo = await ws.objects.getInfo(hit.objectId);
            const clickPositionInObject = {
              x: x - (clickedInfo?.x ?? 0),
              y: y - (clickedInfo?.y ?? 0),
            };

            // Emit diagram:click event for the Diagram coordination to handle
            wb.emit({
              type: 'diagram:click',
              timestamp: Date.now(),
              objectId: hit.objectId,
              nodeId: null, // Node detection will be done by Diagram coordination via hit testing
              clickPosition: clickPositionInObject,
              modifiers: {
                shift: e.shiftKey,
                ctrl: e.ctrlKey,
                meta: e.metaKey,
              },
            });

            // Also select the Diagram object at the floating object level for move/resize
            const position = { x, y };
            const ctrlKey = e.ctrlKey || e.metaKey;
            if (hit.region === 'body' || hit.region === 'border') {
              coordinator.objects.handleObjectMouseDown(
                hit.objectId,
                'body',
                position,
                e.shiftKey,
                ctrlKey,
              );
            } else {
              coordinator.objects.handleObjectMouseDown(
                hit.objectId,
                hit.region,
                position,
                e.shiftKey,
                ctrlKey,
              );
            }
            return;
          }

          if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            // Allow cell+object multi-select with modifier
          }

          // Stop TextEffect editing if clicking on a different object
          // When clicking on a different object while editing a TextEffect, exit edit mode
          const editingTextEffectId = uiStoreApi.getState().editingTextEffectId;
          if (editingTextEffectId && editingTextEffectId !== hit.objectId) {
            uiStoreApi.getState().stopTextEffectEditing();
          }

          const position = { x, y };
          const ctrlKey = e.ctrlKey || e.metaKey; // metaKey for Mac Cmd
          if (hit.region === 'body' || hit.region === 'border') {
            coordinator.objects.handleObjectMouseDown(
              hit.objectId,
              'body',
              position,
              e.shiftKey,
              ctrlKey,
            );
          } else {
            coordinator.objects.handleObjectMouseDown(
              hit.objectId,
              hit.region,
              position,
              e.shiftKey,
              ctrlKey,
            );
          }
          return;
        }

        // 1.5. Check page breaks in page break preview mode
        // Must be after floating objects (they render on top) but before other checks
        if (pageBreakPreviewMode) {
          const pageBreakHit = await coordinator.renderer.hitTestPageBreak(x, y);
          if (pageBreakHit) {
            coordinator.renderer.startPageBreakDrag(pageBreakHit, x, y);
            isPageBreakDraggingRef.current = true;
            return; // Consume the event
          }
        }

        // 1.6. Check range selection mode - route to range picker instead of normal selection
        // When a dialog is in range selection mode (collapse button clicked),
        // clicking on the grid should update the selected range in the input field.
        const rangeSelectionMode = uiStoreApi.getState().rangeSelectionMode;
        if (rangeSelectionMode.active) {
          if (hit.type === 'cell') {
            const cell = { row: hit.row, col: hit.col };
            const anchor = e.shiftKey
              ? (getRangeSelectionAnchor(rangeSelectionMode.currentRange) ?? cell)
              : cell;

            applyRangePickerSelection(uiStoreApi, selection, 'cell', anchor, cell);
            rangeSelectionDragRef.current = {
              isDragging: true,
              mode: 'cell',
              startCell: anchor,
            };
            return; // Don't proceed to normal selection
          }

          if (hit.type === 'row-header') {
            const cell = { row: hit.row, col: 0 };
            applyRangePickerSelection(uiStoreApi, selection, 'row', cell, cell);
            rangeSelectionDragRef.current = {
              isDragging: true,
              mode: 'row',
              startCell: cell,
            };
            return; // Don't proceed to normal row selection
          }

          if (hit.type === 'column-header') {
            const cell = { row: 0, col: hit.col };
            applyRangePickerSelection(uiStoreApi, selection, 'column', cell, cell);
            rangeSelectionDragRef.current = {
              isDragging: true,
              mode: 'column',
              startCell: cell,
            };
            return; // Don't proceed to normal column selection
          }
        }

        // 2. Clicking on empty space deselects floating objects
        if (objectInteraction.hasSelection) {
          // Also stop TextEffect editing if active
          // When clicking outside while editing a TextEffect, we need to:
          // 1. Exit the editing state in the state machine (via deselectAll)
          // 2. Clear the editingTextEffectId in UIStore
          const editingTextEffectId = uiStoreApi.getState().editingTextEffectId;
          if (editingTextEffectId) {
            uiStoreApi.getState().stopTextEffectEditing();
          }
          objectInteraction.deselectAll();
        }

        // 3. Check outline hit testing (grouping +/- buttons)
        if (groupingActions) {
          const outlineHit = coordinator.objects.hitTestOutline(x, y);
          if (outlineHit && outlineHit.type !== 'none') {
            if (outlineHit.type === 'level-button' && outlineHit.level !== undefined) {
              const targetLevel = outlineHit.level;
              const axis = outlineHit.axis;
              const maxLevel =
                outlineHit.axis === 'row'
                  ? groupingActions.maxRowLevel
                  : groupingActions.maxColLevel;
              for (let level = 1; level <= maxLevel; level++) {
                groupingActions.setLevelCollapsed(axis, level, level > targetLevel);
              }
              return;
            } else if (outlineHit.type === 'collapse-button' && outlineHit.groupId) {
              groupingActions.toggleGroupCollapsed(outlineHit.groupId);
              return;
            }
          }
        }

        // 4. Check table resize handle
        const tables = cachedTables;
        for (const table of tables) {
          // Get viewport rect for table start cell
          const tableStartRect = geometry.getCellRect({
            row: table.range.startRow,
            col: table.range.startCol,
          });
          const tableEndRect = geometry.getCellRect({
            row: table.range.endRow,
            col: table.range.endCol,
          });

          if (!tableStartRect || !tableEndRect) continue; // Table not visible

          const tableRect = {
            x: tableStartRect.x,
            y: tableStartRect.y,
            width: tableEndRect.x + tableEndRect.width - tableStartRect.x,
            height: tableEndRect.y + tableEndRect.height - tableStartRect.y,
          };

          if (isOnTableResizeHandle({ x, y }, tableRect)) {
            selection.startTableResize(table.id, table.range);
            return;
          }
        }

        // 5. Check formula range box drag
        if (formulaRangeDrag.tryStartFormulaRangeDrag(x, y)) {
          return;
        }

        const now = Date.now();
        const clickWindow = 500;
        const formatPainterTargeting = formatPainter.isActive && formatPainter.sourceFormat;

        // Selected-cell borders have their own gesture contract and must not
        // inherit the renderer hit-test cell at the boundary. A right/bottom
        // border pixel can classify as the adjacent cell; if we let that pass
        // through normal cell routing, a click moves the active cell and a
        // double-click dispatches Ctrl+Arrow data-edge navigation.
        if (
          selection.ranges.length > 0 &&
          !formatPainterTargeting &&
          !e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey
        ) {
          const firstRange = selection.ranges[0];
          const selectionViewportRect = geometry.getRangeRects(firstRange)[0];
          const borderTolerance = e.pointerType === 'touch' ? 5 : 3;

          if (
            selectionViewportRect &&
            !isOnFillHandle({ x, y }, selectionViewportRect) &&
            isOnSelectionBorder({ x, y }, selectionViewportRect, borderTolerance)
          ) {
            const activeCell = selection.snapshot.activeCell;
            const edge = getSelectionBorderEdge({ x, y }, selectionViewportRect);
            const lastBorderClick = lastSelectionBorderClickRef.current;
            const doubleClickBorderTolerance = e.pointerType === 'touch' ? 5 : 1;
            const isDoubleClick =
              lastBorderClick !== null &&
              lastBorderClick.row === activeCell.row &&
              lastBorderClick.col === activeCell.col &&
              lastBorderClick.sheetId === activeSheetId &&
              lastBorderClick.edge === edge &&
              now - lastBorderClick.time < clickWindow;

            if (isDoubleClick) {
              lastSelectionBorderClickRef.current = null;
              if (
                isOnSelectionBorder({ x, y }, selectionViewportRect, doubleClickBorderTolerance)
              ) {
                nativeHandledSelectionBorderDoubleClickRef.current = {
                  sheetId: activeSheetId,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  time: now,
                };
                await handleSelectionBorderDoubleClick(edge);
                return;
              }
            } else {
              lastSelectionBorderClickRef.current = {
                row: activeCell.row,
                col: activeCell.col,
                sheetId: activeSheetId,
                edge,
                time: now,
              };

              coordinator.grid.handleStartDragCells(activeCell, false);
              return;
            }
          }
        }

        lastSelectionBorderClickRef.current = null;

        // 6. Handle grid hit test results
        // Note: We already have `hit` from renderer.hitTest() above - no need for classifyPoint()
        switch (hit.type) {
          case 'cell': {
            const cell = { row: hit.row, col: hit.col };

            // Track click count for triple-click detection.
            // Sheet ID is part of cell identity here: clicking A1 on Sheet1 then A1 on
            // Sheet2 within 500ms must NOT escalate to a triple-click, otherwise the
            // selectAllText branch swallows the click and prevents formula range
            // insertion across sheets.
            const lastCell = lastClickCellRef.current;
            const sameCell =
              lastCell &&
              lastCell.row === cell.row &&
              lastCell.col === cell.col &&
              lastCell.sheetId === activeSheetId;

            if (sameCell && now - lastClickTimeRef.current < clickWindow) {
              clickCountRef.current++;
            } else {
              clickCountRef.current = 1;
            }

            lastClickTimeRef.current = now;
            lastClickCellRef.current = { ...cell, sheetId: activeSheetId };

            // Triple-click - select all text if in edit mode
            if (clickCountRef.current >= 3) {
              clickCountRef.current = 0;
              // Performance: On-demand read via coordinator instead of subscribing to editor state
              const editorSnapshot = coordinator.grid.getEditorSnapshot();
              if (editorSnapshot.isEditing) {
                editorActions.selectAllText();
                return;
              }
            }

            if (formatPainter.isActive && formatPainter.sourceFormat) {
              pendingFormatPainterTargetRef.current = true;
              selection.onMouseDown(cell, e.shiftKey, e.ctrlKey || e.metaKey);
              break;
            }

            // Excel opens hyperlinks on a plain click.
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey && onHyperlinkClick) {
              if (onHyperlinkClick(cell)) {
                selection.onMouseDown(cell, false, false);
                return;
              }
            }

            // Calculate cell click position for sub-cell hit testing
            const cellRect = geometry.getCellRect(cell);
            if (!cellRect) return; // Cell not visible, shouldn't happen since we got a hit
            const clickPos = {
              x: x - cellRect.x,
              y: y - cellRect.y,
              width: cellRect.width,
              height: cellRect.height,
            };

            const clickPosition: CellClickPosition = {
              clickInCellX: clickPos.x,
              clickInCellY: clickPos.y,
              cellWidth: clickPos.width,
              cellHeight: clickPos.height,
            };
            const containerRect = container.getBoundingClientRect();
            const screenPosition = { x: e.clientX, y: e.clientY };

            // Editing interception - MUST run synchronously before any await.
            // The async table hit region check below yields to the event loop,
            // which could allow blur to fire. handlePointerDown already prevents
            // focus theft via e.preventDefault(), but this early check ensures
            // the interception runs before any async gap.
            {
              // pass raw modifiers; machine composes
              // with ctx.modes.{extend, additive} in MOUSE_DOWN guards.
              const wasIntercepted = coordinator.grid.handleCellClick(
                cell,
                e.shiftKey,
                e.ctrlKey || e.metaKey,
              );
              if (wasIntercepted) {
                return;
              }
            }

            // Use cell interaction hook for filter, comment, format painter, checkbox, validation dropdown
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
              if (cellInteraction.handleCellClick(cell, clickPosition, screenPosition)) {
                return;
              }
            }

            // Table-aware click handling
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
              const tableHit = getCachedTableHitRegion(cachedTables, cell.row, cell.col, {
                clickXInCell: clickPosition.clickInCellX,
                clickYInCell: clickPosition.clickInCellY,
                cellWidth: clickPosition.cellWidth,
                cellHeight: clickPosition.cellHeight,
              });

              if (tableHit.table && tableHit.region !== 'outside') {
                const table = tableHit.table;

                switch (tableHit.region) {
                  case 'header': {
                    pendingTableClickSelectionRef.current = {
                      kind: 'column',
                      sheetId: activeSheetId,
                      row: cell.row,
                      col: cell.col,
                      tableId: table.id,
                      tableRange: table.range,
                      hasHeaderRow: table.hasHeaderRow,
                      hasTotalsRow: table.hasTotalsRow,
                    };
                    pendingTableClickStartRef.current = { x: e.clientX, y: e.clientY };
                    pendingTableClickMovedRef.current = false;
                    return;
                  }
                  case 'corner': {
                    pendingTableClickSelectionRef.current = {
                      kind: 'table-data-or-full',
                      sheetId: activeSheetId,
                      row: cell.row,
                      col: cell.col,
                      tableId: table.id,
                      tableRange: table.range,
                      hasHeaderRow: table.hasHeaderRow,
                      hasTotalsRow: table.hasTotalsRow,
                    };
                    pendingTableClickStartRef.current = { x: e.clientX, y: e.clientY };
                    pendingTableClickMovedRef.current = false;
                    return;
                  }
                  case 'total': {
                    const cellRect = geometry.getCellRect(cell);
                    if (!cellRect) return; // Cell not visible
                    const dropdownX = containerRect.left + cellRect.x;
                    const dropdownY = containerRect.top + cellRect.y + cellRect.height;
                    const tableColumnIndex = tableHit.tableColumnIndex ?? 0;
                    const column = table.columns[tableColumnIndex];
                    const currentFunction = column?.totalFunction ?? null;

                    dispatch('OPEN_TOTAL_ROW_DROPDOWN', {
                      tableId: table.id,
                      columnIndex: tableColumnIndex,
                      position: { x: dropdownX, y: dropdownY },
                      currentFunction,
                    });

                    selection.setSelection(
                      [
                        {
                          startRow: cell.row,
                          startCol: cell.col,
                          endRow: cell.row,
                          endCol: cell.col,
                        },
                      ],
                      cell,
                    );
                    return;
                  }
                  case 'data-left-edge': {
                    pendingTableClickSelectionRef.current = {
                      kind: 'row',
                      sheetId: activeSheetId,
                      row: cell.row,
                      col: cell.col,
                      tableId: table.id,
                      tableRange: table.range,
                      hasHeaderRow: table.hasHeaderRow,
                      hasTotalsRow: table.hasTotalsRow,
                    };
                    pendingTableClickStartRef.current = { x: e.clientX, y: e.clientY };
                    pendingTableClickMovedRef.current = false;
                    return;
                  }
                }
              }
            }

            // Fill handle check
            if (selection.ranges.length > 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              const lastRange = selection.ranges[selection.ranges.length - 1];
              const selectionViewportRect = geometry.getRangeRects(lastRange)[0];

              if (selectionViewportRect && isOnFillHandle({ x, y }, selectionViewportRect)) {
                const handleCell = getRangeBottomRightCell(lastRange);
                fillHandleDragAnchorRef.current = createFillHandleDragAnchor(
                  lastRange,
                  { x, y },
                  selectionViewportRect,
                  geometry.getCellRect(handleCell),
                );
                selection.startFillHandleDrag();
                return;
              }
            }

            // Normal cell click - handle selection
            // Editing interception already handled above (before async table hit region),
            // so this only runs for non-editing clicks.
            //
            // pass raw modifiers; the machine composes
            // them with ctx.modes.{extend, additive} in its MOUSE_DOWN guards.
            selection.onMouseDown(cell, e.shiftKey, e.ctrlKey || e.metaKey);
            break;
          }

          case 'column-header': {
            // raw modifiers; machine applies mode-flag override.
            selection.selectColumn(hit.col, e.shiftKey, e.ctrlKey || e.metaKey);
            break;
          }

          case 'row-header': {
            // raw modifiers; machine applies mode-flag override.
            selection.selectRow(hit.row, e.shiftKey, e.ctrlKey || e.metaKey);
            break;
          }

          case 'frozen-pane-region':
            if (hit.region === 'topLeft') {
              selection.selectAll();
            }
            break;

          case 'column-resize-handle': {
            const positionDims = geometry.getPositionDimensions();
            if (!positionDims) {
              break;
            }
            const selectionState = selection.snapshot;
            const selectedCols: number[] = [];
            const startSizes = new Map<number, number>();
            let isInSelection = false;

            if (selectionState.anchorCol !== null) {
              for (const range of selectionState.ranges) {
                if (range.isFullColumn && hit.col >= range.startCol && hit.col <= range.endCol) {
                  for (let col = range.startCol; col <= range.endCol; col++) {
                    if (!selectedCols.includes(col)) {
                      selectedCols.push(col);
                      startSizes.set(col, positionDims.getColWidth(col));
                    }
                  }
                  isInSelection = true;
                }
              }
            }

            if (isInSelection && selectedCols.length > 1) {
              const colWidth = positionDims.getColWidth(hit.col);
              selection.startColumnResize(hit.col, x, colWidth, selectedCols, startSizes);
            } else {
              const colWidth = positionDims.getColWidth(hit.col);
              selection.startColumnResize(hit.col, x, colWidth);
            }
            break;
          }

          case 'row-resize-handle': {
            const positionDimsRow = geometry.getPositionDimensions();
            if (!positionDimsRow) {
              break;
            }
            const selectionState = selection.snapshot;
            const selectedRows: number[] = [];
            const startSizes = new Map<number, number>();
            let isInSelection = false;

            if (selectionState.anchorRow !== null) {
              for (const range of selectionState.ranges) {
                if (range.isFullRow && hit.row >= range.startRow && hit.row <= range.endRow) {
                  for (let row = range.startRow; row <= range.endRow; row++) {
                    if (!selectedRows.includes(row)) {
                      selectedRows.push(row);
                      startSizes.set(row, positionDimsRow.getRowHeight(row));
                    }
                  }
                  isInSelection = true;
                }
              }
            }

            if (isInSelection && selectedRows.length > 1) {
              const rowHeight = positionDimsRow.getRowHeight(hit.row);
              selection.startRowResize(hit.row, y, rowHeight, selectedRows, startSizes);
            } else {
              const rowHeight = positionDimsRow.getRowHeight(hit.row);
              selection.startRowResize(hit.row, y, rowHeight);
            }
            break;
          }

          case 'hidden-column-boundary': {
            const hiddenCols: number[] = [];
            const startSizes = new Map<number, number>();
            for (let col = hit.hiddenStart; col <= hit.hiddenEnd; col++) {
              hiddenCols.push(col);
              startSizes.set(col, 0);
            }

            void wb
              .getSheetById(activeSheetId)
              .layout.unhideColumns(hit.hiddenStart, hit.hiddenEnd);

            selection.startColumnResize(hit.hiddenStart, x, 0, hiddenCols, startSizes);
            break;
          }

          case 'hidden-row-boundary': {
            const hiddenRows: number[] = [];
            const startSizes = new Map<number, number>();
            for (let row = hit.hiddenStart; row <= hit.hiddenEnd; row++) {
              hiddenRows.push(row);
              startSizes.set(row, 0);
            }

            void wb.getSheetById(activeSheetId).layout.unhideRows(hit.hiddenStart, hit.hiddenEnd);

            selection.startRowResize(hit.hiddenStart, y, 0, hiddenRows, startSizes);
            break;
          }
        }
      })();
    },
    [
      containerRef,
      getGeometry,
      getHitTest,
      coordinator,
      activeSheetId,
      objectInteraction,
      groupingActions,
      onHyperlinkClick,
      wb,
      selection,
      editorActions,
      formulaRangeDrag,
      cellInteraction,
      uiStoreApi,
      dispatch,
      cachedTables,
      pageBreakPreviewMode,
      formatPainter.isActive,
      formatPainter.sourceFormat,
      handleSelectionBorderDoubleClick,
    ],
  );

  // ==========================================================================
  // Mouse Move Handler
  // ==========================================================================

  const handleMouseMove = useCallback(
    (e: GridMouseEvent) => {
      const pendingTableClickStart = pendingTableClickStartRef.current;
      if (pendingTableClickStart) {
        const dx = e.clientX - pendingTableClickStart.x;
        const dy = e.clientY - pendingTableClickStart.y;
        if (dx * dx + dy * dy > 9) {
          pendingTableClickMovedRef.current = true;
        }
      }

      const container = containerRef.current;
      if (!container) return;

      const { x, y } = getRelativePosition(e, container);
      const position = { x, y };

      // Forward to comment hover coordination for indicator detection
      // This runs in parallel with other mouse move handling
      coordinator.grid.commentHover.handleMouseMove?.({ x, y });

      // 0. Handle page break drag (before other move handling)
      if (isPageBreakDraggingRef.current && pageBreakPreviewMode) {
        coordinator.renderer.updatePageBreakDrag(x, y);
        return; // Consume the event while dragging
      }

      // Fallback: check coordinator state in case ref got out of sync
      if (pageBreakPreviewMode && coordinator.renderer.isPageBreakDragging()) {
        coordinator.renderer.updatePageBreakDrag(x, y);
        return;
      }

      // 0.5. Handle range selection mode drag
      if (rangeSelectionDragRef.current.isDragging) {
        const rangeSelectionMode = uiStoreApi.getState().rangeSelectionMode;
        if (rangeSelectionMode.active && rangeSelectionDragRef.current.startCell) {
          const startCell = rangeSelectionDragRef.current.startCell;
          const mode = rangeSelectionDragRef.current.mode;
          let currentCell: { row: number; col: number } | null = null;

          const hitTest = getHitTest();
          const hit = hitTest?.atViewportPoint({ x, y });
          if (mode === 'row') {
            if (hit?.type === 'row-header' || hit?.type === 'cell') {
              currentCell = { row: hit.row, col: startCell.col };
            }
          } else if (mode === 'column') {
            if (hit?.type === 'column-header' || hit?.type === 'cell') {
              currentCell = { row: startCell.row, col: hit.col };
            }
          }

          const geometry = getGeometry();
          if (!currentCell && geometry) {
            currentCell = geometry.fromViewportPoint({ x, y });
          }

          if (currentCell) {
            applyRangePickerSelection(uiStoreApi, selection, mode, startCell, currentCell);
          }

          return; // Consume the event
        }
      }

      // 1. Handle floating object drag/resize/rotate (and insert mode)
      if (isObjectInteractionOwningPointer(coordinator)) {
        coordinator.objects.handleObjectMouseMove(position, e.shiftKey);
        return;
      }

      // 2. Update hovered handle for cursor feedback
      // Use unified renderer.hitTest() for cursor feedback
      if (!isObjectDragOperationLive(coordinator)) {
        const hitTest = getHitTest();
        if (hitTest) {
          const hit = hitTest.atViewportPoint({ x, y });
          const objectRegion = hit.type === 'floating-object' ? hit.region : null;
          cursorManager.updateCursorFromObjectHit(objectRegion);
        }
      }

      // 3. Handle header resize drag
      if (selection.isResizingHeader) {
        const resizePosition = selection.resizeType === 'column' ? x : y;
        selection.onResizeMove(resizePosition);
        return;
      }

      // 4. Handle table resize drag
      if (selection.isResizingTable) {
        const geometry = getGeometry();
        if (geometry) {
          const cell = geometry.fromViewportPoint({ x, y });
          if (cell) {
            selection.onTableResizeMove(cell.row, cell.col);
          }
        }
        return;
      }

      // 5. Handle formula range box drag
      if (formulaRangeDrag.isFormulaRangeDragging()) {
        formulaRangeDrag.moveFormulaRangeDrag(x, y);
        return;
      }

      // 6. Check if any selection mode is active
      const isAnySelectionActive =
        selection.isSelecting ||
        selection.isDraggingFillHandle ||
        selection.isSelectingColumn ||
        selection.isSelectingRow ||
        selection.snapshot.isDraggingCells;

      // 7. Cursor feedback for interactive elements when not in active selection
      if (!isAnySelectionActive && !cursorManager.hoveredHandleRef.current) {
        const hitTestCap = getHitTest();
        const geometryCap = getGeometry();
        if (hitTestCap && geometryCap) {
          const hit = hitTestCap.atViewportPoint({ x, y });

          // Page break line cursor feedback (before other checks in page break preview mode)
          // hitTestPageBreak is async — fire-and-forget cursor update
          if (pageBreakPreviewMode && !isPageBreakDraggingRef.current) {
            void coordinator.renderer.hitTestPageBreak(x, y).then((pageBreakHit) => {
              if (pageBreakHit) {
                // Use ns-resize for horizontal breaks, ew-resize for vertical
                const cursor =
                  pageBreakHit.orientation === 'horizontal' ? 'ns-resize' : 'ew-resize';
                cursorManager.updateCursor(cursor);
              }
            });
          }

          if (hit.type === 'column-resize-handle' || hit.type === 'hidden-column-boundary') {
            cursorManager.updateCursor(getCursorForHitType('columnResize'));
            return;
          }
          if (hit.type === 'row-resize-handle' || hit.type === 'hidden-row-boundary') {
            cursorManager.updateCursor(getCursorForHitType('rowResize'));
            return;
          }

          // Fill handle cursor feedback
          if (selection.ranges.length > 0) {
            const lastRange = selection.ranges[selection.ranges.length - 1];
            const selectionViewportRect = geometryCap.getRangeRects(lastRange)[0];
            if (selectionViewportRect && isOnFillHandle({ x, y }, selectionViewportRect)) {
              cursorManager.updateCursor(
                getCursorForHitType('fillHandle', { ctrlKey: e.ctrlKey, metaKey: e.metaKey }),
              );
              return;
            }
          }

          // Selection border cursor feedback
          // Tolerance must match the mouse-down drag-initiation path above
          // (3px for pointer/pen, 5px for touch) so the cursor and click
          // agree — no dead zone where the cursor shows `move` but the
          // click selects the cell instead of starting drag.
          if (hit.type === 'cell' && selection.ranges.length > 0) {
            const firstRange = selection.ranges[0];
            const selectionViewportRect = geometryCap.getRangeRects(firstRange)[0];
            const borderTolerance = e.pointerType === 'touch' ? 5 : 3;
            if (
              selectionViewportRect &&
              isOnSelectionBorder({ x, y }, selectionViewportRect, borderTolerance)
            ) {
              cursorManager.updateCursor(
                getCursorForHitType('selectionBorder', { ctrlKey: e.ctrlKey, metaKey: e.metaKey }),
              );
              return;
            }
          }

          // Table resize handle cursor feedback
          if (hit.type === 'cell') {
            const tables = cachedTables;
            for (const table of tables) {
              // Get viewport rect for table start cell
              const tableStartRect = geometryCap.getCellRect({
                row: table.range.startRow,
                col: table.range.startCol,
              });
              const tableEndRect = geometryCap.getCellRect({
                row: table.range.endRow,
                col: table.range.endCol,
              });

              if (!tableStartRect || !tableEndRect) continue; // Table not visible

              const tableRect = {
                x: tableStartRect.x,
                y: tableStartRect.y,
                width: tableEndRect.x + tableEndRect.width - tableStartRect.x,
                height: tableEndRect.y + tableEndRect.height - tableStartRect.y,
              };

              if (isOnTableResizeHandle({ x, y }, tableRect)) {
                cursorManager.updateCursor(getCursorForHitType('tableResize'));
                return;
              }
            }

            // Validation dropdown arrow cursor feedback
            const activeCell = selection.snapshot.activeCell;
            if (activeCell && activeCell.row === hit.row && activeCell.col === hit.col) {
              const hoverCellRect = geometryCap.getCellRect(hit);
              if (!hoverCellRect) return; // Cell not visible
              const hoverPos = {
                x: x - hoverCellRect.x,
                y: y - hoverCellRect.y,
                width: hoverCellRect.width,
                height: hoverCellRect.height,
              };

              if (
                isClickOnValidationDropdown(hoverPos.x, hoverPos.y, hoverPos.width, hoverPos.height)
              ) {
                void (async () => {
                  const ws = wb.getSheetById(activeSheetId);
                  const dropdownItems = await ws.validations.getDropdownItems(hit.row, hit.col);
                  if (dropdownItems && dropdownItems.length > 0) {
                    cursorManager.updateCursor(getCursorForHitType('validationDropdown'));
                  }
                })();
                return;
              }
            }

            // Hyperlink cursor feedback. The URL itself is not in the
            // binary viewport record (see types/viewport reader.ts) — use
            // the sync `hasHyperlink` boolean for the cursor decision.
            const hasHyperlink = ws.viewport.getCellData(hit.row, hit.col)?.hasHyperlink === true;
            if (hasHyperlink) {
              cursorManager.updateCursor(getCursorForHitType('hyperlink'));
            }

            // Cell hover callback for tooltip
            onCellHover?.({ row: hit.row, col: hit.col }, { x: e.clientX, y: e.clientY });

            if (hasHyperlink) return;
          } else {
            onCellHover?.(null, { x: e.clientX, y: e.clientY });
          }

          cursorManager.resetCursor();
        }
      }

      if (!isAnySelectionActive) return;

      const geometry = getGeometry();
      if (!geometry) return;

      // 8. Handle column/row header selection drag
      if (selection.isSelectingColumn || selection.isSelectingRow) {
        const hitTestCap = getHitTest();
        if (!hitTestCap) return;
        const hit = hitTestCap.atViewportPoint({ x, y });

        if (selection.isSelectingColumn) {
          if (hit.type === 'column-header' || hit.type === 'cell') {
            selection.onColumnMouseMove(hit.col);
          }
        } else if (selection.isSelectingRow) {
          if (hit.type === 'row-header' || hit.type === 'cell') {
            selection.onRowMouseMove(hit.row);
          }
        }
        return;
      }

      // 9. Handle fill handle drag
      if (selection.isDraggingFillHandle) {
        cursorManager.updateCursor(
          getCursorForHitType('fillHandle', { ctrlKey: e.ctrlKey, metaKey: e.metaKey }),
        );
        const rawCell = geometry.fromViewportPoint({ x, y });
        if (rawCell) {
          const cell = resolveFillHandleDragCell(rawCell, fillHandleDragAnchorRef.current, {
            x,
            y,
          });
          selection.onFillHandleDrag(cell);
        }
        return;
      }

      // 10. Handle right-click fill handle drag
      if (selection.snapshot.isRightDraggingFillHandle) {
        cursorManager.updateCursor(
          getCursorForHitType('fillHandle', { ctrlKey: e.ctrlKey, metaKey: e.metaKey }),
        );
        const rawCell = geometry.fromViewportPoint({ x, y });
        if (rawCell) {
          const cell = resolveFillHandleDragCell(rawCell, fillHandleDragAnchorRef.current, {
            x,
            y,
          });
          selection.onRightFillHandleDrag(cell);
        }
        return;
      }

      // 11. Handle cell drag operations - USE coordinator.grid.handleDragCellsMove()
      if (selection.snapshot.isDraggingCells) {
        const cell = geometry.fromViewportPoint({ x, y });
        if (cell && selection.snapshot.dragSourceRange) {
          void (async () => {
            const validation = await isValidDropTarget(
              activeSheetId,
              selection.snapshot.dragSourceRange!,
              cell,
            );
            const isCopyMode = e.ctrlKey || e.metaKey;
            cursorManager.updateCursor(getCursorForDrag(true, validation.valid, isCopyMode));
          })();

          // Use coordinator method instead of direct actor access
          const isCopyMode = e.ctrlKey || e.metaKey;
          coordinator.grid.handleDragCellsMove(cell, isCopyMode);
        }
        return;
      }

      // 12. Handle normal cell selection drag
      const cell = geometry.fromViewportPoint({ x, y });
      if (cell) {
        selection.onMouseMove(cell);
      }
    },
    [
      containerRef,
      getGeometry,
      getHitTest,
      coordinator,
      activeSheetId,
      objectInteraction,
      selection,
      ws,
      wb,
      onCellHover,
      cursorManager,
      formulaRangeDrag,
      pageBreakPreviewMode,
    ],
  );

  // ==========================================================================
  // Mouse Up Handler (for React synthetic events, if needed)
  // ==========================================================================

  /**
   * Handle mouse up from React synthetic events.
   * Note: Primary pointer event handling is now done via handlePointerUp
   * which delegates to coordinator.handlePointerUp() for correct state-based dispatch.
   * The coordinator now handles both selection and object interaction states.
   *
   * This handler remains for any edge cases that still use React synthetic events.
   *
   */
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 1. Handle floating object operations (and insert mode)
      if (isObjectInteractionOwningPointer(coordinator)) {
        const container = containerRef.current;
        if (container) {
          const { x, y } = getRelativePosition(e, container);
          coordinator.objects.handleObjectMouseUp({ x, y });
        }
        return;
      }

      // 2. Handle formula range box drag completion
      if (formulaRangeDrag.isFormulaRangeDragging()) {
        formulaRangeDrag.endFormulaRangeDrag();
        return;
      }

      // Selection-related mouse up is handled by coordinator.handlePointerUp()
      // which is called from handlePointerUp in the useEffect below.
      // This avoids the stale React state bug.
    },
    [containerRef, coordinator, formulaRangeDrag],
  );

  // ==========================================================================
  // Mouse Leave Handler
  // ==========================================================================

  /**
   * Handle mouse leave by terminating any active drag state via coordinator.
   * Uses coordinator.handlePointerUp() to query actual machine state
   * instead of potentially-stale React state.
   *
   */
  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Terminate any active drag state via coordinator
      // This queries actual machine state, not potentially-stale React state
      coordinator.handlePointerUp();
      applyPendingFormatPainterTarget();
      cursorManager.resetCursor();
      onCellHover?.(null, { x: e.clientX, y: e.clientY });

      // Notify comment hover coordination that mouse left the grid
      coordinator.grid.commentHover.handleMouseLeave?.();
    },
    [coordinator, applyPendingFormatPainterTarget, cursorManager, onCellHover],
  );

  // ==========================================================================
  // Double Click Handler
  // ==========================================================================

  const handleDoubleClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;

      const { x, y } = getRelativePosition(e, container);

      const geometry = getGeometry();
      if (!geometry) return;

      const hitTest = getHitTest();
      if (!hitTest) return;

      const hit = hitTest.atViewportPoint({ x, y });

      if (
        isMatchingNativeSelectionBorderDoubleClick(
          nativeHandledSelectionBorderDoubleClickRef.current,
          activeSheetId,
          e,
        )
      ) {
        nativeHandledSelectionBorderDoubleClickRef.current = null;
        return;
      }

      // 1. Check floating objects FIRST
      if (hit.type === 'floating-object') {
        const dblClickObj = await ws.objects.getInfo(hit.objectId);

        // Handle Diagram double-click to start node text editing
        if (dblClickObj && dblClickObj.type === 'diagram') {
          // Get the object's position to calculate click position relative to the Diagram
          const clickPositionInObject = {
            x: x - (dblClickObj.x ?? 0),
            y: y - (dblClickObj.y ?? 0),
          };

          // Emit diagram:click event - the Diagram coordination will detect
          // double-clicks via timestamp tracking and call handleDoubleClick internally
          // to start text editing on the clicked node.
          // Note: Double-click detection is handled by Diagram coordination comparing
          // click timestamps, not via a separate event type.
          wb.emit({
            type: 'diagram:click',
            timestamp: Date.now(),
            objectId: hit.objectId,
            nodeId: null, // Node detection will be done by Diagram coordination via hit testing
            clickPosition: clickPositionInObject,
            modifiers: {
              shift: e.shiftKey,
              ctrl: e.ctrlKey,
              meta: e.metaKey,
            },
          });
          return;
        }

        if (dblClickObj && (dblClickObj.type === 'textbox' || dblClickObj.type === 'shape')) {
          // Check if this is a TextEffect textbox (has textEffects config)
          // TextEffect textboxes use a different editing mode for styled text.
          // FloatingObjectInfo doesn't carry textEffects — read full object from Zustand cache.
          if (dblClickObj.type === 'textbox') {
            const cachedObj = coordinator.floatingObjectCache?.getState().objects.get(hit.objectId);
            if (
              cachedObj &&
              cachedObj.type === 'textbox' &&
              'textEffects' in cachedObj &&
              cachedObj.textEffects
            ) {
              objectInteraction.enterTextEffectEditing(hit.objectId);
              // Also update UIStore to set editingTextEffectId
              uiStoreApi.getState().startTextEffectEditing(hit.objectId);
              return;
            }
          }
          objectInteraction.enterTextEditing(hit.objectId);
          return;
        }

        // Handle equation double-click to open equation editor dialog
        if (dblClickObj && dblClickObj.type === 'equation') {
          dispatch('EDIT_EQUATION', { objectId: hit.objectId });
          return;
        }

        return;
      }

      // 2. Handle grid hit test results (hit already available from above)

      // Handle column resize border double-click -> auto-fit column
      if (hit.type === 'column-resize-handle') {
        Promise.all([
          import('../../systems/grid-editing/features/autofit'),
          import('@mog/grid-renderer'),
        ]).then(async ([{ autoFitColumns }, { getTextMeasurementService }]) => {
          const textMeasurement = getTextMeasurementService();
          const ws = wb.getSheetById(activeSheetId);
          const usedRange = await ws.getUsedRange();
          const columnsToFit = getAutofitColumnsForResize(hit.col, selection.ranges, usedRange);
          await autoFitColumns(
            activeSheetId,
            columnsToFit,
            textMeasurement,
            (entries) => ws.formatValues(entries),
            wb ?? undefined,
          );
        });
        return;
      }

      // Handle row resize border double-click -> auto-fit row
      if (hit.type === 'row-resize-handle') {
        Promise.all([
          import('../../systems/grid-editing/features/autofit'),
          import('@mog/grid-renderer'),
        ]).then(async ([{ autoFitRows }, { getTextMeasurementService }]) => {
          const textMeasurement = getTextMeasurementService();
          const ws = wb.getSheetById(activeSheetId);
          const usedRange = await ws.getUsedRange();
          const rowsToFit = getAutofitRowsForResize(hit.row, selection.ranges, usedRange);
          await autoFitRows(
            activeSheetId,
            rowsToFit,
            textMeasurement,
            (entries) => ws.formatValues(entries),
            wb ?? undefined,
          );
        });
        return;
      }

      // Double-click fill handle to fill down to adjacent data extent
      if (selection.ranges.length > 0 && geometry) {
        const lastRange = selection.ranges[selection.ranges.length - 1];
        const selectionViewportRect = geometry.getRangeRects(lastRange)[0];

        if (selectionViewportRect && isOnFillHandle({ x, y }, selectionViewportRect)) {
          dispatch('DOUBLE_CLICK_FILL_HANDLE');
          return;
        }
      }

      // Double-click selection border uses Excel data-edge navigation while
      // preserving empty-region right/bottom no-op behavior.
      if (selection.ranges.length > 0 && geometry) {
        const firstRange = selection.ranges[0];
        const selRect = geometry.getRangeRects(firstRange)[0];

        if (selRect && isOnSelectionBorder({ x, y }, selRect, 2)) {
          await handleSelectionBorderDoubleClick(getSelectionBorderEdge({ x, y }, selRect));
          return;
        }
      }

      // Handle hidden column boundary double-click -> unhide columns
      if (hit.type === 'hidden-column-boundary') {
        void wb.getSheetById(activeSheetId).layout.unhideColumns(hit.hiddenStart, hit.hiddenEnd);
        return;
      }

      // Handle hidden row boundary double-click -> unhide rows
      if (hit.type === 'hidden-row-boundary') {
        void wb.getSheetById(activeSheetId).layout.unhideRows(hit.hiddenStart, hit.hiddenEnd);
        return;
      }

      if (hit.type === 'cell') {
        const cell = { row: hit.row, col: hit.col };
        const cellRect = geometry.getCellRect(cell);
        const cornerSelection = cellRect
          ? getTableCornerDoubleClickRange(cachedTables, cell.row, cell.col, {
              clickXInCell: x - cellRect.x,
              clickYInCell: y - cellRect.y,
              cellWidth: cellRect.width,
              cellHeight: cellRect.height,
            })
          : null;

        if (cornerSelection) {
          uiStoreApi.getState().handleCornerClick(cornerSelection.tableId);
          selection.setSelection([cornerSelection.range], {
            row: cornerSelection.range.startRow,
            col: cornerSelection.range.startCol,
          });
          return;
        }

        if (
          isMatchingNativeCellDoubleClick(
            nativeHandledCellDoubleClickRef.current,
            cell,
            activeSheetId,
            e,
          )
        ) {
          nativeHandledCellDoubleClickRef.current = null;
          return;
        }

        handleCellDoubleClickAtViewportPoint(cell, { x, y }, geometry);
      }
    },
    [
      containerRef,
      coordinator,
      activeSheetId,
      getGeometry,
      getHitTest,
      objectInteraction,
      selection,
      wb,
      dispatch,
      handleCellDoubleClickAtViewportPoint,
      handleSelectionBorderDoubleClick,
      uiStoreApi,
      cachedTables,
    ],
  );

  // ==========================================================================
  // Pointer Capture Setup
  // ==========================================================================

  useEffect(() => {
    const container = containerRef.current;
    const pointerCaptureManager = coordinator.input.pointerCaptureManager;
    pointerCaptureManager.setContainerElement(container);
    return () => {
      pointerCaptureManager.setContainerElement(null);
    };
  }, [containerRef, coordinator]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handlePointerDown = (e: PointerEvent) => {
      // DOM overlays that own their own pointer behavior opt out of the grid
      // native pointer path. React synthetic stopPropagation() cannot prevent
      // this native listener from firing.
      if ((e.target as HTMLElement | null)?.closest?.('[data-no-grid-pointer]')) return;

      // Ensure keyboard focus is on the grid container for keyboard shortcuts.
      // Native pointer events (addEventListener) don't auto-focus like React synthetic events.
      // Without this, clicking on shapes/objects won't let Backspace/Delete work.
      //
      // EXCEPTION: When currently editing, do NOT steal focus from the editor input.
      // container.focus() would blur the editor input, triggering onBlur → commit,
      // which exits formulaEditing before the click interception in handleMouseDown
      // can insert a cell reference. Also preventDefault to stop the browser from
      // implicitly focusing the container (which has tabIndex={0}).
      const editorSnapshot = coordinator.grid.getEditorSnapshot();
      if (editorSnapshot.isEditing) {
        e.preventDefault();
      } else {
        container.focus();
      }

      // Skip events in scrollbar regions — ScrollContainer handles these.
      // Native pointerdown fires before React synthetic stopPropagation() can
      // intervene (React 18 delegation timing), so we guard by coordinates.
      const rect = container.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      if (relX >= rect.width - SCROLL_BAR_WIDTH || relY >= rect.height - SCROLL_BAR_WIDTH) return;

      // Right-click on fill handle
      if (e.button === 2) {
        const geometry = getGeometry();
        if (geometry && selection.ranges.length > 0) {
          const rect = container.getBoundingClientRect();
          const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

          const lastRange = selection.ranges[selection.ranges.length - 1];
          const selectionViewportRect = geometry.getRangeRects(lastRange)[0];

          if (selectionViewportRect && isOnFillHandle(pos, selectionViewportRect)) {
            e.preventDefault();
            coordinator.input.setActivePointerId(e.pointerId);
            const handleCell = getRangeBottomRightCell(lastRange);
            fillHandleDragAnchorRef.current = createFillHandleDragAnchor(
              lastRange,
              pos,
              selectionViewportRect,
              geometry.getCellRect(handleCell),
            );
            selection.startRightFillHandleDrag();
            return;
          }
        }
        return;
      }

      if (e.button !== 0) return;

      coordinator.input.inputCoordinator.interrupt();

      if (e.detail === 2) {
        const geometry = getGeometry();
        const hitTest = getHitTest();
        if (geometry && hitTest) {
          const hit = hitTest.atViewportPoint({ x: relX, y: relY });
          if (hit.type === 'cell') {
            const cell = { row: hit.row, col: hit.col };
            const point = { x: relX, y: relY };
            const lastRange = selection.ranges[selection.ranges.length - 1];
            const lastRangeRect = lastRange ? geometry.getRangeRects(lastRange)[0] : null;
            const firstRange = selection.ranges[0];
            const firstRangeRect = firstRange ? geometry.getRangeRects(firstRange)[0] : null;
            const doubleClickBorderTolerance = e.pointerType === 'touch' ? 5 : 1;
            const isReservedSelectionGesture =
              (lastRangeRect && isOnFillHandle(point, lastRangeRect)) ||
              (firstRangeRect &&
                isOnSelectionBorder(point, firstRangeRect, doubleClickBorderTolerance));

            const cellRect = geometry.getCellRect(cell);
            if (cellRect) {
              const cornerSelection = getTableCornerDoubleClickRange(
                cachedTables,
                cell.row,
                cell.col,
                {
                  clickXInCell: relX - cellRect.x,
                  clickYInCell: relY - cellRect.y,
                  cellWidth: cellRect.width,
                  cellHeight: cellRect.height,
                },
              );

              if (cornerSelection) {
                uiStoreApi.getState().handleCornerClick(cornerSelection.tableId);
                selection.setSelection([cornerSelection.range], {
                  row: cornerSelection.range.startRow,
                  col: cornerSelection.range.startCol,
                });
                pendingTableClickSelectionRef.current = null;
                pendingTableClickStartRef.current = null;
                pendingTableClickMovedRef.current = false;
                e.preventDefault();
                return;
              }
            }

            if (
              !isReservedSelectionGesture &&
              handleCellDoubleClickAtViewportPoint(cell, point, geometry)
            ) {
              const now = Date.now();
              clickCountRef.current = 2;
              lastClickTimeRef.current = now;
              lastClickCellRef.current = { ...cell, sheetId: activeSheetId };
              nativeHandledCellDoubleClickRef.current = {
                ...cell,
                sheetId: activeSheetId,
                clientX: e.clientX,
                clientY: e.clientY,
                time: now,
              };
              return;
            }
          }
        }
      }

      coordinator.input.setActivePointerId(e.pointerId);
      handleMouseDown(e);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-no-grid-pointer]')) return;

      // Skip events in scrollbar regions to prevent selection extension
      // during scrollbar drag (same guard as handlePointerDown).
      const rect = container.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      if (relX >= rect.width - SCROLL_BAR_WIDTH || relY >= rect.height - SCROLL_BAR_WIDTH) return;

      handleMouseMove(e);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-no-grid-pointer]')) return;

      // Reset page break dragging state
      isPageBreakDraggingRef.current = false;

      // Reset range selection drag state
      rangeSelectionDragRef.current = { isDragging: false, mode: 'cell', startCell: null };

      // Shape insertion needs the release position to finalize drag-defined
      // bounds. Route it through object coordination before the generic
      // drag terminators, whose shared interface is intentionally positionless.
      if (isObjectInteractionOwningPointer(coordinator)) {
        const rect = container.getBoundingClientRect();
        coordinator.objects.handleObjectMouseUp({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }

      // Delegate to coordinator for correct state-based event dispatch
      // This queries actual machine state, not potentially-stale React state
      coordinator.handlePointerUp();
      fillHandleDragAnchorRef.current = null;
      applyPendingFormatPainterTarget();

      const pendingTableClick = pendingTableClickSelectionRef.current;
      if (pendingTableClick && !pendingTableClickMovedRef.current) {
        const resolved = resolvePendingTableClickSelection(
          pendingTableClick,
          uiStoreApi.getState(),
        );
        if (resolved) {
          selection.setSelection([resolved.range], resolved.activeCell);
        }
      }
      pendingTableClickSelectionRef.current = null;
      pendingTableClickStartRef.current = null;
      pendingTableClickMovedRef.current = false;

      // Handle formula range box drag completion (non-selection operation)
      if (formulaRangeDrag.isFormulaRangeDragging()) {
        formulaRangeDrag.endFormulaRangeDrag();
      }
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-no-grid-pointer]')) return;

      // Reset page break dragging state
      isPageBreakDraggingRef.current = false;

      // Reset range selection drag state
      rangeSelectionDragRef.current = { isDragging: false, mode: 'cell', startCell: null };
      pendingFormatPainterTargetRef.current = false;
      pendingTableClickSelectionRef.current = null;
      pendingTableClickStartRef.current = null;
      pendingTableClickMovedRef.current = false;

      // Use cancel handler to safely reset any drag state
      coordinator.handlePointerCancel();
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [
    containerRef,
    coordinator,
    applyPendingFormatPainterTarget,
    handleMouseDown,
    handleMouseMove,
    formulaRangeDrag,
    selection,
    getGeometry,
    getHitTest,
    activeSheetId,
    handleCellDoubleClickAtViewportPoint,
    dispatch,
    uiStoreApi,
    cachedTables,
  ]);

  // ==========================================================================
  // Return Value
  // ==========================================================================

  return useMemo(
    () => ({
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      handleMouseLeave,
      handleDoubleClick,
      handleContextMenu: contextMenuHandler.handleContextMenu,
      cursor: cursorManager.cursor,
    }),
    [
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      handleMouseLeave,
      handleDoubleClick,
      contextMenuHandler.handleContextMenu,
      cursorManager.cursor,
    ],
  );
}
