import {
  barBaselinePixelForDomain,
  buildExcelCartesianGeometryPlan,
  buildPieDoughnutGeometry,
  chartImportSourceDialect,
  excelBarSlotGeometry,
  pieDoughnutLayoutHintsForConfig,
  resolveBarGeometryGroups,
  seriesConfigForDataSeries,
  type BarGeometryGroupTrace,
  type BarGeometryTrace,
  type CartesianGeometryLayerTrace,
  type CartesianGeometryPointTrace,
  type CartesianGeometryScaleTrace,
  type CartesianGeometryTrace,
  type ChartConfig,
  type ChartData,
  type LegendTrace,
  type PieDoughnutLabelLayoutTrace,
  type BarGeometryGroup,
  type SurfaceApproximationTrace,
  type StockGlyphTrace,
  type ThreeDApproximationTrace,
} from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import { isNoFillNoLineSeriesConfig } from './chart-render-data-normalizer';
import { surfaceApproximationContractForConfig } from './resolved-spec-diagnostics-surface';

type BarGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['barGeometry']
>[number];
type CartesianGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['cartesianGeometry']
>;
type PieDoughnutGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['pieDoughnutGeometry']
>;
type PieDoughnutGeometryModel = NonNullable<ReturnType<typeof buildPieDoughnutGeometry>>;
type PieDoughnutVisualStatus = PieDoughnutGeometrySnapshot['legendLayoutStatus'];
type PieDoughnutBoxSnapshot = NonNullable<
  PieDoughnutGeometrySnapshot['explosionEnvelope']
>['slices'][number]['arcBox'];
type PieDoughnutLabelLayoutSnapshot = NonNullable<PieDoughnutGeometrySnapshot['labelLayout']>;
type PieDoughnutLabelLayoutEntrySnapshot = PieDoughnutLabelLayoutSnapshot['labels'][number];
type LegendSnapshot = ResolvedChartSpecSnapshot['resolved']['legend'];
type StockGlyphGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['stockGlyphGeometry']
>;
type ThreeDApproximationSnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['threeDApproximation']
>;
type SurfaceApproximationSnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['surfaceApproximation']
>;
type SurfaceApproximationContractKind = SurfaceApproximationSnapshot['contractKind'];
type FamilySupportSnapshot = NonNullable<ResolvedChartSpecSnapshot['implementation']['familySupport']>;
type CartesianGeometryAxisRole = NonNullable<
  CartesianGeometrySnapshot['layers']
>[number]['xAxisRole'];
type CartesianGeometryValueAxisRole = NonNullable<
  CartesianGeometrySnapshot['layers']
>[number]['yAxisRole'];
type ExcelCartesianGeometryPlanSnapshot = NonNullable<
  ReturnType<typeof buildExcelCartesianGeometryPlan>
>;
type ExcelCartesianPathAxisLayoutSnapshot = NonNullable<
  NonNullable<ExcelCartesianGeometryPlanSnapshot['x']['category']>['pathAxisLayout']
>;
type CartesianValueAxisSnapshot = CartesianGeometrySnapshot['valueAxes'][number];
type CartesianPathAxisLayoutSnapshot = NonNullable<
  NonNullable<CartesianGeometrySnapshot['x']['category']>['pathAxisLayout']
>;
type CartesianPathPlotFrameSnapshot = NonNullable<CartesianGeometrySnapshot['pathPlotFrame']>;
type CartesianPointAuthoritySnapshot = NonNullable<
  CartesianGeometrySnapshot['pointAuthority']
>[number];
type CartesianPointAuthorityStatus = CartesianPointAuthoritySnapshot['status'];

const CATEGORY_FIELD = 'category';
const AXIS_CROSSING_TOLERANCE_PX = 0.5;
const PIE_DOUGHNUT_LABEL_TOLERANCE_PX = 0.5;

export function snapshotBarGeometry(
  config: ChartConfig,
  chartData: ChartData,
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
  barTrace?: BarGeometryTrace,
): BarGeometrySnapshot[] | undefined {
  const groups = resolveBarGeometryGroups(config, chartData, {
    includeSeries: ({ seriesConfig }) => !isNoFillNoLineSeriesConfig(seriesConfig),
  });
  if (groups.length === 0) return undefined;

  const visibleCategoryCount = chartData.categories.length;
  return groups.map((group) => {
    const geometry = group.geometry;
    const traceGroup = matchingBarTraceGroup(group, barTrace);
    const hasAvailableTrace = traceGroup?.traceStatus === 'available';
    const categoryAxisLength =
      hasAvailableTrace
        ? traceGroup.categoryAxisLength
        : geometry.orientation === 'horizontal'
          ? layout?.plotArea.height
          : layout?.plotArea.width;
    const categoryPitch =
      hasAvailableTrace
        ? traceGroup.categoryPitch
        : categoryAxisLength !== undefined
        ? categoryPitchForPolicy(
            categoryAxisLength,
            visibleCategoryCount,
            geometry.categoryPositionPolicy,
          )
        : undefined;
    const offsets =
      hasAvailableTrace
        ? traceGroup.offsets
        : categoryPitch !== undefined
        ? group.seriesIndices.map((seriesIndex, sourceSlotIndex) => ({
            seriesIndex,
            offset: excelBarSlotGeometry(
              categoryPitch,
              group.seriesIndices.length,
              visualSlotIndex(sourceSlotIndex, group.seriesIndices.length, geometry.seriesSlotOrder),
              geometry,
            ).offset,
          }))
        : undefined;
    const barSize =
      hasAvailableTrace
        ? traceGroup.barSize
        : categoryPitch !== undefined
        ? excelBarSlotGeometry(categoryPitch, group.seriesIndices.length, 0, geometry).size
        : undefined;
    const baselinePixel = hasAvailableTrace
      ? traceGroup.baselinePixel
      : baselinePixelForGeometry(geometry, layout);
    const categoryPitchContract = resolvedCategoryPitchContract(
      geometry,
      categoryPitch,
      traceGroup,
    );
    const resolvedGeometryStatus = resolvedBarGeometryStatus(
      geometry,
      categoryPitchContract,
      traceGroup,
    );

    return {
      groupKey: group.key,
      orientation: geometry.orientation,
      grouping: geometry.grouping,
      sourceGapWidth: geometry.sourceGapWidth,
      sourceOverlap: geometry.sourceOverlap,
      gapWidth: geometry.gapWidth,
      overlap: geometry.overlap,
      ...(geometry.gapWidthClamped !== undefined ? { gapWidthClamped: geometry.gapWidthClamped } : {}),
      ...(geometry.overlapClamped !== undefined ? { overlapClamped: geometry.overlapClamped } : {}),
      seriesIndices: group.seriesIndices,
      ...(group.yAxisIndex !== undefined ? { yAxisIndex: group.yAxisIndex } : {}),
      axisGroup: (group.yAxisIndex ?? 0) === 1 ? 'secondary' : 'primary',
      memberCount: group.seriesIndices.length,
      layerRole: 'bar',
      ...(geometry.seriesSlotOrder !== undefined ? { seriesSlotOrder: geometry.seriesSlotOrder } : {}),
      categoryAxisRole: geometry.categoryAxisRole,
      valueAxisRole: geometry.valueAxisRole,
      categoryPositionPolicy: geometry.categoryPositionPolicy,
      ...(geometry.categoryTickLabelSkip !== undefined
        ? { categoryTickLabelSkip: geometry.categoryTickLabelSkip }
        : {}),
      ...(geometry.categoryTickMarkSkip !== undefined
        ? { categoryTickMarkSkip: geometry.categoryTickMarkSkip }
        : {}),
      ...(geometry.categoryTickSkipSource !== undefined
        ? { categoryTickSkipSource: geometry.categoryTickSkipSource }
        : {}),
      categoryCrossing: geometry.categoryCrossing,
      valueCrossing: geometry.valueCrossing,
      ...(geometry.valueCrossingValue !== undefined
        ? { valueCrossingValue: geometry.valueCrossingValue }
        : {}),
      ...(geometry.baselineValue !== undefined ? { baselineValue: geometry.baselineValue } : {}),
      ...(baselinePixel !== undefined ? { baselinePixel } : {}),
      ...(geometry.valueAxisDomain !== undefined
        ? { valueAxisDomain: geometry.valueAxisDomain }
        : {}),
      ...(geometry.valueAxisTickStep !== undefined
        ? { valueAxisTickStep: geometry.valueAxisTickStep }
        : {}),
      ...(geometry.valueAxisTickCount !== undefined
        ? { valueAxisTickCount: geometry.valueAxisTickCount }
        : {}),
      ...(geometry.percentDomain !== undefined ? { percentDomain: geometry.percentDomain } : {}),
      ...(geometry.percentAxisLabelPolicy !== undefined
        ? { percentAxisLabelPolicy: geometry.percentAxisLabelPolicy }
        : {}),
      ...(geometry.categoryTickStatus !== undefined
        ? { categoryTickStatus: geometry.categoryTickStatus }
        : {}),
      ...(geometry.categoryTickStatusReason !== undefined
        ? { categoryTickStatusReason: geometry.categoryTickStatusReason }
        : {}),
      ...(geometry.valueAxisScaleSource !== undefined
        ? { valueAxisScaleSource: geometry.valueAxisScaleSource }
        : {}),
      ...(geometry.valueAxisScaleStatus !== undefined
        ? { valueAxisScaleStatus: geometry.valueAxisScaleStatus }
        : {}),
      ...(geometry.valueAxisScaleStatusReason !== undefined
        ? { valueAxisScaleStatusReason: geometry.valueAxisScaleStatusReason }
        : {}),
      ...(geometry.axisLayoutStatus !== undefined
        ? { axisLayoutStatus: geometry.axisLayoutStatus }
        : {}),
      ...(geometry.axisLayoutStatusReason !== undefined
        ? { axisLayoutStatusReason: geometry.axisLayoutStatusReason }
        : {}),
      ...resolvedGeometryStatus,
      plotAreaSource: geometry.plotAreaSource,
      ...(geometry.plotAreaAuthority !== undefined
        ? { plotAreaAuthority: geometry.plotAreaAuthority }
        : {}),
      ...(hasAvailableTrace ? { plotAreaAuthority: 'barPostRenderTrace' as const } : {}),
      ...categoryPitchContract,
      ...(categoryAxisLength !== undefined ? { categoryAxisLength } : {}),
      visibleCategoryCount,
      ...(categoryPitch !== undefined ? { categoryPitch } : {}),
      ...(barSize !== undefined ? { barSize } : {}),
      ...(offsets !== undefined ? { offsets } : {}),
      ...(traceGroup ? traceSnapshotFields(barTrace, traceGroup) : {}),
    };
  });
}

function resolvedCategoryPitchContract(
  geometry: BarGeometryGroup['geometry'],
  categoryPitch: number | undefined,
  traceGroup?: BarGeometryGroupTrace,
): Pick<
  BarGeometrySnapshot,
  'categoryPitchAuthority' | 'categoryPitchStatus' | 'categoryPitchStatusReason'
> {
  if (traceGroup?.traceStatus === 'available' && categoryPitch !== undefined) {
    return {
      categoryPitchAuthority: 'barPostRenderTrace',
      categoryPitchStatus: 'exact',
    };
  }

  const categoryPitchAuthority =
    geometry.categoryPitchAuthority ??
    geometry.plotAreaAuthority ??
    (geometry.plotAreaSource === 'manual' ? 'manualLayout' : 'rendererAuto');

  if (geometry.categoryPitchStatus === 'approximate') {
    return {
      categoryPitchAuthority,
      categoryPitchStatus: 'approximate',
      categoryPitchStatusReason:
        geometry.categoryPitchStatusReason ?? 'importedAutoPlotAreaCategoryPitch',
    };
  }
  if (categoryPitch === undefined) {
    return { categoryPitchAuthority };
  }
  if (categoryPitchAuthority === 'manualLayout' || categoryPitchAuthority === 'excelAutoModel') {
    return {
      categoryPitchAuthority,
      categoryPitchStatus: 'exact',
    };
  }
  return {
    categoryPitchAuthority,
    categoryPitchStatus: geometry.categoryPitchStatus ?? 'verifiedDefault',
    ...(geometry.categoryPitchStatusReason
      ? { categoryPitchStatusReason: geometry.categoryPitchStatusReason }
      : {}),
  };
}

function resolvedBarGeometryStatus(
  geometry: BarGeometryGroup['geometry'],
  categoryPitchContract: Pick<
    BarGeometrySnapshot,
    'categoryPitchStatus' | 'categoryPitchStatusReason'
  >,
  traceGroup?: BarGeometryGroupTrace,
): Pick<BarGeometrySnapshot, 'geometryStatus' | 'geometryStatusReason'> {
  const categoryPitchStatus = categoryPitchContract.categoryPitchStatus;
  const statusValues = [
    categoryPitchStatus,
    geometry.categoryTickStatus,
    geometry.valueAxisScaleStatus,
  ];
  const approximateReason =
    categoryPitchStatus === 'approximate'
      ? categoryPitchContract.categoryPitchStatusReason
      : geometry.categoryTickStatus === 'approximate'
        ? geometry.categoryTickStatusReason
        : geometry.valueAxisScaleStatus === 'approximate'
          ? geometry.valueAxisScaleStatusReason
          : geometry.geometryStatusReason ?? geometry.axisLayoutStatusReason;

  if (
    statusValues.some((status) => status === 'approximate') ||
    traceGroup?.traceStatus === 'mismatch' ||
    traceGroup?.traceStatus === 'unavailable' ||
    (geometry.geometryStatus === 'approximate' &&
      !isTracePromotableImportedAutoGeometry(geometry, traceGroup))
  ) {
    return {
      geometryStatus: 'approximate',
      ...(traceGroup?.traceStatusReason
        ? { geometryStatusReason: traceGroup.traceStatusReason }
        : approximateReason
          ? { geometryStatusReason: approximateReason }
          : {}),
    };
  }
  if (statusValues.some((status) => status === undefined) || geometry.geometryStatus === undefined) {
    return {};
  }
  return {
    geometryStatus:
      geometry.geometryStatus === 'verifiedDefault' ? 'verifiedDefault' : 'exact',
  };
}

function isTracePromotableImportedAutoGeometry(
  geometry: BarGeometryGroup['geometry'],
  traceGroup: BarGeometryGroupTrace | undefined,
): boolean {
  return (
    traceGroup?.traceStatus === 'available' &&
    geometry.geometryStatusReason === 'importedAutoPlotAreaCategoryPitch'
  );
}

function matchingBarTraceGroup(
  group: BarGeometryGroup,
  trace: BarGeometryTrace | undefined,
): BarGeometryGroupTrace | undefined {
  if (!trace) return undefined;
  const candidates = trace.layers.flatMap((layer) => layer.groups);
  return (
    candidates.find(
      (candidate) =>
        candidate.groupKey === group.key &&
        sameSeriesIndices(candidate.seriesIndices, group.seriesIndices),
    ) ??
    candidates.find((candidate) => sameSeriesIndices(candidate.seriesIndices, group.seriesIndices))
  );
}

function traceSnapshotFields(
  trace: BarGeometryTrace | undefined,
  group: BarGeometryGroupTrace,
): Pick<
  BarGeometrySnapshot,
  | 'traceStatus'
  | 'traceStatusReason'
  | 'tracePlotArea'
  | 'traceCategoryPitch'
  | 'traceBarSize'
  | 'traceOffsets'
  | 'traceRectangleCount'
  | 'rectangles'
> {
  return {
    traceStatus: group.traceStatus,
    ...(group.traceStatusReason ? { traceStatusReason: group.traceStatusReason } : {}),
    ...(trace
      ? {
          tracePlotArea: {
            x: trace.plotArea.x,
            y: trace.plotArea.y,
            width: trace.plotArea.width,
            height: trace.plotArea.height,
          },
        }
      : {}),
    traceCategoryPitch: group.categoryPitch,
    traceBarSize: group.barSize,
    traceOffsets: group.offsets,
    traceRectangleCount: group.rectangleCount,
    rectangles: group.rectangles,
  };
}

function sameSeriesIndices(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((value, index) => value === right[index]);
}

