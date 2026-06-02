import {
  expectedStockRolesForSubtype,
  isBarLikeChartType,
  resolveBarGeometryGroups,
  seriesConfigForDataSeries,
  stockRoleOrder,
  stockSubTypeFromRolePresence,
  type ChartConfig,
  type ChartData,
} from '@mog/charts';
import type {
  ChartFamilySupportSnapshot,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { importStatusToTerminalRenderStatus } from './import-render-status';
import {
  barShapeDiagnostics,
  isSurfaceFamilyConfig,
  isSurfaceTopViewConfig,
  surfaceApproximationDiagnostics,
  surfacePlaceholderDiagnostics,
} from './resolved-spec-diagnostics-surface';

type LegendSnapshot = ResolvedChartSpecSnapshot['resolved']['legend'];
type SeriesProjectionSnapshot = ResolvedChartSpecSnapshot['resolved']['seriesProjection'];
type ChartSeriesStockRole = NonNullable<
  NonNullable<SeriesProjectionSnapshot['sourceSeries']>[number]['stockRole']
>;

export function buildChartFamilySupportSnapshot(input: {
  chart: ChartFloatingObject;
  config: ChartConfig;
  chartData: ChartData;
  legend: LegendSnapshot;
  seriesProjection: SeriesProjectionSnapshot;
}): ChartFamilySupportSnapshot {
  const { chart, config } = input;
  const family = chartFamily(config);
  const sourceFamily = sourceFamilyForChart(chart, config, family);
  const terminalImportStatus = importStatusToTerminalRenderStatus(chart.importStatus);
  if (terminalImportStatus) {
    const supportLevel =
      importStatusToken(chart.importStatus, 'renderability') === 'placeholder'
        ? 'preservedPlaceholder'
        : 'unsupported';
    return {
      schemaVersion: 1,
      family,
      sourceFamily,
      supportLevel,
      reason:
        supportLevel === 'preservedPlaceholder'
          ? 'preservedPlaceholderImportStatus'
          : 'unsupportedImportStatus',
      diagnostics: importStatusMessages(chart.importStatus, terminalImportStatus.message),
    };
  }

  if (isSurfaceFamilyConfig(config)) {
    const renderable = hasFiniteSurfaceValues(input.chartData);
    const topView = isSurfaceTopViewConfig(config);
    return {
      schemaVersion: 1,
      family,
      sourceFamily,
      supportLevel: renderable ? 'approximate' : 'preservedPlaceholder',
      reason: renderable
        ? topView
          ? 'contourApproximation'
          : 'surfaceApproximation'
        : topView
          ? 'contourProjectionIncomplete'
          : 'surfaceProjectionIncomplete',
      diagnostics: renderable
        ? surfaceApproximationDiagnostics(config)
        : surfacePlaceholderDiagnostics(config),
      renderedAs: topView ? 'contour' : 'surface3d',
    };
  }

  if (config.type === 'stock') {
    return stockFamilySupport({ ...input, family, sourceFamily });
  }

  if (config.type === 'bubble' || config.type === 'bubble3DEffect') {
    return bubbleFamilySupport({ ...input, family, sourceFamily });
  }

  if (config.type === 'radar') {
    return radarFamilySupport({ ...input, family, sourceFamily });
  }

  if (config.type === 'combo') {
    return comboFamilySupport({ ...input, family, sourceFamily });
  }

  if (isRectangularSpecialtyConfig(config)) {
    return rectangularSpecialtyFamilySupport({ ...input, family, sourceFamily });
  }

  if (isThreeDChartConfig(config)) {
    return {
      schemaVersion: 1,
      family,
      sourceFamily,
      supportLevel: 'approximate',
      reason: 'threeDApproximation',
      diagnostics: threeDApproximationDiagnostics(config),
      renderedAs: config.type,
    };
  }

  return {
    schemaVersion: 1,
    family,
    sourceFamily,
    supportLevel: 'exact',
    reason: 'standardRenderer',
    diagnostics: [],
    renderedAs: config.type,
  };
}

export function familySupportCompilerDiagnostics(
  support: ChartFamilySupportSnapshot,
): string[] {
  if (support.supportLevel === 'exact' || support.supportLevel === 'approximate') return [];
  return support.diagnostics;
}

function comboFamilySupport(input: {
  config: ChartConfig;
  chartData: ChartData;
  family: string;
  sourceFamily?: string;
}): ChartFamilySupportSnapshot {
  const barGroups = resolveBarGeometryGroups(input.config, input.chartData);
  const nonBarSeriesCount = comboNonBarSeriesCount(input.config, input.chartData);
  const diagnostics: string[] = [];
  if (barGroups.length > 0) {
    diagnostics.push(
      `combo renderer resolved ${barGroups.length} bar geometry group(s) for layer-aware rendering`,
    );
  }
  if (nonBarSeriesCount > 0) {
    diagnostics.push(
      `combo renderer keeps ${nonBarSeriesCount} non-bar series separate from bar slot geometry`,
    );
  }
  if (barGroups.some((group) => group.yAxisIndex === 1)) {
    diagnostics.push('combo renderer preserves secondary value-axis ownership for bar groups');
  }

  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: 'exact',
    reason: 'comboLayeredRenderer',
    diagnostics,
    renderedAs: 'combo',
  };
}

