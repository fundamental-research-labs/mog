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
  FilterDropdownColumnType,
  FilterDropdownData,
  FilterHeaderInfoEntry,
  FilterKind,
  FilterSortState,
  FilterState,
  FilterSummaryInfo,
  SheetId,
  WorksheetFilters,
} from '@mog-sdk/contracts/api';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type { ColumnFilterCriteria, DynamicFilterRule } from '@mog-sdk/contracts/filter';
import { sheetId as toSheetId, type CellValue } from '@mog-sdk/contracts/core';
import type { FilterCriteria } from '@mog/table-engine';
import { isDateFormat } from '@mog/spreadsheet-utils/number-formats';

import type {
  ColumnFilter as ComputeColumnFilter,
  FilterHeaderInfo as ComputeFilterHeaderInfo,
  FilterState as ComputeFilterState,
  Table as ComputeTable,
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

type FilterMaterializationScope = 'sheetLocal' | 'complete';
type FilterCompactReadScope = 'available' | FilterMaterializationScope;

type FilterListOptions = {
  readonly scope?: FilterMaterializationScope;
};

type FilterCompactListOptions = {
  readonly scope?: FilterCompactReadScope;
};

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

async function toFilterSummary(
  ctx: DocumentContext,
  sheetId: SheetId,
  filter: ComputeFilterState,
  headerEntries: ComputeFilterHeaderInfo[] = [],
): Promise<FilterSummaryInfo> {
  const range = await resolveFilterRange(ctx, sheetId, filter);
  const activeColumnCount = Object.keys(filter.columnFilters ?? {}).length;
  const headerHasActiveFilter = headerEntries.some((entry) => entry.hasActiveFilter);
  const hasAdvancedFilter = Boolean(
    filter.advancedFilter?.criteriaRange || filter.advancedFilter?.uniqueRecordsOnly,
  );
  const hasActiveFilter = activeColumnCount > 0 || hasAdvancedFilter || headerHasActiveFilter;
  const capability = headerEntries.some((entry) => entry.capability === 'unsupported')
    ? 'unsupported'
    : (headerEntries.find((entry) => entry.capability)?.capability ?? 'supported');
  const unsupportedReasons = Array.from(
    new Set(headerEntries.flatMap((entry) => entry.unsupportedReasons ?? [])),
  );
  const summary: FilterSummaryInfo = {
    id: filter.id,
    filterKind: filter.type,
    range,
    activeColumnCount,
    hasActiveCriteria: hasActiveFilter,
    hasActiveFilter,
    clearable: hasActiveFilter,
    detailsReady: true,
    capability,
    unsupportedReasons,
  };
  if (filter.tableId) summary.tableId = filter.tableId;
  return summary;
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

function formatIsDateLike(format: unknown): boolean {
  if (!format || typeof format !== 'object') return false;
  const typed = format as { numberFormat?: unknown; numberFormatType?: unknown };
  if (typed.numberFormatType === 'date' || typed.numberFormatType === 'time') return true;
  return typeof typed.numberFormat === 'string' && isDateFormat(typed.numberFormat);
}

function classifyDropdownColumnType(counts: {
  number: number;
  text: number;
  date: number;
}): FilterDropdownColumnType {
  const total = counts.number + counts.text + counts.date;
  if (total === 0) return 'mixed';
  if (counts.date / total > 0.5) return 'date';
  if (counts.number / total > 0.5) return 'number';
  if (counts.text / total > 0.5) return 'text';
  return 'mixed';
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

  private async awaitSheetMaterialized(): Promise<void> {
    await this.ctx.awaitMaterialized?.(this.sheetId);
  }

  private async awaitAllMaterialized(): Promise<void> {
    await this.ctx.awaitMaterialized?.('allSheets');
  }

  private async awaitFilterListScope(
    options: { readonly scope?: FilterCompactReadScope } | undefined,
    defaultScope: FilterCompactReadScope,
    allowAvailable = false,
  ): Promise<void> {
    const scope = options?.scope ?? defaultScope;
    if (scope === 'available' && allowAvailable) {
      return;
    }
    if (scope === 'complete') {
      await this.awaitAllMaterialized();
      return;
    }
    await this.awaitSheetMaterialized();
  }

  private isTableBackedHeader(entry: ComputeFilterHeaderInfo): boolean {
    return entry.filterKind === 'tableFilter' || entry.sourceType === 'tableAutoFilter';
  }

  private isTableBackedFilter(filter: ComputeFilterState): boolean {
    return filter.type === 'tableFilter';
  }

  private async liveTableIdsForCompactFilterRead(
    filters: ComputeFilterState[],
    headerEntries: ComputeFilterHeaderInfo[],
  ): Promise<Set<string> | null> {
    const needsLiveTables =
      filters.some((filter) => this.isTableBackedFilter(filter)) ||
      headerEntries.some((entry) => this.isTableBackedHeader(entry));
    if (!needsLiveTables) return null;

    const tables = await this.ctx.computeBridge.getAllTablesInSheet(this.sheetId);
    const ids = new Set<string>();
    for (const table of tables as ComputeTable[]) {
      this.addLiveTableAlias(ids, table.id);
      this.addLiveTableAlias(ids, table.name);
      this.addLiveTableAlias(ids, table.displayName);
    }
    return ids;
  }

  private addLiveTableAlias(ids: Set<string>, value: string | undefined): void {
    if (typeof value === 'string') {
      ids.add(value);
    }
  }

  private tableIdIsLive(tableId: string | undefined, liveTableIds: Set<string> | null): boolean {
    if (liveTableIds === null) return true;
    return typeof tableId === 'string' && liveTableIds.has(tableId);
  }

  private filterIsVisibleInCompactRead(
    filter: ComputeFilterState,
    liveTableIds: Set<string> | null,
  ): boolean {
    if (!this.isTableBackedFilter(filter)) return true;
    return this.tableIdIsLive(filter.tableId, liveTableIds);
  }

  private headerIsVisibleInCompactRead(
    entry: ComputeFilterHeaderInfo,
    liveTableIds: Set<string> | null,
  ): boolean {
    if (!this.isTableBackedHeader(entry)) return true;
    return this.tableIdIsLive(entry.tableId, liveTableIds);
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
    await this.awaitAllMaterialized();
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
    await this.awaitAllMaterialized();
    const resolvedId = await this.resolveFilterId(opts.filterId);
    const criteria: ColumnFilterCriteria = {
      type: 'color',
      colorFilter: { type: opts.colorType, color: opts.color },
    };
    await this.setColumnFilter(col, criteria, resolvedId);
    await this.apply(resolvedId);
  }

  /** Standard alias for {@link getAutoFilter}. */
  async get(): Promise<FilterState | null> {
    await this.awaitSheetMaterialized();
    return this.getAutoFilter();
  }

  /** Standard alias for {@link clearAutoFilter}. */
  async clear(): Promise<void> {
    await this.clearAutoFilter();
  }

  /** @deprecated Use {@link add} instead. */
  async setAutoFilter(range: string | CellRange): Promise<AutoFilterSetReceipt> {
    await this.awaitAllMaterialized();
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
    await this.awaitAllMaterialized();
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
    await this.awaitSheetMaterialized();
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
    await this.awaitSheetMaterialized();
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
    await this.awaitAllMaterialized();
    await assertFilterMutationAllowed(this.ctx, this.sheetId, 'filters.remove', filterId);
    await this.ctx.computeBridge.deleteFilter(this.sheetId, filterId);
  }

  async setColumnFilter(
    col: number,
    criteria: ColumnFilterCriteria,
    filterId?: string,
  ): Promise<void> {
    await this.awaitAllMaterialized();
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
  }

  async applyDynamicFilter(col: number, rule: DynamicFilterRule, filterId?: string): Promise<void> {
    await this.awaitAllMaterialized();
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
  }

  async clearColumnFilter(col: number, filterId?: string): Promise<void> {
    await this.awaitAllMaterialized();
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
    await this.awaitSheetMaterialized();
    if (filterId) {
      return this.ctx.computeBridge.getUniqueColumnValues(this.sheetId, filterId, col);
    }
    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    if (filters.length === 0) return [];
    return this.ctx.computeBridge.getUniqueColumnValues(this.sheetId, filters[0].id, col);
  }

  async getFilterDropdownData(col: number, filterId?: string): Promise<FilterDropdownData> {
    await this.awaitSheetMaterialized();
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

    const { values: columnData, columnType } = await this.readColumnDataWithType(
      dataStartRow,
      range.endRow,
      col,
    );
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

    const dropdownData = await this.ctx.computeBridge.tableBuildFilterDropdown(
      columnData,
      currentFilter,
      composeVisibility(otherBitmaps),
    );
    const headerInfo = await this.headerInfoForColumn(filter.id, range.startRow, col);
    const unsupportedPreserved = headerInfo?.capability === 'unsupported';
    return {
      ...dropdownData,
      columnType,
      ...(unsupportedPreserved ? { unsupportedPreserved: true } : {}),
      ...(headerInfo?.unsupportedReasons?.length
        ? { unsupportedReasons: headerInfo.unsupportedReasons }
        : {}),
    };
  }

  /** @deprecated Use {@link setColumnFilter} instead. */
  async setCriteria(filterId: string, col: number, criteria: ColumnFilterCriteria): Promise<void> {
    await this.awaitAllMaterialized();
    await assertFilterMutationAllowed(this.ctx, this.sheetId, 'filters.setColumnFilter', filterId);
    await this.ctx.computeBridge.setColumnFilter(
      this.sheetId,
      filterId,
      col,
      columnFilterCriteriaToCompute(criteria),
    );
  }

  /** @deprecated Use {@link clearColumnFilter} instead. */
  async clearCriteria(filterId: string, col: number): Promise<void> {
    await this.awaitAllMaterialized();
    await assertFilterMutationAllowed(
      this.ctx,
      this.sheetId,
      'filters.clearColumnFilter',
      filterId,
    );
    await this.ctx.computeBridge.clearColumnFilter(this.sheetId, filterId, col);
  }

  async clearAllCriteria(filterId: string): Promise<void> {
    await this.awaitAllMaterialized();
    await assertFilterMutationAllowed(
      this.ctx,
      this.sheetId,
      'filters.clearAllColumnFilters',
      filterId,
    );
    await this.ctx.computeBridge.clearAllColumnFilters(this.sheetId, filterId);
  }

  async apply(filterId: string): Promise<void> {
    await this.awaitAllMaterialized();
    await assertFilterMutationAllowed(this.ctx, this.sheetId, 'filters.apply', filterId);
    await this.ctx.computeBridge.applyFilter(this.sheetId, filterId);
  }

  async reapply(filterId: string): Promise<void> {
    await this.awaitAllMaterialized();
    await assertFilterMutationAllowed(this.ctx, this.sheetId, 'filters.reapply', filterId);
    await this.ctx.computeBridge.reapplyFilter(this.sheetId, filterId);
  }

  async getInfo(filterId: string, options?: FilterListOptions): Promise<FilterDetailInfo | null> {
    await this.awaitFilterListScope(options, 'complete');
    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    const filter = filters.find((f) => f.id === filterId);
    if (!filter) return null;
    return toFilterDetail(this.ctx, this.sheetId, filter);
  }

  /** @deprecated Use {@link getUniqueValues} instead. */
  async getFilterUniqueValues(filterId: string, col: number): Promise<any[]> {
    await this.awaitSheetMaterialized();
    return this.ctx.computeBridge.getUniqueColumnValues(this.sheetId, filterId, col);
  }

  async list(options?: FilterListOptions): Promise<FilterDetailInfo[]> {
    await this.awaitFilterListScope(options, 'complete');
    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    return Promise.all(filters.map((filter) => toFilterDetail(this.ctx, this.sheetId, filter)));
  }

  async listSummaries(options?: FilterCompactListOptions): Promise<FilterSummaryInfo[]> {
    await this.awaitFilterListScope(options, 'sheetLocal', true);
    const [filters, headerEntries] = await Promise.all([
      this.ctx.computeBridge.getFiltersInSheet(this.sheetId),
      this.ctx.computeBridge.getFilterHeaderInfo(this.sheetId),
    ]);
    const liveTableIds = await this.liveTableIdsForCompactFilterRead(filters, headerEntries);
    const visibleHeaderEntries = headerEntries.filter((entry) =>
      this.headerIsVisibleInCompactRead(entry, liveTableIds),
    );
    const headerEntriesByFilterId = new Map<string, ComputeFilterHeaderInfo[]>();
    for (const entry of visibleHeaderEntries) {
      const entries = headerEntriesByFilterId.get(entry.filterId) ?? [];
      entries.push(entry);
      headerEntriesByFilterId.set(entry.filterId, entries);
    }
    return Promise.all(
      filters
        .filter((filter) => this.filterIsVisibleInCompactRead(filter, liveTableIds))
        .map((filter) =>
          toFilterSummary(this.ctx, this.sheetId, filter, headerEntriesByFilterId.get(filter.id)),
        ),
    );
  }

  async listHeaderInfo(options?: FilterCompactListOptions): Promise<FilterHeaderInfoEntry[]> {
    await this.awaitFilterListScope(options, 'sheetLocal', true);
    const entries = await this.ctx.computeBridge.getFilterHeaderInfo(this.sheetId);
    const liveTableIds = await this.liveTableIdsForCompactFilterRead([], entries);
    return entries
      .filter((entry) => this.headerIsVisibleInCompactRead(entry, liveTableIds))
      .map((entry) => {
        const mapped: FilterHeaderInfoEntry = {
          row: entry.row,
          col: entry.col,
          filterId: entry.filterId,
          filterKind: entry.filterKind,
          range: entry.range,
          headerCellId: toCellId(entry.headerCellId),
          hasActiveFilter: entry.hasActiveFilter,
          sourceType: entry.sourceType,
          capability: entry.capability,
          unsupportedReasons: entry.unsupportedReasons,
          buttonVisible: entry.buttonVisible,
          hiddenButton: entry.hiddenButton,
          showButton: entry.showButton,
        };
        if (entry.tableId) mapped.tableId = entry.tableId;
        return mapped;
      });
  }

  async isEnabled(): Promise<boolean> {
    await this.awaitSheetMaterialized();
    return (await this.ctx.computeBridge.getFiltersInSheet(this.sheetId)).length > 0;
  }

  async isDataFiltered(): Promise<boolean> {
    const filters = await this.listSummaries();
    return filters.some((filter) => {
      const activeColumnCount = filter.activeColumnCount ?? 0;
      return filter.hasActiveFilter ?? filter.hasActiveCriteria ?? activeColumnCount > 0;
    });
  }

  /** @deprecated Use list() instead. */
  async listDetails(): Promise<FilterDetailInfo[]> {
    return this.list();
  }

  async getSortState(filterId: string): Promise<FilterSortState | null> {
    await this.awaitSheetMaterialized();
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
    await this.awaitAllMaterialized();
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

  private async readColumnDataWithType(
    startRow: number,
    endRow: number,
    col: number,
  ): Promise<{ values: CellValue[]; columnType: FilterDropdownColumnType }> {
    const values: CellValue[] = [];
    const counts = { number: 0, text: 0, date: 0 };

    for (let row = startRow; row <= endRow; row++) {
      const value = (await this.ctx.computeBridge.getCellValue(this.sheetId, row, col)) ?? null;
      values.push(value);

      if (value === null || value === undefined || value === '') continue;

      if (typeof value === 'number') {
        const format = await this.ctx.computeBridge.getResolvedFormat(this.sheetId, row, col);
        if (formatIsDateLike(format)) {
          counts.date++;
        } else {
          counts.number++;
        }
        continue;
      }

      counts.text++;
    }

    return { values, columnType: classifyDropdownColumnType(counts) };
  }

  private async headerInfoForColumn(
    filterId: string,
    headerRow: number,
    col: number,
  ): Promise<ComputeFilterHeaderInfo | undefined> {
    const entries = await this.ctx.computeBridge.getFilterHeaderInfo(this.sheetId);
    return entries.find(
      (entry) => entry.filterId === filterId && entry.row === headerRow && entry.col === col,
    );
  }
}
