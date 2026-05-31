import {
  effectiveBarGeometry,
  excelBarSlotGeometry,
  hasExcelBarGeometryConfig,
  isBarLikeChartType,
  seriesConfigForDataSeries,
  seriesConfigSourceIndex,
  seriesConfigSourceKey,
  seriesSourceIndex,
  seriesSourceKey,
  type ChartConfig,
  type ChartData,
  type ChartDataPoint,
  type ChartDataSeries,
} from '@mog/charts';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  ChartSeriesDimensionRenderAuthority,
  ChartSeriesProjectionAuthority,
  ChartSeriesProjectionDiagnosticReason,
  ChartSeriesDimensionSourceKind,
  ChartExportOptionsSnapshot,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type {
  ResolvedChartRangeReference,
  ResolvedChartRangeReferences,
} from '../chart-range-references';
import {
  hasRenderableChartPointCache,
  type ChartPointCacheLike,
} from '../chart-point-cache';
import {
  isNoFillNoLineSeriesConfig,
  sourceLinkedAxisNumberFormatDiagnostics,
} from './chart-render-data-normalizer';

type CompilerPathId = ResolvedChartSpecSnapshot['implementation']['compilerPathId'];
type AxisSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['axes']['category']>;
type RangeSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['ranges']['dataRange']>;
type BarGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['barGeometry']
>[number];
type SingleAxisConfig = NonNullable<NonNullable<ChartConfig['axis']>['categoryAxis']>;
type AxisDiagnosticRole = 'category' | 'value' | 'series';
type AxisOrientation = 'horizontal' | 'vertical';
type AxisPosition = 'bottom' | 'top' | 'left' | 'right';
type SeriesRangeReference = ResolvedChartRangeReferences['seriesReferences'][number];

export function defaultExportOptionsForSize(
  width: number,
  height: number,
): ChartExportOptionsSnapshot {
  return {
    format: 'png',
    width,
    height,
    pixelRatio: 1,
    physicalWidth: Math.max(1, Math.round(width)),
    physicalHeight: Math.max(1, Math.round(height)),
    backgroundColor: '#ffffff',
  };
}

