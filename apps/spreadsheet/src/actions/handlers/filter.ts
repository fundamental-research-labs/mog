/**
 * Filter Action Handlers
 *
 * Pure handler functions for filter-related actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - All filter operations delegate to Worksheet API (ws.*)
 * - Rust evaluates filter criteria and updates row visibility in the same mutation
 * - No direct kernel/store imports — fully migrated to ws.filters.* API
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { ColumnFilterCriteria, FilterCondition } from '@mog-sdk/contracts/filter';

import { recordFilterReadinessError } from '../../infra/diagnostics/filter-readiness-errors';
import { guardBridgeMutation } from './bridge-error-guard';
import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Get typed Worksheet from ActionDependencies.
 */
function getWs(deps: ActionDependencies) {
  return deps.workbook.getSheetById(deps.getActiveSheetId());
}

type WorksheetApi = ReturnType<typeof getWs>;

function isAdvancedFilterInfo(filter: { filterKind?: string } | null | undefined): boolean {
  return filter?.filterKind === 'advancedFilter';
}

async function resolveHeaderColumn(ws: WorksheetApi, headerCellId: string): Promise<number | null> {
  const positions = await ws._internal.batchGetCellPositions([headerCellId]);
  return positions.get(headerCellId)?.col ?? null;
}

async function setCriteriaForHeader(
  ws: WorksheetApi,
  filterId: string,
  headerCellId: string,
  criteria: ColumnFilterCriteria,
): Promise<boolean> {
  const col = await resolveHeaderColumn(ws, headerCellId);
  if (col === null) return false;
  await ws.filters.setColumnFilter(col, criteria, filterId);
  return true;
}

async function clearCriteriaForHeader(
  ws: WorksheetApi,
  filterId: string,
  headerCellId: string,
): Promise<boolean> {
  const col = await resolveHeaderColumn(ws, headerCellId);
  if (col === null) return false;
  await ws.filters.clearColumnFilter(col, filterId);
  return true;
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * APPLY_NUMBER_FILTER
 *
 * Applies a number filter (condition filter) to a column.
 * Reads pending config from UIStore (Draft + Apply pattern).
 */
export const APPLY_NUMBER_FILTER: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const uiStore = getUIStore(deps);

  // Read pending config from UIStore
  const { pendingFilterConfig } = uiStore.getState().filterDropdown;

  if (!pendingFilterConfig || pendingFilterConfig.type !== 'number') {
    return notHandled('disabled');
  }

  const { filterId, headerCellId, operator, value, value2 } = pendingFilterConfig;

  // Build conditions array
  const conditions = [
    {
      operator,
      value: value !== undefined ? parseFilterValue(value) : undefined,
      value2: value2 !== undefined ? parseFilterValue(value2) : undefined,
    },
  ];

  const applied = await setCriteriaForHeader(ws, filterId, headerCellId, {
    type: 'condition',
    conditions: conditions as FilterCondition[],
  });
  if (!applied) return notHandled('disabled');

  // Clear pending config
  uiStore.getState().clearPendingFilterConfig();

  return handled();
};

/**
 * APPLY_TEXT_FILTER
 *
 * Applies a text filter (condition filter) to a column.
 * Reads pending config from UIStore (Draft + Apply pattern).
 */
export const APPLY_TEXT_FILTER: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const uiStore = getUIStore(deps);

  // Read pending config from UIStore
  const { pendingFilterConfig } = uiStore.getState().filterDropdown;

  if (!pendingFilterConfig || pendingFilterConfig.type !== 'text') {
    return notHandled('disabled');
  }

  const { filterId, headerCellId, operator, value } = pendingFilterConfig;

  // Build conditions array
  const conditions = [
    {
      operator,
      value: value !== undefined ? value : undefined,
    },
  ];

  const applied = await setCriteriaForHeader(ws, filterId, headerCellId, {
    type: 'condition',
    conditions: conditions as FilterCondition[],
  });
  if (!applied) return notHandled('disabled');

  // Clear pending config
  uiStore.getState().clearPendingFilterConfig();

  return handled();
};

/**
 * APPLY_COLOR_FILTER
 *
 * Applies a color filter to a column.
 * Reads pending config from UIStore (Draft + Apply pattern).
 *
 * B4: Excel-parity quickwin - Color filter support
 */