export function snapshotCartesianGeometry(
  config: ChartConfig,
  chartData: ChartData,
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null = null,
  trace?: CartesianGeometryTrace,
): CartesianGeometrySnapshot | undefined {
  const plan = buildExcelCartesianGeometryPlan(config, chartData);
  if (!plan) return undefined;

  const seriesGeometry = seriesPointGeometry(trace);
  const areaSurfaceStyles = seriesAreaSurfaceStyles(trace);
  const areaSurfaceExtents = seriesAreaSurfaceExtents(trace);
  const layerSnapshots = trace?.layers.map((layer) =>
    snapshotLayerGeometry(layer, trace, layout, plan),
  );
  const categoryXScale = categoryXLayerScale(trace);
  const quantitativeXScale = quantitativeXLayerScale(trace, plan.x.quantitative?.field);
  const seriesSnapshots = plan.series.map((series) => {
    const points = seriesGeometry.get(series.seriesIndex) ?? [];
    const layerIndices = uniqueNumbers(
      points
        .map((point) => point.layerIndex)
        .filter((value): value is number => value !== undefined),
    );
    const areaPoints = points.filter((point) => point.topPixel !== undefined);
    const areaStyle = areaSurfaceStyles.get(series.seriesIndex)?.[0];
    const areaExtent = areaSurfaceExtents.get(series.seriesIndex)?.[0];
    const markerPoints = points.filter(isMarkerGeometryPoint);
    const sourceBlankMarkerGeometryCount = markerPoints.filter(
      (point) => point.sourceBlank === true,
    ).length;
    const markerEligiblePointCount = markerPoints.length - sourceBlankMarkerGeometryCount;
    const suppressedSourceBlankMarkerCount =
      series.zeroProjectedSourceBlankPointCount !== undefined
        ? Math.max(0, series.zeroProjectedSourceBlankPointCount - sourceBlankMarkerGeometryCount)
        : undefined;
    const bubblePoints =
      series.bubbleSizeAuthority === 'series' ? points.filter(isBubbleGeometryPoint) : [];

    return {
      ...series,
      ...(sourceBlankMarkerGeometryCount > 0 ? { sourceBlankMarkerGeometryCount } : {}),
      ...(markerPoints.length > 0 ? { markerEligiblePointCount } : {}),
      ...(suppressedSourceBlankMarkerCount !== undefined
        ? { suppressedSourceBlankMarkerCount }
        : {}),
      ...(layerIndices.length > 0 ? { layers: layerIndices } : {}),
      ...(points.length > 0 ? { pointGeometry: points } : {}),
      ...(areaPoints.length > 0
        ? {
            areaGeometry: {
              baselinePixel: areaPoints.find((point) => point.baselinePixel !== undefined)
                ?.baselinePixel,
              baselinePlotY: areaPoints.find((point) => point.baselinePlotY !== undefined)
                ?.baselinePlotY,
              points: areaPoints,
            },
          }
        : {}),
      ...(areaStyle ? { areaSurfaceStyle: areaStyle } : {}),
      ...(areaExtent ? { areaSurfaceExtent: areaExtent } : {}),
      ...(markerPoints.length > 0
        ? {
            markerGeometry: {
              points: markerPoints,
            },
          }
        : {}),
      ...(bubblePoints.length > 0
        ? {
            bubbleGeometry: {
              sizeDomain: plan.bubble?.sizeDomain,
              sizeRange: plan.bubble?.sizeRange,
              maxRenderedArea: plan.bubble?.maxRenderedArea,
              maxRenderedRadius: plan.bubble?.maxRenderedRadius,
              clippingPolicy: plan.bubble?.clippingPolicy,
              points: bubblePoints,
            },
          }
        : {}),
    };
  });

  const snapshot: CartesianGeometrySnapshot = {
    ...plan,
    geometryStatus: trace && layout ? 'available' : 'unavailable',
    ...(trace
      ? {
          coordinateSystem: trace.coordinateSystem,
          chartWidth: trace.chartWidth,
          chartHeight: trace.chartHeight,
          plotArea: trace.plotArea,
          ...pathPlotFrameSnapshot(plan, trace, layout, categoryXScale),
          layers: layerSnapshots,
        }
      : {}),
    x: {
      modes: plan.x.modes,
      ...(plan.x.category
        ? {
            category: {
              ...plan.x.category,
              ...scaleRangeSnapshot(categoryXScale, trace, 'x'),
              ...categoryXPathAxisLayoutSnapshot(plan.x.category, categoryXScale, trace, layout),
            },
          }
        : {}),
      ...(plan.x.quantitative
        ? {
            quantitative: {
              ...plan.x.quantitative,
              ...quantitativeXScaleSnapshot(plan.x.quantitative, quantitativeXScale, trace),
            },
          }
        : {}),
    },
    valueAxes: plan.valueAxes.map((axis) =>
      compactObject({
        ...axis,
        ...valueAxisScaleSnapshot(plan, trace, axis.axisGroup),
      }),
    ),
    series: seriesSnapshots,
  };
  const pointAuthority = cartesianPointAuthoritySnapshots(config, chartData, snapshot);
  return pointAuthority.length > 0 ? { ...snapshot, pointAuthority } : snapshot;
}

function cartesianPointAuthoritySnapshots(
  config: ChartConfig,
  chartData: ChartData,
  cartesianGeometry: CartesianGeometrySnapshot,
): CartesianPointAuthoritySnapshot[] {
  if (chartImportSourceDialect(config) === undefined) return [];
  if (config.type === 'line' || config.type === 'area') {
    return [pathPointAuthoritySnapshot(config, chartData, cartesianGeometry)];
  }
  if (config.type === 'scatter') {
    return [scatterPointAuthoritySnapshot(config, chartData, cartesianGeometry)];
  }
  return [];
}

function pathPointAuthoritySnapshot(
  config: ChartConfig,
  chartData: ChartData,
  cartesianGeometry: CartesianGeometrySnapshot,
): CartesianPointAuthoritySnapshot {
  const seriesIndices = standardVisibleCartesianSeriesIndices(
    config,
    chartData,
    (series) => series.type === 'line' || series.type === 'area',
    cartesianGeometry,
  );
  const layerIndices = cartesianAuthorityLayerIndices(cartesianGeometry, seriesIndices, [
    'linePath',
    'areaFill',
    'marker',
  ]);
  const diagnostics: string[] = [];
  const geometryStatus = cartesianCoordinateAuthorityStatus(
    'path',
    cartesianGeometry,
    diagnostics,
  );
  const plotFrameStatus = pathPlotFrameAuthorityStatus(cartesianGeometry, diagnostics);
  const xAxisStatus = pathXAxisAuthorityStatus(cartesianGeometry, diagnostics);
  const valueAxisStatus = pathValueAxisAuthorityStatus(
    cartesianGeometry,
    seriesIndices,
    diagnostics,
  );
  const scaleConsistencyStatus = valueAxisScaleConsistencyAuthorityStatus(
    'path',
    cartesianGeometry,
    pathAuthorityValueAxisGroups(cartesianGeometry, seriesIndices),
    diagnostics,
  );
  const layerOrderStatus = pathLayerOrderAuthorityStatus(
    cartesianGeometry,
    seriesIndices,
    diagnostics,
  );
  const pointGeometry = pathPointGeometryAuthorityStatus(
    config,
    chartData,
    cartesianGeometry,
    seriesIndices,
    diagnostics,
  );
  const styleStatus = pathStyleAuthorityStatus(cartesianGeometry, seriesIndices, diagnostics);
  const areaSurfaceStatus =
    config.type === 'area'
      ? areaSurfaceAuthorityStatus(cartesianGeometry, seriesIndices, diagnostics)
      : undefined;
  const interpolationStatus = pathInterpolationAuthorityStatus(
    cartesianGeometry,
    seriesIndices,
    diagnostics,
  );

  return pointAuthoritySnapshot({
    family: 'path',
    seriesIndices,
    layerIndices,
    sourcePointCount: pointGeometry.sourcePointCount,
    renderedPointCount: pointGeometry.renderedPointCount,
    diagnostics,
    statuses: {
      plotFrameStatus,
      xAxisStatus,
      valueAxisStatus,
      scaleConsistencyStatus,
      layerOrderStatus,
      pointGeometryStatus: combineAuthorityStatuses([geometryStatus, pointGeometry.status]),
      styleStatus,
      areaSurfaceStatus,
      interpolationStatus,
    },
  });
}

function scatterPointAuthoritySnapshot(
  config: ChartConfig,
  chartData: ChartData,
  cartesianGeometry: CartesianGeometrySnapshot,
): CartesianPointAuthoritySnapshot {
  const seriesIndices = standardVisibleCartesianSeriesIndices(
    config,
    chartData,
    (series) => series.type === 'scatter',
    cartesianGeometry,
  );
  const layerIndices = cartesianAuthorityLayerIndices(cartesianGeometry, seriesIndices, [
    'linePath',
    'marker',
  ]);
  const diagnostics: string[] = [];
  const geometryStatus = cartesianCoordinateAuthorityStatus(
    'scatter',
    cartesianGeometry,
    diagnostics,
  );
  const xAxisStatus = scatterXAxisAuthorityStatus(cartesianGeometry, diagnostics);
  const axisGroups = pathAuthorityValueAxisGroups(cartesianGeometry, seriesIndices);
  const valueAxisStatus = scatterValueAxisAuthorityStatus(
    cartesianGeometry,
    axisGroups,
    diagnostics,
  );
  const scaleConsistencyStatus = valueAxisScaleConsistencyAuthorityStatus(
    'scatter',
    cartesianGeometry,
    axisGroups,
    diagnostics,
  );
  const layerOrderStatus = scatterLayerOrderAuthorityStatus(
    cartesianGeometry,
    seriesIndices,
    diagnostics,
  );
  const pointGeometry = scatterPointGeometryAuthorityStatus(
    chartData,
    cartesianGeometry,
    seriesIndices,
    diagnostics,
  );
  const styleStatus = scatterStyleAuthorityStatus(cartesianGeometry, seriesIndices, diagnostics);
  const markerGlyphStatus = scatterMarkerGlyphAuthorityStatus(
    cartesianGeometry,
    seriesIndices,
    diagnostics,
  );
  const interpolationStatus = scatterInterpolationAuthorityStatus(
    cartesianGeometry,
    seriesIndices,
    diagnostics,
  );

  return pointAuthoritySnapshot({
    family: 'scatter',
    seriesIndices,
    layerIndices,
    sourcePointCount: pointGeometry.sourcePointCount,
    renderedPointCount: pointGeometry.renderedPointCount,
    diagnostics,
    statuses: {
      xAxisStatus,
      valueAxisStatus,
      scaleConsistencyStatus,
      layerOrderStatus,
      pointGeometryStatus: combineAuthorityStatuses([geometryStatus, pointGeometry.status]),
      styleStatus,
      markerGeometryStatus: pointGeometry.markerGeometryStatus,
      markerGlyphStatus,
      interpolationStatus,
    },
  });
}

function pointAuthoritySnapshot(input: {
  family: CartesianPointAuthoritySnapshot['family'];
  seriesIndices: number[];
  layerIndices: number[];
  sourcePointCount: number;
  renderedPointCount: number;
  diagnostics: string[];
  statuses: Partial<
    Pick<
      CartesianPointAuthoritySnapshot,
      | 'plotFrameStatus'
      | 'xAxisStatus'
      | 'valueAxisStatus'
      | 'scaleConsistencyStatus'
      | 'layerOrderStatus'
      | 'pointGeometryStatus'
      | 'styleStatus'
      | 'areaSurfaceStatus'
      | 'markerGeometryStatus'
      | 'markerGlyphStatus'
      | 'interpolationStatus'
    >
  >;
}): CartesianPointAuthoritySnapshot {
  const status = combineAuthorityStatuses(Object.values(input.statuses));
  return compactObject({
    schemaVersion: 1,
    family: input.family,
    source: 'importedRendererEvidence',
    status,
    ...(input.diagnostics.length > 0 ? { statusReason: input.diagnostics[0] } : {}),
    seriesIndices: input.seriesIndices,
    layerIndices: input.layerIndices,
    sourcePointCount: input.sourcePointCount,
    renderedPointCount: input.renderedPointCount,
    ...input.statuses,
    diagnostics: uniqueStrings(input.diagnostics),
  }) as CartesianPointAuthoritySnapshot;
}

function standardVisibleCartesianSeriesIndices(
  config: ChartConfig,
  chartData: ChartData,
  predicate: (series: CartesianGeometrySnapshot['series'][number]) => boolean,
  cartesianGeometry: CartesianGeometrySnapshot,
): number[] {
  const seriesConfig = config.series ?? [];
  return cartesianGeometry.series.flatMap((geometrySeries) => {
    const index = geometrySeries.seriesIndex;
    const configForSeries = seriesConfigForDataSeries(
      chartData.series[index],
      seriesConfig,
      index,
    );
    if (isNoFillNoLineSeriesConfig(configForSeries)) return [];
    return predicate(geometrySeries) ? [index] : [];
  });
}

function cartesianAuthorityLayerIndices(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  roles: readonly NonNullable<CartesianGeometrySnapshot['layers']>[number]['layerRole'][],
): number[] {
  const seriesSet = new Set(seriesIndices);
  return uniqueNumbers(
    (cartesianGeometry.layers ?? []).flatMap((layer) =>
      layer.layerRole &&
      roles.includes(layer.layerRole) &&
      layer.seriesIndices.some((seriesIndex) => seriesSet.has(seriesIndex))
        ? [layer.layerIndex]
        : [],
    ),
  );
}

function cartesianCoordinateAuthorityStatus(
  family: 'path' | 'scatter',
  cartesianGeometry: CartesianGeometrySnapshot,
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const statuses: CartesianPointAuthorityStatus[] = [];
  if (cartesianGeometry.geometryStatus !== 'available') {
    diagnostics.push(
      `${family} cartesian geometry is ${cartesianGeometry.geometryStatus ?? 'missing'}`,
    );
    statuses.push('missing');
  }
  if (cartesianGeometry.coordinateSystem !== 'chartPixel') {
    diagnostics.push(
      `${family} cartesian geometry coordinateSystem is ${cartesianGeometry.coordinateSystem ?? 'missing'}; expected chartPixel`,
    );
    statuses.push(cartesianGeometry.coordinateSystem === undefined ? 'missing' : 'approximate');
  }
  if (positiveNumber(cartesianGeometry.chartWidth) === undefined) {
    diagnostics.push(`${family} cartesian geometry chartWidth is missing or non-finite`);
    statuses.push('missing');
  }
  if (positiveNumber(cartesianGeometry.chartHeight) === undefined) {
    diagnostics.push(`${family} cartesian geometry chartHeight is missing or non-finite`);
    statuses.push('missing');
  }
  if (!isFiniteRectSnapshot(cartesianGeometry.plotArea)) {
    diagnostics.push(`${family} cartesian geometry plotArea is missing or non-finite`);
    statuses.push('missing');
  }
  return combineAuthorityStatuses(statuses);
}

function pathPlotFrameAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const frame = cartesianGeometry.pathPlotFrame;
  if (!frame) {
    diagnostics.push('path point authority is missing plot-frame reservation evidence');
    return 'missing';
  }
  if (!isExactOrVerifiedDefaultAuthority(frame.reservationStatus)) {
    diagnostics.push(
      `path plot-frame reservation is ${frame.reservationStatus ?? 'missing'}; reason=${frame.reservationStatusReason ?? 'missing'}`,
    );
    return frame.reservationStatus === undefined ? 'missing' : 'approximate';
  }
  return frame.reservationStatus === 'verifiedDefault' ? 'verifiedDefault' : 'exact';
}

function pathXAxisAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const layout = cartesianGeometry.x.category?.pathAxisLayout;
  if (!layout) {
    diagnostics.push('path point authority is missing category path-axis layout evidence');
    return 'missing';
  }
  const categoryStatus = layout.categoryAxisLayoutStatus ?? layout.axisLayoutStatus;
  const categoryReason = layout.categoryAxisLayoutStatusReason ?? layout.axisLayoutStatusReason;
  const pitchStatus = layout.categoryPitchStatus ?? categoryStatus;
  const pitchReason = layout.categoryPitchStatusReason ?? categoryReason;
  const tickStatus = layout.categoryTickStatus ?? categoryStatus;
  const tickReason = layout.categoryTickStatusReason ?? categoryReason;
  const reservationStatus = layout.reservationStatus ?? categoryStatus;
  const statuses = [
    authorityStatusFromContractStatus(
      'path category-axis layout',
      categoryStatus,
      categoryReason,
      diagnostics,
    ),
    authorityStatusFromContractStatus(
      'path category-axis pitch',
      pitchStatus,
      pitchReason,
      diagnostics,
    ),
    authorityStatusFromContractStatus(
      'path category-axis tick layout',
      tickStatus,
      tickReason,
      diagnostics,
    ),
    authorityStatusFromContractStatus(
      'path category-axis reservation',
      reservationStatus,
      layout.reservationStatusReason,
      diagnostics,
    ),
  ];
  return combineAuthorityStatuses(statuses);
}

function pathValueAxisAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  return cartesianValueAxisAuthorityStatus(
    'path',
    cartesianGeometry,
    pathAuthorityValueAxisGroups(cartesianGeometry, seriesIndices),
    diagnostics,
    true,
  );
}

function scatterValueAxisAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  axisGroups: readonly ('primary' | 'secondary')[],
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  return cartesianValueAxisAuthorityStatus(
    'scatter',
    cartesianGeometry,
    axisGroups,
    diagnostics,
    false,
  );
}

