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
  STOCK_VOLUME_FIELD,
  VALUE_FIELD,
  WATERFALL_END_FIELD,
  WATERFALL_RUNNING_TOTAL_FIELD,
  WATERFALL_TYPE_FIELD,
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
  const maxBubbleMagnitude = maxRenderableBubbleMagnitude(data, config);
  let waterfallRunningTotal = 0;
  const waterfallTotalIndices = new Set([
    ...(config?.waterfall?.totalIndices ?? []),
    ...(config?.waterfall?.subtotalIndices ?? []),
  ]);
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
          row[SCATTER_X_FIELD] = scatterXValue(point);
        }
        if (config?.type === 'bubble') {
          row[BUBBLE_SIZE_FIELD] = bubbleSizeValue(point, config, maxBubbleMagnitude);
        }
        if (config?.series?.some(isNoFillNoLineSeries)) {
          row[SERIES_OPACITY_FIELD] = isNoFillNoLineSeries(seriesConfigs[seriesIndex]) ? 0 : 1;
        }
        if (config?.type === 'waterfall') {
          const value = toFiniteNumber(point.y) ?? 0;
          const isTotal = waterfallTotalIndices.has(i);
          const end = isTotal ? value : waterfallRunningTotal + value;
          row[WATERFALL_RUNNING_TOTAL_FIELD] = end;
          row[WATERFALL_END_FIELD] = end;
          row[WATERFALL_TYPE_FIELD] = isTotal ? 'total' : value >= 0 ? 'increase' : 'decrease';
          if (seriesIndex === data.series.length - 1) {
            waterfallRunningTotal = end;
          }
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
        if (point[STOCK_VOLUME_FIELD] !== undefined) {
          row[STOCK_VOLUME_FIELD] = point[STOCK_VOLUME_FIELD];
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

function scatterXValue(point: ChartDataPoint): number {
  return toFiniteNumber(point.x)!;
}

function bubbleSizeValue(
  point: ChartDataPoint,
  config: ChartConfig,
  maxBubbleMagnitude: number,
): number {
  const rawSize = toFiniteNumber(point.size)!;
  const magnitude = Math.abs(rawSize);
  if (config.sizeRepresents === 'w' && maxBubbleMagnitude > 0) {
    return (magnitude * magnitude) / maxBubbleMagnitude;
  }
  return magnitude;
}

function shouldIncludePointInRows(point: ChartDataPoint, config?: ChartConfig): boolean {
  if (point.valueState === 'hidden') return false;
  if (isScatterLikeChart(config) && toFiniteNumber(point.x) === undefined) return false;
  if (config?.type === 'bubble') {
    const size = toFiniteNumber(point.size);
    if (size === undefined) return false;
    if (size <= 0 && config.showNegBubbles !== true) return false;
  }
  if (isScatterLikeChart(config) && point.valueState) return false;
  if (!point.valueState || point.valueState === 'value') return true;
  if (point.valueState === 'blank') {
    return config?.displayBlanksAs === 'zero';
  }
  return false;
}

function maxRenderableBubbleMagnitude(data: ChartData, config?: ChartConfig): number {
  if (config?.type !== 'bubble') return 0;
  let max = 0;
  for (const series of data.series) {
    for (const point of series.data) {
      if (!shouldBubbleSizeParticipate(point, config)) continue;
      const size = toFiniteNumber(point.size);
      if (size !== undefined) max = Math.max(max, Math.abs(size));
    }
  }
  return max;
}

function shouldBubbleSizeParticipate(point: ChartDataPoint, config: ChartConfig): boolean {
  if (point.valueState === 'hidden') return false;
  const size = toFiniteNumber(point.size);
  if (size === undefined) return false;
  return size > 0 || config.showNegBubbles === true;
}