function radarFamilySupport(input: {
  config: ChartConfig;
  family: string;
  sourceFamily?: string;
}): ChartFamilySupportSnapshot {
  const markers = input.config.radarMarkers === true || input.config.subType === 'markers';
  const filled = input.config.radarFilled === true || input.config.subType === 'filled';
  const reason: ChartFamilySupportSnapshot['reason'] = markers
    ? 'radarMarkerStyleFidelity'
    : filled
      ? 'radarFillStyleFidelity'
      : 'radarGridLabelStyleFidelity';
  const diagnostics = [
    'radar polar projection metadata exposes category-angle, value-radius, fill, and marker evidence',
    'radar automatic radial value scale is resolved from the shared Excel-like scale contract',
  ];
  if (markers) {
    diagnostics.push(
      'radar marker shapes use Excel-like automatic defaults when imported marker style is absent',
    );
  }
  if (filled) {
    diagnostics.push(
      'radar filled polygons use an Excel-like default opacity unless imported fill opacity is present',
    );
  }
  diagnostics.push(
    'radar grid and label styling remains approximate when source formatting is incomplete',
  );

  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: 'approximate',
    reason,
    diagnostics,
    renderedAs: 'radar',
  };
}

function rectangularSpecialtyFamilySupport(input: {
  config: ChartConfig;
  chartData: ChartData;
  family: string;
  sourceFamily?: string;
}): ChartFamilySupportSnapshot {
  switch (input.config.type) {
    case 'funnel': {
      const renderable = hasPositiveChartValues(input.chartData);
      return {
        schemaVersion: 1,
        family: input.family,
        sourceFamily: input.sourceFamily,
        supportLevel: renderable ? 'approximate' : 'preservedPlaceholder',
        reason: renderable
          ? 'funnelProportionalBarApproximation'
          : 'funnelProjectionIncomplete',
        diagnostics: renderable
          ? ['funnel chart renders as centered proportional bar layers']
          : ['funnel chart needs at least one positive finite value for proportional geometry'],
        renderedAs: 'funnel',
      };
    }
    case 'waterfall':
      return implementedRectangularSpecialtySupport(input, {
        reason: 'waterfallRenderer',
        incompleteReason: 'waterfallProjectionIncomplete',
        renderedAs: 'waterfall',
        incompleteDiagnostic: 'waterfall chart needs finite values for running-total projection',
      });
    case 'histogram':
      return implementedRectangularSpecialtySupport(input, {
        reason: 'histogramRenderer',
        incompleteReason: 'histogramProjectionIncomplete',
        renderedAs: 'histogram',
        incompleteDiagnostic: 'histogram chart needs finite values for bin projection',
      });
    case 'pareto':
      return implementedRectangularSpecialtySupport(input, {
        reason: 'paretoRenderer',
        incompleteReason: 'paretoProjectionIncomplete',
        renderedAs: 'pareto',
        incompleteDiagnostic: 'pareto chart needs finite values for sorted bars and cumulative line',
      });
    case 'boxplot':
      return implementedRectangularSpecialtySupport(input, {
        reason: 'boxplotRenderer',
        incompleteReason: 'boxplotProjectionIncomplete',
        renderedAs: 'boxplot',
        incompleteDiagnostic: 'boxplot chart needs finite values for box-and-whisker projection',
      });
    case 'treemap':
    case 'sunburst':
    case 'regionMap':
      return {
        schemaVersion: 1,
        family: input.family,
        sourceFamily: input.sourceFamily,
        supportLevel: 'preservedPlaceholder',
        reason: 'preservedOnlyChartExFamily',
        diagnostics: preservedOnlyRectangularDiagnostics(input.config),
        renderedAs: input.config.type,
      };
    default:
      return {
        schemaVersion: 1,
        family: input.family,
        sourceFamily: input.sourceFamily,
        supportLevel: 'unsupported',
        reason: 'unsupportedImportStatus',
        diagnostics: [`${input.config.type} chart family is not renderable`],
      };
  }
}

