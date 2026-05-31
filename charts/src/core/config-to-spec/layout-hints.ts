import type {
  AxisSpec,
  ChannelSpec,
  ConfigSpec,
  EncodingSpec,
  ManualLayoutSpec,
  ScaleSpec,
} from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { formatExcelSerialDateTick, formatTickValue } from '../../grammar/axis-generator';
import { generateTicks, niceLinear } from '../../primitives/scales/linear';
import {
  buildAxisScaleSpec,
  explicitDomainBound,
  mapAxisConfigToAxisSpec,
} from './axis';
import { hasSecondaryYAxis } from './secondary-axis';

type LayoutHints = NonNullable<ConfigSpec['layoutHints']>;

export function buildLayoutHints(
  config: ChartConfig,
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): LayoutHints | undefined {
  const leftYAxisLabelWidth =
    estimateNominalYAxisLabelWidth(encoding, data) ?? estimateYAxisLabelWidth(encoding);
  const rightYAxisLabelWidth = estimateSecondaryYAxisLabelWidth(config, data);
  const bottomMargin = estimateXAxisBottomMargin(encoding);
  const manualPlotArea = manualLayoutFromValue(config.plotLayout ?? config.plotArea?.layout);
  const manualTitle = manualLayoutFromValue(config.titleLayout ?? config.chartTitle?.layout);
  const manualLegend = manualLayoutFromValue(config.legend?.layout);

  if (
    leftYAxisLabelWidth === undefined &&
    rightYAxisLabelWidth === undefined &&
    bottomMargin === undefined &&
    manualPlotArea === undefined &&
    manualTitle === undefined &&
    manualLegend === undefined
  ) {
    return undefined;
  }

  return {
    ...(leftYAxisLabelWidth !== undefined
      ? { leftYAxisLabelWidth, yAxisLabelWidth: leftYAxisLabelWidth }
      : {}),
    ...(rightYAxisLabelWidth !== undefined ? { rightYAxisLabelWidth } : {}),
    ...(bottomMargin !== undefined ? { bottomMargin } : {}),
    ...(manualPlotArea !== undefined ? { manualPlotArea } : {}),
    ...(manualTitle !== undefined ? { manualTitle } : {}),
    ...(manualLegend !== undefined ? { manualLegend } : {}),
  };
}

function manualLayoutFromValue(layout: unknown): ManualLayoutSpec | undefined {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return undefined;
  const source = layout as Record<string, unknown>;
  const result: ManualLayoutSpec = {};
  let hasManualLayoutField = false;

  const layoutTarget = manualLayoutTarget(source.layoutTarget);
  if (layoutTarget) {
    result.layoutTarget = layoutTarget;
    hasManualLayoutField = true;
  }

  const xMode = manualLayoutMode(source.xMode);
  if (xMode) {
    result.xMode = xMode;
    hasManualLayoutField = true;
  }
  const yMode = manualLayoutMode(source.yMode);
  if (yMode) {
    result.yMode = yMode;
    hasManualLayoutField = true;
  }
  const wMode = manualLayoutMode(source.wMode);
  if (wMode) {
    result.wMode = wMode;
    hasManualLayoutField = true;
  }
  const hMode = manualLayoutMode(source.hMode);
  if (hMode) {
    result.hMode = hMode;
    hasManualLayoutField = true;
  }

  const x = finiteNumber(source.x);
  if (x !== undefined) {
    result.x = x;
    hasManualLayoutField = true;
  }
  const y = finiteNumber(source.y);
  if (y !== undefined) {
    result.y = y;
    hasManualLayoutField = true;
  }
  const w = finiteNumber(source.w);
  if (w !== undefined) {
    result.w = w;
    hasManualLayoutField = true;
  }
  const h = finiteNumber(source.h);
  if (h !== undefined) {
    result.h = h;
    hasManualLayoutField = true;
  }

  return hasManualLayoutField ? result : undefined;
}

function manualLayoutTarget(value: unknown): ManualLayoutSpec['layoutTarget'] | undefined {
  return value === 'inner' || value === 'outer' ? value : undefined;
}

function manualLayoutMode(value: unknown): ManualLayoutSpec['xMode'] | undefined {
  return value === 'edge' || value === 'factor' ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function estimateNominalYAxisLabelWidth(
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): number | undefined {
  const y = encoding?.y;
  if (!y || y.type === 'quantitative' || y.axis === null || y.axis?.labels === false) {
    return undefined;
  }

  const labels = data?.categories ?? [];
  if (labels.length === 0) return undefined;

  const maxLabelLength = Math.max(0, ...labels.map((label) => String(label ?? '').length));
  if (maxLabelLength === 0) return undefined;

  const fontSize = y.axis?.labelFontSize ?? 11;
  const estimatedWidth = Math.ceil(maxLabelLength * fontSize * 0.52);
  return Math.max(60, Math.min(660, estimatedWidth));
}

function estimateYAxisLabelWidth(encoding: EncodingSpec | undefined): number | undefined {
  const y = encoding?.y;
  if (!y || y.type !== 'quantitative' || y.axis === null || y.axis?.labels === false) {
    return undefined;
  }

  return estimateQuantitativeAxisLabelWidth(y.axis, y.scale, y.format);
}

function estimateSecondaryYAxisLabelWidth(
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

  const fontSize = axis?.labelFontSize ?? 11;
  const maxMagnitude = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
  const charWidthRatio = maxMagnitude >= 1_000_000 ? 0.6 : 0.52;
  const estimatedWidth = Math.ceil(maxLabelLength * fontSize * charWidthRatio);
  return Math.max(36, Math.min(320, estimatedWidth));
}

function estimateXAxisBottomMargin(encoding: EncodingSpec | undefined): number | undefined {
  const x = encoding?.x;
  const y = encoding?.y;
  if (!x || x.axis === null || x.axis?.labels === false) return undefined;

  const labelAngle = x.axis?.labelAngle ?? 0;
  const fontSize = x.axis?.labelFontSize ?? 11;
  const labelPadding = x.axis?.labelPadding ?? (labelAngle ? 2 : 3);
  const tickExtent = x.axis?.ticks === false ? 0 : (x.axis?.tickSize ?? 6);

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
