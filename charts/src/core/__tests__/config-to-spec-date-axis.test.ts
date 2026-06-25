import type { PathMark, RectMark, TextMark } from '../../primitives/types';
import { compile } from '../../grammar/compiler';
import { isLayerSpec, type ChartSpec, type LayerSpec, type UnitSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartType } from '../../types';
import { configToSpec } from '../config-to-spec';
import { SERIES_INDEX_FIELD } from '../config-to-spec/fields';

const DATE_SERIALS = [45292, 45322, 45352];
type AxisWithTicks = { tickStep?: number; tickInterval?: { unit: string; step: number } };

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
    width: 480,
    height: 75,
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

function pathYCoordinates(path: string): number[] {
  const coordinates = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return coordinates.filter((_, index) => index % 2 === 1);
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
    expect((spec.encoding?.x?.axis as AxisWithTicks | undefined)?.tickStep).toBe(30);

    const result = compile(spec);
    expect(result.scales.x?.bandwidth).toBeUndefined();
    expect(result.scales.x?.(DATE_SERIALS[0]) as number).toBeLessThan(
      result.scales.x?.(DATE_SERIALS[1]) as number,
    );
    expect(xAxisLabels(spec)).toEqual(
      expect.arrayContaining(['1/1/2024', '1/31/2024', '3/1/2024']),
    );
  });

  it('uses calendar-aware imported month major units for date axes', () => {
    const data = makeData();
    const config = makeDateAxisConfig('line');
    config.axis = {
      ...config.axis,
      categoryAxis: {
        ...config.axis?.categoryAxis,
        min: 45292,
        max: 45658,
        majorUnit: 2,
        baseTimeUnit: 'months',
        majorTimeUnit: 'months',
      },
    };
    data.categories = [45292, 45352, 45413, 45474, 45535, 45596, 45658];
    data.series[0]!.data = data.categories.map((serial, index) => ({ x: serial, y: index + 1 }));

    const spec = asUnitSpec(configToSpec(config, data));
    const axis = spec.encoding?.x?.axis as AxisWithTicks | undefined;

    expect(axis?.tickStep).toBeUndefined();
    expect(axis?.tickInterval).toEqual({ unit: 'month', step: 2 });
    expect(xAxisLabels(spec)).toEqual([
      '1/1/2024',
      '3/1/2024',
      '5/1/2024',
      '7/1/2024',
      '9/1/2024',
      '11/1/2024',
      '1/1/2025',
    ]);
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
    expect((spec.layer[0].encoding?.x?.axis as AxisWithTicks | undefined)?.tickStep).toBe(30);
    expect(spec.layer[1].encoding?.x?.type).toBe('quantitative');

    const result = compile(spec);
    expect(result.scales.x?.bandwidth).toBeUndefined();
    expect(xAxisLabels(spec)).toEqual(
      expect.arrayContaining(['1/1/2024', '1/31/2024', '3/1/2024']),
    );
  });

  it('maps imported chart text rotation when vertical text mode is horizontal', () => {
    const config = makeDateAxisConfig('line');
    config.height = 240;
    config.axis = {
      ...config.axis,
      categoryAxis: {
        ...config.axis?.categoryAxis,
        format: { font: { size: 20 }, textRotation: -45, textVerticalType: 'horz' },
      },
    };

    const spec = asUnitSpec(configToSpec(config, makeData()));
    const result = compile(spec);
    const xAxisLabels = result.axes.filter((mark): mark is TextMark => {
      const datum = mark.datum as { role?: string; axisPart?: string } | undefined;
      return mark.type === 'text' && datum?.role === 'x-axis' && datum.axisPart === 'label';
    });

    expect(spec.encoding?.x?.axis).toMatchObject({ labelAngle: -45 });
    expect(xAxisLabels.every((mark) => mark.rotation === -Math.PI / 4)).toBe(true);
    expect(result.layout.margin.bottom).toBeGreaterThan(50);
  });

  it('ignores out-of-range imported chart text rotations', () => {
    const config = makeDateAxisConfig('line');
    config.height = 240;
    config.axis = {
      ...config.axis,
      categoryAxis: {
        ...config.axis?.categoryAxis,
        textOrientation: -1000,
        format: { font: { size: 20 }, textRotation: -1000, textVerticalType: 'horz' },
      },
    };

    const spec = asUnitSpec(configToSpec(config, makeData()));
    const result = compile(spec);
    const xAxisLabels = result.axes.filter((mark): mark is TextMark => {
      const datum = mark.datum as { role?: string; axisPart?: string } | undefined;
      return mark.type === 'text' && datum?.role === 'x-axis' && datum.axisPart === 'label';
    });

    expect(spec.encoding?.x?.axis?.labelAngle).toBeUndefined();
    expect(xAxisLabels.every((mark) => mark.rotation === undefined)).toBe(true);
    expect(result.layout.margin.bottom).toBeLessThan(160);
  });

  it('maps OOXML vertical text modes to label angles', () => {
    const config = makeDateAxisConfig('line');
    config.axis = {
      ...config.axis,
      categoryAxis: {
        ...config.axis?.categoryAxis,
        format: { textVerticalType: 'vert270' },
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

    expect(result.layout.margin.left).toBeGreaterThanOrEqual(220);
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
    config.height = 300;
    config.axis = {
      ...config.axis,
      valueAxis: {
        visible: true,
        min: 0,
        max: 50_000_000,
        numberFormat: '"$"#,##0',
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
    expect(spec.config?.layoutHints?.leftYAxisLabelWidth).toBeGreaterThanOrEqual(
      spec.config?.layoutHints?.rightYAxisLabelWidth ?? 0,
    );

    const result = compile(spec);
    expect(result.layout.margin.left).toBeGreaterThan(0);
    expect(result.layout.margin.right).toBeGreaterThan(0);
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
    config.height = 180;
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
    expect(spec.encoding?.color?.scale).toMatchObject({
      range: ['#A5A5A5', '#ED7D31'],
    });
    expect(spec.encoding?.color?.legend).toMatchObject({
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
    const xAxisLabelBottom = Math.max(
      ...result.axes
        .filter((mark): mark is TextMark => {
          const datum = mark.datum as { role?: string; axisPart?: string } | undefined;
          return mark.type === 'text' && datum?.role === 'x-axis' && datum.axisPart === 'label';
        })
        .map((mark) => mark.y + (mark.fontSize ?? 0)),
    );

    expect(rightAxisLabels.length).toBeGreaterThan(0);
    expect(lineMarks.map((mark) => mark.style.stroke)).toEqual(['#A5A5A5', '#ED7D31']);
    expect(legendSymbols.map((mark) => mark.style.stroke)).toEqual(['#A5A5A5', '#ED7D31']);
    expect(legendLabels.map((mark) => mark.text)).toEqual(['Primary', 'Secondary']);
    expect(new Set(legendLabels.map((mark) => mark.y)).size).toBe(1);
    expect(Math.min(...legendLabels.map((mark) => mark.y))).toBeGreaterThan(
      result.layout.plotArea.y + result.layout.plotArea.height,
    );
    expect(Math.min(...legendLabels.map((mark) => mark.y))).toBeGreaterThan(xAxisLabelBottom);
  });

  it('uses per-series legend glyphs for mixed combo chart families', () => {
    const data: ChartData = {
      categories: DATE_SERIALS,
      series: [
        {
          name: 'Requests',
          data: DATE_SERIALS.map((serial, pointIndex) => ({
            x: serial,
            y: 180 + pointIndex * 20,
          })),
        },
        {
          name: 'p95',
          data: DATE_SERIALS.map((serial, pointIndex) => ({
            x: serial,
            y: 50 + pointIndex * 5,
          })),
        },
      ],
    };
    const config = makeDateAxisConfig('combo', 2);
    config.legend = {
      show: true,
      visible: true,
      position: 'bottom',
    };
    config.series = [
      {
        name: 'Requests',
        type: 'column',
        format: {
          fill: { type: 'solid', color: '#44546A' },
          line: { color: '#1F2937', width: 0.75 },
        },
      },
      {
        name: 'p95',
        type: 'line',
        format: { line: { color: '#FF0000', width: 1.5 } },
      },
    ];

    const spec = asLayerSpec(configToSpec(config, data));

    expect(spec.encoding?.color?.legend).toMatchObject({
      values: ['Requests', 'p95'],
      entries: [
        {
          value: 'Requests',
          label: 'Requests',
          symbolType: 'area',
          seriesIndex: 0,
          sourceSeriesIndex: 0,
          sourceSeriesKey: 'series:0',
        },
        {
          value: 'p95',
          label: 'p95',
          symbolType: 'line',
          seriesIndex: 1,
          sourceSeriesIndex: 1,
          sourceSeriesKey: 'series:1',
        },
      ],
    });
    expect(spec.encoding?.color?.legend).not.toHaveProperty('symbolTypeByValue');

    const result = compile(spec);
    const legendKeys = result.legends.filter((mark): mark is RectMark | PathMark => {
      const datum = mark.datum as { entryIndex?: number } | undefined;
      return (mark.type === 'rect' || mark.type === 'path') && datum?.entryIndex !== undefined;
    });

    expect(legendKeys.map((mark) => mark.type)).toEqual(['rect', 'path']);
    expect((legendKeys[0] as RectMark).width).toBeGreaterThan((legendKeys[0] as RectMark).height);
    expect((legendKeys[1] as PathMark).style.stroke).toBe('#FF0000');
  });

  it('groups stacked combo area series so plot bands use the same raw colors as legend swatches', () => {
    const data: ChartData = {
      categories: ['A', 'B', 'C'],
      series: [
        {
          name: 'Layer 1',
          data: [
            { x: 'A', y: 2 },
            { x: 'B', y: 3 },
            { x: 'C', y: 4 },
          ],
        },
        {
          name: 'Layer 2',
          data: [
            { x: 'A', y: 1 },
            { x: 'B', y: 2 },
            { x: 'C', y: 3 },
          ],
        },
        {
          name: 'Reference',
          data: [
            { x: 'A', y: 1 },
            { x: 'B', y: 2 },
            { x: 'C', y: 2 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'combo',
      subType: 'stacked',
      anchorRow: 0,
      anchorCol: 0,
      width: 480,
      height: 75,
      legend: { show: true, visible: true, position: 'bottom' },
      series: [
        {
          name: 'Layer 1',
          type: 'area',
          format: {
            fill: { type: 'solid', color: '#4472C4', transparency: 0.25 },
            line: { color: '#4472C4' },
          },
        },
        {
          name: 'Layer 2',
          type: 'area',
          format: {
            fill: { type: 'solid', color: '#ED7D31', transparency: 0.5 },
            line: { color: '#ED7D31' },
          },
        },
        {
          name: 'Reference',
          type: 'line',
          format: { line: { color: '#70AD47', width: 1.5 } },
        },
      ],
    };

    const spec = asLayerSpec(configToSpec(config, data));
    const areaLayers = spec.layer.filter(
      (layer) => layer.mark && typeof layer.mark === 'object' && layer.mark.type === 'area',
    );

    expect(areaLayers).toHaveLength(1);
    expect(areaLayers[0].encoding?.detail).toMatchObject({
      field: SERIES_INDEX_FIELD,
      type: 'nominal',
      legend: null,
    });
    expect(areaLayers[0].encoding?.color?.legend).toBeNull();
    expect(areaLayers[0].transform).toEqual([
      { type: 'filter', filter: { field: SERIES_INDEX_FIELD, oneOf: [0, 1] } },
    ]);

    const result = compile(spec, undefined, {
      width: 400,
      height: 300,
      skipAxes: true,
      skipTitle: true,
    });
    const areaMarks = result.marks.filter((mark): mark is PathMark => {
      const datum = mark.datum as Array<{ series?: string }> | undefined;
      return (
        mark.type === 'path' &&
        Array.isArray(datum) &&
        (datum[0]?.series === 'Layer 1' || datum[0]?.series === 'Layer 2')
      );
    });

    expect(areaMarks).toHaveLength(2);
    expect(areaMarks.map((mark) => mark.style.fill)).toEqual(['#4472C4', '#ED7D31']);
    expect(areaMarks.map((mark) => mark.style.opacity)).toEqual([undefined, undefined]);
    expect(areaMarks.map((mark) => mark.style.fillPaint?.opacity)).toEqual([0.75, 0.5]);

    const plotBottom = result.layout.plotArea.y + result.layout.plotArea.height;
    expect(Math.max(...pathYCoordinates(areaMarks[1].path))).toBeLessThan(plotBottom - 1);

    const legendAreaSwatches = result.legends.filter((mark): mark is RectMark => {
      const datum = mark.datum as { entryIndex?: number } | undefined;
      return mark.type === 'rect' && datum?.entryIndex !== undefined;
    });
    expect(legendAreaSwatches.map((mark) => mark.style.fill)).toEqual(['#4472C4', '#ED7D31']);
  });

  it('clips imported combo marks and keeps per-series colors without a default legend', () => {
    const categories = [DATE_SERIALS[0] - 30, ...DATE_SERIALS, DATE_SERIALS[2] + 30];
    const data: ChartData = {
      categories,
      series: [
        {
          name: 'Primary Area',
          data: categories.map((serial, pointIndex) => ({
            x: serial,
            y: pointIndex < 2 ? -10_000_000_000 : 10_000_000_000,
          })),
        },
        {
          name: 'Rate Delta',
          yAxisIndex: 1,
          data: categories.map((serial, pointIndex) => ({
            x: serial,
            y: -0.15 + pointIndex * 0.1,
          })),
        },
        {
          name: 'Reference Line',
          data: categories.map((serial, pointIndex) => ({
            x: serial,
            y: 20_000_000 + pointIndex * 5_000_000,
          })),
        },
      ],
    };
    const config = makeDateAxisConfig('combo', 3);
    config.height = 270;
    config.axis = {
      ...config.axis,
      categoryAxis: {
        ...config.axis?.categoryAxis,
        min: DATE_SERIALS[0],
        max: DATE_SERIALS[2],
        majorUnit: 2,
        baseTimeUnit: 'months',
        majorTimeUnit: 'months',
      },
      valueAxis: {
        visible: true,
        min: 0,
        max: 50_000_000,
        numberFormat: '"$"#,##0',
      },
      secondaryValueAxis: {
        visible: true,
        min: -0.2,
        max: 0.3,
        numberFormat: '0%',
      },
    };
    config.series = [
      {
        name: 'Primary Area',
        type: 'area',
        format: {
          fill: { type: 'solid', color: '#9DC3E6', transparency: 0.57 },
          line: { color: '#9DC3E6' },
        },
      },
      {
        name: 'Rate Delta',
        type: 'column',
        yAxisIndex: 1,
        format: {
          fill: { type: 'solid', color: '#70AD47' },
          line: { color: '#000000', width: 0.75 },
        },
      },
      {
        name: 'Reference Line',
        type: 'line',
        format: {
          fill: { type: 'solid', color: '#70AD47' },
          line: { color: '#000000', width: 1.5 },
        },
      },
    ];

    const spec = asLayerSpec(configToSpec(config, data));

    expect(spec.encoding?.color).toBeUndefined();
    expect(spec.layer.some((layer) => layer.encoding?.color)).toBe(true);
    expect(
      spec.layer.every((layer) => !layer.encoding?.color || layer.encoding.color.legend === null),
    ).toBe(true);
    expect((spec.layer[0].encoding?.x?.axis as AxisWithTicks | undefined)?.tickInterval).toEqual({
      unit: 'month',
      step: 2,
    });
    expect(spec.config?.layoutHints?.leftYAxisLabelWidth).toBeGreaterThanOrEqual(
      spec.config?.layoutHints?.rightYAxisLabelWidth ?? 0,
    );

    const result = compile(spec);
    expect(result.layout.margin.left).toBeGreaterThan(0);
    expect(result.layout.margin.right).toBeGreaterThan(0);
    expect(result.legends).toHaveLength(0);

    const plotClip = result.layout.plotArea;
    const clippedDataMarks = result.marks.filter(
      (mark) => mark.type === 'rect' || mark.type === 'path' || mark.type === 'symbol',
    );
    expect(clippedDataMarks.length).toBeGreaterThan(0);
    expect(clippedDataMarks.every((mark) => mark.clip !== undefined)).toBe(true);
    expect(clippedDataMarks.map((mark) => mark.clip)).toEqual(
      clippedDataMarks.map(() => ({ ...plotClip })),
    );

    const bars = result.marks.filter((mark): mark is RectMark => {
      const datum = mark.datum as { series?: string } | undefined;
      return mark.type === 'rect' && datum?.series === 'Rate Delta';
    });
    const paths = result.marks.filter((mark): mark is PathMark => mark.type === 'path');
    const area = paths.find((mark) => {
      const datum = mark.datum as Array<{ series?: string }> | undefined;
      return Array.isArray(datum) && datum[0]?.series === 'Primary Area';
    });
    const line = paths.find((mark) => {
      const datum = mark.datum as Array<{ series?: string }> | undefined;
      return Array.isArray(datum) && datum[0]?.series === 'Reference Line';
    });

    expect(bars.length).toBeGreaterThan(0);
    expect(bars.every((mark) => mark.style.fill === '#70AD47')).toBe(true);
    expect(bars.every((mark) => mark.style.stroke === '#000000')).toBe(true);
    expect(area?.style.fill).toBe('#9DC3E6');
    expect(area?.style.opacity).toBeUndefined();
    expect(area?.style.fillPaint?.opacity).toBeCloseTo(0.43);
    expect(line?.style.stroke).toBe('#000000');
    expect(line?.style.strokeWidth).toBe(2);

    const areaCoordinates = (area?.path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const areaYCoordinates = areaCoordinates.filter((_, index) => index % 2 === 1);
    expect(Math.min(...areaYCoordinates)).toBeGreaterThanOrEqual(plotClip.y);
    expect(Math.max(...areaYCoordinates)).toBeLessThanOrEqual(plotClip.y + plotClip.height);
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
      width: 480,
      height: 75,
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

  it('preserves blank category rows when imported charts use gap blanks', () => {
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
        {
          type: 'line',
          anchorRow: 0,
          anchorCol: 0,
          width: 480,
          height: 75,
          displayBlanksAs: 'gap',
        },
        data,
      ),
    );
    const zeroSpec = asUnitSpec(
      configToSpec(
        {
          type: 'line',
          anchorRow: 0,
          anchorCol: 0,
          width: 480,
          height: 75,
          displayBlanksAs: 'zero',
        },
        data,
      ),
    );

    expect(inlineRows(gapSpec).map((row) => row.category)).toEqual(['A', 'B', 'C']);
    expect(inlineRows(gapSpec).map((row) => row.value)).toEqual([1, undefined, 2]);
    expect(inlineRows(zeroSpec).map((row) => row.category)).toEqual(['A', 'B', 'C']);
    expect(inlineRows(zeroSpec).map((row) => row.value)).toEqual([1, 0, 2]);
  });
});
