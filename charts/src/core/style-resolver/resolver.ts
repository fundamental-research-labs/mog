import type { ChartConfig, ChartFill, ChartFormat, ChartLineFormat, ChartShadow } from '../../types';
import type { LineStyleSpec, PaintSpec, ShadowSpec } from '../../primitives/types';
import {
  chartStyleRepeatThemeColor,
  chartThemeColorKey,
  chartColorTintShade,
  resolveChartColor,
  resolveChartColorDetailed,
  type ResolveChartColorOptions,
} from './color';

export type ChartStyleResolverContext = ResolveChartColorOptions & {
  config?: ChartConfig;
};

export type ResolvedChartElementStyle = {
  paint?: PaintSpec;
  line?: LineStyleSpec;
  text?: {
    color?: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: 'normal' | 'bold' | number;
    fontStyle?: 'normal' | 'italic';
    underline?: boolean;
    strikethrough?: boolean;
  };
  shadow?: ShadowSpec;
  roundedFrame?: { radius: number };
};

export function resolverContextFromConfig(
  config: ChartConfig,
  ownerKey?: string,
): ChartStyleResolverContext {
  return {
    config,
    workbookTheme: config.workbookTheme,
    colorMapOverride: config.chartStyleContext?.colorMapOverride,
    ownerKey,
    diagnostics: config.chartStyleContext?.diagnostics,
  };
}

export function resolveChartFillPaint(
  fill: ChartFill | undefined,
  context: ChartStyleResolverContext = {},
): PaintSpec | undefined {
  if (!fill) return undefined;
  switch (fill.type) {
    case 'none':
      return { type: 'none' };
    case 'solid': {
      const color = resolveChartColorDetailed(fill.color, context);
      if (!color) return undefined;
      return {
        type: 'solid',
        color: color.color,
        opacity: multiplyOpacity(color.opacity, fill.transparency),
      };
    }
    case 'gradient': {
      const stops = fill.stops
        .map((stop) => {
          const color = resolveChartColorDetailed(stop.color, context);
          if (!color) return undefined;
          return {
            offset: stop.position,
            color: color.color,
            opacity: multiplyOpacity(color.opacity, stop.transparency),
          };
        })
        .filter(Boolean) as Array<{ offset: number; color: string; opacity?: number }>;
      if (stops.length === 0) return undefined;
      if (fill.gradientType === 'radial') {
        return { type: 'radialGradient', stops };
      }
      if (fill.gradientType === 'rectangular') {
        return { type: 'rectangularGradient', stops };
      }
      return { type: 'linearGradient', angle: fill.angle, stops };
    }
    case 'pattern':
      return {
        type: 'pattern',
        pattern: fill.pattern,
        foreground: resolveChartColor(fill.foreground, context),
        background: resolveChartColor(fill.background, context),
      };
  }
}

export function resolveChartFillColor(
  fill: ChartFill | undefined,
  context: ChartStyleResolverContext = {},
): string | undefined {
  const paint = resolveChartFillPaint(fill, context);
  if (paint?.type === 'solid') return paint.color;
  if (paint?.type === 'pattern') return paint.foreground ?? paint.background;
  if (
    (paint?.type === 'linearGradient' ||
      paint?.type === 'radialGradient' ||
      paint?.type === 'rectangularGradient') &&
    paint.stops.length > 0
  ) {
    return paint.stops[0]?.color;
  }
  return undefined;
}

