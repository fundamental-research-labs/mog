import { DEFAULT_AXIS_LABEL_FONT_SIZE, DEFAULT_AXIS_TITLE_FONT_SIZE } from '../../defaults';
import { compile } from '../../grammar/compiler';
import type { TextMark } from '../../primitives/types';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';

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

function axisTextMarks(
  marks: readonly unknown[],
  role: string,
  axisPart: string,
): TextMark[] {
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
    const spec = configToSpec(chartConfig(), DATA);
    const result = compile(spec, undefined, { width: 640, height: 360 });

    const xLabels = axisTextMarks(result.axes, 'x-axis', 'label');
    const yLabels = axisTextMarks(result.axes, 'y-axis', 'label');
    const yTitles = axisTextMarks(result.axes, 'y-axis', 'title');

    expect(xLabels.length).toBeGreaterThan(0);
    expect(yLabels.length).toBeGreaterThan(0);
    expect(xLabels.every((mark) => mark.fontSize === DEFAULT_AXIS_LABEL_FONT_SIZE)).toBe(true);
    expect(yLabels.every((mark) => mark.fontSize === DEFAULT_AXIS_LABEL_FONT_SIZE)).toBe(true);
    expect(yTitles).toHaveLength(1);
    expect(yTitles[0].fontSize).toBe(DEFAULT_AXIS_TITLE_FONT_SIZE);
  });
});
