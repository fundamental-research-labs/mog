import {
  chartImportSourceDialect,
  expectedStockRolesForSubtype,
  isBarLikeChartType,
  isImportedStandardOoxmlChart,
  seriesConfigForDataSeries,
  stackModeForChartType,
  stockRoleOrder,
  stockSubTypeFromRolePresence,
  type ChartConfig,
  type ChartData,
} from '@mog/charts';
import type {
  ChartFamilyExactAuthoritySnapshot,
  ChartFamilySupportSnapshot,
  ResolvedChartSpecSnapshot,
  ResolvedChartSurfaceApproximationContractKind,
} from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { isNoFillNoLineSeriesConfig } from './chart-render-data-normalizer';
import { importStatusToTerminalRenderStatus } from './import-render-status';
import {
  barShapeDiagnostics,
  isSurfaceFamilyConfig,
  isSurfaceTopViewConfig,
  surfaceApproximationContractForConfig,
  surfaceApproximationDiagnostics,
  surfacePlaceholderDiagnostics,
} from './resolved-spec-diagnostics-surface';
import {
  comboXYVisualContractEvidence,
  standardBubbleFamilySupport,
  standardScatterFamilySupport,
} from './xy-family-support';

type LegendSnapshot = ResolvedChartSpecSnapshot['resolved']['legend'];
type SeriesProjectionSnapshot = ResolvedChartSpecSnapshot['resolved']['seriesProjection'];
type BarGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['barGeometry']
>[number];
type PieDoughnutGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['pieDoughnutGeometry']
>;
type CartesianGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['cartesianGeometry']
>;
type CartesianPointAuthoritySnapshot = NonNullable<
  CartesianGeometrySnapshot['pointAuthority']
>[number];
type CartesianComboAuthoritySnapshot = NonNullable<CartesianGeometrySnapshot['comboAuthority']>;
type RadarProjectionSnapshot = ResolvedChartSpecSnapshot['resolved']['plot']['radarProjection'];
type RadarProjection = NonNullable<RadarProjectionSnapshot>;
type RadarStyleDiagnostics = NonNullable<RadarProjection['styleDiagnostics']>;
type RadarStyleContract = NonNullable<RadarStyleDiagnostics['contracts']>[number];
type ChartSeriesStockRole = NonNullable<
  NonNullable<SeriesProjectionSnapshot['sourceSeries']>[number]['stockRole']
>;

export function buildChartFamilySupportSnapshot(input: {
  chart: ChartFloatingObject;
  config: ChartConfig;
  chartData: ChartData;
  legend: LegendSnapshot;
  seriesProjection: SeriesProjectionSnapshot;
  barGeometry?: BarGeometrySnapshot[];
  pieDoughnutGeometry?: PieDoughnutGeometrySnapshot;
  cartesianGeometry?: CartesianGeometrySnapshot;
  radarProjection?: RadarProjectionSnapshot;
}): ChartFamilySupportSnapshot {
  return enforceImportedExactAuthority({
    config: input.config,
    support: buildRawChartFamilySupportSnapshot(input),
  });
}

function buildRawChartFamilySupportSnapshot(input: {
  chart: ChartFloatingObject;
  config: ChartConfig;
  chartData: ChartData;
  legend: LegendSnapshot;
  seriesProjection: SeriesProjectionSnapshot;
  barGeometry?: BarGeometrySnapshot[];
  pieDoughnutGeometry?: PieDoughnutGeometrySnapshot;
  cartesianGeometry?: CartesianGeometrySnapshot;
  radarProjection?: RadarProjectionSnapshot;
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
    const approximationReason = surfaceApproximationReasonForContract(
      surfaceApproximationContractForConfig(config),
    );
    return {
      schemaVersion: 1,
      family,
      sourceFamily,
      supportLevel: renderable ? 'approximate' : 'preservedPlaceholder',
      reason: renderable
        ? approximationReason
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

  if (config.type === 'scatter') {
    return standardScatterFamilySupport({ ...input, family, sourceFamily });
  }

  if (config.type === 'bubble' || config.type === 'bubble3DEffect') {
    return standardBubbleFamilySupport({ ...input, family, sourceFamily });
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

  if (isStandardBarColumnConfig(config)) {
    return standardBarColumnFamilySupport({ ...input, family, sourceFamily });
  }

  if (isStandardPieDoughnutConfig(config)) {
    return standardPieDoughnutFamilySupport({ ...input, family, sourceFamily });
  }

  if (isImportedStandardPathConfig(config)) {
    return standardPathFamilySupport({ ...input, family, sourceFamily });
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

function enforceImportedExactAuthority(input: {
  config: ChartConfig;
  support: ChartFamilySupportSnapshot;
}): ChartFamilySupportSnapshot {
  if (chartImportSourceDialect(input.config) === undefined) return input.support;
  if (input.support.supportLevel !== 'exact') return input.support;

  const exactAuthority =
    input.support.exactAuthority ?? importedExactAuthorityFor(input.config, input.support);
  if (
    exactAuthority &&
    isImportedPathXyExactAuthorityAdmissible(input.config, input.support, exactAuthority)
  ) {
    return {
      ...input.support,
      exactAuthority,
    };
  }

  const { exactAuthority: _exactAuthority, ...supportWithoutAuthority } = input.support;
  return {
    ...supportWithoutAuthority,
    supportLevel: 'approximate',
    reason: 'importedExactAuthorityMissing',
    diagnostics: uniqueSupportDiagnostics([
      exactAuthority
        ? `imported ${input.support.family} exact support requires image-reconciled exact authority before exact support is trusted`
        : `imported ${input.support.family} exact support requires explicit family exact authority`,
      `attempted exact reason: ${input.support.reason}`,
      ...input.support.diagnostics,
    ]),
  };
}

function exactFamilySupport(input: {
  config: ChartConfig;
  family: string;
  sourceFamily?: string;
  reason: ChartFamilySupportSnapshot['reason'];
  renderedAs: string;
  authorityFamily: ChartFamilyExactAuthoritySnapshot['family'];
  evidence: string[];
  diagnostics?: string[];
  authorityDiagnostics?: string[];
}): ChartFamilySupportSnapshot {
  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: 'exact',
    reason: input.reason,
    diagnostics: input.diagnostics ?? [],
    renderedAs: input.renderedAs,
    exactAuthority: {
      schemaVersion: 1,
      family: input.authorityFamily,
      source:
        chartImportSourceDialect(input.config) === undefined
          ? 'nativeRenderer'
          : 'importedRendererEvidence',
      evidence: input.evidence,
      ...(input.authorityDiagnostics && input.authorityDiagnostics.length > 0
        ? { diagnostics: input.authorityDiagnostics }
        : {}),
    },
  };
}

function uniqueSupportDiagnostics(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

function surfaceApproximationReasonForContract(
  contractKind: ResolvedChartSurfaceApproximationContractKind | undefined,
): ChartFamilySupportSnapshot['reason'] {
  switch (contractKind) {
    case 'surface3dWireframe':
      return 'surface3dWireframeApproximation';
    case 'contourFilled':
      return 'contourFilledApproximation';
    case 'contourWireframe':
      return 'contourWireframeApproximation';
    case 'surface3dFilled':
    default:
      return 'surface3dFilledApproximation';
  }
}

function importedExactAuthorityFor(
  config: ChartConfig,
  support: ChartFamilySupportSnapshot,
): ChartFamilyExactAuthoritySnapshot | undefined {
  if (
    (config.type === 'line' || config.type === 'area') &&
    (support.renderedAs === 'line' || support.renderedAs === 'area')
  ) {
    return importedExactAuthority('path', importedPathExactAuthorityEvidence(support.renderedAs));
  }

  if (config.type === 'scatter' && support.renderedAs === 'scatter') {
    return importedExactAuthority('xy', importedScatterExactAuthorityEvidence());
  }

  if (
    (config.type === 'bubble' || config.type === 'bubble3DEffect') &&
    support.renderedAs === 'bubble'
  ) {
    return importedExactAuthority('bubble', [
      'resolved.plot.cartesianGeometry.geometryStatus',
      'resolved.plot.cartesianGeometry.x.quantitative.axisVisualStatus',
      'resolved.plot.cartesianGeometry.valueAxes.axisVisualStatus',
      'resolved.plot.cartesianGeometry.valueAxes.scaleConsistencyStatus',
      'resolved.plot.cartesianGeometry.bubble.sizeScaleAuthority',
      'resolved.plot.cartesianGeometry.series.bubbleGeometry',
      'resolved.plot.cartesianGeometry.series.bubbleVisualStatus',
      'resolved.plot.cartesianGeometry.series.colorAuthorityStatus',
      'resolved.legend.entryVocabulary',
      'resolved.legend.entryItems',
    ]);
  }

  if (config.type === 'combo' && support.renderedAs === 'combo') {
    return importedExactAuthority('combo', importedComboExactAuthorityEvidence());
  }

  return undefined;
}

function isImportedPathXyExactAuthorityAdmissible(
  config: ChartConfig,
  support: ChartFamilySupportSnapshot,
  exactAuthority: ChartFamilyExactAuthoritySnapshot,
): boolean {
  if (support.supportLevel !== 'exact') return false;
  if (exactAuthority.source !== 'importedRendererEvidence') return false;
  const expectedEvidence = importedPathXyExactAuthorityEvidenceFor(
    config,
    support,
    exactAuthority.family,
  );
  return (
    expectedEvidence !== undefined && sameEvidenceSet(exactAuthority.evidence, expectedEvidence)
  );
}

function importedPathXyExactAuthorityEvidenceFor(
  config: ChartConfig,
  support: ChartFamilySupportSnapshot,
  family: ChartFamilyExactAuthoritySnapshot['family'],
): string[] | undefined {
  if (family === 'path') {
    const renderedFamily = importedPathRenderedFamily(config, support);
    return renderedFamily ? importedPathExactAuthorityEvidence(renderedFamily) : undefined;
  }
  if (family === 'xy' && config.type === 'scatter' && support.renderedAs === 'scatter') {
    return importedScatterExactAuthorityEvidence();
  }
  if (family === 'combo' && config.type === 'combo' && support.renderedAs === 'combo') {
    return importedComboExactAuthorityEvidence();
  }
  return undefined;
}

function importedPathRenderedFamily(
  config: ChartConfig,
  support: ChartFamilySupportSnapshot,
): 'line' | 'area' | undefined {
  if (config.type !== 'line' && config.type !== 'area') return undefined;
  if (support.renderedAs === 'line' || support.renderedAs === 'area') return support.renderedAs;
  return undefined;
}

function sameEvidenceSet(actual: readonly string[], expected: readonly string[]): boolean {
  const actualSet = new Set(actual);
  if (actualSet.size !== actual.length || actualSet.size !== expected.length) return false;
  return expected.every((path) => actualSet.has(path));
}

function importedPathExactAuthorityEvidence(renderedFamily: 'line' | 'area'): string[] {
  const evidence = [
    'resolved.plot.cartesianGeometry.pointAuthority.status',
    'resolved.plot.cartesianGeometry.pointAuthority.plotFrameStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.xAxisStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.valueAxisStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.scaleConsistencyStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.layerOrderStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.pointGeometryStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.styleStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.interpolationStatus',
    'resolved.plot.cartesianGeometry.geometryStatus',
    'resolved.plot.cartesianGeometry.coordinateSystem',
    'resolved.plot.cartesianGeometry.chartWidth',
    'resolved.plot.cartesianGeometry.chartHeight',
    'resolved.plot.cartesianGeometry.plotArea',
    'resolved.plot.cartesianGeometry.pathPlotFrame.reservationStatus',
    'resolved.plot.cartesianGeometry.x.category.pathAxisLayout.axisLayoutStatus',
    'resolved.plot.cartesianGeometry.x.category.pathAxisLayout.categoryPitchStatus',
    'resolved.plot.cartesianGeometry.x.category.pathAxisLayout.categoryTickStatus',
    'resolved.plot.cartesianGeometry.valueAxes.axisVisualStatus',
    'resolved.plot.cartesianGeometry.valueAxes.crossingStatus',
    'resolved.plot.cartesianGeometry.valueAxes.reservationStatus',
    'resolved.plot.cartesianGeometry.valueAxes.valueAxisLayoutStatus',
    'resolved.plot.cartesianGeometry.valueAxes.scaleConsistencyStatus',
    'resolved.plot.cartesianGeometry.layers.xScale.pathAxisLayout.axisLayoutStatus',
    'resolved.plot.cartesianGeometry.layers.xScale.pathAxisLayout.categoryPitchStatus',
    'resolved.plot.cartesianGeometry.layers.xScale.pathAxisLayout.categoryTickStatus',
    'resolved.plot.cartesianGeometry.layers.yScale.valueAxisLayoutStatus',
    'resolved.plot.cartesianGeometry.layers.yScale.scaleConsistencyStatus',
    'resolved.plot.cartesianGeometry.layers.pathOrder',
    'resolved.plot.cartesianGeometry.series.pointGeometry',
    'resolved.plot.cartesianGeometry.series.lineVisualStatus',
    'resolved.plot.cartesianGeometry.series.markerVisualStatus',
    'resolved.plot.cartesianGeometry.series.blankMarkerPolicyStatus',
    'resolved.plot.cartesianGeometry.series.colorAuthorityStatus',
  ];
  if (renderedFamily === 'area') {
    evidence.push(
      'resolved.plot.cartesianGeometry.pointAuthority.areaSurfaceStatus',
      'resolved.plot.cartesianGeometry.series.areaSurfaceStyle.styleStatus',
      'resolved.plot.cartesianGeometry.series.areaSurfaceExtent.extentStatus',
    );
  }
  return evidence;
}

function importedScatterExactAuthorityEvidence(): string[] {
  return [
    'resolved.plot.cartesianGeometry.pointAuthority.status',
    'resolved.plot.cartesianGeometry.pointAuthority.xAxisStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.valueAxisStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.scaleConsistencyStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.layerOrderStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.pointGeometryStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.markerGeometryStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.markerGlyphStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.styleStatus',
    'resolved.plot.cartesianGeometry.pointAuthority.interpolationStatus',
    'resolved.plot.cartesianGeometry.geometryStatus',
    'resolved.plot.cartesianGeometry.coordinateSystem',
    'resolved.plot.cartesianGeometry.chartWidth',
    'resolved.plot.cartesianGeometry.chartHeight',
    'resolved.plot.cartesianGeometry.plotArea',
    'resolved.plot.cartesianGeometry.x.quantitative.domain',
    'resolved.plot.cartesianGeometry.x.quantitative.tickValues',
    'resolved.plot.cartesianGeometry.x.quantitative.tickStep',
    'resolved.plot.cartesianGeometry.x.quantitative.range',
    'resolved.plot.cartesianGeometry.x.quantitative.plotRange',
    'resolved.plot.cartesianGeometry.x.quantitative.axisVisualStatus',
    'resolved.plot.cartesianGeometry.x.quantitative.crossingStatus',
    'resolved.plot.cartesianGeometry.x.quantitative.reservationStatus',
    'resolved.plot.cartesianGeometry.valueAxes.domain',
    'resolved.plot.cartesianGeometry.valueAxes.tickValues',
    'resolved.plot.cartesianGeometry.valueAxes.tickStep',
    'resolved.plot.cartesianGeometry.valueAxes.range',
    'resolved.plot.cartesianGeometry.valueAxes.plotRange',
    'resolved.plot.cartesianGeometry.valueAxes.axisVisualStatus',
    'resolved.plot.cartesianGeometry.valueAxes.crossingStatus',
    'resolved.plot.cartesianGeometry.valueAxes.reservationStatus',
    'resolved.plot.cartesianGeometry.valueAxes.scaleConsistencyStatus',
    'resolved.plot.cartesianGeometry.layers.xScale.domain',
    'resolved.plot.cartesianGeometry.layers.xScale.range',
    'resolved.plot.cartesianGeometry.layers.yScale.domain',
    'resolved.plot.cartesianGeometry.layers.yScale.range',
    'resolved.plot.cartesianGeometry.layers.pathOrder',
    'resolved.plot.cartesianGeometry.series.pointGeometry',
    'resolved.plot.cartesianGeometry.series.markerGeometry',
    'resolved.plot.cartesianGeometry.series.lineVisualStatus',
    'resolved.plot.cartesianGeometry.series.markerVisualStatus',
    'resolved.plot.cartesianGeometry.series.colorAuthorityStatus',
  ];
}

function importedComboExactAuthorityEvidence(): string[] {
  return [
    'resolved.plot.cartesianGeometry.comboAuthority.status',
    'resolved.plot.cartesianGeometry.comboAuthority.plotFrameStatus',
    'resolved.plot.cartesianGeometry.comboAuthority.barGeometryStatus',
    'resolved.plot.cartesianGeometry.comboAuthority.nonBarPointAuthorityStatus',
    'resolved.plot.cartesianGeometry.comboAuthority.axisOwnershipStatus',
    'resolved.plot.cartesianGeometry.comboAuthority.valueAxisStatus',
    'resolved.plot.cartesianGeometry.comboAuthority.scaleConsistencyStatus',
    'resolved.plot.cartesianGeometry.comboAuthority.layerOrderStatus',
    'resolved.plot.cartesianGeometry.comboAuthority.legendOrderStatus',
    'resolved.plot.cartesianGeometry.comboAuthority.styleStatus',
    'resolved.plot.cartesianGeometry.comboAuthority.barSeriesIndices',
    'resolved.plot.cartesianGeometry.comboAuthority.nonBarSeriesIndices',
    'resolved.plot.cartesianGeometry.comboAuthority.layerIndices',
    'resolved.plot.barGeometry.geometryStatus',
    'resolved.plot.barGeometry.traceStatus',
    'resolved.plot.barGeometry.rectangleReconciliation.status',
    'resolved.plot.cartesianGeometry.geometryStatus',
    'resolved.plot.cartesianGeometry.coordinateSystem',
    'resolved.plot.cartesianGeometry.plotArea',
    'resolved.plot.cartesianGeometry.valueAxes.axisVisualStatus',
    'resolved.plot.cartesianGeometry.valueAxes.crossingStatus',
    'resolved.plot.cartesianGeometry.valueAxes.reservationStatus',
    'resolved.plot.cartesianGeometry.valueAxes.valueAxisLayoutStatus',
    'resolved.plot.cartesianGeometry.layers',
    'resolved.plot.cartesianGeometry.series.pointGeometry',
  ];
}

function importedExactAuthority(
  family: ChartFamilyExactAuthoritySnapshot['family'],
  evidence: string[],
): ChartFamilyExactAuthoritySnapshot {
  return {
    schemaVersion: 1,
    family,
    source: 'importedRendererEvidence',
    evidence,
  };
}

function standardPathFamilySupport(input: {
  config: ChartConfig;
  chartData: ChartData;
  legend: LegendSnapshot;
  family: string;
  sourceFamily?: string;
  cartesianGeometry?: CartesianGeometrySnapshot;
}): ChartFamilySupportSnapshot {
  const seriesIndices = standardVisiblePathSeriesIndices(input.config, input.chartData);
  const pathEvidence = pathCartesianGeometryEvidence(input.cartesianGeometry, seriesIndices);
  if (pathEvidence) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: pathEvidence.reason,
      diagnostics: pathEvidence.diagnostics,
      renderedAs: input.config.type,
    };
  }

  const areaEvidence =
    input.config.type === 'area'
      ? areaSurfaceStyleEvidence(input.cartesianGeometry, seriesIndices)
      : undefined;
  if (areaEvidence) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: areaEvidence.reason,
      diagnostics: areaEvidence.diagnostics,
      renderedAs: input.config.type,
    };
  }

  const areaExtentEvidence =
    input.config.type === 'area'
      ? areaSurfaceExtentEvidence(input.cartesianGeometry, seriesIndices)
      : undefined;
  if (areaExtentEvidence) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: areaExtentEvidence.reason,
      diagnostics: areaExtentEvidence.diagnostics,
      renderedAs: input.config.type,
    };
  }

  const legendEvidence =
    pathLegendRenderEvidence(input.legend) ?? pathLegendOrderEvidence(input.config, input.legend);
  if (legendEvidence) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: legendEvidence.reason,
      diagnostics: legendEvidence.diagnostics,
      renderedAs: input.config.type,
    };
  }

  const visualEvidence = pathVisualContractEvidence(input.cartesianGeometry, seriesIndices);
  if (visualEvidence) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: visualEvidence.reason,
      diagnostics: visualEvidence.diagnostics,
      renderedAs: input.config.type,
    };
  }

  const pointAuthorityEvidence = pathPointAuthorityEvidence(input.cartesianGeometry);
  if (pointAuthorityEvidence) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: pointAuthorityEvidence.reason,
      diagnostics: pointAuthorityEvidence.diagnostics,
      renderedAs: input.config.type,
    };
  }

  return exactFamilySupport({
    config: input.config,
    family: input.family,
    sourceFamily: input.sourceFamily,
    reason: 'standardRenderer',
    renderedAs: input.config.type,
    authorityFamily: 'path',
    evidence: importedPathExactAuthorityEvidence(input.config.type === 'area' ? 'area' : 'line'),
  });
}

