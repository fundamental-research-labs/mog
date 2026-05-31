import type { RectMark } from '../../primitives/types';
import type { ChartConfig, ChartData } from '../../types';
import { compile } from '../../grammar/compiler';
import { configToSpec } from '../config-to-spec';
import { SERIES_FILL_FIELD } from '../config-to-spec/fields';

function importedBarConfig(): ChartConfig {
  return {
    type: 'bar',
    subType: 'clustered',
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 5,
    series: [
      {
        name: 'Before',
        idx: 0,
        order: 0,
        color: '2F75B5',
        format: {
          fill: { type: 'solid', color: '2F75B5' },
          line: { color: '2F75B5' },
        },
      },
      {
        name: 'After',
        idx: 1,
        order: 1,
        color: '70AD47',
        format: {
          fill: { type: 'solid', color: '70AD47' },
          line: { color: '70AD47' },
        },
      },
    ],
  };
}

function importedBarData(): ChartData {
  return {
    categories: ['North', 'South'],
    series: [
      {
        name: 'Before',
        data: [
          { x: 'North', y: 49 },
          { x: 'South', y: 26 },
        ],
      },
      {
        name: 'After',
        data: [
          { x: 'North', y: 79 },
          { x: 'South', y: 55 },
        ],
      },
    ],
  };
}

function isSeriesRect(mark: unknown): mark is RectMark {
  return (
    typeof mark === 'object' &&
    mark !== null &&
    (mark as { type?: unknown }).type === 'rect' &&
    typeof (mark as { datum?: { series?: unknown } }).datum?.series === 'string'
  );
}

describe('configToSpec bar series colors', () => {
  it('lets per-series imported fills override the primary series fill paint', () => {
    const spec = configToSpec(importedBarConfig(), importedBarData());
    const mark = spec.mark;
    expect(typeof mark).toBe('object');
    expect((mark as { fillField?: string }).fillField).toBe(SERIES_FILL_FIELD);

    const rects = compile(spec).marks.filter(isSeriesRect);

    expect(rects).toHaveLength(4);
    expect(new Set(rects.map((rect) => rect.style.fill))).toEqual(new Set(['#2F75B5', '#70AD47']));
    expect(rects.every((rect) => rect.style.fillPaint === undefined)).toBe(true);
    expect(rects.every((rect) => rect.datum[SERIES_FILL_FIELD] === rect.style.fill)).toBe(true);
  });
});
