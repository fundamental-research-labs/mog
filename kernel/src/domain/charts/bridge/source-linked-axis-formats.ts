import type {
  ChartConfig,
  ChartSeriesPointCache,
  SeriesConfig,
  SingleAxisConfig,
} from '@mog-sdk/contracts/data/charts';

export type SourceLinkedAxisRole = 'category' | 'secondary category' | 'value' | 'secondary value';

export type SourceLinkedAxisNumberFormatResolution = {
  formatCode?: string;
  missingSource: boolean;
  conflictingFormats: boolean;
};

export type SourceLinkedAxisNumberFormatResolutions = Partial<
  Record<SourceLinkedAxisRole, SourceLinkedAxisNumberFormatResolution>
>;

const GENERAL_FORMAT = 'General';
const PERCENT_STACKED_AXIS_FORMAT = '0%';
const SOURCE_LINKED_AXIS_FORMATS_EXTRA_KEY = 'sourceLinkedAxisNumberFormats';
const SOURCE_LINKED_AXIS_ROLES: SourceLinkedAxisRole[] = [
  'category',
  'secondary category',
  'value',
  'secondary value',
];
const PERCENT_STACKED_CHART_TYPES = new Set<string>([
  'lineMarkersStacked100',
  'cylinderColStacked100',
  'cylinderBarStacked100',
  'coneColStacked100',
  'coneBarStacked100',
  'pyramidColStacked100',
  'pyramidBarStacked100',
]);

function normalizeFormatCode(formatCode: string | null | undefined): string | undefined {
  const normalized = formatCode?.trim();
  return normalized ? normalized : undefined;
}

