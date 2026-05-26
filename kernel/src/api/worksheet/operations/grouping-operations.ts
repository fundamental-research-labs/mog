/**
 * Grouping Operations Module
 *
 * Standalone functions for row/column grouping operations.
 * All functions take DocumentContext and sheetId as the first two parameters.
 */

import type { CellRange, SubtotalConfig, SubtotalResult } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  GroupDefinition,
  SheetRange,
  SubtotalFunction,
  SubtotalOptions,
} from '../../../bridges/compute/compute-types.gen';
import { KernelError } from '../../../errors';
import type { DocumentContext, OperationResult } from './shared';
import { invalidCellAddress, operationFailed } from './shared';

// =============================================================================
// Row/Column Grouping Read Operations
// =============================================================================

/**
 * Get all row groups in a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise of array of row group objects
 */
export async function getRowGroups(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<GroupDefinition[]> {
  try {
    return await ctx.computeBridge.getGroups(sheetId, 'row');
  } catch (e) {
    throw KernelError.from(e, 'OPERATION_FAILED', `Failed to get row groups: ${String(e)}`);
  }
}

/**
 * Get all column groups in a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise of array of column group objects
 */
export async function getColumnGroups(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<GroupDefinition[]> {
  try {
    return await ctx.computeBridge.getGroups(sheetId, 'column');
  } catch (e) {
    throw KernelError.from(e, 'OPERATION_FAILED', `Failed to get column groups: ${String(e)}`);
  }
}

// =============================================================================
// Row/Column Grouping Write Operations
// =============================================================================

/**
 * Group rows in a range.
 *
 * Creates an outline group for the specified rows. Rows can be collapsed
 * and expanded together as a group.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row index (0-based, inclusive)
 * @param endRow - End row index (0-based, inclusive)
 * @returns Promise of OperationResult indicating success or failure
 *
 * @example
 * ```typescript
 * // Group rows 5-10
 * const result = await groupRows(ctx, sheetId, 5, 10);
 * if (result.success) {
 *   console.log('Rows grouped successfully');
 * }
 * ```
 */
export async function groupRows(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  endRow: number,
): Promise<OperationResult<void>> {
  if (startRow < 0) {
    return {
      success: false,
      error: invalidCellAddress(startRow, 0),
    };
  }

  if (endRow < startRow) {
    return {
      success: false,
      error: operationFailed('groupRows', 'End row must be >= start row'),
    };
  }

  try {
    await ctx.computeBridge.groupRows(sheetId, startRow, endRow);
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('groupRows', String(e)),
    };
  }
}

/**
 * Ungroup rows in a range.
 *
 * Removes outline groups that fall within the specified row range.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row index (0-based, inclusive)
 * @param endRow - End row index (0-based, inclusive)
 * @returns Promise of OperationResult indicating success or failure
 *
 * @example
 * ```typescript
 * // Ungroup rows 5-10
 * const result = await ungroupRows(ctx, sheetId, 5, 10);
 * if (result.success) {
 *   console.log('Rows ungrouped successfully');
 * }
 * ```
 */
export async function ungroupRows(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  endRow: number,
): Promise<OperationResult<void>> {
  if (startRow < 0) {
    return {
      success: false,
      error: invalidCellAddress(startRow, 0),
    };
  }

  if (endRow < startRow) {
    return {
      success: false,
      error: operationFailed('ungroupRows', 'End row must be >= start row'),
    };
  }

  try {
    await ctx.computeBridge.ungroupRows(sheetId, startRow, endRow);
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('ungroupRows', String(e)),
    };
  }
}

/**
 * Group columns in a range.
 *
 * Creates an outline group for the specified columns. Columns can be collapsed
 * and expanded together as a group.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startCol - Start column index (0-based, inclusive)
 * @param endCol - End column index (0-based, inclusive)
 * @returns Promise of OperationResult indicating success or failure
 *
 * @example
 * ```typescript
 * // Group columns 2-5 (C to F)
 * const result = await groupColumns(ctx, sheetId, 2, 5);
 * if (result.success) {
 *   console.log('Columns grouped successfully');
 * }
 * ```
 */
export async function groupColumns(
  ctx: DocumentContext,
  sheetId: SheetId,
  startCol: number,
  endCol: number,
): Promise<OperationResult<void>> {
  if (startCol < 0) {
    return {
      success: false,
      error: invalidCellAddress(0, startCol),
    };
  }

  if (endCol < startCol) {
    return {
      success: false,
      error: operationFailed('groupColumns', 'End column must be >= start column'),
    };
  }

  try {
    await ctx.computeBridge.groupColumns(sheetId, startCol, endCol);
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('groupColumns', String(e)),
    };
  }
}

/**
 * Ungroup columns in a range.
 *
 * Removes outline groups that fall within the specified column range.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startCol - Start column index (0-based, inclusive)
 * @param endCol - End column index (0-based, inclusive)
 * @returns Promise of OperationResult indicating success or failure
 *
 * @example
 * ```typescript
 * // Ungroup columns 2-5 (C to F)
 * const result = await ungroupColumns(ctx, sheetId, 2, 5);
 * if (result.success) {
 *   console.log('Columns ungrouped successfully');
 * }
 * ```
 */
