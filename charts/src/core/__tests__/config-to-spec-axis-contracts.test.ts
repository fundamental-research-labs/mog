import type { LayerSpec, UnitSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';
import { compile } from '../../grammar/compiler';

function makeData(): ChartData {
  return {
    categories: ['A', 'B', 'C', 'D'],
    series: [
      {
        name: 'Revenue',
        data: [
          { x: 'A', y: 1_000 },
          { x: 'B', y: 2_000 },
          { x: 'C', y: 4_000 },
          { x: 'D', y: 8_000 },
        ],
      },
    ],
  };
}

function asUnitSpec(config: ChartConfig, data = makeData()): UnitSpec {
  return configToSpec(config, data) as UnitSpec;
}

function asLayerSpec(config: ChartConfig, data = makeData()): LayerSpec {
  return configToSpec(config, data) as LayerSpec;
}

function axisLabelTexts(result: ReturnType<typeof compile>, role: string): string[] {
  return result.axes
    .filter((mark) => {
      const datum = mark.datum as Record<string, unknown> | undefined;
      return mark.type === 'text' && datum?.role === role && datum.axisPart === 'label';
    })
    .map((mark) => (mark.type === 'text' ? mark.text : ''));
}

describe('configToSpec axis render contracts', () => {
  it('lowers secondary category axes onto a shared top x-axis', () => {
    const spec = asUnitSpec({
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      axis: {
        categoryAxis: { visible: true },
        secondaryCategoryAxis: {
          visible: true,
          title: 'Top Categories',
          position: 't',
          tickLabelPosition: 'high',
          tickLabelSpacing: 2,
          tickMarkSpacing: 3,
        },
        valueAxis: { visible: true },
      },
    } as ChartConfig);

    expect(spec.encoding?.x?.secondaryAxis).toMatchObject({
      orient: 'top',
      title: 'Top Categories',
      labelPosition: 'high',
      tickLabelSkip: 2,
      tickMarkSkip: 3,
    });
  });

  it('resolves secondary category axis styles with workbook theme context', () => {
    const spec = asUnitSpec({
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      workbookTheme: {
        colors: [{ name: 'accent1', color: '#123456' }],
        colorScheme: {
          accent1: { type: 'SrgbClr', val: '123456', transforms: [] },
        },
      },
      axis: {
        categoryAxis: { visible: true },
        secondaryCategoryAxis: {
          visible: true,
          title: 'Themed Top Axis',
          position: 't',
          format: {
            font: {
              color: { theme: 'accent1' },
            },
          },
          titleFormat: {
            font: {
              color: { theme: 'accent1' },
            },
          },
          gridlineFormat: {
            color: { theme: 'accent1' },
          },
        },
        valueAxis: { visible: true },
      },
    } as ChartConfig);

    expect(spec.encoding?.x?.secondaryAxis).toMatchObject({
      orient: 'top',
      title: 'Themed Top Axis',
      labelColor: '#123456',
      titleColor: '#123456',
      gridColor: '#123456',
    });
  });

  it('lowers log scales, value units, display units, and minor streams', () => {
    const spec = asUnitSpec({
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      axis: {
        categoryAxis: { visible: true },
        valueAxis: {
          visible: true,
          scaleType: 'logarithmic',
          logBase: 2,
          min: 1,
          max: 8192,
          majorUnit: 1024,
          minorUnit: 512,
          displayUnit: 'thousands',
          displayUnitLabel: 'Thousands',
          minorGridLines: true,
          minorGridlineFormat: { color: '#ff0000', width: 1 },
          tickMarks: 'in',
          minorTickMarks: 'cross',
          crossBetween: 'midCat',
        },
      },
    } as ChartConfig);

    expect(spec.encoding?.y?.scale).toMatchObject({
      type: 'log',
      base: 2,
      domain: [1, 8192],
      nice: false,
    });
    expect(spec.encoding?.y?.axis).toMatchObject({
      tickStep: 1024,
      minorTickStep: 512,
      displayUnitFactor: 1_000,
      displayUnitLabel: 'Thousands',
      minorGrid: true,
      minorGridColor: '#ff0000',
      tickMark: 'in',
      minorTickMark: 'cross',
      minorTicks: true,
      categoryCrossing: 'midCat',
    });
  });

  it('lowers reversed axes onto primary, date-serial, horizontal, and secondary scales', () => {
    const primarySpec = asUnitSpec({
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      axis: {
        categoryAxis: { visible: true, reverse: true },
        valueAxis: { visible: true, reverse: true },
      },
    } as ChartConfig);

    expect(primarySpec.encoding?.x?.scale).toMatchObject({ reverse: true });
    expect(primarySpec.encoding?.y?.scale).toMatchObject({ reverse: true });

    const dateData: ChartData = {
      categories: [45_000, 45_001, 45_002],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 45_000, y: 1_000 },
            { x: 45_001, y: 2_000 },
            { x: 45_002, y: 4_000 },
          ],
        },
      ],
    };
    const dateSpec = asUnitSpec(
      {
        type: 'line',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 5,
        axis: {
          categoryAxis: { visible: true, categoryType: 'dateAxis', reverse: true },
          valueAxis: { visible: true },
        },
      } as ChartConfig,
      dateData,
    );

    expect(dateSpec.encoding?.x?.scale).toMatchObject({
      type: 'linear',
      zero: false,
      nice: false,
      reverse: true,
    });

    const horizontalSpec = asUnitSpec({
      type: 'bar',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      axis: {
        categoryAxis: { visible: true, reverse: true },
        valueAxis: { visible: true },
      },
    } as ChartConfig);

    expect(horizontalSpec.encoding?.y?.scale).toMatchObject({ reverse: true });

    const comboData: ChartData = {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 'A', y: 1_000 },
            { x: 'B', y: 2_000 },
          ],
        },
        {
          name: 'Margin',
          yAxisIndex: 1,
          data: [
            { x: 'A', y: 0.1 },
            { x: 'B', y: 0.2 },
          ],
        },
      ],
    };
    const comboSpec = asLayerSpec(
      {
        type: 'combo',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 5,
        axis: {
          categoryAxis: { visible: true },
          valueAxis: { visible: true },
          secondaryValueAxis: { visible: true, reverse: true },
        },
        series: [
          { name: 'Revenue', type: 'column' },
          { name: 'Margin', type: 'line', yAxisIndex: 1 },
        ],
      } as ChartConfig,
      comboData,
    );

    expect(comboSpec.layer[1]?.encoding?.y?.scale).toMatchObject({ reverse: true });
  });

  it('maps tick label position none to hidden labels', () => {
    const spec = asUnitSpec({
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      axis: {
        categoryAxis: { visible: true, tickLabelPosition: 'none' },
        valueAxis: { visible: true },
      },
    } as ChartConfig);

    expect(spec.encoding?.x?.axis).toMatchObject({
      labelPosition: 'none',
      labels: false,
    });
  });

  it('uses Mog auto value-axis tick density for imported horizontal bar charts', () => {
    const data: ChartData = {
      categories: [
        'Stage 1',
        'Stage 2',
        'Stage 3',
        'Stage 4',
        'Stage 5',
        'Stage 6',
        'Stage 7',
        'Stage 8',
        'Stage 9',
        'Stage 10',
        'Stage 11',
      ],
      series: [
        {
          name: 'Count',
          data: [191, 164, 164, 144, 115, 152, 144, 112, 128, 100, 101].map(
            (value, index) => ({ x: `Stage ${index + 1}`, y: value }),
          ),
        },
      ],
    };
    const spec = configToSpec(
      {
        type: 'bar',
        subType: 'clustered',
        anchorRow: 0,
        anchorCol: 0,
        width: 20,
        height: 10,
        axis: {
          categoryAxis: { visible: true },
          valueAxis: { visible: true },
        },
        dataLabels: {
          show: true,
          showValue: true,
          position: 'bestFit',
        },
      } as ChartConfig,
      data,
    );

    const result = compile(spec, undefined, { width: 1526, height: 706 });

    expect(result.scales.x?.domain?.()).toEqual([0, 250]);
    expect(axisLabelTexts(result, 'x-axis')).toEqual(['0', '50', '100', '150', '200', '250']);
  });

  it('uses the same Mog auto value-axis tick density for vertical columns', () => {
    const data: ChartData = {
      categories: ['A', 'B', 'C'],
      series: [
        {
          name: 'Count',
          data: [
            { x: 'A', y: 191 },
            { x: 'B', y: 164 },
            { x: 'C', y: 100 },
          ],
        },
      ],
    };
    const spec = configToSpec(
      {
        type: 'column',
        subType: 'clustered',
        anchorRow: 0,
        anchorCol: 0,
        width: 12,
        height: 8,
        axis: {
          categoryAxis: { visible: true },
          valueAxis: { visible: true },
        },
        dataLabels: {
          show: true,
          showValue: true,
          position: 'outsideEnd',
        },
      } as ChartConfig,
      data,
    );

    const result = compile(spec, undefined, { width: 800, height: 480 });

    expect(result.scales.y?.domain?.()).toEqual([0, 250]);
    expect(axisLabelTexts(result, 'y-axis')).toEqual(['0', '50', '100', '150', '200', '250']);
  });
});