function pathPointAuthorityEvidence(cartesianGeometry: CartesianGeometrySnapshot | undefined):
  | {
      reason: Extract<ChartFamilySupportSnapshot['reason'], 'pathPointAuthorityIncomplete'>;
      diagnostics: string[];
    }
  | undefined {
  const authority = cartesianPointAuthority(cartesianGeometry, 'path');
  if (isExactOrVerifiedDefaultStatus(authority?.status)) return undefined;
  return {
    reason: 'pathPointAuthorityIncomplete',
    diagnostics: pointAuthorityDiagnostics('path', authority),
  };
}

function cartesianPointAuthority(
  cartesianGeometry: CartesianGeometrySnapshot | undefined,
  family: CartesianPointAuthoritySnapshot['family'],
): CartesianPointAuthoritySnapshot | undefined {
  return cartesianGeometry?.pointAuthority?.find((authority) => authority.family === family);
}

function pointAuthorityDiagnostics(
  family: CartesianPointAuthoritySnapshot['family'],
  authority: CartesianPointAuthoritySnapshot | undefined,
): string[] {
  if (!authority) {
    return [`imported ${family} exactness requires resolved cartesian point authority evidence`];
  }
  if (authority.diagnostics.length > 0) return authority.diagnostics;
  return [
    `imported ${family} point authority is ${authority.status}; reason=${authority.statusReason ?? 'missing'}`,
  ];
}

type PieDoughnutStatusKey =
  | 'arcFrameStatus'
  | 'radiusStatus'
  | 'legendLayoutStatus'
  | 'labelLayoutStatus'
  | 'explosionLayoutStatus'
  | 'styleFootprintStatus'
  | 'sliceStyleStatus'
  | 'ringBandStatus'
  | 'holeSizeStatus'
  | 'ringOrderStatus';

type PieDoughnutStatusReasonKey =
  | 'arcFrameStatusReason'
  | 'radiusStatusReason'
  | 'legendLayoutStatusReason'
  | 'labelLayoutStatusReason'
  | 'explosionLayoutStatusReason'
  | 'styleFootprintStatusReason'
  | 'sliceStyleStatusReason'
  | 'ringBandStatusReason'
  | 'holeSizeStatusReason'
  | 'ringOrderStatusReason';

const PIE_DOUGHNUT_STATUS_FIELDS: Array<{
  key: PieDoughnutStatusKey;
  reasonKey: PieDoughnutStatusReasonKey;
  label: string;
}> = [
  { key: 'arcFrameStatus', reasonKey: 'arcFrameStatusReason', label: 'arc frame' },
  { key: 'radiusStatus', reasonKey: 'radiusStatusReason', label: 'radius/center' },
  { key: 'legendLayoutStatus', reasonKey: 'legendLayoutStatusReason', label: 'legend flow' },
  { key: 'labelLayoutStatus', reasonKey: 'labelLayoutStatusReason', label: 'data-label bounds' },
  {
    key: 'explosionLayoutStatus',
    reasonKey: 'explosionLayoutStatusReason',
    label: 'explosion envelope',
  },
  {
    key: 'styleFootprintStatus',
    reasonKey: 'styleFootprintStatusReason',
    label: 'style footprint',
  },
  { key: 'sliceStyleStatus', reasonKey: 'sliceStyleStatusReason', label: 'slice style' },
  { key: 'ringBandStatus', reasonKey: 'ringBandStatusReason', label: 'ring bands' },
  { key: 'holeSizeStatus', reasonKey: 'holeSizeStatusReason', label: 'hole size' },
  { key: 'ringOrderStatus', reasonKey: 'ringOrderStatusReason', label: 'ring order' },
];

function standardPieDoughnutFamilySupport(input: {
  config: ChartConfig;
  family: string;
  sourceFamily?: string;
  pieDoughnutGeometry?: PieDoughnutGeometrySnapshot;
}): ChartFamilySupportSnapshot {
  const geometry = input.pieDoughnutGeometry;
  if (!geometry || hasMissingPieDoughnutGeometryEvidence(geometry)) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: 'pieDoughnutGeometryEvidenceMissing',
      diagnostics: [pieDoughnutGeometryEvidenceDiagnostic(geometry)],
      renderedAs: input.config.type,
    };
  }

  if (isApproximatePieDoughnutGeometry(geometry)) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: 'pieDoughnutGeometryApproximation',
      diagnostics: [pieDoughnutGeometryApproximationDiagnostic(geometry)],
      renderedAs: input.config.type,
    };
  }

  return exactFamilySupport({
    config: input.config,
    family: input.family,
    sourceFamily: input.sourceFamily,
    reason: 'standardRenderer',
    renderedAs: input.config.type,
    authorityFamily: 'pieDoughnut',
    evidence: [
      'resolved.plot.pieDoughnutGeometry.geometryStatus',
      'resolved.plot.pieDoughnutGeometry.arcFrameStatus',
      'resolved.plot.pieDoughnutGeometry.radiusStatus',
      'resolved.plot.pieDoughnutGeometry.legendLayoutStatus',
      'resolved.plot.pieDoughnutGeometry.labelLayoutStatus',
      'resolved.plot.pieDoughnutGeometry.explosionLayoutStatus',
      'resolved.plot.pieDoughnutGeometry.styleFootprintStatus',
      'resolved.plot.pieDoughnutGeometry.sliceStyleStatus',
      'resolved.plot.pieDoughnutGeometry.ringBandStatus',
      'resolved.plot.pieDoughnutGeometry.holeSizeStatus',
      'resolved.plot.pieDoughnutGeometry.ringOrderStatus',
      'resolved.plot.pieDoughnutGeometry.legendFlow',
      'resolved.plot.pieDoughnutGeometry.labelLayout',
      'resolved.plot.pieDoughnutGeometry.explosionEnvelope',
      'resolved.plot.pieDoughnutGeometry.styleFootprint',
      'resolved.plot.pieDoughnutGeometry.rings',
    ],
  });
}

function hasMissingPieDoughnutGeometryEvidence(geometry: PieDoughnutGeometrySnapshot): boolean {
  if (geometry.geometryStatus !== 'available') return true;
  if (!isFinitePositive(geometry.radius) || !isFiniteNumber(geometry.centerX)) return true;
  if (!isFiniteNumber(geometry.centerY) || !isFinitePositive(geometry.arcBox.width)) return true;
  if (!isFinitePositive(geometry.arcBox.height) || geometry.ringCount <= 0) return true;
  if (geometry.rings.length === 0) return true;
  if (!geometry.legendFlow || !geometry.labelLayout) return true;
  if (!geometry.explosionEnvelope || !geometry.styleFootprint) return true;
  return PIE_DOUGHNUT_STATUS_FIELDS.some(({ key }) => geometry[key] === undefined);
}

function isApproximatePieDoughnutGeometry(geometry: PieDoughnutGeometrySnapshot): boolean {
  return PIE_DOUGHNUT_STATUS_FIELDS.some(
    ({ key }) => !isExactOrVerifiedDefaultStatus(geometry[key]),
  );
}

