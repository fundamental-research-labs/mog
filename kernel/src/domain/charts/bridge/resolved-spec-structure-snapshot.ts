import type { ChartConfig, ChartData } from '@mog/charts';
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
      ? categoryLegendEntries(data, deletedEntries, visible, decision)
      : present
        ? seriesLegendEntries(config, series, deletedEntries, visible, decision)
        : [];
  const visibleEntryItems = entryItems.filter((entry) => entry.visible);
  return {
    present,
    visible,
    position: legend?.position,
    entries: entryItems.map((entry) => entry.text),
    visibleEntries: visibleEntryItems.map((entry) => entry.text),
    entryVocabulary: decision.vocabulary,
    entryLayer: decision.layer,
    entryIndexKind: decision.indexKind,
    entryItems,
    visibleEntryItems,
  };
}

function categoryLegendEntries(
  data: ChartData,
  deletedEntries: ReadonlySet<number>,
  visible: boolean,
  decision: LegendVocabularyDecision,
): LegendEntrySnapshot[] {
  return data.categories.map((category, index) => {
    const deleted = deletedEntries.has(index);
    return {
      index,
      text: String(category),
      visible: visible && !deleted,
      ...(deleted ? { deleted: true } : {}),
      vocabulary: decision.vocabulary,
      indexKind: decision.indexKind,
      pointIndex: index,
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
      `${formatBandValue(min, labelFractionDigits)}-${formatBandValue(
        max,
        labelFractionDigits,
      )}`,
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
  return isPointLegendChartType(config.type);
}

function isPointLegendChartType(type: ChartConfig['type']): boolean {
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

export function snapshotRange(reference: ResolvedChartRangeReference | null): RangeSnapshot | null {
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
