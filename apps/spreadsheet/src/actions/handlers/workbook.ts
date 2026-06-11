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

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
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

interface GroupingSelectionSnapshot {
  ranges: readonly CellRange[];
  activeCell: { row: number; col: number };
  anchor: { row: number; col: number } | null;
  anchorCol: number | null;
  anchorRow: number | null;
}

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

function isSingleFullRowRange(range: CellRange): boolean {
  return range.startRow === range.endRow && hasFullRowIntent(range);
}

function isSingleFullColumnRange(range: CellRange): boolean {
  return range.startCol === range.endCol && hasFullColumnIntent(range);
}

function getGroupingCommandRanges(snapshot: GroupingSelectionSnapshot): readonly CellRange[] {
  if (snapshot.ranges.length !== 1) return snapshot.ranges;

  const range = snapshot.ranges[0];
  if (isSingleFullRowRange(range)) {
    const anchorRow = snapshot.anchorRow ?? snapshot.anchor?.row ?? null;
    if (anchorRow !== null && anchorRow !== range.startRow) {
      return [
        {
          ...range,
          startRow: Math.min(anchorRow, snapshot.activeCell.row, range.startRow, range.endRow),
          endRow: Math.max(anchorRow, snapshot.activeCell.row, range.startRow, range.endRow),
          startCol: 0,
          endCol: MAX_COLS - 1,
          isFullRow: true,
        },
      ];
    }
  }

  if (isSingleFullColumnRange(range)) {
    const anchorCol = snapshot.anchorCol ?? snapshot.anchor?.col ?? null;
    if (anchorCol !== null && anchorCol !== range.startCol) {
      return [
        {
          ...range,
          startRow: 0,
          endRow: MAX_ROWS - 1,
          startCol: Math.min(anchorCol, snapshot.activeCell.col, range.startCol, range.endCol),
          endCol: Math.max(anchorCol, snapshot.activeCell.col, range.startCol, range.endCol),
          isFullColumn: true,
        },
      ];
    }
  }

  return snapshot.ranges;
}

function getGroupingCommandRangesFromDeps(deps: ActionDependencies): readonly CellRange[] {
  const selection = deps.accessors.selection;
  return getGroupingCommandRanges({
    ranges: selection.getRanges(),
    activeCell: selection.getActiveCell(),
    anchor: selection.getAnchor(),
    anchorCol: selection.getAnchorCol(),
    anchorRow: selection.getAnchorRow(),
  });
}

function findInnermostContainingGroup(
  groups: GroupRecord[],
  start: number,
  end: number,
): GroupRecord | null {
  return (
    groups
      .filter((group) => group.start <= start && group.end >= end)
      .sort((a, b) => b.level - a.level || a.end - a.start - (b.end - b.start))[0] ?? null
  );
}

function resolveUngroupAxis(
  axis: GroupingAxis | null,
  bounds: SelectionBounds,
  rowGroups: GroupRecord[],
  columnGroups: GroupRecord[],
): GroupingAxis | null {
  const rowGroup = findInnermostContainingGroup(rowGroups, bounds.startRow, bounds.endRow);
  const columnGroup = findInnermostContainingGroup(columnGroups, bounds.startCol, bounds.endCol);

  if (axis === 'rows' && !rowGroup && columnGroup) return 'columns';
  if (axis === 'columns' && !columnGroup && rowGroup) return 'rows';
  return axis;
}

interface OutlineSummarySettings {
  summaryRowsBelow: boolean;
  summaryColumnsRight: boolean;
}

const DEFAULT_OUTLINE_SUMMARY_SETTINGS: OutlineSummarySettings = {
  summaryRowsBelow: true,
  summaryColumnsRight: true,
};

async function readOutlineSummarySettings(
  ws: import('@mog-sdk/contracts/api').WorksheetWithInternals,
): Promise<OutlineSummarySettings> {
  try {
    const settings = await ws.outline.getSettings();
    return {
      summaryRowsBelow: settings.summaryRowsBelow ?? true,
      summaryColumnsRight: settings.summaryColumnsRight ?? true,
    };
  } catch {
    return DEFAULT_OUTLINE_SUMMARY_SETTINGS;
  }
}

function summaryIndex(group: GroupRecord, summaryAfter: boolean): number | null {
  if (summaryAfter) return group.end + 1;
  const index = group.start - 1;
  return index >= 0 ? index : null;
}

