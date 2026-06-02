import type {
  ResolvedChartColorAuthoritySnapshot,
  ResolvedChartColorAuthoritySource,
  ResolvedChartPaintAuthoritySnapshot,
  ResolvedChartPointColorAuthoritySnapshot,
} from '@mog-sdk/contracts/data/charts';

import type {
  ChartColor,
  ChartConfig,
  ChartFormat,
  ChartSeriesStockRole,
  ChartType,
  PointFormat,
  SeriesConfig,
} from '../../types';
import { DEFAULT_CATEGORY_COLORS } from '../../utils/colors';
import {
  chartColorTintShade,
  chartStyleRepeatThemeColor,
  chartThemeColorKey,
  resolveChartColor,
  resolveFormatFillColor,
  resolveFormatLineColor,
} from '../../utils/chart-colors';
import {
  chartStyleOwner,
  resolveChartFillColor,
  resolveChartOwnerFormat,
  resolverContextFromConfig,
} from '../style-resolver';
import { isStrokeColoredSeries, variesColorsByCategory } from './style';

type PaintAuthority = ResolvedChartPaintAuthoritySnapshot;

interface ResolveSeriesColorAuthorityInput {
  config?: ChartConfig;
  series?: SeriesConfig;
  sourceSeriesIndex: number;
  renderedSeriesIndex?: number;
  fallbackType?: ChartType;
  stockSourceRole?: ChartSeriesStockRole;
  stockSourceRoleIndex?: number;
  stockSourceRoleOrder?: readonly ChartSeriesStockRole[];
}

export function resolveSeriesColorAuthority(
  input: ResolveSeriesColorAuthorityInput,
): ResolvedChartColorAuthoritySnapshot | undefined {
  const { config, series, sourceSeriesIndex, renderedSeriesIndex, fallbackType } = input;
  if (!config && !series) return undefined;

  const ownerKey = `series(${sourceSeriesIndex})`;
  const context = config ? resolverContextFromConfig(config, ownerKey) : {};
  const ownerFormat = config ? chartStyleOwner(config, ownerKey)?.format : undefined;
  const format = config
    ? resolveChartOwnerFormat(config, ownerKey, series?.format)
    : series?.format;

  const seriesColor = paintAuthorityFromColor({
    color: series?.color,
    source: 'seriesColor',
    ownerKey,
    context,
    explicit: true,
    fallback: false,
  });
  const fill = resolveFormatFillAuthority({
    format,
    directFormat: series?.format,
    ownerFormat,
    ownerKey,
    context,
    sourceSeriesIndex,
    source: 'seriesFormatFill',
  });
  const stroke = resolveFormatLineAuthority({
    format,
    directFormat: series?.format,
    ownerFormat,
    ownerKey,
    context,
    source: 'seriesFormatLine',
  });
  const markerFill = paintAuthorityFromColor({
    color: series?.markerBackgroundColor,
    source: 'markerBackground',
    ownerKey: `marker(seriesIdx=${sourceSeriesIndex})`,
    context,
    explicit: true,
    fallback: false,
  });
  const markerStroke = paintAuthorityFromColor({
    color: series?.markerForegroundColor,
    source: 'markerForeground',
    ownerKey: `marker(seriesIdx=${sourceSeriesIndex})`,
    context,
    explicit: true,
    fallback: false,
  });

  const primary =
    series && isStrokeColoredSeries(series, fallbackType)
      ? firstAuthority(seriesColor, stroke, fill)
      : firstAuthority(seriesColor, fill, stroke);
  const fallback =
    primary ??
    resolvePaletteFallbackAuthority({
      config,
      fallbackType,
      sourceSeriesIndex,
      renderedSeriesIndex,
      ownerKey,
      stockSourceRole: input.stockSourceRole,
      stockSourceRoleIndex: input.stockSourceRoleIndex,
      stockSourceRoleOrder: input.stockSourceRoleOrder,
    });
  const points = resolvePointColorAuthorities(config, series, sourceSeriesIndex);
  const summary = fallback ?? unknownAuthority(ownerKey);

  return {
    ownerKey,
    sourceSeriesIndex,
    ...(renderedSeriesIndex !== undefined ? { renderedSeriesIndex } : {}),
    ...(summary.color ? { color: summary.color } : {}),
    source: summary.source,
    explicit: summary.explicit,
    fallback: summary.fallback,
    ...(summary.themeSlot ? { themeSlot: summary.themeSlot } : {}),
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
    ...(markerFill ? { markerFill } : {}),
    ...(markerStroke ? { markerStroke } : {}),
    ...(points.length > 0 ? { points } : {}),
  };
}

