import type {
  AxisData,
  ChartGroupMeta,
  ChartSeriesData,
  SingleAxisData,
} from './compute-types.gen';

export type ImportNormalizableChart = {
  chartType?: string;
  axis?: AxisData;
  axes?: AxisData;
  rt?: {
    chartGroupsMeta?: ChartGroupMeta[];
  };
  series?: ChartSeriesData[];
};

function chartTypeForImportedGroups(groups: readonly ChartGroupMeta[]): string | null {
  if (groups.length === 0) return null;
  const chartTypes = groups.map((group) => group.chartType).filter(Boolean);
  if (chartTypes.length === 0) return null;
  return chartTypes.every((chartType) => chartType === chartTypes[0]) ? chartTypes[0] : 'combo';
}

function seriesTypeAssignments(
  groups: ChartGroupMeta[],
  series: readonly ChartSeriesData[],
): Map<number, string> | null {
  const byIndex = new Map<number, string>();
  const positionalGroupTypes: string[] = [];

  for (const group of groups) {
    if (!group.seriesIndices?.length) {
      positionalGroupTypes.push(group.chartType);
      continue;
    }

    for (const index of group.seriesIndices) {
      if (!Number.isInteger(index) || index < 0) return null;
      if (byIndex.has(index) && byIndex.get(index) !== group.chartType) return null;
      byIndex.set(index, group.chartType);
    }
  }

  if (!positionalGroupTypes.length) return byIndex;

  const unassignedUntypedIndices = series
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => !entry.type && !byIndex.has(index))
    .map(({ index }) => index);
  if (positionalGroupTypes.length !== unassignedUntypedIndices.length) return byIndex;

  positionalGroupTypes.forEach((chartType, position) => {
    byIndex.set(unassignedUntypedIndices[position], chartType);
  });

  return byIndex;
}

function chartTypeForUniformSeries(chart: ImportNormalizableChart): string | null {
  if (chart.chartType !== 'combo' || !chart.series?.length) return null;

  const seriesTypes = chart.series.map((entry) => entry.type);
  if (seriesTypes.some((chartType) => !chartType)) return null;

  const [firstType] = seriesTypes;
  return firstType && seriesTypes.every((chartType) => chartType === firstType) ? firstType : null;
}

function axisDataFor(chart: ImportNormalizableChart): AxisData | undefined {
  return chart.axis ?? chart.axes;
}

function isVisibleAxis(axis: SingleAxisData | undefined): boolean {
  return axis !== undefined && axis.visible !== false;
}

function formatContainsPercent(format: string | undefined): boolean {
  return typeof format === 'string' && format.includes('%');
}

function seriesHasPercentValueFormat(series: ChartSeriesData): boolean {
  const cache = series.valueCache;
  if (formatContainsPercent(cache?.formatCode)) return true;
  return cache?.points?.some((point) => formatContainsPercent(point.formatCode)) ?? false;
}

function finiteAxisDomain(axis: SingleAxisData | undefined): [number, number] | null {
  if (
    typeof axis?.min !== 'number' ||
    typeof axis.max !== 'number' ||
    !Number.isFinite(axis.min) ||
    !Number.isFinite(axis.max)
  ) {
    return null;
  }
  return axis.min <= axis.max ? [axis.min, axis.max] : [axis.max, axis.min];
}

function numericCachedValues(series: ChartSeriesData): number[] {
  const values: number[] = [];
  for (const point of series.valueCache?.points ?? []) {
    const value = Number(point.value);
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function domainTolerance(min: number, max: number): number {
  return Math.max(1e-9, Math.abs(max - min) * 1e-12);
}

function valuesFitDomain(values: readonly number[], domain: [number, number]): boolean {
  const [min, max] = domain;
  const tolerance = domainTolerance(min, max);
  return (
    values.length > 0 &&
    values.every((value) => value >= min - tolerance && value <= max + tolerance)
  );
}

function valuesConflictDomain(values: readonly number[], domain: [number, number]): boolean {
  const [min, max] = domain;
  const tolerance = domainTolerance(min, max);
  return values.some((value) => value < min - tolerance || value > max + tolerance);
}

function inferredYAxisIndex(
  chart: ImportNormalizableChart,
  series: ChartSeriesData,
): number | undefined {
  if (series.yAxisIndex === 0 || series.yAxisIndex === 1) return undefined;

  const axis = axisDataFor(chart);
  const secondaryAxis = axis?.secondaryValueAxis;
  if (!isVisibleAxis(secondaryAxis)) return undefined;

  const primaryAxis = axis?.valueAxis;
  if (
    formatContainsPercent(secondaryAxis?.numberFormat) &&
    !formatContainsPercent(primaryAxis?.numberFormat) &&
    seriesHasPercentValueFormat(series)
  ) {
    return 1;
  }

  const secondaryDomain = finiteAxisDomain(secondaryAxis);
  if (!secondaryDomain) return undefined;

  const values = numericCachedValues(series);
  if (!valuesFitDomain(values, secondaryDomain)) return undefined;

  const primaryDomain = finiteAxisDomain(primaryAxis);
  if (!primaryDomain || valuesConflictDomain(values, primaryDomain)) return 1;

  return undefined;
}

function normalizeSeriesAxisBindings<T extends ImportNormalizableChart>(
  chart: T,
  series: ChartSeriesData[] | undefined,
): ChartSeriesData[] | undefined {
  if (!series) return series;

  let changed = false;
  const normalized = series.map((entry) => {
    const yAxisIndex = inferredYAxisIndex(chart, entry);
    if (yAxisIndex === undefined) return entry;
    changed = true;
    return { ...entry, yAxisIndex };
  });

  return changed ? normalized : series;
}

export function normalizeImportedComboChart<T extends ImportNormalizableChart>(chart: T): T {
  const groups = chart.rt?.chartGroupsMeta ?? [];
  const assignments =
    groups.length > 1 && chart.series ? seriesTypeAssignments(groups, chart.series) : null;
  const typedSeries = assignments
    ? chart.series?.map((entry, index) => {
        if (entry.type) return entry;
        const chartType = assignments.get(index);
        return chartType ? { ...entry, type: chartType } : entry;
      })
    : chart.series;
  const series = normalizeSeriesAxisBindings(chart, typedSeries);
  const chartWithNormalizedSeries = series === chart.series ? chart : { ...chart, series };
  const chartType =
    (groups.length > 1 ? chartTypeForImportedGroups(groups) : null) ??
    chartTypeForUniformSeries(chartWithNormalizedSeries) ??
    chart.chartType;

  if (chartType === chart.chartType && series === chart.series) return chart;

  return {
    ...chart,
    ...(chartType ? { chartType } : {}),
    ...(series ? { series } : {}),
  };
}
