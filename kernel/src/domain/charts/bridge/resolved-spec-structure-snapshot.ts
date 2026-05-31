import type { ChartConfig, ChartData } from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import type { ResolvedChartRangeReference } from '../chart-range-references';
import { isNoFillNoLineSeriesConfig } from './chart-render-data-normalizer';

type AxisSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['axes']['category']>;
type RangeSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['ranges']['dataRange']>;
type CategoryLevelSnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['categoryLevels']
>[number];

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
