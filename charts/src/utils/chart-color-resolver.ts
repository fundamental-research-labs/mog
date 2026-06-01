import type { ChartColor } from '../types';
import type {
  ChartThemeColorReference,
  ChartWorkbookThemeColorPalette,
  ResolveChartColorOptions,
  ResolvedColor,
} from './chart-color-types';
import { normalizeDirectColorString } from './chart-color-normalization';
import { applyChartTintShade } from './chart-color-transforms';
import { resolveThemeSlot } from './chart-color-drawing';
import {
  chartColorTintShade,
  chartThemeColorKey,
  isThemeColorReference,
} from './chart-theme-colors';

export function resolveChartColorDetailed(
  color: ChartColor | ChartThemeColorReference | undefined,
  options: ResolveChartColorOptions = {},
): ResolvedColor | undefined {
  if (typeof color === 'string') {
    const normalized = normalizeDirectColorString(color);
    return { color: normalized ?? color };
  }
  if (!isThemeColorReference(color)) return undefined;
  const resolved = resolveThemeSlot(color.theme, options);
  if (!resolved) return undefined;
  const tintShade = chartColorTintShade(color);
  return {
    color: applyChartTintShade(resolved.color, tintShade),
    ...(resolved.opacity !== undefined ? { opacity: resolved.opacity } : {}),
  };
}

export function resolveChartThemeColorReference(
  color: ChartThemeColorReference,
  palette: ChartWorkbookThemeColorPalette,
): string | ChartThemeColorReference {
  const resolved = resolveChartColorDetailed(color, { palette });
  return resolved?.color ?? color;
}

export function resolveChartColor(
  color: ChartColor | ChartThemeColorReference | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  return resolveChartColorDetailed(color, options)?.color;
}

export function resolveChartTextColor(
  color: ChartColor | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  if (chartThemeColorKey(color) === 'tx1' && chartColorTintShade(color) === undefined) {
    return '#595959';
  }
  return resolveChartColor(color, options);
}

export function resolveGridlineColor(
  color: ChartColor | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  return resolveChartColor(color, options);
}

export function applyWorkbookThemePalette<T>(value: T, palette: ChartWorkbookThemeColorPalette): T {
  if (Array.isArray(value)) {
    return value.map((item) => applyWorkbookThemePalette(item, palette)) as T;
  }
  if (isThemeColorReference(value)) {
    return resolveChartThemeColorReference(value, palette) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = applyWorkbookThemePalette(item, palette);
    }
    return output as T;
  }
  return value;
}
