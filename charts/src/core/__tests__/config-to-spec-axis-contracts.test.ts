import type { LayerSpec, UnitSpec } from '../../grammar/spec';
import type { PathMark, RectMark, TextMark } from '../../primitives/types';
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
  return axisTextMarks(result, role, 'label').map((mark) => mark.text);
}

function axisTextMarks(
  result: ReturnType<typeof compile>,
  role: string,
  axisPart: string,
): Array<Extract<(typeof result.axes)[number], { type: 'text' }>> {
  return result.axes.filter(
    (mark): mark is Extract<(typeof result.axes)[number], { type: 'text' }> => {
      const datum = mark.datum as Record<string, unknown> | undefined;
      return mark.type === 'text' && datum?.role === role && datum.axisPart === axisPart;
    },
  );
}

function axisLabels(result: ReturnType<typeof compile>, role: string): TextMark[] {
  return result.axes.filter((mark): mark is TextMark => {
    const datum = mark.datum as Record<string, unknown> | undefined;
    return mark.type === 'text' && datum?.role === role && datum.axisPart === 'label';
  });
}

function axisDomain(result: ReturnType<typeof compile>, role: string): PathMark | undefined {
  return result.axes.find((mark): mark is PathMark => {
    const datum = mark.datum as Record<string, unknown> | undefined;
    return mark.type === 'path' && datum?.role === role && datum.axisPart === 'domain';
  });
}