function selectionContainsIndex(start: number, end: number, index: number): boolean {
  return start <= index && end >= index;
}

function selectionMatchesRowGroupForDetail(
  group: GroupRecord,
  bounds: SelectionBounds,
  settings: OutlineSummarySettings,
  groups: readonly GroupRecord[] = [group],
  includeVisibleSiblingGroupContext = false,
): boolean {
  if (rangesOverlap(group.start, group.end, bounds.startRow, bounds.endRow)) {
    return true;
  }
  const summary = summaryIndex(group, settings.summaryRowsBelow);
  if (summary !== null && bounds.startRow <= summary && bounds.endRow >= summary) {
    return true;
  }
  const importedMemberSummary = isImportedHiddenGroup(group)
    ? summaryIndex(group, !settings.summaryRowsBelow)
    : null;
  if (
    importedMemberSummary !== null &&
    selectionContainsIndex(bounds.startRow, bounds.endRow, importedMemberSummary)
  ) {
    return true;
  }
  return selectionMatchesAdjacentOutlineContext(
    group,
    groups,
    bounds.startRow,
    bounds.endRow,
    settings.summaryRowsBelow,
    isImportedHiddenGroup(group) || includeVisibleSiblingGroupContext,
  );
}

function selectionMatchesColumnGroupForDetail(
  group: GroupRecord,
  bounds: SelectionBounds,
  settings: OutlineSummarySettings,
  groups: readonly GroupRecord[] = [group],
  includeVisibleSiblingGroupContext = false,
): boolean {
  if (rangesOverlap(group.start, group.end, bounds.startCol, bounds.endCol)) {
    return true;
  }
  const summary = summaryIndex(group, settings.summaryColumnsRight);
  if (summary !== null && bounds.startCol <= summary && bounds.endCol >= summary) {
    return true;
  }
  const importedMemberSummary = isImportedHiddenGroup(group)
    ? summaryIndex(group, !settings.summaryColumnsRight)
    : null;
  if (
    importedMemberSummary !== null &&
    selectionContainsIndex(bounds.startCol, bounds.endCol, importedMemberSummary)
  ) {
    return true;
  }
  return selectionMatchesAdjacentOutlineContext(
    group,
    groups,
    bounds.startCol,
    bounds.endCol,
    settings.summaryColumnsRight,
    isImportedHiddenGroup(group) || includeVisibleSiblingGroupContext,
  );
}

/** Minimal shape of `GroupDefinition` used by the show/hide detail iterators. */
interface GroupRecord {
  id: string;
  start: number;
  end: number;
  level: number;
  collapsed: boolean;
  hidden?: boolean;
  collapsedOnMember?: boolean;
}

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function selectionMatchesAdjacentOutlineContext(
  group: GroupRecord,
  groups: readonly GroupRecord[],
  selectionStart: number,
  selectionEnd: number,
  summaryAfter: boolean,
  includeVisibleSiblingGroup = false,
): boolean {
  const sameLevelGroups = groups
    .filter((candidate) => candidate.level === group.level)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const groupIndex = sameLevelGroups.findIndex((candidate) => candidate.id === group.id);
  if (groupIndex === -1) return false;

  if (summaryAfter) {
    const previous = sameLevelGroups[groupIndex - 1];
    if (!previous) return false;
    const includePreviousGroup = includeVisibleSiblingGroup && isVisibleSingletonGroup(previous);
    const contextStart = includePreviousGroup ? previous.start : previous.end + 1;
    return selectionStart >= contextStart && selectionEnd < group.start;
  }

  const next = sameLevelGroups[groupIndex + 1];
  if (!next) return false;
  const includeNextGroup = includeVisibleSiblingGroup && isVisibleSingletonGroup(next);
  const contextEnd = includeNextGroup ? next.end : next.start - 1;
  return selectionStart > group.end && selectionEnd <= contextEnd;
}

function isVisibleSingletonGroup(group: GroupRecord): boolean {
  return !group.collapsed && group.hidden !== true && group.start === group.end;
}

function isImportedHiddenGroup(group: GroupRecord): boolean {
  return group.collapsedOnMember === true || group.hidden === true;
}

