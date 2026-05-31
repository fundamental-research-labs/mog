import type { ChartConfig } from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import {
  importStatusUnsupportedDiagnostics,
  packageAuthorityDiagnostics,
} from './resolved-spec-package-authority';

export { snapshotPackageAuthority } from './resolved-spec-package-authority';

type ResolvedSnapshotSeries = ResolvedChartSpecSnapshot['resolved']['series'];
type ResolvedSnapshotLayout = ResolvedChartSpecSnapshot['resolved']['layout'];
type SingleAxisConfig = NonNullable<NonNullable<ChartConfig['axis']>['categoryAxis']>;
type AxisDiagnosticRole = 'category' | 'value' | 'series';
type AxisOrientation = 'horizontal' | 'vertical';
type AxisPosition = 'bottom' | 'top' | 'left' | 'right';

export function unsupportedFeatureDiagnostics(input: {
  chart: ChartFloatingObject;
  config: ChartConfig;
  series: ResolvedSnapshotSeries;
  layout: ResolvedSnapshotLayout | null;
  hasRenderableChartExData: boolean;
  sourceLinkedAxisNumberFormatDiagnostics: readonly string[];
}): string[] {
  const { chart, config, series, layout } = input;
  const unsupported: string[] = [];
  unsupported.push(...importStatusUnsupportedDiagnostics(chart.importStatus));
  unsupported.push(...packageAuthorityDiagnostics(chart));
  if (config.type === 'bar3d' || config.type === 'column3d') {
    unsupported.push('3-D bar chart rendered as 2-D bar/column approximation');
    for (const shape of barShapeDiagnostics(config)) {
      unsupported.push(`3-D bar shape "${shape}" is preserved but rendered as rectangular bars`);
    }
    if (chartGapDepth(config) !== undefined)
      unsupported.push('3-D bar gapDepth is preserved but not rendered');
  } else if (String(config.type).endsWith('3d') && config.type !== 'surface3d') {
    unsupported.push('3-D chart rendering is approximated by the 2-D chart backend');
  }
  unsupported.push(...surfaceFamilyDiagnostics(config));
  if (config.type === 'regionMap')
    unsupported.push('region map rendering uses placeholder geometry');
  if (config.type === 'treemap')
    unsupported.push('treemap rendering requires hierarchy layout semantics');
  if (config.type === 'sunburst')
    unsupported.push('sunburst rendering requires hierarchy layout semantics');
  const isChartEx = (config.extra as { isChartEx?: boolean } | undefined)?.isChartEx === true;
  if (isChartEx && !config.dataRange && !input.hasRenderableChartExData) {
    unsupported.push(`ChartEx ${config.type} data projection is not implemented`);
  }
  if (config.pivotOptions || config.showAllFieldButtons)
    unsupported.push(pivotFieldButtonDiagnostic(config));
  for (const diagnostic of config.pivotProjection?.diagnostics ?? []) {
    unsupported.push(
      diagnostic.message ?? `pivot chart projection diagnostic: ${diagnostic.reason}`,
    );
  }
  if (!layout) {
    if (hasManualPlotLayout(config))
      unsupported.push('manual plot layout is preserved but not rendered');
    if (hasManualTitleLayout(config))
      unsupported.push('manual title layout is preserved but not rendered');
    if (hasManualLegendLayout(config))
      unsupported.push('manual legend layout is preserved but not rendered');
  }
  if (hasManualDataLabelLayout(config) && !layout?.dataLabels)
    unsupported.push('manual data-label layout is preserved but not rendered');
  if (config.dataTable && !layout?.dataTable)
    unsupported.push('chart data table is preserved but not rendered');
  if (hasPictureMarkers(config))
    unsupported.push('picture markers are preserved for export but rendered as standard symbols');
  unsupported.push(...comboScatterSeriesDiagnostics(config, series));
  if (hasSourceLinkedDataLabelFormatWithoutModeledFormat(config))
    unsupported.push(
      'source-linked data label number formats are preserved but rendered with modeled fallback formatting',
    );
  if (config.type === 'ofPie' && config.seriesLines && config.seriesLines.visible !== false)
    unsupported.push(
      'of-pie series lines require secondary-plot geometry and are preserved for export only',
    );
  if (config.view3d)
    unsupported.push('view3D camera/depth is preserved but rendered as a 2-D approximation');
  if (config.floorFormat || config.sideWallFormat || config.backWallFormat)
    unsupported.push('floor/sideWall/backWall surfaces are preserved but not rendered');
  unsupported.push(...input.sourceLinkedAxisNumberFormatDiagnostics);
  unsupported.push(...axisUnsupportedFeatureDiagnostics(config, series));
  return unsupported;
}

