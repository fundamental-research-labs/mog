import type { DataRow } from '../../grammar/spec';
import type {
  ChartConfig,
  ChartData,
  ChartDataPointValueState,
  ChartType,
  PointFormat,
} from '../../types';
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
  CLIP_TO_PLOT_AREA_FIELD,
  PIE_POINT_KEY_FIELD,
  POINT_INDEX_FIELD,
  RAW_BUBBLE_SIZE_FIELD,
  SCATTER_X_FIELD,
  LINE_SEGMENT_FIELD,
  SERIES_OPACITY_FIELD,
  SOURCE_BLANK_FIELD,
  VALUE_FIELD,
} from './fields';
import {
  bubbleSizeValue,
  effectiveBlankPolicyForRows,
  isBubbleSeries,
  isQuantitativeXSeries,
  maxRenderableBubbleMagnitude,
  scatterXValue,
  renderedPointValueForRows,
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
import type { SeriesConfig } from '../../types';
import {
  seriesConfigForDataSeries,
  seriesOrderForDataSeries,
  seriesSourceIndex,
  seriesSourceKey,
} from '../series-identity';
import { applyCategoryFormat, buildBaseRow } from './data-row-base';
import { applyStockFields } from './data-row-stock';
import { applyWaterfallFields, waterfallTotalIndices } from './data-row-waterfall';
import { isSupportedChartType, resolveComboSeriesType } from './layers/combo-series-options';
import { piePointKey } from './pie-doughnut-geometry';
import { isPieLikeChartType } from './pie-like';

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
  const blankPolicy = effectiveBlankPolicyForRows(config);
  const gapSegmentsBySeries = data.series.map(() => 0);
  let waterfallRunningTotal = 0;
  const totalWaterfallIndices = waterfallTotalIndices(config);
  const rowCount = Math.max(categories.length, ...data.series.map((series) => series.data.length));
  for (let i = 0; i < rowCount; i++) {
    const rawCategory =
      categories[i] ?? data.series.find((series) => series.data[i])?.data[i]?.x ?? '';
    const category = useExcelDateSerialCategories ? toFiniteNumber(rawCategory) : undefined;
    const rowCategory = useStableCategoryKeys
      ? categoryKeyForIndex(i)
      : (category ?? String(rawCategory));
    for (let seriesIndex = 0; seriesIndex < data.series.length; seriesIndex += 1) {
      const series = data.series[seriesIndex];
      const seriesConfig = seriesConfigForDataSeries(series, seriesConfigs, seriesIndex);
      const isQuantitativeX = isQuantitativeXSeries(config, seriesConfig);
      const sourceSeriesIndex = seriesSourceIndex(series, seriesIndex);
      const sourceSeriesKey = seriesSourceKey(series, seriesIndex);
      const renderedSeriesType = effectiveRenderedSeriesType(
        config,
        series,
        seriesConfig,
        seriesIndex,
      );
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
          sourceSeriesKey,
          seriesOrder: seriesOrderForDataSeries(series, seriesConfig, seriesIndex),
        });
        applyPiePointKey(row, config, sourceSeriesIndex, sourceSeriesKey, i);
        row[BLANK_VALUE_FIELD] = true;
        row[SOURCE_BLANK_FIELD] = true;
        applyCategoryFormat(row, data.categoryFormatCodes?.[i]);
        rows.push(row);
        if (blankPolicy === 'gap') {
          gapSegmentsBySeries[seriesIndex] += 1;
        }
        continue;
      }
      if (point && shouldIncludePointInRows(point, config, seriesConfig)) {
        const rowValue = renderedPointValueForRows(point, config, seriesConfig) ?? point.y;
        const row = buildBaseRow({
          rawCategory,
          rowCategory,
          seriesName: series.name,
          pointIndex: i,
          seriesIndex,
          sourceSeriesIndex,
          sourceSeriesKey,
          seriesOrder: seriesOrderForDataSeries(series, seriesConfig, seriesIndex),
          value: rowValue,
        });
        applyPiePointKey(row, config, sourceSeriesIndex, sourceSeriesKey, i);
        if (point.valueState === 'blank') {
          row[SOURCE_BLANK_FIELD] = true;
        }
        if (config?.type === 'radar' && blankPolicy === 'zero' && point.valueState === 'blank') {
          row[BLANK_VALUE_FIELD] = true;
        }
        if (blankPolicy === 'gap') {
          row[LINE_SEGMENT_FIELD] = gapSegmentsBySeries[seriesIndex];
        }
        if (isQuantitativeX) {
          row[SCATTER_X_FIELD] = scatterXValue(point);
        }
        if (isBubbleSeries(config, seriesConfig)) {
          row[BUBBLE_SIZE_FIELD] = bubbleSizeValue(point, config, maxBubbleMagnitude);
          row[RAW_BUBBLE_SIZE_FIELD] = point.size;
          row[CLIP_TO_PLOT_AREA_FIELD] = false;
        }
        if (config?.series?.some(isNoFillNoLineSeries)) {
          row[SERIES_OPACITY_FIELD] = isNoFillNoLineSeries(seriesConfig) ? 0 : 1;
        }
        const pointFormat = seriesConfig?.points?.find((point) => point.idx === i);
        applyPointAnnotations(row, {
          config,
          seriesConfig,
          seriesName: series.name,
          seriesIndex,
          sourceSeriesIndex,
          pointIndex: i,
          category: rawCategory,
          value: point.y,
          valueState: point.valueState,
          xValue: isQuantitativeX ? scatterXValue(point) : undefined,
          bubbleSize: point.size,
          percentage: percentageForValue(point.y, totalsBySeries[seriesIndex]),
          pieLabelGeometry: pieLabelGeometries[seriesIndex]?.[i],
          seriesValues: series.data.map((item) => item?.y),
          pointFormat,
          seriesType: renderedSeriesType,
        });
        applySeriesVisualStyle(row, config, seriesConfig, sourceSeriesIndex, point.y, pointFormat);
        if (config?.type === 'waterfall') {
          const end = applyWaterfallFields({
            row,
            value: point.y,
            pointIndex: i,
            runningTotal: waterfallRunningTotal,
            totalIndices: totalWaterfallIndices,
          });
          if (seriesIndex === data.series.length - 1) {
            waterfallRunningTotal = end;
          }
        }
        applyCategoryFormat(row, data.categoryFormatCodes?.[i]);
        applyStockFields(row, point, config);
        rows.push(row);
      }
    }
  }
  return rows;
}

