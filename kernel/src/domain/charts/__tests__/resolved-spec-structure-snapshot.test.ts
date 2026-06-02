import type { ChartConfig, ChartData } from '@mog/charts';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import { buildChartFamilySupportSnapshot } from '../bridge/chart-family-support';
import {
  groupingFor,
  snapshotAxis,
  snapshotCategoryLevels,
  snapshotLegend,
  snapshotRange,
  titleText,
} from '../bridge/resolved-spec-structure-snapshot';
import type { ResolvedChartRangeReference } from '../chart-range-references';

type SeriesSnapshot = ResolvedChartSpecSnapshot['resolved']['series'][number];
type SeriesProjectionSnapshot = ResolvedChartSpecSnapshot['resolved']['seriesProjection'];

function chartConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    type: 'column',
    anchorRow: 0,
    anchorCol: 0,
    width: 4,
    height: 5,
    ...overrides,
  };
}

function seriesSnapshot(name: string, index: number, sourceSeriesIndex = index): SeriesSnapshot {
  return {
    index,
    order: index,
    sourceSeriesIndex,
    sourceSeriesKey: `series-${sourceSeriesIndex}`,
    name,
    axisGroup: 'primary',
    source: {},
    renderAuthority: {
      values: 'live',
      categories: 'live',
      bubbleSize: 'unavailable',
    },
    categories: [],
    values: [],
    blankMask: [],
    pointCount: 0,
    renderedPointCount: 0,
    dataHash: `hash-${sourceSeriesIndex}`,
  };
}

function seriesProjectionSnapshot(
  overrides: Partial<SeriesProjectionSnapshot> = {},
): SeriesProjectionSnapshot {
  return {
    authority: 'explicitSeries',
    expectedImportedSeriesCount: 0,
    projectedSeriesCount: 0,
    renderedSeriesCount: 0,
    renderedPointCountBySourceSeriesKey: {},
    droppedSeries: [],
    ...overrides,
  };
}

