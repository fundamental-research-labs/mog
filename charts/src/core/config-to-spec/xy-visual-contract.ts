import type { ChartConfig, ChartType, SeriesConfig } from '../../types';
import { resolveChartOwnerFormat } from '../style-resolver';
import { resolveFormatFillOpacity } from '../../utils/chart-colors';
import { resolveSeriesColorAuthority } from './color-authority';
import { excelMarkerShape, markerPointSizeToArea } from './data-row-style';
import { effectiveShowLines, effectiveShowMarkers } from './layers/combo-series-options';
import { dashStyleToStrokeDash, hasExplicitNoLine, isNoFillNoLineSeries } from './style';
import { linePointsToCanvasPx } from './units';

export type XYVisualSeriesType = Extract<ChartType, 'scatter' | 'bubble' | 'bubble3DEffect'>;
export type PathVisualSeriesType = Extract<
  ChartType,
  'line' | 'lineMarkers' | 'lineMarkersStacked' | 'lineMarkersStacked100' | 'area'
>;
export type CartesianVisualSeriesType = XYVisualSeriesType | PathVisualSeriesType;
export type XYVisualContractStatus = 'exact' | 'verifiedDefault' | 'approximate' | 'missing';
export type XYLineInterpolation = 'linear' | 'monotone';

export type XYSeriesVisualContract = {
  sourceShowLines: boolean;
  lineVisibleInk: boolean;
  lineNoFill: boolean;
  lineZeroWidth: boolean;
  lineStroke?: string;
  lineStrokeWidth?: number;
  lineDash?: number[];
  lineOpacity?: number;
  lineInterpolation: XYLineInterpolation;
  lineVisualStatus: XYVisualContractStatus;
  lineVisualStatusReason?: string;
  sourceShowMarkers: boolean;
  markerVisibleInk: boolean;
  markerShape: string;
  markerSize: number;
  markerFill?: string;
  markerStroke?: string;
  markerStrokeWidth?: number;
  markerOpacity?: number;
  markerVisualStatus: XYVisualContractStatus;
  markerVisualStatusReason?: string;
  bubbleVisibleInk: boolean;
  bubbleVisualStatus?: XYVisualContractStatus;
  bubbleVisualStatusReason?: string;
  colorAuthorityStatus: XYVisualContractStatus;
  colorAuthoritySource?: string;
  colorAuthorityReason?: string;
};

export function isXYVisualSeriesType(seriesType: ChartType): seriesType is XYVisualSeriesType {
  return seriesType === 'scatter' || seriesType === 'bubble' || seriesType === 'bubble3DEffect';
}

export function isPathVisualSeriesType(seriesType: ChartType): seriesType is PathVisualSeriesType {
  return (
    seriesType === 'line' ||
    seriesType === 'lineMarkers' ||
    seriesType === 'lineMarkersStacked' ||
    seriesType === 'lineMarkersStacked100' ||
    seriesType === 'area'
  );
}

export function isCartesianVisualSeriesType(
  seriesType: ChartType,
): seriesType is CartesianVisualSeriesType {
  return isXYVisualSeriesType(seriesType) || isPathVisualSeriesType(seriesType);
}

export function resolveXYSeriesVisualContract(input: {
  config: ChartConfig;
  seriesType: ChartType;
  seriesConfig: SeriesConfig | undefined;
  sourceSeriesIndex: number;
}): XYSeriesVisualContract {
  return resolveCartesianSeriesVisualContract(input);
}