function applyPiePointKey(
  row: DataRow,
  config: ChartConfig | undefined,
  sourceSeriesIndex: number,
  sourceSeriesKey: string,
  pointIndex: number,
): void {
  if (!isPieLikeChartType(config?.type)) return;
  row[PIE_POINT_KEY_FIELD] = piePointKey({ sourceSeriesIndex, sourceSeriesKey, pointIndex });
}

function effectiveRenderedSeriesType(
  config: ChartConfig | undefined,
  series: ChartData['series'][number],
  seriesConfig: SeriesConfig | undefined,
  renderedSeriesIndex: number,
): ChartType | undefined {
  if (isSupportedChartType(seriesConfig?.type)) return seriesConfig.type;
  if (isSupportedChartType(series.type)) return series.type;
  if (!config) return undefined;
  if (config.type === 'combo') {
    const resolved = resolveComboSeriesType(config, series, seriesConfig, renderedSeriesIndex);
    return isSupportedChartType(resolved) ? resolved : undefined;
  }
  return config.type;
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
    valueState?: ChartDataPointValueState;
    xValue?: number;
    bubbleSize?: number;
    percentage?: number;
    pieLabelGeometry?: PieLabelGeometry;
    seriesValues: Array<number | undefined>;
    pointFormat?: PointFormat;
    seriesType?: ChartType;
  },
): void {
  const { config, seriesConfig, pointFormat } = context;
  applyPointStyle(row, config, seriesConfig, context.sourceSeriesIndex, pointFormat);
  applyMarker(
    row,
    config,
    seriesConfig,
    context.sourceSeriesIndex,
    pointFormat,
    context.seriesType,
  );
  applyDataLabel(row, context, pointFormat);
  applyErrorBars(row, context);
}