export async function ungroupColumns(
  ctx: DocumentContext,
  sheetId: SheetId,
  startCol: number,
  endCol: number,
): Promise<OperationResult<void>> {
  if (startCol < 0) {
    return {
      success: false,
      error: invalidCellAddress(0, startCol),
    };
  }

  if (endCol < startCol) {
    return {
      success: false,
      error: operationFailed('ungroupColumns', 'End column must be >= start column'),
    };
  }

  try {
    await ctx.computeBridge.ungroupColumns(sheetId, startCol, endCol);
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('ungroupColumns', String(e)),
    };
  }
}

/**
 * Toggle the collapsed state of a group by its ID.
 */
export async function toggleGroupCollapsed(
  ctx: DocumentContext,
  sheetId: SheetId,
  groupId: string,
): Promise<OperationResult<void>> {
  try {
    await ctx.computeBridge.toggleGroupCollapsed(sheetId, groupId);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: operationFailed('toggleGroupCollapsed', String(e)) };
  }
}

/**
 * Expand all groups in the sheet.
 */
export async function expandAllGroups(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<OperationResult<void>> {
  try {
    await ctx.computeBridge.expandAllGroups(sheetId);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: operationFailed('expandAllGroups', String(e)) };
  }
}

/**
 * Collapse all groups in the sheet.
 */
export async function collapseAllGroups(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<OperationResult<void>> {
  try {
    await ctx.computeBridge.collapseAllGroups(sheetId);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: operationFailed('collapseAllGroups', String(e)) };
  }
}

/**
 * Get the full group state for a sheet.
 */
export async function getGroupState(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<{
  rowGroups: GroupDefinition[];
  columnGroups: GroupDefinition[];
  maxRowLevel: number;
  maxColLevel: number;
}> {
  const [rowGroups, columnGroups, maxRowLevel, maxColLevel] = await Promise.all([
    getRowGroups(ctx, sheetId),
    getColumnGroups(ctx, sheetId),
    getMaxOutlineLevel(ctx, sheetId, 'row'),
    getMaxOutlineLevel(ctx, sheetId, 'column'),
  ]);
  return { rowGroups, columnGroups, maxRowLevel, maxColLevel };
}

/**
 * Get the outline level of a specific row or column.
 *
 * The backend may not have a per-index query, so we compute it from group data.
 */
export async function getOutlineLevel(
  ctx: DocumentContext,
  sheetId: SheetId,
  type: 'row' | 'column',
  index: number,
): Promise<number> {
  try {
    const groups = await ctx.computeBridge.getGroups(sheetId, type);
    let level = 0;
    for (const group of groups) {
      const start = group.start ?? 0;
      const end = group.end ?? 0;
      const groupLevel = group.level ?? 1;
      if (index >= start && index <= end && groupLevel > level) {
        level = groupLevel;
      }
    }
    return level;
  } catch {
    return 0;
  }
}

/**
 * Get the maximum outline level for rows or columns.
 */
export async function getMaxOutlineLevel(
  ctx: DocumentContext,
  sheetId: SheetId,
  type: 'row' | 'column',
): Promise<number> {
  try {
    return await ctx.computeBridge.getMaxOutlineLevel(sheetId, type);
  } catch {
    return 0;
  }
}

/**
 * Apply automatic subtotals.
 *
 * Apply automatic subtotals to the caller-supplied target range.
 */
function isSheetRange(value: unknown): value is SheetRange {
  if (!value || typeof value !== 'object') return false;
  const range = value as Record<string, unknown>;
  return (
    typeof range.startRow === 'number' &&
    typeof range.startCol === 'number' &&
    typeof range.endRow === 'number' &&
    typeof range.endCol === 'number'
  );
}

function isBridgeSubtotalResult(value: unknown): value is {
  groupsCreated: number;
  subtotalRowsInserted: number;
  affectedRange: SheetRange;
} {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.groupsCreated === 'number' &&
    typeof result.subtotalRowsInserted === 'number' &&
    isSheetRange(result.affectedRange)
  );
}

function toCellRange(range: SheetRange): CellRange {
  return {
    startRow: range.startRow,
    startCol: range.startCol,
    endRow: range.endRow,
    endCol: range.endCol,
  };
}

export async function subtotal(
  ctx: DocumentContext,
  sheetId: SheetId,
  config: SubtotalConfig,
): Promise<OperationResult<SubtotalResult>> {
  try {
    const options: SubtotalOptions = {
      groupByColumn: config.groupByColumn,
      subtotalColumns: config.subtotalColumns,
      function: config.aggregation satisfies SubtotalFunction,
      hasHeaders: config.hasHeaders,
      replaceExisting: config.replace ?? false,
      summaryBelowData: config.summaryBelowData ?? true,
    };

    const mutationResult = await ctx.computeBridge.autoSubtotals(sheetId, {
      startRow: config.range.startRow,
      startCol: config.range.startCol,
      endRow: config.range.endRow,
      endCol: config.range.endCol,
      options,
    });
    if (!isBridgeSubtotalResult(mutationResult.data)) {
      return {
        success: false,
        error: operationFailed('subtotal', 'Subtotal mutation did not return a valid result.'),
      };
    }
    return {
      success: true,
      data: {
        groupsCreated: mutationResult.data.groupsCreated,
        subtotalRowsInserted: mutationResult.data.subtotalRowsInserted,
        affectedRange: toCellRange(mutationResult.data.affectedRange),
      },
    };
  } catch (e) {
    return { success: false, error: operationFailed('subtotal', String(e)) };
  }
}