function pieDoughnutGeometryEvidenceDiagnostic(
  geometry: PieDoughnutGeometrySnapshot | undefined,
): string {
  if (!geometry) return 'pie/doughnut renderer did not expose resolved visual geometry';
  return [
    'pie/doughnut visual geometry is missing exactness evidence',
    pieDoughnutGeometryDiagnosticDetails(geometry).join('; '),
  ].join('; ');
}

function pieDoughnutGeometryApproximationDiagnostic(geometry: PieDoughnutGeometrySnapshot): string {
  return [
    'pie/doughnut visual geometry is approximate',
    pieDoughnutGeometryDiagnosticDetails(geometry).join('; '),
  ].join('; ');
}

function pieDoughnutGeometryDiagnosticDetails(geometry: PieDoughnutGeometrySnapshot): string[] {
  const details = [
    `family=${geometry.family}`,
    `layoutAuthority=${geometry.layoutAuthority ?? 'missing'}`,
    `geometryStatus=${geometry.geometryStatus}`,
    `ringCount=${geometry.ringCount}`,
    `radius=${
      Number.isFinite(geometry.radius) ? roundDiagnosticNumber(geometry.radius) : 'missing'
    }`,
  ];
  for (const field of PIE_DOUGHNUT_STATUS_FIELDS) {
    const status = geometry[field.key] ?? 'missing';
    const reason = geometry[field.reasonKey];
    details.push(`${field.label}=${status}${reason ? `(${reason})` : ''}`);
  }
  details.push(`legend flow evidence=${geometry.legendFlow?.status ?? 'missing'}`);
  details.push(`label layout evidence=${geometry.labelLayout?.status ?? 'missing'}`);
  details.push(`explosion envelope evidence=${geometry.explosionEnvelope?.status ?? 'missing'}`);
  details.push(`style footprint evidence=${geometry.styleFootprint?.status ?? 'missing'}`);
  if (geometry.styleFootprint?.styleContextStatus) {
    const reason = geometry.styleFootprint.styleContextReason;
    details.push(
      `style context=${geometry.styleFootprint.styleContextStatus}${reason ? `(${reason})` : ''}`,
    );
  }
  if (geometry.styleFootprint?.unmodeledOwnerKeys?.length) {
    details.push(`unmodeled style owners=${geometry.styleFootprint.unmodeledOwnerKeys.join(',')}`);
  }
  if (geometry.manualArcInsetProfile) {
    const status = geometry.manualArcInsetStatus ?? 'missing';
    const reason = geometry.manualArcInsetStatusReason;
    details.push(
      `manual arc inset=${status}(${geometry.manualArcInsetProfile}${reason ? `:${reason}` : ''})`,
    );
  }
  return details;
}

function standardBarColumnFamilySupport(input: {
  config: ChartConfig;
  family: string;
  sourceFamily?: string;
  barGeometry?: readonly BarGeometrySnapshot[];
}): ChartFamilySupportSnapshot {
  const geometry = input.barGeometry ?? [];
  if (geometry.length === 0) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: 'barColumnGeometryEvidenceMissing',
      diagnostics: ['bar/column renderer did not expose a resolved geometry group'],
      renderedAs: input.config.type,
    };
  }

  const missingEvidence = geometry.filter(hasMissingBarColumnGeometryEvidence);
  if (missingEvidence.length > 0) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: 'barColumnGeometryEvidenceMissing',
      diagnostics: missingEvidence.map(barColumnGeometryEvidenceDiagnostic),
      renderedAs: input.config.type,
    };
  }

  const approximate = geometry.filter(isApproximateBarColumnGeometry);
  if (approximate.length > 0) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: 'barColumnGeometryApproximation',
      diagnostics: approximate.map(barColumnGeometryApproximationDiagnostic),
      renderedAs: input.config.type,
    };
  }

  if (chartImportSourceDialect(input.config) !== undefined) {
    const missingReconciliation = geometry.filter(hasMissingBarColumnRectangleReconciliation);
    if (missingReconciliation.length > 0) {
      return {
        schemaVersion: 1,
        family: input.family,
        sourceFamily: input.sourceFamily,
        supportLevel: 'approximate',
        reason: 'barColumnRectangleReconciliationMissing',
        diagnostics: missingReconciliation.map(barColumnRectangleReconciliationDiagnostic),
        renderedAs: input.config.type,
      };
    }

    const mismatchedReconciliation = geometry.filter(hasMismatchedBarColumnRectangleReconciliation);
    if (mismatchedReconciliation.length > 0) {
      return {
        schemaVersion: 1,
        family: input.family,
        sourceFamily: input.sourceFamily,
        supportLevel: 'approximate',
        reason: 'barColumnRectangleReconciliationMismatch',
        diagnostics: mismatchedReconciliation.map(barColumnRectangleReconciliationDiagnostic),
        renderedAs: input.config.type,
      };
    }
  }

  return exactFamilySupport({
    config: input.config,
    family: input.family,
    sourceFamily: input.sourceFamily,
    reason: 'standardRenderer',
    renderedAs: input.config.type,
    authorityFamily: 'barColumn',
    evidence: barColumnExactAuthorityEvidence(chartImportSourceDialect(input.config) !== undefined),
  });
}

function barColumnExactAuthorityEvidence(imported: boolean): string[] {
  return [
    'resolved.plot.barGeometry.geometryStatus',
    'resolved.plot.barGeometry.axisLayoutStatus',
    'resolved.plot.barGeometry.categoryPitchStatus',
    'resolved.plot.barGeometry.categoryTickStatus',
    'resolved.plot.barGeometry.valueAxisScaleStatus',
    'resolved.plot.barGeometry.traceStatus',
    'resolved.plot.barGeometry.traceRectangleCount',
    'resolved.plot.barGeometry.rectangles',
    ...(imported
      ? [
          'resolved.plot.barGeometry.rectangleReconciliation.status',
          'resolved.plot.barGeometry.rectangleReconciliation.excelPlotArea',
          'resolved.plot.barGeometry.rectangleReconciliation.mogPlotArea',
          'resolved.plot.barGeometry.rectangleReconciliation.maxRectangleDelta',
        ]
      : []),
  ];
}

function hasMissingBarColumnGeometryEvidence(group: BarGeometrySnapshot): boolean {
  if (isApproximateBarColumnGeometry(group)) return false;
  if (
    group.geometryStatus === undefined ||
    group.axisLayoutStatus === undefined ||
    group.categoryPitchStatus === undefined ||
    group.categoryTickStatus === undefined ||
    group.valueAxisScaleStatus === undefined
  ) {
    return true;
  }
  if (
    group.traceStatus === undefined ||
    group.traceRectangleCount === undefined ||
    group.traceStatus !== 'available' ||
    group.traceRectangleCount <= 0 ||
    !group.rectangles ||
    group.rectangles.length === 0
  ) {
    return true;
  }
  if (
    group.categoryAxisLength === undefined ||
    group.visibleCategoryCount === undefined ||
    group.categoryPitch === undefined ||
    group.barSize === undefined ||
    group.baselineValue === undefined ||
    !group.offsets ||
    group.offsets.length !== group.seriesIndices.length
  ) {
    return true;
  }
  return !(
    isExactOrVerifiedDefaultStatus(group.geometryStatus) &&
    isExactOrVerifiedDefaultStatus(group.axisLayoutStatus) &&
    isExactOrVerifiedDefaultStatus(group.categoryPitchStatus) &&
    isExactOrVerifiedDefaultStatus(group.categoryTickStatus) &&
    isExactOrVerifiedDefaultStatus(group.valueAxisScaleStatus)
  );
}

function isApproximateBarColumnGeometry(group: BarGeometrySnapshot): boolean {
  return (
    group.geometryStatus === 'approximate' ||
    group.axisLayoutStatus === 'approximate' ||
    group.categoryPitchStatus === 'approximate' ||
    group.categoryTickStatus === 'approximate' ||
    group.valueAxisScaleStatus === 'approximate' ||
    group.traceStatus === 'mismatch' ||
    group.traceStatus === 'unavailable' ||
    group.categoryPitchStatusReason !== undefined ||
    group.categoryTickStatusReason !== undefined ||
    group.valueAxisScaleStatusReason !== undefined ||
    group.axisLayoutStatusReason !== undefined ||
    group.geometryStatusReason !== undefined ||
    group.traceStatusReason !== undefined
  );
}

function hasMissingBarColumnRectangleReconciliation(group: BarGeometrySnapshot): boolean {
  return (
    !group.rectangleReconciliation ||
    group.rectangleReconciliation.status === 'missing' ||
    group.rectangleReconciliation.rectangleCount <= 0
  );
}

function hasMismatchedBarColumnRectangleReconciliation(group: BarGeometrySnapshot): boolean {
  return group.rectangleReconciliation?.status === 'approximate';
}

function isExactOrVerifiedDefaultStatus(status: string | undefined): boolean {
  return status === 'exact' || status === 'verifiedDefault';
}

function barColumnGeometryEvidenceDiagnostic(group: BarGeometrySnapshot): string {
  return [
    `bar/column geometry group "${barColumnGeometryGroupKey(group)}" is missing exactness evidence`,
    barColumnGeometryDiagnosticDetails(group).join('; '),
  ].join('; ');
}

function barColumnGeometryApproximationDiagnostic(group: BarGeometrySnapshot): string {
  const details = barColumnGeometryDiagnosticDetails(group);
  if (group.axisLayoutStatusReason) {
    details.push(`axisLayoutStatusReason=${group.axisLayoutStatusReason}`);
  }
  if (group.categoryPitchStatusReason) {
    details.push(`categoryPitchStatusReason=${group.categoryPitchStatusReason}`);
  }
  if (group.categoryTickStatusReason) {
    details.push(`categoryTickStatusReason=${group.categoryTickStatusReason}`);
  }
  if (group.valueAxisScaleStatusReason) {
    details.push(`valueAxisScaleStatusReason=${group.valueAxisScaleStatusReason}`);
  }
  if (group.geometryStatusReason) {
    details.push(`geometryStatusReason=${group.geometryStatusReason}`);
  }
  if (group.traceStatusReason) {
    details.push(`traceStatusReason=${group.traceStatusReason}`);
  }
  return [
    `bar/column geometry group "${barColumnGeometryGroupKey(group)}" is approximate`,
    details.join('; '),
  ].join('; ');
}

function barColumnGeometryTraceDiagnostic(group: BarGeometrySnapshot): string {
  return [
    `bar/column geometry group "${barColumnGeometryGroupKey(group)}" has trace evidence`,
    barColumnGeometryDiagnosticDetails(group).join('; '),
  ].join('; ');
}

function barColumnRectangleReconciliationDiagnostic(group: BarGeometrySnapshot): string {
  const reconciliation = group.rectangleReconciliation;
  return [
    `bar/column geometry group "${barColumnGeometryGroupKey(group)}" is missing exact Excel rectangle reconciliation`,
    ...barColumnGeometryDiagnosticDetails(group),
    `rectangleReconciliationStatus=${reconciliation?.status ?? 'missing'}`,
    `rectangleReconciliationReason=${reconciliation?.statusReason ?? 'missing'}`,
    `rectangleReconciliationAuthority=${reconciliation?.authority ?? 'missing'}`,
    `rectangleCount=${reconciliation?.rectangleCount ?? 'missing'}`,
    `matchedRectangleCount=${reconciliation?.matchedRectangleCount ?? 'missing'}`,
    `maxRectangleDelta=${formatOptionalDiagnosticNumber(reconciliation?.maxRectangleDelta)}`,
  ].join('; ');
}

function barColumnGeometryDiagnosticDetails(group: BarGeometrySnapshot): string[] {
  return [
    `orientation=${group.orientation ?? 'missing'}`,
    `grouping=${group.grouping ?? 'missing'}`,
    `plotAreaSource=${group.plotAreaSource ?? 'missing'}`,
    `plotAreaAuthority=${group.plotAreaAuthority ?? 'missing'}`,
    `categoryPitchAuthority=${group.categoryPitchAuthority ?? 'missing'}`,
    `categoryPitchStatus=${group.categoryPitchStatus ?? 'missing'}`,
    `categoryTickStatus=${group.categoryTickStatus ?? 'missing'}`,
    `valueAxisScaleSource=${group.valueAxisScaleSource ?? 'missing'}`,
    `valueAxisScaleStatus=${group.valueAxisScaleStatus ?? 'missing'}`,
    `geometryStatus=${group.geometryStatus ?? 'missing'}`,
    `axisLayoutStatus=${group.axisLayoutStatus ?? 'missing'}`,
    `traceStatus=${group.traceStatus ?? 'missing'}`,
    `traceRectangleCount=${group.traceRectangleCount ?? 'missing'}`,
    `categoryPitch=${formatOptionalDiagnosticNumber(group.categoryPitch)}`,
    `barSize=${formatOptionalDiagnosticNumber(group.barSize)}`,
  ];
}

function barColumnGeometryGroupKey(group: BarGeometrySnapshot): string {
  return group.groupKey ?? `series:${group.seriesIndices.join(',') || 'unknown'}`;
}

export function familySupportCompilerDiagnostics(support: ChartFamilySupportSnapshot): string[] {
  if (support.supportLevel === 'exact' || support.supportLevel === 'approximate') return [];
  return support.diagnostics;
}

