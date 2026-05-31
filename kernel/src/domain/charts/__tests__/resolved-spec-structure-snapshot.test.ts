import type { ChartConfig, ChartData } from '@mog/charts';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

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
      visibleEntries: ['Visible'],
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
      visibleEntries: [],
    });
  });
});
