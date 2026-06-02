import type { AxisLayoutStatus, AxisTickSkipSource, StackMode } from '../../grammar/spec';
import type { ChartData, SingleAxisConfig } from '../../types';
import {
  memberValuesForData,
  percentStackedDomainForData,
  stackedValuesForData,
} from './bar-axis-layout';
import { resolveExcelAutoValueAxisScale } from './excel-value-axis-scale';

export type PathAxisTickSkipSource = AxisTickSkipSource;
export type PathPercentAxisLabelPolicy = 'percentFromHundred';
export type PathAxisLayoutStatus = AxisLayoutStatus;
type PathAxisStatusResolution = { status: PathAxisLayoutStatus; reason?: string };

export interface PathChartAxisLayout {
  categoryTickLabelSkip?: number;
  categoryTickMarkSkip?: number;
  categoryTickSkipSource?: PathAxisTickSkipSource;
  axisLength?: number;
  categoryPitch?: number;
  labelBudget?: number;
  projectedLabelWidth?: number;
  visibleLabelCount?: number;
  valueAxisDomain?: [number, number];
  valueAxisTickStep?: number;
  valueAxisTickCount?: number;
  percentDomain?: [number, number];
  percentAxisLabelPolicy?: PathPercentAxisLabelPolicy;
  categoryAxisLayoutStatus?: PathAxisLayoutStatus;
  categoryAxisLayoutStatusReason?: string;
  valueAxisLayoutStatus?: PathAxisLayoutStatus;
  valueAxisLayoutStatusReason?: string;
  axisLayoutStatus?: PathAxisLayoutStatus;
  axisLayoutStatusReason?: string;
  reservationStatus?: PathAxisLayoutStatus;
  reservationStatusReason?: string;
}

interface PathValueAxisLayoutResolution {
  domain?: [number, number];
  tickStep?: number;
  tickCount?: number;
  percentDomain?: [number, number];
  percentAxisLabelPolicy?: PathPercentAxisLabelPolicy;
  status: PathAxisStatusResolution;
}

export interface ResolvePathChartAxisLayoutInput {
  sourceDialect?: 'ooxml' | 'ooxml-chart-ex';
  stackMode?: StackMode;
  data?: Pick<ChartData, 'categories' | 'series'>;
  seriesIndices?: readonly number[];
  categoryAxis?: SingleAxisConfig;
  valueAxis?: SingleAxisConfig;
  chartWidth?: number;
  chartHeight?: number;
  categoryLabels?: readonly string[];
  useDateSerialCategoryAxis?: boolean;
  includeZero?: boolean;
  unitPercentValueAxis?: boolean;
}

const DEFAULT_AXIS_LABEL_FONT_SIZE = 18;
const CATEGORY_TEXT_WIDTH_RATIO = 0.52;
const DEFAULT_LABEL_GAP_PX = 8;
const IMPORTED_AUTO_MAX_CHART_WIDTH_PX = 1600;
const IMPORTED_AUTO_MIN_AXIS_LENGTH_PX = 160;
const IMPORTED_AUTO_PLOT_WIDTH_RATIO = 0.78;
const DEFAULT_CATEGORY_AXIS_WIDTH_PX = 480;

export function resolvePathChartAxisLayout(
  input: ResolvePathChartAxisLayoutInput,
): PathChartAxisLayout {
  const skip = resolveCategoryTickSkip(input);
  const value = resolveValueAxisLayout(input);
  const categoryStatus = resolveCategoryAxisLayoutStatus(input.sourceDialect, skip.source);

  return {
    ...(skip.labelSkip !== undefined ? { categoryTickLabelSkip: skip.labelSkip } : {}),
    ...(skip.markSkip !== undefined ? { categoryTickMarkSkip: skip.markSkip } : {}),
    ...(skip.source !== 'none' ? { categoryTickSkipSource: skip.source } : {}),
    ...(skip.axisLength !== undefined ? { axisLength: skip.axisLength } : {}),
    ...(skip.categoryPitch !== undefined ? { categoryPitch: skip.categoryPitch } : {}),
    ...(skip.labelBudget !== undefined ? { labelBudget: skip.labelBudget } : {}),
    ...(skip.projectedLabelWidth !== undefined
      ? { projectedLabelWidth: skip.projectedLabelWidth }
      : {}),
    ...(skip.visibleLabelCount !== undefined ? { visibleLabelCount: skip.visibleLabelCount } : {}),
    ...(value.domain ? { valueAxisDomain: value.domain } : {}),
    ...(value.tickStep !== undefined ? { valueAxisTickStep: value.tickStep } : {}),
    ...(value.tickCount !== undefined ? { valueAxisTickCount: value.tickCount } : {}),
    ...(value.percentDomain ? { percentDomain: value.percentDomain } : {}),
    ...(value.percentAxisLabelPolicy
      ? { percentAxisLabelPolicy: value.percentAxisLabelPolicy }
      : {}),
    categoryAxisLayoutStatus: categoryStatus.status,
    ...(categoryStatus.reason ? { categoryAxisLayoutStatusReason: categoryStatus.reason } : {}),
    valueAxisLayoutStatus: value.status.status,
    ...(value.status.reason ? { valueAxisLayoutStatusReason: value.status.reason } : {}),
    axisLayoutStatus: categoryStatus.status,
    ...(categoryStatus.reason ? { axisLayoutStatusReason: categoryStatus.reason } : {}),
    ...(skip.source === 'importedAuto'
      ? {
          reservationStatus: 'approximate' as const,
          reservationStatusReason: 'importedAutoPathPlotFrameReservationEstimate',
        }
      : {}),
  };
}

