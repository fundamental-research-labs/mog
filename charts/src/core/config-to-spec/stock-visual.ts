import type {
  DataRow,
  StockGlyphHighLowEndpointPolicySpec,
  StockGlyphBodyVisualSpec,
  StockGlyphSourceRoleMarkerVisualSpec,
  StockGlyphSourceRoleVisualSpec,
  StockGlyphStrokeVisualSpec,
  StockGlyphSubType,
  StockGlyphVisualContractStatus,
  StockGlyphVisualSource,
  StockGlyphVisualSpec,
} from '../../grammar/spec';
import {
  NATIVE_STOCK_GLYPH_PROFILE,
  nativeStockSlotOccupancyForGapWidth,
} from '../../grammar/stock-glyph-profile';
import type {
  ChartConfig,
  ChartFormat,
  ChartLineFormat,
  ChartSeriesStockRole,
  SeriesConfig,
} from '../../types';
import { resolveChartColor } from '../../utils/chart-colors';
import { stockRolePlan } from '../data-extractor-imported';
import { stockSourceCompositionFromConfig, stockValueAxisRoles } from '../stock-semantics';
import { excelMarkerShape, markerPointSizeToArea } from './data-row-style';
import {
  chartStyleOwner,
  resolveChartFillColor,
  resolveChartFillPaint,
  resolveChartLineStyle,
  resolveChartOwnerFormat,
  resolverContextFromConfig,
} from '../style-resolver';
import { STOCK_OPEN_FIELD, STOCK_VOLUME_FIELD } from './fields';
import { resolveSeriesColorAuthority } from './color-authority';
import { linePointsToCanvasPx } from './units';

const DEFAULT_STOCK_STROKE = '#000000';
const DEFAULT_UP_FILL = '#ffffff';
const DEFAULT_DOWN_FILL = '#7f7f7f';
const DEFAULT_VOLUME_FILL = '#5b9bd5';
const DEFAULT_VOLUME_BORDER = '#3f6f9f';
const DEFAULT_SOURCE_ROLE_COLORS = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5'];
const DEFAULT_PRICE_GAP_WIDTH = NATIVE_STOCK_GLYPH_PROFILE.effectiveGapWidth;
const LEGACY_PRICE_GAP_WIDTH = 150;
const DEFAULT_VOLUME_GAP_WIDTH = 150;
const DEFAULT_VOLUME_SURFACE_FRACTION = 0.24;

interface BodyDefaults {
  fill: string;
  fillOpacity?: number;
  border: string;
  borderWidth: number;
  borderOpacity?: number;
}

