import type { DataRow } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartDataPoint } from '../../types';
import { formatExcelValue } from '@mog/spreadsheet-utils/number-formats';
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
  POINT_STROKE_FIELD,
  POINT_STROKE_WIDTH_FIELD,
  RAW_CATEGORY_FIELD,
  RAW_VALUE_FIELD,
  SCATTER_X_FIELD,
  SERIES_FIELD,
  SERIES_INDEX_FIELD,
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
  WATERFALL_TYPE_FIELD,
} from './fields';
import { isNoFillNoLineSeries } from './series-style';
import { linePointsToCanvasPx } from './units';
import type { ChartFill, DataLabelConfig, ErrorBarConfig, PointFormat, SeriesConfig } from '../../types';

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
      const point = series.data[i];
      if (shouldBreakScatterLineAtPoint(point, config)) {
        gapSegmentsBySeries[seriesIndex] += 1;
        continue;
      }
      if (shouldEmitBlankRow(point, config)) {
        const row = buildBaseRow({
          rawCategory,
          rowCategory,
          seriesName: series.name,
          pointIndex: i,
          seriesIndex,
          seriesOrder: seriesConfigs[seriesIndex]?.order ?? seriesIndex,
        });
        row[BLANK_VALUE_FIELD] = true;
        applyCategoryFormat(row, data.categoryFormatCodes?.[i]);
        rows.push(row);
        if (config?.displayBlanksAs === 'gap') {
          gapSegmentsBySeries[seriesIndex] += 1;
        }
        continue;
      }
      if (point && shouldIncludePointInRows(point, config)) {
        const row = buildBaseRow({
          rawCategory,
          rowCategory,
          seriesName: series.name,
          pointIndex: i,
          seriesIndex,
          seriesOrder: seriesConfigs[seriesIndex]?.order ?? seriesIndex,
          value: point.y,
        });
        if (config?.displayBlanksAs === 'gap') {
          row[LINE_SEGMENT_FIELD] = gapSegmentsBySeries[seriesIndex];
        }
        if (isScatterLikeChart(config)) {
          row[SCATTER_X_FIELD] = scatterXValue(point);
        }
        if (config?.type === 'bubble') {
          row[BUBBLE_SIZE_FIELD] = bubbleSizeValue(point, config, maxBubbleMagnitude);
        }
        if (config?.series?.some(isNoFillNoLineSeries)) {
          row[SERIES_OPACITY_FIELD] = isNoFillNoLineSeries(seriesConfigs[seriesIndex]) ? 0 : 1;
        }
        applyPointAnnotations(row, {
          config,
          seriesConfig: seriesConfigs[seriesIndex],
          seriesName: series.name,
          pointIndex: i,
          category: rawCategory,
          value: point.y,
          bubbleSize: point.size,
          percentage: percentageForValue(point.y, totalsBySeries[seriesIndex]),
          pieLabelGeometry: pieLabelGeometries[seriesIndex]?.[i],
          seriesValues: series.data.map((item) => item?.y),
        });
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
  seriesOrder: number;
  value?: number;
}): DataRow {
  const row: DataRow = {
    [CATEGORY_FIELD]: input.rowCategory,
    [SERIES_FIELD]: input.seriesName,
    [POINT_INDEX_FIELD]: input.pointIndex,
    [SERIES_INDEX_FIELD]: input.seriesIndex,
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
    pointIndex: number;
    category: string | number;
    value: number;
    bubbleSize?: number;
    percentage?: number;
    pieLabelGeometry?: PieLabelGeometry;
    seriesValues: Array<number | undefined>;
  },
): void {
  const { config, seriesConfig, pointIndex } = context;
  const pointFormat = seriesConfig?.points?.find((point) => point.idx === pointIndex);
  applyPointStyle(row, seriesConfig, pointFormat);
  applyMarker(row, config, seriesConfig, pointFormat);
  applyDataLabel(row, context, pointFormat);
  applyErrorBars(row, context);
}

function applyPointStyle(
  row: DataRow,
  _seriesConfig: SeriesConfig | undefined,
  pointFormat: PointFormat | undefined,
): void {
  const fill = pointFormat?.fill ?? solidFillColor(pointFormat?.visualFormat?.fill);
  if (fill) row[POINT_FILL_FIELD] = fill;
  const line = pointFormat?.lineFormat ?? pointFormat?.visualFormat?.line;
  const stroke = lineColor(line) ?? pointFormat?.border?.color;
  if (stroke) row[POINT_STROKE_FIELD] = stroke;
  const strokeWidth = linePointsToCanvasPx(line?.width) ?? pointFormat?.border?.width;
  if (strokeWidth !== undefined) row[POINT_STROKE_WIDTH_FIELD] = strokeWidth;
  if (pointFormat?.explosion !== undefined) row[POINT_EXPLOSION_FIELD] = pointFormat.explosion;
}

