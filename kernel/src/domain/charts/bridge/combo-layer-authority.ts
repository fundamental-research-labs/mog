import {
  isBarLikeChartType,
  isImportedStandardOoxmlChart,
  seriesConfigForDataSeries,
  type ChartConfig,
  type ChartData,
} from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import { isNoFillNoLineSeriesConfig } from './chart-render-data-normalizer';

type LegendSnapshot = ResolvedChartSpecSnapshot['resolved']['legend'];
type BarGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['barGeometry']
>[number];
type CartesianGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['cartesianGeometry']
>;
type CartesianLayerSnapshot = NonNullable<CartesianGeometrySnapshot['layers']>[number];
type CartesianSeriesSnapshot = CartesianGeometrySnapshot['series'][number];
type CartesianValueAxisSnapshot = CartesianGeometrySnapshot['valueAxes'][number];
type ComboAuthoritySnapshot = NonNullable<CartesianGeometrySnapshot['comboAuthority']>;
type ComboAuthorityStatus = ComboAuthoritySnapshot['status'];

const PLOT_FRAME_TOLERANCE_PX = 0.5;

export function withComboLayerAuthoritySnapshot(input: {
  config: ChartConfig;
  chartData: ChartData;
  legend: LegendSnapshot;
  barGeometry?: readonly BarGeometrySnapshot[];
  cartesianGeometry?: CartesianGeometrySnapshot;
}): CartesianGeometrySnapshot | undefined {
  const cartesianGeometry = input.cartesianGeometry;
  if (!cartesianGeometry) return undefined;
  if (input.config.type !== 'combo' || !isImportedStandardOoxmlChart(input.config)) {
    return cartesianGeometry;
  }

  const buckets = comboSeriesBuckets(input.config, input.chartData);
  if (buckets.nonBarSeriesIndices.length === 0) return cartesianGeometry;

  const diagnostics: string[] = [];
  const layerIndices = comboAuthorityLayerIndices(
    cartesianGeometry,
    buckets.nonBarSeriesIndices,
  );
  const barGroups = comboBarGroups(input.barGeometry, buckets.barSeriesIndices);
  const axisGroups = comboAuthorityAxisGroups(
    cartesianGeometry,
    barGroups,
    buckets.nonBarSeriesIndices,
  );
  const statuses = {
    plotFrameStatus: comboPlotFrameStatus(cartesianGeometry, barGroups, diagnostics),
    barGeometryStatus: comboBarGeometryStatus(
      barGroups,
      buckets.barSeriesIndices,
      diagnostics,
    ),
    nonBarPointAuthorityStatus: comboNonBarPointAuthorityStatus(
      cartesianGeometry,
      buckets.nonBarSeriesIndices,
      diagnostics,
    ),
    axisOwnershipStatus: comboAxisOwnershipStatus(
      input.config,
      input.chartData,
      cartesianGeometry,
      barGroups,
      buckets,
      diagnostics,
    ),
    valueAxisStatus: comboValueAxisStatus(
      cartesianGeometry,
      axisGroups,
      buckets,
      diagnostics,
    ),
    scaleConsistencyStatus: comboScaleConsistencyStatus(
      cartesianGeometry,
      axisGroups,
      buckets.nonBarSeriesIndices,
      diagnostics,
    ),
    layerOrderStatus: comboLayerOrderStatus(
      cartesianGeometry,
      buckets.nonBarSeriesIndices,
      diagnostics,
    ),
    legendOrderStatus: comboLegendOrderStatus(input.legend, diagnostics),
    styleStatus: comboStyleStatus(cartesianGeometry, buckets, diagnostics),
  };
  const status = combineAuthorityStatuses(Object.values(statuses));

  const comboAuthority = compactObject({
    schemaVersion: 1 as const,
    source: 'importedRendererEvidence' as const,
    status,
    ...(diagnostics.length > 0 ? { statusReason: diagnostics[0] } : {}),
    diagnostics: uniqueStrings(diagnostics),
    barSeriesIndices: buckets.barSeriesIndices,
    nonBarSeriesIndices: buckets.nonBarSeriesIndices,
    pathSeriesIndices: buckets.pathSeriesIndices,
    scatterSeriesIndices: buckets.scatterSeriesIndices,
    bubbleSeriesIndices: buckets.bubbleSeriesIndices,
    barGeometryGroupKeys: barGroups.map(barGeometryGroupKey),
    layerIndices,
    ...statuses,
  }) as ComboAuthoritySnapshot;

  return {
    ...cartesianGeometry,
    comboAuthority,
  };
}

