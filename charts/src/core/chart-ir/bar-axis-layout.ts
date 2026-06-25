import type {
  BarGeometryGrouping,
  BarGeometryOrientation,
  BarGeometryStatus,
  BarValueAxisScaleSource,
} from '../../grammar/spec';
import type { ChartData, SingleAxisConfig } from '../../types';
import { resolveExcelAutoValueAxisScale } from './excel-value-axis-scale';

export type BarAxisTickSkipSource = 'explicit' | 'importedAuto' | 'rendererAuto' | 'none';
export type BarPercentAxisLabelPolicy = 'percentFromHundred';
export type BarAxisLayoutStatus = BarGeometryStatus;

export interface BarColumnAxisLayout {
  categoryTickLabelSkip?: number;
  categoryTickMarkSkip?: number;
  categoryTickSkipSource?: BarAxisTickSkipSource;
  categoryTickStatus?: BarAxisLayoutStatus;
  categoryTickStatusReason?: string;
  valueAxisDomain?: [number, number];
  valueAxisTickStep?: number;
  valueAxisTickCount?: number;
  percentDomain?: [number, number];
  percentAxisLabelPolicy?: BarPercentAxisLabelPolicy;
  valueAxisScaleSource?: BarValueAxisScaleSource;
  valueAxisScaleStatus?: BarAxisLayoutStatus;
  valueAxisScaleStatusReason?: string;
  axisLayoutStatus?: BarAxisLayoutStatus;
  axisLayoutStatusReason?: string;
}

export interface ResolveBarColumnAxisLayoutInput {
  sourceDialect?: 'ooxml' | 'ooxml-chart-ex';
  orientation: BarGeometryOrientation;
  grouping: BarGeometryGrouping;
  data?: Pick<ChartData, 'categories' | 'series'>;
  seriesIndices?: readonly number[];
  categoryAxis?: SingleAxisConfig;
  valueAxis?: SingleAxisConfig;
  chartWidth?: number;
  chartHeight?: number;
}

const DEFAULT_AXIS_LABEL_FONT_SIZE = 11;
const CATEGORY_TEXT_WIDTH_RATIO = 0.52;
const DEFAULT_CATEGORY_AXIS_WIDTH_PX = 480;
const DEFAULT_CATEGORY_AXIS_HEIGHT_PX = 320;
const APPROXIMATE_PLOT_AREA_RATIO = 0.72;

export function resolveBarColumnAxisLayout(
  input: ResolveBarColumnAxisLayoutInput,
): BarColumnAxisLayout {
  const skip = resolveCategoryTickSkip(input);
  const value = resolveValueAxisLayout(input);
  const categoryStatus = resolveCategoryTickStatus(input.sourceDialect, skip.source);
  const valueStatus = {
    status: value.status,
    ...(value.reason ? { reason: value.reason } : {}),
  };
  const status = aggregateAxisLayoutStatus(categoryStatus, valueStatus);

  return {
    ...(skip.labelSkip !== undefined ? { categoryTickLabelSkip: skip.labelSkip } : {}),
    ...(skip.markSkip !== undefined ? { categoryTickMarkSkip: skip.markSkip } : {}),
    ...(skip.source !== 'none' ? { categoryTickSkipSource: skip.source } : {}),
    categoryTickStatus: categoryStatus.status,
    ...(categoryStatus.reason ? { categoryTickStatusReason: categoryStatus.reason } : {}),
    ...(value.domain ? { valueAxisDomain: value.domain } : {}),
    ...(value.tickStep !== undefined ? { valueAxisTickStep: value.tickStep } : {}),
    ...(value.tickCount !== undefined ? { valueAxisTickCount: value.tickCount } : {}),
    ...(value.percentDomain ? { percentDomain: value.percentDomain } : {}),
    ...(value.percentAxisLabelPolicy
      ? { percentAxisLabelPolicy: value.percentAxisLabelPolicy }
      : {}),
    valueAxisScaleSource: value.source,
    valueAxisScaleStatus: value.status,
    ...(value.reason ? { valueAxisScaleStatusReason: value.reason } : {}),
    axisLayoutStatus: status.status,
    ...(status.reason ? { axisLayoutStatusReason: status.reason } : {}),
  };
}