function comboFamilySupport(input: {
  config: ChartConfig;
  chartData: ChartData;
  family: string;
  sourceFamily?: string;
  legend: LegendSnapshot;
  barGeometry?: readonly BarGeometrySnapshot[];
  cartesianGeometry?: CartesianGeometrySnapshot;
}): ChartFamilySupportSnapshot {
  const importedStandardOoxml = isImportedStandardOoxmlChart(input.config);
  const barGroups = input.barGeometry ?? [];
  const visibleBarSeriesIndices = comboVisibleSeriesIndices(input.config, input.chartData, 'bar');
  const visibleNonBarSeriesIndices = comboVisibleSeriesIndices(
    input.config,
    input.chartData,
    'nonBar',
  );
  const visiblePathSeriesIndices = comboVisiblePathSeriesIndices(input.config, input.chartData);
  const visibleAreaSeriesIndices = comboVisibleAreaSeriesIndices(input.config, input.chartData);
  const diagnostics: string[] = [];
  if (barGroups.length > 0) {
    diagnostics.push(
      `combo renderer resolved ${barGroups.length} bar geometry group(s) for layer-aware rendering`,
    );
  }
  if (visibleNonBarSeriesIndices.length > 0) {
    diagnostics.push(
      `combo renderer keeps ${visibleNonBarSeriesIndices.length} non-bar series separate from bar slot geometry`,
    );
  }
  if (barGroups.some((group) => group.yAxisIndex === 1)) {
    diagnostics.push('combo renderer preserves secondary value-axis ownership for bar groups');
  }
  if (visibleBarSeriesIndices.length > 0 && barGroups.length === 0) {
    return comboApproximateSupport(input, {
      reason: 'comboLayeredGeometryEvidenceMissing',
      diagnostics: [
        ...diagnostics,
        `combo renderer did not expose resolved bar geometry for visible bar series ${visibleBarSeriesIndices.join(', ')}`,
      ],
    });
  }

  const missingBarEvidence = barGroups.filter(hasMissingBarColumnGeometryEvidence);
  if (missingBarEvidence.length > 0) {
    return comboApproximateSupport(input, {
      reason: 'comboLayeredGeometryEvidenceMissing',
      diagnostics: [...diagnostics, ...missingBarEvidence.map(barColumnGeometryEvidenceDiagnostic)],
    });
  }

  const approximateBarGeometry = barGroups.filter(isApproximateBarColumnGeometry);
  if (approximateBarGeometry.length > 0) {
    return comboApproximateSupport(input, {
      reason: 'comboLayeredGeometryApproximation',
      diagnostics: [
        ...diagnostics,
        ...approximateBarGeometry.map(barColumnGeometryApproximationDiagnostic),
      ],
    });
  }

  if (importedStandardOoxml && visibleNonBarSeriesIndices.length > 0) {
    const pathEvidence =
      visiblePathSeriesIndices.length > 0
        ? pathCartesianGeometryEvidence(input.cartesianGeometry, visiblePathSeriesIndices)
        : undefined;
    if (pathEvidence) {
      return comboApproximateSupport(input, {
        reason: pathEvidence.reason,
        diagnostics: [...diagnostics, ...pathEvidence.diagnostics],
      });
    }

    const areaEvidence =
      visibleAreaSeriesIndices.length > 0
        ? areaSurfaceStyleEvidence(input.cartesianGeometry, visibleAreaSeriesIndices)
        : undefined;
    if (areaEvidence) {
      return comboApproximateSupport(input, {
        reason: areaEvidence.reason,
        diagnostics: [...diagnostics, ...areaEvidence.diagnostics],
      });
    }

    const areaExtentEvidence =
      visibleAreaSeriesIndices.length > 0
        ? areaSurfaceExtentEvidence(input.cartesianGeometry, visibleAreaSeriesIndices)
        : undefined;
    if (areaExtentEvidence) {
      return comboApproximateSupport(input, {
        reason: areaExtentEvidence.reason,
        diagnostics: [...diagnostics, ...areaExtentEvidence.diagnostics],
      });
    }

    const secondaryAxisEvidence = comboSecondaryUnitPercentAxisEvidence(
      input.config,
      input.chartData,
      input.cartesianGeometry,
    );
    if (secondaryAxisEvidence) {
      return comboApproximateSupport(input, {
        reason: secondaryAxisEvidence.reason,
        diagnostics: [...diagnostics, ...secondaryAxisEvidence.diagnostics],
      });
    }

    const legendEvidence =
      visiblePathSeriesIndices.length > 0
        ? (pathLegendRenderEvidence(input.legend) ??
          pathLegendOrderEvidence(input.config, input.legend))
        : undefined;
    if (legendEvidence) {
      return comboApproximateSupport(input, {
        reason: legendEvidence.reason,
        diagnostics: [...diagnostics, ...legendEvidence.diagnostics],
      });
    }

    const pathVisualEvidence = pathVisualContractEvidence(
      input.cartesianGeometry,
      visiblePathSeriesIndices,
    );
    if (pathVisualEvidence) {
      return comboApproximateSupport(input, {
        reason: pathVisualEvidence.reason,
        diagnostics: [...diagnostics, ...pathVisualEvidence.diagnostics],
      });
    }

    const xyEvidence = comboXYVisualContractEvidence({
      config: input.config,
      chartData: input.chartData,
      legend: input.legend,
      cartesianGeometry: input.cartesianGeometry,
    });
    if (xyEvidence) {
      return {
        schemaVersion: 1,
        family: input.family,
        sourceFamily: input.sourceFamily,
        supportLevel: 'approximate',
        reason: xyEvidence.reason,
        diagnostics: [...diagnostics, ...xyEvidence.diagnostics],
        renderedAs: 'combo',
      };
    }

    const nonBarEvidence = comboNonBarLayerGeometryEvidence(
      input.cartesianGeometry,
      visibleNonBarSeriesIndices,
    );
    if (nonBarEvidence) {
      return comboApproximateSupport(input, {
        reason: nonBarEvidence.reason,
        diagnostics: [...diagnostics, ...nonBarEvidence.diagnostics],
      });
    }
  }

  if (importedStandardOoxml) {
    const comboAuthorityEvidence = comboLayerAuthorityEvidence(input.cartesianGeometry);
    if (comboAuthorityEvidence) {
      return comboApproximateSupport(input, {
        reason: comboAuthorityEvidence.reason,
        diagnostics: [...diagnostics, ...comboAuthorityEvidence.diagnostics],
      });
    }

    return exactFamilySupport({
      config: input.config,
      family: input.family,
      sourceFamily: input.sourceFamily,
      reason: 'comboLayeredRenderer',
      diagnostics,
      renderedAs: 'combo',
      authorityFamily: 'combo',
      evidence: importedComboExactAuthorityEvidence(),
    });
  }

  return exactFamilySupport({
    config: input.config,
    family: input.family,
    sourceFamily: input.sourceFamily,
    reason: 'comboLayeredRenderer',
    diagnostics,
    renderedAs: 'combo',
    authorityFamily: 'combo',
    evidence: [
      'resolved.plot.barGeometry.geometryStatus',
      'resolved.plot.barGeometry.traceStatus',
      'resolved.plot.cartesianGeometry.geometryStatus',
      'resolved.plot.cartesianGeometry.x.category.pathAxisLayout',
      'resolved.plot.cartesianGeometry.pathPlotFrame.reservationStatus',
      'resolved.plot.cartesianGeometry.valueAxes.valueAxisLayoutStatus',
      'resolved.plot.cartesianGeometry.valueAxes.scaleConsistencyStatus',
      'resolved.plot.cartesianGeometry.layers',
      'resolved.plot.cartesianGeometry.series.pointGeometry',
      'resolved.plot.cartesianGeometry.series.lineVisualStatus',
      'resolved.plot.cartesianGeometry.series.markerVisualStatus',
      'resolved.plot.cartesianGeometry.series.bubbleVisualStatus',
      'resolved.plot.cartesianGeometry.series.colorAuthorityStatus',
      'resolved.legend.rendered.entries',
    ],
  });
}

function comboApproximateSupport(
  input: {
    family: string;
    sourceFamily?: string;
  },
  options: {
    reason: Extract<
      ChartFamilySupportSnapshot['reason'],
      | 'comboLayeredGeometryApproximation'
      | 'comboLayeredGeometryEvidenceMissing'
      | 'comboLayerAuthorityIncomplete'
      | 'pathCartesianGeometryApproximation'
      | 'pathCartesianGeometryEvidenceMissing'
      | 'pathAxisReservationApproximation'
      | 'pathPlotFrameReservationApproximation'
      | 'pathPlotFrameEvidenceMissing'
      | 'pathAxisCrossingApproximation'
      | 'pathAxisVisualContractIncomplete'
      | 'pathLegendRenderMismatch'
      | 'pathLegendOrderMismatch'
      | 'pathValueScalePlanTraceMismatch'
      | 'pathLineVisualContractIncomplete'
      | 'pathMarkerVisualContractIncomplete'
      | 'pathColorAuthorityIncomplete'
      | 'pathBlankMarkerPolicyIncomplete'
      | 'areaSurfaceStyleEvidenceMissing'
      | 'areaSurfaceStyleApproximation'
      | 'areaSurfaceExtentEvidenceMissing'
      | 'areaSurfaceExtentApproximation'
      | 'comboSecondaryAxisPolicyApproximation'
    >;
    diagnostics: string[];
  },
): ChartFamilySupportSnapshot {
  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: 'approximate',
    reason: options.reason,
    diagnostics: options.diagnostics,
    renderedAs: 'combo',
  };
}

function radarFamilySupport(input: {
  config: ChartConfig;
  family: string;
  sourceFamily?: string;
  radarProjection?: RadarProjectionSnapshot;
}): ChartFamilySupportSnapshot {
  const markers = input.config.radarMarkers === true || input.config.subType === 'markers';
  const filled = input.config.radarFilled === true || input.config.subType === 'filled';
  const fidelity = radarSupportFidelity(input.radarProjection, { filled, markers });
  const diagnostics = fidelity.map((item) => `${item.reason}:${item.status}`);
  if (!input.radarProjection) diagnostics.push('radarProjectionMetadata:unknown');
  const incomplete = fidelity.find((item) => item.status !== 'exact');

  if (
    !incomplete &&
    input.radarProjection &&
    chartImportSourceDialect(input.config) === undefined
  ) {
    return exactFamilySupport({
      config: input.config,
      family: input.family,
      sourceFamily: input.sourceFamily,
      reason: 'exactRenderer',
      renderedAs: 'radar',
      authorityFamily: 'radar',
      evidence: [
        'resolved.plot.radarProjection.blankPolicyAuthority',
        'resolved.plot.radarProjection.styleDiagnostics.autoValueScaleFidelity',
        'resolved.plot.radarProjection.styleDiagnostics.fillStyleFidelity',
        'resolved.plot.radarProjection.styleDiagnostics.markerStyleFidelity',
        'resolved.plot.radarProjection.styleDiagnostics.strokeStyleFidelity',
        'resolved.plot.radarProjection.styleDiagnostics.gridLabelStyleFidelity',
        'resolved.plot.radarProjection.styleDiagnostics.contracts',
        'resolved.plot.radarProjection.styleDiagnostics.contracts.fidelity',
        'resolved.plot.radarProjection.styleDiagnostics.contracts.sourceAuthority',
      ],
    });
  }

  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: 'approximate',
    reason: incomplete?.reason ?? 'radarDeterministicApproximation',
    diagnostics:
      incomplete || chartImportSourceDialect(input.config) === undefined
        ? diagnostics
        : [
            ...diagnostics,
            'imported radar exactness requires image-reconciled polar layout and style authority',
          ],
    renderedAs: 'radar',
  };
}

function radarSupportFidelity(
  projection: RadarProjectionSnapshot | undefined,
  options: { filled: boolean; markers: boolean },
): Array<{
  reason: Extract<
    ChartFamilySupportSnapshot['reason'],
    | 'radarAutoValueScaleFidelity'
    | 'radarBlankPolicyFidelity'
    | 'radarFillStyleFidelity'
    | 'radarMarkerStyleFidelity'
    | 'radarStrokeStyleFidelity'
    | 'radarGridLabelStyleFidelity'
  >;
  status: 'exact' | 'deterministicApproximation' | 'unknown';
}> {
  const style = projection?.styleDiagnostics;
  return [
    {
      reason: 'radarAutoValueScaleFidelity',
      status: radarLegacyFidelityStatus(style?.autoValueScaleFidelity),
    },
    {
      reason: 'radarBlankPolicyFidelity',
      status: radarBlankPolicyFidelityStatus(projection),
    },
    {
      reason: 'radarFillStyleFidelity',
      status: options.filled
        ? radarStyleContractStatus(style, ['fill'], style?.fillStyleFidelity)
        : 'exact',
    },
    {
      reason: 'radarMarkerStyleFidelity',
      status: options.markers
        ? radarStyleContractStatus(style, ['marker'], style?.markerStyleFidelity)
        : 'exact',
    },
    {
      reason: 'radarStrokeStyleFidelity',
      status: radarStyleContractStatus(style, ['stroke'], style?.strokeStyleFidelity),
    },
    {
      reason: 'radarGridLabelStyleFidelity',
      status: radarStyleContractStatus(
        style,
        ['grid', 'spokes', 'categoryLabels', 'valueLabels'],
        style?.gridLabelStyleFidelity,
      ),
    },
  ];
}

function radarBlankPolicyFidelityStatus(
  projection: RadarProjectionSnapshot,
): 'exact' | 'deterministicApproximation' | 'unknown' {
  if (!projection) return 'unknown';
  if (projection.blankPolicyAuthority === 'explicit') {
    return projection.displayBlanksAs === projection.blankPolicy ? 'exact' : 'unknown';
  }
  if (projection.blankPolicyAuthority === 'excelDefault') {
    return projection.displayBlanksAs === undefined ? 'exact' : 'unknown';
  }
  if (projection.blankPolicyAuthority === 'chartCacheLiveSourceBlank') {
    const evidence = projection.renderedBlankProjectionEvidence ?? [];
    return projection.displayBlanksAs === undefined &&
      evidence.length > 0 &&
      evidence.every((item) => item.cacheValue === 0)
      ? 'exact'
      : 'unknown';
  }
  return 'unknown';
}

function radarLegacyFidelityStatus(
  fidelity: 'exact' | 'approximate' | 'unknown' | undefined,
): 'exact' | 'deterministicApproximation' | 'unknown' {
  if (fidelity === 'exact') return 'exact';
  if (fidelity === 'approximate') return 'deterministicApproximation';
  return 'unknown';
}

function radarStyleContractStatus(
  style: RadarStyleDiagnostics | undefined,
  categories: readonly RadarStyleContract['category'][],
  legacyFidelity: 'exact' | 'approximate' | 'unknown' | undefined,
): 'exact' | 'deterministicApproximation' | 'unknown' {
  if (!style) return 'unknown';
  const contracts = radarContractsFor(style, categories);
  if (contracts.length !== categories.length) {
    return 'unknown';
  }
  if (
    legacyFidelity === 'unknown' ||
    contracts.some((contract) => contract.requiresHumanReview || contract.fidelity === 'unknown')
  ) {
    return 'unknown';
  }
  if (contracts.every((contract) => contract.fidelity === 'exact') && legacyFidelity === 'exact') {
    return contracts.every((contract) => radarStyleContractHasExactAuthority(contract))
      ? 'exact'
      : 'deterministicApproximation';
  }
  return 'deterministicApproximation';
}

