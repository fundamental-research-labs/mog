import type { DataRow } from '../../grammar/spec';
import type {
  ChartConfig,
  ChartData,
  DataLabelConfig,
  PointFormat,
  SeriesConfig,
} from '../../types';
import {
  formatExcelValueResult,
  type ExcelNumberFormatResult,
} from '@mog/spreadsheet-utils/number-formats';
import {
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
} from './fields';
import { resolveChartOwnerFormat, resolverContextFromConfig } from '../style-resolver';
import { resolveChartTextColor } from '../../utils/chart-colors';
import { linePointsToCanvasPx } from './units';
import { lineColor } from './data-row-style';

export interface PieLabelGeometry {
  cos: number;
  sin: number;
}

export function applyDataLabel(
  row: DataRow,
  context: {
    config?: ChartConfig;
    seriesConfig?: SeriesConfig;
    seriesName: string;
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
  const resolverContext = context.config ? resolverContextFromConfig(context.config, ownerKey) : {};
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

export function seriesTotal(values: Array<{ y: number } | undefined>): number {
  return values.reduce((sum, point) => {
    const value = point?.y;
    return typeof value === 'number' && Number.isFinite(value) ? sum + Math.abs(value) : sum;
  }, 0);
}

export function percentageForValue(value: number, total: number): number | undefined {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return undefined;
  return Math.abs(value) / total;
}

export function buildPieLabelGeometries(
  data: ChartData,
  config?: ChartConfig,
): PieLabelGeometry[][] {
  if (!config || !isPieLikeChart(config.type)) return [];

  return data.series.map((series) => {
    const total = seriesTotal(series.data);
    let startAngle = -Math.PI / 2;
    return series.data.map((point) => {
      const value = total > 0 ? Math.abs(point?.y ?? 0) : 1;
      const angle =
        total > 0 ? (value / total) * Math.PI * 2 : (Math.PI * 2) / Math.max(1, series.data.length);
      const midAngle = startAngle + angle / 2;
      startAngle += angle;
      return { cos: Math.cos(midAngle), sin: Math.sin(midAngle) };
    });
  });
}

function mergeLabels(
  chartLabel?: DataLabelConfig,
  seriesLabel?: DataLabelConfig,
  pointLabel?: DataLabelConfig,
): DataLabelConfig | undefined {
  const merged = [chartLabel, seriesLabel, pointLabel]
    .filter(Boolean)
    .reduce(
      (acc, label) => ({ ...acc, ...definedEntries(label!) }),
      {} as Partial<DataLabelConfig>,
    );
  return Object.keys(merged).length > 0
    ? ({ show: false, ...merged } as DataLabelConfig)
    : undefined;
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
    pushNumber(
      formatLabelNumber(context.percentage ?? 0, label.numberFormat ?? label.format ?? '0%'),
    );
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
      return {
        dx: 0,
        dy: 10,
        align: 'center',
        baseline: 'top',
        valueDelta: (v: number) => -Math.abs(v) * 0.08,
      };
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

function dataLabelOwnerKey(sourceSeriesIndex: number, pointIndex: number): string {
  return `dataLabel(seriesIdx=${sourceSeriesIndex},pointIdx=${pointIndex})`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
