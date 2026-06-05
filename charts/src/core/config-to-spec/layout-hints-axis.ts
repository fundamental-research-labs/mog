import type {
  AxisLayoutStatus,
  AxisSpec,
  ChannelSpec,
  ConfigSpec,
  EncodingSpec,
  ScaleSpec,
} from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { formatExcelSerialDateTick, formatTickValue } from '../../grammar/axis-generator';
import { generateTicks, niceLinear } from '../../primitives/scales/linear';
import { buildAxisScaleSpec, explicitDomainBound, mapAxisConfigToAxisSpec } from './axis';
import { chartImportSourceDialect, hasExcelBarGeometryConfig } from './bar-geometry';
import { categoryDisplayLabel } from './category-axis';
import { isPathLikeChartType } from './path-axis-layout';
import { hasSecondaryYAxis } from './secondary-axis';
import { seriesConfigForDataSeries } from '../series-identity';
import { isSupportedChartType, resolveComboSeriesType } from './layers/combo-series-options';

const UNRESOLVED_AXIS_LABEL_FONT_SIZE = 11;
const AXIS_TEXT_WIDTH_RATIO = 0.6;
const AXIS_EDGE_PADDING = 8;
const DEFAULT_AXIS_TITLE_PADDING = 10;

type AxisReservations = NonNullable<ConfigSpec['layoutHints']>['axisReservations'];
type LayoutSide = 'top' | 'right' | 'bottom' | 'left';

export function estimateBarColumnAxisReservations(
  config: ChartConfig,
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): AxisReservations | undefined {
  if (!encoding || !hasExcelBarGeometryConfig(config)) return undefined;

  const reservations: Required<Pick<NonNullable<AxisReservations>, LayoutSide>> & {
    source: 'excelBarColumn';
  } = {
    source: 'excelBarColumn',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };

  reserveAxis('x', encoding.x, encoding.x?.axis, encoding, data, reservations);
  reserveAxis('x', encoding.x, encoding.x?.secondaryAxis, encoding, data, reservations);
  reserveAxis('y', encoding.y, encoding.y?.axis, encoding, data, reservations);
  reserveAxis('y', encoding.y, encoding.y?.secondaryAxis, encoding, data, reservations);

  return reservations;
}

