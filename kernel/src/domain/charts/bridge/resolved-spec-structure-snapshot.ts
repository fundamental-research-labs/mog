import {
  buildPieDoughnutGeometry,
  pieLegendDisplayLabel,
  type ChartConfig,
  type ChartData,
  type LegendTrace,
} from '@mog/charts';
import type {
  ChartLegendEntryIndexKind,
  ChartLegendEntryVocabulary,
  ChartSemanticLayer,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { ResolvedChartRangeReference } from '../chart-range-references';
import { isNoFillNoLineSeriesConfig } from './chart-render-data-normalizer';

type AxisSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['axes']['category']>;
type RangeSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['ranges']['dataRange']>;
type CategoryLevelSnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['categoryLevels']
>[number];
type LegendSnapshot = ResolvedChartSpecSnapshot['resolved']['legend'];
type LegendEntrySnapshot = NonNullable<LegendSnapshot['entryItems']>[number];
type SeriesProjectionSnapshot = ResolvedChartSpecSnapshot['resolved']['seriesProjection'];
type SourceSeriesSnapshot = NonNullable<SeriesProjectionSnapshot['sourceSeries']>[number];

type LegendVocabularyDecision = {
  vocabulary: ChartLegendEntryVocabulary;
  layer: ChartSemanticLayer;
  indexKind: ChartLegendEntryIndexKind;
  useCategoryEntries: boolean;
};

export function snapshotCategoryLevels(data: ChartData): CategoryLevelSnapshot[] | undefined {
  if (!data.categoryLevels?.length) return undefined;
  return data.categoryLevels.map((level) => ({
    level: level.level,
    labels: level.labels.map((label) => (label == null ? null : String(label))),
  }));
}

export function snapshotAxis(
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

export function snapshotLegend(
  config: ChartConfig,
  series: ResolvedChartSpecSnapshot['resolved']['series'],
  data?: ChartData,
  seriesProjection?: SeriesProjectionSnapshot,
  legendTrace?: LegendTrace,
): LegendSnapshot {
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
  const stockSourceSeries = stockLegendSourceSeries(config, seriesProjection);
  const decision = stockSourceSeries
    ? {
        vocabulary: 'stockSourceRole' as const,
        layer: 'source' as const,
        indexKind: 'stockRole' as const,
        useCategoryEntries: false,
      }
    : legendVocabularyFor(config, data);
  const entryItems =
    present && stockSourceSeries
      ? stockSourceLegendEntries(config, stockSourceSeries, deletedEntries, visible, decision)
      : present && decision.vocabulary === 'valueBand' && data
        ? surfaceValueBandLegendEntries(config, data, deletedEntries, visible, decision)
        : present && decision.useCategoryEntries && data
          ? categoryLegendEntries(config, data, deletedEntries, visible, decision)
          : present
            ? seriesLegendEntries(config, series, deletedEntries, visible, decision)
            : [];
  const visibleEntryItems = entryItems.filter((entry) => entry.visible);
  return {
    present,
    visible,
    position: legend?.position,
    ...renderedLegendSnapshot({ present, visible, legendTrace }),
    entries: entryItems.map((entry) => entry.text),
    visibleEntries: visibleEntryItems.map((entry) => entry.text),
    entryVocabulary: decision.vocabulary,
    entryLayer: decision.layer,
    entryIndexKind: decision.indexKind,
    entryItems,
    visibleEntryItems,
  };
}

function renderedLegendSnapshot(input: {
  present: boolean;
  visible: boolean;
  legendTrace?: LegendTrace;
}): Pick<LegendSnapshot, 'rendered'> {
  const trace = input.legendTrace;
  if (!trace) return {};

  const rendered = {
    present: trace.renderedPresent,
    visible: trace.renderedVisible,
    markCount: trace.generatedMarkCount,
    ...(trace.sourceChannels.length > 0 ? { sourceChannels: trace.sourceChannels } : {}),
    ...(trace.area ? { area: normalizedLegendArea(trace) } : {}),
    ...(trace.flow
      ? {
          flow: {
            orient: trace.flow.orient,
            entryCount: trace.flow.entryCount,
            renderedEntryCount: trace.flow.renderedEntryCount,
            visibleEntryCount: trace.flow.visibleEntryCount,
            clippedEntryCount: trace.flow.clippedEntryCount,
            rowCount: trace.flow.rowCount,
            columnCount: trace.flow.columnCount,
            rowGap: trace.flow.rowGap,
            entryGap: trace.flow.entryGap,
            contentWidth: trace.flow.contentWidth,
            contentHeight: trace.flow.contentHeight,
            overflowPolicy: trace.flow.overflowPolicy,
            entries: trace.flow.entries.map((entry) => ({
              entryIndex: entry.entryIndex,
              rowIndex: entry.rowIndex,
              columnIndex: entry.columnIndex,
              text: entry.text,
              x: entry.x,
              y: entry.y,
              width: entry.width,
              height: entry.height,
              symbolBounds: entry.symbolBounds,
              labelBounds: entry.labelBounds,
              drawn: entry.drawn,
              clipped: entry.clipped,
            })),
          },
        }
      : {}),
    ...(trace.renderedEntries && trace.renderedEntries.length > 0
      ? {
          entries: trace.renderedEntries.map((entry) => ({
            value: entry.value,
            text: entry.label,
            ...(entry.symbolType !== undefined ? { symbolType: entry.symbolType } : {}),
            ...(entry.seriesIndex !== undefined ? { seriesIndex: entry.seriesIndex } : {}),
            ...(entry.sourceSeriesIndex !== undefined
              ? { sourceSeriesIndex: entry.sourceSeriesIndex }
              : {}),
            ...(entry.sourceSeriesKey !== undefined
              ? { sourceSeriesKey: entry.sourceSeriesKey }
              : {}),
            ...(entry.pointIndex !== undefined ? { pointIndex: entry.pointIndex } : {}),
            ...(entry.pointKey !== undefined ? { pointKey: entry.pointKey } : {}),
            ...(entry.legendKey !== undefined ? { legendKey: entry.legendKey } : {}),
            ...(entry.colorKey !== undefined ? { colorKey: entry.colorKey } : {}),
            ...(entry.stockRole !== undefined ? { stockRole: entry.stockRole } : {}),
          })),
        }
      : {}),
    ...legendMismatchReason(input.present, input.visible, trace),
  };
  return { rendered };
}

function normalizedLegendArea(
  trace: LegendTrace,
): NonNullable<NonNullable<LegendSnapshot['rendered']>['area']> {
  const width = trace.chartWidth || 1;
  const height = trace.chartHeight || 1;
  const area = trace.area!;
  return {
    left: area.x / width,
    top: area.y / height,
    width: area.width / width,
    height: area.height / height,
  };
}

function legendMismatchReason(
  present: boolean,
  visible: boolean,
  trace: LegendTrace,
): Pick<NonNullable<LegendSnapshot['rendered']>, 'mismatchReason'> {
  if ((!present || !visible) && trace.renderedPresent) {
    return { mismatchReason: 'legendRenderedWithoutVisibleSourceLegend' };
  }
  if (present && visible && !trace.renderedPresent) {
    return { mismatchReason: 'visibleSourceLegendNotRendered' };
  }
  if (trace.renderedPresent && !trace.renderedVisible) {
    return { mismatchReason: 'legendLayoutReservedWithoutMarks' };
  }
  return {};
}

function categoryLegendEntries(
  config: ChartConfig,
  data: ChartData,
  deletedEntries: ReadonlySet<number>,
  visible: boolean,
  decision: LegendVocabularyDecision,
): LegendEntrySnapshot[] {
  if (!isPieLikePointLegendChartType(config.type)) {
    return data.categories.map((category, index) => {
      const deleted = deletedEntries.has(index);
      return {
        index,
        text: categoryLegendDisplayLabel(category, index),
        visible: visible && !deleted,
        ...(deleted ? { deleted: true } : {}),
        vocabulary: decision.vocabulary,
        indexKind: decision.indexKind,
        pointIndex: index,
      };
    });
  }
  return pieLikeLegendEntries(config, data, deletedEntries, visible, decision);
}

function pieLikeLegendEntries(
  config: ChartConfig,
  data: ChartData,
  deletedEntries: ReadonlySet<number>,
  visible: boolean,
  decision: LegendVocabularyDecision,
): LegendEntrySnapshot[] {
  const geometry = buildPieDoughnutGeometry({
    config,
    data,
    chartWidth: 2,
    chartHeight: 2,
    plotArea: { x: 0, y: 0, width: 2, height: 2 },
    includeSeries: ({ seriesConfig }) => !isNoFillNoLineSeriesConfig(seriesConfig),
  });
  const points =
    geometry?.rings[0]?.slices.map((slice) => ({
      pointIndex: slice.pointIndex,
      pointKey: slice.pointKey,
      legendKey: slice.legendKey,
      colorKey: slice.colorKey,
      category: slice.category,
      seriesIndex: slice.seriesIndex,
      sourceSeriesIndex: slice.sourceSeriesIndex,
      sourceSeriesKey: slice.sourceSeriesKey,
    })) ?? [];
  return points.map((point, index) => {
    const deleted = deletedEntries.has(point.pointIndex);
    return {
      index,
      text: pieLegendDisplayLabel(point.category, point.pointIndex),
      visible: visible && !deleted,
      ...(deleted ? { deleted: true } : {}),
      vocabulary: decision.vocabulary,
      indexKind: decision.indexKind,
      pointIndex: point.pointIndex,
      pointKey: point.pointKey,
      legendKey: point.legendKey,
      colorKey: point.colorKey,
      seriesIndex: point.seriesIndex,
      sourceSeriesIndex: point.sourceSeriesIndex,
      sourceSeriesKey: point.sourceSeriesKey,
    };
  });
}

function seriesLegendEntries(
  config: ChartConfig,
  series: ResolvedChartSpecSnapshot['resolved']['series'],
  deletedEntries: ReadonlySet<number>,
  visible: boolean,
  decision: LegendVocabularyDecision,
): LegendEntrySnapshot[] {
  return series.map((item, index) => {
    const configured = config.series?.[item.sourceSeriesIndex] ?? config.series?.[index];
    const deleted = deletedEntries.has(index) || deletedEntries.has(item.sourceSeriesIndex);
    const styleHidden = isNoFillNoLineSeriesConfig(configured);
    return {
      index,
      text: item.name,
      visible: visible && !deleted && !styleHidden,
      ...(deleted ? { deleted: true } : {}),
      vocabulary: decision.vocabulary,
      indexKind: decision.indexKind,
      sourceSeriesIndex: item.sourceSeriesIndex,
      sourceSeriesKey: item.sourceSeriesKey,
      ...(item.stockRole ? { stockRole: item.stockRole } : {}),
    };
  });
}

function stockSourceLegendEntries(
  config: ChartConfig,
  sourceSeries: SourceSeriesSnapshot[],
  deletedEntries: ReadonlySet<number>,
  visible: boolean,
  decision: LegendVocabularyDecision,
): LegendEntrySnapshot[] {
  return sourceSeries.map((item, index) => {
    const configured = config.series?.[item.sourceSeriesIndex] ?? config.series?.[index];
    const deleted = deletedEntries.has(index) || deletedEntries.has(item.sourceSeriesIndex);
    const styleHidden = isNoFillNoLineSeriesConfig(configured);
    return {
      index,
      text: item.name ?? `Series ${item.sourceSeriesIndex + 1}`,
      visible: visible && !deleted && !styleHidden,
      ...(deleted ? { deleted: true } : {}),
      vocabulary: decision.vocabulary,
      indexKind: decision.indexKind,
      sourceSeriesIndex: item.sourceSeriesIndex,
      sourceSeriesKey: item.sourceSeriesKey,
      ...(item.stockRole ? { stockRole: item.stockRole } : {}),
    };
  });
}

function legendVocabularyFor(config: ChartConfig, data?: ChartData): LegendVocabularyDecision {
  const surfaceLegendTypes = new Set([
    'surface',
    'surface3d',
    'surfaceWireframe',
    'surfaceTopView',
    'surfaceTopViewWireframe',
  ]);
  if (surfaceLegendTypes.has(config.type)) {
    if (!isImportedChartConfig(config)) {
      return {
        vocabulary: 'series',
        layer: 'rendered',
        indexKind: 'series',
        useCategoryEntries: false,
      };
    }
    if (hasFiniteSurfaceValues(data)) {
      return {
        vocabulary: 'valueBand',
        layer: 'rendered',
        indexKind: 'valueBand',
        useCategoryEntries: false,
      };
    }
    return {
      vocabulary: 'unknown',
      layer: 'unknown',
      indexKind: 'unknown',
      useCategoryEntries: false,
    };
  }

  if (data && isPieLikePointLegendChartType(config.type)) {
    return {
      vocabulary: 'point',
      layer: 'rendered',
      indexKind: 'point',
      useCategoryEntries: true,
    };
  }

  if (usesPointLegendEntries(config, data)) {
    return {
      vocabulary: 'category',
      layer: 'rendered',
      indexKind: 'point',
      useCategoryEntries: true,
    };
  }

  return {
    vocabulary: 'series',
    layer: 'rendered',
    indexKind: 'series',
    useCategoryEntries: false,
  };
}

function surfaceValueBandLegendEntries(
  config: ChartConfig,
  data: ChartData,
  deletedEntries: ReadonlySet<number>,
  visible: boolean,
  decision: LegendVocabularyDecision,
): LegendEntrySnapshot[] {
  return surfaceValueBandLabels(config, data).map((label, index) => {
    const deleted = deletedEntries.has(index);
    return {
      index,
      text: label,
      visible: visible && !deleted,
      ...(deleted ? { deleted: true } : {}),
      vocabulary: decision.vocabulary,
      indexKind: decision.indexKind,
      valueBandIndex: index,
    };
  });
}

function surfaceValueBandLabels(config: ChartConfig, data: ChartData): string[] {
  const values = finiteSurfaceValues(data);
  if (values.length === 0) return [];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const defaultBandCount = isSurfaceTopViewConfig(config) ? 5 : 8;
  const labelFractionDigits = isSurfaceTopViewConfig(config) ? 2 : 3;
  const valueAxis = config.axis?.valueAxis ?? config.axis?.yAxis;
  const explicitMin = finiteNumber(valueAxis?.min);
  const explicitMax = finiteNumber(valueAxis?.max);
  const explicitStep = finiteNumber(valueAxis?.majorUnit);
  const domainMinSeed = explicitMin ?? (minValue >= 0 ? 0 : minValue);
  const step =
    explicitStep ?? niceStep(Math.max(1e-9, (maxValue - domainMinSeed) / defaultBandCount));
  const domainMin = explicitMin ?? Math.floor(domainMinSeed / step) * step;
  let domainMax = explicitMax ?? Math.ceil(maxValue / step) * step;
  if (domainMax <= domainMin) domainMax = domainMin + step;
  const bandCount = Math.max(1, Math.min(12, Math.ceil((domainMax - domainMin) / step)));
  const labels: string[] = [];
  for (let index = 0; index < bandCount; index += 1) {
    const min = domainMin + index * step;
    const max = index === bandCount - 1 ? domainMax : domainMin + (index + 1) * step;
    labels.push(
      `${formatBandValue(min, labelFractionDigits)}-${formatBandValue(max, labelFractionDigits)}`,
    );
  }
  return labels;
}

function finiteSurfaceValues(data: ChartData): number[] {
  const values: number[] = [];
  for (const series of data.series) {
    for (const point of series.data) {
      if (point.valueState !== undefined && point.valueState !== 'value') continue;
      if (typeof point.y === 'number' && Number.isFinite(point.y)) values.push(point.y);
    }
  }
  return values;
}

function hasFiniteSurfaceValues(data: ChartData | undefined): data is ChartData {
  return data !== undefined && finiteSurfaceValues(data).length > 0;
}

function isSurfaceTopViewConfig(config: ChartConfig): boolean {
  return (
    config.type === 'surface' ||
    config.type === 'surfaceTopView' ||
    config.type === 'surfaceTopViewWireframe' ||
    config.surfaceTopView === true
  );
}

function isImportedChartConfig(config: ChartConfig): boolean {
  if (typeof config.extra !== 'object' || config.extra === null) return false;
  const extra = config.extra as { imported?: unknown; sourceDialect?: unknown };
  return extra.imported === true || typeof extra.sourceDialect === 'string';
}

function niceStep(rawStep: number): number {
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = Math.pow(10, exponent);
  const fraction = rawStep / magnitude;
  const niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  return niceFraction * magnitude;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatBandValue(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits);
}

function usesPointLegendEntries(config: ChartConfig, data?: ChartData): data is ChartData {
  if (!data) return false;
  if (isPieLikePointLegendChartType(config.type)) return true;
  return isXYPointLegendConfig(config) && data.series.some((series) => series.data.length > 0);
}

function isPieLikePointLegendChartType(type: ChartConfig['type']): boolean {
  return (
    type === 'pie' ||
    type === 'pieExploded' ||
    type === 'pie3d' ||
    type === 'pie3dExploded' ||
    type === 'doughnut' ||
    type === 'doughnutExploded' ||
    type === 'ofPie'
  );
}

function isXYPointLegendConfig(config: ChartConfig): boolean {
  if (config.varyByCategories !== true) return false;
  if (isImportedChartConfig(config)) return false;
  return config.type === 'bubble' || config.type === 'bubble3DEffect' || config.type === 'scatter';
}

function categoryLegendDisplayLabel(
  category: string | number | null | undefined,
  pointIndex: number,
): string {
  if (category !== undefined && category !== null && String(category) !== '') {
    return String(category);
  }
  return `Point ${pointIndex + 1}`;
}

export function snapshotRange(reference: ResolvedChartRangeReference | null): RangeSnapshot | null {
  if (!reference) return null;
  return {
    kind: reference.kind,
    source: reference.source,
    ref: reference.ref,
    sheetName: reference.sheetName,
    range: {
      startRow: reference.range.startRow,
      startCol: reference.range.startCol,
      endRow: reference.range.endRow,
      endCol: reference.range.endCol,
    },
  };
}

export function titleText(config: ChartConfig): string | undefined {
  const text =
    config.title ??
    config.chartTitle?.text ??
    config.titleRichText?.map((part) => part.text).join('');
  return text || undefined;
}

export function groupingFor(
  config: ChartConfig,
): ResolvedChartSpecSnapshot['resolved']['grouping'] {
  if (config.subType === 'stacked') return 'stacked';
  if (config.subType === 'percentStacked') return 'percentStacked';
  if (config.subType === 'clustered') return 'clustered';
  return 'standard';
}

function stockLegendSourceSeries(
  config: ChartConfig,
  seriesProjection: SeriesProjectionSnapshot | undefined,
): SourceSeriesSnapshot[] | undefined {
  if (config.type !== 'stock') return undefined;
  const sourceSeries = seriesProjection?.sourceSeries?.filter((item) => item.stockRole);
  return sourceSeries && sourceSeries.length > 0 ? sourceSeries : undefined;
}
