/**
 * Context Menu Actions Hook
 *
 * Provides action handlers for the cell context menu.
 *
 * Architecture (
 * - Actions: Routed through unified dispatch() system (single source of truth)
 * - Reads: Direct domain module access (Cells.getHyperlink, Dimensions.isRowHidden, etc.)
 * - Dialogs: UIStore
 *
 * The dispatch() system ensures that:
 * - Keyboard shortcuts, toolbar buttons, and context menu all use the same handler
 * - No duplicate implementations across different input sources
 * - Clipboard operations go through the XState clipboard-machine via dispatch()
 * - Structure operations go through the same handlers as keyboard shortcuts
 *
 * @see docs/renderer/README.md - Architecture principles
 * @module hooks/use-context-menu-actions
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { dispatch } from '../../actions';
import { withHandlerErrors } from '../../devtools/handler-error-boundary';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../infra/context';
import { rangeToA1 } from '../../systems/shared/types';
import { useGroupingActions } from '../data/use-grouping-actions';
import { useSparklineManager } from '../data/use-sparkline-manager';
import { useClipboard } from '../editing/use-clipboard';
import { useActiveCell } from '../selection/use-active-cell';
import { useSelectionRanges } from '../selection/use-granular-selection';
import { useSelectionActions } from '../selection/use-selection-actions';
import { useSheetViewOptions } from '../view/use-sheet-view-options';
import { useActionDependencies } from './use-action-dependencies';
import { isPickerBackedValidation } from '../../systems/grid-editing/coordination/editor-validation-resolution';
import { clipboardSelectors } from '../../selectors';
import { useCoordinator } from '../shared/use-coordinator';
import { trackPendingClipboardPaste } from '../../systems/grid-editing/coordination/pending-clipboard-paste';
import type { ClipboardState } from '@mog-sdk/contracts/actors';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Types
// =============================================================================

type ContextMenuCell = CellCoord | null;

interface ClipboardActorLike {
  getSnapshot(): ClipboardState;
  subscribe(listener: (state: ClipboardState) => void): { unsubscribe: () => void };
}

function isClipboardPastePending(state: ClipboardState): boolean {
  return clipboardSelectors.isPastePreview(state) || clipboardSelectors.isPasting(state);
}

function waitForClipboardPasteIdle(actor: ClipboardActorLike, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  if (!isClipboardPastePending(actor.getSnapshot())) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let resolved = false;
    let subscription: { unsubscribe: () => void } | null = null;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      subscription?.unsubscribe();
      signal?.removeEventListener('abort', finish);
      resolve();
    };

    signal?.addEventListener('abort', finish, { once: true });

    subscription = actor.subscribe((state) => {
      if (!isClipboardPastePending(state)) {
        finish();
      }
    });

    if (!isClipboardPastePending(actor.getSnapshot())) {
      finish();
    }
  });
}

const CONTEXT_MENU_ACTION_DELAY_MS = 50;

function runAfterInputClick<T>(callback: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(callback());
      } catch (error) {
        reject(error);
      }
    }, CONTEXT_MENU_ACTION_DELAY_MS);
  });
}

export interface UseContextMenuActionsReturn {
  // Clipboard actions
  cut: () => void;
  copy: () => void;
  paste: () => void;
  pasteSpecial: () => void;
  canPaste: boolean;

  // Paste Options Submenu
  pasteValues: () => void;
  pasteFormulas: () => void;
  pasteFormatting: () => void;
  pasteTranspose: () => void;

  // Paste Link/Picture Options
  pasteLink: () => void;
  pasteAsPicture: () => void;
  pasteAsLinkedPicture: () => void;

  // Insert actions
  insertRowAbove: () => void;
  insertRowBelow: () => void;
  insertColumnLeft: () => void;
  insertColumnRight: () => void;

  // Insert Cells Dialog
  insertCells: () => void;
  insertCutCells: () => void;
  hasCutClipboard: boolean;

  // Delete actions
  deleteRows: () => void;
  deleteColumns: () => void;

  // Delete Cells Dialog
  deleteCells: () => void;

  // Selection-type detection for context menu labels
  isFullRowSelection: boolean;
  isFullColumnSelection: boolean;
  isContiguousSelection: boolean;

  // Mixed selection & entire sheet detection
  /** True if entire sheet is selected (Ctrl+A or corner click) */
  isEntireSheetSelection: boolean;
  /** True if selection contains both full rows/cols AND partial ranges */
  isMixedSelection: boolean;

  // Hide/Show actions
  hideRows: () => void;
  hideColumns: () => void;
  unhideRows: () => void;
  unhideColumns: () => void;
  hasHiddenRowsInSelection: boolean;
  hasHiddenColsInSelection: boolean;

  // Resize dialogs
  openRowHeightDialog: () => void;
  openColumnWidthDialog: () => void;

  // Clear actions
  clearContents: () => void;
  clearFormatting: () => void;

  // Selection info
  selectedRowCount: number;
  selectedColCount: number;

  // Page break actions
  insertHorizontalPageBreak: () => void;
  removeHorizontalPageBreak: () => void;
  insertVerticalPageBreak: () => void;
  removeVerticalPageBreak: () => void;
  /** Whether the current selection has a horizontal page break at its start row */
  hasHorizontalPageBreakAtSelection: boolean;
  /** Whether the current selection has a vertical page break at its start col */
  hasVerticalPageBreakAtSelection: boolean;
  /** Whether page break preview mode is enabled */
  isPageBreakPreviewMode: boolean;

  // Grouping actions (Grouping)
  groupRows: () => void;
  ungroupRows: () => void;
  groupColumns: () => void;
  ungroupColumns: () => void;
  canGroup: boolean;
  canUngroup: boolean;

  // Sparkline actions
  editSparkline: () => void;
  clearSparkline: () => void;
  ungroupSparkline: () => void;
  /** Whether the active cell has a sparkline */
  hasSparklineAtActiveCell: boolean;
  /** Whether the active cell's sparkline is part of a group */
  isSparklineInGroup: boolean;
  /** The sparkline ID at the active cell (if any) */
  sparklineIdAtActiveCell: string | null;

  // Merge actions
  /** Merge cells in selection */
  mergeCells: () => void;
  /** Merge & Center: merge and apply center alignment */
  mergeAndCenter: () => void;
  /** Unmerge cells in selection */
  unmergeCells: () => void;
  /** Whether merge is available (multi-cell selection, not already merged) */
  canMerge: boolean;
  /** Whether unmerge is available (selection contains merged cells) */
  canUnmerge: boolean;
  /** Whether selection is currently merged */
  isMerged: boolean;

  // Hyperlink actions
  /** Open hyperlink dialog to insert a new hyperlink */
  insertHyperlink: () => void;
  /** Open hyperlink dialog to edit existing hyperlink */
  editHyperlink: () => void;
  /** Remove hyperlink from active cell */
  removeHyperlink: () => void;
  /** Whether the active cell has a hyperlink */
  hasHyperlinkAtActiveCell: boolean;

  // Open Hyperlink
  /** Open hyperlink at active cell in new tab */
  openHyperlink: () => void;

  // Copy Hyperlink URL to clipboard
  /** Copy hyperlink URL to clipboard */
  copyHyperlink: () => void;

  // Format Cells Dialog (Context Menu Parity)
  /** Open format cells dialog */
  openFormatCellsDialog: () => void;

  // Comment actions
  /** Insert a new comment on the active cell */
  insertComment: () => void;
  /** Edit the existing comment on the active cell */
  editComment: () => void;
  /** Delete all comments on the active cell */
  deleteComment: () => void;
  /** Whether the active cell has a comment */
  hasCommentAtActiveCell: boolean;
  /** Show/Hide all comments on the sheet */
  showHideComment: () => void;

  // Sort/Filter Actions
  /** Sort ascending on current column */
  sortAscending: () => void;
  /** Sort descending on current column */
  sortDescending: () => void;
  /** Open custom sort dialog */
  openCustomSortDialog: () => void;
  /** Filter by selected value */
  filterBySelectedValue: () => void;
  /** Filter by cell color */
  filterByColor: () => void;
  /** Clear all filters */
  clearFilter: () => void;

  // Sort/Filter by Color Expansion
  /** Sort by cell background color */
  sortByCellColor: () => void;
  /** Sort by font color */
  sortByFontColor: () => void;
  /** Filter by font color */
  filterByFontColor: () => void;
  /** Re-apply all filters */
  reapplyFilters: () => void;

  // Data Validation Dialog
  /** Open data validation dialog for the selected range */
  openDataValidationDialog: () => void;

  // Data Validation Dropdown Trigger
  /** Whether the active cell has a dropdown list validation */
  hasDropdownAtActiveCell: boolean;
  /** Open the dropdown list at the active cell */
  openDropdown: () => void;

  // Define Name Dialog
  /** Open define name dialog with current selection pre-filled */
  openDefineNameDialog: () => void;

  // Error and Array Formula Context Menu Items
  /** Whether the active cell contains an error value */
  hasErrorAtActiveCell: boolean;
  /** Whether the active cell is part of an array formula (spill or CSE) */
  isInArrayFormula: boolean;
  /** Trace precedents for the error cell */
  traceError: () => void;
  /** Ignore error indicator for the cell */
  ignoreError: () => void;
  /** Select entire array formula range */
  selectArray: () => void;

  // Table Context Menu
  /** Whether the active cell is inside a table */
  isInTable: boolean;
  /** The table ID if selection is in a table, otherwise null */
  tableIdAtActiveCell: string | null;
  /** Insert table row above current selection */
  insertTableRowAbove: () => void;
  /** Insert table row below current selection */
  insertTableRowBelow: () => void;
  /** Insert table column to the left */
  insertTableColumnLeft: () => void;
  /** Insert table column to the right */
  insertTableColumnRight: () => void;
  /** Delete selected table rows */
  deleteTableRows: () => void;
  /** Delete selected table columns */
  deleteTableColumns: () => void;
  /** Select entire table */
  selectEntireTable: () => void;
  /** Convert table to range */
  convertTableToRange: () => void;

  // Show Formulas option
  /** Toggle show formulas view */
  toggleShowFormulas: () => void;
  /** Whether formulas are currently being shown instead of values */
  isShowingFormulas: boolean;

  // Manage Rules shortcut for conditional formatting
  /** Open the Conditional Formatting Rules Manager dialog */
  openCFRulesManager: () => void;
  /** Whether the active cell has conditional formatting applied */
  hasCFAtActiveCell: boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useContextMenuActions(
  contextMenuCell: ContextMenuCell = null,
): UseContextMenuActionsReturn {
  const coordinator = useCoordinator();
  const clipboardActor = coordinator.grid.access.actors.clipboard as ClipboardActorLike;
  const clipboard = useClipboard();
  // Use granular hooks for better performance - only subscribe to what's needed
  const ranges = useSelectionRanges();
  const { activeCell } = useActiveCell();
  const { setSelection } = useSelectionActions();
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const ws = wb.getSheetById(activeSheetId);
  const groupingActions = useGroupingActions();
  const { sparklineManager } = useSparklineManager();
  const resolvedContextCell = contextMenuCell ?? activeCell;
  const selectResolvedContextCell = useCallback(() => {
    setSelection(
      [
        {
          startRow: resolvedContextCell.row,
          startCol: resolvedContextCell.col,
          endRow: resolvedContextCell.row,
          endCol: resolvedContextCell.col,
        },
      ],
      resolvedContextCell,
    );
  }, [resolvedContextCell, setSelection]);

  // Merge state derivation — inlined from the deleted use-merge hook
  // (Text formatting dispatch). Same logic as the ribbon AlignmentGroup
  // and the Format Cells > Alignment dialog: read toolbarRanges + viewport
  // merges, derive isMerged/canMerge/canUnmerge for menu enablement.
  const toolbarRangesForMerge = useUIStore((s) => s.toolbarRanges);
  const mergeState = useMemo(() => {
    if (!toolbarRangesForMerge || toolbarRangesForMerge.length === 0) {
      return { isMerged: false, canMerge: false, canUnmerge: false };
    }
    const r = toolbarRangesForMerge[0];
    const sRow = Math.min(r.startRow, r.endRow);
    const sCol = Math.min(r.startCol, r.endCol);
    const eRow = Math.max(r.startRow, r.endRow);
    const eCol = Math.max(r.startCol, r.endCol);

    const sheet = wb.getSheetById(activeSheetId);
    const viewportMerges = sheet.viewport.getMerges();
    const findMergeForCell = (row: number, col: number) =>
      viewportMerges.find(
        (m) => row >= m.start_row && row <= m.end_row && col >= m.start_col && col <= m.end_col,
      ) ?? null;

    const isSingleCell = sRow === eRow && sCol === eCol;
    if (isSingleCell) {
      const merge = findMergeForCell(sRow, sCol);
      return { isMerged: merge !== null, canMerge: false, canUnmerge: merge !== null };
    }

    const originMerge = findMergeForCell(sRow, sCol);
    const exactMerged =
      originMerge !== null &&
      originMerge.start_row === sRow &&
      originMerge.start_col === sCol &&
      originMerge.end_row === eRow &&
      originMerge.end_col === eCol;

    let overlapsMerge = false;
    for (const region of viewportMerges) {
      if (
        region.start_row <= eRow &&
        region.end_row >= sRow &&
        region.start_col <= eCol &&
        region.end_col >= sCol
      ) {
        overlapsMerge = true;
        break;
      }
    }

    return { isMerged: exactMerged, canMerge: !exactMerged, canUnmerge: overlapsMerge };
  }, [wb, activeSheetId, toolbarRangesForMerge]);

  // Get action dependencies for unified dispatch
  const actionDeps = useActionDependencies();

  // UIStore actions (only sparkline edit dialog remains as non-dispatch)
  const closeContextMenu = useUIStore((s) => s.closeContextMenu);
  const openEditSparklineDialog = useUIStore((s) => s.openEditSparklineDialog);

  const { viewOptions } = useSheetViewOptions(activeSheetId);
  const isShowingFormulas = viewOptions.showFormulas;

  // Get selection bounds
  const selectionBounds = useMemo(() => {
    if (!ranges || ranges.length === 0) {
      return { startRow: 0, endRow: 0, startCol: 0, endCol: 0 };
    }

    let startRow = Infinity;
    let endRow = -Infinity;
    let startCol = Infinity;
    let endCol = -Infinity;

    for (const range of ranges) {
      startRow = Math.min(startRow, range.startRow);
      endRow = Math.max(endRow, range.endRow);
      startCol = Math.min(startCol, range.startCol);
      endCol = Math.max(endCol, range.endCol);
    }

    return { startRow, endRow, startCol, endCol };
  }, [ranges]);

  const selectedRowCount = selectionBounds.endRow - selectionBounds.startRow + 1;
  const selectedColCount = selectionBounds.endCol - selectionBounds.startCol + 1;

  // ==========================================================================
  // Clipboard Actions
  // ==========================================================================

  const cut = useCallback(() => {
    dispatch('CUT', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const copy = useCallback(() => {
    dispatch('COPY', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const paste = useCallback(() => {
    // / O-A: tag any thrown error from this fire-and-forget chain
    // as 'handler:PASTE' so it's discoverable via __dt.recentErrors. The
    // dispatcher's own try/catch already converts rejections into
    // `{handled:false, error}` resolutions, so this is a defensive belt for
    // any future code path that bypasses that conversion.
    const result = dispatch('PASTE', actionDeps);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void withHandlerErrors('PASTE', () => result as Promise<unknown>);
    }
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const pasteSpecial = useCallback(() => {
    dispatch('OPEN_PASTE_SPECIAL_DIALOG', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Paste Options Submenu
  const pasteValues = useCallback(() => {
    dispatch('PASTE_VALUES', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const pasteFormulas = useCallback(() => {
    dispatch('PASTE_FORMULAS', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const pasteFormatting = useCallback(() => {
    dispatch('PASTE_FORMATTING', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const pasteTranspose = useCallback(() => {
    dispatch('PASTE_TRANSPOSE', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Paste Link/Picture Options
  const pasteLink = useCallback(() => {
    dispatch('PASTE_LINK', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const pasteAsPicture = useCallback(() => {
    dispatch('PASTE_AS_PICTURE', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const pasteAsLinkedPicture = useCallback(() => {
    dispatch('PASTE_AS_LINKED_PICTURE', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Insert Actions
  // ==========================================================================

  const insertRowAbove = useCallback(() => {
    dispatch('INSERT_ROW_ABOVE', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const insertRowBelow = useCallback(() => {
    dispatch('INSERT_ROW_BELOW', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const insertColumnLeft = useCallback(() => {
    dispatch('INSERT_COLUMN_LEFT', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const insertColumnRight = useCallback(() => {
    dispatch('INSERT_COLUMN_RIGHT', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Insert Cells Dialog
  const insertCells = useCallback(() => {
    closeContextMenu();
    // Defer dialog opening to next microtask so Radix DropdownMenu
    // completes its unmount/focus-restoration before Dialog mounts
    queueMicrotask(() => {
      dispatch('OPEN_INSERT_CELLS_DIALOG', actionDeps);
    });
  }, [actionDeps, closeContextMenu]);

  const insertCutCells = useCallback(() => {
    closeContextMenu();
    trackPendingClipboardPaste(
      runAfterInputClick(() => {
        selectResolvedContextCell();
        return dispatch('INSERT_CUT_CELLS_SHIFT_DOWN', actionDeps);
      }),
    );
  }, [actionDeps, closeContextMenu, selectResolvedContextCell]);

  // ==========================================================================
  // Delete Actions
  // ==========================================================================

  const deleteRows = useCallback(() => {
    dispatch('DELETE_ROWS', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const deleteColumns = useCallback(() => {
    dispatch('DELETE_COLUMNS', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const deleteCells = useCallback(() => {
    closeContextMenu();
    // Defer dialog opening to next microtask so Radix DropdownMenu
    // completes its unmount/focus-restoration before Dialog mounts
    queueMicrotask(() => {
      dispatch('OPEN_DELETE_CELLS_DIALOG', actionDeps);
    });
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Hide/Show State Derivation (used for UI display)
  // ==========================================================================

  // Check for hidden rows/cols using Worksheet API (async)
  const [hasHiddenRowsInSelection, setHasHiddenRowsInSelection] = useState(false);
  const [hasHiddenColsInSelection, setHasHiddenColsInSelection] = useState(false);

  // Single bulk bridge call returning the sheet's hidden-row bitmap, then a
  // pure-JS intersection with the selection's row span (plus the two adjacent
  // rows for "unhide hidden rows between visible rows"). Replaces a per-row
  // awaited `isRowHidden` loop that, on a full-column right-click
  // (endRow = MAX_ROWS-1 = 1,048,575), fired ~1M bridge round-trips and
  // blocked menu paint for ~3.2s on empty docs.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ws = wb.getSheetById(activeSheetId);
        const hiddenRows = await ws.layout.getHiddenRowsBitmap();
        if (cancelled) return;
        let found = false;
        // Iterate the hidden set (typically tiny — only actually hidden rows),
        // not the selection range (which can be 1M+ for full-column).
        for (const row of hiddenRows) {
          if (
            (row >= selectionBounds.startRow && row <= selectionBounds.endRow) ||
            (selectionBounds.startRow > 0 && row === selectionBounds.startRow - 1) ||
            row === selectionBounds.endRow + 1
          ) {
            found = true;
            break;
          }
        }
        if (!cancelled) setHasHiddenRowsInSelection(found);
      } catch {
        if (!cancelled) setHasHiddenRowsInSelection(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wb, activeSheetId, selectionBounds.startRow, selectionBounds.endRow]);

  // Symmetric bulk-query for columns. Row-header right-click installs a
  // full-row range (endCol = MAX_COLS-1 = 16,383) — same per-cell loop
  // pathology, measured ~117ms.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ws = wb.getSheetById(activeSheetId);
        const hiddenCols = await ws.layout.getHiddenColumnsBitmap();
        if (cancelled) return;
        let found = false;
        for (const col of hiddenCols) {
          if (
            (col >= selectionBounds.startCol && col <= selectionBounds.endCol) ||
            (selectionBounds.startCol > 0 && col === selectionBounds.startCol - 1) ||
            col === selectionBounds.endCol + 1
          ) {
            found = true;
            break;
          }
        }
        if (!cancelled) setHasHiddenColsInSelection(found);
      } catch {
        if (!cancelled) setHasHiddenColsInSelection(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wb, activeSheetId, selectionBounds.startCol, selectionBounds.endCol]);

  // ==========================================================================
  // Hide/Show Actions
  // ==========================================================================
  const hideRows = useCallback(() => {
    dispatch('HIDE_ROW', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const hideColumns = useCallback(() => {
    dispatch('HIDE_COLUMN', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const unhideRows = useCallback(() => {
    dispatch('UNHIDE_ROW', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const unhideColumns = useCallback(() => {
    dispatch('UNHIDE_COLUMN', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Resize Dialogs
  // ==========================================================================

  const openRowHeightDialog = useCallback(() => {
    dispatch('OPEN_ROW_HEIGHT_DIALOG', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const openColumnWidthDialog = useCallback(() => {
    dispatch('OPEN_COLUMN_WIDTH_DIALOG', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Page Break Actions
  // ==========================================================================

  // Use Sheets domain module for page break operations
  const pageBreakPreviewMode = useUIStore((s) => s.pageBreakPreviewMode);
  const [pageBreaks, setPageBreaks] = useState<{
    rowBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
    colBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
  }>({
    rowBreaks: [],
    colBreaks: [],
  });

  useEffect(() => {
    const run = async () => {
      const ws = wb.getSheetById(activeSheetId);
      const pb = await ws.print.getPageBreaks();
      setPageBreaks(pb);
    };
    void run();
  }, [wb, activeSheetId]);

  const hasHorizontalPageBreakAtSelection = useMemo(() => {
    return pageBreaks.rowBreaks.some((e) => e.id === selectionBounds.startRow);
  }, [pageBreaks.rowBreaks, selectionBounds.startRow]);

  const hasVerticalPageBreakAtSelection = useMemo(() => {
    return pageBreaks.colBreaks.some((e) => e.id === selectionBounds.startCol);
  }, [pageBreaks.colBreaks, selectionBounds.startCol]);

  const insertHorizontalPageBreak = useCallback(() => {
    dispatch('INSERT_HORIZONTAL_PAGE_BREAK', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const removeHorizontalPageBreak = useCallback(() => {
    dispatch('REMOVE_HORIZONTAL_PAGE_BREAK', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const insertVerticalPageBreak = useCallback(() => {
    dispatch('INSERT_VERTICAL_PAGE_BREAK', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const removeVerticalPageBreak = useCallback(() => {
    dispatch('REMOVE_VERTICAL_PAGE_BREAK', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Clear Actions
  // ==========================================================================

  const clearContents = useCallback(() => {
    // / O-A: tag any thrown error as 'handler:CLEAR_CONTENTS'.
    const result = dispatch('CLEAR_CONTENTS', actionDeps);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void withHandlerErrors('CLEAR_CONTENTS', () => result as Promise<unknown>);
    }
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const clearFormatting = useCallback(() => {
    dispatch('CLEAR_FORMATS', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Grouping Actions
  // ==========================================================================

  const groupRows = useCallback(() => {
    groupingActions.groupRows();
    closeContextMenu();
  }, [groupingActions, closeContextMenu]);

  const ungroupRows = useCallback(() => {
    groupingActions.ungroupRows();
    closeContextMenu();
  }, [groupingActions, closeContextMenu]);

  const groupColumns = useCallback(() => {
    groupingActions.groupColumns();
    closeContextMenu();
  }, [groupingActions, closeContextMenu]);

  const ungroupColumns = useCallback(() => {
    groupingActions.ungroupColumns();
    closeContextMenu();
  }, [groupingActions, closeContextMenu]);

  // ==========================================================================
  // Merge Actions
  //
  // Text formatting dispatch: routes through dispatch instead of the
  // deleted useMerge hook. Plain "Merge Cells" (no center) goes through the
  // MERGE_CELLS handler; "Merge & Center" through MERGE_AND_CENTER; unmerge
  // through UNMERGE_CELLS.
  // ==========================================================================

  const mergeCellsAction = useCallback(() => {
    dispatch('MERGE_CELLS', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const mergeAndCenterAction = useCallback(() => {
    dispatch('MERGE_AND_CENTER', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const unmergeCellsAction = useCallback(() => {
    dispatch('UNMERGE_CELLS', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Sparkline Actions
  // ==========================================================================

  // activeCell is now provided by useActiveCell() hook for better performance

  // Check if the active cell has a sparkline
  const sparklineAtActiveCell = useMemo(() => {
    return sparklineManager.getSparklineAtCell(activeSheetId, activeCell.row, activeCell.col);
  }, [sparklineManager, activeSheetId, activeCell.row, activeCell.col]);

  const hasSparklineAtActiveCell = sparklineAtActiveCell !== undefined;
  const sparklineIdAtActiveCell = sparklineAtActiveCell?.id ?? null;

  // Check if the sparkline is part of a group
  const isSparklineInGroup = sparklineAtActiveCell?.groupId !== undefined;

  const editSparkline = useCallback(() => {
    if (sparklineAtActiveCell) {
      openEditSparklineDialog(sparklineAtActiveCell.id, activeCell.row, activeCell.col);
      closeContextMenu();
    }
  }, [
    sparklineAtActiveCell,
    openEditSparklineDialog,
    activeCell.row,
    activeCell.col,
    closeContextMenu,
  ]);

  const clearSparkline = useCallback(() => {
    if (sparklineAtActiveCell) {
      void sparklineManager.deleteSparkline(sparklineAtActiveCell.id);
      closeContextMenu();
    }
  }, [sparklineAtActiveCell, sparklineManager, closeContextMenu]);

  // Ungroup sparkline
  const ungroupSparkline = useCallback(() => {
    if (sparklineAtActiveCell?.groupId) {
      void sparklineManager.ungroupSparklines(sparklineAtActiveCell.groupId);
      closeContextMenu();
    }
  }, [sparklineAtActiveCell, sparklineManager, closeContextMenu]);

  // ==========================================================================
  // Hyperlink Actions
  // ==========================================================================

  // The hyperlink *URL* is intentionally NOT carried in the binary viewport
  // record (per types/viewport/src/viewport/reader.ts:50–51 — "use
  // hasHyperlink flag + async API"). The `hasHyperlink` BIT is also
  // currently unreliable: Rust's `set_hyperlink` returns empty viewport
  // patches (compute/core/src/storage/engine/objects.rs:876), so the binary
  // buffer's bit isn't refreshed until the cell is re-rendered for some
  // OTHER reason. We therefore source the presence of a hyperlink from the
  // async kernel API (`ws.hyperlinks.has`) into a stateful boolean — the
  // context menu reads this when deciding whether to render the
  // Edit/Remove branch vs. the Insert branch.
  const [hasHyperlinkAtActiveCell, setHasHyperlinkAtActiveCell] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const present = await ws.hyperlinks.has(activeCell.row, activeCell.col);
        if (!cancelled) setHasHyperlinkAtActiveCell(present);
      } catch {
        if (!cancelled) setHasHyperlinkAtActiveCell(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ws, activeCell.row, activeCell.col]);

  const insertHyperlink = useCallback(() => {
    closeContextMenu();
    // Defer the dialog open to the next microtask so Radix ContextMenu finishes
    // its unmount/focus-restoration before the Dialog mounts. Without this,
    // Radix's DismissableLayer interprets the focus-restoration from the
    // closing context menu as an outside click and closes the dialog
    // immediately. Same pattern as openCustomSortDialog above.
    queueMicrotask(() => {
      dispatch('OPEN_HYPERLINK_DIALOG', actionDeps, {
        row: activeCell.row,
        col: activeCell.col,
        existingHyperlink: undefined,
      });
    });
  }, [actionDeps, activeCell.row, activeCell.col, closeContextMenu]);

  const editHyperlink = useCallback(() => {
    closeContextMenu();
    // Defer dialog open — see insertHyperlink. Don't pass existingHyperlink
    // — the handler does the async lookup via the kernel hyperlinks API.
    // (The viewport-buffer read is unreliable because hyperlinkUrl is not in
    // the binary record.)
    queueMicrotask(() => {
      dispatch('OPEN_HYPERLINK_DIALOG', actionDeps, {
        row: activeCell.row,
        col: activeCell.col,
      });
    });
  }, [actionDeps, activeCell.row, activeCell.col, closeContextMenu]);

  const removeHyperlinkAction = useCallback(() => {
    dispatch('REMOVE_HYPERLINK', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Open Hyperlink
  const openHyperlink = useCallback(() => {
    dispatch('OPEN_HYPERLINK', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Copy Hyperlink URL to clipboard.
  // Source the URL from the kernel API rather than the viewport buffer
  // (see comment above on hasHyperlinkAtActiveCell).
  const copyHyperlink = useCallback(() => {
    void (async () => {
      try {
        const url = await ws.hyperlinks.get(activeCell.row, activeCell.col);
        if (url) {
          await navigator.clipboard.writeText(url);
        }
      } finally {
        closeContextMenu();
      }
    })();
  }, [ws, activeCell.row, activeCell.col, closeContextMenu]);

  // ==========================================================================
  // Format Cells Dialog (Context Menu Parity)
  // ==========================================================================

  const openFormatCellsDialog = useCallback(() => {
    dispatch('OPEN_FORMAT_CELLS_DIALOG', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Comment Actions
  // ==========================================================================

  // Sync check via viewport buffer (threaded comments only; legacy notes return false here)
  const hasCommentViewport = useMemo(() => {
    return ws.viewport.hasComment(resolvedContextCell.row, resolvedContextCell.col);
  }, [ws.viewport, resolvedContextCell.row, resolvedContextCell.col]);

  // Async check via Comments domain (covers all types, including legacy notes)
  const [hasCommentAsync, setHasCommentAsync] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    setHasCommentAsync(false);
    void (async () => {
      try {
        await waitForClipboardPasteIdle(clipboardActor, abortController.signal);
        if (cancelled) return;
        const present = await ws.comments.hasComment(
          resolvedContextCell.row,
          resolvedContextCell.col,
        );
        if (!cancelled) setHasCommentAsync(present);
      } catch {
        if (!cancelled) setHasCommentAsync(false);
      }
    })();
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [ws, clipboardActor, resolvedContextCell.row, resolvedContextCell.col]);

  const hasCommentAtActiveCell = hasCommentViewport || hasCommentAsync;

  const insertComment = useCallback(() => {
    selectResolvedContextCell();
    dispatch('INSERT_COMMENT', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu, selectResolvedContextCell]);

  const editComment = useCallback(() => {
    selectResolvedContextCell();
    dispatch('EDIT_COMMENT', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu, selectResolvedContextCell]);

  const deleteComment = useCallback(() => {
    selectResolvedContextCell();
    dispatch('DELETE_COMMENT', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu, selectResolvedContextCell]);

  // Show/Hide Comment
  const showHideComment = useCallback(() => {
    selectResolvedContextCell();
    dispatch('SHOW_HIDE_COMMENTS', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu, selectResolvedContextCell]);

  // ==========================================================================
  // Sort/Filter Actions
  // ==========================================================================

  const sortAscending = useCallback(() => {
    dispatch('SORT_ASCENDING', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const sortDescending = useCallback(() => {
    dispatch('SORT_DESCENDING', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const openCustomSortDialog = useCallback(() => {
    closeContextMenu();
    // Defer dialog opening to next microtask so Radix ContextMenu
    // completes its unmount/focus-restoration before Dialog mounts.
    // Without this deferral the Sort dialog opens and immediately closes
    // because Radix's DismissableLayer interprets the focus-restoration
    // from the closing context menu as an outside click.
    // Same pattern as insertCells / deleteCells (see above).
    queueMicrotask(() => {
      dispatch('OPEN_CUSTOM_SORT_DIALOG', actionDeps);
    });
  }, [actionDeps, closeContextMenu]);

  const filterBySelectedValue = useCallback(() => {
    dispatch('FILTER_BY_SELECTED_VALUE', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const filterByColor = useCallback(() => {
    dispatch('FILTER_BY_COLOR', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Filter by Font Color
  const filterByFontColor = useCallback(() => {
    dispatch('FILTER_BY_FONT_COLOR', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Re-apply filters
  const reapplyFilters = useCallback(() => {
    dispatch('REAPPLY_FILTERS', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  const clearFilter = useCallback(() => {
    dispatch('CLEAR_FILTER', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Sort by Cell Color
  const sortByCellColor = useCallback(() => {
    dispatch('SORT_BY_CELL_COLOR', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Sort by Font Color
  const sortByFontColor = useCallback(() => {
    dispatch('SORT_BY_FONT_COLOR', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Data Validation Dialog
  // ==========================================================================

  const openDataValidationDialog = useCallback(() => {
    dispatch('OPEN_DV_DIALOG', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Data Validation Dropdown Trigger
  // ==========================================================================

  // Migrated: ws.validations.get() replaces Schemas.getRangeSchema for dropdown detection.
  // ValidationRule has type='list', showDropdown, values, listSource fields directly.
  const [hasDropdownAtActiveCell, setHasDropdownAtActiveCell] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ws = wb.getSheetById(activeSheetId);
    void ws.validations.get(activeCell.row, activeCell.col).then((rule) => {
      if (cancelled) return;
      if (!rule) {
        setHasDropdownAtActiveCell(false);
        return;
      }
      setHasDropdownAtActiveCell(isPickerBackedValidation(rule));
    });
    return () => {
      cancelled = true;
    };
  }, [wb, activeSheetId, activeCell.row, activeCell.col]);

  // Open the dropdown at the active cell
  const openDropdown = useCallback(() => {
    dispatch('OPEN_DROPDOWN', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Define Name Dialog
  // ==========================================================================

  // Open Define Name dialog with current selection pre-filled
  const openDefineNameDialog = useCallback(() => {
    // Get the first range for the "Refers to" field
    const firstRange = ranges?.[0];
    const refersTo = firstRange ? `=${rangeToA1(firstRange)}` : `=$A$1:$A$1`;
    dispatch('OPEN_DEFINE_NAME_DIALOG', actionDeps, {
      mode: 'create',
      initialRefersTo: refersTo,
      initialScope: activeSheetId,
    });
    closeContextMenu();
  }, [ranges, activeSheetId, actionDeps, closeContextMenu]);

  // ==========================================================================
  // Selection-Type Detection for Context Menu Labels
  // ==========================================================================

  // Check if the entire selection consists of full rows
  const isFullRowSelection = useMemo(() => {
    return ranges.some((range) => range.isFullRow === true);
  }, [ranges]);

  // Check if the entire selection consists of full columns
  const isFullColumnSelection = useMemo(() => {
    return ranges.some((range) => range.isFullColumn === true);
  }, [ranges]);

  // Check if the selection is contiguous (single range)
  const isContiguousSelection = useMemo(() => {
    return ranges.length === 1;
  }, [ranges.length]);

  // ==========================================================================
  // Mixed Selection & Entire Sheet Detection
  // ==========================================================================

  // Check if entire sheet is selected (both full row AND full column selection)
  const isEntireSheetSelection = useMemo(() => {
    // Entire sheet = full row selection AND full column selection in the same range
    // This happens when user presses Ctrl+A or clicks the corner button
    return isFullRowSelection && isFullColumnSelection;
  }, [isFullRowSelection, isFullColumnSelection]);

  // Check for mixed selection (some full rows/cols + partial ranges)
  const isMixedSelection = useMemo(() => {
    if (!ranges || ranges.length <= 1) return false;

    let hasFullRange = false;
    let hasPartialRange = false;

    for (const range of ranges) {
      const isFullRow = range.isFullRow === true;
      const isFullCol = range.isFullColumn === true;
      if (isFullRow || isFullCol) {
        hasFullRange = true;
      } else {
        hasPartialRange = true;
      }
    }

    return hasFullRange && hasPartialRange;
  }, [ranges]);

  // ==========================================================================
  // Error and Array Formula Detection
  // ==========================================================================

  // Helper to check if a value is an error
  const isErrorValue = useCallback((value: unknown): boolean => {
    if (value instanceof Error) return true;
    if (typeof value === 'string') {
      const errorStrings = [
        '#VALUE!',
        '#REF!',
        '#NAME?',
        '#DIV/0!',
        '#N/A',
        '#NULL!',
        '#NUM!',
        '#SPILL!',
        '#CALC!',
      ];
      return errorStrings.includes(value);
    }
    // Check for error object format
    if (value && typeof value === 'object' && 'type' in value && value.type === 'error') {
      return true;
    }
    return false;
  }, []);

  // Use ViewportBuffer instead of Cells domain module
  const hasErrorAtActiveCell = useMemo(() => {
    const vpCell = ws.viewport.getCellData(activeCell.row, activeCell.col);
    if (!vpCell) return false;
    // Check if value is an error (error object or error string)
    if (vpCell.value && isErrorValue(vpCell.value)) return true;
    return false;
  }, [ws.viewport, activeCell.row, activeCell.col, isErrorValue]);

  // Array formula detection is handled by Rust compute-core (async).
  // Sync stubs have been removed — this is always false until async wiring is added.
  const isInArrayFormula = false;

  // Trace precedents for error cell
  const traceError = useCallback(() => {
    dispatch('TRACE_ERROR', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Ignore error indicator for cell
  const ignoreError = useCallback(() => {
    dispatch('IGNORE_ERROR', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Select entire array formula range
  const selectArray = useCallback(() => {
    dispatch('SELECT_ARRAY', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Table Context Menu
  // ==========================================================================

  // Check if the active cell is inside a table (async)
  const [tableAtActiveCell, setTableAtActiveCell] = useState<any | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ws = wb.getSheetById(activeSheetId);
        const result = await ws.tables.getAtCell(activeCell.row, activeCell.col);
        if (!cancelled) setTableAtActiveCell(result ?? undefined);
      } catch {
        if (!cancelled) setTableAtActiveCell(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wb, activeSheetId, activeCell.row, activeCell.col]);

  const isInTable = tableAtActiveCell !== undefined;
  const tableIdAtActiveCell = tableAtActiveCell?.name ?? tableAtActiveCell?.id ?? null;

  // Insert table row above
  const insertTableRowAbove = useCallback(() => {
    if (!tableIdAtActiveCell) return;
    dispatch('INSERT_TABLE_ROW_ABOVE', actionDeps, {
      tableId: tableIdAtActiveCell,
      rowIndex: activeCell.row,
    });
    closeContextMenu();
  }, [actionDeps, tableIdAtActiveCell, activeCell.row, closeContextMenu]);

  // Insert table row below
  const insertTableRowBelow = useCallback(() => {
    if (!tableIdAtActiveCell) return;
    dispatch('INSERT_TABLE_ROW_BELOW', actionDeps, {
      tableId: tableIdAtActiveCell,
      rowIndex: activeCell.row,
    });
    closeContextMenu();
  }, [actionDeps, tableIdAtActiveCell, activeCell.row, closeContextMenu]);

  // Insert table column to the left
  const insertTableColumnLeft = useCallback(() => {
    if (!tableIdAtActiveCell) return;
    dispatch('INSERT_TABLE_COLUMN_LEFT', actionDeps, {
      tableId: tableIdAtActiveCell,
      columnIndex: activeCell.col,
    });
    closeContextMenu();
  }, [actionDeps, tableIdAtActiveCell, activeCell.col, closeContextMenu]);

  // Insert table column to the right
  const insertTableColumnRight = useCallback(() => {
    if (!tableIdAtActiveCell) return;
    dispatch('INSERT_TABLE_COLUMN_RIGHT', actionDeps, {
      tableId: tableIdAtActiveCell,
      columnIndex: activeCell.col,
    });
    closeContextMenu();
  }, [actionDeps, tableIdAtActiveCell, activeCell.col, closeContextMenu]);

  // Delete selected table rows
  const deleteTableRows = useCallback(() => {
    if (!tableIdAtActiveCell) return;
    dispatch('DELETE_TABLE_ROWS', actionDeps, {
      tableId: tableIdAtActiveCell,
      startRow: ranges[0]?.startRow ?? activeCell.row,
      endRow: ranges[0]?.endRow ?? activeCell.row,
    });
    closeContextMenu();
  }, [actionDeps, tableIdAtActiveCell, ranges, activeCell.row, closeContextMenu]);

  // Delete selected table columns
  const deleteTableColumns = useCallback(() => {
    if (!tableIdAtActiveCell) return;
    dispatch('DELETE_TABLE_COLUMNS', actionDeps, {
      tableId: tableIdAtActiveCell,
      startCol: ranges[0]?.startCol ?? activeCell.col,
      endCol: ranges[0]?.endCol ?? activeCell.col,
    });
    closeContextMenu();
  }, [actionDeps, tableIdAtActiveCell, ranges, activeCell.col, closeContextMenu]);

  // Select entire table
  const selectEntireTable = useCallback(() => {
    if (!tableAtActiveCell) return;
    const tableRange = tableAtActiveCell.range;
    // Use setSelection action to select the entire table
    setSelection(
      [
        {
          startRow: tableRange.startRow,
          startCol: tableRange.startCol,
          endRow: tableRange.endRow,
          endCol: tableRange.endCol,
        },
      ],
      { row: tableRange.startRow, col: tableRange.startCol },
    );
    closeContextMenu();
  }, [tableAtActiveCell, setSelection, closeContextMenu]);

  // Convert table to range
  const convertTableToRange = useCallback(() => {
    if (!tableIdAtActiveCell) return;
    dispatch('OPEN_CONVERT_TO_RANGE_DIALOG', actionDeps, {
      tableId: tableIdAtActiveCell,
    });
    closeContextMenu();
  }, [actionDeps, tableIdAtActiveCell, closeContextMenu]);

  // ==========================================================================
  // Show Formulas
  // ==========================================================================

  const toggleShowFormulas = useCallback(() => {
    dispatch('TOGGLE_FORMULA_VIEW', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // ==========================================================================
  // Manage Rules (Conditional Formatting)
  // ==========================================================================

  const openCFRulesManager = useCallback(() => {
    dispatch('OPEN_CF_RULES_MANAGER', actionDeps);
    closeContextMenu();
  }, [actionDeps, closeContextMenu]);

  // Check if active cell has conditional formatting (via Worksheet API)
  const [hasCFAtActiveCell, setHasCFAtActiveCell] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const ws = wb.getSheetById(activeSheetId);
        const formats = await ws.conditionalFormats.list();
        if (cancelled) return;

        const row = activeCell.row;
        const col = activeCell.col;
        const found = formats.some((format) =>
          format.ranges?.some(
            (range) =>
              row >= range.startRow &&
              row <= range.endRow &&
              col >= range.startCol &&
              col <= range.endCol,
          ),
        );
        if (!cancelled) setHasCFAtActiveCell(found);
      } catch {
        if (!cancelled) setHasCFAtActiveCell(false);
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [wb, activeSheetId, activeCell.row, activeCell.col]);

  // ==========================================================================
  // Return
  // ==========================================================================

  return useMemo(
    () => ({
      // Clipboard
      cut,
      copy,
      paste,
      pasteSpecial,
      canPaste: clipboard.hasClipboard && !clipboard.isPasting,

      // Paste Options Submenu
      pasteValues,
      pasteFormulas,
      pasteFormatting,
      pasteTranspose,

      // Paste Link/Picture Options
      pasteLink,
      pasteAsPicture,
      pasteAsLinkedPicture,

      // Insert
      insertRowAbove,
      insertRowBelow,
      insertColumnLeft,
      insertColumnRight,

      // Insert Cells Dialog
      insertCells,
      insertCutCells,
      hasCutClipboard: clipboard.hasCut,

      // Delete
      deleteRows,
      deleteColumns,

      deleteCells,

      // Selection-type detection
      isFullRowSelection,
      isFullColumnSelection,
      isContiguousSelection,

      // Mixed selection & entire sheet detection
      isEntireSheetSelection,
      isMixedSelection,

      // Hide/Show
      hideRows,
      hideColumns,
      unhideRows,
      unhideColumns,
      hasHiddenRowsInSelection,
      hasHiddenColsInSelection,

      // Resize
      openRowHeightDialog,
      openColumnWidthDialog,

      // Clear
      clearContents,
      clearFormatting,

      // Selection info
      selectedRowCount,
      selectedColCount,

      // Page breaks
      insertHorizontalPageBreak,
      removeHorizontalPageBreak,
      insertVerticalPageBreak,
      removeVerticalPageBreak,
      hasHorizontalPageBreakAtSelection,
      hasVerticalPageBreakAtSelection,
      isPageBreakPreviewMode: pageBreakPreviewMode,

      // Grouping (Grouping)
      groupRows,
      ungroupRows,
      groupColumns,
      ungroupColumns,
      canGroup: groupingActions.canGroup,
      canUngroup: groupingActions.canUngroup,

      // Sparkline
      editSparkline,
      clearSparkline,
      ungroupSparkline,
      hasSparklineAtActiveCell,
      isSparklineInGroup,
      sparklineIdAtActiveCell,

      // Merge
      mergeCells: mergeCellsAction,
      mergeAndCenter: mergeAndCenterAction,
      unmergeCells: unmergeCellsAction,
      canMerge: mergeState.canMerge,
      canUnmerge: mergeState.canUnmerge,
      isMerged: mergeState.isMerged,

      // Hyperlink
      insertHyperlink,
      editHyperlink,
      removeHyperlink: removeHyperlinkAction,
      hasHyperlinkAtActiveCell,

      // Open Hyperlink
      openHyperlink,

      // Copy Hyperlink URL
      copyHyperlink,

      // Format Cells Dialog (Context Menu Parity)
      openFormatCellsDialog,

      // Comments
      insertComment,
      editComment,
      deleteComment,
      hasCommentAtActiveCell,
      showHideComment,

      // Sort/Filter Actions
      sortAscending,
      sortDescending,
      openCustomSortDialog,
      // Sort by Color
      sortByCellColor,
      sortByFontColor,
      filterBySelectedValue,
      filterByColor,
      // Filter by Font Color and Re-apply
      filterByFontColor,
      reapplyFilters,
      clearFilter,

      // Data Validation Dialog
      openDataValidationDialog,

      // Data Validation Dropdown Trigger
      hasDropdownAtActiveCell,
      openDropdown,

      // Define Name Dialog
      openDefineNameDialog,

      hasErrorAtActiveCell,
      isInArrayFormula,
      traceError,
      ignoreError,
      selectArray,

      // Table Context Menu
      isInTable,
      tableIdAtActiveCell,
      insertTableRowAbove,
      insertTableRowBelow,
      insertTableColumnLeft,
      insertTableColumnRight,
      deleteTableRows,
      deleteTableColumns,
      selectEntireTable,
      convertTableToRange,

      toggleShowFormulas,
      isShowingFormulas,

      openCFRulesManager,
      hasCFAtActiveCell,
    }),
    [
      cut,
      copy,
      paste,
      pasteSpecial,
      clipboard.hasClipboard,
      clipboard.isPasting,
      pasteValues,
      pasteFormulas,
      pasteFormatting,
      pasteTranspose,
      pasteLink,
      pasteAsPicture,
      pasteAsLinkedPicture,
      insertRowAbove,
      insertRowBelow,
      insertColumnLeft,
      insertColumnRight,
      insertCells,
      insertCutCells,
      clipboard.hasCut,
      deleteRows,
      deleteColumns,
      deleteCells,
      isFullRowSelection,
      isFullColumnSelection,
      isContiguousSelection,
      isEntireSheetSelection,
      isMixedSelection,
      hideRows,
      hideColumns,
      unhideRows,
      unhideColumns,
      hasHiddenRowsInSelection,
      hasHiddenColsInSelection,
      openRowHeightDialog,
      openColumnWidthDialog,
      clearContents,
      clearFormatting,
      selectedRowCount,
      selectedColCount,
      insertHorizontalPageBreak,
      removeHorizontalPageBreak,
      insertVerticalPageBreak,
      removeVerticalPageBreak,
      hasHorizontalPageBreakAtSelection,
      hasVerticalPageBreakAtSelection,
      pageBreakPreviewMode,
      groupRows,
      ungroupRows,
      groupColumns,
      ungroupColumns,
      groupingActions.canGroup,
      groupingActions.canUngroup,
      editSparkline,
      clearSparkline,
      ungroupSparkline,
      hasSparklineAtActiveCell,
      isSparklineInGroup,
      sparklineIdAtActiveCell,
      mergeCellsAction,
      mergeAndCenterAction,
      unmergeCellsAction,
      mergeState.canMerge,
      mergeState.canUnmerge,
      mergeState.isMerged,
      insertHyperlink,
      editHyperlink,
      removeHyperlinkAction,
      hasHyperlinkAtActiveCell,
      openHyperlink,
      copyHyperlink,
      openFormatCellsDialog,
      insertComment,
      editComment,
      deleteComment,
      hasCommentAtActiveCell,
      showHideComment,
      sortAscending,
      sortDescending,
      openCustomSortDialog,
      sortByCellColor,
      sortByFontColor,
      filterBySelectedValue,
      filterByColor,
      filterByFontColor,
      reapplyFilters,
      clearFilter,
      openDataValidationDialog,
      hasDropdownAtActiveCell,
      openDropdown,
      openDefineNameDialog,
      hasErrorAtActiveCell,
      isInArrayFormula,
      traceError,
      ignoreError,
      selectArray,
      isInTable,
      tableIdAtActiveCell,
      insertTableRowAbove,
      insertTableRowBelow,
      insertTableColumnLeft,
      insertTableColumnRight,
      deleteTableRows,
      deleteTableColumns,
      selectEntireTable,
      convertTableToRange,
      toggleShowFormulas,
      isShowingFormulas,
      openCFRulesManager,
      hasCFAtActiveCell,
    ],
  );
}
