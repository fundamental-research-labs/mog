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
  setLevelCollapsed: (axis: 'row' | 'column', level: number, collapsed: boolean) => Promise<void>;
  /** Toggle collapse state of a specific group by ID */
  toggleGroupCollapsed: (groupId: string) => Promise<boolean>;
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
    async (axis: 'row' | 'column', level: number, collapsed: boolean) => {
      const action = collapsed ? 'Collapse' : 'Expand';
      wb.setPendingUndoDescription(`${action} ${axis} level ${level}`);
      const ws = wb.getSheetById(activeSheetId);
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
    },
    [wb, activeSheetId],
  );

  const toggleGroupCollapsed = useCallback(
    async (groupId: string) => {
      const ws = wb.getSheetById(activeSheetId);
      await ws.outline.toggleCollapsed(groupId);
      return true;
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