function comboSeriesBuckets(config: ChartConfig, chartData: ChartData): {
  barSeriesIndices: number[];
  nonBarSeriesIndices: number[];
  pathSeriesIndices: number[];
  scatterSeriesIndices: number[];
  bubbleSeriesIndices: number[];
} {
  const buckets = {
    barSeriesIndices: [] as number[],
    nonBarSeriesIndices: [] as number[],
    pathSeriesIndices: [] as number[],
    scatterSeriesIndices: [] as number[],
    bubbleSeriesIndices: [] as number[],
  };
  const seriesConfigs = config.series ?? [];
  for (let index = 0; index < chartData.series.length; index += 1) {
    const series = chartData.series[index];
    const seriesConfig = seriesConfigForDataSeries(series, seriesConfigs, index);
    if (isNoFillNoLineSeriesConfig(seriesConfig)) continue;

    const seriesType = comboSeriesType(config, chartData, index);
    if (isBarLikeChartType(seriesType)) {
      buckets.barSeriesIndices.push(index);
      continue;
    }

    buckets.nonBarSeriesIndices.push(index);
    if (isPathComboSeriesType(seriesType)) buckets.pathSeriesIndices.push(index);
    if (seriesType === 'scatter') buckets.scatterSeriesIndices.push(index);
    if (seriesType === 'bubble' || seriesType === 'bubble3DEffect') {
      buckets.bubbleSeriesIndices.push(index);
    }
  }
  return buckets;
}

function comboSeriesType(
  config: ChartConfig,
  chartData: ChartData,
  index: number,
): string | undefined {
  const series = chartData.series[index];
  const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
  return seriesConfig?.type ?? series.type ?? (index === 0 ? 'column' : 'line');
}

function isPathComboSeriesType(seriesType: string | undefined): boolean {
  return (
    seriesType === 'line' ||
    seriesType === 'lineMarkers' ||
    seriesType === 'lineMarkersStacked' ||
    seriesType === 'lineMarkersStacked100' ||
    seriesType === 'area'
  );
}

function comboBarGroups(
  barGeometry: readonly BarGeometrySnapshot[] | undefined,
  barSeriesIndices: readonly number[],
): BarGeometrySnapshot[] {
  if (!barGeometry || barSeriesIndices.length === 0) return [];
  const barSeriesSet = new Set(barSeriesIndices);
  return barGeometry.filter((group) =>
    group.seriesIndices.some((seriesIndex) => barSeriesSet.has(seriesIndex)),
  );
}

function comboAuthorityLayerIndices(
  cartesianGeometry: CartesianGeometrySnapshot,
  nonBarSeriesIndices: readonly number[],
): number[] {
  const seriesSet = new Set(nonBarSeriesIndices);
  return uniqueNumbers(
    (cartesianGeometry.layers ?? []).flatMap((layer) =>
      layer.seriesIndices.some((seriesIndex) => seriesSet.has(seriesIndex))
        ? [layer.layerIndex]
        : [],
    ),
  );
}

function comboAuthorityAxisGroups(
  cartesianGeometry: CartesianGeometrySnapshot,
  barGroups: readonly BarGeometrySnapshot[],
  nonBarSeriesIndices: readonly number[],
): Array<'primary' | 'secondary'> {
  const groups = new Set<'primary' | 'secondary'>();
  for (const group of barGroups) {
    groups.add(group.axisGroup ?? (group.yAxisIndex === 1 ? 'secondary' : 'primary'));
  }
  const seriesSet = new Set(nonBarSeriesIndices);
  for (const series of cartesianGeometry.series) {
    if (seriesSet.has(series.seriesIndex)) groups.add(series.axisGroup);
  }
  for (const layer of cartesianGeometry.layers ?? []) {
    if (!layer.seriesIndices.some((seriesIndex) => seriesSet.has(seriesIndex))) continue;
    if (layer.yAxisRole === 'secondaryYValue') groups.add('secondary');
    if (layer.yAxisRole === 'primaryYValue') groups.add('primary');
  }
  return [...groups];
}

function comboPlotFrameStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  barGroups: readonly BarGeometrySnapshot[],
  diagnostics: string[],
): ComboAuthorityStatus {
  const statuses: ComboAuthorityStatus[] = [];
  if (cartesianGeometry.geometryStatus !== 'available') {
    diagnostics.push(
      `combo cartesian geometry is ${cartesianGeometry.geometryStatus ?? 'missing'}`,
    );
    statuses.push(cartesianGeometry.geometryStatus === undefined ? 'missing' : 'approximate');
  }
  if (cartesianGeometry.coordinateSystem !== 'chartPixel') {
    diagnostics.push(
      `combo cartesian geometry coordinateSystem is ${cartesianGeometry.coordinateSystem ?? 'missing'}; expected chartPixel`,
    );
    statuses.push(cartesianGeometry.coordinateSystem === undefined ? 'missing' : 'approximate');
  }
  if (!finiteRect(cartesianGeometry.plotArea)) {
    diagnostics.push('combo cartesian plot frame is missing or non-finite');
    statuses.push('missing');
  }
  if (barGroups.length === 0) return combineAuthorityStatuses(statuses);

  for (const group of barGroups) {
    const plotArea =
      group.rectangleReconciliation?.mogPlotArea ?? group.tracePlotArea ?? undefined;
    if (!finiteRect(plotArea)) {
      diagnostics.push(
        `combo bar geometry group ${barGeometryGroupKey(group)} is missing trace plot area`,
      );
      statuses.push('missing');
      continue;
    }
    if (!rectsAlign(cartesianGeometry.plotArea, plotArea)) {
      diagnostics.push(
        `combo bar geometry group ${barGeometryGroupKey(group)} plot frame does not align with cartesian overlay frame`,
      );
      statuses.push('approximate');
    } else {
      statuses.push('exact');
    }
  }
  return combineAuthorityStatuses(statuses);
}

function comboBarGeometryStatus(
  barGroups: readonly BarGeometrySnapshot[],
  barSeriesIndices: readonly number[],
  diagnostics: string[],
): ComboAuthorityStatus {
  if (barSeriesIndices.length === 0) return 'verifiedDefault';
  if (barGroups.length === 0) {
    diagnostics.push(
      `combo layer authority is missing bar geometry for visible bar series ${barSeriesIndices.join(', ')}`,
    );
    return 'missing';
  }

  const statuses: ComboAuthorityStatus[] = [];
  const covered = new Set<number>();
  for (const group of barGroups) {
    group.seriesIndices.forEach((seriesIndex) => covered.add(seriesIndex));
    statuses.push(
      statusFromExactContract(
        `combo bar group ${barGeometryGroupKey(group)} geometry`,
        group.geometryStatus,
        group.geometryStatusReason,
        diagnostics,
      ),
      statusFromExactContract(
        `combo bar group ${barGeometryGroupKey(group)} axis layout`,
        group.axisLayoutStatus,
        group.axisLayoutStatusReason,
        diagnostics,
      ),
      statusFromExactContract(
        `combo bar group ${barGeometryGroupKey(group)} category pitch`,
        group.categoryPitchStatus,
        group.categoryPitchStatusReason,
        diagnostics,
      ),
      statusFromExactContract(
        `combo bar group ${barGeometryGroupKey(group)} category tick`,
        group.categoryTickStatus,
        group.categoryTickStatusReason,
        diagnostics,
      ),
      statusFromExactContract(
        `combo bar group ${barGeometryGroupKey(group)} value-axis scale`,
        group.valueAxisScaleStatus,
        group.valueAxisScaleStatusReason,
        diagnostics,
      ),
      statusFromAvailableContract(
        `combo bar group ${barGeometryGroupKey(group)} trace`,
        group.traceStatus,
        group.traceStatusReason,
        diagnostics,
      ),
      statusFromExactContract(
        `combo bar group ${barGeometryGroupKey(group)} rectangle reconciliation`,
        group.rectangleReconciliation?.status,
        group.rectangleReconciliation?.statusReason,
        diagnostics,
      ),
    );
  }

  const missing = barSeriesIndices.filter((seriesIndex) => !covered.has(seriesIndex));
  if (missing.length > 0) {
    diagnostics.push(
      `combo layer authority bar geometry does not cover visible bar series ${missing.join(', ')}`,
    );
    statuses.push('missing');
  }
  return combineAuthorityStatuses(statuses);
}

function comboNonBarPointAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  nonBarSeriesIndices: readonly number[],
  diagnostics: string[],
): ComboAuthorityStatus {
  const statuses: ComboAuthorityStatus[] = [];
  for (const seriesIndex of nonBarSeriesIndices) {
    const series = cartesianGeometry.series.find((item) => item.seriesIndex === seriesIndex);
    const points = series?.pointGeometry ?? [];
    if (!series || points.length === 0) {
      diagnostics.push(
        `combo layer authority is missing non-bar point geometry for series ${seriesIndex}`,
      );
      statuses.push('missing');
      continue;
    }
    const nonFinite = points.filter((point) => !finitePointGeometry(point)).length;
    if (nonFinite > 0) {
      diagnostics.push(
        `combo non-bar series ${seriesIndex} has ${nonFinite} non-finite point geometry trace(s)`,
      );
      statuses.push('approximate');
    } else {
      statuses.push('exact');
    }
  }
  return combineAuthorityStatuses(statuses);
}

function comboAxisOwnershipStatus(
  config: ChartConfig,
  chartData: ChartData,
  cartesianGeometry: CartesianGeometrySnapshot,
  barGroups: readonly BarGeometrySnapshot[],
  buckets: ReturnType<typeof comboSeriesBuckets>,
  diagnostics: string[],
): ComboAuthorityStatus {
  const statuses: ComboAuthorityStatus[] = [];
  const barSeriesSet = new Set(buckets.barSeriesIndices);
  for (const group of barGroups) {
    const expected = group.yAxisIndex === 1 ? 'secondary' : 'primary';
    const actual = group.axisGroup ?? expected;
    if (actual !== expected) {
      diagnostics.push(
        `combo bar group ${barGeometryGroupKey(group)} axis ownership is ${actual}; expected ${expected}`,
      );
      statuses.push('approximate');
    } else {
      statuses.push('exact');
    }
    group.seriesIndices.forEach((seriesIndex) => barSeriesSet.delete(seriesIndex));
  }
  if (barSeriesSet.size > 0) {
    diagnostics.push(
      `combo axis ownership is missing bar geometry for series ${[...barSeriesSet].join(', ')}`,
    );
    statuses.push('missing');
  }

  for (const seriesIndex of buckets.nonBarSeriesIndices) {
    const series = cartesianGeometry.series.find((item) => item.seriesIndex === seriesIndex);
    if (!series) {
      diagnostics.push(`combo axis ownership is missing cartesian series ${seriesIndex}`);
      statuses.push('missing');
      continue;
    }

    const seriesConfig = seriesConfigForDataSeries(
      chartData.series[seriesIndex],
      config.series ?? [],
      seriesIndex,
    );
    const expectedAxisGroup = (seriesConfig?.yAxisIndex ?? chartData.series[seriesIndex]?.yAxisIndex) === 1
      ? 'secondary'
      : 'primary';
    if (series.axisGroup !== expectedAxisGroup) {
      diagnostics.push(
        `combo non-bar series ${seriesIndex} y-axis ownership is ${series.axisGroup}; expected ${expectedAxisGroup}`,
      );
      statuses.push('approximate');
    } else {
      statuses.push('exact');
    }

    const layers = layersForSeries(cartesianGeometry, seriesIndex);
    if (layers.length === 0) {
      diagnostics.push(`combo non-bar series ${seriesIndex} is missing layer axis ownership`);
      statuses.push('missing');
      continue;
    }
    const expectedYRole =
      expectedAxisGroup === 'secondary' ? 'secondaryYValue' : 'primaryYValue';
    const expectedXRole = series.xRole === 'quantitative' ? 'xValue' : undefined;
    for (const layer of layers) {
      if (layer.yAxisRole !== expectedYRole) {
        diagnostics.push(
          `combo layer ${layer.layerIndex} y-axis role is ${layer.yAxisRole ?? 'missing'}; expected ${expectedYRole}`,
        );
        statuses.push(layer.yAxisRole === undefined ? 'missing' : 'approximate');
      }
      if (expectedXRole && layer.xAxisRole !== expectedXRole) {
        diagnostics.push(
          `combo layer ${layer.layerIndex} x-axis role is ${layer.xAxisRole ?? 'missing'}; expected ${expectedXRole}`,
        );
        statuses.push(layer.xAxisRole === undefined ? 'missing' : 'approximate');
      }
    }
  }
  return combineAuthorityStatuses(statuses);
}

function comboValueAxisStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  axisGroups: readonly ('primary' | 'secondary')[],
  buckets: ReturnType<typeof comboSeriesBuckets>,
  diagnostics: string[],
): ComboAuthorityStatus {
  const statuses: ComboAuthorityStatus[] = [];
  for (const axisGroup of axisGroups) {
    const axis = cartesianGeometry.valueAxes.find((item) => item.axisGroup === axisGroup);
    if (!axis) {
      diagnostics.push(`combo layer authority is missing ${axisGroup} value-axis evidence`);
      statuses.push('missing');
      continue;
    }
    statuses.push(...valueAxisContractStatuses(`${axisGroup} value axis`, axis, diagnostics));
  }

  if (buckets.scatterSeriesIndices.length > 0 || buckets.bubbleSeriesIndices.length > 0) {
    const xAxis = cartesianGeometry.x.quantitative;
    if (!xAxis) {
      diagnostics.push('combo scatter/bubble layer authority is missing quantitative x-axis evidence');
      statuses.push('missing');
    } else {
      statuses.push(
        statusFromExactContract(
          'combo quantitative x-axis visual',
          xAxis.axisVisualStatus,
          xAxis.axisVisualStatusReason,
          diagnostics,
        ),
        statusFromExactContract(
          'combo quantitative x-axis crossing',
          xAxis.crossingStatus,
          xAxis.crossingStatusReason,
          diagnostics,
        ),
        statusFromExactContract(
          'combo quantitative x-axis reservation',
          xAxis.reservationStatus,
          xAxis.reservationStatusReason,
          diagnostics,
        ),
      );
      if (!xAxis.domain || !xAxis.range || !xAxis.plotRange || !xAxis.tickValues) {
        diagnostics.push('combo quantitative x-axis is missing domain, range, plot range, or tick evidence');
        statuses.push('missing');
      }
    }
  }

  return combineAuthorityStatuses(statuses);
}

function valueAxisContractStatuses(
  label: string,
  axis: CartesianValueAxisSnapshot,
  diagnostics: string[],
): ComboAuthorityStatus[] {
  return [
    statusFromExactContract(label + ' visual', axis.axisVisualStatus, axis.axisVisualStatusReason, diagnostics),
    statusFromExactContract(label + ' crossing', axis.crossingStatus, axis.crossingStatusReason, diagnostics),
    statusFromExactContract(label + ' reservation', axis.reservationStatus, axis.reservationStatusReason, diagnostics),
    statusFromExactContract(
      label + ' layout',
      axis.valueAxisLayoutStatus ?? axis.axisLayoutStatus,
      axis.valueAxisLayoutStatusReason ?? axis.axisLayoutStatusReason,
      diagnostics,
    ),
  ];
}

function comboScaleConsistencyStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  axisGroups: readonly ('primary' | 'secondary')[],
  nonBarSeriesIndices: readonly number[],
  diagnostics: string[],
): ComboAuthorityStatus {
  const statuses: ComboAuthorityStatus[] = [];
  for (const axisGroup of axisGroups) {
    const axis = cartesianGeometry.valueAxes.find((item) => item.axisGroup === axisGroup);
    if (!axis) {
      statuses.push('missing');
      continue;
    }
    if (axis.scaleConsistencyStatus !== 'consistent') {
      diagnostics.push(
        `combo ${axisGroup} value-axis scale consistency is ${axis.scaleConsistencyStatus ?? 'missing'}; reason=${axis.scaleConsistencyReason ?? 'missing'}`,
      );
      statuses.push(axis.scaleConsistencyStatus === undefined ? 'missing' : 'approximate');
    } else {
      statuses.push('exact');
    }
  }

  const seriesSet = new Set(nonBarSeriesIndices);
  for (const layer of cartesianGeometry.layers ?? []) {
    if (!layer.seriesIndices.some((seriesIndex) => seriesSet.has(seriesIndex))) continue;
    if (layer.yScale?.scaleConsistencyStatus !== 'consistent') {
      diagnostics.push(
        `combo layer ${layer.layerIndex} y-scale consistency is ${layer.yScale?.scaleConsistencyStatus ?? 'missing'}; reason=${layer.yScale?.scaleConsistencyReason ?? 'missing'}`,
      );
      statuses.push(layer.yScale?.scaleConsistencyStatus === undefined ? 'missing' : 'approximate');
    } else {
      statuses.push('exact');
    }
  }
  return combineAuthorityStatuses(statuses);
}

function comboLayerOrderStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  nonBarSeriesIndices: readonly number[],
  diagnostics: string[],
): ComboAuthorityStatus {
  const seriesSet = new Set(nonBarSeriesIndices);
  const layers = (cartesianGeometry.layers ?? []).filter((layer) =>
    layer.seriesIndices.some((seriesIndex) => seriesSet.has(seriesIndex)),
  );
  if (layers.length === 0) {
    diagnostics.push('combo layer authority is missing non-bar layer order evidence');
    return 'missing';
  }

  const statuses: ComboAuthorityStatus[] = [];
  for (const layer of layers) {
    if (
      (layer.layerRole === 'linePath' || layer.layerRole === 'areaFill') &&
      layer.pathOrder !== 'source'
    ) {
      diagnostics.push(
        `combo layer ${layer.layerIndex} path order is ${layer.pathOrder ?? 'missing'}; expected source`,
      );
      statuses.push(layer.pathOrder === undefined ? 'missing' : 'approximate');
    } else {
      statuses.push('exact');
    }
  }

  for (const seriesIndex of nonBarSeriesIndices) {
    const seriesLayers = layersForSeries(cartesianGeometry, seriesIndex);
    const areaLayer = firstLayerIndex(seriesLayers, 'areaFill');
    const lineLayer = firstLayerIndex(seriesLayers, 'linePath');
    const markerLayer = firstLayerIndex(seriesLayers, 'marker');
    if (areaLayer !== undefined && markerLayer !== undefined && areaLayer > markerLayer) {
      diagnostics.push(
        `combo area layer ${areaLayer} renders after marker layer ${markerLayer} for series ${seriesIndex}`,
      );
      statuses.push('approximate');
    }
    if (lineLayer !== undefined && markerLayer !== undefined && lineLayer > markerLayer) {
      diagnostics.push(
        `combo line layer ${lineLayer} renders after marker layer ${markerLayer} for series ${seriesIndex}`,
      );
      statuses.push('approximate');
    }
  }
  return combineAuthorityStatuses(statuses);
}

function comboLegendOrderStatus(
  legend: LegendSnapshot,
  diagnostics: string[],
): ComboAuthorityStatus {
  if (!legend.present || legend.visible === false) return 'verifiedDefault';
  const expected = (legend.visibleEntryItems ?? []).map(legendEntryOrderKey);
  if (expected.length === 0) return 'verifiedDefault';
  const rendered = legend.rendered?.entries;
  if (!rendered || rendered.length === 0) {
    diagnostics.push('combo legend rendered entry order evidence is missing');
    return 'missing';
  }
  const actual = rendered.map(renderedLegendEntryOrderKey);
  if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index])) {
    diagnostics.push(
      `combo legend rendered order ${actual.join(' | ')} does not match expected order ${expected.join(' | ')}`,
    );
    return 'approximate';
  }
  return 'exact';
}

function comboStyleStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  buckets: ReturnType<typeof comboSeriesBuckets>,
  diagnostics: string[],
): ComboAuthorityStatus {
  const statuses: ComboAuthorityStatus[] = [];
  const pathSeries = new Set(buckets.pathSeriesIndices);
  const scatterSeries = new Set(buckets.scatterSeriesIndices);
  const bubbleSeries = new Set(buckets.bubbleSeriesIndices);
  for (const seriesIndex of buckets.nonBarSeriesIndices) {
    const series = cartesianGeometry.series.find((item) => item.seriesIndex === seriesIndex);
    if (!series) {
      diagnostics.push(`combo style authority is missing cartesian series ${seriesIndex}`);
      statuses.push('missing');
      continue;
    }

    if (pathSeries.has(seriesIndex)) {
      statuses.push(...pathStyleStatuses(series, diagnostics));
    } else if (scatterSeries.has(seriesIndex)) {
      statuses.push(...scatterStyleStatuses(series, diagnostics));
    } else if (bubbleSeries.has(seriesIndex)) {
      statuses.push(...bubbleStyleStatuses(series, diagnostics));
    } else {
      diagnostics.push(`combo style authority does not classify non-bar series ${seriesIndex}`);
      statuses.push('approximate');
    }
  }
  return combineAuthorityStatuses(statuses);
}

function pathStyleStatuses(
  series: CartesianSeriesSnapshot,
  diagnostics: string[],
): ComboAuthorityStatus[] {
  const statuses: ComboAuthorityStatus[] = [];
  const hasVisibleInk =
    series.lineVisibleInk === true ||
    series.markerVisibleInk === true ||
    series.markerLayer === true ||
    series.areaSurfaceStyle !== undefined;
  if (hasVisibleInk) {
    statuses.push(
      statusFromExactContract(
        `combo path series ${series.seriesIndex} color authority`,
        series.colorAuthorityStatus,
        series.colorAuthorityReason,
        diagnostics,
      ),
    );
  }
  statuses.push(
    statusFromExactContract(
      `combo path series ${series.seriesIndex} line visual`,
      series.lineVisualStatus,
      series.lineVisualStatusReason,
      diagnostics,
    ),
    statusFromExactContract(
      `combo path series ${series.seriesIndex} blank-marker policy`,
      series.blankMarkerPolicyStatus,
      series.blankMarkerPolicyStatusReason,
      diagnostics,
    ),
  );
  if (series.sourceShowMarkers || series.markerVisibleInk || series.markerLayer) {
    statuses.push(
      statusFromExactContract(
        `combo path series ${series.seriesIndex} marker visual`,
        series.markerVisualStatus,
        series.markerVisualStatusReason,
        diagnostics,
      ),
    );
  }
  if (series.areaSurfaceStyle) {
    statuses.push(
      statusFromExactContract(
        `combo area series ${series.seriesIndex} surface style`,
        series.areaSurfaceStyle.styleStatus,
        series.areaSurfaceStyle.styleStatusReason,
        diagnostics,
      ),
    );
  }
  if (series.areaSurfaceExtent) {
    statuses.push(
      statusFromExactContract(
        `combo area series ${series.seriesIndex} surface extent`,
        series.areaSurfaceExtent.extentStatus,
        series.areaSurfaceExtent.extentStatusReason,
        diagnostics,
      ),
    );
  }
  return statuses;
}

function scatterStyleStatuses(
  series: CartesianSeriesSnapshot,
  diagnostics: string[],
): ComboAuthorityStatus[] {
  const statuses = [
    statusFromExactContract(
      `combo scatter series ${series.seriesIndex} color authority`,
      series.colorAuthorityStatus,
      series.colorAuthorityReason,
      diagnostics,
    ),
    statusFromExactContract(
      `combo scatter series ${series.seriesIndex} marker visual`,
      series.markerVisualStatus,
      series.markerVisualStatusReason,
      diagnostics,
    ),
  ];
  if (series.lineVisibleInk || series.sourceShowLines) {
    statuses.push(
      statusFromExactContract(
        `combo scatter series ${series.seriesIndex} line visual`,
        series.lineVisualStatus,
        series.lineVisualStatusReason,
        diagnostics,
      ),
    );
  }
  return statuses;
}

