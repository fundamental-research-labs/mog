import type { ChartConfig, ChartData } from '../../types';
import { chartDataToRows } from '../config-to-spec';
import {
  BLANK_VALUE_FIELD,
  BUBBLE_SIZE_FIELD,
  CATEGORY_FIELD,
  LINE_SEGMENT_FIELD,
  POINT_INDEX_FIELD,
  RAW_BUBBLE_SIZE_FIELD,
  RAW_CATEGORY_FIELD,
  SCATTER_X_FIELD,
  SERIES_FIELD,
  SERIES_OPACITY_FIELD,
  VALUE_FIELD,
} from '../config-to-spec/fields';

function baseConfig(type: ChartConfig['type']): ChartConfig {
  return {
    type,
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 5,
  };
}

describe('chartDataToRows', () => {
  it('uses stable category keys for imported duplicate and blank category labels', () => {
    const data: ChartData = {
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
    const config: ChartConfig = {
      ...baseConfig('bar'),
      subType: 'stacked',
      extra: {},
    };

    const rows = chartDataToRows(data, config);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row[CATEGORY_FIELD])).toEqual([
      '__mogCategory:0',
      '__mogCategory:2',
      '__mogCategory:3',
    ]);
    expect(rows.map((row) => row[RAW_CATEGORY_FIELD])).toEqual(['Group A', 'Repeated', 'Repeated']);
    expect(rows.map((row) => row[POINT_INDEX_FIELD])).toEqual([0, 2, 3]);
  });

  it("emits blank category rows and advances line segments for displayBlanksAs 'gap'", () => {
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
    const config: ChartConfig = {
      ...baseConfig('line'),
      displayBlanksAs: 'gap',
    };

    const rows = chartDataToRows(data, config);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row[POINT_INDEX_FIELD])).toEqual([0, 1, 2]);
    expect(rows[1]).toEqual(
      expect.objectContaining({
        [CATEGORY_FIELD]: 'B',
        [RAW_CATEGORY_FIELD]: 'B',
        [BLANK_VALUE_FIELD]: true,
      }),
    );
    expect(rows[1]).not.toHaveProperty(VALUE_FIELD);
    expect(rows.map((row) => row[LINE_SEGMENT_FIELD])).toEqual([0, undefined, 1]);
  });

  it('breaks scatter line segments for blank x and y points when showLines is enabled', () => {
    const data: ChartData = {
      categories: [1, '', 3, 4],
      series: [
        {
          name: 'Series 1',
          data: [
            { x: 1, y: 10 },
            { x: '', y: 0, valueState: 'blank' },
            { x: 3, y: 0, valueState: 'blank' },
            { x: 4, y: 40 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      ...baseConfig('scatter'),
      displayBlanksAs: 'gap',
      showLines: true,
    };

    const rows = chartDataToRows(data, config);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row[POINT_INDEX_FIELD])).toEqual([0, 3]);
    expect(rows.map((row) => row[SCATTER_X_FIELD])).toEqual([1, 4]);
    expect(rows.map((row) => row[VALUE_FIELD])).toEqual([10, 40]);
    expect(rows.map((row) => row[LINE_SEGMENT_FIELD])).toEqual([0, 2]);
  });

  it('breaks scatter line segments for invalid omitted quantitative points only in gap mode', () => {
    const data: ChartData = {
      categories: [1, 'not-x', 3],
      series: [
        {
          name: 'Series 1',
          data: [
            { x: 1, y: 10 },
            { x: 'not-x', y: 20 },
            { x: 3, y: 30 },
          ],
        },
      ],
    };
    const gapConfig: ChartConfig = {
      ...baseConfig('scatter'),
      displayBlanksAs: 'gap',
      showLines: true,
    };
    const spanConfig: ChartConfig = {
      ...baseConfig('scatter'),
      displayBlanksAs: 'span',
      showLines: true,
    };

    const gapRows = chartDataToRows(data, gapConfig);
    const spanRows = chartDataToRows(data, spanConfig);

    expect(gapRows.map((row) => row[POINT_INDEX_FIELD])).toEqual([0, 2]);
    expect(gapRows.map((row) => row[SCATTER_X_FIELD])).toEqual([1, 3]);
    expect(gapRows.map((row) => row[VALUE_FIELD])).toEqual([10, 30]);
    expect(gapRows.map((row) => row[LINE_SEGMENT_FIELD])).toEqual([0, 1]);

    expect(spanRows.map((row) => row[POINT_INDEX_FIELD])).toEqual([0, 2]);
    expect(spanRows.map((row) => row[LINE_SEGMENT_FIELD])).toEqual([undefined, undefined]);
  });

  it('emits raw and width-normalized bubble size fields', () => {
    const data: ChartData = {
      categories: [1, 2],
      series: [
        {
          name: 'Bubbles',
          data: [
            { x: 1, y: 10, size: 10 },
            { x: 2, y: 20, size: 20 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      ...baseConfig('bubble'),
      sizeRepresents: 'w',
    };

    const rows = chartDataToRows(data, config);

    expect(rows).toEqual([
      expect.objectContaining({
        [SCATTER_X_FIELD]: 1,
        [VALUE_FIELD]: 10,
        [BUBBLE_SIZE_FIELD]: 5,
        [RAW_BUBBLE_SIZE_FIELD]: 10,
      }),
      expect.objectContaining({
        [SCATTER_X_FIELD]: 2,
        [VALUE_FIELD]: 20,
        [BUBBLE_SIZE_FIELD]: 20,
        [RAW_BUBBLE_SIZE_FIELD]: 20,
      }),
    ]);
  });

  it('marks no-fill no-line series rows as transparent while leaving visible series opaque', () => {
    const data: ChartData = {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Hidden scaffold',
          data: [
            { x: 'A', y: 100 },
            { x: 'B', y: 200 },
          ],
        },
        {
          name: 'Visible',
          data: [
            { x: 'A', y: 10 },
            { x: 'B', y: 20 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      ...baseConfig('column'),
      series: [
        {
          idx: 0,
          format: { fill: { type: 'none' }, line: {} },
        },
        {
          idx: 1,
          format: {
            fill: { type: 'solid', color: { theme: 'accent1' } },
            line: { color: { theme: 'tx1' }, width: 0.75 },
          },
        },
      ],
    };

    const rows = chartDataToRows(data, config);
    const hiddenRows = rows.filter((row) => row[SERIES_FIELD] === 'Hidden scaffold');
    const visibleRows = rows.filter((row) => row[SERIES_FIELD] === 'Visible');

    expect(hiddenRows.map((row) => row[SERIES_OPACITY_FIELD])).toEqual([0, 0]);
    expect(visibleRows.map((row) => row[SERIES_OPACITY_FIELD])).toEqual([1, 1]);
  });
});
