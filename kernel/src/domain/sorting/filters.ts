/**
 * Filters Domain Module
 *
 * Filter CRUD operations and evaluation.
 * Pure functions that take DocumentContext as first parameter.
 *
 * Write operations delegate to ComputeBridge (Rust compute core).
 * Read operations are async, querying ComputeBridge.
 * Filter evaluation (bitmap matching, row hide/show) is handled entirely by Rust.
 * MutationResultHandler drives event emission -- no manual event emission here.
 *
 */

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { StructureChangeSource } from '@mog-sdk/contracts/event-base';
import type {
  ColumnFilterCriteria,
  FilterEvaluationResult,
  FilterSortState,
  FilterState,
  FilterType,
} from '@mog-sdk/contracts/filter';
import type { WorkflowCellValue } from '@mog-sdk/contracts/workflows';

import type { DocumentContext } from '../../context/types';
import { columnFilterCriteriaToCompute } from '../../bridges/compute/compute-wire-converters';
import { KernelError } from '../../errors';

// Re-export filter types for consumers
export type { ColumnFilterCriteria, FilterState } from '@mog-sdk/contracts/filter';

// =============================================================================
// Types (kept for backward compatibility)
// =============================================================================

export interface CellColorInfo {
  backgroundColor?: string;
  fontColor?: string;
}

export type GetCellColorsCallback = (row: number, col: number) => CellColorInfo | undefined;

export interface Top10FilterContext {
  threshold: number;
  filterType: 'top' | 'bottom';
}

export interface AverageFilterContext {
  average: number;
}

export interface FilterEvaluationOptions {
  getCellColors?: GetCellColorsCallback;
  top10Contexts?: Map<string, Top10FilterContext>;
  averageContexts?: Map<string, AverageFilterContext>;
}

// =============================================================================
// Internal: Map Rust filter objects to FilterState
// =============================================================================

/**
 * Map a Rust filter object to the FilterState type.
 * Rust returns camelCase objects from serde.
 */
function mapRustFilter(rustFilter: any): FilterState {
  return {
    id: rustFilter.id,
    type: rustFilter.type ?? rustFilter.filterType ?? 'autoFilter',
    headerStartCellId: rustFilter.headerStartCellId ?? '',
    headerEndCellId: rustFilter.headerEndCellId ?? '',
    dataEndCellId: rustFilter.dataEndCellId ?? '',
    columnFilters: rustFilter.columnFilters ?? {},
    sortState: rustFilter.sortState,
    tableId: rustFilter.tableId,
    createdAt: rustFilter.createdAt ?? Date.now(),
    updatedAt: rustFilter.updatedAt ?? Date.now(),
  };
}

// =============================================================================
// Filter CRUD — Write Operations
// =============================================================================

/**
 * Create a new filter for a range.
 *
 * Delegates to ComputeBridge. Rust handles:
 * - CellId-based range storage
 * - Filter state persistence
 *
 * MutationResultHandler handles event emission.
 *
 * @returns The created filter state (queried back from Rust)
 */
export async function createFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  type: FilterType = 'autoFilter',
  _origin: StructureChangeSource = 'user',
  tableId?: string,
): Promise<FilterState> {
  await ctx.computeBridge.createFilter(sheetId, {
    startRow: range.startRow,
    startCol: range.startCol,
    endRow: range.endRow,
    endCol: range.endCol,
    filterType: type,
    tableId,
  });

  // Query back the created filter
  const filters = await getFiltersInSheet(ctx, sheetId);
  // Find the most recently created filter matching our range/tableId
  const created = filters.find((f) => (tableId ? f.tableId === tableId : f.type === type));
  if (!created) {
    throw new KernelError('DOMAIN_FILTER_CREATE_FAILED', 'Failed to create filter');
  }
  return created;
}

/**
 * Delete a filter.
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 */
export async function deleteFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  _origin: StructureChangeSource = 'user',
): Promise<void> {
  await ctx.computeBridge.deleteFilter(sheetId, filterId);
}