function cartesianValueAxisAuthorityStatus(
  family: 'path' | 'scatter',
  cartesianGeometry: CartesianGeometrySnapshot,
  axisGroups: readonly ('primary' | 'secondary')[],
  diagnostics: string[],
  requirePathLayout: boolean,
): CartesianPointAuthorityStatus {
  const statuses: CartesianPointAuthorityStatus[] = [];
  for (const axisGroup of axisGroups) {
    const axis = cartesianGeometry.valueAxes.find((item) => item.axisGroup === axisGroup);
    if (!axis) {
      diagnostics.push(`${family} point authority is missing ${axisGroup} value-axis evidence`);
      statuses.push('missing');
      continue;
    }
    statuses.push(
      authorityStatusFromContractStatus(
        `${family} ${axisGroup} value-axis visual`,
        axis.axisVisualStatus,
        axis.axisVisualStatusReason,
        diagnostics,
      ),
      authorityStatusFromContractStatus(
        `${family} ${axisGroup} value-axis crossing`,
        axis.crossingStatus,
        axis.crossingStatusReason,
        diagnostics,
      ),
      authorityStatusFromContractStatus(
        `${family} ${axisGroup} value-axis reservation`,
        axis.reservationStatus,
        axis.reservationStatusReason,
        diagnostics,
      ),
    );
    if (requirePathLayout) {
      statuses.push(
        authorityStatusFromContractStatus(
          `${family} ${axisGroup} value-axis layout`,
          axis.valueAxisLayoutStatus ?? axis.axisLayoutStatus,
          axis.valueAxisLayoutStatusReason ?? axis.axisLayoutStatusReason,
          diagnostics,
        ),
      );
    }
    if (family === 'scatter') {
      statuses.push(quantitativeAxisExtentStatus(`${axisGroup} y value-axis`, axis, diagnostics));
    }
  }
  return combineAuthorityStatuses(statuses);
}

function valueAxisScaleConsistencyAuthorityStatus(
  family: 'path' | 'scatter',
  cartesianGeometry: CartesianGeometrySnapshot,
  axisGroups: readonly ('primary' | 'secondary')[],
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const statuses: CartesianPointAuthorityStatus[] = [];
  for (const axisGroup of axisGroups) {
    const axis = cartesianGeometry.valueAxes.find((item) => item.axisGroup === axisGroup);
    if (!axis) {
      statuses.push('missing');
      continue;
    }
    if (axis.scaleConsistencyStatus !== 'consistent') {
      diagnostics.push(
        `${family} ${axisGroup} value-axis scale consistency is ${axis.scaleConsistencyStatus ?? 'missing'}; reason=${axis.scaleConsistencyReason ?? 'missing'}`,
      );
      statuses.push(axis.scaleConsistencyStatus === undefined ? 'missing' : 'approximate');
    } else {
      statuses.push('exact');
    }
  }
  return combineAuthorityStatuses(statuses);
}

function pathLayerOrderAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const pathLayers = authorityLayers(cartesianGeometry, seriesIndices, ['linePath', 'areaFill']);
  if (pathLayers.length === 0) {
    diagnostics.push('path point authority is missing source-order path layer evidence');
    return 'missing';
  }
  const mismatched = pathLayers.filter((layer) => layer.pathOrder !== 'source');
  if (mismatched.length > 0) {
    diagnostics.push(
      `path layer order is not source for layer(s) ${mismatched.map((layer) => layer.layerIndex).join(', ')}`,
    );
    return 'approximate';
  }
  return 'exact';
}

function scatterLayerOrderAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const lineLayers = authorityLayers(cartesianGeometry, seriesIndices, ['linePath']);
  const visibleLineSeries = targetAuthoritySeries(cartesianGeometry, seriesIndices).filter(
    (series) => series.lineVisibleInk === true,
  );
  if (visibleLineSeries.length === 0) return 'verifiedDefault';
  if (lineLayers.length === 0) {
    diagnostics.push('scatter point authority is missing source-order line layer evidence');
    return 'missing';
  }
  const mismatched = lineLayers.filter((layer) => layer.pathOrder !== 'source');
  if (mismatched.length > 0) {
    diagnostics.push(
      `scatter line layer order is not source for layer(s) ${mismatched.map((layer) => layer.layerIndex).join(', ')}`,
    );
    return 'approximate';
  }
  return 'exact';
}

function pathPointGeometryAuthorityStatus(
  config: ChartConfig,
  chartData: ChartData,
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  diagnostics: string[],
): {
  status: CartesianPointAuthorityStatus;
  sourcePointCount: number;
  renderedPointCount: number;
} {
  const statuses: CartesianPointAuthorityStatus[] = [];
  let sourcePointCount = 0;
  let renderedPointCount = 0;
  for (const series of targetAuthoritySeries(cartesianGeometry, seriesIndices)) {
    const expectedPathPoints = expectedPathPointCount(config, chartData, series.seriesIndex);
    const pathLayerRole = series.type === 'area' ? 'areaFill' : 'linePath';
    const pathLayerRequired = series.type === 'area' || series.lineVisibleInk !== false;
    if (pathLayerRequired) {
      const layer = authorityLayerForSeries(cartesianGeometry, series.seriesIndex, pathLayerRole);
      const rendered = layer ? pointsForAuthorityLayer(series, layer.layerIndex).length : 0;
      sourcePointCount += expectedPathPoints;
      renderedPointCount += rendered;
      statuses.push(
        pointCountAuthorityStatus(
          `${series.type} series ${series.seriesIndex} ${pathLayerRole}`,
          expectedPathPoints,
          rendered,
          diagnostics,
        ),
      );
      statuses.push(layerScaleAuthorityStatus(`${series.type} series ${series.seriesIndex}`, layer, diagnostics));
    }

    if (series.sourceShowMarkers || series.markerVisibleInk || series.markerLayer) {
      const expectedMarkerPoints = expectedPathMarkerPointCount(
        config,
        chartData,
        series.seriesIndex,
        series.blankMarkerPolicy,
      );
      const markerLayer = authorityLayerForSeries(cartesianGeometry, series.seriesIndex, 'marker');
      const rendered = markerLayer ? pointsForAuthorityLayer(series, markerLayer.layerIndex).length : 0;
      sourcePointCount += expectedMarkerPoints;
      renderedPointCount += rendered;
      statuses.push(
        pointCountAuthorityStatus(
          `path series ${series.seriesIndex} marker layer`,
          expectedMarkerPoints,
          rendered,
          diagnostics,
        ),
      );
      statuses.push(layerScaleAuthorityStatus(`path series ${series.seriesIndex} marker`, markerLayer, diagnostics));
    }

    const invalidPoints = (series.pointGeometry ?? []).filter(
      (point) => !hasFiniteCartesianPointPosition(point),
    ).length;
    if (invalidPoints > 0) {
      diagnostics.push(
        `path series ${series.seriesIndex} has ${invalidPoints} non-finite point geometry position(s)`,
      );
      statuses.push('approximate');
    }
  }
  return {
    status: combineAuthorityStatuses(statuses),
    sourcePointCount,
    renderedPointCount,
  };
}

function scatterPointGeometryAuthorityStatus(
  chartData: ChartData,
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  diagnostics: string[],
): {
  status: CartesianPointAuthorityStatus;
  markerGeometryStatus?: CartesianPointAuthorityStatus;
  sourcePointCount: number;
  renderedPointCount: number;
} {
  const statuses: CartesianPointAuthorityStatus[] = [];
  const markerStatuses: CartesianPointAuthorityStatus[] = [];
  let sourcePointCount = 0;
  let renderedPointCount = 0;
  for (const series of targetAuthoritySeries(cartesianGeometry, seriesIndices)) {
    const expectedPoints = expectedScatterPointCount(chartData, series.seriesIndex);
    if (series.lineVisibleInk) {
      const lineLayer = authorityLayerForSeries(cartesianGeometry, series.seriesIndex, 'linePath');
      const rendered = lineLayer ? pointsForAuthorityLayer(series, lineLayer.layerIndex).length : 0;
      sourcePointCount += expectedPoints;
      renderedPointCount += rendered;
      statuses.push(
        pointCountAuthorityStatus(
          `scatter series ${series.seriesIndex} line layer`,
          expectedPoints,
          rendered,
          diagnostics,
        ),
      );
      statuses.push(layerScaleAuthorityStatus(`scatter series ${series.seriesIndex} line`, lineLayer, diagnostics));
    }
    if (series.markerVisibleInk) {
      const markerLayer = authorityLayerForSeries(cartesianGeometry, series.seriesIndex, 'marker');
      const markerPoints = series.markerGeometry?.points ?? [];
      sourcePointCount += expectedPoints;
      renderedPointCount += markerPoints.length;
      const countStatus = pointCountAuthorityStatus(
        `scatter series ${series.seriesIndex} marker geometry`,
        expectedPoints,
        markerPoints.length,
        diagnostics,
      );
      markerStatuses.push(countStatus);
      statuses.push(countStatus);
      statuses.push(layerScaleAuthorityStatus(`scatter series ${series.seriesIndex} marker`, markerLayer, diagnostics));
      const invalidSizeCount = markerPoints.filter(
        (point) => !positiveNumber(point.renderedRadius) && !positiveNumber(point.renderedArea),
      ).length;
      if (invalidSizeCount > 0) {
        diagnostics.push(
          `scatter series ${series.seriesIndex} marker geometry has ${invalidSizeCount} point(s) without finite rendered size`,
        );
        markerStatuses.push('approximate');
        statuses.push('approximate');
      }
    }
    const invalidPoints = (series.pointGeometry ?? []).filter(
      (point) => !hasFiniteCartesianPointPosition(point),
    ).length;
    if (invalidPoints > 0) {
      diagnostics.push(
        `scatter series ${series.seriesIndex} has ${invalidPoints} non-finite point geometry position(s)`,
      );
      statuses.push('approximate');
    }
  }
  return {
    status: combineAuthorityStatuses(statuses),
    markerGeometryStatus:
      markerStatuses.length > 0 ? combineAuthorityStatuses(markerStatuses) : 'verifiedDefault',
    sourcePointCount,
    renderedPointCount,
  };
}

function pathStyleAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const statuses: CartesianPointAuthorityStatus[] = [];
  for (const series of targetAuthoritySeries(cartesianGeometry, seriesIndices)) {
    if (series.lineVisibleInk || series.markerVisibleInk || series.markerLayer) {
      statuses.push(
        authorityStatusFromContractStatus(
          `path series ${series.seriesIndex} color authority`,
          series.colorAuthorityStatus,
          series.colorAuthorityReason,
          diagnostics,
        ),
      );
    }
    statuses.push(
      authorityStatusFromContractStatus(
        `path series ${series.seriesIndex} line visual contract`,
        series.lineVisualStatus,
        series.lineVisualStatusReason,
        diagnostics,
      ),
      authorityStatusFromContractStatus(
        `path series ${series.seriesIndex} blank-marker policy`,
        series.blankMarkerPolicyStatus,
        series.blankMarkerPolicyStatusReason,
        diagnostics,
      ),
    );
    if (series.sourceShowMarkers || series.markerVisibleInk || series.markerLayer) {
      statuses.push(
        authorityStatusFromContractStatus(
          `path series ${series.seriesIndex} marker visual contract`,
          series.markerVisualStatus,
          series.markerVisualStatusReason,
          diagnostics,
        ),
      );
    }
  }
  return combineAuthorityStatuses(statuses);
}

function scatterStyleAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const statuses: CartesianPointAuthorityStatus[] = [];
  for (const series of targetAuthoritySeries(cartesianGeometry, seriesIndices)) {
    if (series.lineVisibleInk || series.markerVisibleInk) {
      statuses.push(
        authorityStatusFromContractStatus(
          `scatter series ${series.seriesIndex} color authority`,
          series.colorAuthorityStatus,
          series.colorAuthorityReason,
          diagnostics,
        ),
      );
    }
    if (series.lineVisibleInk) {
      statuses.push(
        authorityStatusFromContractStatus(
          `scatter series ${series.seriesIndex} line visual contract`,
          series.lineVisualStatus,
          series.lineVisualStatusReason,
          diagnostics,
        ),
      );
    }
    if (series.markerVisibleInk) {
      statuses.push(
        authorityStatusFromContractStatus(
          `scatter series ${series.seriesIndex} marker visual contract`,
          series.markerVisualStatus,
          series.markerVisualStatusReason,
          diagnostics,
        ),
      );
    }
  }
  return combineAuthorityStatuses(statuses);
}

function areaSurfaceAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const statuses: CartesianPointAuthorityStatus[] = [];
  for (const series of targetAuthoritySeries(cartesianGeometry, seriesIndices)) {
    const style = series.areaSurfaceStyle;
    const extent = series.areaSurfaceExtent;
    statuses.push(
      authorityStatusFromContractStatus(
        `area series ${series.seriesIndex} surface style`,
        style?.styleStatus,
        style?.styleStatusReason,
        diagnostics,
      ),
      authorityStatusFromContractStatus(
        `area series ${series.seriesIndex} surface extent`,
        extent?.extentStatus,
        extent?.extentStatusReason,
        diagnostics,
      ),
    );
    const areaLayer = authorityLayerForSeries(cartesianGeometry, series.seriesIndex, 'areaFill');
    const areaPointCount = series.areaGeometry?.points.length ?? 0;
    const layerPointCount = areaLayer
      ? pointsForAuthorityLayer(series, areaLayer.layerIndex).length
      : 0;
    statuses.push(
      pointCountAuthorityStatus(
        `area series ${series.seriesIndex} surface geometry`,
        layerPointCount,
        areaPointCount,
        diagnostics,
      ),
    );
    if (extent && areaPointCount > 0 && extent.pointCount !== areaPointCount) {
      diagnostics.push(
        `area series ${series.seriesIndex} surface extent pointCount ${extent.pointCount} does not match area geometry ${areaPointCount}`,
      );
      statuses.push('approximate');
    }
  }
  return combineAuthorityStatuses(statuses);
}

function pathInterpolationAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const smooth = targetAuthoritySeries(cartesianGeometry, seriesIndices).filter(
    (series) => series.lineVisibleInk && series.lineInterpolation === 'monotone',
  );
  if (smooth.length === 0) return 'exact';
  diagnostics.push(
    `path series ${smooth.map((series) => series.seriesIndex).join(', ')} use smooth interpolation; reason=excelSmoothInterpolationUnverified`,
  );
  return 'approximate';
}

function scatterMarkerGlyphAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const statuses: CartesianPointAuthorityStatus[] = [];
  for (const series of targetAuthoritySeries(cartesianGeometry, seriesIndices)) {
    if (!series.markerVisibleInk) continue;
    const markerLayer = authorityLayerForSeries(cartesianGeometry, series.seriesIndex, 'marker');
    if (markerLayer?.sizeAuthority !== 'markerStyle' && markerLayer?.sizeAuthority !== 'fixedMarkSize') {
      diagnostics.push(
        `scatter series ${series.seriesIndex} marker size authority is ${markerLayer?.sizeAuthority ?? 'missing'}`,
      );
      statuses.push(markerLayer?.sizeAuthority === undefined ? 'missing' : 'approximate');
    }
    if (!series.markerShape || positiveNumber(series.markerSize) === undefined) {
      diagnostics.push(`scatter series ${series.seriesIndex} marker glyph/size authority is missing`);
      statuses.push('missing');
    } else {
      statuses.push('exact');
    }
  }
  return statuses.length > 0 ? combineAuthorityStatuses(statuses) : 'verifiedDefault';
}

function scatterInterpolationAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const statuses: CartesianPointAuthorityStatus[] = [];
  for (const series of targetAuthoritySeries(cartesianGeometry, seriesIndices)) {
    if (!series.lineVisibleInk) continue;
    if (series.lineInterpolation !== 'linear') {
      diagnostics.push(
        `scatter series ${series.seriesIndex} line interpolation is ${series.lineInterpolation ?? 'missing'}; reason=excelSmoothInterpolationUnverified`,
      );
      statuses.push(series.lineInterpolation === undefined ? 'missing' : 'approximate');
    } else {
      statuses.push('exact');
    }
  }
  return statuses.length > 0 ? combineAuthorityStatuses(statuses) : 'verifiedDefault';
}

function scatterXAxisAuthorityStatus(
  cartesianGeometry: CartesianGeometrySnapshot,
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const xAxis = cartesianGeometry.x.quantitative;
  if (!xAxis) {
    diagnostics.push('scatter point authority is missing quantitative x-axis evidence');
    return 'missing';
  }
  return combineAuthorityStatuses([
    quantitativeAxisExtentStatus('scatter x value-axis', xAxis, diagnostics),
    authorityStatusFromContractStatus(
      'scatter x value-axis visual',
      xAxis.axisVisualStatus,
      xAxis.axisVisualStatusReason,
      diagnostics,
    ),
    authorityStatusFromContractStatus(
      'scatter x value-axis crossing',
      xAxis.crossingStatus,
      xAxis.crossingStatusReason,
      diagnostics,
    ),
    authorityStatusFromContractStatus(
      'scatter x value-axis reservation',
      xAxis.reservationStatus,
      xAxis.reservationStatusReason,
      diagnostics,
    ),
  ]);
}

function quantitativeAxisExtentStatus(
  label: string,
  axis: {
    domain?: [number, number];
    tickValues?: Array<string | number | null>;
    tickStep?: number;
    range?: [number, number];
    plotRange?: [number, number];
  },
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const statuses: CartesianPointAuthorityStatus[] = [];
  if (!isFinitePairSnapshot(axis.domain)) {
    diagnostics.push(`${label} domain is missing or non-finite`);
    statuses.push('missing');
  }
  if (!Array.isArray(axis.tickValues) || axis.tickValues.length === 0) {
    diagnostics.push(`${label} tickValues are missing`);
    statuses.push('missing');
  }
  if (positiveNumber(axis.tickStep) === undefined) {
    diagnostics.push(`${label} tickStep is missing or non-finite`);
    statuses.push('missing');
  }
  if (!isFinitePairSnapshot(axis.range)) {
    diagnostics.push(`${label} range is missing or non-finite`);
    statuses.push('missing');
  }
  if (!isFinitePairSnapshot(axis.plotRange)) {
    diagnostics.push(`${label} plotRange is missing or non-finite`);
    statuses.push('missing');
  }
  return combineAuthorityStatuses(statuses);
}