function cacheFormatCode(cache: ChartSeriesPointCache | undefined): string | undefined {
  return (
    normalizeFormatCode(cache?.formatCode) ??
    cache?.points.map((point) => normalizeFormatCode(point.formatCode)).find(Boolean)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSourceLinkedAxisNumberFormatResolution(
  value: unknown,
): value is SourceLinkedAxisNumberFormatResolution {
  if (!isRecord(value)) return false;
  return (
    (value.formatCode === undefined || typeof value.formatCode === 'string') &&
    typeof value.missingSource === 'boolean' &&
    typeof value.conflictingFormats === 'boolean'
  );
}

function hasSourceLinkedAxisNumberFormatResolutions(
  resolutions: SourceLinkedAxisNumberFormatResolutions | undefined,
): resolutions is SourceLinkedAxisNumberFormatResolutions {
  return Boolean(resolutions && SOURCE_LINKED_AXIS_ROLES.some((role) => resolutions[role]));
}

function sourceLinkedAxisNumberFormatResolutionsFromConfig(
  config: ChartConfig,
): SourceLinkedAxisNumberFormatResolutions | undefined {
  if (!isRecord(config.extra)) return undefined;
  const raw = config.extra[SOURCE_LINKED_AXIS_FORMATS_EXTRA_KEY];
  if (!isRecord(raw)) return undefined;

  const resolutions: SourceLinkedAxisNumberFormatResolutions = {};
  for (const role of SOURCE_LINKED_AXIS_ROLES) {
    const resolution = raw[role];
    if (isSourceLinkedAxisNumberFormatResolution(resolution)) {
      resolutions[role] = resolution;
    }
  }
  return hasSourceLinkedAxisNumberFormatResolutions(resolutions) ? resolutions : undefined;
}

function withSourceLinkedAxisNumberFormatExtra(
  config: ChartConfig,
  resolutions: SourceLinkedAxisNumberFormatResolutions | undefined,
): ChartConfig['extra'] {
  if (!hasSourceLinkedAxisNumberFormatResolutions(resolutions)) return config.extra;
  const extra = isRecord(config.extra) ? config.extra : {};
  return {
    ...extra,
    [SOURCE_LINKED_AXIS_FORMATS_EXTRA_KEY]: resolutions,
  };
}

function firstCategorySourceFormat(config: ChartConfig): SourceLinkedAxisNumberFormatResolution {
  const formatCode = config.series
    ?.map((series) => {
      const categoryLabelFormat = series.categoryLabelFormat;
      return (
        normalizeFormatCode(categoryLabelFormat?.formatCode) ??
        categoryLabelFormat?.points
          ?.map((point) => normalizeFormatCode(point.formatCode))
          .find(Boolean) ??
        cacheFormatCode(series.categoryCache)
      );
    })
    .find(Boolean);

  return { formatCode, missingSource: !formatCode, conflictingFormats: false };
}

function valueAxisGroup(role: SourceLinkedAxisRole): 0 | 1 | undefined {
  if (role === 'value') return 0;
  if (role === 'secondary value') return 1;
  return undefined;
}

function isSeriesBoundToAxis(series: SeriesConfig, axisGroup: 0 | 1): boolean {
  return axisGroup === 1 ? series.yAxisIndex === 1 : series.yAxisIndex !== 1;
}

function hasVisibleChartLineStyle(line: unknown): boolean {
  if (!line || typeof line !== 'object') return false;
  const candidate = line as { color?: unknown; width?: unknown };
  return candidate.color !== undefined || candidate.width !== undefined;
}

export function isNoFillNoLineSeriesConfig(
  series: NonNullable<ChartConfig['series']>[number] | undefined,
): boolean {
  if (!series?.format) return false;
  return series.format.fill?.type === 'none' && !hasVisibleChartLineStyle(series.format.line);
}

function firstValueSourceFormat(
  config: ChartConfig,
  axisGroup: 0 | 1,
): SourceLinkedAxisNumberFormatResolution {
  const sourceFormats =
    config.series
      ?.filter((series) => isSeriesBoundToAxis(series, axisGroup))
      .filter((series) => !isNoFillNoLineSeriesConfig(series))
      .map((series) => cacheFormatCode(series.valueCache))
      .filter((formatCode): formatCode is string => Boolean(formatCode)) ?? [];
  const formatCode = sourceFormats[0];
  const conflictingFormats = sourceFormats.some((candidate) => candidate !== formatCode);
  return { formatCode, missingSource: !formatCode, conflictingFormats };
}

function sourceLinkedAxisFormat(
  config: ChartConfig,
  role: SourceLinkedAxisRole,
  resolutions: SourceLinkedAxisNumberFormatResolutions | undefined,
): SourceLinkedAxisNumberFormatResolution {
  const explicitResolution = resolutions?.[role];
  if (explicitResolution) return explicitResolution;
  const axisGroup = valueAxisGroup(role);
  if (axisGroup !== undefined) return firstValueSourceFormat(config, axisGroup);
  return firstCategorySourceFormat(config);
}

function isPercentStackedSubType(subType: ChartConfig['subType'] | undefined): boolean {
  return subType === 'percentStacked' || subType === 'markersPercentStacked';
}

function isPercentStackedChartType(type: string | undefined): boolean {
  return PERCENT_STACKED_CHART_TYPES.has(String(type));
}

function hasPercentStackedValueAxis(config: ChartConfig, axisGroup: 0 | 1): boolean {
  if (isPercentStackedSubType(config.subType) || isPercentStackedChartType(config.type)) {
    return true;
  }

  return (
    config.series
      ?.filter((series) => isSeriesBoundToAxis(series, axisGroup))
      .some((series) => isPercentStackedChartType(series.type)) ?? false
  );
}

function percentStackedAxisFormat(
  config: ChartConfig,
  role: SourceLinkedAxisRole,
): string | undefined {
  const axisGroup = valueAxisGroup(role);
  if (axisGroup === undefined) return undefined;
  return hasPercentStackedValueAxis(config, axisGroup) ? PERCENT_STACKED_AXIS_FORMAT : undefined;
}

function resolvedAxisNumberFormat(
  axis: SingleAxisConfig,
  config: ChartConfig,
  role: SourceLinkedAxisRole,
  resolutions: SourceLinkedAxisNumberFormatResolutions | undefined,
): string | undefined {
  const resolvedSourceFormat = normalizeFormatCode(resolutions?.[role]?.formatCode);
  if (resolvedSourceFormat) return resolvedSourceFormat;
  const explicitAxisFormat = normalizeFormatCode(axis.numberFormat);
  if (explicitAxisFormat) return explicitAxisFormat;
  const percentFormat = percentStackedAxisFormat(config, role);
  if (percentFormat) return percentFormat;
  return sourceLinkedAxisFormat(config, role, resolutions).formatCode;
}

function axisWithResolvedNumberFormat(
  axis: SingleAxisConfig | undefined,
  config: ChartConfig,
  role: SourceLinkedAxisRole,
  resolutions: SourceLinkedAxisNumberFormatResolutions | undefined,
): SingleAxisConfig | undefined {
  if (!axis?.linkNumberFormat) return axis;
  const numberFormat = resolvedAxisNumberFormat(axis, config, role, resolutions);
  if (!numberFormat || numberFormat === axis.numberFormat) return axis;
  return { ...axis, numberFormat };
}

function sourceFormatLabel(resolution: SourceLinkedAxisNumberFormatResolution): string {
  return resolution.formatCode ?? GENERAL_FORMAT;
}

function axisSourceFormatDiagnostic(
  axis: SingleAxisConfig | undefined,
  config: ChartConfig,
  role: SourceLinkedAxisRole,
  resolutions: SourceLinkedAxisNumberFormatResolutions | undefined,
): string | undefined {
  if (!axis?.linkNumberFormat) return undefined;
  const resolution = sourceLinkedAxisFormat(config, role, resolutions);
  const explicitAxisFormat = normalizeFormatCode(axis.numberFormat);
  const percentFormat = percentStackedAxisFormat(config, role);
  if (
    percentFormat &&
    (!explicitAxisFormat || explicitAxisFormat === percentFormat) &&
    resolution.formatCode &&
    resolution.formatCode !== percentFormat
  ) {
    return `${role} axis percent-stacked number format uses ${percentFormat} instead of source format ${sourceFormatLabel(
      resolution,
    )}`;
  }

  if (explicitAxisFormat && resolution.formatCode && resolution.formatCode !== explicitAxisFormat) {
    return `${role} axis source-linked number format keeps explicit axis format ${explicitAxisFormat} instead of source format ${sourceFormatLabel(
      resolution,
    )}`;
  }

  if (resolution.missingSource) {
    return `${role} axis source-linked number format has no source format; using ${
      normalizeFormatCode(axis.numberFormat) ?? GENERAL_FORMAT
    }`;
  }
  if (resolution.conflictingFormats) {
    return `${role} axis source-linked number format uses first bound series format due to conflicting source formats`;
  }
  return undefined;
}

/**
 * Resolve Excel source-linked axis formats before rendering.
 *
 * Explicit axis formats are authoritative. Otherwise category axes inherit
 * imported category label/cache formats and value axes inherit a percent-stack
 * default or the first visible bound series' value cache format for their axis
 * group. This keeps primary and secondary value axes independent while
 * preserving the original linkNumberFormat contract for export.
 */
export function withSourceLinkedAxisNumberFormats(
  config: ChartConfig,
  resolutions?: SourceLinkedAxisNumberFormatResolutions,
): ChartConfig {
  const axis = config.axis;
  if (!axis) return config;
  const effectiveResolutions =
    resolutions ?? sourceLinkedAxisNumberFormatResolutionsFromConfig(config);
  const extra = withSourceLinkedAxisNumberFormatExtra(config, resolutions);

  const categoryAxis = axisWithResolvedNumberFormat(
    axis.categoryAxis ?? axis.xAxis,
    config,
    'category',
    effectiveResolutions,
  );
  const secondaryCategoryAxis = axisWithResolvedNumberFormat(
    axis.secondaryCategoryAxis,
    config,
    'secondary category',
    effectiveResolutions,
  );
  const valueAxis = axisWithResolvedNumberFormat(
    axis.valueAxis ?? axis.yAxis,
    config,
    'value',
    effectiveResolutions,
  );
  const secondaryValueAxis = axisWithResolvedNumberFormat(
    axis.secondaryValueAxis ?? axis.secondaryYAxis,
    config,
    'secondary value',
    effectiveResolutions,
  );

  if (
    categoryAxis === (axis.categoryAxis ?? axis.xAxis) &&
    secondaryCategoryAxis === axis.secondaryCategoryAxis &&
    valueAxis === (axis.valueAxis ?? axis.yAxis) &&
    secondaryValueAxis === (axis.secondaryValueAxis ?? axis.secondaryYAxis) &&
    extra === config.extra
  ) {
    return config;
  }

  return {
    ...config,
    ...(extra === config.extra ? {} : { extra }),
    axis: {
      ...axis,
      ...(categoryAxis ? { categoryAxis, xAxis: categoryAxis } : {}),
      ...(secondaryCategoryAxis ? { secondaryCategoryAxis } : {}),
      ...(valueAxis ? { valueAxis, yAxis: valueAxis } : {}),
      ...(secondaryValueAxis ? { secondaryValueAxis, secondaryYAxis: secondaryValueAxis } : {}),
    },
  };
}

export function sourceLinkedAxisNumberFormatDiagnostics(
  config: ChartConfig,
  resolutions?: SourceLinkedAxisNumberFormatResolutions,
): string[] {
  const axis = config.axis;
  if (!axis) return [];
  const effectiveResolutions =
    resolutions ?? sourceLinkedAxisNumberFormatResolutionsFromConfig(config);
  return [
    axisSourceFormatDiagnostic(
      axis.categoryAxis ?? axis.xAxis,
      config,
      'category',
      effectiveResolutions,
    ),
    axisSourceFormatDiagnostic(
      axis.secondaryCategoryAxis,
      config,
      'secondary category',
      effectiveResolutions,
    ),
    axisSourceFormatDiagnostic(axis.valueAxis ?? axis.yAxis, config, 'value', effectiveResolutions),
    axisSourceFormatDiagnostic(
      axis.secondaryValueAxis ?? axis.secondaryYAxis,
      config,
      'secondary value',
      effectiveResolutions,
    ),
  ].filter((diagnostic): diagnostic is string => Boolean(diagnostic));
}
