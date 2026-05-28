/**
 * WorksheetFiltersImpl — Implementation of the WorksheetFilters sub-API.
 *
 * Calls computeBridge directly, no operations-layer ceremony.
 */
import type {
  AutoFilterClearReceipt,
  AutoFilterSetReceipt,
  AdvancedFilterOptions,
  AdvancedFilterResult,
  CellRange,
  FilterByColorOptions,
  FilterDetailInfo,
  FilterDropdownData,
  FilterKind,
  FilterSortState,
  FilterState,
  SheetId,
  WorksheetFilters,
} from '@mog-sdk/contracts/api';
import type { ColumnFilterCriteria, DynamicFilterRule } from '@mog-sdk/contracts/filter';
import { sheetId as toSheetId, type CellValue } from '@mog-sdk/contracts/core';
import type { FilterCriteria } from '@mog/table-engine';

import type {
  ColumnFilter as ComputeColumnFilter,
  FilterState as ComputeFilterState,
} from '../../bridges/compute/compute-types.gen';
import {
  columnFilterCriteriaToCompute,
  computeColumnFilterToCriteria,
} from '../../bridges/compute/compute-wire-converters';
import { KernelError } from '../../errors';

import type { DocumentContext } from '../../context';
import { parseCellRange, toA1 } from '../internal/utils';
import { resolveFilterRange } from './filter-range-resolution';
import {
  assertFilterMutationAllowed,
  assertNoProtectedTableFilterCreation,
} from './protected-table-operations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveAdvancedCriteriaRange(
  ctx: DocumentContext,
  filter: ComputeFilterState,
): Promise<{ startRow: number; startCol: number; endRow: number; endCol: number } | undefined> {
  const criteria = filter.advancedFilter?.criteriaRange;
  if (!criteria) return undefined;

  const [startPos, endPos] = await Promise.all([
    ctx.computeBridge.getCellPosition(toSheetId(criteria.sheetId), criteria.startCellId),
    ctx.computeBridge.getCellPosition(toSheetId(criteria.sheetId), criteria.endCellId),
  ]);
  if (!startPos || !endPos) return undefined;

  return {
    startRow: startPos.row,
    startCol: startPos.col,
    endRow: endPos.row,
    endCol: endPos.col,
  };
}

async function toFilterDetail(
  ctx: DocumentContext,
  sheetId: SheetId,
  filter: ComputeFilterState,
): Promise<FilterDetailInfo> {
  const fRange = await resolveFilterRange(ctx, sheetId, filter);
  const rawFilters = filter.columnFilters ?? {};
  const converted: Record<string, ColumnFilterCriteria> = {};
  for (const [key, cf] of Object.entries(rawFilters)) {
    converted[key] = computeColumnFilterToCriteria(cf);
  }

  const detail: FilterDetailInfo = {
    id: filter.id,
    filterKind: filter.type,
    range: fRange,
    columnFilters: converted,
  };
  if (filter.tableId) detail.tableId = filter.tableId;
  if (filter.type === 'advancedFilter') {
    detail.advancedFilter = {
      criteriaRange: await resolveAdvancedCriteriaRange(ctx, filter),
      uniqueRecordsOnly: filter.advancedFilter?.uniqueRecordsOnly ?? false,
      active: Boolean(
        filter.advancedFilter?.criteriaRange || filter.advancedFilter?.uniqueRecordsOnly,
      ),
    };
  }
  return detail;
}

const EMPTY_FILTER_DROPDOWN_DATA: FilterDropdownData = {
  items: [],
  hasBlank: false,
  blankCount: 0,
  blankSelected: true,
  totalRowCount: 0,
};