export const APPLY_COLOR_FILTER: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const uiStore = getUIStore(deps);

  // Read pending config from UIStore
  const { pendingColorFilter } = uiStore.getState().filterDropdown;

  if (!pendingColorFilter) {
    return notHandled('disabled');
  }

  const { filterId, headerCellId, col, colorType, color } = pendingColorFilter;

  if (col !== undefined) {
    // Use the column-index-based API (preferred path when col is available)
    await ws.filters.setColumnFilter(
      col,
      {
        type: 'color',
        colorFilter: { type: colorType, color },
      },
      filterId,
    );
  } else {
    const applied = await setCriteriaForHeader(ws, filterId, headerCellId, {
      type: 'color',
      colorFilter: { type: colorType, color },
    });
    if (!applied) return notHandled('disabled');
  }

  // Clear pending config
  uiStore.getState().clearPendingColorFilter();

  return handled();
};

/**
 * APPLY_TOP10_FILTER
 *
 * Applies a top 10 filter to a column.
 * Reads pending config from UIStore (Draft + Apply pattern).
 *
 * B4: Excel-parity quickwin - Top10 filter support
 */
export const APPLY_TOP10_FILTER: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const uiStore = getUIStore(deps);

  // Read pending config from UIStore
  const { pendingTop10Config } = uiStore.getState().filterDropdown;

  if (!pendingTop10Config) {
    return notHandled('disabled');
  }

  const { filterId, headerCellId, type, count, by } = pendingTop10Config;

  // Set the top10 criteria
  const applied = await setCriteriaForHeader(ws, filterId, headerCellId, {
    type: 'top10',
    topBottom: { type, count, by },
  });
  if (!applied) return notHandled('disabled');

  // Clear pending config and close dialog
  uiStore.getState().clearPendingTop10Config();
  uiStore.getState().closeTop10Dialog();

  return handled();
};

/**
 * OPEN_TOP10_DIALOG
 *
 * Opens the Top 10 filter dialog.
 */
export const OPEN_TOP10_DIALOG: ActionHandler = (deps: ActionDependencies): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().openTop10Dialog();
  return handled();
};

/**
 * CLOSE_TOP10_DIALOG
 *
 * Closes the Top 10 filter dialog.
 */
export const CLOSE_TOP10_DIALOG: ActionHandler = (deps: ActionDependencies): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closeTop10Dialog();
  return handled();
};

/**
 * CLEAR_COLUMN_FILTER
 *
 * Clears the filter from a specific column.
 * Uses the current filter dropdown context (filterId, headerCellId).
 */
export const CLEAR_COLUMN_FILTER: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const uiStore = getUIStore(deps);

  // Read current filter context from UIStore
  const { filterId, headerCellId } = uiStore.getState().filterDropdown;

  if (!filterId || !headerCellId) {
    return notHandled('disabled');
  }

  const cleared = await clearCriteriaForHeader(ws, filterId, headerCellId);
  if (!cleared) return notHandled('disabled');

  return handled();
};

// =============================================================================
// Context Menu Filter Actions (Context Menus - Item 4.4)
// =============================================================================

/**
 * FILTER_BY_SELECTED_VALUE
 *
 * Filter the data to show only rows matching the value in the selected cell.
 *
 * Context Menus - Item 4.4 (Sort/Filter Submenus)
 */
