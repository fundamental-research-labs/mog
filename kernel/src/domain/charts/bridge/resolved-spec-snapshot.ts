import type { ChartConfig, ChartData, ChartDataPoint, ChartDataSeries } from '@mog/charts';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  ChartExportOptionsSnapshot,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type {
  ResolvedChartRangeReference,
  ResolvedChartRangeReferences,
} from '../chart-range-references';
import {
  isNoFillNoLineSeriesConfig,
  sourceLinkedAxisNumberFormatDiagnostics,
} from './chart-render-data-normalizer';

type CompilerPathId = ResolvedChartSpecSnapshot['implementation']['compilerPathId'];
type AxisSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['axes']['category']>;
type RangeSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['ranges']['dataRange']>;

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
}): ResolvedChartSpecSnapshot {
  const categories = input.chartData.categories.map(snapshotScalar);
  const hasExplicitSeriesReferences =
    input.config.series?.some((item) =>
      Boolean(item.values || item.categories || item.bubbleSize),
    ) ?? false;
  const series = input.chartData.series.map((dataSeries, index) =>
    snapshotSeries(dataSeries, index, categories, input.config, hasExplicitSeriesReferences),
  );
  const legend = snapshotLegend(input.config, series);

  return {
    schemaVersion: 1,
    chartId: input.chart.id,
    sheetId: String(input.sheetId),
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
      categories,
      plot: {
        displayBlanksAs: input.config.displayBlanksAs,
        plotVisibleOnly: input.config.plotVisibleOnly,
        gapWidth: input.config.gapWidth,
        overlap: input.config.overlap,
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
      unsupportedFeatures: unsupportedFeatureDiagnostics(input.config, series),
    },
  };
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
      ?.filter((entry) => entry.delete || entry.visible === false)
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
            (_item, index) =>
              !deletedEntries.has(index) && !isNoFillNoLineSeriesConfig(config.series?.[index]),
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
): ResolvedChartSpecSnapshot['resolved']['series'][number] {
  const configured = config.series?.[index];
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
  };
  const name = snapshotSeriesName(series, configured, index);

  return {
    index,
    order: configured?.order ?? configured?.idx ?? index,
    name,
    type: series.type ?? configured?.type,
    axisGroup: series.yAxisIndex === 1 || configured?.yAxisIndex === 1 ? 'secondary' : 'primary',
    color: series.color ?? configured?.color ?? config.colors?.[index],
    source,
    categories: seriesCategories,
    values,
    blankMask,
    dataHash: hashJson({
      name,
      source,
      categories: seriesCategories,
      categoryFormatCodes: config.series?.[index]?.categoryLabelFormat,
      values,
      blankMask,
    }),
  };
}

function snapshotSeriesName(
  series: ChartDataSeries,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
  index: number,
): string {
  if (!configured?.name && typeof configured?.idx === 'number' && Number.isInteger(configured.idx)) {
    return `Series ${configured.idx}`;
  }
  return series.name || `Series ${index + 1}`;
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

function unsupportedFeatureDiagnostics(
  config: ChartConfig,
  series: ResolvedChartSpecSnapshot['resolved']['series'],
): string[] {
  const unsupported: string[] = [];
  if (String(config.type).endsWith('3d'))
    unsupported.push('3d chart rendering is approximated by the 2d chart backend');
  if (
    config.type === 'surface' ||
    config.type === 'surface3d' ||
    config.type === 'surfaceTopView'
  )
    unsupported.push('surface chart rendering is not fully semantic');
  if (
    config.wireframe ||
    config.type === 'surfaceWireframe' ||
    config.type === 'surfaceTopViewWireframe'
  )
    unsupported.push('surface wireframe rendering is not fully semantic');
  if (config.type === 'regionMap')
    unsupported.push('region map rendering uses placeholder geometry');
  const isChartEx = (config.extra as { isChartEx?: boolean } | undefined)?.isChartEx === true;
  if (
    isChartEx &&
    !config.dataRange &&
    !config.series?.some((series) => series.values?.trim() || series.valueCache?.points?.length)
  ) {
    unsupported.push(`ChartEx ${config.type} data projection is not implemented`);
  }
  if (config.pivotOptions || config.showAllFieldButtons)
    unsupported.push(pivotFieldButtonDiagnostic(config));
  if (config.plotLayout) unsupported.push('manual plot layout is preserved but not rendered');
  if (config.titleLayout || config.chartTitle?.layout)
    unsupported.push('manual title layout is preserved but not rendered');
  if (config.legend?.layout)
    unsupported.push('manual legend layout is preserved but not rendered');
  if (hasManualDataLabelLayout(config))
    unsupported.push('manual data-label layout is preserved but not rendered');
  if (hasTrendlineLabelLayout(config))
    unsupported.push('trendline label layout is preserved but not rendered');
  if (config.dataTable)
    unsupported.push('chart data table is preserved but not rendered');
  if (config.view3d)
    unsupported.push('view3D camera/depth is preserved but rendered as a 2D approximation');
  if (config.floorFormat || config.sideWallFormat || config.backWallFormat)
    unsupported.push('floor/sideWall/backWall surfaces are preserved but not rendered');
  unsupported.push(...sourceLinkedAxisNumberFormatDiagnostics(config));
  unsupported.push(...axisUnsupportedFeatureDiagnostics(config.axis, series));
  return unsupported;
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
          series.dataLabels?.layout ||
          series.points?.some((point) => point.dataLabel?.layout),
      ),
  );
}

function hasTrendlineLabelLayout(config: ChartConfig): boolean {
  return Boolean(
    config.trendline?.label?.layout ||
      config.trendlines?.some((trendline) => trendline.label?.layout) ||
      config.series?.some((series) =>
        series.trendlines?.some((trendline) => trendline.label?.layout),
      ),
  );
}

function axisUnsupportedFeatureDiagnostics(
  axis: ChartConfig['axis'],
  series: ResolvedChartSpecSnapshot['resolved']['series'],
): string[] {
  if (!axis) return [];
  const diagnostics = new Set<string>();
  const entries: Array<[string, NonNullable<ChartConfig['axis']>['categoryAxis']]> = [
    ['category', axis.categoryAxis ?? axis.xAxis],
    ['value', axis.valueAxis ?? axis.yAxis],
    ['secondary category', axis.secondaryCategoryAxis],
    ['secondary value', axis.secondaryValueAxis ?? axis.secondaryYAxis],
    ['series/depth', axis.seriesAxis],
  ];

  for (const [label, axisConfig] of entries) {
    if (!axisConfig) continue;
    if (label === 'series/depth') {
      diagnostics.add('series/depth axes are preserved but not rendered');
    }
    if (
      axisConfig.crossBetween ||
      axisConfig.isBetweenCategories !== undefined
    ) {
      diagnostics.add(`${label} axis category crossing policy is approximate`);
    }
    for (const diagnostic of logAxisDiagnostics(label, axisConfig, series)) {
      diagnostics.add(diagnostic);
    }
  }

  return Array.from(diagnostics);
}

function logAxisDiagnostics(
  label: string,
  axisConfig: NonNullable<NonNullable<ChartConfig['axis']>['categoryAxis']>,
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