export function resolveStockGlyphVisual(input: {
  config: ChartConfig;
  rows: DataRow[];
  subType: StockGlyphSubType;
}): StockGlyphVisualSpec {
  const { config, rows, subType } = input;
  const sourceSeries = stockSourceSeries(config.series ?? []);
  const stockConfig = { ...config, subType };
  const composition = stockSourceCompositionFromConfig(stockConfig);
  const volumeAxisPolicy = composition.volumeAxisPolicy;
  const highLowEndpointPolicy: StockGlyphHighLowEndpointPolicySpec = {
    type: 'sourceRoleExtents',
    roles: stockValueAxisRoles(stockConfig),
  };
  const priceGlyphMode =
    config.upDownBars !== undefined
      ? 'upDownBody'
      : subType === 'ohlc' || subType === 'volume-ohlc'
        ? 'ohlcTick'
        : 'hlcTick';
  const nativeTickProfile = usesNativeStockTickProfile(subType, priceGlyphMode);
  const priceGapWidth = stockGapWidth(
    config.upDownBars?.gapWidth ?? config.gapWidth,
    nativeTickProfile ? DEFAULT_PRICE_GAP_WIDTH : LEGACY_PRICE_GAP_WIDTH,
  );
  const slotOccupancy = nativeTickProfile
    ? slotOccupancyForGapWidth(priceGapWidth)
    : volumeSlotOccupancyForGapWidth(priceGapWidth);
  const highLowLineFormat = config.highLowLines?.format;
  const highLowLine = resolveStockStroke({
    config,
    line: highLowLineFormat,
    ownerKey: highLowLineFormat ? 'highLowLines' : seriesOwnerKey(sourceSeries.high),
    fallbackStroke: DEFAULT_STOCK_STROKE,
    fallbackWidth: nativeTickProfile ? NATIVE_STOCK_GLYPH_PROFILE.stemStrokeWidth : 1,
    source: highLowLineFormat ? 'importedHighLowLines' : 'excelDefault',
    honorNoFill: highLowLineFormat !== undefined,
  });
  const openTick = stockTickStroke(highLowLine, nativeTickProfile);
  const closeTick = stockTickStroke(highLowLine, nativeTickProfile);

  const upBody = resolveStockBody({
    config,
    format: config.upDownBars?.upFormat,
    ownerKey: 'upDownBars',
    defaults: {
      fill: DEFAULT_UP_FILL,
      border: DEFAULT_STOCK_STROKE,
      borderWidth: 1,
    },
    source: config.upDownBars?.upFormat ? 'importedUpDownBars' : 'excelDefault',
  });
  const downBody = resolveStockBody({
    config,
    format: config.upDownBars?.downFormat,
    ownerKey: 'upDownBars',
    defaults: {
      fill: DEFAULT_DOWN_FILL,
      border: DEFAULT_STOCK_STROKE,
      borderWidth: 1,
    },
    source: config.upDownBars?.downFormat ? 'importedUpDownBars' : 'excelDefault',
  });
  const flatBody = { ...upBody };
  const volume =
    isVolumeStockSubType(subType) && volumeAxisPolicy === 'separateVolumeAxis'
      ? resolveVolumeVisual(config, sourceSeries.volume)
      : undefined;
  const expectsSourceRoleVisuals = composition.sourceKind !== 'modeled';
  const sourceRoleVisuals = expectsSourceRoleVisuals
    ? resolveSourceRoleVisuals(config, sourceSeries, composition)
    : [];

  const missingReasons = stockVisualMissingReasons({
    rows,
    priceGlyphMode,
    requiresVolume: isVolumeStockSubType(subType) && volumeAxisPolicy === 'separateVolumeAxis',
    hasVolumeVisual:
      !isVolumeStockSubType(subType) ||
      volumeAxisPolicy === 'stockValueAxis' ||
      volume !== undefined,
    sourceRoleVisuals,
    expectedSourceRoleCount: expectsSourceRoleVisuals ? composition.sourceRoleOrder.length : 0,
  });
  const visualStatus = missingReasons.length > 0 ? 'incomplete' : 'available';
  const styleSources = uniqueStyleSources([
    highLowLine.source,
    openTick.source,
    closeTick.source,
    upBody.source,
    downBody.source,
    flatBody.source,
    volume?.source,
    ...sourceRoleVisuals.flatMap((visual) => [visual.line.source, visual.marker.source]),
  ]);

  return {
    visualStatus,
    ...(missingReasons.length > 0 ? { visualStatusReason: missingReasons.join(';') } : {}),
    priceGlyphMode,
    volumeAxisPolicy,
    highLowEndpointPolicy,
    gapWidth: priceGapWidth,
    slotOccupancy,
    drawOrder:
      priceGlyphMode === 'upDownBody'
        ? [...(volume ? ['volume' as const] : []), 'highLowStem', 'body']
        : [...(volume ? ['volume' as const] : []), 'highLowStem', 'openTick', 'closeTick'],
    highLowLine,
    openTick,
    closeTick,
    upBody,
    downBody,
    flatBody,
    ...(volume ? { volume } : {}),
    ...(sourceRoleVisuals.length > 0 ? { sourceRoleVisuals } : {}),
    ...(config.highLowLines !== undefined ? { importedHighLowLines: true } : {}),
    ...(config.upDownBars !== undefined ? { importedUpDownBars: true } : {}),
    styleSources,
  };
}

