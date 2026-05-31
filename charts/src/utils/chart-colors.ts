import type { ChartFill, ChartFormat } from '../types';
import {
  applyChartTintShade,
  applyWorkbookThemePalette,
  chartColorTintShade,
  chartStyleRepeatThemeColor,
  chartThemeColorKey,
  chartThemeSlotKey,
  createChartWorkbookThemeColorPalette,
  normalizeChartHexColor,
  ooxmlSchemeColorHex,
  resolveChartColor,
  resolveChartColorDetailed,
  resolveChartTextColor,
  resolveChartThemeColorReference,
  resolveGridlineColor,
  type ChartThemeColorReference,
  type ChartWorkbookThemeColorEntry,
  type ChartWorkbookThemeColorPalette,
  type ResolveChartColorOptions,
} from '../core/style-resolver/color';
import { resolveChartFillColor } from '../core/style-resolver/resolver';

export {
  applyChartTintShade,
  applyWorkbookThemePalette,
  chartColorTintShade,
  chartStyleRepeatThemeColor,
  chartThemeColorKey,
  chartThemeSlotKey,
  createChartWorkbookThemeColorPalette,
  normalizeChartHexColor,
  ooxmlSchemeColorHex,
  resolveChartColor,
  resolveChartColorDetailed,
  resolveChartTextColor,
  resolveChartThemeColorReference,
  resolveGridlineColor,
};

export type {
  ChartThemeColorReference,
  ChartWorkbookThemeColorEntry,
  ChartWorkbookThemeColorPalette,
  ResolveChartColorOptions,
};

export function resolveSolidFillColor(
  fill: ChartFill | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  return resolveChartFillColor(fill, options);
}

export function resolveFormatFillColor(
  format: ChartFormat | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  return resolveChartFillColor(format?.fill, options);
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