export function buildResolvedChartSpecSnapshot(input: {
  chart: ChartFloatingObject;
  sheetId: SheetId;
  config: ChartConfig;
  chartData: ChartData;
  resolvedRanges: ResolvedChartRangeReferences;
  exportOptions: ChartExportOptionsSnapshot;
  compilerPathId: CompilerPathId;
  compilerInputHash: string;
  layout?: ResolvedChartSpecSnapshot['resolved']['layout'] | null;
  renderFrame?: ResolvedChartSpecSnapshot['renderFrame'];
  chartArea?: ResolvedChartSpecSnapshot['chartArea'];
  plotArea?: ResolvedChartSpecSnapshot['plotArea'] | null;
  pageContext?: ResolvedChartSpecSnapshot['pageContext'];
  packageAuthority?: ResolvedChartSpecSnapshot['packageAuthority'];
}): ResolvedChartSpecSnapshot {
  const categories = input.chartData.categories.map(snapshotScalar);
  const hasExplicitSeriesReferences =
    input.config.series?.some((item) =>
      Boolean(item.values || item.categories || item.bubbleSize),
    ) ?? false;
  const seriesReferencesByIndex = new Map(
    input.resolvedRanges.seriesReferences.map((reference) => [reference.index, reference]),
  );
  const series = input.chartData.series.map((dataSeries, index) =>
    snapshotSeries(
      dataSeries,
      index,
      categories,
      input.config,
      hasExplicitSeriesReferences,
      seriesReferencesByIndex.get(seriesSourceIndex(dataSeries, index)),
    ),
  );
  const legend = snapshotLegend(input.config, series);
  const seriesProjection = snapshotSeriesProjection(input.config, input.chartData, series);

  return {
    schemaVersion: 1,
    chartId: input.chart.id,
    sheetId: String(input.sheetId),
    sheetKind: input.renderFrame?.kind === 'chartSheet' ? 'chartSheet' : 'worksheet',
    layoutAuthority: input.renderFrame?.kind ?? 'embedded',
    renderFrame: input.renderFrame,
    chartArea: input.chartArea,
    plotArea: input.plotArea ?? undefined,
    pageContext: input.pageContext ?? input.renderFrame?.pageContext,
    packageAuthority: input.packageAuthority ?? snapshotPackageAuthority(input.chart),
    chartObject: {
      id: input.chart.id,
      name: input.chart.name,
      anchorRow: input.chart.anchor?.anchorRow,
      anchorCol: input.chart.anchor?.anchorCol,
      width: input.chart.widthCells ?? input.chart.width,
      height: input.chart.heightCells ?? input.chart.height,
      widthPt: input.chart.widthPt,
      heightPt: input.chart.heightPt,
    },
    export: input.exportOptions,
    implementation: {
      renderAuthority: 'chartBridge',
      renderStatus: 'renderable',
      compilerPathId: input.compilerPathId,
      compilerInputHash: input.compilerInputHash,
      compilerVersion: 1,
    },
    resolved: {
      chartType: input.config.type,
      subType: input.config.subType,
      grouping: groupingFor(input.config),
      title: {
        present: titleText(input.config) !== undefined,
        text: titleText(input.config),
      },
      legend,
      axes: {
        category: snapshotAxis(input.config.axis?.categoryAxis ?? input.config.axis?.xAxis),
        value: snapshotAxis(input.config.axis?.valueAxis ?? input.config.axis?.yAxis),
        secondaryCategory: snapshotAxis(input.config.axis?.secondaryCategoryAxis),
        secondaryValue: snapshotAxis(
          input.config.axis?.secondaryValueAxis ?? input.config.axis?.secondaryYAxis,
        ),
        series: snapshotAxis(input.config.axis?.seriesAxis),
      },
      series,
      seriesProjection,
      categories,
      layout: input.layout ?? undefined,
      plot: {
        displayBlanksAs: input.config.displayBlanksAs,
        plotVisibleOnly: input.config.plotVisibleOnly,
        gapWidth: input.config.gapWidth,
        gapDepth: chartGapDepth(input.config),
        overlap: input.config.overlap,
        barGeometry: snapshotBarGeometry(input.config, input.chartData, input.layout ?? null),
      },
      ranges: {
        dataRange: snapshotRange(input.resolvedRanges.dataRange),
        categoryRange: snapshotRange(input.resolvedRanges.categoryRange),
        seriesRange: snapshotRange(input.resolvedRanges.seriesRange),
        seriesReferences: input.resolvedRanges.seriesReferences.map((seriesReference) => ({
          index: seriesReference.index,
          values: snapshotRange(seriesReference.values),
          categories: snapshotRange(seriesReference.categories),
          bubbleSize: snapshotRange(seriesReference.bubbleSizes ?? null),
        })),
        diagnostics: input.resolvedRanges.diagnostics.map((diagnostic) => ({
          kind: diagnostic.kind,
          code: diagnostic.code,
          ref: diagnostic.ref,
          sheetName: diagnostic.sheetName,
          message: diagnostic.message,
        })),
      },
      dataHashes: {
        categoriesHash: hashJson(categories),
        seriesHash: hashJson(series),
      },
    },
    diagnostics: {
      compiler: input.resolvedRanges.diagnostics.map((diagnostic) => diagnostic.message),
      unsupportedFeatures: unsupportedFeatureDiagnostics(
        input.chart,
        input.config,
        series,
        input.layout ?? null,
      ),
    },
  };
}

