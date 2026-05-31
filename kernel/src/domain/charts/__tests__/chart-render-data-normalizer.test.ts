import type { ChartConfig, ChartData } from '@mog/charts';

import {
  isNoFillNoLineSeriesConfig,
  normalizeChartDataForRendering,
  normalizeImportedCategoryData,
  trimTrailingBlankChartData,
  withCategoryFormatCodes,
} from '../bridge/chart-render-data-normalizer';

const data = (overrides: Partial<ChartData> = {}): ChartData => ({
  categories: ['A', 'B'],
  series: [
    {
      name: 'Series 1',
      data: [
        { x: 'A', y: 1 },
        { x: 'B', y: 2 },
      ],
    },
  ],
  ...overrides,
});

describe('chart render data normalizer', () => {
  it('applies category format codes from imported category label format', () => {
    expect(
      withCategoryFormatCodes(data(), {
        type: 'line',
        anchorRow: 0,
        anchorCol: 0,
        width: 4,
        height: 4,
        series: [
          {
            categoryLabelFormat: {
              formatCode: 'general',
              points: [{ idx: 1, formatCode: 'mmm-yy' }],
            },
          },
        ],
      } as ChartConfig),
    ).toMatchObject({
      categoryFormatCodes: ['general', 'mmm-yy'],
    });
  });

  it('normalizes imported category cache values and omitted cached points', () => {
    const normalized = normalizeImportedCategoryData(data({ categories: ['A', 'B', 'C'] }), {
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 4,
      series: [
        {
          categoryCache: {
            pointCount: 3,
            points: [
              { idx: 0, value: '45292' },
              { idx: 2, value: 'North' },
            ],
          },
        },
      ],
    } as ChartConfig);

    expect(normalized.categories).toEqual([45292, '', 'North']);
    expect(normalized.series[0].data).toEqual([
      { x: 45292, y: 1, name: '45292' },
      { x: '', y: 2, name: '' },
    ]);
  });

  it('trims trailing blank chart categories, points, and category format codes', () => {
    expect(
      trimTrailingBlankChartData(
        data({
          categories: ['A', '', ''],
          categoryFormatCodes: ['fmt-a', 'fmt-b', 'fmt-c'],
          series: [
            {
              name: 'Series 1',
              data: [
                { x: 'A', y: 1 },
                { x: '', y: 0, valueState: 'blank' },
                { x: '', y: 0, valueState: 'blank' },
              ],
            },
          ],
        }),
      ),
    ).toEqual({
      categories: ['A'],
      categoryFormatCodes: ['fmt-a'],
      series: [
        {
          name: 'Series 1',
          data: [{ x: 'A', y: 1 }],
        },
      ],
    });
  });

  it('normalizes in the same order used by rendering', () => {
    const normalized = normalizeChartDataForRendering(
      data({
        categories: ['Fallback', ''],
        series: [
          {
            name: 'Series 1',
            data: [
              { x: 'Fallback', y: 1 },
              { x: '', y: 0, valueState: 'blank' },
            ],
          },
        ],
      }),
      {
        type: 'line',
        anchorRow: 0,
        anchorCol: 0,
        width: 4,
        height: 4,
        series: [
          {
            categoryLabelFormat: { formatCode: 'fmt', points: [] },
            categoryCache: { pointCount: 2, points: [{ idx: 0, value: 'From Cache' }] },
          },
        ],
      } as ChartConfig,
    );

    expect(normalized).toEqual({
      categories: ['From Cache'],
      categoryFormatCodes: ['fmt'],
      series: [
        {
          name: 'Series 1',
          data: [{ x: 'From Cache', y: 1, name: 'From Cache' }],
        },
      ],
    });
  });

  it('detects no-fill/no-line series for render and diagnostics filtering', () => {
    expect(
      isNoFillNoLineSeriesConfig({
        format: { fill: { type: 'none' } },
      }),
    ).toBe(true);
    expect(
      isNoFillNoLineSeriesConfig({
        format: { fill: { type: 'none' }, line: { color: '#ff0000' } },
      }),
    ).toBe(false);
    expect(isNoFillNoLineSeriesConfig(undefined)).toBe(false);
  });
});
