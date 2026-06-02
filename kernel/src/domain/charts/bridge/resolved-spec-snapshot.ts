import {
  seriesSourceIndex,
  type CartesianGeometryTrace,
  type ChartConfig,
  type ChartData,
} from '@mog/charts';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  ChartExportOptionsSnapshot,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { ResolvedChartRangeReferences } from '../chart-range-references';
import { sourceLinkedAxisNumberFormatDiagnostics } from './chart-render-data-normalizer';
import {
  buildChartFamilySupportSnapshot,
  familySupportCompilerDiagnostics,
} from './chart-family-support';
import { snapshotBarGeometry, snapshotCartesianGeometry } from './resolved-spec-plot-snapshot';
import { hashJson, snapshotScalar } from './resolved-spec-primitives';
import { snapshotRadarProjection } from './resolved-spec-radar-projection';
import {
  chartGapDepth,
  snapshotPackageAuthority,
  unsupportedFeatureDiagnostics,
} from './resolved-spec-diagnostics';
import {
  hasRenderableChartExData,
  renderAuthorityDiagnostics,
  snapshotSeries,
  snapshotSeriesProjection,
} from './resolved-spec-series-snapshot';
import {
  groupingFor,
  snapshotAxis,
  snapshotCategoryLevels,
  snapshotLegend,
  snapshotRange,
  titleText,
} from './resolved-spec-structure-snapshot';

type CompilerPathId = ResolvedChartSpecSnapshot['implementation']['compilerPathId'];

export { defaultExportOptionsForSize, hashJson } from './resolved-spec-primitives';

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
  cartesianGeometryTrace?: CartesianGeometryTrace;
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
  const cartesianGeometry = snapshotCartesianGeometry(
    input.config,
    input.chartData,
    input.layout ?? null,
    input.cartesianGeometryTrace,
  );
  const seriesWithoutGeometry = input.chartData.series.map((dataSeries, index) =>
    snapshotSeries(
      dataSeries,
      index,
      categories,
      input.config,
      hasExplicitSeriesReferences,
      seriesReferencesByIndex.get(seriesSourceIndex(dataSeries, index)),
    ),
  );
  const series = cartesianGeometry
    ? withSeriesGeometry(seriesWithoutGeometry, cartesianGeometry)
    : seriesWithoutGeometry;
  const seriesProjection = snapshotSeriesProjection(
    input.config,
    input.chartData,
    series,
    seriesReferencesByIndex,
  );
  const legend = snapshotLegend(input.config, series, input.chartData, seriesProjection);
  const familySupport = buildChartFamilySupportSnapshot({
    chart: input.chart,
    config: input.config,
    chartData: input.chartData,
    legend,
    seriesProjection,
  });
  const unsupportedFeatures = uniqueDiagnostics([
    ...unsupportedFeatureDiagnostics({
      chart: input.chart,
      config: input.config,
      series,
      layout: input.layout ?? null,
      hasRenderableChartExData: hasRenderableChartExData(input.config),
      sourceLinkedAxisNumberFormatDiagnostics: sourceLinkedAxisNumberFormatDiagnostics(
        input.config,
      ),
    }),
  ]);
  const radarProjection = snapshotRadarProjection({
    config: input.config,
    chartData: input.chartData,
    layout: input.layout ?? null,
    chartArea: input.chartArea,
    renderFrame: input.renderFrame,
  });

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
      familySupport,
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
        ...snapshotXYValueAxes(input.config),
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
        cartesianGeometry,
        radarProjection,
      },
      ranges: {
        dataRange: snapshotRange(input.resolvedRanges.dataRange),
        categoryRange: snapshotRange(input.resolvedRanges.categoryRange),
        seriesRange: snapshotRange(input.resolvedRanges.seriesRange),
        seriesReferences: input.resolvedRanges.seriesReferences.map((seriesReference) => {
          const name = snapshotRange(seriesReference.name ?? null);
          return {
            index: seriesReference.index,
            ...(name ? { name } : {}),
            values: snapshotRange(seriesReference.values),
            categories: snapshotRange(seriesReference.categories),
            bubbleSize: snapshotRange(seriesReference.bubbleSizes ?? null),
          };
        }),
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
        ...familySupportCompilerDiagnostics(familySupport),
      ],
      unsupportedFeatures,
    },
  };
}

function snapshotXYValueAxes(
  config: ChartConfig,
): Pick<ResolvedChartSpecSnapshot['resolved']['axes'], 'xValue' | 'yValue'> {
  if (!isXYChartType(config.type)) return {};
  const xValue = snapshotAxis(config.axis?.xAxis);
  const yValue = snapshotAxis(config.axis?.yAxis ?? config.axis?.valueAxis);
  return {
    ...(xValue ? { xValue } : {}),
    ...(yValue ? { yValue } : {}),
  };
}

function isXYChartType(type: ChartConfig['type']): boolean {
  return type === 'scatter' || type === 'bubble' || type === 'bubble3DEffect';
}

function uniqueDiagnostics(diagnostics: readonly string[]): string[] {
  return Array.from(new Set(diagnostics.filter((diagnostic) => diagnostic.trim().length > 0)));
}

function withSeriesGeometry(
  series: ResolvedChartSpecSnapshot['resolved']['series'],
  cartesianGeometry: NonNullable<
    ResolvedChartSpecSnapshot['resolved']['plot']['cartesianGeometry']
  >,
): ResolvedChartSpecSnapshot['resolved']['series'] {
  const geometryBySeriesIndex = new Map(
    cartesianGeometry.series.map((item) => [item.seriesIndex, item]),
  );
  return series.map((item) => {
    const geometry = geometryBySeriesIndex.get(item.index);
    if (!geometry) return item;
    return {
      ...item,
      geometry: {
        xMode: geometry.xMode,
        xRole: geometry.xRole,
        axisGroup: geometry.axisGroup,
        stackGroup: geometry.stackGroup,
        markerLayer: geometry.markerLayer,
        bubbleSizeAuthority: geometry.bubbleSizeAuthority,
      },
    };
  });
}