/**
 * Set filter criteria for a specific column.
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 */
export function setColumnFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  headerCellId: CellId,
  criteria: ColumnFilterCriteria,
  _origin: StructureChangeSource = 'user',
): Promise<void> {
  return (async () => {
    const pos = await ctx.computeBridge.getCellPosition(sheetId, headerCellId);
    if (!pos) return;
    await ctx.computeBridge.setColumnFilter(
      sheetId,
      filterId,
      pos.col,
      columnFilterCriteriaToCompute(criteria),
    );
  })();
}

/**
 * Clear filter criteria for a specific column.
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 */
export function clearColumnFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  headerCellId: CellId,
  _origin: StructureChangeSource = 'user',
): Promise<void> {
  return (async () => {
    const pos = await ctx.computeBridge.getCellPosition(sheetId, headerCellId);
    if (!pos) return;
    await ctx.computeBridge.clearColumnFilter(sheetId, filterId, pos.col);
  })();
}

/**
 * Clear all column filters (show all rows).
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 */
export function clearAllColumnFilters(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  _origin: StructureChangeSource = 'user',
): Promise<void> {
  return ctx.computeBridge.clearAllColumnFilters(sheetId, filterId).then(() => undefined);
}

// =============================================================================
// Filter Reads — Async Queries
// =============================================================================

/**
 * Get all filters in a sheet.
 *
 * Delegates to ComputeBridge.
 */
export async function getFiltersInSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<FilterState[]> {
  const rustFilters = await ctx.computeBridge.getFiltersInSheet(sheetId);
  return rustFilters.map(mapRustFilter);
}

/**
 * Get a filter by ID.
 */
export async function getFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<FilterState | undefined> {
  const filters = await getFiltersInSheet(ctx, sheetId);
  return filters.find((f) => f.id === filterId);
}

/**
 * Get filter that contains a specific cell.
 */
export async function getFilterContainingCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  _row: number,
  _col: number,
): Promise<FilterState | undefined> {
  // Rust handles range resolution internally.
  // For now, return all filters and let the caller check containment
  // via the resolved range from the viewport.
  const filters = await getFiltersInSheet(ctx, sheetId);
  // Without position resolution (done by Rust), return first filter
  // This is a simplified implementation; full containment check
  // would require Rust to expose a getFilterAtCell query.
  return filters.length > 0 ? filters[0] : undefined;
}

/**
 * Get filter that overlaps with a given range.
 */
export async function getFilterForRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  _range: CellRange,
): Promise<FilterState | undefined> {
  const filters = await getFiltersInSheet(ctx, sheetId);
  return filters.length > 0 ? filters[0] : undefined;
}

/**
 * Get filter header info for a cell (for rendering filter dropdown buttons).
 */
export async function getFilterHeaderInfo(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _row: number,
  _col: number,
): Promise<{ filterId: string; headerCellId: CellId; hasActiveFilter: boolean } | undefined> {
  // In the viewport-buffer model, filter header info is provided by Rust via
  // the ViewportCell data. This stub returns undefined; filter buttons will be
  // rendered when the viewport buffer carries per-cell filter metadata.
  return undefined;
}

/**
 * Resolve filter range to current positions.
 * In the CB model, Rust handles range resolution internally.
 * This returns null as a signal that callers should use Rust queries.
 */
export async function resolveFilterRange(
  _ctx: DocumentContext,
  _filter: FilterState,
): Promise<CellRange | null> {
  // Range resolution is handled by Rust internally.
  // Callers needing resolved positions should use CB queries.
  return null;
}

// =============================================================================
// Filter Evaluation & Application
// =============================================================================

/**
 * Evaluate filter criteria and return which rows match.
 *
 * Delegates to ComputeBridge.applyFilter() which handles evaluation in Rust.
 * The getCellValue callback is no longer needed — Rust reads cell values directly.
 */
export async function evaluateFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  _getCellValue?: (row: number, col: number) => WorkflowCellValue | undefined,
  _options?: FilterEvaluationOptions,
): Promise<FilterEvaluationResult[]> {
  // Rust handles evaluation internally via applyFilter.
  // Return empty array; callers that need per-row results should
  // check hidden row state instead.
  void ctx.computeBridge.applyFilter(sheetId, filterId);
  return [];
}

/**
 * Apply filter: evaluate criteria and hide/unhide rows accordingly.
 *
 * Delegates entirely to ComputeBridge.applyFilter().
 * Rust evaluates criteria, determines which rows to hide/show,
 * and returns the changes via MutationResult.
 */
