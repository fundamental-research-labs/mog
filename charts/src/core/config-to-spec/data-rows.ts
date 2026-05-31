import type { DataRow } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { isHorizontalBarType } from './axis';
import {
  categoryKeyForIndex,
  shouldUseDateSerialCategoryAxis,
  shouldUseStableCategoryKeys,
  toFiniteNumber,
} from './category-axis';
import {
  BLANK_VALUE_FIELD,
  BUBBLE_SIZE_FIELD,
  CATEGORY_FIELD,
  CATEGORY_FORMAT_CODE_FIELD,
  POINT_INDEX_FIELD,
  RAW_BUBBLE_SIZE_FIELD,
  RAW_CATEGORY_FIELD,
  RAW_VALUE_FIELD,
  SCATTER_X_FIELD,
  SERIES_FIELD,
  SERIES_INDEX_FIELD,
  SOURCE_SERIES_INDEX_FIELD,
  SOURCE_SERIES_KEY_FIELD,
  LINE_SEGMENT_FIELD,
  SERIES_ORDER_FIELD,
  SERIES_OPACITY_FIELD,
  STOCK_CLOSE_FIELD,
  STOCK_DIRECTION_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
  STOCK_VOLUME_FIELD,
  VALUE_FIELD,
  WATERFALL_END_FIELD,
  WATERFALL_RUNNING_TOTAL_FIELD,
  WATERFALL_START_FIELD,
  WATERFALL_TYPE_FIELD,
} from './fields';
import {
  bubbleSizeValue,
  isBubbleSeries,
  isQuantitativeXSeries,
  maxRenderableBubbleMagnitude,
  scatterXValue,
  shouldBreakScatterLineAtPoint,
  shouldEmitBlankRow,
  shouldIncludePointInRows,
} from './data-point-values';
import { applyMarker, applyPointStyle, applySeriesVisualStyle } from './data-row-style';
import {
  applyDataLabel,
  buildPieLabelGeometries,
  percentageForValue,
  seriesTotal,
  type PieLabelGeometry,
} from './data-label-rows';
import { applyErrorBars } from './error-bar-rows';
import { isNoFillNoLineSeries } from './style';
import type { PointFormat, SeriesConfig } from '../../types';
import {
  seriesConfigForDataSeries,
  seriesOrderForDataSeries,
  seriesSourceIndex,
  seriesSourceKey,
} from '../series-identity';

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
  const totalsBySeries = data.series.map((series) => seriesTotal(series.data));
  const pieLabelGeometries = buildPieLabelGeometries(data, config);
  const gapSegmentsBySeries = data.series.map(() => 0);
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
      const seriesConfig = seriesConfigForDataSeries(series, seriesConfigs, seriesIndex);
      const isQuantitativeX = isQuantitativeXSeries(config, seriesConfig);
      const sourceSeriesIndex = seriesSourceIndex(series, seriesIndex);
      const point = series.data[i];
      if (shouldBreakScatterLineAtPoint(point, config, seriesConfig)) {
        gapSegmentsBySeries[seriesIndex] += 1;
        continue;
      }
      if (shouldEmitBlankRow(point, config, seriesConfig)) {
        const row = buildBaseRow({
          rawCategory,
          rowCategory,
          seriesName: series.name,
          pointIndex: i,
          seriesIndex,
          sourceSeriesIndex,
          sourceSeriesKey: seriesSourceKey(series, seriesIndex),
          seriesOrder: seriesOrderForDataSeries(series, seriesConfig, seriesIndex),
        });
        row[BLANK_VALUE_FIELD] = true;
        applyCategoryFormat(row, data.categoryFormatCodes?.[i]);
        rows.push(row);
        if (config?.displayBlanksAs === 'gap') {
          gapSegmentsBySeries[seriesIndex] += 1;
        }
        continue;
      }
      if (point && shouldIncludePointInRows(point, config, seriesConfig)) {
        const row = buildBaseRow({
          rawCategory,
          rowCategory,
          seriesName: series.name,
          pointIndex: i,
          seriesIndex,
          sourceSeriesIndex,
          sourceSeriesKey: seriesSourceKey(series, seriesIndex),
          seriesOrder: seriesOrderForDataSeries(series, seriesConfig, seriesIndex),
          value: point.y,
        });
        if (config?.displayBlanksAs === 'gap') {
          row[LINE_SEGMENT_FIELD] = gapSegmentsBySeries[seriesIndex];
        }
        if (isQuantitativeX) {
          row[SCATTER_X_FIELD] = scatterXValue(point);
        }
        if (isBubbleSeries(config, seriesConfig)) {
          row[BUBBLE_SIZE_FIELD] = bubbleSizeValue(point, config, maxBubbleMagnitude);
          row[RAW_BUBBLE_SIZE_FIELD] = point.size;
        }
        if (config?.series?.some(isNoFillNoLineSeries)) {
          row[SERIES_OPACITY_FIELD] = isNoFillNoLineSeries(seriesConfig) ? 0 : 1;
        }
        applyPointAnnotations(row, {
          config,
          seriesConfig,
          seriesName: series.name,
          seriesIndex,
          sourceSeriesIndex,
          pointIndex: i,
          category: rawCategory,
          value: point.y,
          xValue: isQuantitativeX ? scatterXValue(point) : undefined,
          bubbleSize: point.size,
          percentage: percentageForValue(point.y, totalsBySeries[seriesIndex]),
          pieLabelGeometry: pieLabelGeometries[seriesIndex]?.[i],
          seriesValues: series.data.map((item) => item?.y),
        });
        applySeriesVisualStyle(row, config, seriesConfig, sourceSeriesIndex);
        if (config?.type === 'waterfall') {
          const value = toFiniteNumber(point.y) ?? 0;
          const isTotal = waterfallTotalIndices.has(i);
          const start = isTotal ? 0 : waterfallRunningTotal;
          const end = isTotal ? value : waterfallRunningTotal + value;
          row[WATERFALL_START_FIELD] = start;
          row[WATERFALL_RUNNING_TOTAL_FIELD] = end;
          row[WATERFALL_END_FIELD] = end;
          row[WATERFALL_TYPE_FIELD] = isTotal ? 'total' : value >= 0 ? 'increase' : 'decrease';
          if (seriesIndex === data.series.length - 1) {
            waterfallRunningTotal = end;
          }
        }
        applyCategoryFormat(row, data.categoryFormatCodes?.[i]);
        // Propagate OHLC fields if present (for stock charts)
        if (point[STOCK_OPEN_FIELD] !== undefined) row[STOCK_OPEN_FIELD] = point[STOCK_OPEN_FIELD];
        if (point[STOCK_HIGH_FIELD] !== undefined) row[STOCK_HIGH_FIELD] = point[STOCK_HIGH_FIELD];
        if (point[STOCK_LOW_FIELD] !== undefined) row[STOCK_LOW_FIELD] = point[STOCK_LOW_FIELD];
        if (point[STOCK_CLOSE_FIELD] !== undefined) {
          row[STOCK_CLOSE_FIELD] = point[STOCK_CLOSE_FIELD];
        }
        const stockOpen = toFiniteNumber(point[STOCK_OPEN_FIELD]);
        const stockClose = toFiniteNumber(point[STOCK_CLOSE_FIELD]);
        if (stockOpen !== undefined && stockClose !== undefined) {
          row[STOCK_DIRECTION_FIELD] = stockClose >= stockOpen ? 'up' : 'down';
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

function buildBaseRow(input: {
  rawCategory: string | number;
  rowCategory: string | number;
  seriesName: string;
  pointIndex: number;
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  seriesOrder: number;
  value?: number;
}): DataRow {
  const row: DataRow = {
    [CATEGORY_FIELD]: input.rowCategory,
    [SERIES_FIELD]: input.seriesName,
    [POINT_INDEX_FIELD]: input.pointIndex,
    [SERIES_INDEX_FIELD]: input.seriesIndex,
    [SOURCE_SERIES_INDEX_FIELD]: input.sourceSeriesIndex,
    [SOURCE_SERIES_KEY_FIELD]: input.sourceSeriesKey,
    [SERIES_ORDER_FIELD]: input.seriesOrder,
    [RAW_CATEGORY_FIELD]: input.rawCategory,
  };
  if (input.value !== undefined) {
    row[VALUE_FIELD] = input.value;
    row[RAW_VALUE_FIELD] = input.value;
  }
  return row;
}

function applyCategoryFormat(row: DataRow, categoryFormatCode: string | null | undefined): void {
  if (categoryFormatCode) row[CATEGORY_FORMAT_CODE_FIELD] = categoryFormatCode;
}

function applyPointAnnotations(
  row: DataRow,
  context: {
    config?: ChartConfig;
    seriesConfig?: SeriesConfig;
    seriesName: string;
    seriesIndex: number;
    sourceSeriesIndex: number;
    pointIndex: number;
    category: string | number;
    value: number;
    xValue?: number;
    bubbleSize?: number;
    percentage?: number;
    pieLabelGeometry?: PieLabelGeometry;
    seriesValues: Array<number | undefined>;
  },
): void {
  const { config, seriesConfig, pointIndex } = context;
  const pointFormat = seriesConfig?.points?.find((point) => point.idx === pointIndex);
  applyPointStyle(row, config, seriesConfig, context.sourceSeriesIndex, pointFormat);
  applyMarker(row, config, seriesConfig, context.sourceSeriesIndex, pointFormat);
  applyDataLabel(row, context, pointFormat);
  applyErrorBars(row, context);
}