function layerScaleAuthorityStatus(
  label: string,
  layer: NonNullable<CartesianGeometrySnapshot['layers']>[number] | undefined,
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  if (!layer) {
    diagnostics.push(`${label} layer evidence is missing`);
    return 'missing';
  }
  const statuses = [
    scaleGeometryAuthorityStatus(`${label} layer ${layer.layerIndex} xScale`, layer.xScale, diagnostics),
    scaleGeometryAuthorityStatus(`${label} layer ${layer.layerIndex} yScale`, layer.yScale, diagnostics),
  ];
  return combineAuthorityStatuses(statuses);
}

function scaleGeometryAuthorityStatus(
  label: string,
  scale: NonNullable<CartesianGeometrySnapshot['layers']>[number]['xScale'] | undefined,
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  const statuses: CartesianPointAuthorityStatus[] = [];
  if (!scale) {
    diagnostics.push(`${label} is missing`);
    return 'missing';
  }
  if (!scale.field) {
    diagnostics.push(`${label} field is missing`);
    statuses.push('missing');
  }
  if (!Array.isArray(scale.domain) || scale.domain.length === 0) {
    diagnostics.push(`${label} domain is missing`);
    statuses.push('missing');
  }
  if (!isFinitePairSnapshot(scale.range)) {
    diagnostics.push(`${label} range is missing or non-finite`);
    statuses.push('missing');
  }
  return combineAuthorityStatuses(statuses);
}

function authorityStatusFromContractStatus(
  label: string,
  status: string | undefined,
  reason: string | undefined,
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  if (status === 'exact' || status === 'verifiedDefault') return status;
  diagnostics.push(`${label} is ${status ?? 'missing'}; reason=${reason ?? 'missing'}`);
  return status === undefined || status === 'missing' ? 'missing' : 'approximate';
}

function pointCountAuthorityStatus(
  label: string,
  expected: number,
  rendered: number,
  diagnostics: string[],
): CartesianPointAuthorityStatus {
  if (expected === rendered && expected > 0) return 'exact';
  if (expected === 0 && rendered === 0) return 'verifiedDefault';
  diagnostics.push(`${label} rendered ${rendered} point(s); expected ${expected}`);
  return rendered === 0 ? 'missing' : 'approximate';
}

function pathAuthorityValueAxisGroups(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
): Array<'primary' | 'secondary'> {
  const seriesSet = new Set(seriesIndices);
  const groups = new Set<'primary' | 'secondary'>();
  for (const series of cartesianGeometry.series) {
    if (seriesSet.has(series.seriesIndex)) groups.add(series.axisGroup);
  }
  return [...groups];
}

function authorityLayers(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
  roles: readonly NonNullable<CartesianGeometrySnapshot['layers']>[number]['layerRole'][],
): NonNullable<CartesianGeometrySnapshot['layers']> {
  const seriesSet = new Set(seriesIndices);
  return (
    cartesianGeometry.layers?.filter(
      (layer) =>
        layer.layerRole !== undefined &&
        roles.includes(layer.layerRole) &&
        layer.seriesIndices.some((seriesIndex) => seriesSet.has(seriesIndex)),
    ) ?? []
  );
}

function targetAuthoritySeries(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndices: readonly number[],
): CartesianGeometrySnapshot['series'] {
  const seriesSet = new Set(seriesIndices);
  return cartesianGeometry.series.filter((series) => seriesSet.has(series.seriesIndex));
}

function authorityLayerForSeries(
  cartesianGeometry: CartesianGeometrySnapshot,
  seriesIndex: number,
  role: NonNullable<CartesianGeometrySnapshot['layers']>[number]['layerRole'],
): NonNullable<CartesianGeometrySnapshot['layers']>[number] | undefined {
  return cartesianGeometry.layers?.find(
    (layer) =>
      layer.layerRole === role && layer.seriesIndices.includes(seriesIndex) && layer.pointCount > 0,
  );
}

function pointsForAuthorityLayer(
  series: CartesianGeometrySnapshot['series'][number],
  layerIndex: number,
): NonNullable<CartesianGeometrySnapshot['series'][number]['pointGeometry']> {
  return (series.pointGeometry ?? []).filter((point) => point.layerIndex === layerIndex);
}

function expectedPathPointCount(
  config: ChartConfig,
  chartData: ChartData,
  seriesIndex: number,
): number {
  return expectedSeriesPointCount(chartData, seriesIndex, (point) => {
    if (finiteNumber(point?.y) !== undefined) return true;
    return config.displayBlanksAs === 'zero' && point?.valueState === 'blank';
  });
}

function expectedPathMarkerPointCount(
  config: ChartConfig,
  chartData: ChartData,
  seriesIndex: number,
  blankMarkerPolicy: string | undefined,
): number {
  return expectedSeriesPointCount(chartData, seriesIndex, (point) => {
    if (finiteNumber(point?.y) !== undefined && point?.valueState !== 'blank') return true;
    if (blankMarkerPolicy === 'suppressSourceBlankMarkers') return false;
    return config.displayBlanksAs === 'zero' && point?.valueState === 'blank';
  });
}

function expectedScatterPointCount(chartData: ChartData, seriesIndex: number): number {
  return expectedSeriesPointCount(
    chartData,
    seriesIndex,
    (point) => finiteNumber(point?.x) !== undefined && finiteNumber(point?.y) !== undefined,
  );
}

function expectedSeriesPointCount(
  chartData: ChartData,
  seriesIndex: number,
  predicate: (point: ChartData['series'][number]['data'][number]) => boolean,
): number {
  const series = chartData.series[seriesIndex];
  if (!series) return 0;
  return series.data.filter(predicate).length;
}

function hasFiniteCartesianPointPosition(
  point: NonNullable<CartesianGeometrySnapshot['series'][number]['pointGeometry']>[number],
): boolean {
  return (
    finiteNumber(point.xPixel) !== undefined &&
    finiteNumber(point.yPixel) !== undefined &&
    finiteNumber(point.plotX) !== undefined &&
    finiteNumber(point.plotY) !== undefined &&
    finiteNumber(point.chartX) !== undefined &&
    finiteNumber(point.chartY) !== undefined
  );
}

function combineAuthorityStatuses(
  statuses: readonly (CartesianPointAuthorityStatus | undefined)[],
): CartesianPointAuthorityStatus {
  const resolved = statuses.filter(
    (status): status is CartesianPointAuthorityStatus => status !== undefined,
  );
  if (resolved.length === 0) return 'exact';
  if (resolved.includes('missing')) return 'missing';
  if (resolved.includes('approximate')) return 'approximate';
  if (resolved.includes('verifiedDefault')) return 'verifiedDefault';
  return 'exact';
}

function isExactOrVerifiedDefaultAuthority(status: string | undefined): boolean {
  return status === 'exact' || status === 'verifiedDefault';
}

function isFiniteRectSnapshot(
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
    finiteNumber(rect?.x) !== undefined &&
    finiteNumber(rect?.y) !== undefined &&
    positiveNumber(rect?.width) !== undefined &&
    positiveNumber(rect?.height) !== undefined
  );
}

function isFinitePairSnapshot(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    finiteNumber(value[0]) !== undefined &&
    finiteNumber(value[1]) !== undefined
  );
}

function seriesAreaSurfaceStyles(
  trace: CartesianGeometryTrace | undefined,
): Map<number, NonNullable<CartesianGeometrySnapshot['series'][number]['areaSurfaceStyle']>[]> {
  const bySeries = new Map<
    number,
    NonNullable<CartesianGeometrySnapshot['series'][number]['areaSurfaceStyle']>[]
  >();
  if (!trace) return bySeries;

  for (const layer of trace.layers) {
    for (const style of layer.areaSurfaceStyles ?? []) {
      if (style.seriesIndex === undefined) continue;
      const current = bySeries.get(style.seriesIndex) ?? [];
      current.push(style);
      bySeries.set(style.seriesIndex, current);
    }
  }
  return bySeries;
}

function seriesAreaSurfaceExtents(
  trace: CartesianGeometryTrace | undefined,
): Map<number, NonNullable<CartesianGeometrySnapshot['series'][number]['areaSurfaceExtent']>[]> {
  const bySeries = new Map<
    number,
    NonNullable<CartesianGeometrySnapshot['series'][number]['areaSurfaceExtent']>[]
  >();
  if (!trace) return bySeries;

  for (const layer of trace.layers) {
    for (const extent of layer.areaSurfaceExtents ?? []) {
      if (extent.seriesIndex === undefined) continue;
      const current = bySeries.get(extent.seriesIndex) ?? [];
      current.push(extent);
      bySeries.set(extent.seriesIndex, current);
    }
  }
  return bySeries;
}

export function snapshotPieDoughnutGeometry(input: {
  config: ChartConfig;
  chartData: ChartData;
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null | undefined;
  chartArea?: ResolvedChartSpecSnapshot['chartArea'];
  renderFrame?: ResolvedChartSpecSnapshot['renderFrame'];
  legend?: LegendSnapshot;
  legendTrace?: LegendTrace;
  labelTrace?: PieDoughnutLabelLayoutTrace;
}): PieDoughnutGeometrySnapshot | undefined {
  const chartWidth = positiveSize(input.chartArea?.width ?? input.renderFrame?.width);
  const chartHeight = positiveSize(input.chartArea?.height ?? input.renderFrame?.height);
  const plotArea = plotAreaPixels(input.layout, chartWidth, chartHeight);
  const layoutHints = pieDoughnutLayoutHintsForConfig(input.config, input.chartData);
  const geometry = buildPieDoughnutGeometry({
    config: input.config,
    data: input.chartData,
    chartWidth,
    chartHeight,
    plotArea,
    layoutHints,
    includeSeries: ({ seriesConfig }) => !isNoFillNoLineSeriesConfig(seriesConfig),
  });
  if (!geometry) return undefined;
  const geometryStatus = input.layout?.plotArea ? 'available' : 'unavailable';
  const legendFlow = pieDoughnutLegendFlowSnapshot({
    config: input.config,
    legend: input.legend,
    legendTrace: input.legendTrace,
  });
  const labelLayout = pieDoughnutLabelLayoutSnapshot({
    geometry,
    layoutHints,
    trace: input.labelTrace,
  });
  const explosionEnvelope = pieDoughnutExplosionEnvelopeSnapshot(geometry);
  const styleFootprint = pieDoughnutStyleFootprintSnapshot(input.config, geometry);
  return {
    geometryStatus,
    ...(geometryStatus === 'unavailable' ? { geometryStatusReason: 'layoutUnavailable' } : {}),
    ...geometry,
    legendLayoutStatus: legendFlow.status,
    ...(legendFlow.statusReason
      ? { legendLayoutStatusReason: legendFlow.statusReason }
      : {}),
    labelLayoutStatus: labelLayout.status,
    ...(labelLayout.statusReason ? { labelLayoutStatusReason: labelLayout.statusReason } : {}),
    explosionLayoutStatus: explosionEnvelope.status,
    ...(explosionEnvelope.statusReason
      ? { explosionLayoutStatusReason: explosionEnvelope.statusReason }
      : {}),
    styleFootprintStatus: styleFootprint.status,
    ...(styleFootprint.statusReason
      ? { styleFootprintStatusReason: styleFootprint.statusReason }
      : {}),
    sliceStyleStatus: styleFootprint.sliceStyleStatus,
    ...(styleFootprint.sliceStyleStatusReason
      ? { sliceStyleStatusReason: styleFootprint.sliceStyleStatusReason }
      : {}),
    legendFlow,
    labelLayout,
    explosionEnvelope,
    styleFootprint,
  };
}

function pieDoughnutLegendFlowSnapshot(input: {
  config: ChartConfig;
  legend?: LegendSnapshot;
  legendTrace?: LegendTrace;
}): NonNullable<PieDoughnutGeometrySnapshot['legendFlow']> {
  const position = pieDoughnutLegendPosition(input.config);
  const sourceEntries = input.legend?.visibleEntryItems ?? [];
  if (!input.legend?.present || input.legend.visible === false || sourceEntries.length === 0) {
    return emptyPieDoughnutLegendFlow(position, 'verifiedDefault');
  }

  const base = emptyPieDoughnutLegendFlow(position, 'approximate');
  if (position === 'overlay') {
    return { ...base, statusReason: 'legendOverlayNotCalibrated' };
  }
  if (position === 'custom') {
    return { ...base, statusReason: 'legendCustomLayoutNotCalibrated' };
  }
  if (!hasPieDoughnutPointLegendVocabulary(input.legend, sourceEntries)) {
    return { ...base, statusReason: 'legendPointVocabularyMissing' };
  }

  const trace = input.legendTrace;
  const rendered = input.legend?.rendered;
  if (!trace?.flow || !rendered?.entries) {
    return { ...base, status: 'unknown', statusReason: 'legendTraceMissing' };
  }
  if (rendered.mismatchReason) {
    return {
      ...legendFlowFromTrace(position, trace, rendered.entries, 'approximate'),
      statusReason: rendered.mismatchReason,
    };
  }
  if (!legendEntryIdentityMatches(sourceEntries, rendered.entries)) {
    return {
      ...legendFlowFromTrace(position, trace, rendered.entries, 'approximate'),
      statusReason: 'legendEntryIdentityMismatch',
    };
  }
  const evidenceGap = pieDoughnutLegendFlowEvidenceGap({
    position,
    trace,
    renderedEntryCount: rendered.entries.length,
    sourceEntryCount: sourceEntries.length,
  });
  if (evidenceGap) {
    return {
      ...legendFlowFromTrace(position, trace, rendered.entries, 'approximate'),
      statusReason: evidenceGap,
    };
  }

  return {
    ...legendFlowFromTrace(position, trace, rendered.entries, 'exact'),
    statusReason: 'renderedLegendFlowTraceMatched',
  };
}

function emptyPieDoughnutLegendFlow(
  position: string | undefined,
  status: PieDoughnutVisualStatus,
): NonNullable<PieDoughnutGeometrySnapshot['legendFlow']> {
  return {
    ...(position ? { position } : {}),
    status,
    entryCount: 0,
    renderedEntryCount: 0,
    visibleEntryCount: 0,
    clippedEntryCount: 0,
    rowCount: 0,
    columnCount: 0,
    rowGap: 0,
    entryGap: 0,
    contentWidth: 0,
    contentHeight: 0,
    overflowPolicy: 'none',
    entries: [],
  };
}

function legendFlowFromTrace(
  position: string | undefined,
  trace: LegendTrace,
  renderedEntries: NonNullable<NonNullable<LegendSnapshot['rendered']>['entries']>,
  status: PieDoughnutVisualStatus,
): NonNullable<PieDoughnutGeometrySnapshot['legendFlow']> {
  const flow = trace.flow;
  if (!flow) return emptyPieDoughnutLegendFlow(position, 'unknown');
  return {
    ...(position ? { position } : {}),
    status,
    ...(trace.area ? { area: trace.area } : {}),
    orient: flow.orient,
    entryCount: flow.entryCount,
    renderedEntryCount: flow.renderedEntryCount,
    visibleEntryCount: flow.visibleEntryCount,
    clippedEntryCount: flow.clippedEntryCount,
    rowCount: flow.rowCount,
    columnCount: flow.columnCount,
    rowGap: flow.rowGap,
    entryGap: flow.entryGap,
    contentWidth: flow.contentWidth,
    contentHeight: flow.contentHeight,
    overflowPolicy: flow.overflowPolicy,
    entries: flow.entries.map((entry) => {
      const rendered = renderedEntries[entry.entryIndex];
      return {
        index: entry.entryIndex,
        text: rendered?.text ?? entry.text,
        ...(rendered?.pointIndex !== undefined ? { pointIndex: rendered.pointIndex } : {}),
        ...(rendered?.pointKey !== undefined ? { pointKey: rendered.pointKey } : {}),
        ...(rendered?.legendKey !== undefined ? { legendKey: rendered.legendKey } : {}),
        ...(rendered?.colorKey !== undefined ? { colorKey: rendered.colorKey } : {}),
        ...(rendered?.seriesIndex !== undefined ? { seriesIndex: rendered.seriesIndex } : {}),
        ...(rendered?.sourceSeriesIndex !== undefined
          ? { sourceSeriesIndex: rendered.sourceSeriesIndex }
          : {}),
        ...(rendered?.sourceSeriesKey !== undefined
          ? { sourceSeriesKey: rendered.sourceSeriesKey }
          : {}),
        rowIndex: entry.rowIndex,
        columnIndex: entry.columnIndex,
        bounds: {
          x: entry.x,
          y: entry.y,
          width: entry.width,
          height: entry.height,
        },
        symbolBounds: entry.symbolBounds,
        labelBounds: entry.labelBounds,
        drawn: entry.drawn,
        clipped: entry.clipped,
      };
    }),
  };
}

