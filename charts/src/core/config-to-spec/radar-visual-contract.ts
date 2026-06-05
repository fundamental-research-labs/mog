import type {
  ResolvedChartRadarStyleContractEntrySnapshot,
  ResolvedChartRadarStyleContractFidelity,
  ResolvedChartRadarStyleSourceAuthority,
  ResolvedChartRadarStyleDiagnosticsSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { AxisSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartFormat, PointFormat, SeriesConfig } from '../../types';
import {
  RADAR_DEFAULT_CATEGORY_LABEL_COLOR,
  RADAR_DEFAULT_CATEGORY_LABEL_FONT_SIZE,
  RADAR_DEFAULT_FILLED_OPACITY,
  RADAR_DEFAULT_FONT_FAMILY,
  RADAR_DEFAULT_GRID_COLOR,
  RADAR_DEFAULT_GRID_WIDTH,
  RADAR_DEFAULT_MARKER_SIZE,
  RADAR_DEFAULT_SERIES_STROKE_WIDTH,
  RADAR_DEFAULT_SPOKE_COLOR,
  RADAR_DEFAULT_SPOKE_WIDTH,
  RADAR_DEFAULT_VALUE_LABEL_COLOR,
  RADAR_DEFAULT_VALUE_LABEL_FONT_SIZE,
} from '../radar-semantics';
import { seriesConfigForDataSeries, seriesSourceIndex } from '../series-identity';
import {
  chartStyleOwner,
  mergeChartFormats,
  resolveChartFillPaint,
  resolveChartLineStyle,
  resolveChartOwnerFormat,
  resolverContextFromConfig,
} from '../style-resolver';
import { resolveFormatFillOpacity } from '../../utils/chart-colors';
import { resolveSeriesColorAuthority } from './color-authority';
import { excelMarkerShape, markerPointSizeToArea } from './data-row-style';
import { isImportedStandardOoxmlChart } from './bar-geometry';
import { mapAxisConfigToAxisSpec, resolveAxisConfigForChannel } from './axis';
import { dashStyleToStrokeDash, hasExplicitNoLine, isNoFillNoLineSeries } from './style';
import { linePointsToCanvasPx } from './units';

type RadarVisualStatus = 'exact' | 'verifiedDefault' | 'approximate' | 'unknown';
type ContractCategory = ResolvedChartRadarStyleContractEntrySnapshot['category'];
type ContractValue = ResolvedChartRadarStyleContractEntrySnapshot['rendered'][string];
type PaintAuthority = ReturnType<typeof resolveSeriesColorAuthority>;

export interface RadarPointMarkerVisualContract {
  pointIndex: number;
  markerVisible: boolean;
  markerShape?: string;
  markerSize?: number;
  markerFill?: string;
  markerStroke?: string;
  markerStrokeWidth?: number;
  markerStatus: RadarVisualStatus;
  markerStatusReason?: string;
  markerSourceAuthority: ResolvedChartRadarStyleSourceAuthority;
}

export interface RadarSeriesVisualContract {
  renderedSeriesIndex: number;
  sourceSeriesIndex: number;
  fillVisible: boolean;
  fillColor?: string;
  fillOpacity?: number;
  fillStatus: RadarVisualStatus;
  fillStatusReason?: string;
  fillSourceAuthority: ResolvedChartRadarStyleSourceAuthority;
  strokeVisible: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  strokeDash?: number[];
  strokeOpacity?: number;
  strokeStatus: RadarVisualStatus;
  strokeStatusReason?: string;
  strokeSourceAuthority: ResolvedChartRadarStyleSourceAuthority;
  markerVisible: boolean;
  markerShape?: string;
  markerSize?: number;
  markerFill?: string;
  markerStroke?: string;
  markerStrokeWidth?: number;
  markerStatus: RadarVisualStatus;
  markerStatusReason?: string;
  markerSourceAuthority: ResolvedChartRadarStyleSourceAuthority;
  pointMarkers: RadarPointMarkerVisualContract[];
}

export interface RadarVisualContract {
  styleDiagnostics: ResolvedChartRadarStyleDiagnosticsSnapshot;
  contracts: ResolvedChartRadarStyleContractEntrySnapshot[];
  series: RadarSeriesVisualContract[];
  seriesBySourceIndex: Map<number, RadarSeriesVisualContract>;
  categoryAxis?: AxisSpec;
  valueAxis?: AxisSpec;
  fillOpacity?: number;
  markerSize?: number;
  strokeWidth?: number;
}

interface CategoryEvidence {
  visible: boolean;
  status: RadarVisualStatus;
  sourceAuthority: ResolvedChartRadarStyleSourceAuthority;
  requiresHumanReview?: boolean;
  reason?: string;
}

export function resolveRadarVisualContract(input: {
  config: ChartConfig;
  chartData: ChartData;
  filled: boolean;
  markers: boolean;
}): RadarVisualContract {
  const imported = isImportedStandardOoxmlChart(input.config);
  const series = input.chartData.series.map((dataSeries, renderedSeriesIndex) => {
    const seriesConfig = seriesConfigForDataSeries(
      dataSeries,
      input.config.series ?? [],
      renderedSeriesIndex,
    );
    const sourceIndex = seriesSourceIndex(dataSeries, renderedSeriesIndex);
    return resolveRadarSeriesVisualContract({
      config: input.config,
      seriesConfig,
      sourceSeriesIndex: sourceIndex,
      renderedSeriesIndex,
      filled: input.filled,
      markers: input.markers,
      imported,
    });
  });
  const seriesBySourceIndex = new Map(series.map((item) => [item.sourceSeriesIndex, item]));

  const categoryAxisConfig = input.config.axis
    ? resolveAxisConfigForChannel(input.config.axis, 'x', false)
    : undefined;
  const valueAxisConfig = input.config.axis
    ? resolveAxisConfigForChannel(input.config.axis, 'y', false)
    : undefined;
  const categoryAxis = categoryAxisConfig
    ? mapAxisConfigToAxisSpec(categoryAxisConfig, input.config, 'categoryAxis')
    : undefined;
  const valueAxis = valueAxisConfig
    ? mapAxisConfigToAxisSpec(valueAxisConfig, input.config, 'valueAxis')
    : undefined;

  const fillContract = seriesContract({
    category: 'fill',
    enabled: input.filled,
    evidences: series.map((item) => ({
      visible: item.fillVisible,
      status: item.fillStatus,
      sourceAuthority: item.fillSourceAuthority,
      ...(item.fillStatusReason ? { reason: item.fillStatusReason } : {}),
    })),
    rendered: {
      enabled: input.filled,
      seriesCount: series.length,
      firstColor: firstDefined(series.map((item) => item.fillColor)) ?? null,
      firstOpacity: firstDefined(series.map((item) => item.fillOpacity)) ?? null,
    },
    approximateReason: 'radar fill style uses unverified defaults or palette fallback',
  });
  const markerContract = seriesContract({
    category: 'marker',
    enabled: input.markers,
    evidences: series.flatMap((item) => [
      {
        visible: item.markerVisible,
        status: item.markerStatus,
        sourceAuthority: item.markerSourceAuthority,
        ...(item.markerStatusReason ? { reason: item.markerStatusReason } : {}),
      },
      ...item.pointMarkers.map((point) => ({
        visible: point.markerVisible,
        status: point.markerStatus,
        sourceAuthority: point.markerSourceAuthority,
        ...(point.markerStatusReason ? { reason: point.markerStatusReason } : {}),
      })),
    ]),
    rendered: {
      enabled: input.markers,
      seriesCount: series.length,
      firstShape: firstDefined(series.map((item) => item.markerShape)) ?? null,
      firstSize: firstDefined(series.map((item) => item.markerSize)) ?? null,
      firstFill: firstDefined(series.map((item) => item.markerFill)) ?? null,
      firstStroke: firstDefined(series.map((item) => item.markerStroke)) ?? null,
      firstStrokeWidth: firstDefined(series.map((item) => item.markerStrokeWidth)) ?? null,
    },
    approximateReason: 'radar marker style uses unverified defaults or palette fallback',
  });
  const strokeContract = seriesContract({
    category: 'stroke',
    enabled: true,
    evidences: series.map((item) => ({
      visible: item.strokeVisible,
      status: item.strokeStatus,
      sourceAuthority: item.strokeSourceAuthority,
      ...(item.strokeStatusReason ? { reason: item.strokeStatusReason } : {}),
    })),
    rendered: {
      enabled: true,
      seriesCount: series.length,
      firstColor: firstDefined(series.map((item) => item.strokeColor)) ?? null,
      firstWidth: firstDefined(series.map((item) => item.strokeWidth)) ?? null,
      firstDash: dashValue(firstDefined(series.map((item) => item.strokeDash))) ?? null,
      firstOpacity: firstDefined(series.map((item) => item.strokeOpacity)) ?? null,
    },
    approximateReason: 'radar stroke style uses unverified defaults or palette fallback',
  });
  const gridContract = axisLineContract({
    category: 'grid',
    axisConfig: valueAxisConfig,
    axis: valueAxis,
    imported,
    lineKind: 'grid',
    rendered: {
      enabled: valueAxis?.grid !== false,
      color: valueAxis?.gridColor ?? RADAR_DEFAULT_GRID_COLOR,
      width: valueAxis?.gridWidth ?? RADAR_DEFAULT_GRID_WIDTH,
      dash: dashValue(valueAxis?.gridDash) ?? null,
      opacity: valueAxis?.gridOpacity ?? null,
    },
  });
  const spokesContract = axisLineContract({
    category: 'spokes',
    axisConfig: valueAxisConfig,
    axis: valueAxis,
    imported,
    lineKind: 'axis',
    rendered: {
      enabled: valueAxis?.domain !== false,
      color: valueAxis?.domainColor ?? valueAxis?.tickColor ?? RADAR_DEFAULT_SPOKE_COLOR,
      width: valueAxis?.domainWidth ?? valueAxis?.tickWidth ?? RADAR_DEFAULT_SPOKE_WIDTH,
      dash: dashValue(valueAxis?.domainDash ?? valueAxis?.tickDash) ?? null,
      opacity: valueAxis?.domainOpacity ?? valueAxis?.tickOpacity ?? null,
    },
  });
  const categoryLabelsContract = axisLabelContract({
    category: 'categoryLabels',
    axisConfig: categoryAxisConfig,
    axis: categoryAxis,
    imported,
    rendered: {
      enabled: categoryAxis?.labels !== false,
      color: categoryAxis?.labelColor ?? RADAR_DEFAULT_CATEGORY_LABEL_COLOR,
      fontSize: categoryAxis?.labelFontSize ?? RADAR_DEFAULT_CATEGORY_LABEL_FONT_SIZE,
      fontFamily: categoryAxis?.labelFontFamily ?? RADAR_DEFAULT_FONT_FAMILY,
      labelPosition: categoryAxis?.labelPosition ?? null,
    },
  });
  const valueLabelsContract = axisLabelContract({
    category: 'valueLabels',
    axisConfig: valueAxisConfig,
    axis: valueAxis,
    imported,
    rendered: {
      enabled: valueAxis?.labels !== false,
      color: valueAxis?.labelColor ?? RADAR_DEFAULT_VALUE_LABEL_COLOR,
      fontSize: valueAxis?.labelFontSize ?? RADAR_DEFAULT_VALUE_LABEL_FONT_SIZE,
      fontFamily: valueAxis?.labelFontFamily ?? RADAR_DEFAULT_FONT_FAMILY,
      numberFormat: valueAxis?.format ?? null,
      labelPosition: valueAxis?.labelPosition ?? null,
    },
  });
  const contracts = [
    fillContract,
    markerContract,
    strokeContract,
    gridContract,
    spokesContract,
    categoryLabelsContract,
    valueLabelsContract,
  ];
  const gridLabelFidelity = aggregateLegacyFidelity([
    gridContract,
    spokesContract,
    categoryLabelsContract,
    valueLabelsContract,
  ]);
  const styleDiagnostics: ResolvedChartRadarStyleDiagnosticsSnapshot = {
    autoValueScaleFidelity: 'exact',
    fillStyleFidelity: legacyFidelity(fillContract),
    markerStyleFidelity: legacyFidelity(markerContract),
    strokeStyleFidelity: legacyFidelity(strokeContract),
    gridLabelStyleFidelity: gridLabelFidelity,
    reasons: contractReasons(contracts),
    contracts,
  };

  return {
    styleDiagnostics,
    contracts,
    series,
    seriesBySourceIndex,
    ...(categoryAxis ? { categoryAxis } : {}),
    ...(valueAxis ? { valueAxis } : {}),
    ...(input.filled
      ? {
          fillOpacity:
            firstDefined(series.map((item) => item.fillOpacity)) ?? RADAR_DEFAULT_FILLED_OPACITY,
        }
      : {}),
    ...(input.markers
      ? {
          markerSize:
            firstDefined(series.map((item) => item.markerSize)) ?? RADAR_DEFAULT_MARKER_SIZE,
        }
      : {}),
    strokeWidth:
      firstDefined(series.map((item) => item.strokeWidth)) ?? RADAR_DEFAULT_SERIES_STROKE_WIDTH,
  };
}

function resolveRadarSeriesVisualContract(input: {
  config: ChartConfig;
  seriesConfig: SeriesConfig | undefined;
  sourceSeriesIndex: number;
  renderedSeriesIndex: number;
  filled: boolean;
  markers: boolean;
  imported: boolean;
}): RadarSeriesVisualContract {
  const {
    config,
    seriesConfig,
    sourceSeriesIndex,
    renderedSeriesIndex,
    filled,
    markers,
    imported,
  } = input;
  const seriesHidden = isNoFillNoLineSeries(seriesConfig);
  const ownerKey = `series(${sourceSeriesIndex})`;
  const ownerFormat = chartStyleOwner(config, ownerKey)?.format;
  const format = resolveChartOwnerFormat(config, ownerKey, seriesConfig?.format);
  const context = resolverContextFromConfig(config, ownerKey);
  const colorAuthority = resolveSeriesColorAuthority({
    config,
    series: seriesConfig,
    sourceSeriesIndex,
    renderedSeriesIndex,
    fallbackType: 'radar',
  });
  const colorStatus = colorAuthorityVisualStatus(colorAuthority);
  const fill = resolveSeriesFillVisual({
    filled,
    seriesHidden,
    format,
    ownerFormat,
    seriesConfig,
    context,
    colorAuthority,
    colorStatus,
    imported,
  });
  const stroke = resolveSeriesStrokeVisual({
    seriesHidden,
    format,
    ownerFormat,
    seriesConfig,
    colorAuthority,
    colorStatus,
    imported,
  });
  const marker = resolveSeriesMarkerVisual({
    config,
    seriesConfig,
    sourceSeriesIndex,
    markers,
    seriesHidden,
    colorAuthority,
    colorStatus,
    imported,
  });

  return {
    renderedSeriesIndex,
    sourceSeriesIndex,
    ...fill,
    ...stroke,
    ...marker,
  };
}

function resolveSeriesFillVisual(input: {
  filled: boolean;
  seriesHidden: boolean;
  format: ChartFormat | undefined;
  ownerFormat: ChartFormat | undefined;
  seriesConfig: SeriesConfig | undefined;
  context: ReturnType<typeof resolverContextFromConfig>;
  colorAuthority: PaintAuthority | undefined;
  colorStatus: RadarVisualStatus;
  imported: boolean;
}): Pick<
  RadarSeriesVisualContract,
  | 'fillVisible'
  | 'fillColor'
  | 'fillOpacity'
  | 'fillStatus'
  | 'fillStatusReason'
  | 'fillSourceAuthority'
> {
  if (!input.filled || input.seriesHidden) {
    return {
      fillVisible: false,
      fillStatus: 'exact',
      fillStatusReason: input.filled ? 'seriesNoFillNoLine' : 'radarFillDisabled',
      fillSourceAuthority: input.filled ? importedAuthority(input.imported) : 'notApplicable',
    };
  }
  if (input.format?.fill?.type === 'none') {
    return {
      fillVisible: false,
      fillStatus: 'exact',
      fillStatusReason: 'sourceFillNoFill',
      fillSourceAuthority: importedAuthority(input.imported),
    };
  }
  if (isUnsupportedFill(input.format?.fill)) {
    return {
      fillVisible: true,
      fillStatus: 'unknown',
      fillStatusReason: 'unsupportedRadarFillPaint',
      fillSourceAuthority: importedAuthority(input.imported),
    };
  }
  const paint = resolveChartFillPaint(input.format?.fill, input.context);
  const fillColor =
    paint?.type === 'solid'
      ? paint.color
      : (input.colorAuthority?.fill?.color ?? input.colorAuthority?.color);
  const fillOpacity =
    paint?.type === 'solid'
      ? (paint.opacity ?? 1)
      : (resolveFormatFillOpacity(input.format) ??
        (input.format?.fill?.type === 'solid' ? 1 : RADAR_DEFAULT_FILLED_OPACITY));
  const hasImportedFillEvidence =
    hasFormatComponent(input.ownerFormat?.fill) ||
    hasFormatComponent(input.seriesConfig?.format?.fill) ||
    input.seriesConfig?.color !== undefined;
  const status = fillColorStatus({
    visible: true,
    color: fillColor,
    colorStatus: input.colorStatus,
    hasImportedEvidence: input.imported && hasImportedFillEvidence,
  });
  return {
    fillVisible: true,
    ...(fillColor ? { fillColor } : {}),
    fillOpacity,
    fillStatus: status.status,
    ...(status.reason ? { fillStatusReason: status.reason } : {}),
    fillSourceAuthority: statusSourceAuthority(
      status.status,
      input.imported && hasImportedFillEvidence,
    ),
  };
}

function resolveSeriesStrokeVisual(input: {
  seriesHidden: boolean;
  format: ChartFormat | undefined;
  ownerFormat: ChartFormat | undefined;
  seriesConfig: SeriesConfig | undefined;
  colorAuthority: PaintAuthority | undefined;
  colorStatus: RadarVisualStatus;
  imported: boolean;
}): Pick<
  RadarSeriesVisualContract,
  | 'strokeVisible'
  | 'strokeColor'
  | 'strokeWidth'
  | 'strokeDash'
  | 'strokeOpacity'
  | 'strokeStatus'
  | 'strokeStatusReason'
  | 'strokeSourceAuthority'
> {
  const line = input.format?.line;
  const lineNoFill = line?.noFill === true || hasExplicitNoLine(input.seriesConfig);
  const lineWidth = lineNoFill
    ? 0
    : (linePointsToCanvasPx(line?.width) ?? linePointsToCanvasPx(input.seriesConfig?.lineWidth));
  const lineZeroWidth = line?.width === 0 || input.seriesConfig?.lineWidth === 0;
  const strokeVisible = !input.seriesHidden && !lineNoFill && !lineZeroWidth;
  const strokeColor = strokeVisible
    ? (input.colorAuthority?.stroke?.color ?? input.colorAuthority?.color)
    : undefined;
  const resolvedLine = lineNoFill
    ? undefined
    : resolveChartLineStyle(line, {}, { widthToPx: linePointsToCanvasPx });
  const strokeDash = line?.dashStyle ? dashStyleToStrokeDash(line.dashStyle, lineWidth) : undefined;
  const strokeOpacity = resolvedLine?.opacity;
  const hasImportedLineEvidence =
    hasFormatComponent(input.ownerFormat?.line) ||
    hasFormatComponent(input.seriesConfig?.format?.line) ||
    input.seriesConfig?.lineWidth !== undefined;
  if (!strokeVisible) {
    return {
      strokeVisible: false,
      strokeWidth: lineWidth ?? 0,
      strokeStatus: lineNoFill || lineZeroWidth || input.seriesHidden ? 'exact' : 'approximate',
      strokeStatusReason: lineNoFill
        ? 'sourceLineNoFill'
        : lineZeroWidth
          ? 'sourceLineZeroWidth'
          : input.seriesHidden
            ? 'seriesNoFillNoLine'
            : 'radarStrokeNotVisible',
      strokeSourceAuthority: importedAuthority(input.imported),
    };
  }
  if (!strokeColor) {
    return {
      strokeVisible,
      strokeWidth: lineWidth ?? RADAR_DEFAULT_SERIES_STROKE_WIDTH,
      strokeStatus: 'approximate',
      strokeStatusReason: 'radarStrokeColorMissing',
      strokeSourceAuthority: 'mogDeclaredDefault',
    };
  }
  const status = lineVisualStatus({
    colorStatus: input.colorStatus,
    hasImportedLineEvidence: input.imported && hasImportedLineEvidence,
  });
  return {
    strokeVisible,
    strokeColor,
    strokeWidth: lineWidth ?? RADAR_DEFAULT_SERIES_STROKE_WIDTH,
    ...(strokeDash ? { strokeDash } : {}),
    ...(strokeOpacity !== undefined ? { strokeOpacity } : {}),
    strokeStatus: status.status,
    ...(status.reason ? { strokeStatusReason: status.reason } : {}),
    strokeSourceAuthority: statusSourceAuthority(
      status.status,
      input.imported && hasImportedLineEvidence,
    ),
  };
}

function resolveSeriesMarkerVisual(input: {
  config: ChartConfig;
  seriesConfig: SeriesConfig | undefined;
  sourceSeriesIndex: number;
  markers: boolean;
  seriesHidden: boolean;
  colorAuthority: PaintAuthority | undefined;
  colorStatus: RadarVisualStatus;
  imported: boolean;
}): Pick<
  RadarSeriesVisualContract,
  | 'markerVisible'
  | 'markerShape'
  | 'markerSize'
  | 'markerFill'
  | 'markerStroke'
  | 'markerStrokeWidth'
  | 'markerStatus'
  | 'markerStatusReason'
  | 'markerSourceAuthority'
  | 'pointMarkers'
> {
  const markerOwnerKey = `marker(seriesIdx=${input.sourceSeriesIndex})`;
  const markerFormat = resolveChartOwnerFormat(input.config, markerOwnerKey, undefined);
  const markerContext = resolverContextFromConfig(input.config, markerOwnerKey);
  const markerVisible =
    input.markers &&
    !input.seriesHidden &&
    input.seriesConfig?.showMarkers !== false &&
    input.seriesConfig?.markerStyle !== 'none';
  const markerShape = markerVisible
    ? excelMarkerShape(input.seriesConfig?.markerStyle, input.sourceSeriesIndex, input.config)
    : undefined;
  const markerSize = markerVisible
    ? markerPointSizeToArea(input.seriesConfig?.markerSize)
    : undefined;
  const markerFill = markerVisible
    ? (markerFillColor(markerFormat, markerContext) ??
      input.colorAuthority?.markerFill?.color ??
      input.colorAuthority?.fill?.color ??
      input.colorAuthority?.color)
    : undefined;
  const markerStroke = markerVisible
    ? (markerLineColor(markerFormat, markerContext) ??
      input.colorAuthority?.markerStroke?.color ??
      input.colorAuthority?.stroke?.color ??
      input.colorAuthority?.color)
    : undefined;
  const markerStrokeWidth = markerVisible ? markerStrokeWidthFromFormat(markerFormat) : undefined;
  const renderedMarkerStrokeWidth =
    markerVisible && markerStroke ? (markerStrokeWidth ?? 1) : markerStrokeWidth;
  const hasMarkerOwner = chartStyleOwner(input.config, markerOwnerKey)?.format !== undefined;
  const hasMarkerDirectEvidence =
    input.seriesConfig?.markerStyle !== undefined ||
    input.seriesConfig?.markerSize !== undefined ||
    input.seriesConfig?.markerBackgroundColor !== undefined ||
    input.seriesConfig?.markerForegroundColor !== undefined;
  const hasMarkerPaintEvidence =
    markerFormat?.fill !== undefined ||
    markerFormat?.line?.color !== undefined ||
    input.seriesConfig?.markerBackgroundColor !== undefined ||
    input.seriesConfig?.markerForegroundColor !== undefined;
  const hasUnsupportedMarkerStyle = hasUnsupportedMarkerRenderedStyle(markerFormat);
  const markerStatus = markerVisualStatus({
    markerVisible,
    markerStyle: input.seriesConfig?.markerStyle,
    markerFill,
    markerStroke,
    markerStrokeWidth: renderedMarkerStrokeWidth,
    colorStatus: input.colorStatus,
    hasImportedEvidence: input.imported && (hasMarkerOwner || hasMarkerDirectEvidence),
    hasPaintEvidence: input.imported && hasMarkerPaintEvidence,
    hasUnsupportedRenderedStyle: hasUnsupportedMarkerStyle,
  });
  const pointMarkers = (input.seriesConfig?.points ?? [])
    .filter((point) => hasPointMarkerEvidence(input.config, input.sourceSeriesIndex, point))
    .map((point) =>
      resolvePointMarkerVisual({
        config: input.config,
        seriesConfig: input.seriesConfig,
        point,
        sourceSeriesIndex: input.sourceSeriesIndex,
        markers: input.markers,
        seriesHidden: input.seriesHidden,
        seriesMarkerFormat: markerFormat,
        colorAuthority: input.colorAuthority,
        colorStatus: input.colorStatus,
        imported: input.imported,
      }),
    );

  return {
    markerVisible,
    ...(markerShape ? { markerShape } : {}),
    ...(markerSize !== undefined ? { markerSize } : {}),
    ...(markerFill ? { markerFill } : {}),
    ...(markerStroke ? { markerStroke } : {}),
    ...(renderedMarkerStrokeWidth !== undefined
      ? { markerStrokeWidth: renderedMarkerStrokeWidth }
      : {}),
    markerStatus: markerStatus.status,
    ...(markerStatus.reason ? { markerStatusReason: markerStatus.reason } : {}),
    markerSourceAuthority: statusSourceAuthority(
      markerStatus.status,
      input.imported && (hasMarkerOwner || hasMarkerDirectEvidence),
    ),
    pointMarkers,
  };
}

function resolvePointMarkerVisual(input: {
  config: ChartConfig;
  seriesConfig: SeriesConfig | undefined;
  point: PointFormat;
  sourceSeriesIndex: number;
  markers: boolean;
  seriesHidden: boolean;
  seriesMarkerFormat: ChartFormat | undefined;
  colorAuthority: PaintAuthority | undefined;
  colorStatus: RadarVisualStatus;
  imported: boolean;
}): RadarPointMarkerVisualContract {
  const pointOwnerKey = `markerPoint(seriesIdx=${input.sourceSeriesIndex},pointIdx=${input.point.idx})`;
  const pointMarkerFormat = resolveChartOwnerFormat(input.config, pointOwnerKey, undefined);
  const markerFormat = mergeChartFormats(input.seriesMarkerFormat, pointMarkerFormat);
  const context = resolverContextFromConfig(input.config, pointOwnerKey);
  const style = input.point.markerStyle ?? input.seriesConfig?.markerStyle;
  const markerVisible =
    input.markers &&
    !input.seriesHidden &&
    input.seriesConfig?.showMarkers !== false &&
    style !== 'none';
  const pointAuthority = input.colorAuthority?.points?.find(
    (authority) => authority.pointIndex === input.point.idx,
  );
  const markerShape = markerVisible
    ? excelMarkerShape(style, input.sourceSeriesIndex, input.config)
    : undefined;
  const markerSize = markerVisible
    ? markerPointSizeToArea(input.point.markerSize ?? input.seriesConfig?.markerSize)
    : undefined;
  const markerFill = markerVisible
    ? (markerFillColor(markerFormat, context) ??
      pointAuthority?.markerFill?.color ??
      input.colorAuthority?.markerFill?.color ??
      input.colorAuthority?.fill?.color ??
      input.colorAuthority?.color)
    : undefined;
  const markerStroke = markerVisible
    ? (markerLineColor(markerFormat, context) ??
      pointAuthority?.markerStroke?.color ??
      input.colorAuthority?.markerStroke?.color ??
      input.colorAuthority?.stroke?.color ??
      input.colorAuthority?.color)
    : undefined;
  const markerStrokeWidth = markerVisible ? markerStrokeWidthFromFormat(markerFormat) : undefined;
  const renderedMarkerStrokeWidth =
    markerVisible && markerStroke ? (markerStrokeWidth ?? 1) : markerStrokeWidth;
  const hasPointMarkerOwner = chartStyleOwner(input.config, pointOwnerKey)?.format !== undefined;
  const hasDirectEvidence =
    input.point.markerStyle !== undefined ||
    input.point.markerSize !== undefined ||
    input.point.markerBackgroundColor !== undefined ||
    input.point.markerForegroundColor !== undefined;
  const hasMarkerPaintEvidence =
    input.seriesMarkerFormat?.fill !== undefined ||
    input.seriesMarkerFormat?.line?.color !== undefined ||
    pointMarkerFormat?.fill !== undefined ||
    pointMarkerFormat?.line?.color !== undefined ||
    input.point.markerBackgroundColor !== undefined ||
    input.point.markerForegroundColor !== undefined;
  const hasUnsupportedMarkerStyle =
    hasUnsupportedMarkerRenderedStyle(input.seriesMarkerFormat) ||
    hasUnsupportedMarkerRenderedStyle(pointMarkerFormat);
  const status = markerVisualStatus({
    markerVisible,
    markerStyle: style,
    markerFill,
    markerStroke,
    markerStrokeWidth: renderedMarkerStrokeWidth,
    colorStatus: input.colorStatus,
    hasImportedEvidence: input.imported && (hasPointMarkerOwner || hasDirectEvidence),
    hasPaintEvidence: input.imported && hasMarkerPaintEvidence,
    hasUnsupportedRenderedStyle: hasUnsupportedMarkerStyle,
  });
  return {
    pointIndex: input.point.idx,
    markerVisible,
    ...(markerShape ? { markerShape } : {}),
    ...(markerSize !== undefined ? { markerSize } : {}),
    ...(markerFill ? { markerFill } : {}),
    ...(markerStroke ? { markerStroke } : {}),
    ...(renderedMarkerStrokeWidth !== undefined
      ? { markerStrokeWidth: renderedMarkerStrokeWidth }
      : {}),
    markerStatus: status.status,
    ...(status.reason ? { markerStatusReason: status.reason } : {}),
    markerSourceAuthority: statusSourceAuthority(
      status.status,
      input.imported && (hasPointMarkerOwner || hasDirectEvidence),
    ),
  };
}

function hasPointMarkerEvidence(
  config: ChartConfig,
  sourceSeriesIndex: number,
  point: PointFormat,
): boolean {
  const pointOwnerKey = `markerPoint(seriesIdx=${sourceSeriesIndex},pointIdx=${point.idx})`;
  return (
    chartStyleOwner(config, pointOwnerKey)?.format !== undefined ||
    point.markerStyle !== undefined ||
    point.markerSize !== undefined ||
    point.markerBackgroundColor !== undefined ||
    point.markerForegroundColor !== undefined
  );
}

function axisLineContract(input: {
  category: Extract<ContractCategory, 'grid' | 'spokes'>;
  axisConfig: ReturnType<typeof resolveAxisConfigForChannel> | undefined;
  axis: AxisSpec | undefined;
  imported: boolean;
  lineKind: 'grid' | 'axis';
  rendered: Record<string, ContractValue | undefined>;
}): ResolvedChartRadarStyleContractEntrySnapshot {
  const visible = Boolean(input.rendered.enabled);
  const line =
    input.lineKind === 'grid' ? input.axisConfig?.gridlineFormat : input.axisConfig?.format?.line;
  const hiddenBySource =
    input.lineKind === 'grid'
      ? input.axisConfig?.gridLines === false || line?.noFill === true || input.axis?.grid === false
      : input.axisConfig?.visible === false ||
        line?.noFill === true ||
        input.axis?.domain === false;
  if (!visible || hiddenBySource) {
    return contractEntry({
      category: input.category,
      fidelity: 'exact',
      sourceAuthority: importedAuthority(input.imported),
      rendered: input.rendered,
      ...(hiddenBySource ? { reason: 'sourceAxisLineHidden' } : {}),
    });
  }
  const hasLineEvidence = input.lineKind === 'grid' ? line !== undefined : line !== undefined;
  const hasColor =
    input.lineKind === 'grid'
      ? input.axis?.gridColor !== undefined
      : input.axis?.domainColor !== undefined || input.axis?.tickColor !== undefined;
  const hasWidth =
    input.lineKind === 'grid'
      ? input.axis?.gridWidth !== undefined
      : input.axis?.domainWidth !== undefined || input.axis?.tickWidth !== undefined;
  if (input.imported && hasLineEvidence && hasColor && hasWidth && !isUnsupportedLine(line)) {
    return contractEntry({
      category: input.category,
      fidelity: 'exact',
      sourceAuthority: 'imported',
      rendered: input.rendered,
    });
  }
  if (!hasLineEvidence) {
    return contractEntry({
      category: input.category,
      fidelity: 'exact',
      sourceAuthority: 'excelDefault',
      rendered: input.rendered,
    });
  }
  if (input.imported && !isUnsupportedLine(line)) {
    return contractEntry({
      category: input.category,
      fidelity: 'exact',
      sourceAuthority: 'imported',
      rendered: input.rendered,
    });
  }
  return contractEntry({
    category: input.category,
    fidelity: isUnsupportedLine(line) ? 'unknown' : 'deterministicApproximation',
    sourceAuthority: isUnsupportedLine(line)
      ? importedAuthority(input.imported)
      : 'mogDeclaredDefault',
    rendered: input.rendered,
    requiresHumanReview: isUnsupportedLine(line),
    reason: isUnsupportedLine(line)
      ? `radar ${input.category} line style is not fully represented`
      : `radar ${input.category} style lacks imported or verified Excel-default authority`,
  });
}

function axisLabelContract(input: {
  category: Extract<ContractCategory, 'categoryLabels' | 'valueLabels'>;
  axisConfig: ReturnType<typeof resolveAxisConfigForChannel> | undefined;
  axis: AxisSpec | undefined;
  imported: boolean;
  rendered: Record<string, ContractValue | undefined>;
}): ResolvedChartRadarStyleContractEntrySnapshot {
  const visible = Boolean(input.rendered.enabled);
  if (!visible) {
    return contractEntry({
      category: input.category,
      fidelity: 'exact',
      sourceAuthority: importedAuthority(input.imported),
      rendered: input.rendered,
      reason: 'sourceAxisLabelsHidden',
    });
  }
  const ownerFormat = input.axisConfig ? input.axisConfig.format : undefined;
  const hasSupportedLabelEvidence = input.imported && ownerFormat !== undefined;
  return contractEntry({
    category: input.category,
    fidelity: 'exact',
    sourceAuthority: hasSupportedLabelEvidence ? 'imported' : 'excelDefault',
    rendered: input.rendered,
  });
}

function seriesContract(input: {
  category: ContractCategory;
  enabled: boolean;
  evidences: CategoryEvidence[];
  rendered: Record<string, ContractValue | undefined>;
  approximateReason: string;
}): ResolvedChartRadarStyleContractEntrySnapshot {
  if (!input.enabled) {
    return contractEntry({
      category: input.category,
      fidelity: 'exact',
      sourceAuthority: 'notApplicable',
      rendered: input.rendered,
    });
  }
  const evidences =
    input.evidences.length > 0
      ? input.evidences
      : [
          {
            visible: true,
            status: 'approximate' as RadarVisualStatus,
            sourceAuthority: 'mogDeclaredDefault' as ResolvedChartRadarStyleSourceAuthority,
            reason: 'radarSeriesVisualEvidenceMissing',
          },
        ];
  const unknown = evidences.find((item) => item.status === 'unknown');
  if (unknown) {
    return contractEntry({
      category: input.category,
      fidelity: 'unknown',
      sourceAuthority: unknown.sourceAuthority,
      rendered: input.rendered,
      requiresHumanReview: unknown.requiresHumanReview ?? true,
      reason: unknown.reason ?? `${input.category} style requires review`,
    });
  }
  const approximate = evidences.find((item) => item.status === 'approximate');
  if (approximate) {
    return contractEntry({
      category: input.category,
      fidelity: 'deterministicApproximation',
      sourceAuthority: 'mogDeclaredDefault',
      rendered: input.rendered,
      reason: approximate.reason ?? input.approximateReason,
    });
  }
  return contractEntry({
    category: input.category,
    fidelity: 'exact',
    sourceAuthority: evidences.some((item) => item.sourceAuthority === 'imported')
      ? 'imported'
      : 'excelDefault',
    rendered: input.rendered,
  });
}

function contractEntry(input: {
  category: ContractCategory;
  fidelity: ResolvedChartRadarStyleContractFidelity;
  sourceAuthority: ResolvedChartRadarStyleSourceAuthority;
  rendered: Record<string, ContractValue | undefined>;
  requiresHumanReview?: boolean;
  reason?: string;
}): ResolvedChartRadarStyleContractEntrySnapshot {
  return {
    category: input.category,
    fidelity: input.fidelity,
    sourceAuthority: input.sourceAuthority,
    requiresHumanReview: input.requiresHumanReview ?? false,
    rendered: compactRendered(input.rendered),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

function colorAuthorityVisualStatus(authority: PaintAuthority | undefined): RadarVisualStatus {
  if (!authority || authority.source === 'unknown') return 'approximate';
  if (authority.fallback === true) return 'verifiedDefault';
  return 'exact';
}

function fillColorStatus(input: {
  visible: boolean;
  color: string | undefined;
  colorStatus: RadarVisualStatus;
  hasImportedEvidence: boolean;
}): { status: RadarVisualStatus; reason?: string } {
  if (!input.visible) return { status: 'exact' };
  if (!input.color) return { status: 'approximate', reason: 'radarFillColorMissing' };
  if (input.colorStatus === 'approximate') {
    return { status: 'approximate', reason: 'radarFillColorAuthorityUnresolved' };
  }
  if (!input.hasImportedEvidence && input.colorStatus !== 'verifiedDefault') {
    return { status: 'approximate', reason: 'radarFillImportedEvidenceMissing' };
  }
  return { status: input.colorStatus };
}

function lineVisualStatus(input: {
  colorStatus: RadarVisualStatus;
  hasImportedLineEvidence: boolean;
}): { status: RadarVisualStatus; reason?: string } {
  if (input.colorStatus === 'approximate') {
    return { status: 'approximate', reason: 'radarStrokeColorAuthorityUnresolved' };
  }
  if (!input.hasImportedLineEvidence && input.colorStatus !== 'verifiedDefault') {
    return { status: 'approximate', reason: 'radarStrokeImportedEvidenceMissing' };
  }
  return { status: input.colorStatus };
}

function markerVisualStatus(input: {
  markerVisible: boolean;
  markerStyle: string | undefined;
  markerFill: string | undefined;
  markerStroke: string | undefined;
  markerStrokeWidth: number | undefined;
  colorStatus: RadarVisualStatus;
  hasImportedEvidence: boolean;
  hasPaintEvidence: boolean;
  hasUnsupportedRenderedStyle: boolean;
}): { status: RadarVisualStatus; reason?: string } {
  if (!input.markerVisible) return { status: 'exact', reason: 'sourceMarkerDisabled' };
  if (input.markerStyle === 'picture') {
    return { status: 'unknown', reason: 'unsupportedRadarMarkerPicture' };
  }
  if (input.hasUnsupportedRenderedStyle) {
    return { status: 'approximate', reason: 'radarMarkerRenderedStyleIncomplete' };
  }
  if (!input.markerFill && !input.markerStroke) {
    return { status: 'approximate', reason: 'radarMarkerPaintMissing' };
  }
  if (input.markerStroke && input.markerStrokeWidth === undefined) {
    return { status: 'approximate', reason: 'radarMarkerStrokeWidthDefaultUnverified' };
  }
  if (input.colorStatus === 'approximate' && !input.hasPaintEvidence) {
    return { status: 'approximate', reason: 'radarMarkerColorAuthorityUnresolved' };
  }
  if (!input.hasImportedEvidence && input.colorStatus !== 'verifiedDefault') {
    return { status: 'approximate', reason: 'radarMarkerImportedEvidenceMissing' };
  }
  return { status: input.hasPaintEvidence ? 'exact' : input.colorStatus };
}

function markerFillColor(
  format: ChartFormat | undefined,
  context: ReturnType<typeof resolverContextFromConfig>,
): string | undefined {
  if (format?.fill?.type === 'none') return 'rgba(0, 0, 0, 0)';
  const paint = resolveChartFillPaint(format?.fill, context);
  return paint?.type === 'solid' ? paint.color : undefined;
}

function markerLineColor(
  format: ChartFormat | undefined,
  context: ReturnType<typeof resolverContextFromConfig>,
): string | undefined {
  if (format?.line?.noFill === true) return undefined;
  const line = resolveChartLineStyle(format?.line, context, { widthToPx: linePointsToCanvasPx });
  return line?.paint?.type === 'solid' ? line.paint.color : undefined;
}

function markerStrokeWidthFromFormat(format: ChartFormat | undefined): number | undefined {
  if (format?.line?.noFill === true) return 0;
  return linePointsToCanvasPx(format?.line?.width);
}

function hasUnsupportedMarkerRenderedStyle(format: ChartFormat | undefined): boolean {
  return Boolean(
    format?.fill?.type === 'gradient' ||
    format?.fill?.type === 'pattern' ||
    (format?.fill?.type === 'solid' && format.fill.transparency !== undefined) ||
    format?.line?.transparency !== undefined ||
    format?.line?.dashStyle !== undefined,
  );
}

function statusSourceAuthority(
  status: RadarVisualStatus,
  importedEvidence: boolean,
): ResolvedChartRadarStyleSourceAuthority {
  if (status === 'verifiedDefault') return 'excelDefault';
  if (status === 'exact') return importedEvidence ? 'imported' : 'excelDefault';
  return importedEvidence && status === 'unknown' ? 'imported' : 'mogDeclaredDefault';
}

function importedAuthority(imported: boolean): ResolvedChartRadarStyleSourceAuthority {
  return imported ? 'imported' : 'mogDeclaredDefault';
}

function isUnsupportedFill(fill: ChartFormat['fill'] | undefined): boolean {
  return fill?.type === 'gradient' || fill?.type === 'pattern';
}

function isUnsupportedLine(line: ChartFormat['line'] | undefined): boolean {
  return line?.dashStyle === undefined
    ? false
    : dashStyleToStrokeDash(line.dashStyle, 1) === undefined;
}

function hasFormatComponent(value: unknown): boolean {
  return value !== undefined;
}

function contractReasons(contracts: ResolvedChartRadarStyleContractEntrySnapshot[]): string[] {
  return contracts
    .filter((contract) => contract.fidelity !== 'exact')
    .map((contract) => `${contractReasonName(contract.category)}:${contract.fidelity}`);
}

function legacyFidelity(
  contract: ResolvedChartRadarStyleContractEntrySnapshot,
): 'exact' | 'approximate' | 'unknown' {
  if (contract.fidelity === 'exact') return 'exact';
  if (contract.fidelity === 'unknown') return 'unknown';
  return 'approximate';
}

function aggregateLegacyFidelity(
  contracts: ResolvedChartRadarStyleContractEntrySnapshot[],
): 'exact' | 'approximate' | 'unknown' {
  if (contracts.some((contract) => contract.fidelity === 'unknown')) return 'unknown';
  if (contracts.some((contract) => contract.fidelity !== 'exact')) return 'approximate';
  return 'exact';
}

function compactRendered(
  rendered: Record<string, ContractValue | undefined>,
): Record<string, ContractValue> {
  return Object.fromEntries(
    Object.entries(rendered).filter(
      (entry): entry is [string, ContractValue] => entry[1] !== undefined,
    ),
  );
}

function firstDefined<T>(values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

function dashValue(dash: number[] | undefined): string | undefined {
  return dash && dash.length > 0 ? dash.join(',') : undefined;
}

function contractReasonName(category: ContractCategory): string {
  switch (category) {
    case 'fill':
      return 'radarFillStyleFidelity';
    case 'marker':
      return 'radarMarkerStyleFidelity';
    case 'stroke':
      return 'radarStrokeStyleFidelity';
    case 'grid':
    case 'spokes':
    case 'categoryLabels':
    case 'valueLabels':
      return 'radarGridLabelStyleFidelity';
  }
}
