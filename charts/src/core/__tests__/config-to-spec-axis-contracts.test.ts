import type { UnitSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';

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
});