function snapshotBarGeometry(
  config: ChartConfig,
  chartData: ChartData,
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
): BarGeometrySnapshot[] | undefined {
  if (!hasExcelBarGeometryConfig(config)) return undefined;

  const geometry = effectiveBarGeometry(config);
  if (!geometry) return undefined;

  const seriesIndices = barGeometrySeriesIndices(config, chartData);
  if (seriesIndices.length === 0) return undefined;

  const categoryLength =
    geometry.orientation === 'horizontal'
      ? layout?.plotArea.height
      : layout?.plotArea.width;
  const categoryPitch =
    categoryLength && chartData.categories.length > 0
      ? categoryLength / chartData.categories.length
      : undefined;
  const offsets =
    categoryPitch !== undefined
      ? seriesIndices.map((seriesIndex, slotIndex) => ({
          seriesIndex,
          offset: excelBarSlotGeometry(categoryPitch, seriesIndices.length, slotIndex, geometry)
            .offset,
        }))
      : undefined;
  const barSize =
    categoryPitch !== undefined
      ? excelBarSlotGeometry(categoryPitch, seriesIndices.length, 0, geometry).size
      : undefined;

  return [
    {
      orientation: geometry.orientation,
      grouping: geometry.grouping,
      sourceGapWidth: geometry.sourceGapWidth,
      sourceOverlap: geometry.sourceOverlap,
      gapWidth: geometry.gapWidth,
      overlap: geometry.overlap,
      gapWidthClamped: geometry.gapWidthClamped,
      overlapClamped: geometry.overlapClamped,
      seriesIndices,
      categoryPitch,
      barSize,
      offsets,
    },
  ];
}

function barGeometrySeriesIndices(config: ChartConfig, chartData: ChartData): number[] {
  return chartData.series
    .map((dataSeries, index) => {
      const seriesConfig = seriesConfigForDataSeries(dataSeries, config.series ?? [], index);
      const seriesType = seriesConfig?.type ?? dataSeries.type ?? config.type;
      return {
        index,
        seriesConfig,
        isBarLike: config.type === 'combo' ? isBarLikeChartType(seriesType) : true,
      };
    })
    .filter(
      ({ isBarLike, seriesConfig }) =>
        isBarLike && !isNoFillNoLineSeriesConfig(seriesConfig),
    )
    .map(({ index }) => index);
}

function snapshotAxis(
  axis: NonNullable<ChartConfig['axis']>['categoryAxis'],
): AxisSnapshot | undefined {
  if (!axis) return undefined;
  return {
    present: true,
    visible: axis.visible ?? axis.show,
    title: axis.title,
    axisType: axis.axisType ?? axis.type,
    scaleType: axis.scaleType,
    categoryType: axis.categoryType,
    min: axis.min,
    max: axis.max,
    majorUnit: axis.majorUnit,
    minorUnit: axis.minorUnit,
    logBase: axis.logBase,
    displayUnit: axis.displayUnit,
    customDisplayUnit: axis.customDisplayUnit,
    displayUnitLabel: axis.displayUnitLabel,
    displayUnitLabelLayout: axis.displayUnitLabelLayout,
    displayUnitLabelFormat: axis.displayUnitLabelFormat,
    numberFormat: axis.numberFormat,
    linkNumberFormat: axis.linkNumberFormat,
    position: axis.position,
    reverse: axis.reverse,
    tickMarks: axis.tickMarks,
    minorTickMarks: axis.minorTickMarks,
    tickLabelPosition: axis.tickLabelPosition,
    tickLabelSpacing: axis.tickLabelSpacing,
    tickMarkSpacing: axis.tickMarkSpacing,
    crossBetween: axis.crossBetween,
    crossesAt: axis.crossesAt,
    crossesAtValue: axis.crossesAtValue,
    isBetweenCategories: axis.isBetweenCategories,
    minorGridLines: axis.minorGridLines,
    minorGridlineFormat: axis.minorGridlineFormat,
    textOrientation: axis.textOrientation,
  };
}