function implementedRectangularSpecialtySupport(
  input: {
    config: ChartConfig;
    chartData: ChartData;
    family: string;
    sourceFamily?: string;
  },
  options: {
    reason: ChartFamilySupportSnapshot['reason'];
    incompleteReason: ChartFamilySupportSnapshot['reason'];
    renderedAs: string;
    incompleteDiagnostic: string;
  },
): ChartFamilySupportSnapshot {
  const renderable = hasFiniteChartValues(input.chartData);
  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: renderable ? 'exact' : 'preservedPlaceholder',
    reason: renderable ? options.reason : options.incompleteReason,
    diagnostics: renderable ? [] : [options.incompleteDiagnostic],
    renderedAs: options.renderedAs,
  };
}

export function threeDApproximationDiagnostics(config: ChartConfig): string[] {
  const diagnostics = ['3-D chart rendering is approximate'];
  if (config.type === 'pie3d' || config.type === 'pie3dExploded') {
    diagnostics.push('pie3D projection uses an approximate arc-depth fallback');
  }
  if (config.view3d) {
    diagnostics.push('view3D camera/depth is preserved but rendered approximately');
  }
  for (const shape of barShapeDiagnostics(config)) {
    diagnostics.push(`3-D bar shape "${shape}" is preserved but may render approximately`);
  }
  if (config.floorFormat || config.sideWallFormat || config.backWallFormat) {
    diagnostics.push('floor/sideWall/backWall surfaces are preserved but not Excel-equivalent');
  }
  return diagnostics;
}

function stockFamilySupport(input: {
  chart: ChartFloatingObject;
  config: ChartConfig;
  legend: LegendSnapshot;
  seriesProjection: SeriesProjectionSnapshot;
  family: string;
  sourceFamily?: string;
}): ChartFamilySupportSnapshot {
  const expectedRoles = expectedStockRoles(input.config, input.seriesProjection);
  const sourceRoles = new Set(
    (input.seriesProjection.sourceSeries ?? [])
      .map((series) => series.stockRole)
      .filter((role): role is ChartSeriesStockRole => role !== undefined),
  );
  const projectedRoles = new Set(
    (input.seriesProjection.projectedRoleMappings ?? []).map((mapping) => mapping.stockRole),
  );
  const visibleLegendRoles = new Set(
    (input.legend.visibleEntryItems ?? [])
      .map((entry) => entry.stockRole)
      .filter((role): role is ChartSeriesStockRole => role !== undefined),
  );
  const missingSourceRoles = expectedRoles.filter((role) => !sourceRoles.has(role));
  const missingProjectedRoles = expectedRoles.filter((role) => !projectedRoles.has(role));
  const legendRequiresSourceRoles =
    input.legend.present && input.legend.visible !== false && expectedRoles.length > 0;
  const missingLegendRoles = legendRequiresSourceRoles
    ? expectedRoles.filter((role) => !visibleLegendRoles.has(role))
    : [];
  const renderedPointProjectionComplete = hasCompleteStockRenderedPointProjection(
    input.seriesProjection.stockRenderProjection,
    expectedRoles,
  );
  const exact =
    expectedRoles.length > 0 &&
    missingSourceRoles.length === 0 &&
    missingProjectedRoles.length === 0 &&
    missingLegendRoles.length === 0 &&
    input.seriesProjection.stockRenderProjection !== undefined &&
    renderedPointProjectionComplete;

  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: exact ? 'exact' : 'approximate',
    reason: exact ? 'exactRenderer' : 'stockSourceProjectionIncomplete',
    diagnostics: exact
      ? []
      : [
          stockProjectionDiagnostic(
            missingSourceRoles,
            missingProjectedRoles,
            missingLegendRoles,
            input.seriesProjection.stockRenderProjection === undefined,
            !renderedPointProjectionComplete,
          ),
        ],
    renderedAs: 'stock',
  };
}