function legendEntryIdentityMatches(
  sourceEntries: NonNullable<LegendSnapshot['visibleEntryItems']>,
  renderedEntries: NonNullable<NonNullable<LegendSnapshot['rendered']>['entries']>,
): boolean {
  if (sourceEntries.length !== renderedEntries.length) return false;
  return sourceEntries.every((source, index) => {
    const rendered = renderedEntries[index];
    if (!rendered) return false;
    if (source.legendKey || rendered.legendKey) return source.legendKey === rendered.legendKey;
    if (source.colorKey || rendered.colorKey) return source.colorKey === rendered.colorKey;
    if (source.pointKey || rendered.pointKey) return source.pointKey === rendered.pointKey;
    if (source.pointIndex !== undefined || rendered.pointIndex !== undefined) {
      return source.pointIndex === rendered.pointIndex;
    }
    return source.text === rendered.text;
  });
}

function hasPieDoughnutPointLegendVocabulary(
  legend: LegendSnapshot | undefined,
  sourceEntries: NonNullable<LegendSnapshot['visibleEntryItems']>,
): boolean {
  if (!legend) return false;
  if (legend.entryVocabulary === 'point') return sourceEntries.every(hasLegendPointIdentity);
  if (legend.entryIndexKind !== 'point') return false;
  return sourceEntries.every(hasLegendPointIdentity);
}

function hasLegendPointIdentity(
  entry: NonNullable<LegendSnapshot['visibleEntryItems']>[number],
): boolean {
  return (
    entry.pointKey !== undefined ||
    entry.legendKey !== undefined ||
    entry.colorKey !== undefined ||
    entry.pointIndex !== undefined
  );
}

function pieDoughnutLegendFlowEvidenceGap(input: {
  position: string | undefined;
  trace: LegendTrace;
  renderedEntryCount: number;
  sourceEntryCount: number;
}): string | undefined {
  if (!isCalibratedPieDoughnutLegendPosition(input.position)) {
    return 'legendPositionNotCalibrated';
  }
  if (!input.trace.area || !isFiniteLegendBox(input.trace.area)) {
    return 'legendAreaMissing';
  }

  const flow = input.trace.flow;
  if (!flow) return 'legendTraceMissing';
  if (!finiteLegendFlowMetrics(flow)) return 'legendFlowMetricsMissing';
  if (input.renderedEntryCount !== input.sourceEntryCount) {
    return 'legendRenderedEntryCountMismatch';
  }
  if (flow.renderedEntryCount !== input.renderedEntryCount) {
    return 'legendFlowRenderedEntryCountMismatch';
  }
  if (flow.entries.length !== input.renderedEntryCount) {
    return 'legendFlowEntryCountMismatch';
  }
  if (!flow.entries.every((entry) => isFiniteLegendFlowEntry(entry))) {
    return 'legendFlowEntryBoundsMissing';
  }
  return undefined;
}

function isCalibratedPieDoughnutLegendPosition(position: string | undefined): boolean {
  return (
    position === 'left' ||
    position === 'right' ||
    position === 'top' ||
    position === 'bottom'
  );
}

function finiteLegendFlowMetrics(flow: NonNullable<LegendTrace['flow']>): boolean {
  return [
    flow.entryCount,
    flow.renderedEntryCount,
    flow.visibleEntryCount,
    flow.clippedEntryCount,
    flow.rowCount,
    flow.columnCount,
    flow.rowGap,
    flow.entryGap,
    flow.contentWidth,
    flow.contentHeight,
  ].every((value) => Number.isFinite(value) && value >= 0);
}

function isFiniteLegendFlowEntry(
  entry: NonNullable<LegendTrace['flow']>['entries'][number],
): boolean {
  return (
    Number.isFinite(entry.entryIndex) &&
    Number.isFinite(entry.rowIndex) &&
    Number.isFinite(entry.columnIndex) &&
    isFiniteLegendBox(entry) &&
    isFiniteLegendBox(entry.symbolBounds) &&
    isFiniteLegendBox(entry.labelBounds)
  );
}

function isFiniteLegendBox(box: { x: number; y: number; width: number; height: number }): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width >= 0 &&
    box.height >= 0
  );
}

function pieDoughnutLabelLayoutSnapshot(input: {
  geometry: PieDoughnutGeometryModel;
  layoutHints: ReturnType<typeof pieDoughnutLayoutHintsForConfig>;
  trace?: PieDoughnutLabelLayoutTrace;
}): PieDoughnutLabelLayoutSnapshot {
  const hints = input.layoutHints;
  const labelCount = positiveInteger(hints?.labelCount) ?? 0;
  const outsideLabelCount = positiveInteger(hints?.outsideLabelCount) ?? 0;
  const defaultLabelCount = positiveInteger(hints?.defaultLabelCount) ?? 0;
  const zeroValueLabelCount = positiveInteger(hints?.zeroValueLabelCount) ?? 0;
  const nearZeroValueLabelCount = positiveInteger(hints?.nearZeroValueLabelCount) ?? 0;
  const maxLabelTextLength = positiveInteger(hints?.maxLabelTextLength) ?? 0;
  const trace = input.trace;
  const labels = (trace?.labels ?? []).map(pieDoughnutLabelTraceEntrySnapshot);
  const renderedLabelCount = trace?.labels.length ?? 0;
  const base = {
    labelCount,
    renderedLabelCount,
    defaultLabelCount,
    zeroValueLabelCount,
    nearZeroValueLabelCount,
    outsideLabelCount,
    maxLabelTextLength,
    labels,
  };

  if (labelCount <= 0) {
    return {
      status: 'verifiedDefault',
      ...base,
      leaderLinePolicy: 'none',
      collisionPolicy: 'notApplicable',
      overflowPolicy: 'notApplicable',
    };
  }

  const leaderLinePolicy = outsideLabelCount > 0 || labels.some((label) => label.leaderVisible)
    ? 'outsideLabels'
    : 'none';
  const nonPromotableReason = pieDoughnutNonPromotableLabelReason({
    geometry: input.geometry,
    labelCount,
    outsideLabelCount,
    defaultLabelCount,
    zeroValueLabelCount,
    nearZeroValueLabelCount,
  });

  if (nonPromotableReason) {
    return {
      status: 'approximate',
      statusReason: nonPromotableReason,
      ...base,
      leaderLinePolicy,
      collisionPolicy: 'estimated',
      overflowPolicy: 'estimated',
    };
  }

  if (!trace) {
    return {
      status: 'approximate',
      statusReason: 'labelBoundsTraceMissing',
      ...base,
      leaderLinePolicy,
      collisionPolicy: 'estimated',
      overflowPolicy: 'estimated',
    };
  }

  if (!pieDoughnutLabelTraceDimensionsMatch(input.geometry, trace)) {
    return {
      status: 'approximate',
      statusReason: 'labelBoundsTraceMissing',
      ...base,
      leaderLinePolicy,
      collisionPolicy: 'estimated',
      overflowPolicy: 'estimated',
    };
  }

  if (trace.labels.some((label) => label.layoutTarget !== undefined)) {
    return {
      status: 'approximate',
      statusReason: input.geometry.labelLayoutStatusReason ?? 'dataLabelBoundsEstimated',
      ...base,
      leaderLinePolicy,
      collisionPolicy: 'estimated',
      overflowPolicy: 'estimated',
    };
  }

  if (
    trace.labels.length !== labelCount ||
    !pieDoughnutLabelTraceIdentityMatches(input.geometry, trace)
  ) {
    return {
      status: 'approximate',
      statusReason: 'labelBoundsIdentityMismatch',
      ...base,
      leaderLinePolicy,
      collisionPolicy: 'estimated',
      overflowPolicy: 'estimated',
    };
  }

  if (!trace.labels.every(isFinitePieDoughnutLabelTraceEntry)) {
    return {
      status: 'approximate',
      statusReason: 'labelBoundsTraceMissing',
      ...base,
      leaderLinePolicy,
      collisionPolicy: 'estimated',
      overflowPolicy: 'estimated',
    };
  }

  if (trace.labels.some((label) => label.measurementAuthority === 'estimated')) {
    return {
      status: 'approximate',
      statusReason: 'labelBoundsMeasurementEstimated',
      ...base,
      leaderLinePolicy,
      collisionPolicy: 'estimated',
      overflowPolicy: 'estimated',
    };
  }

  const collisionObserved = pieDoughnutLabelCollisionObserved(trace.labels);
  if (collisionObserved) {
    return {
      status: 'approximate',
      statusReason: 'labelCollisionObserved',
      ...base,
      leaderLinePolicy,
      collisionPolicy: 'observed',
      overflowPolicy: pieDoughnutLabelOverflowObserved(input.geometry, trace.labels)
        ? 'observed'
        : 'noneObserved',
    };
  }

  const overflowObserved = pieDoughnutLabelOverflowObserved(input.geometry, trace.labels);
  if (overflowObserved) {
    return {
      status: 'approximate',
      statusReason: 'labelOverflowObserved',
      ...base,
      leaderLinePolicy,
      collisionPolicy: 'noneObserved',
      overflowPolicy: 'observed',
    };
  }

  return {
    status: 'exact',
    ...base,
    leaderLinePolicy,
    collisionPolicy: 'noneObserved',
    overflowPolicy: 'noneObserved',
  };
}

function pieDoughnutNonPromotableLabelReason(input: {
  geometry: PieDoughnutGeometryModel;
  labelCount: number;
  outsideLabelCount: number;
  defaultLabelCount: number;
  zeroValueLabelCount: number;
  nearZeroValueLabelCount: number;
}): string | undefined {
  if (input.labelCount <= 0) return undefined;
  if (input.outsideLabelCount > 0) return 'outsideLabelBoundsEstimated';
  if (input.geometry.family !== 'pie' && input.geometry.family !== 'doughnut') {
    return input.geometry.labelLayoutStatusReason ?? 'dataLabelBoundsEstimated';
  }
  if (input.geometry.layoutAuthority !== 'manualLayout') {
    return input.geometry.labelLayoutStatusReason ?? 'defaultLabelAutoPlacementEstimated';
  }
  if (input.geometry.ringCount !== 1) {
    return input.geometry.labelLayoutStatusReason ?? 'dataLabelBoundsEstimated';
  }
  if (
    input.defaultLabelCount <= 0 &&
    input.zeroValueLabelCount <= 0 &&
    input.nearZeroValueLabelCount <= 0
  ) {
    return input.geometry.labelLayoutStatusReason ?? 'dataLabelBoundsEstimated';
  }
  return undefined;
}

function pieDoughnutLabelTraceEntrySnapshot(
  label: PieDoughnutLabelLayoutTrace['labels'][number],
): PieDoughnutLabelLayoutEntrySnapshot {
  return {
    seriesIndex: label.seriesIndex,
    ...(label.sourceSeriesIndex !== undefined
      ? { sourceSeriesIndex: label.sourceSeriesIndex }
      : {}),
    ...(label.sourceSeriesKey !== undefined ? { sourceSeriesKey: label.sourceSeriesKey } : {}),
    pointIndex: label.pointIndex,
    ...(label.pointKey !== undefined ? { pointKey: label.pointKey } : {}),
    text: label.text,
    ...(label.position !== undefined ? { position: label.position } : {}),
    labelX: label.labelX,
    labelY: label.labelY,
    anchor: label.anchor,
    bounds: label.bounds,
    ...(label.maxWidth !== undefined ? { maxWidth: label.maxWidth } : {}),
    font: label.font,
    ...(label.lineHeight !== undefined ? { lineHeight: label.lineHeight } : {}),
    leaderVisible: label.leaderVisible,
    zeroValue: label.zeroValue,
    nearZeroValue: label.nearZeroValue,
    ...(label.layoutTarget !== undefined ? { layoutTarget: label.layoutTarget } : {}),
    coordinateSystem: label.coordinateSystem,
    measurementAuthority: label.measurementAuthority,
  };
}

function pieDoughnutLabelTraceDimensionsMatch(
  geometry: PieDoughnutGeometryModel,
  trace: PieDoughnutLabelLayoutTrace,
): boolean {
  return (
    sameTraceNumber(geometry.chartWidth, trace.chartWidth) &&
    sameTraceNumber(geometry.chartHeight, trace.chartHeight) &&
    sameTraceNumber(geometry.plotArea.x, trace.plotArea.x) &&
    sameTraceNumber(geometry.plotArea.y, trace.plotArea.y) &&
    sameTraceNumber(geometry.plotArea.width, trace.plotArea.width) &&
    sameTraceNumber(geometry.plotArea.height, trace.plotArea.height) &&
    geometry.coordinateSystem === trace.coordinateSystem &&
    geometry.family === trace.family
  );
}

function pieDoughnutLabelTraceIdentityMatches(
  geometry: PieDoughnutGeometryModel,
  trace: PieDoughnutLabelLayoutTrace,
): boolean {
  const slices = geometry.rings.flatMap((ring) => ring.slices);
  return trace.labels.every((label) =>
    slices.some((slice) => {
      if (label.pointKey || slice.pointKey) return label.pointKey === slice.pointKey;
      return label.seriesIndex === slice.seriesIndex && label.pointIndex === slice.pointIndex;
    }),
  );
}

function isFinitePieDoughnutLabelTraceEntry(
  label: PieDoughnutLabelLayoutTrace['labels'][number],
): boolean {
  return (
    Number.isFinite(label.labelX) &&
    Number.isFinite(label.labelY) &&
    Number.isFinite(label.anchor.x) &&
    Number.isFinite(label.anchor.y) &&
    isFinitePieDoughnutBox(label.bounds) &&
    (label.maxWidth === undefined || Number.isFinite(label.maxWidth)) &&
    Number.isFinite(label.font.size)
  );
}

function pieDoughnutLabelCollisionObserved(
  labels: PieDoughnutLabelLayoutTrace['labels'],
): boolean {
  for (let i = 0; i < labels.length; i += 1) {
    const first = labels[i];
    if (!first) continue;
    for (let j = i + 1; j < labels.length; j += 1) {
      const second = labels[j];
      if (second && pieDoughnutBoxesOverlap(first.bounds, second.bounds)) return true;
    }
  }
  return false;
}

function pieDoughnutBoxesOverlap(
  a: PieDoughnutBoxSnapshot,
  b: PieDoughnutBoxSnapshot,
): boolean {
  return (
    a.x + a.width > b.x + PIE_DOUGHNUT_LABEL_TOLERANCE_PX &&
    b.x + b.width > a.x + PIE_DOUGHNUT_LABEL_TOLERANCE_PX &&
    a.y + a.height > b.y + PIE_DOUGHNUT_LABEL_TOLERANCE_PX &&
    b.y + b.height > a.y + PIE_DOUGHNUT_LABEL_TOLERANCE_PX
  );
}

function pieDoughnutLabelOverflowObserved(
  geometry: PieDoughnutGeometryModel,
  labels: PieDoughnutLabelLayoutTrace['labels'],
): boolean {
  const frame = {
    x: 0,
    y: 0,
    width: geometry.chartWidth,
    height: geometry.chartHeight,
  };
  return labels.some((label) => !pieDoughnutBoxInside(label.bounds, frame));
}

function pieDoughnutBoxInside(
  box: PieDoughnutBoxSnapshot,
  frame: PieDoughnutBoxSnapshot,
): boolean {
  return (
    box.x >= frame.x - PIE_DOUGHNUT_LABEL_TOLERANCE_PX &&
    box.y >= frame.y - PIE_DOUGHNUT_LABEL_TOLERANCE_PX &&
    box.x + box.width <= frame.x + frame.width + PIE_DOUGHNUT_LABEL_TOLERANCE_PX &&
    box.y + box.height <= frame.y + frame.height + PIE_DOUGHNUT_LABEL_TOLERANCE_PX
  );
}

function isFinitePieDoughnutBox(box: PieDoughnutBoxSnapshot): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width >= 0 &&
    box.height >= 0
  );
}

function sameTraceNumber(a: number, b: number): boolean {
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <= PIE_DOUGHNUT_LABEL_TOLERANCE_PX
  );
}

function pieDoughnutExplosionEnvelopeSnapshot(
  geometry: PieDoughnutGeometryModel,
): NonNullable<PieDoughnutGeometrySnapshot['explosionEnvelope']> {
  const slices = geometry.rings
    .flatMap((ring) => ring.slices)
    .filter((slice) => slice.explosionPercent > 0 || slice.explosionOffset > 0)
    .map((slice) => ({
      seriesIndex: slice.seriesIndex,
      pointIndex: slice.pointIndex,
      pointKey: slice.pointKey,
      explosionPercent: slice.explosionPercent,
      explosionOffset: slice.explosionOffset,
      arcBox: slice.arcBox,
    }));
  return {
    status: geometry.explosionLayoutStatus,
    ...(geometry.explosionLayoutStatusReason
      ? { statusReason: geometry.explosionLayoutStatusReason }
      : {}),
    maxExplosionPercent: slices.reduce(
      (max, slice) => Math.max(max, slice.explosionPercent),
      0,
    ),
    maxExplosionOffset: slices.reduce(
      (max, slice) => Math.max(max, slice.explosionOffset),
      0,
    ),
    effectBleed: geometry.styleReservation.radial,
    reservation: geometry.explosionReservation,
    ...(slices.length > 0
      ? { unionBounds: unionPieDoughnutBoxes(slices.map((slice) => slice.arcBox)) }
      : {}),
    slices,
  };
}