export function resolveCartesianSeriesVisualContract(input: {
  config: ChartConfig;
  seriesType: ChartType;
  seriesConfig: SeriesConfig | undefined;
  sourceSeriesIndex: number;
}): XYSeriesVisualContract {
  const { config, seriesType, seriesConfig, sourceSeriesIndex } = input;
  const sourceShowLines = effectiveShowLines(seriesConfig, seriesType, config);
  const sourceShowMarkers = effectiveShowMarkers(
    seriesConfig,
    seriesType,
    config,
    !sourceShowLines,
  );
  const seriesHidden = isNoFillNoLineSeries(seriesConfig);
  const ownerKey = `series(${sourceSeriesIndex})`;
  const lineFormat = config
    ? resolveChartOwnerFormat(
        config,
        ownerKey,
        seriesConfig?.format,
      )?.line
    : seriesConfig?.format?.line;
  const lineNoFill = lineFormat?.noFill === true || hasExplicitNoLine(seriesConfig);
  const lineStrokeWidth =
    lineNoFill ? 0 : linePointsToCanvasPx(lineFormat?.width) ?? seriesConfig?.lineWidth;
  const lineZeroWidth = lineFormat?.width === 0 || seriesConfig?.lineWidth === 0;
  const isBubbleSeries = seriesType === 'bubble' || seriesType === 'bubble3DEffect';
  const colorAuthority = resolveSeriesColorAuthority({
    config,
    series: seriesConfig,
    sourceSeriesIndex,
    fallbackType: seriesType,
  });
  const colorAuthorityStatus = colorAuthorityVisualStatus(colorAuthority);
  const markerFill =
    colorAuthority?.markerFill?.color ?? colorAuthority?.fill?.color ?? colorAuthority?.color;
  const markerStroke =
    colorAuthority?.markerStroke?.color ?? colorAuthority?.stroke?.color ?? colorAuthority?.color;
  const markerStrokeWidth = markerStroke ? 1 : undefined;
  const lineStroke = !lineNoFill
    ? (colorAuthority?.stroke?.color ?? colorAuthority?.color)
    : undefined;
  const lineOpacity =
    typeof lineFormat?.transparency === 'number' && Number.isFinite(lineFormat.transparency)
      ? Math.max(0, Math.min(1, 1 - lineFormat.transparency))
      : undefined;
  const lineDash = lineFormat?.dashStyle
    ? dashStyleToStrokeDash(lineFormat.dashStyle, lineStrokeWidth)
    : undefined;
  const markerOpacity = resolveFormatFillOpacity(seriesConfig?.format);
  const lineInterpolation: XYLineInterpolation =
    seriesConfig?.smooth === true || config.smoothLines === true ? 'monotone' : 'linear';
  const lineVisualStatus = resolveLineVisualStatus({
    sourceShowLines,
    lineVisibleInk: sourceShowLines && !seriesHidden && !lineNoFill && !lineZeroWidth,
    lineNoFill,
    lineZeroWidth,
    lineStroke,
    lineStrokeWidth,
    lineInterpolation,
    colorAuthorityStatus,
  });
  const markerVisualStatus = resolveMarkerVisualStatus({
    markerVisibleInk: sourceShowMarkers && !seriesHidden,
    markerFill,
    markerStroke,
    colorAuthorityStatus,
  });
  const bubbleVisualStatus = isBubbleSeries
    ? resolveBubbleVisualStatus({
        bubbleVisibleInk: !seriesHidden,
        fill: markerFill ?? colorAuthority?.fill?.color ?? colorAuthority?.color,
        colorAuthorityStatus,
      })
    : undefined;
  const colorAuthorityReason = colorAuthorityStatusReason(colorAuthority, colorAuthorityStatus);

  return {
    sourceShowLines,
    lineVisibleInk: sourceShowLines && !seriesHidden && !lineNoFill && !lineZeroWidth,
    lineNoFill,
    lineZeroWidth,
    ...(lineStroke ? { lineStroke } : {}),
    ...(lineStrokeWidth !== undefined ? { lineStrokeWidth } : {}),
    ...(lineDash ? { lineDash } : {}),
    ...(lineOpacity !== undefined ? { lineOpacity } : {}),
    lineInterpolation,
    lineVisualStatus: lineVisualStatus.status,
    ...(lineVisualStatus.reason ? { lineVisualStatusReason: lineVisualStatus.reason } : {}),
    sourceShowMarkers,
    markerVisibleInk: sourceShowMarkers && !seriesHidden,
    markerShape: excelMarkerShape(seriesConfig?.markerStyle, sourceSeriesIndex, config),
    markerSize: markerPointSizeToArea(seriesConfig?.markerSize),
    ...(markerFill ? { markerFill } : {}),
    ...(markerStroke ? { markerStroke } : {}),
    ...(markerStrokeWidth !== undefined ? { markerStrokeWidth } : {}),
    ...(markerOpacity !== undefined ? { markerOpacity } : {}),
    markerVisualStatus: markerVisualStatus.status,
    ...(markerVisualStatus.reason ? { markerVisualStatusReason: markerVisualStatus.reason } : {}),
    bubbleVisibleInk: isBubbleSeries && !seriesHidden,
    ...(bubbleVisualStatus ? { bubbleVisualStatus: bubbleVisualStatus.status } : {}),
    ...(bubbleVisualStatus?.reason ? { bubbleVisualStatusReason: bubbleVisualStatus.reason } : {}),
    colorAuthorityStatus,
    ...(colorAuthority?.source ? { colorAuthoritySource: colorAuthority.source } : {}),
    ...(colorAuthorityReason ? { colorAuthorityReason } : {}),
  };
}

