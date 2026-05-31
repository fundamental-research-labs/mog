import { compile } from '../../grammar/compiler';
import type { AxisSpec, ChartSpec, UnitSpec } from '../../grammar/spec';
import type { TextMark } from '../../primitives/types';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';
import {
  EXCEL_AXIS_LABEL_FONT_SIZE_PX,
  EXCEL_AXIS_TITLE_FONT_SIZE_PX,
} from '../config-to-spec/axis-defaults';
import { pointsToCanvasPx } from '../config-to-spec/units';

const DATA: ChartData = {
  categories: ['A', 'B', 'C'],
  series: [
    {
      name: 'Series 1',
      data: [
        { x: 'A', y: 10 },
        { x: 'B', y: 20 },
        { x: 'C', y: 30 },
      ],
    },
  ],
};

function chartConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    type: 'column',
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 15,
    axis: {
      categoryAxis: {
        visible: true,
        axisType: 'catAx',
        position: 'b',
      },
      valueAxis: {
        visible: true,
        axisType: 'valAx',
        position: 'l',
        min: 0,
        max: 1,
        numberFormat: '0%',
        title: 'Value',
      },
    },
    ...overrides,
  };
}

function asUnitSpec(spec: ChartSpec): UnitSpec {
  expect(spec.layer).toBeUndefined();
  return spec as UnitSpec;
}

function axisTextMarks(marks: readonly unknown[], role: string, axisPart: string): TextMark[] {
  return marks.filter((mark): mark is TextMark => {
    if (!mark || typeof mark !== 'object' || (mark as { type?: unknown }).type !== 'text') {
      return false;
    }
    const datum = (mark as { datum?: { role?: string; axisPart?: string } }).datum;
    return datum?.role === role && datum.axisPart === axisPart;
  });
}

describe('configToSpec implicit axis font defaults', () => {
  it('uses Excel-sized defaults when imported axis text omits txPr font size', () => {
    const spec = asUnitSpec(configToSpec(chartConfig(), DATA));

    expect(spec.encoding?.x?.axis).toMatchObject({
      labelFontSize: EXCEL_AXIS_LABEL_FONT_SIZE_PX,
    });
    expect(spec.encoding?.y?.axis).toMatchObject({
      labelFontSize: EXCEL_AXIS_LABEL_FONT_SIZE_PX,
      titleFontSize: EXCEL_AXIS_TITLE_FONT_SIZE_PX,
    });

    const result = compile(spec, undefined, { width: 640, height: 360 });

    const xLabels = axisTextMarks(result.axes, 'x-axis', 'label');
    const yLabels = axisTextMarks(result.axes, 'y-axis', 'label');
    const yTitles = axisTextMarks(result.axes, 'y-axis', 'title');

    expect(xLabels.length).toBeGreaterThan(0);
    expect(yLabels.length).toBeGreaterThan(0);
    expect(xLabels.every((mark) => mark.fontSize === EXCEL_AXIS_LABEL_FONT_SIZE_PX)).toBe(true);
    expect(yLabels.every((mark) => mark.fontSize === EXCEL_AXIS_LABEL_FONT_SIZE_PX)).toBe(true);
    expect(yTitles).toHaveLength(1);
    expect(yTitles[0].fontSize).toBe(EXCEL_AXIS_TITLE_FONT_SIZE_PX);
  });

  it('preserves explicit imported axis text font sizes over defaults', () => {
    const spec = asUnitSpec(
      configToSpec(
        chartConfig({
          axis: {
            categoryAxis: {
              visible: true,
              axisType: 'catAx',
              position: 'b',
              format: { font: { size: 7 } },
            },
            valueAxis: {
              visible: true,
              axisType: 'valAx',
              position: 'l',
              min: 0,
              max: 1,
              numberFormat: '0%',
              title: 'Value',
              format: { font: { size: 6 } },
              titleFormat: { font: { size: 8 } },
            },
          },
        }),
        DATA,
      ),
    );

    const xAxis = spec.encoding?.x?.axis as AxisSpec | undefined;
    const yAxis = spec.encoding?.y?.axis as AxisSpec | undefined;
    expect(xAxis?.labelFontSize).toBe(pointsToCanvasPx(7));
    expect(yAxis?.labelFontSize).toBe(pointsToCanvasPx(6));
    expect(yAxis?.titleFontSize).toBe(pointsToCanvasPx(8));
  });
});
