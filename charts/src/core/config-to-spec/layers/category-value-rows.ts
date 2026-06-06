import type { DataRow } from '../../../grammar/spec';
import { CATEGORY_FIELD, SERIES_FIELD, SERIES_INDEX_FIELD, VALUE_FIELD } from '../fields';

export function categoryValueRows(rows: DataRow[]): DataRow[] {
  const positiveRows = rows.filter((row) => positiveValue(row) > 0);
  const firstSeriesRows = positiveRows.filter((row) => seriesIndex(row) === 0);
  if (firstSeriesRows.length > 1) return firstSeriesRows;

  const distinctSeriesIndexes = new Set(
    positiveRows
      .map((row) => seriesIndex(row))
      .filter((value): value is number => value !== undefined),
  );
  const distinctCategories = new Set(
    positiveRows.map((row) => String(row[CATEGORY_FIELD] ?? '')),
  );
  const isOnePointPerSeries =
    positiveRows.length > 1 &&
    distinctSeriesIndexes.size === positiveRows.length &&
    distinctCategories.size <= 1;

  if (!isOnePointPerSeries) {
    return firstSeriesRows.length > 0 ? firstSeriesRows : positiveRows;
  }

  return positiveRows.map((row) => {
    const seriesName = row[SERIES_FIELD];
    const category =
      typeof seriesName === 'string' && seriesName.trim().length > 0
        ? seriesName
        : row[CATEGORY_FIELD];
    return { ...row, [CATEGORY_FIELD]: category };
  });
}

export function positiveValue(row: DataRow): number {
  const value = row[VALUE_FIELD];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function seriesIndex(row: DataRow): number | undefined {
  const value = row[SERIES_INDEX_FIELD];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
