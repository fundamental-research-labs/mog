import type { PathMark, RectMark, TextMark } from '../../primitives/types';
import { compile } from '../../grammar/compiler';
import { isLayerSpec, type ChartSpec, type LayerSpec, type UnitSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartType } from '../../types';
import { configToSpec } from '../config-to-spec';

const DATE_SERIALS = [45292, 45322, 45352];
type AxisWithTickStep = { tickStep?: number };

function makeData(seriesCount = 1): ChartData {
  return {
    categories: DATE_SERIALS,
    series: Array.from({ length: seriesCount }, (_, seriesIndex) => ({
      name: `Series ${seriesIndex + 1}`,
      data: DATE_SERIALS.map((serial, pointIndex) => ({
        x: serial,
        y: (seriesIndex + 1) * (pointIndex + 1),
      })),
    })),
  };
}

function makeDateAxisConfig(type: ChartType, seriesCount = 1): ChartConfig {
  return {
    type,
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 5,
    axis: {
      categoryAxis: {
        visible: true,
        axisType: 'dateAx',
        min: DATE_SERIALS[0],
        max: DATE_SERIALS[2],
        majorUnit: 30,
        numberFormat: 'm/d/yyyy',
      },
      valueAxis: {
        visible: true,
      },
    },
    series:
      type === 'combo'
        ? Array.from({ length: seriesCount }, (_, index) => ({
            name: `Series ${index + 1}`,
            type: index === 0 ? 'bar' : 'line',
          }))
        : undefined,
  };
}

function asUnitSpec(spec: ChartSpec): UnitSpec {
  expect(isLayerSpec(spec)).toBe(false);
  return spec as UnitSpec;
}

function asLayerSpec(spec: ChartSpec): LayerSpec {
  expect(isLayerSpec(spec)).toBe(true);
  return spec as LayerSpec;
}

function inlineRows(spec: ChartSpec) {
  expect(spec.data).toBeDefined();
  expect('values' in spec.data!).toBe(true);
  return 'values' in spec.data! ? spec.data.values : [];
}

function xAxisLabels(spec: ChartSpec): string[] {
  const result = compile(spec);
  return result.axes
    .filter((mark): mark is TextMark => {
      const datum = mark.datum as { role?: string; axisPart?: string } | undefined;
      return mark.type === 'text' && datum?.role === 'x-axis' && datum.axisPart === 'label';
    })
    .map((mark) => mark.text);
}