export function percentStackedDomainForData(
  data: Pick<ChartData, 'categories' | 'series'> | undefined,
  seriesIndices: readonly number[] | undefined,
): [number, number] | undefined {
  if (!data) return undefined;
  let hasPositive = false;
  let hasNegative = false;
  const members = memberIndexSet(seriesIndices);
  for (let pointIndex = 0; pointIndex < data.categories.length; pointIndex += 1) {
    data.series.forEach((series, seriesIndex) => {
      if (members && !members.has(seriesIndex)) return;
      const value = series.data[pointIndex]?.y;
      if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return;
      if (value > 0) hasPositive = true;
      else hasNegative = true;
    });
  }

  const min = hasNegative ? -100 : 0;
  const max = hasPositive ? 100 : 0;
  return min === max ? [min, min + 100] : [min, max];
}

export function stackedValuesForData(
  data: Pick<ChartData, 'categories' | 'series'>,
  seriesIndices: readonly number[] | undefined,
): number[] {
  const values: number[] = [];
  const members = memberIndexSet(seriesIndices);
  for (let pointIndex = 0; pointIndex < data.categories.length; pointIndex += 1) {
    let positive = 0;
    let negative = 0;
    data.series.forEach((series, seriesIndex) => {
      if (members && !members.has(seriesIndex)) return;
      const value = series.data[pointIndex]?.y;
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      if (value >= 0) positive += value;
      else negative += value;
    });
    values.push(positive, negative);
  }
  return values;
}

export function memberValuesForData(
  data: Pick<ChartData, 'series'>,
  seriesIndices: readonly number[] | undefined,
): number[] {
  const values: number[] = [];
  const members = memberIndexSet(seriesIndices);
  data.series.forEach((series, seriesIndex) => {
    if (members && !members.has(seriesIndex)) return;
    for (const point of series.data) {
      if (typeof point?.y === 'number' && Number.isFinite(point.y)) values.push(point.y);
    }
  });
  return values;
}

function resolveCategoryTickSkip(input: ResolveBarColumnAxisLayoutInput): {
  labelSkip?: number;
  markSkip?: number;
  source: BarAxisTickSkipSource;
} {
  const explicitLabelSkip = positiveInteger(input.categoryAxis?.tickLabelSpacing);
  const explicitMarkSkip = positiveInteger(input.categoryAxis?.tickMarkSpacing);
  if (explicitLabelSkip !== undefined || explicitMarkSkip !== undefined) {
    return {
      labelSkip: explicitLabelSkip,
      markSkip: explicitMarkSkip,
      source: 'explicit',
    };
  }

  if (input.sourceDialect !== 'ooxml') return { source: 'none' };
  if (input.categoryAxis?.visible === false || input.categoryAxis?.show === false) {
    return { source: 'none' };
  }

  const autoSkip = importedAutoCategoryTickSkip(input);
  return autoSkip > 1
    ? { labelSkip: autoSkip, markSkip: autoSkip, source: 'importedAuto' }
    : { labelSkip: 1, markSkip: 1, source: 'importedAuto' };
}

function importedAutoCategoryTickSkip(input: ResolveBarColumnAxisLayoutInput): number {
  const categories = input.data?.categories ?? [];
  const categoryCount = categories.length;
  if (categoryCount <= 1) return 1;

  const maxLabelLength = Math.max(
    1,
    ...categories.map((category) => String(category ?? '').length),
  );
  if (input.orientation === 'horizontal') {
    const axisLength = approximateCategoryAxisLength(input);
    const slot = axisLength / categoryCount;
    const sizeDrivenSkip =
      slot > 0 ? Math.ceil(DEFAULT_AXIS_LABEL_FONT_SIZE / slot) : categoryCount;
    const densityDrivenSkip =
      categoryCount >= 24 || (maxLabelLength >= 24 && categoryCount >= 16) ? 2 : 1;
    return clamp(
      Math.max(sizeDrivenSkip, densityDrivenSkip),
      1,
      Math.max(1, Math.ceil(categoryCount / 2)),
    );
  }

  const angle = normalizedAxisLabelAngle(input.categoryAxis);
  const axisLength = approximateCategoryAxisLength(input);
  const slot = axisLength / categoryCount;
  if (slot <= 0) return 1;

  const rawWidth = maxLabelLength * DEFAULT_AXIS_LABEL_FONT_SIZE * CATEGORY_TEXT_WIDTH_RATIO;
  const radians = (Math.abs(angle) * Math.PI) / 180;
  const projectedWidth =
    Math.cos(radians) * rawWidth + Math.sin(radians) * DEFAULT_AXIS_LABEL_FONT_SIZE;
  if (projectedWidth <= slot) return 1;

  return clamp(Math.ceil(projectedWidth / slot), 1, Math.max(1, Math.ceil(categoryCount / 2)));
}