function resolvePointColorAuthorities(
  config: ChartConfig | undefined,
  series: SeriesConfig | undefined,
  sourceSeriesIndex: number,
): ResolvedChartPointColorAuthoritySnapshot[] {
  if (!series?.points?.length) return [];
  return series.points
    .map((point) => resolvePointColorAuthority(config, series, sourceSeriesIndex, point))
    .filter((point): point is ResolvedChartPointColorAuthoritySnapshot => point !== undefined);
}

function resolvePointColorAuthority(
  config: ChartConfig | undefined,
  series: SeriesConfig,
  sourceSeriesIndex: number,
  point: PointFormat,
): ResolvedChartPointColorAuthoritySnapshot | undefined {
  const pointOwnerKey = `point(seriesIdx=${sourceSeriesIndex},pointIdx=${point.idx})`;
  const markerOwnerKey = `markerPoint(seriesIdx=${sourceSeriesIndex},pointIdx=${point.idx})`;
  const pointContext = config ? resolverContextFromConfig(config, pointOwnerKey) : {};
  const markerContext = config ? resolverContextFromConfig(config, markerOwnerKey) : {};
  const pointOwnerFormat = config ? chartStyleOwner(config, pointOwnerKey)?.format : undefined;
  const pointFormat = pointChartFormat(point);
  const format = config
    ? resolveChartOwnerFormat(config, pointOwnerKey, pointFormat)
    : pointFormat;
  const fill =
    paintAuthorityFromColor({
      color: point.fill,
      source: 'pointFill',
      ownerKey: pointOwnerKey,
      context: pointContext,
      explicit: true,
      fallback: false,
    }) ??
    resolveFormatFillAuthority({
      format,
      directFormat: pointFormat,
      ownerFormat: pointOwnerFormat,
      ownerKey: pointOwnerKey,
      context: pointContext,
      sourceSeriesIndex,
      source: 'pointVisualFormat',
    });
  const stroke =
    resolveFormatLineAuthority({
      format,
      directFormat: pointFormat,
      ownerFormat: pointOwnerFormat,
      ownerKey: pointOwnerKey,
      context: pointContext,
      source: 'pointVisualFormat',
    }) ??
    paintAuthorityFromColor({
      color: point.border?.color,
      source: 'pointVisualFormat',
      ownerKey: pointOwnerKey,
      context: pointContext,
      explicit: true,
      fallback: false,
    });
  const markerFill = paintAuthorityFromColor({
    color: point.markerBackgroundColor ?? series.markerBackgroundColor,
    source: 'markerBackground',
    ownerKey: markerOwnerKey,
    context: markerContext,
    explicit:
      point.markerBackgroundColor !== undefined || series.markerBackgroundColor !== undefined,
    fallback: false,
  });
  const markerStroke = paintAuthorityFromColor({
    color: point.markerForegroundColor ?? series.markerForegroundColor,
    source: 'markerForeground',
    ownerKey: markerOwnerKey,
    context: markerContext,
    explicit:
      point.markerForegroundColor !== undefined || series.markerForegroundColor !== undefined,
    fallback: false,
  });

  if (!fill && !stroke && !markerFill && !markerStroke) return undefined;
  return {
    pointIndex: point.idx,
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
    ...(markerFill ? { markerFill } : {}),
    ...(markerStroke ? { markerStroke } : {}),
  };
}