function radarStyleContractHasExactAuthority(contract: RadarStyleContract): boolean {
  return (
    contract.sourceAuthority === 'imported' ||
    contract.sourceAuthority === 'excelDefault' ||
    contract.sourceAuthority === 'notApplicable'
  );
}

function radarContractsFor(
  style: RadarStyleDiagnostics,
  categories: readonly RadarStyleContract['category'][],
): RadarStyleContract[] {
  const contracts = style.contracts ?? [];
  return categories
    .map((category) => contracts.find((contract) => contract.category === category))
    .filter((contract): contract is RadarStyleContract => contract !== undefined);
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
        reason: renderable ? 'funnelProportionalBarApproximation' : 'funnelProjectionIncomplete',
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
        incompleteDiagnostic:
          'pareto chart needs finite values for sorted bars and cumulative line',
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
  const diagnostics = [
    '3-D chart rendering is approximate',
    'exact 3-D support requires Excel-authoritative projected face geometry, occlusion order, lighting/shading, and wall/floor pixel authority',
  ];
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
  const legendEntryRoles = new Set(
    (input.legend.entryItems ?? [])
      .map((entry) => entry.stockRole)
      .filter((role): role is ChartSeriesStockRole => role !== undefined),
  );
  const missingSourceRoles = expectedRoles.filter((role) => !sourceRoles.has(role));
  const missingProjectedRoles = expectedRoles.filter((role) => !projectedRoles.has(role));
  const legendRequiresSourceRoles =
    input.legend.present && input.legend.visible !== false && expectedRoles.length > 0;
  const missingLegendRoles = legendRequiresSourceRoles
    ? expectedRoles.filter((role) => !legendEntryRoles.has(role))
    : [];
  const visibleLegendNotRendered =
    legendRequiresSourceRoles &&
    visibleLegendRoles.size > 0 &&
    input.legend.rendered?.visible !== true;
  const renderedPointProjectionComplete = hasCompleteStockRenderedPointProjection(
    input.seriesProjection.stockRenderProjection,
    expectedRoles,
  );
  const geometryProjectionComplete = hasCompleteStockGeometryProjection(
    input.seriesProjection.stockRenderProjection,
  );
  const visualProjectionComplete = hasCompleteStockVisualProjection(
    input.seriesProjection.stockRenderProjection,
    expectedRoles,
  );
  const structuralComplete =
    expectedRoles.length > 0 &&
    missingSourceRoles.length === 0 &&
    missingProjectedRoles.length === 0 &&
    missingLegendRoles.length === 0 &&
    !visibleLegendNotRendered &&
    input.seriesProjection.stockRenderProjection !== undefined &&
    renderedPointProjectionComplete &&
    geometryProjectionComplete &&
    visualProjectionComplete;
  const exactEvidence = stockExactEvidenceStatus(
    input.seriesProjection.stockRenderProjection,
    expectedRoles,
  );
  const exact = structuralComplete && exactEvidence.complete;
  const structuralDiagnostic = stockProjectionDiagnostic(
    missingSourceRoles,
    missingProjectedRoles,
    missingLegendRoles,
    visibleLegendNotRendered,
    input.seriesProjection.stockRenderProjection === undefined,
    !renderedPointProjectionComplete,
    !geometryProjectionComplete,
    !visualProjectionComplete,
  );
  const reason: ChartFamilySupportSnapshot['reason'] = exact
    ? 'exactRenderer'
    : !visualProjectionComplete || visibleLegendNotRendered
      ? 'stockGlyphVisualContractIncomplete'
      : !structuralComplete
        ? 'stockSourceProjectionIncomplete'
        : 'stockExactEvidenceIncomplete';

  if (exact) {
    return exactFamilySupport({
      config: input.config,
      family: input.family,
      sourceFamily: input.sourceFamily,
      reason,
      renderedAs: 'stock',
      authorityFamily: 'stock',
      evidence: [
        'resolved.seriesProjection.sourceSeries.stockRole',
        'resolved.seriesProjection.projectedRoleMappings.stockRole',
        'resolved.seriesProjection.stockRenderProjection',
        'resolved.seriesProjection.stockRenderProjection.stockSourceComposition.sourceRoleOrder',
        'resolved.seriesProjection.stockRenderProjection.sourceRoleSemanticStatus',
        'resolved.seriesProjection.stockRenderProjection.renderedRoleValues',
        'resolved.seriesProjection.stockRenderProjection.renderedCategories',
        'resolved.seriesProjection.stockRenderProjection.visual',
        'resolved.seriesProjection.stockRenderProjection.visual.sourceRoleVisuals.lineVisualStatus',
        'resolved.seriesProjection.stockRenderProjection.visual.sourceRoleVisuals.markerVisualStatus',
        'resolved.seriesProjection.stockRenderProjection.visual.sourceRoleVisuals.colorAuthorityStatus',
        'resolved.seriesProjection.stockRenderProjection.sourceRoleVisuals.lineVisualStatus',
        'resolved.seriesProjection.stockRenderProjection.sourceRoleVisuals.markerVisualStatus',
        'resolved.seriesProjection.stockRenderProjection.sourceRoleVisuals.colorAuthorityStatus',
        'resolved.seriesProjection.stockRenderProjection.priceScale',
        'resolved.seriesProjection.stockRenderProjection.priceScale.scaleAuthorityStatus',
        ...(expectedRoles.includes('volume')
          ? [
              'resolved.seriesProjection.stockRenderProjection.volumeScale',
              'resolved.seriesProjection.stockRenderProjection.volumeSurface',
            ]
          : []),
      ],
    });
  }

  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: 'approximate',
    reason,
    diagnostics: [
      ...(!structuralComplete ? [structuralDiagnostic] : []),
      ...exactEvidence.diagnostics,
    ],
    renderedAs: 'stock',
  };
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
  visibleLegendNotRendered: boolean,
  missingRenderProjection: boolean,
  missingRenderedPointProjection: boolean,
  missingGeometryProjection: boolean,
  missingVisualProjection: boolean,
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
  if (visibleLegendNotRendered) details.push('visible stock source legend was not rendered');
  if (missingRenderProjection) details.push('missing stock glyph render projection');
  if (missingRenderedPointProjection) {
    details.push('missing stock rendered-point projection');
  }
  if (missingGeometryProjection) details.push('missing stock glyph geometry projection');
  if (missingVisualProjection) details.push('missing stock glyph visual projection');
  return details.length > 0
    ? `stock source projection is incomplete (${details.join('; ')})`
    : 'stock source projection is incomplete';
}

function stockExactEvidenceStatus(
  projection: SeriesProjectionSnapshot['stockRenderProjection'],
  expectedRoles: readonly ChartSeriesStockRole[],
): { complete: boolean; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (!projection) {
    return {
      complete: false,
      diagnostics: ['stock exact evidence is incomplete (missing stock render projection)'],
    };
  }

  if (!isExactOrVerifiedDefaultStatus(projection.sourceRoleSemanticStatus)) {
    diagnostics.push(
      `source role semantics are ${projection.sourceRoleSemanticStatus ?? 'missing'}; source=${
        projection.sourceRoleSemanticSource ?? 'missing'
      }; reason=${projection.sourceRoleSemanticReason ?? 'missing'}`,
    );
  }

  const visuals = projection.sourceRoleVisuals ?? projection.visual?.sourceRoleVisuals;
  const visualByRole = new Map((visuals ?? []).map((visual) => [visual.role, visual]));
  for (const role of expectedRoles) {
    const visual = visualByRole.get(role);
    if (!visual) {
      diagnostics.push(`source role ${role} visual evidence is missing`);
      continue;
    }
    if (!isExactOrVerifiedDefaultStatus(visual.lineVisualStatus)) {
      diagnostics.push(
        `source role ${role} line visual contract is ${
          visual.lineVisualStatus ?? 'missing'
        }; reason=${visual.lineVisualStatusReason ?? 'missing'}`,
      );
    }
    if (!isExactOrVerifiedDefaultStatus(visual.markerVisualStatus)) {
      diagnostics.push(
        `source role ${role} marker visual contract is ${
          visual.markerVisualStatus ?? 'missing'
        }; reason=${visual.markerVisualStatusReason ?? 'missing'}`,
      );
    }
    if (!isAcceptedStockSourceRoleColorAuthority(visual)) {
      diagnostics.push(
        `source role ${role} color authority is ${
          visual.colorAuthorityStatus ?? 'missing'
        }; source=${visual.colorAuthoritySource ?? 'missing'}; reason=${
          visual.colorAuthorityReason ?? 'missing'
        }`,
      );
    }
  }

  if (expectedRoles.includes('volume') && projection.volumeAxisPolicy === 'separateVolumeAxis') {
    const volumeVisual = projection.visual?.volume;
    if (!isExactOrVerifiedDefaultStatus(volumeVisual?.visualStatus)) {
      diagnostics.push(
        `stock volume visual authority is ${
          volumeVisual?.visualStatus ?? 'missing'
        }; reason=${volumeVisual?.visualStatusReason ?? 'missing'}`,
      );
    }
  }

  const priceScale = projection.priceScale;
  if (!isExactOrVerifiedDefaultStatus(priceScale?.scaleAuthorityStatus)) {
    diagnostics.push(
      `stock price scale authority is ${
        priceScale?.scaleAuthorityStatus ?? 'missing'
      }; authority=${priceScale?.scaleAuthority ?? 'missing'}; reason=${
        priceScale?.scaleAuthorityReason ?? 'missing'
      }; zeroBaseline=${priceScale?.zeroBaselinePolicy ?? 'missing'}`,
    );
  }

  return {
    complete: diagnostics.length === 0,
    diagnostics: diagnostics.map(
      (diagnostic) => `stock exact evidence is incomplete (${diagnostic})`,
    ),
  };
}

function isAcceptedStockSourceRoleColorAuthority(visual: {
  colorAuthorityStatus?: string;
  colorAuthoritySource?: string;
}): boolean {
  if (visual.colorAuthorityStatus === 'exact') {
    return isResolvedStockColorAuthoritySource(visual.colorAuthoritySource);
  }
  if (visual.colorAuthorityStatus === 'verifiedDefault') {
    return visual.colorAuthoritySource === 'excelStockRoleDefault';
  }
  return false;
}

function isResolvedStockColorAuthoritySource(source: string | undefined): boolean {
  return source !== undefined && source !== 'defaultPalette' && source !== 'unknown';
}

function hasCompleteStockVisualProjection(
  projection: SeriesProjectionSnapshot['stockRenderProjection'],
  expectedRoles: readonly ChartSeriesStockRole[],
): boolean {
  if (!projection?.visual) return false;
  const visual = projection.visual;
  if (projection.visualStatus !== 'available' || visual.visualStatus !== 'available') return false;
  if (!projection.stockSourceComposition) return false;
  if (!projection.volumeAxisPolicy) return false;
  if (projection.stockSourceComposition.volumeAxisPolicy !== projection.volumeAxisPolicy) {
    return false;
  }
  if (!projection.highLowEndpointPolicy?.roles?.length) return false;
  if (!projection.priceGlyphMode || projection.priceGlyphMode !== visual.priceGlyphMode) {
    return false;
  }
  if (!isFiniteNonNegative(projection.gapWidth)) return false;
  if (!isFinitePositive(projection.slotOccupancy)) return false;
  if (!isFinitePositive(visual.slotOccupancy)) return false;
  if (!isCompleteStockStrokeVisual(visual.highLowLine)) return false;
  if (visual.priceGlyphMode === 'upDownBody') {
    if (!isCompleteStockBodyVisual(visual.upBody)) return false;
    if (!isCompleteStockBodyVisual(visual.downBody)) return false;
    if (!isCompleteStockBodyVisual(visual.flatBody)) return false;
  } else {
    if (expectedRoles.includes('open') && !isCompleteStockStrokeVisual(visual.openTick)) {
      return false;
    }
    if (!isCompleteStockStrokeVisual(visual.closeTick)) return false;
  }
  if (!hasCompleteStockSourceRoleVisuals(projection, expectedRoles)) return false;
  if (expectedRoles.includes('volume') && !hasCompleteStockVolumeProjection(projection)) {
    return false;
  }
  return true;
}

function hasCompleteStockVolumeProjection(
  projection: SeriesProjectionSnapshot['stockRenderProjection'],
): boolean {
  if (!projection?.visual) return false;
  if (projection.volumeAxisPolicy === 'stockValueAxis') {
    return !projection.visual.volume;
  }
  if (projection.volumeAxisPolicy !== 'separateVolumeAxis') return false;
  const volume = projection.visual.volume;
  return (
    isCompleteStockVolumeVisual(volume) &&
    isExactOrVerifiedDefaultStatus(volume.visualStatus) &&
    isFinitePositive(projection.volumeBarWidth) &&
    hasCompleteStockVolumeScaleEvidence(projection.volumeScale) &&
    hasCompleteStockVolumeSurface(projection.volumeSurface)
  );
}

function isCompleteStockVolumeVisual(visual: unknown): visual is {
  fill: string;
  border: string;
  borderWidth: number;
  visualStatus?: string;
  gapWidth: number;
  slotOccupancy: number;
  surfacePolicy: { type: 'plotFraction'; fraction: number };
} {
  const candidate = visual as
    | {
        gapWidth?: unknown;
        slotOccupancy?: unknown;
        surfacePolicy?: { type?: unknown; fraction?: unknown };
      }
    | undefined;
  const surfacePolicy = candidate?.surfacePolicy;
  return (
    isCompleteStockBodyVisual(visual) &&
    isFiniteNonNegative(candidate?.gapWidth) &&
    isFinitePositive(candidate?.slotOccupancy) &&
    surfacePolicy?.type === 'plotFraction' &&
    isFinitePositive(surfacePolicy.fraction)
  );
}

function hasCompleteStockVolumeScaleEvidence(scale: unknown): boolean {
  const candidate = scale as { domain?: unknown; range?: unknown } | undefined;
  return (
    Array.isArray(candidate?.domain) &&
    candidate.domain.length === 2 &&
    candidate.domain.every(isFiniteNumber) &&
    Array.isArray(candidate.range) &&
    candidate.range.length === 2 &&
    candidate.range.every(isFiniteNumber)
  );
}

