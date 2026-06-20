import { compile } from '../../grammar/compiler';
import { isLayerSpec, type ChartSpec, type UnitSpec } from '../../grammar/spec';
import type { RectMark, TextMark } from '../../primitives/types';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';

const TEST_CHART_WIDTH_PT = 480;
const TEST_CHART_HEIGHT_PT = 75;

function asUnitSpec(spec: ChartSpec): UnitSpec {
  expect(isLayerSpec(spec)).toBe(false);
  return spec as UnitSpec;
}

function inlineRows(spec: ChartSpec) {
  expect(spec.data).toBeDefined();
  expect('values' in spec.data!).toBe(true);
  return 'values' in spec.data! ? spec.data.values : [];
}

describe('configToSpec invisible stacked bar series', () => {
  const data: ChartData = {
    categories: ['A', 'B'],
    series: [
      {
        name: 'Series 0',
        data: [
          { x: 'A', y: 100 },
          { x: 'B', y: 200 },
        ],
      },
      {
        name: 'Series 1',
        data: [
          { x: 'A', y: 10 },
          { x: 'B', y: 20 },
        ],
      },
      {
        name: '25th to Median',
        data: [
          { x: 'A', y: 5 },
          { x: 'B', y: 8 },
        ],
      },
      {
        name: 'Median to 75th',
        data: [
          { x: 'A', y: 6 },
          { x: 'B', y: 9 },
        ],
      },
    ],
  };

  const config: ChartConfig = {
    type: 'bar',
    subType: 'stacked',
    anchorRow: 0,
    anchorCol: 0,
    width: TEST_CHART_WIDTH_PT,
    height: TEST_CHART_HEIGHT_PT,
    legend: {
      show: true,
      visible: true,
      position: 'right',
    },
    series: [
      {
        idx: 0,
        order: 0,
        format: { fill: { type: 'none' }, line: {} },
      },
      {
        idx: 1,
        order: 1,
        format: { fill: { type: 'none' }, line: {} },
      },
      {
        idx: 2,
        order: 2,
        name: '25th to Median',
        format: {
          fill: { type: 'solid', color: { theme: 'accent1', tintShade: 0.86 } },
          line: { color: { theme: 'tx1' }, width: 0.75 },
        },
      },
      {
        idx: 3,
        order: 3,
        name: 'Median to 75th',
        format: {
          fill: { type: 'solid', color: { theme: 'accent1', tintShade: 0.58 } },
          line: { color: { theme: 'tx1' }, width: 0.75 },
        },
      },
    ],
  };

  it('keeps no-fill/no-line series in stack data but hides their marks and legend entries', () => {
    const spec = asUnitSpec(configToSpec(config, data));
    const rows = inlineRows(spec);

    expect(spec.mark).toMatchObject({
      type: 'bar',
      stroke: '#000000',
      strokeWidth: 1,
    });
    expect(rows.filter((row) => row.series === 'Series 0')).toHaveLength(2);
    expect(rows.filter((row) => row.series === 'Series 0')).toEqual(
      expect.arrayContaining([expect.objectContaining({ __mogSeriesOpacity: 0 })]),
    );
    expect(rows.filter((row) => row.series === '25th to Median')).toEqual(
      expect.arrayContaining([expect.objectContaining({ __mogSeriesOpacity: 1 })]),
    );
    expect(spec.encoding?.color?.scale).toMatchObject({
      domain: ['25th to Median', 'Median to 75th'],
    });
    expect(spec.encoding?.color?.legend).toEqual(expect.not.objectContaining({ reverse: true }));

    const result = compile(spec);
    expect(result.layout.legend?.x).toBeGreaterThanOrEqual(
      result.layout.plotArea.x + result.layout.plotArea.width,
    );
    const hiddenBars = result.marks.filter(
      (mark): mark is RectMark =>
        mark.type === 'rect' &&
        (mark.datum as { series?: string } | undefined)?.series === 'Series 0',
    );
    expect(hiddenBars).toHaveLength(2);
    expect(hiddenBars.every((mark) => mark.style.opacity === 0)).toBe(true);

    const legendLabels = result.legends
      .filter((mark): mark is TextMark => mark.type === 'text')
      .map((mark) => mark.text);
    expect(legendLabels).toEqual(['25th to Median', 'Median to 75th']);
  });

  it('uses stable category keys for imported charts with duplicate and blank labels', () => {
    const duplicateData: ChartData = {
      categories: ['Group A', '', 'Repeated', 'Repeated'],
      series: [
        {
          name: 'Visible',
          data: [
            { x: 'Group A', y: 10 },
            { x: '', y: 0, valueState: 'blank' },
            { x: 'Repeated', y: 20 },
            { x: 'Repeated', y: 30 },
          ],
        },
      ],
    };
    const importedConfig: ChartConfig = {
      type: 'bar',
      subType: 'stacked',
      anchorRow: 0,
      anchorCol: 0,
      width: TEST_CHART_WIDTH_PT,
      height: TEST_CHART_HEIGHT_PT,
      extra: {},
    };

    const spec = asUnitSpec(configToSpec(importedConfig, duplicateData));

    expect(spec.encoding?.y?.scale).toMatchObject({
      domain: ['__mogCategory:0', '__mogCategory:1', '__mogCategory:2', '__mogCategory:3'],
      reverse: true,
    });
    expect(spec.encoding?.y?.axis).toMatchObject({
      labelTextByValue: {
        '__mogCategory:0': 'Group A',
        '__mogCategory:1': '',
        '__mogCategory:2': 'Repeated',
        '__mogCategory:3': 'Repeated',
      },
    });

    const rows = inlineRows(spec);
    expect(rows.map((row) => row.category)).toEqual([
      '__mogCategory:0',
      '__mogCategory:2',
      '__mogCategory:3',
    ]);

    const result = compile(spec);
    const bars = result.marks.filter((mark): mark is RectMark => mark.type === 'rect');
    expect(new Set(bars.map((mark) => mark.y))).toHaveProperty('size', 3);
  });

  it('uses stable category keys for multi-level categories with duplicate and blank labels', () => {
    const multiLevelData: ChartData = {
      categories: ['North / Q1', 'North / Q1', ''],
      categoryLevels: [
        { level: 0, labels: ['North', 'North', 'South'] },
        { level: 1, labels: ['Q1', 'Q1', null] },
      ],
      series: [
        {
          name: 'Visible',
          data: [
            { x: 'North / Q1', y: 10 },
            { x: 'North / Q1', y: 20 },
            { x: '', y: 30 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: TEST_CHART_WIDTH_PT,
      height: TEST_CHART_HEIGHT_PT,
    };

    const spec = asUnitSpec(configToSpec(config, multiLevelData));

    expect(spec.encoding?.x?.scale).toMatchObject({
      domain: ['__mogCategory:0', '__mogCategory:1', '__mogCategory:2'],
    });
    expect(spec.encoding?.x?.axis).toMatchObject({
      labelTextByValue: {
        '__mogCategory:0': 'North / Q1',
        '__mogCategory:1': 'North / Q1',
        '__mogCategory:2': '',
      },
      multiLevelLabelsByValue: {
        '__mogCategory:0': ['North', 'Q1'],
        '__mogCategory:1': ['North', 'Q1'],
        '__mogCategory:2': ['South', ''],
      },
    });
    expect(inlineRows(spec).map((row) => row.category)).toEqual([
      '__mogCategory:0',
      '__mogCategory:1',
      '__mogCategory:2',
    ]);

    const result = compile(spec);
    const axisLevelLabels = result.axes.filter((mark): mark is TextMark => {
      const datum = mark.datum as { axisPart?: string } | undefined;
      return mark.type === 'text' && datum?.axisPart === 'multiLevelLabel';
    });
    expect(axisLevelLabels.map((mark) => mark.text)).toEqual([
      'Q1',
      'North',
      'Q1',
      'North',
      '',
      'South',
    ]);
    expect(axisLevelLabels.map((mark) => (mark.datum as { level: number }).level)).toEqual([
      1, 0, 1, 0, 1, 0,
    ]);
    expect(spec.config?.layoutHints?.bottomMargin).toBeGreaterThanOrEqual(43);
  });

  it('renders multi-level category labels on horizontal bar y-axes', () => {
    const multiLevelData: ChartData = {
      categories: ['North / Q1', 'North / Q1', ''],
      categoryLevels: [
        { level: 0, labels: ['North', 'North', 'South'] },
        { level: 1, labels: ['Q1', 'Q1', null] },
      ],
      series: [
        {
          name: 'Visible',
          data: [
            { x: 'North / Q1', y: 10 },
            { x: 'North / Q1', y: 20 },
            { x: '', y: 30 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'bar',
      anchorRow: 0,
      anchorCol: 0,
      width: TEST_CHART_WIDTH_PT,
      height: TEST_CHART_HEIGHT_PT,
    };

    const spec = asUnitSpec(configToSpec(config, multiLevelData));

    expect(spec.encoding?.y?.axis).toMatchObject({
      multiLevelLabelsByValue: {
        '__mogCategory:0': ['North', 'Q1'],
        '__mogCategory:1': ['North', 'Q1'],
        '__mogCategory:2': ['South', ''],
      },
    });

    const result = compile(spec);
    const axisLevelLabels = result.axes.filter((mark): mark is TextMark => {
      const datum = mark.datum as { axisPart?: string; role?: string } | undefined;
      return (
        mark.type === 'text' && datum?.role === 'y-axis' && datum.axisPart === 'multiLevelLabel'
      );
    });
    expect(axisLevelLabels.map((mark) => mark.text)).toEqual([
      'Q1',
      'North',
      'Q1',
      'North',
      '',
      'South',
    ]);
    expect(axisLevelLabels.map((mark) => (mark.datum as { level: number }).level)).toEqual([
      1, 0, 1, 0, 1, 0,
    ]);
    expect(spec.config?.layoutHints?.leftYAxisLabelWidth).toBeGreaterThanOrEqual(65);
  });

  it('reserves enough y-axis margin for long imported category labels with chart fonts', () => {
    const longLabelData: ChartData = {
      categories: ['13.5% - 15.5% Discount Rate, 2.0% - 4.0% Terminal FCF Growth Rate:'],
      series: [
        {
          name: 'Visible',
          data: [{ x: '13.5% - 15.5% Discount Rate, 2.0% - 4.0% Terminal FCF Growth Rate:', y: 1 }],
        },
      ],
    };
    const importedConfig: ChartConfig = {
      type: 'bar',
      anchorRow: 0,
      anchorCol: 0,
      width: TEST_CHART_WIDTH_PT,
      height: TEST_CHART_HEIGHT_PT,
      axis: {
        categoryAxis: {
          visible: true,
          format: {
            font: {
              name: '+mn-lt',
              size: 12,
            },
          },
        },
      },
    };

    const spec = asUnitSpec(configToSpec(importedConfig, longLabelData));

    expect(spec.config?.layoutHints?.yAxisLabelWidth).toBeGreaterThan(540);
  });
});