function compareDetailGroupCollapsePriority(a: GroupRecord, b: GroupRecord): number {
  const levelDelta = b.level - a.level;
  if (levelDelta !== 0) return levelDelta;

  const importedDelta = Number(isImportedHiddenGroup(b)) - Number(isImportedHiddenGroup(a));
  if (importedDelta !== 0) return importedDelta;

  return b.end - b.start - (a.end - a.start);
}

function detailIndexes(group: GroupRecord): number[] {
  return Array.from(
    { length: group.end - group.start + 1 },
    (_value, index) => group.start + index,
  );
}

async function setImportedDetailVisibility(
  ws: import('@mog-sdk/contracts/api').WorksheetWithInternals,
  group: GroupRecord,
  axis: GroupingAxis,
  visible: boolean,
): Promise<void> {
  if (group.hidden !== true) return;

  if (axis === 'rows') {
    if (visible) {
      await ws.layout.unhideRows(group.start, group.end);
    } else {
      await ws.layout.hideRows(detailIndexes(group));
    }
    return;
  }

  if (visible) {
    await ws.layout.unhideColumns(group.start, group.end);
  } else {
    await ws.layout.hideColumns(detailIndexes(group));
  }
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
// Selection bounds come from actor accessors at action time. Header selections
// can visually collapse while focus moves through ribbon popovers, so grouping
// commands recover row/column spans from the preserved selection anchor.
// =============================================================================

/**
 * Alt+Shift+Right - Group selected rows (rowSpan ≥ 2) or columns
 * (colSpan ≥ 2). Full-row/full-column selections use the raw range
 * intent first; ordinary and select-all ranges keep the legacy row-first
 * span fallback (i.e. a single cell never groups).
 */
export const GROUP: AsyncActionHandler = async (deps) => {
  const { workbook: wb } = deps;
  const ranges = getGroupingCommandRangesFromDeps(deps);
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
 * then the legacy row-first span fallback. A single active cell falls
 * back to the innermost containing outline group, matching Excel's
 * shortcut behavior for a cell inside an existing group.
 */
export const UNGROUP: AsyncActionHandler = async (deps) => {
  const { workbook: wb } = deps;
  const ranges = getGroupingCommandRangesFromDeps(deps);
  const bounds = computeSelectionBounds(ranges);
  if (!bounds) return notHandled('disabled');

  const fullSelectionAxis = inferFullSelectionAxis(ranges);
  let axis = fullSelectionAxis ?? inferSpanAxis(bounds);

  const ws = wb.getSheetById(wb.getActiveSheetId());
  let outlineGroups: { rowGroups: GroupRecord[]; columnGroups: GroupRecord[] } | null = null;
  const getOutlineGroups = async () => {
    if (outlineGroups) return outlineGroups;
    const state = await ws.outline.getState();
    outlineGroups = {
      rowGroups: state.rowGroups as GroupRecord[],
      columnGroups: state.columnGroups as GroupRecord[],
    };
    return outlineGroups;
  };

  if (!fullSelectionAxis) {
    const groups = await getOutlineGroups();
    axis = resolveUngroupAxis(axis, bounds, groups.rowGroups, groups.columnGroups);
  }

  if (axis === 'rows') {
    if (bounds.startRow === bounds.endRow) {
      const groups = await getOutlineGroups();
      const rowGroup = findInnermostContainingGroup(
        groups.rowGroups,
        bounds.startRow,
        bounds.endRow,
      );
      if (rowGroup) {
        wb.setPendingUndoDescription(`Ungroup rows ${rowGroup.start + 1}-${rowGroup.end + 1}`);
        await ws.outline.ungroupRows(rowGroup.start, rowGroup.end);
        return handled();
      }
    }
    wb.setPendingUndoDescription(`Ungroup rows ${bounds.startRow + 1}-${bounds.endRow + 1}`);
    await ws.outline.ungroupRows(bounds.startRow, bounds.endRow);
    return handled();
  }
  if (axis === 'columns') {
    if (bounds.startCol === bounds.endCol) {
      const groups = await getOutlineGroups();
      const columnGroup = findInnermostContainingGroup(
        groups.columnGroups,
        bounds.startCol,
        bounds.endCol,
      );
      if (columnGroup) {
        wb.setPendingUndoDescription(
          `Ungroup columns ${columnGroup.start + 1}-${columnGroup.end + 1}`,
        );
        await ws.outline.ungroupColumns(columnGroup.start, columnGroup.end);
        return handled();
      }
    }
    wb.setPendingUndoDescription(`Ungroup columns ${bounds.startCol + 1}-${bounds.endCol + 1}`);
    await ws.outline.ungroupColumns(bounds.startCol, bounds.endCol);
    return handled();
  }

  const state = await getOutlineGroups();
  const rowGroup = findInnermostContainingGroup(state.rowGroups, bounds.startRow, bounds.endRow);
  if (rowGroup) {
    wb.setPendingUndoDescription(`Ungroup rows ${rowGroup.start + 1}-${rowGroup.end + 1}`);
    await ws.outline.ungroupRows(rowGroup.start, rowGroup.end);
    return handled();
  }

  const columnGroup = findInnermostContainingGroup(
    state.columnGroups,
    bounds.startCol,
    bounds.endCol,
  );
  if (columnGroup) {
    wb.setPendingUndoDescription(`Ungroup columns ${columnGroup.start + 1}-${columnGroup.end + 1}`);
    await ws.outline.ungroupColumns(columnGroup.start, columnGroup.end);
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
  const ranges = getGroupingCommandRangesFromDeps(deps);
  const bounds = computeSelectionBounds(ranges);
  if (!bounds) return notHandled('disabled');
  const explicitAxis = inferFullSelectionAxis(ranges);

  const ws = wb.getSheetById(wb.getActiveSheetId());
  const state = await ws.outline.getState();
  const settings = await readOutlineSummarySettings(ws);
  const rowGroups = state.rowGroups as GroupRecord[];
  const columnGroups = state.columnGroups as GroupRecord[];

  let toggled = false;
  if (explicitAxis !== 'columns') {
    for (const group of rowGroups) {
      if (
        group.collapsed &&
        selectionMatchesRowGroupForDetail(group, bounds, settings, rowGroups)
      ) {
        await ws.outline.toggleCollapsed(group.id);
        await setImportedDetailVisibility(ws, group, 'rows', true);
        toggled = true;
      }
    }
  }
  if (explicitAxis !== 'rows') {
    for (const group of columnGroups) {
      if (
        group.collapsed &&
        selectionMatchesColumnGroupForDetail(group, bounds, settings, columnGroups)
      ) {
        await ws.outline.toggleCollapsed(group.id);
        await setImportedDetailVisibility(ws, group, 'columns', true);
        toggled = true;
      }
    }
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
  const ranges = getGroupingCommandRangesFromDeps(deps);
  const bounds = computeSelectionBounds(ranges);
  if (!bounds) return notHandled('disabled');
  const explicitAxis = inferFullSelectionAxis(ranges);

  const ws = wb.getSheetById(wb.getActiveSheetId());
  const state = await ws.outline.getState();
  const settings = await readOutlineSummarySettings(ws);
  const rowGroups = state.rowGroups as GroupRecord[];
  const columnGroups = state.columnGroups as GroupRecord[];

  // Find the innermost expanded row group containing the selection.
  const rowGroupsContaining =
    explicitAxis === 'columns'
      ? []
      : rowGroups
          .filter(
            (g) =>
              !g.collapsed &&
              selectionMatchesRowGroupForDetail(g, bounds, settings, rowGroups, true),
          )
          .sort(compareDetailGroupCollapsePriority);

  let toggled = false;
  if (rowGroupsContaining.length > 0) {
    const group = rowGroupsContaining[0];
    if (group.hidden === true) {
      await setImportedDetailVisibility(ws, group, 'rows', false);
    } else {
      await ws.outline.toggleCollapsed(group.id);
    }
    toggled = true;
  }

  const colGroupsContaining =
    explicitAxis === 'rows'
      ? []
      : columnGroups
          .filter(
            (g) =>
              !g.collapsed &&
              selectionMatchesColumnGroupForDetail(g, bounds, settings, columnGroups, true),
          )
          .sort(compareDetailGroupCollapsePriority);

  if (colGroupsContaining.length > 0) {
    const group = colGroupsContaining[0];
    if (group.hidden === true) {
      await setImportedDetailVisibility(ws, group, 'columns', false);
    } else {
      await ws.outline.toggleCollapsed(group.id);
    }
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
