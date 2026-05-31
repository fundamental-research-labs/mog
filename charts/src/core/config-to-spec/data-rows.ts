import type { DataRow } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartDataPoint } from '../../types';
import {
  formatExcelValueResult,
  type ExcelNumberFormatResult,
} from '@mog/spreadsheet-utils/number-formats';
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
  DATA_LABEL_ALIGN_FIELD,
  DATA_LABEL_ANCHOR_X_FIELD,
  DATA_LABEL_ANCHOR_Y_FIELD,
  DATA_LABEL_BASELINE_FIELD,
  DATA_LABEL_COLOR_FIELD,
  DATA_LABEL_DX_FIELD,
  DATA_LABEL_DY_FIELD,
  DATA_LABEL_FONT_SIZE_FIELD,
  DATA_LABEL_LAYOUT_TARGET_FIELD,
  DATA_LABEL_LAYOUT_X_FIELD,
  DATA_LABEL_LAYOUT_Y_FIELD,
  DATA_LABEL_LEADER_STROKE_FIELD,
  DATA_LABEL_LEADER_STROKE_WIDTH_FIELD,
  DATA_LABEL_LEADER_VISIBLE_FIELD,
  DATA_LABEL_ROTATION_FIELD,
  DATA_LABEL_TEXT_FIELD,
  DATA_LABEL_VALUE_ANCHOR_FIELD,
  DATA_LABEL_VISIBLE_FIELD,
  DATA_LABEL_X_FIELD,
  DATA_LABEL_Y_FIELD,
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
  MARKER_FILL_FIELD,
  MARKER_SHAPE_FIELD,
  MARKER_SIZE_FIELD,
  MARKER_STROKE_FIELD,
  MARKER_VISIBLE_FIELD,
  POINT_EXPLOSION_FIELD,
  POINT_FILL_FIELD,
  POINT_INDEX_FIELD,
  POINT_STYLE_VISIBLE_FIELD,
  POINT_STROKE_FIELD,
  POINT_STROKE_WIDTH_FIELD,
  RAW_BUBBLE_SIZE_FIELD,
  RAW_CATEGORY_FIELD,
  RAW_VALUE_FIELD,
  SCATTER_X_FIELD,
  SERIES_FIELD,
  SERIES_FILL_FIELD,
  SERIES_INDEX_FIELD,
  SERIES_STROKE_FIELD,
  SERIES_STROKE_WIDTH_FIELD,
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
import { isNoFillNoLineSeries, resolveSeriesColor } from './series-style';
import {
  resolveChartFillColor,
  resolveChartLineStyle,
  resolveChartOwnerFormat,
  resolverContextFromConfig,
} from '../style-resolver';
import { resolveChartColor, resolveChartTextColor } from '../../utils/chart-colors';
import { linePointsToCanvasPx } from './units';
import type {
  ChartColor,
  ChartFormat,
  DataLabelConfig,
  ErrorBarConfig,
  PointFormat,
  SeriesConfig,
} from '../../types';
import {
  seriesConfigForDataSeries,
  seriesOrderForDataSeries,
  seriesSourceIndex,
  seriesSourceKey,
} from '../series-identity';

interface PieLabelGeometry {
  cos: number;
  sin: number;
}

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