function pieDoughnutStyleFootprintSnapshot(
  config: ChartConfig,
  geometry: PieDoughnutGeometryModel,
): NonNullable<PieDoughnutGeometrySnapshot['styleFootprint']> {
  const frameEffectFlags = compactStrings([
    config.roundedCorners ? 'roundedFrame' : undefined,
    hasVisibleShadow(config.chartArea?.format?.shadow) ? 'chartAreaShadow' : undefined,
    hasVisibleShadow(config.chartFormat?.shadow) ? 'chartFormatShadow' : undefined,
    hasVisibleShadow(config.plotArea?.format?.shadow) ? 'plotAreaShadow' : undefined,
    hasVisibleShadow(config.plotFormat?.shadow) ? 'plotFormatShadow' : undefined,
    hasUnmodeledFill(config.chartArea?.format?.fill) ? 'chartAreaFillEffect' : undefined,
    hasUnmodeledFill(config.chartFormat?.fill) ? 'chartFormatFillEffect' : undefined,
    hasUnmodeledFill(config.plotArea?.format?.fill) ? 'plotAreaFillEffect' : undefined,
    hasUnmodeledFill(config.plotFormat?.fill) ? 'plotFormatFillEffect' : undefined,
  ]);
  const sliceEffectFlags = compactStrings([
    typeof config.style === 'number' ? 'builtInChartStyle' : undefined,
    ...((config.series ?? []).flatMap((series, seriesIndex) =>
      pieDoughnutSeriesStyleFlags(series, seriesIndex),
    )),
  ]);
  return {
    status: geometry.styleFootprintStatus,
    ...(geometry.styleFootprintStatusReason
      ? { statusReason: geometry.styleFootprintStatusReason }
      : {}),
    sliceStyleStatus: geometry.sliceStyleStatus,
    ...(geometry.sliceStyleStatusReason
      ? { sliceStyleStatusReason: geometry.sliceStyleStatusReason }
      : {}),
    ...(typeof config.style === 'number' ? { chartStyleId: config.style } : {}),
    hasChartStyleContext: config.chartStyleContext !== undefined,
    styleOwnerCount: config.chartStyleContext?.owners?.length ?? 0,
    ...(geometry.styleContextStatus
      ? { styleContextStatus: geometry.styleContextStatus }
      : {}),
    ...(geometry.styleContextReason
      ? { styleContextReason: geometry.styleContextReason }
      : {}),
    ...(geometry.styleContextEffectFlags?.length
      ? { styleContextEffectFlags: geometry.styleContextEffectFlags }
      : {}),
    ...(geometry.unmodeledStyleOwnerKeys?.length
      ? { unmodeledOwnerKeys: geometry.unmodeledStyleOwnerKeys }
      : {}),
    ...(geometry.styleContextReservationMode
      ? { styleContextReservationMode: geometry.styleContextReservationMode }
      : {}),
    ...(geometry.modeledStyleContextEffectBleed !== undefined
      ? {
          modeledReservation: {
            source: 'styleContext' as const,
            effectBleed: geometry.modeledStyleContextEffectBleed,
            ...(geometry.styleContextReservationMode
              ? { mode: geometry.styleContextReservationMode }
              : {}),
          },
        }
      : {}),
    explicitSeriesFormatCount: (config.series ?? []).filter((series) => series.format).length,
    explicitPointFormatCount: (config.series ?? []).reduce(
      (count, series) => count + (series.points?.filter((point) => point.visualFormat).length ?? 0),
      0,
    ),
    frameEffectFlags,
    sliceEffectFlags,
    effectBleed: geometry.styleReservation.radial,
  };
}

function pieDoughnutSeriesStyleFlags(
  series: NonNullable<ChartConfig['series']>[number],
  seriesIndex: number,
): string[] {
  const flags: string[] = [];
  if (series.showShadow || hasVisibleShadow(series.format?.shadow)) {
    flags.push(`series(${seriesIndex})Shadow`);
  }
  if (hasUnmodeledFill(series.format?.fill)) {
    flags.push(`series(${seriesIndex})FillEffect`);
  }
  for (const point of series.points ?? []) {
    if (hasVisibleShadow(point.visualFormat?.shadow)) {
      flags.push(`series(${seriesIndex})Point(${point.idx})Shadow`);
    }
    if (hasUnmodeledFill(point.visualFormat?.fill)) {
      flags.push(`series(${seriesIndex})Point(${point.idx})FillEffect`);
    }
  }
  return flags;
}

function pieDoughnutLegendPosition(config: ChartConfig): string | undefined {
  if (!config.legend || config.legend.position === 'none') return 'none';
  if (config.legend.overlay === true) return 'overlay';
  return config.legend.position ?? 'right';
}

