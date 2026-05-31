import type { AxisSpec, ChannelSpec, EncodingSpec, ScaleSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { DEFAULT_AXIS_LABEL_FONT_SIZE } from '../../defaults';
import { formatExcelSerialDateTick, formatTickValue } from '../../grammar/axis-generator';
import { generateTicks, niceLinear } from '../../primitives/scales/linear';
import { buildAxisScaleSpec, explicitDomainBound, mapAxisConfigToAxisSpec } from './axis';
import { hasSecondaryYAxis } from './secondary-axis';

export function estimateNominalYAxisLabelWidth(
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): number | undefined {
  const y = encoding?.y;
  if (!y || y.type === 'quantitative' || y.axis === null || y.axis?.labels === false) {
    return undefined;
  }

  const labels = data?.categories ?? [];
  if (labels.length === 0) return undefined;

  const fontSize = y.axis?.labelFontSize ?? DEFAULT_AXIS_LABEL_FONT_SIZE;
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

export function estimateXAxisBottomMargin(encoding: EncodingSpec | undefined): number | undefined {
  const x = encoding?.x;
  const y = encoding?.y;
  if (!x || x.axis === null || x.axis?.labels === false) return undefined;

  const labelAngle = x.axis?.labelAngle ?? 0;
  const fontSize = x.axis?.labelFontSize ?? DEFAULT_AXIS_LABEL_FONT_SIZE;
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
    ...values.map((value) => formatTickValue(value, format ?? axis?.format).length),
  );
  if (maxLabelLength === 0) return undefined;

  const fontSize = axis?.labelFontSize ?? DEFAULT_AXIS_LABEL_FONT_SIZE;
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
