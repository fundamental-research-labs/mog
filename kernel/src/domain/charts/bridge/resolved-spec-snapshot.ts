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
import { isNoFillNoLineSeriesConfig } from './chart-render-data-normalizer';

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
      unsupportedFeatures: unsupportedFeatureDiagnostics(input.config),
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
    numberFormat: axis.numberFormat,
    position: axis.position,
    reverse: axis.reverse,
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

function unsupportedFeatureDiagnostics(config: ChartConfig): string[] {
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
    unsupported.push('pivot chart field buttons are not rendered');
  unsupported.push(...axisUnsupportedFeatureDiagnostics(config.axis));
  return unsupported;
}

function axisUnsupportedFeatureDiagnostics(axis: ChartConfig['axis']): string[] {
  if (!axis) return [];
  const diagnostics = new Set<string>();
  const entries: Array<[string, NonNullable<ChartConfig['axis']>['categoryAxis']]> = [
    ['category', axis.categoryAxis ?? axis.xAxis],
    ['value', axis.valueAxis ?? axis.yAxis],
    ['secondary category', axis.secondaryCategoryAxis],
    ['series/depth', axis.seriesAxis],
  ];

  for (const [label, axisConfig] of entries) {
    if (!axisConfig) continue;
    if (label === 'secondary category') {
      diagnostics.add('secondary category axes are preserved but not rendered');
    }
    if (label === 'series/depth') {
      diagnostics.add('series/depth axes are preserved but not rendered');
    }
    if (axisConfig.scaleType === 'logarithmic' || axisConfig.logBase !== undefined) {
      diagnostics.add(`${label} log axis scale is not fully rendered`);
    }
    if (
      axisConfig.displayUnit ||
      axisConfig.customDisplayUnit !== undefined ||
      axisConfig.displayUnitLabel
    ) {
      diagnostics.add(`${label} axis display units are not rendered`);
    }
    if (axisConfig.tickLabelSpacing !== undefined || axisConfig.tickMarkSpacing !== undefined) {
      diagnostics.add(`${label} axis explicit tick skipping is not rendered`);
    }
    if (axisConfig.linkNumberFormat) {
      diagnostics.add(`${label} axis source-linked number format is not resolved`);
    }
    if (axisConfig.tickLabelPosition && axisConfig.tickLabelPosition !== 'nextTo') {
      diagnostics.add(`${label} axis tick label position is not fully rendered`);
    }
    if (
      axisConfig.crossBetween ||
      axisConfig.isBetweenCategories !== undefined ||
      axisConfig.crossesAt === 'custom'
    ) {
      diagnostics.add(`${label} axis crossing semantics are not fully rendered`);
    }
    if (
      axisConfig.minorUnit !== undefined ||
      axisConfig.minorGridLines ||
      axisConfig.minorTickMarks
    ) {
      diagnostics.add(`${label} axis minor ticks/gridlines are approximate`);
    }
  }

  return Array.from(diagnostics);
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
