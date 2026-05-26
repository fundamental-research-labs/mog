/**
 * Kanban View Configuration
 *
 * Re-exports and utilities for Kanban view configuration.
 * The main KanbanViewConfig type is defined in ../types.ts for consistency.
 */

import type { ColId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { KanbanViewConfig, TableId, ViewId } from '../types';

// Re-export the type for convenience
export type { KanbanViewConfig } from '../types';

/**
 * Default Kanban view configuration.
 * Used when creating new Kanban views without full config.
 */
export const DEFAULT_KANBAN_CONFIG: Partial<KanbanViewConfig> = {
  cardFields: [],
  showEmptyGroups: true,
  wipLimits: {},
  collapsedColumns: [],
};

/**
 * Create a full Kanban config from partial input.
 */
export function createKanbanConfig(
  viewId: ViewId,
  sheetId: SheetId,
  tableId: TableId,
  groupByColumn: ColId,
  cardTitleColumn: ColId,
  partial: Partial<KanbanViewConfig> = {},
): KanbanViewConfig {
  return {
    viewId,
    sheetId,
    tableId,
    groupByColumn,
    cardTitleColumn,
    cardFields: partial.cardFields ?? [],
    cardColorColumn: partial.cardColorColumn,
    showEmptyGroups: partial.showEmptyGroups ?? true,
    columnOrder: partial.columnOrder,
    wipLimits: partial.wipLimits ?? {},
    collapsedColumns: partial.collapsedColumns ?? [],
  };
}
