import type { TextMark } from '../../primitives/types';
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
});