describe('resolved spec structure snapshot helpers', () => {
  it('snapshots category levels and ranges', () => {
    const chartData: ChartData = {
      categories: ['Q1', 'Q2'],
      categoryLevels: [
        { level: 0, labels: ['North', null] },
        { level: 1, labels: ['Q1', 'Q2'] },
      ],
      series: [],
    };
    const reference: ResolvedChartRangeReference = {
      kind: 'seriesValues',
      source: 'a1',
      ref: 'Sheet1!A1:B2',
      range: {
        sheetId: toSheetId('sheet-1'),
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      },
    };

    expect(snapshotCategoryLevels(chartData)).toEqual([
      { level: 0, labels: ['North', null] },
      { level: 1, labels: ['Q1', 'Q2'] },
    ]);
    expect(snapshotCategoryLevels({ categories: [], series: [] })).toBeUndefined();
    expect(snapshotRange(reference)).toEqual({
      kind: 'seriesValues',
      source: 'a1',
      ref: 'Sheet1!A1:B2',
      range: {
        sheetId: 'sheet-1',
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      },
    });
    expect(snapshotRange(null)).toBeNull();
  });

  it('snapshots axis structure and resolves title/grouping helpers', () => {
    expect(
      snapshotAxis({
        visible: true,
        show: false,
        title: 'Month',
        type: 'category',
        scaleType: 'linear',
        categoryType: 'textAxis',
        min: 1,
        max: 12,
        majorUnit: 2,
        minorUnit: 1,
        logBase: 10,
        displayUnit: 'thousands',
        customDisplayUnit: 1000,
        displayUnitLabel: 'K',
        numberFormat: '0.0',
        linkNumberFormat: true,
        position: 'bottom',
        reverse: true,
        tickMarks: 'outside',
        minorTickMarks: 'inside',
        tickLabelPosition: 'nextTo',
        tickLabelSpacing: 2,
        tickMarkSpacing: 1,
        crossBetween: 'between',
        crossesAt: 'custom',
        crossesAtValue: 4,
        isBetweenCategories: true,
        minorGridLines: true,
        textOrientation: 45,
      }),
    ).toMatchObject({
      present: true,
      visible: true,
      title: 'Month',
      axisType: 'category',
      scaleType: 'linear',
      categoryType: 'textAxis',
      min: 1,
      max: 12,
      majorUnit: 2,
      minorUnit: 1,
      logBase: 10,
      displayUnit: 'thousands',
      customDisplayUnit: 1000,
      displayUnitLabel: 'K',
      numberFormat: '0.0',
      linkNumberFormat: true,
      position: 'bottom',
      reverse: true,
      tickMarks: 'outside',
      minorTickMarks: 'inside',
      tickLabelPosition: 'nextTo',
      tickLabelSpacing: 2,
      tickMarkSpacing: 1,
      crossBetween: 'between',
      crossesAt: 'custom',
      crossesAtValue: 4,
      isBetweenCategories: true,
      minorGridLines: true,
      textOrientation: 45,
    });
    expect(snapshotAxis(undefined)).toBeUndefined();
    expect(titleText(chartConfig({ title: 'Explicit', chartTitle: { text: 'Rich' } }))).toBe(
      'Explicit',
    );
    expect(titleText(chartConfig({ chartTitle: { text: 'Rich' } }))).toBe('Rich');
    expect(titleText(chartConfig({ titleRichText: [{ text: 'Rich ' }, { text: 'Title' }] }))).toBe(
      'Rich Title',
    );
    expect(titleText(chartConfig({ title: '' }))).toBeUndefined();
    expect(groupingFor(chartConfig({ subType: 'stacked' }))).toBe('stacked');
    expect(groupingFor(chartConfig({ subType: 'percentStacked' }))).toBe('percentStacked');
    expect(groupingFor(chartConfig({ subType: 'clustered' }))).toBe('clustered');
    expect(groupingFor(chartConfig())).toBe('standard');
  });

  it('snapshots legend entries from visibility, deleted entries, and hidden series styles', () => {
    const series = [
      seriesSnapshot('Visible', 0),
      seriesSnapshot('Deleted by rendered index', 1, 7),
      seriesSnapshot('Deleted by source index', 2, 4),
      seriesSnapshot('No fill no line', 3),
    ];
    const config = chartConfig({
      legend: {
        show: true,
        visible: true,
        position: 'right',
        entries: [
          { idx: 1, delete: true },
          { idx: 4, visible: false },
        ],
      },
      series: [
        { name: 'Visible' },
        { name: 'Deleted by rendered index' },
        { name: 'Fallback slot' },
        { name: 'No fill no line', format: { fill: { type: 'none' } } },
      ],
    });

    expect(snapshotLegend(config, series)).toEqual({
      present: true,
      visible: true,
      position: 'right',
      entries: [
        'Visible',
        'Deleted by rendered index',
        'Deleted by source index',
        'No fill no line',
      ],
      entryItems: [
        {
          text: 'Visible',
          index: 0,
          visible: true,
          vocabulary: 'series',
          indexKind: 'series',
          sourceSeriesIndex: 0,
          sourceSeriesKey: 'series-0',
        },
        {
          text: 'Deleted by rendered index',
          index: 1,
          visible: false,
          deleted: true,
          vocabulary: 'series',
          indexKind: 'series',
          sourceSeriesIndex: 7,
          sourceSeriesKey: 'series-7',
        },
        {
          text: 'Deleted by source index',
          index: 2,
          visible: false,
          deleted: true,
          vocabulary: 'series',
          indexKind: 'series',
          sourceSeriesIndex: 4,
          sourceSeriesKey: 'series-4',
        },
        {
          text: 'No fill no line',
          index: 3,
          visible: false,
          vocabulary: 'series',
          indexKind: 'series',
          sourceSeriesIndex: 3,
          sourceSeriesKey: 'series-3',
        },
      ],
      entryVocabulary: 'series',
      entryIndexKind: 'series',
      entryLayer: 'rendered',
      visibleEntries: ['Visible'],
      visibleEntryItems: [
        {
          text: 'Visible',
          index: 0,
          visible: true,
          vocabulary: 'series',
          indexKind: 'series',
          sourceSeriesIndex: 0,
          sourceSeriesKey: 'series-0',
        },
      ],
    });
    expect(
      snapshotLegend(chartConfig({ legend: { show: true, visible: true, position: 'none' } }), [
        seriesSnapshot('Hidden legend', 0),
      ]),
    ).toEqual({
      present: false,
      visible: false,
      position: 'none',
      entries: [],
      entryItems: [],
      entryVocabulary: 'series',
      entryIndexKind: 'series',
      entryLayer: 'rendered',
      visibleEntries: [],
      visibleEntryItems: [],
    });
  });

  it('snapshots series legend entries for non-point vary-by-category charts', () => {
    const config = chartConfig({
      varyByCategories: true,
      legend: {
        show: true,
        visible: true,
        position: 'right',
        entries: [{ idx: 1, delete: true }],
      },
    });
    const data: ChartData = {
      categories: ['Category A', 'Category B', 'Category C'],
      series: [{ name: 'Measure', data: [] }],
    };

    expect(snapshotLegend(config, [seriesSnapshot('Measure', 0)], data)).toEqual({
      present: true,
      visible: true,
      position: 'right',
      entries: ['Measure'],
      entryItems: [
        {
          text: 'Measure',
          index: 0,
          visible: true,
          vocabulary: 'series',
          indexKind: 'series',
          sourceSeriesIndex: 0,
          sourceSeriesKey: 'series-0',
        },
      ],
      entryVocabulary: 'series',
      entryIndexKind: 'series',
      entryLayer: 'rendered',
      visibleEntries: ['Measure'],
      visibleEntryItems: [
        {
          text: 'Measure',
          index: 0,
          visible: true,
          vocabulary: 'series',
          indexKind: 'series',
          sourceSeriesIndex: 0,
          sourceSeriesKey: 'series-0',
        },
      ],
    });
  });

  it('snapshots point legend entries for pie-like charts', () => {
    const config = chartConfig({
      type: 'pie',
      varyByCategories: false,
      legend: {
        show: true,
        visible: true,
        position: 'right',
        entries: [{ idx: 1, delete: true }],
      },
    });
    const data: ChartData = {
      categories: ['Category A', 'Category B', 'Category C'],
      series: [{ name: 'Measure', data: [] }],
    };

    expect(snapshotLegend(config, [seriesSnapshot('Measure', 0)], data)).toEqual({
      present: true,
      visible: true,
      position: 'right',
      entries: ['Category A', 'Category B', 'Category C'],
      entryItems: [
        {
          text: 'Category A',
          index: 0,
          visible: true,
          vocabulary: 'category',
          indexKind: 'point',
          pointIndex: 0,
        },
        {
          text: 'Category B',
          index: 1,
          visible: false,
          deleted: true,
          vocabulary: 'category',
          indexKind: 'point',
          pointIndex: 1,
        },
        {
          text: 'Category C',
          index: 2,
          visible: true,
          vocabulary: 'category',
          indexKind: 'point',
          pointIndex: 2,
        },
      ],
      entryVocabulary: 'category',
      entryIndexKind: 'point',
      entryLayer: 'rendered',
      visibleEntries: ['Category A', 'Category C'],
      visibleEntryItems: [
        {
          text: 'Category A',
          index: 0,
          visible: true,
          vocabulary: 'category',
          indexKind: 'point',
          pointIndex: 0,
        },
        {
          text: 'Category C',
          index: 2,
          visible: true,
          vocabulary: 'category',
          indexKind: 'point',
          pointIndex: 2,
        },
      ],
    });
  });

  it('keeps imported bubble legends in the source series domain', () => {
    const config = chartConfig({
      type: 'bubble',
      varyByCategories: true,
      legend: {
        show: true,
        visible: true,
        position: 'right',
        entries: [{ idx: 0, delete: true }],
      },
    });
    const data: ChartData = {
      categories: [1, 2, 3],
      series: [{ name: 'Products', data: [] }],
    };

    expect(snapshotLegend(config, [seriesSnapshot('Products', 0)], data)).toEqual({
      present: true,
      visible: true,
      position: 'right',
      entries: ['Products'],
      entryItems: [
        {
          text: 'Products',
          index: 0,
          visible: false,
          deleted: true,
          vocabulary: 'series',
          indexKind: 'series',
          sourceSeriesIndex: 0,
          sourceSeriesKey: 'series-0',
        },
      ],
      entryVocabulary: 'series',
      entryIndexKind: 'series',
      entryLayer: 'rendered',
      visibleEntries: [],
      visibleEntryItems: [],
    });
  });

  it('reports standard bubble support as exact when the legend uses source series entries', () => {
    const config = chartConfig({
      type: 'bubble',
      legend: { show: true, visible: true, position: 'right' },
    });
    const data: ChartData = {
      categories: [1, 2],
      series: [{ name: 'Products', data: [] }],
    };
    const legend = snapshotLegend(config, [seriesSnapshot('Products', 0)], data);

    expect(
      buildChartFamilySupportSnapshot({
        chart: { chartType: 'bubble' } as any,
        config,
        chartData: data,
        legend,
        seriesProjection: seriesProjectionSnapshot(),
      }),
    ).toMatchObject({
      supportLevel: 'exact',
      reason: 'exactRenderer',
      renderedAs: 'bubble',
    });
    expect(
      buildChartFamilySupportSnapshot({
        chart: { chartType: 'bubble' } as any,
        config,
        chartData: data,
        legend: { ...legend, entryVocabulary: 'category' },
        seriesProjection: seriesProjectionSnapshot(),
      }),
    ).toMatchObject({
      supportLevel: 'approximate',
      reason: 'bubbleLegendSeriesDomain',
    });
  });
});