function unionPieDoughnutBoxes(boxes: readonly PieDoughnutBoxSnapshot[]): PieDoughnutBoxSnapshot {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function hasVisibleShadow(shadow: { visible?: boolean } | undefined): boolean {
  return shadow !== undefined && shadow.visible !== false;
}

function hasUnmodeledFill(fill: { type?: string } | undefined): boolean {
  return fill?.type === 'gradient' || fill?.type === 'pattern';
}

function compactStrings(values: ReadonlyArray<string | undefined>): string[] {
  return values.filter((value): value is string => value !== undefined);
}

export function snapshotStockGlyphGeometry(
  config: ChartConfig,
  trace: StockGlyphTrace | undefined,
): StockGlyphGeometrySnapshot | undefined {
  if (!trace) {
    return config.type === 'stock' || isStockSubType(config.subType)
      ? {
          geometryStatus: 'unavailable',
          geometryStatusReason: 'stockGlyphTraceUnavailable',
        }
      : undefined;
  }

  return {
    geometryStatus: 'available',
    coordinateSystem: trace.coordinateSystem,
    chartWidth: trace.chartWidth,
    chartHeight: trace.chartHeight,
    plotArea: trace.plotArea,
    subType: trace.subType,
    xMode: trace.xMode,
    renderedPointCount: trace.renderedPointCount,
    categoryPitch: trace.categoryPitch,
    glyphWidth: trace.glyphWidth,
    ...(trace.gapWidth !== undefined ? { gapWidth: trace.gapWidth } : {}),
    ...(trace.slotOccupancy !== undefined ? { slotOccupancy: trace.slotOccupancy } : {}),
    tickLength: trace.tickLength,
    ...(trace.volumeBarWidth !== undefined ? { volumeBarWidth: trace.volumeBarWidth } : {}),
    ...(trace.priceScale !== undefined ? { priceScale: trace.priceScale } : {}),
    ...(trace.volumeScale !== undefined ? { volumeScale: trace.volumeScale } : {}),
    ...(trace.volumeAxisPolicy !== undefined ? { volumeAxisPolicy: trace.volumeAxisPolicy } : {}),
    ...(trace.highLowEndpointPolicy !== undefined
      ? { highLowEndpointPolicy: trace.highLowEndpointPolicy }
      : {}),
    ...(trace.volumeSurface !== undefined ? { volumeSurface: trace.volumeSurface } : {}),
    ...(trace.visual !== undefined ? { visual: trace.visual } : {}),
    layers: trace.layers,
    points: trace.points,
  };
}

function isStockSubType(value: unknown): boolean {
  return (
    value === 'hlc' ||
    value === 'ohlc' ||
    value === 'volume-hlc' ||
    value === 'volume-ohlc'
  );
}

function isPathDepthThreeDConfig(config: ChartConfig): boolean {
  return (
    config.type === 'bar3d' ||
    config.type === 'column3d' ||
    config.type === 'line3d' ||
    config.type === 'pie3d' ||
    config.type === 'pie3dExploded' ||
    config.type === 'area3d' ||
    isDecorativeThreeDBarShapeConfig(config.type)
  );
}

function isDecorativeThreeDBarShapeConfig(type: ChartConfig['type']): boolean {
  return (
    type === 'cylinderColClustered' ||
    type === 'cylinderColStacked' ||
    type === 'cylinderColStacked100' ||
    type === 'cylinderBarClustered' ||
    type === 'cylinderBarStacked' ||
    type === 'cylinderBarStacked100' ||
    type === 'cylinderCol' ||
    type === 'coneColClustered' ||
    type === 'coneColStacked' ||
    type === 'coneColStacked100' ||
    type === 'coneBarClustered' ||
    type === 'coneBarStacked' ||
    type === 'coneBarStacked100' ||
    type === 'coneCol' ||
    type === 'pyramidColClustered' ||
    type === 'pyramidColStacked' ||
    type === 'pyramidColStacked100' ||
    type === 'pyramidBarClustered' ||
    type === 'pyramidBarStacked' ||
    type === 'pyramidBarStacked100' ||
    type === 'pyramidCol'
  );
}

export function snapshotThreeDApproximation(input: {
  config: ChartConfig;
  chartData: ChartData;
  familySupport?: FamilySupportSnapshot;
  trace?: ThreeDApproximationTrace;
}): ThreeDApproximationSnapshot | undefined {
  if (
    input.familySupport?.reason !== 'threeDApproximation' ||
    !isPathDepthThreeDConfig(input.config)
  ) {
    return undefined;
  }

  const trace = input.trace;
  const layer = trace?.layers[0];
  const barShapes = snapshotThreeDBarShapes(input.config, layer?.barShapes);
  const gapDepth = chartGapDepthForSnapshot(input.config, layer?.gapDepth);
  return {
    schemaVersion: 1,
    renderer: 'pathDepthApproximation',
    chartType: String(input.config.type),
    markFamily: layer?.markFamily,
    sourceFamily: input.familySupport.sourceFamily ?? layer?.sourceFamily,
    renderedMarkType: layer?.renderedMarkType,
    ...(input.config.view3d ?? layer?.view3d
      ? { view3d: input.config.view3d ?? layer?.view3d }
      : {}),
    ...(gapDepth !== undefined ? { gapDepth } : {}),
    ...(layer?.depthSource ? { depthSource: layer.depthSource } : {}),
    ...(layer?.depthVector ? { depthVector: roundVector(layer.depthVector) } : {}),
    ...(layer?.depthClampStatus ? { depthClampStatus: layer.depthClampStatus } : {}),
    ...(barShapes ? { barShapes } : {}),
    sourceSeriesCount: trace
      ? sumTraceLayerNumbers(trace.layers, 'sourceSeriesCount')
      : input.chartData.series.length,
    sourcePointCount: trace
      ? sumTraceLayerNumbers(trace.layers, 'sourcePointCount')
      : sourcePointCount(input.chartData),
    renderablePointCount: trace
      ? sumTraceLayerNumbers(trace.layers, 'renderablePointCount')
      : renderablePointCount(input.chartData),
    markCount: trace?.markCount ?? 0,
    faceCounts: trace?.faceCounts ?? emptyThreeDFaceCounts(),
    ...(trace?.projection ? { projection: trace.projection } : {}),
    wallSurfaceStatus: wallSurfaceStatus(input.config),
    geometryStatus: trace ? trace.geometryStatus : 'traceMissing',
  };
}

export function snapshotSurfaceApproximation(input: {
  config: ChartConfig;
  chartData: ChartData;
  familySupport?: FamilySupportSnapshot;
  trace?: SurfaceApproximationTrace;
}): SurfaceApproximationSnapshot | undefined {
  const reason = input.familySupport?.reason;
  if (!isSurfaceApproximationReason(reason)) return undefined;

  const trace = input.trace;
  const contractKind =
    trace?.contractKind ??
    surfaceApproximationContractForConfig(input.config) ??
    surfaceApproximationContractKindForReason(reason);
  if (!contractKind) return undefined;
  const contract = surfaceApproximationContractFields(contractKind);
  const domain = {
    ...(trace?.valueDomain ?? surfaceValueDomain(input.chartData)),
    ...valueAxisDomain(input.config),
  };

  return {
    schemaVersion: 1,
    renderer: contract.renderer,
    mode: contract.mode,
    contractKind,
    topView: contract.topView,
    wireframe: contract.wireframe,
    chartType: String(input.config.type),
    ...(input.config.view3d ?? trace?.layers[0]?.view3d
      ? { view3d: input.config.view3d ?? trace?.layers[0]?.view3d }
      : {}),
    grid: trace?.grid ?? surfaceGridSnapshot(input.chartData),
    valueDomain: domain,
    bands: surfaceBandsSnapshot(trace?.bands, input.config),
    markCounts: trace?.markCounts ?? emptySurfaceMarkCounts(),
    plotAreaPolicy: contract.plotAreaPolicy,
    ...(trace?.density ? { density: trace.density } : {}),
    ...(trace?.projection ? { projection: trace.projection } : {}),
    geometryStatus: trace ? trace.geometryStatus : 'traceMissing',
  };
}

function isSurfaceApproximationReason(
  reason: FamilySupportSnapshot['reason'] | undefined,
): boolean {
  switch (reason) {
    case 'surface3dFilledApproximation':
    case 'surface3dWireframeApproximation':
    case 'contourFilledApproximation':
    case 'contourWireframeApproximation':
    case 'surfaceApproximation':
    case 'contourApproximation':
      return true;
    default:
      return false;
  }
}

function surfaceApproximationContractKindForReason(
  reason: FamilySupportSnapshot['reason'] | undefined,
): SurfaceApproximationContractKind | undefined {
  switch (reason) {
    case 'surface3dFilledApproximation':
      return 'surface3dFilled';
    case 'surface3dWireframeApproximation':
      return 'surface3dWireframe';
    case 'contourFilledApproximation':
      return 'contourFilled';
    case 'contourWireframeApproximation':
      return 'contourWireframe';
    default:
      return undefined;
  }
}

function surfaceApproximationContractFields(contractKind: SurfaceApproximationContractKind): Pick<
  SurfaceApproximationSnapshot,
  'renderer' | 'mode' | 'topView' | 'wireframe' | 'plotAreaPolicy'
> {
  switch (contractKind) {
    case 'surface3dWireframe':
      return {
        renderer: 'mogSurfaceApproximation',
        mode: 'surface3d',
        topView: false,
        wireframe: true,
        plotAreaPolicy: 'normalizedProjectedCube',
      };
    case 'contourFilled':
      return {
        renderer: 'mogContourApproximation',
        mode: 'contour',
        topView: true,
        wireframe: false,
        plotAreaPolicy: 'squareTopView',
      };
    case 'contourWireframe':
      return {
        renderer: 'mogContourApproximation',
        mode: 'contour',
        topView: true,
        wireframe: true,
        plotAreaPolicy: 'squareTopView',
      };
    case 'surface3dFilled':
    default:
      return {
        renderer: 'mogSurfaceApproximation',
        mode: 'surface3d',
        topView: false,
        wireframe: false,
        plotAreaPolicy: 'normalizedProjectedCube',
      };
  }
}

function chartGapDepthForSnapshot(
  config: ChartConfig,
  traceGapDepth: number | undefined,
): number | undefined {
  return finiteNumber(config.gapDepth) ?? traceGapDepth;
}

function roundVector(vector: { x: number; y: number }): { x: number; y: number } {
  return {
    x: roundSnapshotNumber(vector.x),
    y: roundSnapshotNumber(vector.y),
  };
}

function snapshotThreeDBarShapes(
  config: ChartConfig,
  trace: ThreeDApproximationTrace['layers'][number]['barShapes'] | undefined,
): ThreeDApproximationSnapshot['barShapes'] | undefined {
  const chartShape = resolvedThreeDBarShape(config.barShape) ?? trace?.chartShape;
  type SeriesShapeSnapshot = NonNullable<
    NonNullable<ThreeDApproximationSnapshot['barShapes']>['seriesShapes']
  >[number];
  const seriesShapes: SeriesShapeSnapshot[] = (config.series ?? []).flatMap(
    (series, index): SeriesShapeSnapshot[] => {
      const shape = resolvedThreeDBarShape(series.barShape);
      if (!shape) return [];
      return [
        {
          seriesIndex: index,
          ...(series.sourceSeriesIndex !== undefined
            ? { sourceSeriesIndex: series.sourceSeriesIndex }
            : {}),
          ...(series.sourceSeriesKey ? { sourceSeriesKey: series.sourceSeriesKey } : {}),
          shape,
        },
      ];
    },
  );
  const distinctShapes = uniqueStrings([
    ...(chartShape ? [chartShape] : []),
    ...(trace?.distinctShapes ?? []),
    ...seriesShapes.map((series) => series.shape),
  ]);

  if (!chartShape && seriesShapes.length === 0 && distinctShapes.length === 0) return undefined;
  return {
    ...(chartShape ? { chartShape } : {}),
    ...(seriesShapes.length > 0
      ? { seriesShapes }
      : trace?.seriesShapes
        ? { seriesShapes: trace.seriesShapes }
        : {}),
    distinctShapes,
  };
}

function resolvedThreeDBarShape(
  value: unknown,
): NonNullable<ThreeDApproximationSnapshot['barShapes']>['distinctShapes'][number] | undefined {
  return isResolvedThreeDBarShape(value) ? value : undefined;
}

function isResolvedThreeDBarShape(
  value: unknown,
): value is NonNullable<ThreeDApproximationSnapshot['barShapes']>['distinctShapes'][number] {
  return (
    value === 'box' ||
    value === 'cylinder' ||
    value === 'cone' ||
    value === 'coneToMax' ||
    value === 'pyramid' ||
    value === 'pyramidToMax'
  );
}

function sumTraceLayerNumbers(
  layers: ThreeDApproximationTrace['layers'],
  field: 'sourceSeriesCount' | 'sourcePointCount' | 'renderablePointCount',
): number {
  return layers.reduce((sum, layer) => sum + layer[field], 0);
}

function sourcePointCount(chartData: ChartData): number {
  return chartData.series.reduce((sum, series) => sum + series.data.length, 0);
}

function renderablePointCount(chartData: ChartData): number {
  let count = 0;
  for (const series of chartData.series) {
    for (const point of series.data) {
      if (point.valueState !== undefined && point.valueState !== 'value') continue;
      if (finiteNumber(point.y) !== undefined) count += 1;
    }
  }
  return count;
}

function emptyThreeDFaceCounts(): ThreeDApproximationSnapshot['faceCounts'] {
  return {
    front: 0,
    back: 0,
    top: 0,
    side: 0,
    connector: 0,
    outer: 0,
    inner: 0,
  };
}

function wallSurfaceStatus(config: ChartConfig): ThreeDApproximationSnapshot['wallSurfaceStatus'] {
  return {
    floor: config.floorFormat ? 'preservedMetadataApproximateRenderer' : 'absent',
    sideWall: config.sideWallFormat ? 'preservedMetadataApproximateRenderer' : 'absent',
    backWall: config.backWallFormat ? 'preservedMetadataApproximateRenderer' : 'absent',
    fidelity: 'metadataPreservedNotExcelEquivalent',
  };
}

function surfaceGridSnapshot(chartData: ChartData): SurfaceApproximationSnapshot['grid'] {
  const rows = chartData.series.length;
  const columns = Math.max(0, ...chartData.series.map((series) => series.data.length));
  const finiteValueCount = renderablePointCount(chartData);
  return {
    rows,
    columns,
    finiteValueCount,
    missingCellCount: Math.max(0, rows * columns - finiteValueCount),
    source: rows >= 2 && columns >= 2 ? 'seriesPointIndexGrid' : 'unavailable',
  };
}

function surfaceValueDomain(chartData: ChartData): SurfaceApproximationSnapshot['valueDomain'] {
  const values: number[] = [];
  for (const series of chartData.series) {
    for (const point of series.data) {
      if (point.valueState !== undefined && point.valueState !== 'value') continue;
      const value = finiteNumber(point.y);
      if (value !== undefined) values.push(value);
    }
  }
  return values.length > 0
    ? {
        dataMin: Math.min(...values),
        dataMax: Math.max(...values),
      }
    : {};
}

function valueAxisDomain(config: ChartConfig): SurfaceApproximationSnapshot['valueDomain'] {
  const axis = config.axis?.valueAxis ?? config.axis?.yAxis;
  const axisMin = finiteNumber(axis?.min);
  const axisMax = finiteNumber(axis?.max);
  const axisMajorUnit = finiteNumber(axis?.majorUnit);
  return {
    ...(axisMin !== undefined ? { axisMin } : {}),
    ...(axisMax !== undefined ? { axisMax } : {}),
    ...(axisMajorUnit !== undefined ? { axisMajorUnit } : {}),
  };
}

function emptySurfaceBands(): SurfaceApproximationSnapshot['bands'] {
  return {
    count: 0,
    entries: [],
    legendOrder: [],
    authority: 'fallback',
  };
}

function surfaceBandsSnapshot(
  traceBands: SurfaceApproximationTrace['bands'] | undefined,
  config: ChartConfig,
): SurfaceApproximationSnapshot['bands'] {
  const sourceBandFormats = sourceBandFormatsForSnapshot(config);
  const bands = traceBands ?? emptySurfaceBands();
  if (bands.sourceBandFormats || sourceBandFormats.length === 0) return bands;
  return {
    ...bands,
    sourceBandFormats,
  };
}

function sourceBandFormatsForSnapshot(
  config: ChartConfig,
): NonNullable<SurfaceApproximationSnapshot['bands']['sourceBandFormats']> {
  return (config.surfaceBandFormats ?? []).flatMap((format) => {
    const index = finiteNumber(format.index);
    if (index === undefined) return [];
    const fillColor =
      typeof format.fillColor === 'string' && format.fillColor.length > 0
        ? format.fillColor
        : undefined;
    return [
      {
        index,
        ...(fillColor ? { fillColor } : {}),
        hasFormatting: format.hasFormatting === true || fillColor !== undefined,
        ...(format.source === 'ooxmlBandFmt' ? { source: 'ooxmlBandFmt' as const } : {}),
      },
    ];
  });
}

function emptySurfaceMarkCounts(): SurfaceApproximationSnapshot['markCounts'] {
  return {
    filledPatches: 0,
    isolineSegments: 0,
    wireSegments: 0,
    frameMarks: 0,
    totalDataMarks: 0,
  };
}

function seriesPointGeometry(
  trace: CartesianGeometryTrace | undefined,
): Map<number, NonNullable<CartesianGeometrySnapshot['series'][number]['pointGeometry']>> {
  const bySeries = new Map<
    number,
    NonNullable<CartesianGeometrySnapshot['series'][number]['pointGeometry']>
  >();
  if (!trace) return bySeries;

  for (const layer of trace.layers) {
    for (const point of layer.points) {
      if (point.seriesIndex === undefined) continue;
      const current = bySeries.get(point.seriesIndex) ?? [];
      current.push(snapshotPointGeometry(point, layer));
      bySeries.set(point.seriesIndex, current);
    }
  }
  return bySeries;
}

function snapshotPointGeometry(
  point: CartesianGeometryPointTrace,
  layer: CartesianGeometryLayerTrace,
): NonNullable<CartesianGeometrySnapshot['series'][number]['pointGeometry']>[number] {
  return {
    ...point,
    layerIndex: layer.layerIndex,
    markType: layer.markType,
    layerRole: layer.layerRole,
    sizeAuthority: layer.sizeAuthority,
  };
}

function snapshotLayerGeometry(
  layer: CartesianGeometryLayerTrace,
  trace: CartesianGeometryTrace,
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
  plan: NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>,
): NonNullable<CartesianGeometrySnapshot['layers']>[number] {
  const seriesIndices = uniqueNumbers(
    layer.points
      .map((point) => point.seriesIndex)
      .filter((value): value is number => value !== undefined),
  );
  const axisRoles = layerAxisRoles(layer, plan, seriesIndices);
  const yScale = snapshotScaleGeometry(layer.yScale, trace, layout, 'y');
  return {
    layerIndex: layer.layerIndex,
    markType: layer.markType,
    layerRole: layer.layerRole,
    sizeAuthority: layer.sizeAuthority,
    pathOrder: layer.pathOrder,
    xField: layer.xField,
    yField: layer.yField,
    sizeField: layer.sizeField,
    ...axisRoles,
    xScale: snapshotScaleGeometry(layer.xScale, trace, layout, 'x'),
    yScale: yScale
      ? compactObject({
          ...yScale,
          ...layerYValueScaleSnapshot(plan, trace, axisRoles.yAxisRole),
        })
      : undefined,
    ...(layer.sizeScale ? { sizeScale: layer.sizeScale } : {}),
    pointCount: layer.points.length,
    seriesIndices,
    ...(layer.areaSurfaceStyles ? { areaSurfaceStyles: layer.areaSurfaceStyles } : {}),
    ...(layer.areaSurfaceExtents ? { areaSurfaceExtents: layer.areaSurfaceExtents } : {}),
    area: layer.area,
  };
}

function pathPlotFrameSnapshot(
  plan: NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>,
  trace: CartesianGeometryTrace,
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
  categoryXScale: CartesianGeometryScaleTrace | undefined,
): Pick<CartesianGeometrySnapshot, 'pathPlotFrame'> {
  const planned = plan.x.category?.pathAxisLayout;
  const rendered = categoryXScale?.pathAxisLayout;
  if (!planned && !rendered) return {};

  const plotArea = trace.plotArea;
  return {
    pathPlotFrame: compactObject({
      renderedPlotArea: plotArea,
      ...(layout?.plotArea ? { normalizedPlotArea: layout.plotArea } : {}),
      reservations: {
        top: roundSnapshotNumber(plotArea.y),
        left: roundSnapshotNumber(plotArea.x),
        right: roundSnapshotNumber(trace.chartWidth - plotArea.x - plotArea.width),
        bottom: roundSnapshotNumber(trace.chartHeight - plotArea.y - plotArea.height),
      },
      ...reconciledPathPlotFrameReservation(rendered ?? planned, {
        trace,
        layout,
      }),
      ...(planned?.axisLength !== undefined ? { preReconcileAxisLength: planned.axisLength } : {}),
      ...(rendered?.axisLength !== undefined ? { postReconcileAxisLength: rendered.axisLength } : {}),
      ...(planned?.categoryPitch !== undefined
        ? { preReconcileCategoryPitch: planned.categoryPitch }
        : {}),
      ...(rendered?.categoryPitch !== undefined
        ? { postReconcileCategoryPitch: rendered.categoryPitch }
        : {}),
    }),
  };
}

function reconciledPathPlotFrameReservation(
  pathAxisLayout:
    | ExcelCartesianPathAxisLayoutSnapshot
    | CartesianGeometryScaleTrace['pathAxisLayout']
    | undefined,
  input: {
    trace: CartesianGeometryTrace;
    layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null;
    scale?: CartesianGeometryScaleTrace;
    categoryCount?: number;
    requireCategoryScaleEvidence?: boolean;
  },
): Pick<CartesianPathPlotFrameSnapshot, 'reservationStatus' | 'reservationStatusReason'> {
  const status = pathAxisLayout?.reservationStatus;
  const reason = pathAxisLayout?.reservationStatusReason;
  if (
    status === 'approximate' &&
    reason === 'importedAutoPathPlotFrameReservationEstimate' &&
    hasRenderedPathPlotFrameEvidence(input.trace, input.layout) &&
    (!input.requireCategoryScaleEvidence ||
      hasRenderedCategoryScaleEvidence(input.scale, input.categoryCount))
  ) {
    return {
      reservationStatus: 'exact',
      reservationStatusReason: undefined,
    };
  }
  return compactObject({
    ...(status ? { reservationStatus: status } : {}),
    ...(reason ? { reservationStatusReason: reason } : {}),
  });
}

function hasRenderedPathPlotFrameEvidence(
  trace: CartesianGeometryTrace,
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
): boolean {
  return (
    layout?.plotArea !== undefined &&
    positiveNumber(trace.plotArea.width) !== undefined &&
    positiveNumber(trace.plotArea.height) !== undefined
  );
}

function hasRenderedCategoryScaleEvidence(
  scale: CartesianGeometryScaleTrace | undefined,
  categoryCount: number | undefined,
): boolean {
  const axisLength = scale?.range
    ? positiveNumber(Math.abs(scale.range[1] - scale.range[0]))
    : undefined;
  const visibleCategoryCount =
    positiveInteger(categoryCount) ?? positiveInteger(scale?.domain?.length);
  return axisLength !== undefined && visibleCategoryCount !== undefined;
}

function reconciledScalePathAxisLayout(
  scale: CartesianGeometryScaleTrace,
  trace: CartesianGeometryTrace,
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
  axis: 'x' | 'y',
): CartesianGeometryScaleTrace['pathAxisLayout'] | undefined {
  const pathAxisLayout = scale.pathAxisLayout;
  if (!pathAxisLayout) return undefined;

  if (axis === 'x') {
    const axisLength = scale.range ? Math.abs(scale.range[1] - scale.range[0]) : undefined;
    const categoryCount = scale.domain?.length ?? 0;
    const categoryPitch =
      axisLength !== undefined && categoryCount > 0 ? axisLength / categoryCount : undefined;
    return compactObject({
      ...pathAxisLayout,
      ...(axisLength !== undefined ? { axisLength } : {}),
      ...(categoryPitch !== undefined ? { categoryPitch } : {}),
      ...(categoryCount > 0
        ? {
            visibleLabelCount: Math.ceil(
              categoryCount / (positiveInteger(pathAxisLayout.categoryTickLabelSkip) ?? 1),
            ),
          }
        : {}),
      ...reconciledPathCategoryAxisLayoutSnapshot(pathAxisLayout, axisLength, categoryPitch),
      ...reconciledPathPlotFrameReservation(pathAxisLayout, {
        trace,
        layout,
        scale,
        categoryCount,
        requireCategoryScaleEvidence: true,
      }),
    });
  }

  return pathAxisLayout;
}

function reconciledPathCategoryAxisLayoutSnapshot(
  pathAxisLayout:
    | ExcelCartesianPathAxisLayoutSnapshot
    | CartesianGeometryScaleTrace['pathAxisLayout'],
  axisLength: number | undefined,
  categoryPitch: number | undefined,
): Pick<
  CartesianPathAxisLayoutSnapshot,
  | 'axisLayoutStatus'
  | 'axisLayoutStatusReason'
  | 'categoryAxisLayoutStatus'
  | 'categoryAxisLayoutStatusReason'
  | 'categoryPitchStatus'
  | 'categoryPitchStatusReason'
  | 'categoryTickStatus'
  | 'categoryTickStatusReason'
> {
  const status = pathAxisLayout?.categoryAxisLayoutStatus ?? pathAxisLayout?.axisLayoutStatus;
  const reason =
    pathAxisLayout?.categoryAxisLayoutStatusReason ?? pathAxisLayout?.axisLayoutStatusReason;
  if (
    status === 'approximate' &&
    reason === 'importedAutoPathCategoryTickSkipHeuristic' &&
    pathAxisLayout?.categoryTickSkipSource === 'importedAuto' &&
    positiveNumber(axisLength) !== undefined &&
    positiveNumber(categoryPitch) !== undefined
  ) {
    return {
      axisLayoutStatus: 'exact',
      axisLayoutStatusReason: undefined,
      categoryAxisLayoutStatus: 'exact',
      categoryAxisLayoutStatusReason: undefined,
      categoryPitchStatus: 'exact',
      categoryPitchStatusReason: undefined,
      categoryTickStatus: 'exact',
      categoryTickStatusReason: undefined,
    };
  }
  return compactObject({
    ...(status ? { categoryPitchStatus: status, categoryTickStatus: status } : {}),
    ...(reason
      ? {
          categoryPitchStatusReason: reason,
          categoryTickStatusReason: reason,
        }
      : {}),
  });
}

function reconciledPathValueAxisLayoutSnapshot(
  plannedAxis: ExcelCartesianGeometryPlanSnapshot['valueAxes'][number] | undefined,
  consistency: Partial<CartesianValueAxisSnapshot>,
): Pick<
  CartesianValueAxisSnapshot,
  | 'axisLayoutStatus'
  | 'axisLayoutStatusReason'
  | 'valueAxisLayoutStatus'
  | 'valueAxisLayoutStatusReason'
> {
  const status = plannedAxis?.valueAxisLayoutStatus ?? plannedAxis?.axisLayoutStatus;
  const reason = plannedAxis?.valueAxisLayoutStatusReason ?? plannedAxis?.axisLayoutStatusReason;
  if (
    status === 'approximate' &&
    reason === 'importedAutoPathValueAxisScaleHeuristic' &&
    plannedAxis?.domain &&
    plannedAxis.tickStep !== undefined &&
    consistency.scaleConsistencyStatus === 'consistent'
  ) {
    return {
      axisLayoutStatus: 'exact',
      axisLayoutStatusReason: undefined,
      valueAxisLayoutStatus: 'exact',
      valueAxisLayoutStatusReason: undefined,
    };
  }
  return {};
}

function snapshotScaleGeometry(
  scale: CartesianGeometryScaleTrace | undefined,
  trace: CartesianGeometryTrace,
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
  axis: 'x' | 'y',
): NonNullable<CartesianGeometrySnapshot['layers']>[number]['xScale'] | undefined {
  if (!scale) return undefined;
  const { crossing: _crossing, pathAxisLayout: _pathAxisLayout, ...scaleSnapshot } = scale;
  const pathAxisLayout = reconciledScalePathAxisLayout(scale, trace, layout, axis);
  return compactObject({
    ...scaleSnapshot,
    ...scaleRangeSnapshot(scale, trace, axis),
    ...(pathAxisLayout ? { pathAxisLayout } : {}),
  });
}

function layerYValueScaleSnapshot(
  plan: NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>,
  trace: CartesianGeometryTrace | undefined,
  yAxisRole: CartesianGeometryValueAxisRole | undefined,
): Pick<
  NonNullable<NonNullable<CartesianGeometrySnapshot['layers']>[number]['yScale']>,
  | 'valueAxisLayoutStatus'
  | 'valueAxisLayoutStatusReason'
  | 'scaleConsistencyStatus'
  | 'scaleConsistencyReason'
> {
  const axisGroup =
    yAxisRole === 'secondaryYValue'
      ? 'secondary'
      : yAxisRole === 'primaryYValue'
        ? 'primary'
        : undefined;
  if (!axisGroup) return {};
  const axis = valueAxisScaleSnapshot(plan, trace, axisGroup);
  return compactObject({
    valueAxisLayoutStatus: axis.valueAxisLayoutStatus ?? axis.axisLayoutStatus,
    valueAxisLayoutStatusReason: axis.valueAxisLayoutStatusReason ?? axis.axisLayoutStatusReason,
    scaleConsistencyStatus: axis.scaleConsistencyStatus,
    scaleConsistencyReason: axis.scaleConsistencyReason,
  });
}

function isBubbleGeometryPoint(
  point: NonNullable<CartesianGeometrySnapshot['series'][number]['pointGeometry']>[number],
): boolean {
  return (
    point.layerRole === 'bubble' ||
    point.sizeAuthority === 'bubbleSize' ||
    (point.layerRole === undefined && point.rawBubbleSize !== undefined)
  );
}

function isMarkerGeometryPoint(
  point: NonNullable<CartesianGeometrySnapshot['series'][number]['pointGeometry']>[number],
): boolean {
  if (isBubbleGeometryPoint(point)) return false;
  if (point.layerRole === 'marker') return true;
  return isPointMarkType(point.markType);
}

function isPointMarkType(markType: string | undefined): boolean {
  return markType === 'point' || markType === 'circle' || markType === 'square';
}

function quantitativeXScaleSnapshot(
  plannedAxis: NonNullable<
    NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>['x']['quantitative']
  >,
  scale: CartesianGeometryScaleTrace | undefined,
  trace: CartesianGeometryTrace | undefined,
): Pick<
  NonNullable<CartesianGeometrySnapshot['x']['quantitative']>,
  | 'renderedAxisOrient'
  | 'tickValues'
  | 'range'
  | 'plotRange'
  | 'crossingStatus'
  | 'crossingStatusReason'
  | 'crossing'
> {
  if (!scale || !trace) return {};
  return {
    renderedAxisOrient: scale.axisOrient,
    tickValues: scale.tickValues,
    ...scaleRangeSnapshot(scale, trace, 'x'),
    ...axisCrossingSnapshot(plannedAxis, scale.crossing, true),
  };
}

function valueAxisScaleSnapshot(
  plan: NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>,
  trace: CartesianGeometryTrace | undefined,
  axisGroup: 'primary' | 'secondary',
): Partial<NonNullable<CartesianGeometrySnapshot['valueAxes'][number]>> {
  if (!trace) return {};
  const plannedAxis = plan.valueAxes.find((axis) => axis.axisGroup === axisGroup);
  const seriesIndices = new Set(
    plan.series
      .filter((series) => series.axisGroup === axisGroup)
      .map((series) => series.seriesIndex),
  );
  const layer = trace.layers.find((item) =>
    item.points.some(
      (point) => point.seriesIndex !== undefined && seriesIndices.has(point.seriesIndex),
    ),
  );
  if (!layer?.yScale) return {};
  const renderedDomain = numericDomainPair(layer.yScale.domain);
  const renderedTickStep = positiveNumber(layer.yScale.tickStep);
  const consistency = scaleConsistencySnapshot({
    plannedDomain: plannedAxis?.domain,
    renderedDomain,
    plannedTickStep: plannedAxis?.tickStep,
    renderedTickStep,
  });
  return {
    ...(renderedDomain ? { domain: renderedDomain } : {}),
    ...(renderedTickStep !== undefined ? { tickStep: renderedTickStep } : {}),
    renderedAxisOrient: layer.yScale.axisOrient,
    tickValues: layer.yScale.tickValues,
    ...scaleRangeSnapshot(layer.yScale, trace, 'y'),
    ...consistency,
    ...reconciledPathValueAxisLayoutSnapshot(plannedAxis, consistency),
    ...axisCrossingSnapshot(plannedAxis, layer.yScale.crossing, true),
  };
}

function categoryXPathAxisLayoutSnapshot(
  category: NonNullable<
    NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>['x']['category']
  >,
  scale: CartesianGeometryScaleTrace | undefined,
  trace: CartesianGeometryTrace | undefined,
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
): Pick<typeof category, 'pathAxisLayout'> | Record<string, never> {
  const pathAxisLayout = scale?.pathAxisLayout ?? category.pathAxisLayout;
  if (!pathAxisLayout || !scale?.range || !trace) return {};
  const axisLength = Math.abs(scale.range[1] - scale.range[0]);
  const categoryPitch = category.pointCount > 0 ? axisLength / category.pointCount : undefined;
  const skip = positiveInteger(pathAxisLayout.categoryTickLabelSkip) ?? 1;
  return {
    pathAxisLayout: compactObject({
      ...pathAxisLayout,
      axisLength,
      ...(categoryPitch !== undefined ? { categoryPitch } : {}),
      visibleLabelCount: Math.ceil(category.pointCount / skip),
      ...reconciledPathCategoryAxisLayoutSnapshot(pathAxisLayout, axisLength, categoryPitch),
      ...reconciledPathPlotFrameReservation(pathAxisLayout, {
        trace,
        layout,
        scale,
        categoryCount: category.pointCount,
        requireCategoryScaleEvidence: true,
      }),
    }),
  };
}

function categoryXLayerScale(
  trace: CartesianGeometryTrace | undefined,
): CartesianGeometryScaleTrace | undefined {
  if (!trace) return undefined;
  return trace.layers.find((layer) => layer.xField === CATEGORY_FIELD && layer.xScale)?.xScale;
}

function quantitativeXLayerScale(
  trace: CartesianGeometryTrace | undefined,
  field: string | undefined,
): CartesianGeometryScaleTrace | undefined {
  if (!trace || !field) return undefined;
  return trace.layers.find((layer) => layer.xField === field && layer.xScale)?.xScale;
}

function layerAxisRoles(
  layer: CartesianGeometryLayerTrace,
  plan: NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>,
  seriesIndices: readonly number[],
): {
  xAxisRole?: CartesianGeometryAxisRole;
  yAxisRole?: CartesianGeometryValueAxisRole;
} {
  const xAxisRole =
    layer.xField === plan.x.quantitative?.field
      ? ('xValue' as const)
      : plan.x.category?.axisRole;
  const yAxisRole = layerValueAxisRole(plan, seriesIndices);
  return {
    ...(xAxisRole ? { xAxisRole } : {}),
    ...(yAxisRole ? { yAxisRole } : {}),
  };
}

function layerValueAxisRole(
  plan: NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>,
  seriesIndices: readonly number[],
): CartesianGeometryValueAxisRole | undefined {
  const seriesIndexSet = new Set(seriesIndices);
  const series = plan.series.find((item) => seriesIndexSet.has(item.seriesIndex));
  if (!series) return undefined;
  return series?.axisGroup === 'secondary' ? 'secondaryYValue' : 'primaryYValue';
}

function scaleRangeSnapshot(
  scale: CartesianGeometryScaleTrace | undefined,
  trace: CartesianGeometryTrace | undefined,
  axis: 'x' | 'y',
): { range?: [number, number]; plotRange?: [number, number] } {
  if (!scale?.range || !trace) return {};
  return {
    range: scale.range,
    plotRange: scale.range.map((value) =>
      axis === 'x'
        ? normalize(value - trace.plotArea.x, trace.plotArea.width)
        : normalize(value - trace.plotArea.y, trace.plotArea.height),
    ) as [number, number],
  };
}

function scaleConsistencySnapshot(input: {
  plannedDomain?: [number, number];
  renderedDomain?: [number, number];
  plannedTickStep?: number;
  renderedTickStep?: number;
}): Partial<NonNullable<CartesianGeometrySnapshot['valueAxes'][number]>> {
  const domainComparable = input.plannedDomain !== undefined && input.renderedDomain !== undefined;
  const tickStepComparable =
    input.plannedTickStep !== undefined && input.renderedTickStep !== undefined;
  if (!domainComparable && !tickStepComparable) return {};

  const domainMismatch =
    domainComparable && !numericPairsEqual(input.plannedDomain!, input.renderedDomain!);
  const tickStepMismatch =
    tickStepComparable && !numbersEqual(input.plannedTickStep!, input.renderedTickStep!);
  if (!domainMismatch && !tickStepMismatch) {
    return { scaleConsistencyStatus: 'consistent' };
  }

  return {
    scaleConsistencyStatus: 'planTraceMismatch',
    scaleConsistencyReason: domainMismatch
      ? 'valueAxisPlanDomainDiffersFromRenderedScale'
      : 'valueAxisPlanTickStepDiffersFromRenderedScale',
    ...(input.plannedDomain ? { plannedDomain: input.plannedDomain } : {}),
    ...(input.renderedDomain ? { renderedDomain: input.renderedDomain } : {}),
    ...(input.plannedTickStep !== undefined ? { plannedTickStep: input.plannedTickStep } : {}),
    ...(input.renderedTickStep !== undefined ? { renderedTickStep: input.renderedTickStep } : {}),
  };
}

function axisCrossingSnapshot(
  plannedAxis:
    | {
        crossingStatus?: string;
        crossingStatusReason?: string;
        crossing?: {
          sourceCrossing?: 'automatic' | 'min' | 'max' | 'custom';
          sourceCrossingValue?: number;
          sourceCategoryCrossing?: 'between' | 'midCat';
          categoryCrossingApplication?:
            | 'applied'
            | 'notApplicableQuantitativePeer'
            | 'defaultBetween'
            | 'defaultMidCat';
          peerAxisKind?: 'quantitative' | 'categoryPoint' | 'dateSerial';
          unsupportedReason?: string;
        };
      }
    | undefined,
  renderedCrossing: CartesianGeometryScaleTrace['crossing'] | undefined,
  traceAvailable: boolean,
): {
  crossingStatus?: 'exact' | 'verifiedDefault' | 'approximate' | 'missing';
  crossingStatusReason?: string;
  crossing?: NonNullable<CartesianGeometrySnapshot['valueAxes'][number]['crossing']>;
} {
  if (!traceAvailable) return {};

  const crossing = resolvedAxisCrossingEvidence(plannedAxis?.crossing, renderedCrossing);
  const plannedStatus = plannedAxis?.crossingStatus;
  const plannedUnsupportedReason =
    plannedAxis?.crossingStatusReason ?? plannedAxis?.crossing?.unsupportedReason;

  if (plannedStatus === 'approximate' || plannedAxis?.crossing?.unsupportedReason) {
    return {
      crossingStatus: 'approximate',
      crossingStatusReason: plannedUnsupportedReason ?? 'valueAxisCrossingUnsupported',
      ...(crossing ? { crossing } : {}),
    };
  }

  if (!renderedCrossing) {
    return {
      crossingStatus: 'missing',
      crossingStatusReason: 'valueAxisCrossingTraceMissing',
      ...(crossing ? { crossing } : {}),
    };
  }

  if (axisCrossingPlanTraceMismatch(plannedAxis?.crossing, renderedCrossing)) {
    return {
      crossingStatus: 'approximate',
      crossingStatusReason: 'valueAxisCrossingPlanTraceMismatch',
      ...(crossing ? { crossing } : {}),
    };
  }

  const status = plannedStatus === 'verifiedDefault' ? 'verifiedDefault' : 'exact';
  return {
    crossingStatus: status,
    crossingStatusReason:
      status === 'verifiedDefault' ? 'excelDefaultCrossing' : 'valueAxisCrossingPlanTraceMatch',
    ...(crossing ? { crossing } : {}),
  };
}

function resolvedAxisCrossingEvidence(
  planned:
    | {
        sourceCrossing?: 'automatic' | 'min' | 'max' | 'custom';
        sourceCrossingValue?: number;
        sourceCategoryCrossing?: 'between' | 'midCat';
        categoryCrossingApplication?:
          | 'applied'
          | 'notApplicableQuantitativePeer'
          | 'defaultBetween'
          | 'defaultMidCat';
        peerAxisKind?: 'quantitative' | 'categoryPoint' | 'dateSerial';
      }
    | undefined,
  rendered: CartesianGeometryScaleTrace['crossing'] | undefined,
): NonNullable<CartesianGeometrySnapshot['valueAxes'][number]['crossing']> | undefined {
  if (!planned && !rendered) return undefined;
  const plannedPixel = rendered?.renderedPixel;
  const plannedPlotPosition = rendered?.renderedPlotPosition;
  const deltaPx =
    plannedPixel !== undefined && rendered?.renderedPixel !== undefined
      ? roundSnapshotNumber(Math.abs(plannedPixel - rendered.renderedPixel))
      : undefined;
  return removeUndefinedAxisCrossingFields({
    sourceCrossing: planned?.sourceCrossing ?? rendered?.sourceCrossing,
    sourceCrossingValue: planned?.sourceCrossingValue ?? rendered?.sourceCrossingValue,
    sourceCategoryCrossing: planned?.sourceCategoryCrossing ?? rendered?.sourceCategoryCrossing,
    categoryCrossingApplication:
      planned?.categoryCrossingApplication ?? rendered?.categoryCrossingApplication,
    peerAxisKind: planned?.peerAxisKind ?? rendered?.peerScaleKind,
    plannedPixel,
    renderedPixel: rendered?.renderedPixel,
    plannedPlotPosition,
    renderedPlotPosition: rendered?.renderedPlotPosition,
    deltaPx,
    effectiveMode: rendered?.effectiveMode,
  });
}

function removeUndefinedAxisCrossingFields<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function axisCrossingPlanTraceMismatch(
  planned:
    | {
        sourceCrossing?: 'automatic' | 'min' | 'max' | 'custom';
        sourceCrossingValue?: number;
        sourceCategoryCrossing?: 'between' | 'midCat';
        categoryCrossingApplication?:
          | 'applied'
          | 'notApplicableQuantitativePeer'
          | 'defaultBetween'
          | 'defaultMidCat';
        peerAxisKind?: 'quantitative' | 'categoryPoint' | 'dateSerial';
      }
    | undefined,
  rendered: NonNullable<CartesianGeometryScaleTrace['crossing']>,
): boolean {
  if (!planned) return false;
  if (planned.peerAxisKind !== undefined && planned.peerAxisKind !== rendered.peerScaleKind) {
    return true;
  }
  if (planned.sourceCrossing !== rendered.sourceCrossing) return true;
  if (
    planned.sourceCrossing === 'custom' &&
    planned.sourceCrossingValue !== undefined &&
    rendered.sourceCrossingValue !== undefined &&
    !numbersEqual(planned.sourceCrossingValue, rendered.sourceCrossingValue)
  ) {
    return true;
  }
  if (planned.sourceCategoryCrossing !== rendered.sourceCategoryCrossing) return true;
  if (
    (planned.categoryCrossingApplication === 'applied' ||
      planned.categoryCrossingApplication === 'notApplicableQuantitativePeer') &&
    planned.categoryCrossingApplication !== rendered.categoryCrossingApplication
  ) {
    return true;
  }
  const deltaPx = 0;
  return deltaPx > AXIS_CROSSING_TOLERANCE_PX;
}

function numericDomainPair(values: readonly unknown[] | undefined): [number, number] | undefined {
  if (!values || values.length < 2) return undefined;
  const first = finiteNumber(values[0]);
  const last = finiteNumber(values[values.length - 1]);
  return first !== undefined && last !== undefined ? [first, last] : undefined;
}

function numericPairsEqual(a: [number, number], b: [number, number]): boolean {
  return numbersEqual(a[0], b[0]) && numbersEqual(a[1], b[1]);
}

function numbersEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6;
}