function applyMarker(
  row: DataRow,
  config: ChartConfig | undefined,
  seriesConfig: SeriesConfig | undefined,
  pointFormat: PointFormat | undefined,
): void {
  const style = pointFormat?.markerStyle ?? seriesConfig?.markerStyle;
  const showMarkers =
    style === 'none'
      ? false
      : (pointFormat?.markerStyle !== undefined ||
        pointFormat?.markerSize !== undefined ||
        seriesConfig?.showMarkers === true ||
        isMarkerDefaultChart(config?.type));
  if (!showMarkers) return;

  row[MARKER_VISIBLE_FIELD] = true;
  row[MARKER_SHAPE_FIELD] = excelMarkerShape(style);
  row[MARKER_SIZE_FIELD] = markerPointSizeToArea(pointFormat?.markerSize ?? seriesConfig?.markerSize);
  const pointLine = pointFormat?.lineFormat ?? pointFormat?.visualFormat?.line;
  const fill =
    colorToCss(pointFormat?.markerBackgroundColor ?? seriesConfig?.markerBackgroundColor) ??
    pointFormat?.fill ??
    solidFillColor(pointFormat?.visualFormat?.fill);
  const stroke =
    colorToCss(pointFormat?.markerForegroundColor ?? seriesConfig?.markerForegroundColor) ??
    lineColor(pointLine) ??
    pointFormat?.border?.color;
  if (fill) row[MARKER_FILL_FIELD] = fill;
  if (stroke) row[MARKER_STROKE_FIELD] = stroke;
}

