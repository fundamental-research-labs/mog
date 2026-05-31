import type { ConfigSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { dataTableRowCount } from './layers/data-table';

type LayoutHints = NonNullable<ConfigSpec['layoutHints']>;

export function dataTableLayoutHint(
  config: ChartConfig,
  data: ChartData | undefined,
): LayoutHints['dataTable'] | undefined {
  const rowCount = dataTableRowCount(config, data);
  if (rowCount === 0) return undefined;
  return {
    rowCount,
    height: Math.max(34, Math.min(160, rowCount * 18 + 8)),
  };
}