function resolveCategoryTickSkip(input: ResolvePathChartAxisLayoutInput): {
  labelSkip?: number;
  markSkip?: number;
  source: PathAxisTickSkipSource;
  axisLength?: number;
  categoryPitch?: number;
  labelBudget?: number;
  projectedLabelWidth?: number;
  visibleLabelCount?: number;
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
  if (input.useDateSerialCategoryAxis) return { source: 'none' };
  if (input.categoryAxis?.visible === false || input.categoryAxis?.show === false) {
    return { source: 'none' };
  }

  const auto = importedAutoPathCategoryTickSkip(input);
  return {
    labelSkip: auto.labelSkip,
    markSkip: auto.labelSkip,
    source: 'importedAuto',
    axisLength: auto.axisLength,
    categoryPitch: auto.categoryPitch,
    labelBudget: auto.labelBudget,
    projectedLabelWidth: auto.projectedLabelWidth,
    visibleLabelCount: auto.visibleLabelCount,
  };
}

function importedAutoPathCategoryTickSkip(input: ResolvePathChartAxisLayoutInput): {
  labelSkip: number;
  axisLength?: number;
  categoryPitch?: number;
  labelBudget?: number;
  projectedLabelWidth?: number;
  visibleLabelCount?: number;
} {
  const labels = pathCategoryLabels(input);
  const categoryCount = labels.length;
  if (categoryCount <= 1) {
    return {
      labelSkip: 1,
      visibleLabelCount: categoryCount,
    };
  }

  const axisLength = approximateCategoryAxisLength(input);
  const categoryPitch = axisLength / categoryCount;
  if (categoryPitch <= 0) {
    return {
      labelSkip: 1,
      axisLength,
      categoryPitch,
      visibleLabelCount: categoryCount,
    };
  }

  const maxLabelLength = Math.max(1, ...labels.map((label) => label.length));
  const rawWidth = maxLabelLength * DEFAULT_AXIS_LABEL_FONT_SIZE * CATEGORY_TEXT_WIDTH_RATIO;
  const angle = normalizedAxisLabelAngle(input.categoryAxis);
  const radians = (Math.abs(angle) * Math.PI) / 180;
  const projectedWidth =
    Math.cos(radians) * rawWidth + Math.sin(radians) * DEFAULT_AXIS_LABEL_FONT_SIZE;
  const labelBudget = projectedWidth + DEFAULT_LABEL_GAP_PX;
  const labelSkip =
    projectedWidth <= categoryPitch
      ? 1
      : clamp(Math.ceil(labelBudget / categoryPitch), 1, Math.max(1, Math.ceil(categoryCount / 2)));

  return {
    labelSkip,
    axisLength,
    categoryPitch,
    labelBudget,
    projectedLabelWidth: projectedWidth,
    visibleLabelCount: Math.ceil(categoryCount / labelSkip),
  };
}