function hasCompleteStockVolumeSurface(surface: unknown): boolean {
  const candidate = surface as
    | {
        x?: unknown;
        y?: unknown;
        width?: unknown;
        height?: unknown;
        plotX?: unknown;
        plotY?: unknown;
        plotWidth?: unknown;
        plotHeight?: unknown;
      }
    | undefined;
  return (
    isFiniteNumber(candidate?.x) &&
    isFiniteNumber(candidate?.y) &&
    isFinitePositive(candidate?.width) &&
    isFinitePositive(candidate?.height) &&
    isFiniteNumber(candidate?.plotX) &&
    isFiniteNumber(candidate?.plotY) &&
    isFinitePositive(candidate?.plotWidth) &&
    isFinitePositive(candidate?.plotHeight)
  );
}

function hasCompleteStockSourceRoleVisuals(
  projection: SeriesProjectionSnapshot['stockRenderProjection'],
  expectedRoles: readonly ChartSeriesStockRole[],
): boolean {
  const visuals = projection?.sourceRoleVisuals ?? projection?.visual?.sourceRoleVisuals;
  if (!Array.isArray(visuals) || visuals.length === 0) return false;
  const byRole = new Map(visuals.map((visual) => [visual.role, visual]));
  let expectedLineLayerCount = 0;
  let expectedMarkerLayerCount = 0;
  for (const role of expectedRoles) {
    const visual = byRole.get(role);
    if (!visual) return false;
    if (!isCompleteStockStrokeVisual(visual.line)) return false;
    if (!isCompleteStockMarkerVisual(visual.marker)) return false;
    const usesPriceOverlay = role !== 'volume' || projection?.volumeAxisPolicy === 'stockValueAxis';
    if (usesPriceOverlay) {
      if (visual.layerMode !== 'overlayLayer') return false;
      if (visual.lineVisible) expectedLineLayerCount += 1;
      if (visual.markerVisible) expectedMarkerLayerCount += 1;
    } else if (visual.layerMode !== 'glyphInputOnly') {
      return false;
    }
  }
  return (
    projection?.sourceRoleLineLayerCount === expectedLineLayerCount &&
    projection?.sourceRoleMarkerLayerCount === expectedMarkerLayerCount
  );
}

function isCompleteStockStrokeVisual(visual: unknown): visual is {
  stroke: string;
  strokeWidth: number;
} {
  const candidate = visual as { stroke?: unknown; strokeWidth?: unknown } | undefined;
  return (
    typeof candidate?.stroke === 'string' &&
    candidate.stroke.length > 0 &&
    typeof candidate.strokeWidth === 'number' &&
    Number.isFinite(candidate.strokeWidth) &&
    candidate.strokeWidth > 0
  );
}

function isCompleteStockBodyVisual(visual: unknown): visual is {
  fill: string;
  border: string;
  borderWidth: number;
} {
  const candidate = visual as
    | { fill?: unknown; border?: unknown; borderWidth?: unknown }
    | undefined;
  return (
    typeof candidate?.fill === 'string' &&
    candidate.fill.length > 0 &&
    typeof candidate.border === 'string' &&
    candidate.border.length > 0 &&
    typeof candidate.borderWidth === 'number' &&
    Number.isFinite(candidate.borderWidth) &&
    candidate.borderWidth >= 0
  );
}

function isCompleteStockMarkerVisual(visual: unknown): visual is {
  fill: string;
  stroke: string;
  strokeWidth: number;
  shape: string;
  size: number;
} {
  const candidate = visual as
    | {
        fill?: unknown;
        stroke?: unknown;
        strokeWidth?: unknown;
        shape?: unknown;
        size?: unknown;
      }
    | undefined;
  return (
    typeof candidate?.fill === 'string' &&
    candidate.fill.length > 0 &&
    typeof candidate.stroke === 'string' &&
    candidate.stroke.length > 0 &&
    typeof candidate.strokeWidth === 'number' &&
    Number.isFinite(candidate.strokeWidth) &&
    candidate.strokeWidth >= 0 &&
    typeof candidate.shape === 'string' &&
    candidate.shape.length > 0 &&
    typeof candidate.size === 'number' &&
    Number.isFinite(candidate.size) &&
    candidate.size > 0
  );
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function roundDiagnosticNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function formatOptionalDiagnosticNumber(value: number | undefined): number | 'missing' {
  return typeof value === 'number' && Number.isFinite(value)
    ? roundDiagnosticNumber(value)
    : 'missing';
}

function hasCompleteStockGeometryProjection(
  projection: SeriesProjectionSnapshot['stockRenderProjection'],
): boolean {
  if (!projection) return false;
  return (
    projection.geometryStatus === 'available' &&
    typeof projection.geometryPointCount === 'number' &&
    projection.geometryPointCount === projection.renderedPointCount &&
    isFinitePositive(projection.glyphWidth) &&
    isFinitePositive(projection.tickLength) &&
    hasCompleteStockPriceScaleEvidence(projection.priceScale)
  );
}

function hasCompleteStockPriceScaleEvidence(
  scale: NonNullable<SeriesProjectionSnapshot['stockRenderProjection']>['priceScale'],
): boolean {
  const candidate = scale as
    | { domain?: unknown; tickStep?: unknown; tickValues?: unknown }
    | undefined;
  return (
    Array.isArray(candidate?.domain) &&
    candidate.domain.length === 2 &&
    candidate.domain.every(isFiniteNumber) &&
    isFinitePositive(candidate.tickStep)
  );
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
  const rolesToValidate = new Set<ChartSeriesStockRole>([...stockRoleOrder(), ...expectedRoles]);
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

type ComboVisibleSeriesRole = 'bar' | 'nonBar';

function comboVisibleSeriesIndices(
  config: ChartConfig,
  chartData: ChartData,
  role: ComboVisibleSeriesRole,
): number[] {
  if (config.type !== 'combo') return [];
  const indices: number[] = [];
  for (let index = 0; index < chartData.series.length; index += 1) {
    const series = chartData.series[index];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    if (isNoFillNoLineSeriesConfig(seriesConfig)) continue;
    const seriesType = seriesConfig?.type ?? series.type ?? (index === 0 ? 'column' : 'line');
    const barSeries = isBarLikeChartType(seriesType);
    if ((role === 'bar' && barSeries) || (role === 'nonBar' && !barSeries)) {
      indices.push(index);
    }
  }
  return indices;
}

function comboVisiblePathSeriesIndices(config: ChartConfig, chartData: ChartData): number[] {
  if (config.type !== 'combo') return [];
  const indices: number[] = [];
  for (let index = 0; index < chartData.series.length; index += 1) {
    const series = chartData.series[index];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    if (isNoFillNoLineSeriesConfig(seriesConfig)) continue;
    const seriesType = seriesConfig?.type ?? series.type ?? (index === 0 ? 'column' : 'line');
    if (seriesType === 'line' || seriesType === 'area') indices.push(index);
  }
  return indices;
}

function comboVisibleAreaSeriesIndices(config: ChartConfig, chartData: ChartData): number[] {
  if (config.type !== 'combo') return [];
  const indices: number[] = [];
  for (let index = 0; index < chartData.series.length; index += 1) {
    const series = chartData.series[index];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    if (isNoFillNoLineSeriesConfig(seriesConfig)) continue;
    const seriesType = seriesConfig?.type ?? series.type ?? (index === 0 ? 'column' : 'line');
    if (seriesType === 'area') indices.push(index);
  }
  return indices;
}

function comboSecondaryPathSeriesIndices(config: ChartConfig, chartData: ChartData): number[] {
  if (config.type !== 'combo') return [];
  const indices: number[] = [];
  for (let index = 0; index < chartData.series.length; index += 1) {
    const series = chartData.series[index];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    if (isNoFillNoLineSeriesConfig(seriesConfig)) continue;
    const yAxisIndex = seriesConfig?.yAxisIndex ?? series.yAxisIndex;
    if (yAxisIndex !== 1) continue;
    const seriesType = seriesConfig?.type ?? series.type ?? (index === 0 ? 'column' : 'line');
    if (isPathSeriesType(seriesType)) indices.push(index);
  }
  return indices;
}

function isPathSeriesType(type: string | undefined): boolean {
  return (
    type === 'line' ||
    type === 'lineMarkers' ||
    type === 'lineMarkersStacked' ||
    type === 'lineMarkersStacked100' ||
    type === 'area'
  );
}

function standardVisiblePathSeriesIndices(config: ChartConfig, chartData: ChartData): number[] {
  return chartData.series.flatMap((_series, index) => {
    const seriesConfig = seriesConfigForDataSeries(
      chartData.series[index],
      config.series ?? [],
      index,
    );
    return isNoFillNoLineSeriesConfig(seriesConfig) ? [] : [index];
  });
}

function isImportedStandardPathConfig(config: ChartConfig): boolean {
  return isImportedStandardOoxmlChart(config) && (config.type === 'line' || config.type === 'area');
}

function pathCartesianGeometryEvidence(
  cartesianGeometry: CartesianGeometrySnapshot | undefined,
  seriesIndices: readonly number[],
):
  | {
      reason: Extract<
        ChartFamilySupportSnapshot['reason'],
        | 'pathCartesianGeometryApproximation'
        | 'pathCartesianGeometryEvidenceMissing'
        | 'pathAxisReservationApproximation'
        | 'pathPlotFrameReservationApproximation'
        | 'pathPlotFrameEvidenceMissing'
        | 'pathAxisCrossingApproximation'
        | 'pathAxisVisualContractIncomplete'
        | 'pathValueScalePlanTraceMismatch'
      >;
      diagnostics: string[];
    }
  | undefined {
  if (seriesIndices.length === 0) return undefined;

  if (!cartesianGeometry) {
    return {
      reason: 'pathCartesianGeometryEvidenceMissing',
      diagnostics: [
        `path renderer did not expose cartesian geometry for series ${seriesIndices.join(', ')}`,
      ],
    };
  }
  if (cartesianGeometry.geometryStatus !== 'available') {
    return {
      reason: 'pathCartesianGeometryEvidenceMissing',
      diagnostics: [
        `path cartesian geometry is ${cartesianGeometry.geometryStatus ?? 'missing'} for series ${seriesIndices.join(', ')}`,
      ],
    };
  }

  const pathAxisLayout = cartesianGeometry.x.category?.pathAxisLayout;
  if (!pathAxisLayout) {
    return {
      reason: 'pathCartesianGeometryEvidenceMissing',
      diagnostics: ['path cartesian geometry is missing rendered category-axis layout evidence'],
    };
  }
  if (!cartesianGeometry.pathPlotFrame) {
    return {
      reason: 'pathPlotFrameEvidenceMissing',
      diagnostics: ['path cartesian geometry is missing plot-frame reservation evidence'],
    };
  }

  const mismatchedAxis = cartesianGeometry.valueAxes.find(
    (axis) => axis.scaleConsistencyStatus === 'planTraceMismatch',
  );
  if (mismatchedAxis) {
    return {
      reason: 'pathValueScalePlanTraceMismatch',
      diagnostics: [
        `path value-axis ${mismatchedAxis.axisGroup} rendered scale differs from plan; reason=${mismatchedAxis.scaleConsistencyReason ?? 'missing'}`,
      ],
    };
  }

  const valueAxisEvidence = pathValueAxisVisualContractEvidence(cartesianGeometry, seriesIndices);
  if (valueAxisEvidence) return valueAxisEvidence;

  const categoryStatus = pathAxisLayout.categoryAxisLayoutStatus ?? pathAxisLayout.axisLayoutStatus;
  if (!isExactOrVerifiedDefaultStatus(categoryStatus)) {
    return {
      reason: 'pathCartesianGeometryApproximation',
      diagnostics: [
        `path category-axis layout is ${categoryStatus ?? 'missing'}; reason=${pathAxisLayout.categoryAxisLayoutStatusReason ?? pathAxisLayout.axisLayoutStatusReason ?? 'missing'}`,
      ],
    };
  }
  const reservationStatus =
    cartesianGeometry.pathPlotFrame.reservationStatus ??
    pathAxisLayout.reservationStatus ??
    categoryStatus;
  const reservationStatusReason =
    cartesianGeometry.pathPlotFrame.reservationStatusReason ??
    pathAxisLayout.reservationStatusReason ??
    pathAxisLayout.categoryAxisLayoutStatusReason ??
    pathAxisLayout.axisLayoutStatusReason;
  if (!isExactOrVerifiedDefaultStatus(reservationStatus)) {
    return {
      reason: 'pathPlotFrameReservationApproximation',
      diagnostics: [
        `path plot-frame reservation is ${reservationStatus ?? 'missing'}; reason=${reservationStatusReason ?? 'missing'}`,
      ],
    };
  }

  const layerScaleEvidence = pathLayerScaleEvidence(cartesianGeometry, seriesIndices);
  if (layerScaleEvidence) return layerScaleEvidence;

  const missingSeries = seriesIndices.filter(
    (seriesIndex) => !hasComboNonBarPointGeometry(cartesianGeometry, seriesIndex),
  );
  if (missingSeries.length > 0) {
    return {
      reason: 'pathCartesianGeometryEvidenceMissing',
      diagnostics: [
        `path cartesian geometry is missing point evidence for series ${missingSeries.join(', ')}`,
      ],
    };
  }

  const nonSourcePathLayers =
    cartesianGeometry.layers?.filter(
      (layer) =>
        (layer.layerRole === 'linePath' || layer.layerRole === 'areaFill') &&
        layer.seriesIndices.some((seriesIndex) => seriesIndices.includes(seriesIndex)) &&
        layer.pathOrder !== 'source',
    ) ?? [];
  if (nonSourcePathLayers.length > 0) {
    return {
      reason: 'pathCartesianGeometryApproximation',
      diagnostics: [
        `path layers ${nonSourcePathLayers.map((layer) => layer.layerIndex).join(', ')} do not preserve source path order`,
      ],
    };
  }

  return undefined;
}

function pathValueAxisVisualContractEvidence(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
):
  | {
      reason: Extract<ChartFamilySupportSnapshot['reason'], 'pathAxisVisualContractIncomplete'>;
      diagnostics: string[];
    }
  | undefined {
  const diagnostics: string[] = [];
  for (const axisGroup of pathValueAxisGroupsForSeries(cartesianGeometry, seriesIndices)) {
    const axis = cartesianGeometry.valueAxes.find((item) => item.axisGroup === axisGroup);
    if (!axis) {
      diagnostics.push(`path cartesian geometry is missing ${axisGroup} path value-axis evidence`);
      continue;
    }
    diagnostics.push(...pathValueAxisStatusDiagnostics(`${axisGroup} path value axis`, axis));
  }

  return diagnostics.length > 0
    ? {
        reason: 'pathAxisVisualContractIncomplete',
        diagnostics,
      }
    : undefined;
}

function pathValueAxisGroupsForSeries(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
): Array<'primary' | 'secondary'> {
  const seriesIndexSet = new Set(seriesIndices);
  const axisGroups = new Set<'primary' | 'secondary'>();
  for (const series of cartesianGeometry.series) {
    if (seriesIndexSet.has(series.seriesIndex)) axisGroups.add(series.axisGroup);
  }
  for (const layer of pathGeometryLayersForSeries(cartesianGeometry, seriesIndices)) {
    if (layer.yAxisRole === 'primaryYValue') axisGroups.add('primary');
    if (layer.yAxisRole === 'secondaryYValue') axisGroups.add('secondary');
  }
  return [...axisGroups];
}

function pathValueAxisStatusDiagnostics(
  label: string,
  axis: {
    axisVisualStatus?: string;
    axisVisualStatusReason?: string;
    crossingStatus?: string;
    crossingStatusReason?: string;
    reservationStatus?: string;
    reservationStatusReason?: string;
    axisLayoutStatus?: string;
    axisLayoutStatusReason?: string;
    valueAxisLayoutStatus?: string;
    valueAxisLayoutStatusReason?: string;
  },
): string[] {
  const diagnostics: string[] = [];
  if (!isExactOrVerifiedDefaultStatus(axis.axisVisualStatus)) {
    diagnostics.push(
      `${label} visual status is ${axis.axisVisualStatus ?? 'missing'}; reason=${axis.axisVisualStatusReason ?? 'missing'}`,
    );
  }
  if (!isExactOrVerifiedDefaultStatus(axis.crossingStatus)) {
    diagnostics.push(
      `${label} crossing status is ${axis.crossingStatus ?? 'missing'}; reason=${axis.crossingStatusReason ?? 'missing'}`,
    );
  }
  if (!isExactOrVerifiedDefaultStatus(axis.reservationStatus)) {
    diagnostics.push(
      `${label} reservation status is ${axis.reservationStatus ?? 'missing'}; reason=${axis.reservationStatusReason ?? 'missing'}`,
    );
  }
  const layoutStatus = axis.valueAxisLayoutStatus ?? axis.axisLayoutStatus;
  if (!isExactOrVerifiedDefaultStatus(layoutStatus)) {
    diagnostics.push(
      `${label} layout status is ${layoutStatus ?? 'missing'}; reason=${axis.valueAxisLayoutStatusReason ?? axis.axisLayoutStatusReason ?? 'missing'}`,
    );
  }
  return diagnostics;
}

function areaSurfaceStyleEvidence(
  cartesianGeometry: CartesianGeometrySnapshot | undefined,
  seriesIndices: readonly number[],
):
  | {
      reason: Extract<
        ChartFamilySupportSnapshot['reason'],
        'areaSurfaceStyleEvidenceMissing' | 'areaSurfaceStyleApproximation'
      >;
      diagnostics: string[];
    }
  | undefined {
  if (seriesIndices.length === 0) return undefined;
  if (!cartesianGeometry || cartesianGeometry.geometryStatus !== 'available') {
    return {
      reason: 'areaSurfaceStyleEvidenceMissing',
      diagnostics: [
        `area surface style evidence is missing because cartesian geometry is ${cartesianGeometry?.geometryStatus ?? 'missing'} for series ${seriesIndices.join(', ')}`,
      ],
    };
  }

  const missing: number[] = [];
  const approximate: string[] = [];
  for (const seriesIndex of seriesIndices) {
    const series = cartesianGeometry.series.find((item) => item.seriesIndex === seriesIndex);
    const style = series?.areaSurfaceStyle;
    if (!style) {
      missing.push(seriesIndex);
      continue;
    }
    if (!isExactOrVerifiedDefaultStatus(style.styleStatus)) {
      approximate.push(
        `area series ${seriesIndex} surface style is ${style.styleStatus}; reason=${style.styleStatusReason ?? 'missing'}`,
      );
    }
  }

  if (missing.length > 0) {
    return {
      reason: 'areaSurfaceStyleEvidenceMissing',
      diagnostics: [`area surface style evidence is missing for series ${missing.join(', ')}`],
    };
  }
  if (approximate.length > 0) {
    return {
      reason: 'areaSurfaceStyleApproximation',
      diagnostics: approximate,
    };
  }
  return undefined;
}

function areaSurfaceExtentEvidence(
  cartesianGeometry: CartesianGeometrySnapshot | undefined,
  seriesIndices: readonly number[],
):
  | {
      reason: Extract<
        ChartFamilySupportSnapshot['reason'],
        'areaSurfaceExtentEvidenceMissing' | 'areaSurfaceExtentApproximation'
      >;
      diagnostics: string[];
    }
  | undefined {
  if (seriesIndices.length === 0) return undefined;
  if (!cartesianGeometry || cartesianGeometry.geometryStatus !== 'available') {
    return {
      reason: 'areaSurfaceExtentEvidenceMissing',
      diagnostics: [
        `area surface extent evidence is missing because cartesian geometry is ${cartesianGeometry?.geometryStatus ?? 'missing'} for series ${seriesIndices.join(', ')}`,
      ],
    };
  }

  const missing: number[] = [];
  const approximate: string[] = [];
  for (const seriesIndex of seriesIndices) {
    const series = cartesianGeometry.series.find((item) => item.seriesIndex === seriesIndex);
    const extent = series?.areaSurfaceExtent;
    if (!extent) {
      missing.push(seriesIndex);
      continue;
    }
    if (!isExactOrVerifiedDefaultStatus(extent.extentStatus)) {
      approximate.push(
        `area series ${seriesIndex} surface extent is ${extent.extentStatus}; reason=${extent.extentStatusReason ?? 'missing'}`,
      );
    }
  }

  if (missing.length > 0) {
    return {
      reason: 'areaSurfaceExtentEvidenceMissing',
      diagnostics: [`area surface extent evidence is missing for series ${missing.join(', ')}`],
    };
  }
  if (approximate.length > 0) {
    return {
      reason: 'areaSurfaceExtentApproximation',
      diagnostics: approximate,
    };
  }
  return undefined;
}

function comboSecondaryUnitPercentAxisEvidence(
  config: ChartConfig,
  chartData: ChartData,
  cartesianGeometry: CartesianGeometrySnapshot | undefined,
):
  | {
      reason: Extract<
        ChartFamilySupportSnapshot['reason'],
        'comboSecondaryAxisPolicyApproximation'
      >;
      diagnostics: string[];
    }
  | undefined {
  const secondaryPathSeries = comboSecondaryPathSeriesIndices(config, chartData);
  if (secondaryPathSeries.length === 0) return undefined;
  const axis = config.axis?.secondaryValueAxis ?? config.axis?.secondaryYAxis;
  if (
    typeof axis?.min === 'number' ||
    typeof axis?.max === 'number' ||
    !comboSecondaryAxisHasPercentFormat(config, chartData, secondaryPathSeries, axis)
  ) {
    return undefined;
  }
  const values = finiteSeriesValues(chartData, secondaryPathSeries);
  if (values.length === 0 || !values.every((value) => value >= 0 && value <= 1)) {
    return undefined;
  }
  const secondaryAxis = cartesianGeometry?.valueAxes.find((item) => item.axisGroup === 'secondary');
  const domain = secondaryAxis?.domain;
  const expectedTickStep = typeof axis?.majorUnit === 'number' ? axis.majorUnit : 0.2;
  if (!domain || !nearlyEqual(domain[0], 0) || !nearlyEqual(domain[1], 1)) {
    return {
      reason: 'comboSecondaryAxisPolicyApproximation',
      diagnostics: [
        `secondary percentage path axis expected [0, 1] domain but resolved ${domain ? `[${domain[0]}, ${domain[1]}]` : 'missing'}`,
      ],
    };
  }
  if (
    secondaryAxis?.tickStep !== undefined &&
    !nearlyEqual(secondaryAxis.tickStep, expectedTickStep)
  ) {
    return {
      reason: 'comboSecondaryAxisPolicyApproximation',
      diagnostics: [
        `secondary percentage path axis expected tickStep ${expectedTickStep} but resolved ${secondaryAxis.tickStep}`,
      ],
    };
  }
  if (!isExactOrVerifiedDefaultStatus(secondaryAxis?.reservationStatus)) {
    return {
      reason: 'comboSecondaryAxisPolicyApproximation',
      diagnostics: [
        `secondary percentage path axis reservation is ${secondaryAxis?.reservationStatus ?? 'missing'}; reason=${secondaryAxis?.reservationStatusReason ?? 'missing'}`,
      ],
    };
  }
  return undefined;
}

function comboSecondaryAxisHasPercentFormat(
  config: ChartConfig,
  chartData: ChartData,
  seriesIndices: readonly number[],
  axis: { numberFormat?: string } | undefined,
): boolean {
  if (formatContainsPercent(axis?.numberFormat)) return true;
  return seriesIndices.some((seriesIndex) => {
    const series = chartData.series[seriesIndex];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], seriesIndex);
    const cache = seriesConfig?.valueCache;
    if (formatContainsPercent(cache?.formatCode)) return true;
    return cache?.points?.some((point) => formatContainsPercent(point.formatCode)) === true;
  });
}

