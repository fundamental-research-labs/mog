import type { ChartGroupMeta, ChartSeriesData } from './compute-types.gen';

export type ImportNormalizableChart = {
  chartType?: string;
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

export function normalizeImportedComboChart<T extends ImportNormalizableChart>(chart: T): T {
  const groups = chart.rt?.chartGroupsMeta ?? [];
  const assignments =
    groups.length > 1 && chart.series ? seriesTypeAssignments(groups, chart.series) : null;
  const series = assignments
    ? chart.series?.map((entry, index) => {
        if (entry.type) return entry;
        const chartType = assignments.get(index);
        return chartType ? { ...entry, type: chartType } : entry;
      })
    : chart.series;
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