function bubbleFamilySupport(input: {
  config: ChartConfig;
  legend: LegendSnapshot;
  family: string;
  sourceFamily?: string;
}): ChartFamilySupportSnapshot {
  const threeD = input.config.type === 'bubble3DEffect' || input.config.bubble3DEffect === true;
  if (threeD) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: 'threeDApproximation',
      diagnostics: ['3-D chart rendering is approximate'],
      renderedAs: 'bubble',
    };
  }

  const legendMatchesSource = bubbleLegendMatchesSource(input.config, input.legend);
  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: legendMatchesSource ? 'exact' : 'approximate',
    reason: legendMatchesSource ? 'exactRenderer' : 'bubbleLegendSeriesDomain',
    diagnostics: legendMatchesSource ? [] : [bubbleLegendDiagnostic(input.config, input.legend)],
    renderedAs: 'bubble',
  };
}

function bubbleLegendMatchesSource(config: ChartConfig, legend: LegendSnapshot): boolean {
  if (!legend.present) return true;
  if (bubbleUsesPointLegendVocabulary(config)) {
    return legend.entryVocabulary === 'category' || legend.entryVocabulary === 'point';
  }
  return legend.entryVocabulary === 'series';
}

function bubbleLegendDiagnostic(config: ChartConfig, legend: LegendSnapshot): string {
  const vocabulary = legend.entryVocabulary ?? 'unknown';
  if (bubbleUsesPointLegendVocabulary(config)) {
    return `bubble legend vocabulary is ${vocabulary}; expected point/category entries from vary-by-category source semantics`;
  }
  return `bubble legend vocabulary is ${vocabulary}; expected source series entries`;
}

function bubbleUsesPointLegendVocabulary(config: ChartConfig): boolean {
  return config.varyByCategories === true;
}

function expectedStockRoles(
  config: ChartConfig,
  projection: SeriesProjectionSnapshot,
): ChartSeriesStockRole[] {
  switch (config.subType) {
    case 'volume-ohlc':
    case 'volume-hlc':
    case 'ohlc':
    case 'hlc':
      return expectedStockRolesForSubtype(config.subType);
    default:
      break;
  }

  const roles = new Set(
    (projection.sourceSeries ?? [])
      .map((series) => series.stockRole)
      .filter((role): role is ChartSeriesStockRole => role !== undefined),
  );
  if (roles.size === 0) return expectedStockRolesForSubtype('hlc');
  return expectedStockRolesForSubtype(
    stockSubTypeFromRolePresence({
      ...(roles.has('volume') ? { volume: true } : {}),
      ...(roles.has('open') ? { open: true } : {}),
      ...(roles.has('high') ? { high: true } : {}),
      ...(roles.has('low') ? { low: true } : {}),
      ...(roles.has('close') ? { close: true } : {}),
    }),
  );
}

function stockProjectionDiagnostic(
  missingSourceRoles: readonly ChartSeriesStockRole[],
  missingProjectedRoles: readonly ChartSeriesStockRole[],
  missingLegendRoles: readonly ChartSeriesStockRole[],
  missingRenderProjection: boolean,
  missingRenderedPointProjection: boolean,
): string {
  const details: string[] = [];
  if (missingSourceRoles.length > 0) {
    details.push(`missing source roles: ${missingSourceRoles.join(', ')}`);
  }
  if (missingProjectedRoles.length > 0) {
    details.push(`missing rendered stock projection roles: ${missingProjectedRoles.join(', ')}`);
  }
  if (missingLegendRoles.length > 0) {
    details.push(`missing source legend roles: ${missingLegendRoles.join(', ')}`);
  }
  if (missingRenderProjection) details.push('missing stock glyph render projection');
  if (missingRenderedPointProjection) {
    details.push('missing stock rendered-point projection');
  }
  return details.length > 0
    ? `stock source projection is incomplete (${details.join('; ')})`
    : 'stock source projection is incomplete';
}