export const FILTER_BY_SELECTED_VALUE: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  // Get the value to filter by
  const cellData = await ws.getCell(activeCell.row, activeCell.col);
  const cellValue = cellData?.value;

  // Find or create a filter for this region
  let filter = await ws.filters.getForRange({
    startRow: 0,
    startCol: activeCell.col,
    endRow: 0,
    endCol: activeCell.col,
  });

  if (isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  if (!filter) {
    await ws.filters.setAutoFilter({
      startRow: 0,
      startCol: 0,
      endRow: 1000,
      endCol: activeCell.col + 1,
    });
    filter = await ws.filters.getForRange({
      startRow: 0,
      startCol: activeCell.col,
      endRow: 0,
      endCol: activeCell.col,
    });
  }

  if (!filter || isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  await ws.filters.setColumnFilter(
    activeCell.col,
    {
      type: 'value',
      values: cellValue !== undefined ? [cellValue] : [],
    },
    filter.id,
  );

  return handled();
};

/**
 * FILTER_BY_COLOR
 *
 * Filter the data to show only rows matching the color of the selected cell.
 *
 * Context Menus - Item 4.4 (Sort/Filter Submenus)
 */
export const FILTER_BY_COLOR: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  // Get cell colors via format
  const format = await ws.formats.get(activeCell.row, activeCell.col);
  const backgroundColor = format?.backgroundColor;
  const fontColor = format?.fontColor;

  if (!backgroundColor && !fontColor) {
    return notHandled('disabled');
  }

  // Find or create a filter for this region
  let filter = await ws.filters.getForRange({
    startRow: 0,
    startCol: activeCell.col,
    endRow: 0,
    endCol: activeCell.col,
  });

  if (isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  if (!filter) {
    await ws.filters.setAutoFilter({
      startRow: 0,
      startCol: 0,
      endRow: 1000,
      endCol: activeCell.col + 1,
    });
    filter = await ws.filters.getForRange({
      startRow: 0,
      startCol: activeCell.col,
      endRow: 0,
      endCol: activeCell.col,
    });
  }

  if (!filter || isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  const colorType: 'fill' | 'font' = backgroundColor ? 'fill' : 'font';
  const color = backgroundColor || fontColor;

  await ws.filters.setColumnFilter(
    activeCell.col,
    {
      type: 'color',
      colorFilter: { type: colorType, color: color! },
    },
    filter.id,
  );

  return handled();
};

/**
 * FILTER_BY_FONT_COLOR
 *
 * Filter the data to show only rows matching the font color of the selected cell.
 *
 * Context Menus - Filter by Font Color
 */
export const FILTER_BY_FONT_COLOR: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  const format = await ws.formats.get(activeCell.row, activeCell.col);
  const fontColor = format?.fontColor;

  if (!fontColor) {
    return notHandled('disabled');
  }

  let filter = await ws.filters.getForRange({
    startRow: 0,
    startCol: activeCell.col,
    endRow: 0,
    endCol: activeCell.col,
  });

  if (isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  if (!filter) {
    await ws.filters.setAutoFilter({
      startRow: 0,
      startCol: 0,
      endRow: 1000,
      endCol: activeCell.col + 1,
    });
    filter = await ws.filters.getForRange({
      startRow: 0,
      startCol: activeCell.col,
      endRow: 0,
      endCol: activeCell.col,
    });
  }

  if (!filter || isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  await ws.filters.setColumnFilter(
    activeCell.col,
    {
      type: 'color',
      colorFilter: { type: 'font', color: fontColor },
    },
    filter.id,
  );

  return handled();
};

/**
 * CLEAR_FILTER
 *
 * Clear all filters from the current data region.
 *
 * Context Menus - Item 4.4 (Sort/Filter Submenus)
 */
export const CLEAR_FILTER: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  const filter = await ws.filters.getForRange({
    startRow: activeCell.row,
    startCol: activeCell.col,
    endRow: activeCell.row,
    endCol: activeCell.col,
  });

  if (!filter) {
    return notHandled('disabled');
  }

  await ws.filters.remove(filter.id);

  return handled();
};

// =============================================================================
// Custom AutoFilter Dialog Actions
// =============================================================================

/**
 * OPEN_CUSTOM_AUTOFILTER_DIALOG
 *
 * Opens the Custom AutoFilter dialog for a specific column.
 *
 * Custom AutoFilter Dialog
 */
export const OPEN_CUSTOM_AUTOFILTER_DIALOG: ActionHandler = (
  deps: ActionDependencies,
  payload?: { filterId: string; columnIndex: number; columnName?: string },
): ActionResult => {
  if (!payload?.filterId || payload?.columnIndex === undefined) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  uiStore
    .getState()
    .openCustomAutoFilterDialog(payload.filterId, payload.columnIndex, payload.columnName);
  return handled();
};

/**
 * CLOSE_CUSTOM_AUTOFILTER_DIALOG
 *
 * Closes the Custom AutoFilter dialog.
 *
 * Custom AutoFilter Dialog
 */
export const CLOSE_CUSTOM_AUTOFILTER_DIALOG: ActionHandler = (
  deps: ActionDependencies,
): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closeCustomAutoFilterDialog();
  return handled();
};

/**
 * APPLY_CUSTOM_AUTOFILTER
 *
 * Applies custom filter conditions from the Custom AutoFilter dialog.
 * Supports two conditions with AND/OR logic and wildcards (* and ?).
 *
 * Custom AutoFilter Dialog
 */
export const APPLY_CUSTOM_AUTOFILTER: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    filterId: string;
    columnIndex: number;
    conditions: {
      condition1: { operator: string; value: string } | null;
      condition2: { operator: string; value: string } | null;
      logicalOperator: 'and' | 'or';
    };
  },
): Promise<ActionResult> => {
  if (!payload?.filterId || payload?.columnIndex === undefined || !payload?.conditions) {
    return notHandled('disabled');
  }

  const ws = getWs(deps);
  const { filterId, columnIndex, conditions } = payload;

  // Build the filter conditions array
  type FilterOperatorType =
    | 'equals'
    | 'notEquals'
    | 'contains'
    | 'notContains'
    | 'startsWith'
    | 'endsWith'
    | 'greaterThan'
    | 'greaterThanOrEqual'
    | 'lessThan'
    | 'lessThanOrEqual';

  const filterConditions: Array<{
    operator: FilterOperatorType;
    value?: string | number;
  }> = [];

  if (conditions.condition1) {
    filterConditions.push({
      operator: mapCustomOperatorToFilterOperator(
        conditions.condition1.operator,
      ) as FilterOperatorType,
      value: parseFilterValue(conditions.condition1.value),
    });
  }

  if (conditions.condition2) {
    filterConditions.push({
      operator: mapCustomOperatorToFilterOperator(
        conditions.condition2.operator,
      ) as FilterOperatorType,
      value: parseFilterValue(conditions.condition2.value),
    });
  }

  await ws.filters.setColumnFilter(
    columnIndex,
    {
      type: 'condition',
      conditions: filterConditions,
      conditionLogic: conditions.logicalOperator,
    },
    filterId,
  );

  return handled();
};