function snapshotLegend(
  config: ChartConfig,
  series: ResolvedChartSpecSnapshot['resolved']['series'],
): ResolvedChartSpecSnapshot['resolved']['legend'] {
  const legend = config.legend;
  const present = !!legend && legend.position !== 'none';
  const deletedEntries = new Set(
    legend?.entries
      ?.filter((entry) => entry.delete === true || (entry.delete !== false && entry.visible === false))
      .map((entry) => entry.idx) ?? [],
  );
  const visible = present ? (legend?.visible ?? legend?.show ?? true) : false;
  return {
    present,
    visible,
    position: legend?.position,
    entries: present ? series.map((item) => item.name) : [],
    visibleEntries: visible
      ? series
          .filter(
            (item, index) =>
              !deletedEntries.has(index) &&
              !deletedEntries.has(item.sourceSeriesIndex) &&
              !isNoFillNoLineSeriesConfig(
                config.series?.[item.sourceSeriesIndex] ?? config.series?.[index],
              ),
          )
          .map((item) => item.name)
      : [],
  };
}

function snapshotSeries(
  series: ChartDataSeries,
  index: number,
  categories: Array<string | number | null>,
  config: ChartConfig,
  hasExplicitSeriesReferences: boolean,
  rangeReference: SeriesRangeReference | undefined,
): ResolvedChartSpecSnapshot['resolved']['series'][number] {
  const configured = seriesConfigForDataSeries(series, config.series ?? [], index);
  const sourceSeriesIndex = seriesSourceIndex(series, index);
  const sourceSeriesKey = seriesSourceKey(series, index);
  const values: Array<number | null> = [];
  const blankMask: boolean[] = [];
  const seriesCategories = snapshotCategoriesForSeries(
    series,
    configured,
    categories,
    hasExplicitSeriesReferences,
  );
  const length = Math.max(seriesCategories.length, series.data.length);
  for (let pointIndex = 0; pointIndex < length; pointIndex += 1) {
    const value = numericPointValue(series.data[pointIndex]);
    values.push(value);
    blankMask.push(value === null);
  }
  const source = {
    values: configured?.values,
    categories: configured?.categories,
    bubbleSize: configured?.bubbleSize,
    valueSourceKind: configured?.valueSourceKind,
    categorySourceKind: configured?.categorySourceKind,
    bubbleSizeSourceKind: configured?.bubbleSizeSourceKind,
  };
  const renderAuthority = {
    values: dimensionRenderAuthority({
      cache: configured?.valueCache,
      sourceKind: configured?.valueSourceKind,
      resolvedRange: rangeReference?.values,
    }),
    categories: dimensionRenderAuthority({
      cache: configured?.categoryCache,
      sourceKind: configured?.categorySourceKind,
      resolvedRange: rangeReference?.categories,
    }),
    bubbleSize: dimensionRenderAuthority({
      cache: configured?.bubbleSizeCache,
      sourceKind: configured?.bubbleSizeSourceKind,
      resolvedRange: rangeReference?.bubbleSizes ?? null,
    }),
  };
  const name = snapshotSeriesName(series, configured, sourceSeriesIndex);
  const renderedPointCount = values.filter((value) => value !== null).length;
  const effectiveType = series.type ?? configured?.type;
  const xRole = effectiveSeriesXRole(config, configured, effectiveType);

  return {
    index,
    order: configured?.order ?? configured?.idx ?? index,
    sourceSeriesIndex,
    sourceSeriesKey,
    visibleOrder: configured?.visibleOrder ?? series.visibleOrder ?? index,
    pivotSeriesKey: configured?.pivotSeriesKey ?? series.pivotSeriesKey,
    pivotDataFieldIndex: configured?.pivotDataFieldIndex ?? series.pivotDataFieldIndex,
    projectionAuthority:
      series.projectionAuthority ??
      configured?.projectionAuthority ??
      seriesProjectionAuthority(config, configured, hasExplicitSeriesReferences),
    projectionDiagnostics: [
      ...(configured?.projectionDiagnostics ?? []),
      ...(series.projectionDiagnostics ?? []),
    ],
    name,
    type: effectiveType,
    axisGroup: series.yAxisIndex === 1 || configured?.yAxisIndex === 1 ? 'secondary' : 'primary',
    xRole,
    showLines: configured?.showLines,
    smooth: configured?.smooth,
    showMarkers: configured?.showMarkers,
    markerStyle: configured?.markerStyle,
    renderLayerCount: estimatedRenderLayerCount(config, configured, effectiveType, index),
    color: series.color ?? configured?.color ?? config.colors?.[sourceSeriesIndex] ?? config.colors?.[index],
    source,
    renderAuthority,
    categories: seriesCategories,
    values,
    blankMask,
    pointCount: length,
    renderedPointCount,
    dataHash: hashJson({
      name,
      sourceSeriesIndex,
      sourceSeriesKey,
      type: effectiveType,
      xRole,
      showLines: configured?.showLines,
      smooth: configured?.smooth,
      showMarkers: configured?.showMarkers,
      markerStyle: configured?.markerStyle,
      renderLayerCount: estimatedRenderLayerCount(config, configured, effectiveType, index),
      source,
      renderAuthority,
      categories: seriesCategories,
      categoryFormatCodes: configured?.categoryLabelFormat,
      values,
      blankMask,
    }),
  };
}

