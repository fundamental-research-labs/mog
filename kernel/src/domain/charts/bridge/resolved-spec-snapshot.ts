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
import { hasRenderableChartPointCache, type ChartPointCacheLike } from '../chart-point-cache';
import {
  isNoFillNoLineSeriesConfig,
  sourceLinkedAxisNumberFormatDiagnostics,
} from './chart-render-data-normalizer';
import {
  chartGapDepth,
  snapshotPackageAuthority,
  unsupportedFeatureDiagnostics,
} from './resolved-spec-diagnostics';

type CompilerPathId = ResolvedChartSpecSnapshot['implementation']['compilerPathId'];
type AxisSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['axes']['category']>;
type RangeSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['ranges']['dataRange']>;
type BarGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['barGeometry']
>[number];
type CategoryLevelSnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['categoryLevels']
>[number];
type SeriesRangeReference = ResolvedChartRangeReferences['seriesReferences'][number];
type SeriesSnapshot = ResolvedChartSpecSnapshot['resolved']['series'][number];

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
  const categoryLevels = snapshotCategoryLevels(input.chartData);
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
      categoryLevels,
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
        categoriesHash: hashJson(categoryLevels ? { categories, categoryLevels } : categories),
        seriesHash: hashJson(series),
      },
    },
    diagnostics: {
      compiler: [
        ...input.resolvedRanges.diagnostics.map((diagnostic) => diagnostic.message),
        ...renderAuthorityDiagnostics(series),
      ],
      unsupportedFeatures: unsupportedFeatureDiagnostics({
        chart: input.chart,
        config: input.config,
        series,
        layout: input.layout ?? null,
        hasRenderableChartExData: hasRenderableChartExData(input.config),
        sourceLinkedAxisNumberFormatDiagnostics: sourceLinkedAxisNumberFormatDiagnostics(
          input.config,
        ),
      }),
    },
  };
}

function renderAuthorityDiagnostics(series: SeriesSnapshot[]): string[] {
  return series.flatMap((item) => {
    const seriesNumber = item.index + 1;
    return [
      renderAuthorityDiagnostic({
        seriesNumber,
        dimension: 'values',
        ref: item.source.values,
        authority: item.renderAuthority.values,
      }),
      renderAuthorityDiagnostic({
        seriesNumber,
        dimension: 'categories',
        ref: item.source.categories,
        authority: item.renderAuthority.categories,
      }),
      renderAuthorityDiagnostic({
        seriesNumber,
        dimension: 'bubbleSize',
        ref: item.source.bubbleSize,
        authority: item.renderAuthority.bubbleSize,
      }),
    ].filter((message): message is string => message !== undefined);
  });
}

function renderAuthorityDiagnostic(input: {
  seriesNumber: number;
  dimension: 'values' | 'categories' | 'bubbleSize';
  ref: string | undefined;
  authority: ChartSeriesDimensionRenderAuthority;
}): string | undefined {
  if (input.authority === 'literal') {
    return `Series ${input.seriesNumber} ${input.dimension} rendered from literal chart data.`;
  }
  if (input.authority === 'fallbackCache') {
    return input.ref?.trim()
      ? `Series ${input.seriesNumber} ${input.dimension} rendered from fallback cache because live source "${input.ref}" is unavailable.`
      : `Series ${input.seriesNumber} ${input.dimension} rendered from fallback cache without a live source.`;
  }
  return undefined;
}

function snapshotCategoryLevels(data: ChartData): CategoryLevelSnapshot[] | undefined {
  if (!data.categoryLevels?.length) return undefined;
  return data.categoryLevels.map((level) => ({
    level: level.level,
    labels: level.labels.map((label) => (label == null ? null : String(label))),
  }));
}

function hasRenderableChartExData(config: ChartConfig): boolean {
  return (
    config.series?.some(
      (series) => series.values?.trim() || hasRenderableChartPointCache(series.valueCache),
    ) ?? false
  );
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
    geometry.orientation === 'horizontal' ? layout?.plotArea.height : layout?.plotArea.width;
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
    .filter(({ isBarLike, seriesConfig }) => isBarLike && !isNoFillNoLineSeriesConfig(seriesConfig))
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
      ?.filter(
        (entry) => entry.delete === true || (entry.delete !== false && entry.visible === false),
      )
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
      cacheRenderable:
        hasRenderableChartPointCache(configured?.categoryCache) ||
        hasRenderableCategoryLevelsCache(configured?.categoryLevels),
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
    color:
      series.color ??
      configured?.color ??
      config.colors?.[sourceSeriesIndex] ??
      config.colors?.[index],
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
      .filter((item): item is NonNullable<typeof item> => item !== undefined) ?? [];

  const renderedSeriesCount = series.filter((item) => item.renderedPointCount > 0).length;
  const hasExplicitSeries = config.series?.some((item) =>
    Boolean(item.values || item.valueCache || item.categories || item.categoryCache),
  );
  return {
    authority:
      config.pivotProjection?.authority ??
      (hasExplicitSeries ? 'explicitSeries' : config.dataRange ? 'liveRange' : 'unavailable'),
    expectedImportedSeriesCount:
      config.pivotProjection?.expectedImportedSeriesCount ??
      config.series?.length ??
      data.series.length,
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
  cacheRenderable?: boolean;
  sourceKind: ChartSeriesDimensionSourceKind | undefined;
  resolvedRange: ResolvedChartRangeReference | null | undefined;
}): ChartSeriesDimensionRenderAuthority {
  const cacheRenderable = input.cacheRenderable ?? hasRenderableChartPointCache(input.cache);
  if (input.sourceKind === 'literal') {
    return cacheRenderable ? 'literal' : 'unavailable';
  }
  if (input.sourceKind === 'cacheFallback') {
    return cacheRenderable ? 'fallbackCache' : 'unavailable';
  }
  if (input.resolvedRange) {
    return 'live';
  }
  if (cacheRenderable) {
    return 'fallbackCache';
  }
  return 'unavailable';
}

function hasRenderableCategoryLevelsCache(
  cache: NonNullable<NonNullable<ChartConfig['series']>[number]['categoryLevels']> | undefined,
): boolean {
  return categoryLevelPointCardinality(cache) > 0 && (cache?.levels.length ?? 0) > 0;
}

function categoryLevelPointCardinality(
  cache: NonNullable<NonNullable<ChartConfig['series']>[number]['categoryLevels']> | undefined,
): number {
  if (!cache) return 0;
  if (
    typeof cache.pointCount === 'number' &&
    Number.isInteger(cache.pointCount) &&
    cache.pointCount >= 0
  ) {
    return cache.pointCount;
  }
  return cache.levels.reduce((max, level) => {
    const levelPointCount =
      typeof level.pointCount === 'number' &&
      Number.isInteger(level.pointCount) &&
      level.pointCount >= 0
        ? level.pointCount
        : 0;
    const maxPointIndex = level.points.reduce((pointMax, point) => {
      return Math.max(pointMax, point.idx + 1);
    }, 0);
    return Math.max(max, levelPointCount, maxPointIndex);
  }, 0);
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
  const type =
    seriesType ?? (config.type === 'combo' ? (index === 0 ? 'column' : 'line') : config.type);
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

function seriesMarkFamily(
  seriesType: string | undefined,
): 'bar' | 'line' | 'area' | 'point' | 'other' {
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