function applyPointStyle(
  row: DataRow,
  config: ChartConfig | undefined,
  _seriesConfig: SeriesConfig | undefined,
  sourceSeriesIndex: number,
  pointFormat: PointFormat | undefined,
): void {
  const ownerKey =
    pointFormat?.idx === undefined
      ? undefined
      : pointOwnerKey(sourceSeriesIndex, pointFormat.idx);
  const resolverContext = config && ownerKey ? resolverContextFromConfig(config, ownerKey) : {};
  const format = config
    ? resolveChartOwnerFormat(config, ownerKey, pointChartFormat(pointFormat))
    : pointChartFormat(pointFormat);
  const fill =
    colorToCss(pointFormat?.fill, resolverContext) ??
    resolveChartFillColor(format?.fill, resolverContext);
  let hasStyle = false;
  if (fill) row[POINT_FILL_FIELD] = fill;
  const line = format?.line;
  const stroke = lineColor(line, resolverContext) ?? colorToCss(pointFormat?.border?.color);
  if (stroke) row[POINT_STROKE_FIELD] = stroke;
  const strokeWidth = linePointsToCanvasPx(line?.width) ?? pointFormat?.border?.width;
  if (strokeWidth !== undefined) row[POINT_STROKE_WIDTH_FIELD] = strokeWidth;
  if (pointFormat?.explosion !== undefined) row[POINT_EXPLOSION_FIELD] = pointFormat.explosion;
  hasStyle =
    fill !== undefined ||
    stroke !== undefined ||
    strokeWidth !== undefined ||
    pointFormat?.explosion !== undefined;
  if (hasStyle) row[POINT_STYLE_VISIBLE_FIELD] = true;
}

function applyMarker(
  row: DataRow,
  config: ChartConfig | undefined,
  seriesConfig: SeriesConfig | undefined,
  sourceSeriesIndex: number,
  pointFormat: PointFormat | undefined,
): void {
  const style = pointFormat?.markerStyle ?? seriesConfig?.markerStyle;
  const hasPointMarkerOverride =
    pointFormat?.markerStyle !== undefined || pointFormat?.markerSize !== undefined;
  if (seriesConfig?.showMarkers === false && !hasPointMarkerOverride) return;
  const showMarkers =
    style === 'none'
      ? false
      : (pointFormat?.markerStyle !== undefined ||
        pointFormat?.markerSize !== undefined ||
        seriesConfig?.markerStyle !== undefined ||
        seriesConfig?.markerSize !== undefined ||
        seriesConfig?.showMarkers === true ||
        isMarkerDefaultChart(config?.type, seriesConfig?.type));
  if (!showMarkers) return;

  row[MARKER_VISIBLE_FIELD] = true;
  row[MARKER_SHAPE_FIELD] = excelMarkerShape(style);
  row[MARKER_SIZE_FIELD] = markerPointSizeToArea(pointFormat?.markerSize ?? seriesConfig?.markerSize);
  const pointLine = pointFormat?.lineFormat ?? pointFormat?.visualFormat?.line;
  const ownerKey =
    pointFormat?.idx === undefined
      ? markerOwnerKey(sourceSeriesIndex)
      : markerPointOwnerKey(sourceSeriesIndex, pointFormat.idx);
  const resolverContext = config ? resolverContextFromConfig(config, ownerKey) : {};
  const fill =
    resolveChartColor(
      pointFormat?.markerBackgroundColor ?? seriesConfig?.markerBackgroundColor,
      resolverContext,
    ) ??
    colorToCss(pointFormat?.fill, resolverContext) ??
    resolveChartFillColor(pointFormat?.visualFormat?.fill, resolverContext);
  const stroke =
    resolveChartColor(
      pointFormat?.markerForegroundColor ?? seriesConfig?.markerForegroundColor,
      resolverContext,
    ) ??
    lineColor(pointLine, resolverContext) ??
    colorToCss(pointFormat?.border?.color);
  if (fill) row[MARKER_FILL_FIELD] = fill;
  if (stroke) row[MARKER_STROKE_FIELD] = stroke;
}