function hasCompleteStockRenderedPointProjection(
  projection: SeriesProjectionSnapshot['stockRenderProjection'],
  expectedRoles: readonly ChartSeriesStockRole[],
): boolean {
  if (!projection) return false;
  const sourcePointCount = projection.sourcePointCount;
  const renderedPointCount = projection.renderedPointCount;
  const trailingBlankPointCount = projection.trailingBlankPointCount;
  if (
    typeof sourcePointCount !== 'number' ||
    !Number.isInteger(sourcePointCount) ||
    sourcePointCount < 0
  ) {
    return false;
  }
  if (
    typeof renderedPointCount !== 'number' ||
    !Number.isInteger(renderedPointCount) ||
    renderedPointCount < 0
  ) {
    return false;
  }
  if (
    typeof trailingBlankPointCount !== 'number' ||
    !Number.isInteger(trailingBlankPointCount) ||
    trailingBlankPointCount < 0 ||
    trailingBlankPointCount > sourcePointCount
  ) {
    return false;
  }
  if (!Array.isArray(projection.renderedPointIndexes)) return false;
  if (!Array.isArray(projection.droppedPointIndexes)) return false;
  if (!projection.renderedRoleValues || typeof projection.renderedRoleValues !== 'object') {
    return false;
  }
  const renderedRoleValues = projection.renderedRoleValues;
  const rolesToValidate = new Set<ChartSeriesStockRole>([
    ...stockRoleOrder(),
    ...expectedRoles,
  ]);
  for (const role of rolesToValidate) {
    const roleValues = renderedRoleValues[role];
    if (!Array.isArray(roleValues) || roleValues.length !== renderedPointCount) return false;
  }
  if (
    !Array.isArray(projection.renderedCategories) ||
    projection.renderedCategories.length !== renderedPointCount
  ) {
    return false;
  }
  if (projection.renderedPointIndexes.length !== renderedPointCount) return false;
  if (
    projection.renderedPointIndexes.length + projection.droppedPointIndexes.length !==
    sourcePointCount
  ) {
    return false;
  }
  return [...projection.renderedPointIndexes, ...projection.droppedPointIndexes].every(
    (pointIndex) => isProjectionPointIndex(pointIndex, sourcePointCount),
  );
}

function isProjectionPointIndex(pointIndex: unknown, sourcePointCount: number): boolean {
  return (
    Number.isInteger(pointIndex) &&
    typeof pointIndex === 'number' &&
    pointIndex >= 0 &&
    pointIndex < sourcePointCount
  );
}

function chartFamily(config: ChartConfig): string {
  if (config.type === 'bubble3DEffect') return 'bubble';
  if (isSurfaceFamilyConfig(config)) {
    return isSurfaceTopViewConfig(config) ? 'surface' : 'surface3d';
  }
  if (isThreeDBarShapeConfig(config)) return 'bar3d';
  return config.type;
}

function sourceFamilyForChart(
  chart: ChartFloatingObject,
  config: ChartConfig,
  fallback: string,
): string | undefined {
  const extra = recordValue(config.extra);
  const extraFamily = stringValue(extra?.sourceFamily);
  if (extraFamily) return extraFamily;
  const raw = stringValue((chart as { chartType?: unknown }).chartType);
  if (raw) return raw;
  const groupTypes = chartGroupTypesForChart(chart);
  if (groupTypes.length === 1) return groupTypes[0];
  if (groupTypes.length > 1) return 'combo';
  return fallback;
}

function comboNonBarSeriesCount(config: ChartConfig, chartData: ChartData): number {
  if (config.type !== 'combo') return 0;
  let count = 0;
  for (let index = 0; index < chartData.series.length; index += 1) {
    const series = chartData.series[index];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    const seriesType = seriesConfig?.type ?? series.type ?? (index === 0 ? 'column' : 'line');
    if (!isBarLikeChartType(seriesType)) count += 1;
  }
  return count;
}