function resolveValueAxisLayout(input: ResolveBarColumnAxisLayoutInput): {
  domain?: [number, number];
  tickStep?: number;
  tickCount?: number;
  percentDomain?: [number, number];
  percentAxisLabelPolicy?: BarPercentAxisLabelPolicy;
  source: BarValueAxisScaleSource;
  status: BarAxisLayoutStatus;
  reason?: string;
} {
  const explicitMin = finiteNumber(input.valueAxis?.min);
  const explicitMax = finiteNumber(input.valueAxis?.max);
  const explicitTickStep = positiveNumber(input.valueAxis?.majorUnit);
  const hasExplicitScale =
    explicitMin !== undefined || explicitMax !== undefined || explicitTickStep !== undefined;
  const hasCompleteExplicitScale =
    explicitMin !== undefined && explicitMax !== undefined && explicitTickStep !== undefined;

  if (input.sourceDialect === 'ooxml-chart-ex') {
    return {
      source: hasCompleteExplicitScale ? 'explicit' : 'heuristic',
      status: 'approximate',
      reason: 'chartExBarColumnAxisLayoutApproximation',
    };
  }

  if (input.grouping === 'percentStacked') {
    const percentDomain = percentStackedDomainForData(input.data, input.seriesIndices) ?? [0, 100];
    const domain: [number, number] = [
      explicitMin ?? percentDomain[0],
      explicitMax ?? percentDomain[1],
    ];
    const tickStep = explicitTickStep ?? percentAxisTickStep(domain);
    const exactness = percentStackedValueScaleStatus(
      input.sourceDialect,
      hasExplicitScale,
      hasCompleteExplicitScale,
    );
    return {
      domain,
      tickStep,
      tickCount: tickCountForStep(domain, tickStep),
      percentDomain: domain,
      percentAxisLabelPolicy: 'percentFromHundred',
      ...exactness,
    };
  }

  if (!input.data) {
    return missingValueScaleStatus(input.sourceDialect);
  }
  const values =
    input.grouping === 'stacked'
      ? stackedValuesForData(input.data, input.seriesIndices)
      : memberValuesForData(input.data, input.seriesIndices);
  if (values.length === 0) {
    return missingValueScaleStatus(input.sourceDialect);
  }

  if (isLogarithmicAxis(input.valueAxis)) {
    return explicitMin !== undefined && explicitMax !== undefined
      ? {
          domain: [explicitMin, explicitMax],
          source: 'explicit',
          status: explicitTickStep !== undefined ? 'exact' : 'approximate',
          ...(explicitTickStep !== undefined
            ? { tickStep: explicitTickStep }
            : { reason: 'logarithmicValueAxisTickStepMissing' }),
        }
      : {
          source: hasExplicitScale ? 'explicit' : 'missing',
          status: 'approximate',
          reason: 'logarithmicValueAxisScaleUnsupported',
        };
  }

  if (input.sourceDialect === 'ooxml') {
    const resolved = resolveExcelAutoValueAxisScale({
      values,
      includeZero: true,
      explicitMin,
      explicitMax,
      explicitTickStep,
    });
    return resolved
      ? {
          domain: resolved.domain,
          tickStep: resolved.tickStep,
          tickCount: resolved.tickCount,
          source: hasCompleteExplicitScale ? 'explicit' : 'excelAutoModel',
          status: hasExplicitScale && !hasCompleteExplicitScale ? 'approximate' : 'exact',
          ...(hasExplicitScale && !hasCompleteExplicitScale
            ? { reason: 'importedAutoValueAxisScalePartialExplicitAxis' }
            : {}),
        }
      : missingValueScaleStatus(input.sourceDialect);
  }

  return {
    source: hasCompleteExplicitScale ? 'explicit' : 'excelAutoModel',
    status: hasCompleteExplicitScale ? 'exact' : 'verifiedDefault',
  };
}

function resolveCategoryTickStatus(
  sourceDialect: ResolveBarColumnAxisLayoutInput['sourceDialect'],
  skipSource: BarAxisTickSkipSource,
): { status: BarAxisLayoutStatus; reason?: string } {
  if (sourceDialect === 'ooxml-chart-ex') {
    return {
      status: 'approximate',
      reason: 'chartExBarColumnAxisLayoutApproximation',
    };
  }
  if (sourceDialect === 'ooxml') {
    if (skipSource === 'importedAuto') {
      return { status: 'exact' };
    }
    return { status: 'exact' };
  }
  return { status: 'verifiedDefault' };
}