function applySeriesVisualStyle(
  row: DataRow,
  config: ChartConfig | undefined,
  seriesConfig: SeriesConfig | undefined,
  sourceSeriesIndex: number,
): void {
  if (!seriesConfig || isNoFillNoLineSeries(seriesConfig)) return;
  const fill = config
    ? resolveSeriesColor(seriesConfig, sourceSeriesIndex, config.type, config)
    : resolveSeriesColor(seriesConfig, sourceSeriesIndex);
  if (fill) row[SERIES_FILL_FIELD] = fill;

  const ownerKey = `series(${sourceSeriesIndex})`;
  const resolverContext = config ? resolverContextFromConfig(config, ownerKey) : {};
  const format = config
    ? resolveChartOwnerFormat(config, ownerKey, seriesConfig?.format)
    : seriesConfig?.format;
  const stroke = lineColor(format?.line, resolverContext);
  const strokeWidth = linePointsToCanvasPx(format?.line?.width);
  if (stroke) row[SERIES_STROKE_FIELD] = stroke;
  if (strokeWidth !== undefined) row[SERIES_STROKE_WIDTH_FIELD] = strokeWidth;
}

function applyDataLabel(
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
    bubbleSize?: number;
    percentage?: number;
    pieLabelGeometry?: PieLabelGeometry;
  },
  pointFormat: PointFormat | undefined,
): void {
  const label = mergeLabels(
    context.config?.dataLabels,
    context.seriesConfig?.dataLabels,
    pointFormat?.dataLabel,
  );
  if (!label || label.delete === true || label.show === false) return;

  const labelText = composeLabelText(label, context);
  if (!labelText.text) return;
  row[DATA_LABEL_VISIBLE_FIELD] = true;
  row[DATA_LABEL_TEXT_FIELD] = labelText.text;
  const placement = labelPlacement(label.position, context.config?.type);
  const manualX = finiteNumber(label.layout?.x);
  const manualY = finiteNumber(label.layout?.y);
  const hasManualPosition = manualX !== undefined || manualY !== undefined;
  row[DATA_LABEL_DX_FIELD] = hasManualPosition ? 0 : placement.dx;
  row[DATA_LABEL_DY_FIELD] = hasManualPosition ? 0 : placement.dy;
  row[DATA_LABEL_ALIGN_FIELD] = hasManualPosition ? 'left' : placement.align;
  row[DATA_LABEL_BASELINE_FIELD] = hasManualPosition ? 'top' : placement.baseline;
  row[DATA_LABEL_VALUE_ANCHOR_FIELD] = context.value + placement.valueDelta(context.value);
  if (hasManualPosition) {
    row[DATA_LABEL_LAYOUT_TARGET_FIELD] =
      label.layout?.layoutTarget === 'inner' ? 'inner' : 'outer';
    if (manualX !== undefined) row[DATA_LABEL_LAYOUT_X_FIELD] = manualX;
    if (manualY !== undefined) row[DATA_LABEL_LAYOUT_Y_FIELD] = manualY;
  }
  if (context.pieLabelGeometry) {
    const coordinates = pieLabelCoordinates(context.pieLabelGeometry, label.position);
    row[DATA_LABEL_ANCHOR_X_FIELD] = coordinates.anchorX;
    row[DATA_LABEL_ANCHOR_Y_FIELD] = coordinates.anchorY;
    row[DATA_LABEL_X_FIELD] = coordinates.labelX;
    row[DATA_LABEL_Y_FIELD] = coordinates.labelY;
  }
  const ownerKey = dataLabelOwnerKey(context.sourceSeriesIndex, context.pointIndex);
  const resolverContext = context.config
    ? resolverContextFromConfig(context.config, ownerKey)
    : {};
  const labelFormat = context.config
    ? resolveChartOwnerFormat(context.config, ownerKey, label.visualFormat)
    : label.visualFormat;
  const font = labelFormat?.font;
  const color = resolveChartTextColor(font?.color, resolverContext) ?? labelText.color;
  if (color) row[DATA_LABEL_COLOR_FIELD] = color;
  if (font?.size !== undefined) row[DATA_LABEL_FONT_SIZE_FIELD] = font.size;
  const rotation = label.textOrientation ?? labelFormat?.textRotation;
  if (rotation !== undefined) row[DATA_LABEL_ROTATION_FIELD] = rotation;
  if (label.showLeaderLines === true || label.leaderLinesFormat) {
    row[DATA_LABEL_LEADER_VISIBLE_FIELD] = true;
    const line = label.leaderLinesFormat?.format;
    const stroke = lineColor(line, resolverContext);
    const strokeWidth = linePointsToCanvasPx(line?.width);
    if (stroke) row[DATA_LABEL_LEADER_STROKE_FIELD] = stroke;
    if (strokeWidth !== undefined) row[DATA_LABEL_LEADER_STROKE_WIDTH_FIELD] = strokeWidth;
  }
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
    { config: context.seriesConfig?.errorBars, fallbackDirection: defaultErrorBarDirection(context.config) },
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
      if (extent.minus !== undefined && extent.plus === undefined) row[ERROR_BAR_X_MAX_FIELD] = baseValue;
      if (extent.plus !== undefined && extent.minus === undefined) row[ERROR_BAR_X_MIN_FIELD] = baseValue;
    } else {
      if (extent.minus !== undefined) {
        row[ERROR_BAR_Y_MIN_FIELD] = extent.minus;
        if (!bar.noEndCap) row[ERROR_BAR_Y_MIN_CAP_VISIBLE_FIELD] = true;
      }
      if (extent.plus !== undefined) {
        row[ERROR_BAR_Y_MAX_FIELD] = extent.plus;
        if (!bar.noEndCap) row[ERROR_BAR_Y_MAX_CAP_VISIBLE_FIELD] = true;
      }
      if (extent.minus !== undefined && extent.plus === undefined) row[ERROR_BAR_Y_MAX_FIELD] = baseValue;
      if (extent.plus !== undefined && extent.minus === undefined) row[ERROR_BAR_Y_MIN_FIELD] = baseValue;
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

function mergeLabels(
  chartLabel?: DataLabelConfig,
  seriesLabel?: DataLabelConfig,
  pointLabel?: DataLabelConfig,
): DataLabelConfig | undefined {
  const merged = [chartLabel, seriesLabel, pointLabel].filter(Boolean).reduce(
    (acc, label) => ({ ...acc, ...definedEntries(label!) }),
    {} as Partial<DataLabelConfig>,
  );
  return Object.keys(merged).length > 0 ? ({ show: false, ...merged } as DataLabelConfig) : undefined;
}

function definedEntries<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function composeLabelText(
  label: DataLabelConfig,
  context: {
    seriesName: string;
    category: string | number;
    value: number;
    bubbleSize?: number;
    percentage?: number;
  },
): { text: string; color?: string } {
  if (label.text) return { text: label.text };
  if (label.formula) return { text: label.formula };
  if (label.richText?.length) return { text: label.richText.map((run) => run.text).join('') };

  const showValue = label.showValue ?? defaultLabelShowsValue(label);
  const parts: string[] = [];
  let color: string | undefined;
  const pushNumber = (result: ExcelNumberFormatResult) => {
    parts.push(result.text);
    color ??= result.color;
  };
  if (label.showSeriesName) parts.push(context.seriesName);
  if (label.showCategoryName ?? label.showCategory) parts.push(String(context.category));
  if (showValue) pushNumber(formatLabelNumber(context.value, label.numberFormat ?? label.format));
  if (label.showPercentage ?? label.showPercent) {
    pushNumber(formatLabelNumber(context.percentage ?? 0, label.numberFormat ?? label.format ?? '0%'));
  }
  if (label.showBubbleSize && context.bubbleSize !== undefined) {
    pushNumber(formatLabelNumber(context.bubbleSize, label.numberFormat ?? label.format));
  }
  return {
    text: parts.join(label.separator ?? ', '),
    ...(color !== undefined ? { color } : {}),
  };
}

function defaultLabelShowsValue(label: DataLabelConfig): boolean {
  return !(
    label.showSeriesName ||
    label.showCategoryName ||
    label.showCategory ||
    label.showPercentage ||
    label.showPercent ||
    label.showBubbleSize
  );
}

function formatLabelNumber(value: number, format?: string): ExcelNumberFormatResult {
  if (format) return formatExcelValueResult(value, format);
  return {
    text: Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12))),
    section: value < 0 ? 'negative' : value === 0 ? 'zero' : 'positive',
  };
}