export function estimatePathChartAxisReservations(
  config: ChartConfig,
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): AxisReservations | undefined {
  if (!encoding || !hasImportedPathAxisLayout(config, data)) return undefined;

  const reservations: Required<Pick<NonNullable<AxisReservations>, LayoutSide>> & {
    source: 'excelPath';
    status?: AxisLayoutStatus;
    statusReason?: string;
  } = {
    source: 'excelPath',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const status = pathAxisReservationStatus(encoding);
  if (status.status) reservations.status = status.status;
  if (status.reason) reservations.statusReason = status.reason;

  reserveAxis('x', encoding.x, encoding.x?.axis, encoding, data, reservations);
  reserveAxis('x', encoding.x, encoding.x?.secondaryAxis, encoding, data, reservations);
  reserveAxis('y', encoding.y, encoding.y?.axis, encoding, data, reservations);
  reserveAxis('y', encoding.y, encoding.y?.secondaryAxis, encoding, data, reservations);

  return reservations;
}

function hasImportedPathAxisLayout(config: ChartConfig, data: ChartData | undefined): boolean {
  if (chartImportSourceDialect(config) === undefined) return false;
  if (isPathLikeChartType(config.type)) return true;
  if (config.type !== 'combo' || !data) return false;

  return data.series.some((series, index) => {
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    const seriesType = resolveComboSeriesType(config, series, seriesConfig, index);
    return isSupportedChartType(seriesType) && isPathLikeChartType(seriesType);
  });
}

function pathAxisReservationStatus(encoding: EncodingSpec): {
  status?: AxisLayoutStatus;
  reason?: string;
} {
  for (const axis of [
    encoding.x?.axis,
    encoding.x?.secondaryAxis,
    encoding.y?.axis,
    encoding.y?.secondaryAxis,
  ]) {
    if (!axis || axis === null) continue;
    if (axis.pathAxisReservationStatus) {
      return {
        status: axis.pathAxisReservationStatus,
        reason: axis.pathAxisReservationStatusReason,
      };
    }
  }
  return {};
}

function reserveAxis(
  channelName: 'x' | 'y',
  channel: ChannelSpec | undefined,
  axis: AxisSpec | null | undefined,
  encoding: EncodingSpec,
  data: ChartData | undefined,
  reservations: Required<Pick<NonNullable<AxisReservations>, LayoutSide>>,
): void {
  if (!channel || axis === null) return;

  const labelsInside = categoryAxisLabelsInsidePlot(channelName, encoding, data);
  const labelSide = channelName === 'x' ? xAxisLabelSide(axis) : yAxisLabelSide(axis);
  const titleSide = labelsInside ? defaultAxisSide(channelName, axis) : labelSide;

  const labelReservation = labelsInside
    ? 0
    : channelName === 'x'
      ? xAxisLabelReservation(channel, axis, data)
      : yAxisLabelReservation(channel, axis, data);
  const titleReservation = axisTitleReservation(channel, axis);

  if (labelReservation > 0) {
    reservations[labelSide] = Math.max(reservations[labelSide], labelReservation);
  }
  if (titleReservation > 0) {
    reservations[titleSide] = Math.max(
      reservations[titleSide],
      titleSide === labelSide ? labelReservation + titleReservation : titleReservation,
    );
  }
}

function xAxisLabelReservation(
  channel: ChannelSpec,
  axis: AxisSpec | undefined,
  data: ChartData | undefined,
): number {
  if (axis?.labels === false || axis?.labelPosition === 'none') return tickReservation(axis);

  const fontSize = axis?.labelFontSize ?? UNRESOLVED_AXIS_LABEL_FONT_SIZE;
  const labelAngle = axis?.labelAngle ?? 0;
  const labelPadding = axis?.labelPadding ?? (labelAngle ? 2 : 3);
  const multiLevelLabelCount = maxMultiLevelLabelCount(axis);
  const labelExtent =
    Math.abs(labelAngle) <= 1 && multiLevelLabelCount > 1
      ? multiLevelLabelCount * (fontSize + 2)
      : rotatedTextHeight(maxAxisLabelWidth(channel, axis, data, fontSize), fontSize, labelAngle);

  return Math.ceil(tickReservation(axis) + labelPadding + labelExtent + AXIS_EDGE_PADDING);
}

function yAxisLabelReservation(
  channel: ChannelSpec,
  axis: AxisSpec | undefined,
  data: ChartData | undefined,
): number {
  if (axis?.labels === false || axis?.labelPosition === 'none') return tickReservation(axis);

  const fontSize = axis?.labelFontSize ?? UNRESOLVED_AXIS_LABEL_FONT_SIZE;
  const labelAngle = axis?.labelAngle ?? 0;
  const labelPadding = axis?.labelPadding ?? 3;
  const multiLevelWidth = estimateMultiLevelYAxisLabelWidth(axis, fontSize);
  const labelExtent =
    multiLevelWidth ??
    rotatedTextWidth(maxAxisLabelWidth(channel, axis, data, fontSize), fontSize, labelAngle);

  return Math.ceil(tickReservation(axis) + labelPadding + labelExtent + AXIS_EDGE_PADDING);
}

function axisTitleReservation(channel: ChannelSpec, axis: AxisSpec | undefined): number {
  if (axis?.title === null) return 0;
  const title = axis?.title ?? channel.title;
  if (!title) return 0;
  const fontSize = axis?.titleFontSize ?? 12;
  return Math.ceil((axis?.titlePadding ?? DEFAULT_AXIS_TITLE_PADDING) + fontSize);
}

function tickReservation(axis: AxisSpec | undefined): number {
  return axis?.ticks === false ? 0 : (axis?.tickSize ?? 6);
}

function maxAxisLabelWidth(
  channel: ChannelSpec,
  axis: AxisSpec | undefined,
  data: ChartData | undefined,
  fontSize: number,
): number {
  const labels = visibleAxisLabels(axis, axisLabelCandidates(channel, axis, data));
  const maxLabelLength = Math.max(1, ...labels.map((label) => label.length));
  return Math.ceil(maxLabelLength * fontSize * AXIS_TEXT_WIDTH_RATIO);
}

function visibleAxisLabels(axis: AxisSpec | undefined, labels: string[]): string[] {
  const skip = normalizedSkip(axis?.tickLabelSkip);
  if (!skip || skip <= 1) return labels.length > 0 ? labels : [''];
  const visible = labels.filter((_label, index) => index % skip === 0);
  return visible.length > 0 ? visible : labels;
}

function axisLabelCandidates(
  channel: ChannelSpec,
  axis: AxisSpec | undefined,
  data: ChartData | undefined,
): string[] {
  if (channel.type === 'quantitative') {
    return quantitativeAxisLabels(axis, channel.scale, channel.format);
  }

  const labels: string[] = [];
  if (axis?.labelTextByValue) labels.push(...Object.values(axis.labelTextByValue));
  if (axis?.multiLevelLabelsByValue) {
    labels.push(...Object.values(axis.multiLevelLabelsByValue).flat());
  }
  if (labels.length > 0) return labels.filter((label) => label !== '');

  const scaleDomain = Array.isArray(channel.scale?.domain) ? channel.scale.domain : undefined;
  if (scaleDomain && scaleDomain.length > 0) {
    return scaleDomain.map((value) => axisLabelForValue(axis, value, channel.format));
  }

  return (data?.categories ?? []).map(categoryDisplayLabel);
}

function quantitativeAxisLabels(
  axis: AxisSpec | undefined,
  scale: ScaleSpec | null | undefined,
  format: string | undefined,
): string[] {
  if (axis?.labels === false) return [];

  const scaleDomain = Array.isArray(scale?.domain) ? scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined) return [];

  const tickCount = axis?.tickCount ?? 10;
  const domain =
    scale?.nice === false
      ? ([min, max] as [number, number])
      : niceLinear(min, max, typeof scale?.nice === 'number' ? scale.nice : tickCount);
  const ticks = generateTicks(domain[0], domain[1], tickCount);
  const values = ticks.length > 0 ? ticks : domain;
  return values.map((value) => axisLabelForValue(axis, value, format));
}