function resolveFormatFillAuthority(input: {
  format: ChartFormat | undefined;
  directFormat: ChartFormat | undefined;
  ownerFormat: ChartFormat | undefined;
  ownerKey: string;
  context: Parameters<typeof resolveChartColor>[1];
  sourceSeriesIndex: number;
  source: Extract<ResolvedChartColorAuthoritySource, 'seriesFormatFill' | 'pointVisualFormat'>;
}): PaintAuthority | undefined {
  const { format, directFormat, ownerFormat, ownerKey, context, sourceSeriesIndex, source } = input;
  const fill = format?.fill;
  if (!fill) return undefined;

  const fillTheme = fill.type === 'solid' ? chartThemeColorKey(fill.color) : undefined;
  const fillHasExplicitTransform =
    fill.type === 'solid' && chartColorTintShade(fill.color) !== undefined;
  const componentSource = formatComponentSource(directFormat?.fill, ownerFormat?.fill, source);
  const explicitColor = fillHasExplicitTransform
    ? resolveFormatFillColor({ fill }, context)
    : undefined;
  if (explicitColor) {
    return {
      color: explicitColor,
      source: componentSource,
      ownerKey,
      explicit: true,
      fallback: false,
      ...(fillTheme ? { themeSlot: fillTheme } : {}),
    };
  }

  const repeatedThemeColor = chartStyleRepeatThemeColor(fillTheme, sourceSeriesIndex);
  if (repeatedThemeColor) {
    return {
      color: repeatedThemeColor,
      source: 'themeRepeat',
      ownerKey,
      explicit: false,
      fallback: true,
      ...(fillTheme ? { themeSlot: fillTheme } : {}),
    };
  }

  const color = resolveChartFillColor(fill, context);
  if (!color) return undefined;
  return {
    color,
    source: componentSource,
    ownerKey,
    explicit: true,
    fallback: false,
    ...(fillTheme ? { themeSlot: fillTheme } : {}),
  };
}

function resolveFormatLineAuthority(input: {
  format: ChartFormat | undefined;
  directFormat: ChartFormat | undefined;
  ownerFormat: ChartFormat | undefined;
  ownerKey: string;
  context: Parameters<typeof resolveChartColor>[1];
  source: Extract<ResolvedChartColorAuthoritySource, 'seriesFormatLine' | 'pointVisualFormat'>;
}): PaintAuthority | undefined {
  const { format, directFormat, ownerFormat, ownerKey, context, source } = input;
  if (format?.line?.noFill === true) return undefined;
  const color = resolveFormatLineColor(format, context);
  if (!color) return undefined;
  const lineColor = format?.line?.color;
  const themeSlot = chartThemeColorKey(lineColor);
  return {
    color,
    source: formatComponentSource(directFormat?.line, ownerFormat?.line, source),
    ownerKey,
    explicit: true,
    fallback: false,
    ...(themeSlot ? { themeSlot } : {}),
  };
}

function resolvePaletteFallbackAuthority(input: {
  config: ChartConfig | undefined;
  fallbackType: ChartType | undefined;
  sourceSeriesIndex: number;
  renderedSeriesIndex: number | undefined;
  ownerKey: string;
  stockSourceRole: ChartSeriesStockRole | undefined;
  stockSourceRoleIndex: number | undefined;
  stockSourceRoleOrder: readonly ChartSeriesStockRole[] | undefined;
}): PaintAuthority | undefined {
  const { config, sourceSeriesIndex, renderedSeriesIndex, ownerKey } = input;
  if (!config) {
    return defaultPaletteAuthority(sourceSeriesIndex, ownerKey);
  }

  const context = resolverContextFromConfig(config, 'chartArea');
  const configColor =
    colorFromPalette(config.colors, sourceSeriesIndex, context) ??
    colorFromPalette(config.colors, renderedSeriesIndex, context);
  if (configColor) {
    return {
      color: configColor,
      source: 'configPalette',
      ownerKey,
      explicit: true,
      fallback: false,
    };
  }

  if (variesColorsByCategory(config)) {
    const theme =
      WORKBOOK_THEME_CATEGORY_COLOR_SLOTS[
        sourceSeriesIndex % WORKBOOK_THEME_CATEGORY_COLOR_SLOTS.length
      ];
    const workbookThemeColor = resolveChartColor({ theme }, context);
    if (workbookThemeColor) {
      return {
        color: workbookThemeColor,
        source: 'workbookTheme',
        ownerKey,
        explicit: false,
        fallback: true,
        themeSlot: theme,
      };
    }
  }

  const stockDefault = stockRoleDefaultAuthority(input);
  if (stockDefault) return stockDefault;

  return defaultPaletteAuthority(sourceSeriesIndex, ownerKey);
}

const EXCEL_STOCK_ROLE_DEFAULT_COLOR_AUTHORITY_SOURCE: ResolvedChartColorAuthoritySource =
  'excelStockRoleDefault';