function resolveValueAxisLayout(
  input: ResolvePathChartAxisLayoutInput,
): PathValueAxisLayoutResolution {
  if (input.unitPercentValueAxis && !hasExplicitDomainBound(input.valueAxis)) {
    const domain: [number, number] = [0, 1];
    const tickStep = positiveNumber(input.valueAxis?.majorUnit) ?? 0.2;
    return withValueAxisLayoutStatus(
      input,
      {
        domain,
        tickStep,
        tickCount: tickCountForStep(domain, tickStep),
      },
      'unitPercentPathValueAxisPolicy',
    );
  }

  if (input.stackMode === 'normalize') {
    const percentDomain = percentStackedDomainForData(input.data, input.seriesIndices) ?? [0, 100];
    const domain: [number, number] = [
      finiteNumber(input.valueAxis?.min) ?? percentDomain[0],
      finiteNumber(input.valueAxis?.max) ?? percentDomain[1],
    ];
    const tickStep = positiveNumber(input.valueAxis?.majorUnit) ?? percentAxisTickStep(domain);
    return withValueAxisLayoutStatus(
      input,
      {
        domain,
        tickStep,
        tickCount: tickCountForStep(domain, tickStep),
        percentDomain: domain,
        percentAxisLabelPolicy: 'percentFromHundred',
      },
      'percentStackedPathValueAxisPolicy',
    );
  }

  if (!input.data) return withValueAxisLayoutStatus(input, {});
  const values =
    input.stackMode === 'zero'
      ? stackedValuesForData(input.data, input.seriesIndices)
      : memberValuesForData(input.data, input.seriesIndices);
  if (values.length === 0) return withValueAxisLayoutStatus(input, {});

  if (isLogarithmicAxis(input.valueAxis)) {
    const explicitMin = finiteNumber(input.valueAxis?.min);
    const explicitMax = finiteNumber(input.valueAxis?.max);
    return withValueAxisLayoutStatus(
      input,
      explicitMin !== undefined && explicitMax !== undefined
        ? { domain: [explicitMin, explicitMax] }
        : {},
    );
  }

  if (input.sourceDialect === 'ooxml') {
    const resolved = resolveExcelAutoValueAxisScale({
      values,
      includeZero: input.includeZero ?? false,
      explicitMin: finiteNumber(input.valueAxis?.min),
      explicitMax: finiteNumber(input.valueAxis?.max),
      explicitTickStep: positiveNumber(input.valueAxis?.majorUnit),
    });
    return withValueAxisLayoutStatus(
      input,
      resolved
        ? {
            domain: resolved.domain,
            tickStep: resolved.tickStep,
            tickCount: resolved.tickCount,
          }
        : {},
    );
  }

  return withValueAxisLayoutStatus(input, {});
}

function withValueAxisLayoutStatus(
  input: ResolvePathChartAxisLayoutInput,
  layout: Omit<PathValueAxisLayoutResolution, 'status'>,
  policyReason?: string,
): PathValueAxisLayoutResolution {
  return {
    ...layout,
    status: resolveValueAxisLayoutStatus(input, policyReason),
  };
}

function resolveValueAxisLayoutStatus(
  input: ResolvePathChartAxisLayoutInput,
  policyReason?: string,
): PathAxisStatusResolution {
  if (input.sourceDialect === 'ooxml-chart-ex') {
    return {
      status: 'approximate',
      reason: 'chartExPathValueAxisLayoutApproximation',
    };
  }
  if (input.sourceDialect !== 'ooxml') return { status: 'verifiedDefault' };

  if (hasFullExplicitValueAxisLayout(input.valueAxis)) return { status: 'exact' };

  return {
    status: 'approximate',
    reason: policyReason ?? 'importedAutoPathValueAxisScaleHeuristic',
  };
}

function hasFullExplicitValueAxisLayout(axis: SingleAxisConfig | undefined): boolean {
  return (
    finiteNumber(axis?.min) !== undefined &&
    finiteNumber(axis?.max) !== undefined &&
    positiveNumber(axis?.majorUnit) !== undefined
  );
}

function hasExplicitDomainBound(axis: SingleAxisConfig | undefined): boolean {
  return finiteNumber(axis?.min) !== undefined || finiteNumber(axis?.max) !== undefined;
}

function resolveCategoryAxisLayoutStatus(
  sourceDialect: ResolvePathChartAxisLayoutInput['sourceDialect'],
  skipSource: PathAxisTickSkipSource,
): PathAxisStatusResolution {
  if (sourceDialect === 'ooxml-chart-ex') {
    return {
      status: 'approximate',
      reason: 'chartExPathAxisLayoutApproximation',
    };
  }
  if (sourceDialect === 'ooxml') {
    if (skipSource === 'importedAuto') {
      return {
        status: 'approximate',
        reason: 'importedAutoPathCategoryTickSkipHeuristic',
      };
    }
    return { status: 'exact' };
  }
  return { status: 'verifiedDefault' };
}

function approximateCategoryAxisLength(input: ResolvePathChartAxisLayoutInput): number {
  const chartWidth = positiveNumber(input.chartWidth);
  if (chartWidth === undefined) return DEFAULT_CATEGORY_AXIS_WIDTH_PX;
  const normalizedChartWidth = Math.min(chartWidth, IMPORTED_AUTO_MAX_CHART_WIDTH_PX);
  return Math.max(
    IMPORTED_AUTO_MIN_AXIS_LENGTH_PX,
    normalizedChartWidth * IMPORTED_AUTO_PLOT_WIDTH_RATIO,
  );
}

function pathCategoryLabels(input: ResolvePathChartAxisLayoutInput): string[] {
  if (input.categoryLabels && input.categoryLabels.length > 0) return [...input.categoryLabels];
  return (input.data?.categories ?? []).map((category) => String(category ?? ''));
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