function colorAuthorityVisualStatus(
  authority: ReturnType<typeof resolveSeriesColorAuthority> | undefined,
): XYVisualContractStatus {
  if (!authority || authority.source === 'unknown') return 'missing';
  if (authority.source === 'defaultPalette') return 'approximate';
  if (authority.fallback === true) return 'verifiedDefault';
  return 'exact';
}

function colorAuthorityStatusReason(
  authority: ReturnType<typeof resolveSeriesColorAuthority> | undefined,
  status: XYVisualContractStatus,
): string | undefined {
  if (status === 'missing') return 'seriesColorAuthorityMissing';
  if (status === 'approximate') return `seriesColorAuthority:${authority?.source ?? 'unknown'}`;
  return undefined;
}

function resolveLineVisualStatus(input: {
  sourceShowLines: boolean;
  lineVisibleInk: boolean;
  lineNoFill: boolean;
  lineZeroWidth: boolean;
  lineStroke: string | undefined;
  lineStrokeWidth: number | undefined;
  lineInterpolation: XYLineInterpolation;
  colorAuthorityStatus: XYVisualContractStatus;
}): { status: XYVisualContractStatus; reason?: string } {
  if (!input.sourceShowLines) return { status: 'verifiedDefault', reason: 'sourceLineDisabled' };
  if (input.lineNoFill) return { status: 'exact', reason: 'sourceLineNoFill' };
  if (input.lineZeroWidth) return { status: 'exact', reason: 'sourceLineZeroWidth' };
  if (!input.lineVisibleInk) return { status: 'missing', reason: 'lineInkVisibilityMissing' };
  if (!input.lineStroke) return { status: 'missing', reason: 'lineStrokeMissing' };
  if (input.lineStrokeWidth !== undefined && input.lineStrokeWidth <= 0) {
    return { status: 'missing', reason: 'lineStrokeWidthMissing' };
  }
  if (input.lineInterpolation === 'monotone') {
    return { status: 'approximate', reason: 'excelSmoothInterpolationUnverified' };
  }
  if (input.colorAuthorityStatus === 'approximate' || input.colorAuthorityStatus === 'missing') {
    return { status: input.colorAuthorityStatus, reason: 'lineColorAuthorityUnresolved' };
  }
  return { status: input.colorAuthorityStatus };
}

function resolveMarkerVisualStatus(input: {
  markerVisibleInk: boolean;
  markerFill: string | undefined;
  markerStroke: string | undefined;
  colorAuthorityStatus: XYVisualContractStatus;
}): { status: XYVisualContractStatus; reason?: string } {
  if (!input.markerVisibleInk) return { status: 'verifiedDefault', reason: 'sourceMarkerDisabled' };
  if (!input.markerFill && !input.markerStroke) {
    return { status: 'missing', reason: 'markerPaintMissing' };
  }
  if (input.colorAuthorityStatus === 'approximate' || input.colorAuthorityStatus === 'missing') {
    return { status: input.colorAuthorityStatus, reason: 'markerColorAuthorityUnresolved' };
  }
  return { status: input.colorAuthorityStatus };
}

function resolveBubbleVisualStatus(input: {
  bubbleVisibleInk: boolean;
  fill: string | undefined;
  colorAuthorityStatus: XYVisualContractStatus;
}): { status: XYVisualContractStatus; reason?: string } {
  if (!input.bubbleVisibleInk) return { status: 'verifiedDefault', reason: 'sourceBubbleHidden' };
  if (!input.fill) return { status: 'missing', reason: 'bubblePaintMissing' };
  if (input.colorAuthorityStatus === 'approximate' || input.colorAuthorityStatus === 'missing') {
    return { status: input.colorAuthorityStatus, reason: 'bubbleColorAuthorityUnresolved' };
  }
  return { status: input.colorAuthorityStatus };
}