function computeFilterToTableFilter(filter: ComputeColumnFilter): FilterCriteria {
  switch (filter.type) {
    case 'values':
      return {
        type: 'values',
        included: filter.values as CellValue[],
        includeBlanks: filter.includeBlanks,
      };
    case 'condition':
      return {
        type: 'condition',
        conditions: filter.conditions.map((condition) => ({
          operator: condition.operator,
          value: condition.value ?? null,
          ...(condition.value2 !== undefined ? { value2: condition.value2 } : {}),
        })),
        logic: filter.logic,
      } as FilterCriteria;
    case 'topBottom':
      return {
        type: 'topBottom',
        direction: filter.direction,
        count: filter.count,
        by: filter.by,
      };
    case 'dynamic':
      return {
        type: 'dynamic',
        rule: filter.rule,
      };
    case 'color':
      return {
        type: 'color',
        cellColor: filter.byFont ? undefined : filter.color,
        fontColor: filter.byFont ? filter.color : undefined,
      };
    case 'icon':
      return {
        type: 'icon',
        iconSetName: filter.iconSetName,
        iconIndex: filter.iconIndex,
      } as unknown as FilterCriteria;
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}

function composeVisibility(bitmaps: Uint8Array[]): Uint8Array | null {
  if (bitmaps.length === 0) return null;
  const result = new Uint8Array(bitmaps[0]);
  for (const bitmap of bitmaps.slice(1)) {
    for (let i = 0; i < result.length; i++) {
      result[i] = result[i] === 1 && bitmap[i] === 1 ? 1 : 0;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class WorksheetFiltersImpl implements WorksheetFilters {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  /**
   * Resolve a filterId parameter: use the provided ID directly, or fall back
   * to the first auto-filter in the sheet.
   */
  private async resolveFilterId(filterId?: string): Promise<string> {
    if (filterId) return filterId;
    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    if (filters.length === 0)
      throw new KernelError('COMPUTE_ERROR', 'No auto-filter set. Call setAutoFilter() first.');
    return filters[0].id;
  }

  /** Standard alias for {@link setAutoFilter}. */
  async add(range: string | CellRange): Promise<void> {
    this._ensureWritable('filters.add');
    await this.setAutoFilter(range);
  }

  /**
   * Apply an Excel Advanced Filter.
   *
   * The compute layer owns range parsing, criteria evaluation, row visibility,
   * copy-to writes, and viewport patches. The worksheet API is the public
   * kernel contract that forwards the raw user-visible ranges and returns the
   * typed receipt emitted by Rust.
   */
  async applyAdvanced(options: AdvancedFilterOptions): Promise<AdvancedFilterResult> {
    this._ensureWritable('filters.applyAdvanced');
    const result = await this.ctx.computeBridge.applyAdvancedFilter(this.sheetId, {
      listRange: options.listRange,
      criteriaRange: options.criteriaRange ?? undefined,
      mode: options.mode,
      copyToRange: options.mode === 'copyTo' ? options.copyToRange : undefined,
      uniqueRecordsOnly: options.uniqueRecordsOnly ?? false,
      filterId: options.mode === 'inPlace' ? options.filterId : undefined,
    });
    if (!result.data || typeof result.data !== 'object') {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Advanced Filter returned no receipt: ${JSON.stringify(result.data)}`,
      );
    }
    return result.data as AdvancedFilterResult;
  }

  /**
   * Filter a column by cell or font color.
   *
   * Resolves the active filter (or the explicit `filterId`), then composes a
   * color-typed {@link ColumnFilterCriteria} and routes through
   * {@link setColumnFilter}. The wire converter forwards the `'fill' | 'font'`
   * discriminator and hex color to Rust, which evaluates the predicate per
   * row using the resolved effective format.
   */
  async byColor(col: number, opts: FilterByColorOptions): Promise<void> {
    const resolvedId = await this.resolveFilterId(opts.filterId);
    const criteria: ColumnFilterCriteria = {
      type: 'color',
      colorFilter: { type: opts.colorType, color: opts.color },
    };
    await this.setColumnFilter(col, criteria, resolvedId);
  }

  /** Standard alias for {@link getAutoFilter}. */
  async get(): Promise<FilterState | null> {
    return this.getAutoFilter();
  }

  /** Standard alias for {@link clearAutoFilter}. */
  async clear(): Promise<void> {
    await this.clearAutoFilter();
  }

  /** @deprecated Use {@link add} instead. */
  async setAutoFilter(range: string | CellRange): Promise<AutoFilterSetReceipt> {
    if (typeof range === 'string') {
      const parsed = parseCellRange(range);
      if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);
      await assertNoProtectedTableFilterCreation(this.ctx, this.sheetId, 'filters.add', parsed);

      await this.ctx.computeBridge.createFilter(this.sheetId, {
        startRow: parsed.startRow,
        startCol: parsed.startCol,
        endRow: parsed.endRow,
        endCol: parsed.endCol,
      });
      return { kind: 'autoFilterSet', range };
    } else {
      if (
        range.startRow < 0 ||
        range.startCol < 0 ||
        range.endRow < range.startRow ||
        range.endCol < range.startCol
      ) {
        throw new KernelError(
          'COMPUTE_ERROR',
          `Invalid range: (${range.startRow}, ${range.startCol}) to (${range.endRow}, ${range.endCol})`,
        );
      }

      await assertNoProtectedTableFilterCreation(this.ctx, this.sheetId, 'filters.add', range);
      await this.ctx.computeBridge.createFilter(this.sheetId, {
        startRow: range.startRow,
        startCol: range.startCol,
        endRow: range.endRow,
        endCol: range.endCol,
      });
      const rangeStr = `${toA1(range.startRow, range.startCol)}:${toA1(range.endRow, range.endCol)}`;
      return { kind: 'autoFilterSet', range: rangeStr };
    }
  }

  /** @deprecated Use {@link clear} instead. */
  async clearAutoFilter(): Promise<AutoFilterClearReceipt> {
    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    for (const filter of filters) {
      await assertFilterMutationAllowed(this.ctx, this.sheetId, 'filters.remove', filter.id);
    }
    for (const filter of filters) {
      await this.ctx.computeBridge.deleteFilter(this.sheetId, filter.id);
    }
    return { kind: 'autoFilterClear' };
  }

  /** @deprecated Use {@link get} instead. */
  async getAutoFilter(): Promise<FilterState | null> {
    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    if (filters.length === 0) return null;
    const filter = filters[0];
    const rawFilters = filter.columnFilters ?? {};
    const converted: Record<string, ColumnFilterCriteria> = {};
    for (const [key, cf] of Object.entries(rawFilters)) {
      converted[key] = computeColumnFilterToCriteria(cf);
    }
    return {
      range: `${toA1(filter.startRow ?? 0, filter.startCol ?? 0)}:${toA1(filter.endRow ?? 0, filter.endCol ?? 0)}`,
      columnFilters: converted,
    };
  }

  async getForRange(
    range: string | CellRange,
  ): Promise<{ id: string; filterKind: FilterKind } | null> {
    let resolved: CellRange;
    if (typeof range === 'string') {
      const parsed = parseCellRange(range);
      if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);
      resolved = parsed;
    } else {
      resolved = range;
    }

    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    for (const filter of filters) {
      const fRange = await resolveFilterRange(this.ctx, this.sheetId, filter);

      // Check intersection
      if (
        !(
          resolved.endRow < fRange.startRow ||
          resolved.startRow > fRange.endRow ||
          resolved.endCol < fRange.startCol ||
          resolved.startCol > fRange.endCol
        )
      ) {
        return { id: filter.id, filterKind: filter.type };
      }
    }
    return null;
  }

  async remove(filterId: string): Promise<void> {
    await assertFilterMutationAllowed(this.ctx, this.sheetId, 'filters.remove', filterId);
    await this.ctx.computeBridge.deleteFilter(this.sheetId, filterId);
  }

  async setColumnFilter(
    col: number,
    criteria: ColumnFilterCriteria,
    filterId?: string,
  ): Promise<void> {
    const resolvedId = await this.resolveFilterId(filterId);
    await assertFilterMutationAllowed(
      this.ctx,
      this.sheetId,
      'filters.setColumnFilter',
      resolvedId,
    );
    await this.ctx.computeBridge.setColumnFilter(
      this.sheetId,
      resolvedId,
      col,
      columnFilterCriteriaToCompute(criteria),
    );
    // Apply the filter so hidden-row state is actually updated.
    // The Rust mutation handlers (compute_apply_filter,
    // compute_set_column_filter) emit full-viewport-binary patches that
    // capture post-filter row visibility — Rust visibility pipeline moved the
    // viewport refresh from the kernel to the Rust patch channel.
    await this.ctx.computeBridge.applyFilter(this.sheetId, resolvedId);
  }

  async applyDynamicFilter(col: number, rule: DynamicFilterRule, filterId?: string): Promise<void> {
    const resolvedId = await this.resolveFilterId(filterId);
    await assertFilterMutationAllowed(
      this.ctx,
      this.sheetId,
      'filters.setColumnFilter',
      resolvedId,
    );

    // Date columns are stored as Excel serial numbers, so the column-filter
    // value space must be Excel serials too. Rather than re-implementing the
    // date-rule math in TypeScript (which inevitably drifts from the Rust
    // source of truth in `compute-table::filter_resolve::compute_date_range`),
    // ask the engine to resolve the rule to an inclusive serial range and
    // dispatch as a concrete `between` condition filter.
    //
    // For non-date rules (`aboveAverage`/`belowAverage`) the bridge returns
    // `null` — those rules need column data to compute a threshold and
    // remain delegated to the engine as a `dynamic` criterion.
    const serialRange = await this.ctx.computeBridge.computeDynamicFilterSerialRange(rule);

    let criteria: ColumnFilterCriteria;
    if (serialRange !== null) {
      const [start, end] = serialRange;
      criteria = {
        type: 'condition',
        conditions: [
          {
            operator: 'between',
            value: start,
            value2: end,
          },
        ],
        conditionLogic: 'and',
      };
    } else {
      criteria = {
        type: 'dynamic',
        dynamicFilter: { rule },
      };
    }

    await this.ctx.computeBridge.setColumnFilter(
      this.sheetId,
      resolvedId,
      col,
      columnFilterCriteriaToCompute(criteria),
    );
    // Apply the filter so hidden-row state is actually updated. The Rust
    // mutation handler emits a full-viewport-binary patch that includes
    // post-filter row visibility (Rust visibility pipeline).
    await this.ctx.computeBridge.applyFilter(this.sheetId, resolvedId);
  }

  async clearColumnFilter(col: number, filterId?: string): Promise<void> {
    let resolvedId: string;
    if (filterId) {
      resolvedId = filterId;
    } else {
      const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
      if (filters.length === 0) return;
      resolvedId = filters[0].id;
    }
    await assertFilterMutationAllowed(
      this.ctx,
      this.sheetId,
      'filters.clearColumnFilter',
      resolvedId,
    );
    await this.ctx.computeBridge.clearColumnFilter(this.sheetId, resolvedId, col);
  }

  async getUniqueValues(col: number, filterId?: string): Promise<any[]> {
    if (filterId) {
      return this.ctx.computeBridge.getUniqueColumnValues(this.sheetId, filterId, col);
    }
    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    if (filters.length === 0) return [];
    return this.ctx.computeBridge.getUniqueColumnValues(this.sheetId, filters[0].id, col);
  }

  async getFilterDropdownData(col: number, filterId?: string): Promise<FilterDropdownData> {
    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    const filter = filterId ? filters.find((candidate) => candidate.id === filterId) : filters[0];
    if (!filter) return EMPTY_FILTER_DROPDOWN_DATA;

    const range = await resolveFilterRange(this.ctx, this.sheetId, filter);
    if (col < range.startCol || col > range.endCol) {
      return EMPTY_FILTER_DROPDOWN_DATA;
    }

    const dataStartRow = range.startRow + 1;
    if (dataStartRow > range.endRow) {
      return EMPTY_FILTER_DROPDOWN_DATA;
    }

    const currentHeaderCellId = await this.resolveHeaderCellIdForColumn(
      filter,
      range.startRow,
      col,
    );

    const columnData = await this.readColumnData(dataStartRow, range.endRow, col);
    const currentComputeFilter = currentHeaderCellId
      ? filter.columnFilters?.[currentHeaderCellId]
      : undefined;
    const currentFilter = currentComputeFilter
      ? computeFilterToTableFilter(currentComputeFilter)
      : null;

    const otherBitmaps: Uint8Array[] = [];
    for (const [headerCellId, computeFilter] of Object.entries(filter.columnFilters ?? {})) {
      if (headerCellId === currentHeaderCellId) continue;
      const headerPos = await this.ctx.computeBridge.getCellPosition(this.sheetId, headerCellId);
      if (!headerPos) continue;
      if (headerPos.row === range.startRow && headerPos.col === col) continue;
      const otherColumnData = await this.readColumnData(dataStartRow, range.endRow, headerPos.col);
      const bitmap = await this.ctx.computeBridge.tableEvaluateColumnFilter(
        computeFilterToTableFilter(computeFilter),
        otherColumnData,
      );
      otherBitmaps.push(new Uint8Array(bitmap));
    }

    return this.ctx.computeBridge.tableBuildFilterDropdown(
      columnData,
      currentFilter,
      composeVisibility(otherBitmaps),
    );
  }

  /** @deprecated Use {@link setColumnFilter} instead. */
  async setCriteria(filterId: string, col: number, criteria: ColumnFilterCriteria): Promise<void> {
    await assertFilterMutationAllowed(this.ctx, this.sheetId, 'filters.setColumnFilter', filterId);
    await this.ctx.computeBridge.setColumnFilter(
      this.sheetId,
      filterId,
      col,
      columnFilterCriteriaToCompute(criteria),
    );
    // Apply the filter so hidden-row state is updated. Full-viewport
    // patches now flow from the Rust mutation handler (Rust visibility pipeline).
    await this.ctx.computeBridge.applyFilter(this.sheetId, filterId);
  }

  /** @deprecated Use {@link clearColumnFilter} instead. */
  async clearCriteria(filterId: string, col: number): Promise<void> {
    await assertFilterMutationAllowed(
      this.ctx,
      this.sheetId,
      'filters.clearColumnFilter',
      filterId,
    );
    await this.ctx.computeBridge.clearColumnFilter(this.sheetId, filterId, col);
    // Apply the filter so hidden-row state is updated. Full-viewport
    // patches now flow from the Rust mutation handler (Rust visibility pipeline).
    await this.ctx.computeBridge.applyFilter(this.sheetId, filterId);
  }

  async clearAllCriteria(filterId: string): Promise<void> {
    await assertFilterMutationAllowed(
      this.ctx,
      this.sheetId,
      'filters.clearAllColumnFilters',
      filterId,
    );
    await this.ctx.computeBridge.clearAllColumnFilters(this.sheetId, filterId);
  }

  async apply(filterId: string): Promise<void> {
    await assertFilterMutationAllowed(this.ctx, this.sheetId, 'filters.apply', filterId);
    await this.ctx.computeBridge.applyFilter(this.sheetId, filterId);
  }

  async getInfo(filterId: string): Promise<FilterDetailInfo | null> {
    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    const filter = filters.find((f) => f.id === filterId);
    if (!filter) return null;
    return toFilterDetail(this.ctx, this.sheetId, filter);
  }

  /** @deprecated Use {@link getUniqueValues} instead. */
  async getFilterUniqueValues(filterId: string, col: number): Promise<any[]> {
    return this.ctx.computeBridge.getUniqueColumnValues(this.sheetId, filterId, col);
  }

  async list(): Promise<FilterDetailInfo[]> {
    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    return Promise.all(filters.map((filter) => toFilterDetail(this.ctx, this.sheetId, filter)));
  }

  async isEnabled(): Promise<boolean> {
    return (await this.ctx.computeBridge.getFiltersInSheet(this.sheetId)).length > 0;
  }

  async isDataFiltered(): Promise<boolean> {
    const filters = await this.list();
    return filters.some((f) => Object.keys(f.columnFilters ?? {}).length > 0);
  }

  /** @deprecated Use list() instead. */
  async listDetails(): Promise<FilterDetailInfo[]> {
    return this.list();
  }

  async getSortState(filterId: string): Promise<FilterSortState | null> {
    try {
      const sortState = await this.ctx.computeBridge.getFilterSortState(this.sheetId, filterId);
      if (!sortState) return null;
      return {
        column: sortState.columnCellId,
        direction: sortState.order,
      };
    } catch {
      return null;
    }
  }

  async setSortState(filterId: string, state: FilterSortState): Promise<void> {
    await assertFilterMutationAllowed(this.ctx, this.sheetId, 'filters.setSortState', filterId);
    await this.ctx.computeBridge.setFilterSortState(this.sheetId, filterId, {
      columnCellId: String(state.column),
      order: state.direction,
      sortBy: 'value',
    });
  }

  private async resolveHeaderCellIdForColumn(
    filter: ComputeFilterState,
    headerRow: number,
    col: number,
  ): Promise<string | null> {
    const directCellId = await this.ctx.computeBridge.getCellIdAt(this.sheetId, headerRow, col);
    if (directCellId) return directCellId;

    for (const headerCellId of Object.keys(filter.columnFilters ?? {})) {
      const headerPos = await this.ctx.computeBridge.getCellPosition(this.sheetId, headerCellId);
      if (headerPos?.row === headerRow && headerPos.col === col) {
        return headerCellId;
      }
    }

    return null;
  }

  private async readColumnData(
    startRow: number,
    endRow: number,
    col: number,
  ): Promise<CellValue[]> {
    const values: CellValue[] = [];
    for (let row = startRow; row <= endRow; row++) {
      values.push((await this.ctx.computeBridge.getCellValue(this.sheetId, row, col)) ?? null);
    }
    return values;
  }
}
