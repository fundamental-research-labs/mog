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
  ERROR_BAR_STROKE_FIELD,
  ERROR_BAR_STROKE_WIDTH_FIELD,
  ERROR_BAR_VISIBLE_FIELD,
  ERROR_BAR_X_MAX_CAP_VISIBLE_FIELD,
  ERROR_BAR_X_MAX_FIELD,
  ERROR_BAR_X_MIN_CAP_VISIBLE_FIELD,
  ERROR_BAR_X_MIN_FIELD,
  ERROR_BAR_Y_MAX_CAP_VISIBLE_FIELD,
  ERROR_BAR_Y_MAX_FIELD,
  ERROR_BAR_Y_MIN_CAP_VISIBLE_FIELD,
  ERROR_BAR_Y_MIN_FIELD,
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
import { applyMarker, applyPointStyle, applySeriesVisualStyle, lineColor } from './data-row-style';
import {
  applyDataLabel,
  buildPieLabelGeometries,
  percentageForValue,
  seriesTotal,
  type PieLabelGeometry,
} from './data-label-rows';
import { isNoFillNoLineSeries } from './style';
import { resolverContextFromConfig } from '../style-resolver';
import { linePointsToCanvasPx } from './units';
import type { ErrorBarConfig, PointFormat, SeriesConfig } from '../../types';
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

function applyErrorBars(
  row: DataRow,
  context: {
    config?: ChartConfig;
    seriesConfig?: SeriesConfig;
    sourceSeriesIndex: number;
    pointIndex: number;
    value: number;
    xValue?: number;
    seriesValues: Array<number | undefined>;
  },
): void {
  const bars = [
    {
      config: context.seriesConfig?.errorBars,
      fallbackDirection: defaultErrorBarDirection(context.config),
    },
    { config: context.seriesConfig?.xErrorBars, fallbackDirection: 'x' as const },
    { config: context.seriesConfig?.yErrorBars, fallbackDirection: 'y' as const },
  ].filter((entry): entry is { config: ErrorBarConfig; fallbackDirection: 'x' | 'y' } =>
    Boolean(entry.config),
  );
  if (bars.length === 0) return;

  for (const { config: bar, fallbackDirection } of bars) {
    if (bar.visible === false) continue;
    const direction = normalizedErrorBarDirection(bar.direction, fallbackDirection);
    const baseValue = direction === 'x' ? (context.xValue ?? context.value) : context.value;
    const extent = errorBarExtent(bar, { ...context, baseValue });
    if (!extent) continue;
    row[ERROR_BAR_VISIBLE_FIELD] = true;
    if (direction === 'x') {
      if (extent.minus !== undefined) {
        row[ERROR_BAR_X_MIN_FIELD] = extent.minus;
        if (!bar.noEndCap) row[ERROR_BAR_X_MIN_CAP_VISIBLE_FIELD] = true;
      }
      if (extent.plus !== undefined) {
        row[ERROR_BAR_X_MAX_FIELD] = extent.plus;
        if (!bar.noEndCap) row[ERROR_BAR_X_MAX_CAP_VISIBLE_FIELD] = true;
      }
      if (extent.minus !== undefined && extent.plus === undefined)
        row[ERROR_BAR_X_MAX_FIELD] = baseValue;
      if (extent.plus !== undefined && extent.minus === undefined)
        row[ERROR_BAR_X_MIN_FIELD] = baseValue;
    } else {
      if (extent.minus !== undefined) {
        row[ERROR_BAR_Y_MIN_FIELD] = extent.minus;
        if (!bar.noEndCap) row[ERROR_BAR_Y_MIN_CAP_VISIBLE_FIELD] = true;
      }
      if (extent.plus !== undefined) {
        row[ERROR_BAR_Y_MAX_FIELD] = extent.plus;
        if (!bar.noEndCap) row[ERROR_BAR_Y_MAX_CAP_VISIBLE_FIELD] = true;
      }
      if (extent.minus !== undefined && extent.plus === undefined)
        row[ERROR_BAR_Y_MAX_FIELD] = baseValue;
      if (extent.plus !== undefined && extent.minus === undefined)
        row[ERROR_BAR_Y_MIN_FIELD] = baseValue;
    }
    const ownerKey = errorBarsOwnerKey(context.sourceSeriesIndex, direction);
    const resolverContext = context.config
      ? resolverContextFromConfig(context.config, ownerKey)
      : {};
    const stroke = lineColor(bar.lineFormat, resolverContext);
    const strokeWidth = linePointsToCanvasPx(bar.lineFormat?.width);
    if (stroke) row[ERROR_BAR_STROKE_FIELD] = stroke;
    if (strokeWidth !== undefined) row[ERROR_BAR_STROKE_WIDTH_FIELD] = strokeWidth;
  }
}

function defaultErrorBarDirection(config?: ChartConfig): 'x' | 'y' {
  return config && isHorizontalBarType(config.type) ? 'x' : 'y';
}

function normalizedErrorBarDirection(
  direction: string | undefined,
  fallback: 'x' | 'y',
): 'x' | 'y' {
  return direction === 'x' ? 'x' : direction === 'y' ? 'y' : fallback;
}

function errorBarExtent(
  bar: ErrorBarConfig,
  context: { pointIndex: number; baseValue: number; seriesValues: Array<number | undefined> },
): { plus?: number; minus?: number } | undefined {
  const type = bar.valueType ?? 'fixedVal';
  const custom = type === 'cust' || type === 'custom' || bar.plusSource || bar.minusSource;
  const plusDelta = custom
    ? customErrorDelta(bar.plusSource, context.pointIndex)
    : baseErrorDelta(type, bar, context);
  const minusDelta = custom
    ? customErrorDelta(bar.minusSource, context.pointIndex)
    : baseErrorDelta(type, bar, context);
  const plus =
    bar.barType === 'minus' || plusDelta === undefined ? undefined : context.baseValue + plusDelta;
  const minus =
    bar.barType === 'plus' || minusDelta === undefined ? undefined : context.baseValue - minusDelta;
  return plus === undefined && minus === undefined ? undefined : { plus, minus };
}

function baseErrorDelta(
  type: string,
  bar: ErrorBarConfig,
  context: { baseValue: number; seriesValues: Array<number | undefined> },
): number {
  const value = bar.value ?? 1;
  if (type === 'percentage' || type === 'percentageValue')
    return (Math.abs(context.baseValue) * value) / 100;
  if (type === 'stdDev') return sampleStdDev(context.seriesValues) * value;
  if (type === 'stdErr')
    return (
      (sampleStdDev(context.seriesValues) / Math.sqrt(validNumbers(context.seriesValues).length)) *
      value
    );
  return value;
}

function customErrorDelta(
  source: ErrorBarConfig['plusSource'],
  pointIndex: number,
): number | undefined {
  const raw = source?.cache?.points.find((point) => point.idx === pointIndex)?.value;
  const value = raw === undefined ? undefined : Number(raw);
  return value !== undefined && Number.isFinite(value) ? Math.abs(value) : undefined;
}

function sampleStdDev(values: Array<number | undefined>): number {
  const nums = validNumbers(values);
  if (nums.length < 2) return 0;
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  const variance = nums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function validNumbers(values: Array<number | undefined>): number[] {
  return values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
}

function errorBarsOwnerKey(sourceSeriesIndex: number, axis: 'x' | 'y'): string {
  return `errorBars(seriesIdx=${sourceSeriesIndex},axis=${axis})`;
}