/**
 * Map custom autofilter operator names to filter domain operator names.
 * Maps to FilterOperator type defined in contracts/src/pivot.ts
 */
function mapCustomOperatorToFilterOperator(operator: string): string {
  const mapping: Record<string, string> = {
    equals: 'equals',
    notEquals: 'notEquals',
    greaterThan: 'greaterThan',
    lessThan: 'lessThan',
    greaterOrEqual: 'greaterThanOrEqual',
    lessOrEqual: 'lessThanOrEqual',
    beginsWith: 'startsWith',
    endsWith: 'endsWith',
    contains: 'contains',
    notContains: 'notContains',
  };
  return mapping[operator] || operator;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse a filter value string to appropriate type.
 * Attempts to convert to number if possible.
 */
function parseFilterValue(value: string): string | number {
  const trimmed = value.trim();

  // Try parsing as number
  const num = parseFloat(trimmed);
  if (!isNaN(num) && isFinite(num) && String(num) === trimmed) {
    return num;
  }

  // Return as string
  return trimmed;
}

// =============================================================================
// Advanced Filter Dialog Actions
// =============================================================================

/**
 * OPEN_ADVANCED_FILTER_DIALOG
 *
 * Opens the Advanced Filter dialog.
 * Pre-populates the list range based on current selection if available.
 *
 * Advanced Filter Dialog
 */
export const OPEN_ADVANCED_FILTER_DIALOG: ActionHandler = (
  deps: ActionDependencies,
): ActionResult => {
  const uiStore = getUIStore(deps);
  const sheetId = deps.getActiveSheetId();

  // Try to get the current selection to pre-populate the list range
  // Use getDataBoundedRanges to constrain full column/row selections to actual data bounds
  let initialListRange = '';
  const ranges = deps.accessors.selection.getDataBoundedRanges(sheetId);
  if (ranges && ranges.length > 0) {
    const range = ranges[0];
    // Convert range to A1 notation
    initialListRange = rangeToA1Notation(range);
  }

  uiStore.getState().openAdvancedFilterDialog(initialListRange);
  return handled();
};

/**
 * CLOSE_ADVANCED_FILTER_DIALOG
 *
 * Closes the Advanced Filter dialog.
 *
 * Advanced Filter Dialog
 */
export const CLOSE_ADVANCED_FILTER_DIALOG: ActionHandler = (
  deps: ActionDependencies,
): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closeAdvancedFilterDialog();
  return handled();
};

/**
 * APPLY_ADVANCED_FILTER
 *
 * Applies the advanced filter based on criteria range.
 * Supports filtering in place or copying to another location.
 *
 * Advanced Filter Dialog
 *
 * The criteria range format is:
 * - Row 1: Column headers (must match data headers exactly)
 * - Row 2+: Filter criteria (AND within row, OR across rows)
 *
 * Example criteria range:
 * | Name | Age |
 * | Smith | >30 |
 * | Johnson | |
 * This filters for: (Name="Smith" AND Age>30) OR (Name="Johnson")
 */