function axisLabelForValue(
  axis: AxisSpec | undefined,
  value: unknown,
  format: string | undefined,
): string {
  const mapped = axis?.labelTextByValue?.[String(value)];
  if (mapped !== undefined) return mapped;
  if (axis?.formatType === 'time') return formatExcelSerialDateTick(value, format);
  if (axis?.percentAxisLabelPolicy === 'percentFromHundred') {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) {
      return formatTickValue(numeric / 100, percentAxisFormat(format ?? axis.format));
    }
  }
  return formatTickValue(value, format ?? axis?.format);
}

function percentAxisFormat(format: string | undefined): string {
  return format && format.length > 0 ? format : '0%';
}

function xAxisLabelSide(axis: AxisSpec | undefined): Extract<LayoutSide, 'top' | 'bottom'> {
  if (axis?.labelPosition === 'high') return 'top';
  if (axis?.labelPosition === 'low') return 'bottom';
  return axis?.orient === 'top' ? 'top' : 'bottom';
}

function yAxisLabelSide(axis: AxisSpec | undefined): Extract<LayoutSide, 'left' | 'right'> {
  if (axis?.labelPosition === 'high') return 'right';
  if (axis?.labelPosition === 'low') return 'left';
  return axis?.orient === 'right' ? 'right' : 'left';
}

function defaultAxisSide(channelName: 'x' | 'y', axis: AxisSpec | undefined): LayoutSide {
  if (channelName === 'x') return axis?.orient === 'top' ? 'top' : 'bottom';
  return axis?.orient === 'right' ? 'right' : 'left';
}

function normalizedSkip(skip: number | undefined): number | undefined {
  if (skip === undefined || !Number.isFinite(skip) || skip < 1) return undefined;
  return Math.max(1, Math.floor(skip));
}

function rotatedTextWidth(width: number, height: number, angleDegrees: number): number {
  const radians = (Math.abs(angleDegrees) * Math.PI) / 180;
  return Math.cos(radians) * width + Math.sin(radians) * height;
}

function rotatedTextHeight(width: number, height: number, angleDegrees: number): number {
  const radians = (Math.abs(angleDegrees) * Math.PI) / 180;
  return Math.sin(radians) * width + Math.cos(radians) * height;
}

export function estimateNominalYAxisLabelWidth(
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): number | undefined {
  const y = encoding?.y;
  if (!y || y.type === 'quantitative' || y.axis === null || y.axis?.labels === false) {
    return undefined;
  }
  if (categoryAxisLabelsInsidePlot('y', encoding, data)) {
    return 0;
  }

  const labels = data?.categories ?? [];
  if (labels.length === 0) return undefined;

  const fontSize = y.axis?.labelFontSize ?? UNRESOLVED_AXIS_LABEL_FONT_SIZE;
  const estimatedWidth =
    estimateMultiLevelYAxisLabelWidth(y.axis, fontSize) ??
    estimateSingleColumnYAxisLabelWidth(labels, fontSize);
  if (estimatedWidth === undefined) return undefined;
  return Math.max(60, Math.min(660, estimatedWidth));
}