describe('configToSpec imported Excel date category axes', () => {
  it('uses a continuous date-serial x scale for imported line charts', () => {
    const spec = asUnitSpec(configToSpec(makeDateAxisConfig('line'), makeData()));

    expect(inlineRows(spec)[0].category).toBe(DATE_SERIALS[0]);
    expect(spec.encoding?.x).toMatchObject({
      field: 'category',
      type: 'quantitative',
      scale: {
        type: 'linear',
        domain: [DATE_SERIALS[0], DATE_SERIALS[2]],
        zero: false,
        nice: false,
      },
      axis: {
        format: 'm/d/yyyy',
        formatType: 'time',
      },
    });
    expect((spec.encoding?.x?.axis as AxisWithTickStep | undefined)?.tickStep).toBe(30);

    const result = compile(spec);
    expect(result.scales.x?.bandwidth).toBeUndefined();
    expect(result.scales.x?.(DATE_SERIALS[0]) as number).toBeLessThan(
      result.scales.x?.(DATE_SERIALS[1]) as number,
    );
    expect(xAxisLabels(spec)).toEqual(
      expect.arrayContaining(['1/1/2024', '1/31/2024', '3/1/2024']),
    );
  });

  it('uses the same continuous date category semantics for area charts', () => {
    const spec = asUnitSpec(configToSpec(makeDateAxisConfig('area'), makeData()));

    expect(inlineRows(spec)[1].category).toBe(DATE_SERIALS[1]);
    expect(spec.encoding?.x?.type).toBe('quantitative');
    expect(spec.encoding?.x?.scale).toMatchObject({ type: 'linear', zero: false, nice: false });

    const result = compile(spec);
    expect(result.scales.x?.bandwidth).toBeUndefined();
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('propagates date category axes into combo chart layers', () => {
    const spec = asLayerSpec(configToSpec(makeDateAxisConfig('combo', 2), makeData(2)));

    expect(inlineRows(spec)[0].category).toBe(DATE_SERIALS[0]);
    expect(spec.layer[0].encoding?.x).toMatchObject({
      field: 'category',
      type: 'quantitative',
      scale: {
        type: 'linear',
        domain: [DATE_SERIALS[0], DATE_SERIALS[2]],
        zero: false,
        nice: false,
      },
      axis: {
        formatType: 'time',
      },
    });
    expect((spec.layer[0].encoding?.x?.axis as AxisWithTickStep | undefined)?.tickStep).toBe(30);
    expect(spec.layer[1].encoding?.x?.type).toBe('quantitative');

    const result = compile(spec);
    expect(result.scales.x?.bandwidth).toBeUndefined();
    expect(xAxisLabels(spec)).toEqual(
      expect.arrayContaining(['1/1/2024', '1/31/2024', '3/1/2024']),
    );
  });

  it('maps imported vertical chart text orientation and reserves bottom label space', () => {
    const config = makeDateAxisConfig('line');
    config.height = 16;
    config.axis = {
      ...config.axis,
      categoryAxis: {
        ...config.axis?.categoryAxis,
        textOrientation: -1000,
        format: { font: { size: 20 } },
      },
    };

    const spec = asUnitSpec(configToSpec(config, makeData()));
    const result = compile(spec);
    const xAxisLabels = result.axes.filter((mark): mark is TextMark => {
      const datum = mark.datum as { role?: string; axisPart?: string } | undefined;
      return mark.type === 'text' && datum?.role === 'x-axis' && datum.axisPart === 'label';
    });

    expect(spec.encoding?.x?.axis).toMatchObject({ labelAngle: -90 });
    expect(xAxisLabels.every((mark) => mark.rotation === -Math.PI / 2)).toBe(true);
    expect(result.layout.margin.bottom).toBeGreaterThanOrEqual(160);
  });

  it('reserves enough left margin for large imported currency axis labels', () => {
    const config = makeDateAxisConfig('line');
    config.axis = {
      ...config.axis,
      valueAxis: {
        visible: true,
        min: 0,
        max: 50_000_000,
        numberFormat: '"$"#,##0',
        tickMarks: 'none',
        format: { font: { size: 20 } },
      },
    };

    const spec = asUnitSpec(configToSpec(config, makeData()));
    const result = compile(spec);

    expect(result.layout.margin.left).toBeGreaterThanOrEqual(300);
  });

  it('uses independent y scales for combo series bound to a secondary axis', () => {
    const data: ChartData = {
      categories: DATE_SERIALS,
      series: [
        {
          name: 'Dollars',
          data: DATE_SERIALS.map((serial, pointIndex) => ({
            x: serial,
            y: 20_000_000 + pointIndex * 5_000_000,
          })),
        },
        {
          name: 'Percent',
          yAxisIndex: 1,
          data: DATE_SERIALS.map((serial, pointIndex) => ({
            x: serial,
            y: -0.1 + pointIndex * 0.15,
          })),
        },
      ],
    };
    const config = makeDateAxisConfig('combo', 2);
    config.height = 20;
    config.axis = {
      ...config.axis,
      valueAxis: {
        visible: true,
        min: 0,
        max: 50_000_000,
      },
      secondaryValueAxis: {
        visible: true,
        min: -0.2,
        max: 0.3,
        numberFormat: '0%',
      },
    };
    config.series = [
      { name: 'Dollars', type: 'line' },
      { name: 'Percent', type: 'column', yAxisIndex: 1 },
    ];

    const spec = asLayerSpec(configToSpec(config, data));

    expect(spec.resolve).toMatchObject({
      scale: { y: 'independent' },
      axis: { y: 'independent' },
    });
    expect(spec.layer[1].encoding?.y?.scale).toMatchObject({
      domain: [-0.2, 0.3],
      nice: false,
    });

    const result = compile(spec);
    const secondaryBars = result.marks.filter((mark): mark is RectMark => {
      const datum = mark.datum as { series?: string } | undefined;
      return mark.type === 'rect' && datum?.series === 'Percent';
    });

    expect(secondaryBars.length).toBeGreaterThan(0);
    expect(Math.max(...secondaryBars.map((mark) => mark.height))).toBeGreaterThanOrEqual(20);

    const rightAxisLabels = result.axes
      .filter((mark): mark is TextMark => {
        const datum = mark.datum as { role?: string; axisPart?: string } | undefined;
        return mark.type === 'text' && datum?.role === 'y-axis-right' && datum.axisPart === 'label';
      })
      .map((mark) => mark.text);
    expect(rightAxisLabels).toContain('30%');
    expect(rightAxisLabels).toContain('-20%');
    expect(rightAxisLabels).not.toContain('35%');
  });

  it('uses layered right-axis rendering for non-combo charts with secondary series', () => {
    const data: ChartData = {
      categories: DATE_SERIALS,
      series: [
        {
          name: 'Primary',
          data: DATE_SERIALS.map((serial, pointIndex) => ({
            x: serial,
            y: 1_000_000 + pointIndex * 500_000,
          })),
        },
        {
          name: 'Secondary',
          yAxisIndex: 1,
          data: DATE_SERIALS.map((serial, pointIndex) => ({
            x: serial,
            y: 8_000_000 + pointIndex * 2_000_000,
          })),
        },
      ],
    };
    const config = makeDateAxisConfig('line', 2);
    config.height = 12;
    config.axis = {
      ...config.axis,
      valueAxis: {
        visible: true,
        numberFormat: '$#,##0',
      },
      secondaryYAxis: {
        visible: true,
        numberFormat: '$#,##0',
      },
    };
    config.legend = {
      show: true,
      visible: true,
      position: 'bottom',
    };
    config.series = [
      {
        name: 'Primary',
        type: 'line',
        format: { line: { color: { theme: 'accent3' }, width: 2.25 } },
      },
      {
        name: 'Secondary',
        type: 'line',
        yAxisIndex: 1,
        format: { line: { color: { theme: 'accent2' }, width: 2.25 } },
      },
    ];

    const spec = asLayerSpec(configToSpec(config, data));

    expect(spec.resolve).toMatchObject({
      scale: { y: 'independent' },
      axis: { y: 'independent' },
    });
    expect(spec.layer[1].encoding?.y?.axis).toMatchObject({
      orient: 'right',
      format: '$#,##0',
    });
    expect(spec.layer[0].encoding?.color?.scale).toMatchObject({
      range: ['#A5A5A5', '#ED7D31'],
    });
    expect(spec.layer[0].encoding?.color?.legend).toMatchObject({
      symbolType: 'line',
    });

    const result = compile(spec);
    const rightAxisLabels = result.axes.filter((mark): mark is TextMark => {
      const datum = mark.datum as { role?: string; axisPart?: string } | undefined;
      return mark.type === 'text' && datum?.role === 'y-axis-right' && datum.axisPart === 'label';
    });
    const lineMarks = result.marks.filter((mark): mark is PathMark => {
      const datum = mark.datum as Array<{ series?: string }> | undefined;
      return mark.type === 'path' && Array.isArray(datum) && Boolean(datum[0]?.series);
    });
    const legendLabels = result.legends.filter((mark): mark is TextMark => mark.type === 'text');
    const legendSymbols = result.legends.filter((mark): mark is PathMark => mark.type === 'path');

    expect(rightAxisLabels.length).toBeGreaterThan(0);
    expect(lineMarks.map((mark) => mark.style.stroke)).toEqual(['#A5A5A5', '#ED7D31']);
    expect(legendSymbols.map((mark) => mark.style.stroke)).toEqual(['#A5A5A5', '#ED7D31']);
    expect(legendLabels.map((mark) => mark.text)).toEqual(['Primary', 'Secondary']);
    expect(new Set(legendLabels.map((mark) => mark.y)).size).toBe(1);
    expect(Math.min(...legendLabels.map((mark) => mark.y))).toBeGreaterThan(
      result.layout.plotArea.y + result.layout.plotArea.height,
    );
  });

  it('keeps ordinary string category charts on nominal band scales', () => {
    const data: ChartData = {
      categories: ['Jan', 'Feb', 'Mar'],
      series: [
        {
          name: 'Series 1',
          data: [
            { x: 'Jan', y: 1 },
            { x: 'Feb', y: 2 },
            { x: 'Mar', y: 3 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      axis: {
        categoryAxis: {
          visible: true,
          axisType: 'catAx',
        },
      },
    };

    const spec = asUnitSpec(configToSpec(config, data));

    expect(inlineRows(spec)[0].category).toBe('Jan');
    expect(spec.encoding?.x?.type).toBe('nominal');
    expect(compile(spec).scales.x?.bandwidth).toEqual(expect.any(Function));
  });

  it('omits blank points from grammar rows when imported charts use gap blanks', () => {
    const data: ChartData = {
      categories: ['A', 'B', 'C'],
      series: [
        {
          name: 'Series 1',
          data: [
            { x: 'A', y: 1 },
            { x: 'B', y: 0, valueState: 'blank' },
            { x: 'C', y: 2 },
          ],
        },
      ],
    };

    const gapSpec = asUnitSpec(
      configToSpec(
        { type: 'line', anchorRow: 0, anchorCol: 0, width: 8, height: 5, displayBlanksAs: 'gap' },
        data,
      ),
    );
    const zeroSpec = asUnitSpec(
      configToSpec(
        { type: 'line', anchorRow: 0, anchorCol: 0, width: 8, height: 5, displayBlanksAs: 'zero' },
        data,
      ),
    );

    expect(inlineRows(gapSpec).map((row) => row.category)).toEqual(['A', 'C']);
    expect(inlineRows(zeroSpec).map((row) => row.category)).toEqual(['A', 'B', 'C']);
  });
});
