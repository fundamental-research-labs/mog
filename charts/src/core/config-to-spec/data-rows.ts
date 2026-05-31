import type { DataRow } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartDataPoint } from '../../types';
import {
  categoryKeyForIndex,
  isHorizontalBarType,
  shouldUseDateSerialCategoryAxis,
  shouldUseStableCategoryKeys,
  toFiniteNumber,
} from './axis';
import { SERIES_OPACITY_FIELD } from './constants';
import { isNoFillNoLineSeries } from './series-style';

/**
 * Convert ChartData (categories + series) to flat DataRow[] for the grammar.
 * Each row gets { category, value, series } fields.
 *
 * For stock charts with OHLC data, we also emit open/high/low/close fields
 * from the data point's extra properties when available.
 */
export function chartDataToRows(data: ChartData, config?: ChartConfig): DataRow[] {
  const rows: DataRow[] = [];
  const categories = data.categories ?? [];
  const useExcelDateSerialCategories = config
    ? shouldUseDateSerialCategoryAxis(config, data, isHorizontalBarType(config.type))
    : false;
  const useStableCategoryKeys = shouldUseStableCategoryKeys(
    config,
    data,
    useExcelDateSerialCategories,
  );
  const seriesConfigs = config?.series ?? [];
  for (let i = 0; i < categories.length; i++) {
    const rawCategory = categories[i];
    const category = useExcelDateSerialCategories ? toFiniteNumber(rawCategory) : undefined;
    const rowCategory = useStableCategoryKeys
      ? categoryKeyForIndex(i)
      : (category ?? String(rawCategory));
    for (let seriesIndex = 0; seriesIndex < data.series.length; seriesIndex += 1) {
      const series = data.series[seriesIndex];
      const point = series.data[i];
      if (point && shouldIncludePointInRows(point, config)) {
        const row: DataRow = {
          category: rowCategory,
          value: point.y,
          series: series.name,
        };
        if (config?.series?.some(isNoFillNoLineSeries)) {
          row[SERIES_OPACITY_FIELD] = isNoFillNoLineSeries(seriesConfigs[seriesIndex]) ? 0 : 1;
        }
        const categoryFormatCode = data.categoryFormatCodes?.[i];
        if (categoryFormatCode) row.categoryFormatCode = categoryFormatCode;
        // Propagate OHLC fields if present (for stock charts)
        if (point.open !== undefined) row.open = point.open;
        if (point.high !== undefined) row.high = point.high;
        if (point.low !== undefined) row.low = point.low;
        if (point.close !== undefined) row.close = point.close;
        rows.push(row);
      }
    }
  }
  return rows;
}

function shouldIncludePointInRows(point: ChartDataPoint, config?: ChartConfig): boolean {
  if (!point.valueState || point.valueState === 'value') return true;
  if (point.valueState === 'blank') {
    return config?.displayBlanksAs === 'zero';
  }
  return false;
}