function finiteSeriesValues(chartData: ChartData, seriesIndices: readonly number[]): number[] {
  const seriesSet = new Set(seriesIndices);
  const values: number[] = [];
  chartData.series.forEach((series, seriesIndex) => {
    if (!seriesSet.has(seriesIndex)) return;
    for (const point of series.data) {
      if (typeof point?.y === 'number' && Number.isFinite(point.y)) values.push(point.y);
    }
  });
  return values;
}

function formatContainsPercent(format: string | undefined): boolean {
  return typeof format === 'string' && format.includes('%');
}

function nearlyEqual(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-9;
}

function pathLayerScaleEvidence(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
):
  | {
      reason: Extract<
        ChartFamilySupportSnapshot['reason'],
        'pathCartesianGeometryApproximation' | 'pathCartesianGeometryEvidenceMissing'
      >;
      diagnostics: string[];
    }
  | undefined {
  const layers = pathGeometryLayersForSeries(cartesianGeometry, seriesIndices);
  if (layers.length === 0) {
    return {
      reason: 'pathCartesianGeometryEvidenceMissing',
      diagnostics: [
        `path cartesian geometry is missing rendered layer evidence for series ${seriesIndices.join(', ')}`,
      ],
    };
  }

  const missing: string[] = [];
  const approximate: string[] = [];
  for (const layer of layers) {
    if (layer.xAxisRole === 'categoryX' || layer.xAxisRole === 'dateCategoryX') {
      const categoryReason =
        layer.xScale?.pathAxisLayout?.categoryAxisLayoutStatusReason ??
        layer.xScale?.pathAxisLayout?.axisLayoutStatusReason;
      const xStatus =
        layer.xScale?.pathAxisLayout?.categoryAxisLayoutStatus ??
        layer.xScale?.pathAxisLayout?.axisLayoutStatus;
      const pitchStatus = layer.xScale?.pathAxisLayout?.categoryPitchStatus ?? xStatus;
      const pitchReason = layer.xScale?.pathAxisLayout?.categoryPitchStatusReason ?? categoryReason;
      const tickStatus = layer.xScale?.pathAxisLayout?.categoryTickStatus ?? xStatus;
      const tickReason = layer.xScale?.pathAxisLayout?.categoryTickStatusReason ?? categoryReason;
      if (xStatus === undefined) {
        missing.push(`layer ${layer.layerIndex} x path-axis layout status`);
      } else if (!isExactOrVerifiedDefaultStatus(xStatus)) {
        approximate.push(
          `layer ${layer.layerIndex} x path-axis layout is ${xStatus}; reason=${layer.xScale?.pathAxisLayout?.categoryAxisLayoutStatusReason ?? layer.xScale?.pathAxisLayout?.axisLayoutStatusReason ?? 'missing'}`,
        );
      }
      if (pitchStatus === undefined) {
        missing.push(`layer ${layer.layerIndex} x path-axis category pitch status`);
      } else if (!isExactOrVerifiedDefaultStatus(pitchStatus)) {
        approximate.push(
          `layer ${layer.layerIndex} x path-axis category pitch is ${pitchStatus}; reason=${pitchReason ?? 'missing'}`,
        );
      }
      if (tickStatus === undefined) {
        missing.push(`layer ${layer.layerIndex} x path-axis category tick status`);
      } else if (!isExactOrVerifiedDefaultStatus(tickStatus)) {
        approximate.push(
          `layer ${layer.layerIndex} x path-axis category tick layout is ${tickStatus}; reason=${tickReason ?? 'missing'}`,
        );
      }
    }

    const yAxis = pathValueAxisForLayer(cartesianGeometry, layer);
    const yStatus =
      layer.yScale?.valueAxisLayoutStatus ??
      yAxis?.valueAxisLayoutStatus ??
      yAxis?.axisLayoutStatus ??
      layer.yScale?.pathAxisLayout?.valueAxisLayoutStatus ??
      layer.yScale?.pathAxisLayout?.axisLayoutStatus;
    const yReason =
      layer.yScale?.valueAxisLayoutStatusReason ??
      yAxis?.valueAxisLayoutStatusReason ??
      yAxis?.axisLayoutStatusReason ??
      layer.yScale?.pathAxisLayout?.valueAxisLayoutStatusReason ??
      layer.yScale?.pathAxisLayout?.axisLayoutStatusReason;
    if (yStatus === undefined) {
      missing.push(`layer ${layer.layerIndex} y path value-axis layout status`);
    } else if (!isExactOrVerifiedDefaultStatus(yStatus)) {
      approximate.push(
        `layer ${layer.layerIndex} y path value-axis layout is ${yStatus}; reason=${yReason ?? 'missing'}`,
      );
    }
    if (layer.yScale?.scaleConsistencyStatus === undefined) {
      missing.push(`layer ${layer.layerIndex} y value-axis scale consistency status`);
    } else if (layer.yScale.scaleConsistencyStatus !== 'consistent') {
      approximate.push(
        `layer ${layer.layerIndex} y value-axis scale consistency is ${layer.yScale.scaleConsistencyStatus}; reason=${layer.yScale.scaleConsistencyReason ?? 'missing'}`,
      );
    }
  }

  if (missing.length > 0) {
    return {
      reason: 'pathCartesianGeometryEvidenceMissing',
      diagnostics: [`path layer scale evidence is incomplete: ${missing.join('; ')}`],
    };
  }
  if (approximate.length > 0) {
    return {
      reason: 'pathCartesianGeometryApproximation',
      diagnostics: approximate,
    };
  }
  return undefined;
}

