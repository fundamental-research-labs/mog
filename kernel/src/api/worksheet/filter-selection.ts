import type { CellRange, SheetId } from '@mog-sdk/contracts/api';

import type { FilterState as ComputeFilterState } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context';
import { resolveFilterRange, type ResolvedFilterRange } from './filter-range-resolution';

export function filterHasActiveCriteria(filter: ComputeFilterState): boolean {
  return (
    Object.keys(filter.columnFilters ?? {}).length > 0 ||
    Boolean(filter.advancedFilter?.criteriaRange || filter.advancedFilter?.uniqueRecordsOnly)
  );
}

function defaultKindRank(filter: ComputeFilterState): number {
  switch (filter.type) {
    case 'autoFilter':
      return 0;
    case 'tableFilter':
      return 1;
    case 'advancedFilter':
      return 2;
    default:
      return 3;
  }
}

function defaultCompatibilityRank(filter: ComputeFilterState): number {
  return filter.type === 'autoFilter' || filter.type === 'tableFilter' ? 0 : 1;
}

function setAutoFilterKindRank(filter: ComputeFilterState): number {
  switch (filter.type) {
    case 'autoFilter':
      return 0;
    case 'tableFilter':
      return 1;
    case 'advancedFilter':
      return 2;
    default:
      return 3;
  }
}

function stableFilterKey(filter: ComputeFilterState): string {
  return `${filter.type}:${filter.tableId ?? ''}:${filter.id}`;
}

export function compareFiltersForDefault(a: ComputeFilterState, b: ComputeFilterState): number {
  const compatibilityDelta = defaultCompatibilityRank(a) - defaultCompatibilityRank(b);
  if (compatibilityDelta !== 0) return compatibilityDelta;

  const activeDelta = Number(filterHasActiveCriteria(b)) - Number(filterHasActiveCriteria(a));
  if (activeDelta !== 0) return activeDelta;

  const kindDelta = defaultKindRank(a) - defaultKindRank(b);
  if (kindDelta !== 0) return kindDelta;

  return stableFilterKey(a).localeCompare(stableFilterKey(b));
}

function compareFiltersForSetAutoFilter(a: ComputeFilterState, b: ComputeFilterState): number {
  const kindDelta = setAutoFilterKindRank(a) - setAutoFilterKindRank(b);
  if (kindDelta !== 0) return kindDelta;

  const activeDelta = Number(filterHasActiveCriteria(b)) - Number(filterHasActiveCriteria(a));
  if (activeDelta !== 0) return activeDelta;

  return stableFilterKey(a).localeCompare(stableFilterKey(b));
}

export function selectDefaultFilter(
  filters: readonly ComputeFilterState[],
): ComputeFilterState | null {
  return [...filters].sort(compareFiltersForDefault)[0] ?? null;
}

export async function resolveDefaultFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<ComputeFilterState | null> {
  return selectDefaultFilter(await ctx.computeBridge.getFiltersInSheet(sheetId));
}

function rangesEqual(a: ResolvedFilterRange, b: CellRange): boolean {
  return (
    a.startRow === b.startRow &&
    a.startCol === b.startCol &&
    a.endRow === b.endRow &&
    a.endCol === b.endCol
  );
}

export async function findExistingFilterForRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<ComputeFilterState | null> {
  const filters = await ctx.computeBridge.getFiltersInSheet(sheetId);
  const matches: ComputeFilterState[] = [];
  for (const filter of filters) {
    if (filter.type !== 'autoFilter' && filter.type !== 'tableFilter') continue;
    const resolved = await resolveFilterRange(ctx, sheetId, filter);
    if (rangesEqual(resolved, range)) {
      matches.push(filter);
    }
  }
  return [...matches].sort(compareFiltersForSetAutoFilter)[0] ?? null;
}