function bubbleStyleStatuses(
  series: CartesianSeriesSnapshot,
  diagnostics: string[],
): ComboAuthorityStatus[] {
  return [
    statusFromExactContract(
      `combo bubble series ${series.seriesIndex} color authority`,
      series.colorAuthorityStatus,
      series.colorAuthorityReason,
      diagnostics,
    ),
    statusFromExactContract(
      `combo bubble series ${series.seriesIndex} bubble visual`,
      series.bubbleVisualStatus,
      series.bubbleVisualStatusReason,
      diagnostics,
    ),
  ];
}

function statusFromExactContract(
  label: string,
  status: string | undefined,
  reason: string | undefined,
  diagnostics: string[],
): ComboAuthorityStatus {
  if (status === 'exact' || status === 'verifiedDefault') return status;
  diagnostics.push(`${label} is ${status ?? 'missing'}; reason=${reason ?? 'missing'}`);
  return status === undefined || status === 'missing' ? 'missing' : 'approximate';
}

function statusFromAvailableContract(
  label: string,
  status: string | undefined,
  reason: string | undefined,
  diagnostics: string[],
): ComboAuthorityStatus {
  if (status === 'available') return 'exact';
  diagnostics.push(`${label} is ${status ?? 'missing'}; reason=${reason ?? 'missing'}`);
  return status === undefined || status === 'missing' ? 'missing' : 'approximate';
}

function combineAuthorityStatuses(
  statuses: readonly (ComboAuthorityStatus | undefined)[],
): ComboAuthorityStatus {
  const resolved = statuses.filter(
    (status): status is ComboAuthorityStatus => status !== undefined,
  );
  if (resolved.length === 0) return 'exact';
  if (resolved.includes('missing')) return 'missing';
  if (resolved.includes('approximate')) return 'approximate';
  if (resolved.includes('verifiedDefault')) return 'verifiedDefault';
  return 'exact';
}

function layersForSeries(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndex: number,
): CartesianLayerSnapshot[] {
  return (cartesianGeometry.layers ?? []).filter((layer) =>
    layer.seriesIndices.includes(seriesIndex),
  );
}

function firstLayerIndex(
  layers: readonly CartesianLayerSnapshot[],
  role: NonNullable<CartesianLayerSnapshot['layerRole']>,
): number | undefined {
  return layers.find((layer) => layer.layerRole === role)?.layerIndex;
}

function finitePointGeometry(point: {
  xPixel?: number;
  yPixel?: number;
  plotX?: number;
  plotY?: number;
  chartX?: number;
  chartY?: number;
}): boolean {
  return (
    finiteNumber(point.xPixel) !== undefined &&
    finiteNumber(point.yPixel) !== undefined &&
    finiteNumber(point.plotX) !== undefined &&
    finiteNumber(point.plotY) !== undefined &&
    finiteNumber(point.chartX) !== undefined &&
    finiteNumber(point.chartY) !== undefined
  );
}

function rectsAlign(
  first: { x?: number; y?: number; width?: number; height?: number } | undefined,
  second: { x?: number; y?: number; width?: number; height?: number } | undefined,
): boolean {
  if (!finiteRect(first) || !finiteRect(second)) return false;
  return (
    Math.abs(first.x - second.x) <= PLOT_FRAME_TOLERANCE_PX &&
    Math.abs(first.y - second.y) <= PLOT_FRAME_TOLERANCE_PX &&
    Math.abs(first.width - second.width) <= PLOT_FRAME_TOLERANCE_PX &&
    Math.abs(first.height - second.height) <= PLOT_FRAME_TOLERANCE_PX
  );
}

function finiteRect(
  rect: { x?: number; y?: number; width?: number; height?: number } | undefined,
): rect is { x: number; y: number; width: number; height: number } {
  return (
    finiteNumber(rect?.x) !== undefined &&
    finiteNumber(rect?.y) !== undefined &&
    positiveNumber(rect?.width) !== undefined &&
    positiveNumber(rect?.height) !== undefined
  );
}

function barGeometryGroupKey(group: BarGeometrySnapshot): string {
  return group.groupKey ?? `series:${group.seriesIndices.join(',') || 'unknown'}`;
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

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function uniqueNumbers(values: readonly number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const numeric = finiteNumber(value);
  return numeric !== undefined && numeric > 0 ? numeric : undefined;
}