function pathValueAxisForLayer(
  cartesianGeometry: CartesianGeometrySnapshot,
  layer: NonNullable<CartesianGeometrySnapshot['layers']>[number],
): CartesianGeometrySnapshot['valueAxes'][number] | undefined {
  if (layer.yAxisRole === 'secondaryYValue') {
    return cartesianGeometry.valueAxes.find((axis) => axis.axisGroup === 'secondary');
  }
  if (layer.yAxisRole === 'primaryYValue') {
    return cartesianGeometry.valueAxes.find((axis) => axis.axisGroup === 'primary');
  }
  const seriesIndex = layer.seriesIndices[0];
  const series = cartesianGeometry.series.find((item) => item.seriesIndex === seriesIndex);
  return cartesianGeometry.valueAxes.find((axis) => axis.axisGroup === series?.axisGroup);
}

function pathGeometryLayersForSeries(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
): NonNullable<CartesianGeometrySnapshot['layers']> {
  const seriesIndexSet = new Set(seriesIndices);
  return (
    cartesianGeometry.layers?.filter((layer) => {
      if (
        layer.layerRole !== 'linePath' &&
        layer.layerRole !== 'areaFill' &&
        layer.layerRole !== 'marker'
      ) {
        return false;
      }
      return layer.seriesIndices.some((seriesIndex) => seriesIndexSet.has(seriesIndex));
    }) ?? []
  );
}

type PathVisualContractReason = Extract<
  ChartFamilySupportSnapshot['reason'],
  | 'pathLineVisualContractIncomplete'
  | 'pathMarkerVisualContractIncomplete'
  | 'pathColorAuthorityIncomplete'
  | 'pathBlankMarkerPolicyIncomplete'
>;

function pathVisualContractEvidence(
  cartesianGeometry: CartesianGeometrySnapshot | undefined,
  seriesIndices: readonly number[],
):
  | {
      reason: PathVisualContractReason;
      diagnostics: string[];
    }
  | undefined {
  if (!cartesianGeometry || seriesIndices.length === 0) return undefined;
  const seriesIndexSet = new Set(seriesIndices);
  const diagnostics = new Map<PathVisualContractReason, string[]>();

  for (const series of cartesianGeometry.series) {
    if (!seriesIndexSet.has(series.seriesIndex) || !isPathVisualGeometrySeries(series.type)) {
      continue;
    }

    const hasVisiblePathInk =
      series.lineVisibleInk === true ||
      series.markerVisibleInk === true ||
      series.markerLayer === true;

    if (hasVisiblePathInk && !isExactOrVerifiedDefaultStatus(series.colorAuthorityStatus)) {
      addPathVisualDiagnostic(
        diagnostics,
        'pathColorAuthorityIncomplete',
        `path series ${series.seriesIndex} color authority is ${series.colorAuthorityStatus ?? 'missing'}; reason=${series.colorAuthorityReason ?? 'missing'}`,
      );
    }

    if (!isExactOrVerifiedDefaultStatus(series.lineVisualStatus)) {
      addPathVisualDiagnostic(
        diagnostics,
        'pathLineVisualContractIncomplete',
        `path series ${series.seriesIndex} line visual contract is ${series.lineVisualStatus ?? 'missing'}; reason=${series.lineVisualStatusReason ?? 'missing'}`,
      );
    }

    if (
      (series.sourceShowMarkers || series.markerVisibleInk || series.markerLayer) &&
      !isExactOrVerifiedDefaultStatus(series.markerVisualStatus)
    ) {
      addPathVisualDiagnostic(
        diagnostics,
        'pathMarkerVisualContractIncomplete',
        `path series ${series.seriesIndex} marker visual contract is ${series.markerVisualStatus ?? 'missing'}; reason=${series.markerVisualStatusReason ?? 'missing'}`,
      );
    }

    if (!isExactOrVerifiedDefaultStatus(series.blankMarkerPolicyStatus)) {
      addPathVisualDiagnostic(
        diagnostics,
        'pathBlankMarkerPolicyIncomplete',
        `path series ${series.seriesIndex} blank-marker policy is ${series.blankMarkerPolicyStatus ?? 'missing'}; reason=${series.blankMarkerPolicyStatusReason ?? 'missing'}`,
      );
    }

    if (
      series.blankMarkerPolicy === 'suppressSourceBlankMarkers' &&
      (series.sourceBlankMarkerGeometryCount ?? 0) > 0
    ) {
      addPathVisualDiagnostic(
        diagnostics,
        'pathBlankMarkerPolicyIncomplete',
        `path series ${series.seriesIndex} rendered ${series.sourceBlankMarkerGeometryCount} marker point(s) for source blanks`,
      );
    }
  }

  for (const reason of PATH_VISUAL_REASON_ORDER) {
    const reasonDiagnostics = diagnostics.get(reason);
    if (reasonDiagnostics?.length) {
      return { reason, diagnostics: reasonDiagnostics };
    }
  }
  return undefined;
}

const PATH_VISUAL_REASON_ORDER: PathVisualContractReason[] = [
  'pathColorAuthorityIncomplete',
  'pathLineVisualContractIncomplete',
  'pathMarkerVisualContractIncomplete',
  'pathBlankMarkerPolicyIncomplete',
];

function addPathVisualDiagnostic(
  diagnostics: Map<PathVisualContractReason, string[]>,
  reason: PathVisualContractReason,
  diagnostic: string,
): void {
  const current = diagnostics.get(reason) ?? [];
  current.push(diagnostic);
  diagnostics.set(reason, current);
}

function isPathVisualGeometrySeries(type: string): boolean {
  return (
    type === 'line' ||
    type === 'lineMarkers' ||
    type === 'lineMarkersStacked' ||
    type === 'lineMarkersStacked100' ||
    type === 'area'
  );
}

function pathLegendRenderEvidence(legend: LegendSnapshot):
  | {
      reason: Extract<ChartFamilySupportSnapshot['reason'], 'pathLegendRenderMismatch'>;
      diagnostics: string[];
    }
  | undefined {
  if (!legend.rendered?.mismatchReason) return undefined;
  return {
    reason: 'pathLegendRenderMismatch',
    diagnostics: [`path legend render mismatch: ${legend.rendered.mismatchReason}`],
  };
}

function pathLegendOrderEvidence(
  config: ChartConfig,
  legend: LegendSnapshot,
):
  | {
      reason: Extract<ChartFamilySupportSnapshot['reason'], 'pathLegendOrderMismatch'>;
      diagnostics: string[];
    }
  | undefined {
  if (!legend.present || legend.visible === false) return undefined;
  const renderedEntries = legend.rendered?.entries;
  const visibleEntries = legend.visibleEntryItems ?? [];
  if (visibleEntries.length === 0) return undefined;
  if (!renderedEntries || renderedEntries.length === 0) {
    return {
      reason: 'pathLegendOrderMismatch',
      diagnostics: ['path legend rendered entry order evidence is missing'],
    };
  }

  const expectedEntries = shouldReversePathLegendOrder(config)
    ? [...visibleEntries].reverse()
    : visibleEntries;
  const expected = expectedEntries.map(legendEntryOrderKey);
  const actual = renderedEntries.map(renderedLegendEntryOrderKey);
  if (
    expected.length !== actual.length ||
    expected.some((value, index) => value !== actual[index])
  ) {
    return {
      reason: 'pathLegendOrderMismatch',
      diagnostics: [
        `path legend rendered order ${actual.join(' | ')} does not match expected order ${expected.join(' | ')}`,
      ],
    };
  }
  return undefined;
}

function shouldReversePathLegendOrder(config: ChartConfig): boolean {
  if (config.type !== 'area') return false;
  return (
    config.subType === 'stacked' ||
    config.subType === 'percentStacked' ||
    stackModeForChartType(config.type) !== undefined
  );
}

function legendEntryOrderKey(
  entry: NonNullable<LegendSnapshot['visibleEntryItems']>[number],
): string {
  if (entry.sourceSeriesKey) return `source:${entry.sourceSeriesKey}`;
  if (entry.sourceSeriesIndex !== undefined) return `sourceIndex:${entry.sourceSeriesIndex}`;
  if (entry.pointKey) return `point:${entry.pointKey}`;
  if (entry.pointIndex !== undefined) return `pointIndex:${entry.pointIndex}`;
  if (entry.stockRole) return `stock:${entry.stockRole}`;
  return `text:${entry.text}`;
}

function renderedLegendEntryOrderKey(
  entry: NonNullable<NonNullable<LegendSnapshot['rendered']>['entries']>[number],
): string {
  if (entry.sourceSeriesKey) return `source:${entry.sourceSeriesKey}`;
  if (entry.sourceSeriesIndex !== undefined) return `sourceIndex:${entry.sourceSeriesIndex}`;
  if (entry.pointKey) return `point:${entry.pointKey}`;
  if (entry.pointIndex !== undefined) return `pointIndex:${entry.pointIndex}`;
  if (entry.stockRole) return `stock:${entry.stockRole}`;
  return `text:${entry.text}`;
}

function comboLayerAuthorityEvidence(cartesianGeometry: CartesianGeometrySnapshot | undefined):
  | {
      reason: Extract<
        ChartFamilySupportSnapshot['reason'],
        'comboLayerAuthorityIncomplete' | 'comboLayeredGeometryEvidenceMissing'
      >;
      diagnostics: string[];
    }
  | undefined {
  const authority = cartesianGeometry?.comboAuthority;
  if (!authority) {
    return {
      reason: 'comboLayeredGeometryEvidenceMissing',
      diagnostics: ['imported combo exactness requires resolved combo layer authority evidence'],
    };
  }
  if (isExactOrVerifiedDefaultStatus(authority.status)) return undefined;
  return {
    reason: 'comboLayerAuthorityIncomplete',
    diagnostics: comboLayerAuthorityDiagnostics(authority),
  };
}

function comboLayerAuthorityDiagnostics(authority: CartesianComboAuthoritySnapshot): string[] {
  if (authority.diagnostics.length > 0) return authority.diagnostics;
  return [
    `imported combo layer authority is ${authority.status}; reason=${authority.statusReason ?? 'missing'}`,
  ];
}

function comboNonBarLayerGeometryEvidence(
  cartesianGeometry: CartesianGeometrySnapshot | undefined,
  seriesIndices: readonly number[],
):
  | {
      reason: Extract<
        ChartFamilySupportSnapshot['reason'],
        'comboLayeredGeometryApproximation' | 'comboLayeredGeometryEvidenceMissing'
      >;
      diagnostics: string[];
    }
  | undefined {
  if (!cartesianGeometry) {
    return {
      reason: 'comboLayeredGeometryEvidenceMissing',
      diagnostics: [
        `combo renderer did not expose cartesian geometry for non-bar series ${seriesIndices.join(', ')}`,
      ],
    };
  }
  if (cartesianGeometry.geometryStatus !== 'available') {
    return {
      reason: 'comboLayeredGeometryEvidenceMissing',
      diagnostics: [
        `combo cartesian geometry is ${cartesianGeometry.geometryStatus ?? 'missing'} for non-bar series ${seriesIndices.join(', ')}`,
      ],
    };
  }

  const missingSeries = seriesIndices.filter(
    (seriesIndex) => !hasComboNonBarPointGeometry(cartesianGeometry, seriesIndex),
  );
  if (missingSeries.length > 0) {
    return {
      reason: 'comboLayeredGeometryEvidenceMissing',
      diagnostics: [
        `combo cartesian geometry is missing category-point evidence for non-bar series ${missingSeries.join(', ')}`,
      ],
    };
  }
  return undefined;
}

function hasComboNonBarPointGeometry(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndex: number,
): boolean {
  const series = cartesianGeometry.series.find((item) => item.seriesIndex === seriesIndex);
  if (!series?.pointGeometry || series.pointGeometry.length === 0) return false;
  if (
    series.xRole === 'category' &&
    series.xMode !== 'categoryPoint' &&
    series.xMode !== 'dateSerial'
  ) {
    return false;
  }

  return (
    cartesianGeometry.layers?.some((layer) => {
      if (!layer.seriesIndices.includes(seriesIndex) || layer.pointCount <= 0) return false;
      return (
        series.xRole === 'quantitative' ||
        layer.xAxisRole === 'categoryX' ||
        layer.xAxisRole === 'dateCategoryX'
      );
    }) ?? false
  );
}

function isStandardBarColumnConfig(config: ChartConfig): boolean {
  return config.type === 'bar' || config.type === 'column';
}

function isStandardPieDoughnutConfig(config: ChartConfig): boolean {
  return (
    config.type === 'pie' ||
    config.type === 'pieExploded' ||
    config.type === 'doughnut' ||
    config.type === 'doughnutExploded'
  );
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
      return [
        'treemap rendering requires hierarchy layout semantics and is preserved as a placeholder',
      ];
    case 'sunburst':
      return [
        'sunburst rendering requires hierarchy layout semantics and is preserved as a placeholder',
      ];
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
        point?.valueState !== 'hidden' && typeof point?.y === 'number' && Number.isFinite(point.y),
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
