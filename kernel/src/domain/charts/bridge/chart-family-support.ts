import type { ChartConfig } from '@mog/charts';
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
  legend: LegendSnapshot;
  seriesProjection: SeriesProjectionSnapshot;
}): ChartFamilySupportSnapshot {
  const { chart, config } = input;
  const family = chartFamily(config);
  const sourceFamily = sourceFamilyForChart(chart, family);
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

  if (isImportedChartConfig(config) && isSurfaceFamilyConfig(config)) {
    const diagnostics = surfacePlaceholderDiagnostics(config);
    return {
      schemaVersion: 1,
      family,
      sourceFamily,
      supportLevel: 'preservedPlaceholder',
      reason: isSurfaceTopViewConfig(config)
        ? 'contourProjectionIncomplete'
        : 'surfaceProjectionIncomplete',
      diagnostics,
    };
  }

  if (config.type === 'stock') {
    return stockFamilySupport({ ...input, family, sourceFamily });
  }

  if (config.type === 'bubble' || config.type === 'bubble3DEffect') {
    return bubbleFamilySupport({ ...input, family, sourceFamily });
  }

  if (config.type === 'radar') {
    return {
      schemaVersion: 1,
      family,
      sourceFamily,
      supportLevel: 'approximate',
      reason: 'radarLayoutFidelity',
      diagnostics: [
        'radar layout is rendered with Mog radial geometry and may differ from Excel occupancy',
      ],
      renderedAs: 'radar',
    };
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
  if (support.supportLevel === 'exact') return [];
  return support.diagnostics;
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
  const exact =
    expectedRoles.length > 0 &&
    missingSourceRoles.length === 0 &&
    missingProjectedRoles.length === 0 &&
    missingLegendRoles.length === 0 &&
    input.seriesProjection.stockRenderProjection !== undefined;

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

  const seriesLegend = !input.legend.present || input.legend.entryVocabulary === 'series';
  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: seriesLegend ? 'exact' : 'approximate',
    reason: seriesLegend ? 'exactRenderer' : 'bubbleLegendSeriesDomain',
    diagnostics: seriesLegend
      ? []
      : ['bubble legend uses a point/category domain instead of the source series domain'],
    renderedAs: 'bubble',
  };
}

function expectedStockRoles(
  config: ChartConfig,
  projection: SeriesProjectionSnapshot,
): ChartSeriesStockRole[] {
  switch (config.subType) {
    case 'volume-ohlc':
      return ['volume', 'open', 'high', 'low', 'close'];
    case 'volume-hlc':
      return ['volume', 'high', 'low', 'close'];
    case 'ohlc':
      return ['open', 'high', 'low', 'close'];
    case 'hlc':
      return ['high', 'low', 'close'];
    default:
      break;
  }

  const roles = new Set(
    (projection.sourceSeries ?? [])
      .map((series) => series.stockRole)
      .filter((role): role is ChartSeriesStockRole => role !== undefined),
  );
  const inferred: ChartSeriesStockRole[] = [];
  if (roles.has('volume')) inferred.push('volume');
  if (roles.has('open')) inferred.push('open');
  if (roles.has('high')) inferred.push('high');
  if (roles.has('low')) inferred.push('low');
  if (roles.has('close')) inferred.push('close');
  return inferred.length > 0 ? inferred : ['high', 'low', 'close'];
}

function stockProjectionDiagnostic(
  missingSourceRoles: readonly ChartSeriesStockRole[],
  missingProjectedRoles: readonly ChartSeriesStockRole[],
  missingLegendRoles: readonly ChartSeriesStockRole[],
  missingRenderProjection: boolean,
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
  return details.length > 0
    ? `stock source projection is incomplete (${details.join('; ')})`
    : 'stock source projection is incomplete';
}

function chartFamily(config: ChartConfig): string {
  if (config.type === 'bubble3DEffect') return 'bubble';
  if (isThreeDBarShapeConfig(config)) return 'bar3d';
  return config.type;
}

function sourceFamilyForChart(chart: ChartFloatingObject, fallback: string): string | undefined {
  const raw = (chart as { chartType?: unknown }).chartType;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return fallback;
}

function isImportedChartConfig(config: ChartConfig): boolean {
  if (typeof config.extra !== 'object' || config.extra === null) return false;
  const extra = config.extra as { imported?: unknown; sourceDialect?: unknown };
  return extra.imported === true || typeof extra.sourceDialect === 'string';
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