function resolveVolumeVisual(
  config: ChartConfig,
  volumeSeries: StockSourceSeries | undefined,
): StockGlyphVisualSpec['volume'] {
  const ownerKey = seriesOwnerKey(volumeSeries);
  const context = resolverContextFromConfig(config, ownerKey);
  const fallbackFill =
    resolveChartColor(volumeSeries?.series.color, context) ??
    resolveChartColor(config.colors?.[0], resolverContextFromConfig(config, 'chartArea')) ??
    DEFAULT_VOLUME_FILL;
  const body = resolveStockBody({
    config,
    format: volumeSeries?.series.format,
    ownerKey,
    defaults: {
      fill: fallbackFill,
      fillOpacity: 0.72,
      border: DEFAULT_VOLUME_BORDER,
      borderWidth: 0,
    },
    source: volumeSeries ? 'volumeSeriesFormat' : 'excelDefault',
  });
  const visualStatus = resolveVolumeVisualStatus({
    config,
    volumeSeries,
    ownerKey,
  });
  const gapWidth = stockGapWidth(
    volumeSeries?.series.gapWidth ?? config.gapWidth,
    DEFAULT_VOLUME_GAP_WIDTH,
  );
  return {
    ...body,
    visualStatus: visualStatus.status,
    ...(visualStatus.reason ? { visualStatusReason: visualStatus.reason } : {}),
    gapWidth,
    slotOccupancy: volumeSlotOccupancyForGapWidth(gapWidth),
    surfacePolicy: {
      type: 'plotFraction',
      fraction: DEFAULT_VOLUME_SURFACE_FRACTION,
    },
  };
}

function resolveVolumeVisualStatus(input: {
  config: ChartConfig;
  volumeSeries: StockSourceSeries | undefined;
  ownerKey: string;
}): { status: StockGlyphVisualContractStatus; reason?: string } {
  if (!input.volumeSeries) {
    return { status: 'missing', reason: 'stockVolumeSourceSeriesMissing' };
  }
  const series = input.volumeSeries.series;
  const ownerFormat = chartStyleOwner(input.config, input.ownerKey)?.format;
  const missing: string[] = [];
  if (
    series.color === undefined &&
    series.format?.fill === undefined &&
    ownerFormat?.fill === undefined
  ) {
    missing.push('fill');
  }
  if (series.format?.line === undefined && ownerFormat?.line === undefined) {
    missing.push('border');
  }
  if (series.gapWidth === undefined && input.config.gapWidth === undefined) {
    missing.push('gapWidth');
  }
  if (missing.length > 0) {
    return {
      status: 'approximate',
      reason: `stockVolumeVisualAuthorityMissing:${missing.join(',')}`,
    };
  }
  return { status: 'exact' };
}

function resolveStockStroke(input: {
  config: ChartConfig;
  line: ChartLineFormat | undefined;
  ownerKey: string;
  fallbackStroke: string;
  fallbackWidth: number;
  source: StockGlyphVisualSource;
  honorNoFill?: boolean;
}): StockGlyphStrokeVisualSpec {
  const context = resolverContextFromConfig(input.config, input.ownerKey);
  if (input.honorNoFill && input.line?.noFill === true) {
    return {
      stroke: input.fallbackStroke,
      strokeWidth: 0,
      source: input.source,
    };
  }
  const resolvedLine = resolveChartLineStyle(input.line, context, {
    widthToPx: linePointsToCanvasPx,
  });
  const paint = resolvedLine?.paint;
  return {
    stroke: paint?.type === 'solid' ? paint.color : input.fallbackStroke,
    ...(paint?.type === 'solid' && paint.opacity !== undefined
      ? { strokeOpacity: paint.opacity }
      : resolvedLine?.opacity !== undefined
        ? { strokeOpacity: resolvedLine.opacity }
        : {}),
    strokeWidth:
      resolvedLine?.width ?? linePointsToCanvasPx(input.line?.width) ?? input.fallbackWidth,
    ...(resolvedLine?.dash ? { strokeDash: resolvedLine.dash } : {}),
    ...(resolvedLine ? { line: resolvedLine } : {}),
    source: input.source,
  };
}