function barShapeDiagnostics(config: ChartConfig): string[] {
  const shapes = new Set<string>();
  if (config.barShape) shapes.add(config.barShape);
  for (const series of config.series ?? []) {
    if (series.barShape) shapes.add(series.barShape);
  }
  return Array.from(shapes);
}

export function chartGapDepth(config: ChartConfig): number | undefined {
  return finiteNumber(config.gapDepth) ?? findNumberField(config.extra, ['gapDepth', 'gap_depth']);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function findNumberField(value: unknown, keys: readonly string[], depth = 0): number | undefined {
  if (depth > 16 || typeof value !== 'object' || value === null) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNumberField(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const found = finiteNumber(record[key]);
    if (found !== undefined) return found;
  }
  for (const child of Object.values(record)) {
    const found = findNumberField(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function surfaceFamilyDiagnostics(config: ChartConfig): string[] {
  const type = config.type;
  const isSurfaceType =
    type === 'surface' ||
    type === 'surface3d' ||
    type === 'surfaceWireframe' ||
    type === 'surfaceTopView' ||
    type === 'surfaceTopViewWireframe';
  if (!isSurfaceType) return [];

  const wireframe =
    config.wireframe === true || type === 'surfaceWireframe' || type === 'surfaceTopViewWireframe';
  if (wireframe) {
    return ['surface wireframe rendering is not implemented; chart is preserved as a placeholder'];
  }

  const topView = config.surfaceTopView === true || type === 'surfaceTopView' || type === 'surface';
  if (topView) {
    return [
      'contour/top-view surface rendering is not implemented; chart is preserved as a placeholder',
    ];
  }

  if (type === 'surface3d') {
    return ['3-D surface chart rendering is not implemented; chart is preserved as a placeholder'];
  }

  return ['surface chart rendering is not implemented; chart is preserved as a placeholder'];
}

function hasManualPlotLayout(config: ChartConfig): boolean {
  return Boolean(config.plotLayout || config.plotArea?.layout);
}

function hasManualTitleLayout(config: ChartConfig): boolean {
  return Boolean(config.titleLayout || config.chartTitle?.layout);
}

function hasManualLegendLayout(config: ChartConfig): boolean {
  return Boolean(config.legend?.layout);
}

function pivotFieldButtonDiagnostic(config: ChartConfig): string {
  const flags = [
    config.showAllFieldButtons !== undefined ? 'showAllFieldButtons' : undefined,
    config.pivotOptions?.showAxisFieldButtons !== undefined ? 'showAxisFieldButtons' : undefined,
    config.pivotOptions?.showLegendFieldButtons !== undefined
      ? 'showLegendFieldButtons'
      : undefined,
    config.pivotOptions?.showReportFilterFieldButtons !== undefined
      ? 'showReportFilterFieldButtons'
      : undefined,
    config.pivotOptions?.showValueFieldButtons !== undefined ? 'showValueFieldButtons' : undefined,
  ].filter(Boolean);
  return flags.length > 0
    ? `pivot chart field buttons are preserved but not rendered (${flags.join(', ')})`
    : 'pivot chart field buttons are preserved but not rendered';
}

function hasManualDataLabelLayout(config: ChartConfig): boolean {
  return Boolean(
    config.dataLabels?.layout ||
    config.series?.some(
      (series) =>
        series.dataLabels?.layout || series.points?.some((point) => point.dataLabel?.layout),
    ),
  );
}

function hasPictureMarkers(config: ChartConfig): boolean {
  return Boolean(
    config.series?.some(
      (series) =>
        series.markerStyle === 'picture' ||
        series.points?.some((point) => point.markerStyle === 'picture'),
    ),
  );
}

function comboScatterSeriesDiagnostics(
  config: ChartConfig,
  series: ResolvedSnapshotSeries,
): string[] {
  const diagnostics: string[] = [];
  if (config.type === 'combo') {
    const xRoles = new Set(series.map((item) => item.xRole).filter(Boolean));
    if (xRoles.size > 1) {
      diagnostics.push(
        'combo chart mixes category and quantitative x roles; layers are rendered with per-series x encodings where possible',
      );
    }
  }

  for (const item of series) {
    if (item.type && item.renderLayerCount === 0) {
      diagnostics.push(
        `series ${item.sourceSeriesIndex} uses unsupported chart type "${item.type}" and is not rendered as a combo layer`,
      );
    }
    if (
      item.xRole === 'quantitative' &&
      !item.categories.some(
        (category, index) => typeof category === 'number' && item.values[index] !== null,
      )
    ) {
      diagnostics.push(
        `series ${item.sourceSeriesIndex} has no valid numeric x/y points for scatter rendering`,
      );
    }
    if (
      (item.type === 'scatter' || item.xRole === 'quantitative') &&
      item.showLines === false &&
      item.showMarkers === false &&
      item.markerStyle !== 'picture'
    ) {
      diagnostics.push(`series ${item.sourceSeriesIndex} has no visible line or marker channel`);
    }
  }

  return diagnostics;
}

function hasSourceLinkedDataLabelFormatWithoutModeledFormat(config: ChartConfig): boolean {
  return dataLabelConfigs(config).some(
    (label) => label.linkNumberFormat === true && !label.numberFormat && !label.format,
  );
}

function dataLabelConfigs(config: ChartConfig): NonNullable<ChartConfig['dataLabels']>[] {
  const labels: NonNullable<ChartConfig['dataLabels']>[] = [];
  if (config.dataLabels) labels.push(config.dataLabels);
  for (const series of config.series ?? []) {
    if (series.dataLabels) labels.push(series.dataLabels);
    for (const point of series.points ?? []) {
      if (point.dataLabel) labels.push(point.dataLabel);
    }
  }
  return labels;
}

function axisUnsupportedFeatureDiagnostics(
  config: ChartConfig,
  series: ResolvedSnapshotSeries,
): string[] {
  const axis = config.axis;
  if (!axis) return [];
  const diagnostics = new Set<string>();
  const isChartEx = (config.extra as { isChartEx?: boolean } | undefined)?.isChartEx === true;
  const isHorizontal = isHorizontalChartType(config.type);
  const entries: Array<{
    label: string;
    role: AxisDiagnosticRole;
    axisConfig: SingleAxisConfig | undefined;
    secondary?: boolean;
  }> = [
    { label: 'category', role: 'category', axisConfig: axis.categoryAxis ?? axis.xAxis },
    { label: 'value', role: 'value', axisConfig: axis.valueAxis ?? axis.yAxis },
    {
      label: 'secondary category',
      role: 'category',
      axisConfig: axis.secondaryCategoryAxis,
      secondary: true,
    },
    {
      label: 'secondary value',
      role: 'value',
      axisConfig: axis.secondaryValueAxis ?? axis.secondaryYAxis,
      secondary: true,
    },
    { label: 'series/depth', role: 'series', axisConfig: axis.seriesAxis },
  ];

  for (const { label, role, axisConfig, secondary } of entries) {
    if (!axisConfig) continue;
    if (role === 'series') {
      diagnostics.add('series/depth axes are preserved but not rendered');
    }
    if (isChartEx) {
      diagnostics.add(
        `ChartEx ${label} axis metadata is preserved but rendered through the standard chart axis backend`,
      );
    }
    const positionDiagnostic = axisPositionDiagnostic(label, role, axisConfig, isHorizontal);
    if (positionDiagnostic) diagnostics.add(positionDiagnostic);
    if (axisConfig.crossBetween || axisConfig.isBetweenCategories !== undefined) {
      diagnostics.add(`${label} axis category crossing policy is approximate`);
    }
    if (secondary && role === 'category') {
      const scaleDiagnostic = secondaryCategoryIndependentScaleDiagnostic(label, axisConfig);
      if (scaleDiagnostic) diagnostics.add(scaleDiagnostic);
    }
    for (const diagnostic of logAxisDiagnostics(label, axisConfig, series)) {
      diagnostics.add(diagnostic);
    }
  }

  return Array.from(diagnostics);
}

function axisPositionDiagnostic(
  label: string,
  role: AxisDiagnosticRole,
  axisConfig: SingleAxisConfig,
  isHorizontalChart: boolean,
): string | undefined {
  if (!axisConfig.position) return undefined;
  const position = normalizeAxisPosition(axisConfig.position);
  if (!position) {
    return `${label} axis position "${axisConfig.position}" is not recognized`;
  }
  const expectedOrientation = expectedAxisOrientation(role, isHorizontalChart);
  if (!expectedOrientation) return undefined;
  const allowed =
    expectedOrientation === 'horizontal'
      ? new Set<AxisPosition>(['bottom', 'top'])
      : new Set<AxisPosition>(['left', 'right']);
  return allowed.has(position)
    ? undefined
    : `${label} axis position "${axisConfig.position}" does not match ${expectedOrientation} axis geometry`;
}

function expectedAxisOrientation(
  role: AxisDiagnosticRole,
  isHorizontalChart: boolean,
): AxisOrientation | undefined {
  if (role === 'series') return undefined;
  if (role === 'category') return isHorizontalChart ? 'vertical' : 'horizontal';
  return isHorizontalChart ? 'horizontal' : 'vertical';
}

function normalizeAxisPosition(position: string): AxisPosition | undefined {
  switch (position.toLowerCase()) {
    case 'b':
    case 'bottom':
      return 'bottom';
    case 't':
    case 'top':
      return 'top';
    case 'l':
    case 'left':
      return 'left';
    case 'r':
    case 'right':
      return 'right';
    default:
      return undefined;
  }
}

function secondaryCategoryIndependentScaleDiagnostic(
  label: string,
  axisConfig: SingleAxisConfig,
): string | undefined {
  const fields = [
    axisConfig.min !== undefined ? 'min' : undefined,
    axisConfig.max !== undefined ? 'max' : undefined,
    axisConfig.logBase !== undefined ? 'logBase' : undefined,
    axisConfig.scaleType !== undefined ? 'scaleType' : undefined,
    axisConfig.reverse !== undefined ? 'reverse' : undefined,
    axisConfig.majorUnit !== undefined ? 'majorUnit' : undefined,
    axisConfig.minorUnit !== undefined ? 'minorUnit' : undefined,
    axisConfig.categoryType !== undefined ? 'categoryType' : undefined,
    axisConfig.baseTimeUnit !== undefined ? 'baseTimeUnit' : undefined,
    axisConfig.majorTimeUnit !== undefined ? 'majorTimeUnit' : undefined,
    axisConfig.minorTimeUnit !== undefined ? 'minorTimeUnit' : undefined,
  ].filter(Boolean);
  if (fields.length === 0) return undefined;
  return `${label} axis independent scale/domain is preserved but rendered on the primary category scale (${fields.join(', ')})`;
}

function isHorizontalChartType(chartType: ChartConfig['type']): boolean {
  switch (chartType) {
    case 'bar':
    case 'bar3d':
    case 'cylinderBarClustered':
    case 'cylinderBarStacked':
    case 'cylinderBarStacked100':
    case 'coneBarClustered':
    case 'coneBarStacked':
    case 'coneBarStacked100':
    case 'pyramidBarClustered':
    case 'pyramidBarStacked':
    case 'pyramidBarStacked100':
      return true;
    default:
      return false;
  }
}

function logAxisDiagnostics(
  label: string,
  axisConfig: SingleAxisConfig,
  series: ResolvedSnapshotSeries,
): string[] {
  const isLogAxis = axisConfig.scaleType === 'logarithmic' || axisConfig.logBase !== undefined;
  if (!isLogAxis) return [];

  const diagnostics: string[] = [];
  const logBase = axisConfig.logBase ?? 10;
  if (!Number.isFinite(logBase) || logBase <= 1) {
    diagnostics.push(`${label} axis logarithmic scale has invalid base`);
  }

  const invalidDomainFields = [
    axisConfig.min !== undefined && axisConfig.min <= 0 ? 'min' : undefined,
    axisConfig.max !== undefined && axisConfig.max <= 0 ? 'max' : undefined,
  ].filter(Boolean);
  if (invalidDomainFields.length > 0) {
    diagnostics.push(
      `${label} axis logarithmic scale has non-positive ${invalidDomainFields.join('/')} domain`,
    );
  }

  const values = positiveDomainCandidateValues(label, series);
  if (values.length > 0 && values.every((value) => value <= 0)) {
    diagnostics.push(`${label} axis logarithmic scale has no positive bound data values`);
  }

  return diagnostics;
}

function positiveDomainCandidateValues(label: string, series: ResolvedSnapshotSeries): number[] {
  if (label === 'value') {
    return series
      .filter((item) => item.axisGroup !== 'secondary')
      .flatMap((item) => item.values)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  }
  if (label === 'secondary value') {
    return series
      .filter((item) => item.axisGroup === 'secondary')
      .flatMap((item) => item.values)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  }
  return [];
}
