import {
  chartImportSourceDialect,
  isImportedStandardOoxmlChart,
  seriesConfigForDataSeries,
  type ChartConfig,
  type ChartData,
} from '@mog/charts';
import type {
  ChartFamilySupportSnapshot,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import { isNoFillNoLineSeriesConfig } from './chart-render-data-normalizer';

type LegendSnapshot = ResolvedChartSpecSnapshot['resolved']['legend'];
type CartesianGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['cartesianGeometry']
>;
type CartesianPointAuthoritySnapshot = NonNullable<
  CartesianGeometrySnapshot['pointAuthority']
>[number];
type CartesianSeriesSnapshot = CartesianGeometrySnapshot['series'][number];
type CartesianLayerSnapshot = NonNullable<CartesianGeometrySnapshot['layers']>[number];
type CartesianPointSnapshot = NonNullable<CartesianSeriesSnapshot['pointGeometry']>[number];
type XYEvidenceReason = Extract<
  ChartFamilySupportSnapshot['reason'],
  | 'xyCartesianGeometryEvidenceMissing'
  | 'xyAxisVisualContractIncomplete'
  | 'scatterVisualContractIncomplete'
  | 'scatterPointAuthorityIncomplete'
  | 'bubbleSizeAuthorityUnresolved'
  | 'bubbleLegendVocabularyUnresolved'
  | 'bubbleColorAuthorityUnresolved'
  | 'bubbleVisualContractIncomplete'
>;

export type XYFamilySupportEvidence = {
  reason: XYEvidenceReason;
  diagnostics: string[];
};

export function standardScatterFamilySupport(input: {
  config: ChartConfig;
  chartData: ChartData;
  legend: LegendSnapshot;
  family: string;
  sourceFamily?: string;
  cartesianGeometry?: CartesianGeometrySnapshot;
}): ChartFamilySupportSnapshot {
  const evidence = isImportedStandardOoxmlChart(input.config)
    ? scatterVisualContractEvidence({
        config: input.config,
        chartData: input.chartData,
        cartesianGeometry: input.cartesianGeometry,
      })
    : undefined;
  if (evidence) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: evidence.reason,
      diagnostics: evidence.diagnostics,
      renderedAs: 'scatter',
    };
  }

  if (isImportedStandardOoxmlChart(input.config)) {
    const pointAuthorityEvidence = scatterPointAuthorityEvidence(input.cartesianGeometry);
    if (pointAuthorityEvidence) {
      return {
        schemaVersion: 1,
        family: input.family,
        sourceFamily: input.sourceFamily,
        supportLevel: 'approximate',
        reason: pointAuthorityEvidence.reason,
        diagnostics: pointAuthorityEvidence.diagnostics,
        renderedAs: 'scatter',
      };
    }

    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'exact',
      reason: 'standardRenderer',
      diagnostics: [],
      renderedAs: 'scatter',
    };
  }

  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: 'exact',
    reason: 'standardRenderer',
    diagnostics: [],
    renderedAs: 'scatter',
  };
}

