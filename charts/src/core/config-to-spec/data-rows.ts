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
  POINT_INDEX_FIELD,
  RAW_BUBBLE_SIZE_FIELD,
  SCATTER_X_FIELD,
  LINE_SEGMENT_FIELD,
  SERIES_OPACITY_FIELD,
  VALUE_FIELD,
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
  const totalWaterfallIndices = waterfallTotalIndices(config);
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
        applyStockFields(row, point);
        rows.push(row);
      }
    }
  }
  return rows;
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
