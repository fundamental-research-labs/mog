/**
 * useGroupingIntegration Effect Hook
 *
 * Provides grouping data to the coordinator for outline hit testing.
 * Used by Row/Column Grouping feature.
 *
 * PERFORMANCE: This hook accepts useGroupingState() output which does NOT
 * subscribe to selection. This prevents SpreadsheetGrid from re-rendering
 * on every cell click.
 *
 * @see Row/Column Grouping
 * @see 09-SPREADSHEET-GRID-DECOMPOSITION.md
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
 */

import { useEffect } from 'react';

import type { GroupDefinition, SheetGroupingConfig } from '@mog-sdk/contracts/grouping';
import type { SheetCoordinator } from '../../../coordinator/sheet-coordinator';

/**
 * Grouping state interface from useGroupingState hook.
 * NOTE: This does NOT include selection-dependent fields (canGroup, canUngroup, selection-aware actions)
 * to prevent re-renders when selection changes.
 *
 * Includes stable callbacks that don't depend on selection:
 * - setLevelCollapsed: operates on level, not selection
 * - toggleGroupCollapsed: operates on groupId, not selection
 */
export interface GroupingState {
  /** Grouping configuration */
  groupingConfig: SheetGroupingConfig | undefined;
  /** Row groups data */
  rowGroups: GroupDefinition[];
  /** Column groups data */
  columnGroups: GroupDefinition[];
  /** Maximum row grouping level */
  maxRowLevel: number;
  /** Maximum column grouping level */
  maxColLevel: number;
  /** Set all groups at a level to collapsed/expanded (stable - no selection dependency) */
  setLevelCollapsed: (axis: 'row' | 'column', level: number, collapsed: boolean) => void;
  /** Toggle collapse state of a specific group by ID (stable - no selection dependency) */
  toggleGroupCollapsed: (groupId: string) => boolean;
}

/**
 * Options for the useGroupingIntegration hook.
 */
export interface UseGroupingIntegrationOptions {
  /** The sheet coordinator instance */
  coordinator: SheetCoordinator;
  /** Grouping state from useGroupingState hook (NOT useGroupingActions - no selection dependency) */
  groupingState: GroupingState;
}

/**
 * Sets up grouping data getter for the coordinator.
 *
 * This hook provides the coordinator with access to row/column grouping data
 * for outline hit testing and rendering. The coordinator uses this data
 * to handle clicks on group outline buttons.
 *
 * PERFORMANCE: Uses groupingState from useGroupingState() which does NOT
 * subscribe to selection. This prevents unnecessary re-renders.
 *
 * @param options - Configuration options
 */
export function useGroupingIntegration(options: UseGroupingIntegrationOptions): void {
  const { coordinator, groupingState } = options;

  useEffect(() => {
    coordinator.objects.setGroupingDataGetter(() => ({
      config: groupingState.groupingConfig ?? null,
      rowGroups: groupingState.rowGroups,
      columnGroups: groupingState.columnGroups,
      maxRowLevel: groupingState.maxRowLevel,
      maxColLevel: groupingState.maxColLevel,
    }));
  }, [coordinator, groupingState]);
}
