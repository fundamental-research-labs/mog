import type { DataRow } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartDataPoint } from '../../types';
import { isHorizontalBarType } from './axis';
import {
  categoryKeyForIndex,
  shouldUseDateSerialCategoryAxis,
  shouldUseStableCategoryKeys,
  toFiniteNumber,
} from './category-axis';
import {
  BUBBLE_SIZE_FIELD,
  CATEGORY_FIELD,
  CATEGORY_FORMAT_CODE_FIELD,
  SCATTER_X_FIELD,
  SERIES_FIELD,
  SERIES_OPACITY_FIELD,
  STOCK_CLOSE_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
  VALUE_FIELD,
} from './fields';
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
          [CATEGORY_FIELD]: rowCategory,
          [VALUE_FIELD]: point.y,
          [SERIES_FIELD]: series.name,
        };
        if (isScatterLikeChart(config)) {
          row[SCATTER_X_FIELD] = scatterXValue(point, i);
        }
        if (config?.type === 'bubble') {
          row[BUBBLE_SIZE_FIELD] = bubbleSizeValue(point);
        }
        if (config?.series?.some(isNoFillNoLineSeries)) {
          row[SERIES_OPACITY_FIELD] = isNoFillNoLineSeries(seriesConfigs[seriesIndex]) ? 0 : 1;
        }
        const categoryFormatCode = data.categoryFormatCodes?.[i];
        if (categoryFormatCode) row[CATEGORY_FORMAT_CODE_FIELD] = categoryFormatCode;
        // Propagate OHLC fields if present (for stock charts)
        if (point[STOCK_OPEN_FIELD] !== undefined) row[STOCK_OPEN_FIELD] = point[STOCK_OPEN_FIELD];
        if (point[STOCK_HIGH_FIELD] !== undefined) row[STOCK_HIGH_FIELD] = point[STOCK_HIGH_FIELD];
        if (point[STOCK_LOW_FIELD] !== undefined) row[STOCK_LOW_FIELD] = point[STOCK_LOW_FIELD];
        if (point[STOCK_CLOSE_FIELD] !== undefined) {
          row[STOCK_CLOSE_FIELD] = point[STOCK_CLOSE_FIELD];
        }
        rows.push(row);
      }
    }
  }
  return rows;
}

function isScatterLikeChart(config?: ChartConfig): boolean {
  return config?.type === 'scatter' || config?.type === 'bubble';
}

function scatterXValue(point: ChartDataPoint, pointIndex: number): number {
  return toFiniteNumber(point.x) ?? pointIndex + 1;
}

function bubbleSizeValue(point: ChartDataPoint): number {
  return toFiniteNumber(point.size) ?? 1;
}

function shouldIncludePointInRows(point: ChartDataPoint, config?: ChartConfig): boolean {
  if (!point.valueState || point.valueState === 'value') return true;
  if (point.valueState === 'blank') {
    return config?.displayBlanksAs === 'zero';
  }
  return false;
}