function horizontalPathY(path: string): number {
  const match = /^M[^,]+,([^ ]+) L/.exec(path);
  if (!match) throw new Error(`Unexpected horizontal path: ${path}`);
  return Number(match[1]);
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
          data: [191, 164, 164, 144, 115, 152, 144, 112, 128, 100, 101].map((value, index) => ({
            x: `Stage ${index + 1}`,
            y: value,
          })),
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

  it('keeps diverging horizontal bar category labels at zero while placing the y-axis title outside the plot', () => {
    const categories = ['Segment A', 'Segment B', 'Segment C'];
    const data: ChartData = {
      categories,
      series: [
        {
          name: 'Left',
          data: categories.map((category, index) => ({ x: category, y: -(index + 2) })),
        },
        {
          name: 'Right',
          data: categories.map((category, index) => ({ x: category, y: index + 3 })),
        },
      ],
    };
    const spec = asUnitSpec(
      {
        type: 'bar',
        subType: 'clustered',
        anchorRow: 0,
        anchorCol: 0,
        width: 12,
        height: 7,
        axis: {
          categoryAxis: {
            visible: true,
            title: 'Category Axis',
            position: 'l',
            crossesAt: 'automatic',
          },
          valueAxis: { visible: true, crossesAt: 'automatic' },
        },
      } as ChartConfig,
      data,
    );

    expect(spec.config?.layoutHints?.yAxisLabelsInsidePlot).toBe(true);
    const result = compile(spec, undefined, { width: 800, height: 480 });
    const labels = axisTextMarks(result, 'y-axis', 'label');
    const title = axisTextMarks(result, 'y-axis', 'title')[0];

    expect(result.layout.margin.left).toBe(50);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => label.x > result.layout.plotArea.x)).toBe(true);
    expect(title).toBeDefined();
    expect(title!.x).toBeLessThan(result.layout.plotArea.x);
  });

  it('still reserves left margin for positive horizontal bar category labels outside the plot', () => {
    const categories = ['Segment A', 'Segment B', 'Segment C'];
    const data: ChartData = {
      categories,
      series: [
        {
          name: 'Right',
          data: categories.map((category, index) => ({ x: category, y: index + 3 })),
        },
      ],
    };
    const spec = asUnitSpec(
      {
        type: 'bar',
        subType: 'clustered',
        anchorRow: 0,
        anchorCol: 0,
        width: 12,
        height: 7,
        axis: {
          categoryAxis: {
            visible: true,
            title: 'Category Axis',
            position: 'l',
            crossesAt: 'automatic',
          },
          valueAxis: { visible: true, crossesAt: 'automatic' },
        },
      } as ChartConfig,
      data,
    );

    expect(spec.config?.layoutHints?.yAxisLabelsInsidePlot).toBeUndefined();
    const result = compile(spec, undefined, { width: 800, height: 480 });
    const labels = axisTextMarks(result, 'y-axis', 'label');

    expect(result.layout.margin.left).toBeGreaterThan(100);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => label.x < result.layout.plotArea.x)).toBe(true);
  });

  it('keeps mixed-sign column category labels at zero while placing the x-axis title outside the plot', () => {
    const categories = ['Segment A', 'Segment B', 'Segment C'];
    const data: ChartData = {
      categories,
      series: [
        {
          name: 'Delta',
          data: categories.map((category, index) => ({
            x: category,
            y: index === 1 ? -4 : index + 2,
          })),
        },
      ],
    };
    const spec = asUnitSpec(
      {
        type: 'column',
        subType: 'clustered',
        anchorRow: 0,
        anchorCol: 0,
        width: 12,
        height: 7,
        axis: {
          categoryAxis: {
            visible: true,
            title: 'Category Axis',
            position: 'b',
            crossesAt: 'automatic',
          },
          valueAxis: { visible: true, crossesAt: 'automatic' },
        },
      } as ChartConfig,
      data,
    );

    expect(spec.config?.layoutHints?.xAxisLabelsInsidePlot).toBe(true);
    const result = compile(spec, undefined, { width: 800, height: 480 });
    const labels = axisTextMarks(result, 'x-axis', 'label');
    const title = axisTextMarks(result, 'x-axis', 'title')[0];
    const plotBottom = result.layout.plotArea.y + result.layout.plotArea.height;

    expect(result.layout.margin.bottom).toBeGreaterThanOrEqual(24);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => label.y < plotBottom)).toBe(true);
    expect(title).toBeDefined();
    expect(title!.y).toBeGreaterThan(plotBottom);
  });

  it('honors explicit imported primary bounds in a dual-axis column-line combo', () => {
    const categories = [
      'slot-01',
      'slot-02',
      'slot-03',
      'slot-04',
      'slot-05',
      'slot-06',
      'slot-07',
      'slot-08',
      'slot-09',
      'slot-10',
      'slot-11',
      'slot-12',
      'slot-13',
      'slot-14',
      'slot-15',
    ];
    const primaryValues = [
      29.8, 30.1, 30.4, 30.7, 31, 31.2, 31.4, 31.6, 31.7, 31.8, 31.9, 32, 32.1, 32.2, 32.3,
    ];
    const secondaryValues = [
      327, 495, 485, 486, 612, 575, 503, 498, 517, 540, 522, 558, 571, 599, 615,
    ];
    const data: ChartData = {
      categories,
      series: [
        {
          name: 'Synthetic primary series',
          data: categories.map((x, index) => ({ x, y: primaryValues[index] })),
        },
        {
          name: 'Synthetic secondary series',
          yAxisIndex: 1,
          data: categories.map((x, index) => ({ x, y: secondaryValues[index] })),
        },
      ],
    };
    const spec = asLayerSpec(
      {
        type: 'combo',
        subType: 'clustered',
        anchorRow: 0,
        anchorCol: 0,
        width: 20,
        height: 10,
        axis: {
          categoryAxis: { visible: true, title: 'Synthetic category' },
          valueAxis: {
            visible: true,
            title: 'Synthetic primary axis',
            min: 29,
            max: 33,
            majorUnit: 1,
            gridLines: true,
          },
          secondaryValueAxis: {
            visible: true,
            position: 'r',
          },
        },
        series: [
          { name: 'Synthetic primary series', type: 'column' },
          { name: 'Synthetic secondary series', type: 'line', yAxisIndex: 1 },
        ],
      } as ChartConfig,
      data,
    );

    expect(spec.layer[0]?.encoding?.y?.scale).toMatchObject({
      domain: [29, 33],
      nice: false,
    });
    expect(spec.layer[0]?.encoding?.y?.scale).not.toHaveProperty('zero');
    expect(spec.layer[1]?.encoding?.y?.scale).toMatchObject({
      domain: [0, 700],
      nice: false,
      zero: true,
    });
    expect(spec.layer[1]?.encoding?.y?.axis).toMatchObject({ tickStep: 100 });

    const result = compile(spec, undefined, { width: 1454, height: 724 });

    expect(result.scales.y?.domain?.()).toEqual([29, 33]);
    expect(axisLabelTexts(result, 'y-axis')).toEqual(['29', '30', '31', '32', '33']);
    expect(axisLabelTexts(result, 'y-axis-right')).toEqual([
      '0',
      '100',
      '200',
      '300',
      '400',
      '500',
      '600',
      '700',
    ]);
  });

  it('uses Mog auto value-axis domains and primary-zero crossing for dual-axis column-line combos', () => {
    const categories = ['Period 1', 'Period 2', 'Period 3', 'Period 4', 'Period 5'];
    const primaryValues = [118, -176, 182, -207, 64];
    const secondaryValues = [1_110, 948, 1_388, 972, 1_264];
    const data: ChartData = {
      categories,
      series: [
        {
          name: 'Delta count',
          data: categories.map((x, index) => ({ x, y: primaryValues[index] })),
        },
        {
          name: 'Running total',
          yAxisIndex: 1,
          data: categories.map((x, index) => ({ x, y: secondaryValues[index] })),
        },
      ],
    };
    const spec = asLayerSpec(
      {
        type: 'combo',
        subType: 'clustered',
        anchorRow: 0,
        anchorCol: 0,
        width: 20,
        height: 10,
        axis: {
          categoryAxis: { visible: true, title: 'Period' },
          valueAxis: { visible: true, title: 'Delta count' },
          secondaryValueAxis: {
            visible: true,
            position: 'r',
            crossesAt: 'max',
            numberFormat: '#,##0',
          },
        },
        series: [
          {
            name: 'Delta count',
            type: 'column',
            color: '059669',
            invertIfNegative: true,
            format: {
              fill: { type: 'solid', color: '059669' },
              line: { color: '065F46' },
            },
          },
          {
            name: 'Running total',
            type: 'line',
            yAxisIndex: 1,
            showMarkers: true,
          },
        ],
      } as ChartConfig,
      data,
    );

    expect(spec.layer[0]?.encoding?.y?.scale).toMatchObject({
      domain: [-250, 200],
      nice: false,
    });
    expect(spec.layer[0]?.encoding?.y?.axis).toMatchObject({ tickStep: 50 });
    expect(spec.layer[1]?.encoding?.y?.scale).toMatchObject({
      domain: [0, 1600],
      nice: false,
    });
    expect(spec.layer[1]?.encoding?.y?.axis).toMatchObject({ tickStep: 200 });

    const result = compile(spec, undefined, { width: 1454, height: 724 });
    expect(axisLabelTexts(result, 'y-axis')).toEqual([
      '-250',
      '-200',
      '-150',
      '-100',
      '-50',
      '0',
      '50',
      '100',
      '150',
      '200',
    ]);
    expect(axisLabelTexts(result, 'y-axis-right')).toEqual([
      '0',
      '200',
      '400',
      '600',
      '800',
      '1,000',
      '1,200',
      '1,400',
      '1,600',
    ]);

    const xDomain = axisDomain(result, 'x-axis');
    const primaryZero = axisLabels(result, 'y-axis').find((label) => label.text === '0');
    expect(xDomain).toBeDefined();
    expect(primaryZero).toBeDefined();
    expect(horizontalPathY(xDomain!.path)).toBeCloseTo(primaryZero!.y, 6);

    const negativeBars = result.marks.filter((mark): mark is RectMark => {
      const datum = mark.datum as { series?: string; value?: number } | undefined;
      return mark.type === 'rect' && datum?.series === 'Delta count' && Number(datum.value) < 0;
    });
    expect(negativeBars).toHaveLength(2);
    expect(negativeBars.map((bar) => bar.style.fill)).toEqual(['#FFFFFF', '#FFFFFF']);
    expect(negativeBars.map((bar) => bar.style.stroke)).toEqual(['#065F46', '#065F46']);
  });
});
