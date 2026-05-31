import type { DataRow } from '../../grammar/spec';
import type { ChartConfig, ErrorBarConfig, SeriesConfig } from '../../types';
import { isHorizontalBarType } from './axis';
import {
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
} from './fields';
import { resolverContextFromConfig } from '../style-resolver';
import { linePointsToCanvasPx } from './units';
import { lineColor } from './data-row-style';

export function applyErrorBars(
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
