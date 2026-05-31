import type { MarkSpec } from '../../../grammar/spec';
import type { ChartConfig, TrendlineConfig } from '../../../types';
import { resolveChartLineStyle, resolverContextFromConfig } from '../../style-resolver';
import { linePointsToCanvasPx } from '../units';

export function buildTrendlineMark(config: ChartConfig, trendline: TrendlineConfig): MarkSpec {
  const resolvedLine = resolveChartLineStyle(
    trendline.lineFormat,
    resolverContextFromConfig(config, 'trendline'),
    { widthToPx: linePointsToCanvasPx },
  );
  const mark: MarkSpec = {
    type: 'line',
    stroke:
      trendline.color ??
      (resolvedLine?.paint?.type === 'solid' ? resolvedLine.paint.color : undefined),
    strokeWidth: trendline.lineWidth ?? resolvedLine?.width ?? 2,
  };
  if (resolvedLine) {
    mark.line = {
      ...resolvedLine,
      ...(trendline.color ? { paint: { type: 'solid' as const, color: trendline.color } } : {}),
      ...(trendline.lineWidth !== undefined ? { width: trendline.lineWidth } : {}),
    };
  }
  if (resolvedLine?.dash) mark.strokeDash = resolvedLine.dash;
  if (resolvedLine?.opacity !== undefined) mark.opacity = resolvedLine.opacity;
  if (trendline.lineFormat?.noFill === true) {
    mark.opacity = 0;
    mark.strokeWidth = 0;
    mark.line = { ...(mark.line ?? {}), paint: { type: 'none' } };
  }
  return mark;
}