function seriesProjectionAuthority(
  config: ChartConfig,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
  hasExplicitSeriesReferences: boolean,
): ChartSeriesProjectionAuthority {
  if (configured?.projectionAuthority) return configured.projectionAuthority;
  if (config.pivotProjection?.authority) return config.pivotProjection.authority;
  if (hasExplicitSeriesReferences) return 'explicitSeries';
  return config.dataRange ? 'liveRange' : 'unavailable';
}

function snapshotSeriesProjection(
  config: ChartConfig,
  data: ChartData,
  series: ResolvedChartSpecSnapshot['resolved']['series'],
): ResolvedChartSpecSnapshot['resolved']['seriesProjection'] {
  const renderedPointCountBySourceSeriesKey: Record<string, number> = {};
  for (const item of series) {
    renderedPointCountBySourceSeriesKey[item.sourceSeriesKey] = item.renderedPointCount;
  }

  const projectedKeys = new Set(series.map((item) => item.sourceSeriesKey));
  const droppedSeries =
    config.series
      ?.map((configured, index) => {
        const sourceSeriesIndex = seriesConfigSourceIndex(configured, index);
        const sourceSeriesKey = seriesConfigSourceKey(configured, sourceSeriesIndex);
        if (projectedKeys.has(sourceSeriesKey)) return undefined;
        const diagnostic = configured.projectionDiagnostics?.[0];
        return {
          sourceSeriesIndex,
          sourceSeriesKey,
          name: configured.name,
          reason: diagnostic?.reason ?? droppedSeriesReason(configured),
          message: diagnostic?.message,
        };
      })
      .filter(
        (item): item is NonNullable<typeof item> =>
          item !== undefined,
      ) ?? [];

  const renderedSeriesCount = series.filter((item) => item.renderedPointCount > 0).length;
  const hasExplicitSeries = config.series?.some((item) =>
    Boolean(item.values || item.valueCache || item.categories || item.categoryCache),
  );
  return {
    authority:
      config.pivotProjection?.authority ??
      (hasExplicitSeries ? 'explicitSeries' : config.dataRange ? 'liveRange' : 'unavailable'),
    expectedImportedSeriesCount:
      config.pivotProjection?.expectedImportedSeriesCount ?? config.series?.length ?? data.series.length,
    projectedSeriesCount: config.pivotProjection?.projectedSeriesCount ?? data.series.length,
    renderedSeriesCount: config.pivotProjection?.renderedSeriesCount ?? renderedSeriesCount,
    renderedPointCountBySourceSeriesKey,
    droppedSeries,
  };
}

function droppedSeriesReason(
  series: NonNullable<ChartConfig['series']>[number],
): ChartSeriesProjectionDiagnosticReason {
  if (series.filtered) return 'allItemsFiltered';
  if (isNoFillNoLineSeriesConfig(series)) return 'styleResolvedNoFillOrLine';
  if (series.projectionAuthority === 'unavailable') return 'unresolvedPivotSource';
  return 'noValueData';
}

