import { HIDDEN_CHART_CELL, type CellDataAccessor } from '@mog/charts';
import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

import type { DocumentContext } from '../../../context/types';
import { getValue } from '../../cells/cell-reads';
import type { ResolvedChartRangeReferences } from '../chart-range-references';
import { isCellHidden, type HiddenCellVisibility } from './hidden-visibility';

export type CellAccessorOptions = {
  defaultSheetId?: SheetId;
  sheetAliases?: Map<string, string>;
  hiddenVisibility?: HiddenCellVisibility;
};

/**
 * Create a CellDataAccessor for the charts library.
 * Pre-fetches cell values into a map since the charts library expects sync access.
 */
export async function createCellAccessor(
  ctx: DocumentContext,
  ranges: Array<CellRange | null | undefined>,
  options?: CellAccessorOptions,
): Promise<CellDataAccessor> {
  const valueMap = new Map<string, ReturnType<CellDataAccessor['getValue']>>();
  const seen = new Set<string>();

  for (const range of ranges) {
    if (!range?.sheetId) continue;
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        const key = `${range.sheetId},${row},${col}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (isCellHidden(range.sheetId, row, col, options?.hiddenVisibility)) {
          valueMap.set(key, HIDDEN_CHART_CELL);
          continue;
        }

        const value = await getValue(ctx, toSheetId(range.sheetId), row, col);
        // CellError values are converted to null for chart data extraction.
        let chartValue: ReturnType<CellDataAccessor['getValue']>;
        if (value && typeof value === 'object' && 'type' in value) {
          chartValue = null;
        } else {
          chartValue = (value ?? null) as ReturnType<CellDataAccessor['getValue']>;
        }
        valueMap.set(key, chartValue);
      }
    }
  }

  return {
    getValue: (row: number, col: number, sheetId?: string) => {
      const resolvedSheetId = sheetId
        ? (options?.sheetAliases?.get(sheetId) ?? sheetId)
        : options?.defaultSheetId;
      if (!resolvedSheetId) return null;
      if (isCellHidden(resolvedSheetId, row, col, options?.hiddenVisibility)) {
        return HIDDEN_CHART_CELL;
      }
      return valueMap.get(`${resolvedSheetId},${row},${col}`) ?? null;
    },
  };
}

export function seriesSheetAliases(
  resolvedRanges: ResolvedChartRangeReferences,
): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const series of resolvedRanges.seriesReferences) {
    for (const reference of [series.values, series.categories, series.bubbleSizes]) {
      const parsed = reference?.ref ? parseCellRange(reference.ref) : null;
      if (parsed?.sheetName && reference?.range.sheetId) {
        aliases.set(parsed.sheetName, String(reference.range.sheetId));
      }
    }
  }
  return aliases;
}
