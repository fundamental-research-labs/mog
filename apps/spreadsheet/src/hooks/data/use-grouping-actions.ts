/**
 * Grouping Actions Hook
 *
 * Provides action handlers for row/column grouping (outline) operations.
 * Used by DataRibbon, context menu, and keyboard shortcuts.
 *
 * Row/Column Grouping
 *
 * Architecture:
 * - Writes: Through Worksheet API (outline.groupRows, outline.ungroupRows, outline.groupColumns,
 * outline.ungroupColumns, outline.toggleCollapsed, outline.expandAll, outline.collapseAll)
 * - Reads: Worksheet API (outline.getState)
 * - Subscriptions: EventBus for grouping change notifications
 *
 * PERFORMANCE OPTIMIZATION:
 * - Actions use ON-DEMAND selection reads (point-in-time) instead of subscriptions
 * - This prevents re-renders of components that only need actions (not selection state)
 * - canGroup/canUngroup still use selection subscription for toolbar button states
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 18: Point-in-time reads
 * @module hooks/use-grouping-actions
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';
import type { GroupDefinition, SheetGroupingConfig } from '@mog-sdk/contracts/grouping';

import { useActiveSheetId, useWorkbook } from '../../infra/context';
import { useSelectionRanges } from '../selection/use-granular-selection';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// Types
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
  anchor?: { row: number; col: number } | null;
  anchorCol?: number | null;
  anchorRow?: number | null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Compute bounding box of all selected ranges.
 * Used for on-demand selection reads in action callbacks.
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

function isSingleFullRowRange(range: CellRange): boolean {
  return (
    range.startRow === range.endRow &&
    (range.isFullRow === true || (range.startCol === 0 && range.endCol === MAX_COLS - 1))
  );
}

function isSingleFullColumnRange(range: CellRange): boolean {
  return (
    range.startCol === range.endCol &&
    (range.isFullColumn === true || (range.startRow === 0 && range.endRow === MAX_ROWS - 1))
  );
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

interface OutlineSummarySettings {
  summaryRowsBelow: boolean;
  summaryColumnsRight: boolean;
}

async function readOutlineSummarySettings(ws: {
  outline: {
    getSettings: () => Promise<{
      summaryRowsBelow?: boolean;
      summaryColumnsRight?: boolean;
    }>;
  };
}): Promise<OutlineSummarySettings> {
  try {
    const settings = await ws.outline.getSettings();
    return {
      summaryRowsBelow: settings.summaryRowsBelow ?? true,
      summaryColumnsRight: settings.summaryColumnsRight ?? true,
    };
  } catch {
    return {
      summaryRowsBelow: true,
      summaryColumnsRight: true,
    };
  }
}

function summaryIndex(
  group: Pick<GroupDefinition, 'start' | 'end'>,
  summaryAfter: boolean,
): number | null {
  if (summaryAfter) return group.end + 1;
  const index = group.start - 1;
  return index >= 0 ? index : null;
}

function selectionContainsIndex(start: number, end: number, index: number): boolean {
  return start <= index && end >= index;
}

function selectionMatchesRowGroupForDetail(
  group: Pick<GroupDefinition, 'start' | 'end' | 'hidden' | 'collapsedOnMember'>,
  bounds: SelectionBounds,
  settings: OutlineSummarySettings,
): boolean {
  if (group.start <= bounds.startRow && group.end >= bounds.endRow) {
    return true;
  }
  const summary = summaryIndex(group, settings.summaryRowsBelow);
  if (summary !== null && bounds.startRow === summary && bounds.endRow === summary) {
    return true;
  }
  const importedMemberSummary = isImportedHiddenGroup(group)
    ? summaryIndex(group, !settings.summaryRowsBelow)
    : null;
  return (
    importedMemberSummary !== null &&
    selectionContainsIndex(bounds.startRow, bounds.endRow, importedMemberSummary)
  );
}

function selectionMatchesColumnGroupForDetail(
  group: Pick<GroupDefinition, 'start' | 'end' | 'hidden' | 'collapsedOnMember'>,
  bounds: SelectionBounds,
  settings: OutlineSummarySettings,
): boolean {
  if (group.start <= bounds.startCol && group.end >= bounds.endCol) {
    return true;
  }
  const summary = summaryIndex(group, settings.summaryColumnsRight);
  if (summary !== null && bounds.startCol === summary && bounds.endCol === summary) {
    return true;
  }
  const importedMemberSummary = isImportedHiddenGroup(group)
    ? summaryIndex(group, !settings.summaryColumnsRight)
    : null;
  return (
    importedMemberSummary !== null &&
    selectionContainsIndex(bounds.startCol, bounds.endCol, importedMemberSummary)
  );
}

function isImportedHiddenGroup(
  group: Pick<GroupDefinition, 'hidden' | 'collapsedOnMember'>,
): boolean {
  return group.collapsedOnMember === true || group.hidden === true;
}

function detailIndexes(group: Pick<GroupDefinition, 'start' | 'end'>): number[] {
  return Array.from(
    { length: group.end - group.start + 1 },
    (_value, index) => group.start + index,
  );
}

async function setImportedDetailVisibility(
  ws: import('@mog-sdk/contracts/api').WorksheetWithInternals,
  group: GroupDefinition,
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
// Return Type
// =============================================================================

export interface UseGroupingActionsReturn {
  // Group/Ungroup actions
  /** Group the selected rows */
  groupRows: () => void;
  /** Group the selected columns */
  groupColumns: () => void;
  /** Ungroup the selected rows (removes one level) */
  ungroupRows: () => void;
  /** Ungroup the selected columns (removes one level) */
  ungroupColumns: () => void;
  /** Clear all row grouping in selection */
  clearRowGrouping: () => void;
  /** Clear all column grouping in selection */
  clearColumnGrouping: () => void;

  // Collapse/Expand actions
  /** Toggle collapse state of a specific group */
  toggleGroupCollapsed: (groupId: string) => boolean;
  /** Set all groups at a level to collapsed/expanded */
  setLevelCollapsed: (axis: 'row' | 'column', level: number, collapsed: boolean) => void;
  /** Expand all groups */
  expandAll: (axis?: 'row' | 'column') => void;
  /** Collapse all groups */
  collapseAll: (axis?: 'row' | 'column') => void;
  /** Show detail for selected rows (expand groups containing selection) */
  showDetail: () => void;
  /** Hide detail for selected rows (collapse groups containing selection) */
  hideDetail: () => void;

  // Settings
  /** Update outline settings */
  setOutlineSettings: (
    settings: Partial<
      Pick<
        SheetGroupingConfig,
        | 'summaryRowsBelow'
        | 'summaryColumnsRight'
        | 'showOutlineSymbols'
        | 'showOutlineLevelButtons'
      >
    >,
  ) => void;

  // State
  /** Current grouping configuration */
  groupingConfig: SheetGroupingConfig;
  /** All row groups */
  rowGroups: GroupDefinition[];
  /** All column groups */
  columnGroups: GroupDefinition[];
  /** Maximum row outline level (0 if no groups) */
  maxRowLevel: number;
  /** Maximum column outline level (0 if no groups) */
  maxColLevel: number;
  /** Whether grouping actions are available (requires selection) */
  canGroup: boolean;
  /** Whether ungroup actions are available (selection has groups) */
  canUngroup: boolean;
  /** True if any groups are collapsed (can be shown/expanded) */
  canShowDetail: boolean;
  /** True if any groups are expanded (can be hidden/collapsed) */
  canHideDetail: boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useGroupingActions(): UseGroupingActionsReturn {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const coordinator = useCoordinator();

  // Selection subscription - ONLY used for canGroup/canUngroup button states
  // Actions use on-demand reads instead (see getSelectionBoundsOnDemand below)
  const ranges = useSelectionRanges();

  // Subscribe to grouping config changes
  const [groupingConfig, setGroupingConfig] = useState<SheetGroupingConfig>({
    summaryRowsBelow: true,
    summaryColumnsRight: true,
    showOutlineSymbols: true,
    showOutlineLevelButtons: true,
  } as SheetGroupingConfig);

  // Version counter for re-rendering when grouping state changes
  const [groupVersion, setGroupVersion] = useState(0);

  useEffect(() => {
    if (!activeSheetId) return;

    // Initial load (async) via Worksheet API
    const ws = wb.getSheetById(activeSheetId);
    const run = async () => {
      const state = await ws.outline.getState();
      setGroupingConfig({
        summaryRowsBelow: true,
        summaryColumnsRight: true,
        showOutlineSymbols: true,
        showOutlineLevelButtons: true,
        rowGroups: state.rowGroups as GroupDefinition[],
        columnGroups: state.columnGroups as GroupDefinition[],
        maxRowLevel: state.maxRowLevel,
        maxColLevel: state.maxColLevel,
      } as SheetGroupingConfig);
    };
    void run();

    // Subscribe to grouping changes via Worksheet API
    const unsubscribe = ws.on('grouping:changed', () => {
      setGroupVersion((v) => v + 1);
    });
    return unsubscribe;
  }, [wb, activeSheetId]);

  // Get groups - fetched when groupingConfig or groupVersion changes
  const [rowGroups, setRowGroups] = useState<GroupDefinition[]>([]);
  const [columnGroups, setColumnGroups] = useState<GroupDefinition[]>([]);
  const [maxRowLevel, setMaxRowLevel] = useState<number>(0);
  const [maxColLevel, setMaxColLevel] = useState<number>(0);

  useEffect(() => {
    if (!activeSheetId) return;

    const ws = wb.getSheetById(activeSheetId);
    const run = async () => {
      const state = await ws.outline.getState();
      setRowGroups(state.rowGroups as GroupDefinition[]);
      setColumnGroups(state.columnGroups as GroupDefinition[]);
      setMaxRowLevel(state.maxRowLevel);
      setMaxColLevel(state.maxColLevel);
    };
    void run();
  }, [wb, activeSheetId, groupingConfig, groupVersion]);

  // ==========================================================================
  // ON-DEMAND SELECTION READ (for actions)
  // Point-in-time read - does NOT cause re-renders when selection changes
  // @see docs/ARCHITECTURE-CHECKLIST.md - Section 18: Point-in-time reads
  // ==========================================================================
  const getSelectionBoundsOnDemand = useCallback((): SelectionBounds | null => {
    const snapshot = coordinator.grid.getSelectionSnapshot();
    return computeSelectionBounds(getGroupingCommandRanges(snapshot));
  }, [coordinator]);

  // ==========================================================================
  // REACTIVE SELECTION (for button states only)
  // This is acceptable for toolbar buttons that need to show enabled/disabled
  // ==========================================================================
  const selectionBounds = useMemo(() => computeSelectionBounds(ranges), [ranges]);

  // Can group - need at least 2 rows or columns selected
  const canGroup = useMemo(() => {
    if (!selectionBounds) return false;
    const rowSpan = selectionBounds.endRow - selectionBounds.startRow + 1;
    const colSpan = selectionBounds.endCol - selectionBounds.startCol + 1;
    return rowSpan >= 2 || colSpan >= 2;
  }, [selectionBounds]);

  // Can ungroup - selection must be in a group
  const canUngroup = useMemo(() => {
    if (!selectionBounds) return false;

    // Check if any row group contains the selection
    const hasRowGroup = rowGroups.some(
      (g) => g.start <= selectionBounds.startRow && g.end >= selectionBounds.endRow,
    );

    // Check if any column group contains the selection
    const hasColGroup = columnGroups.some(
      (g) => g.start <= selectionBounds.startCol && g.end >= selectionBounds.endCol,
    );

    return hasRowGroup || hasColGroup;
  }, [selectionBounds, rowGroups, columnGroups]);

  // Can show detail - any groups are collapsed (can be expanded)
  const canShowDetail = useMemo(
    () => rowGroups.some((g) => g.collapsed) || columnGroups.some((g) => g.collapsed),
    [rowGroups, columnGroups],
  );

  // Can hide detail - any groups are expanded (can be collapsed)
  const canHideDetail = useMemo(
    () => rowGroups.some((g) => !g.collapsed) || columnGroups.some((g) => !g.collapsed),
    [rowGroups, columnGroups],
  );

  // ==========================================================================
  // Actions (use ON-DEMAND selection reads for stable callbacks)
  // These callbacks do NOT re-render when selection changes - they read
  // selection at invocation time using getSelectionBoundsOnDemand()
  // ==========================================================================

  // Write operations use Worksheet API
  const groupRows = useCallback(() => {
    const bounds = getSelectionBoundsOnDemand();
    if (!bounds) return;
    wb.setPendingUndoDescription(`Group rows ${bounds.startRow + 1}-${bounds.endRow + 1}`);
    const ws = wb.getSheetById(activeSheetId);
    void ws.outline.groupRows(bounds.startRow, bounds.endRow);
  }, [wb, activeSheetId, getSelectionBoundsOnDemand]);

  const groupColumns = useCallback(() => {
    const bounds = getSelectionBoundsOnDemand();
    if (!bounds) return;
    wb.setPendingUndoDescription(`Group columns ${bounds.startCol + 1}-${bounds.endCol + 1}`);
    const ws = wb.getSheetById(activeSheetId);
    void ws.outline.groupColumns(bounds.startCol, bounds.endCol);
  }, [wb, activeSheetId, getSelectionBoundsOnDemand]);

  const ungroupRows = useCallback(() => {
    const bounds = getSelectionBoundsOnDemand();
    if (!bounds) return;
    wb.setPendingUndoDescription(`Ungroup rows ${bounds.startRow + 1}-${bounds.endRow + 1}`);
    const ws = wb.getSheetById(activeSheetId);
    void ws.outline.ungroupRows(bounds.startRow, bounds.endRow);
  }, [wb, activeSheetId, getSelectionBoundsOnDemand]);

  const ungroupColumns = useCallback(() => {
    const bounds = getSelectionBoundsOnDemand();
    if (!bounds) return;
    wb.setPendingUndoDescription(`Ungroup columns ${bounds.startCol + 1}-${bounds.endCol + 1}`);
    const ws = wb.getSheetById(activeSheetId);
    void ws.outline.ungroupColumns(bounds.startCol, bounds.endCol);
  }, [wb, activeSheetId, getSelectionBoundsOnDemand]);

  const clearRowGrouping = useCallback(() => {
    const bounds = getSelectionBoundsOnDemand();
    if (!bounds) return;
    wb.setPendingUndoDescription(`Clear row grouping`);
    const ws = wb.getSheetById(activeSheetId);
    void (async () => {
      const state = await ws.outline.getState();
      const overlapping = (state.rowGroups as GroupDefinition[])
        .filter((g) => !(g.end < bounds.startRow || g.start > bounds.endRow))
        .sort((a, b) => b.level - a.level);
      for (const _group of overlapping) {
        await ws.outline.ungroupRows(bounds.startRow, bounds.endRow);
      }
    })();
  }, [wb, activeSheetId, getSelectionBoundsOnDemand]);

  const clearColumnGrouping = useCallback(() => {
    const bounds = getSelectionBoundsOnDemand();
    if (!bounds) return;
    wb.setPendingUndoDescription(`Clear column grouping`);
    const ws = wb.getSheetById(activeSheetId);
    void (async () => {
      const state = await ws.outline.getState();
      const overlapping = (state.columnGroups as GroupDefinition[])
        .filter((g) => !(g.end < bounds.startCol || g.start > bounds.endCol))
        .sort((a, b) => b.level - a.level);
      for (const _group of overlapping) {
        await ws.outline.ungroupColumns(bounds.startCol, bounds.endCol);
      }
    })();
  }, [wb, activeSheetId, getSelectionBoundsOnDemand]);

  const toggleGroupCollapsed = useCallback(
    (groupId: string) => {
      const ws = wb.getSheetById(activeSheetId);
      void ws.outline.toggleCollapsed(groupId);
      return true; // Optimistic return; API is async
    },
    [wb, activeSheetId],
  );

  const setLevelCollapsed = useCallback(
    (axis: 'row' | 'column', level: number, collapsed: boolean) => {
      const action = collapsed ? 'Collapse' : 'Expand';
      wb.setPendingUndoDescription(`${action} ${axis} level ${level}`);
      const ws = wb.getSheetById(activeSheetId);
      void (async () => {
        const state = await ws.outline.getState();
        const groups = axis === 'row' ? state.rowGroups : state.columnGroups;
        for (const group of groups) {
          if (
            (group as GroupDefinition).level >= level &&
            (group as GroupDefinition).collapsed !== collapsed
          ) {
            await ws.outline.toggleCollapsed((group as GroupDefinition).id);
          }
        }
      })();
    },
    [wb, activeSheetId],
  );

  // Worksheet API: outline.expandAll/outline.collapseAll don't support axis filter,
  // but this matches the common use case. Per-axis filtering is a TODO.
  const expandAll = useCallback(
    (axis?: 'row' | 'column') => {
      wb.setPendingUndoDescription(`Expand all ${axis || 'groups'}`);
      const ws = wb.getSheetById(activeSheetId);
      void ws.outline.expandAll();
    },
    [wb, activeSheetId],
  );

  const collapseAll = useCallback(
    (axis?: 'row' | 'column') => {
      wb.setPendingUndoDescription(`Collapse all ${axis || 'groups'}`);
      const ws = wb.getSheetById(activeSheetId);
      void ws.outline.collapseAll();
    },
    [wb, activeSheetId],
  );

  const showDetail = useCallback(() => {
    void (async () => {
      const bounds = getSelectionBoundsOnDemand();
      if (!bounds) return;

      const ws = wb.getSheetById(activeSheetId);
      const state = await ws.outline.getState();
      const settings = await readOutlineSummarySettings(ws);
      const currentRowGroups = state.rowGroups as GroupDefinition[];
      const currentColumnGroups = state.columnGroups as GroupDefinition[];

      // Find all collapsed groups containing the selection and expand them
      for (const group of currentRowGroups) {
        if (group.collapsed && selectionMatchesRowGroupForDetail(group, bounds, settings)) {
          // Toggle to expand (collapsed -> expanded)
          await ws.outline.toggleCollapsed(group.id);
          await setImportedDetailVisibility(ws, group, 'rows', true);
        }
      }

      for (const group of currentColumnGroups) {
        if (group.collapsed && selectionMatchesColumnGroupForDetail(group, bounds, settings)) {
          await ws.outline.toggleCollapsed(group.id);
          await setImportedDetailVisibility(ws, group, 'columns', true);
        }
      }
    })();
  }, [wb, activeSheetId, getSelectionBoundsOnDemand]);

  const hideDetail = useCallback(() => {
    void (async () => {
      const bounds = getSelectionBoundsOnDemand();
      if (!bounds) return;

      const ws = wb.getSheetById(activeSheetId);
      const state = await ws.outline.getState();
      const settings = await readOutlineSummarySettings(ws);
      const currentRowGroups = state.rowGroups as GroupDefinition[];
      const currentColumnGroups = state.columnGroups as GroupDefinition[];

      // Find innermost expanded groups containing the selection and collapse them
      const rowGroupsContaining = currentRowGroups
        .filter(
          (g: GroupDefinition) =>
            !g.collapsed && selectionMatchesRowGroupForDetail(g, bounds, settings),
        )
        .sort((a: GroupDefinition, b: GroupDefinition) => b.level - a.level); // Innermost first

      if (rowGroupsContaining.length > 0) {
        // Toggle to collapse (expanded -> collapsed)
        const group = rowGroupsContaining[0];
        if (group.hidden === true) {
          await setImportedDetailVisibility(ws, group, 'rows', false);
        } else {
          await ws.outline.toggleCollapsed(group.id);
        }
      }

      const colGroupsContaining = currentColumnGroups
        .filter(
          (g: GroupDefinition) =>
            !g.collapsed && selectionMatchesColumnGroupForDetail(g, bounds, settings),
        )
        .sort((a: GroupDefinition, b: GroupDefinition) => b.level - a.level);

      if (colGroupsContaining.length > 0) {
        const group = colGroupsContaining[0];
        if (group.hidden === true) {
          await setImportedDetailVisibility(ws, group, 'columns', false);
        } else {
          await ws.outline.toggleCollapsed(group.id);
        }
      }
    })();
  }, [wb, activeSheetId, getSelectionBoundsOnDemand]);

  // No-op: outline settings are managed by the compute core.
  // A dedicated API method will be added when needed.
  const setOutlineSettings = useCallback(
    (
      _settings: Partial<
        Pick<
          SheetGroupingConfig,
          | 'summaryRowsBelow'
          | 'summaryColumnsRight'
          | 'showOutlineSymbols'
          | 'showOutlineLevelButtons'
        >
      >,
    ) => {
      wb.setPendingUndoDescription('Update outline settings');
    },
    [wb],
  );

  return {
    // Actions
    groupRows,
    groupColumns,
    ungroupRows,
    ungroupColumns,
    clearRowGrouping,
    clearColumnGrouping,
    toggleGroupCollapsed,
    setLevelCollapsed,
    expandAll,
    collapseAll,
    showDetail,
    hideDetail,
    setOutlineSettings,

    // State
    groupingConfig,
    rowGroups,
    columnGroups,
    maxRowLevel,
    maxColLevel,
    canGroup,
    canUngroup,
    canShowDetail,
    canHideDetail,
  };
}
