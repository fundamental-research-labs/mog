/**
 * Workbook Action Handlers
 *
 * Pure handler functions for workbook-related actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps) => ActionResult
 * - Sheet lifecycle and grouping go directly through the unified
 * `WorkbookInternal` API (`deps.workbook.sheets.*`,
 * `ws.outline.*`). The legacy stringly-typed callback was
 * deleted in every workbook-side mutation
 * routes through the typed Workbook API now.
 *
 * This file handles:
 * - Sheet navigation (previous/next sheet, Ctrl+PageUp/PageDown)
 * - Sheet management (insert sheet, delete sheet)
 * - Grouping operations (group, ungroup, show/hide detail —
 * ported from `apps/spreadsheet/src/hooks/data/use-grouping-actions.ts`).
 *
 */

import type { ActionHandler, ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';
import { MAX_COLS, MAX_ROWS, type CellRange, type SheetId } from '@mog-sdk/contracts/core';

import { handled, notHandled } from './handler-utils';

// =============================================================================
// Selection bounds helper (ported from use-grouping-actions.ts:52-68)
// =============================================================================

interface SelectionBounds {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

type GroupingAxis = 'rows' | 'columns';

/**
 * Compute bounding box of all selected ranges. Mirrors
 * `computeSelectionBounds` in `use-grouping-actions.ts:52-68`.
 *
 * Returns null when the selection is empty (no ranges) — the caller
 * surfaces `disabled` upstream.
 */
function computeSelectionBounds(ranges: readonly CellRange[]): SelectionBounds | null {
  if (ranges.length === 0) return null;

  let startRow = Infinity;
  let endRow = -Infinity;
  let startCol = Infinity;
  let endCol = -Infinity;

  for (const range of ranges) {
    startRow = Math.min(startRow, range.startRow, range.endRow);
    endRow = Math.max(endRow, range.startRow, range.endRow);
    startCol = Math.min(startCol, range.startCol, range.endCol);
    endCol = Math.max(endCol, range.startCol, range.endCol);
  }

  return { startRow, endRow, startCol, endCol };
}

function inferGroupingAxis(
  ranges: readonly CellRange[],
  bounds: SelectionBounds,
): GroupingAxis | null {
  const fullSelectionAxis = inferFullSelectionAxis(ranges);
  if (fullSelectionAxis) return fullSelectionAxis;
  return inferSpanAxis(bounds);
}

function inferFullSelectionAxis(ranges: readonly CellRange[]): GroupingAxis | null {
  let axis: GroupingAxis | null = null;

  for (const range of ranges) {
    const isFullColumn = hasFullColumnIntent(range);
    const isFullRow = hasFullRowIntent(range);

    if (isFullColumn && !isFullRow) {
      if (axis === 'rows') return null;
      axis = 'columns';
      continue;
    }

    if (isFullRow && !isFullColumn) {
      if (axis === 'columns') return null;
      axis = 'rows';
      continue;
    }

    // Ordinary ranges and select-all/both-axis ranges keep the legacy
    // row-first span fallback.
    return null;
  }

  return axis;
}

function hasFullColumnIntent(range: CellRange): boolean {
  const startRow = Math.min(range.startRow, range.endRow);
  const endRow = Math.max(range.startRow, range.endRow);
  return range.isFullColumn === true || (startRow === 0 && endRow === MAX_ROWS - 1);
}

function hasFullRowIntent(range: CellRange): boolean {
  const startCol = Math.min(range.startCol, range.endCol);
  const endCol = Math.max(range.startCol, range.endCol);
  return range.isFullRow === true || (startCol === 0 && endCol === MAX_COLS - 1);
}

function inferSpanAxis(bounds: SelectionBounds): GroupingAxis | null {
  const rowSpan = bounds.endRow - bounds.startRow + 1;
  const colSpan = bounds.endCol - bounds.startCol + 1;

  if (rowSpan >= 2) return 'rows';
  if (colSpan >= 2) return 'columns';
  return null;
}

/** Minimal shape of `GroupDefinition` used by the show/hide detail iterators. */
interface GroupRecord {
  id: string;
  start: number;
  end: number;
  level: number;
  collapsed: boolean;
}

function findInnermostContainingGroup(
  groups: readonly GroupRecord[],
  start: number,
  end: number,
): GroupRecord | null {
  let match: GroupRecord | null = null;
  for (const group of groups) {
    if (group.start > start || group.end < end) continue;
    if (!match || group.level > match.level || group.end - group.start < match.end - match.start) {
      match = group;
    }
  }
  return match;
}

// =============================================================================
// Sheet Navigation Actions
// =============================================================================

/**
 * Ctrl+PageUp - Navigate to the previous visible sheet.
 *
 * Uses the kernel state mirror (`wb.mirror`) for synchronous sheet
 * enumeration — same source the tab strip reads from. We filter to
 * visible sheets and wrap around the active sheet's index.
 *
 * Reference: `apps/spreadsheet/src/index.tsx:516-545`
 * (the legacy app-level switch that this replaces).
 */
export const PREVIOUS_SHEET: ActionHandler = (deps): ActionResult => {
  const { workbook: wb } = deps;
  const visibleSheets = collectVisibleSheets(wb);
  if (visibleSheets.length === 0) return notHandled('disabled');

  const activeId = wb.getActiveSheetId();
  const currentIndex = visibleSheets.findIndex((s) => s.id === activeId);
  if (currentIndex === -1) return notHandled('disabled');

  const n = visibleSheets.length;
  const prevIndex = (currentIndex - 1 + n) % n;
  void wb.sheets.setActive(visibleSheets[prevIndex].id);
  return handled();
};

/**
 * Ctrl+PageDown - Navigate to the next visible sheet.
 */
export const NEXT_SHEET: ActionHandler = (deps): ActionResult => {
  const { workbook: wb } = deps;
  const visibleSheets = collectVisibleSheets(wb);
  if (visibleSheets.length === 0) return notHandled('disabled');

  const activeId = wb.getActiveSheetId();
  const currentIndex = visibleSheets.findIndex((s) => s.id === activeId);
  if (currentIndex === -1) return notHandled('disabled');

  const n = visibleSheets.length;
  const nextIndex = (currentIndex + 1) % n;
  void wb.sheets.setActive(visibleSheets[nextIndex].id);
  return handled();
};

/**
 * Shift+F11 - Insert a new sheet via the unified Workbook API.
 *
 * Mirrors `useSheetTabActions().handleAddSheet`: pass no name and let
 * the kernel pick a unique "SheetN" so we don't race against a stale
 * sheet count (the same race that produced duplicate React keys before).
 */
export const INSERT_SHEET: AsyncActionHandler = async (deps) => {
  await deps.workbook.sheets.add();
  return handled();
};

/**
 * Delete the active sheet via the unified Workbook API.
 *
 * Guards against deleting the only sheet — the underlying API throws on
 * the last-sheet remove anyway, but we prefer a clean `notHandled`
 * disabled signal at the action layer.
 */
export const DELETE_SHEET: AsyncActionHandler = async (deps) => {
  const { workbook: wb } = deps;
  const visibleSheets = collectVisibleSheets(wb);
  if (visibleSheets.length <= 1) {
    return notHandled('disabled');
  }
  const activeId = wb.getActiveSheetId();
  await wb.sheets.remove(activeId);
  return handled();
};

// =============================================================================
// Grouping Actions
//
// Ported from apps/spreadsheet/src/hooks/data/use-grouping-actions.ts:269-443.
// Selection bounds come from `deps.accessors.selection.getRanges()` (the
// same selection accessor every other handler uses), NOT
// `coordinator.grid.getSelectionSnapshot`; keeping `coordinator?: unknown`
// untouched preserves the current handler contract.
// =============================================================================

/**
 * Alt+Shift+Right - Group selected rows (rowSpan ≥ 2) or columns
 * (colSpan ≥ 2). Full-row/full-column selections use the raw range
 * intent first; ordinary and select-all ranges keep the legacy row-first
 * span fallback (i.e. a single cell never groups).
 */
export const GROUP: AsyncActionHandler = async (deps) => {
  const { workbook: wb } = deps;
  const ranges = deps.accessors.selection.getRanges();
  const bounds = computeSelectionBounds(ranges);
  if (!bounds) return notHandled('disabled');

  const axis = inferGroupingAxis(ranges, bounds);

  const ws = wb.getSheetById(wb.getActiveSheetId());
  if (axis === 'rows') {
    wb.setPendingUndoDescription(`Group rows ${bounds.startRow + 1}-${bounds.endRow + 1}`);
    await ws.outline.groupRows(bounds.startRow, bounds.endRow);
    return handled();
  }
  if (axis === 'columns') {
    wb.setPendingUndoDescription(`Group columns ${bounds.startCol + 1}-${bounds.endCol + 1}`);
    await ws.outline.groupColumns(bounds.startCol, bounds.endCol);
    return handled();
  }
  return notHandled('disabled');
};

/**
 * Alt+Shift+Left - Ungroup selected rows or columns.
 * Mirrors GROUP's axis decision: full-row/full-column intent first,
 * then the legacy row-first span fallback.
 */
export const UNGROUP: AsyncActionHandler = async (deps) => {
  const { workbook: wb } = deps;
  const ranges = deps.accessors.selection.getRanges();
  const bounds = computeSelectionBounds(ranges);
  if (!bounds) return notHandled('disabled');

  const axis = inferGroupingAxis(ranges, bounds);

  const ws = wb.getSheetById(wb.getActiveSheetId());
  if (axis === 'rows') {
    wb.setPendingUndoDescription(`Ungroup rows ${bounds.startRow + 1}-${bounds.endRow + 1}`);
    await ws.outline.ungroupRows(bounds.startRow, bounds.endRow);
    return handled();
  }
  if (axis === 'columns') {
    wb.setPendingUndoDescription(`Ungroup columns ${bounds.startCol + 1}-${bounds.endCol + 1}`);
    await ws.outline.ungroupColumns(bounds.startCol, bounds.endCol);
    return handled();
  }
  const state = await ws.outline.getState();
  const containingRowGroup = findInnermostContainingGroup(
    state.rowGroups as GroupRecord[],
    bounds.startRow,
    bounds.endRow,
  );
  if (containingRowGroup) {
    wb.setPendingUndoDescription(
      `Ungroup rows ${containingRowGroup.start + 1}-${containingRowGroup.end + 1}`,
    );
    await ws.outline.ungroupRows(containingRowGroup.start, containingRowGroup.end);
    return handled();
  }

  const containingColumnGroup = findInnermostContainingGroup(
    state.columnGroups as GroupRecord[],
    bounds.startCol,
    bounds.endCol,
  );
  if (containingColumnGroup) {
    wb.setPendingUndoDescription(
      `Ungroup columns ${containingColumnGroup.start + 1}-${containingColumnGroup.end + 1}`,
    );
    await ws.outline.ungroupColumns(containingColumnGroup.start, containingColumnGroup.end);
    return handled();
  }
  return notHandled('disabled');
};

/**
 * Alt+Shift+Down / Ctrl+Shift+J - Show detail (expand any collapsed
 * groups containing the selection). Iterates rowGroups + columnGroups.
 * Ported from `use-grouping-actions.ts:383-407`.
 */
export const SHOW_DETAIL: AsyncActionHandler = async (deps) => {
  const { workbook: wb } = deps;
  const bounds = computeSelectionBounds(deps.accessors.selection.getRanges());
  if (!bounds) return notHandled('disabled');

  const ws = wb.getSheetById(wb.getActiveSheetId());
  const state = await ws.outline.getState();
  const rowGroups = state.rowGroups as GroupRecord[];
  const columnGroups = state.columnGroups as GroupRecord[];

  let toggled = false;
  const rowGroup = findInnermostContainingGroup(rowGroups, bounds.startRow, bounds.endRow);
  if (rowGroup?.collapsed) {
    await ws.outline.toggleCollapsed(rowGroup.id);
    toggled = true;
  }

  const columnGroup = findInnermostContainingGroup(columnGroups, bounds.startCol, bounds.endCol);
  if (columnGroup?.collapsed) {
    await ws.outline.toggleCollapsed(columnGroup.id);
    toggled = true;
  }
  return toggled ? handled() : notHandled('disabled');
};

/**
 * Alt+Shift+Up - Hide detail. Collapse the innermost (highest-level)
 * expanded group containing the selection on each axis.
 * Ported from `use-grouping-actions.ts:409-443`.
 */
export const HIDE_DETAIL: AsyncActionHandler = async (deps) => {
  const { workbook: wb } = deps;
  const bounds = computeSelectionBounds(deps.accessors.selection.getRanges());
  if (!bounds) return notHandled('disabled');

  const ws = wb.getSheetById(wb.getActiveSheetId());
  const state = await ws.outline.getState();
  const rowGroups = state.rowGroups as GroupRecord[];
  const columnGroups = state.columnGroups as GroupRecord[];

  // Find the innermost expanded row group containing the selection.
  let toggled = false;
  const rowGroup = findInnermostContainingGroup(rowGroups, bounds.startRow, bounds.endRow);
  if (rowGroup && !rowGroup.collapsed) {
    await ws.outline.toggleCollapsed(rowGroup.id);
    toggled = true;
  }

  const columnGroup = findInnermostContainingGroup(columnGroups, bounds.startCol, bounds.endCol);
  if (columnGroup && !columnGroup.collapsed) {
    await ws.outline.toggleCollapsed(columnGroup.id);
    toggled = true;
  }

  return toggled ? handled() : notHandled('disabled');
};

// =============================================================================
// Internal helpers
// =============================================================================

interface VisibleSheet {
  id: SheetId;
  index: number;
}

/**
 * Read the kernel state mirror to enumerate visible sheets in display
 * order. Matches `use-sheet-tab-actions.ts:135-172` exactly:
 * the mirror is the canonical sync sheet list (populated by
 * `MutationResultHandler` before events fire), and the `hidden` flag
 * filters out sheets the user has hidden.
 */
function collectVisibleSheets(
  wb: import('@mog-sdk/contracts/api').WorkbookInternal,
): VisibleSheet[] {
  const ids = wb.mirror.getSheetIds();
  const out: VisibleSheet[] = [];
  ids.forEach((id, index) => {
    const meta = wb.mirror.getSheetMeta(id);
    // Skip sheets the mirror has registered but not yet populated
    // (extremely brief window during initial hydration).
    if (meta.name === null) return;
    if (meta.hidden) return;
    out.push({ id, index });
  });
  return out;
}
