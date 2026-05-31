import type {
  AxisData,
  ChartGroupMeta,
  ChartStyleContextData,
  ChartSeriesData,
  SingleAxisData,
} from './compute-types.gen';

export type ImportNormalizableChart = {
  chartType?: string;
  subType?: string;
  axis?: AxisData;
  axes?: AxisData;
  chartStyleContext?: ChartStyleContextData;
  ooxml?: unknown;
  rt?: {
    chartGroupsMeta?: ChartGroupMeta[];
  };
  series?: ChartSeriesData[];
};

type ChartColorMapOverrideConfig = NonNullable<ChartStyleContextData['colorMapOverride']>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function colorMappingValue(mapping: Record<string, unknown>, field: string): string | undefined {
  const snakeField = field === 'folHlink' ? 'fol_hlink' : field;
  const value = mapping[field] ?? mapping[snakeField];
  return typeof value === 'string' ? value : undefined;
}

function chartColorMapOverrideFromSerialized(
  value: unknown,
): ChartColorMapOverrideConfig | undefined {
  if (
    value === 'MasterClrMapping' ||
    value === 'masterClrMapping' ||
    value === 'master' ||
    value === 'Master'
  ) {
    return { type: 'master' };
  }

  const record = asRecord(value);
  if (!record) return undefined;

  const kind = record.kind ?? record.type;
  if (kind === 'master' || kind === 'Master') return { type: 'master' };
  if ('MasterClrMapping' in record || 'masterClrMapping' in record) return { type: 'master' };

  const rawMapping =
    asRecord(record.OverrideClrMapping) ??
    asRecord(record.overrideClrMapping) ??
    asRecord(record.Override) ??
    asRecord(record.override) ??
    asRecord(record.mapping) ??
    record;

  const mappingFields = [
    'bg1',
    'tx1',
    'bg2',
    'tx2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'hlink',
    'folHlink',
  ] as const;
  const mapping: Record<string, string> = {};
  for (const field of mappingFields) {
    const mappedValue = colorMappingValue(rawMapping, field);
    if (mappedValue) mapping[field] = mappedValue;
  }

  return Object.keys(mapping).length > 0 ? { type: 'override', mapping } : undefined;
}

function chartStyleContextFromOoxml(ooxml: unknown): ChartStyleContextData | undefined {
  const ooxmlRecord = asRecord(ooxml);
  const definition = asRecord(ooxmlRecord?.definition);
  const colorMapOverride = chartColorMapOverrideFromSerialized(
    definition?.clr_map_ovr ?? definition?.clrMapOvr,
  );
  return colorMapOverride ? { colorMapOverride } : undefined;
}

function normalizeImportedChartStyleContext<T extends ImportNormalizableChart>(chart: T): T {
  if (chart.chartStyleContext) return chart;
  const chartStyleContext = chartStyleContextFromOoxml(chart.ooxml);
  return chartStyleContext ? { ...chart, chartStyleContext } : chart;
}

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

function isVolumeSeriesType(chartType: string | undefined): boolean {
  return (
    chartType === 'bar' ||
    chartType === 'column' ||
    chartType === 'bar3D' ||
    chartType === 'bar3d' ||
    chartType === 'column3D' ||
    chartType === 'column3d'
  );
}

function importedStockVolumeSubType(
  chart: ImportNormalizableChart,
  groups: readonly ChartGroupMeta[],
  series: readonly ChartSeriesData[] | undefined,
): 'volume-hlc' | 'volume-ohlc' | null {
  if (!series?.length) return null;
  if (chart.chartType !== 'combo' && groups.length <= 1) return null;

  const stockIndices: number[] = [];
  const volumeIndices: number[] = [];

  series.forEach((entry, index) => {
    if (entry.type === 'stock') stockIndices.push(index);
    if (isVolumeSeriesType(entry.type)) volumeIndices.push(index);
  });

  if (volumeIndices.length !== 1) return null;
  if (stockIndices.length !== 3 && stockIndices.length !== 4) return null;
  if (stockIndices.length + volumeIndices.length !== series.length) return null;

  return stockIndices.length === 4 ? 'volume-ohlc' : 'volume-hlc';
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
  if (isStandardXYChartGroup(chart)) return undefined;

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

function isStandardXYChartGroup(chart: ImportNormalizableChart): boolean {
  const groups = chart.rt?.chartGroupsMeta ?? [];
  const chartType = chart.chartType?.toLowerCase() ?? groups[0]?.chartType?.toLowerCase();
  if (chartType !== 'scatter' && chartType !== 'bubble') return false;
  return groups.length <= 1;
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
  const chartWithStyleContext = normalizeImportedChartStyleContext(chart);
  const groups = chart.rt?.chartGroupsMeta ?? [];
  const assignments =
    groups.length > 1 && chartWithStyleContext.series
      ? seriesTypeAssignments(groups, chartWithStyleContext.series)
      : null;
  const typedSeries = assignments
    ? chartWithStyleContext.series?.map((entry, index) => {
        if (entry.type) return entry;
        const chartType = assignments.get(index);
        return chartType ? { ...entry, type: chartType } : entry;
      })
    : chartWithStyleContext.series;
  const series = normalizeSeriesAxisBindings(chartWithStyleContext, typedSeries);
  const chartWithNormalizedSeries =
    series === chartWithStyleContext.series
      ? chartWithStyleContext
      : { ...chartWithStyleContext, series };
  const stockVolumeSubType = importedStockVolumeSubType(chartWithNormalizedSeries, groups, series);
  const chartType =
    (stockVolumeSubType ? 'stock' : null) ??
    (groups.length > 1 ? chartTypeForImportedGroups(groups) : null) ??
    chartTypeForUniformSeries(chartWithNormalizedSeries) ??
    chartWithStyleContext.chartType;
  const subType = stockVolumeSubType ?? chartWithStyleContext.subType;

  if (
    chartType === chartWithStyleContext.chartType &&
    series === chartWithStyleContext.series &&
    subType === chartWithStyleContext.subType
  ) {
    return chartWithStyleContext;
  }

  return {
    ...chartWithStyleContext,
    ...(chartType ? { chartType } : {}),
    ...(subType ? { subType } : {}),
    ...(series ? { series } : {}),
  };
}