function dimensionRenderAuthority(input: {
  cache: ChartPointCacheLike | null | undefined;
  sourceKind: ChartSeriesDimensionSourceKind | undefined;
  resolvedRange: ResolvedChartRangeReference | null | undefined;
}): ChartSeriesDimensionRenderAuthority {
  if (input.sourceKind === 'literal') {
    return hasRenderableChartPointCache(input.cache) ? 'literal' : 'unavailable';
  }
  if (input.sourceKind === 'cacheFallback') {
    return hasRenderableChartPointCache(input.cache) ? 'fallbackCache' : 'unavailable';
  }
  if (input.resolvedRange) {
    return 'live';
  }
  if (hasRenderableChartPointCache(input.cache)) {
    return 'fallbackCache';
  }
  return 'unavailable';
}

function snapshotSeriesName(
  series: ChartDataSeries,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
  index: number,
): string {
  if (series.name) return series.name;
  if (configured?.name) return configured.name;

  if (
    typeof configured?.idx === 'number' &&
    Number.isInteger(configured.idx) &&
    configured.idx > 0
  ) {
    return `Series ${configured.idx}`;
  }

  if (
    typeof configured?.order === 'number' &&
    Number.isInteger(configured.order) &&
    configured.order >= 0
  ) {
    return `Series ${configured.order + 1}`;
  }

  return `Series ${index + 1}`;
}

function snapshotCategoriesForSeries(
  series: ChartDataSeries,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
  categories: Array<string | number | null>,
  hasExplicitSeriesReferences: boolean,
): Array<string | number | null> {
  if (configured?.categories) {
    return series.data.map((point) => snapshotScalar(point?.x));
  }
  return !hasExplicitSeriesReferences ? categories : [];
}

function snapshotRange(reference: ResolvedChartRangeReference | null): RangeSnapshot | null {
  if (!reference) return null;
  return {
    kind: reference.kind,
    source: reference.source,
    ref: reference.ref,
    range: {
      sheetId: reference.range.sheetId ? String(reference.range.sheetId) : undefined,
      startRow: reference.range.startRow,
      startCol: reference.range.startCol,
      endRow: reference.range.endRow,
      endCol: reference.range.endCol,
    },
  };
}

function titleText(config: ChartConfig): string | undefined {
  const text =
    config.title ??
    config.chartTitle?.text ??
    config.titleRichText?.map((part) => part.text).join('');
  return text || undefined;
}

function groupingFor(config: ChartConfig): ResolvedChartSpecSnapshot['resolved']['grouping'] {
  if (config.subType === 'stacked') return 'stacked';
  if (config.subType === 'percentStacked') return 'percentStacked';
  if (config.subType === 'clustered') return 'clustered';
  return 'standard';
}

function numericPointValue(point: ChartDataPoint | undefined): number | null {
  if (point?.valueState && point.valueState !== 'value') return null;
  if (!point || typeof point.y !== 'number' || !Number.isFinite(point.y)) return null;
  return point.y;
}

function snapshotScalar(value: string | number | null | undefined): string | number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  return null;
}

function effectiveSeriesXRole(
  config: ChartConfig,
  series: NonNullable<ChartConfig['series']>[number] | undefined,
  seriesType: string | undefined,
): 'category' | 'quantitative' | undefined {
  if (series?.xRole) return series.xRole;
  if (
    config.type === 'scatter' ||
    config.type === 'bubble' ||
    seriesType === 'scatter' ||
    seriesType === 'bubble'
  ) {
    return 'quantitative';
  }
  return series?.categories ? 'category' : undefined;
}

function estimatedRenderLayerCount(
  config: ChartConfig,
  series: NonNullable<ChartConfig['series']>[number] | undefined,
  seriesType: string | undefined,
  index: number,
): number {
  const type = seriesType ?? (config.type === 'combo' ? (index === 0 ? 'column' : 'line') : config.type);
  if (!isKnownRenderableSeriesType(type)) return 0;
  const markFamily = seriesMarkFamily(type);
  const showLines = effectiveSeriesShowLines(config, series, type);
  const showMarkers = effectiveSeriesShowMarkers(series, type, config.type, !showLines);
  if (markFamily === 'point') return (showLines ? 1 : 0) + (showMarkers ? 1 : 0);
  if (markFamily === 'line' || markFamily === 'area') {
    return (showLines ? 1 : 0) + (showMarkers ? 1 : 0);
  }
  return 1;
}

