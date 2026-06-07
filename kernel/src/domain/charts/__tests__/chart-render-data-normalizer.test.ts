import type { ChartConfig, ChartData } from '@mog/charts';

import {
  isNoFillNoLineSeriesConfig,
  normalizeChartDataForRendering,
  normalizeImportedCategoryData,
  sourceLinkedAxisNumberFormatDiagnostics,
  trimTrailingBlankChartData,
  withCategoryFormatCodes,
  withSourceLinkedAxisNumberFormats,
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

  it('preserves independent quantitative x vectors for imported scatter series', () => {
    const normalized = normalizeImportedCategoryData(
      data({
        categories: [-0.065, 0.145],
        series: [
          {
            name: 'Cluster 1',
            data: [
              { x: -0.065, y: 1 },
              { x: 0.145, y: 2 },
            ],
          },
          {
            name: 'Cluster 2',
            data: [
              { x: 0.135, y: 3 },
              { x: -0.063, y: 4 },
              { x: 0.093, y: 5 },
            ],
          },
        ],
      }),
      {
        type: 'scatter',
        anchorRow: 0,
        anchorCol: 0,
        width: 4,
        height: 4,
        series: [
          {
            xRole: 'quantitative',
            categoryCache: {
              pointCount: 2,
              points: [
                { idx: 0, value: '-0.065' },
                { idx: 1, value: '0.145' },
              ],
            },
          },
          {
            xRole: 'quantitative',
            categoryCache: {
              pointCount: 3,
              points: [
                { idx: 0, value: '0.135' },
                { idx: 1, value: '-0.063' },
                { idx: 2, value: '0.093' },
              ],
            },
          },
        ],
      } as ChartConfig,
    );

    expect(normalized.categories).toHaveLength(3);
    expect(normalized.series[0].data.map((point) => point.x)).toEqual([-0.065, 0.145]);
    expect(normalized.series[1].data.map((point) => point.x)).toEqual([0.135, -0.063, 0.093]);
  });

  it('preserves imported bubble x and size values through category normalization', () => {
    const normalized = normalizeImportedCategoryData(
      data({
        categories: [1],
        series: [
          {
            name: 'Bubbles A',
            data: [{ x: 1, y: 10, size: 5 }],
          },
          {
            name: 'Bubbles B',
            data: [
              { x: 10, y: 20, size: 15 },
              { x: 20, y: 30, size: 25 },
            ],
          },
        ],
      }),
      {
        type: 'bubble',
        anchorRow: 0,
        anchorCol: 0,
        width: 4,
        height: 4,
        series: [
          {
            xRole: 'quantitative',
            categoryCache: { pointCount: 1, points: [{ idx: 0, value: '1' }] },
          },
          {
            xRole: 'quantitative',
            categoryCache: {
              pointCount: 2,
              points: [
                { idx: 0, value: '10' },
                { idx: 1, value: '20' },
              ],
            },
          },
        ],
      } as ChartConfig,
    );

    expect(normalized.categories).toHaveLength(2);
    expect(normalized.series[1].data).toEqual([
      { x: 10, y: 20, size: 15 },
      { x: 20, y: 30, size: 25 },
    ]);
  });

  it('normalizes category-role combo series without rewriting quantitative scatter layers', () => {
    const normalized = normalizeImportedCategoryData(
      data({
        categories: ['Fallback A', 'Fallback B'],
        series: [
          {
            name: 'Line',
            data: [
              { x: 'Fallback A', y: 1 },
              { x: 'Fallback B', y: 2 },
            ],
          },
          {
            name: 'Scatter',
            data: [
              { x: 10, y: 3 },
              { x: 20, y: 4 },
              { x: 30, y: 5 },
            ],
          },
        ],
      }),
      {
        type: 'combo',
        anchorRow: 0,
        anchorCol: 0,
        width: 4,
        height: 4,
        series: [
          {
            type: 'line',
            xRole: 'category',
            categoryCache: {
              pointCount: 2,
              points: [
                { idx: 0, value: 'North' },
                { idx: 1, value: 'South' },
              ],
            },
          },
          {
            type: 'scatter',
            xRole: 'quantitative',
            categoryCache: {
              pointCount: 3,
              points: [
                { idx: 0, value: '10' },
                { idx: 1, value: '20' },
                { idx: 2, value: '30' },
              ],
            },
          },
        ],
      } as ChartConfig,
    );

    expect(normalized.categories).toEqual(['North', 'South', '']);
    expect(normalized.series[0].data).toEqual([
      { x: 'North', y: 1, name: 'North' },
      { x: 'South', y: 2, name: 'South' },
    ]);
    expect(normalized.series[1].data.map((point) => point.x)).toEqual([10, 20, 30]);
  });

  it('trims trailing blank chart categories, points, and category format codes', () => {
    expect(
      trimTrailingBlankChartData(
        data({
          categories: ['A', '', ''],
          categoryLevels: [
            { level: 0, labels: ['North', 'North', null] },
            { level: 1, labels: ['Q1', null, null] },
          ],
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
      categoryLevels: [
        { level: 0, labels: ['North'] },
        { level: 1, labels: ['Q1'] },
      ],
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

  it("preserves trailing blank category domains for displayBlanksAs 'gap' and 'span'", () => {
    const source = data({
      categories: ['A', 'B', 'C'],
      categoryFormatCodes: ['fmt-a', 'fmt-b', 'fmt-c'],
      series: [
        {
          name: 'Series 1',
          data: [
            { x: 'A', y: 1 },
            { x: 'B', y: 0, valueState: 'blank' },
            { x: 'C', y: 0, valueState: 'blank' },
          ],
        },
      ],
    });

    for (const displayBlanksAs of ['gap', 'span'] as const) {
      expect(
        normalizeChartDataForRendering(source, {
          type: 'line',
          displayBlanksAs,
          anchorRow: 0,
          anchorCol: 0,
          width: 4,
          height: 4,
        } as ChartConfig),
      ).toEqual(source);
    }
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

  it('resolves source-linked category and value axis formats from imported caches', () => {
    const config = {
      type: 'combo',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 4,
      axis: {
        categoryAxis: { visible: true, linkNumberFormat: true },
        valueAxis: { visible: true, linkNumberFormat: true },
        secondaryValueAxis: { visible: true, linkNumberFormat: true },
      },
      series: [
        {
          categoryLabelFormat: { formatCode: 'mmm-yy', points: [] },
          valueCache: { formatCode: '$#,##0', points: [{ idx: 0, value: '1200' }] },
        },
        {
          yAxisIndex: 1,
          valueCache: { formatCode: '0.0%', points: [{ idx: 0, value: '0.2' }] },
        },
      ],
    } as ChartConfig;

    const resolved = withSourceLinkedAxisNumberFormats(config);

    expect(resolved).not.toBe(config);
    expect(resolved.axis?.categoryAxis?.numberFormat).toBe('mmm-yy');
    expect(resolved.axis?.xAxis?.numberFormat).toBe('mmm-yy');
    expect(resolved.axis?.valueAxis?.numberFormat).toBe('$#,##0');
    expect(resolved.axis?.yAxis?.numberFormat).toBe('$#,##0');
    expect(resolved.axis?.secondaryValueAxis?.numberFormat).toBe('0.0%');
    expect(resolved.axis?.secondaryYAxis?.numberFormat).toBe('0.0%');
    expect(sourceLinkedAxisNumberFormatDiagnostics(resolved)).toEqual([]);
  });

  it('reports unresolved and conflicting source-linked value axis formats', () => {
    expect(
      sourceLinkedAxisNumberFormatDiagnostics({
        type: 'line',
        anchorRow: 0,
        anchorCol: 0,
        width: 4,
        height: 4,
        axis: {
          valueAxis: { visible: true, linkNumberFormat: true },
          secondaryValueAxis: { visible: true, linkNumberFormat: true, numberFormat: '0%' },
        },
        series: [{ valueCache: { formatCode: '$#,##0', points: [] } }],
      } as ChartConfig),
    ).toEqual(['secondary value axis source-linked number format has no source format; using 0%']);

    expect(
      sourceLinkedAxisNumberFormatDiagnostics({
        type: 'line',
        anchorRow: 0,
        anchorCol: 0,
        width: 4,
        height: 4,
        axis: { valueAxis: { visible: true, linkNumberFormat: true } },
        series: [
          { valueCache: { formatCode: '$#,##0', points: [] } },
          { valueCache: { formatCode: '0.0%', points: [] } },
        ],
      } as ChartConfig),
    ).toEqual([
      'value axis source-linked number format uses first bound series format due to conflicting source formats',
    ]);
  });

  it('uses explicit live source-linked axis format resolutions for rendering and diagnostics', () => {
    const config = {
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 4,
      extra: { owner: 'chart-import' },
      axis: {
        valueAxis: { visible: true, linkNumberFormat: true, numberFormat: '0%' },
      },
      series: [],
    } as ChartConfig;

    const resolved = withSourceLinkedAxisNumberFormats(config, {
      value: {
        formatCode: '$#,##0',
        missingSource: false,
        conflictingFormats: true,
      },
    });

    expect(resolved.axis?.valueAxis?.numberFormat).toBe('$#,##0');
    expect(resolved.axis?.yAxis?.numberFormat).toBe('$#,##0');
    expect(resolved.extra).toMatchObject({ owner: 'chart-import' });
    expect(sourceLinkedAxisNumberFormatDiagnostics(resolved)).toEqual([
      'value axis source-linked number format uses first bound series format due to conflicting source formats',
    ]);
  });
});
