/**
 * Filter Operations Module
 *
 * Standalone functions for filter operations extracted from SheetAPI.
 * All functions take DocumentContext and sheetId as the first two parameters.
 */

import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { ColumnFilterCriteria } from '@mog-sdk/contracts/filter';
import type { FilterMutationReceipt } from '@mog-sdk/contracts/api';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationAdmissionOptions } from '../../../bridges/compute';
import type {
  ColumnFilter,
  FilterSortState,
  FilterState,
} from '../../../bridges/compute/compute-types.gen';
import { columnFilterCriteriaToCompute } from '../../../bridges/compute/compute-wire-converters';
import type { DocumentContext, OperationResult } from './shared';
import { invalidRange, operationFailed } from './shared';
import { KernelError } from '../../../errors';
import { resolveFilterRange } from '../filter-range-resolution';
import {
  buildFilterMutationReceipt,
  columnFilterIsClear,
  getFilterById,
} from '../filters/mutation-receipts';
import {
  assertFilterMutationAllowed,
  assertNoProtectedTableFilterCreation,
} from '../protected-table-operations';
import { createVersionOperationContext } from '../../internal/version-operation-context';

// =============================================================================
// Filter Operations
// =============================================================================

type FilterMutationOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

const FILTER_DOMAIN_IDS = ['filters.auto-filter'] as const;

/**
 * Create a filter on a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row of filter range (0-based)
 * @param startCol - Start column of filter range (0-based)
 * @param endRow - End row of filter range (0-based)
 * @param endCol - End column of filter range (0-based)
 * @param tableId - Optional table ID to associate with filter
 * @returns OperationResult indicating success or failure
 *
 * @example
 * ```typescript
 * // Create filter on range A1:D100
 * const result = await createFilter(ctx, sheetId, 0, 0, 99, 3);
 * if (result.success) {
 *   console.log('Filter created');
 * }
 * ```
 */
export async function createFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  tableId?: string,
): Promise<OperationResult<void>> {
  // Validate range
  if (startRow < 0 || startCol < 0 || endRow < startRow || endCol < startCol) {
    return {
      success: false,
      error: invalidRange(startRow, startCol, endRow, endCol),
    };
  }

  try {
    await ctx.awaitMaterialized?.('allSheets');
    await assertNoProtectedTableFilterCreation(ctx, sheetId, 'filters.add', {
      startRow,
      startCol,
      endRow,
      endCol,
    });
    await ctx.computeBridge.createFilter(
      sheetId,
      { startRow, startCol, endRow, endCol, tableId },
      createFilterMutationOptions(ctx, sheetId, 'filters.add'),
    );
    return { success: true, data: undefined };
  } catch (e) {
    return {
      success: false,
      error: e instanceof KernelError ? e : operationFailed('createFilter', String(e)),
    };
  }
}

/**
 * Delete a filter from a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param filterId - Filter ID to delete
 * @returns OperationResult indicating success or failure
 */
export async function deleteFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<OperationResult<void>> {
  try {
    await ctx.awaitMaterialized?.('allSheets');
    await assertFilterMutationAllowed(ctx, sheetId, 'filters.remove', filterId);
    await ctx.computeBridge.deleteFilter(
      sheetId,
      filterId,
      createFilterMutationOptions(ctx, sheetId, 'filters.remove'),
    );
    return { success: true, data: undefined };
  } catch (e) {
    return {
      success: false,
      error: e instanceof KernelError ? e : operationFailed('deleteFilter', String(e)),
    };
  }
}

/**
 * Set filter criteria for a column.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param filterId - Filter ID
 * @param headerCol - Column index (0-based)
 * @param criteria - Filter criteria object
 * @returns OperationResult indicating success or failure
 *
 * @example
 * ```typescript
 * // Filter to show only values > 100
 * const criteria = { condition: 'greaterThan', value: 100 };
 * await setColumnFilter(ctx, sheetId, filterId, 0, criteria);
 * ```
 */
export async function setColumnFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  headerCol: number,
  criteria: ColumnFilterCriteria,
): Promise<OperationResult<FilterMutationReceipt>> {
  try {
    await ctx.awaitMaterialized?.('allSheets');
    const filter = await getFilterById(ctx, sheetId, filterId);
    if (!filter) {
      return {
        success: true,
        data: buildFilterMutationReceipt({
          kind: 'filter.columnFilter.set',
          status: 'noOp',
          sheetId,
          filterId,
          column: headerCol,
        }),
      };
    }
    await assertFilterMutationAllowed(ctx, sheetId, 'filters.setColumnFilter', filterId);
    const range = await resolveFilterRange(ctx, sheetId, filter);
    const result = await ctx.computeBridge.setColumnFilter(
      sheetId,
      filterId,
      headerCol,
      columnFilterCriteriaToCompute(criteria),
      createFilterMutationOptions(ctx, sheetId, 'filters.setColumnFilter'),
    );
    return {
      success: true,
      data: buildFilterMutationReceipt({
        kind: 'filter.columnFilter.set',
        sheetId,
        filterId,
        column: headerCol,
        filter,
        range,
        result,
      }),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof KernelError ? e : operationFailed('setColumnFilter', String(e)),
    };
  }
}