function stockTickStroke(
  base: StockGlyphStrokeVisualSpec,
  nativeTickProfile: boolean,
): StockGlyphStrokeVisualSpec {
  if (!nativeTickProfile || base.source !== 'excelDefault' || base.strokeWidth <= 0) {
    return { ...base };
  }
  return {
    ...base,
    strokeWidth: NATIVE_STOCK_GLYPH_PROFILE.tickStrokeWidth,
  };
}

function usesNativeStockTickProfile(
  subType: StockGlyphSubType,
  priceGlyphMode: StockGlyphVisualSpec['priceGlyphMode'],
): boolean {
  return priceGlyphMode !== 'upDownBody' && (subType === 'hlc' || subType === 'ohlc');
}

function visibleSourceLine(line: ChartLineFormat | undefined): ChartLineFormat | undefined {
  if (!line || line.noFill === true) return undefined;
  return line;
}

function sourceLineExplicitlyHidden(
  series: SeriesConfig | undefined,
  line: ChartLineFormat | undefined,
): boolean {
  return series?.showLines === false || line?.noFill === true;
}

function sourceLineExplicitlyVisible(
  series: SeriesConfig | undefined,
  line: ChartLineFormat | undefined,
): boolean {
  return series?.showLines === true || visibleSourceLine(line) !== undefined;
}

function sourceMarkerDefaultsToVisible(series: SeriesConfig | undefined): boolean {
  return (
    series?.showMarkers === true || Boolean(series?.markerStyle && series.markerStyle !== 'none')
  );
}

function sourceMarkerExplicitlyHidden(series: SeriesConfig | undefined): boolean {
  return series?.showMarkers === false || series?.markerStyle === 'none';
}

function resolveStockBody(input: {
  config: ChartConfig;
  format: ChartFormat | undefined;
  ownerKey: string;
  defaults: BodyDefaults;
  source: StockGlyphVisualSource;
}): StockGlyphBodyVisualSpec {
  const context = resolverContextFromConfig(input.config, input.ownerKey);
  const format = resolveChartOwnerFormat(input.config, input.ownerKey, input.format);
  const formatFill = format?.fill;
  const fillPaint = resolveChartFillPaint(formatFill, context);
  const fill =
    fillPaint?.type === 'solid'
      ? fillPaint.color
      : (resolveChartFillColor(formatFill, context) ?? input.defaults.fill);
  const fillOpacity =
    fillPaint?.type === 'solid'
      ? fillPaint.opacity
      : formatFill?.type === 'solid' && typeof formatFill.transparency === 'number'
        ? clamp01(1 - formatFill.transparency)
        : input.defaults.fillOpacity;
  const borderLine =
    format?.line?.noFill === true
      ? undefined
      : resolveChartLineStyle(format?.line, context, { widthToPx: linePointsToCanvasPx });
  const borderPaint = borderLine?.paint;
  const border = borderPaint?.type === 'solid' ? borderPaint.color : input.defaults.border;
  const borderOpacity =
    borderPaint?.type === 'solid' && borderPaint.opacity !== undefined
      ? borderPaint.opacity
      : (borderLine?.opacity ?? input.defaults.borderOpacity);
  const borderWidth =
    format?.line?.noFill === true
      ? 0
      : (borderLine?.width ??
        linePointsToCanvasPx(format?.line?.width) ??
        input.defaults.borderWidth);
  return {
    fill,
    ...(fillOpacity !== undefined ? { fillOpacity } : {}),
    ...(fillPaint ? { fillPaint } : {}),
    border,
    ...(borderOpacity !== undefined ? { borderOpacity } : {}),
    borderWidth,
    ...(borderLine ? { borderLine } : {}),
    source: input.source,
  };
}