function labelPlacement(position: DataLabelConfig['position'], chartType?: ChartConfig['type']) {
  const isPie = chartType === 'pie' || chartType === 'doughnut' || chartType === 'pie3d';
  switch (position) {
    case 'left':
      return { dx: -10, dy: 0, align: 'right', baseline: 'middle', valueDelta: () => 0 };
    case 'right':
      return { dx: 10, dy: 0, align: 'left', baseline: 'middle', valueDelta: () => 0 };
    case 'bottom':
    case 'insideBase':
      return { dx: 0, dy: 10, align: 'center', baseline: 'top', valueDelta: (v: number) => -Math.abs(v) * 0.08 };
    case 'outsideEnd':
    case 'top':
    case 'bestFit':
    case 'callout':
      return {
        dx: 0,
        dy: isPie ? -16 : -10,
        align: 'center',
        baseline: 'bottom',
        valueDelta: (v: number) => Math.max(Math.abs(v) * 0.08, 1),
      };
    case 'center':
    case 'inside':
    case 'insideEnd':
    default:
      return { dx: 0, dy: 0, align: 'center', baseline: 'middle', valueDelta: () => 0 };
  }
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
  const plus = bar.barType === 'minus' || plusDelta === undefined ? undefined : context.baseValue + plusDelta;
  const minus = bar.barType === 'plus' || minusDelta === undefined ? undefined : context.baseValue - minusDelta;
  return plus === undefined && minus === undefined ? undefined : { plus, minus };
}