export const APPLY_ADVANCED_FILTER: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const uiStore = getUIStore(deps);

  // Read dialog state
  const dialogState = uiStore.getState().advancedFilterDialog;

  if (!dialogState.listRange.trim()) {
    uiStore.getState().setAdvancedFilterError('List range is required.');
    return handled();
  }

  if (!dialogState.filterInPlace) {
    if (!dialogState.copyToRange.trim()) {
      uiStore
        .getState()
        .setAdvancedFilterError('Copy to range is required when not filtering in place.');
      return handled();
    }
  }

  try {
    const ok = await guardBridgeMutation(async () => {
      await ws.filters.applyAdvanced({
        listRange: dialogState.listRange,
        criteriaRange: dialogState.criteriaRange || undefined,
        mode: dialogState.filterInPlace ? 'inPlace' : 'copyTo',
        copyToRange: dialogState.filterInPlace ? undefined : dialogState.copyToRange,
        uniqueRecordsOnly: dialogState.uniqueRecordsOnly,
      } as Parameters<typeof ws.filters.applyAdvanced>[0]);
    });
    if (!ok) return handled();
    uiStore.getState().closeAdvancedFilterDialog();
  } catch (err) {
    uiStore
      .getState()
      .setAdvancedFilterError(err instanceof Error ? err.message : 'Advanced Filter failed.');
  }

  return handled();
};

/**
 * Convert a CellRange to A1 notation string.
 */
function rangeToA1Notation(range: {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}): string {
  const startCol = columnToLetter(range.startCol);
  const endCol = columnToLetter(range.endCol);
  const startRow = range.startRow + 1;
  const endRow = range.endRow + 1;

  if (range.startRow === range.endRow && range.startCol === range.endCol) {
    return `${startCol}${startRow}`;
  }
  return `${startCol}${startRow}:${endCol}${endRow}`;
}

/**
 * Convert column index to letter (0 = A, 1 = B, etc.)
 */
function columnToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c >= 0) {
    result = String.fromCharCode((c % 26) + 65) + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}

// =============================================================================
// Sort & Filter Group Actions
// =============================================================================

/**
 * CLEAR_ALL_FILTERS
 *
 * Clear all filters on the active sheet.
 * Unlike CLEAR_FILTER which clears a single filter, this removes all
 * column filter criteria from all filters on the sheet.
 *
 * Sort & Filter group - Clear button
 */
export const CLEAR_ALL_FILTERS: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const sheetId = deps.getActiveSheetId();

  try {
    const allFilters = await ws.filters.listSummaries();
    const clearableFilters = allFilters.filter((filter) => {
      const hasActiveFilter = filter.hasActiveFilter ?? filter.hasActiveCriteria;
      return filter.clearable ?? (filter.filterKind !== 'advancedFilter' && hasActiveFilter);
    });

    if (clearableFilters.length === 0) {
      return handled(); // No filters to clear
    }

    for (const filter of clearableFilters) {
      await ws.filters.clearAllCriteria(filter.id);
    }

    return handled();
  } catch (error) {
    recordFilterReadinessError({
      source: 'dataTabClear',
      sheetId,
      operation: 'filters.clearAllCriteria',
      error,
    });
    throw error;
  }
};

/**
 * REAPPLY_FILTERS
 *
 * Re-apply all filters on the active sheet.
 * Useful after data changes to ensure row visibility is correct.
 *
 * Sort & Filter group - Reapply button
 */
export const REAPPLY_FILTERS: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);

  const allFilters = await ws.filters.list();

  if (!allFilters || allFilters.length === 0) {
    return handled(); // No filters to reapply
  }

  for (const filter of allFilters) {
    if (filter.filterKind === 'advancedFilter') {
      if (!filter.advancedFilter?.active) continue;
      await ws.filters.applyAdvanced({
        listRange: rangeToA1Notation(filter.range),
        criteriaRange: filter.advancedFilter.criteriaRange
          ? rangeToA1Notation(filter.advancedFilter.criteriaRange)
          : undefined,
        mode: 'inPlace',
        uniqueRecordsOnly: filter.advancedFilter.uniqueRecordsOnly,
        filterId: filter.id,
      });
    } else {
      await ws.filters.apply(filter.id);
    }
  }

  return handled();
};