function resolveSourceRoleVisuals(
  config: ChartConfig,
  sourceSeries: Partial<Record<ChartSeriesStockRole, StockSourceSeries>>,
  composition: ReturnType<typeof stockSourceCompositionFromConfig>,
): StockGlyphSourceRoleVisualSpec[] {
  return composition.sourceRoleOrder.map((role, roleIndex) => {
    const glyphInputOnly =
      role === 'volume' && composition.volumeAxisPolicy === 'separateVolumeAxis';
    const overlayCapable =
      !glyphInputOnly && (role !== 'volume' || composition.volumeAxisPolicy === 'stockValueAxis');
    return resolveSourceRoleVisual({
      config,
      role,
      roleIndex,
      source: sourceSeries[role],
      sourceRoleOrder: composition.sourceRoleOrder,
      layerMode: glyphInputOnly ? 'glyphInputOnly' : 'overlayLayer',
      lineVisible: overlayCapable,
      markerVisible: overlayCapable,
    });
  });
}

function resolveSourceRoleVisual(input: {
  config: ChartConfig;
  role: ChartSeriesStockRole;
  roleIndex: number;
  source: StockSourceSeries | undefined;
  sourceRoleOrder: readonly ChartSeriesStockRole[];
  layerMode: StockGlyphSourceRoleVisualSpec['layerMode'];
  lineVisible: boolean;
  markerVisible: boolean;
}): StockGlyphSourceRoleVisualSpec {
  const { config, source, roleIndex } = input;
  const ownerKey = seriesOwnerKey(source);
  const sourceSeriesIndex = source ? seriesOwnerIndex(source.series, source.index) : roleIndex;
  const colorAuthority = source
    ? resolveSeriesColorAuthority({
        config,
        series: source.series,
        sourceSeriesIndex,
        fallbackType: 'stock',
        stockSourceRole: input.role,
        stockSourceRoleIndex: roleIndex,
        stockSourceRoleOrder: input.sourceRoleOrder,
      })
    : undefined;
  const roleColorAuthority = resolveStockSourceRoleColorAuthority({
    authority: colorAuthority,
    role: input.role,
    roleIndex,
    source,
    sourceRoleOrder: input.sourceRoleOrder,
  });
  const colorAuthorityStatus = roleColorAuthority.status;
  const fallbackStroke = stockSourceRoleColor(
    config,
    source,
    roleIndex,
    colorAuthority,
    roleColorAuthority.color,
  );
  const rawLineFormat = source?.series.format?.line;
  const lineFormat = visibleSourceLine(rawLineFormat);
  const lineExplicitlyHidden = sourceLineExplicitlyHidden(source?.series, rawLineFormat);
  const markerExplicitlyHidden = sourceMarkerExplicitlyHidden(source?.series);
  const line = resolveStockStroke({
    config,
    line: lineFormat,
    ownerKey,
    fallbackStroke,
    fallbackWidth: 1,
    source: lineFormat ? 'sourceSeriesFormat' : 'excelDefault',
  });
  const marker = resolveSourceRoleMarkerVisual({
    config,
    source,
    fallbackStroke: line.stroke,
    fallbackFill: line.stroke,
    visualSource: markerVisualSource(source),
    colorAuthority,
    roleColor: roleColorAuthority.color,
  });
  const lineVisible =
    input.layerMode === 'overlayLayer' &&
    input.lineVisible &&
    sourceLineExplicitlyVisible(source?.series, rawLineFormat) &&
    !lineExplicitlyHidden &&
    line.strokeWidth > 0;
  const markerVisible =
    input.layerMode === 'overlayLayer' &&
    input.markerVisible &&
    sourceMarkerDefaultsToVisible(source?.series) &&
    !markerExplicitlyHidden;
  const lineVisualStatus = resolveSourceRoleLineVisualStatus({
    layerMode: input.layerMode,
    lineVisible,
    lineExplicitlyHidden,
    line,
    colorAuthorityStatus,
  });
  const markerVisualStatus = resolveSourceRoleMarkerVisualStatus({
    layerMode: input.layerMode,
    markerVisible,
    markerExplicitlyHidden,
    marker,
    colorAuthorityStatus,
  });
  return {
    role: input.role,
    ...(source ? { sourceSeriesIndex } : {}),
    ...(source?.series.sourceSeriesKey ? { sourceSeriesKey: source.series.sourceSeriesKey } : {}),
    layerMode: input.layerMode,
    lineVisible,
    lineVisualStatus: lineVisualStatus.status,
    ...(lineVisualStatus.reason ? { lineVisualStatusReason: lineVisualStatus.reason } : {}),
    markerVisible,
    markerVisualStatus: markerVisualStatus.status,
    ...(markerVisualStatus.reason ? { markerVisualStatusReason: markerVisualStatus.reason } : {}),
    colorAuthorityStatus,
    ...(roleColorAuthority.source ? { colorAuthoritySource: roleColorAuthority.source } : {}),
    ...(roleColorAuthority.reason ? { colorAuthorityReason: roleColorAuthority.reason } : {}),
    line,
    marker,
  };
}