function isRectangularSpecialtyConfig(config: ChartConfig): boolean {
  switch (config.type) {
    case 'funnel':
    case 'waterfall':
    case 'histogram':
    case 'pareto':
    case 'boxplot':
    case 'treemap':
    case 'sunburst':
    case 'regionMap':
      return true;
    default:
      return false;
  }
}

function preservedOnlyRectangularDiagnostics(config: ChartConfig): string[] {
  switch (config.type) {
    case 'treemap':
      return ['treemap rendering requires hierarchy layout semantics and is preserved as a placeholder'];
    case 'sunburst':
      return ['sunburst rendering requires hierarchy layout semantics and is preserved as a placeholder'];
    case 'regionMap':
      return ['region map rendering uses placeholder geometry'];
    default:
      return [`${config.type} chart family is preserved as a placeholder`];
  }
}

function isThreeDChartConfig(config: ChartConfig): boolean {
  return (
    config.type === 'bar3d' ||
    config.type === 'column3d' ||
    config.type === 'line3d' ||
    config.type === 'pie3d' ||
    config.type === 'pie3dExploded' ||
    config.type === 'area3d' ||
    isThreeDBarShapeConfig(config)
  );
}

function isThreeDBarShapeConfig(config: ChartConfig): boolean {
  switch (config.type) {
    case 'cylinderColClustered':
    case 'cylinderColStacked':
    case 'cylinderColStacked100':
    case 'cylinderBarClustered':
    case 'cylinderBarStacked':
    case 'cylinderBarStacked100':
    case 'cylinderCol':
    case 'coneColClustered':
    case 'coneColStacked':
    case 'coneColStacked100':
    case 'coneBarClustered':
    case 'coneBarStacked':
    case 'coneBarStacked100':
    case 'coneCol':
    case 'pyramidColClustered':
    case 'pyramidColStacked':
    case 'pyramidColStacked100':
    case 'pyramidBarClustered':
    case 'pyramidBarStacked':
    case 'pyramidBarStacked100':
    case 'pyramidCol':
      return true;
    default:
      return false;
  }
}

function hasFiniteSurfaceValues(data: ChartData): boolean {
  return hasFiniteChartValues(data);
}

function hasFiniteChartValues(data: ChartData): boolean {
  return data.series.some((series) =>
    series.data.some(
      (point) =>
        point?.valueState !== 'hidden' &&
        typeof point?.y === 'number' &&
        Number.isFinite(point.y),
    ),
  );
}

function hasPositiveChartValues(data: ChartData): boolean {
  return data.series.some((series) =>
    series.data.some(
      (point) =>
        point?.valueState !== 'hidden' &&
        typeof point?.y === 'number' &&
        Number.isFinite(point.y) &&
        point.y > 0,
    ),
  );
}

function chartGroupTypesForChart(chart: ChartFloatingObject): string[] {
  const groups = (chart as { rt?: { chartGroupsMeta?: unknown } }).rt?.chartGroupsMeta;
  if (!Array.isArray(groups)) return [];
  return Array.from(
    new Set(
      groups
        .map((group) => stringValue(recordValue(group)?.chartType))
        .filter((value): value is string => value !== undefined),
    ),
  );
}

function importStatusToken(status: unknown, key: string): string | undefined {
  if (typeof status !== 'object' || status === null) return undefined;
  const value = (status as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

function importStatusMessages(status: unknown, fallback: string): string[] {
  const messages = new Set<string>();
  if (typeof status === 'object' && status !== null) {
    const direct = (status as { message?: unknown }).message;
    if (typeof direct === 'string' && direct.trim()) messages.add(direct.trim());
    const diagnostics = (status as { diagnostics?: unknown }).diagnostics;
    if (Array.isArray(diagnostics)) {
      for (const diagnostic of diagnostics) {
        const message =
          typeof diagnostic === 'object' && diagnostic !== null
            ? (diagnostic as { message?: unknown }).message
            : undefined;
        if (typeof message === 'string' && message.trim()) messages.add(message.trim());
      }
    }
  }
  messages.add(fallback);
  return Array.from(messages);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
