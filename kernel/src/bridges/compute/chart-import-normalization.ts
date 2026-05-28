import type { ChartGroupMeta, ChartSeriesData } from './compute-types.gen';

export type ImportNormalizableChart = {
  chartType?: string;
  rt?: {
    chartGroupsMeta?: ChartGroupMeta[];
  };
  series?: ChartSeriesData[];
};

function hasImportedComboGroups(chart: ImportNormalizableChart): boolean {
  return (chart.rt?.chartGroupsMeta?.length ?? 0) > 1;
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

export function normalizeImportedComboChart<T extends ImportNormalizableChart>(chart: T): T {
  if (!hasImportedComboGroups(chart)) return chart;

  const groups = chart.rt?.chartGroupsMeta ?? [];
  const assignments = chart.series ? seriesTypeAssignments(groups, chart.series) : null;
  return {
    ...chart,
    chartType: 'combo',
    series: chart.series?.map((entry, index) => {
      if (entry.type) return entry;
      const chartType = assignments?.get(index);
      return chartType ? { ...entry, type: chartType } : entry;
    }),
  };
}