export function estimateYAxisLabelWidth(encoding: EncodingSpec | undefined): number | undefined {
  const y = encoding?.y;
  if (!y || y.type !== 'quantitative' || y.axis === null || y.axis?.labels === false) {
    return undefined;
  }

  return estimateQuantitativeAxisLabelWidth(y.axis, y.scale, y.format);
}

export function estimateSecondaryYAxisLabelWidth(
  config: ChartConfig,
  data: ChartData | undefined,
): number | undefined {
  if (!hasSecondaryYAxis(config, data)) return undefined;
  const secondaryAxis = config.axis?.secondaryValueAxis ?? config.axis?.secondaryYAxis;
  if (!secondaryAxis) return undefined;

  const ownerKey = config.axis?.secondaryValueAxis ? 'secondaryValueAxis' : 'secondaryYAxis';
  const axis = mapAxisConfigToAxisSpec(secondaryAxis, config, ownerKey);
  const scale = buildAxisScaleSpec(secondaryAxis, false);
  return estimateQuantitativeAxisLabelWidth(axis, scale, axis.format);
}

export function estimateXAxisBottomMargin(
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): number | undefined {
  const x = encoding?.x;
  const y = encoding?.y;
  if (!x || x.axis === null || x.axis?.labels === false) return undefined;

  const labelAngle = x.axis?.labelAngle ?? 0;
  const fontSize = x.axis?.labelFontSize ?? UNRESOLVED_AXIS_LABEL_FONT_SIZE;
  const labelPadding = x.axis?.labelPadding ?? (labelAngle ? 2 : 3);
  const tickExtent = x.axis?.ticks === false ? 0 : (x.axis?.tickSize ?? 6);
  const multiLevelLabelCount = maxMultiLevelLabelCount(x.axis);

  if (
    Math.abs(labelAngle) <= 1 &&
    multiLevelLabelCount > 1 &&
    xAxisLabelSideForMargin(x.axis) === 'bottom'
  ) {
    return Math.max(
      32,
      Math.ceil(tickExtent + labelPadding + multiLevelLabelCount * (fontSize + 2) + 8),
    );
  }

  if (Math.abs(labelAngle) > 1) {
    const labelWidth = estimateXAxisMaxLabelWidth(x, fontSize);
    const radians = (Math.abs(labelAngle) * Math.PI) / 180;
    const rotatedHeight = Math.sin(radians) * labelWidth + Math.cos(radians) * fontSize;
    return Math.max(40, Math.ceil(tickExtent + labelPadding + rotatedHeight + 8));
  }

  if (!y || y.type !== 'quantitative' || x.axis?.crossesAt !== 'automatic') {
    return undefined;
  }

  const scaleDomain = Array.isArray(y.scale?.domain) ? y.scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined || min >= 0 || max <= 0) return undefined;

  return Math.max(24, Math.ceil(fontSize + labelPadding + 3));
}

function estimateQuantitativeAxisLabelWidth(
  axis: AxisSpec | undefined,
  scale: ScaleSpec | null | undefined,
  format: string | undefined,
): number | undefined {
  if (axis?.labels === false) return undefined;

  const scaleDomain = Array.isArray(scale?.domain) ? scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined) return undefined;

  const tickCount = axis?.tickCount ?? 10;
  const domain =
    scale?.nice === false
      ? ([min, max] as [number, number])
      : niceLinear(min, max, typeof scale?.nice === 'number' ? scale.nice : tickCount);
  const ticks = generateTicks(domain[0], domain[1], tickCount);
  const values = ticks.length > 0 ? ticks : domain;
  const maxLabelLength = Math.max(
    0,
    ...values.map((value) => axisLabelForValue(axis, value, format ?? axis?.format).length),
  );
  if (maxLabelLength === 0) return undefined;

  const fontSize = axis?.labelFontSize ?? UNRESOLVED_AXIS_LABEL_FONT_SIZE;
  const maxMagnitude = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
  const charWidthRatio = maxMagnitude >= 1_000_000 ? 0.6 : 0.52;
  const estimatedWidth = Math.ceil(maxLabelLength * fontSize * charWidthRatio);
  return Math.max(36, Math.min(320, estimatedWidth));
}