const EXCEL_STOCK_ROLE_DEFAULT_COLORS = [
  '#4472c4',
  '#ed7d31',
  '#a5a5a5',
  '#ffc000',
  '#5b9bd5',
];

function stockRoleDefaultAuthority(input: {
  fallbackType: ChartType | undefined;
  ownerKey: string;
  stockSourceRole: ChartSeriesStockRole | undefined;
  stockSourceRoleIndex: number | undefined;
  stockSourceRoleOrder: readonly ChartSeriesStockRole[] | undefined;
}): PaintAuthority | undefined {
  if (input.fallbackType !== 'stock') return undefined;
  if (!input.stockSourceRole || !input.stockSourceRoleOrder?.length) return undefined;
  const roleIndex = stockRoleDefaultIndex({
    role: input.stockSourceRole,
    roleIndex: input.stockSourceRoleIndex,
    sourceRoleOrder: input.stockSourceRoleOrder,
  });
  if (roleIndex === undefined) return undefined;
  const color =
    EXCEL_STOCK_ROLE_DEFAULT_COLORS[roleIndex % EXCEL_STOCK_ROLE_DEFAULT_COLORS.length];
  if (!color) return undefined;
  return {
    color,
    source: EXCEL_STOCK_ROLE_DEFAULT_COLOR_AUTHORITY_SOURCE,
    ownerKey: input.ownerKey,
    explicit: false,
    fallback: false,
  };
}

function stockRoleDefaultIndex(input: {
  role: ChartSeriesStockRole;
  roleIndex: number | undefined;
  sourceRoleOrder: readonly ChartSeriesStockRole[];
}): number | undefined {
  if (
    input.roleIndex !== undefined &&
    input.roleIndex >= 0 &&
    input.sourceRoleOrder[input.roleIndex] === input.role
  ) {
    return input.roleIndex;
  }
  const index = input.sourceRoleOrder.indexOf(input.role);
  return index >= 0 ? index : undefined;
}

function defaultPaletteAuthority(index: number, ownerKey: string): PaintAuthority {
  return {
    color: DEFAULT_CATEGORY_COLORS[index % DEFAULT_CATEGORY_COLORS.length] ?? '#1f77b4',
    source: 'defaultPalette',
    ownerKey,
    explicit: false,
    fallback: true,
  };
}

function colorFromPalette(
  palette: string[] | undefined,
  index: number | undefined,
  context: Parameters<typeof resolveChartColor>[1],
): string | undefined {
  if (!palette?.length || index === undefined) return undefined;
  const color = palette[index % palette.length];
  return resolveChartColor(color, context);
}

function paintAuthorityFromColor(input: {
  color: ChartColor | undefined;
  source: ResolvedChartColorAuthoritySource;
  ownerKey: string;
  context: Parameters<typeof resolveChartColor>[1];
  explicit: boolean;
  fallback: boolean;
}): PaintAuthority | undefined {
  const { color, source, ownerKey, context, explicit, fallback } = input;
  const resolved = resolveChartColor(color, context);
  if (!resolved) return undefined;
  const themeSlot = chartThemeColorKey(color);
  return {
    color: resolved,
    source,
    ownerKey,
    explicit,
    fallback,
    ...(themeSlot ? { themeSlot } : {}),
  };
}

function firstAuthority(
  ...authorities: Array<PaintAuthority | undefined>
): PaintAuthority | undefined {
  return authorities.find((authority) => authority?.color);
}

function unknownAuthority(ownerKey: string): PaintAuthority {
  return {
    source: 'unknown',
    ownerKey,
    explicit: false,
    fallback: true,
  };
}

function formatComponentSource(
  directValue: unknown,
  ownerValue: unknown,
  directSource: ResolvedChartColorAuthoritySource,
): ResolvedChartColorAuthoritySource {
  if (directValue !== undefined) return directSource;
  if (ownerValue !== undefined) return 'chartStyleOwner';
  return directSource;
}

function pointChartFormat(point: PointFormat): ChartFormat | undefined {
  const base = point.visualFormat;
  if (!point.lineFormat) return base;
  return { ...(base ?? {}), line: point.lineFormat };
}

const WORKBOOK_THEME_CATEGORY_COLOR_SLOTS = [
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
] as const;
