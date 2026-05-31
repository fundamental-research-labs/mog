import type { ChartFill, ChartFormat } from '../types';
import type { ResolveChartColorOptions } from './chart-color-types';
import { resolveChartColor } from './chart-color-resolver';

export function resolveSolidFillColor(
  fill: ChartFill | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  return resolveFillColor(fill, options);
}

export function resolveFormatFillColor(
  format: ChartFormat | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  return resolveFillColor(format?.fill, options);
}

export function resolveFormatFillOpacity(format: ChartFormat | undefined): number | undefined {
  const transparency = format?.fill?.type === 'solid' ? format.fill.transparency : undefined;
  if (typeof transparency !== 'number' || !Number.isFinite(transparency)) return undefined;
  return Math.max(0, Math.min(1, 1 - transparency));
}

export function resolveLineColor(
  line: ChartFormat['line'] | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  return resolveChartColor(line?.color, options);
}

export function resolveFormatLineColor(
  format: ChartFormat | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  return resolveChartColor(format?.line?.color, options);
}

function resolveFillColor(
  fill: ChartFill | undefined,
  options: ResolveChartColorOptions,
): string | undefined {
  if (!fill) return undefined;
  switch (fill.type) {
    case 'none':
      return undefined;
    case 'solid':
      return resolveChartColor(fill.color, options);
    case 'pattern':
      return (
        resolveChartColor(fill.foreground, options) ?? resolveChartColor(fill.background, options)
      );
    case 'gradient':
      return fill.stops.length > 0 ? resolveChartColor(fill.stops[0]?.color, options) : undefined;
  }
}