export function resolveChartLineStyle(
  line: ChartLineFormat | undefined,
  context: ChartStyleResolverContext = {},
  options: { widthToPx?: (width: number | undefined) => number | undefined } = {},
): LineStyleSpec | undefined {
  if (!line) return undefined;
  const color = line.color ? resolveChartColorDetailed(line.color, context) : undefined;
  const width = options.widthToPx ? options.widthToPx(line.width) : line.width;
  const dash = dashStyleToStrokeDash(line.dashStyle, width);
  if (!color && width === undefined && !dash && line.transparency === undefined) return undefined;
  return {
    ...(color ? { paint: { type: 'solid', color: color.color, opacity: color.opacity } } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(dash ? { dash } : {}),
    opacity: multiplyOpacity(color?.opacity, line.transparency),
  };
}

export function resolveChartShadow(
  shadow: ChartShadow | undefined,
  context: ChartStyleResolverContext = {},
): ShadowSpec | undefined {
  if (!shadow || shadow.visible === false) return undefined;
  const color = resolveChartColorDetailed(shadow.color, context);
  return {
    color: color?.color ?? '#000000',
    blur: shadow.blur,
    offsetX: shadow.offsetX,
    offsetY: shadow.offsetY,
    opacity: multiplyOpacity(color?.opacity, shadow.transparency),
  };
}

export function resolveChartElementStyle(
  format: ChartFormat | undefined,
  context: ChartStyleResolverContext = {},
  options: { widthToPx?: (width: number | undefined) => number | undefined } = {},
): ResolvedChartElementStyle {
  const textColor = resolveChartColor(format?.font?.color, context);
  return {
    paint: resolveChartFillPaint(format?.fill, context),
    line: resolveChartLineStyle(format?.line, context, options),
    text: format?.font
      ? {
          color: textColor,
          fontFamily: format.font.name,
          fontSize: format.font.size,
          fontWeight: format.font.bold ? 'bold' : undefined,
          fontStyle: format.font.italic === undefined ? undefined : format.font.italic ? 'italic' : 'normal',
          underline: format.font.underline !== undefined && format.font.underline !== 'none',
          strikethrough: format.font.strikethrough !== undefined,
        }
      : undefined,
    shadow: resolveChartShadow(format?.shadow, context),
  };
}

export function resolveSeriesColor(
  format: ChartFormat | undefined,
  seriesColor: string | undefined,
  sourceSeriesIndex: number,
  context: ChartStyleResolverContext = {},
): string | undefined {
  const fill = format?.fill;
  const fillTheme = fill?.type === 'solid' ? chartThemeColorKey(fill.color) : undefined;
  const fillHasExplicitTransform =
    fill?.type === 'solid' && chartColorTintShade(fill.color) !== undefined;
  return (
    (seriesColor ? resolveChartColor(seriesColor, context) : undefined) ??
    (fillHasExplicitTransform ? resolveChartFillColor(format?.fill, context) : undefined) ??
    chartStyleRepeatThemeColor(fillTheme, sourceSeriesIndex) ??
    resolveChartFillColor(format?.fill, context) ??
    resolveChartColor(format?.line?.color, context)
  );
}

function dashStyleToStrokeDash(
  dashStyle: NonNullable<ChartLineFormat['dashStyle']> | undefined,
  width: number | undefined,
): number[] | undefined {
  const unit = Math.max(1, width ?? 1);
  switch (dashStyle) {
    case 'dot':
      return [unit, unit * 2];
    case 'dash':
      return [unit * 4, unit * 2];
    case 'dashDot':
      return [unit * 4, unit * 2, unit, unit * 2];
    case 'longDash':
      return [unit * 8, unit * 2];
    case 'longDashDot':
      return [unit * 8, unit * 2, unit, unit * 2];
    case 'longDashDotDot':
      return [unit * 8, unit * 2, unit, unit * 2, unit, unit * 2];
    default:
      return undefined;
  }
}

function multiplyOpacity(
  existingOpacity: number | undefined,
  transparency: number | undefined,
): number | undefined {
  const fromTransparency =
    typeof transparency === 'number' && Number.isFinite(transparency)
      ? Math.max(0, Math.min(1, 1 - transparency))
      : undefined;
  if (existingOpacity === undefined) return fromTransparency;
  if (fromTransparency === undefined) return existingOpacity;
  return existingOpacity * fromTransparency;
}
