import type { MarkSpec } from '../../grammar/spec';
import type { ChartConfig } from '../../types';
import { resolveLineColor } from '../../utils/chart-colors';
import {
  resolveChartFillPaint,
  resolveChartLineStyle,
  resolveChartOwnerFormat,
  resolverContextFromConfig,
} from '../style-resolver';
import { MARK_TYPE_MAP } from './constants';
import { POINT_FILL_FIELD, POINT_STROKE_FIELD, POINT_STROKE_WIDTH_FIELD } from './fields';
import { hasVisibleLineStyle, isNoFillNoLineSeries } from './style';
import { linePointsToCanvasPx } from './units';

export function applyPrimarySeriesFormat(mark: MarkSpec, config: ChartConfig): void {
  const seriesIndex = config.series?.findIndex((item) => !isNoFillNoLineSeries(item)) ?? -1;
  if (seriesIndex < 0) return;

  const series = config.series?.[seriesIndex];
  const format = resolveChartOwnerFormat(config, `series(${seriesIndex})`, series?.format);
  if (!format) return;
  const context = resolverContextFromConfig(config, `series(${seriesIndex})`);
  const fillPaint = resolveChartFillPaint(format.fill, context);
  if (fillPaint) mark.fillPaint = fillPaint;
  const line = resolveChartLineStyle(format.line, context, {
    widthToPx: linePointsToCanvasPx,
  });
  if (line) {
    mark.line = line;
    if (line.paint?.type === 'solid') mark.stroke = line.paint.color;
    if (line.width !== undefined) mark.strokeWidth = line.width;
    if (line.dash) mark.strokeDash = line.dash;
  }
}

export function applyPointStyleFields(mark: MarkSpec, config: ChartConfig): void {
  if (!hasPointStyleOverrides(config)) return;
  mark.fillField = POINT_FILL_FIELD;
  mark.strokeField = POINT_STROKE_FIELD;
  mark.strokeWidthField = POINT_STROKE_WIDTH_FIELD;
}

export function hasPointStyleOverrides(config: ChartConfig): boolean {
  return (config.series ?? []).some((series) =>
    (series.points ?? []).some(
      (point) =>
        point.fill !== undefined ||
        point.border !== undefined ||
        point.lineFormat !== undefined ||
        point.visualFormat?.fill !== undefined ||
        point.visualFormat?.line !== undefined,
    ),
  );
}

export function applyImportedBarOutline(mark: MarkSpec, config: ChartConfig): void {
  if (MARK_TYPE_MAP[config.type] !== 'bar') return;
  const line = config.series?.find(
    (series) => !isNoFillNoLineSeries(series) && hasVisibleLineStyle(series.format?.line),
  )?.format?.line;
  if (!line) return;

  mark.stroke =
    resolveLineColor(line, resolverContextFromConfig(config, 'series')) ?? mark.stroke ?? '#000000';
  const strokeWidth = linePointsToCanvasPx(line.width);
  if (strokeWidth !== undefined) mark.strokeWidth = strokeWidth;
}