/**
 * Clear filter criteria for a specific column.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param filterId - Filter ID
 * @param headerCol - Column index (0-based)
 * @returns OperationResult indicating success or failure
 */
export async function clearColumnFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  headerCol: number,
): Promise<OperationResult<FilterMutationReceipt>> {
  try {
    await ctx.awaitMaterialized?.('allSheets');
    const filter = await getFilterById(ctx, sheetId, filterId);
    if (!filter) {
      return {
        success: true,
        data: buildFilterMutationReceipt({
          kind: 'filter.columnFilter.clear',
          status: 'noOp',
          sheetId,
          filterId,
          column: headerCol,
          filter,
        }),
      };
    }
    const range = await resolveFilterRange(ctx, sheetId, filter);
    if (await columnFilterIsClear(ctx, sheetId, filter, range, headerCol)) {
      return {
        success: true,
        data: buildFilterMutationReceipt({
          kind: 'filter.columnFilter.clear',
          status: 'noOp',
          sheetId,
          filterId,
          column: headerCol,
          filter,
          range,
        }),
      };
    }
    await assertFilterMutationAllowed(ctx, sheetId, 'filters.clearColumnFilter', filterId);
    const result = await ctx.computeBridge.clearColumnFilter(
      sheetId,
      filterId,
      headerCol,
      createFilterMutationOptions(ctx, sheetId, 'filters.clearColumnFilter'),
    );
    return {
      success: true,
      data: buildFilterMutationReceipt({
        kind: 'filter.columnFilter.clear',
        sheetId,
        filterId,
        column: headerCol,
        filter,
        range,
        result,
      }),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof KernelError ? e : operationFailed('clearColumnFilter', String(e)),
    };
  }
}

/**
 * Clear all filter criteria for a filter.
 *
 * Removes filters from all columns but keeps the filter structure intact.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param filterId - Filter ID
 * @returns OperationResult indicating success or failure
 */
export async function clearAllColumnFilters(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<OperationResult<FilterMutationReceipt>> {
  try {
    await ctx.awaitMaterialized?.('allSheets');
    const filter = await getFilterById(ctx, sheetId, filterId);
    if (!filter) {
      return {
        success: true,
        data: buildFilterMutationReceipt({
          kind: 'filter.criteria.clearAll',
          status: 'noOp',
          sheetId,
          filterId,
        }),
      };
    }
    const range = await resolveFilterRange(ctx, sheetId, filter);
    if (Object.keys(filter.columnFilters ?? {}).length === 0) {
      return {
        success: true,
        data: buildFilterMutationReceipt({
          kind: 'filter.criteria.clearAll',
          status: 'noOp',
          sheetId,
          filterId,
          filter,
          range,
        }),
      };
    }
    await assertFilterMutationAllowed(ctx, sheetId, 'filters.clearAllColumnFilters', filterId);
    const result = await ctx.computeBridge.clearAllColumnFilters(
      sheetId,
      filterId,
      createFilterMutationOptions(ctx, sheetId, 'filters.clearAllColumnFilters'),
    );
    return {
      success: true,
      data: buildFilterMutationReceipt({
        kind: 'filter.criteria.clearAll',
        sheetId,
        filterId,
        filter,
        range,
        result,
      }),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof KernelError ? e : operationFailed('clearAllColumnFilters', String(e)),
    };
  }
}

/**
 * Get all filters in a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise of filter objects
 */
export async function getFiltersInSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<FilterState[]> {
  return ctx.computeBridge.getFiltersInSheet(sheetId);
}

/**
 * Apply a filter to update row visibility.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param filterId - Filter ID to apply
 * @returns OperationResult indicating success or failure
 */
export async function applyFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<OperationResult<FilterMutationReceipt>> {
  try {
    await ctx.awaitMaterialized?.('allSheets');
    const filter = await getFilterById(ctx, sheetId, filterId);
    if (!filter) {
      return {
        success: true,
        data: buildFilterMutationReceipt({
          kind: 'filter.apply',
          status: 'noOp',
          sheetId,
          filterId,
        }),
      };
    }
    await assertFilterMutationAllowed(ctx, sheetId, 'filters.apply', filterId);
    const range = await resolveFilterRange(ctx, sheetId, filter);
    const result = await ctx.computeBridge.applyFilter(
      sheetId,
      filterId,
      createFilterMutationOptions(ctx, sheetId, 'filters.apply'),
    );
    return {
      success: true,
      data: buildFilterMutationReceipt({
        kind: 'filter.apply',
        sheetId,
        filterId,
        filter,
        range,
        result,
      }),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof KernelError ? e : operationFailed('applyFilter', String(e)),
    };
  }
}

/**
 * Reapply a filter after data changes.
 */
export async function reapplyFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<OperationResult<FilterMutationReceipt>> {
  try {
    await ctx.awaitMaterialized?.('allSheets');
    const filter = await getFilterById(ctx, sheetId, filterId);
    if (!filter) {
      return {
        success: true,
        data: buildFilterMutationReceipt({
          kind: 'filter.reapply',
          status: 'noOp',
          sheetId,
          filterId,
        }),
      };
    }
    await assertFilterMutationAllowed(ctx, sheetId, 'filters.reapply', filterId);
    const range = await resolveFilterRange(ctx, sheetId, filter);
    const result = await ctx.computeBridge.reapplyFilter(
      sheetId,
      filterId,
      createFilterMutationOptions(ctx, sheetId, 'filters.reapply'),
    );
    return {
      success: true,
      data: buildFilterMutationReceipt({
        kind: 'filter.reapply',
        sheetId,
        filterId,
        filter,
        range,
        result,
      }),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof KernelError ? e : operationFailed('reapplyFilter', String(e)),
    };
  }
}

/**
 * Get unique values in a filter column for dropdown UI.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param filterId - Filter ID
 * @param headerCol - Column index (0-based)
 * @returns Promise of unique values object
 */
export async function getUniqueColumnValues(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  headerCol: number,
): Promise<CellValue[]> {
  return ctx.computeBridge.getUniqueColumnValues(sheetId, filterId, headerCol);
}

/**
 * Find the first filter whose range overlaps the given range.
 *
 * Used by handlers that need to check if a filter already covers a selection.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - Range to check
 * @returns Filter object with `id` if found, or null
 */
export async function getFilterForRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: { startRow: number; startCol: number; endRow: number; endCol: number },
): Promise<{ id: string } | null> {
  const filters = await ctx.computeBridge.getFiltersInSheet(sheetId);
  for (const filter of filters) {
    const fRange = await resolveFilterRange(ctx, sheetId, filter);

    // Check intersection
    if (
      !(
        range.endRow < fRange.startRow ||
        range.startRow > fRange.endRow ||
        range.endCol < fRange.startCol ||
        range.startCol > fRange.endCol
      )
    ) {
      return { id: filter.id };
    }
  }
  return null;
}

