import type { DataRow } from '../../grammar/spec';
import type { ChartConfig } from '../../types';
import { toFiniteNumber } from './category-axis';
import {
  WATERFALL_END_FIELD,
  WATERFALL_RUNNING_TOTAL_FIELD,
  WATERFALL_START_FIELD,
  WATERFALL_TYPE_FIELD,
} from './fields';

export function waterfallTotalIndices(config: ChartConfig | undefined): Set<number> {
  return new Set([
    ...(config?.waterfall?.totalIndices ?? []),
    ...(config?.waterfall?.subtotalIndices ?? []),
  ]);
}

export function applyWaterfallFields(input: {
  row: DataRow;
  value: number;
  pointIndex: number;
  runningTotal: number;
  totalIndices: ReadonlySet<number>;
}): number {
  const value = toFiniteNumber(input.value) ?? 0;
  const isTotal = input.totalIndices.has(input.pointIndex);
  const start = isTotal ? 0 : input.runningTotal;
  const end = isTotal ? value : input.runningTotal + value;
  input.row[WATERFALL_START_FIELD] = start;
  input.row[WATERFALL_RUNNING_TOTAL_FIELD] = end;
  input.row[WATERFALL_END_FIELD] = end;
  input.row[WATERFALL_TYPE_FIELD] = isTotal ? 'total' : value >= 0 ? 'increase' : 'decrease';
  return end;
}