export function standardBubbleFamilySupport(input: {
  config: ChartConfig;
  chartData: ChartData;
  legend: LegendSnapshot;
  family: string;
  sourceFamily?: string;
  cartesianGeometry?: CartesianGeometrySnapshot;
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

  const evidence = isImportedStandardOoxmlChart(input.config)
    ? bubbleVisualContractEvidence({
        config: input.config,
        chartData: input.chartData,
        legend: input.legend,
        cartesianGeometry: input.cartesianGeometry,
      })
    : bubbleLegendVocabularyEvidence(input.config, input.chartData, input.legend);
  if (evidence) {
    return {
      schemaVersion: 1,
      family: input.family,
      sourceFamily: input.sourceFamily,
      supportLevel: 'approximate',
      reason: evidence.reason,
      diagnostics: evidence.diagnostics,
      renderedAs: 'bubble',
    };
  }

  return {
    schemaVersion: 1,
    family: input.family,
    sourceFamily: input.sourceFamily,
    supportLevel: 'exact',
    reason: 'exactRenderer',
    diagnostics: [],
    renderedAs: 'bubble',
  };
}

export function comboXYVisualContractEvidence(input: {
  config: ChartConfig;
  chartData: ChartData;
  legend: LegendSnapshot;
  cartesianGeometry?: CartesianGeometrySnapshot;
}): XYFamilySupportEvidence | undefined {
  if (!isImportedStandardOoxmlChart(input.config)) return undefined;
  const scatterIndices = xySeriesIndicesFromConfig(input.config, input.chartData, 'scatter');
  const bubbleIndices = xySeriesIndicesFromConfig(input.config, input.chartData, 'bubble');
  if (scatterIndices.length === 0 && bubbleIndices.length === 0) return undefined;

  const scatterEvidence =
    scatterIndices.length > 0
      ? scatterVisualContractEvidence({
          config: input.config,
          chartData: input.chartData,
          cartesianGeometry: input.cartesianGeometry,
          seriesIndices: scatterIndices,
        })
      : undefined;
  if (scatterEvidence) return scatterEvidence;

  return bubbleIndices.length > 0
    ? bubbleVisualContractEvidence({
        config: input.config,
        chartData: input.chartData,
        legend: input.legend,
        cartesianGeometry: input.cartesianGeometry,
        seriesIndices: bubbleIndices,
      })
    : undefined;
}

function scatterVisualContractEvidence(input: {
  config: ChartConfig;
  chartData: ChartData;
  cartesianGeometry?: CartesianGeometrySnapshot;
  seriesIndices?: readonly number[];
}): XYFamilySupportEvidence | undefined {
  const targetIndices =
    input.seriesIndices ?? xySeriesIndicesFromConfig(input.config, input.chartData, 'scatter');
  const geometryEvidence = xyCartesianGeometryEvidence(input.cartesianGeometry, targetIndices);
  if (geometryEvidence) return geometryEvidence;
  if (!input.cartesianGeometry) return undefined;

  const coordinateDiagnostics = scatterCoordinateTraceDiagnostics(input.cartesianGeometry);
  if (coordinateDiagnostics.length > 0) {
    return {
      reason: 'scatterVisualContractIncomplete',
      diagnostics: coordinateDiagnostics,
    };
  }

  const axisEvidence = scatterAxisEvidence(input.cartesianGeometry, targetIndices);
  if (axisEvidence) return axisEvidence;

  const diagnostics: string[] = [];
  for (const series of targetGeometrySeries(input.cartesianGeometry, targetIndices)) {
    diagnostics.push(...scatterSeriesDiagnostics(input.cartesianGeometry, series));
  }
  return diagnostics.length > 0
    ? {
        reason: 'scatterVisualContractIncomplete',
        diagnostics,
      }
    : undefined;
}

function scatterPointAuthorityEvidence(
  cartesianGeometry: CartesianGeometrySnapshot | undefined,
): XYFamilySupportEvidence | undefined {
  const authority = cartesianGeometry?.pointAuthority?.find(
    (item): item is CartesianPointAuthoritySnapshot => item.family === 'scatter',
  );
  if (isExactOrVerifiedDefaultStatus(authority?.status)) return undefined;
  return {
    reason: 'scatterPointAuthorityIncomplete',
    diagnostics: scatterPointAuthorityDiagnostics(authority),
  };
}

function scatterPointAuthorityDiagnostics(
  authority: CartesianPointAuthoritySnapshot | undefined,
): string[] {
  if (!authority) {
    return ['imported scatter exactness requires resolved cartesian point authority evidence'];
  }
  if (authority.diagnostics.length > 0) return authority.diagnostics;
  return [
    `imported scatter point authority is ${authority.status}; reason=${authority.statusReason ?? 'missing'}`,
  ];
}

function bubbleVisualContractEvidence(input: {
  config: ChartConfig;
  chartData: ChartData;
  legend: LegendSnapshot;
  cartesianGeometry?: CartesianGeometrySnapshot;
  seriesIndices?: readonly number[];
}): XYFamilySupportEvidence | undefined {
  const targetIndices =
    input.seriesIndices ?? xySeriesIndicesFromConfig(input.config, input.chartData, 'bubble');
  const geometryEvidence = xyCartesianGeometryEvidence(input.cartesianGeometry, targetIndices);
  if (geometryEvidence) return geometryEvidence;
  if (!input.cartesianGeometry) return undefined;

  const legendEvidence = bubbleLegendVocabularyEvidence(input.config, input.chartData, input.legend);
  if (legendEvidence) return legendEvidence;

  const axisEvidence = xyAxisEvidence(input.cartesianGeometry, targetIndices);
  if (axisEvidence) return axisEvidence;

  const bubblePlan = input.cartesianGeometry.bubble;
  if (
    !bubblePlan ||
    !isFiniteNonNegative(bubblePlan.maxRenderableMagnitude) ||
    !isFinitePositive(bubblePlan.maxRenderedArea)
  ) {
    return {
      reason: 'bubbleSizeAuthorityUnresolved',
      diagnostics: ['bubble renderer did not expose resolved size/radius authority'],
    };
  }

  const diagnostics: string[] = [];
  for (const series of targetGeometrySeries(input.cartesianGeometry, targetIndices)) {
    diagnostics.push(...bubbleSeriesDiagnostics(series));
  }
  if (diagnostics.some((item) => item.includes('color authority'))) {
    return { reason: 'bubbleColorAuthorityUnresolved', diagnostics };
  }
  if (diagnostics.some((item) => item.includes('size authority'))) {
    return { reason: 'bubbleSizeAuthorityUnresolved', diagnostics };
  }
  return diagnostics.length > 0
    ? {
        reason: 'bubbleVisualContractIncomplete',
        diagnostics,
      }
    : undefined;
}

function xyCartesianGeometryEvidence(
  cartesianGeometry: CartesianGeometrySnapshot | undefined,
  seriesIndices: readonly number[],
): XYFamilySupportEvidence | undefined {
  if (seriesIndices.length === 0) return undefined;
  if (!cartesianGeometry) {
    return {
      reason: 'xyCartesianGeometryEvidenceMissing',
      diagnostics: [
        `XY renderer did not expose cartesian geometry for series ${seriesIndices.join(', ')}`,
      ],
    };
  }
  if (cartesianGeometry.geometryStatus !== 'available') {
    return {
      reason: 'xyCartesianGeometryEvidenceMissing',
      diagnostics: [
        `XY cartesian geometry is ${cartesianGeometry.geometryStatus ?? 'missing'} for series ${seriesIndices.join(', ')}`,
      ],
    };
  }
  const missingSeries = seriesIndices.filter((seriesIndex) => {
    const series = cartesianGeometry.series.find((item) => item.seriesIndex === seriesIndex);
    return !series?.pointGeometry || series.pointGeometry.length === 0;
  });
  if (missingSeries.length > 0) {
    return {
      reason: 'xyCartesianGeometryEvidenceMissing',
      diagnostics: [
        `XY cartesian geometry is missing point evidence for series ${missingSeries.join(', ')}`,
      ],
    };
  }
  return undefined;
}

function scatterCoordinateTraceDiagnostics(
  cartesianGeometry: CartesianGeometrySnapshot,
): string[] {
  const diagnostics: string[] = [];
  if (cartesianGeometry.coordinateSystem !== 'chartPixel') {
    diagnostics.push(
      `scatter cartesian geometry coordinateSystem is ${cartesianGeometry.coordinateSystem ?? 'missing'}; expected chartPixel`,
    );
  }
  if (!isFinitePositive(cartesianGeometry.chartWidth)) {
    diagnostics.push(
      `scatter cartesian geometry chartWidth is ${formatFiniteDiagnosticValue(cartesianGeometry.chartWidth)}`,
    );
  }
  if (!isFinitePositive(cartesianGeometry.chartHeight)) {
    diagnostics.push(
      `scatter cartesian geometry chartHeight is ${formatFiniteDiagnosticValue(cartesianGeometry.chartHeight)}`,
    );
  }
  if (!isFiniteRect(cartesianGeometry.plotArea)) {
    diagnostics.push('scatter cartesian geometry plotArea is missing or non-finite');
  }
  return diagnostics;
}

function scatterAxisEvidence(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
): XYFamilySupportEvidence | undefined {
  if (!cartesianGeometry.x.quantitative) {
    return {
      reason: 'scatterVisualContractIncomplete',
      diagnostics: ['scatter cartesian geometry is missing quantitative x-axis evidence'],
    };
  }
  return xyAxisEvidence(cartesianGeometry, seriesIndices);
}

function xyAxisEvidence(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
): XYFamilySupportEvidence | undefined {
  const diagnostics: string[] = [];
  const x = cartesianGeometry.x.quantitative;
  if (!x) {
    diagnostics.push('XY cartesian geometry is missing quantitative x-axis evidence');
  } else {
    diagnostics.push(...axisStatusDiagnostics('x value', x));
    if (
      x.renderedAxisOrient &&
      x.renderedAxisOrient !== 'bottom' &&
      x.renderedAxisOrient !== 'top'
    ) {
      diagnostics.push(`x value axis rendered with ${x.renderedAxisOrient} orientation`);
    }
  }

  const axisGroups = new Set(
    targetGeometrySeries(cartesianGeometry, seriesIndices).map((series) => series.axisGroup),
  );
  for (const axisGroup of axisGroups) {
    const axis = cartesianGeometry.valueAxes.find((item) => item.axisGroup === axisGroup);
    if (!axis) {
      diagnostics.push(`XY cartesian geometry is missing ${axisGroup} y-axis evidence`);
      continue;
    }
    diagnostics.push(...axisStatusDiagnostics(`${axisGroup} y value`, axis));
    if (
      axis.renderedAxisOrient &&
      axis.renderedAxisOrient !== 'left' &&
      axis.renderedAxisOrient !== 'right'
    ) {
      diagnostics.push(
        `${axisGroup} y value axis rendered with ${axis.renderedAxisOrient} orientation`,
      );
    }
    if (axis.scaleConsistencyStatus === 'planTraceMismatch') {
      diagnostics.push(
        `${axisGroup} y value-axis rendered scale differs from plan; reason=${axis.scaleConsistencyReason ?? 'missing'}`,
      );
    }
  }

  return diagnostics.length > 0
    ? {
        reason: 'xyAxisVisualContractIncomplete',
        diagnostics,
      }
    : undefined;
}

function scatterSeriesDiagnostics(
  cartesianGeometry: CartesianGeometrySnapshot,
  series: CartesianSeriesSnapshot,
): string[] {
  const diagnostics: string[] = [];
  if (!series.lineVisibleInk && !series.markerVisibleInk) {
    diagnostics.push(`scatter series ${series.seriesIndex} has no visible line or marker contract`);
  }
  if (!isExactOrVerifiedDefaultStatus(series.colorAuthorityStatus)) {
    diagnostics.push(
      `scatter series ${series.seriesIndex} color authority is ${series.colorAuthorityStatus ?? 'missing'}; reason=${series.colorAuthorityReason ?? 'missing'}`,
    );
  }
  if (series.lineVisibleInk) {
    if (!isExactOrVerifiedDefaultStatus(series.lineVisualStatus)) {
      diagnostics.push(
        `scatter series ${series.seriesIndex} line visual contract is ${series.lineVisualStatus ?? 'missing'}; reason=${series.lineVisualStatusReason ?? 'missing'}`,
      );
    }
    const lineLayer = seriesLayer(cartesianGeometry, series.seriesIndex, 'linePath');
    if (!lineLayer) {
      diagnostics.push(`scatter series ${series.seriesIndex} is missing a rendered line-path layer`);
    } else {
      if (lineLayer.pathOrder !== 'source') {
        diagnostics.push(
          `scatter series ${series.seriesIndex} line layer ${lineLayer.layerIndex} path order is ${lineLayer.pathOrder ?? 'missing'}; expected source`,
        );
      }
      diagnostics.push(
        ...layerScaleDiagnostics(`scatter series ${series.seriesIndex} line layer`, lineLayer),
      );
      diagnostics.push(
        ...pointGeometryDiagnostics(
          `scatter series ${series.seriesIndex} line layer ${lineLayer.layerIndex}`,
          pointsForLayer(series, lineLayer.layerIndex),
        ),
      );
    }
  }
  if (series.markerVisibleInk) {
    if (!isExactOrVerifiedDefaultStatus(series.markerVisualStatus)) {
      diagnostics.push(
        `scatter series ${series.seriesIndex} marker visual contract is ${series.markerVisualStatus ?? 'missing'}; reason=${series.markerVisualStatusReason ?? 'missing'}`,
      );
    }
    const markerLayer = seriesLayer(cartesianGeometry, series.seriesIndex, 'marker');
    if (!markerLayer) {
      diagnostics.push(`scatter series ${series.seriesIndex} is missing a rendered marker layer`);
    } else {
      if (markerLayer.sizeAuthority !== 'markerStyle' && markerLayer.sizeAuthority !== 'fixedMarkSize') {
        diagnostics.push(
          `scatter series ${series.seriesIndex} marker layer ${markerLayer.layerIndex} size authority is ${markerLayer.sizeAuthority ?? 'missing'}`,
        );
      }
      diagnostics.push(
        ...layerScaleDiagnostics(`scatter series ${series.seriesIndex} marker layer`, markerLayer, {
          requireSizeScale: markerLayer.sizeAuthority === 'markerStyle',
        }),
      );
    }
    const markerPoints = series.markerGeometry?.points ?? [];
    if (markerPoints.length === 0) {
      diagnostics.push(`scatter series ${series.seriesIndex} is missing rendered marker geometry`);
    } else {
      diagnostics.push(
        ...pointGeometryDiagnostics(
          `scatter series ${series.seriesIndex} marker geometry`,
          markerPoints,
          { requireRenderedSize: true },
        ),
      );
    }
    if (!series.markerShape || !isFinitePositive(series.markerSize)) {
      diagnostics.push(
        `scatter series ${series.seriesIndex} is missing marker glyph/size authority`,
      );
    }
  }
  return diagnostics;
}

function layerScaleDiagnostics(
  label: string,
  layer: CartesianLayerSnapshot,
  options: { requireSizeScale?: boolean } = {},
): string[] {
  const diagnostics: string[] = [];
  diagnostics.push(...scaleTraceDiagnostics(`${label} ${layer.layerIndex} xScale`, layer.xScale));
  diagnostics.push(...scaleTraceDiagnostics(`${label} ${layer.layerIndex} yScale`, layer.yScale));
  if (options.requireSizeScale) {
    diagnostics.push(
      ...scaleTraceDiagnostics(`${label} ${layer.layerIndex} sizeScale`, layer.sizeScale, {
        allowMissingRange: true,
      }),
    );
  }
  return diagnostics;
}

function scaleTraceDiagnostics(
  label: string,
  scale: CartesianLayerSnapshot['xScale'] | undefined,
  options: { allowMissingRange?: boolean } = {},
): string[] {
  const diagnostics: string[] = [];
  if (!scale) {
    return [`${label} trace is missing`];
  }
  if (!scale.field) {
    diagnostics.push(`${label} field is missing`);
  }
  if (!Array.isArray(scale.domain) || scale.domain.length === 0) {
    diagnostics.push(`${label} domain is missing`);
  }
  if (!options.allowMissingRange && !isFinitePair(scale.range)) {
    diagnostics.push(`${label} range is missing or non-finite`);
  }
  return diagnostics;
}

function pointGeometryDiagnostics(
  label: string,
  points: readonly CartesianPointSnapshot[],
  options: { requireRenderedSize?: boolean } = {},
): string[] {
  if (points.length === 0) {
    return [`${label} point geometry is missing`];
  }
  const diagnostics: string[] = [];
  const invalidPositionCount = points.filter((point) => !hasFinitePointPosition(point)).length;
  if (invalidPositionCount > 0) {
    diagnostics.push(`${label} has ${invalidPositionCount} non-finite point position(s)`);
  }
  if (options.requireRenderedSize) {
    const invalidSizeCount = points.filter((point) => !hasFiniteRenderedSize(point)).length;
    if (invalidSizeCount > 0) {
      diagnostics.push(`${label} has ${invalidSizeCount} point(s) without finite rendered size`);
    }
  }
  return diagnostics;
}

function pointsForLayer(
  series: CartesianSeriesSnapshot,
  layerIndex: number,
): CartesianPointSnapshot[] {
  return (series.pointGeometry ?? []).filter((point) => point.layerIndex === layerIndex);
}

function bubbleSeriesDiagnostics(series: CartesianSeriesSnapshot): string[] {
  const diagnostics: string[] = [];
  if (series.bubbleVisibleInk !== true) {
    diagnostics.push(`bubble series ${series.seriesIndex} has no visible bubble contract`);
  }
  if (series.bubbleSizeAuthority !== 'series') {
    diagnostics.push(`bubble series ${series.seriesIndex} size authority is missing`);
  }
  if (!isExactOrVerifiedDefaultStatus(series.bubbleVisualStatus)) {
    diagnostics.push(
      `bubble series ${series.seriesIndex} visual contract is ${series.bubbleVisualStatus ?? 'missing'}; reason=${series.bubbleVisualStatusReason ?? 'missing'}`,
    );
  }
  if (!isExactOrVerifiedDefaultStatus(series.colorAuthorityStatus)) {
    diagnostics.push(
      `bubble series ${series.seriesIndex} color authority is ${series.colorAuthorityStatus ?? 'missing'}; reason=${series.colorAuthorityReason ?? 'missing'}`,
    );
  }
  const points = series.bubbleGeometry?.points ?? [];
  if (points.length === 0) {
    diagnostics.push(`bubble series ${series.seriesIndex} is missing rendered bubble geometry`);
  } else if (!points.some((point) => isFiniteNonNegative(point.renderedRadius))) {
    diagnostics.push(`bubble series ${series.seriesIndex} is missing resolved bubble radii`);
  }
  return diagnostics;
}

function bubbleLegendVocabularyEvidence(
  config: ChartConfig,
  chartData: ChartData,
  legend: LegendSnapshot,
): XYFamilySupportEvidence | undefined {
  if (!legend.present) return undefined;
  const vocabulary = legend.entryVocabulary ?? 'unknown';
  if (bubbleUsesPointLegendVocabulary(config, chartData)) {
    return vocabulary === 'category' || vocabulary === 'point'
      ? undefined
      : {
          reason: 'bubbleLegendVocabularyUnresolved',
          diagnostics: [
            `bubble legend vocabulary is ${vocabulary}; expected point/category entries from vary-by-category source semantics`,
          ],
        };
  }
  return vocabulary === 'series'
    ? undefined
    : {
        reason: 'bubbleLegendVocabularyUnresolved',
        diagnostics: [`bubble legend vocabulary is ${vocabulary}; expected source series entries`],
      };
}

function bubbleUsesPointLegendVocabulary(config: ChartConfig, chartData: ChartData): boolean {
  if (config.varyByCategories !== true) return false;
  if (config.type !== 'bubble' && config.type !== 'bubble3DEffect' && config.type !== 'combo') {
    return false;
  }
  if (chartImportSourceDialect(config) === undefined) return true;
  return (
    chartData.series.filter((series, index) => {
      const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
      return !isNoFillNoLineSeriesConfig(seriesConfig);
    }).length <= 1
  );
}

function xySeriesIndicesFromConfig(
  config: ChartConfig,
  chartData: ChartData,
  family: 'scatter' | 'bubble',
): number[] {
  return chartData.series.flatMap((series, index) => {
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    if (isNoFillNoLineSeriesConfig(seriesConfig)) return [];
    const type =
      seriesConfig?.type ??
      series.type ??
      (config.type === 'combo' ? defaultComboType(index) : config.type);
    if (family === 'scatter') return type === 'scatter' ? [index] : [];
    return type === 'bubble' || type === 'bubble3DEffect' ? [index] : [];
  });
}

function targetGeometrySeries(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
): CartesianSeriesSnapshot[] {
  const indexSet = new Set(seriesIndices);
  return cartesianGeometry.series.filter((series) => indexSet.has(series.seriesIndex));
}

function axisStatusDiagnostics(
  label: string,
  axis: {
    axisVisualStatus?: string;
    axisVisualStatusReason?: string;
    crossingStatus?: string;
    crossingStatusReason?: string;
    reservationStatus?: string;
    reservationStatusReason?: string;
  },
): string[] {
  const diagnostics: string[] = [];
  if (!isExactOrVerifiedDefaultStatus(axis.axisVisualStatus)) {
    diagnostics.push(
      `${label} axis visual status is ${axis.axisVisualStatus ?? 'missing'}; reason=${axis.axisVisualStatusReason ?? 'missing'}`,
    );
  }
  if (!isExactOrVerifiedDefaultStatus(axis.crossingStatus)) {
    diagnostics.push(
      `${label} axis crossing status is ${axis.crossingStatus ?? 'missing'}; reason=${axis.crossingStatusReason ?? 'missing'}`,
    );
  }
  if (!isExactOrVerifiedDefaultStatus(axis.reservationStatus)) {
    diagnostics.push(
      `${label} axis reservation status is ${axis.reservationStatus ?? 'missing'}; reason=${axis.reservationStatusReason ?? 'missing'}`,
    );
  }
  return diagnostics;
}

function seriesLayer(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndex: number,
  layerRole: NonNullable<CartesianLayerSnapshot['layerRole']>,
  predicate: (layer: CartesianLayerSnapshot) => boolean = () => true,
): CartesianLayerSnapshot | undefined {
  return cartesianGeometry.layers?.find(
    (layer) =>
      layer.layerRole === layerRole &&
      layer.seriesIndices.includes(seriesIndex) &&
      layer.pointCount > 0 &&
      predicate(layer),
  );
}

function isExactOrVerifiedDefaultStatus(status: string | undefined): boolean {
  return status === 'exact' || status === 'verifiedDefault';
}

function hasFinitePointPosition(point: CartesianPointSnapshot): boolean {
  return (
    isFiniteNumber(point.xPixel) &&
    isFiniteNumber(point.yPixel) &&
    isFiniteNumber(point.plotX) &&
    isFiniteNumber(point.plotY) &&
    isFiniteNumber(point.chartX) &&
    isFiniteNumber(point.chartY)
  );
}

function hasFiniteRenderedSize(point: CartesianPointSnapshot): boolean {
  return isFinitePositive(point.renderedRadius) || isFinitePositive(point.renderedArea);
}

function isFiniteRect(
  rect:
    | {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }
    | undefined,
): boolean {
  return (
    isFiniteNumber(rect?.x) &&
    isFiniteNumber(rect?.y) &&
    isFinitePositive(rect?.width) &&
    isFinitePositive(rect?.height)
  );
}

function isFinitePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1])
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function formatFiniteDiagnosticValue(value: unknown): string {
  return value === undefined ? 'missing' : String(value);
}

function defaultComboType(index: number): 'column' | 'line' {
  return index === 0 ? 'column' : 'line';
}