function resolveSourceRoleMarkerVisual(input: {
  config: ChartConfig;
  source: StockSourceSeries | undefined;
  fallbackStroke: string;
  fallbackFill: string;
  visualSource: StockGlyphVisualSource;
  colorAuthority: ReturnType<typeof resolveSeriesColorAuthority> | undefined;
  roleColor: string | undefined;
}): StockGlyphSourceRoleMarkerVisualSpec {
  const { config, source } = input;
  const ownerIndex = source ? seriesOwnerIndex(source.series, source.index) : 0;
  const context = resolverContextFromConfig(config, `marker(seriesIdx=${ownerIndex})`);
  return {
    fill:
      input.colorAuthority?.markerFill?.color ??
      input.colorAuthority?.fill?.color ??
      input.roleColor ??
      resolveChartColor(source?.series.markerBackgroundColor, context) ??
      resolveChartColor(source?.series.color, context) ??
      input.fallbackFill,
    stroke:
      input.colorAuthority?.markerStroke?.color ??
      input.colorAuthority?.stroke?.color ??
      input.roleColor ??
      resolveChartColor(source?.series.markerForegroundColor, context) ??
      input.fallbackStroke,
    strokeWidth: 1,
    shape: excelMarkerShape(source?.series.markerStyle, ownerIndex, config),
    size: markerPointSizeToArea(source?.series.markerSize),
    source: input.visualSource,
  };
}

function stockSourceRoleColor(
  config: ChartConfig,
  source: StockSourceSeries | undefined,
  roleIndex: number,
  colorAuthority: ReturnType<typeof resolveSeriesColorAuthority> | undefined,
  roleColor: string | undefined,
): string {
  const ownerKey = seriesOwnerKey(source);
  const context = resolverContextFromConfig(config, ownerKey);
  return (
    roleColor ??
    colorAuthority?.stroke?.color ??
    colorAuthority?.color ??
    resolveChartColor(source?.series.color, context) ??
    resolveChartColor(config.colors?.[roleIndex], context) ??
    DEFAULT_SOURCE_ROLE_COLORS[roleIndex % DEFAULT_SOURCE_ROLE_COLORS.length] ??
    DEFAULT_STOCK_STROKE
  );
}