function estimateSingleColumnYAxisLabelWidth(
  labels: Array<string | number | null | undefined>,
  fontSize: number,
): number | undefined {
  const maxLabelLength = Math.max(0, ...labels.map((label) => String(label ?? '').length));
  return maxLabelLength > 0 ? Math.ceil(maxLabelLength * fontSize * 0.52) : undefined;
}

function estimateMultiLevelYAxisLabelWidth(
  axis: AxisSpec | null | undefined,
  fontSize: number,
): number | undefined {
  const labelsByValue = axis?.multiLevelLabelsByValue;
  if (!labelsByValue) return undefined;
  const labels = Object.values(labelsByValue);
  const levelCount = Math.max(0, ...labels.map((item) => item.length));
  if (levelCount <= 1) return undefined;

  let width = 0;
  for (let level = 0; level < levelCount; level += 1) {
    const maxLabelLength = Math.max(0, ...labels.map((item) => item[level]?.length ?? 0));
    if (maxLabelLength > 0) {
      width += Math.ceil(maxLabelLength * fontSize * 0.52) + 12;
    }
  }
  return width > 0 ? width : undefined;
}

function estimateXAxisMaxLabelWidth(x: ChannelSpec, fontSize: number): number {
  const axis = x.axis;
  const format = x.format ?? axis?.format;
  const scaleDomain = Array.isArray(x.scale?.domain) ? x.scale.domain : undefined;
  const candidates = scaleDomain?.filter((value) => value !== undefined) ?? [];
  if (candidates.length === 0) return fontSize * 8;

  const maxLabelLength = Math.max(
    1,
    ...candidates.map((value) => {
      const text =
        axis?.formatType === 'time'
          ? formatExcelSerialDateTick(value, format)
          : formatTickValue(value, format);
      return text.length;
    }),
  );
  return Math.ceil(maxLabelLength * fontSize * 0.52);
}

function maxMultiLevelLabelCount(axis: AxisSpec | null | undefined): number {
  const labelsByValue = axis?.multiLevelLabelsByValue;
  if (!labelsByValue) return 0;
  return Math.max(0, ...Object.values(labelsByValue).map((labels) => labels.length));
}

function xAxisLabelSideForMargin(axis: AxisSpec | null | undefined): 'top' | 'bottom' {
  if (axis?.labelPosition === 'high') return 'top';
  if (axis?.labelPosition === 'low') return 'bottom';
  return axis?.orient === 'top' ? 'top' : 'bottom';
}

export function categoryAxisLabelsInsidePlot(
  axis: 'x' | 'y',
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): boolean {
  const categoryChannel = axis === 'x' ? encoding?.x : encoding?.y;
  const valueChannel = axis === 'x' ? encoding?.y : encoding?.x;
  if (!categoryChannel || !valueChannel) return false;
  if (categoryChannel.type === 'quantitative' || valueChannel.type !== 'quantitative') {
    return false;
  }
  const axisSpec = categoryChannel.axis;
  if (axisSpec === null) return false;
  if (axisSpec?.labels === false) return false;
  if (axisSpec?.labelPosition && axisSpec.labelPosition !== 'nextTo') return false;
  if (axisSpec?.crossesAt !== 'automatic' && axisSpec?.crossesAt !== 'custom') return false;

  const domain = valueDomain(valueChannel, data);
  if (!domain) return false;
  const [min, max] = domain;
  if (axisSpec?.crossesAt === 'custom') {
    const crossing = axisSpec.crossesAtValue;
    return typeof crossing === 'number' && crossing > min && crossing < max;
  }
  return min < 0 && max > 0;
}

function valueDomain(
  channel: ChannelSpec,
  data: ChartData | undefined,
): [number, number] | undefined {
  const scaleDomain = Array.isArray(channel.scale?.domain) ? channel.scale.domain : undefined;
  const explicitMin = explicitDomainBound(scaleDomain, 0);
  const explicitMax = explicitDomainBound(scaleDomain, 1);
  if (explicitMin !== undefined && explicitMax !== undefined) {
    return [Math.min(explicitMin, explicitMax), Math.max(explicitMin, explicitMax)];
  }

  const values: number[] = [];
  for (const series of data?.series ?? []) {
    for (const point of series.data) {
      if (typeof point.y === 'number' && Number.isFinite(point.y)) values.push(point.y);
    }
  }
  if (values.length === 0) return undefined;
  return [Math.min(...values), Math.max(...values)];
}
