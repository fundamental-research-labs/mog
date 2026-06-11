/**
 * Grouping State Hook
 *
 * Provides grouping state (config, groups, levels) and STABLE callbacks without any selection dependency.
 * This hook is designed for components that need to render grouping UI but should NOT
 * re-render on every cell selection change.
 *
 * PERFORMANCE: This hook does NOT subscribe to selection state. Components that need
 * selection-aware grouping actions should use useGroupingActions() instead.
 *
 * Includes stable callbacks:
 * - setLevelCollapsed: Collapse/expand all groups at a level (no selection needed)
 * - toggleGroupCollapsed: Toggle a specific group by ID (no selection needed)
 *
 * Row/Column Grouping - Performance Optimization
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 18: Point-in-time reads
 * @module hooks/use-grouping-state
 */

import { useCallback, useEffect, useState } from 'react';

import type { GroupDefinition, SheetGroupingConfig } from '@mog-sdk/contracts/grouping';

import { useActiveSheetId, useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

type OutlineWithSetLevelCollapsed = {
  setLevelCollapsed?: (
    axis: 'row' | 'column',
    level: number,
    collapsed: boolean,
  ) => Promise<void>;
};

type GroupingAxis = 'rows' | 'columns';

type OutlineActionGlobal = typeof globalThis & {
  __MOG_PENDING_OUTLINE_ACTION__?: Promise<void>;
};

type WorksheetWithOutlineLayout = {
  outline: {
    getState: () => Promise<{
      rowGroups: GroupDefinition[];
      columnGroups: GroupDefinition[];
    }>;
    toggleCollapsed: (groupId: string) => Promise<void>;
  } & OutlineWithSetLevelCollapsed;
  layout: {
    unhideRows: (startRow: number, endRow: number) => Promise<void>;
    unhideColumns: (startCol: number, endCol: number) => Promise<void>;
    resetRowHeight: (row: number) => Promise<void>;
    resetColumnWidth: (col: number) => Promise<void>;
  };
};

function scheduleOutlineAction(action: () => Promise<void>): void {
  const global = globalThis as OutlineActionGlobal;
  const previous = global.__MOG_PENDING_OUTLINE_ACTION__;
  const pending = new Promise<void>((resolve, reject) => {
    globalThis.setTimeout(() => {
      Promise.resolve(previous)
        .catch(() => undefined)
        .then(action)
        .then(resolve, reject)
        .finally(() => {
          if (global.__MOG_PENDING_OUTLINE_ACTION__ === pending) {
            delete global.__MOG_PENDING_OUTLINE_ACTION__;
          }
        });
    }, 0);
  });
  global.__MOG_PENDING_OUTLINE_ACTION__ = pending;
}

async function resetImportedDetailDimensions(
  ws: WorksheetWithOutlineLayout,
  axis: GroupingAxis,
  indexes: number[],
): Promise<void> {
  if (axis === 'rows') {
    await Promise.all(indexes.map((row) => ws.layout.resetRowHeight(row)));
    return;
  }

  await Promise.all(indexes.map((col) => ws.layout.resetColumnWidth(col)));
}

export interface UseGroupingStateReturn {
  /** Current grouping configuration */
  groupingConfig: SheetGroupingConfig | undefined;
  /** All row groups */
  rowGroups: GroupDefinition[];
  /** All column groups */
  columnGroups: GroupDefinition[];
  /** Maximum row outline level (0 if no groups) */
  maxRowLevel: number;
  /** Maximum column outline level (0 if no groups) */
  maxColLevel: number;

  // Stable callbacks (NO selection dependency)
  /** Set all groups at a level to collapsed/expanded */
  setLevelCollapsed: (axis: 'row' | 'column', level: number, collapsed: boolean) => void;
  /** Toggle collapse state of a specific group by ID */
  toggleGroupCollapsed: (groupId: string) => boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for accessing grouping state WITHOUT selection dependency.
 *
 * Use this hook in components that need to render grouping data but should NOT
 * re-render when selection changes. For selection-aware grouping actions,
 * use useGroupingActions() instead.
 *
 * @example
 * ```tsx
 * // In SpreadsheetGrid - only needs state for rendering
 * const { groupingConfig, rowGroups, columnGroups } = useGroupingState();
 * ```
 */
export function useGroupingState(): UseGroupingStateReturn {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();

  // Subscribe to grouping config changes (NOT selection)
  const [groupingConfig, setGroupingConfig] = useState<SheetGroupingConfig | undefined>(undefined);

  // Version counter for re-rendering when grouping state changes
  const [groupVersion, setGroupVersion] = useState(0);

  useEffect(() => {
    if (!activeSheetId) return;

    // Initial load (async)
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
  }, [wb, activeSheetId, groupVersion]);

  // ==========================================================================
  // STABLE CALLBACKS (no selection dependency)
  // These callbacks don't need selection state - they operate on specific
  // groups by ID or level, not by selection bounds.
  // ==========================================================================

  const setLevelCollapsed = useCallback(
    (axis: 'row' | 'column', level: number, collapsed: boolean) => {
      const action = collapsed ? 'Collapse' : 'Expand';
      wb.setPendingUndoDescription(`${action} ${axis} level ${level}`);
      const ws = wb.getSheetById(activeSheetId) as unknown as WorksheetWithOutlineLayout;
      scheduleOutlineAction(async () => {
        const state = await ws.outline.getState();
        const groups = axis === 'row' ? state.rowGroups : state.columnGroups;
        const importedGroups = groups.filter(
          (group) => group.hidden === true && group.level >= level && group.collapsed !== collapsed,
        );

        if (!collapsed) {
          const groupAxis: GroupingAxis = axis === 'row' ? 'rows' : 'columns';
          for (const group of importedGroups) {
            await resetImportedDetailDimensions(ws, groupAxis, [group.start]);
          }
        }

        for (const group of groups) {
          if (group.level >= level && group.collapsed !== collapsed) {
            if (typeof ws.outline.setLevelCollapsed === 'function') {
              await ws.outline.setLevelCollapsed(axis, level, collapsed);
              break;
            }
            await ws.outline.toggleCollapsed(group.id);
          }
        }
      });
    },
    [wb, activeSheetId],
  );

  const toggleGroupCollapsed = useCallback(
    (groupId: string) => {
      const ws = wb.getSheetById(activeSheetId);
      void ws.outline.toggleCollapsed(groupId);
      return true; // Optimistic return; API is async
    },
    [wb, activeSheetId],
  );

  return {
    groupingConfig,
    rowGroups,
    columnGroups,
    maxRowLevel,
    maxColLevel,
    setLevelCollapsed,
    toggleGroupCollapsed,
  };
}
