import type { MarkSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartFormat, ChartLineSettings } from '../../../types';
import { resolveFormatFillColor, resolveLineColor } from '../../../utils/chart-colors';
import { resolveChartLineStyle, resolverContextFromConfig } from '../../style-resolver';
import { ANALYSIS_FILL_FIELD, ANALYSIS_STROKE_FIELD, ANALYSIS_STROKE_WIDTH_FIELD } from '../fields';
import { linePointsToCanvasPx } from '../units';
import { upDownStrokeWidth } from './analysis-line-settings';

export function lineMark(
  config: ChartConfig,
  settings: ChartLineSettings | undefined,
  fallbackStroke: string,
): MarkSpec {
  const line = settings?.format;
  const context = resolverContextFromConfig(config, 'analysisLine');
  const resolvedLine = resolveChartLineStyle(line, context, {
    widthToPx: linePointsToCanvasPx,
  });
  const stroke = resolvedLine?.paint?.type === 'solid' ? resolvedLine.paint.color : undefined;
  const mark: MarkSpec = {
    type: 'rule',
    stroke: stroke ?? resolveLineColor(line, context) ?? fallbackStroke,
    strokeWidth: resolvedLine?.width ?? linePointsToCanvasPx(line?.width) ?? 1,
    strokeField: ANALYSIS_STROKE_FIELD,
    strokeWidthField: ANALYSIS_STROKE_WIDTH_FIELD,
  };
  if (resolvedLine?.dash) mark.strokeDash = resolvedLine.dash;
  if (resolvedLine) mark.line = resolvedLine;
  if (resolvedLine?.opacity !== undefined) mark.opacity = resolvedLine.opacity;
  return mark;
}

export function upDownMark(
  config: ChartConfig,
  format: ChartFormat | undefined,
  fallback: string,
): MarkSpec {
  const context = resolverContextFromConfig(config, 'upDownBars');
  const stroke =
    resolveFormatFillColor(format, context) ?? resolveLineColor(format?.line, context) ?? fallback;
  return {
    type: 'rule',
    stroke,
    strokeWidth: upDownStrokeWidth(config) ?? 8,
    strokeField: ANALYSIS_FILL_FIELD,
    strokeWidthField: ANALYSIS_STROKE_WIDTH_FIELD,
  };
}