function uniqueNumbers(values: readonly number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values)).sort();
}

function normalize(value: number, extent: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(extent) || extent === 0) return NaN;
  return roundSnapshotNumber(value / extent);
}

function plotAreaPixels(
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null | undefined,
  chartWidth: number,
  chartHeight: number,
): { x: number; y: number; width: number; height: number } {
  const plotArea = layout?.plotArea;
  if (!plotArea) {
    return { x: 0, y: 0, width: chartWidth, height: chartHeight };
  }
  return {
    x: plotArea.left * chartWidth,
    y: plotArea.top * chartHeight,
    width: plotArea.width * chartWidth,
    height: plotArea.height * chartHeight,
  };
}

function positiveSize(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const numeric = positiveNumber(value);
  return numeric === undefined ? undefined : Math.floor(numeric);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function roundSnapshotNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) < 1e-9) return 0;
  return Number.parseFloat(value.toFixed(6));
}

function categoryPitchForPolicy(
  axisLength: number,
  categoryCount: number,
  policy: BarGeometrySnapshot['categoryPositionPolicy'],
): number | undefined {
  if (categoryCount <= 0) return undefined;
  if (policy === 'onCategory' && categoryCount > 1) {
    return axisLength / (categoryCount - 1);
  }
  return axisLength / categoryCount;
}

function visualSlotIndex(
  slotIndex: number,
  seriesCount: number,
  order: BarGeometrySnapshot['seriesSlotOrder'],
): number {
  return order === 'reverse' ? seriesCount - 1 - slotIndex : slotIndex;
}

function baselinePixelForGeometry(
  geometry: BarGeometryGroup['geometry'],
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
): number | undefined {
  if (!layout) return undefined;
  const domain = geometry.percentDomain ?? geometry.valueAxisDomain;
  const range =
    geometry.orientation === 'horizontal'
      ? ([layout.plotArea.left, layout.plotArea.left + layout.plotArea.width] as [number, number])
      : ([layout.plotArea.top + layout.plotArea.height, layout.plotArea.top] as [number, number]);
  return barBaselinePixelForDomain({ geometry, domain, range });
}