function effectiveSeriesShowLines(
  config: ChartConfig,
  series: NonNullable<ChartConfig['series']>[number] | undefined,
  seriesType: string,
): boolean {
  if (series?.showLines !== undefined) return series.showLines;
  if (seriesType === 'scatter' || seriesType === 'bubble') return config.showLines === true;
  const markFamily = seriesMarkFamily(seriesType);
  return markFamily === 'line' || markFamily === 'area';
}

function effectiveSeriesShowMarkers(
  series: NonNullable<ChartConfig['series']>[number] | undefined,
  seriesType: string | undefined,
  chartType: ChartConfig['type'],
  defaultValue = false,
): boolean {
  if (series?.markerStyle === 'none') return false;
  if (series?.showMarkers !== undefined) return series.showMarkers;
  if (series?.markerStyle !== undefined || series?.markerSize !== undefined) return true;
  if (
    series?.points?.some(
      (point) =>
        point.markerStyle !== undefined ||
        point.markerSize !== undefined ||
        point.markerBackgroundColor !== undefined ||
        point.markerForegroundColor !== undefined,
    )
  ) {
    return true;
  }
  return (
    chartType === 'lineMarkers' ||
    seriesType === 'lineMarkers' ||
    seriesType === 'lineMarkersStacked' ||
    seriesType === 'lineMarkersStacked100' ||
    defaultValue
  );
}

function seriesMarkFamily(seriesType: string | undefined): 'bar' | 'line' | 'area' | 'point' | 'other' {
  switch (seriesType) {
    case 'bar':
    case 'column':
    case 'bar3d':
    case 'column3d':
    case 'bar3D':
    case 'column3D':
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
      return 'bar';
    case 'line':
    case 'line3d':
    case 'line3D':
    case 'lineMarkers':
    case 'lineMarkersStacked':
    case 'lineMarkersStacked100':
      return 'line';
    case 'area':
    case 'area3d':
    case 'area3D':
      return 'area';
    case 'scatter':
    case 'bubble':
    case 'bubble3DEffect':
      return 'point';
    default:
      return 'other';
  }
}

function isKnownRenderableSeriesType(seriesType: string | undefined): boolean {
  return seriesMarkFamily(seriesType) !== 'other';
}