function resolveStockSourceRoleColorAuthority(input: {
  authority: ReturnType<typeof resolveSeriesColorAuthority> | undefined;
  role: ChartSeriesStockRole;
  roleIndex: number;
  source: StockSourceSeries | undefined;
  sourceRoleOrder: readonly ChartSeriesStockRole[];
}): {
  status: StockGlyphVisualContractStatus;
  source?: string;
  reason?: string;
  color?: string;
} {
  const authority = input.authority;
  if (!authority || authority.source === 'unknown') {
    return {
      status: 'missing',
      source: authority?.source,
      reason: 'stockSourceRoleColorAuthorityMissing',
    };
  }

  if (authority.source === 'defaultPalette') {
    return {
      status: 'approximate',
      source: authority.source,
      reason: `stockSourceRoleColorAuthority:${authority.source}`,
      color: stockAuthorityColor(authority),
    };
  }

  if (authority.source === 'excelStockRoleDefault') {
    const color = stockAuthorityColor(authority);
    const expectedColor = stockExcelDefaultSourceRoleColor(input);
    if (input.source && color && expectedColor && sameStockColor(color, expectedColor)) {
      return {
        status: 'verifiedDefault',
        source: authority.source,
        reason: 'excelStockRoleDefaultPalette:roleOrder',
        color: expectedColor,
      };
    }
    return {
      status: 'approximate',
      source: authority.source,
      reason: 'stockSourceRoleColorAuthority:roleDefaultMismatch',
      color: color ?? expectedColor,
    };
  }

  return {
    status: authority.fallback === true ? 'verifiedDefault' : 'exact',
    source: authority.source,
    color: stockAuthorityColor(authority),
  };
}

function stockAuthorityColor(
  authority: ReturnType<typeof resolveSeriesColorAuthority> | undefined,
): string | undefined {
  return authority?.stroke?.color ?? authority?.fill?.color ?? authority?.color;
}

function stockExcelDefaultSourceRoleColor(input: {
  role: ChartSeriesStockRole;
  roleIndex: number;
  sourceRoleOrder: readonly ChartSeriesStockRole[];
}): string | undefined {
  const resolvedIndex =
    input.sourceRoleOrder[input.roleIndex] === input.role
      ? input.roleIndex
      : input.sourceRoleOrder.indexOf(input.role);
  if (resolvedIndex < 0) return undefined;
  return DEFAULT_SOURCE_ROLE_COLORS[resolvedIndex % DEFAULT_SOURCE_ROLE_COLORS.length];
}