function applyDataLabel(
  row: DataRow,
  context: {
    config?: ChartConfig;
    seriesConfig?: SeriesConfig;
    seriesName: string;
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

  const text = composeLabelText(label, context);
  if (!text) return;
  row[DATA_LABEL_VISIBLE_FIELD] = true;
  row[DATA_LABEL_TEXT_FIELD] = text;
  const placement = labelPlacement(label.position, context.config?.type);
  row[DATA_LABEL_DX_FIELD] = placement.dx;
  row[DATA_LABEL_DY_FIELD] = placement.dy;
  row[DATA_LABEL_ALIGN_FIELD] = placement.align;
  row[DATA_LABEL_BASELINE_FIELD] = placement.baseline;
  row[DATA_LABEL_VALUE_ANCHOR_FIELD] = context.value + placement.valueDelta(context.value);
  if (context.pieLabelGeometry) {
    const coordinates = pieLabelCoordinates(context.pieLabelGeometry, label.position);
    row[DATA_LABEL_ANCHOR_X_FIELD] = coordinates.anchorX;
    row[DATA_LABEL_ANCHOR_Y_FIELD] = coordinates.anchorY;
    row[DATA_LABEL_X_FIELD] = coordinates.labelX;
    row[DATA_LABEL_Y_FIELD] = coordinates.labelY;
  }
  const font = label.visualFormat?.font;
  const color = colorToCss(font?.color);
  if (color) row[DATA_LABEL_COLOR_FIELD] = color;
  if (font?.size !== undefined) row[DATA_LABEL_FONT_SIZE_FIELD] = font.size;
  const rotation = label.textOrientation ?? label.visualFormat?.textRotation;
  if (rotation !== undefined) row[DATA_LABEL_ROTATION_FIELD] = rotation;
  if (label.showLeaderLines === true || label.leaderLinesFormat) {
    row[DATA_LABEL_LEADER_VISIBLE_FIELD] = true;
    const line = label.leaderLinesFormat?.format;
    const stroke = lineColor(line);
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
    pointIndex: number;
    value: number;
    seriesValues: Array<number | undefined>;
  },
): void {
  const bars = [
    context.seriesConfig?.errorBars,
    context.seriesConfig?.xErrorBars,
    context.seriesConfig?.yErrorBars,
  ].filter(Boolean) as ErrorBarConfig[];
  if (bars.length === 0) return;

  for (const bar of bars) {
    if (bar.visible === false) continue;
    const direction = bar.direction ?? (context.config?.type === 'scatter' ? 'y' : 'y');
    const extent = errorBarExtent(bar, context);
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
    } else {
      if (extent.minus !== undefined) {
        row[ERROR_BAR_Y_MIN_FIELD] = extent.minus;
        if (!bar.noEndCap) row[ERROR_BAR_Y_MIN_CAP_VISIBLE_FIELD] = true;
      }
      if (extent.plus !== undefined) {
        row[ERROR_BAR_Y_MAX_FIELD] = extent.plus;
        if (!bar.noEndCap) row[ERROR_BAR_Y_MAX_CAP_VISIBLE_FIELD] = true;
      }
    }
    const stroke = lineColor(bar.lineFormat);
    const strokeWidth = linePointsToCanvasPx(bar.lineFormat?.width);
    if (stroke) row[ERROR_BAR_STROKE_FIELD] = stroke;
    if (strokeWidth !== undefined) row[ERROR_BAR_STROKE_WIDTH_FIELD] = strokeWidth;
  }
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
): string {
  if (label.text) return label.text;
  if (label.formula) return label.formula;
  if (label.richText?.length) return label.richText.map((run) => run.text).join('');

  const showValue = label.showValue ?? defaultLabelShowsValue(label);
  const parts: string[] = [];
  if (label.showSeriesName) parts.push(context.seriesName);
  if (label.showCategoryName ?? label.showCategory) parts.push(String(context.category));
  if (showValue) parts.push(formatLabelNumber(context.value, label.numberFormat ?? label.format));
  if (label.showPercentage ?? label.showPercent) {
    parts.push(formatLabelNumber(context.percentage ?? 0, label.numberFormat ?? label.format ?? '0%'));
  }
  if (label.showBubbleSize && context.bubbleSize !== undefined) {
    parts.push(formatLabelNumber(context.bubbleSize, label.numberFormat ?? label.format));
  }
  return parts.join(label.separator ?? ', ');
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

function formatLabelNumber(value: number, format?: string): string {
  if (format) return formatExcelValue(value, format);
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
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
  context: { pointIndex: number; value: number; seriesValues: Array<number | undefined> },
): { plus?: number; minus?: number } | undefined {
  const type = bar.valueType ?? 'fixedVal';
  const custom = type === 'cust' || type === 'custom' || bar.plusSource || bar.minusSource;
  const plusDelta = custom
    ? customErrorDelta(bar.plusSource, context.pointIndex)
    : baseErrorDelta(type, bar, context);
  const minusDelta = custom
    ? customErrorDelta(bar.minusSource, context.pointIndex)
    : baseErrorDelta(type, bar, context);
  const plus = bar.barType === 'minus' || plusDelta === undefined ? undefined : context.value + plusDelta;
  const minus = bar.barType === 'plus' || minusDelta === undefined ? undefined : context.value - minusDelta;
  return plus === undefined && minus === undefined ? undefined : { plus, minus };
}

function baseErrorDelta(
  type: string,
  bar: ErrorBarConfig,
  context: { value: number; seriesValues: Array<number | undefined> },
): number {
  const value = bar.value ?? 1;
  if (type === 'percentage' || type === 'percentageValue') return Math.abs(context.value) * value / 100;
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

function isMarkerDefaultChart(type?: ChartConfig['type']): boolean {
  return type === 'lineMarkers' || type === 'lineMarkersStacked' || type === 'lineMarkersStacked100';
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

function solidFillColor(fill: ChartFill | undefined): string | undefined {
  if (!fill || fill.type !== 'solid') return undefined;
  return colorToCss(fill.color);
}

function lineColor(line: PointFormat['lineFormat'] | undefined): string | undefined {
  if (!line || line.noFill) return undefined;
  return colorToCss(line.color);
}

function colorToCss(color: unknown): string | undefined {
  if (typeof color === 'string') return color.startsWith('#') ? color : `#${color}`;
  if (color && typeof color === 'object' && 'theme' in color) return undefined;
  return undefined;
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

function shouldEmitBlankRow(
  point: ChartDataPoint | undefined,
  config?: ChartConfig,
): boolean {
  if (isScatterLikeChart(config)) return false;
  if (config?.displayBlanksAs !== 'gap' && config?.displayBlanksAs !== 'span') return false;
  if (!point) return true;
  return point.valueState === 'blank';
}

function shouldBreakScatterLineAtPoint(
  point: ChartDataPoint | undefined,
  config?: ChartConfig,
): boolean {
  return (
    config?.type === 'scatter' &&
    config.showLines === true &&
    config.displayBlanksAs === 'gap' &&
    (!point || point.valueState === 'blank')
  );
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