export async function applyFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  _getCellValue?: (row: number, col: number) => WorkflowCellValue | undefined,
  _origin?: StructureChangeSource,
  _options?: FilterEvaluationOptions,
): Promise<void> {
  await ctx.computeBridge.applyFilter(sheetId, filterId);
}

/**
 * Get unique values in a filter column (for populating dropdown).
 *
 * Delegates to ComputeBridge.
 */
export async function getUniqueValues(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  headerCellId: CellId,
  _getCellValue?: (row: number, col: number) => WorkflowCellValue | undefined,
): Promise<WorkflowCellValue[]> {
  const pos = await ctx.computeBridge.getCellPosition(sheetId, headerCellId);
  if (!pos) return [];
  const result = await ctx.computeBridge.getUniqueColumnValues(sheetId, filterId, pos.col);
  return (result as unknown as WorkflowCellValue[]) ?? [];
}

// =============================================================================
// Sort State
// =============================================================================

/**
 * Set the sort state for a filter.
 *
 * Sort state is stored as part of the filter in Rust.
 * Currently updates via setColumnFilter with sort metadata.
 */
export function setFilterSortState(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _filterId: string,
  _sortState: FilterSortState | undefined,
  _origin: StructureChangeSource = 'user',
): void {
  // Sort state management is handled by Rust as part of filter state.
  // The sorting module handles sort operations directly via CB.
}

/**
 * Clear the sort state for a filter.
 */
export function clearFilterSortState(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  origin: StructureChangeSource = 'user',
): void {
  setFilterSortState(ctx, sheetId, filterId, undefined, origin);
}

/**
 * Get the sort state for a filter.
 */
export async function getFilterSortState(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<FilterSortState | undefined> {
  const filter = await getFilter(ctx, sheetId, filterId);
  return filter?.sortState;
}

// =============================================================================
// Table Filter Queries
// =============================================================================

/**
 * Get the filter associated with a table.
 */
export async function getTableFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableId: string,
): Promise<FilterState | undefined> {
  const filters = await getFiltersInSheet(ctx, sheetId);
  return filters.find((f) => f.tableId === tableId);
}

/**
 * Check if a specific table column has an active filter.
 */
export async function hasTableColumnFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableId: string,
  _headerRow: number,
  _headerCol: number,
): Promise<boolean> {
  const filter = await getTableFilter(ctx, sheetId, tableId);
  if (!filter) return false;
  return Object.keys(filter.columnFilters).length > 0;
}

// =============================================================================
// Filter Record Counting (StatusBar Integration)
// =============================================================================

/**
 * Get filtered vs total record count for a specific filter.
 */
export async function getFilteredRecordCount(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
  _getCellValue?: (row: number, col: number) => WorkflowCellValue | undefined,
): Promise<{ visible: number; total: number } | null> {
  const filter = await getFilter(ctx, sheetId, filterId);
  if (!filter) return null;

  // In the CB model, record counting is derived from hidden row state.
  // Return null to signal that the status bar should query visibility directly.
  return null;
}

/**
 * Get all active filters in a sheet (filters with non-empty columnFilters).
 */
export async function getActiveFilters(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<FilterState[]> {
  const filters = await getFiltersInSheet(ctx, sheetId);
  return filters.filter((f) => Object.keys(f.columnFilters).length > 0);
}

/**
 * Get count of active column filters across all filters in a sheet.
 */
export async function getActiveFilterCount(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<number> {
  const filters = await getFiltersInSheet(ctx, sheetId);
  let count = 0;
  for (const filter of filters) {
    count += Object.keys(filter.columnFilters).length;
  }
  return count;
}

/**
 * Get filter record counts for StatusBar display.
 */
export async function getStatusBarFilterInfo(
  ctx: DocumentContext,
  sheetId: SheetId,
  _getCellValue?: (row: number, col: number) => WorkflowCellValue | undefined,
): Promise<{ visible: number; total: number; filterCount: number } | null> {
  const activeFilters = await getActiveFilters(ctx, sheetId);
  if (activeFilters.length === 0) return null;

  const filterCount = await getActiveFilterCount(ctx, sheetId);

  // In the CB model, record counting is derived from hidden row state.
  return { visible: 0, total: 0, filterCount };
}