function unsupportedFeatureDiagnostics(
  chart: ChartFloatingObject,
  config: ChartConfig,
  series: ResolvedChartSpecSnapshot['resolved']['series'],
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
): string[] {
  const unsupported: string[] = [];
  unsupported.push(...importStatusUnsupportedDiagnostics(chart.importStatus));
  unsupported.push(...packageAuthorityDiagnostics(chart));
  if (config.type === 'bar3d' || config.type === 'column3d') {
    unsupported.push('3-D bar chart rendered as 2-D bar/column approximation');
    for (const shape of barShapeDiagnostics(config)) {
      unsupported.push(
        `3-D bar shape "${shape}" is preserved but rendered as rectangular bars`,
      );
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
  if (
    isChartEx &&
    !config.dataRange &&
    !config.series?.some(
      (series) => series.values?.trim() || hasRenderableChartPointCache(series.valueCache),
    )
  ) {
    unsupported.push(`ChartEx ${config.type} data projection is not implemented`);
  }
  if (config.pivotOptions || config.showAllFieldButtons)
    unsupported.push(pivotFieldButtonDiagnostic(config));
  for (const diagnostic of config.pivotProjection?.diagnostics ?? []) {
    unsupported.push(
      diagnostic.message ??
        `pivot chart projection diagnostic: ${diagnostic.reason}`,
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
  unsupported.push(...sourceLinkedAxisNumberFormatDiagnostics(config));
  unsupported.push(...axisUnsupportedFeatureDiagnostics(config, series));
  return unsupported;
}

function snapshotPackageAuthority(
  chart: ChartFloatingObject,
): ResolvedChartSpecSnapshot['packageAuthority'] | undefined {
  const authority = chart.ooxml?.standardChartExportAuthority;
  const provenance = chart.ooxml?.standardChartProvenance;
  if (!authority && !provenance) return undefined;

  return {
    source: authority?.packageOwner ?? provenance?.originalPath ?? 'standardChart',
    fingerprint: authority?.projectionFingerprint ?? provenance?.projectionFingerprint,
    status: packageAuthorityStatus(authority),
    details: {
      kind: 'standardChart',
      validity: authority?.validity,
      chartPartRevision: authority?.chartPartRevision,
      packageOwner: authority?.packageOwner,
      relationshipClosureCurrent: authority?.relationshipClosureCurrent,
      staleReason: authority?.staleReason,
      projectionSchemaVersion: provenance?.projectionSchemaVersion,
      originalPath: provenance?.originalPath,
      relsPath: provenance?.relsPath,
      auxiliaryPaths: provenance?.auxiliaryPaths,
      relationshipCount: provenance?.relationships?.length,
    },
  };
}

function packageAuthorityStatus(
  authority: ChartFloatingObject['ooxml'] extends infer O
    ? O extends { standardChartExportAuthority?: infer A }
      ? A | undefined
      : never
    : never,
): NonNullable<ResolvedChartSpecSnapshot['packageAuthority']>['status'] {
  if (!authority) return 'unknown';
  if (authority.validity === 'current')
    return authority.relationshipClosureCurrent === false ? 'stale' : 'current';
  if (authority.validity === 'unverified') return 'unknown';
  return 'stale';
}

function packageAuthorityDiagnostics(chart: ChartFloatingObject): string[] {
  const authority = chart.ooxml?.standardChartExportAuthority;
  if (!authority) return [];
  const status = packageAuthorityStatus(authority);
  if (status !== 'stale') return [];
  const validity = authority.validity ?? 'unknown';
  const reason =
    authority.staleReason ??
    (authority.relationshipClosureCurrent === false
      ? 'chart relationship graph is not closed'
      : undefined);
  return [
    reason
      ? `standard chart package authority is ${validity}: ${reason}`
      : `standard chart package authority is ${validity}`,
  ];
}

function importStatusUnsupportedDiagnostics(importStatus: unknown): string[] {
  if (typeof importStatus !== 'object' || importStatus === null) return [];
  const diagnostics = (importStatus as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) return [];

  const messages: string[] = [];
  for (const diagnostic of diagnostics) {
    if (typeof diagnostic !== 'object' || diagnostic === null) continue;
    const message = (diagnostic as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) messages.push(message);
  }
  return Array.from(new Set(messages));
}

function barShapeDiagnostics(config: ChartConfig): string[] {
  const shapes = new Set<string>();
  if (config.barShape) shapes.add(config.barShape);
  for (const series of config.series ?? []) {
    if (series.barShape) shapes.add(series.barShape);
  }
  return Array.from(shapes);
}

function chartGapDepth(config: ChartConfig): number | undefined {
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
    config.wireframe === true ||
    type === 'surfaceWireframe' ||
    type === 'surfaceTopViewWireframe';
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
    return [
      '3-D surface chart rendering is not implemented; chart is preserved as a placeholder',
    ];
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
  series: ResolvedChartSpecSnapshot['resolved']['series'],
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
      !item.categories.some((category, index) => typeof category === 'number' && item.values[index] !== null)
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
      diagnostics.push(
        `series ${item.sourceSeriesIndex} has no visible line or marker channel`,
      );
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
  series: ResolvedChartSpecSnapshot['resolved']['series'],
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
  series: ResolvedChartSpecSnapshot['resolved']['series'],
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

function positiveDomainCandidateValues(
  label: string,
  series: ResolvedChartSpecSnapshot['resolved']['series'],
): number[] {
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

export function hashJson(value: unknown): string {
  const text = stableStringify(value);
  let hashA = 0x811c9dc5;
  let hashB = 0x811c9dc5 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x01000193);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, '0')}${(hashB >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