function baseErrorDelta(
  type: string,
  bar: ErrorBarConfig,
  context: { baseValue: number; seriesValues: Array<number | undefined> },
): number {
  const value = bar.value ?? 1;
  if (type === 'percentage' || type === 'percentageValue') return Math.abs(context.baseValue) * value / 100;
  if (type === 'stdDev') return sampleStdDev(context.seriesValues) * value;
  if (type === 'stdErr') return sampleStdDev(context.seriesValues) / Math.sqrt(validNumbers(context.seriesValues).length) * value;
  return value;
}

function customErrorDelta(source: ErrorBarConfig['plusSource'], pointIndex: number): number | undefined {
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
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function seriesTotal(values: Array<{ y: number } | undefined>): number {
  return values.reduce((sum, point) => {
    const value = point?.y;
    return typeof value === 'number' && Number.isFinite(value) ? sum + Math.abs(value) : sum;
  }, 0);
}

function percentageForValue(value: number, total: number): number | undefined {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return undefined;
  return Math.abs(value) / total;
}

function buildPieLabelGeometries(data: ChartData, config?: ChartConfig): PieLabelGeometry[][] {
  if (!config || !isPieLikeChart(config.type)) return [];

  return data.series.map((series) => {
    const total = seriesTotal(series.data);
    let startAngle = -Math.PI / 2;
    return series.data.map((point) => {
      const value = total > 0 ? Math.abs(point?.y ?? 0) : 1;
      const angle = total > 0 ? (value / total) * Math.PI * 2 : (Math.PI * 2) / Math.max(1, series.data.length);
      const midAngle = startAngle + angle / 2;
      startAngle += angle;
      return { cos: Math.cos(midAngle), sin: Math.sin(midAngle) };
    });
  });
}

function pieLabelCoordinates(
  geometry: PieLabelGeometry,
  position: DataLabelConfig['position'],
): { anchorX: number; anchorY: number; labelX: number; labelY: number } {
  const outside =
    position === 'outside' ||
    position === 'outsideEnd' ||
    position === 'bestFit' ||
    position === 'callout';
  const center = position === 'center';
  const anchorRadius = 0.42;
  const labelRadius = outside ? 0.56 : center ? 0.0 : 0.3;
  return {
    anchorX: 0.5 + geometry.cos * anchorRadius,
    anchorY: 0.5 + geometry.sin * anchorRadius,
    labelX: 0.5 + geometry.cos * labelRadius,
    labelY: 0.5 + geometry.sin * labelRadius,
  };
}

function isPieLikeChart(type?: ChartConfig['type']): boolean {
  return type === 'pie' || type === 'doughnut' || type === 'pie3d';
}

function isMarkerDefaultChart(type?: ChartConfig['type'], seriesType?: string): boolean {
  return (
    type === 'lineMarkers' ||
    type === 'lineMarkersStacked' ||
    type === 'lineMarkersStacked100' ||
    seriesType === 'lineMarkers' ||
    seriesType === 'lineMarkersStacked' ||
    seriesType === 'lineMarkersStacked100'
  );
}

function excelMarkerShape(style?: string): string {
  switch (style) {
    case 'square':
    case 'diamond':
    case 'star':
    case 'dash':
      return style;
    case 'triangle':
      return 'triangle-up';
    case 'plus':
      return 'cross';
    case 'x':
      return 'x';
    case 'dot':
    case 'circle':
    case 'auto':
    default:
      return 'circle';
  }
}

function markerPointSizeToArea(size?: number): number {
  const diameter = size ?? 7;
  return Math.max(4, diameter * diameter);
}

function pointChartFormat(pointFormat: PointFormat | undefined): ChartFormat | undefined {
  if (!pointFormat) return undefined;
  const base = pointFormat.visualFormat;
  if (!pointFormat.lineFormat) return base;
  return { ...(base ?? {}), line: pointFormat.lineFormat };
}

function lineColor(
  line: PointFormat['lineFormat'] | undefined,
  context: Parameters<typeof resolveChartLineStyle>[1] = {},
): string | undefined {
  if (!line || line.noFill) return undefined;
  const resolved = resolveChartLineStyle(line, context, { widthToPx: linePointsToCanvasPx });
  return resolved?.paint?.type === 'solid' ? resolved.paint.color : undefined;
}

function colorToCss(
  color: unknown,
  context: Parameters<typeof resolveChartColor>[1] = {},
): string | undefined {
  if (typeof color === 'string') return color.startsWith('#') ? color : `#${color}`;
  if (color && typeof color === 'object' && 'theme' in color) {
    return resolveChartColor(color as ChartColor, context);
  }
  return undefined;
}

function pointOwnerKey(sourceSeriesIndex: number, pointIndex: number): string {
  return `point(seriesIdx=${sourceSeriesIndex},pointIdx=${pointIndex})`;
}

function markerOwnerKey(sourceSeriesIndex: number): string {
  return `marker(seriesIdx=${sourceSeriesIndex})`;
}

function markerPointOwnerKey(sourceSeriesIndex: number, pointIndex: number): string {
  return `markerPoint(seriesIdx=${sourceSeriesIndex},pointIdx=${pointIndex})`;
}

function dataLabelOwnerKey(sourceSeriesIndex: number, pointIndex: number): string {
  return `dataLabel(seriesIdx=${sourceSeriesIndex},pointIdx=${pointIndex})`;
}

function errorBarsOwnerKey(sourceSeriesIndex: number, axis: 'x' | 'y'): string {
  return `errorBars(seriesIdx=${sourceSeriesIndex},axis=${axis})`;
}

function isScatterLikeChart(config?: ChartConfig): boolean {
  return config?.type === 'scatter' || config?.type === 'bubble';
}

function isQuantitativeXSeries(
  config: ChartConfig | undefined,
  seriesConfig: SeriesConfig | undefined,
): boolean {
  if (seriesConfig?.xRole === 'quantitative') return true;
  if (seriesConfig?.xRole === 'category') return false;
  return (
    isScatterLikeChart(config) ||
    seriesConfig?.type === 'scatter' ||
    seriesConfig?.type === 'bubble'
  );
}

function isBubbleSeries(
  config: ChartConfig | undefined,
  seriesConfig: SeriesConfig | undefined,
): boolean {
  return config?.type === 'bubble' || seriesConfig?.type === 'bubble';
}

function scatterXValue(point: ChartDataPoint): number {
  return toFiniteNumber(point.x)!;
}

function bubbleSizeValue(
  point: ChartDataPoint,
  config: ChartConfig | undefined,
  maxBubbleMagnitude: number,
): number {
  const rawSize = toFiniteNumber(point.size)!;
  const magnitude = Math.abs(rawSize);
  if (config?.sizeRepresents === 'w' && maxBubbleMagnitude > 0) {
    return (magnitude * magnitude) / maxBubbleMagnitude;
  }
  return magnitude;
}

function shouldIncludePointInRows(
  point: ChartDataPoint,
  config?: ChartConfig,
  seriesConfig?: SeriesConfig,
): boolean {
  if (point.valueState === 'hidden') return false;
  if (config?.type === 'stock' && !isRenderableStockPoint(point, config)) return false;
  const isQuantitativeX = isQuantitativeXSeries(config, seriesConfig);
  if (isQuantitativeX && toFiniteNumber(point.x) === undefined) return false;
  if (isBubbleSeries(config, seriesConfig)) {
    const size = toFiniteNumber(point.size);
    if (size === undefined) return false;
    if (size <= 0 && config?.showNegBubbles !== true) return false;
  }
  if (isQuantitativeX && point.valueState) return false;
  if (!point.valueState || point.valueState === 'value') return true;
  if (point.valueState === 'blank') {
    return config?.displayBlanksAs === 'zero';
  }
  return false;
}

function isRenderableStockPoint(point: ChartDataPoint, config: ChartConfig): boolean {
  const hasHighLowClose =
    toFiniteNumber(point.high) !== undefined &&
    toFiniteNumber(point.low) !== undefined &&
    toFiniteNumber(point.close) !== undefined;
  if (hasHighLowClose) {
    return (
      (config.subType !== 'ohlc' && config.subType !== 'volume-ohlc') ||
      toFiniteNumber(point.open) !== undefined
    );
  }

  return toFiniteNumber(point.open) !== undefined && toFiniteNumber(point.close) !== undefined;
}

function shouldEmitBlankRow(
  point: ChartDataPoint | undefined,
  config?: ChartConfig,
  seriesConfig?: SeriesConfig,
): boolean {
  if (isQuantitativeXSeries(config, seriesConfig)) return false;
  if (config?.displayBlanksAs !== 'gap' && config?.displayBlanksAs !== 'span') return false;
  if (!point) return true;
  return point.valueState === 'blank';
}

function shouldBreakScatterLineAtPoint(
  point: ChartDataPoint | undefined,
  config?: ChartConfig,
  seriesConfig?: SeriesConfig,
): boolean {
  return (
    isQuantitativeXSeries(config, seriesConfig) &&
    (seriesConfig?.showLines ?? config?.showLines) === true &&
    config?.displayBlanksAs === 'gap' &&
    (!point || point.valueState === 'blank')
  );
}

function maxRenderableBubbleMagnitude(data: ChartData, config?: ChartConfig): number {
  if (!config) return 0;
  let max = 0;
  for (let seriesIndex = 0; seriesIndex < data.series.length; seriesIndex += 1) {
    const series = data.series[seriesIndex];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], seriesIndex);
    if (!isBubbleSeries(config, seriesConfig)) continue;
    for (const point of series.data) {
      if (!shouldIncludePointInRows(point, config, seriesConfig)) continue;
      const size = toFiniteNumber(point.size);
      if (size !== undefined) max = Math.max(max, Math.abs(size));
    }
  }
  return max;
}