function aggregateAxisLayoutStatus(
  categoryStatus: { status: BarAxisLayoutStatus; reason?: string },
  valueStatus: { status: BarAxisLayoutStatus; reason?: string },
): { status: BarAxisLayoutStatus; reason?: string } {
  if (categoryStatus.status === 'approximate') return categoryStatus;
  if (valueStatus.status === 'approximate') return valueStatus;
  if (categoryStatus.status === 'verifiedDefault' || valueStatus.status === 'verifiedDefault') {
    return { status: 'verifiedDefault' };
  }
  return { status: 'exact' };
}

function percentStackedValueScaleStatus(
  sourceDialect: ResolveBarColumnAxisLayoutInput['sourceDialect'],
  hasExplicitScale: boolean,
  hasCompleteExplicitScale: boolean,
): { source: BarValueAxisScaleSource; status: BarAxisLayoutStatus; reason?: string } {
  if (hasCompleteExplicitScale) {
    return { source: 'explicit', status: 'exact' };
  }
  if (!hasExplicitScale) {
    return {
      source: 'percentStackedDefault',
      status:
        sourceDialect === 'ooxml' || sourceDialect === undefined
          ? 'verifiedDefault'
          : 'approximate',
      ...(sourceDialect === 'ooxml-chart-ex'
        ? { reason: 'chartExBarColumnAxisLayoutApproximation' }
        : {}),
    };
  }
  return {
    source: 'heuristic',
    status: 'approximate',
    reason:
      sourceDialect === 'ooxml'
        ? 'importedAutoValueAxisScaleHeuristic'
        : 'percentStackedValueAxisScaleIncompleteExplicitAxis',
  };
}

function missingValueScaleStatus(sourceDialect: ResolveBarColumnAxisLayoutInput['sourceDialect']): {
  source: BarValueAxisScaleSource;
  status: BarAxisLayoutStatus;
  reason?: string;
} {
  if (sourceDialect === undefined) {
    return { source: 'missing', status: 'verifiedDefault' };
  }
  return {
    source: 'missing',
    status: 'approximate',
    reason: 'barColumnValueAxisScaleMissing',
  };
}

function approximateCategoryAxisLength(input: ResolveBarColumnAxisLayoutInput): number {
  if (input.orientation === 'vertical') {
    const chartWidth = positiveNumber(input.chartWidth);
    return chartWidth !== undefined
      ? Math.max(120, chartWidth * APPROXIMATE_PLOT_AREA_RATIO)
      : DEFAULT_CATEGORY_AXIS_WIDTH_PX;
  }
  const chartHeight = positiveNumber(input.chartHeight);
  return chartHeight !== undefined
    ? Math.max(120, chartHeight * APPROXIMATE_PLOT_AREA_RATIO)
    : DEFAULT_CATEGORY_AXIS_HEIGHT_PX;
}

function normalizedAxisLabelAngle(axis: SingleAxisConfig | undefined): number {
  const raw = axis?.textOrientation ?? axis?.format?.textRotation;
  if (raw === undefined) return 0;
  const degrees = Math.abs(raw) >= 60000 ? raw / 60000 : raw;
  return Number.isFinite(degrees) ? clamp(degrees, -90, 90) : 0;
}

function percentAxisTickStep(domain: [number, number]): number {
  const span = Math.abs(domain[1] - domain[0]);
  if (span <= 100) return 20;
  return 50;
}

function tickCountForStep(domain: [number, number], step: number): number | undefined {
  if (!Number.isFinite(step) || step <= 0) return undefined;
  const count = Math.floor(Math.abs(domain[1] - domain[0]) / step) + 1;
  return Number.isFinite(count) && count > 0 ? count : undefined;
}

function memberIndexSet(seriesIndices: readonly number[] | undefined): Set<number> | undefined {
  return seriesIndices && seriesIndices.length > 0 ? new Set(seriesIndices) : undefined;
}

function positiveInteger(value: number | undefined): number | undefined {
  const numeric = finiteNumber(value);
  if (numeric === undefined || numeric < 1) return undefined;
  return Math.floor(numeric);
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isLogarithmicAxis(axis: SingleAxisConfig | undefined): boolean {
  return axis?.scaleType === 'logarithmic' || axis?.logBase !== undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