/**
 * Get detailed filter info by ID.
 * Returns filter with resolved numeric range and column filters.
 */
export async function getFilterInfo(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<{
  id: string;
  range: { startRow: number; startCol: number; endRow: number; endCol: number };
  columnFilters: Record<string, ColumnFilter>;
} | null> {
  const filters = await ctx.computeBridge.getFiltersInSheet(sheetId);
  const filter = filters.find((f) => f.id === filterId);
  if (!filter) return null;
  const fRange = await resolveFilterRange(ctx, sheetId, filter);
  return {
    id: filter.id,
    range: fRange,
    columnFilters: filter.columnFilters ?? {},
  };
}

/**
 * List all filters in the sheet.
 */
export async function listFilters(ctx: DocumentContext, sheetId: SheetId): Promise<FilterState[]> {
  return ctx.computeBridge.getFiltersInSheet(sheetId);
}

/**
 * List all filters in the sheet with resolved numeric ranges.
 * Single bridge call — avoids the N+1 pattern of listFilters + getFilterInfo per filter.
 */
export async function listFilterDetails(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<
  Array<{
    id: string;
    range: { startRow: number; startCol: number; endRow: number; endCol: number };
    columnFilters: Record<string, ColumnFilter>;
  }>
> {
  const filters = await ctx.computeBridge.getFiltersInSheet(sheetId);
  return Promise.all(
    filters.map(async (filter) => {
      const fRange = await resolveFilterRange(ctx, sheetId, filter);
      return {
        id: filter.id,
        range: fRange,
        columnFilters: filter.columnFilters ?? {},
      };
    }),
  );
}

/**
 * Get the sort state for a filter.
 */
export async function getFilterSortState(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<FilterSortState | null> {
  try {
    return await ctx.computeBridge.getFilterSortState(sheetId, filterId);
  } catch {
    return null;
  }
}

/**
 * Set the sort state for a filter.
 */
export async function setFilterSortState(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  state: FilterSortState | null,
): Promise<OperationResult<void>> {
  try {
    await ctx.awaitMaterialized?.('allSheets');
    await assertFilterMutationAllowed(ctx, sheetId, 'filters.setSortState', filterId);
    await ctx.computeBridge.setFilterSortState(
      sheetId,
      filterId,
      state,
      createFilterMutationOptions(ctx, sheetId, 'filters.setSortState'),
    );
    return { success: true, data: undefined };
  } catch (e) {
    return {
      success: false,
      error: e instanceof KernelError ? e : operationFailed('setFilterSortState', String(e)),
    };
  }
}

function createFilterMutationOptions(
  ctx: DocumentContext,
  sheetId: SheetId,
  operationIdPrefix: string,
): FilterMutationOptions {
  return {
    operationContext: createVersionOperationContext(ctx, {
      operationIdPrefix,
      sheetIds: [sheetId],
      domainIds: FILTER_DOMAIN_IDS,
    }),
  };
}