function sameStockColor(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function resolveSourceRoleLineVisualStatus(input: {
  layerMode: StockGlyphSourceRoleVisualSpec['layerMode'];
  lineVisible: boolean;
  lineExplicitlyHidden: boolean;
  line: StockGlyphStrokeVisualSpec;
  colorAuthorityStatus: StockGlyphVisualContractStatus;
}): { status: StockGlyphVisualContractStatus; reason?: string } {
  if (input.layerMode === 'glyphInputOnly') {
    return { status: 'verifiedDefault', reason: 'sourceRoleLineGlyphInputOnly' };
  }
  if (input.lineExplicitlyHidden) return { status: 'exact', reason: 'sourceRoleLineHidden' };
  if (!input.lineVisible) {
    return { status: 'verifiedDefault', reason: 'sourceRoleLineNotRenderedByStockGlyph' };
  }
  if (!input.line.stroke) return { status: 'missing', reason: 'sourceRoleLineStrokeMissing' };
  if (!Number.isFinite(input.line.strokeWidth) || input.line.strokeWidth <= 0) {
    return { status: 'missing', reason: 'sourceRoleLineWidthMissing' };
  }
  if (input.colorAuthorityStatus === 'approximate' || input.colorAuthorityStatus === 'missing') {
    return {
      status: input.colorAuthorityStatus,
      reason: 'sourceRoleLineColorAuthorityUnresolved',
    };
  }
  return { status: input.colorAuthorityStatus };
}

function resolveSourceRoleMarkerVisualStatus(input: {
  layerMode: StockGlyphSourceRoleVisualSpec['layerMode'];
  markerVisible: boolean;
  markerExplicitlyHidden: boolean;
  marker: StockGlyphSourceRoleMarkerVisualSpec;
  colorAuthorityStatus: StockGlyphVisualContractStatus;
}): { status: StockGlyphVisualContractStatus; reason?: string } {
  if (input.layerMode === 'glyphInputOnly') {
    return { status: 'verifiedDefault', reason: 'sourceRoleMarkerGlyphInputOnly' };
  }
  if (input.markerExplicitlyHidden) return { status: 'exact', reason: 'sourceRoleMarkerHidden' };
  if (!input.markerVisible) {
    return { status: 'verifiedDefault', reason: 'sourceRoleMarkerDisabled' };
  }
  if (!input.marker.fill && !input.marker.stroke) {
    return { status: 'missing', reason: 'sourceRoleMarkerPaintMissing' };
  }
  if (input.colorAuthorityStatus === 'approximate' || input.colorAuthorityStatus === 'missing') {
    return {
      status: input.colorAuthorityStatus,
      reason: 'sourceRoleMarkerColorAuthorityUnresolved',
    };
  }
  return { status: input.colorAuthorityStatus };
}

function markerVisualSource(source: StockSourceSeries | undefined): StockGlyphVisualSource {
  return source ? 'sourceSeriesFormat' : 'excelDefault';
}

interface StockSourceSeries {
  series: SeriesConfig;
  index: number;
}

function stockSourceSeries(
  seriesConfigs: SeriesConfig[],
): Partial<Record<ChartSeriesStockRole, StockSourceSeries>> {
  const plan = stockRolePlan(seriesConfigs);
  if (!plan) return {};
  const byRole: Partial<Record<ChartSeriesStockRole, StockSourceSeries>> = {};
  for (const role of ['volume', 'open', 'high', 'low', 'close'] as const) {
    const index = plan[role];
    if (index === undefined) continue;
    const series = seriesConfigs[index];
    if (series) byRole[role] = { series, index };
  }
  return byRole;
}

function seriesOwnerKey(source: StockSourceSeries | undefined): string {
  return `series(${source ? seriesOwnerIndex(source.series, source.index) : 0})`;
}

function seriesOwnerIndex(series: SeriesConfig, fallback: number): number {
  return typeof series.idx === 'number' && Number.isInteger(series.idx) && series.idx >= 0
    ? series.idx
    : fallback;
}

function stockVisualMissingReasons(input: {
  rows: DataRow[];
  priceGlyphMode: StockGlyphVisualSpec['priceGlyphMode'];
  requiresVolume: boolean;
  hasVolumeVisual: boolean;
  sourceRoleVisuals: StockGlyphSourceRoleVisualSpec[];
  expectedSourceRoleCount: number;
}): string[] {
  const reasons: string[] = [];
  if (
    input.priceGlyphMode === 'upDownBody' &&
    !input.rows.some((row) => typeof row[STOCK_OPEN_FIELD] === 'number')
  ) {
    reasons.push('stockOpenValuesUnavailable');
  }
  if (
    !input.hasVolumeVisual ||
    (input.requiresVolume && !input.rows.some((row) => typeof row[STOCK_VOLUME_FIELD] === 'number'))
  ) {
    reasons.push('stockVolumeVisualUnavailable');
  }
  if (input.sourceRoleVisuals.length < input.expectedSourceRoleCount) {
    reasons.push('stockSourceRoleVisualsUnavailable');
  }
  return reasons;
}

function isVolumeStockSubType(subType: StockGlyphSubType): boolean {
  return subType === 'volume-hlc' || subType === 'volume-ohlc';
}

function stockGapWidth(value: unknown, fallback = DEFAULT_PRICE_GAP_WIDTH): number {
  return clampNumber(typeof value === 'number' ? value : fallback, 0, 500);
}

function slotOccupancyForGapWidth(gapWidth: number): number {
  return roundNumber(nativeStockSlotOccupancyForGapWidth(gapWidth));
}

function volumeSlotOccupancyForGapWidth(gapWidth: number): number {
  return roundNumber(clampNumber(100 / (100 + gapWidth), 0.12, 0.92));
}

function uniqueStyleSources(
  sources: Array<StockGlyphVisualSource | undefined>,
): StockGlyphVisualSource[] {
  return Array.from(
    new Set(sources.filter((source): source is StockGlyphVisualSource => !!source)),
  );
}

function clamp01(value: number): number {
  return clampNumber(value, 0, 1);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundNumber(value: number): number {
  return Number.parseFloat(value.toFixed(6));
}
